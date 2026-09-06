const DEFAULT_ATTEMPTS = 6;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_READ_TIMEOUT_MS = 15_000;
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_UPDATE_TIMEOUT_MS = 300_000;
const DEFAULT_ROLLBACK_GRACE_MS = 15_000;
const DEFAULT_TTS_RETRY_DELAY_MS = 15_000;
const DEFAULT_TTS_WINDOW_MS = 20 * 60_000;
// The deploy command gets 44 of the workflow's 50 minutes. Target work is
// capped at 32 minutes, leaving 12 for a 5-minute rollback update plus the
// 6m15s worst-case rollback probes and 45s of internal headroom.
const DEFAULT_DEPLOYMENT_WINDOW_MS = 44 * 60_000;
const DEFAULT_ROLLBACK_RESERVE_MS = 12 * 60_000;
const RELEASE_VERSION_TOKEN = '${SUBWAVE_VERSION:?required}';
const UNRESOLVED_RELEASE_VERSION = /\$\{SUBWAVE_VERSION[^}]*\}/;
const TTS_IMAGE_REPOSITORY = 'ghcr.io/obiwancanoweme/subwave-tts-heavy-cuda';
const DIGEST = /^sha256:[a-f0-9]{64}$/;

export class PortainerRequestTimeoutError extends Error {
  constructor(operation, timeoutMs, options = {}) {
    super(`Portainer ${operation} timed out after ${timeoutMs}ms`, options);
    this.name = 'PortainerRequestTimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

export class DeploymentVerificationError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'DeploymentVerificationError';
  }
}

function deadlineTimeout(maximumMs, deadlineMs, now, label) {
  if (deadlineMs === undefined) return maximumMs;
  const remainingMs = Math.floor(deadlineMs - now());
  if (remainingMs <= 0) throw new DeploymentVerificationError(`${label} deadline exhausted`);
  return Math.min(maximumMs, remainingMs);
}

async function sleepBeforeDeadline({ milliseconds, deadlineMs, now, sleep }) {
  const boundedMs = deadlineTimeout(milliseconds, deadlineMs, now, 'Deployment');
  await sleep(boundedMs);
  return boundedMs;
}

export class DeploymentRolledBackError extends Error {
  constructor({ targetVersion, previousVersion, cause }) {
    super('Target deployment failed; rollback verified', { cause });
    this.name = 'DeploymentRolledBackError';
    this.targetVersion = targetVersion;
    this.previousVersion = previousVersion;
  }
}

export class RollbackIncidentError extends Error {
  constructor({ targetVersion, previousVersion, deploymentError, rollbackError }) {
    super('Target deployment failed and rollback failed or could not be verified', {
      cause: new AggregateError([deploymentError, rollbackError]),
    });
    this.name = 'RollbackIncidentError';
    this.targetVersion = targetVersion;
    this.previousVersion = previousVersion;
  }
}

export function upsertEnv(env, name, value) {
  const next = [];
  let found = false;
  for (const entry of env) {
    if (entry.name !== name) {
      next.push({ ...entry });
    } else if (!found) {
      next.push({ ...entry, value });
      found = true;
    }
  }
  if (!found) next.push({ name, value });
  return next;
}

export function renderReleaseManifest(manifest, targetVersion) {
  if (!manifest.includes(RELEASE_VERSION_TOKEN)) {
    throw new Error('Portainer manifest has no exact SUBWAVE_VERSION placeholder');
  }
  const rendered = manifest.replaceAll(RELEASE_VERSION_TOKEN, targetVersion);
  if (UNRESOLVED_RELEASE_VERSION.test(rendered)) {
    throw new Error('Portainer manifest has an unresolved SUBWAVE_VERSION placeholder');
  }
  return rendered;
}

export class PortainerClient {
  constructor({
    baseUrl,
    apiKey,
    stackId,
    endpointId,
    fetchImpl = fetch,
    readTimeoutMs = DEFAULT_READ_TIMEOUT_MS,
    updateTimeoutMs = DEFAULT_UPDATE_TIMEOUT_MS,
    signalFactory = AbortSignal.timeout,
    pollDelayMs = DEFAULT_RETRY_DELAY_MS,
    sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    now = () => performance.now(),
  }) {
    Object.assign(this, { apiKey, stackId, endpointId, fetch: fetchImpl });
    Object.assign(this, { readTimeoutMs, updateTimeoutMs, signalFactory, now });
    Object.assign(this, { pollDelayMs, sleep });
    this.pendingUpdate = false;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async request(path, {
    timeoutMs = this.readTimeoutMs,
    deadlineMs,
    operation = 'request',
    ...options
  } = {}) {
    const boundedTimeoutMs = deadlineTimeout(timeoutMs, deadlineMs, this.now, `Portainer ${operation}`);
    try {
      const response = await this.fetch(`${this.baseUrl}/api${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
          ...options.headers,
        },
        signal: this.signalFactory(boundedTimeoutMs),
      });
      if (!response.ok) {
        try {
          await response.body?.cancel();
        } catch {
          // The status is sufficient; never replace it with body cleanup details.
        }
        throw new Error(`Portainer ${operation} failed with HTTP ${response.status}`);
      }
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new PortainerRequestTimeoutError(operation, boundedTimeoutMs, { cause: error });
      }
      throw error;
    }
  }

  async snapshotStack({ deadlineMs } = {}) {
    const [stack, file] = await Promise.all([
      this.request(`/stacks/${this.stackId}`, { deadlineMs }),
      this.request(`/stacks/${this.stackId}/file`, { deadlineMs }),
    ]);
    this.stackName = stack.Name;
    return { Env: stack.Env ?? [], StackFileContent: file.StackFileContent };
  }

  // Portainer 2.45 returns Status=3 before Compose finishes. Never inspect the
  // new containers or send rollback while that deployment is still running.
  // Status enum: portainer/portainer api/portainer.go (2.45.0), 1/2/3/4.
  async waitForStackUpdate({ deadlineMs }) {
    while (true) {
      const stack = await this.request(`/stacks/${this.stackId}`, {
        deadlineMs, operation: 'stack deployment status',
      });
      if ([1, 2, 4].includes(stack?.Status)) {
        this.pendingUpdate = false;
        return stack;
      }
      if (stack?.Status !== 3) {
        throw new DeploymentVerificationError('Portainer stack deployment status is unknown');
      }
      await sleepBeforeDeadline({
        milliseconds: this.pollDelayMs, deadlineMs, now: this.now, sleep: this.sleep,
      });
    }
  }

  async updateStack(snapshot, { deadlineMs } = {}) {
    const updateDeadline = Math.min(deadlineMs ?? Infinity, this.now() + this.updateTimeoutMs);
    // An earlier timeout/read failure leaves an uncertain operation. Prove it
    // terminal before attempting another PUT, including rollback.
    if (this.pendingUpdate) await this.waitForStackUpdate({ deadlineMs: updateDeadline });
    const stack = await this.request(`/stacks/${this.stackId}?endpointId=${this.endpointId}`, {
      method: 'PUT',
      body: JSON.stringify({ ...snapshot, Prune: true, PullImage: true }),
      timeoutMs: this.updateTimeoutMs,
      deadlineMs: updateDeadline,
      operation: 'stack update',
    });
    if (stack?.Status === 3) {
      this.pendingUpdate = true;
      const result = await this.waitForStackUpdate({ deadlineMs: updateDeadline });
      if (result.Status !== 1) {
        throw new DeploymentVerificationError('Portainer stack deployment failed');
      }
      return result;
    }
    if (stack?.Status === 4 || stack?.Status === 2) {
      throw new DeploymentVerificationError('Portainer stack deployment failed');
    }
    return stack;
  }

  inspectContainer(containerId, operation = 'container inspection', { deadlineMs } = {}) {
    return this.request(
      `/endpoints/${this.endpointId}/docker/containers/${encodeURIComponent(containerId)}/json`,
      { operation, deadlineMs },
    );
  }

  inspectImage(imageRef, { deadlineMs } = {}) {
    return this.request(
      `/endpoints/${this.endpointId}/docker/images/${encodeURIComponent(imageRef)}/json`,
      { operation: 'TTS image inspection', deadlineMs },
    );
  }

  async verifyAnalyzerDeployment({ releaseTag, deadlineMs }) {
    try {
      if (typeof releaseTag !== 'string' || releaseTag.length === 0) {
        throw new DeploymentVerificationError('Analyzer release image tag is missing');
      }
      const containers = await this.request(
        `/endpoints/${this.endpointId}/docker/containers/json?all=true`,
        { operation: 'analyzer container listing', deadlineMs },
      );
      const analyzer = Array.isArray(containers) && containers.find((container) => {
        const labels = container?.Labels ?? {};
        if (labels['com.docker.compose.service'] !== 'analyzer') return false;
        if (this.stackName) return labels['com.docker.compose.project'] === this.stackName;
        return container?.Names?.includes('/sub-wave-analyzer');
      });
      if (!analyzer?.Id) {
        throw new DeploymentVerificationError('Analyzer container is missing');
      }

      const container = await this.inspectContainer(analyzer.Id, 'container inspection', { deadlineMs });
      if (container?.State?.Running !== true) {
        throw new DeploymentVerificationError('Analyzer container is not running');
      }
      if (container?.State?.Health?.Status !== 'healthy') {
        throw new DeploymentVerificationError('Analyzer container is not healthy');
      }
      if (container?.RestartCount !== 0) {
        throw new DeploymentVerificationError('Analyzer container restart count is not zero');
      }
      if (typeof container?.Config?.Image !== 'string'
        || !container.Config.Image.endsWith(`:${releaseTag}`)) {
        throw new DeploymentVerificationError('Analyzer container does not use the release image');
      }
      return container;
    } catch (error) {
      if (error instanceof DeploymentVerificationError) throw error;
      throw new DeploymentVerificationError('Analyzer deployment verification failed', { cause: error });
    }
  }

  async verifyTtsDeployment({ releaseTag, expectedDigest, deadlineMs }) {
    try {
      if (typeof releaseTag !== 'string' || releaseTag.length === 0) {
        throw new DeploymentVerificationError('CUDA TTS release image tag is missing');
      }
      if (typeof expectedDigest !== 'string' || !DIGEST.test(expectedDigest)) {
        throw new DeploymentVerificationError('CUDA TTS expected repository digest is missing or malformed');
      }
      const expectedImage = `${TTS_IMAGE_REPOSITORY}:${releaseTag}`;
      const containers = await this.request(
        `/endpoints/${this.endpointId}/docker/containers/json?all=true`,
        { operation: 'TTS container listing', deadlineMs },
      );
      const tts = Array.isArray(containers) && containers.find((container) => {
        const labels = container?.Labels ?? {};
        if (labels['com.docker.compose.service'] !== 'tts-heavy') return false;
        if (this.stackName) return labels['com.docker.compose.project'] === this.stackName;
        return container?.Names?.includes('/sub-wave-tts-heavy');
      });
      if (!tts?.Id) {
        throw new DeploymentVerificationError('CUDA TTS container is missing');
      }

      const container = await this.inspectContainer(
        tts.Id,
        'TTS container inspection',
        { deadlineMs },
      );
      if (container?.State?.Running !== true) {
        throw new DeploymentVerificationError('CUDA TTS container is not running');
      }
      if (container?.State?.Health?.Status !== 'healthy') {
        throw new DeploymentVerificationError('CUDA TTS container is not healthy');
      }
      if (container?.RestartCount !== 0) {
        throw new DeploymentVerificationError('CUDA TTS container restart count is not zero');
      }
      if (container?.Config?.Image !== expectedImage) {
        throw new DeploymentVerificationError('CUDA TTS container does not use the exact release image');
      }

      // Bind the running container to the local immutable tag and require a
      // registry digest for the expected repository. Tag preflight guarantees
      // the release tag itself was absent before publication; this proves the
      // exact pulled artifact, rather than an unrelated image with a matching
      // Config.Image string, is what Docker started.
      const image = await this.inspectImage(expectedImage, { deadlineMs });
      if (typeof container?.Image !== 'string'
        || typeof image?.Id !== 'string'
        || container.Image !== image.Id) {
        throw new DeploymentVerificationError('CUDA TTS container image identity does not match the release tag');
      }
      const expectedRepoDigest = `${TTS_IMAGE_REPOSITORY}@${expectedDigest}`;
      if (!Array.isArray(image?.RepoDigests) || image.RepoDigests.length !== 1) {
        throw new DeploymentVerificationError('CUDA TTS release image must have exactly one repository digest');
      }
      if (image.RepoDigests[0] !== expectedRepoDigest) {
        throw new DeploymentVerificationError('CUDA TTS release image does not have the expected repository digest');
      }
      return container;
    } catch (error) {
      if (error instanceof DeploymentVerificationError) throw error;
      throw new DeploymentVerificationError('CUDA TTS deployment verification failed', { cause: error });
    }
  }
}

async function retry(operation, {
  attempts = DEFAULT_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  deadlineMs,
  now = () => performance.now(),
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error('Retry attempts must be a positive integer');
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (deadlineMs !== undefined && now() >= deadlineMs) {
      throw lastError ?? new DeploymentVerificationError('Deployment deadline exhausted');
    }
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        if (deadlineMs === undefined) await sleep(retryDelayMs);
        else await sleepBeforeDeadline({ milliseconds: retryDelayMs, deadlineMs, now, sleep });
      }
    }
  }
  throw lastError;
}

async function retryUntilDeadline(operation, {
  deadlineMs,
  retryDelayMs,
  sleep,
  now,
}) {
  let lastError;
  while (now() < deadlineMs) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (now() >= deadlineMs) break;
      await sleepBeforeDeadline({ milliseconds: retryDelayMs, deadlineMs, now, sleep });
    }
  }
  throw lastError ?? new DeploymentVerificationError('CUDA TTS verification deadline exhausted');
}

function probeOptions(options) {
  const {
    fetchImpl = fetch,
    probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
    signalFactory = AbortSignal.timeout,
    streamPassword,
    deadlineMs,
    now = () => performance.now(),
    ...retryOptions
  } = options;
  return {
    fetchImpl, probeTimeoutMs, signalFactory, streamPassword, deadlineMs, now, retryOptions,
  };
}

export async function probeHealth(url, options = {}) {
  const {
    fetchImpl, probeTimeoutMs, signalFactory, deadlineMs, now, retryOptions,
  } = probeOptions(options);
  return retry(async () => {
    const timeoutMs = deadlineTimeout(probeTimeoutMs, deadlineMs, now, 'Health probe');
    const response = await fetchImpl(url, { signal: signalFactory(timeoutMs) });
    if (response.status !== 200) {
      throw new Error(`Health probe failed with HTTP ${response.status}`);
    }
    const body = await response.json();
    if (body?.status !== 'on-air') {
      throw new Error(`Health probe reported status ${String(body?.status)}`);
    }
  }, { ...retryOptions, deadlineMs, now });
}

export async function probeStream(url, options = {}) {
  const {
    fetchImpl, probeTimeoutMs, signalFactory, streamPassword, deadlineMs, now, retryOptions,
  } = probeOptions(options);
  return retry(async () => {
    const headers = streamPassword
      ? { Authorization: `Basic ${Buffer.from(`listener:${streamPassword}`).toString('base64')}` }
      : undefined;
    const timeoutMs = deadlineTimeout(probeTimeoutMs, deadlineMs, now, 'Stream probe');
    const response = await fetchImpl(url, {
      ...(headers ? { headers } : {}),
      signal: signalFactory(timeoutMs),
    });
    let reader;
    let probeError;
    try {
      reader = response.body?.getReader();
      if (response.status !== 200) {
        throw new Error(`Stream probe failed with HTTP ${response.status}`);
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!/^audio\/mpeg(?:\s*;|$)/i.test(contentType)) {
        throw new Error(`Stream probe returned unexpected content type ${contentType || '(missing)'}`);
      }
      if (!reader) throw new Error('Stream probe returned no response body');

      while (true) {
        const { value, done } = await reader.read();
        if (value?.byteLength > 0) return;
        if (done) throw new Error('Stream probe returned an empty response body');
      }
    } catch (error) {
      probeError = error;
      throw error;
    } finally {
      try {
        if (reader) await reader.cancel();
        else if (response.body) await response.body.cancel();
      } catch (cancelError) {
        if (!probeError) throw cancelError;
      }
    }
  }, { ...retryOptions, deadlineMs, now });
}

function versionFrom(env) {
  return env.find((entry) => entry.name === 'SUBWAVE_VERSION')?.value ?? null;
}

async function verifyDeployment({
  client,
  releaseTag,
  healthUrl,
  streamUrl,
  streamPassword,
  fetchImpl,
  expectedTtsDigest,
  requireTts = false,
  deadlineMs,
  ttsWindowMs = DEFAULT_TTS_WINDOW_MS,
  ttsRetryDelayMs = DEFAULT_TTS_RETRY_DELAY_MS,
  now = () => performance.now(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ...retryOptions
}) {
  const options = { fetchImpl, deadlineMs, now, sleep, ...retryOptions };
  await probeHealth(healthUrl, options);
  await probeStream(streamUrl, { ...options, streamPassword });
  // Compose's analyzer healthcheck is the /health contract gate: ok=true and
  // an active `analyze` engine. Inspecting healthy here proves that contract
  // without exposing the analyzer on a public host port.
  await retry(
    () => client.verifyAnalyzerDeployment({ releaseTag, deadlineMs }),
    { ...retryOptions, deadlineMs, now, sleep },
  );
  if (requireTts) {
    const ttsDeadlineMs = Math.min(deadlineMs, now() + ttsWindowMs);
    await retryUntilDeadline(
      () => client.verifyTtsDeployment({
        releaseTag,
        expectedDigest: expectedTtsDigest,
        deadlineMs: ttsDeadlineMs,
      }),
      { deadlineMs: ttsDeadlineMs, retryDelayMs: ttsRetryDelayMs, sleep, now },
    );
  }
}

export async function deployWithRollback({
  client,
  manifest,
  targetVersion,
  healthUrl,
  streamUrl,
  streamPassword,
  fetchImpl = fetch,
  attempts = DEFAULT_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  expectedTtsDigest,
  ttsWindowMs = DEFAULT_TTS_WINDOW_MS,
  ttsRetryDelayMs = DEFAULT_TTS_RETRY_DELAY_MS,
  rollbackGraceMs = DEFAULT_ROLLBACK_GRACE_MS,
  deploymentWindowMs = DEFAULT_DEPLOYMENT_WINDOW_MS,
  rollbackReserveMs = DEFAULT_ROLLBACK_RESERVE_MS,
  now = () => performance.now(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  const renderedManifest = renderReleaseManifest(manifest, targetVersion);
  const deploymentDeadlineMs = now() + deploymentWindowMs;
  const targetDeadlineMs = deploymentDeadlineMs - rollbackReserveMs;
  if (targetDeadlineMs <= now()) throw new Error('Deployment timing budget is invalid');
  const snapshot = await client.snapshotStack({ deadlineMs: targetDeadlineMs });
  const previousVersion = versionFrom(snapshot.Env);
  const target = {
    Env: upsertEnv(snapshot.Env, 'SUBWAVE_VERSION', targetVersion),
    StackFileContent: renderedManifest,
  };
  const verification = {
    client,
    healthUrl,
    streamUrl,
    streamPassword,
    fetchImpl,
    attempts,
    retryDelayMs,
    expectedTtsDigest,
    ttsWindowMs,
    ttsRetryDelayMs,
    now,
    sleep,
  };

  try {
    await client.updateStack(target, { deadlineMs: targetDeadlineMs });
    await verifyDeployment({
      ...verification,
      releaseTag: targetVersion,
      requireTts: true,
      deadlineMs: targetDeadlineMs,
    });
  } catch (deploymentError) {
    // Older synchronous servers may continue work after a response timeout.
    // Retain their bounded grace; async deployments are additionally settled
    // by updateStack before any rollback PUT.
    if (deploymentError instanceof PortainerRequestTimeoutError
      && deploymentError.operation === 'stack update'
      && rollbackGraceMs > 0) {
      await sleepBeforeDeadline({
        milliseconds: rollbackGraceMs,
        deadlineMs: deploymentDeadlineMs,
        now,
        sleep,
      });
    }
    try {
      await client.updateStack(snapshot, { deadlineMs: deploymentDeadlineMs });
      // v1.7.0-obiwave.1 predates Ark's default-on TTS sidecar. Rollback
      // verification therefore retains the public radio + analyzer contract
      // without requiring a container the restored snapshot never ran.
      await verifyDeployment({
        ...verification,
        releaseTag: previousVersion,
        deadlineMs: deploymentDeadlineMs,
      });
    } catch (rollbackError) {
      throw new RollbackIncidentError({
        targetVersion, previousVersion, deploymentError, rollbackError,
      });
    }
    throw new DeploymentRolledBackError({ targetVersion, previousVersion, cause: deploymentError });
  }

  return { previousVersion, targetVersion };
}

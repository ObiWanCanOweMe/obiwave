const DEFAULT_ATTEMPTS = 6;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_READ_TIMEOUT_MS = 15_000;
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_UPDATE_TIMEOUT_MS = 300_000;
const DEFAULT_ROLLBACK_GRACE_MS = 15_000;
const DEFAULT_TTS_ATTEMPTS = 81;
const DEFAULT_TTS_RETRY_DELAY_MS = 15_000;
const RELEASE_VERSION_TOKEN = '${SUBWAVE_VERSION:?required}';
const UNRESOLVED_RELEASE_VERSION = /\$\{SUBWAVE_VERSION[^}]*\}/;
const TTS_IMAGE_REPOSITORY = 'ghcr.io/obiwancanoweme/subwave-tts-heavy-cuda';

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
  }) {
    Object.assign(this, { apiKey, stackId, endpointId, fetch: fetchImpl });
    Object.assign(this, { readTimeoutMs, updateTimeoutMs, signalFactory });
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async request(path, { timeoutMs = this.readTimeoutMs, operation = 'request', ...options } = {}) {
    try {
      const response = await this.fetch(`${this.baseUrl}/api${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
          ...options.headers,
        },
        signal: this.signalFactory(timeoutMs),
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
        throw new PortainerRequestTimeoutError(operation, timeoutMs, { cause: error });
      }
      throw error;
    }
  }

  async snapshotStack() {
    const [stack, file] = await Promise.all([
      this.request(`/stacks/${this.stackId}`),
      this.request(`/stacks/${this.stackId}/file`),
    ]);
    this.stackName = stack.Name;
    return { Env: stack.Env ?? [], StackFileContent: file.StackFileContent };
  }

  updateStack(snapshot) {
    return this.request(`/stacks/${this.stackId}?endpointId=${this.endpointId}`, {
      method: 'PUT',
      body: JSON.stringify({ ...snapshot, Prune: true, PullImage: true }),
      timeoutMs: this.updateTimeoutMs,
      operation: 'stack update',
    });
  }

  inspectContainer(containerId, operation = 'container inspection') {
    return this.request(
      `/endpoints/${this.endpointId}/docker/containers/${encodeURIComponent(containerId)}/json`,
      { operation },
    );
  }

  inspectImage(imageRef) {
    return this.request(
      `/endpoints/${this.endpointId}/docker/images/${encodeURIComponent(imageRef)}/json`,
      { operation: 'TTS image inspection' },
    );
  }

  async verifyAnalyzerDeployment({ releaseTag }) {
    try {
      if (typeof releaseTag !== 'string' || releaseTag.length === 0) {
        throw new DeploymentVerificationError('Analyzer release image tag is missing');
      }
      const containers = await this.request(
        `/endpoints/${this.endpointId}/docker/containers/json?all=true`,
        { operation: 'analyzer container listing' },
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

      const container = await this.inspectContainer(analyzer.Id);
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

  async verifyTtsDeployment({ releaseTag }) {
    try {
      if (typeof releaseTag !== 'string' || releaseTag.length === 0) {
        throw new DeploymentVerificationError('CUDA TTS release image tag is missing');
      }
      const expectedImage = `${TTS_IMAGE_REPOSITORY}:${releaseTag}`;
      const containers = await this.request(
        `/endpoints/${this.endpointId}/docker/containers/json?all=true`,
        { operation: 'TTS container listing' },
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

      const container = await this.inspectContainer(tts.Id, 'TTS container inspection');
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
      const image = await this.inspectImage(expectedImage);
      if (typeof container?.Image !== 'string'
        || typeof image?.Id !== 'string'
        || container.Image !== image.Id) {
        throw new DeploymentVerificationError('CUDA TTS container image identity does not match the release tag');
      }
      const expectedDigestPrefix = `${TTS_IMAGE_REPOSITORY}@sha256:`;
      if (!Array.isArray(image?.RepoDigests)
        || !image.RepoDigests.some((digest) => (
          typeof digest === 'string'
          && digest.startsWith(expectedDigestPrefix)
          && /^[0-9a-f]{64}$/.test(digest.slice(expectedDigestPrefix.length))
        ))) {
        throw new DeploymentVerificationError('CUDA TTS release image has no expected repository digest');
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
} = {}) {
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error('Retry attempts must be a positive integer');
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(retryDelayMs);
    }
  }
  throw lastError;
}

function probeOptions(options) {
  const {
    fetchImpl = fetch,
    probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
    signalFactory = AbortSignal.timeout,
    streamPassword,
    ...retryOptions
  } = options;
  return { fetchImpl, probeTimeoutMs, signalFactory, streamPassword, retryOptions };
}

export async function probeHealth(url, options = {}) {
  const { fetchImpl, probeTimeoutMs, signalFactory, retryOptions } = probeOptions(options);
  return retry(async () => {
    const response = await fetchImpl(url, { signal: signalFactory(probeTimeoutMs) });
    if (response.status !== 200) {
      throw new Error(`Health probe failed with HTTP ${response.status}`);
    }
    const body = await response.json();
    if (body?.status !== 'on-air') {
      throw new Error(`Health probe reported status ${String(body?.status)}`);
    }
  }, retryOptions);
}

export async function probeStream(url, options = {}) {
  const { fetchImpl, probeTimeoutMs, signalFactory, streamPassword, retryOptions } = probeOptions(options);
  return retry(async () => {
    const headers = streamPassword
      ? { Authorization: `Basic ${Buffer.from(`listener:${streamPassword}`).toString('base64')}` }
      : undefined;
    const response = await fetchImpl(url, {
      ...(headers ? { headers } : {}),
      signal: signalFactory(probeTimeoutMs),
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
  }, retryOptions);
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
  requireTts = false,
  ttsAttempts = DEFAULT_TTS_ATTEMPTS,
  ttsRetryDelayMs = DEFAULT_TTS_RETRY_DELAY_MS,
  ...retryOptions
}) {
  const options = { fetchImpl, ...retryOptions };
  await probeHealth(healthUrl, options);
  await probeStream(streamUrl, { ...options, streamPassword });
  // Compose's analyzer healthcheck is the /health contract gate: ok=true and
  // an active `analyze` engine. Inspecting healthy here proves that contract
  // without exposing the analyzer on a public host port.
  await retry(() => client.verifyAnalyzerDeployment({ releaseTag }), retryOptions);
  if (requireTts) {
    await retry(
      () => client.verifyTtsDeployment({ releaseTag }),
      { ...retryOptions, attempts: ttsAttempts, retryDelayMs: ttsRetryDelayMs },
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
  ttsAttempts = DEFAULT_TTS_ATTEMPTS,
  ttsRetryDelayMs = DEFAULT_TTS_RETRY_DELAY_MS,
  rollbackGraceMs = DEFAULT_ROLLBACK_GRACE_MS,
  sleep,
}) {
  const renderedManifest = renderReleaseManifest(manifest, targetVersion);
  const snapshot = await client.snapshotStack();
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
    ttsAttempts,
    ttsRetryDelayMs,
    ...(sleep ? { sleep } : {}),
  };

  try {
    await client.updateStack(target);
    await verifyDeployment({ ...verification, releaseTag: targetVersion, requireTts: true });
  } catch (deploymentError) {
    // Portainer's update endpoint is synchronous, but after a client timeout the
    // server may briefly continue work. A bounded grace period reduces overlap;
    // the API provides no operation handle with which to prove completion.
    if (deploymentError instanceof PortainerRequestTimeoutError && rollbackGraceMs > 0) {
      await (sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))))(
        rollbackGraceMs,
      );
    }
    try {
      await client.updateStack(snapshot);
      // v1.7.0-obiwave.1 predates Ark's default-on TTS sidecar. Rollback
      // verification therefore retains the public radio + analyzer contract
      // without requiring a container the restored snapshot never ran.
      await verifyDeployment({ ...verification, releaseTag: previousVersion });
    } catch (rollbackError) {
      throw new RollbackIncidentError({
        targetVersion, previousVersion, deploymentError, rollbackError,
      });
    }
    throw new DeploymentRolledBackError({ targetVersion, previousVersion, cause: deploymentError });
  }

  return { previousVersion, targetVersion };
}

const DEFAULT_ATTEMPTS = 6;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_READ_TIMEOUT_MS = 15_000;
const DEFAULT_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_UPDATE_TIMEOUT_MS = 300_000;
const DEFAULT_ROLLBACK_GRACE_MS = 15_000;

export class PortainerRequestTimeoutError extends Error {
  constructor(operation, timeoutMs, options = {}) {
    super(`Portainer ${operation} timed out after ${timeoutMs}ms`, options);
    this.name = 'PortainerRequestTimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
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
  const next = env.map((entry) => ({ ...entry }));
  const found = next.find((entry) => entry.name === name);
  if (found) found.value = value;
  else next.push({ name, value });
  return next;
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
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}/api${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey,
          ...options.headers,
        },
        signal: this.signalFactory(timeoutMs),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new PortainerRequestTimeoutError(operation, timeoutMs, { cause: error });
      }
      throw error;
    }
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
  }

  async snapshotStack() {
    const [stack, file] = await Promise.all([
      this.request(`/stacks/${this.stackId}`),
      this.request(`/stacks/${this.stackId}/file`),
    ]);
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
    ...retryOptions
  } = options;
  return { fetchImpl, probeTimeoutMs, signalFactory, retryOptions };
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
  const { fetchImpl, probeTimeoutMs, signalFactory, retryOptions } = probeOptions(options);
  return retry(async () => {
    const response = await fetchImpl(url, { signal: signalFactory(probeTimeoutMs) });
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

async function verifyDeployment({ healthUrl, streamUrl, fetchImpl, ...retryOptions }) {
  const options = { fetchImpl, ...retryOptions };
  await probeHealth(healthUrl, options);
  await probeStream(streamUrl, options);
}

export async function deployWithRollback({
  client,
  manifest,
  targetVersion,
  healthUrl,
  streamUrl,
  fetchImpl = fetch,
  attempts = DEFAULT_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  rollbackGraceMs = DEFAULT_ROLLBACK_GRACE_MS,
  sleep,
}) {
  const snapshot = await client.snapshotStack();
  const previousVersion = versionFrom(snapshot.Env);
  const target = {
    Env: upsertEnv(snapshot.Env, 'SUBWAVE_VERSION', targetVersion),
    StackFileContent: manifest,
  };
  const verification = {
    healthUrl,
    streamUrl,
    fetchImpl,
    attempts,
    retryDelayMs,
    ...(sleep ? { sleep } : {}),
  };

  try {
    await client.updateStack(target);
    await verifyDeployment(verification);
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
      await verifyDeployment(verification);
    } catch (rollbackError) {
      throw new RollbackIncidentError({
        targetVersion, previousVersion, deploymentError, rollbackError,
      });
    }
    throw new DeploymentRolledBackError({ targetVersion, previousVersion, cause: deploymentError });
  }

  return { previousVersion, targetVersion };
}

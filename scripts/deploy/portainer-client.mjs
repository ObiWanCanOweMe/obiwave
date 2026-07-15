const DEFAULT_ATTEMPTS = 24;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const REQUEST_TIMEOUT_MS = 30_000;

export function upsertEnv(env, name, value) {
  const next = env.map((entry) => ({ ...entry }));
  const found = next.find((entry) => entry.name === name);
  if (found) found.value = value;
  else next.push({ name, value });
  return next;
}

export class PortainerClient {
  constructor({ baseUrl, apiKey, stackId, endpointId, fetchImpl = fetch }) {
    Object.assign(this, { apiKey, stackId, endpointId, fetch: fetchImpl });
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async request(path, options = {}) {
    const response = await this.fetch(`${this.baseUrl}/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        ...options.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Portainer request failed with HTTP ${response.status}: ${text}`);
    }
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
  const { fetchImpl = fetch, ...retryOptions } = options;
  return { fetchImpl, retryOptions };
}

export async function probeHealth(url, options = {}) {
  const { fetchImpl, retryOptions } = probeOptions(options);
  return retry(async () => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
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
  const { fetchImpl, retryOptions } = probeOptions(options);
  return retry(async () => {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
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
    try {
      await client.updateStack(snapshot);
      await verifyDeployment(verification);
    } catch (rollbackError) {
      throw new AggregateError(
        [deploymentError, rollbackError],
        'Deployment verification failed and rollback could not be verified',
      );
    }
    throw new Error('Deployment verification failed; rollback verified', { cause: deploymentError });
  }

  return { previousVersion, targetVersion };
}

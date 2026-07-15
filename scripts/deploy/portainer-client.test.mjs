import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PortainerClient,
  deployWithRollback,
  probeHealth,
  probeStream,
  upsertEnv,
} from './portainer-client.mjs';
import { runRelease } from './portainer-release.mjs';

const oldFile = 'services:\n  controller:\n    image: old\n';
const newFile = 'services:\n  controller:\n    image: new\n';
const oldEnv = [
  { name: 'ADMIN_USER', value: 'operator', preserved: 'exactly' },
  { name: 'SUBWAVE_VERSION', value: 'v0.41.0-obiwave.3' },
];

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function streamResponse(chunk = new Uint8Array([1, 2, 3])) {
  return new Response(chunk, {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg' },
  });
}

function clientFor(fetchImpl) {
  return new PortainerClient({
    baseUrl: 'https://portainer.example/',
    apiKey: 'secret-token',
    stackId: '7',
    endpointId: '2',
    fetchImpl,
  });
}

test('upsertEnv changes only the requested entry without mutating input', () => {
  const env = [
    { name: 'ADMIN_USER', value: 'operator' },
    { name: 'SUBWAVE_VERSION', value: 'v0.41.0-obiwave.3' },
  ];

  assert.deepEqual(upsertEnv(env, 'SUBWAVE_VERSION', 'v0.42.0-obiwave.1'), [
    { name: 'ADMIN_USER', value: 'operator' },
    { name: 'SUBWAVE_VERSION', value: 'v0.42.0-obiwave.1' },
  ]);
  assert.equal(env[1].value, 'v0.41.0-obiwave.3');
});

test('Portainer update requests pruning and image pulls for the selected endpoint', async () => {
  const calls = [];
  const client = clientFor(async (url, options) => {
    calls.push({ url, ...options });
    return jsonResponse({});
  });

  await client.updateStack({ Env: oldEnv, StackFileContent: newFile });

  const [updateCall] = calls;
  assert.equal(JSON.parse(updateCall.body).Prune, true);
  assert.equal(JSON.parse(updateCall.body).PullImage, true);
  assert.match(updateCall.url, /\/api\/stacks\/7\?endpointId=2$/);
});

test('probes require on-air JSON and a non-empty MP3 body chunk', async () => {
  const cancelled = [];
  const fetchImpl = async (url) => {
    if (url.endsWith('/health')) return jsonResponse({ status: 'on-air' });
    return new Response(new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array([9]));
      },
      cancel() {
        cancelled.push(true);
      },
    }), { status: 200, headers: { 'Content-Type': 'audio/mpeg; charset=binary' } });
  };

  await probeHealth('https://radio.example/health', { fetchImpl, attempts: 1 });
  await probeStream('https://radio.example/stream.mp3', { fetchImpl, attempts: 1 });
  assert.equal(cancelled.length, 1);
});

test('deploys the checked-in manifest once after preserving the operator environment', async () => {
  const successfulUpdateCalls = [];
  const portainerFetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/stacks/7' && options.method === 'PUT') {
      successfulUpdateCalls.push({ url, ...options });
      return jsonResponse({});
    }
    if (parsed.pathname === '/api/stacks/7') return jsonResponse({ Env: oldEnv });
    if (parsed.pathname === '/api/stacks/7/file') return jsonResponse({ StackFileContent: oldFile });
    throw new Error(`Unexpected request: ${url}`);
  };
  const probeFetch = async (url) => url.endsWith('/health')
    ? jsonResponse({ status: 'on-air' })
    : streamResponse();

  const result = await deployWithRollback({
    client: clientFor(portainerFetch),
    manifest: newFile,
    targetVersion: 'v0.42.0-obiwave.1',
    healthUrl: 'https://radio.example/health',
    streamUrl: 'https://radio.example/stream.mp3',
    fetchImpl: probeFetch,
    attempts: 1,
  });

  assert.equal(successfulUpdateCalls.length, 1);
  const update = JSON.parse(successfulUpdateCalls[0].body);
  assert.deepEqual(update.Env, [
    { name: 'ADMIN_USER', value: 'operator', preserved: 'exactly' },
    { name: 'SUBWAVE_VERSION', value: 'v0.42.0-obiwave.1' },
  ]);
  assert.equal(update.StackFileContent, newFile);
  assert.deepEqual(result, {
    previousVersion: 'v0.41.0-obiwave.3',
    targetVersion: 'v0.42.0-obiwave.1',
  });
});

test('restores the full snapshot and verifies it after a failed target probe', async () => {
  const rolledBackUpdateCalls = [];
  let updateCount = 0;
  const portainerFetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/stacks/7' && options.method === 'PUT') {
      updateCount += 1;
      rolledBackUpdateCalls.push({ url, ...options });
      return jsonResponse({});
    }
    if (parsed.pathname === '/api/stacks/7') return jsonResponse({ Env: oldEnv });
    if (parsed.pathname === '/api/stacks/7/file') return jsonResponse({ StackFileContent: oldFile });
    throw new Error(`Unexpected request: ${url}`);
  };
  const probeFetch = async (url) => {
    if (updateCount === 1 && url.endsWith('/health')) {
      return jsonResponse({ status: 'starting' }, { status: 503 });
    }
    return url.endsWith('/health') ? jsonResponse({ status: 'on-air' }) : streamResponse();
  };
  const sleeps = [];

  await assert.rejects(
    deployWithRollback({
      client: clientFor(portainerFetch),
      manifest: newFile,
      targetVersion: 'v0.42.0-obiwave.1',
      healthUrl: 'https://radio.example/health',
      streamUrl: 'https://radio.example/stream.mp3',
      fetchImpl: probeFetch,
      attempts: 2,
      retryDelayMs: 5_000,
      sleep: async (milliseconds) => sleeps.push(milliseconds),
    }),
    /deployment verification failed.*rollback verified/i,
  );

  assert.equal(rolledBackUpdateCalls.length, 2);
  assert.equal(JSON.parse(rolledBackUpdateCalls[1].body).StackFileContent, oldFile);
  assert.deepEqual(JSON.parse(rolledBackUpdateCalls[1].body).Env, oldEnv);
  assert.deepEqual(sleeps, [5_000]);
});

test('release validation rejects malformed tags before any deployment work', async () => {
  let touchedDeployment = false;
  const env = {
    PORTAINER_URL: 'https://portainer.example',
    PORTAINER_API_KEY: 'secret-token',
    PORTAINER_STACK_ID: '7',
    PORTAINER_ENDPOINT_ID: '2',
    SUBWAVE_RELEASE_TAG: 'v0.42.0',
    SUBWAVE_HEALTH_URL: 'https://radio.example/health',
    SUBWAVE_STREAM_URL: 'https://radio.example/stream.mp3',
  };

  await assert.rejects(runRelease({
    env,
    readFile: async () => {
      touchedDeployment = true;
      return newFile;
    },
    clientFactory: () => {
      touchedDeployment = true;
      return {};
    },
  }), /fork-qualified release tag/);
  assert.equal(touchedDeployment, false);
});

test('release validation reports all missing required configuration before deployment work', async () => {
  let touchedDeployment = false;

  await assert.rejects(runRelease({
    env: { SUBWAVE_RELEASE_TAG: 'v0.42.0-obiwave.1' },
    readFile: async () => {
      touchedDeployment = true;
      return newFile;
    },
    clientFactory: () => {
      touchedDeployment = true;
      return {};
    },
  }), (error) => {
    assert.match(error.message, /PORTAINER_URL/);
    assert.match(error.message, /PORTAINER_API_KEY/);
    assert.match(error.message, /SUBWAVE_STREAM_URL/);
    return true;
  });
  assert.equal(touchedDeployment, false);
});

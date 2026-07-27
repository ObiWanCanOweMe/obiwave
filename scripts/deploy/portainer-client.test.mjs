import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';

import {
  DeploymentRolledBackError,
  PortainerClient,
  PortainerRequestTimeoutError,
  RollbackIncidentError,
  deployWithRollback,
  probeHealth,
  probeStream,
  renderReleaseManifest,
  upsertEnv,
} from './portainer-client.mjs';
import { runRelease } from './portainer-release.mjs';

const oldFile = 'services:\n  controller:\n    image: old\n';
const newFile = 'services:\n  controller:\n    image: new\n';
const releaseManifest = `services:
  controller:
    image: ghcr.io/obiwancanoweme/subwave-controller:\${SUBWAVE_VERSION:?required}
  analyzer:
    image: ghcr.io/obiwancanoweme/subwave-analyzer-cuda:\${SUBWAVE_VERSION:?required}
`;
const renderedManifest = `services:
  controller:
    image: ghcr.io/obiwancanoweme/subwave-controller:v0.42.0-obiwave.1
  analyzer:
    image: ghcr.io/obiwancanoweme/subwave-analyzer-cuda:v0.42.0-obiwave.1
`;
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

function clientFor(fetchImpl, options = {}) {
  return new PortainerClient({
    baseUrl: 'https://portainer.example/',
    apiKey: 'secret-token',
    stackId: '7',
    endpointId: '2',
    fetchImpl,
    ...options,
  });
}

function releaseEnv(overrides = {}) {
  return {
    PORTAINER_URL: 'https://portainer.example',
    PORTAINER_API_KEY: 'secret-token',
    PORTAINER_STACK_ID: '7',
    PORTAINER_ENDPOINT_ID: '2',
    SUBWAVE_RELEASE_TAG: 'v0.42.0-obiwave.1',
    SUBWAVE_HEALTH_URL: 'https://radio.example/health',
    SUBWAVE_STREAM_URL: 'https://radio.example/stream.mp3',
    ...overrides,
  };
}

async function recordingServer(handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
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

test('upsertEnv collapses duplicate target entries while preserving unrelated order and fields', () => {
  const env = [
    { name: 'ADMIN_USER', value: 'operator', preserved: 'first' },
    { name: 'SUBWAVE_VERSION', value: 'v0.40.0-obiwave.1', preserved: 'kept-target' },
    { name: 'SITE_URL', value: 'https://radio.example', preserved: 'middle' },
    { name: 'SUBWAVE_VERSION', value: 'v0.41.0-obiwave.3', discarded: true },
    { name: 'ADMIN_PASS', value: 'password', preserved: 'last' },
  ];

  const result = upsertEnv(env, 'SUBWAVE_VERSION', 'v0.42.0-obiwave.1');

  assert.deepEqual(result, [
    { name: 'ADMIN_USER', value: 'operator', preserved: 'first' },
    { name: 'SUBWAVE_VERSION', value: 'v0.42.0-obiwave.1', preserved: 'kept-target' },
    { name: 'SITE_URL', value: 'https://radio.example', preserved: 'middle' },
    { name: 'ADMIN_PASS', value: 'password', preserved: 'last' },
  ]);
  assert.equal(result.filter((entry) => entry.name === 'SUBWAVE_VERSION').length, 1);
  assert.equal(env[1].value, 'v0.40.0-obiwave.1');
});

test('renders every exact release placeholder with the immutable target tag', () => {
  const twice = `${releaseManifest}${releaseManifest.replace('controller:', 'web:')}`;
  const rendered = renderReleaseManifest(twice, 'v0.42.0-obiwave.1');

  assert.equal(rendered.match(/v0\.42\.0-obiwave\.1/g)?.length, 4);
  assert.doesNotMatch(rendered, /\$\{SUBWAVE_VERSION[^}]*\}/);
  assert.doesNotMatch(rendered, /UPSTREAM_ANALYZER_VERSION/);
});

test('rejects missing or unsupported release placeholders before deployment', () => {
  assert.throws(
    () => renderReleaseManifest('services: {}\n', 'v0.42.0-obiwave.1'),
    /no exact SUBWAVE_VERSION placeholder/,
  );
  assert.throws(
    () => renderReleaseManifest(
      `${releaseManifest}\n# \${SUBWAVE_VERSION:-latest}\n`,
      'v0.42.0-obiwave.1',
    ),
    /unresolved SUBWAVE_VERSION placeholder/,
  );
});

test('rejects an invalid release manifest before reading Portainer state', async () => {
  let snapshotCalled = false;
  await assert.rejects(deployWithRollback({
    client: {
      snapshotStack: async () => {
        snapshotCalled = true;
        return { Env: [], StackFileContent: oldFile };
      },
    },
    manifest: 'services: {}\n',
    targetVersion: 'v0.42.0-obiwave.1',
    healthUrl: 'https://radio.example/health',
    streamUrl: 'https://radio.example/stream.mp3',
  }), /no exact SUBWAVE_VERSION placeholder/);
  assert.equal(snapshotCalled, false);
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

test('Portainer uses separate short read and realistic update timeouts', async () => {
  const timeoutSignals = [];
  const signalFactory = (milliseconds) => {
    timeoutSignals.push(milliseconds);
    return new AbortController().signal;
  };
  const client = clientFor(async (url, options = {}) => {
    const parsed = new URL(url);
    if (options.method === 'PUT') return jsonResponse({});
    if (parsed.pathname.endsWith('/file')) return jsonResponse({ StackFileContent: oldFile });
    return jsonResponse({ Env: oldEnv });
  }, { readTimeoutMs: 7_000, updateTimeoutMs: 240_000, signalFactory });

  await client.snapshotStack();
  await client.updateStack({ Env: oldEnv, StackFileContent: newFile });

  assert.deepEqual(timeoutSignals.sort((a, b) => a - b), [7_000, 7_000, 240_000]);
});

test('Portainer HTTP errors do not include response bodies', async () => {
  const client = clientFor(async () => new Response('token=do-not-print', { status: 500 }));

  await assert.rejects(client.snapshotStack(), (error) => {
    assert.match(error.message, /HTTP 500/);
    assert.doesNotMatch(error.message, /do-not-print/);
    return true;
  });
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

test('regression: stream probe authenticates a private mount without putting the secret in its URL', async () => {
  const expected = `Basic ${Buffer.from('listener:mount-secret').toString('base64')}`;
  const requests = [];
  const server = await recordingServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization ?? null });
    if (req.url === '/public' || req.headers.authorization === expected) {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
      res.end(Buffer.from([1, 2, 3]));
      return;
    }
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('private');
  });

  try {
    await probeStream(`${server.baseUrl}/public`, { attempts: 1 });
    await assert.rejects(
      probeStream(`${server.baseUrl}/private`, { attempts: 1 }),
      /HTTP 401/,
    );
    await probeStream(`${server.baseUrl}/private`, {
      attempts: 1,
      streamPassword: 'mount-secret',
    });
  } finally {
    await server.close();
  }

  assert.deepEqual(requests, [
    { url: '/public', authorization: null },
    { url: '/private', authorization: null },
    { url: '/private', authorization: expected },
  ]);
  assert.ok(requests.every(({ url }) => !url.includes('mount-secret')));
});

test('regression: target and rollback stream verification both retain private-mount auth', async () => {
  const expected = `Basic ${Buffer.from('listener:mount-secret').toString('base64')}`;
  const streamAuthorizations = [];
  let streamProbeCount = 0;
  const server = await recordingServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'on-air' }));
      return;
    }
    streamAuthorizations.push(req.headers.authorization ?? null);
    streamProbeCount += 1;
    if (req.headers.authorization !== expected || streamProbeCount === 1) {
      res.writeHead(streamProbeCount === 1 ? 503 : 401, { 'Content-Type': 'text/plain' });
      res.end('not ready');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
    res.end(Buffer.from([9]));
  });
  let updates = 0;
  const client = {
    snapshotStack: async () => ({ Env: oldEnv, StackFileContent: oldFile }),
    updateStack: async () => { updates += 1; },
  };

  try {
    await assert.rejects(deployWithRollback({
      client,
      manifest: releaseManifest,
      targetVersion: 'v0.42.0-obiwave.1',
      healthUrl: `${server.baseUrl}/health`,
      streamUrl: `${server.baseUrl}/private`,
      streamPassword: 'mount-secret',
      attempts: 1,
    }), DeploymentRolledBackError);
  } finally {
    await server.close();
  }

  assert.equal(updates, 2);
  assert.deepEqual(streamAuthorizations, [expected, expected]);
});

test('probes use an independently injected short timeout', async () => {
  const timeoutSignals = [];
  const signalFactory = (milliseconds) => {
    timeoutSignals.push(milliseconds);
    return new AbortController().signal;
  };
  const fetchImpl = async (url) => url.endsWith('/health')
    ? jsonResponse({ status: 'on-air' })
    : streamResponse();

  await probeHealth('https://radio.example/health', {
    fetchImpl, attempts: 1, probeTimeoutMs: 3_000, signalFactory,
  });
  await probeStream('https://radio.example/stream.mp3', {
    fetchImpl, attempts: 1, probeTimeoutMs: 3_000, signalFactory,
  });

  assert.deepEqual(timeoutSignals, [3_000, 3_000]);
});

test('stream probe cancels response bodies rejected by HTTP status or content type', async () => {
  for (const fixture of [
    { status: 503, contentType: 'audio/mpeg', expected: /HTTP 503/ },
    { status: 200, contentType: 'text/html', expected: /unexpected content type text\/html/ },
  ]) {
    let cancelled = 0;
    const body = {
      getReader() {
        return {
          read: async () => ({ value: new Uint8Array([1]), done: false }),
          cancel: async () => { cancelled += 1; },
        };
      },
    };
    const fetchImpl = async () => ({
      status: fixture.status,
      headers: { get: () => fixture.contentType },
      body,
    });

    await assert.rejects(
      probeStream('https://radio.example/stream.mp3', { fetchImpl, attempts: 1 }),
      fixture.expected,
    );
    assert.equal(cancelled, 1);
  }
});

test('stream probe preserves the original read error when cancellation also fails', async () => {
  const readError = new Error('stream read failed');
  const fetchImpl = async () => ({
    status: 200,
    headers: { get: () => 'audio/mpeg' },
    body: {
      getReader() {
        return {
          read: async () => { throw readError; },
          cancel: async () => { throw new Error('cancel failed'); },
        };
      },
    },
  });

  await assert.rejects(
    probeStream('https://radio.example/stream.mp3', { fetchImpl, attempts: 1 }),
    (error) => error === readError,
  );
});

test('deploys the rendered checked-in manifest without an upstream analyzer pin', async () => {
  const unseededEnv = [
    { name: 'ADMIN_USER', value: 'operator', preserved: 'exactly' },
  ];
  const successfulUpdateCalls = [];
  const portainerFetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/stacks/7' && options.method === 'PUT') {
      successfulUpdateCalls.push({ url, ...options });
      return jsonResponse({});
    }
    if (parsed.pathname === '/api/stacks/7') return jsonResponse({ Env: unseededEnv });
    if (parsed.pathname === '/api/stacks/7/file') return jsonResponse({ StackFileContent: oldFile });
    throw new Error(`Unexpected request: ${url}`);
  };
  const probeFetch = async (url) => url.endsWith('/health')
    ? jsonResponse({ status: 'on-air' })
    : streamResponse();

  const result = await deployWithRollback({
    client: clientFor(portainerFetch),
    manifest: releaseManifest,
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
  assert.equal(update.StackFileContent, renderedManifest);
  assert.doesNotMatch(update.StackFileContent, /\$\{SUBWAVE_VERSION[^}]*\}/);
  assert.deepEqual(result, {
    previousVersion: null,
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
      manifest: releaseManifest,
      targetVersion: 'v0.42.0-obiwave.1',
      healthUrl: 'https://radio.example/health',
      streamUrl: 'https://radio.example/stream.mp3',
      fetchImpl: probeFetch,
      attempts: 2,
      retryDelayMs: 5_000,
      sleep: async (milliseconds) => sleeps.push(milliseconds),
    }),
    (error) => {
      assert.ok(error instanceof DeploymentRolledBackError);
      assert.equal(error.targetVersion, 'v0.42.0-obiwave.1');
      assert.equal(error.previousVersion, 'v0.41.0-obiwave.3');
      return true;
    },
  );

  assert.equal(rolledBackUpdateCalls.length, 2);
  assert.equal(JSON.parse(rolledBackUpdateCalls[1].body).StackFileContent, oldFile);
  assert.deepEqual(JSON.parse(rolledBackUpdateCalls[1].body).Env, oldEnv);
  assert.deepEqual(sleeps, [5_000]);
});

test('a timed-out target update waits for a bounded grace period before rollback', async () => {
  const updates = [];
  const sleeps = [];
  const client = clientFor(async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/stacks/7' && options.method === 'PUT') {
      updates.push(JSON.parse(options.body));
      if (updates.length === 1) throw new DOMException('timed out', 'TimeoutError');
      return jsonResponse({});
    }
    if (parsed.pathname === '/api/stacks/7') return jsonResponse({ Env: oldEnv });
    if (parsed.pathname === '/api/stacks/7/file') return jsonResponse({ StackFileContent: oldFile });
    throw new Error(`Unexpected request: ${url}`);
  });
  const probeFetch = async (url) => url.endsWith('/health')
    ? jsonResponse({ status: 'on-air' })
    : streamResponse();

  await assert.rejects(deployWithRollback({
    client,
    manifest: releaseManifest,
    targetVersion: 'v0.42.0-obiwave.1',
    healthUrl: 'https://radio.example/health',
    streamUrl: 'https://radio.example/stream.mp3',
    fetchImpl: probeFetch,
    attempts: 1,
    rollbackGraceMs: 12_000,
    sleep: async (milliseconds) => sleeps.push(milliseconds),
  }), DeploymentRolledBackError);

  assert.equal(updates.length, 2);
  assert.deepEqual(updates[1].Env, oldEnv);
  assert.equal(updates[1].StackFileContent, oldFile);
  assert.deepEqual(sleeps, [12_000]);
});

test('an update timeout while reading the response body waits before rollback', async () => {
  const updates = [];
  const sleeps = [];
  const client = clientFor(async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/api/stacks/7' && options.method === 'PUT') {
      updates.push(JSON.parse(options.body));
      if (updates.length === 1) {
        return {
          ok: true,
          status: 200,
          text: async () => { throw new DOMException('body timed out', 'TimeoutError'); },
        };
      }
      return jsonResponse({});
    }
    if (parsed.pathname === '/api/stacks/7') return jsonResponse({ Env: oldEnv });
    if (parsed.pathname === '/api/stacks/7/file') return jsonResponse({ StackFileContent: oldFile });
    throw new Error(`Unexpected request: ${url}`);
  });
  const probeFetch = async (url) => url.endsWith('/health')
    ? jsonResponse({ status: 'on-air' })
    : streamResponse();

  await assert.rejects(deployWithRollback({
    client,
    manifest: releaseManifest,
    targetVersion: 'v0.42.0-obiwave.1',
    healthUrl: 'https://radio.example/health',
    streamUrl: 'https://radio.example/stream.mp3',
    fetchImpl: probeFetch,
    attempts: 1,
    rollbackGraceMs: 9_000,
    sleep: async (milliseconds) => sleeps.push(milliseconds),
  }), (error) => {
    assert.ok(error instanceof DeploymentRolledBackError);
    assert.ok(error.cause instanceof PortainerRequestTimeoutError);
    assert.equal(error.cause.operation, 'stack update');
    return true;
  });

  assert.equal(updates.length, 2);
  assert.deepEqual(sleeps, [9_000]);
});

test('a failed rollback is a typed incident with sanitized version metadata', async () => {
  let updateCount = 0;
  const client = {
    snapshotStack: async () => ({ Env: oldEnv, StackFileContent: oldFile }),
    updateStack: async () => {
      updateCount += 1;
      if (updateCount === 1) throw new Error('target failed with token=secret');
      throw new Error('rollback failed with manifest=secret');
    },
  };

  await assert.rejects(deployWithRollback({
    client,
    manifest: releaseManifest,
    targetVersion: 'v0.42.0-obiwave.1',
    healthUrl: 'https://radio.example/health',
    streamUrl: 'https://radio.example/stream.mp3',
    attempts: 1,
  }), (error) => {
    assert.ok(error instanceof RollbackIncidentError);
    assert.equal(error.targetVersion, 'v0.42.0-obiwave.1');
    assert.equal(error.previousVersion, 'v0.41.0-obiwave.3');
    assert.doesNotMatch(error.message, /token|manifest|secret/);
    return true;
  });
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

test('release forwards the optional production listener secret only as probe configuration', async () => {
  const calls = [];
  await runRelease({
    env: releaseEnv({ SUBWAVE_STREAM_PASSWORD: 'mount-secret' }),
    readFile: async () => releaseManifest,
    clientFactory: () => ({}),
    deploy: async (options) => {
      calls.push(options);
      return {
        previousVersion: 'v0.41.0-obiwave.3',
        targetVersion: options.targetVersion,
      };
    },
    log: () => {},
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].streamPassword, 'mount-secret');
  assert.doesNotMatch(calls[0].streamUrl, /mount-secret/);
});

test('release reports a verified rollback without logging sensitive causes', async () => {
  const logs = [];
  const summaries = [];
  const failure = new DeploymentRolledBackError({
    targetVersion: 'v0.42.0-obiwave.1',
    previousVersion: 'v0.41.0-obiwave.3',
    cause: new Error('token=do-not-print'),
  });

  await assert.rejects(runRelease({
    env: releaseEnv({ GITHUB_STEP_SUMMARY: '/tmp/summary' }),
    readFile: async () => newFile,
    clientFactory: () => ({}),
    deploy: async () => { throw failure; },
    log: (message) => logs.push(message),
    appendFile: async (_path, value) => summaries.push(value),
  }), (error) => error === failure);

  const output = [...logs, ...summaries].join('\n');
  assert.match(output, /Target version: `?v0\.42\.0-obiwave\.1`?/);
  assert.match(output, /Restored previous version: `?v0\.41\.0-obiwave\.3`?/);
  assert.match(output, /rollback verified/i);
  assert.doesNotMatch(output, /do-not-print|token=/);
});

test('release clearly flags an unverified rollback incident without sensitive causes', async () => {
  const logs = [];
  const summaries = [];
  const failure = new RollbackIncidentError({
    targetVersion: 'v0.42.0-obiwave.1',
    previousVersion: 'unexpected\nsecret-previous-value',
    deploymentError: new Error('headers=do-not-print'),
    rollbackError: new Error('response=do-not-print'),
  });

  await assert.rejects(runRelease({
    env: releaseEnv({ GITHUB_STEP_SUMMARY: '/tmp/summary' }),
    readFile: async () => newFile,
    clientFactory: () => ({}),
    deploy: async () => { throw failure; },
    log: (message) => logs.push(message),
    appendFile: async (_path, value) => summaries.push(value),
  }), (error) => error === failure);

  const output = [...logs, ...summaries].join('\n');
  assert.match(output, /Target version: `?v0\.42\.0-obiwave\.1`?/);
  assert.match(output, /Previous version: `?\(not set or unrecognized\)`?/);
  assert.match(output, /ROLLBACK FAILED OR UNVERIFIED/);
  assert.doesNotMatch(output, /do-not-print|headers=|response=|secret-previous-value/);
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

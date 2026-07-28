import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

process.env.STATE_DIR = mkdtempSync(join(tmpdir(), 'subwave-search-provider-probe-'));
process.env.ADMIN_USER = 'route-test-admin';
process.env.ADMIN_PASS = 'route-test-password';
delete process.env.KAGI_API_KEY;

const settings = await import('../src/settings.js');
const { router } = await import('../src/routes/settings.js');
await settings.load();

const realFetch = globalThis.fetch;
let queuedResponse = new Response(JSON.stringify({ meta: {}, data: {} }), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});
let queuedError: Error | null = null;
let seenAuthorization = '';
let outboundSearchRequests = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  const isKagi = url.startsWith('https://kagi.com/api/v1/search');
  const isTavily = url.startsWith('https://api.tavily.com/search');
  const isBrave = url.startsWith('https://api.search.brave.com/res/v1/web/search');
  if (!isKagi && !isTavily && !isBrave) {
    return realFetch(input, init);
  }
  outboundSearchRequests++;
  if (!isKagi) return queuedResponse;
  assert.equal(new URL(url).search, '');
  seenAuthorization = new Headers(init?.headers).get('Authorization') || '';
  if (queuedError) throw queuedError;
  return queuedResponse;
};

const app = express();
app.use(express.json());
app.use(router);

const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});

try {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const port = address.port;
  const authorization =
    `Basic ${Buffer.from('route-test-admin:route-test-password').toString('base64')}`;
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { authorization, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      body: await response.json() as {
        ok: boolean;
        message: string;
        latencyMs: number;
      },
    };
  };
  const postBody = async (path: string, body: unknown) => {
    const response = await post(path, body);
    return response.body as {
      ok: boolean;
      message: string;
      latencyMs: number;
    };
  };

  const cases = [
    { status: 200, body: { meta: {}, data: {} }, ok: true, match: /Kagi Search key valid/ },
    { status: 401, body: {}, ok: false, match: /invalid|lacks Search API access/i },
    { status: 403, body: {}, ok: false, match: /invalid|lacks Search API access/i },
    { status: 429, body: {}, ok: false, match: /rate limit|quota|balance/i },
    { status: 200, body: { data: 'bad' }, ok: false, match: /unsupported response/i },
  ];

  for (const item of cases) {
    queuedError = null;
    queuedResponse = new Response(JSON.stringify(item.body), {
      status: item.status,
      headers: { 'Content-Type': 'application/json' },
    });
    seenAuthorization = '';
    const responseBody = await postBody('/settings/secrets/test', {
      key: 'KAGI_API_KEY',
      value: 'route-kagi-secret',
      provider: 'kagi',
    });
    assert.equal(responseBody.ok, item.ok);
    assert.match(responseBody.message, item.match);
    assert.equal(seenAuthorization, 'Bearer route-kagi-secret');
    assert.equal(JSON.stringify(responseBody).includes('route-kagi-secret'), false);
  }

  for (const error of [new Error('fetch failed: ENOTFOUND'), new Error('The operation was aborted')]) {
    queuedError = error;
    const responseBody = await postBody('/settings/secrets/test', {
      key: 'KAGI_API_KEY',
      value: 'route-kagi-secret',
      provider: 'kagi',
    });
    assert.equal(responseBody.ok, false);
    assert.match(responseBody.message, /could not be reached/i);
    assert.equal(responseBody.message.includes('route-kagi-secret'), false);
  }
  queuedError = new Error('credential route-kagi-secret exploded');
  const redactedError = await postBody('/settings/secrets/test', {
    key: 'KAGI_API_KEY',
    value: 'route-kagi-secret',
    provider: 'kagi',
  });
  assert.equal(redactedError.ok, false);
  assert.equal(JSON.stringify(redactedError).includes('route-kagi-secret'), false);
  queuedError = null;
  queuedResponse = new Response(JSON.stringify({ meta: {}, data: {} }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  await settings.update({ search: {
    provider: 'kagi',
    apiKeys: { kagi: 'saved-kagi-key' },
  } });
  seenAuthorization = '';
  const savedProbe = await postBody('/settings/secrets/test', {
    key: 'KAGI_API_KEY',
    value: '',
    provider: 'kagi',
  });
  assert.equal(savedProbe.ok, true);
  assert.equal(seenAuthorization, 'Bearer saved-kagi-key');

  await settings.update({ search: { apiKeys: { kagi: null } } });
  process.env.KAGI_API_KEY = 'environment-kagi-key';
  queuedResponse = new Response(JSON.stringify({ meta: {}, data: {} }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  seenAuthorization = '';
  const envProbe = await postBody('/settings/secrets/test', {
    key: 'KAGI_API_KEY',
    value: '',
    provider: 'kagi',
  });
  assert.equal(envProbe.ok, true);
  assert.equal(seenAuthorization, 'Bearer environment-kagi-key');
  delete process.env.KAGI_API_KEY;

  for (const mismatch of [
    { key: 'SEARCH_API_KEY', provider: 'kagi' },
    { key: 'KAGI_API_KEY', provider: 'tavily' },
    { key: 'KAGI_API_KEY', provider: 'brave' },
  ]) {
    for (const source of ['submitted', 'saved', 'environment'] as const) {
      await settings.update({ search: { apiKeys: {
        tavily: null,
        brave: null,
        kagi: null,
      } } });
      delete process.env.SEARCH_API_KEY;
      delete process.env.KAGI_API_KEY;

      let value = '';
      if (source === 'submitted') {
        value = `${source}-mismatch-secret`;
      } else if (source === 'saved') {
        await settings.update({ search: { apiKeys: {
          [mismatch.provider]: `${source}-mismatch-secret`,
        } } });
      } else {
        process.env[mismatch.provider === 'kagi' ? 'KAGI_API_KEY' : 'SEARCH_API_KEY'] =
          `${source}-mismatch-secret`;
      }

      outboundSearchRequests = 0;
      const response = await post('/settings/secrets/test', {
        ...mismatch,
        value,
      });
      assert.equal(response.status, 400, `${mismatch.key}/${mismatch.provider}/${source}`);
      assert.equal(response.body.ok, false, `${mismatch.key}/${mismatch.provider}/${source}`);
      assert.match(response.body.message, /does not match provider/i);
      assert.equal(outboundSearchRequests, 0, `${mismatch.key}/${mismatch.provider}/${source}`);
    }
  }
  delete process.env.SEARCH_API_KEY;
  delete process.env.KAGI_API_KEY;

  console.log('search provider probe: Kagi validates submitted, saved, and environment keys safely');
} finally {
  delete process.env.KAGI_API_KEY;
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}

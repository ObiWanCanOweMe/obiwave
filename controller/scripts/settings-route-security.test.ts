import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

process.env.STATE_DIR = mkdtempSync(join(tmpdir(), 'subwave-settings-route-'));
process.env.ADMIN_USER = 'route-test-admin';
process.env.ADMIN_PASS = 'route-test-password';

const settings = await import('../src/settings.js');
const { router } = await import('../src/routes/settings.js');

await settings.load();

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
  const token = 'route-only-litellm-token';
  const authorization = `Basic ${Buffer.from('route-test-admin:route-test-password').toString('base64')}`;
  const response = await fetch(`http://127.0.0.1:${address.port}/settings`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({
      llm: {
        provider: 'litellm',
        model: 'vendor/model',
        baseUrl: 'https://gateway.example/v1',
        apiKey: token,
      },
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { requiresRestart: false });
  assert.equal('saved' in body, false);
  assert.equal(JSON.stringify(body).includes(token), false);
  assert.equal(settings.llmKeyFor('litellm'), token, 'the key should still be retained internally');

  const searchToken = 'route-only-kagi-token';
  const searchResponse = await fetch(`http://127.0.0.1:${address.port}/settings`, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify({
      search: {
        provider: 'kagi',
        apiKeys: { kagi: searchToken },
      },
    }),
  });
  assert.equal(searchResponse.status, 200);
  const searchBody = await searchResponse.json();
  assert.deepEqual(searchBody, { requiresRestart: false });
  assert.equal(JSON.stringify(searchBody).includes(searchToken), false);
  assert.equal(settings.searchKeyFor('kagi'), searchToken);
  console.log('settings route security: POST response is public-only and token-free');
} finally {
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}

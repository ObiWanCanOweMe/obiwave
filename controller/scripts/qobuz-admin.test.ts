import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readFile, stat, access } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
process.env.ADMIN_USER = 'operator'; process.env.ADMIN_PASS = 'test-password'; process.env.QOBUZ_APP_ID = 'boot-app';
const { createQobuzSettingsRouter } = await import('../src/routes/settings/qobuz.js');
const { router: coreRouter } = await import('../src/routes/settings/core.js');
const settings = await import('../src/settings.js');
const { STATE_DIR } = await import('../src/config.js');
const { effectiveQobuzCredentials } = await import('../src/music/qobuz/credentials.js');
let tested: unknown;
const app = express(); app.use(express.json()); app.use(createQobuzSettingsRouter({ client: credentials => ({ testConnection: async () => { tested = credentials; return { accountKey: 'a'.repeat(64), fullTrackAccess: true }; } }) }));
app.use(coreRouter);
const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const headers = { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from('operator:test-password').toString('base64')}` };
test.after(() => server.close());
const post = (path: string, body: unknown) => fetch(base+path, { method: 'POST', headers, body: JSON.stringify(body) });
test('Admin credential probe authenticates, merges environment values and never persists', async () => {
  assert.equal((await fetch(base+'/settings/qobuz')).status, 401);
  const response = await post('/settings/qobuz/test', { appSecret: 'secret', userAuthToken: 'token', userId: '42' });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, fullTrackAccess: true });
  assert.deepEqual(tested, { appId: 'boot-app', appSecret: 'secret', userAuthToken: 'token', userId: '42' });
  await assert.rejects(access(`${STATE_DIR}/secrets.env`));
});
test('save preserves blank secrets, rejects environment edits and supports explicit clear', async () => {
  assert.equal((await post('/settings/qobuz/credentials', { appId: 'other' })).status, 400);
  assert.equal((await post('/settings/qobuz/credentials', { appSecret: 'secret', userAuthToken: 'token', userId: '42' })).status, 200);
  assert.equal((await stat(`${STATE_DIR}/secrets.env`)).mode & 0o777, 0o600);
  await post('/settings/qobuz/credentials', { appSecret: '', userAuthToken: 'set' });
  assert.equal(effectiveQobuzCredentials()?.userAuthToken, 'token');
  const status = await (await fetch(base+'/settings/qobuz', { headers })).json() as any;
  assert.equal(status.credentials.appId.source, 'environment'); assert.equal(status.credentials.appSecret.source, 'saved');
  assert.equal(JSON.stringify(status).includes('boot-app'), false); assert.equal(JSON.stringify(status).includes('token'), false);
  await post('/settings/qobuz/credentials', { clear: ['userAuthToken'] }); assert.equal(effectiveQobuzCredentials(), null);
  assert.equal((await readFile(`${STATE_DIR}/secrets.env`, 'utf8')).includes('QOBUZ_USER_AUTH_TOKEN=\n'), true);
});
test('control characters and hostile probe failures never leak submitted credentials', async () => {
  const response = await post('/settings/qobuz/test', { appSecret: 'secret\nline', userAuthToken: 'token', userId: '42' });
  assert.equal(response.status, 400); assert.equal((await response.text()).includes('secret'), false);
});

test('the real settings response hydrates the saved Qobuz controls after reload', async () => {
  await settings.load(); await settings.update({ qobuz: { enabled: true, cacheMaxGb: 2 } });
  const response = await fetch(base+'/settings', { headers }); assert.equal(response.status, 200);
  const data = await response.json() as any;
  assert.deepEqual(data.values.qobuz, { enabled: true, cacheMaxGb: 2 });
});

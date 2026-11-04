import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { STATE_DIR } from '../src/config.js';
import * as settings from '../src/settings.js';
import { readSecretsFile, saveSecrets } from '../src/setup/secrets.js';

test('Qobuz defaults off, validates patches and persists no credentials in settings', async () => {
  await settings.load();
  assert.deepEqual(settings.get().qobuz, { enabled: false, cacheMaxGb: 5 });
  await settings.update({ qobuz: { enabled: true, cacheMaxGb: 2 } });
  assert.deepEqual(settings.get().qobuz, { enabled: true, cacheMaxGb: 2 });
  await assert.rejects(settings.update({ qobuz: { cacheMaxGb: -1 } }), /qobuz/);
  await saveSecrets({ QOBUZ_APP_ID: 'app', QOBUZ_APP_SECRET: 'private-secret', QOBUZ_USER_AUTH_TOKEN: 'private-token', QOBUZ_USER_ID: '42' });
  assert.equal((await stat(`${STATE_DIR}/secrets.env`)).mode & 0o777, 0o600);
  assert.equal(readSecretsFile(await readFile(`${STATE_DIR}/secrets.env`, 'utf8')).values.QOBUZ_APP_ID, 'app');
  const json = await readFile(`${STATE_DIR}/settings.json`, 'utf8');
  assert.equal(json.includes('private-secret'), false);
  assert.equal(json.includes('private-token'), false);
});

test('saved credential clear invalidates authority without leaking values', async () => {
  const { effectiveQobuzCredentials, qobuzAuthority, verifyQobuzAuthority, qobuzCredentialStatus } = await import('../src/music/qobuz/credentials.js');
  const credentials = effectiveQobuzCredentials()!;
  assert.equal(credentials.userId, '42');
  verifyQobuzAuthority(credentials);
  assert.ok(qobuzAuthority());
  assert.equal(qobuzCredentialStatus().appSecret.source, 'saved');
  await saveSecrets({ QOBUZ_APP_SECRET: '' });
  assert.equal(effectiveQobuzCredentials(), null);
  assert.equal(qobuzAuthority(), null);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyMainSettingsMode } from './main-settings-mode.mjs';

for (const mode of [0o644, 0o600, 0x80000000 + 0o644]) {
  test(`main settings metadata verifies ${mode.toString(8)} without reading file contents`, async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, method: options.method || 'GET' });
      assert.equal(options.headers['X-API-Key'], 'test-key');
      if (url.includes('/containers/json')) return Response.json([{ Id: 'controller-id', Names: ['/sub-wave-controller'] }]);
      assert.equal(options.method, 'HEAD');
      assert.equal(new URL(url).searchParams.get('path'), '/var/sub-wave/stations/main/settings.json');
      return new Response(null, { headers: { 'X-Docker-Container-Path-Stat': Buffer.from(JSON.stringify({ mode, linkTarget: '' })).toString('base64') } });
    };
    const result = verifyMainSettingsMode({ baseUrl: 'https://portainer.example', apiKey: 'test-key', endpointId: '1', fetchImpl });
    if (mode === 0o644) await result;
    else await assert.rejects(result, /must be 0644/);
    assert.equal(calls.length, 2);
  });
}

test('missing metadata fails without reading a response body', async () => {
  let calls = 0;
  await assert.rejects(verifyMainSettingsMode({ baseUrl: 'https://portainer.example', apiKey: 'test-key', endpointId: '1', fetchImpl: async () => {
    if (++calls === 1) return Response.json([{ Id: 'controller-id', Names: ['/sub-wave-controller'] }]);
    return new Response(null);
  } }), /metadata/);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createQobuzClient } from '../src/music/qobuz/client.js';
import { isPublicAddress, publicHttps, type HttpTransport } from '../src/music/qobuz/http.js';
const creds = { appId: 'app', appSecret: 'secret', userAuthToken: 'token', userId: '42' };
const reply = (data: unknown, status = 200) => ({ status, headers: {}, body: (async function* () { yield Buffer.from(JSON.stringify(data)); })() });
test('file URL request signs CD FLAC parameters and rejects previews', async () => {
  const client = createQobuzClient(creds, { now: () => 1700000000000, transport: async url => {
    assert.equal(url.origin, 'https://www.qobuz.com');
    assert.equal(url.searchParams.get('format_id'), '6');
    assert.equal(url.searchParams.get('request_sig'), createHash('md5').update('trackgetFileUrlformat_id6intentstreamtrack_id1231700000000secret').digest('hex'));
    return reply({ url: 'https://media.example/song.flac?signature=private', sample: true, duration: 30 });
  }});
  await assert.rejects(client.fileUrl('123'), /preview|unavailable/i);
});
test('account verification binds supplied identity and full-track entitlement', async () => {
  const client = createQobuzClient(creds, { transport: async () => reply({ id: 42, credential: { parameters: { lossless_streaming: true } } }) });
  const result = await client.testConnection();
  assert.equal(result.fullTrackAccess, true);
  assert.match(result.accountKey, /^[a-f0-9]{64}$/);
  await assert.rejects(createQobuzClient(creds, { transport: async () => reply({ id: 99 }) }).testConnection(), /account/i);
});
test('auth failure is sanitized and never retried', async () => {
  let calls = 0;
  const client = createQobuzClient(creds, { transport: async () => { calls++; return reply({ message: 'token secret' }, 401); } });
  await assert.rejects(client.search('song'), error => { assert.equal(String(error).includes('token'), false); assert.match(String(error), /unauthorized/); return true; });
  assert.equal(calls, 1);
});
test('transient responses retry once; malformed metadata is not a valid track', async () => {
  let calls = 0;
  const transport: HttpTransport = async () => ++calls === 1 ? reply({}, 503) : reply({ tracks: { items: [{ id: 123 }, { id: 124, title: 'Song', performer: { name: 'Artist' }, album: { title: 'Album' }, duration: 200, streamable: true }] } });
  assert.deepEqual((await createQobuzClient(creds, { transport }).search('song')).map(t => t.id), ['124']);
  assert.equal(calls, 2);
});
test('public HTTPS refuses unsafe destinations before transport and bounds redirects', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1']) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress('1.1.1.1'), true);
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true);
  await assert.rejects(publicHttps(new URL('http://example.com'), AbortSignal.timeout(100)), /destination/i);
  await assert.rejects(publicHttps(new URL('https://127.0.0.1'), AbortSignal.timeout(100)), /destination/i);
});
test('API deadline includes an unresponsive transport', async () => {
  await assert.rejects(createQobuzClient(creds, { timeoutMs: 20, transport: () => new Promise(() => {}) }).search('song'), /timed out/);
});

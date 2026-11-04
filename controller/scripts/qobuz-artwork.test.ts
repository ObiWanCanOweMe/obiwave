import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchQobuzArtwork } from '../src/music/qobuz/artwork.js';
import { initializeQobuz, qobuzCache } from '../src/music/qobuz/runtime.js';
import { router } from '../src/routes/public.js';
import { queue } from '../src/broadcast/queue.js';
import * as settings from '../src/settings.js';
import express from 'express';
import { writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const execFileAsync = promisify(execFile);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1sAAAAASUVORK5CYII=', 'base64');
test('artwork accepts only bounded raster data and never private destinations', async () => {
  const transport = async () => ({ status: 200, headers: {}, body: (async function* () { yield png; })() });
  assert.deepEqual((await fetchQobuzArtwork('https://media.example/art.png', undefined, transport))?.bytes, png);
  await assert.rejects(fetchQobuzArtwork('https://127.0.0.1/art.png', undefined, transport));
  assert.equal(await fetchQobuzArtwork('https://media.example/art.png', undefined, async () => ({ status: 200, headers: {}, body: (async function* () { yield Buffer.from('<svg><script/>'); })() })), null);
});
test('existing web and native clients can display account-owned art on a locked station', async () => {
  await settings.load(); await initializeQobuz(() => queue.qobuzReferences());
  const partial = await qobuzCache.reserve(4); await writeFile(partial.path, 'data');
  const lease = await qobuzCache.publish({ id: '123', title: 'Song', artist: 'Artist', album: 'Album', duration: 200, explicit: false }, { path: partial.path, audio: { bytes: 4, duration: 200, suffix: 'flac', samplingRate: 44100, bitDepth: 16, channelCount: 2 }, artwork: { bytes: png, contentType: 'image/png' } }, { accountKey: 'a'.repeat(64), revision: 1 });
  partial.release(); queue.current = { track: lease.track };
  const app = express(); app.use('/api', router); app.use(router); const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const cover = await fetch(`${base}/cover/qobuz%3A123`); assert.equal(cover.status, 200); assert.deepEqual(Buffer.from(await cover.arrayBuffer()), png);
    await settings.update({ privacy: { privatePlayer: true, password: 'station-password' } });
    // Exercise the unchanged client helpers: neither attaches the station password.
    const tsx = fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url));
    const web = await execFileAsync(process.execPath, ['--import', tsx, '--input-type=module', '-e', `import {createStationClient} from './lib/stationClient.ts'; process.stdout.write(createStationClient({apiUrl:${JSON.stringify(base)}}).coverUrl('qobuz:123'));`], { cwd: fileURLToPath(new URL('../../web/', import.meta.url)) });
    const native = await execFileAsync(process.execPath, ['--import', tsx, '--input-type=module', '-e', `import {createApi} from './src/lib/api.ts'; process.stdout.write(JSON.stringify(createApi(${JSON.stringify(base)}, {username:'gateway', password:'login'}, () => 'station-password').cover('qobuz:123')));`], { cwd: fileURLToPath(new URL('../../app/', import.meta.url)) });
    const image = JSON.parse(native.stdout);
    for (const [url, headers] of [[web.stdout, undefined], [image.uri, image.headers]] as const) {
      const response = await fetch(url, { headers }); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    }
    assert.equal((await fetch(`${base}/cover/qobuz%3A123?auth=station-password`)).status, 200);
    assert.equal(await qobuzCache.cover('qobuz:123', 'b'.repeat(64)), null);
  } finally { server.close(); lease.release(); queue.current = null; }
});

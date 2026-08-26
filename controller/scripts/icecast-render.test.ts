import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const state = mkdtempSync(join(tmpdir(), 'subwave-icecast-render-'));
const rendered = join(state, 'icecast.xml');
writeFileSync(join(state, 'liquidsoap_stream_buffer_seconds.txt'), '22');
writeFileSync(join(state, 'liquidsoap_stream_bitrate.txt'), '192');
writeFileSync(join(state, 'liquidsoap_opus_bitrate.txt'), '96');
writeFileSync(join(state, 'liquidsoap_aac_bitrate.txt'), '128');
writeFileSync(join(state, 'liquidsoap_icecast_max_clients.txt'), '321');
writeFileSync(join(state, 'icecast_listener_auth.txt'), 'true');

const run = spawnSync(resolve(root, 'docker/icecast-render.sh'), [], {
  env: {
    ...process.env,
    ICECAST_STATE_DIR: state,
    ICECAST_TEMPLATE: resolve(root, 'docker/icecast.xml.template'),
    ICECAST_RENDERED: rendered,
    ICECAST_SOURCE_PASSWORD: 'source-secret',
    ICECAST_ADMIN_PASSWORD: 'admin-secret',
    ICECAST_RELAY_PASSWORD: 'relay-secret',
    ICECAST_TRUSTED_PROXY_IPS: '127.0.0.1,::1',
    LISTENER_AUTH_URL: 'http://controller:7701/listener-auth',
  },
  encoding: 'utf8',
});
assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);

const xml = readFileSync(rendered, 'utf8');
assert.match(xml, /<clients>321<\/clients>/);
assert.match(run.stderr, /max listeners 321 \(from settings\)/);
assert.match(xml, /<x-forwarded-for>127\.0\.0\.1<\/x-forwarded-for>/);
assert.match(xml, /<x-forwarded-for>::1<\/x-forwarded-for>/);
assert.doesNotMatch(xml, /@TRUSTED_PROXIES@/);
const mountBlocks = xml.match(/<mount type="normal">[\s\S]*?<\/mount>/g) ?? [];
const mountBlock = (mount: string) => {
  const block = mountBlocks.find(candidate => candidate.includes(`<mount-name>${mount}</mount-name>`));
  assert.ok(block, `rendered config contains ${mount}`);
  return block;
};

const expected = {
  '/stream.mp3': { burst: 528000, queue: 2112000 },
  '/stream.opus': { burst: 264000, queue: 2097152 },
  '/stream.aac': { burst: 352000, queue: 2097152 },
  '/stream.flac': { burst: 2475000, queue: 9900000 },
};

for (const [mount, sizes] of Object.entries(expected)) {
  const block = mountBlock(mount);
  assert.match(block, new RegExp(`<burst-size>${sizes.burst}</burst-size>`));
  assert.match(block, new RegExp(`<queue-size>${sizes.queue}</queue-size>`));
  assert.match(block, /<authentication type="url">/);
}

writeFileSync(join(state, 'icecast_listener_auth.txt'), 'false');
const publicRun = spawnSync(resolve(root, 'docker/icecast-render.sh'), [], {
  env: {
    ...process.env,
    ICECAST_STATE_DIR: state,
    ICECAST_TEMPLATE: resolve(root, 'docker/icecast.xml.template'),
    ICECAST_RENDERED: rendered,
    ICECAST_SOURCE_PASSWORD: 'source-secret',
    ICECAST_ADMIN_PASSWORD: 'admin-secret',
    ICECAST_RELAY_PASSWORD: 'relay-secret',
  },
  encoding: 'utf8',
});
assert.equal(publicRun.status, 0, `${publicRun.stdout}${publicRun.stderr}`);
const publicXml = readFileSync(rendered, 'utf8');
const publicMountBlocks = publicXml.match(/<mount type="normal">[\s\S]*?<\/mount>/g) ?? [];
for (const mount of ['/stream.mp3', '/stream.opus', '/stream.aac', '/stream.flac']) {
  const block = publicMountBlocks.find(candidate => candidate.includes(`<mount-name>${mount}</mount-name>`));
  assert.ok(block, `public config contains ${mount}`);
  assert.doesNotMatch(block, /<authentication type="url">/, `${mount} remains unauthenticated`);
}

console.log('icecast-render.test.ts: per-mount bursts render in private and public modes');

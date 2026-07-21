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
    LISTENER_AUTH_URL: 'http://controller:7701/listener-auth',
  },
  encoding: 'utf8',
});
assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);

const xml = readFileSync(rendered, 'utf8');
const mountBlocks = xml.match(/<mount type="normal">[\s\S]*?<\/mount>/g) ?? [];
const mountBlock = (mount: string) => {
  const block = mountBlocks.find(candidate => candidate.includes(`<mount-name>${mount}</mount-name>`));
  assert.ok(block, `rendered config contains ${mount}`);
  return block;
};

assert.match(mountBlock('/stream.mp3'), /<burst-size>528000<\/burst-size>/);
assert.match(mountBlock('/stream.opus'), /<burst-size>0<\/burst-size>/);
assert.match(mountBlock('/stream.aac'), /<burst-size>352000<\/burst-size>/);
assert.match(mountBlock('/stream.flac'), /<burst-size>0<\/burst-size>/);
for (const mount of ['/stream.mp3', '/stream.opus', '/stream.aac', '/stream.flac']) {
  assert.match(mountBlock(mount), /<authentication type="url">/, `${mount} retains listener auth`);
}
assert.match(xml, /<queue-size>2112000<\/queue-size>/, 'queue is four times the largest mount burst');
assert.match(
  run.stderr,
  /VBR bursts disabled: opus=0B flac=0B/,
  'renderer log is honest about variable-rate mounts',
);

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

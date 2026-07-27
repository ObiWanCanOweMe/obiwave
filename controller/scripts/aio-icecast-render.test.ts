// Wiring contract: split and AIO deployments both invoke the same behavioral
// renderer covered by icecast-render.test.ts.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const template = readFileSync(resolve(root, 'docker/icecast.xml.template'), 'utf8');
const supervisor = readFileSync(resolve(root, 'docker/aio/supervisor.sh'), 'utf8');
const entrypoint = readFileSync(resolve(root, 'docker/broadcast-entrypoint.sh'), 'utf8');
const aioDockerfile = readFileSync(resolve(root, 'docker/Dockerfile.aio'), 'utf8');
const broadcastDockerfile = readFileSync(resolve(root, 'docker/Dockerfile.broadcast'), 'utf8');

assert.match(template, /\$\{ICECAST_BURST_SIZE\}/, 'template requires a computed burst size');
assert.match(template, /\$\{ICECAST_QUEUE_SIZE\}/, 'template requires a computed queue size');

assert.match(supervisor, /\/usr\/local\/bin\/icecast-render/, 'AIO invokes shared renderer');
assert.match(entrypoint, /\/usr\/local\/bin\/icecast-render/, 'split stack invokes shared renderer');
assert.equal(
  [...supervisor.matchAll(/\/usr\/local\/bin\/icecast-render/g)].length,
  1,
  'AIO invokes the shared renderer exactly once',
);
assert.equal(
  [...entrypoint.matchAll(/\/usr\/local\/bin\/icecast-render/g)].length,
  1,
  'split stack invokes the shared renderer exactly once',
);
for (const [deployment, script] of [['AIO', supervisor], ['split stack', entrypoint]] as const) {
  assert.doesNotMatch(
    script,
    /\bemit_mount\s*\(\)|\bMOUNTS_XML=|<!--@STREAM_MOUNTS@-->/,
    `${deployment} does not carry a duplicated mount XML renderer`,
  );
}
assert.match(
  supervisor,
  /ICECAST_STATE_DIR="\$STATE_DIR"/,
  'AIO renders Icecast from the active station directory',
);
assert.match(
  entrypoint,
  /ICECAST_STATE_DIR="\$STATE_DIR"/,
  'split stack renders Icecast from the active station directory',
);
assert.match(
  supervisor,
  /LISTENER_AUTH_URL="\$\{LISTENER_AUTH_URL:-http:\/\/localhost:7701\/listener-auth\}"/,
  'AIO keeps its loopback listener-auth callback default',
);
assert.match(
  entrypoint,
  /LISTENER_AUTH_URL="\$\{LISTENER_AUTH_URL:-http:\/\/controller:7701\/listener-auth\}"/,
  'split stack keeps its controller-service listener-auth callback default',
);
assert.match(aioDockerfile, /COPY docker\/icecast-render\.sh \/usr\/local\/bin\/icecast-render/);
assert.match(broadcastDockerfile, /COPY docker\/icecast-render\.sh \/usr\/local\/bin\/icecast-render/);

console.log('aio-icecast-render.test.ts: split and AIO use the shared renderer');

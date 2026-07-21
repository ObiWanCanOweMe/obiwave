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
assert.match(aioDockerfile, /COPY docker\/icecast-render\.sh \/usr\/local\/bin\/icecast-render/);
assert.match(broadcastDockerfile, /COPY docker\/icecast-render\.sh \/usr\/local\/bin\/icecast-render/);

console.log('aio-icecast-render.test.ts: split and AIO use the shared renderer');

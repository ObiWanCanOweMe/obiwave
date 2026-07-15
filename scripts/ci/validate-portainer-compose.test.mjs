import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePortainerCompose } from './validate-portainer-compose.mjs';

const valid = `
x-state: &state /mnt/NVMe/container-data/subwave/state:/var/sub-wave
services:
  broadcast:
    image: ghcr.io/obiwancanoweme/subwave-broadcast:\${SUBWAVE_VERSION:?required}
    ports:
      - "10.20.0.9:\${ICECAST_PORT:-7702}:7702"
      - "[2600:1700:3210:5314:10:20:0:9]:\${ICECAST_PORT:-7702}:7702"
  controller:
    image: ghcr.io/obiwancanoweme/subwave-controller:\${SUBWAVE_VERSION:?required}
    ports:
      - "10.20.0.9:\${CONTROLLER_PORT:-7701}:7701"
      - "[2600:1700:3210:5314:10:20:0:9]:\${CONTROLLER_PORT:-7701}:7701"
  web:
    image: ghcr.io/obiwancanoweme/subwave-web:\${SUBWAVE_VERSION:?required}
    ports:
      - "10.20.0.9:\${WEB_PORT:-7700}:7700"
      - "[2600:1700:3210:5314:10:20:0:9]:\${WEB_PORT:-7700}:7700"
  analyzer:
    image: ghcr.io/obiwancanoweme/subwave-analyzer:\${SUBWAVE_VERSION:?required}
`;

test('accepts the production contract', () => {
  assert.deepEqual(validatePortainerCompose(valid), []);
});

test('rejects mutable or checkout-coupled deployment', () => {
  const invalid = `${valid}\nbuild: .\nimage: example:latest\n` +
    `ghcr.io/perminder-klair/subwave-web\n./state:/var/sub-wave\n` +
    `env_file: ./.env\n0.0.0.0:7700:7700\n[::]:7700:7700\n`;
  assert.deepEqual(validatePortainerCompose(invalid), [
    'manifest contains a build directive', 'manifest references latest',
    'manifest references the upstream image namespace',
    'manifest contains a repository-relative state mount',
    'manifest depends on a repository .env file',
    'manifest binds a published port to a wildcard address',
  ]);
});

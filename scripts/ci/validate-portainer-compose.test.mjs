import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePortainerCompose } from './validate-portainer-compose.mjs';

const valid = `
x-state: &state-mount /mnt/NVMe/container-data/subwave/state:/var/sub-wave
x-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
services:
  broadcast:
    image: ghcr.io/obiwancanoweme/subwave-broadcast:\${SUBWAVE_VERSION:?required}
    logging: *default-logging
    ports:
      - "10.20.0.9:\${ICECAST_PORT:-7702}:7702"
      - "[2600:1700:3210:5314:10:20:0:9]:\${ICECAST_PORT:-7702}:7702"
    volumes:
      - *state-mount
      - /mnt/NVMe/container-data/subwave/state/logs:/var/log/liquidsoap
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:7702/status-json.xsl"]
  controller:
    image: ghcr.io/obiwancanoweme/subwave-controller:\${SUBWAVE_VERSION:?required}
    logging: *default-logging
    depends_on:
      broadcast:
        condition: service_healthy
      docker-socket-proxy:
        condition: service_started
    env_file:
      - stack.env
    ports:
      - "10.20.0.9:\${CONTROLLER_PORT:-7701}:7701"
      - "[2600:1700:3210:5314:10:20:0:9]:\${CONTROLLER_PORT:-7701}:7701"
    volumes:
      - *state-mount
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:7701/health"]
  docker-socket-proxy:
    image: ghcr.io/tecnativa/docker-socket-proxy:0.3.0
    logging: *default-logging
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
  web:
    image: ghcr.io/obiwancanoweme/subwave-web:\${SUBWAVE_VERSION:?required}
    logging: *default-logging
    depends_on:
      controller:
        condition: service_healthy
    ports:
      - "10.20.0.9:\${WEB_PORT:-7700}:7700"
      - "[2600:1700:3210:5314:10:20:0:9]:\${WEB_PORT:-7700}:7700"
  tts-heavy:
    image: ghcr.io/obiwancanoweme/subwave-tts-heavy:\${SUBWAVE_VERSION:?required}
    logging: *default-logging
    mem_limit: \${TTS_HEAVY_MEM_LIMIT:-10g}
    profiles: ["tts-heavy"]
    volumes:
      - *state-mount
      - tts-heavy-chatterbox-cache:/opt/chatterbox/hf-cache
      - tts-heavy-pocket-cache:/opt/pocket-tts/hf-cache
  analyzer:
    image: ghcr.io/obiwancanoweme/subwave-analyzer\${ANALYZER_HEAVY:+-heavy}:\${SUBWAVE_VERSION:?required}
    logging: *default-logging
    mem_limit: \${ANALYZER_MEM_LIMIT:-6g}
    volumes:
      - *state-mount
      - analyzer-cache:/opt/analyzer/hf-cache
volumes:
  tts-heavy-chatterbox-cache:
  tts-heavy-pocket-cache:
  analyzer-cache:
`;

function errorsFor(source) {
  return validatePortainerCompose(source);
}

function assertRejects(source, expected) {
  assert.ok(errorsFor(source).includes(expected), `expected ${expected}`);
}

test('accepts the full six-service production contract', () => {
  assert.deepEqual(errorsFor(valid), []);
});

test('rejects mutable or checkout-coupled deployment', () => {
  const invalid = `${valid}\nbuild: .\nimage: example:latest\n` +
    `ghcr.io/perminder-klair/subwave-web\n./state:/var/sub-wave\n` +
    `env_file: ./.env\n0.0.0.0:7700:7700\n[::]:7700:7700\n`;
  for (const expected of [
    'manifest contains a build directive',
    'manifest references latest',
    'manifest references the upstream image namespace',
    'manifest contains a repository-relative state mount',
    'manifest depends on a repository .env file',
    'manifest binds a published port to a wildcard address',
  ]) assertRejects(invalid, expected);
});

test('rejects missing services and exact first-party images', () => {
  assertRejects(valid.replace(/  analyzer:\n[\s\S]*?(?=volumes:)/, ''), 'manifest is missing service analyzer');
  for (const service of ['broadcast', 'controller', 'web', 'tts-heavy']) {
    assertRejects(
      valid.replace(`ghcr.io/obiwancanoweme/subwave-${service}:`, `example.invalid/subwave-${service}:`),
      `service ${service} has an invalid image`,
    );
  }
  assertRejects(
    valid.replace('subwave-analyzer\${ANALYZER_HEAVY:+-heavy}', 'subwave-analyzer'),
    'service analyzer has an invalid image',
  );
  assertRejects(
    valid.replace('ghcr.io/tecnativa/docker-socket-proxy:0.3.0', 'ghcr.io/tecnativa/docker-socket-proxy:latest'),
    'service docker-socket-proxy has an invalid image',
  );
});

test('rejects material topology removals', () => {
  const cases = [
    ['      - stack.env\n', 'service controller is missing env_file stack.env'],
    ['    profiles: ["tts-heavy"]\n', 'service tts-heavy is missing profile tts-heavy'],
    ['    healthcheck:\n      test: ["CMD-SHELL", "curl -f http://localhost:7701/health"]\n', 'service controller is missing a healthcheck'],
    ['      docker-socket-proxy:\n        condition: service_started\n', 'service controller is missing docker-socket-proxy service_started dependency'],
    ['      - analyzer-cache:/opt/analyzer/hf-cache\n', 'service analyzer is missing its named cache mount'],
    ['  analyzer-cache:\n', 'manifest is missing named volume analyzer-cache'],
    ['    logging: *default-logging\n', 'service broadcast is missing default log rotation'],
  ];
  for (const [material, expected] of cases) assertRejects(valid.replace(material, ''), expected);
});

test('rejects off-contract and extra published ports', () => {
  for (const binding of [
    '127.0.0.1:\${WEB_PORT:-7700}:7700',
    '10.20.0.10:\${WEB_PORT:-7700}:7700',
    '0.0.0.0:\${WEB_PORT:-7700}:7700',
    '[::]:\${WEB_PORT:-7700}:7700',
  ]) {
    const invalid = valid.replace('10.20.0.9:\${WEB_PORT:-7700}:7700', binding);
    assertRejects(invalid, `manifest contains an unapproved published port ${binding}`);
  }
  const extra = valid.replace(
    '      - "10.20.0.9:\${WEB_PORT:-7700}:7700"',
    '      - "10.20.0.9:\${WEB_PORT:-7700}:7700"\n      - "10.20.0.9:9999:9999"',
  );
  assertRejects(extra, 'manifest contains an unapproved published port 10.20.0.9:9999:9999');
});

test('does not accept required port bindings that appear only in comments', () => {
  const binding = '10.20.0.9:\${WEB_PORT:-7700}:7700';
  const invalid = valid.replace(`      - "${binding}"`, `      # - "${binding}"`);
  assertRejects(invalid, `manifest is missing published port ${binding}`);
});

test('rejects approved bindings assigned to the wrong service', () => {
  const web = '10.20.0.9:\${WEB_PORT:-7700}:7700';
  const controller = '10.20.0.9:\${CONTROLLER_PORT:-7701}:7701';
  const swapped = valid.replace(web, '__WEB__').replace(controller, web).replace('__WEB__', controller);
  assertRejects(swapped, `service web is missing published port ${web}`);
  assertRejects(swapped, `service controller is missing published port ${controller}`);
});

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
  caddy:
    image: ghcr.io/obiwancanoweme/subwave-caddy:\${SUBWAVE_VERSION:?required}
    logging: *default-logging
    depends_on:
      web:
        condition: service_started
      controller:
        condition: service_healthy
      broadcast:
        condition: service_healthy
    ports:
      - "10.20.0.9:\${WEB_PORT:-7700}:80"
      - "[2600:1700:3210:5314:10:20:0:9]:\${WEB_PORT:-7700}:80"
    volumes:
      - caddy-data:/data
      - caddy-config:/config
  broadcast:
    image: ghcr.io/obiwancanoweme/subwave-broadcast:\${SUBWAVE_VERSION:?required}
    logging: *default-logging
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
  caddy-data:
  caddy-config:
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

const nonCaddyServices = [
  'broadcast',
  'controller',
  'docker-socket-proxy',
  'web',
  'tts-heavy',
  'analyzer',
];

test('accepts the full seven-service Caddy production contract', () => {
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
  for (const service of ['caddy', 'broadcast', 'controller', 'web', 'tts-heavy']) {
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
    [
      '    image: ghcr.io/obiwancanoweme/subwave-broadcast:\${SUBWAVE_VERSION:?required}\n    logging: *default-logging\n',
      'service broadcast is missing default log rotation',
      '    image: ghcr.io/obiwancanoweme/subwave-broadcast:\${SUBWAVE_VERSION:?required}\n',
    ],
    ['      web:\n        condition: service_started\n', 'service caddy is missing web service_started dependency'],
    ['      controller:\n        condition: service_healthy\n', 'service caddy is missing controller service_healthy dependency'],
    ['      broadcast:\n        condition: service_healthy\n', 'service caddy is missing broadcast service_healthy dependency'],
    ['      - caddy-data:/data\n', 'service caddy is missing its data volume'],
    ['      - caddy-config:/config\n', 'service caddy is missing its config volume'],
    ['  caddy-data:\n', 'manifest is missing named volume caddy-data'],
    ['  caddy-config:\n', 'manifest is missing named volume caddy-config'],
  ];
  for (const [material, expected, replacement = ''] of cases) {
    assertRejects(valid.replace(material, replacement), expected);
  }
});

test('rejects non-Caddy services that publish host ports', () => {
  for (const service of nonCaddyServices) {
    const marker = `\n  ${service}:\n`;
    const invalid = valid.replace(
      marker,
      `${marker}    ports:\n      - "10.20.0.9:9999:9999"\n`,
    );
    assertRejects(invalid, `service ${service} must not publish host ports`);
  }
});

test('rejects non-Caddy services that publish host ports with flow syntax', () => {
  for (const service of nonCaddyServices) {
    const marker = `\n  ${service}:\n`;
    const invalid = valid.replace(
      marker,
      `${marker}    ports: ["10.20.0.9:9999:9999"]\n`,
    );
    assertRejects(invalid, `service ${service} must not publish host ports`);
  }
});

test('rejects non-Caddy services that publish host ports with multiline flow syntax', () => {
  for (const service of nonCaddyServices) {
    const marker = `\n  ${service}:\n`;
    const invalid = valid.replace(
      marker,
      `${marker}    ports: [\n      "10.20.0.9:9999:9999"\n    ]\n`,
    );
    assertRejects(invalid, `service ${service} must not publish host ports`);
  }
});

test('rejects missing, off-contract, commented, or duplicated Caddy bindings', () => {
  const ipv4 = '10.20.0.9:${WEB_PORT:-7700}:80';
  const ipv6 = '[2600:1700:3210:5314:10:20:0:9]:${WEB_PORT:-7700}:80';
  assertRejects(valid.replace(`      - "${ipv4}"\n`, ''), `service caddy is missing published port ${ipv4}`);
  assertRejects(valid.replace(ipv4, '0.0.0.0:${WEB_PORT:-7700}:80'), 'manifest binds a published port to a wildcard address');
  assertRejects(valid.replace(`      - "${ipv6}"`, `      # - "${ipv6}"`), `service caddy is missing published port ${ipv6}`);
  assertRejects(valid.replace(`      - "${ipv4}"`, `      - "${ipv4}"\n      - "${ipv4}"`), `manifest must publish port ${ipv4} exactly once`);
});

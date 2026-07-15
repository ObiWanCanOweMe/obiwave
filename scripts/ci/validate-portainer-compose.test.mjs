import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as validator from './validate-portainer-compose.mjs';

const { validatePortainerCompose } = validator;

const trustedProxyRanges = '10.20.0.14/32 2600:1700:3210:5314:10:20:0:14/128';
const validResolved = {
  services: {
    caddy: {
      environment: { TRUSTED_PROXY_RANGES: trustedProxyRanges },
      ports: [
        { host_ip: '10.20.0.9', published: '7700', target: 80 },
        { host_ip: '2600:1700:3210:5314:10:20:0:9', published: 7700, target: '80' },
      ],
    },
    web: {},
  },
};

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
    environment:
      TRUSTED_PROXY_RANGES: "10.20.0.14/32 2600:1700:3210:5314:10:20:0:14/128"
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

function resolvedErrors(model) {
  return validator.validateResolvedPortainerCompose?.(model) ?? [];
}

function renderCompose(source) {
  const directory = mkdtempSync(join(tmpdir(), 'subwave-compose-policy-'));
  const file = join(directory, 'compose.yml');
  try {
    writeFileSync(file, source);
    const result = spawnSync('docker', ['compose', '--profile', '*', '-f', file, 'config', '--format', 'json'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('resolved model rejects a non-Caddy published port', () => {
  const model = structuredClone(validResolved);
  model.services.web.ports = [{ host_ip: '10.20.0.9', published: 9999, target: 9999 }];
  assert.ok(
    resolvedErrors(model).includes('resolved service web must not publish host ports'),
  );
});

test('Docker-resolved tagged ports key cannot bypass non-Caddy port policy', () => {
  const model = renderCompose(`
services:
  caddy:
    image: alpine
    environment:
      TRUSTED_PROXY_RANGES: "${trustedProxyRanges}"
    ports:
      - "10.20.0.9:7700:80"
      - "[2600:1700:3210:5314:10:20:0:9]:7700:80"
  web:
    image: alpine
    !!str ports:
      - "10.20.0.9:9999:9999"
`);
  assert.ok(
    resolvedErrors(model).includes('resolved service web must not publish host ports'),
  );
});

test('Docker-resolved quoted and merged ports cannot bypass non-Caddy port policy', () => {
  const cases = [
    `
services:
  caddy:
    image: alpine
    environment:
      TRUSTED_PROXY_RANGES: "${trustedProxyRanges}"
    ports:
      - "10.20.0.9:7700:80"
      - "[2600:1700:3210:5314:10:20:0:9]:7700:80"
  web:
    image: alpine
    "ports": ["10.20.0.9:9999:9999"]
`,
    `
x-port-leak: &port-leak
  ports: ["10.20.0.9:9999:9999"]
services:
  caddy:
    image: alpine
    environment:
      TRUSTED_PROXY_RANGES: "${trustedProxyRanges}"
    ports:
      - "10.20.0.9:7700:80"
      - "[2600:1700:3210:5314:10:20:0:9]:7700:80"
  web:
    <<: *port-leak
    image: alpine
`,
  ];
  for (const source of cases) {
    assert.ok(
      resolvedErrors(renderCompose(source)).includes('resolved service web must not publish host ports'),
    );
  }
});

test('Docker-resolved profiled services cannot bypass non-Caddy port policy', () => {
  const model = renderCompose(`
services:
  caddy:
    image: alpine
    environment:
      TRUSTED_PROXY_RANGES: "${trustedProxyRanges}"
    ports:
      - "10.20.0.9:7700:80"
      - "[2600:1700:3210:5314:10:20:0:9]:7700:80"
  tts-heavy:
    image: alpine
    profiles: ["tts-heavy"]
    ports: ["10.20.0.9:9999:9999"]
`);
  assert.ok(
    resolvedErrors(model).includes('resolved service tts-heavy must not publish host ports'),
  );
});

test('resolved model requires exact Caddy port ownership and cardinality', () => {
  assert.deepEqual(resolvedErrors(validResolved), []);

  const missing = structuredClone(validResolved);
  missing.services.caddy.ports.pop();
  assert.ok(resolvedErrors(missing).includes('resolved service caddy must publish exactly the approved ports'));

  const duplicate = structuredClone(validResolved);
  duplicate.services.caddy.ports.push({ ...duplicate.services.caddy.ports[0] });
  assert.ok(resolvedErrors(duplicate).includes('resolved service caddy must publish exactly the approved ports'));

  for (const [field, value] of [
    ['host_ip', '10.20.0.10'],
    ['published', '7701'],
    ['target', 81],
  ]) {
    const wrong = structuredClone(validResolved);
    wrong.services.caddy.ports[0][field] = value;
    assert.ok(resolvedErrors(wrong).includes('resolved service caddy must publish exactly the approved ports'));
  }

  const wrongOwner = structuredClone(validResolved);
  wrongOwner.services.web.ports = [wrongOwner.services.caddy.ports.pop()];
  assert.ok(resolvedErrors(wrongOwner).includes('resolved service web must not publish host ports'));
  assert.ok(resolvedErrors(wrongOwner).includes('resolved service caddy must publish exactly the approved ports'));
});

test('resolved model requires exact Caddy trusted proxy ranges', () => {
  for (const value of [undefined, '10.20.0.15/32']) {
    const model = structuredClone(validResolved);
    if (value === undefined) delete model.services.caddy.environment.TRUSTED_PROXY_RANGES;
    else model.services.caddy.environment.TRUSTED_PROXY_RANGES = value;
    assert.ok(
      resolvedErrors(model).includes('resolved service caddy has invalid bender trusted proxy ranges'),
    );
  }
});

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

test('generic Caddyfile expands optional trusted proxies and parses them strictly', () => {
  const caddyfile = readFileSync(new URL('../../docker/Caddyfile', import.meta.url), 'utf8');
  assert.match(caddyfile, /trusted_proxies static[\s\S]*\{\$TRUSTED_PROXY_RANGES\}/);
  assert.match(caddyfile, /^\s*trusted_proxies_strict\s*$/m);
});

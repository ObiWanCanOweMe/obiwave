import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as validator from './validate-portainer-compose.mjs';

const { validatePortainerCompose } = validator;

const trustedProxyRanges = '10.20.0.14/32 2600:1700:3210:5314:10:20:0:14/128';
const portainerManifest = readFileSync(
  new URL('../../deploy/portainer/docker-compose.yml', import.meta.url),
  'utf8',
);
const cudaGateScript = '/opt/analyzer/venv/bin/python -c "import sys, torch; sys.exit(0 if torch.cuda.is_available() else 1)" && exec uvicorn server:app --host 0.0.0.0 --port 8080';
const cudaGateCommand = ['/bin/sh', '-c', cudaGateScript];
const cudaGateSource = `command:
      - /bin/sh
      - -c
      - >-
        /opt/analyzer/venv/bin/python -c "import sys, torch; sys.exit(0 if torch.cuda.is_available() else 1)" &&
        exec uvicorn server:app --host 0.0.0.0 --port 8080`;
const ttsCudaGateScript = '/opt/chatterbox/venv/bin/python -c "import sys, torch; sys.exit(0 if torch.cuda.is_available() else 1)" && exec uvicorn server:app --host 0.0.0.0 --port 8080';
const ttsCudaGateCommand = ['/bin/sh', '-c', ttsCudaGateScript];
const validResolved = {
  services: {
    caddy: {
      environment: { TRUSTED_PROXY_RANGES: trustedProxyRanges },
      ports: [
        { host_ip: '10.20.0.9', published: '7700', target: 80, protocol: 'tcp' },
        { host_ip: '2600:1700:3210:5314:10:20:0:9', published: 7700, target: '80', protocol: 'tcp' },
      ],
    },
    web: {},
    'tts-heavy': {
      image: 'ghcr.io/obiwancanoweme/subwave-tts-heavy-cuda:v1.0.0-obiwave.1',
      command: ttsCudaGateCommand,
      environment: { TTS_HEAVY_DEVICE: 'cuda', TTS_HEAVY_ENGINES: 'chatterbox,pocket-tts' },
      deploy: {
        resources: {
          reservations: {
            devices: [{ driver: 'nvidia', count: 'all', capabilities: ['gpu'] }],
          },
        },
      },
    },
    analyzer: {
      image: 'ghcr.io/obiwancanoweme/subwave-analyzer-cuda:v1.0.0-obiwave.1',
      command: cudaGateCommand,
      environment: { ANALYZE_DEVICE: 'cuda' },
      deploy: {
        resources: {
          reservations: {
            devices: [{ driver: 'nvidia', count: 'all', capabilities: ['gpu'] }],
          },
        },
      },
    },
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
    image: ghcr.io/obiwancanoweme/subwave-tts-heavy-cuda:\${SUBWAVE_VERSION:?required}
    command:
      - /bin/sh
      - -c
      - >-
        /opt/chatterbox/venv/bin/python -c "import sys, torch; sys.exit(0 if torch.cuda.is_available() else 1)" &&
        exec uvicorn server:app --host 0.0.0.0 --port 8080
    logging: *default-logging
    mem_limit: \${TTS_HEAVY_MEM_LIMIT:-10g}
    environment:
      TTS_HEAVY_DEVICE: cuda
      TTS_HEAVY_ENGINES: chatterbox,pocket-tts
      POCKET_TTS_VOICE: \${POCKET_TTS_VOICE:-alba}
      HF_TOKEN: \${HF_TOKEN:-}
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    volumes:
      - *state-mount
      - tts-heavy-chatterbox-cache:/opt/chatterbox/hf-cache
      - tts-heavy-pocket-cache:/opt/pocket-tts/hf-cache
  analyzer:
    image: ghcr.io/obiwancanoweme/subwave-analyzer-cuda:\${SUBWAVE_VERSION:?required}
    command:
      - /bin/sh
      - -c
      - >-
        /opt/analyzer/venv/bin/python -c "import sys, torch; sys.exit(0 if torch.cuda.is_available() else 1)" &&
        exec uvicorn server:app --host 0.0.0.0 --port 8080
    logging: *default-logging
    mem_limit: \${ANALYZER_MEM_LIMIT:-6g}
    environment:
      ANALYZE_DEVICE: cuda
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
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

function renderCompose(source, env = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'subwave-compose-policy-'));
  const file = join(directory, 'compose.yml');
  try {
    writeFileSync(file, source);
    writeFileSync(join(directory, 'stack.env'), '');
    writeFileSync(join(directory, '.env'), '');
    const result = spawnSync('docker', ['compose', '--profile', '*', '-f', file, 'config', '--format', 'json'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ...env,
        SUBWAVE_VERSION: 'v1.0.0-obiwave.1',
        ADMIN_USER: 'ci',
        ADMIN_PASS: 'ci',
        SITE_URL: 'https://radio.kener.org',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function renderAnalyzerService(file) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  return renderCompose(source).services.analyzer;
}

function runAnalyzerHealthcheck(healthcheck, body) {
  const directory = mkdtempSync(join(tmpdir(), 'subwave-analyzer-health-'));
  const curl = join(directory, 'curl');
  try {
    writeFileSync(curl, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(body)}'\n`);
    chmodSync(curl, 0o755);
    const command = healthcheck.test[1].replace('/opt/analyzer/venv/bin/python', 'python3');
    return spawnSync('/bin/sh', ['-c', command], {
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
    }).status;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function aioHealthCommand() {
  const source = readFileSync(new URL('../../docker/Dockerfile.aio', import.meta.url), 'utf8');
  const match = source.match(/HEALTHCHECK[^\n]*\\\n\s*CMD ([^\n]+)/);
  assert.ok(match, 'AIO Dockerfile must declare a shell-form health command');
  return match[1];
}

test('every sidecar analyzer healthcheck requires ok=true and the analyze engine only', () => {
  for (const file of [
    'docker-compose.yml',
    'docker-compose.byo.yml',
    'docker-compose.dev.yml',
    'deploy/portainer/docker-compose.yml',
  ]) {
    const healthcheck = renderAnalyzerService(file).healthcheck;
    assert.ok(healthcheck, `${file} analyzer is missing a healthcheck`);
    assert.equal(runAnalyzerHealthcheck(healthcheck, { ok: true, engines: ['analyze'] }), 0, file);
    assert.equal(
      runAnalyzerHealthcheck(healthcheck, {
        ok: true,
        engines: ['analyze'],
        analyze_audio_capable: false,
        analyze_vocal_capable: false,
      }),
      0,
      `${file} must not require optional CLAP or Demucs residency`,
    );
    for (const body of [
      { ok: false, engines: ['analyze'] },
      { ok: true, engines: [] },
      { ok: true, engines: ['clap', 'demucs'] },
    ]) {
      assert.notEqual(runAnalyzerHealthcheck(healthcheck, body), 0, `${file}: ${JSON.stringify(body)}`);
    }
  }
});

test('AIO health fails when ANALYZE_PYTHON is not executable before probing public health', () => {
  const directory = mkdtempSync(join(tmpdir(), 'subwave-aio-health-'));
  const curl = join(directory, 'curl');
  const python = join(directory, 'analyze-python');
  try {
    writeFileSync(curl, '#!/bin/sh\nexit 0\n');
    writeFileSync(python, '#!/bin/sh\nexit 0\n');
    chmodSync(curl, 0o755);
    const command = aioHealthCommand();
    const run = (mode) => {
      chmodSync(python, mode);
      return spawnSync('/bin/sh', ['-c', command], {
        env: {
          ...process.env,
          ANALYZE_PYTHON: python,
          PATH: `${directory}:${process.env.PATH}`,
        },
      }).status;
    };
    assert.notEqual(run(0o644), 0);
    assert.equal(run(0o755), 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

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

test('resolved model requires TCP for both Caddy publications', () => {
  const udpOnly = structuredClone(validResolved);
  for (const port of udpOnly.services.caddy.ports) port.protocol = 'udp';
  assert.ok(
    resolvedErrors(udpOnly).includes('resolved service caddy must publish exactly the approved ports'),
  );

  const mixed = structuredClone(validResolved);
  mixed.services.caddy.ports[1].protocol = 'udp';
  assert.ok(
    resolvedErrors(mixed).includes('resolved service caddy must publish exactly the approved ports'),
  );
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

test('resolved analyzer requires the release-tagged CUDA mirror and NVIDIA reservation', () => {
  assert.deepEqual(resolvedErrors(validResolved), []);

  const cases = [
    ['image', 'example.invalid/analyzer:1.0.0', 'resolved analyzer has an invalid CUDA mirror image'],
    ['device', 'cpu', 'resolved analyzer must require CUDA'],
    ['driver', 'other', 'resolved analyzer has an invalid NVIDIA GPU reservation'],
    ['count', 1, 'resolved analyzer has an invalid NVIDIA GPU reservation'],
    ['capabilities', ['compute'], 'resolved analyzer has an invalid NVIDIA GPU reservation'],
  ];

  for (const [field, value, expected] of cases) {
    const model = structuredClone(validResolved);
    if (field === 'image') model.services.analyzer.image = value;
    if (field === 'device') model.services.analyzer.environment.ANALYZE_DEVICE = value;
    if (field === 'driver') model.services.analyzer.deploy.resources.reservations.devices[0].driver = value;
    if (field === 'count') model.services.analyzer.deploy.resources.reservations.devices[0].count = value;
    if (field === 'capabilities') {
      model.services.analyzer.deploy.resources.reservations.devices[0].capabilities = value;
    }
    assert.ok(resolvedErrors(model).includes(expected));
  }

  const dockerNormalized = structuredClone(validResolved);
  dockerNormalized.services.analyzer.deploy.resources.reservations.devices[0].count = -1;
  assert.deepEqual(resolvedErrors(dockerNormalized), []);
});

test('source and resolved Ark TTS require the default-on fail-closed CUDA topology', () => {
  assert.deepEqual(errorsFor(valid), []);

  const sourceCases = [
    [
      'ghcr.io/obiwancanoweme/subwave-tts-heavy-cuda:${SUBWAVE_VERSION:?required}',
      'ghcr.io/obiwancanoweme/subwave-tts-heavy:${SUBWAVE_VERSION:?required}',
      'service tts-heavy has an invalid image',
    ],
    [
      `    command:
      - /bin/sh
      - -c
      - >-
        /opt/chatterbox/venv/bin/python -c "import sys, torch; sys.exit(0 if torch.cuda.is_available() else 1)" &&
        exec uvicorn server:app --host 0.0.0.0 --port 8080
`,
      '',
      'service tts-heavy is missing its fail-closed CUDA startup gate',
    ],
    ['      TTS_HEAVY_DEVICE: cuda\n', '      TTS_HEAVY_DEVICE: cpu\n', 'service tts-heavy must require CUDA'],
    ['      TTS_HEAVY_ENGINES: chatterbox,pocket-tts\n', '      TTS_HEAVY_ENGINES: chatterbox\n', 'service tts-heavy must load both engines'],
    [
      `    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
`,
      '',
      'service tts-heavy is missing its NVIDIA GPU reservation',
    ],
    ['    mem_limit: ${TTS_HEAVY_MEM_LIMIT:-10g}\n', '    mem_limit: ${TTS_HEAVY_MEM_LIMIT:-10g}\n    profiles: ["tts-heavy"]\n', 'service tts-heavy must not be profile-gated'],
  ];
  for (const [from, to, expected] of sourceCases) assertRejects(valid.replace(from, to), expected);

  const resolvedCases = [
    ['image', 'ghcr.io/obiwancanoweme/subwave-tts-heavy:v1.0.0-obiwave.1', 'resolved tts-heavy has an invalid CUDA mirror image'],
    ['command', undefined, 'resolved tts-heavy has an invalid fail-closed CUDA startup gate'],
    ['device', 'cpu', 'resolved tts-heavy must require CUDA'],
    ['engines', 'chatterbox', 'resolved tts-heavy must load both engines'],
    ['devices', undefined, 'resolved tts-heavy has an invalid NVIDIA GPU reservation'],
    ['profiles', ['tts-heavy'], 'resolved tts-heavy must not be profile-gated'],
  ];
  for (const [field, value, expected] of resolvedCases) {
    const model = structuredClone(validResolved);
    if (field === 'image') model.services['tts-heavy'].image = value;
    if (field === 'command') delete model.services['tts-heavy'].command;
    if (field === 'device') model.services['tts-heavy'].environment.TTS_HEAVY_DEVICE = value;
    if (field === 'engines') model.services['tts-heavy'].environment.TTS_HEAVY_ENGINES = value;
    if (field === 'devices') delete model.services['tts-heavy'].deploy.resources.reservations.devices;
    if (field === 'profiles') model.services['tts-heavy'].profiles = value;
    assert.ok(resolvedErrors(model).includes(expected), expected);
  }
});

test('Portainer forwards analyzer lifecycle overrides', () => {
  const analyzer = renderCompose(portainerManifest, {
    ANALYZE_IDLE_UNLOAD_S: '17',
    ANALYZE_RECYCLE_IDLE_S: '23',
  }).services.analyzer;
  assert.equal(analyzer.environment.ANALYZE_IDLE_UNLOAD_S, '17');
  assert.equal(analyzer.environment.ANALYZE_RECYCLE_IDLE_S, '23');
});

test('source and resolved analyzer require the fail-closed CUDA startup gate', () => {
  assert.deepEqual(errorsFor(valid), []);
  assertRejects(
    valid.replace(cudaGateSource, ''),
    'service analyzer is missing its fail-closed CUDA startup gate',
  );
  assertRejects(
    valid.replace(
      cudaGateSource,
      cudaGateSource.replace('sys.exit(0 if torch.cuda.is_available() else 1)', 'sys.exit(0)'),
    ),
    'service analyzer is missing its fail-closed CUDA startup gate',
  );

  for (const command of [
    undefined,
    ['/bin/sh', '-c', cudaGateScript.replace(' && ', ' ; ')],
    ['/bin/sh', '-c', cudaGateScript.replace('/opt/analyzer/venv/bin/python', 'python')],
    ['/bin/sh', '-c', cudaGateScript.replace('exec uvicorn', 'uvicorn')],
  ]) {
    const model = structuredClone(validResolved);
    if (command === undefined) delete model.services.analyzer.command;
    else model.services.analyzer.command = command;
    assert.ok(
      resolvedErrors(model).includes('resolved analyzer has an invalid fail-closed CUDA startup gate'),
    );
  }
});

test('CUDA preflight gates analyzer server startup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'subwave-cuda-gate-'));
  const preflight = join(directory, 'cuda-preflight');
  const server = join(directory, 'analyzer-server');
  const started = join(directory, 'server-started');
  try {
    writeFileSync(preflight, '#!/bin/sh\nexit "$CUDA_PREFLIGHT_STATUS"\n');
    writeFileSync(server, '#!/bin/sh\n: > \"$ANALYZER_STARTED\"\n');
    chmodSync(preflight, 0o755);
    chmodSync(server, 0o755);

    const command = renderCompose(portainerManifest).services.analyzer.command[2]
      .replace(
        '/opt/analyzer/venv/bin/python -c "import sys, torch; sys.exit(0 if torch.cuda.is_available() else 1)"',
        '"$CUDA_PREFLIGHT"',
      )
      .replace(
        'exec uvicorn server:app --host 0.0.0.0 --port 8080',
        'exec "$ANALYZER_SERVER"',
      );
    const runGate = (status) => spawnSync('/bin/sh', ['-c', command], {
      env: {
        ...process.env,
        CUDA_PREFLIGHT: preflight,
        CUDA_PREFLIGHT_STATUS: String(status),
        ANALYZER_SERVER: server,
        ANALYZER_STARTED: started,
      },
    });

    assert.equal(runGate(1).status, 1);
    assert.equal(existsSync(started), false);
    assert.equal(runGate(0).status, 0);
    assert.equal(existsSync(started), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CUDA preflight gates Ark TTS server startup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'subwave-tts-cuda-gate-'));
  const preflight = join(directory, 'cuda-preflight');
  const server = join(directory, 'tts-heavy-server');
  const started = join(directory, 'server-started');
  try {
    writeFileSync(preflight, '#!/bin/sh\nexit "$CUDA_PREFLIGHT_STATUS"\n');
    writeFileSync(server, '#!/bin/sh\n: > "$TTS_HEAVY_STARTED"\n');
    chmodSync(preflight, 0o755);
    chmodSync(server, 0o755);

    const command = renderCompose(portainerManifest).services['tts-heavy'].command[2]
      .replace(
        '/opt/chatterbox/venv/bin/python -c "import sys, torch; sys.exit(0 if torch.cuda.is_available() else 1)"',
        '"$CUDA_PREFLIGHT"',
      )
      .replace(
        'exec uvicorn server:app --host 0.0.0.0 --port 8080',
        'exec "$TTS_HEAVY_SERVER"',
      );
    const runGate = (status) => spawnSync('/bin/sh', ['-c', command], {
      env: {
        ...process.env,
        CUDA_PREFLIGHT: preflight,
        CUDA_PREFLIGHT_STATUS: String(status),
        TTS_HEAVY_SERVER: server,
        TTS_HEAVY_STARTED: started,
      },
    });

    assert.equal(runGate(1).status, 1);
    assert.equal(existsSync(started), false);
    assert.equal(runGate(0).status, 0);
    assert.equal(existsSync(started), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('accepts the full seven-service Caddy production contract', () => {
  assert.deepEqual(errorsFor(valid), []);
});

test('rejects mutable or checkout-coupled deployment', () => {
  const invalid = `${valid}\nbuild: .\nimage: example:latest\n` +
    `./state:/var/sub-wave\n` +
    `env_file: ./.env\n0.0.0.0:7700:7700\n[::]:7700:7700\n`;
  for (const expected of [
    'manifest contains a build directive',
    'manifest references latest',
    'manifest contains a repository-relative state mount',
    'manifest depends on a repository .env file',
  ]) assertRejects(invalid, expected);
  assertRejects(
    valid.replace(
      'ghcr.io/obiwancanoweme/subwave-web:\${SUBWAVE_VERSION:?required}',
      'ghcr.io/perminder-klair/subwave-web:\${SUBWAVE_VERSION:?required}',
    ),
    'service web has an invalid image',
  );
});

test('rejects missing services and exact first-party images', () => {
  assertRejects(valid.replace(/  analyzer:\n[\s\S]*?(?=volumes:)/, ''), 'manifest is missing service analyzer');
  for (const service of ['caddy', 'broadcast', 'controller', 'web']) {
    assertRejects(
      valid.replace(`ghcr.io/obiwancanoweme/subwave-${service}:`, `example.invalid/subwave-${service}:`),
      `service ${service} has an invalid image`,
    );
  }
  assertRejects(
    valid.replace(
      'ghcr.io/obiwancanoweme/subwave-tts-heavy-cuda:${SUBWAVE_VERSION:?required}',
      'example.invalid/subwave-tts-heavy-cuda:${SUBWAVE_VERSION:?required}',
    ),
    'service tts-heavy has an invalid image',
  );
  for (const image of [
    'ghcr.io/obiwancanoweme/subwave-analyzer:\${SUBWAVE_VERSION:?required}',
    'ghcr.io/perminder-klair/subwave-analyzer-cuda:v1.0.0-obiwave.1',
    'ghcr.io/perminder-klair/subwave-analyzer-cuda:latest',
    'ghcr.io/obiwancanoweme/subwave-analyzer-cuda:latest',
    'ghcr.io/obiwancanoweme/subwave-analyzer-cuda:\${UPSTREAM_ANALYZER_VERSION:?required}',
  ]) {
    assertRejects(
      valid.replace(
        'ghcr.io/obiwancanoweme/subwave-analyzer-cuda:\${SUBWAVE_VERSION:?required}',
        image,
      ),
      'service analyzer has an invalid image',
    );
  }
  assertRejects(
    valid.replace('ghcr.io/tecnativa/docker-socket-proxy:0.3.0', 'ghcr.io/tecnativa/docker-socket-proxy:latest'),
    'service docker-socket-proxy has an invalid image',
  );
});

test('rejects material topology removals', () => {
  const cases = [
    ['      - stack.env\n', 'service controller is missing env_file stack.env'],
    ['    mem_limit: ${TTS_HEAVY_MEM_LIMIT:-10g}\n', 'service tts-heavy must not be profile-gated', '    mem_limit: ${TTS_HEAVY_MEM_LIMIT:-10g}\n    profiles: ["tts-heavy"]\n'],
    ['    healthcheck:\n      test: ["CMD-SHELL", "curl -f http://localhost:7701/health"]\n', 'service controller is missing a healthcheck'],
    ['      docker-socket-proxy:\n        condition: service_started\n', 'service controller is missing docker-socket-proxy service_started dependency'],
    ['      ANALYZE_DEVICE: cuda\n', 'service analyzer must require CUDA'],
    [
      '      ANALYZE_DEVICE: cuda\n    deploy:\n      resources:\n        reservations:\n          devices:\n            - driver: nvidia\n              count: all\n              capabilities: [gpu]\n',
      'service analyzer is missing its NVIDIA GPU reservation',
      '      ANALYZE_DEVICE: cuda\n',
    ],
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

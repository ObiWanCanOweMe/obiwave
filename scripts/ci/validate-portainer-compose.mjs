import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const rules = [
  [/^\s*build\s*:/m, 'manifest contains a build directive'],
  [/(?:^|:)latest(?:$|\s)/m, 'manifest references latest'],
  [/(?:\$\{STATE_DIR[^}]*\}|\.\/state):\/var\/sub-wave/, 'manifest contains a repository-relative state mount'],
  [/env_file:\s*(?:\n\s*-\s*)?\.\/\.env/, 'manifest depends on a repository .env file'],
];

const serviceImages = new Map([
  ['caddy', 'ghcr.io/obiwancanoweme/subwave-caddy:${SUBWAVE_VERSION:?required}'],
  ['broadcast', 'ghcr.io/obiwancanoweme/subwave-broadcast:${SUBWAVE_VERSION:?required}'],
  ['controller', 'ghcr.io/obiwancanoweme/subwave-controller:${SUBWAVE_VERSION:?required}'],
  ['docker-socket-proxy', 'ghcr.io/tecnativa/docker-socket-proxy:0.3.0'],
  ['web', 'ghcr.io/obiwancanoweme/subwave-web:${SUBWAVE_VERSION:?required}'],
  ['tts-heavy', 'ghcr.io/obiwancanoweme/subwave-tts-heavy:${SUBWAVE_VERSION:?required}'],
  ['analyzer', 'ghcr.io/obiwancanoweme/subwave-analyzer-cuda:${SUBWAVE_VERSION:?required}'],
]);

const serviceRequirements = [
  ['caddy', 'logging: *default-logging', 'service caddy is missing default log rotation'],
  ['caddy', 'web:\n        condition: service_started', 'service caddy is missing web service_started dependency'],
  ['caddy', 'controller:\n        condition: service_healthy', 'service caddy is missing controller service_healthy dependency'],
  ['caddy', 'broadcast:\n        condition: service_healthy', 'service caddy is missing broadcast service_healthy dependency'],
  ['caddy', 'caddy-data:/data', 'service caddy is missing its data volume'],
  ['caddy', 'caddy-config:/config', 'service caddy is missing its config volume'],
  ['broadcast', 'logging: *default-logging', 'service broadcast is missing default log rotation'],
  ['broadcast', 'healthcheck:', 'service broadcast is missing a healthcheck'],
  ['broadcast', '*state-mount', 'service broadcast is missing the state mount'],
  ['broadcast', '/mnt/NVMe/container-data/subwave/state/logs:/var/log/liquidsoap', 'service broadcast is missing the liquidsoap log mount'],
  ['controller', 'logging: *default-logging', 'service controller is missing default log rotation'],
  ['controller', 'healthcheck:', 'service controller is missing a healthcheck'],
  ['controller', 'env_file:\n      - stack.env', 'service controller is missing env_file stack.env'],
  ['controller', 'broadcast:\n        condition: service_healthy', 'service controller is missing broadcast service_healthy dependency'],
  ['controller', 'docker-socket-proxy:\n        condition: service_started', 'service controller is missing docker-socket-proxy service_started dependency'],
  ['controller', '*state-mount', 'service controller is missing the state mount'],
  ['docker-socket-proxy', 'logging: *default-logging', 'service docker-socket-proxy is missing default log rotation'],
  ['docker-socket-proxy', '/var/run/docker.sock:/var/run/docker.sock:ro', 'service docker-socket-proxy is missing its read-only socket mount'],
  ['web', 'logging: *default-logging', 'service web is missing default log rotation'],
  ['web', 'controller:\n        condition: service_healthy', 'service web is missing controller service_healthy dependency'],
  ['tts-heavy', 'logging: *default-logging', 'service tts-heavy is missing default log rotation'],
  ['tts-heavy', 'profiles: ["tts-heavy"]', 'service tts-heavy is missing profile tts-heavy'],
  ['tts-heavy', 'mem_limit:', 'service tts-heavy is missing its memory limit'],
  ['tts-heavy', '*state-mount', 'service tts-heavy is missing the state mount'],
  ['tts-heavy', 'tts-heavy-chatterbox-cache:/opt/chatterbox/hf-cache', 'service tts-heavy is missing its chatterbox cache mount'],
  ['tts-heavy', 'tts-heavy-pocket-cache:/opt/pocket-tts/hf-cache', 'service tts-heavy is missing its pocket cache mount'],
  ['analyzer', 'logging: *default-logging', 'service analyzer is missing default log rotation'],
  ['analyzer', 'mem_limit:', 'service analyzer is missing its memory limit'],
  ['analyzer', 'ANALYZE_DEVICE: cuda', 'service analyzer must require CUDA'],
  [
    'analyzer',
    'driver: nvidia\n              count: all\n              capabilities: [gpu]',
    'service analyzer is missing its NVIDIA GPU reservation',
  ],
  ['analyzer', '*state-mount', 'service analyzer is missing the state mount'],
  ['analyzer', 'analyzer-cache:/opt/analyzer/hf-cache', 'service analyzer is missing its named cache mount'],
];

function uncommented(source) {
  return source.split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .map((line) => line.replace(/\s+#.*$/, ''))
    .join('\n');
}

function serviceBlocks(source) {
  const lines = source.split('\n');
  const servicesAt = lines.findIndex((line) => /^services:\s*$/.test(line));
  const blocks = new Map();
  if (servicesAt === -1) return blocks;

  let current;
  for (let index = servicesAt + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\S/.test(line)) break;
    const header = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
    if (header) {
      current = header[1];
      blocks.set(current, []);
    } else if (current) {
      blocks.get(current).push(line);
    }
  }
  return new Map([...blocks].map(([name, linesForService]) => [name, linesForService.join('\n')]));
}

function namedVolumes(source) {
  const lines = source.split('\n');
  const volumesAt = lines.findIndex((line) => /^volumes:\s*$/.test(line));
  if (volumesAt === -1) return new Set();
  const names = [];
  for (let index = volumesAt + 1; index < lines.length && !/^\S/.test(lines[index]); index += 1) {
    const match = lines[index].match(/^  ([a-zA-Z0-9_-]+):/);
    if (match) names.push(match[1]);
  }
  return new Set(names);
}

export function validatePortainerCompose(source) {
  const active = uncommented(source);
  const errors = rules.filter(([pattern]) => pattern.test(active)).map(([, message]) => message);
  const blocks = serviceBlocks(active);

  for (const [service, expectedImage] of serviceImages) {
    const block = blocks.get(service);
    if (!block) {
      errors.push(`manifest is missing service ${service}`);
      continue;
    }
    const image = block.match(/^    image:\s*(\S+)\s*$/m)?.[1];
    if (image !== expectedImage) errors.push(`service ${service} has an invalid image`);
  }
  for (const service of blocks.keys()) {
    if (!serviceImages.has(service)) errors.push(`manifest contains unexpected service ${service}`);
  }

  for (const [service, marker, message] of serviceRequirements) {
    const block = blocks.get(service);
    if (block && !block.includes(marker) && !errors.includes(message)) errors.push(message);
  }

  const volumes = namedVolumes(active);
  for (const volume of ['caddy-data', 'caddy-config', 'tts-heavy-chatterbox-cache', 'tts-heavy-pocket-cache', 'analyzer-cache']) {
    if (!volumes.has(volume)) errors.push(`manifest is missing named volume ${volume}`);
  }

  for (const marker of [
    '/mnt/NVMe/container-data/subwave/state:/var/sub-wave',
    'x-logging: &default-logging',
    'driver: json-file',
    'max-size: "10m"',
    'max-file: "3"',
  ]) {
    if (!active.includes(marker)) errors.push(`manifest is missing ${marker}`);
  }

  return errors;
}

const trustedProxyRanges = '10.20.0.14/32 2600:1700:3210:5314:10:20:0:14/128';
const approvedResolvedPorts = [
  '10.20.0.9|7700|80|tcp',
  '2600:1700:3210:5314:10:20:0:9|7700|80|tcp',
].sort();

function resolvedPorts(service) {
  if (service?.ports == null) return [];
  return Array.isArray(service.ports) ? service.ports : [service.ports];
}

function normalizedPort(port) {
  const value = (field) => ['string', 'number'].includes(typeof port?.[field])
    ? String(port[field])
    : '';
  return `${value('host_ip')}|${value('published')}|${value('target')}|${value('protocol')}`;
}

export function validateResolvedPortainerCompose(model) {
  const errors = [];
  const services = model?.services && typeof model.services === 'object' ? model.services : {};
  const caddy = services.caddy;

  if (!caddy || typeof caddy !== 'object') {
    errors.push('resolved manifest is missing service caddy');
  } else {
    const actualPorts = resolvedPorts(caddy).map(normalizedPort).sort();
    if (JSON.stringify(actualPorts) !== JSON.stringify(approvedResolvedPorts)) {
      errors.push('resolved service caddy must publish exactly the approved ports');
    }
    if (caddy.environment?.TRUSTED_PROXY_RANGES !== trustedProxyRanges) {
      errors.push('resolved service caddy has invalid bender trusted proxy ranges');
    }
  }

  for (const [service, configuration] of Object.entries(services)) {
    if (service !== 'caddy' && resolvedPorts(configuration).length !== 0) {
      errors.push(`resolved service ${service} must not publish host ports`);
    }
  }

  const analyzer = services.analyzer;
  if (!/^ghcr\.io\/obiwancanoweme\/subwave-analyzer-cuda:v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)-obiwave\.[1-9][0-9]*$/.test(analyzer?.image ?? '')) {
    errors.push('resolved analyzer has an invalid CUDA mirror image');
  }
  if (analyzer?.environment?.ANALYZE_DEVICE !== 'cuda') {
    errors.push('resolved analyzer must require CUDA');
  }
  const devices = analyzer?.deploy?.resources?.reservations?.devices;
  if (
    !Array.isArray(devices)
    || devices.length !== 1
    || devices[0]?.driver !== 'nvidia'
    || !['all', -1].includes(devices[0]?.count)
    || JSON.stringify(devices[0]?.capabilities) !== JSON.stringify(['gpu'])
  ) {
    errors.push('resolved analyzer has an invalid NVIDIA GPU reservation');
  }
  return errors;
}

async function main() {
  const file = process.argv[2] ?? 'deploy/portainer/docker-compose.yml';
  const sourceErrors = validatePortainerCompose(await readFile(file, 'utf8'));
  const result = spawnSync(
    'docker',
    ['compose', '--profile', '*', '-f', file, 'config', '--format', 'json'],
    {
      encoding: 'utf8',
      env: process.env,
    },
  );
  if (result.error) throw new Error(`docker compose config failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`docker compose config failed: ${result.stderr.trim() || `exit ${result.status}`}`);
  }
  let model;
  try {
    model = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`docker compose config emitted invalid JSON: ${error.message}`);
  }
  const errors = [...sourceErrors, ...validateResolvedPortainerCompose(model)];
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`validated ${file}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

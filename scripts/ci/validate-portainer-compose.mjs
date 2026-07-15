import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const rules = [
  [/^\s*build\s*:/m, 'manifest contains a build directive'],
  [/(?:^|:)latest(?:$|\s)/m, 'manifest references latest'],
  [/ghcr\.io\/perminder-klair\//, 'manifest references the upstream image namespace'],
  [/(?:\$\{STATE_DIR[^}]*\}|\.\/state):\/var\/sub-wave/, 'manifest contains a repository-relative state mount'],
  [/env_file:\s*(?:\n\s*-\s*)?\.\/\.env/, 'manifest depends on a repository .env file'],
  [/(?:0\.0\.0\.0|\[::\]):(?:\$\{[^}]+\}|[0-9]+):[0-9]+/, 'manifest binds a published port to a wildcard address'],
];

const serviceImages = new Map([
  ['broadcast', 'ghcr.io/obiwancanoweme/subwave-broadcast:${SUBWAVE_VERSION:?required}'],
  ['controller', 'ghcr.io/obiwancanoweme/subwave-controller:${SUBWAVE_VERSION:?required}'],
  ['docker-socket-proxy', 'ghcr.io/tecnativa/docker-socket-proxy:0.3.0'],
  ['web', 'ghcr.io/obiwancanoweme/subwave-web:${SUBWAVE_VERSION:?required}'],
  ['tts-heavy', 'ghcr.io/obiwancanoweme/subwave-tts-heavy:${SUBWAVE_VERSION:?required}'],
  ['analyzer', 'ghcr.io/obiwancanoweme/subwave-analyzer${ANALYZER_HEAVY:+-heavy}:${SUBWAVE_VERSION:?required}'],
]);

const approvedPorts = [
  '10.20.0.9:${WEB_PORT:-7700}:7700',
  '[2600:1700:3210:5314:10:20:0:9]:${WEB_PORT:-7700}:7700',
  '10.20.0.9:${CONTROLLER_PORT:-7701}:7701',
  '[2600:1700:3210:5314:10:20:0:9]:${CONTROLLER_PORT:-7701}:7701',
  '10.20.0.9:${ICECAST_PORT:-7702}:7702',
  '[2600:1700:3210:5314:10:20:0:9]:${ICECAST_PORT:-7702}:7702',
];

const servicePorts = new Map([
  ['web', approvedPorts.slice(0, 2)],
  ['controller', approvedPorts.slice(2, 4)],
  ['broadcast', approvedPorts.slice(4, 6)],
]);

const serviceRequirements = [
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

function publishedPorts(blocks) {
  const ports = new Map();
  for (const [service, block] of blocks) {
    const serviceEntries = [];
    const lines = block.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      if (!/^    ports:\s*$/.test(lines[index])) continue;
      for (index += 1; index < lines.length && !/^    \S/.test(lines[index]); index += 1) {
        const entry = lines[index].match(/^\s*-\s*(.+?)\s*$/);
        if (entry) serviceEntries.push(entry[1].replace(/^(['"])(.*)\1$/, '$2'));
      }
      index -= 1;
    }
    ports.set(service, serviceEntries);
  }
  return ports;
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
  for (const volume of ['tts-heavy-chatterbox-cache', 'tts-heavy-pocket-cache', 'analyzer-cache']) {
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

  const portsByService = publishedPorts(blocks);
  const ports = [...portsByService.values()].flat();
  for (const port of ports) {
    if (!approvedPorts.includes(port)) errors.push(`manifest contains an unapproved published port ${port}`);
  }
  for (const [service, expectedPorts] of servicePorts) {
    const actualPorts = portsByService.get(service) ?? [];
    for (const port of expectedPorts) {
      if (!actualPorts.includes(port)) errors.push(`service ${service} is missing published port ${port}`);
    }
  }
  for (const port of approvedPorts) {
    if (ports.filter((candidate) => candidate === port).length !== 1) errors.push(`manifest is missing published port ${port}`);
  }
  return errors;
}

async function main() {
  const file = process.argv[2] ?? 'deploy/portainer/docker-compose.yml';
  const errors = validatePortainerCompose(await readFile(file, 'utf8'));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`validated ${file}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

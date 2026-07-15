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

const required = [
  '/mnt/NVMe/container-data/subwave/state:/var/sub-wave',
  '10.20.0.9:${WEB_PORT:-7700}:7700',
  '[2600:1700:3210:5314:10:20:0:9]:${WEB_PORT:-7700}:7700',
  '10.20.0.9:${CONTROLLER_PORT:-7701}:7701',
  '[2600:1700:3210:5314:10:20:0:9]:${CONTROLLER_PORT:-7701}:7701',
  '10.20.0.9:${ICECAST_PORT:-7702}:7702',
  '[2600:1700:3210:5314:10:20:0:9]:${ICECAST_PORT:-7702}:7702',
  'ghcr.io/obiwancanoweme/subwave-broadcast:${SUBWAVE_VERSION:?required}',
  'ghcr.io/obiwancanoweme/subwave-controller:${SUBWAVE_VERSION:?required}',
  'ghcr.io/obiwancanoweme/subwave-web:${SUBWAVE_VERSION:?required}',
];

export function validatePortainerCompose(source) {
  const errors = rules.filter(([pattern]) => pattern.test(source)).map(([, message]) => message);
  for (const value of required) if (!source.includes(value)) errors.push(`manifest is missing ${value}`);
  return errors;
}

async function main() {
  const file = process.argv[2] ?? 'deploy/portainer/docker-compose.yml';
  const errors = validatePortainerCompose(await readFile(file, 'utf8'));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`validated ${file}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

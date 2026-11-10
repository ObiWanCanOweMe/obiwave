// Compose must give hosted controller rules and server-rendered admin pages
// the same opt-in flag without enabling hosted mode for existing installs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

const HOSTED_VARS = [
  'SUBWAVE_HOSTED',
  'SUBWAVE_MAX_BITRATE',
  'SUBWAVE_LISTENER_CAP',
  'SUBWAVE_MUSIC_UPLOAD_URL',
  'SUBWAVE_MUSIC_LIBRARY_URL',
];
const read = (name: string) => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');

for (const file of ['docker-compose.yml', 'docker-compose.byo.yml']) {
  test(`${file}: hosted values reach web with empty defaults and controller via root env`, () => {
    const { services } = parse(read(file));
    for (const name of HOSTED_VARS) {
      assert.ok(services.web.environment.includes(`${name}=\${${name}:-}`), name);
    }
    assert.ok(services.controller.env_file.some((entry: string | { path: string }) =>
      (typeof entry === 'string' ? entry : entry.path) === './.env'));
  });
}

test('the example and protected Portainer deployment keep hosted mode off', () => {
  const example = read('.env.example');
  const deployed = parse(read('deploy/portainer/docker-compose.yml'));
  for (const name of HOSTED_VARS) {
    assert.doesNotMatch(example, new RegExp(`^${name}=`, 'm'));
  }
  for (const name of ['web', 'controller']) {
    const env = deployed.services[name].environment;
    const entries = Array.isArray(env) ? env : Object.entries(env).map(([key, value]) => `${key}=${value}`);
    assert.ok(!entries.some((entry: string) => entry.startsWith('SUBWAVE_HOSTED=')));
  }
});

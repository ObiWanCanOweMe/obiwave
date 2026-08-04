import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

async function json(path) {
  return JSON.parse(await text(path));
}

function lockVersions(lock, packageName) {
  const suffix = `/node_modules/${packageName}`;
  return Object.entries(lock.packages)
    .filter(([path]) => path === `node_modules/${packageName}` || path.endsWith(suffix))
    .map(([, metadata]) => metadata.version)
    .filter(Boolean);
}

function atLeast(actual, expected) {
  const left = actual.split(/[.-]/).map(Number);
  const right = expected.split(/[.-]/).map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}

test('Caddy is rebuilt with the scanner-backed fixed Go and module versions', async () => {
  for (const path of ['docker/Dockerfile.caddy', 'docker/Dockerfile.aio']) {
    const dockerfile = await text(path);
    assert.match(dockerfile, /golang:1\.26\.5-alpine/);
    assert.match(dockerfile, /github\.com\/caddyserver\/caddy\/v2\/cmd\/caddy@v2\.11\.4/);
    assert.match(dockerfile, /golang\.org\/x\/text@v0\.39\.0/);
    assert.match(dockerfile, /google\.golang\.org\/grpc@v1\.82\.1/);
  }
});

test('runtime images install current distribution security updates', async () => {
  for (const path of [
    'docker/Dockerfile.broadcast',
    'docker/Dockerfile.controller',
    'docker/Dockerfile.aio',
    'docker/Dockerfile.tts-heavy',
    'docker/Dockerfile.analyzer',
    'web/Dockerfile',
  ]) {
    assert.match(await text(path), /apt-get upgrade -y/, `${path} must upgrade its runtime OS packages`);
  }
  assert.match(await text('docker/Dockerfile.caddy'), /apk upgrade --no-cache/);
});

test('runtime Node images do not retain the package manager toolchain', async () => {
  for (const path of ['docker/Dockerfile.controller', 'docker/Dockerfile.aio', 'web/Dockerfile']) {
    const dockerfile = await text(path);
    assert.match(dockerfile, /rm -rf \/usr\/local\/lib\/node_modules\/npm/);
    assert.match(dockerfile, /rm -f \/usr\/local\/bin\/npm \/usr\/local\/bin\/npx/);
  }
});

test('controller production dependency locks meet the scanner fixed versions', async () => {
  const manifest = await json('controller/package.json');
  const lock = await json('controller/package-lock.json');
  assert.equal(manifest.dependencies['adm-zip'], '^0.6.0');
  assert.ok(lockVersions(lock, 'adm-zip').every((version) => atLeast(version, '0.6.0')));
  assert.ok(lockVersions(lock, 'fast-uri').every((version) => atLeast(version, '3.1.5')));
  assert.ok(lockVersions(lock, 'ip-address').every((version) => atLeast(version, '10.3.1')));
});

test('web dependency locks pull the Next release with fixed Sharp', async () => {
  const manifest = await json('web/package.json');
  const lock = await json('web/package-lock.json');
  assert.equal(manifest.dependencies.next, '^16.3.0');
  assert.equal(manifest.dependencies['@next/third-parties'], '^16.3.0');
  assert.ok(lockVersions(lock, 'sharp').every((version) => atLeast(version, '0.35.0')));
});

test('web font imports exist in the installed Next Google-font catalog', async () => {
  const layout = await text('web/app/layout.tsx');
  const fontData = await json('web/node_modules/next/dist/compiled/@next/font/dist/google/font-data.json');
  const imports = layout.match(/import \{ ([^}]+) \} from 'next\/font\/google';/)?.[1]
    .split(',')
    .map((name) => name.trim());

  assert.ok(imports?.length, 'layout must expose its next/font/google imports');
  for (const fontFunction of imports) {
    const family = fontFunction.replaceAll('_', ' ');
    assert.ok(fontData[family], `${fontFunction} must map to a current Next Google-font family`);
  }
});

test('Python runtime environments force fixed packaging and msgpack versions', async () => {
  for (const path of ['docker/Dockerfile.analyzer', 'docker/Dockerfile.aio']) {
    const dockerfile = await text(path);
    assert.match(dockerfile, /setuptools==83\.0\.0/);
    assert.match(dockerfile, /wheel==0\.47\.0/);
    assert.match(dockerfile, /msgpack==1\.2\.1/);
  }

  const tts = await text('docker/Dockerfile.tts-heavy');
  assert.match(tts, /setuptools==83\.0\.0/);
  assert.match(tts, /wheel==0\.47\.0/);
  assert.match(tts, /msgpack==1\.2\.1/);
  assert.match(tts, /setuptools==80\.10\.2/, 'Chatterbox retains its documented pkg_resources cap');
});

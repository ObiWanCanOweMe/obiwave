import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const ci = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const webPackage = JSON.parse(
  await readFile(new URL('../../web/package.json', import.meta.url), 'utf8'),
);
const webLock = JSON.parse(
  await readFile(new URL('../../web/package-lock.json', import.meta.url), 'utf8'),
);
const publish = await readFile(new URL('../../.github/workflows/publish-images.yml', import.meta.url), 'utf8');
const scan = await readFile(new URL('../../.github/workflows/scan-images.yml', import.meta.url), 'utf8');
const cutRelease = await readFile(
  new URL('../../.github/workflows/cut-fork-release.yml', import.meta.url),
  'utf8',
);
const verifyCliAssets = await readFile(
  new URL('../../.github/workflows/verify-cli-assets.yml', import.meta.url),
  'utf8',
);
const analyzerPythonWrapper = await readFile(
  new URL('../../controller/scripts/analyzer-python.test.ts', import.meta.url),
  'utf8',
);
const caddyfiles = await Promise.all(
  ['../../docker/Caddyfile', '../../docker/aio/Caddyfile'].map((file) =>
    readFile(new URL(file, import.meta.url), 'utf8'),
  ),
);
const workflowDirectory = new URL('../../.github/workflows/', import.meta.url);

test('Caddy owns the listener-auth namespace before the general API proxy', () => {
  for (const caddyfile of caddyfiles) {
    const listenerMatcher = '@listener_auth_internal path /api/listener-auth /api/listener-auth/*';
    const listenerMatcherIndex = caddyfile.indexOf(listenerMatcher);
    const apiProxyIndex = caddyfile.indexOf('handle_path /api/*');

    assert.ok(listenerMatcherIndex >= 0, 'missing listener-auth namespace matcher');
    assert.ok(apiProxyIndex > listenerMatcherIndex, 'listener-auth matcher must precede the general API proxy');
  }
});

test('official JavaScript actions use the Node 24 runtime', async () => {
  const workflowFiles = (await readdir(workflowDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.yml'))
    .map((entry) => entry.name)
    .sort();

  for (const workflowFile of workflowFiles) {
    const workflow = await readFile(new URL(workflowFile, workflowDirectory), 'utf8');
    assert.doesNotMatch(workflow, /actions\/checkout@v4/, workflowFile);
    assert.doesNotMatch(workflow, /actions\/setup-node@v4/, workflowFile);
    assert.doesNotMatch(workflow, /docker\/setup-buildx-action@v3/, workflowFile);
    assert.doesNotMatch(workflow, /docker\/build-push-action@v6/, workflowFile);
    assert.doesNotMatch(workflow, /docker\/login-action@v3/, workflowFile);
    assert.doesNotMatch(workflow, /docker\/setup-qemu-action@v3/, workflowFile);
  }
});

test('CI remains unfiltered and reusable while sparing tag runs from cancellation', () => {
  assert.match(ci, /on:\s*\n\s+pull_request:\s*\n\s+push:\s*\n\s+workflow_call:/);
  assert.match(ci, /cancel-in-progress:.*pull_request.*refs\/tags/);
});

test('consolidated CI verifies the generated theme-token mirror', () => {
  assert.match(ci, /if: matrix\.package == 'controller'[\s\S]*npm run gen:themes/);
  assert.match(ci, /git diff --exit-code \.\.\/web\/lib\/theme-tokens\.generated\.ts/);
});

test('controller quality provisions the pinned NumPy prerequisite for vocal-gate tests', () => {
  const dependencyStep = ci.slice(
    ci.indexOf('      - name: Install analyzer Python test dependencies'),
    ci.indexOf('      - run: ${{ matrix.command }}'),
  );
  assert.ok(dependencyStep, 'missing analyzer Python dependency step before the quality command');
  assert.match(dependencyStep, /if: matrix\.package == 'controller'/);
  assert.match(dependencyStep, /python3 -m venv \.venv-analyzer-tests/);
  assert.match(
    dependencyStep,
    /\.venv-analyzer-tests\/bin\/python -m pip install .*numpy==2\.2\.6/,
  );
  assert.match(dependencyStep, /\.venv-analyzer-tests\/bin.*GITHUB_PATH/);
  assert.match(analyzerPythonWrapper, /'vocal_gate_test\.py'/, 'vocal gate must remain in npm test');
});

test('controller image smoke executes the production child command inside the built image', () => {
  const imageSmoke = ci.slice(ci.indexOf('  image-smoke:'));
  assert.match(imageSmoke, /tags: subwave-ci-\$\{\{ matrix\.image \}\}:test/);
  assert.match(imageSmoke, /load: true/);
  assert.match(
    imageSmoke,
    /if: matrix\.image == 'controller'[\s\S]*docker run --rm[\s\S]*test ! -e \/usr\/local\/bin\/npm[\s\S]*test ! -e \/usr\/local\/bin\/npx[\s\S]*\/app\/node_modules\/\.bin\/tsx scripts\/production-command\.test\.ts/,
  );
});

test('app quality matrix runs the native stream-buffer contract', () => {
  const appCommand = ci.match(/- package: app\s*\n\s+command: ([^\n]+)/)?.[1];
  assert.ok(appCommand, 'missing app quality-matrix command');
  assert.match(appCommand, /(?:^|&& )npm run test:stream-buffer-format(?: &&|$)/);
});

test('web quality runs the complete mounted state suite with its locked local runner', () => {
  const webCommand = ci.match(/- package: web\s*\n\s+command: ([^\n]+)/)?.[1];
  assert.ok(webCommand, 'missing web quality-matrix command');
  assert.match(webCommand, /(?:^|&& )npm run test:mounted-state(?: &&|$)/);

  const aggregate = webPackage.scripts?.['test:mounted-state'];
  assert.equal(typeof aggregate, 'string', 'missing aggregate mounted-state package script');
  for (const script of [
    'test:onboarding-provider-state',
    'test:tts-secret-state',
    'test:library-liked-state',
    'test:archive-error-state',
  ]) {
    assert.match(aggregate, new RegExp(`(?:^|&& )npm run ${script}(?: &&|$)`), `${script} is outside the aggregate suite`);
  }

  assert.equal(
    webPackage.scripts['test:onboarding-provider-state'],
    'tsx scripts/onboarding-provider-state.test.ts',
  );
  assert.equal(webPackage.scripts['test:tts-secret-state'], 'tsx scripts/tts-secret-state.test.ts');
  assert.equal(webPackage.scripts['test:library-liked-state'], 'tsx scripts/library-liked-state.test.ts');
  assert.equal(webPackage.scripts['test:archive-error-state'], 'tsx scripts/archive-error-state.test.ts');
  assert.equal(typeof webPackage.devDependencies?.tsx, 'string', 'tsx must be declared as a web dev dependency');
  assert.equal(typeof webLock.packages?.['node_modules/tsx']?.version, 'string', 'tsx must be installed in the web lockfile');
});

test('CUDA analyzer is mirrored, never rebuilt', () => {
  assert.match(publish, /mirror-cuda-analyzer:/);
  assert.match(
    publish,
    /RELEASE_TAG: \$\{\{ github\.ref_name \}\}[\s\S]*node scripts\/release\/mirror-cuda-analyzer\.mjs/,
  );
  const buildMatrix = publish.slice(
    publish.indexOf('  build:'),
    publish.indexOf('    steps:', publish.indexOf('  build:')),
  );
  assert.doesNotMatch(buildMatrix, /subwave-analyzer-cuda/);
});

test('reusable CI deployment gate runs the CUDA mirror helper contract', () => {
  const deploymentCommand = ci.match(
    /- name: Run deployment contract tests\s*\n\s+run: ([^\n]+)/,
  )?.[1];
  assert.ok(deploymentCommand, 'missing reusable deployment-contract test command');
  assert.match(
    deploymentCommand,
    /(?:^| )scripts\/release\/mirror-cuda-analyzer\.test\.mjs(?: |$)/,
  );
});

test('CUDA mirror is preflighted, scanned, and gates deployment', () => {
  assert.match(publish, /tag-preflight:[\s\S]*- subwave-analyzer-cuda/);
  assert.match(publish, /vulnerability-policy:[\s\S]*needs: \[validate, release-gate, tag-preflight, build, mirror-cuda-analyzer\]/);
  assert.match(publish, /deploy-production:[\s\S]*needs: \[validate, release-gate, tag-preflight, build, mirror-cuda-analyzer, vulnerability-policy\]/);
  assert.match(scan, /matrix:[\s\S]*- subwave-analyzer-cuda/);
});

test('CLI asset drift watches the analyzer GPU overlay', () => {
  assert.match(verifyCliAssets, /docker-compose\.analyzer-gpu\.yml/);
});

test('release publication waits for the reusable CI gate', () => {
  assert.match(publish, /release-gate:\s*\n\s+uses: \.\/\.github\/workflows\/ci\.yml/);
  assert.match(publish, /build:\s*\n\s+needs: \[validate, release-gate, tag-preflight\]/);
  assert.match(publish, /vulnerability-policy:\s*\n\s+needs: \[validate, release-gate, tag-preflight, build, mirror-cuda-analyzer\]/);
  assert.match(publish, /deploy-production:\s*\n\s+needs: \[validate, release-gate, tag-preflight, build, mirror-cuda-analyzer, vulnerability-policy\]/);
});

test('publication grants package access only to jobs that need it', () => {
  const workflowPermissions = publish.slice(
    publish.indexOf('\npermissions:'),
    publish.indexOf('\nconcurrency:'),
  );
  const preflight = publish.slice(
    publish.indexOf('  tag-preflight:'),
    publish.indexOf('  mirror-cuda-analyzer:'),
  );
  const mirror = publish.slice(
    publish.indexOf('  mirror-cuda-analyzer:'),
    publish.indexOf('  build:'),
  );
  const build = publish.slice(
    publish.indexOf('  build:'),
    publish.indexOf('  vulnerability-policy:'),
  );

  assert.match(workflowPermissions, /^\npermissions:\n  contents: read\n$/);
  assert.match(preflight, /permissions:\n      contents: read\n      packages: read/);
  assert.match(mirror, /permissions:\n      contents: read\n      packages: write/);
  assert.match(build, /permissions:\n      contents: read\n      packages: write/);
});

test('release tag concurrency never cancels an in-flight publication', () => {
  assert.match(publish, /concurrency:\s*\n\s+group: publish-images-\$\{\{ github\.ref_name \}\}\s*\n\s+cancel-in-progress: false/);
});

test('all ten exact tags pass a complete preflight before any build starts', () => {
  const preflightStart = publish.indexOf('  tag-preflight:');
  const buildStart = publish.indexOf('  build:');
  const scanStart = publish.indexOf('  vulnerability-policy:');
  assert.ok(preflightStart >= 0 && buildStart > preflightStart && scanStart > buildStart);

  const preflight = publish.slice(preflightStart, buildStart);
  const build = publish.slice(buildStart, scanStart);
  const matrix = preflight.match(/matrix:\n\s+image:\n((?:\s+- [^\n]+\n)+)/)?.[1];
  assert.ok(matrix, 'missing tag-preflight image matrix');
  const images = [...matrix.matchAll(/^\s+- ([^\n]+)$/gm)].map(([, image]) => image);
  assert.deepEqual(images, [
    'subwave-caddy',
    'subwave-broadcast',
    'subwave-controller',
    'subwave-web',
    'subwave-aio',
    'subwave-aio-heavy',
    'subwave-tts-heavy',
    'subwave-analyzer',
    'subwave-analyzer-heavy',
    'subwave-analyzer-cuda',
  ]);
  assert.match(preflight, /uses: docker\/login-action@v4[\s\S]*node scripts\/ci\/assert-image-tag-absent\.mjs/);
  assert.doesNotMatch(build, /assert-image-tag-absent/);
});

test('private image scans authenticate with package read permission', () => {
  assert.match(publish, /vulnerability-policy:[\s\S]*?permissions:[\s\S]*?packages: read/);
  assert.match(scan, /permissions:[\s\S]*?packages: read/);
  assert.match(scan, /scan:[\s\S]*?uses: docker\/login-action@v4[\s\S]*?uses: aquasecurity\/trivy-action/);
});

test('image scans pin Trivy to the reviewed immutable release commit', () => {
  assert.doesNotMatch(scan, /aquasecurity\/trivy-action@0\.28\.0/);
  assert.match(
    scan,
    /uses: aquasecurity\/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0\.36\.0/,
  );
  assert.match(scan, /version: v0\.67\.2/);
});

test('image vulnerability policy scans and aggregates the exact ten-image matrix', () => {
  const scanJob = scan.slice(scan.indexOf('  scan:'), scan.indexOf('  vulnerability-policy:'));
  const matrix = scanJob.match(/matrix:\n\s+image:\n((?:\s+- [^\n]+\n)+)/)?.[1];
  assert.ok(matrix, 'missing scan image matrix');
  const images = [...matrix.matchAll(/^\s+- ([^\n]+)$/gm)].map(([, image]) => image);
  assert.deepEqual(images, [
    'subwave-caddy',
    'subwave-broadcast',
    'subwave-controller',
    'subwave-web',
    'subwave-aio',
    'subwave-aio-heavy',
    'subwave-tts-heavy',
    'subwave-analyzer',
    'subwave-analyzer-heavy',
    'subwave-analyzer-cuda',
  ]);

  assert.match(scanJob, /format: json/);
  assert.match(scanJob, /output: \$\{\{ matrix\.image \}\}\.json/);
  assert.match(scanJob, /name: trivy-json-\$\{\{ matrix\.image \}\}/);
  assert.match(scanJob, /format: sarif/);
  assert.match(scanJob, /Upload SARIF[\s\S]*if: always\(\)/);

  const policyJob = scan.slice(scan.indexOf('  vulnerability-policy:'));
  assert.match(policyJob, /needs: \[resolve-tag, scan\]/);
  assert.match(policyJob, /if: always\(\)/);
  assert.match(policyJob, /pattern: trivy-json-\*/);
  assert.match(policyJob, /merge-multiple: true/);
  assert.match(policyJob, /node scripts\/security\/trivy-policy\.mjs/);
  assert.match(policyJob, /security\/trivy-acceptance\.json/);
});

test('release scans exercise production child commands in controller and both AIO images', () => {
  const scanJob = scan.slice(scan.indexOf('  scan:'), scan.indexOf('  vulnerability-policy:'));
  assert.match(
    scanJob,
    /if: contains\(fromJSON\('\["subwave-controller","subwave-aio","subwave-aio-heavy"\]'\), matrix\.image\)/,
  );
  assert.match(
    scanJob,
    /docker run --rm --entrypoint \/bin\/sh[\s\S]*ghcr\.io\/obiwancanoweme\/\$\{\{ matrix\.image \}\}:\$\{\{ needs\.resolve-tag\.outputs\.tag \}\}/,
  );
  assert.match(scanJob, /test ! -e \/usr\/local\/bin\/npm/);
  assert.match(scanJob, /test ! -e \/usr\/local\/bin\/npx/);
  assert.match(scanJob, /\/app\/node_modules\/\.bin\/tsx scripts\/production-command\.test\.ts/);
});

test('report-only scanner exit codes are backed by fail-closed aggregate enforcement', () => {
  assert.match(scan, /exit-code: "0"/);
  assert.match(scan, /steps\.json-scan\.outcome/);
  assert.match(scan, /outcome: succeeded \? 'success' : 'failure'/);
  assert.match(scan, /vulnerability-policy:[\s\S]*node scripts\/security\/trivy-policy\.mjs/);
});

test('production timeout covers bounded target and rollback operations', () => {
  assert.match(publish, /deploy-production:[\s\S]*?timeout-minutes: 30/);
});

test('fork release defaults to the fork release branch', () => {
  assert.match(
    cutRelease,
    /target:\s*[\s\S]*?description: Branch, tag, or commit to release[\s\S]*?default: develop/,
  );
});

test('fork release fetches only the requested canonical upstream tag before validation', () => {
  const fetchTag =
    'git fetch --no-tags https://github.com/perminder-klair/subwave.git "refs/tags/${BASE_TAG}:refs/tags/${BASE_TAG}"';
  const fetchIndex = cutRelease.indexOf(fetchTag);
  const validationIndex = cutRelease.indexOf(
    'git rev-parse --verify "refs/tags/${BASE_TAG}^{commit}"',
  );

  assert.ok(fetchIndex >= 0, 'missing exact canonical upstream tag fetch');
  assert.ok(validationIndex > fetchIndex, 'base tag must be fetched before it is validated');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ci = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const webPackage = JSON.parse(
  await readFile(new URL('../../web/package.json', import.meta.url), 'utf8'),
);
const webLock = JSON.parse(
  await readFile(new URL('../../web/package-lock.json', import.meta.url), 'utf8'),
);
const publish = await readFile(new URL('../../.github/workflows/publish-images.yml', import.meta.url), 'utf8');
const scan = await readFile(new URL('../../.github/workflows/scan-images.yml', import.meta.url), 'utf8');
const recoveryV13 = await readFile(
  new URL('../../.github/workflows/recover-v1.3.0-obiwave.2.yml', import.meta.url),
  'utf8',
);
const recoveryV15 = await readFile(
  new URL('../../.github/workflows/recover-v1.5.0-obiwave.1.yml', import.meta.url),
  'utf8',
).catch(() => '');
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

function jobBlock(workflow, jobName) {
  const match = workflow.match(
    new RegExp(`^  ${jobName}:\\n([\\s\\S]*?)(?=^  [A-Za-z0-9_-]+:\\n|(?![\\s\\S]))`, 'm'),
  );
  assert.ok(match, `missing ${jobName} job`);
  return match[1];
}

function jobNeeds(job) {
  const match = job.match(/^    needs: \[([^\]]*)\]$/m);
  assert.ok(match, 'missing job needs');
  return match[1].split(',').map((name) => name.trim());
}

function jobScalar(job, key) {
  const match = job.match(new RegExp(`^    ${key}: ([^\\n#]+?)\\s*$`, 'm'));
  assert.ok(match, `missing ${key}`);
  return match[1];
}

function yamlScalar(value) {
  const scalar = value.trim().replace(/\s+#.*$/, '');
  if ((scalar.startsWith('"') && scalar.endsWith('"')) || (scalar.startsWith("'") && scalar.endsWith("'"))) {
    return scalar.slice(1, -1);
  }
  return scalar;
}

function permissionDeclarations(workflow) {
  return workflow.split('\n').flatMap((line, lineNumber) => {
    const match = line.match(/^(\s*)(?:permissions|"permissions"|'permissions')\s*:(.*)$/);
    return match ? [{ indent: match[1].length, inlineValue: match[2], lineNumber }] : [];
  });
}

function assertRecoveryPermissionForms(workflow) {
  for (const declaration of permissionDeclarations(workflow)) {
    assert.equal(declaration.inlineValue.trim(), '', 'permissions must use block form');
  }
}

function permissionEntries(workflow) {
  const lines = workflow.split('\n');
  const entries = [];
  for (const declaration of permissionDeclarations(workflow)) {
    for (let lineNumber = declaration.lineNumber + 1; lineNumber < lines.length; lineNumber += 1) {
      const line = lines[lineNumber];
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const indent = line.match(/^\s*/)[0].length;
      if (indent <= declaration.indent) break;
      const entry = line.match(/^\s*((?:"[^"]*"|'[^']*'|[^:\s]+))\s*:\s*(.*?)\s*$/);
      if (entry) entries.push({ key: yamlScalar(entry[1]), value: yamlScalar(entry[2]) });
    }
  }
  return entries;
}

function assertRecoveryPermissions(workflow) {
  assertRecoveryPermissionForms(workflow);
  assert.deepEqual(
    permissionEntries(workflow)
      .filter(({ value }) => value === 'write')
      .map(({ key }) => key),
    ['security-events'],
    'unexpected write permissions',
  );
}

function assertNoJobEnv(job) {
  assert.doesNotMatch(job, /^    (?:env|"env"|'env')\s*:/m, 'deploy environment must be step-scoped');
}

function stepBlock(job, stepName) {
  const match = job.match(
    new RegExp(`^      - name: ${stepName}\\n([\\s\\S]*?)(?=^      - |(?![\\s\\S]))`, 'm'),
  );
  assert.ok(match, `missing ${stepName} step`);
  return match[1];
}

function stepEnv(step) {
  const match = step.match(/^        env:\n((?:          [^\n]+\n?)*)/m);
  assert.ok(match, 'missing step environment');
  return Object.fromEntries(
    [...match[1].matchAll(/^          ([A-Z0-9_]+): ([^\n]+)$/gm)].map(([, key, value]) => [key, value]),
  );
}

function stepRun(job, stepName) {
  const lines = job.split('\n');
  const stepIndex = lines.findIndex((line) => line === `      - name: ${stepName}`);
  assert.notEqual(stepIndex, -1, `missing ${stepName} step`);
  const runIndex = lines.findIndex((line, index) => index > stepIndex && line === '        run: |');
  assert.notEqual(runIndex, -1, `missing ${stepName} run block`);
  const script = [];
  for (const line of lines.slice(runIndex + 1)) {
    if (line === '') {
      script.push('');
      continue;
    }
    const indent = line.match(/^ */)[0].length;
    if (indent <= 8) break;
    assert.ok(indent >= 10, `invalid ${stepName} run indentation`);
    script.push(line.slice(10));
  }
  return `${script.join('\n')}\n`;
}

function assertRecoveryWorkflow(workflow, { tag, manifest }) {
  assert.match(workflow, /^on:\n  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /workflow_dispatch:[\s\S]*?inputs:/);

  const defaultPermissions = workflow.match(/^permissions:\n((?:  [^\n]+\n?)*)/m)?.[1];
  assert.ok(defaultPermissions, 'missing default workflow permissions');
  assert.match(defaultPermissions, /^  contents: read$/m);
  assertRecoveryPermissions(workflow);
  assert.match(
    workflow,
    new RegExp(`^concurrency:\\n  group: recover-${tag.replaceAll('.', '\\.')}\\n  cancel-in-progress: false$`, 'm'),
  );

  const validate = jobBlock(workflow, 'validate');
  const policy = jobBlock(workflow, 'vulnerability-policy');
  const deploy = jobBlock(workflow, 'deploy-production');
  assert.match(validate, /^    permissions:\n      contents: read\n      packages: read$/m);
  assert.deepEqual(jobNeeds(policy), ['validate']);
  assert.match(policy, /^    uses: \.\/\.github\/workflows\/scan-images\.yml$/m);
  assert.match(policy, new RegExp(`release_tag: ${tag.replaceAll('.', '\\.')}\\n`));
  assert.match(policy, new RegExp(`recovery_manifest: ${manifest.replaceAll('.', '\\.')}\\n`));
  assert.match(
    policy,
    /^    permissions:\n      contents: read\n      packages: read\n      security-events: write$/m,
  );
  assert.deepEqual(jobNeeds(deploy), ['validate', 'vulnerability-policy']);
  assert.equal(jobScalar(deploy, 'environment'), 'production');
  assert.match(
    deploy,
    /^    concurrency:\n      group: subwave-production\n      cancel-in-progress: false$/m,
  );
  assert.equal(jobScalar(deploy, 'timeout-minutes'), '30');
  assertNoJobEnv(deploy);
  const deployStep = stepBlock(deploy, 'Deploy immutable release through Portainer');
  assert.deepEqual(stepEnv(deployStep), {
    PORTAINER_URL: '${{ vars.PORTAINER_URL }}',
    PORTAINER_API_KEY: '${{ secrets.PORTAINER_API_KEY }}',
    PORTAINER_STACK_ID: '${{ vars.PORTAINER_STACK_ID }}',
    PORTAINER_ENDPOINT_ID: '${{ vars.PORTAINER_ENDPOINT_ID }}',
    SUBWAVE_RELEASE_TAG: tag,
    SUBWAVE_HEALTH_URL: '${{ vars.SUBWAVE_HEALTH_URL }}',
    SUBWAVE_STREAM_URL: '${{ vars.SUBWAVE_STREAM_URL }}',
    SUBWAVE_STREAM_PASSWORD: '${{ secrets.SUBWAVE_STREAM_PASSWORD }}',
  });
  assert.deepEqual(
    [...deploy.matchAll(/^\s+run: ([^\n]+)$/gm)].map(([, command]) => command),
    ['node scripts/deploy/portainer-release.mjs'],
  );
  assert.doesNotMatch(workflow, /\b(?:docker\s+(?:build|push|tag)|gh\s+release\s+create)\b/);
}

test('Caddy owns the listener-auth namespace before the general API proxy', () => {
  for (const caddyfile of caddyfiles) {
    const listenerMatcher = '@listener_auth_internal path /api/listener-auth /api/listener-auth/*';
    const listenerMatcherIndex = caddyfile.indexOf(listenerMatcher);
    const apiProxyIndex = caddyfile.indexOf('handle_path /api/*');

    assert.ok(listenerMatcherIndex >= 0, 'missing listener-auth namespace matcher');
    assert.ok(apiProxyIndex > listenerMatcherIndex, 'listener-auth matcher must precede the general API proxy');
  }
});

test('recovery contract rejects alternate permission and deploy-environment forms', () => {
  for (const recovery of [recoveryV13, recoveryV15]) {
    for (const [mutation, expected] of [
      [recovery.replace('permissions:\n  contents: read', 'permissions: write-all'), /block form/],
      [recovery.replace('permissions:\n  contents: read', 'permissions: {contents: read}'), /block form/],
      [
        recovery.replace(
          '  deploy-production:',
          '  permission-mutation:\n    "permissions": "write-all"\n  deploy-production:',
        ),
        /block form/,
      ],
      [
        recovery.replace(
          '  deploy-production:',
          '  permission-mutation:\n    permissions:\n      actions: "write"\n  deploy-production:',
        ),
        /unexpected write permissions/,
      ],
    ]) {
      assert.throws(() => assertRecoveryPermissions(mutation), expected);
    }

    const deploy = jobBlock(recovery, 'deploy-production');
    for (const mutation of [
      `${deploy.replace('    environment: production', '    env: inherited\n    environment: production')}`,
      `${deploy.replace('    environment: production', '    env: {PORTAINER_URL: leaked}\n    environment: production')}`,
      `${deploy.replace('    environment: production', '    "env": {PORTAINER_URL: leaked}\n    environment: production')}`,
    ]) {
      assert.throws(() => assertNoJobEnv(mutation), /deploy environment must be step-scoped/);
    }
  }
});

test('both one-release recoveries are fixed-identity, policy-gated, and protected', () => {
  assertRecoveryWorkflow(recoveryV13, {
    tag: 'v1.3.0-obiwave.2',
    manifest: 'security/releases/v1.3.0-obiwave.2.json',
  });
  assertRecoveryWorkflow(recoveryV15, {
    tag: 'v1.5.0-obiwave.1',
    manifest: 'security/releases/v1.5.0-obiwave.1.json',
  });
});

test('both recovery contracts reject identity, authorization, and deployment-gate mutations', () => {
  for (const [workflow, identity] of [
    [recoveryV13, {
      tag: 'v1.3.0-obiwave.2',
      manifest: 'security/releases/v1.3.0-obiwave.2.json',
    }],
    [recoveryV15, {
      tag: 'v1.5.0-obiwave.1',
      manifest: 'security/releases/v1.5.0-obiwave.1.json',
    }],
  ]) {
    assertRecoveryWorkflow(workflow, identity);
    for (const mutation of [
      (value) => value.replace(/release_tag: v[^\n]+/, 'release_tag: v9.9.9-obiwave.9'),
      (value) => value.replace(/recovery_manifest: security\/releases\/[^\n]+/, 'recovery_manifest: security/releases/foreign.json'),
      (value) => `${value}\n# forbidden\n# docker push ghcr.io/example/image\n`,
      (value) => value.replace('needs: [validate, vulnerability-policy]', 'needs: [validate]'),
      (value) => value.replace('    environment: production', '    env: inherited\n    environment: production'),
      (value) => value.replace('      security-events: write', '      actions: write'),
      (value) => value.replace('    environment: production', '    environment: staging'),
    ]) {
      assert.throws(() => assertRecoveryWorkflow(mutation(workflow), identity));
    }
  }
});

test('scanner resolve-tag executes recovery validation as valid Bash', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'subwave-resolve-tag-'));
  const outputPath = join(directory, 'github-output');
  try {
    const result = spawnSync('bash', ['-e'], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      encoding: 'utf8',
      input: stepRun(jobBlock(scan, 'resolve-tag'), 'Resolve and validate release tag'),
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: 'workflow_call',
        GITHUB_OUTPUT: outputPath,
        RECOVERY_MANIFEST: 'security/releases/v1.3.0-obiwave.2.json',
        REQUESTED_TAG: 'v1.3.0-obiwave.2',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(outputPath, 'utf8'), /^tag=v1\.3\.0-obiwave\.2$/m);
  } finally {
    await rm(directory, { recursive: true, force: true });
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
  assert.match(scan, /scan:[\s\S]*?uses: docker\/login-action@v4/);
});

test('image scans invoke the local pinned scanner runner for JSON and SARIF', () => {
  const scanJob = scan.slice(scan.indexOf('  scan:'), scan.indexOf('  vulnerability-policy:'));
  assert.match(scanJob, /uses: docker\/setup-buildx-action@v4/);
  assert.match(scanJob, /node scripts\/security\/trivy-runner\.mjs[\s\S]*?--format json/);
  assert.match(scanJob, /node scripts\/security\/trivy-runner\.mjs[\s\S]*?--format sarif/);
});

test('recovery input is transferred through the environment, never interpolated into Bash', () => {
  const resolveJob = scan.slice(scan.indexOf('  resolve-tag:'), scan.indexOf('  scan:'));
  assert.match(resolveJob, /env:\s*\n\s+REQUESTED_TAG: \$\{\{ inputs\.release_tag \}\}\s*\n\s+RECOVERY_MANIFEST: \$\{\{ inputs\.recovery_manifest \}\}/);
  assert.doesNotMatch(resolveJob, /RECOVERY_MANIFEST="\$\{\{ inputs\.recovery_manifest \}\}"/);
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

  assert.match(scanJob, /name: trivy-json-\$\{\{ matrix\.image \}\}/);
  assert.match(scanJob, /Record JSON scanner status[\s\S]*?if: always\(\)/);
  assert.match(scanJob, /Upload policy JSON[\s\S]*?if: always\(\)/);
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
  const jsonRunnerIndex = scanJob.indexOf('      - name: Scan ${{ matrix.image }} for policy JSON');
  const productionProbeIndex = scanJob.indexOf('      - name: Exercise production child command');
  assert.ok(jsonRunnerIndex >= 0 && productionProbeIndex > jsonRunnerIndex, 'production probe must follow the JSON runner');
  assert.match(
    scanJob,
    /if: always\(\) && contains\(fromJSON\('\["subwave-controller","subwave-aio","subwave-aio-heavy"\]'\), matrix\.image\) && steps\.json-scan\.outcome == 'success'/,
  );
  assert.match(
    scanJob,
    /docker run --rm --entrypoint \/bin\/sh \$\{\{ steps\.refs\.outputs\.tag_ref \}\}/,
  );
  assert.match(scanJob, /test ! -e \/usr\/local\/bin\/npm/);
  assert.match(scanJob, /test ! -e \/usr\/local\/bin\/npx/);
  assert.match(scanJob, /\/app\/node_modules\/\.bin\/tsx scripts\/production-command\.test\.ts/);
});

test('image scanner outcomes remain visible to the aggregate policy gate', () => {
  assert.match(scan, /id: json-scan[\s\S]*?continue-on-error: true/);
  assert.match(scan, /Record JSON scanner status[\s\S]*?steps\.json-scan\.outcome/);
  assert.match(scan, /Upload policy JSON[\s\S]*?if: always\(\)/);
  assert.match(scan, /vulnerability-policy:\s*\n\s+needs: \[resolve-tag, scan\][\s\S]*?if: always\(\)/);
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

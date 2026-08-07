import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
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
const finalizeV16 = await readFile(
  new URL('../../.github/workflows/finalize-v1.6.0-obiwave.1.yml', import.meta.url),
  'utf8',
);
const recoveryV16 = await readFile(
  new URL('../../.github/workflows/recover-v1.6.0-obiwave.1.yml', import.meta.url),
  'utf8',
).catch(() => '');
const recoveryV16Partial = JSON.parse(await readFile(
  new URL('../../security/releases/v1.6.0-obiwave.1.partial.json', import.meta.url),
  'utf8',
));
const recoveryV16BuildDigests = Object.freeze({
  'subwave-caddy': `sha256:${'1'.repeat(64)}`,
  'subwave-web': `sha256:${'2'.repeat(64)}`,
  'subwave-aio-heavy': `sha256:${'3'.repeat(64)}`,
  'subwave-tts-heavy': `sha256:${'4'.repeat(64)}`,
  'subwave-analyzer-heavy': `sha256:${'5'.repeat(64)}`,
});
const sealedRecoveryV16 = Object.freeze({
  schemaVersion: 1,
  releaseTag: recoveryV16Partial.releaseTag,
  sourceCommit: recoveryV16Partial.sourceCommit,
  scanner: recoveryV16Partial.scanner,
  images: recoveryV16Partial.images.map((image) => Object.freeze({
    name: image.name,
    digest: image.action === 'preserve' ? image.digest : recoveryV16BuildDigests[image.name],
  })),
});
const sealedRecoveryV16B64 = Buffer.from(JSON.stringify(sealedRecoveryV16)).toString('base64');
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

function topLevelBlockLines(workflow, key) {
  const lines = workflow.split('\n');
  const keyIndexes = lines.flatMap((line, index) => line === `${key}:` ? [index] : []);
  assert.equal(keyIndexes.length, 1, `expected exactly one top-level ${key} block`);
  const [keyIndex] = keyIndexes;
  const block = [];
  for (const line of lines.slice(keyIndex + 1)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!line.startsWith(' ')) break;
    block.push(line);
  }
  return block;
}

function foldedStepCommand(step) {
  const lines = step.split('\n');
  const runIndex = lines.findIndex((line) => line === '        run: >-');
  assert.notEqual(runIndex, -1, 'missing folded step command');
  const command = [];
  for (const line of lines.slice(runIndex + 1)) {
    if (!line.trim()) continue;
    const indent = line.match(/^ */)[0].length;
    if (indent <= 8) break;
    assert.ok(indent >= 10, 'invalid folded step command indentation');
    command.push(line.trim());
  }
  assert.ok(command.length > 0, 'empty folded step command');
  return command.join(' ');
}

function recoveryJobNames(workflow) {
  return topLevelBlockLines(workflow, 'jobs')
    .filter((line) => line.match(/^  \S/))
    .map((line) => {
      const match = line.match(/^  ((?:"[^"]*"|'[^']*'|[^:\s]+))\s*:\s*$/);
      assert.ok(match, 'recovery jobs must use block mappings');
      return yamlScalar(match[1]);
    });
}

function jobStepHeaders(job) {
  return job.split('\n').flatMap((line) => {
    const match = line.match(/^      - (.+)$/);
    return match ? [match[1]] : [];
  });
}

function assertNoGatedPathBypass(job, jobName) {
  const bypassKey = '(?:if|continue-on-error|"if"|"continue-on-error"|\'if\'|\'continue-on-error\')';
  assert.doesNotMatch(
    job,
    new RegExp(`^    ${bypassKey}\\s*:`, 'm'),
    `${jobName} must not bypass its job gate`,
  );
  assert.doesNotMatch(
    job,
    new RegExp(`^        ${bypassKey}\\s*:`, 'm'),
    `${jobName} steps must fail closed`,
  );
}

const RECOVERY_V16_TAG = 'v1.6.0-obiwave.1';
const RECOVERY_V16_SOURCE = '87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787';
const RECOVERY_V16_PARTIAL = 'security/releases/v1.6.0-obiwave.1.partial.json';
const RECOVERY_V16_IMAGES = Object.freeze([
  'subwave-caddy',
  'subwave-web',
  'subwave-aio-heavy',
  'subwave-tts-heavy',
  'subwave-analyzer-heavy',
]);
const RECOVERY_WORKFLOWS = Object.freeze([
  Object.freeze({
    workflow: recoveryV13,
    tag: 'v1.3.0-obiwave.2',
    manifest: 'security/releases/v1.3.0-obiwave.2.json',
  }),
  Object.freeze({
    workflow: recoveryV15,
    tag: 'v1.5.0-obiwave.1',
    manifest: 'security/releases/v1.5.0-obiwave.1.json',
  }),
  Object.freeze({
    workflow: finalizeV16,
    tag: 'v1.6.0-obiwave.1',
    manifest: 'security/releases/v1.6.0-obiwave.1.json',
  }),
]);

function assertExactJobPermissions(job, expected) {
  const declarations = permissionDeclarations(job);
  assert.equal(declarations.length, 1, 'job must declare exactly one permissions block');
  assert.deepEqual(
    permissionEntries(job).map(({ key, value }) => [key, value]),
    Object.entries(expected),
  );
}

function assertSelectiveRecoveryV16(workflow) {
  assert.deepEqual(topLevelBlockLines(workflow, 'on'), ['  workflow_dispatch:']);
  assert.deepEqual(recoveryJobNames(workflow), [
    'validate',
    'release-gate',
    'build',
    'seal',
    'vulnerability-policy',
    'deploy-production',
  ]);
  assert.equal(
    workflow.match(/^permissions:\n((?:  [^\n]+\n?)*)/m)?.[1],
    '  contents: read\n',
  );
  assert.match(
    workflow,
    /^concurrency:\n  group: recover-v1\.6\.0-obiwave\.1\n  cancel-in-progress: false$/m,
  );
  assert.doesNotMatch(workflow, /\$\{\{\s*inputs\./);

  const validate = jobBlock(workflow, 'validate');
  const releaseGate = jobBlock(workflow, 'release-gate');
  const build = jobBlock(workflow, 'build');
  const seal = jobBlock(workflow, 'seal');
  const policy = jobBlock(workflow, 'vulnerability-policy');
  const deploy = jobBlock(workflow, 'deploy-production');

  assert.deepEqual(jobStepHeaders(validate), [
    'uses: actions/checkout@v5',
    'uses: actions/setup-node@v5',
    'uses: docker/setup-buildx-action@v4',
    'uses: docker/login-action@v4',
    'name: Verify partial recovery identity',
    'name: Prove selective build tags are absent',
  ]);
  assert.deepEqual(jobStepHeaders(releaseGate), []);
  assert.deepEqual(jobStepHeaders(build), [
    'uses: actions/checkout@v5',
    'uses: docker/setup-qemu-action@v4',
    'uses: docker/setup-buildx-action@v4',
    'uses: docker/login-action@v4',
    'name: Reconfirm immutable tag absence',
    'id: build',
    'name: Record immutable build digest',
    'name: Upload immutable build digest',
  ]);
  assert.deepEqual(jobStepHeaders(seal), [
    'uses: actions/checkout@v5',
    'uses: actions/setup-node@v5',
    'uses: docker/setup-buildx-action@v4',
    'uses: docker/login-action@v4',
    'uses: actions/download-artifact@v4',
    'id: seal',
    'name: Summarize sealed recovery manifest',
    'name: Upload sealed recovery manifest',
  ]);
  assert.deepEqual(jobStepHeaders(policy), []);
  assert.deepEqual(jobStepHeaders(deploy), [
    'uses: actions/checkout@v5',
    'uses: actions/setup-node@v5',
    'name: Deploy immutable release through Portainer',
  ]);
  assert.match(build, /^      - id: build\n        uses: docker\/build-push-action@v7$/m);
  assert.match(seal, /^      - id: seal\n        name: Seal recovery manifest\n        run: \|$/m);

  assertExactJobPermissions(validate, { contents: 'read', packages: 'read' });
  assertExactJobPermissions(build, { contents: 'read', packages: 'write' });
  assertExactJobPermissions(seal, { contents: 'read', packages: 'read' });
  assertExactJobPermissions(policy, {
    contents: 'read',
    packages: 'read',
    'security-events': 'write',
  });
  assert.equal(permissionDeclarations(releaseGate).length, 0);
  assert.equal(permissionDeclarations(deploy).length, 0);

  assert.match(releaseGate, /^    uses: \.\/\.github\/workflows\/ci\.yml$/m);
  assert.match(releaseGate, new RegExp(`^      checkout_ref: ${RECOVERY_V16_SOURCE}$`, 'm'));
  assert.deepEqual(jobNeeds(build), ['validate', 'release-gate']);
  assert.deepEqual(jobNeeds(seal), ['validate', 'release-gate', 'build']);
  assert.deepEqual(jobNeeds(policy), ['validate', 'release-gate', 'build', 'seal']);
  assert.deepEqual(jobNeeds(deploy), [
    'validate',
    'release-gate',
    'build',
    'seal',
    'vulnerability-policy',
  ]);

  const buildMatrix = build.match(
    /^      matrix:\n        include:\n([\s\S]*?)(?=^    steps:)/m,
  )?.[1];
  assert.ok(buildMatrix, 'missing selective build matrix');
  assert.equal(buildMatrix, [
    '          - image: subwave-caddy',
    '            dockerfile: docker/Dockerfile.caddy',
    '            platforms: linux/amd64,linux/arm64',
    '          - image: subwave-web',
    '            dockerfile: web/Dockerfile',
    '            platforms: linux/amd64,linux/arm64',
    '          - image: subwave-aio-heavy',
    '            dockerfile: docker/Dockerfile.aio',
    '            platforms: linux/amd64',
    '            build_args: |',
    '              WITH_CLAP=1',
    '              WITH_DEMUCS=1',
    '          - image: subwave-tts-heavy',
    '            dockerfile: docker/Dockerfile.tts-heavy',
    '            platforms: linux/amd64',
    '          - image: subwave-analyzer-heavy',
    '            dockerfile: docker/Dockerfile.analyzer',
    '            platforms: linux/amd64',
    '            build_args: |',
    '              WITH_CLAP=1',
    '              WITH_DEMUCS=1',
    '',
  ].join('\n'));

  const validationStep = stepBlock(validate, 'Verify partial recovery identity');
  assert.match(validate, /uses: actions\/checkout@v5\n        with:\n          fetch-depth: 0/);
  assert.match(validate, /uses: docker\/login-action@v4[\s\S]*?registry: ghcr\.io/);
  assert.equal(
    foldedStepCommand(validationStep),
    `node scripts/release/recovery-manifest.mjs verify-partial --manifest ${RECOVERY_V16_PARTIAL} --scanner security/trivy-scanner.json --repository ObiWanCanOweMe/obiwave`,
  );
  const validateAbsence = stepRun(validate, 'Prove selective build tags are absent');
  assert.equal((validateAbsence.match(/assert-image-tag-absent\.mjs/g) ?? []).length, 5);
  for (const image of RECOVERY_V16_IMAGES) {
    assert.equal(
      (validateAbsence.match(new RegExp(`ghcr\\.io/obiwancanoweme/${image}:${RECOVERY_V16_TAG.replaceAll('.', '\\.')}`, 'g')) ?? []).length,
      1,
    );
  }

  assert.equal(
    (build.match(new RegExp(`ref: ${RECOVERY_V16_SOURCE}`, 'g')) ?? []).length,
    1,
  );
  assert.match(build, /uses: docker\/setup-qemu-action@v4/);
  assert.match(build, /uses: docker\/setup-buildx-action@v4/);
  assert.match(build, /uses: docker\/login-action@v4[\s\S]*?registry: ghcr\.io/);
  const repeatAbsenceIndex = build.indexOf('      - name: Reconfirm immutable tag absence');
  const buildActionIndex = build.indexOf('      - id: build');
  assert.ok(repeatAbsenceIndex >= 0 && buildActionIndex > repeatAbsenceIndex);
  assert.doesNotMatch(build.slice(repeatAbsenceIndex, buildActionIndex), /\n      - /);
  assert.match(
    stepRun(build, 'Reconfirm immutable tag absence'),
    /node scripts\/ci\/assert-image-tag-absent\.mjs "ghcr\.io\/obiwancanoweme\/\$\{\{ matrix\.image \}\}:v1\.6\.0-obiwave\.1"/,
  );
  assert.match(build, /^          context: \.$/m);
  assert.match(build, /^          file: \$\{\{ matrix\.dockerfile \}\}$/m);
  assert.match(build, /^          push: true$/m);
  assert.match(build, /^          tags: ghcr\.io\/obiwancanoweme\/\$\{\{ matrix\.image \}\}:v1\.6\.0-obiwave\.1$/m);
  assert.match(build, /^            org\.opencontainers\.image\.version=v1\.6\.0-obiwave\.1$/m);
  assert.match(build, /^            org\.opencontainers\.image\.revision=87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787$/m);

  const record = stepBlock(build, 'Record immutable build digest');
  assert.deepEqual(stepEnv(record), {
    IMAGE: '${{ matrix.image }}',
    DIGEST: '${{ steps.build.outputs.digest }}',
    OUTPUT_PATH: '${{ runner.temp }}/${{ matrix.image }}.json',
  });
  const recordCommand = stepRun(build, 'Record immutable build digest');
  assert.match(recordCommand, /\^subwave-\[a-z0-9-\]\+\$/);
  assert.match(recordCommand, /\^sha256:\[a-f0-9\]\{64\}\$/);
  assert.match(recordCommand, /writeFileSync\(process\.env\.OUTPUT_PATH/);
  assert.match(build, /name: recovery-build-digest-\$\{\{ matrix\.image \}\}/);
  assert.match(build, /path: \$\{\{ runner\.temp \}\}\/\$\{\{ matrix\.image \}\}\.json/);
  const buildArtifact = stepBlock(build, 'Upload immutable build digest');
  assert.match(buildArtifact, /^        uses: actions\/upload-artifact@v4$/m);

  assert.match(seal, /pattern: recovery-build-digest-\*/);
  assert.match(seal, /merge-multiple: true/);
  assert.match(seal, /node scripts\/release\/recovery-manifest\.mjs seal/);
  assert.match(seal, /name: v1\.6\.0-obiwave\.1-recovery-manifest/);
  assert.equal(
    seal.match(/^    outputs:\n((?:      [^\n]+\n?)*)/m)?.[1],
    '      manifest_b64: ${{ steps.seal.outputs.manifest_b64 }}\n',
  );
  assert.match(seal, /manifest\.images\.length !== 10/);
  assert.match(seal, /manifest\.images\.map\(\(\{ name, digest \}\)/);
  assert.match(seal, /GITHUB_STEP_SUMMARY/);
  const manifestArtifact = stepBlock(seal, 'Upload sealed recovery manifest');
  assert.match(manifestArtifact, /^        uses: actions\/upload-artifact@v4$/m);
  assert.match(manifestArtifact, /path: \$\{\{ runner\.temp \}\}\/v1\.6\.0-obiwave\.1-recovery-manifest\.json/);

  assert.match(policy, /^    uses: \.\/\.github\/workflows\/scan-images\.yml$/m);
  assert.match(policy, /^      release_tag: v1\.6\.0-obiwave\.1$/m);
  assert.match(policy, /^      partial_recovery_manifest: security\/releases\/v1\.6\.0-obiwave\.1\.partial\.json$/m);
  assert.match(policy, /^      sealed_recovery_manifest_b64: \$\{\{ needs\.seal\.outputs\.manifest_b64 \}\}$/m);
  assert.equal((workflow.match(/needs\.seal\.outputs\.manifest_b64/g) ?? []).length, 1);

  assert.equal(jobScalar(deploy, 'environment'), 'production');
  assert.match(deploy, /^    concurrency:\n      group: subwave-production\n      cancel-in-progress: false$/m);
  assert.equal(jobScalar(deploy, 'timeout-minutes'), '30');
  const deployStep = stepBlock(deploy, 'Deploy immutable release through Portainer');
  assert.equal(stepEnv(deployStep).SUBWAVE_RELEASE_TAG, RECOVERY_V16_TAG);
  assert.match(deployStep, /^        run: node scripts\/deploy\/portainer-release\.mjs$/m);

  for (const [jobName, job] of [
    ['validate', validate],
    ['release-gate', releaseGate],
    ['build', build],
    ['seal', seal],
    ['vulnerability-policy', policy],
    ['deploy-production', deploy],
  ]) {
    assertNoGatedPathBypass(job, jobName);
  }
  assert.doesNotMatch(workflow, /continue-on-error/);
  assert.doesNotMatch(workflow, /\bdocker\s+tag\b|\bgh\s+release\s+create\b|\b(?:docker|gh)\s+[^\n]*(?:delete|rm)\b/i);
  const normalizedCommands = workflow.replace(/\\\n\s*/g, ' ');
  assert.doesNotMatch(
    normalizedCommands,
    /\bgh\s+workflow\s+run\b|\/actions\/workflows\/[^\s"']+\/dispatches\b|\bdocker\s+push\b|\bdocker\s+(?:build|buildx\s+build)\b[^\n]*(?:^|\s)(?:-t|--tag)(?:\s|=)|\bdocker\s+buildx\s+imagetools\s+create\b[^\n]*\s--tag(?:\s|=)/im,
  );
  for (const [, tag] of workflow.matchAll(/ghcr\.io\/obiwancanoweme\/[^\s"']+:([^\s"']+)/g)) {
    assert.equal(tag, RECOVERY_V16_TAG, 'alternate public image tag is forbidden');
  }
}

test('v1.6 recovery selectively publishes, seals, scans, and deploys the partial publication', () => {
  assertSelectiveRecoveryV16(recoveryV16);
});

test('v1.6 recovery rejects immutable-tag and gate bypass mutations', () => {
  assertSelectiveRecoveryV16(recoveryV16);
  for (const mutation of [
    recoveryV16.replace('needs: [validate, release-gate]', 'needs: [validate]'),
    recoveryV16.replace('    environment: production', '    environment: staging'),
    recoveryV16.replaceAll('v1.6.0-obiwave.1', 'latest'),
    `${recoveryV16}\n# docker tag source target\n`,
    `${recoveryV16}\n# gh release create v1.6.0-obiwave.1\n`,
    recoveryV16.replace(
      '      - name: Verify partial recovery identity',
      '      - name: Dispatch another workflow\n        run: gh workflow run publish-images.yml\n      - name: Verify partial recovery identity',
    ),
    recoveryV16.replace(
      '      - name: Reconfirm immutable tag absence',
      '      - name: Retag an image\n        run: docker buildx imagetools create --tag ghcr.io/obiwancanoweme/subwave-web:v1.6.0-obiwave.1 source\n      - name: Reconfirm immutable tag absence',
    ),
    recoveryV16.replace(
      '          node scripts/ci/assert-image-tag-absent.mjs "ghcr.io/obiwancanoweme/${{ matrix.image }}:v1.6.0-obiwave.1"',
      '          node scripts/ci/assert-image-tag-absent.mjs "ghcr.io/obiwancanoweme/${{ matrix.image }}:v1.6.0-obiwave.1"\n          docker push ghcr.io/obiwancanoweme/subwave-web:v1.6.0-obiwave.1',
    ),
    recoveryV16.replace(
      '          node scripts/ci/assert-image-tag-absent.mjs "ghcr.io/obiwancanoweme/${{ matrix.image }}:v1.6.0-obiwave.1"',
      '          node scripts/ci/assert-image-tag-absent.mjs "ghcr.io/obiwancanoweme/${{ matrix.image }}:v1.6.0-obiwave.1"\n          docker build -t ghcr.io/obiwancanoweme/subwave-web:v1.6.0-obiwave.1 .',
    ),
    recoveryV16.replace(
      '          node scripts/ci/assert-image-tag-absent.mjs "ghcr.io/obiwancanoweme/${{ matrix.image }}:v1.6.0-obiwave.1"',
      '          node scripts/ci/assert-image-tag-absent.mjs "ghcr.io/obiwancanoweme/${{ matrix.image }}:v1.6.0-obiwave.1"\n          gh api --method POST repos/ObiWanCanOweMe/obiwave/actions/workflows/publish-images.yml/dispatches',
    ),
    recoveryV16.replace(
      '      manifest_b64: ${{ steps.seal.outputs.manifest_b64 }}',
      '      manifest_b64: ${{ steps.seal.outputs.manifest_b64 }}\n      manifest_path: /tmp/recovery.json',
    ),
    recoveryV16.replace(
      '      - id: build',
      '      - name: Bypass\n        run: true\n      - id: build',
    ),
  ]) {
    assert.throws(() => assertSelectiveRecoveryV16(mutation));
  }
});

function assertRecoveryWorkflow(workflow, { tag, manifest }) {
  assert.deepEqual(
    topLevelBlockLines(workflow, 'on'),
    ['  workflow_dispatch:'],
    'workflow_dispatch must be the only recovery trigger',
  );
  assert.deepEqual(
    recoveryJobNames(workflow),
    ['validate', 'vulnerability-policy', 'deploy-production'],
    'recovery workflow must contain only the approved gated jobs',
  );

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
  for (const [jobName, job] of [
    ['validate', validate],
    ['vulnerability-policy', policy],
    ['deploy-production', deploy],
  ]) {
    assertNoGatedPathBypass(job, jobName);
  }
  assert.deepEqual(jobStepHeaders(validate), [
    'uses: actions/checkout@v5',
    'uses: actions/setup-node@v5',
    'uses: docker/setup-buildx-action@v4',
    'uses: docker/login-action@v4',
    'name: Verify immutable recovery artifacts',
  ]);
  assert.deepEqual(jobStepHeaders(policy), []);
  assert.deepEqual(jobStepHeaders(deploy), [
    'uses: actions/checkout@v5',
    'uses: actions/setup-node@v5',
    'name: Deploy immutable release through Portainer',
  ]);
  assert.match(validate, /^    permissions:\n      contents: read\n      packages: read$/m);
  const validationStep = stepBlock(validate, 'Verify immutable recovery artifacts');
  assert.deepEqual(stepEnv(validationStep), { GH_TOKEN: '${{ github.token }}' });
  assert.equal(
    foldedStepCommand(validationStep),
    `node scripts/release/recovery-manifest.mjs verify-all --manifest ${manifest} --scanner security/trivy-scanner.json --repository ObiWanCanOweMe/obiwave`,
  );
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
  for (const { workflow: recovery } of RECOVERY_WORKFLOWS) {
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

test('one-release recovery contracts are fixed-identity, policy-gated, and protected', () => {
  for (const { workflow, tag, manifest } of RECOVERY_WORKFLOWS) {
    assertRecoveryWorkflow(workflow, { tag, manifest });
  }
});

test('recovery contracts reject every trigger beyond manual dispatch', () => {
  for (const { workflow, tag, manifest } of RECOVERY_WORKFLOWS) {
    const identity = { tag, manifest };
    for (const extraTrigger of [
      '  push:',
      "  schedule:\n    - cron: '0 0 * * *'",
      '  workflow_call:',
    ]) {
      const mutation = workflow.replace(
        '  workflow_dispatch:',
        `  workflow_dispatch:\n${extraTrigger}`,
      );
      assert.throws(() => assertRecoveryWorkflow(mutation, identity));
    }
  }
});

test('recovery contracts reject a bypassed immutable-artifact validation step', () => {
  for (const { workflow, tag, manifest } of RECOVERY_WORKFLOWS) {
    const identity = { tag, manifest };
    const mutation = workflow.replace(
      '          node scripts/release/recovery-manifest.mjs verify-all',
      '          echo validation-bypassed',
    );
    assert.throws(() => assertRecoveryWorkflow(mutation, identity));
  }
});

for (const [bypassName, mutateWorkflow] of [
  [
    'an always-running production deployment',
    (workflow) => workflow.replace(
      '  deploy-production:\n',
      '  deploy-production:\n    if: always()\n',
    ),
  ],
  [
    'a skipped immutable-artifact preflight',
    (workflow) => workflow.replace(
      '      - name: Verify immutable recovery artifacts\n',
      '      - name: Verify immutable recovery artifacts\n        if: false\n',
    ),
  ],
  [
    'a non-blocking immutable-artifact preflight',
    (workflow) => workflow.replace(
      '      - name: Verify immutable recovery artifacts\n',
      '      - name: Verify immutable recovery artifacts\n        continue-on-error: true\n',
    ),
  ],
  [
    'an extra ungated production deployment job',
    (workflow) => {
      const releaseTag = workflow.match(/^          SUBWAVE_RELEASE_TAG: ([^\n]+)$/m)?.[1];
      assert.ok(releaseTag, 'missing fixed recovery release tag');
      return `${workflow}\n  ungated-production-deploy:\n    runs-on: ubuntu-latest\n    environment: production\n    steps:\n      - uses: actions/checkout@v5\n      - uses: actions/setup-node@v5\n        with:\n          node-version: '22'\n      - name: Deploy without policy gate\n        env:\n          PORTAINER_URL: \${{ vars.PORTAINER_URL }}\n          PORTAINER_API_KEY: \${{ secrets.PORTAINER_API_KEY }}\n          PORTAINER_STACK_ID: \${{ vars.PORTAINER_STACK_ID }}\n          PORTAINER_ENDPOINT_ID: \${{ vars.PORTAINER_ENDPOINT_ID }}\n          SUBWAVE_RELEASE_TAG: ${releaseTag}\n          SUBWAVE_HEALTH_URL: \${{ vars.SUBWAVE_HEALTH_URL }}\n          SUBWAVE_STREAM_URL: \${{ vars.SUBWAVE_STREAM_URL }}\n          SUBWAVE_STREAM_PASSWORD: \${{ secrets.SUBWAVE_STREAM_PASSWORD }}\n        run: node scripts/deploy/portainer-release.mjs\n`;
    },
  ],
]) {
  test(`recovery contracts reject ${bypassName}`, () => {
    for (const { workflow, tag, manifest } of RECOVERY_WORKFLOWS) {
      const identity = { tag, manifest };
      assert.throws(() => assertRecoveryWorkflow(mutateWorkflow(workflow), identity));
    }
  });
}

test('recovery contracts reject identity, authorization, and deployment-gate mutations', () => {
  for (const { workflow, tag, manifest } of RECOVERY_WORKFLOWS) {
    const identity = { tag, manifest };
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

async function runResolveTag(env) {
  const repository = fileURLToPath(new URL('../..', import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), 'subwave-resolve-tag-'));
  const outputPath = join(directory, 'github-output');
  const runtimePath = env.SEALED_RECOVERY_MANIFEST_B64
    && /^v\d+\.\d+\.\d+-obiwave\.\d+$/.test(env.REQUESTED_TAG)
    ? join(repository, 'security/releases', `runtime-${env.REQUESTED_TAG}.json`)
    : null;
  const previousRuntime = runtimePath
    ? await readFile(runtimePath).then((contents) => ({ exists: true, contents }), () => ({ exists: false }))
    : null;
  try {
    const result = spawnSync('bash', ['-e'], {
      cwd: repository,
      encoding: 'utf8',
      input: stepRun(jobBlock(scan, 'resolve-tag'), 'Resolve and validate release tag'),
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: 'workflow_call',
        GITHUB_OUTPUT: outputPath,
        RECOVERY_MANIFEST: '',
        PARTIAL_RECOVERY_MANIFEST: '',
        SEALED_RECOVERY_MANIFEST_B64: '',
        ...env,
      },
    });
    const output = await readFile(outputPath, 'utf8').catch(() => '');
    return { result, output };
  } finally {
    await rm(directory, { recursive: true, force: true });
    if (runtimePath && previousRuntime.exists) {
      await writeFile(runtimePath, previousRuntime.contents);
    } else if (runtimePath) {
      await rm(runtimePath, { force: true });
    }
  }
}

test('scanner resolve-tag executes static recovery validation as valid Bash', async () => {
  const { result, output } = await runResolveTag({
    RECOVERY_MANIFEST: 'security/releases/v1.3.0-obiwave.2.json',
    REQUESTED_TAG: 'v1.3.0-obiwave.2',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(output, /^tag=v1\.3\.0-obiwave\.2$/m);
  assert.match(output, /^recovery_mode=static$/m);
  assert.match(output, /^recovery_manifest=security\/releases\/v1\.3\.0-obiwave\.2\.json$/m);
});

test('scanner resolve-tag materializes and validates a sealed manifest as valid Bash', async () => {
  const { result, output } = await runResolveTag({
    PARTIAL_RECOVERY_MANIFEST: 'security/releases/v1.6.0-obiwave.1.partial.json',
    REQUESTED_TAG: 'v1.6.0-obiwave.1',
    SEALED_RECOVERY_MANIFEST_B64: sealedRecoveryV16B64,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(output, /^tag=v1\.6\.0-obiwave\.1$/m);
  assert.match(output, /^recovery_mode=sealed$/m);
  assert.match(output, /^recovery_manifest=security\/releases\/runtime-v1\.6\.0-obiwave\.1\.json$/m);
  assert.match(output, /^partial_recovery_manifest=security\/releases\/v1\.6\.0-obiwave\.1\.partial\.json$/m);
  assert.doesNotMatch(output, new RegExp(sealedRecoveryV16B64));
});

test('sealed manifest resolution rejects mixed, incomplete, escaped, and mismatched recovery inputs', async () => {
  for (const env of [
    {
      RECOVERY_MANIFEST: 'security/releases/v1.3.0-obiwave.2.json',
      PARTIAL_RECOVERY_MANIFEST: 'security/releases/v1.6.0-obiwave.1.partial.json',
      REQUESTED_TAG: 'v1.6.0-obiwave.1',
      SEALED_RECOVERY_MANIFEST_B64: sealedRecoveryV16B64,
    },
    {
      PARTIAL_RECOVERY_MANIFEST: 'security/releases/v1.6.0-obiwave.1.partial.json',
      REQUESTED_TAG: 'v1.6.0-obiwave.1',
    },
    {
      REQUESTED_TAG: 'v1.6.0-obiwave.1',
      SEALED_RECOVERY_MANIFEST_B64: sealedRecoveryV16B64,
    },
    {
      PARTIAL_RECOVERY_MANIFEST: '../security/releases/v1.6.0-obiwave.1.partial.json',
      REQUESTED_TAG: 'v1.6.0-obiwave.1',
      SEALED_RECOVERY_MANIFEST_B64: sealedRecoveryV16B64,
    },
    {
      RECOVERY_MANIFEST: 'security/releases/v1.3.0-obiwave.2.json',
      REQUESTED_TAG: 'v1.5.0-obiwave.1',
    },
    {
      PARTIAL_RECOVERY_MANIFEST: 'security/releases/v1.6.0-obiwave.1.partial.json',
      REQUESTED_TAG: 'v1.5.0-obiwave.1',
      SEALED_RECOVERY_MANIFEST_B64: sealedRecoveryV16B64,
    },
  ]) {
    const { result, output } = await runResolveTag(env);
    assert.notEqual(result.status, 0, `unexpected recovery acceptance:\n${output}`);
    assert.doesNotMatch(`${result.stdout}${result.stderr}${output}`, new RegExp(sealedRecoveryV16B64));
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

test('reusable CI declares an optional checkout ref', () => {
  assert.match(
    ci,
    /workflow_call:\s*\n\s+inputs:\s*\n\s+checkout_ref:\s*\n\s+description: Optional source commit or ref to test\s*\n\s+required: false\s*\n\s+default: ''\s*\n\s+type: string/,
  );
});

test('every reusable CI job uses the release-source checkout ref', () => {
  assert.equal((ci.match(/uses: actions\/checkout@v5/g) ?? []).length, 3);
  assert.equal(
    (ci.match(/uses: actions\/checkout@v5\s*\n\s+with:\s*\n\s+ref: \$\{\{ inputs\.checkout_ref \|\| github\.sha \}\}/g) ?? []).length,
    3,
  );
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
  assert.doesNotMatch(jobBlock(publish, 'release-gate'), /^    with:/m);
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

test('JSON and SARIF scanner invocations include tag and digest-qualified pull references', () => {
  const scanJob = jobBlock(scan, 'scan');
  for (const stepName of [
    'Scan ${{ matrix.image }} for policy JSON',
    'Scan ${{ matrix.image }} for SARIF',
  ]) {
    const stepStart = scanJob.indexOf(`      - name: ${stepName}`);
    assert.notEqual(stepStart, -1, `missing ${stepName} step`);
    const nextStep = scanJob.indexOf('\n      - ', stepStart + 1);
    const step = scanJob.slice(stepStart, nextStep === -1 ? undefined : nextStep);
    assert.equal(stepEnv(step).TAG_REF, '${{ steps.refs.outputs.tag_ref }}');
    assert.equal(stepEnv(step).PULL_REF, '${{ steps.refs.outputs.pull_ref }}');

    const command = stepRun(scanJob, stepName);
    assert.match(command, /--tag-ref "\$TAG_REF"/);
    assert.match(command, /recovery_args\+=\(--pull-ref "\$PULL_REF"\)/);
    assert.match(command, /"\$\{recovery_args\[@\]\}"/);
  }
});

test('sealed manifest workflow-call inputs are optional transport values', () => {
  assert.match(
    scan,
    /partial_recovery_manifest:\s*\n\s+description: Approved repository-relative partial recovery manifest\s*\n\s+required: false\s*\n\s+default: ''\s*\n\s+type: string\s*\n\s+sealed_recovery_manifest_b64:\s*\n\s+description: Base64 sealed recovery manifest from an upstream job\s*\n\s+required: false\s*\n\s+default: ''\s*\n\s+type: string/,
  );
});

test('recovery inputs are transferred through the environment, never interpolated into Bash', () => {
  const resolveJob = scan.slice(scan.indexOf('  resolve-tag:'), scan.indexOf('  scan:'));
  const resolveStep = stepBlock(resolveJob, 'Resolve and validate release tag');
  assert.deepEqual(stepEnv(resolveStep), {
    REQUESTED_TAG: '${{ inputs.release_tag }}',
    RECOVERY_MANIFEST: '${{ inputs.recovery_manifest }}',
    PARTIAL_RECOVERY_MANIFEST: '${{ inputs.partial_recovery_manifest }}',
    SEALED_RECOVERY_MANIFEST_B64: '${{ inputs.sealed_recovery_manifest_b64 }}',
  });
  assert.doesNotMatch(stepRun(resolveJob, 'Resolve and validate release tag'), /\$\{\{ inputs\./);

  const outputs = resolveJob.slice(resolveJob.indexOf('    outputs:'), resolveJob.indexOf('    steps:'));
  assert.match(outputs, /^      recovery_mode: \$\{\{ steps\.resolve\.outputs\.recovery_mode \}\}$/m);
  assert.match(outputs, /^      recovery_manifest: \$\{\{ steps\.resolve\.outputs\.recovery_manifest \}\}$/m);
  assert.match(outputs, /^      partial_recovery_manifest: \$\{\{ steps\.resolve\.outputs\.partial_recovery_manifest \}\}$/m);
  assert.doesNotMatch(outputs, /sealed_recovery_manifest_b64/i);
});

test('every scan matrix job materializes the sealed manifest before resolving immutable refs', () => {
  const scanJob = jobBlock(scan, 'scan');
  const materializeStep = stepBlock(scanJob, 'Materialize sealed recovery manifest');
  const refsStep = stepBlock(scanJob, 'Resolve immutable image references');
  assert.ok(
    scanJob.indexOf('      - name: Materialize sealed recovery manifest')
      < scanJob.indexOf('      - name: Resolve immutable image references'),
  );
  assert.deepEqual(stepEnv(materializeStep), {
    PARTIAL_RECOVERY_MANIFEST: '${{ needs.resolve-tag.outputs.partial_recovery_manifest }}',
    RECOVERY_MANIFEST: '${{ needs.resolve-tag.outputs.recovery_manifest }}',
    RECOVERY_MODE: '${{ needs.resolve-tag.outputs.recovery_mode }}',
    SEALED_RECOVERY_MANIFEST_B64: '${{ inputs.sealed_recovery_manifest_b64 }}',
  });
  assert.match(
    stepRun(scanJob, 'Materialize sealed recovery manifest'),
    /materialize-sealed[\s\S]*--manifest "\$PARTIAL_RECOVERY_MANIFEST"[\s\S]*--output "\$RECOVERY_MANIFEST"/,
  );
  assert.doesNotMatch(stepRun(scanJob, 'Materialize sealed recovery manifest'), /\$\{\{ inputs\./);
  assert.match(
    stepRun(scanJob, 'Resolve immutable image references'),
    /sealed-image[\s\S]*--manifest "\$RECOVERY_MANIFEST"[\s\S]*--partial-manifest "\$PARTIAL_RECOVERY_MANIFEST"/,
  );
  assert.match(stepRun(scanJob, 'Resolve immutable image references'), /--image "\$IMAGE"/);
  assert.deepEqual(stepEnv(refsStep), {
    IMAGE: '${{ matrix.image }}',
    RELEASE_TAG: '${{ needs.resolve-tag.outputs.tag }}',
    RECOVERY_MANIFEST: '${{ needs.resolve-tag.outputs.recovery_manifest }}',
    PARTIAL_RECOVERY_MANIFEST: '${{ needs.resolve-tag.outputs.partial_recovery_manifest }}',
    RECOVERY_MODE: '${{ needs.resolve-tag.outputs.recovery_mode }}',
  });

  assert.equal((scanJob.match(/--partial-recovery-manifest "\$PARTIAL_RECOVERY_MANIFEST"/g) ?? []).length, 2);
  assert.equal((scanJob.match(/--recovery-manifest "\$RECOVERY_MANIFEST"/g) ?? []).length, 2);
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

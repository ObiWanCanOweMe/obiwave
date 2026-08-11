#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises';

import { CANONICAL_IMAGE_NAMESPACE, EXPECTED_IMAGES } from '../security/trivy-policy.mjs';

const SCANNER_VERSION = '0.67.2';
const SCANNER_IMAGE = 'aquasec/trivy@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08';
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40}$/;
const APPROVED_RECOVERIES = Object.freeze({
  'v1.3.0-obiwave.2': Object.freeze({
    sourceCommit: '41c8a329670f99c3b440a468adbb9fe2d900a4fe',
    images: Object.freeze([
      Object.freeze({ name: 'subwave-caddy', digest: 'sha256:10a653cd8eb73a4aa55998d4f499ed7184a37ae99a41c2222f7a9434175290cd' }),
      Object.freeze({ name: 'subwave-broadcast', digest: 'sha256:e983017f0bae67fa10cd7bf9833403227c2e193492175087e03bb8ac99df236b' }),
      Object.freeze({ name: 'subwave-controller', digest: 'sha256:e516778b297cc92f65b22e2336a2a8c7c16618f63fe19746f01dc9dbf405f7f6' }),
      Object.freeze({ name: 'subwave-web', digest: 'sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f' }),
      Object.freeze({ name: 'subwave-aio', digest: 'sha256:50e961965b7f449f330c83e8942fea58d02a7dc5265e3efa8c3600017f48166e' }),
      Object.freeze({ name: 'subwave-aio-heavy', digest: 'sha256:48c0e3bd7fc6dba4e8dc01b6eec12b267be9ac1635d7af15e8a5710724c3427d' }),
      Object.freeze({ name: 'subwave-tts-heavy', digest: 'sha256:ee4dd62bf79eddbf6329ea059e5e172ef176c87353c18d05dd1ec3c0f0c53025' }),
      Object.freeze({ name: 'subwave-analyzer', digest: 'sha256:be9a81fd5b43c97e4093399aebc8d00cfdfa656d032602e7ca0644e49934164f' }),
      Object.freeze({ name: 'subwave-analyzer-heavy', digest: 'sha256:82e7c5bef067ffe35db03a2bbe08c518e764fb61065eee34af4213aede4ebe00' }),
      Object.freeze({ name: 'subwave-analyzer-cuda', digest: 'sha256:c6964797b8a88dd2fa9291778543c27594350aba84c7c2f2d25560cd5150bb72' }),
    ]),
  }),
  'v1.5.0-obiwave.1': Object.freeze({
    sourceCommit: 'fe269a1e632fe6f886ac987f641f41326e1392e0',
    images: Object.freeze([
      Object.freeze({ name: 'subwave-caddy', digest: 'sha256:cdf89341b5a0c5c31493f6b2653b45631aac6e184148af8a46db02ff3072f235' }),
      Object.freeze({ name: 'subwave-broadcast', digest: 'sha256:32eb3d4c2a4146e31f37a389bc4d3b8309d3f13bf31edf5e7bf3a687f96ad5d0' }),
      Object.freeze({ name: 'subwave-controller', digest: 'sha256:5aa26e9be46fdb2d733e7da2c74af63bbfeb7630575cae6bcbf0bf7c9b29ee55' }),
      Object.freeze({ name: 'subwave-web', digest: 'sha256:f2f635a3b9d581db1478a74e5dfddbdae6faa31bb4b7694c7e03095915130008' }),
      Object.freeze({ name: 'subwave-aio', digest: 'sha256:f745b4ae1133af9e77f1006ccf2ca219a6df0243451b4e633c143f0b6cc1ab8a' }),
      Object.freeze({ name: 'subwave-aio-heavy', digest: 'sha256:2d37d9c15e88b90523c437e8330c7245050f92a2eefc513ac6a556ca7c68a90b' }),
      Object.freeze({ name: 'subwave-tts-heavy', digest: 'sha256:41a6be4327f9f321b0993da4bac93a6359e440c1c26f7af52b663bcb083a3784' }),
      Object.freeze({ name: 'subwave-analyzer', digest: 'sha256:ec22ae65a95f60d070414b2fa73a7ec481190d66355426ce1cdbfdb142ef9f2c' }),
      Object.freeze({ name: 'subwave-analyzer-heavy', digest: 'sha256:290e2cd443bcee737fc4806f77384f172858e133f4fc0c0292195be9d53c9c5c' }),
      Object.freeze({ name: 'subwave-analyzer-cuda', digest: 'sha256:a69d2f866eb9d991a69212b5605c15a3631d4d21cec8c4608a6cb29f9d7c9cc2' }),
    ]),
  }),
  'v1.6.0-obiwave.1': Object.freeze({
    sourceCommit: '87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787',
    images: Object.freeze([
      Object.freeze({ name: 'subwave-caddy', digest: 'sha256:2721393a1eb3080e4dc6114893ac6a0472a258b8e32654f1b2a9c63a926c050f' }),
      Object.freeze({ name: 'subwave-broadcast', digest: 'sha256:a623e516992ade44d83ac72c231d2ecc278eb71c613d04212936a5ec03237c2f' }),
      Object.freeze({ name: 'subwave-controller', digest: 'sha256:fe765d8f9a491012c33c6828686cb350aa2e6f84acffd170fc038b4be93c614f' }),
      Object.freeze({ name: 'subwave-web', digest: 'sha256:0c6e1f925433dfb23c76022209eee614ffae0559a53e0b4b49e4f0c22a169c44' }),
      Object.freeze({ name: 'subwave-aio', digest: 'sha256:6d1c79424e19348653f929f0687582984d46fc964cdc388a49a03d58b8d3b1fe' }),
      Object.freeze({ name: 'subwave-aio-heavy', digest: 'sha256:8da2822e6e0053228442e1d379b4ef208858f9ab9f1863e4737db545c408d0b4' }),
      Object.freeze({ name: 'subwave-tts-heavy', digest: 'sha256:8e783b7067cfa172feca4cbc88d4d5100af29ee1d663db28d18aad42fec3bd15' }),
      Object.freeze({ name: 'subwave-analyzer', digest: 'sha256:4d4aaac6121f24699b3de79c00572afe87fd7c971b8b02c81c6bec12c7e1a1c9' }),
      Object.freeze({ name: 'subwave-analyzer-heavy', digest: 'sha256:9b058fd453db1811d2ff1928092b9e52320d62b0defa377baebeeb3a0da1a7ca' }),
      Object.freeze({ name: 'subwave-analyzer-cuda', digest: 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341' }),
    ]),
  }),
  'v1.6.0-obiwave.2': Object.freeze({
    sourceCommit: '28076250da60844457973794933b5af3b82fa1dc',
    images: Object.freeze([
      Object.freeze({ name: 'subwave-caddy', digest: 'sha256:03315a161f65eb17c1d31de1b01e5b3754a7fdf7e37f85fa90df7a6a13ab416d' }),
      Object.freeze({ name: 'subwave-broadcast', digest: 'sha256:da1347715f0830ef089dba511e750752340220103e25fb2d7c62d081c39af270' }),
      Object.freeze({ name: 'subwave-controller', digest: 'sha256:3735c284f0c10e59e691c3d3605e741cfbde266850bb11cd9315699dcd81592e' }),
      Object.freeze({ name: 'subwave-web', digest: 'sha256:5cced33d7555185218bed805997e6547ae4b8bc978aaf35f828713ddc518a6c3' }),
      Object.freeze({ name: 'subwave-aio', digest: 'sha256:f3b54ec397d032cf551fffb70275d9a4e2fe3c810a6389075846e5cbbb2c9ca5' }),
      Object.freeze({ name: 'subwave-aio-heavy', digest: 'sha256:d75e67787e3e409e69ba312218a993dda15b0f8bebc4ef2ee3dd2b302a27ab49' }),
      Object.freeze({ name: 'subwave-tts-heavy', digest: 'sha256:0243b5ba48aa771d31036597c8c9c8f834f1bd5db8f6ce5b5584df76dd80e4fa' }),
      Object.freeze({ name: 'subwave-analyzer', digest: 'sha256:e72b6d318c652d1dd3938087b83e4c9251f3d9cc401d0a3cd2f833e49ebca1ea' }),
      Object.freeze({ name: 'subwave-analyzer-heavy', digest: 'sha256:ddc2dcc05de5f35fe38897417e7cddc47a70ff72856766321baac5c70d3a1cf7' }),
      Object.freeze({ name: 'subwave-analyzer-cuda', digest: 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341' }),
    ]),
  }),
  'v1.6.0-obiwave.3': Object.freeze({
    sourceCommit: '47a76f4cb5b45a26307ba4ebfcf7c77f66405492',
    images: Object.freeze([
      Object.freeze({ name: 'subwave-caddy', digest: 'sha256:201ac36144dd5aac2053ec6558c7a5af56befb8539de248d16a5afa2e4e523f4' }),
      Object.freeze({ name: 'subwave-broadcast', digest: 'sha256:516403e48ce839ddd36d09dd7f9f141b727aff56bfe293dfc0874e28c4f79d6b' }),
      Object.freeze({ name: 'subwave-controller', digest: 'sha256:540b4ee5e147e874a85c1e191f4195cc6c11d71f995951d985f98da9ce056997' }),
      Object.freeze({ name: 'subwave-web', digest: 'sha256:fe1da1ce8bf418953a080b9372985cedd8eab7cfbf007b145e8de2c4dda9eef8' }),
      Object.freeze({ name: 'subwave-aio', digest: 'sha256:8ac05fc188da2fa10d11b108775a3d41b14baa76b120a8fbec76e2c8bdc4317c' }),
      Object.freeze({ name: 'subwave-aio-heavy', digest: 'sha256:9bc62cda75bbfeea18ab4e3b7a1c2292c86cfa4034b8a336ac722daa3a67230e' }),
      Object.freeze({ name: 'subwave-tts-heavy', digest: 'sha256:8c87ff0b738f839ffe7cc9235bca318ce2fb9f6a2630b6ba0be306a988eec8f9' }),
      Object.freeze({ name: 'subwave-analyzer', digest: 'sha256:3dc8f420425e48768b0ab6d733aa3e47d5d883e067632dc6483ed0f4d5a1798f' }),
      Object.freeze({ name: 'subwave-analyzer-heavy', digest: 'sha256:5141e66cf1f953f6a4c7c4e753c86ed1556da7912d860369a069f7d9eafe1d15' }),
      Object.freeze({ name: 'subwave-analyzer-cuda', digest: 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341' }),
    ]),
  }),
  'v1.6.0-obiwave.4': Object.freeze({
    sourceCommit: 'b96ef42c6a014ecf96964809a42370ad5e6954ea',
    images: Object.freeze([
      Object.freeze({ name: 'subwave-caddy', digest: 'sha256:94362b8a08bbaa4d4b34eb20cbf6c4aef786fb5ab9d306b3d11b0a8fbb5ad4d1' }),
      Object.freeze({ name: 'subwave-broadcast', digest: 'sha256:9611d7b063a70cc96f94f02d4ba2574724f748c4bdca40a4c1d58dcfab75d459' }),
      Object.freeze({ name: 'subwave-controller', digest: 'sha256:9069bd7362c4c8cad3554ddfc4d82f7dcabac25d52337b276f3c72721c3a0d98' }),
      Object.freeze({ name: 'subwave-web', digest: 'sha256:8404a8d593bcff6866ab8ea8aa5f63dcae46963997ac08adf797e6b8fb67fc61' }),
      Object.freeze({ name: 'subwave-aio', digest: 'sha256:4448bcb829f93c3f537bf75b9b4a341f02ee10bc057201f1e8cdd4fe49391955' }),
      Object.freeze({ name: 'subwave-aio-heavy', digest: 'sha256:31aa0db54828e4a402ac1d3439bb0e2a5358921ca8ce0b0a8764affaffbb01a4' }),
      Object.freeze({ name: 'subwave-tts-heavy', digest: 'sha256:5f54595798f04ac2869ab51d56859da5d678add3f217d8046a3f216a6a2fd0a4' }),
      Object.freeze({ name: 'subwave-analyzer', digest: 'sha256:cc368beaa0913e8359edac0bc9cadc20853e0f3b78aff4e5361f518662388594' }),
      Object.freeze({ name: 'subwave-analyzer-heavy', digest: 'sha256:7765bccbb8ab223cb40856419d702ba091904e7a34a317fd1fc6a201a8b0f082' }),
      Object.freeze({ name: 'subwave-analyzer-cuda', digest: 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341' }),
    ]),
  }),
  'v1.7.0-obiwave.1': Object.freeze({
    sourceCommit: '62c7c9cf9f73256a4499d4b0aad9b3388866a46b',
    images: Object.freeze([
      Object.freeze({ name: 'subwave-caddy', digest: 'sha256:591b4e7b511097335d27aba289e58baa85ff80df87c85a8447ed9b2b559a9b2d' }),
      Object.freeze({ name: 'subwave-broadcast', digest: 'sha256:cef32c8b4289d7ff366b809321a2da3d19f27d991260c9a473177a6a029371d7' }),
      Object.freeze({ name: 'subwave-controller', digest: 'sha256:b0f8e0de367970ec765384c24bd4070229f3b88e4e7db01f91fabe827c62a2dc' }),
      Object.freeze({ name: 'subwave-web', digest: 'sha256:cf973b3e18dbd3eb1e7769d30c76429605898975a476be0dd1350dc0f7dd4b6a' }),
      Object.freeze({ name: 'subwave-aio', digest: 'sha256:cd7956245880da40e66646ff28571409f5d1fbd4e26253760ad5f81208b65a11' }),
      Object.freeze({ name: 'subwave-aio-heavy', digest: 'sha256:c73ced1117cfe15ce085b9744b998c55945fb92d549d2c1a5548b2d68eefedd5' }),
      Object.freeze({ name: 'subwave-tts-heavy', digest: 'sha256:ae75b8c439cf1541cdb5a9b536298b93b46ed58e1068ec7df861774b15d62007' }),
      Object.freeze({ name: 'subwave-analyzer', digest: 'sha256:00b1220098b08b6ecce4d9d9c796a55e1cd78fa19f8aa18271048c8cab856868' }),
      Object.freeze({ name: 'subwave-analyzer-heavy', digest: 'sha256:8520a2dd063ace1b5d7a17d96815b880ce08db9dee8fd882a8ae57bc34efe5c7' }),
      Object.freeze({ name: 'subwave-analyzer-cuda', digest: 'sha256:8fc7c81ea43a118d1c9d79da14986efa4876674745ac6ed6af166c202439990b' }),
    ]),
  }),
});
const APPROVED_PARTIAL_RECOVERIES = Object.freeze({
  'v1.6.0-obiwave.1': Object.freeze({
    sourceCommit: '87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787',
    images: Object.freeze([
      Object.freeze({ name: 'subwave-caddy', action: 'build' }),
      Object.freeze({ name: 'subwave-broadcast', action: 'preserve', digest: 'sha256:a623e516992ade44d83ac72c231d2ecc278eb71c613d04212936a5ec03237c2f' }),
      Object.freeze({ name: 'subwave-controller', action: 'preserve', digest: 'sha256:fe765d8f9a491012c33c6828686cb350aa2e6f84acffd170fc038b4be93c614f' }),
      Object.freeze({ name: 'subwave-web', action: 'build' }),
      Object.freeze({ name: 'subwave-aio', action: 'preserve', digest: 'sha256:6d1c79424e19348653f929f0687582984d46fc964cdc388a49a03d58b8d3b1fe' }),
      Object.freeze({ name: 'subwave-aio-heavy', action: 'build' }),
      Object.freeze({ name: 'subwave-tts-heavy', action: 'build' }),
      Object.freeze({ name: 'subwave-analyzer', action: 'preserve', digest: 'sha256:4d4aaac6121f24699b3de79c00572afe87fd7c971b8b02c81c6bec12c7e1a1c9' }),
      Object.freeze({ name: 'subwave-analyzer-heavy', action: 'build' }),
      Object.freeze({ name: 'subwave-analyzer-cuda', action: 'preserve', digest: 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341' }),
    ]),
  }),
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function fail(reason) {
  throw new Error(`Recovery manifest invalid: ${reason}`);
}

function freezeManifest(manifest) {
  return Object.freeze({
    schemaVersion: manifest.schemaVersion,
    releaseTag: manifest.releaseTag,
    sourceCommit: manifest.sourceCommit,
    scanner: Object.freeze({ ...manifest.scanner }),
    images: Object.freeze(manifest.images.map((image) => Object.freeze({ ...image }))),
  });
}

function freezePartialManifest(manifest) {
  return Object.freeze({
    schemaVersion: manifest.schemaVersion,
    kind: manifest.kind,
    releaseTag: manifest.releaseTag,
    sourceCommit: manifest.sourceCommit,
    scanner: Object.freeze({ ...manifest.scanner }),
    images: Object.freeze(manifest.images.map((image) => Object.freeze({ ...image }))),
  });
}

function validateScanner(scanner, scannerConfig) {
  if (!hasExactKeys(scanner, ['version', 'imageRef'])) {
    fail('scanner keys must be version and imageRef');
  }
  if (scanner.version !== SCANNER_VERSION || scanner.imageRef !== SCANNER_IMAGE) {
    fail('scanner must match the pinned recovery scanner');
  }
  if (!hasExactKeys(scannerConfig, ['schemaVersion', 'version', 'imageRef'])) {
    fail('scanner config keys must be schemaVersion, version, and imageRef');
  }
  if (
    scannerConfig.schemaVersion !== 1 ||
    scannerConfig.version !== scanner.version ||
    scannerConfig.imageRef !== scanner.imageRef
  ) {
    fail('scanner config must equal the recovery scanner');
  }
}

export function validatePartialRecoveryManifest({ manifest, scannerConfig }) {
  if (!hasExactKeys(manifest, ['schemaVersion', 'kind', 'releaseTag', 'sourceCommit', 'scanner', 'images'])) {
    fail('partial manifest keys must be schemaVersion, kind, releaseTag, sourceCommit, scanner, and images');
  }
  if (manifest.schemaVersion !== 2 || manifest.kind !== 'partial-publication-recovery') {
    fail('partial manifest must be schema version 2 partial-publication-recovery');
  }
  const approvedRecovery = APPROVED_PARTIAL_RECOVERIES[manifest.releaseTag];
  if (!approvedRecovery) fail('partial releaseTag is not approved');
  if (manifest.sourceCommit !== approvedRecovery.sourceCommit || !SHA.test(manifest.sourceCommit)) {
    fail(`sourceCommit must equal ${approvedRecovery.sourceCommit}`);
  }
  validateScanner(manifest.scanner, scannerConfig);
  if (!Array.isArray(manifest.images) || manifest.images.length !== approvedRecovery.images.length) {
    fail(`images must contain exactly ${approvedRecovery.images.length} entries`);
  }
  for (const [index, entry] of manifest.images.entries()) {
    const approved = approvedRecovery.images[index];
    const expectedKeys = approved.action === 'preserve' ? ['name', 'action', 'digest'] : ['name', 'action'];
    if (!hasExactKeys(entry, expectedKeys)) fail(`partial image ${index} has invalid keys`);
    if (entry.name !== approved.name || entry.name !== EXPECTED_IMAGES[index]) {
      fail(`image ${index} must equal ${approved.name}`);
    }
    if (entry.action !== approved.action) fail(`image ${entry.name} action is not approved`);
    if (approved.action === 'preserve' && (!DIGEST.test(entry.digest) || entry.digest !== approved.digest)) {
      fail(`image ${entry.name} digest is not approved`);
    }
  }
  return freezePartialManifest(manifest);
}

export async function loadPartialRecoveryManifest({ manifestPath, scannerPath }) {
  let manifest;
  let scannerConfig;
  try {
    [manifest, scannerConfig] = await Promise.all([
      readFile(manifestPath, 'utf8').then(JSON.parse),
      readFile(scannerPath, 'utf8').then(JSON.parse),
    ]);
  } catch {
    throw new Error('Partial recovery manifest files could not be read as JSON');
  }
  return validatePartialRecoveryManifest({ manifest, scannerConfig });
}

function sealedManifestFromEvidence(partialManifest, buildDigests, registryDigests) {
  if (!isObject(buildDigests)) fail('build digests must be an object');
  if (!isObject(registryDigests)) fail('registry digests must be an object');
  const buildImages = partialManifest.images.filter(({ action }) => action === 'build');
  const buildNames = buildImages.map(({ name }) => name);
  const registryNames = Object.keys(registryDigests);
  if (Object.keys(buildDigests).length !== buildNames.length || !buildNames.every((name) => Object.hasOwn(buildDigests, name))) {
    fail('build digest evidence must contain exactly the approved build images');
  }
  if (registryNames.length !== EXPECTED_IMAGES.length || !registryNames.every((name, index) => name === EXPECTED_IMAGES[index])) {
    fail('registry digest evidence must contain every image in canonical order');
  }
  return {
    schemaVersion: 1,
    releaseTag: partialManifest.releaseTag,
    sourceCommit: partialManifest.sourceCommit,
    scanner: { ...partialManifest.scanner },
    images: partialManifest.images.map((entry) => {
      const expectedDigest = entry.action === 'build' ? buildDigests[entry.name] : entry.digest;
      const registryDigest = registryDigests[entry.name];
      if (!DIGEST.test(expectedDigest)) fail(`image ${entry.name} has an invalid digest`);
      if (registryDigest !== expectedDigest || !DIGEST.test(registryDigest)) {
        fail(`registry digest does not match approved evidence: ${entry.name}`);
      }
      return { name: entry.name, digest: expectedDigest };
    }),
  };
}

export function sealRecoveryManifest({ partialManifest, buildDigests, registryDigests }) {
  const validatedPartial = validatePartialRecoveryManifest({
    manifest: partialManifest,
    scannerConfig: { schemaVersion: 1, version: SCANNER_VERSION, imageRef: SCANNER_IMAGE },
  });
  return freezeManifest(sealedManifestFromEvidence(validatedPartial, buildDigests, registryDigests));
}

export function validateSealedRecoveryManifest({ manifest, partialManifest, scannerConfig }) {
  const validatedPartial = validatePartialRecoveryManifest({ manifest: partialManifest, scannerConfig });
  if (!hasExactKeys(manifest, ['schemaVersion', 'releaseTag', 'sourceCommit', 'scanner', 'images'])) {
    fail('sealed manifest keys must be schemaVersion, releaseTag, sourceCommit, scanner, and images');
  }
  if (manifest.schemaVersion !== 1) fail('sealed schemaVersion must equal 1');
  if (manifest.releaseTag !== validatedPartial.releaseTag || manifest.sourceCommit !== validatedPartial.sourceCommit) {
    fail('sealed release identity must match the approved partial recovery');
  }
  validateScanner(manifest.scanner, scannerConfig);
  if (
    manifest.scanner.version !== validatedPartial.scanner.version ||
    manifest.scanner.imageRef !== validatedPartial.scanner.imageRef
  ) {
    fail('sealed scanner must match the approved partial recovery');
  }
  if (!Array.isArray(manifest.images) || manifest.images.length !== validatedPartial.images.length) {
    fail(`sealed images must contain exactly ${validatedPartial.images.length} entries`);
  }
  for (const [index, entry] of manifest.images.entries()) {
    const partialEntry = validatedPartial.images[index];
    if (!hasExactKeys(entry, ['name', 'digest'])) fail(`sealed image ${index} keys must be name and digest`);
    if (entry.name !== partialEntry.name || entry.name !== EXPECTED_IMAGES[index]) {
      fail(`sealed image ${index} must equal ${partialEntry.name}`);
    }
    if (!DIGEST.test(entry.digest)) fail(`sealed image ${entry.name} must have a lowercase sha256 digest`);
    if (partialEntry.action === 'preserve' && entry.digest !== partialEntry.digest) {
      fail(`sealed image ${entry.name} digest must preserve the approved value`);
    }
  }
  return freezeManifest(manifest);
}

export async function loadSealedRecoveryManifest({ manifestPath, partialManifestPath, scannerPath }) {
  let manifest;
  let partialManifest;
  let scannerConfig;
  try {
    [manifest, partialManifest, scannerConfig] = await Promise.all([
      readFile(manifestPath, 'utf8').then(JSON.parse),
      readFile(partialManifestPath, 'utf8').then(JSON.parse),
      readFile(scannerPath, 'utf8').then(JSON.parse),
    ]);
  } catch {
    throw new Error('Sealed recovery manifest files could not be read as JSON');
  }
  return validateSealedRecoveryManifest({ manifest, partialManifest, scannerConfig });
}

export function validateRecoveryManifest({ manifest, scannerConfig }) {
  if (!hasExactKeys(manifest, ['schemaVersion', 'releaseTag', 'sourceCommit', 'scanner', 'images'])) {
    fail('manifest keys must be schemaVersion, releaseTag, sourceCommit, scanner, and images');
  }
  if (manifest.schemaVersion !== 1) fail('schemaVersion must equal 1');
  const approvedRecovery = APPROVED_RECOVERIES[manifest.releaseTag];
  if (!approvedRecovery) fail('releaseTag is not approved');
  if (manifest.sourceCommit !== approvedRecovery.sourceCommit || !SHA.test(manifest.sourceCommit)) {
    fail(`sourceCommit must equal ${approvedRecovery.sourceCommit}`);
  }
  if (!hasExactKeys(manifest.scanner, ['version', 'imageRef'])) {
    fail('scanner keys must be version and imageRef');
  }
  if (manifest.scanner.version !== SCANNER_VERSION || manifest.scanner.imageRef !== SCANNER_IMAGE) {
    fail('scanner must match the pinned recovery scanner');
  }
  if (!hasExactKeys(scannerConfig, ['schemaVersion', 'version', 'imageRef'])) {
    fail('scanner config keys must be schemaVersion, version, and imageRef');
  }
  if (
    scannerConfig.schemaVersion !== 1 ||
    scannerConfig.version !== manifest.scanner.version ||
    scannerConfig.imageRef !== manifest.scanner.imageRef
  ) {
    fail('scanner config must equal the recovery scanner');
  }
  if (!Array.isArray(manifest.images) || manifest.images.length !== approvedRecovery.images.length) {
    fail(`images must contain exactly ${approvedRecovery.images.length} entries`);
  }
  for (const [index, entry] of manifest.images.entries()) {
    const approved = approvedRecovery.images[index];
    if (!hasExactKeys(entry, ['name', 'digest'])) fail(`image ${index} keys must be name and digest`);
    if (entry.name !== approved.name || entry.name !== EXPECTED_IMAGES[index]) {
      fail(`image ${index} must equal ${approved.name}`);
    }
    if (!DIGEST.test(entry.digest)) fail(`image ${entry.name} must have a lowercase sha256 digest`);
    if (entry.digest !== approved.digest) fail(`image ${entry.name} digest is not approved`);
  }
  return freezeManifest(manifest);
}

export async function loadRecoveryManifest({ manifestPath, scannerPath }) {
  let manifest;
  let scannerConfig;
  try {
    [manifest, scannerConfig] = await Promise.all([
      readFile(manifestPath, 'utf8').then(JSON.parse),
      readFile(scannerPath, 'utf8').then(JSON.parse),
    ]);
  } catch {
    throw new Error('Recovery manifest files could not be read as JSON');
  }
  return validateRecoveryManifest({ manifest, scannerConfig });
}

export function recoveryImage(manifest, imageName) {
  const entry = manifest.images.find(({ name }) => name === imageName);
  if (!entry) throw new Error(`Recovery manifest has no image: ${imageName}`);
  const tagRef = `${CANONICAL_IMAGE_NAMESPACE}/${entry.name}:${manifest.releaseTag}`;
  return { image: entry.name, tagRef, pullRef: `${tagRef}@${entry.digest}`, digest: entry.digest };
}

function commandRunner(command, args) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function runCommand(run, command, args, label) {
  try {
    return run(command, args);
  } catch {
    throw new Error(`Recovery ${label} command failed`);
  }
}

function requireOutput(output, label) {
  if (typeof output !== 'string' || output.trim() === '') {
    throw new Error(`Recovery ${label} command returned no output`);
  }
  return output.trim();
}

function parseDigest(output) {
  let value;
  try {
    value = JSON.parse(requireOutput(output, 'image inspection'));
  } catch (error) {
    if (error.message.startsWith('Recovery ')) throw error;
    throw new Error('Recovery image inspection returned an invalid digest');
  }
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    throw new Error('Recovery image inspection returned an invalid digest');
  }
  return value;
}

function parsePublicRelease(output) {
  let value;
  try {
    value = JSON.parse(requireOutput(output, 'GitHub release'));
  } catch (error) {
    if (error.message.startsWith('Recovery ')) throw error;
    throw new Error('Recovery GitHub release returned invalid JSON');
  }
  if (
    !hasExactKeys(value, ['tagName', 'targetCommitish', 'isDraft', 'isPrerelease']) ||
    typeof value.tagName !== 'string' || typeof value.targetCommitish !== 'string' ||
    typeof value.isDraft !== 'boolean' || typeof value.isPrerelease !== 'boolean'
  ) {
    throw new Error('Recovery GitHub release returned invalid metadata');
  }
  return value;
}

function parseScannerVersion(output) {
  const match = /^Version:\s+(\d+\.\d+\.\d+)\s*$/.exec(requireOutput(output, 'scanner version'));
  if (!match) throw new Error('Recovery scanner returned an invalid version');
  return match[1];
}

export function verifyRecoveryImage({ manifest, imageName, run = commandRunner }) {
  const expected = recoveryImage(manifest, imageName);
  const actual = parseDigest(runCommand(run, 'docker', [
    'buildx', 'imagetools', 'inspect', expected.tagRef,
    '--format', '{{json .Manifest.Digest}}',
  ], 'image inspection'));
  if (actual !== expected.digest) throw new Error(`Recovery image digest mismatch: ${imageName}`);
  return Object.freeze({ image: imageName, digest: actual, tagRef: expected.tagRef });
}

export function verifyRecoveryPreflight({ manifest, repository, run = commandRunner }) {
  if (typeof repository !== 'string' || repository.trim() === '') {
    throw new Error('Recovery repository is required');
  }
  const tagCommit = requireOutput(
    runCommand(run, 'git', ['rev-parse', `${manifest.releaseTag}^{commit}`], 'release tag'),
    'release tag',
  );
  if (tagCommit !== manifest.sourceCommit) throw new Error('Recovery release tag source mismatch');

  const release = parsePublicRelease(runCommand(run, 'gh', [
    'release', 'view', manifest.releaseTag, '--repo', repository,
    '--json', 'tagName,targetCommitish,isDraft,isPrerelease',
  ], 'GitHub release'));
  if (release.tagName !== manifest.releaseTag || release.targetCommitish !== manifest.sourceCommit) {
    throw new Error('Recovery GitHub release source mismatch');
  }
  if (release.isDraft || release.isPrerelease) throw new Error('Recovery GitHub release is not public');

  const images = manifest.images.map((entry) => {
    const { tagRef } = recoveryImage(manifest, entry.name);
    const digest = parseDigest(runCommand(run, 'docker', [
      'buildx', 'imagetools', 'inspect', tagRef,
      '--format', '{{json .Manifest.Digest}}',
    ], 'image inspection'));
    if (digest !== entry.digest) throw new Error(`Recovery image digest mismatch: ${entry.name}`);
    return Object.freeze({ image: entry.name, digest });
  });

  const scannerVersion = parseScannerVersion(runCommand(
    run,
    'docker',
    ['run', '--rm', manifest.scanner.imageRef, '--version'],
    'scanner version',
  ));
  if (scannerVersion !== manifest.scanner.version) throw new Error('Recovery scanner version mismatch');
  return Object.freeze({ tag: manifest.releaseTag, source: tagCommit, scannerVersion, images: Object.freeze(images) });
}

function partialRecoveryTag(manifest, imageName) {
  const entry = manifest.images.find(({ name }) => name === imageName);
  if (!entry) throw new Error(`Partial recovery manifest has no image: ${imageName}`);
  return `${CANONICAL_IMAGE_NAMESPACE}/${entry.name}:${manifest.releaseTag}`;
}

export function verifyPartialRecoveryPreflight({ manifest, repository, run = commandRunner }) {
  if (typeof repository !== 'string' || repository.trim() === '') {
    throw new Error('Recovery repository is required');
  }
  const partial = validatePartialRecoveryManifest({
    manifest,
    scannerConfig: { schemaVersion: 1, version: SCANNER_VERSION, imageRef: SCANNER_IMAGE },
  });
  const tagCommit = requireOutput(
    runCommand(run, 'git', ['rev-parse', `${partial.releaseTag}^{commit}`], 'release tag'),
    'release tag',
  );
  if (tagCommit !== partial.sourceCommit) throw new Error('Recovery release tag source mismatch');
  const release = parsePublicRelease(runCommand(run, 'gh', [
    'release', 'view', partial.releaseTag, '--repo', repository,
    '--json', 'tagName,targetCommitish,isDraft,isPrerelease',
  ], 'GitHub release'));
  if (release.tagName !== partial.releaseTag || release.targetCommitish !== partial.sourceCommit) {
    throw new Error('Recovery GitHub release source mismatch');
  }
  if (release.isDraft || release.isPrerelease) throw new Error('Recovery GitHub release is not public');
  const images = partial.images
    .filter(({ action }) => action === 'preserve')
    .map((entry) => {
      const tagRef = partialRecoveryTag(partial, entry.name);
      const digest = parseDigest(runCommand(run, 'docker', [
        'buildx', 'imagetools', 'inspect', tagRef,
        '--format', '{{json .Manifest.Digest}}',
      ], 'image inspection'));
      if (digest !== entry.digest) throw new Error(`Recovery image digest mismatch: ${entry.name}`);
      return Object.freeze({ image: entry.name, digest });
    });
  const scannerVersion = parseScannerVersion(runCommand(
    run,
    'docker',
    ['run', '--rm', partial.scanner.imageRef, '--version'],
    'scanner version',
  ));
  if (scannerVersion !== partial.scanner.version) throw new Error('Recovery scanner version mismatch');
  return Object.freeze({ tag: partial.releaseTag, source: tagCommit, scannerVersion, images: Object.freeze(images) });
}

async function readBuildDigestRecords(directory) {
  let files;
  try {
    files = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new Error('Recovery build digest records could not be read');
  }
  if (files.length !== 5 || files.some((file) => !file.isFile() || !file.name.endsWith('.json'))) {
    throw new Error('Recovery build digest records must contain exactly five JSON files');
  }
  const records = {};
  for (const file of files) {
    let record;
    try {
      record = JSON.parse(await readFile(`${directory}/${file.name}`, 'utf8'));
    } catch {
      throw new Error('Recovery build digest record is not valid JSON');
    }
    if (!hasExactKeys(record, ['image', 'digest']) || typeof record.image !== 'string' || !DIGEST.test(record.digest) || Object.hasOwn(records, record.image)) {
      throw new Error('Recovery build digest record is invalid');
    }
    records[record.image] = record.digest;
  }
  return records;
}

function inspectRegistryDigests(partialManifest, run = commandRunner) {
  return Object.fromEntries(partialManifest.images.map((entry) => {
    const tagRef = partialRecoveryTag(partialManifest, entry.name);
    const digest = parseDigest(runCommand(run, 'docker', [
      'buildx', 'imagetools', 'inspect', tagRef,
      '--format', '{{json .Manifest.Digest}}',
    ], 'image inspection'));
    return [entry.name, digest];
  }));
}

function parseSealedManifestEnvironment(partialManifest, scannerConfig) {
  const encoded = process.env.SEALED_RECOVERY_MANIFEST_B64;
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error('Recovery sealed manifest environment is invalid');
  }
  let text;
  let manifest;
  try {
    text = Buffer.from(encoded, 'base64').toString('utf8');
    if (Buffer.from(text, 'utf8').toString('base64') !== encoded) throw new Error('not canonical');
    manifest = JSON.parse(text);
  } catch {
    throw new Error('Recovery sealed manifest environment is invalid');
  }
  return validateSealedRecoveryManifest({ manifest, partialManifest, scannerConfig });
}

async function writeSealedManifest(outputPath, manifest) {
  try {
    await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch {
    throw new Error('Recovery sealed manifest could not be written');
  }
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  const commands = ['validate', 'verify-all', 'verify-image', 'image', 'validate-partial', 'verify-partial', 'seal', 'materialize-sealed', 'sealed-image'];
  if (!commands.includes(command)) {
    throw new Error('Recovery command is not recognized');
  }
  const allowed = new Set(['manifest', 'scanner', 'repository', 'image', 'partial-manifest', 'build-digests', 'output']);
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith('--') || value === undefined || !allowed.has(flag.slice(2)) || Object.hasOwn(values, flag.slice(2))) {
      throw new Error('Recovery command arguments are invalid');
    }
    values[flag.slice(2)] = value;
  }
  const required = {
    validate: ['manifest', 'scanner'],
    'verify-all': ['manifest', 'scanner', 'repository'],
    'verify-image': ['manifest', 'scanner', 'image'],
    image: ['manifest', 'scanner', 'image'],
    'validate-partial': ['manifest', 'scanner'],
    'verify-partial': ['manifest', 'scanner', 'repository'],
    seal: ['manifest', 'scanner', 'build-digests', 'output'],
    'materialize-sealed': ['manifest', 'scanner', 'output'],
    'sealed-image': ['manifest', 'scanner', 'partial-manifest', 'image'],
  }[command];
  if (Object.keys(values).length !== required.length || required.some((name) => !values[name])) {
    throw new Error('Recovery command arguments are invalid');
  }
  return { command, values };
}

async function writeImageOutput(image) {
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `tag_ref=${image.tagRef}\npull_ref=${image.pullRef}\ndigest=${image.digest}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(image)}\n`);
}

export async function runCli(argv = process.argv.slice(2)) {
  const { command, values } = parseCli(argv);
  if (['validate', 'verify-all', 'verify-image', 'image'].includes(command)) {
    const manifest = await loadRecoveryManifest({ manifestPath: values.manifest, scannerPath: values.scanner });
    if (command === 'validate') return;
    if (command === 'verify-all') {
      process.stdout.write(`${JSON.stringify(verifyRecoveryPreflight({ manifest, repository: values.repository }))}\n`);
      return;
    }
    if (command === 'verify-image') {
      process.stdout.write(`${JSON.stringify(verifyRecoveryImage({ manifest, imageName: values.image }))}\n`);
      return;
    }
    await writeImageOutput(recoveryImage(manifest, values.image));
    return;
  }
  if (command === 'sealed-image') {
    const sealed = await loadSealedRecoveryManifest({
      manifestPath: values.manifest,
      partialManifestPath: values['partial-manifest'],
      scannerPath: values.scanner,
    });
    await writeImageOutput(recoveryImage(sealed, values.image));
    return;
  }
  const partialManifest = await loadPartialRecoveryManifest({ manifestPath: values.manifest, scannerPath: values.scanner });
  if (command === 'validate-partial') return;
  if (command === 'verify-partial') {
    process.stdout.write(`${JSON.stringify(verifyPartialRecoveryPreflight({ manifest: partialManifest, repository: values.repository }))}\n`);
    return;
  }
  if (command === 'seal') {
    const buildDigests = await readBuildDigestRecords(values['build-digests']);
    const sealed = sealRecoveryManifest({
      partialManifest,
      buildDigests,
      registryDigests: inspectRegistryDigests(partialManifest),
    });
    await writeSealedManifest(values.output, sealed);
    if (!process.env.GITHUB_OUTPUT) throw new Error('Recovery seal requires GITHUB_OUTPUT');
    await appendFile(process.env.GITHUB_OUTPUT, `manifest_b64=${Buffer.from(JSON.stringify(sealed)).toString('base64')}\n`);
    return;
  }
  if (command === 'materialize-sealed') {
    await writeSealedManifest(values.output, parseSealedManifestEnvironment(partialManifest, {
      schemaVersion: 1,
      version: SCANNER_VERSION,
      imageRef: SCANNER_IMAGE,
    }));
    return;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

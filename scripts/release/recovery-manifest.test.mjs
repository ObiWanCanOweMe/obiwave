import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as manifestModule from './recovery-manifest.mjs';
import { EXPECTED_IMAGES } from '../security/trivy-policy.mjs';

const scannerConfig = {
  schemaVersion: 1,
  version: '0.67.2',
  imageRef: 'aquasec/trivy@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08',
};

function exactV13Manifest() {
  return {
    schemaVersion: 1,
    releaseTag: 'v1.3.0-obiwave.2',
    sourceCommit: '41c8a329670f99c3b440a468adbb9fe2d900a4fe',
    scanner: {
      version: '0.67.2',
      imageRef: 'aquasec/trivy@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08',
    },
    images: [
      { name: 'subwave-caddy', digest: 'sha256:10a653cd8eb73a4aa55998d4f499ed7184a37ae99a41c2222f7a9434175290cd' },
      { name: 'subwave-broadcast', digest: 'sha256:e983017f0bae67fa10cd7bf9833403227c2e193492175087e03bb8ac99df236b' },
      { name: 'subwave-controller', digest: 'sha256:e516778b297cc92f65b22e2336a2a8c7c16618f63fe19746f01dc9dbf405f7f6' },
      { name: 'subwave-web', digest: 'sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f' },
      { name: 'subwave-aio', digest: 'sha256:50e961965b7f449f330c83e8942fea58d02a7dc5265e3efa8c3600017f48166e' },
      { name: 'subwave-aio-heavy', digest: 'sha256:48c0e3bd7fc6dba4e8dc01b6eec12b267be9ac1635d7af15e8a5710724c3427d' },
      { name: 'subwave-tts-heavy', digest: 'sha256:ee4dd62bf79eddbf6329ea059e5e172ef176c87353c18d05dd1ec3c0f0c53025' },
      { name: 'subwave-analyzer', digest: 'sha256:be9a81fd5b43c97e4093399aebc8d00cfdfa656d032602e7ca0644e49934164f' },
      { name: 'subwave-analyzer-heavy', digest: 'sha256:82e7c5bef067ffe35db03a2bbe08c518e764fb61065eee34af4213aede4ebe00' },
      { name: 'subwave-analyzer-cuda', digest: 'sha256:c6964797b8a88dd2fa9291778543c27594350aba84c7c2f2d25560cd5150bb72' },
    ],
  };
}

function exactV15Manifest() {
  return {
    schemaVersion: 1,
    releaseTag: 'v1.5.0-obiwave.1',
    sourceCommit: 'fe269a1e632fe6f886ac987f641f41326e1392e0',
    scanner: {
      version: '0.67.2',
      imageRef: 'aquasec/trivy@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08',
    },
    images: [
      { name: 'subwave-caddy', digest: 'sha256:cdf89341b5a0c5c31493f6b2653b45631aac6e184148af8a46db02ff3072f235' },
      { name: 'subwave-broadcast', digest: 'sha256:32eb3d4c2a4146e31f37a389bc4d3b8309d3f13bf31edf5e7bf3a687f96ad5d0' },
      { name: 'subwave-controller', digest: 'sha256:5aa26e9be46fdb2d733e7da2c74af63bbfeb7630575cae6bcbf0bf7c9b29ee55' },
      { name: 'subwave-web', digest: 'sha256:f2f635a3b9d581db1478a74e5dfddbdae6faa31bb4b7694c7e03095915130008' },
      { name: 'subwave-aio', digest: 'sha256:f745b4ae1133af9e77f1006ccf2ca219a6df0243451b4e633c143f0b6cc1ab8a' },
      { name: 'subwave-aio-heavy', digest: 'sha256:2d37d9c15e88b90523c437e8330c7245050f92a2eefc513ac6a556ca7c68a90b' },
      { name: 'subwave-tts-heavy', digest: 'sha256:41a6be4327f9f321b0993da4bac93a6359e440c1c26f7af52b663bcb083a3784' },
      { name: 'subwave-analyzer', digest: 'sha256:ec22ae65a95f60d070414b2fa73a7ec481190d66355426ce1cdbfdb142ef9f2c' },
      { name: 'subwave-analyzer-heavy', digest: 'sha256:290e2cd443bcee737fc4806f77384f172858e133f4fc0c0292195be9d53c9c5c' },
      { name: 'subwave-analyzer-cuda', digest: 'sha256:a69d2f866eb9d991a69212b5605c15a3631d4d21cec8c4608a6cb29f9d7c9cc2' },
    ],
  };
}

function exactV16Manifest() {
  return {
    schemaVersion: 1,
    releaseTag: 'v1.6.0-obiwave.1',
    sourceCommit: '87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787',
    scanner: {
      version: '0.67.2',
      imageRef: 'aquasec/trivy@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08',
    },
    images: [
      { name: 'subwave-caddy', digest: 'sha256:2721393a1eb3080e4dc6114893ac6a0472a258b8e32654f1b2a9c63a926c050f' },
      { name: 'subwave-broadcast', digest: 'sha256:a623e516992ade44d83ac72c231d2ecc278eb71c613d04212936a5ec03237c2f' },
      { name: 'subwave-controller', digest: 'sha256:fe765d8f9a491012c33c6828686cb350aa2e6f84acffd170fc038b4be93c614f' },
      { name: 'subwave-web', digest: 'sha256:0c6e1f925433dfb23c76022209eee614ffae0559a53e0b4b49e4f0c22a169c44' },
      { name: 'subwave-aio', digest: 'sha256:6d1c79424e19348653f929f0687582984d46fc964cdc388a49a03d58b8d3b1fe' },
      { name: 'subwave-aio-heavy', digest: 'sha256:8da2822e6e0053228442e1d379b4ef208858f9ab9f1863e4737db545c408d0b4' },
      { name: 'subwave-tts-heavy', digest: 'sha256:8e783b7067cfa172feca4cbc88d4d5100af29ee1d663db28d18aad42fec3bd15' },
      { name: 'subwave-analyzer', digest: 'sha256:4d4aaac6121f24699b3de79c00572afe87fd7c971b8b02c81c6bec12c7e1a1c9' },
      { name: 'subwave-analyzer-heavy', digest: 'sha256:9b058fd453db1811d2ff1928092b9e52320d62b0defa377baebeeb3a0da1a7ca' },
      { name: 'subwave-analyzer-cuda', digest: 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341' },
    ],
  };
}

function exactV16Revision2Manifest() {
  return {
    schemaVersion: 1,
    releaseTag: 'v1.6.0-obiwave.2',
    sourceCommit: '28076250da60844457973794933b5af3b82fa1dc',
    scanner: {
      version: '0.67.2',
      imageRef: 'aquasec/trivy@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08',
    },
    images: [
      { name: 'subwave-caddy', digest: 'sha256:03315a161f65eb17c1d31de1b01e5b3754a7fdf7e37f85fa90df7a6a13ab416d' },
      { name: 'subwave-broadcast', digest: 'sha256:da1347715f0830ef089dba511e750752340220103e25fb2d7c62d081c39af270' },
      { name: 'subwave-controller', digest: 'sha256:3735c284f0c10e59e691c3d3605e741cfbde266850bb11cd9315699dcd81592e' },
      { name: 'subwave-web', digest: 'sha256:5cced33d7555185218bed805997e6547ae4b8bc978aaf35f828713ddc518a6c3' },
      { name: 'subwave-aio', digest: 'sha256:f3b54ec397d032cf551fffb70275d9a4e2fe3c810a6389075846e5cbbb2c9ca5' },
      { name: 'subwave-aio-heavy', digest: 'sha256:d75e67787e3e409e69ba312218a993dda15b0f8bebc4ef2ee3dd2b302a27ab49' },
      { name: 'subwave-tts-heavy', digest: 'sha256:0243b5ba48aa771d31036597c8c9c8f834f1bd5db8f6ce5b5584df76dd80e4fa' },
      { name: 'subwave-analyzer', digest: 'sha256:e72b6d318c652d1dd3938087b83e4c9251f3d9cc401d0a3cd2f833e49ebca1ea' },
      { name: 'subwave-analyzer-heavy', digest: 'sha256:ddc2dcc05de5f35fe38897417e7cddc47a70ff72856766321baac5c70d3a1cf7' },
      { name: 'subwave-analyzer-cuda', digest: 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341' },
    ],
  };
}

function exactV16Revision3Manifest() {
  return {
    schemaVersion: 1,
    releaseTag: 'v1.6.0-obiwave.3',
    sourceCommit: '47a76f4cb5b45a26307ba4ebfcf7c77f66405492',
    scanner: {
      version: '0.67.2',
      imageRef: 'aquasec/trivy@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08',
    },
    images: [
      { name: 'subwave-caddy', digest: 'sha256:201ac36144dd5aac2053ec6558c7a5af56befb8539de248d16a5afa2e4e523f4' },
      { name: 'subwave-broadcast', digest: 'sha256:516403e48ce839ddd36d09dd7f9f141b727aff56bfe293dfc0874e28c4f79d6b' },
      { name: 'subwave-controller', digest: 'sha256:540b4ee5e147e874a85c1e191f4195cc6c11d71f995951d985f98da9ce056997' },
      { name: 'subwave-web', digest: 'sha256:fe1da1ce8bf418953a080b9372985cedd8eab7cfbf007b145e8de2c4dda9eef8' },
      { name: 'subwave-aio', digest: 'sha256:8ac05fc188da2fa10d11b108775a3d41b14baa76b120a8fbec76e2c8bdc4317c' },
      { name: 'subwave-aio-heavy', digest: 'sha256:9bc62cda75bbfeea18ab4e3b7a1c2292c86cfa4034b8a336ac722daa3a67230e' },
      { name: 'subwave-tts-heavy', digest: 'sha256:8c87ff0b738f839ffe7cc9235bca318ce2fb9f6a2630b6ba0be306a988eec8f9' },
      { name: 'subwave-analyzer', digest: 'sha256:3dc8f420425e48768b0ab6d733aa3e47d5d883e067632dc6483ed0f4d5a1798f' },
      { name: 'subwave-analyzer-heavy', digest: 'sha256:5141e66cf1f953f6a4c7c4e753c86ed1556da7912d860369a069f7d9eafe1d15' },
      { name: 'subwave-analyzer-cuda', digest: 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341' },
    ],
  };
}

function exactV16Revision4Manifest() {
  return {
    schemaVersion: 1,
    releaseTag: 'v1.6.0-obiwave.4',
    sourceCommit: 'b96ef42c6a014ecf96964809a42370ad5e6954ea',
    scanner: {
      version: '0.67.2',
      imageRef: 'aquasec/trivy@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08',
    },
    images: [
      { name: 'subwave-caddy', digest: 'sha256:94362b8a08bbaa4d4b34eb20cbf6c4aef786fb5ab9d306b3d11b0a8fbb5ad4d1' },
      { name: 'subwave-broadcast', digest: 'sha256:9611d7b063a70cc96f94f02d4ba2574724f748c4bdca40a4c1d58dcfab75d459' },
      { name: 'subwave-controller', digest: 'sha256:9069bd7362c4c8cad3554ddfc4d82f7dcabac25d52337b276f3c72721c3a0d98' },
      { name: 'subwave-web', digest: 'sha256:8404a8d593bcff6866ab8ea8aa5f63dcae46963997ac08adf797e6b8fb67fc61' },
      { name: 'subwave-aio', digest: 'sha256:4448bcb829f93c3f537bf75b9b4a341f02ee10bc057201f1e8cdd4fe49391955' },
      { name: 'subwave-aio-heavy', digest: 'sha256:31aa0db54828e4a402ac1d3439bb0e2a5358921ca8ce0b0a8764affaffbb01a4' },
      { name: 'subwave-tts-heavy', digest: 'sha256:5f54595798f04ac2869ab51d56859da5d678add3f217d8046a3f216a6a2fd0a4' },
      { name: 'subwave-analyzer', digest: 'sha256:cc368beaa0913e8359edac0bc9cadc20853e0f3b78aff4e5361f518662388594' },
      { name: 'subwave-analyzer-heavy', digest: 'sha256:7765bccbb8ab223cb40856419d702ba091904e7a34a317fd1fc6a201a8b0f082' },
      { name: 'subwave-analyzer-cuda', digest: 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341' },
    ],
  };
}

function exactV17Manifest() {
  return {
    schemaVersion: 1,
    releaseTag: 'v1.7.0-obiwave.1',
    sourceCommit: '62c7c9cf9f73256a4499d4b0aad9b3388866a46b',
    scanner: {
      version: '0.67.2',
      imageRef: 'aquasec/trivy@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08',
    },
    images: [
      { name: 'subwave-caddy', digest: 'sha256:591b4e7b511097335d27aba289e58baa85ff80df87c85a8447ed9b2b559a9b2d' },
      { name: 'subwave-broadcast', digest: 'sha256:cef32c8b4289d7ff366b809321a2da3d19f27d991260c9a473177a6a029371d7' },
      { name: 'subwave-controller', digest: 'sha256:b0f8e0de367970ec765384c24bd4070229f3b88e4e7db01f91fabe827c62a2dc' },
      { name: 'subwave-web', digest: 'sha256:cf973b3e18dbd3eb1e7769d30c76429605898975a476be0dd1350dc0f7dd4b6a' },
      { name: 'subwave-aio', digest: 'sha256:cd7956245880da40e66646ff28571409f5d1fbd4e26253760ad5f81208b65a11' },
      { name: 'subwave-aio-heavy', digest: 'sha256:c73ced1117cfe15ce085b9744b998c55945fb92d549d2c1a5548b2d68eefedd5' },
      { name: 'subwave-tts-heavy', digest: 'sha256:ae75b8c439cf1541cdb5a9b536298b93b46ed58e1068ec7df861774b15d62007' },
      { name: 'subwave-analyzer', digest: 'sha256:00b1220098b08b6ecce4d9d9c796a55e1cd78fa19f8aa18271048c8cab856868' },
      { name: 'subwave-analyzer-heavy', digest: 'sha256:8520a2dd063ace1b5d7a17d96815b880ce08db9dee8fd882a8ae57bc34efe5c7' },
      { name: 'subwave-analyzer-cuda', digest: 'sha256:8fc7c81ea43a118d1c9d79da14986efa4876674745ac6ed6af166c202439990b' },
    ],
  };
}

function exactV16PartialManifest() {
  return {
    schemaVersion: 2,
    kind: 'partial-publication-recovery',
    releaseTag: 'v1.6.0-obiwave.1',
    sourceCommit: '87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787',
    scanner: { version: scannerConfig.version, imageRef: scannerConfig.imageRef },
    images: [
      { name: 'subwave-caddy', action: 'build' },
      { name: 'subwave-broadcast', action: 'preserve', digest: 'sha256:a623e516992ade44d83ac72c231d2ecc278eb71c613d04212936a5ec03237c2f' },
      { name: 'subwave-controller', action: 'preserve', digest: 'sha256:fe765d8f9a491012c33c6828686cb350aa2e6f84acffd170fc038b4be93c614f' },
      { name: 'subwave-web', action: 'build' },
      { name: 'subwave-aio', action: 'preserve', digest: 'sha256:6d1c79424e19348653f929f0687582984d46fc964cdc388a49a03d58b8d3b1fe' },
      { name: 'subwave-aio-heavy', action: 'build' },
      { name: 'subwave-tts-heavy', action: 'build' },
      { name: 'subwave-analyzer', action: 'preserve', digest: 'sha256:4d4aaac6121f24699b3de79c00572afe87fd7c971b8b02c81c6bec12c7e1a1c9' },
      { name: 'subwave-analyzer-heavy', action: 'build' },
      { name: 'subwave-analyzer-cuda', action: 'preserve', digest: 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341' },
    ],
  };
}

test('accepts only the approved partial recovery identity', () => {
  const value = manifestModule.validatePartialRecoveryManifest({
    manifest: exactV16PartialManifest(), scannerConfig,
  });
  assert.equal(value.releaseTag, 'v1.6.0-obiwave.1');
  assert.equal(value.images.filter((image) => image.action === 'build').length, 5);
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.images));
  assert.ok(Object.isFrozen(value.images[0]));
});

function rejectsPartial(label, mutate) {
  test(`partial recovery rejects ${label}`, () => {
    const manifest = exactV16PartialManifest();
    mutate(manifest);
    assert.throws(
      () => manifestModule.validatePartialRecoveryManifest({ manifest, scannerConfig }),
      /Recovery manifest invalid:/,
    );
  });
}

rejectsPartial('a changed source', (manifest) => { manifest.sourceCommit = 'a'.repeat(40); });
rejectsPartial('a changed scanner', (manifest) => { manifest.scanner.version = '0.68.0'; });
rejectsPartial('a changed action', (manifest) => { manifest.images[0].action = 'preserve'; });
rejectsPartial('a changed preserved digest', (manifest) => { manifest.images[1].digest = `sha256:${'a'.repeat(64)}`; });
rejectsPartial('out-of-order images', (manifest) => { [manifest.images[0], manifest.images[1]] = [manifest.images[1], manifest.images[0]]; });
rejectsPartial('a missing image', (manifest) => { manifest.images.pop(); });
rejectsPartial('an extra image', (manifest) => { manifest.images.push({ name: 'subwave-surprise', action: 'build' }); });
rejectsPartial('a digest on a build image', (manifest) => { manifest.images[0].digest = `sha256:${'a'.repeat(64)}`; });
rejectsPartial('a missing digest on a preserved image', (manifest) => { delete manifest.images[1].digest; });

const buildDigests = Object.freeze({
  'subwave-caddy': `sha256:${'1'.repeat(64)}`,
  'subwave-web': `sha256:${'2'.repeat(64)}`,
  'subwave-aio-heavy': `sha256:${'3'.repeat(64)}`,
  'subwave-tts-heavy': `sha256:${'4'.repeat(64)}`,
  'subwave-analyzer-heavy': `sha256:${'5'.repeat(64)}`,
});

function exactV16RegistryDigests() {
  return Object.fromEntries(exactV16PartialManifest().images.map((image) => [
    image.name,
    image.action === 'build' ? buildDigests[image.name] : image.digest,
  ]));
}

function exactV16SealedManifest() {
  return {
    schemaVersion: 1,
    releaseTag: 'v1.6.0-obiwave.1',
    sourceCommit: '87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787',
    scanner: { version: scannerConfig.version, imageRef: scannerConfig.imageRef },
    images: exactV16PartialManifest().images.map((image) => ({
      name: image.name,
      digest: image.action === 'build' ? buildDigests[image.name] : image.digest,
    })),
  };
}

test('seals partial recovery build and registry evidence into a canonical manifest', () => {
  const sealed = manifestModule.sealRecoveryManifest({
    partialManifest: exactV16PartialManifest(),
    buildDigests,
    registryDigests: exactV16RegistryDigests(),
  });
  assert.deepEqual(sealed, exactV16SealedManifest());
  assert.ok(Object.isFrozen(sealed));
  assert.ok(Object.isFrozen(sealed.images));
  assert.ok(Object.isFrozen(sealed.images[0]));
});

test('validates a sealed recovery manifest against the approved partial identity', () => {
  const sealed = manifestModule.validateSealedRecoveryManifest({
    manifest: exactV16SealedManifest(),
    partialManifest: exactV16PartialManifest(),
    scannerConfig,
  });
  assert.deepEqual(sealed, exactV16SealedManifest());
});

function rejectsSeal(label, mutate) {
  test(`seal rejects ${label}`, () => {
    const input = {
      partialManifest: exactV16PartialManifest(),
      buildDigests: { ...buildDigests },
      registryDigests: exactV16RegistryDigests(),
    };
    mutate(input);
    assert.throws(
      () => manifestModule.sealRecoveryManifest(input),
      /Recovery manifest invalid:/,
    );
  });
}

rejectsSeal('missing build evidence', (input) => { delete input.buildDigests['subwave-web']; });
rejectsSeal('extra build evidence', (input) => { input.buildDigests['subwave-surprise'] = `sha256:${'a'.repeat(64)}`; });
rejectsSeal('a changed preserved digest', (input) => { input.registryDigests['subwave-broadcast'] = `sha256:${'a'.repeat(64)}`; });
rejectsSeal('registry and build digest disagreement', (input) => { input.registryDigests['subwave-web'] = `sha256:${'a'.repeat(64)}`; });
rejectsSeal('a malformed build digest', (input) => { input.buildDigests['subwave-web'] = 'sha256:bad'; });
rejectsSeal('registry evidence in the wrong order', (input) => {
  input.registryDigests = Object.fromEntries(Object.entries(input.registryDigests).reverse());
});
rejectsSeal('a foreign registry image', (input) => { input.registryDigests['subwave-surprise'] = `sha256:${'a'.repeat(64)}`; });

function rejectsSealed(label, mutate) {
  test(`sealed recovery rejects ${label}`, () => {
    const manifest = exactV16SealedManifest();
    mutate(manifest);
    assert.throws(
      () => manifestModule.validateSealedRecoveryManifest({
        manifest,
        partialManifest: exactV16PartialManifest(),
        scannerConfig,
      }),
      /Recovery manifest invalid:/,
    );
  });
}

rejectsSealed('a changed preserved digest', (manifest) => { manifest.images[1].digest = `sha256:${'a'.repeat(64)}`; });
rejectsSealed('a malformed build digest', (manifest) => { manifest.images[0].digest = 'sha256:bad'; });
rejectsSealed('out-of-order images', (manifest) => { [manifest.images[0], manifest.images[1]] = [manifest.images[1], manifest.images[0]]; });
rejectsSealed('a foreign image', (manifest) => { manifest.images[0].name = 'subwave-surprise'; });

function rejects(label, mutate) {
  for (const [release, exactManifest] of [
    ['v1.3', exactV13Manifest],
    ['v1.5', exactV15Manifest],
    ['v1.6 revision 1', exactV16Manifest],
    ['v1.6 revision 2', exactV16Revision2Manifest],
    ['v1.6 revision 3', exactV16Revision3Manifest],
    ['v1.6 revision 4', exactV16Revision4Manifest],
    ['v1.7 revision 1', exactV17Manifest],
  ]) {
    test(`rejects ${label} for ${release}`, () => {
      const manifest = exactManifest();
      mutate(manifest);
      assert.throws(
        () => manifestModule.validateRecoveryManifest({ manifest, scannerConfig }),
        /Recovery manifest invalid:/,
      );
    });
  }
}

test('accepts each literal approved recovery identity', () => {
  for (const [manifest, tag, source] of [
    [exactV13Manifest(), 'v1.3.0-obiwave.2', '41c8a329670f99c3b440a468adbb9fe2d900a4fe'],
    [exactV15Manifest(), 'v1.5.0-obiwave.1', 'fe269a1e632fe6f886ac987f641f41326e1392e0'],
    [exactV16Manifest(), 'v1.6.0-obiwave.1', '87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787'],
    [exactV16Revision2Manifest(), 'v1.6.0-obiwave.2', '28076250da60844457973794933b5af3b82fa1dc'],
    [exactV16Revision3Manifest(), 'v1.6.0-obiwave.3', '47a76f4cb5b45a26307ba4ebfcf7c77f66405492'],
    [exactV16Revision4Manifest(), 'v1.6.0-obiwave.4', 'b96ef42c6a014ecf96964809a42370ad5e6954ea'],
    [exactV17Manifest(), 'v1.7.0-obiwave.1', '62c7c9cf9f73256a4499d4b0aad9b3388866a46b'],
  ]) {
    const value = manifestModule.validateRecoveryManifest({ manifest, scannerConfig });
    assert.equal(value.releaseTag, tag);
    assert.equal(value.sourceCommit, source);
    assert.equal(value.images.length, 10);
    assert.ok(Object.isFrozen(value));
    assert.ok(Object.isFrozen(value.images));
  }
});

test('historical recovery images stay bound to their approved record after live policy expansion', () => {
  assert.deepEqual(EXPECTED_IMAGES, [
    'subwave-caddy',
    'subwave-broadcast',
    'subwave-controller',
    'subwave-web',
    'subwave-aio',
    'subwave-aio-heavy',
    'subwave-tts-heavy',
    'subwave-tts-heavy-cuda',
    'subwave-analyzer',
    'subwave-analyzer-heavy',
    'subwave-analyzer-cuda',
  ]);

  const approved = manifestModule.validateRecoveryManifest({
    manifest: exactV13Manifest(),
    scannerConfig,
  });
  assert.equal(approved.images.length, 10);

  const wrongName = exactV13Manifest();
  wrongName.images[6].name = 'subwave-tts-heavy-cuda';
  assert.throws(
    () => manifestModule.validateRecoveryManifest({ manifest: wrongName, scannerConfig }),
    /image 6 must equal subwave-tts-heavy/,
  );

  const wrongOrder = exactV13Manifest();
  [wrongOrder.images[6], wrongOrder.images[7]] = [wrongOrder.images[7], wrongOrder.images[6]];
  assert.throws(
    () => manifestModule.validateRecoveryManifest({ manifest: wrongOrder, scannerConfig }),
    /image 6 must equal subwave-tts-heavy/,
  );
});

test('rejects a valid manifest assembled from cross-release identity parts', () => {
  const manifest = exactV15Manifest();
  manifest.sourceCommit = exactV13Manifest().sourceCommit;
  assert.throws(
    () => manifestModule.validateRecoveryManifest({ manifest, scannerConfig }),
    /Recovery manifest invalid:/,
  );
});

test('rejects an unsupported recovery tag even when its manifest is internally consistent', () => {
  const manifest = exactV15Manifest();
  manifest.releaseTag = 'v9.9.9-obiwave.9';
  assert.throws(
    () => manifestModule.validateRecoveryManifest({ manifest, scannerConfig }),
    /releaseTag is not approved/,
  );
});

test('returns canonical and digest-qualified references', () => {
  assert.deepEqual(manifestModule.recoveryImage(exactV13Manifest(), 'subwave-web'), {
    image: 'subwave-web',
    tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2',
    pullRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2@sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f',
    digest: 'sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f',
  });
  assert.deepEqual(manifestModule.recoveryImage(exactV16Manifest(), 'subwave-caddy'), {
    image: 'subwave-caddy',
    tagRef: 'ghcr.io/obiwancanoweme/subwave-caddy:v1.6.0-obiwave.1',
    pullRef: 'ghcr.io/obiwancanoweme/subwave-caddy:v1.6.0-obiwave.1@sha256:2721393a1eb3080e4dc6114893ac6a0472a258b8e32654f1b2a9c63a926c050f',
    digest: 'sha256:2721393a1eb3080e4dc6114893ac6a0472a258b8e32654f1b2a9c63a926c050f',
  });
  assert.deepEqual(manifestModule.recoveryImage(exactV16Revision2Manifest(), 'subwave-analyzer-cuda'), {
    image: 'subwave-analyzer-cuda',
    tagRef: 'ghcr.io/obiwancanoweme/subwave-analyzer-cuda:v1.6.0-obiwave.2',
    pullRef: 'ghcr.io/obiwancanoweme/subwave-analyzer-cuda:v1.6.0-obiwave.2@sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341',
    digest: 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341',
  });
});

rejects('a wrong fork tag', (manifest) => { manifest.releaseTag = 'v1.3.0'; });
rejects('a wrong source commit', (manifest) => { manifest.sourceCommit = 'a'.repeat(40); });
rejects('a wrong scanner version', (manifest) => { manifest.scanner.version = '0.68.0'; });
rejects('a wrong scanner image', (manifest) => {
  manifest.scanner.imageRef = 'aquasec/trivy@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
});
for (const [release, exactManifest] of [
  ['v1.3', exactV13Manifest],
  ['v1.5', exactV15Manifest],
  ['v1.6 revision 1', exactV16Manifest],
  ['v1.6 revision 2', exactV16Revision2Manifest],
  ['v1.6 revision 3', exactV16Revision3Manifest],
  ['v1.6 revision 4', exactV16Revision4Manifest],
  ['v1.7 revision 1', exactV17Manifest],
]) {
  test(`rejects scanner-config disagreement for ${release}`, () => {
    assert.throws(
      () => manifestModule.validateRecoveryManifest({
        manifest: exactManifest(),
        scannerConfig: { ...scannerConfig, version: '0.68.0' },
      }),
      /Recovery manifest invalid:/,
    );
  });
}
rejects('a foreign image namespace', (manifest) => { manifest.images[0].name = 'ghcr.io/foreign/subwave-caddy'; });
rejects('an uppercase digest', (manifest) => { manifest.images[0].digest = `sha256:${'A'.repeat(64)}`; });
rejects('a malformed digest', (manifest) => { manifest.images[0].digest = 'sha256:abc'; });
rejects('a valid lowercase digest that is not approved for the image', (manifest) => {
  manifest.images[0].digest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
});
rejects('a duplicate image', (manifest) => { manifest.images[1].name = 'subwave-caddy'; });
rejects('a missing image', (manifest) => { manifest.images.pop(); });
rejects('an extra image', (manifest) => {
  manifest.images.push({ name: 'subwave-surprise', digest: `sha256:${'a'.repeat(64)}` });
});
rejects('out-of-order images', (manifest) => { [manifest.images[0], manifest.images[1]] = [manifest.images[1], manifest.images[0]]; });
rejects('an unexpected manifest key', (manifest) => { manifest.unexpected = true; });

test('rejects an unknown image lookup', () => {
  assert.throws(
    () => manifestModule.recoveryImage(exactV13Manifest(), 'subwave-surprise'),
    /Recovery manifest has no image: subwave-surprise/,
  );
});

function digestOutput(name) {
  return JSON.stringify(exactV13Manifest().images.find((image) => image.name === name).digest);
}

function preflightRunner(overrides = {}) {
  const calls = [];
  const run = (command, args) => {
    calls.push({ command, args });
    if (command === 'git') return overrides.git ?? '41c8a329670f99c3b440a468adbb9fe2d900a4fe\n';
    if (command === 'gh') return overrides.release ?? JSON.stringify({
      tagName: 'v1.3.0-obiwave.2',
      targetCommitish: '41c8a329670f99c3b440a468adbb9fe2d900a4fe',
      isDraft: false,
      isPrerelease: false,
    });
    if (args[0] === 'run') return overrides.scanner ?? 'Version: 0.67.2\n';
    const image = args[3].split('/').at(-1).split(':')[0];
    return overrides[image] ?? digestOutput(image);
  };
  return { calls, run };
}

test('verifies one image with the exact inspected digest', () => {
  const { calls, run } = preflightRunner();
  assert.deepEqual(manifestModule.verifyRecoveryImage({
    manifest: exactV13Manifest(), imageName: 'subwave-web', run,
  }), {
    image: 'subwave-web',
    digest: 'sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f',
    tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2',
  });
  assert.deepEqual(calls, [{
    command: 'docker',
    args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'],
  }]);
});

test('fails a single-image inspection whose digest differs', () => {
  const { run } = preflightRunner({ 'subwave-web': JSON.stringify(`sha256:${'a'.repeat(64)}`) });
  assert.throws(
    () => manifestModule.verifyRecoveryImage({ manifest: exactV13Manifest(), imageName: 'subwave-web', run }),
    /Recovery image digest mismatch: subwave-web/,
  );
});

test('fails a single-image inspection with malformed output', () => {
  const { run } = preflightRunner({ 'subwave-web': 'not-json' });
  assert.throws(
    () => manifestModule.verifyRecoveryImage({ manifest: exactV13Manifest(), imageName: 'subwave-web', run }),
    /Recovery image inspection returned an invalid digest/,
  );
});

test('sanitizes a single-image child process failure', () => {
  assert.throws(
    () => manifestModule.verifyRecoveryImage({
      manifest: exactV13Manifest(),
      imageName: 'subwave-web',
      run() { throw new Error('registry password leaked here'); },
    }),
    (error) => error.message === 'Recovery image inspection command failed',
  );
});

test('preflight runs the exact tag, release, image, and scanner checks', () => {
  const { calls, run } = preflightRunner();
  const result = manifestModule.verifyRecoveryPreflight({
    manifest: exactV13Manifest(), repository: 'ObiWanCanOweMe/obiwave', run,
  });
  assert.deepEqual(result, {
    tag: 'v1.3.0-obiwave.2',
    source: '41c8a329670f99c3b440a468adbb9fe2d900a4fe',
    scannerVersion: '0.67.2',
    images: [
      { image: 'subwave-caddy', digest: 'sha256:10a653cd8eb73a4aa55998d4f499ed7184a37ae99a41c2222f7a9434175290cd' },
      { image: 'subwave-broadcast', digest: 'sha256:e983017f0bae67fa10cd7bf9833403227c2e193492175087e03bb8ac99df236b' },
      { image: 'subwave-controller', digest: 'sha256:e516778b297cc92f65b22e2336a2a8c7c16618f63fe19746f01dc9dbf405f7f6' },
      { image: 'subwave-web', digest: 'sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f' },
      { image: 'subwave-aio', digest: 'sha256:50e961965b7f449f330c83e8942fea58d02a7dc5265e3efa8c3600017f48166e' },
      { image: 'subwave-aio-heavy', digest: 'sha256:48c0e3bd7fc6dba4e8dc01b6eec12b267be9ac1635d7af15e8a5710724c3427d' },
      { image: 'subwave-tts-heavy', digest: 'sha256:ee4dd62bf79eddbf6329ea059e5e172ef176c87353c18d05dd1ec3c0f0c53025' },
      { image: 'subwave-analyzer', digest: 'sha256:be9a81fd5b43c97e4093399aebc8d00cfdfa656d032602e7ca0644e49934164f' },
      { image: 'subwave-analyzer-heavy', digest: 'sha256:82e7c5bef067ffe35db03a2bbe08c518e764fb61065eee34af4213aede4ebe00' },
      { image: 'subwave-analyzer-cuda', digest: 'sha256:c6964797b8a88dd2fa9291778543c27594350aba84c7c2f2d25560cd5150bb72' },
    ],
  });
  assert.deepEqual(calls, [
    { command: 'git', args: ['rev-parse', 'v1.3.0-obiwave.2^{commit}'] },
    { command: 'gh', args: ['release', 'view', 'v1.3.0-obiwave.2', '--repo', 'ObiWanCanOweMe/obiwave', '--json', 'tagName,targetCommitish,isDraft,isPrerelease'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-caddy:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-broadcast:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-controller:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-aio:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-aio-heavy:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-tts-heavy:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-analyzer:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-analyzer-heavy:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['buildx', 'imagetools', 'inspect', 'ghcr.io/obiwancanoweme/subwave-analyzer-cuda:v1.3.0-obiwave.2', '--format', '{{json .Manifest.Digest}}'] },
    { command: 'docker', args: ['run', '--rm', 'aquasec/trivy@sha256:e2b22eac59c02003d8749f5b8d9bd073b62e30fefaef5b7c8371204e0a4b0c08', '--version'] },
  ]);
});

test('preflight rejects a tag that resolves to another source commit', () => {
  const { run } = preflightRunner({ git: `${'a'.repeat(40)}\n` });
  assert.throws(
    () => manifestModule.verifyRecoveryPreflight({ manifest: exactV13Manifest(), repository: 'ObiWanCanOweMe/obiwave', run }),
    /Recovery release tag source mismatch/,
  );
});

test('preflight rejects release metadata pointing at another source commit', () => {
  const { run } = preflightRunner({ release: JSON.stringify({
    tagName: 'v1.3.0-obiwave.2', targetCommitish: 'a'.repeat(40), isDraft: false, isPrerelease: false,
  }) });
  assert.throws(
    () => manifestModule.verifyRecoveryPreflight({ manifest: exactV13Manifest(), repository: 'ObiWanCanOweMe/obiwave', run }),
    /Recovery GitHub release source mismatch/,
  );
});

test('preflight rejects release metadata for another tag', () => {
  const { run } = preflightRunner({ release: JSON.stringify({
    tagName: 'v1.3.0-obiwave.1',
    targetCommitish: '41c8a329670f99c3b440a468adbb9fe2d900a4fe',
    isDraft: false,
    isPrerelease: false,
  }) });
  assert.throws(
    () => manifestModule.verifyRecoveryPreflight({ manifest: exactV13Manifest(), repository: 'ObiWanCanOweMe/obiwave', run }),
    /Recovery GitHub release source mismatch/,
  );
});

for (const releaseState of [
  { isDraft: true, isPrerelease: false },
  { isDraft: false, isPrerelease: true },
]) {
  test(`preflight rejects a non-public GitHub release (${JSON.stringify(releaseState)})`, () => {
    const { run } = preflightRunner({ release: JSON.stringify({
      tagName: 'v1.3.0-obiwave.2',
      targetCommitish: '41c8a329670f99c3b440a468adbb9fe2d900a4fe',
      ...releaseState,
    }) });
    assert.throws(
      () => manifestModule.verifyRecoveryPreflight({
        manifest: exactV13Manifest(), repository: 'ObiWanCanOweMe/obiwave', run,
      }),
      /Recovery GitHub release is not public/,
    );
  });
}

test('preflight rejects any image whose inspected digest differs', () => {
  const { run } = preflightRunner({ 'subwave-controller': JSON.stringify(`sha256:${'a'.repeat(64)}`) });
  assert.throws(
    () => manifestModule.verifyRecoveryPreflight({ manifest: exactV13Manifest(), repository: 'ObiWanCanOweMe/obiwave', run }),
    /Recovery image digest mismatch: subwave-controller/,
  );
});

test('preflight rejects a scanner reporting another version', () => {
  const { run } = preflightRunner({ scanner: 'Version: 0.68.0\n' });
  assert.throws(
    () => manifestModule.verifyRecoveryPreflight({ manifest: exactV13Manifest(), repository: 'ObiWanCanOweMe/obiwave', run }),
    /Recovery scanner version mismatch/,
  );
});

const scriptPath = fileURLToPath(new URL('./recovery-manifest.mjs', import.meta.url));
const manifestPath = fileURLToPath(new URL('../../security/releases/v1.3.0-obiwave.2.json', import.meta.url));
const v16ManifestPath = fileURLToPath(
  new URL('../../security/releases/v1.6.0-obiwave.1.json', import.meta.url),
);
const v16Revision2ManifestPath = fileURLToPath(
  new URL('../../security/releases/v1.6.0-obiwave.2.json', import.meta.url),
);
const v16Revision3ManifestPath = fileURLToPath(
  new URL('../../security/releases/v1.6.0-obiwave.3.json', import.meta.url),
);
const v16Revision4ManifestPath = fileURLToPath(
  new URL('../../security/releases/v1.6.0-obiwave.4.json', import.meta.url),
);
const v17ManifestPath = fileURLToPath(
  new URL('../../security/releases/v1.7.0-obiwave.1.json', import.meta.url),
);
const scannerPath = fileURLToPath(new URL('../../security/trivy-scanner.json', import.meta.url));

function runImageCli(extra = [], env = process.env) {
  return spawnSync(process.execPath, [
    scriptPath,
    'image',
    '--manifest', manifestPath,
    '--scanner', scannerPath,
    '--image', 'subwave-web',
    ...extra,
  ], { encoding: 'utf8', env });
}

test('validate CLI accepts the exact manifest without external preflight', () => {
  const result = spawnSync(process.execPath, [
    scriptPath,
    'validate',
    '--manifest', manifestPath,
    '--scanner', scannerPath,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('validate CLI accepts the checked-in v1.6 recovery identity', () => {
  const result = spawnSync(process.execPath, [
    scriptPath,
    'validate',
    '--manifest', v16ManifestPath,
    '--scanner', scannerPath,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('validate CLI accepts the exact checked-in v1.7 recovery identity', () => {
  const result = spawnSync(process.execPath, [
    scriptPath,
    'validate',
    '--manifest', v17ManifestPath,
    '--scanner', scannerPath,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('validate CLI accepts the checked-in v1.6 revision 2 recovery identity', () => {
  const result = spawnSync(process.execPath, [
    scriptPath,
    'validate',
    '--manifest', v16Revision2ManifestPath,
    '--scanner', scannerPath,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('validate CLI accepts the checked-in v1.6 revision 3 recovery identity', () => {
  const result = spawnSync(process.execPath, [
    scriptPath,
    'validate',
    '--manifest', v16Revision3ManifestPath,
    '--scanner', scannerPath,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('validate CLI accepts the checked-in v1.6 revision 4 recovery identity', () => {
  const result = spawnSync(process.execPath, [
    scriptPath,
    'validate',
    '--manifest', v16Revision4ManifestPath,
    '--scanner', scannerPath,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('image CLI emits the canonical references as one JSON object', () => {
  const result = runImageCli();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    image: 'subwave-web',
    tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2',
    pullRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2@sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f',
    digest: 'sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f',
  });
});

test('image CLI writes GitHub output instead of stdout when requested', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recovery-manifest-'));
  const outputPath = join(directory, 'github-output');
  try {
    const result = runImageCli([], { ...process.env, GITHUB_OUTPUT: outputPath });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(
      await readFile(outputPath, 'utf8'),
      'tag_ref=ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2\n' +
        'pull_ref=ghcr.io/obiwancanoweme/subwave-web:v1.3.0-obiwave.2@sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f\n' +
        'digest=sha256:2caee389ca4aa09c3ecf1e57d31eb5b1248d6ddf5b4908511a908ce42e48008f\n',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('CLI rejects duplicate and unknown arguments without echoing their values', () => {
  for (const args of [
    ['--image', 'subwave-caddy'],
    ['--unexpected', 'secret-value'],
  ]) {
    const result = runImageCli(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Recovery command arguments are invalid/);
    assert.doesNotMatch(result.stderr, /secret-value/);
  }
});

test('legacy CLI commands reject partial-recovery-only arguments', () => {
  const result = runImageCli(['--partial-manifest', 'secret-value']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Recovery command arguments are invalid/);
  assert.doesNotMatch(result.stderr, /secret-value/);
});

function partialPreflightRunner(overrides = {}) {
  const calls = [];
  const run = (command, args) => {
    calls.push({ command, args });
    if (command === 'git') return overrides.git ?? '87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787\n';
    if (command === 'gh') return overrides.release ?? JSON.stringify({
      tagName: 'v1.6.0-obiwave.1',
      targetCommitish: '87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787',
      isDraft: false,
      isPrerelease: false,
    });
    if (args[0] === 'run') return overrides.scanner ?? 'Version: 0.67.2\n';
    const image = args[3].split('/').at(-1).split(':')[0];
    return overrides[image] ?? JSON.stringify(exactV16RegistryDigests()[image]);
  };
  return { calls, run };
}

test('partial recovery preflight checks release identity, preserved tags, and scanner', () => {
  const { calls, run } = partialPreflightRunner();
  const result = manifestModule.verifyPartialRecoveryPreflight({
    manifest: exactV16PartialManifest(), repository: 'ObiWanCanOweMe/obiwave', run,
  });
  assert.deepEqual(result, {
    tag: 'v1.6.0-obiwave.1',
    source: '87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787',
    scannerVersion: '0.67.2',
    images: [
      { image: 'subwave-broadcast', digest: 'sha256:a623e516992ade44d83ac72c231d2ecc278eb71c613d04212936a5ec03237c2f' },
      { image: 'subwave-controller', digest: 'sha256:fe765d8f9a491012c33c6828686cb350aa2e6f84acffd170fc038b4be93c614f' },
      { image: 'subwave-aio', digest: 'sha256:6d1c79424e19348653f929f0687582984d46fc964cdc388a49a03d58b8d3b1fe' },
      { image: 'subwave-analyzer', digest: 'sha256:4d4aaac6121f24699b3de79c00572afe87fd7c971b8b02c81c6bec12c7e1a1c9' },
      { image: 'subwave-analyzer-cuda', digest: 'sha256:cdf74b46d05a40d453b69541644b4e9e7c587617100a7484a616e358efd3c341' },
    ],
  });
  assert.deepEqual(calls.map(({ command, args }) => [command, args[0]]), [
    ['git', 'rev-parse'], ['gh', 'release'],
    ['docker', 'buildx'], ['docker', 'buildx'], ['docker', 'buildx'], ['docker', 'buildx'], ['docker', 'buildx'],
    ['docker', 'run'],
  ]);
});

test('partial recovery preflight rejects a non-public GitHub release', () => {
  const { run } = partialPreflightRunner({ release: JSON.stringify({
    tagName: 'v1.6.0-obiwave.1', targetCommitish: '87fd6e1398f2f8d204d7ed6c7d86ef2e6e2ed787', isDraft: true, isPrerelease: false,
  }) });
  assert.throws(
    () => manifestModule.verifyPartialRecoveryPreflight({
      manifest: exactV16PartialManifest(), repository: 'ObiWanCanOweMe/obiwave', run,
    }),
    /Recovery GitHub release is not public/,
  );
});

const partialManifestPath = fileURLToPath(new URL('../../security/releases/v1.6.0-obiwave.1.partial.json', import.meta.url));

function runPartialCli(command, args = [], env = process.env) {
  return spawnSync(process.execPath, [
    scriptPath,
    command,
    '--manifest', partialManifestPath,
    '--scanner', scannerPath,
    ...args,
  ], { encoding: 'utf8', env });
}

test('validate-partial CLI accepts the checked-in partial identity', () => {
  const result = runPartialCli('validate-partial');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('materialize-sealed and sealed-image CLI strictly transport a sealed manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recovery-sealed-'));
  const outputPath = join(directory, 'runtime.json');
  try {
    const encoded = Buffer.from(`${JSON.stringify(exactV16SealedManifest())}\n`).toString('base64');
    const materialized = runPartialCli('materialize-sealed', ['--output', outputPath], {
      ...process.env,
      SEALED_RECOVERY_MANIFEST_B64: encoded,
    });
    assert.equal(materialized.status, 0, materialized.stderr);
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), exactV16SealedManifest());
    const image = spawnSync(process.execPath, [
      scriptPath,
      'sealed-image',
      '--manifest', outputPath,
      '--partial-manifest', partialManifestPath,
      '--scanner', scannerPath,
      '--image', 'subwave-web',
    ], { encoding: 'utf8' });
    assert.equal(image.status, 0, image.stderr);
    assert.deepEqual(JSON.parse(image.stdout), {
      image: 'subwave-web',
      tagRef: 'ghcr.io/obiwancanoweme/subwave-web:v1.6.0-obiwave.1',
      pullRef: `ghcr.io/obiwancanoweme/subwave-web:v1.6.0-obiwave.1@${buildDigests['subwave-web']}`,
      digest: buildDigests['subwave-web'],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('seal CLI accepts exactly five build records and emits a base64 sealed manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'recovery-seal-'));
  const recordsDirectory = join(directory, 'records');
  const binDirectory = join(directory, 'bin');
  const outputPath = join(directory, 'runtime.json');
  const githubOutput = join(directory, 'github-output');
  try {
    await mkdir(recordsDirectory);
    await mkdir(binDirectory);
    for (const [image, digest] of Object.entries(buildDigests)) {
      await writeFile(join(recordsDirectory, `${image}.json`), `${JSON.stringify({ image, digest })}\n`);
    }
    const cases = Object.entries(exactV16RegistryDigests())
      .map(([image, digest]) => `  *${image}:*) printf '%s\\n' '"${digest}"' ;;`)
      .join('\n');
    const dockerPath = join(binDirectory, 'docker');
    await writeFile(dockerPath, `#!/bin/sh\ncase "$4" in\n${cases}\nesac\n`);
    await chmod(dockerPath, 0o755);
    const result = runPartialCli('seal', ['--build-digests', recordsDirectory, '--output', outputPath], {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH}`,
      GITHUB_OUTPUT: githubOutput,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), exactV16SealedManifest());
    assert.match(await readFile(githubOutput, 'utf8'), /^manifest_b64=[A-Za-z0-9+/=]+\n$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

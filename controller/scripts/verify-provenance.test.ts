import assert from 'node:assert/strict';
import {
  resolveVerifierProvenance,
  verifierHealthFields,
} from '../src/util/verify-provenance.ts';

const marker = 'subwave-verify-8de7ba8b-17f5-4d89-9f34-e0f625529b11';
const dummyUrl = 'http://127.0.0.1:9999';

assert.equal(resolveVerifierProvenance({
  nodeEnv: 'production', marker, navidromeUrl: 'https://music.example.test',
}), null, 'production must never expose verifier provenance');
assert.deepEqual(verifierHealthFields(null), {}, 'production /health shape must stay unchanged');

assert.equal(resolveVerifierProvenance({
  nodeEnv: 'development', navidromeUrl: dummyUrl,
}), null, 'an absent marker must expose nothing');
assert.equal(resolveVerifierProvenance({
  nodeEnv: 'test', marker: 'not-a-verifier-marker', navidromeUrl: dummyUrl,
}), null, 'an invalid marker must expose nothing');

assert.throws(
  () => resolveVerifierProvenance({
    nodeEnv: 'development', marker, navidromeUrl: 'https://music.example.test',
  }),
  /loopback dummy Subsonic backend/,
  'a valid verifier marker must reject non-loopback Navidrome before startup',
);

const provenance = resolveVerifierProvenance({
  nodeEnv: 'test', marker, navidromeUrl: `${dummyUrl}/`,
});
assert.equal(
  provenance,
  '38da5b3c3d40ccea2a9ac5188f0ab9edc55b7b2d9b0d42ea95b2b683b781ca9a',
  'development/test attestation must be opaque and deterministic',
);
assert.deepEqual(verifierHealthFields(provenance), { verifyProvenance: provenance });
assert.ok(!provenance?.includes(marker));
assert.ok(!provenance?.includes(dummyUrl));

console.log('verify provenance tests passed');

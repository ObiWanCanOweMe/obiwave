import { createHash } from 'node:crypto';

const MARKER_RE = /^subwave-verify-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DUMMY_SUBSONIC_URL = 'http://127.0.0.1:9999';

type VerifyProvenanceInput = {
  nodeEnv?: string;
  marker?: string;
  navidromeUrl: string;
};

export function resolveVerifierProvenance({
  nodeEnv,
  marker,
  navidromeUrl,
}: VerifyProvenanceInput): string | null {
  if (nodeEnv !== 'development' && nodeEnv !== 'test') return null;
  const candidate = (marker || '').trim();
  if (!MARKER_RE.test(candidate)) return null;
  if (navidromeUrl.replace(/\/+$/, '') !== DUMMY_SUBSONIC_URL) {
    throw new Error('verifier isolation requires the loopback dummy Subsonic backend');
  }
  return createHash('sha256')
    .update(`subwave-controller-verifier\0${candidate}\0${DUMMY_SUBSONIC_URL}`)
    .digest('hex');
}

export function verifierHealthFields(provenance: string | null): Record<string, string> {
  return provenance ? { verifyProvenance: provenance } : {};
}

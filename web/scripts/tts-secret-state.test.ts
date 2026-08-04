import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clearPersistedSecretInput } from '../components/admin/settings/TtsSection.tsx';

assert.equal(clearPersistedSecretInput(true, 'raw-secret'), '');
assert.equal(clearPersistedSecretInput(false, 'raw-secret'), 'raw-secret');

const source = readFileSync(
  fileURLToPath(new URL('../components/admin/settings/TtsSection.tsx', import.meta.url)),
  'utf8',
);
assert.match(
  source,
  /setCloudKeyInput\(value => clearPersistedSecretInput\(managedKeySaved, value\)\)/,
  'managed TTS keys clear raw input only after persistence succeeds',
);
assert.match(
  source,
  /setCompatKeyInput\(value => clearPersistedSecretInput\(settingsSaved, value\)\)/,
  'compatibility TTS keys clear raw input only after settings persistence succeeds',
);

console.log('tts-secret-state.test.ts: persisted secrets clear raw inputs only after successful saves');

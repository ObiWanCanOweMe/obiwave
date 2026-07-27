import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STATE_DIR = mkdtempSync(join(tmpdir(), 'subwave-cloud-tts-provider-key-'));
delete process.env.OPENAI_API_KEY;
delete process.env.ELEVENLABS_API_KEY;

// Simulate a pre-fix settings.json where an OpenAI-compatible bearer survived
// after the operator switched the selected provider to managed OpenAI.
writeFileSync(
  join(process.env.STATE_DIR, 'settings.json'),
  JSON.stringify({
    tts: {
      defaultEngine: 'cloud',
      cloud: {
        enabled: true,
        provider: 'openai',
        model: 'gpt-4o-mini-tts',
        voice: 'alloy',
        apiKey: 'stale-compat-bearer',
      },
    },
  }),
);

const settings = await import('../src/settings.js');
const cloudSpeech = await import('../src/llm/internal/speech/cloud-speech.js');

let failures = 0;
async function test(name: string, run: () => Promise<void>) {
  try {
    await run();
    console.log(`✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

await settings.load();

await test('cloud credential resolution scopes the inline bearer to openai-compatible', async () => {
  const resolveCloudApiKey = (cloudSpeech as unknown as {
    resolveCloudApiKey?: (
      cfg: { provider?: string; apiKey?: string },
      env: Record<string, string | undefined>,
    ) => string;
  }).resolveCloudApiKey;

  assert.equal(
    resolveCloudApiKey?.(
      { provider: 'openai-compatible', apiKey: 'compat-bearer' },
      { OPENAI_API_KEY: 'managed-openai-env-key' },
    ),
    'compat-bearer',
  );
  assert.equal(
    resolveCloudApiKey?.(
      { provider: 'openai', apiKey: 'compat-bearer' },
      { OPENAI_API_KEY: 'managed-openai-env-key' },
    ),
    'managed-openai-env-key',
  );
  assert.equal(
    resolveCloudApiKey?.(
      { provider: 'elevenlabs', apiKey: 'compat-bearer' },
      { ELEVENLABS_API_KEY: 'managed-elevenlabs-env-key' },
    ),
    'managed-elevenlabs-env-key',
  );
});

await test('persisted compatible bearer is ignored for managed OpenAI', async () => {
  assert.equal(settings.get().tts.cloud.apiKey, '');
  assert.equal(settings.getRedacted().tts.cloud.apiKey, '');
  assert.equal(cloudSpeech.isConfigured(), false);

  process.env.OPENAI_API_KEY = 'managed-openai-env-key';
  assert.equal(cloudSpeech.isConfigured(), true);
  delete process.env.OPENAI_API_KEY;
});

await test('switching from compatible TTS to OpenAI clears the inline bearer', async () => {
  await settings.update({
    tts: {
      cloud: {
        provider: 'openai-compatible',
        model: 'compat-speech-model',
        voice: '',
        baseUrl: 'https://compat-tts.example/v1',
        apiKey: 'compat-bearer',
      },
    },
  });
  assert.equal(settings.get().tts.cloud.apiKey, 'compat-bearer');

  await settings.update({
    tts: {
      cloud: {
        provider: 'openai',
        model: 'gpt-4o-mini-tts',
        voice: 'alloy',
      },
    },
  });

  assert.equal(settings.get().tts.cloud.apiKey, '');
  assert.equal(settings.getRedacted().tts.cloud.apiKey, '');
  assert.equal(cloudSpeech.isConfigured(), false);

  process.env.OPENAI_API_KEY = 'managed-openai-env-key';
  assert.equal(cloudSpeech.isConfigured(), true);
  delete process.env.OPENAI_API_KEY;
});

await test('switching from compatible TTS to ElevenLabs clears the inline bearer', async () => {
  await settings.update({
    tts: {
      cloud: {
        provider: 'openai-compatible',
        model: 'compat-speech-model',
        voice: '',
        baseUrl: 'https://compat-tts.example/v1',
        apiKey: 'compat-bearer',
      },
    },
  });
  await settings.update({
    tts: {
      cloud: {
        provider: 'elevenlabs',
        model: 'eleven_flash_v2_5',
        voice: 'voice-id',
      },
    },
  });

  assert.equal(settings.get().tts.cloud.apiKey, '');
  assert.equal(settings.getRedacted().tts.cloud.apiKey, '');
  assert.equal(cloudSpeech.isConfigured(), false);

  process.env.ELEVENLABS_API_KEY = 'managed-elevenlabs-env-key';
  assert.equal(cloudSpeech.isConfigured(), true);
  delete process.env.ELEVENLABS_API_KEY;
});

if (failures) process.exit(1);

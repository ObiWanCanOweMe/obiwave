import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [
  source,
  ttsSource,
  librarySource,
  voiceHookSource,
  settingsSource,
  routesSource,
  cloudSpeechSource,
] = await Promise.all([
  readFile(new URL('../components/admin/settings/LlmSection.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/admin/settings/TtsSection.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/admin/settings/LibrarySection.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../hooks/useVoiceDiscovery.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../controller/src/settings.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../controller/src/routes/settings/tts.ts', import.meta.url), 'utf8'),
  readFile(new URL('../../controller/src/llm/internal/speech/cloud-speech.ts', import.meta.url), 'utf8'),
]);

function blockBetween(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing block start: ${start}`);
  assert.notEqual(to, -1, `missing block end: ${end}`);
  return text.slice(from, to);
}

function assertNoConflictMarkers(text: string, label: string) {
  assert.doesNotMatch(text, /^(?:<<<<<<<|=======|>>>>>>>)(?: .*)?$/m, `${label} contains a merge conflict marker`);
}

function assertSpeechModelUsesResolvedKey(text: string) {
  const speechModelBlock = blockBetween(
    text,
    'function speechModel(c: any) {',
    '// True when the cloud engine has a usable key',
  );
  assert.match(
    speechModelBlock,
    /const apiKey = resolveCloudApiKey\(c\);/,
    'speechModel must resolve the credential for the selected provider',
  );
  assert.doesNotMatch(
    speechModelBlock,
    /\bc\.apiKey\b/,
    'speechModel must not consume the compatible inline bearer directly',
  );
}

for (const [label, text] of [
  ['LlmSection.tsx', source],
  ['TtsSection.tsx', ttsSource],
  ['LibrarySection.tsx', librarySource],
  ['useVoiceDiscovery.ts', voiceHookSource],
  ['settings.ts', settingsSource],
  ['routes/settings/tts.ts', routesSource],
  ['cloud-speech.ts', cloudSpeechSource],
] as const) {
  assertNoConflictMarkers(text, label);
}

assert.throws(
  () => assertNoConflictMarkers('before\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> v0.45.0\nafter', 'fixture'),
  /fixture contains a merge conflict marker/,
);

assertSpeechModelUsesResolvedKey(cloudSpeechSource);
const directCloudKeyMutation = cloudSpeechSource.replace(
  'const apiKey = resolveCloudApiKey(c);',
  "const apiKey = String(c.apiKey || '').trim();",
);
assert.notEqual(directCloudKeyMutation, cloudSpeechSource, 'direct-key mutation fixture must alter speechModel');
assert.throws(
  () => assertSpeechModelUsesResolvedKey(directCloudKeyMutation),
  /speechModel must resolve the credential for the selected provider/,
);

assert.match(source, /const INLINE_KEY_PROVIDERS = \['openai-compatible', 'locca', 'litellm'\];/);
assert.match(source, /const CUSTOM_URL_PROVIDERS = \['openai-compatible', 'litellm'\];/);
assert.match(source, /const primaryBaseUrl = form\.llm\.providerBaseUrls\[primaryProvider\] \?\? '';/);
assert.match(source, /const fallbackBaseUrl = form\.llm\.fallback\.providerBaseUrls\[fallbackProvider\] \?\? '';/);
const embedDiscoveryBlock = blockBetween(
  librarySource,
  'const embedDiscoveryEnabled =',
  'const embedDiscovery =',
);
assert.match(
  embedDiscoveryBlock,
  /embedKeyPresent \|\| !!embeddingKeyInput\.trim\(\)/,
  'saved EMBEDDING_API_KEY must enable model discovery using runtime credential precedence',
);
assert.match(
  librarySource,
  /adminFetch\('\/settings\/llm\/discover', \{[\s\S]*?method: 'POST',[\s\S]*?body: JSON\.stringify\(\{ baseUrl: url \}\)/,
  'direct Locca discovery must keep its unsaved URL in a POST body',
);
assert.doesNotMatch(librarySource, /settings\/llm\/discover\?baseUrl=/);
assert.match(
  source,
  /providerBaseUrls: \{ \.\.\.f\.llm\.providerBaseUrls, \[primaryProvider\]: e\.target\.value \}/,
  'primary URL edits must write the selected provider slot',
);
assert.match(
  source,
  /providerBaseUrls: \{ \.\.\.f\.llm\.fallback\.providerBaseUrls, \[fallbackProvider\]: e\.target\.value \}/,
  'fallback URL edits must write the selected provider slot',
);
const primaryLoccaUrlBlock = blockBetween(
  source,
  "{form.llm.provider === 'locca' && (",
  '{INLINE_KEY_PROVIDERS.includes(form.llm.provider) && (',
);
assert.match(
  primaryLoccaUrlBlock,
  /providerBaseUrls: \{ \.\.\.f\.llm\.providerBaseUrls, locca: e\.target\.value \}/,
  'primary Locca URL edits must write providerBaseUrls.locca',
);
const fallbackLoccaUrlBlock = blockBetween(
  source,
  "{form.llm.fallback.provider === 'locca' && (",
  '{INLINE_KEY_PROVIDERS.includes(form.llm.fallback.provider) && (',
);
assert.match(
  fallbackLoccaUrlBlock,
  /providerBaseUrls: \{ \.\.\.f\.llm\.fallback\.providerBaseUrls, locca: e\.target\.value \}/,
  'fallback Locca URL edits must write fallback.providerBaseUrls.locca',
);
assert.match(
  source,
  /owner: 'chat',[\s\S]*?leg: 'primary',[\s\S]*?apiKey: INLINE_KEY_PROVIDERS\.includes\(primaryProvider\)[\s\S]*?\? compatKeyInput[\s\S]*?: primaryKeyInput,[\s\S]*?baseUrl: primaryBaseUrl,/,
  'primary discovery must identify the chat owner and use the key typed for the selected provider',
);
assert.match(
  source,
  /owner: 'chat',[\s\S]*?leg: 'fallback',[\s\S]*?apiKey: INLINE_KEY_PROVIDERS\.includes\(fallbackProvider\)[\s\S]*?\? compatFallbackKeyInput[\s\S]*?: fallbackKeyInput,[\s\S]*?baseUrl: fallbackBaseUrl,/,
  'fallback discovery must identify the chat owner and use the key typed for the selected provider',
);
assert.match(
  source,
  /\[primaryProvider, primaryBaseUrl, form\.llm\.model, compatKeyInput\]/,
  'primary typed-key/provider/URL/model changes must invalidate stale probes',
);
assert.match(
  source,
  /\[fallbackProvider, fallbackBaseUrl, form\.llm\.fallback\.model, compatFallbackKeyInput\]/,
  'fallback typed-key/provider/URL/model changes must invalidate stale probes',
);

const saveBlock = blockBetween(source, 'const save = async () => {', 'const savedLlm =');
assert.match(saveBlock, /providerBaseUrls: form\.llm\.providerBaseUrls,/);
assert.match(saveBlock, /providerBaseUrls: form\.llm\.fallback\.providerBaseUrls,/);
assert.match(saveBlock, /strictRequests: form\.llm\.strictRequests,/);
assert.match(saveBlock, /INLINE_KEY_PROVIDERS\.includes\(activeProvider\)[\s\S]*?apiKey: compatKeyInput\.trim\(\)/);
assert.match(saveBlock, /INLINE_KEY_PROVIDERS\.includes\(activeFallbackProvider\)[\s\S]*?apiKey: compatFallbackKeyInput\.trim\(\)/);
assert.doesNotMatch(source, /form\.llm(\.fallback)?\.baseUrl/);

assert.match(ttsSource, /const \[compatKeyInput, setCompatKeyInput\] = useState\(''\);/);
assert.match(ttsSource, /\.\.\.\(isCompat && compatKeyInput\.trim\(\) \? \{ apiKey: compatKeyInput\.trim\(\) \} : \{\}\)/);
assert.match(ttsSource, /placeholder=\{savedCloud\.apiKey === 'set' \? '•••••• \(on file\)' : 'Optional'\}/);
assert.match(ttsSource, /if \(!isCompat && cloudKeyInput\.trim\(\)\)/);
assert.match(
  ttsSource,
  /useVoiceDiscovery\(\{[\s\S]*?apiKey: isCompat \? compatKeyInput : cloudKeyInput,/,
  'voice discovery must receive the unsaved key owned by the selected TTS provider',
);
assert.match(voiceHookSource, /buildVoiceDiscoveryRequest\(\{/);
assert.doesNotMatch(
  voiceHookSource,
  /settings\/tts\/voices\?\$\{params\}/,
  'voice discovery URL must not carry an unsaved server or credential',
);
assert.match(settingsSource, /stored\.tts\?\.cloud\?\.provider === 'openai-compatible'[\s\S]*?stored\.tts\.cloud\.apiKey/);
assert.match(settingsSource, /if \(next\.tts\.cloud\.provider !== 'openai-compatible'\) \{\s*next\.tts\.cloud\.apiKey = '';/);
assert.match(cloudSpeechSource, /export function resolveCloudApiKey\(/);
assert.match(cloudSpeechSource, /if \(c\.provider === 'openai-compatible'\) return String\(c\.apiKey \|\| ''\)\.trim\(\);/);
assert.match(cloudSpeechSource, /if \(c\.provider === 'elevenlabs'\) return String\(env\.ELEVENLABS_API_KEY \|\| ''\)\.trim\(\);/);
assert.match(cloudSpeechSource, /if \(c\.provider === 'openai'\) return String\(env\.OPENAI_API_KEY \|\| ''\)\.trim\(\);/);
assert.match(routesSource, /router\.post\('\/settings\/tts\/voices'/);
assert.match(routesSource, /storedCredentialIsBound/);

console.log('✓ LLM settings composes provider-scoped URLs with LiteLLM transport safeguards');

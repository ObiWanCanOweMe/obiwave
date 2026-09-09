import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const [
  source,
  ttsSource,
  librarySource,
  voiceHookSource,
  discoveryQuerySource,
  settingsSource,
  routesSource,
  cloudSpeechSource,
] = await Promise.all([
  readFile(new URL('../components/admin/settings/LlmSection.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/admin/settings/TtsSection.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/admin/settings/LibrarySection.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../hooks/useVoiceDiscovery.ts', import.meta.url), 'utf8'),
  readFile(new URL('../hooks/discovery-queries.ts', import.meta.url), 'utf8'),
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
  ['discovery-queries.ts', discoveryQuerySource],
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
  /adminResponse\(adminFetch, '\/settings\/llm\/discover', \{[\s\S]*?method: 'POST',[\s\S]*?body: JSON\.stringify\(\{ baseUrl: url \}\)/,
  'direct Locca discovery must keep its unsaved URL in a POST body',
);
assert.doesNotMatch(librarySource, /settings\/llm\/discover\?baseUrl=/);
// Execute the real URL callbacks and helper without mounting unrelated network
// hooks. AST extraction keeps this contract independent of inline-vs-helper
// formatting while proving each Input still reaches the correct credential leg.
function assertUrlEditsPreserveOwnership(text: string) {
  const tree = ts.createSourceFile('LlmSection.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let helper: ts.Expression | undefined;
  const callbacks = new Map<string, ts.Expression>();
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'changeLlmBaseUrl') {
      helper = node.initializer;
    }
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(tree) === 'Input') {
      const props = new Map<string, ts.Expression>();
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)
          && attribute.initializer.expression) {
          props.set(attribute.name.getText(tree), attribute.initializer.expression);
        }
      }
      const value = props.get('value');
      const onChange = props.get('onChange');
      if (value && onChange && ts.isBinaryExpression(value) && ts.isElementAccessExpression(value.left)) {
        const access = value.left;
        if (ts.isPropertyAccessExpression(access.expression) && access.expression.name.text === 'providerBaseUrls') {
          const owner = access.expression.expression.getText(tree);
          const key = access.argumentExpression;
          const slot = ts.isStringLiteral(key) ? key.text : key.getText(tree);
          callbacks.set(`${owner}:${slot}`, onChange);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(helper, 'provider URL editor must have a shared connection update helper');

  for (const [owner, slot, leg, provider] of [
    ['form.llm', 'primaryProvider', 'primary', 'litellm'],
    ['form.llm', 'locca', 'primary', 'locca'],
    ['form.llm.fallback', 'fallbackProvider', 'fallback', 'openai-compatible'],
    ['form.llm.fallback', 'locca', 'fallback', 'locca'],
  ] as const) {
    const callback = callbacks.get(`${owner}:${slot}`);
    assert.ok(callback, `${owner}:${slot} must remain an editable URL field`);
    for (const sameEndpoint of [false, true]) {
      const savedUrl = 'https://saved.example/v1';
      const nextUrl = sameEndpoint ? ` ${savedUrl}/ ` : 'https://changed.example/v1';
      const makeLeg = (name: string) => ({
        provider,
        model: `${name}-model`,
        providerBaseUrls: { [provider]: savedUrl, openai: 'https://other.example/v1' },
        headers: [{ name: 'x-secret', value: 'set' }, { name: 'x-typed', value: `${name}-unsaved` }],
      });
      let form = { otherSetting: 'keep', llm: { ...makeLeg('primary'), fallback: makeLeg('fallback') } };
      const original = form;
      const selectedBefore = leg === 'primary' ? original.llm : original.llm.fallback;
      const untouchedBefore = leg === 'primary' ? original.llm.fallback : original.llm;
      const javascript = ts.transpileModule(
        `const changeLlmBaseUrl = ${helper.getText(tree)}; const onChange = ${callback.getText(tree)}; onChange;`,
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
      ).outputText;
      const onChange = runInNewContext(javascript, {
        primaryProvider: provider,
        fallbackProvider: provider,
        setForm: (update: (previous: typeof form) => typeof form) => { form = update(form); },
      }) as (event: { target: { value: string } }) => void;
      onChange({ target: { value: nextUrl } });
      const selected = leg === 'primary' ? form.llm : form.llm.fallback;
      const untouched = leg === 'primary' ? form.llm.fallback : form.llm;
      assert.equal(selected.providerBaseUrls[provider], nextUrl, `${owner}:${slot} writes its provider slot`);
      assert.equal(selected.providerBaseUrls.openai, 'https://other.example/v1', 'other provider URL retained');
      assert.equal(selected.model, selectedBefore.model, 'model retained');
      assert.equal(form.otherSetting, 'keep');
      assert.equal(selectedBefore.providerBaseUrls[provider], savedUrl, 'update does not mutate the prior form');
      assert.equal(untouched.providerBaseUrls, untouchedBefore.providerBaseUrls, 'other leg URLs untouched');
      assert.equal(untouched.headers, untouchedBefore.headers, 'other leg credentials untouched');
      if (sameEndpoint) {
        assert.equal(selected.headers, selectedBefore.headers, 'normalized same endpoint retains stored and typed headers');
      } else {
        assert.equal(selected.headers.length, 0, 'changed endpoint clears inherited and previously typed headers');
      }
    }
  }
}
assertUrlEditsPreserveOwnership(source);
const retainedHeaderMutation = source.replace('headers: sameEndpoint ? current.headers : []', 'headers: current.headers');
assert.notEqual(retainedHeaderMutation, source);
assert.throws(() => assertUrlEditsPreserveOwnership(retainedHeaderMutation), /changed endpoint clears/);
const wrongLegMutation = source.replace("changeLlmBaseUrl('fallback', fallbackProvider", "changeLlmBaseUrl('primary', fallbackProvider");
assert.notEqual(wrongLegMutation, source);
assert.throws(() => assertUrlEditsPreserveOwnership(wrongLegMutation), /writes its provider slot/);

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
assert.match(ttsSource, /compatApiKey\?: string;/);
assert.match(ttsSource, /placeholder=\{savedCloud\.compatApiKey === 'set' \? '•••••• \(on file\)' : 'Optional'\}/);
assert.match(ttsSource, /const hasStoredCompatKey = data\.values\?\.tts\?\.cloud\?\.compatApiKey === 'set';/);
assert.match(ttsSource, /settingsSaved && clearInlineCloudKey && hadStoredInlineKey && !hasStoredCompatKey/);
assert.match(ttsSource, /if \(!isCompat && cloudKeyInput\.trim\(\)\)/);
assert.match(
  ttsSource,
  /useVoiceDiscovery\(\{[\s\S]*?apiKey: isCompat \? compatKeyInput : cloudKeyInput,/,
  'voice discovery must receive the unsaved key owned by the selected TTS provider',
);
assert.match(
  discoveryQuerySource,
  /function fetchVoices[\s\S]*?buildVoiceDiscoveryRequest\(input\)/,
  'the Query-owned voice read must retain the body-only request builder',
);
assert.doesNotMatch(
  voiceHookSource + discoveryQuerySource,
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

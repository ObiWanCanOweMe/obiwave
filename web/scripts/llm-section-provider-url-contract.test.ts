import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../components/admin/settings/LlmSection.tsx', import.meta.url), 'utf8');

assert.match(source, /const INLINE_KEY_PROVIDERS = \['openai-compatible', 'locca', 'litellm'\];/);
assert.match(source, /const CUSTOM_URL_PROVIDERS = \['openai-compatible', 'litellm'\];/);
assert.match(source, /const primaryBaseUrl = form\.llm\.providerBaseUrls\[primaryProvider\] \?\? '';/);
assert.match(source, /const fallbackBaseUrl = form\.llm\.fallback\.providerBaseUrls\[fallbackProvider\] \?\? '';/);
assert.match(source, /leg: 'primary',[\s\S]*?apiKey: compatKeyInput,[\s\S]*?baseUrl: primaryBaseUrl,/);
assert.match(source, /leg: 'fallback',[\s\S]*?apiKey: compatFallbackKeyInput,[\s\S]*?baseUrl: fallbackBaseUrl,/);
assert.match(source, /strictRequests: form\.llm\.strictRequests,/);
assert.doesNotMatch(source, /form\.llm(\.fallback)?\.baseUrl/);

console.log('✓ LLM settings composes provider-scoped URLs with LiteLLM transport safeguards');

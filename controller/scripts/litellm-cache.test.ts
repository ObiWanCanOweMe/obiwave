import assert from 'node:assert/strict';
import http from 'node:http';
import { generateText } from 'ai';

const authorizations: string[] = [];
const gateway = http.createServer((req, res) => {
  authorizations.push(String(req.headers.authorization || ''));
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    const parsed = JSON.parse(body || '{}');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-cache-test',
      object: 'chat.completion',
      created: 1,
      model: parsed.model || 'vendor/model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }));
  });
});
await new Promise<void>((resolve, reject) => {
  gateway.listen(0, '127.0.0.1', resolve);
  gateway.once('error', reject);
});

try {
  const address = gateway.address();
  assert.ok(address && typeof address === 'object');
  process.env.LITELLM_API_BASE = `http://127.0.0.1:${address.port}/v1`;
  process.env.LITELLM_API_KEY = 'environment-token-a';

  const { languageModel } = await import('../src/llm/provider.js');
  const cfg = {
    provider: 'litellm',
    model: 'vendor/model',
    apiKey: '',
    baseUrl: '',
    ollamaUrl: '',
    reasoning: false,
  };

  await generateText({ model: languageModel(cfg), prompt: 'one', maxOutputTokens: 16, maxRetries: 0 });
  process.env.LITELLM_API_KEY = 'environment-token-b';
  await generateText({ model: languageModel(cfg), prompt: 'two', maxOutputTokens: 16, maxRetries: 0 });

  assert.deepEqual(authorizations, [
    'Bearer environment-token-a',
    'Bearer environment-token-b',
  ], 'changing the effective environment token must construct a fresh LiteLLM client');
  console.log('✓ LiteLLM cache follows effective environment token changes');
} finally {
  await new Promise<void>((resolve, reject) => gateway.close(err => err ? reject(err) : resolve()));
}

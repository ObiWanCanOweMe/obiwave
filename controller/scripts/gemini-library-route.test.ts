// Gemini browsing shares the credential-safe POST discovery boundary. Never
// contact Google: serve its catalogue through a fetch stub and use temp state.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import express from 'express';

const state = mkdtempSync(join(tmpdir(), 'subwave-gemini-library-route-'));
process.env.STATE_DIR = state;
process.env.ADMIN_USER = 'library-admin';
process.env.ADMIN_PASS = 'library-password';
process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'catalogue-stub-key';

const settings = await import('../src/settings.js');
const library = await import('../src/audio/gemini-library.js');
const { router } = await import('../src/routes/settings/tts.js');
await settings.load();
await settings.update({ tts: { gemini: { libraryLanguage: 'en-AU' } } });
const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');
const endpoint = `http://127.0.0.1:${address.port}/settings/tts/voices`;
const authorization = `Basic ${Buffer.from('library-admin:library-password').toString('base64')}`;
const originalFetch = globalThis.fetch;
const catalogueQueries: URLSearchParams[] = [];
globalThis.fetch = (async (input, init) => {
  const url = new URL(String(input));
  if (url.origin === new URL(endpoint).origin) return originalFetch(input, init);
  assert.equal(url.origin, 'https://generativelanguage.googleapis.com');
  assert.equal(url.searchParams.has('key'), false, 'Google bearer must stay out of query parameters');
  assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'catalogue-stub-key');
  catalogueQueries.push(url.searchParams);
  return Response.json({ voices: [{
    id: 'en-au-advisor-1', display_name: 'Advisor', language_code: 'en-AU',
    accent: 'Sydney English', gender: 'male', pitch: 'low',
  }] });
}) as typeof fetch;

try {
  await test('Gemini discovery is POST-only and requires admin authentication', async () => {
    const before = catalogueQueries.length;
    const legacy = await fetch(`${endpoint}?provider=gemini`, { headers: { authorization } });
    assert.equal(legacy.status, 405);
    const unauthorized = await fetch(endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini' }),
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(catalogueQueries.length, before);
  });
  await test('Gemini filters use POST body; omitted, explicit, and any language preserve precedence', async () => {
    for (const [language, expected] of [[undefined, 'en-AU'], ['en-US', 'en-US'], ['any', null]] as const) {
      library._resetLibraryIndex();
      const before = catalogueQueries.length;
      const response = await fetch(`${endpoint}?language=wrong-query-language&gender=wrong-query-gender`, {
        method: 'POST', headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'gemini', language, gender: 'male', pageSize: 17, pageToken: 'body-token' }),
      });
      assert.equal(response.status, 200);
      const result = await response.json() as any;
      assert.equal(result.ok, true);
      assert.equal(result.voices[0].id, 'en-au-advisor-1');
      assert.equal(result.facets.ready, true);
      assert.deepEqual(result.facets.accents, ['Sydney English']);
      const q = catalogueQueries[before];
      assert.equal(q.get('language_code'), expected);
      assert.equal(q.get('gender'), 'male');
      assert.equal(q.get('page_size'), '17');
      assert.equal(q.get('page_token'), 'body-token');
    }
    assert.equal(settings.get().tts.gemini.libraryLanguage, 'en-AU', 'browsing must not save unsaved filters');
  });
} finally {
  globalThis.fetch = originalFetch;
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(state, { recursive: true, force: true });
}

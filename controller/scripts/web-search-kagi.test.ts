import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.STATE_DIR = mkdtempSync(join(tmpdir(), 'subwave-web-search-kagi-'));
delete process.env.SEARCH_API_KEY;
delete process.env.KAGI_API_KEY;
const settings = await import('../src/settings.js');
const {
  braveSearch,
  kagiAfterDate,
  kagiSearch,
  parseKagiResponse,
  searchCacheKey,
  searchReady,
  searchWeb,
  tavilySearch,
} = await import('../src/skills/web-search.js');
await settings.load();

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'));

async function withFetch(
  response: Response,
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = async () => response;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failures++;
    console.error(`  ✗ ${name}\n      ${err?.message || err}`);
  }
}

console.log('Kagi Search adapter:');

await test('parses Kagi buckets with expected ordering and safety limits', () => {
  assert.deepEqual(
    parseKagiResponse(fixture('kagi-artist.json')).results.map((r: any) => r.title),
    ['Artist profile', 'Duplicate', 'Artist announces world tour', 'A new interview'],
  );
  assert.deepEqual(
    parseKagiResponse(fixture('kagi-artist.json'), 'week').results.map((r: any) => r.title),
    ['Artist announces world tour', 'Duplicate from news', 'A new interview', 'Artist profile'],
  );
  assert.equal(parseKagiResponse(fixture('kagi-artist.json')).answer, '');
  assert.deepEqual(parseKagiResponse(fixture('kagi-empty.json')), { answer: '', results: [] });
  assert.deepEqual(parseKagiResponse({ data: 'bad' }), { answer: '', results: [] });

  const normal = parseKagiResponse(fixture('kagi-artist.json'));
  assert.equal(normal.results[0].content, 'A & B profile.');
  assert.equal(normal.results.some((r: any) => r.title === 'Answer'), false);
  assert.equal(normal.results.some((r: any) => r.title === 'Infobox'), false);

  const encodedMarkup = parseKagiResponse({
    data: {
      search: [{
        url: 'https://example.test/encoded',
        title: '&lt;b&gt;Encoded&lt;/b&gt;&nbsp;Title',
        snippet: 'One&nbsp;&amp;&nbsp;two&hellip; &lt;em&gt;safe&lt;/em&gt;',
      }],
    },
  });
  assert.deepEqual(encodedMarkup.results, [{
    title: 'Encoded Title',
    content: 'One & two… safe',
  }]);

  const capped = parseKagiResponse({
    data: {
      search: Array.from({ length: 12 }, (_, i) => ({
        url: `https://example.test/${i}`,
        title: `Result ${i}`,
        snippet: 'x'.repeat(400),
      })),
    },
  });
  assert.equal(capped.results.length, 10);
  assert.equal(capped.results.every((r: any) => r.content.length === 300), true);

  const fallbackDedup = parseKagiResponse({
    data: {
      search: [
        { url: '', title: 'Same', snippet: 'Same snippet' },
        { url: '', title: ' same ', snippet: ' same snippet ' },
      ],
    },
  });
  assert.equal(fallbackDedup.results.length, 1);

  assert.deepEqual(
    parseKagiResponse({
      data: {
        interesting_finds: [
          { url: 'https://small.test', title: 'Small web', snippet: 'Excluded.' },
        ],
      },
    }),
    { answer: '', results: [] },
  );
});

await test('derives dates and cache keys', () => {
  assert.equal(kagiAfterDate('day', new Date('2026-07-25T12:00:00Z')), '2026-07-24');
  assert.equal(kagiAfterDate('week', new Date('2026-07-25T12:00:00Z')), '2026-07-18');
  assert.equal(kagiAfterDate('month', new Date('2026-07-25T12:00:00Z')), '2026-06-25');
  assert.equal(searchCacheKey('kagi', 'Artist News', 'week'), 'kagi:week:artist news');
  assert.equal(searchCacheKey('brave', 'Artist News'), 'brave::artist news');
});

await test('sends the Kagi API request contract', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://kagi.com/api/v1/search');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer kagi-test-key');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body, {
      query: 'artist news',
      workflow: 'search',
      format: 'json',
      limit: 10,
      safe_search: true,
      filters: { after: '2026-07-18' },
    });
    return new Response(JSON.stringify(fixture('kagi-artist.json')), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    await kagiSearch('artist news', 'week', {
      apiKey: 'kagi-test-key',
      now: new Date('2026-07-25T12:00:00Z'),
    });
  } finally {
    globalThis.fetch = original;
  }
});

await test('reports Kagi key, HTTP, and malformed-response failures', async () => {
  await assert.rejects(
    kagiSearch('query', undefined, { apiKey: '' }),
    /Kagi Search API key not configured/,
  );
  await withFetch(new Response('{}', { status: 401 }), () =>
    assert.rejects(
      kagiSearch('query', undefined, { apiKey: 'key' }),
      /Kagi Search HTTP 401/,
    ));
  await withFetch(new Response('{}', { status: 429 }), () =>
    assert.rejects(
      kagiSearch('query', undefined, { apiKey: 'key' }),
      /Kagi Search HTTP 429/,
    ));
  await withFetch(
    new Response(JSON.stringify({ data: 'bad' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
    () => assert.rejects(
      kagiSearch('query', undefined, { apiKey: 'key' }),
      /unsupported response/,
    ),
  );
});

await test('dispatches Kagi and keeps all keyed providers credential-isolated', async () => {
  delete process.env.KAGI_API_KEY;
  process.env.SEARCH_API_KEY = 'wrong-shared-key';
  await settings.update({ search: {
    provider: 'kagi',
    apiKeys: { kagi: null },
  } });
  assert.equal(searchReady(), false, 'Kagi must not consume SEARCH_API_KEY');

  process.env.KAGI_API_KEY = 'kagi-env-key';
  assert.equal(searchReady(), true);
  await withFetch(
    new Response(JSON.stringify(fixture('kagi-empty.json')), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
    async () => {
      assert.deepEqual(await searchWeb('dispatch proof'), { answer: '', results: [] });
    },
  );
  delete process.env.KAGI_API_KEY;
  delete process.env.SEARCH_API_KEY;

  await settings.update({ search: {
    provider: 'brave',
    apiKeys: { brave: 'saved-brave-key', tavily: null },
  } });
  let braveAuthorization = '';
  const original = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    braveAuthorization = new Headers(init?.headers).get('X-Subscription-Token') || '';
    return new Response(JSON.stringify({ web: { results: [] } }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    assert.equal(searchReady(), true, 'saved Brave key should make it ready');
    await braveSearch('saved brave key proof');
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(braveAuthorization, 'saved-brave-key');

  await settings.update({ search: {
    provider: 'tavily',
    apiKeys: { brave: null, tavily: 'saved-tavily-key' },
  } });
  let tavilyAuthorization = '';
  globalThis.fetch = async (_input, init) => {
    tavilyAuthorization = new Headers(init?.headers).get('Authorization') || '';
    return new Response(JSON.stringify({ answer: '', results: [] }), {
      headers: { 'Content-Type': 'application/json' },
    });
  };
  try {
    assert.equal(searchReady(), true, 'saved Tavily key should make it ready');
    await tavilySearch('saved tavily key proof');
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(tavilyAuthorization, 'Bearer saved-tavily-key');

  await settings.update({ search: {
    provider: 'brave',
    apiKeys: { brave: null, tavily: 'saved-tavily-key' },
  } });
  assert.equal(searchReady(), false, 'Brave must not consume Tavily credentials');
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log('\nAll Kagi adapter tests passed.');

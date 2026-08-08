import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bulkEmbeddingBatchSize,
  bulkEmbeddingFailureMessage,
  commitBulkEmbeddingBatch,
  safeEmbeddingFailureClass,
  withBulkEmbeddingRateLimit,
} from '../src/music/embedding-bulk.js';
import { isLocalEmbeddingProvider } from '../src/llm/provider.js';

async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}`); throw err; }
}

console.log('bulk embedding rate policy:');

await test('cloud providers use 64 tracks per request', () => {
  assert.equal(bulkEmbeddingBatchSize(5, false), 64);
  assert.equal(bulkEmbeddingBatchSize(50, false), 64);
});

await test('local providers retain the bounded operator-derived size', () => {
  assert.equal(bulkEmbeddingBatchSize(1, true), 8);
  assert.equal(bulkEmbeddingBatchSize(5, true), 10);
  assert.equal(bulkEmbeddingBatchSize(50, true), 64);
});

await test('remote HTTPS openai-compatible endpoints use the cloud batch', () => {
  const local = isLocalEmbeddingProvider(
    'openai-compatible',
    'https://litellm.example.com/v1',
  );
  assert.equal(local, false);
  assert.equal(bulkEmbeddingBatchSize(25, local), 64);
});

await test('HTTP self-hosted openai-compatible endpoints retain the local bounded batch', () => {
  const local = isLocalEmbeddingProvider(
    'openai-compatible',
    'http://odin.example.test:4000/v1',
  );
  assert.equal(local, true);
  assert.equal(bulkEmbeddingBatchSize(25, local), 50);
});

await test('safe classifications unwrap SDK errors without exposing provider text', () => {
  const wrapped: any = {
    name: 'AI_RetryError',
    lastError: Object.assign(new Error('token=do-not-print responseBody=secret'), {
      statusCode: 503,
    }),
  };
  const fixtures: Array<[unknown, string]> = [
    [wrapped, 'HTTP 503'],
    [{ cause: { code: 'ECONNRESET', message: 'api_key=do-not-print' } }, 'ECONNRESET'],
    [{ name: 'TimeoutError', message: 'token=do-not-print' }, 'timeout'],
    [new Error('api_key=do-not-print'), 'unclassified error'],
  ];

  for (const [error, expected] of fixtures) {
    const classification = safeEmbeddingFailureClass(error);
    assert.equal(classification, expected);
    assert.equal(classification.includes('do-not-print'), false);
    assert.equal(classification.includes('secret'), false);
  }
});

await test('Retry-After 60 retries the identical request after a safety margin', async () => {
  const rateLimit: any = new Error('rate limit exceeded');
  rateLimit.statusCode = 429;
  rateLimit.responseHeaders = { 'retry-after': '60' };
  let calls = 0;
  const waits: number[] = [];
  const notices: unknown[] = [];
  const result = await withBulkEmbeddingRateLimit(
    async () => { calls += 1; if (calls === 1) throw rateLimit; return 'ok'; },
    { sleep: async ms => { waits.push(ms); }, onWait: notice => notices.push(notice) },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
  assert.deepEqual(waits, [60_250]);
  assert.deepEqual(notices, [{
    seconds: 60,
    attempt: 1,
    kind: 'rate-limit',
    classification: 'HTTP 429',
  }]);
  assert.equal(JSON.stringify(notices).includes('rate limit exceeded'), false);
});

await test('permanent errors and rate limits without a safe Retry-After fail immediately', async () => {
  for (const error of [
    Object.assign(new Error('api_key=do-not-print'), { statusCode: 400 }),
    Object.assign(new Error('api_key=do-not-print'), { statusCode: 401 }),
    Object.assign(new Error('rate limit api_key=do-not-print'), { statusCode: 429, responseHeaders: {} }),
    Object.assign(new Error('rate limit api_key=do-not-print'), { statusCode: 429, responseHeaders: { 'retry-after': '0' } }),
    Object.assign(new Error('rate limit api_key=do-not-print'), { statusCode: 429, responseHeaders: { 'retry-after': '66' } }),
  ]) {
    let slept = false;
    await assert.rejects(() => withBulkEmbeddingRateLimit(
      async () => { throw error; },
      { sleep: async () => { slept = true; } },
    ));
    assert.equal(slept, false);
  }
});

await test('transient embedding failures retry three times with a bounded backoff', async () => {
  const transient = Object.assign(new Error('responseBody=do-not-print'), { statusCode: 503 });
  let calls = 0;
  const waits: number[] = [];
  const notices: unknown[] = [];
  const result = await withBulkEmbeddingRateLimit(
    async () => { calls += 1; if (calls < 4) throw transient; return 'ok'; },
    { sleep: async ms => { waits.push(ms); }, onWait: notice => notices.push(notice) },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 4);
  assert.deepEqual(waits, [500, 1_500, 3_500]);
  assert.deepEqual(notices, [
    { seconds: 1, attempt: 1, kind: 'transient', classification: 'HTTP 503' },
    { seconds: 2, attempt: 2, kind: 'transient', classification: 'HTTP 503' },
    { seconds: 4, attempt: 3, kind: 'transient', classification: 'HTTP 503' },
  ]);
  assert.equal(JSON.stringify(notices).includes('do-not-print'), false);
});

await test('transient embedding failures throw after their bounded retry budget', async () => {
  const transient = Object.assign(new Error('responseBody=do-not-print'), { statusCode: 503 });
  let calls = 0;
  const waits: number[] = [];
  const notices: unknown[] = [];
  await assert.rejects(() => withBulkEmbeddingRateLimit(
    async () => { calls += 1; throw transient; },
    { sleep: async ms => { waits.push(ms); }, onWait: notice => notices.push(notice) },
  ));
  assert.equal(calls, 4);
  assert.deepEqual(waits, [500, 1_500, 3_500]);
  assert.equal(notices.length, 3);
  assert.equal(JSON.stringify(notices).includes('do-not-print'), false);
});

await test('fatal operator copy never contains the raw gateway error', () => {
  const error: any = Object.assign(new Error('token sk-secret responseBody api_key=hash'), {
    statusCode: 429,
    responseHeaders: { 'retry-after': '120' },
  });
  const message = bulkEmbeddingFailureMessage(error);
  assert.equal(message, 'Embedding service rate limit could not be safely retried (HTTP 429)');
  assert.equal(message.includes('secret'), false);
  assert.equal(message.includes('api_key'), false);
});

await test('fatal operator copy includes only the safe transient classification', () => {
  const message = bulkEmbeddingFailureMessage(Object.assign(
    new Error('token=do-not-print'),
    { statusCode: 503 },
  ));
  assert.equal(message, 'Embedding service request failed (HTTP 503)');
  assert.equal(message.includes('do-not-print'), false);
});

await test('a permanently throttled batch stops after three waits', async () => {
  const error: any = Object.assign(new Error('rate limit'), {
    statusCode: 429,
    responseHeaders: { 'retry-after': '1' },
  });
  let calls = 0;
  let sleeps = 0;
  await assert.rejects(() => withBulkEmbeddingRateLimit(
    async () => { calls += 1; throw error; },
    { sleep: async () => { sleeps += 1; } },
  ));
  assert.equal(calls, 4);
  assert.equal(sleeps, 3);
});

await test('a transiently failing cloud batch advances progress once, only after all upserts', async () => {
  const transient: any = Object.assign(new Error('token=do-not-print'), { statusCode: 503 });
  const vectors = Array.from({ length: 64 }, (_, i) => [i]);
  let calls = 0;
  let upserts = 0;
  let progress = 0;
  const progressUpdates: number[] = [];

  const result = await withBulkEmbeddingRateLimit(
    async () => {
      calls += 1;
      if (calls === 1) throw transient;
      return vectors;
    },
    {
      sleep: async () => {
        assert.equal(upserts, 0);
        assert.equal(progress, 0);
        assert.deepEqual(progressUpdates, []);
      },
    },
  );

  commitBulkEmbeddingBatch({
    result,
    commit: result => {
      for (const vector of result) {
        assert.deepEqual(vector, [upserts]);
        upserts += 1;
      }
    },
    onCommitted: () => {
      assert.equal(upserts, 64);
      progress += 64;
      progressUpdates.push(progress);
    },
  });

  assert.equal(calls, 2);
  assert.equal(upserts, 64);
  assert.equal(progress, 64);
  assert.deepEqual(progressUpdates, [64]);
});

await test('tagger wires bulk retry only around document embeddings', () => {
  const tagger = readFileSync(
    new URL('../src/music/tag-library/embed.ts', import.meta.url),
    'utf8',
  );
  assert.match(tagger, /bulkEmbeddingBatchSize\(/);
  assert.match(tagger, /commitBulkEmbeddingBatch\(/);
  assert.match(tagger, /embedDocTexts\(texts, textMode, \{ maxRetries: 0 \}\)/);
  const embedPhase = tagger.slice(tagger.indexOf('withBulkEmbeddingRateLimit('));
  assert.match(embedPhase, /notice\.classification/);
  assert.doesNotMatch(embedPhase, /err\.message/);
  assert.match(
    tagger,
    /commit: vecs => \{[\s\S]*?upsertTrackVector[\s\S]*?onCommitted: \(\) => \{[\s\S]*?reportProgress/,
  );
});

await test('interactive query embeddings do not opt into bulk retry', () => {
  const source = readFileSync(new URL('../src/music/embeddings.ts', import.meta.url), 'utf8');
  const queryBody = source.slice(source.indexOf('export async function embedQueryText'));
  assert.doesNotMatch(queryBody, /withBulkEmbeddingRateLimit/);
  assert.doesNotMatch(queryBody, /maxRetries:\s*0/);
});

console.log('\nall bulk embedding rate-policy tests passed');

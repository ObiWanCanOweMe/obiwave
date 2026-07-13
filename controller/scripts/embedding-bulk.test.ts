import assert from 'node:assert/strict';
import {
  bulkEmbeddingBatchSize,
  bulkEmbeddingFailureMessage,
  withBulkEmbeddingRateLimit,
} from '../src/music/embedding-bulk.js';

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
  assert.deepEqual(notices, [{ seconds: 60, attempt: 1 }]);
  assert.equal(JSON.stringify(notices).includes('rate limit exceeded'), false);
});

await test('non-rate-limit and unusable delays fail immediately', async () => {
  for (const error of [
    Object.assign(new Error('boom'), { statusCode: 500 }),
    Object.assign(new Error('rate limit'), { statusCode: 429, responseHeaders: {} }),
    Object.assign(new Error('rate limit'), { statusCode: 429, responseHeaders: { 'retry-after': '0' } }),
    Object.assign(new Error('rate limit'), { statusCode: 429, responseHeaders: { 'retry-after': '66' } }),
  ]) {
    let slept = false;
    await assert.rejects(() => withBulkEmbeddingRateLimit(
      async () => { throw error; },
      { sleep: async () => { slept = true; } },
    ));
    assert.equal(slept, false);
  }
});

await test('fatal operator copy never contains the raw gateway error', () => {
  const error: any = Object.assign(new Error('token sk-secret responseBody api_key=hash'), {
    statusCode: 429,
    responseHeaders: { 'retry-after': '120' },
  });
  const message = bulkEmbeddingFailureMessage(error);
  assert.equal(message, 'Embedding service rate limit could not be safely retried');
  assert.equal(message.includes('secret'), false);
  assert.equal(message.includes('api_key'), false);
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

console.log('\nall bulk embedding rate-policy tests passed');

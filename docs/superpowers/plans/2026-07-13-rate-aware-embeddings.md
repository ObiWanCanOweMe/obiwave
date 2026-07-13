# Rate-Aware Cloud Embeddings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the SUB/WAVE library tagger complete cloud embedding passes through a LiteLLM key limited to 20 requests per minute, while preserving completed vectors and visible Admin progress.

**Architecture:** Add a small, pure bulk-embedding policy module that chooses cloud batch size and retries only valid 429 responses using their `Retry-After` delay. Wire that policy only into the tagger's document-embedding path with AI SDK internal retries disabled; interactive query embeddings, probes, and DJ calls retain their current latency behavior. Deploy only the controller and resume the partial index with a normal forward run.

**Tech Stack:** TypeScript, Vercel AI SDK `embedMany`, SUB/WAVE controller/tagger, Node/tsx tests, Docker Compose production stack.

## Global Constraints

- Apply rate-limit waiting only to bulk document embeddings created by the library tagger.
- Keep interactive query embeddings, preflight probes, DJ calls, and chat failover latency unchanged.
- Use batches of 64 tracks for cloud embedding providers; preserve the existing bounded operator-derived size for local providers.
- Accept LiteLLM's observed `Retry-After: 60`, add a 250 ms safety margin, and reject missing, invalid, zero, or over-65-second retry delays.
- Retry the identical batch and advance progress only after success.
- Allow at most three consecutive rate-limit waits without an intervening successful request.
- Never place raw gateway errors, headers, response bodies, API-key identifiers, or tokens in operator-facing logs.
- Resume the partial `openai-compatible:cohere.embed-english-v3` 1024-dimensional index without reseeding or dropping vectors.
- Preserve mood/energy tags, enrichment, acoustic analysis, DJ session state, Odin analyzer, web, and broadcast services.
- Rebuild and recreate only the production controller service.

---

### Task 1: Add the pure bulk embedding rate policy

**Files:**
- Create: `controller/src/music/embedding-bulk.ts`
- Create: `controller/scripts/embedding-bulk.test.ts`
- Modify: `controller/src/llm/sdk.ts`

**Interfaces:**
- Consumes: `isRateLimited(error): boolean` and `retryAfterMs(error): number | null` from the public `llm/sdk.js` barrel.
- Produces: `bulkEmbeddingBatchSize(tagBatchSize: number, local: boolean): number` and `withBulkEmbeddingRateLimit<T>(request, options): Promise<T>`.

- [ ] **Step 1: Write the failing bulk-policy test**

Create `controller/scripts/embedding-bulk.test.ts` with tests for local/cloud batch sizes, a successful 60-second retry, fatal non-429 and invalid-delay errors, secret-safe callback data, and the three-wait ceiling:

```ts
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
```

- [ ] **Step 2: Run the auto-discovered test directly to verify RED**

The full runner auto-discovers `scripts/*.test.ts`; no registry edit is needed. Run:

```bash
cd controller
npx tsx scripts/embedding-bulk.test.ts
```

Expected: failure because `../src/music/embedding-bulk.js` does not exist.

- [ ] **Step 3: Export the existing classifiers through the public barrel**

Extend `controller/src/llm/sdk.ts` without changing their implementations:

```ts
export {
  isUnreachable,
  isQuotaOrAuthError,
  isRateLimited,
  errReason,
  nearestId,
  stripThinking,
  modelTolerant,
} from './internal/core/pure.js';
export { retryAfterMs } from './internal/core/retry.js';
```

- [ ] **Step 4: Implement the pure bulk policy**

Create `controller/src/music/embedding-bulk.ts`:

```ts
import { isRateLimited, retryAfterMs } from '../llm/sdk.js';

export const CLOUD_EMBED_BATCH_SIZE = 64;
export const MAX_BULK_RETRY_AFTER_MS = 65_000;
export const BULK_RETRY_SAFETY_MS = 250;
export const MAX_CONSECUTIVE_RATE_LIMIT_WAITS = 3;

export interface BulkEmbeddingWaitNotice {
  seconds: number;
  attempt: number;
}

export interface BulkEmbeddingRetryOptions {
  sleep?: (ms: number) => Promise<void>;
  onWait?: (notice: BulkEmbeddingWaitNotice) => void;
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function bulkEmbeddingBatchSize(tagBatchSize: number, local: boolean): number {
  if (!local) return CLOUD_EMBED_BATCH_SIZE;
  return Math.max(8, Math.min(64, tagBatchSize * 2));
}

function usableRateLimitDelay(err: unknown): number | null {
  if (!isRateLimited(err)) return null;
  const hinted = retryAfterMs(err);
  if (hinted == null || hinted > MAX_BULK_RETRY_AFTER_MS) return null;
  return hinted;
}

export function bulkEmbeddingFailureMessage(err: unknown): string {
  return isRateLimited(err)
    ? 'Embedding service rate limit could not be safely retried'
    : 'Embedding service request failed';
}

export async function withBulkEmbeddingRateLimit<T>(
  request: () => Promise<T>,
  options: BulkEmbeddingRetryOptions = {},
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  let waits = 0;
  while (true) {
    try {
      return await request();
    } catch (err) {
      const hinted = usableRateLimitDelay(err);
      if (hinted == null || waits >= MAX_CONSECUTIVE_RATE_LIMIT_WAITS) throw err;
      waits += 1;
      options.onWait?.({ seconds: Math.ceil(hinted / 1000), attempt: waits });
      await sleep(hinted + BULK_RETRY_SAFETY_MS);
    }
  }
}
```

- [ ] **Step 5: Run focused tests and typecheck to verify GREEN**

```bash
cd controller
npx tsx scripts/embedding-bulk.test.ts
npm run typecheck
```

Expected: the new test prints `all bulk embedding rate-policy tests passed`; TypeScript exits 0.

- [ ] **Step 6: Commit Task 1**

```bash
git add controller/src/music/embedding-bulk.ts controller/src/llm/sdk.ts \
  controller/scripts/embedding-bulk.test.ts
git commit -m "feat: add bulk embedding rate policy"
```

---

### Task 2: Wire rate-aware retries into document embeddings only

**Files:**
- Modify: `controller/src/music/embeddings.ts`
- Modify: `controller/src/music/tag-library.ts`
- Modify: `controller/scripts/embedding-bulk.test.ts`

**Interfaces:**
- Consumes: `bulkEmbeddingBatchSize()` and `withBulkEmbeddingRateLimit()` from Task 1.
- Produces: `embedDocTexts(texts, mode, { maxRetries: 0 })`; `embedQueryText()` retains its existing default AI SDK behavior.

- [ ] **Step 1: Extend the test with source-boundary assertions and verify RED**

Add `readFileSync` to the test's import block and append the boundary tests:

```ts
import { readFileSync } from 'node:fs';

await test('tagger wires bulk retry only around document embeddings', () => {
  const tagger = readFileSync(new URL('../src/music/tag-library.ts', import.meta.url), 'utf8');
  assert.match(tagger, /bulkEmbeddingBatchSize\(/);
  assert.match(tagger, /withBulkEmbeddingRateLimit\(/);
  assert.match(tagger, /embedDocTexts\(texts, textMode, \{ maxRetries: 0 \}\)/);
});

await test('interactive query embeddings do not opt into bulk retry', () => {
  const source = readFileSync(new URL('../src/music/embeddings.ts', import.meta.url), 'utf8');
  const queryBody = source.slice(source.indexOf('export async function embedQueryText'));
  assert.doesNotMatch(queryBody, /withBulkEmbeddingRateLimit/);
  assert.doesNotMatch(queryBody, /maxRetries:\s*0/);
});
```

Run:

```bash
cd controller
npx tsx scripts/embedding-bulk.test.ts
```

Expected: failure because the tagger does not yet call the Task 1 helpers or disable SDK retries.

- [ ] **Step 2: Add an optional retry override to the embedding transport**

In `controller/src/music/embeddings.ts`, introduce:

```ts
export interface EmbedTextOptions {
  maxRetries?: number;
}

export async function embedTexts(
  texts: string[],
  options: EmbedTextOptions = {},
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = embeddingModel();
  const { embeddings } = await embedMany({
    model,
    values: texts,
    ...(options.maxRetries != null ? { maxRetries: options.maxRetries } : {}),
  });
  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    throw new Error(
      `embedMany returned ${embeddings?.length ?? 'no'} vectors for ${texts.length} texts`,
    );
  }
  return embeddings as number[][];
}
```

Change only the document helper signature:

```ts
export function embedDocTexts(
  texts: string[],
  mode: IndexTextMode,
  options: EmbedTextOptions = {},
): Promise<number[][]> {
  return embedTexts(texts.map(t => applyDocPrefix(t, mode)), options);
}
```

Leave `embedQueryText()` calling `embedTexts([...])` without options.

- [ ] **Step 3: Wire cloud batching, retry, and secret-safe Admin warnings**

In `controller/src/music/tag-library.ts`, import:

```ts
import {
  bulkEmbeddingBatchSize,
  bulkEmbeddingFailureMessage,
  withBulkEmbeddingRateLimit,
} from './embedding-bulk.js';
```

Replace the batch-size calculation and request block in `phaseEmbed()` with:

```ts
const local = embeddings.embeddingPerfAdvisory().local;
const embedBatchSize = bulkEmbeddingBatchSize(batchSize, local);

// inside the existing batch loop
vecs = await withBulkEmbeddingRateLimit(
  () => embeddings.embedDocTexts(texts, textMode, { maxRetries: 0 }),
  {
    onWait: ({ seconds, attempt }) => {
      const again = attempt > 1 ? ` (attempt ${attempt})` : '';
      logEvent(
        'warning',
        `Embedding service rate limit reached — waiting ${seconds}s before retrying this batch${again}`,
      );
    },
  },
);
```

Replace the existing fatal catch so rejected errors are sanitized before either the structured log or the top-level process handler can capture them:

```ts
} catch (err) {
  const message = bulkEmbeddingFailureMessage(err);
  logEvent('error', message);
  throw new Error(message);
}
```

- [ ] **Step 4: Run focused and full controller verification**

```bash
cd controller
npx tsx scripts/embedding-bulk.test.ts
npx tsx scripts/embedding-prefix.test.ts
npm test
npm run lint
```

Expected: all tests pass; ESLint and `tsc --noEmit` exit 0.

- [ ] **Step 5: Verify the diff is scoped and secret-safe**

```bash
git diff --check
git diff -- controller/src/music/embedding-bulk.ts controller/src/music/embeddings.ts \
  controller/src/music/tag-library.ts controller/src/llm/sdk.ts \
  controller/scripts/embedding-bulk.test.ts
```

Expected: no unrelated changes; operator warning contains only delay/attempt values.

- [ ] **Step 6: Commit Task 2**

```bash
git add controller/src/music/embeddings.ts controller/src/music/tag-library.ts \
  controller/scripts/embedding-bulk.test.ts
git commit -m "fix: honor embedding rate limit waits"
```

---

### Task 3: Integrate, deploy the controller, and resume the partial index

**Files:**
- Merge commits: feature worktree branch into local `develop`
- Rebuild/recreate: production `controller` service only
- Modify through API: `state/library.db` missing text vectors and remaining mood tags
- Preserve: all other services and existing library artifacts

**Interfaces:**
- Consumes: Task 2's rate-aware document embedding path and the saved LiteLLM key/configuration.
- Produces: a terminal successful normal forward tag run with complete 1024-dimensional text-vector coverage.

- [ ] **Step 1: Run final branch verification before integration**

```bash
cd controller
npm test
npm run lint
cd ..
git diff --check
git status --short --branch
```

Expected: tests/lint pass; only the known unrelated `controller/scripts/__pycache__/` may remain untracked in the main checkout.

- [ ] **Step 2: Merge the reviewed feature branch into local `develop`**

From the main checkout:

```bash
git switch develop
git merge --no-ff feat/rate-aware-embeddings
```

Expected: clean merge containing only the approved controller/test changes and documentation commits.

- [ ] **Step 3: Rebuild and recreate only the live controller**

```bash
docker compose build controller
docker compose up -d --no-deps controller
docker compose ps controller broadcast web analyzer
```

Expected: controller recreated and healthy; broadcast, web, and analyzer container identities/start times remain unchanged.

- [ ] **Step 4: Verify configuration and on-air health before resuming**

Load credentials without printing them, then run:

```bash
set -a
. ./.env
set +a
ADMIN_AUTH="$ADMIN_USER:$ADMIN_PASS"

curl -fsS --max-time 30 -u "$ADMIN_AUTH" \
  http://localhost:7700/api/settings/embedding/probe \
  | jq -e '.ok == true and .dim == 1024'

.claude/skills/subwave-deploy/scripts/health-check.sh
```

Expected: probe assertion `true`; stream is on-air with non-silent audio.

- [ ] **Step 5: Record the resume boundary and start the exact normal forward run**

```bash
curl -fsS --max-time 10 -u "$ADMIN_AUTH" http://localhost:7700/api/settings \
  | jq '{withEmbedding:.libraryStats.withEmbedding,tagged:.libraryStats.total,embeddingMeta:.libraryStats.embeddingMeta}'

curl -fsS --max-time 15 -u "$ADMIN_AUTH" \
  -H 'Content-Type: application/json' \
  -X POST http://localhost:7700/api/tag-library \
  --data-binary '{"reconcile":false,"enrich":false,"tagMoods":true,"analyze":false}' \
  | jq -e '.ok == true and .tagger.running == true'
```

Expected: starts without `reseed`, `limit`, or any `re*` flag; existing vectors remain.

- [ ] **Step 6: Prove the rate-aware wait and Admin progress survive a 20-RPM window**

Poll every 30 seconds. Require all of the following before considering the fix live:

```bash
curl -fsS --max-time 10 -u "$ADMIN_AUTH" http://localhost:7700/api/library/tagger \
  | jq '{running:.tagger.running,progress:.tagger.progress,lastLog:.tagger.lastLog[-8:]}'
```

Expected:

- `progress.phase == "embed"` with a determinate missing-vector total.
- Progress advances beyond 1,280 tracks (20 cloud requests × 64 tracks).
- A structured warning says the service is waiting before retrying a batch.
- The child remains running after the warning and later progress advances again.
- No raw response, header, token, or API-key identifier appears in `lastLog`.

- [ ] **Step 7: Monitor to terminal success and verify final state**

Poll no faster than every 30 seconds until `running == false`, then run:

```bash
curl -fsS --max-time 10 -u "$ADMIN_AUTH" http://localhost:7700/api/library/tagger \
  | jq -e '.tagger.lastRun.outcome == "ok"'

curl -fsS --max-time 10 -u "$ADMIN_AUTH" http://localhost:7700/api/settings \
  | jq -e '
      .libraryStats.withEmbedding == 44851 and
      .libraryStats.embeddingMeta.model == "openai-compatible:cohere.embed-english-v3" and
      .libraryStats.embeddingMeta.dim == 1024
    '

curl -fsS --max-time 10 -u "$ADMIN_AUTH" http://localhost:7700/api/library/coverage \
  | jq -e '
      .embeddedModel == "openai-compatible:cohere.embed-english-v3" and
      .embeddedDim == 1024 and
      .currentEmbeddingModel == "openai-compatible:cohere.embed-english-v3" and
      .embeddingStale == false
    '

.claude/skills/subwave-deploy/scripts/health-check.sh
```

Expected: terminal `ok`, full vector coverage, correct model/dimension, no staleness, and non-silent on-air audio. If the catalogue total changed during the run, compare `withEmbedding` to the fresh `/api/library/coverage.total` instead of hard-coding 44,851 and document the exact delta.

- [ ] **Step 8: Clear sensitive shell values and record the operational report**

```bash
unset ADMIN_AUTH
```

Append sanitized deployment, rate-wait, final coverage, duration, and stream-health results to `.superpowers/sdd/task-2-report.md`. Do not commit this ignored operational report.

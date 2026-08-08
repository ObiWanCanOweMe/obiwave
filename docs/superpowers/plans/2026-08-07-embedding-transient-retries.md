# Embedding Transient Retries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bulk library embeddings survive bounded transient provider failures while reporting only a sanitized HTTP or transport classification.

**Architecture:** Keep AI SDK retries disabled and extend the existing bulk-only wrapper in `embedding-bulk.ts`. Reuse the shared `isTransient` decision through the public LLM barrel, but own embedding-specific delays, `Retry-After` limits, and sanitized diagnostic rendering in the music layer.

**Tech Stack:** TypeScript, Vercel AI SDK error shapes, SUB/WAVE controller script tests, ESLint, TypeScript compiler.

## Global Constraints

- Apply retries only to bulk document embeddings used by the library tagger.
- Use three transient retries with fixed delays of 500 ms, 1,500 ms, and 3,500 ms.
- Preserve the existing three-wait, 65-second maximum `Retry-After` policy and 250 ms safety margin.
- Keep the underlying `embedMany` call at `maxRetries: 0`.
- Never expose exception messages, response bodies, headers, URLs, prompts, model input, or credentials.
- Commit vectors and update progress exactly once, only after a whole batch succeeds.

---

### Task 1: Safe classification and bounded transient retry

**Files:**
- Modify: `controller/src/llm/sdk.ts`
- Modify: `controller/src/music/embedding-bulk.ts`
- Test: `controller/scripts/embedding-bulk.test.ts`

**Interfaces:**
- Consumes: `isTransient(error)` and `isRateLimited(error)` from the stable `llm/sdk.ts` barrel.
- Produces: `safeEmbeddingFailureClass(error): string` and the extended `withBulkEmbeddingRateLimit(request, options)` behavior.
- Extends: `BulkEmbeddingWaitNotice` with `kind: 'rate-limit' | 'transient'` and `classification: string`.

- [ ] **Step 1: Write failing classification tests**

Add assertions proving the classifier returns `HTTP 503`, `ECONNRESET`, `timeout`, and `unclassified error` for direct and AI SDK-wrapped errors. Include raw secret-shaped messages in every fixture and assert they never appear in the result.

```ts
await test('safe classifications unwrap SDK errors without exposing provider text', () => {
  const wrapped: any = {
    name: 'AI_RetryError',
    lastError: Object.assign(new Error('token=do-not-print responseBody=secret'), {
      statusCode: 503,
    }),
  };
  assert.equal(safeEmbeddingFailureClass(wrapped), 'HTTP 503');
  assert.equal(safeEmbeddingFailureClass({ cause: { code: 'ECONNRESET' } }), 'ECONNRESET');
  assert.equal(safeEmbeddingFailureClass({ name: 'TimeoutError' }), 'timeout');
  assert.equal(
    safeEmbeddingFailureClass(new Error('api_key=do-not-print')),
    'unclassified error',
  );
});
```

- [ ] **Step 2: Write failing transient retry tests**

Add one recovery test and one exhaustion test. Inject `sleep` to capture the exact 500/1,500/3,500 ms sequence without wall-clock waits, and assert notices contain only the sanitized category.

```ts
await test('transient embedding failures retry three times with a bounded backoff', async () => {
  const transient = Object.assign(new Error('responseBody=do-not-print'), { statusCode: 503 });
  let calls = 0;
  const waits: number[] = [];
  const notices: unknown[] = [];
  const result = await withBulkEmbeddingRateLimit(
    async () => { calls += 1; if (calls < 4) throw transient; return 'ok'; },
    { sleep: async ms => waits.push(ms), onWait: notice => notices.push(notice) },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 4);
  assert.deepEqual(waits, [500, 1_500, 3_500]);
  assert.equal(JSON.stringify(notices).includes('do-not-print'), false);
});
```

Also prove HTTP 400/401 and recognised rate limits without a safe `Retry-After` still fail immediately.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
cd controller && npx tsx scripts/embedding-bulk.test.ts
```

Expected: FAIL because `safeEmbeddingFailureClass` is not exported and HTTP 503 still fails without sleeping.

- [ ] **Step 4: Export the shared transient classifier**

Add `isTransient` to the existing public export list in `controller/src/llm/sdk.ts`. Do not add an internal import from the music layer.

```ts
export {
  isTransient,
  isUnreachable,
  // existing exports remain unchanged
} from './internal/core/pure.js';
```

- [ ] **Step 5: Implement safe classification**

In `embedding-bulk.ts`, unwrap only structural error containers (`lastError`, final `errors[]` entry, then `cause`) with cycle protection and a small depth bound. Render only numeric status, an allowlisted transport code, the two timeout names, or `unclassified error`.

```ts
export function safeEmbeddingFailureClass(error: unknown): string {
  const err = unwrapEmbeddingError(error);
  const status = err?.statusCode ?? err?.status ?? err?.cause?.statusCode ?? err?.cause?.status;
  if (typeof status === 'number' && Number.isInteger(status)) return `HTTP ${status}`;
  const code = err?.code ?? err?.cause?.code;
  if (typeof code === 'string' && SAFE_TRANSPORT_CODES.has(code)) return code;
  const name = err?.name ?? err?.cause?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout';
  return 'unclassified error';
}
```

- [ ] **Step 6: Extend the retry loop minimally**

Keep the existing rate-limit branch first. For other `isTransient(error)` results, consume the next delay from `[500, 1_500, 3_500]`, send a sanitized notice, and retry. Throw immediately when the error is permanent or either retry budget is exhausted.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
cd controller && npx tsx scripts/embedding-bulk.test.ts
```

Expected: every bulk embedding policy test passes with no warning or secret text.

- [ ] **Step 8: Commit Task 1**

```bash
git add controller/src/llm/sdk.ts controller/src/music/embedding-bulk.ts controller/scripts/embedding-bulk.test.ts
git commit -m "fix: retry transient embedding failures"
```

---

### Task 2: Surface sanitized retry and terminal diagnostics

**Files:**
- Modify: `controller/src/music/embedding-bulk.ts`
- Modify: `controller/src/music/tag-library/embed.ts`
- Test: `controller/scripts/embedding-bulk.test.ts`

**Interfaces:**
- Consumes: `BulkEmbeddingWaitNotice` and `bulkEmbeddingFailureMessage(error)` from Task 1.
- Produces: operator-visible tagger events containing the sanitized failure category.

- [ ] **Step 1: Write failing source-contract and message tests**

Update the fatal-copy test to require the safe category and reject the raw provider message. Add a source-contract assertion that the embed phase differentiates rate-limit and transient retry notices and includes `classification`, without interpolating `err.message`.

```ts
assert.equal(
  bulkEmbeddingFailureMessage(Object.assign(new Error('token=do-not-print'), { statusCode: 503 })),
  'Embedding service request failed (HTTP 503)',
);
assert.match(embedPhase, /notice\.classification/);
assert.doesNotMatch(embedPhase, /err\.message/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run `cd controller && npx tsx scripts/embedding-bulk.test.ts`.

Expected: FAIL because fatal messages and retry notices do not yet include the safe category.

- [ ] **Step 3: Implement sanitized operator messages**

Update `bulkEmbeddingFailureMessage` to append `safeEmbeddingFailureClass(error)`. Update `phaseEmbed` so rate limits retain their current wording while ordinary transient waits log `Embedding service <classification> — retrying in <seconds>s (attempt <n>)` using fields supplied by the retry wrapper.

- [ ] **Step 4: Prove exactly-once commit behavior after transient recovery**

Adapt the existing commit/progress test so the first request throws HTTP 503, the second returns vectors, and all upserts/progress assertions remain unchanged. This verifies retries never partially commit a failed request.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run `cd controller && npx tsx scripts/embedding-bulk.test.ts`.

Expected: all tests pass; logs and notices contain only safe categories.

- [ ] **Step 6: Commit Task 2**

```bash
git add controller/src/music/tag-library/embed.ts controller/src/music/embedding-bulk.ts controller/scripts/embedding-bulk.test.ts
git commit -m "fix: report safe embedding failure classes"
```

---

### Task 3: Full verification and delivery

**Files:**
- Verify: all changed files and controller test/lint surfaces

**Interfaces:**
- Consumes: completed Tasks 1 and 2.
- Produces: a reviewed branch and pull request ready for release/deployment.

- [ ] **Step 1: Run controller tests**

```bash
cd controller && npm test
```

Expected: complete controller suite passes.

- [ ] **Step 2: Run controller lint and type-check**

```bash
cd controller && npm run lint
```

Expected: ESLint and `tsc --noEmit` pass.

- [ ] **Step 3: Check patch integrity**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only intentional commits/files.

- [ ] **Step 4: Review the complete branch diff**

Compare against `origin/develop`, confirming retry scope, budgets, redaction, and unchanged interactive embedding behavior. Address only actionable findings and rerun affected verification.

- [ ] **Step 5: Push and open the pull request**

```bash
git push -u origin fix/embedding-transient-retries
gh pr create --base develop --head fix/embedding-transient-retries
```

The PR summary must state the production failure evidence, exact retry budgets, sanitization guarantee, and verification results.

- [ ] **Step 6: Wait for required CI**

Use `gh pr checks --watch`; do not merge while any required check is pending or failing.

- [ ] **Step 7: Merge when CI is green**

Use a normal merge commit, preserving the repository’s established branch flow.

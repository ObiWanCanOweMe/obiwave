# Bounded Embedding Retries and Safe Diagnostics

## Problem

The library tagger embeds cloud batches with AI SDK retries disabled so SUB/WAVE can own the retry policy. Today the bulk wrapper retries only recognised rate limits that include a usable `Retry-After` header. Any other transient gateway, timeout, socket, or DNS failure aborts the entire tagger run, even after thousands of successfully committed batches. The fatal error is then collapsed to `Embedding service request failed`, which hides the safe HTTP or transport classification an operator needs.

The production incident processed 29,184 of 41,870 vectors before one request failed. The saved model, one-text probe, and a 64-text batch all succeeded afterward, demonstrating why a bounded transient retry belongs around each bulk request.

## Design

Extend `controller/src/music/embedding-bulk.ts`; do not enable AI SDK retries or route bulk embedding through the chat-oriented retry wrapper.

The wrapper will continue to own the complete retry budget around one idempotent embedding request:

- Recognised rate limits with a usable `Retry-After` keep their existing policy: wait for the supplied delay plus the 250 ms safety margin, reject delays over 65 seconds, and stop after three waits.
- Other errors classified by the shared `isTransient` helper receive at most three retries after the initial attempt, with fixed delays of 500 ms, 1,500 ms, and 3,500 ms.
- Authentication, quota, validation, unsupported-model, and other permanent failures are not retried.
- The AI SDK call remains `maxRetries: 0`, preventing nested retry budgets.
- Vector writes and progress updates still occur only after the complete batch succeeds, exactly once.

Export `isTransient` through the stable `llm/sdk.ts` barrel so the music layer does not import from `llm/internal/**`.

## Sanitized diagnostics

Add an embedding-specific classifier that unwraps common AI SDK retry wrappers and emits only one of these safe categories:

- `HTTP <status>` when a numeric HTTP status is available.
- A known transport code such as `ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `EAI_AGAIN`, `UND_ERR_SOCKET`, or `UND_ERR_CONNECT_TIMEOUT`.
- `timeout` for `AbortError` or `TimeoutError`.
- `unclassified error` otherwise.

The classifier must never include exception messages, response bodies, headers, URLs, prompts, model inputs, or credentials.

Retry notices will include the same sanitized category. Final fatal messages will be:

- `Embedding service rate limit could not be safely retried (<category>)` for recognised rate limits whose wait is unusable or exhausted.
- `Embedding service request failed (<category>)` for all other exhausted or permanent failures.

## Scope

This applies only to bulk document embeddings in the library tagger. Interactive similarity-query embeddings, embedding probes, chat calls, and audio embeddings keep their current policies.

No settings, schema, API, database, or UI changes are required.

## Testing

Extend `controller/scripts/embedding-bulk.test.ts` using injected sleep functions so tests remain deterministic and fast. Coverage will prove:

- HTTP 503 and transport failures recover within the bounded retry budget.
- A persistent transient error stops after the initial request plus three retries.
- Permanent HTTP errors fail immediately.
- Recognised rate limits preserve the existing `Retry-After` behavior and limits.
- Wrapped AI SDK errors classify and retry based on their underlying error.
- Fatal and retry messages contain the safe category but exclude raw provider text and secret-shaped values.
- Successful retry commits vectors and progress exactly once.
- Interactive query embeddings remain outside the bulk retry path.

Controller type-checking and the complete controller test suite must remain green.

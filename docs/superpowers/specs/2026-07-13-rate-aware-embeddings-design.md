# Rate-Aware Cloud Embeddings Design

## Goal

Allow a full SUB/WAVE library embedding pass to complete through a LiteLLM key limited to 20 requests per minute, without losing completed vectors, rerunning acoustic analysis, or disrupting the broadcast.

## Scope

- Apply rate-limit waiting only to bulk document embeddings created by the library tagger.
- Keep interactive query embeddings, preflight probes, DJ calls, and chat failover latency unchanged.
- Use batches of 64 tracks for cloud embedding providers. Preserve the existing smaller operator-derived batch size for local providers such as Ollama.
- Resume the existing partial `openai-compatible:cohere.embed-english-v3` index; do not reseed or drop vectors again.
- Preserve existing mood/energy tags, enrichment, acoustic analysis, DJ session state, Odin analyzer, and broadcast services.

## Data Flow

1. The tagger selects only tracks that do not already have text vectors.
2. For a cloud embedding provider, it sends up to 64 track texts in one `/embeddings` request.
3. The AI SDK's short internal retry loop is disabled for this bulk path so the original HTTP 429 and `Retry-After` header remain available.
4. A successful response is validated and committed exactly as today.
5. A rate-limit response with a valid positive `Retry-After` pauses the child process for that duration plus a small safety margin, emits an operator-facing warning, and retries the same batch without advancing progress.
6. Any non-rate-limit error, malformed/missing wait instruction, or excessive wait remains fatal and leaves already committed vectors available for a later normal forward run.
7. Existing structured progress continues to publish `Embedding tracks · done / total`; the warning also appears in the Admin Library activity log while the count is paused.

## Boundaries and Safety

- Rate-limit classification and delay parsing must be pure and unit-tested.
- The bulk wait loop is abortable by the existing tagger process stop mechanism; no detached retry worker or separate queue is introduced.
- The same batch is retried, preventing gaps or duplicate progress accounting. Vector upserts remain idempotent.
- Waiting is restricted to HTTP 429 responses that provide a usable retry delay. The controller must not sleep indefinitely on authentication, quota, connectivity, or provider errors.
- A bounded maximum accepted single wait prevents a malformed gateway response from sleeping for hours. LiteLLM's observed 60-second delay must be accepted.
- No token, API-key identifier, response body, or raw headers may be written to the Admin log.

## Deployment and Recovery

- Add focused controller tests first, then implement the document-only retry and cloud batch policy.
- Run the focused tests, controller lint/typecheck, and relevant existing embedding/tagger tests.
- Rebuild and recreate only the production controller service. Do not restart broadcast, web, analyzer, or Odin components.
- Verify the saved embedding probe still returns 1024 dimensions and the stream remains on-air.
- Start a normal unlimited tag run with reconciliation, enrichment, and acoustic analysis disabled. This resumes missing vectors and then tags the remaining untagged tracks without dropping the 5,680 completed vectors.
- Monitor Admin Library progress through rate-limit waits and to terminal `lastRun.outcome: "ok"`, then verify full 1024-dimensional vector coverage, tag coverage, and stream health.

## Testing

- Cloud batch selection returns 64; local batch selection retains the existing bounded formula.
- A 429 with `Retry-After: 60` waits and retries the identical batch.
- Progress does not advance during the wait and advances exactly once after success.
- Non-429 failures are not retried by the bulk rate-limit loop.
- Missing, invalid, zero, or over-limit retry delays fail rather than sleep.
- Interactive/query embeddings do not use the bulk wait policy.
- Secret-bearing gateway error content is not emitted in structured operator logs.

## Success Criteria

- The controller survives repeated 20-RPM LiteLLM throttles during the full library pass.
- Admin Library continues showing determinate embedding progress and visible rate-limit waits.
- The partial index resumes rather than resets.
- Existing tags and acoustic records remain unchanged except that the 124 currently untagged tracks may receive normal mood/energy tags after vector completion.
- Broadcast audio stays on-air throughout.

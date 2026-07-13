# LiteLLM Embeddings Configuration Design

Date: 2026-07-13

## Goal

Move SUB/WAVE's text-embedding workload from the unavailable Nomic server on
Odin (`:8090`) to the operator's existing LiteLLM gateway, while keeping the
DJ's chat configuration unchanged.

## Current state

- DJ chat uses `litellm:gemini-3-flash-no-reasoning`.
- Text embeddings use `openai-compatible:nomic-embed-text:latest` at
  `http://odin.trusted.kener.org:8090/v1`.
- Nothing is listening on Odin port 8090, so the tagger's embedding preflight
  fails with `ECONNREFUSED` and stops before processing tracks.
- The current index contains 44,727 Nomic vectors at 768 dimensions, with 124
  library tracks still waiting to be tagged.
- The existing LiteLLM gateway successfully serves
  `cohere.embed-english-v3`; a direct probe returned a 1024-dimensional vector
  in approximately 0.25 seconds.

## Configuration

Keep the chat leg unchanged. Configure the independent embedding leg as:

- provider: `openai-compatible`
- model: `cohere.embed-english-v3`
- base URL: the existing LiteLLM API base from the root `.env`
- API key: the existing LiteLLM token from the root `.env`

The key is supplied through the authenticated settings API and stored in the
existing masked `settings.embedding.apiKey` slot. It must not be printed,
placed in a URL, or included in logs. The public settings response continues to
return only `"set"` for the field.

The first-class `litellm` provider remains chat-only. Embeddings use the
existing OpenAI-compatible embedding transport because LiteLLM exposes an
OpenAI-compatible `/embeddings` endpoint. No controller or web code changes are
required.

## Migration sequence

1. Save the new embedding provider, model, base URL, and key through the live
   authenticated settings endpoint.
2. Run the controller's embedding probe with the saved configuration.
3. Require a successful response with an actual dimension of 1024. If the
   probe fails or reports any other dimension, stop without modifying the
   existing vector index.
4. Start an unlimited reseed with `thenTag` enabled. The reseed drops and
   rebuilds the text-vector index for the complete library; it does not rerun
   acoustic analysis.
5. After the vector rebuild, continue into the normal forward tagging pass so
   the remaining untagged tracks are processed.
6. Monitor tagger status and logs until the run finishes or reports a concrete
   error.

## Data and operational effects

- Existing mood and energy tags remain available as propagation seeds.
- The old 768-dimensional Nomic vectors are replaced with 1024-dimensional
  Cohere vectors.
- The full library is re-embedded, so the operation can take substantial time
  and consume LiteLLM quota. It must run without a batch limit to avoid leaving
  a mixed vector index.
- The radio broadcast, DJ session, acoustic analyzer on Odin, and current chat
  provider remain online and unchanged.
- The failed Odin embedding service is no longer on the active data path; it is
  not started, removed, or otherwise mutated by this operation.

## Verification

- Live settings report the embedding provider/model as
  `openai-compatible:cohere.embed-english-v3`, with the key masked.
- Embedding preflight succeeds and reports dimension 1024 before reseeding.
- Tagger status reports a reseed/re-embedding run rather than an immediate
  preflight stop.
- Controller logs show outbound embedding progress without credential leakage.
- Stream health and a non-silent audio probe remain green while the background
  migration runs.

## Failure handling

- A failed preflight blocks the reseed and preserves the current index.
- A tagger failure is reported with its phase and error; no automatic service
  restart or repeated destructive reseed is attempted.
- A stopped or interrupted reseed is resumed only through the supported
  full-reseed path, not by mixing old and new vectors.

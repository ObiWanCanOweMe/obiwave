# LiteLLM Discovery Environment-Key Design

## Problem

SUB/WAVE can run LiteLLM chat inference when the gateway URL is saved in
`settings.json` and its bearer token is supplied by `OPENAI_API_KEY`, but the
authenticated model-discovery and compatibility-probe routes omit that token.
Those routes currently consult the environment token only when the gateway URL
also came from the environment. The live registry does not impose that coupling:
it resolves the saved URL and environment token independently.

The result is a false `401 LiteLLM Virtual Key expected` from model discovery
and probes while normal DJ calls continue to succeed.

## Goals

- Make LiteLLM discovery and compatibility probes use the same credential
  precedence as live inference for a trusted, saved gateway endpoint.
- Preserve the existing guard that never forwards stored or environment
  credentials to an arbitrary URL submitted by a browser.
- Verify the fix through the mounted Express routes, not only through a pure
  credential helper.
- After deployment, discover the live model catalogue and benchmark Gemini 3
  Flash against Claude Haiku 4.5 on real `djAgentPick` scenarios without
  changing live station settings.

## Design

Two route paths resolve LiteLLM connections. `resolveCustomConnection()` in
`model-discovery.ts` binds credentials to the saved discovery endpoint;
`resolveLiteLlmRouteConfig()` in `llm.ts` does the same for compatibility
probes. In each saved-endpoint branch, resolve the token with
`effectiveLiteLlmApiKey({ apiKey: settings.llmKeyFor('litellm') })`. This keeps
the established order: saved provider token, then `LITELLM_API_KEY`, then
`OPENAI_API_KEY`.

An explicit request token continues to win. An unsaved URL continues to receive
no implicit token. An environment-owned URL continues to use the environment
token as before.

## Testing

Extend `controller/scripts/litellm-routes.test.ts` with the missing production
shape: a saved LiteLLM URL, no saved provider token, no environment base URL,
and an `OPENAI_API_KEY` token. The mounted `/settings/llm/models` and
`/settings/llm/probe-compat` routes must send that token to the saved gateway.
Existing changed-origin assertions remain the security regression coverage.

Verify the focused route test, the complete controller test suite, lint, and
typecheck. After deployment, verify authenticated live discovery returns a
model list.

## Benchmark

Run the matrix harness through the real LiteLLM route for
`gemini-3-flash-no-reasoning` and `claude-haiku-4-5-20251001`, restricted to
agent-mode `djAgentPick` scenarios with three iterations. Compare thrown rate,
rule violations, and p50 latency. The harness process overrides provider/model
only for itself and must not update the station's saved LLM settings.

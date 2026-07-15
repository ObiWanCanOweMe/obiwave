# LiteLLM Cloud Provider Design

## Goal

Add LiteLLM as a distinct cloud chat provider so SUB/WAVE can route DJ and
agent calls through an operator-supplied LiteLLM endpoint without sending the
llama.cpp-specific request fields used by the existing `openai-compatible`
provider.

LiteLLM is chat-only in this change. It must not appear as an embedding
provider or change the library's existing embedding configuration.

## Why a Separate Provider

The current `openai-compatible` provider intentionally targets self-hosted
llama.cpp, vLLM, LM Studio, and locca servers. Its transport injects local-model
controls including `repeat_penalty`, `chat_template_kwargs`, `reasoning_format`,
`thinking`, and `parallel_tool_calls`. Those controls improve local-model
reliability, but cloud vendors behind LiteLLM reject some of them before a
model call begins.

The new provider id is `litellm`. It preserves the local provider unchanged and
makes the cloud-gateway transport explicit in settings, logs, benchmarks, and
fallback routing.

## Provider Transport

The provider uses the AI SDK OpenAI client in chat-completions mode:

- `createOpenAI({ baseURL, apiKey, name: 'litellm', fetch: debugFetch }).chat(model)`
- The configured base URL is used verbatim after trimming trailing slashes.
- The bearer token is sent through the SDK's normal `Authorization` header.
- `debugFetch` remains the only fetch wrapper so existing opt-in raw-request
  diagnostics continue to work without recording authorization headers.
- The transport must not call `openAICompatibleFetch` and must not add
  `repeat_penalty`, `chat_template_kwargs`, `reasoning_format`, `thinking`,
  `reasoning`, or `parallel_tool_calls`.

LiteLLM receives the standard OpenAI chat-completions body produced by the SDK.
This is the same gateway-safe pattern already used by Requesty, except the
operator supplies the endpoint.

## Capabilities and Agent Strategy

LiteLLM is treated as a cloud aggregator:

- Structured output uses the native strategy first, matching other hosted
  gateways rather than local GGUF models.
- It does not use body-injected sampling controls.
- Generic reasoning controls are omitted because one LiteLLM endpoint can route
  to multiple vendor dialects. Operators should select a non-reasoning model or
  LiteLLM alias when deterministic no-think behavior is required.
- Existing agent recovery paths remain available if a routed model does not
  complete the native tool flow.
- Primary and fallback legs both support `litellm` and keep their existing
  provider-scoped key behavior.

## Configuration Resolution

LiteLLM configuration resolves in this order.

### Base URL

1. The active leg's saved `baseUrl` setting.
2. `LITELLM_API_BASE` from the controller environment.
3. `OPENAI_API_BASE` from the controller environment.

### Bearer Token

1. The provider-scoped inline key saved for `litellm`.
2. `LITELLM_API_KEY` from the controller environment.
3. `OPENAI_API_KEY` from the controller environment.

An Admin-entered value therefore overrides environment configuration, while an
operator whose endpoint and token already live in `.env` does not need to copy
the secret into `settings.json`.

Saving a LiteLLM provider is valid when the effective base URL resolves from
either settings or the environment. The model remains mandatory. The bearer
token may be empty because some private LiteLLM deployments are keyless.

The resolved key must remain provider-scoped: selecting native OpenAI later
must not reuse a LiteLLM inline override, and selecting LiteLLM must not mutate
the OpenAI provider's key.

## Admin and Onboarding UI

`LiteLLM` appears as a separate cloud-provider card and fallback-provider
option with the description `Custom cloud gateway`.

When selected, the form shows:

- A server base URL field, with environment-backed status when no saved
  override is present.
- A bearer-token field, optional when a token is already available from the
  environment or the endpoint is keyless.
- The existing connection-test control.
- Model discovery from the effective `<baseUrl>/models` endpoint using the
  effective bearer token.
- The normal model selector and all provider-independent DJ settings.

The UI never returns or displays an environment token. The controller settings
response exposes only presence booleans for `LITELLM_API_BASE`,
`OPENAI_API_BASE`, `LITELLM_API_KEY`, and `OPENAI_API_KEY` as needed to explain
configuration status.

Onboarding supports the same provider, fields, model discovery, and connection
test. Saving through onboarding persists an explicit override only when the
operator entered one.

LiteLLM does not appear in `EMBEDDING_PROVIDERS` or the Library Tagger embedding
picker. Switching the chat provider preserves the current embedding pin and
vector index.

## Controller Routes

The existing settings routes are extended rather than duplicated:

- Provider discovery accepts `provider=litellm`, resolves the effective URL and
  token, calls `/models`, and returns chat model ids.
- The OpenAI-compatible connection probe supports LiteLLM's effective
  configuration while remaining non-mutating.
- Settings validation requires an effective URL, not necessarily a saved URL.
- The reachability probe treats LiteLLM as a configured remote host and checks
  `/models` with a short timeout. Authentication failures count as reachable;
  only connection, DNS, and timeout failures count as unreachable.

Errors are concise and must not include the bearer token. Authentication,
unreachable-host, unsupported-model, and upstream validation failures remain
distinguishable in the Admin test result and controller telemetry.

## Compatibility and Migration

This change introduces no automatic migration:

- Existing `openai-compatible` and `locca` settings keep their exact transport
  and local-model controls.
- Existing native cloud providers keep their current environment keys and
  request behavior.
- Existing LiteLLM-like endpoints configured as `openai-compatible` remain as
  saved until the operator explicitly selects `litellm`.
- Existing embedding settings and stored vectors are untouched.

## Testing

Unit tests must prove:

- `litellm` is accepted as a chat provider but not an embedding provider.
- Saved URL and token overrides win over environment values.
- `LITELLM_*` values win over `OPENAI_*` fallbacks.
- A missing saved URL is valid when an environment URL exists and invalid when
  no effective URL exists.
- LiteLLM uses native structured output and no body-injection capability.
- An intercepted LiteLLM request contains standard OpenAI fields and none of
  the local-only injected fields.
- Primary and fallback legs resolve the `litellm` provider-scoped token without
  leaking it to the native OpenAI provider.
- Authenticated model discovery uses the effective URL and token.
- Provider metadata, labels, status, and form visibility cover LiteLLM.

After unit tests pass, verification runs:

1. The representative `llm-bench` screen against the Mercury endpoint for
   agent picks, agent segments, spoken links, and banter.
2. A deeper comparison of the strongest candidates if the screen produces
   successful calls.
3. The complete controller test, lint, and typecheck commands.
4. Web lint and typecheck for the provider UI.

Development and Mercury benchmarks run outside the live controller. The live
station stays on its existing Google provider until the operator explicitly
chooses to switch it after reviewing benchmark results.

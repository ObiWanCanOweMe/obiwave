# LiteLLM final-review fix report

Date: 2026-07-13

Base commit: `fa7bd02`

Implementation commit: `d46c438` (`fix(llm): close final LiteLLM review gaps`)

## Outcome

All final-review findings were fixed in the `feat/litellm-cloud-provider` worktree. No deployment, service restart, live-provider change, root-state access, or real-secret access was performed.

## Files changed

- `controller/src/settings.ts` — pins a fresh/inheriting embedding configuration to the previous embedding-capable provider and its default model before LiteLLM becomes the chat provider.
- `controller/src/routes/settings.ts` — adds authenticated POST model discovery, explicit `primary`/`fallback`/`onboarding` leg identity, leg-scoped saved configuration resolution, environment fallback, and explicit probe leg selection.
- `controller/src/llm/internal/provider/registry.ts` — includes a SHA-256 digest of the effective LiteLLM token in the model-client cache signature without storing/logging the raw token.
- `controller/scripts/litellm-config.test.ts` — integration regression for safe effective embeddings after a default LiteLLM save.
- `controller/scripts/litellm-cache.test.ts` — in-process environment-token rotation regression using a recording gateway.
- `controller/scripts/litellm-routes.test.ts` — real mounted-route coverage for authenticated primary/fallback discovery, fallback probing, environment-only resolution, and unsaved onboarding discovery.
- `web/hooks/useModelDiscovery.ts` — sends LiteLLM discovery as authenticated POST with leg/body token and invalidates stale requests on every dependency change.
- `web/components/admin/settings/LlmSection.tsx` — supplies explicit discovery/probe legs and suppresses stale compatibility-probe results for provider, URL, token, or model changes.
- `web/components/onboarding/useWizard.ts` — sends unsaved onboarding discovery credentials in the POST body and suppresses stale connection-test results.
- `web/components/onboarding/steps.tsx` — invalidates LiteLLM discovery when the unsaved bearer token changes.
- `web/lib/asyncResultGeneration.ts` — reusable monotonic async-result generation guard.
- `web/scripts/async-result-generation.test.ts` — pure state regression for stale-result suppression.
- `web/package.json` — exposes the new web regression command.

## RED evidence

Each regression was added before its production change and run against commit `fa7bd02` plus tests only.

1. `cd controller && npx tsx scripts/litellm-config.test.ts`
   - Exit `1`.
   - Expected `{ provider: 'ollama', model: 'nomic-embed-text' }`; actual `{ provider: 'litellm', model: '' }`.
2. `cd controller && npx tsx scripts/litellm-cache.test.ts`
   - Exit `1`.
   - Expected Authorization tokens A then B; actual A then A, proving the cached client retained the old effective environment token.
3. `cd controller && npx tsx scripts/litellm-routes.test.ts`
   - Exit `1`.
   - Authenticated `POST /settings/llm/models` returned `404`, proving the body-token/explicit-leg contract did not exist.
4. `cd web && node --experimental-strip-types scripts/async-result-generation.test.ts`
   - Exit `1`.
   - Assertion failed because the async generation guard module did not exist.

## Focused GREEN evidence

- `cd controller && npx tsx scripts/litellm-config.test.ts` — exit `0`.
- `cd controller && npx tsx scripts/litellm-cache.test.ts` — exit `0`.
- `cd controller && npx tsx scripts/litellm-routes.test.ts` — exit `0`; recording gateways observed exact `/v1/models` and `/v1/chat/completions` paths plus the expected primary, fallback, environment, and unsaved-onboarding Authorization headers.
- `cd web && npm run test:async-generation` — exit `0`.

## Full verification

- `cd controller && npm test` — exit `0`; all 38 test files passed.
- `cd controller && npm run lint` — exit `0`; ESLint and `tsc --noEmit` passed. ESLint reported the repository's existing warning baseline (516 warnings, 0 errors).
- `cd web && npm run test:llm-provider && npm run test:onboarding-provider-state && npm run test:async-generation` — exit `0`; all relevant web regressions passed. Node emitted the existing package-module-type warning for strip-types scripts.
- `cd web && npm run lint` — exit `0`; ESLint and `tsc --noEmit` passed.
- `cd web && npm run build` — exit `0`; Next.js 15.5.19 compiled, typechecked, generated all 81 static pages, and finalized the production build.
- `git diff --check` — exit `0` before the implementation commit.

## Self-review

- LiteLLM remains absent from `EMBEDDING_PROVIDERS`; the safe pin happens at `settings.update()`, so both Admin and onboarding save paths receive the same protection.
- LiteLLM URL precedence is request-body override, selected saved leg URL, `LITELLM_API_BASE`, then `OPENAI_API_BASE`.
- LiteLLM token precedence is request-body override, selected saved provider-scoped key, `LITELLM_API_KEY`, then `OPENAI_API_KEY`.
- A stale LiteLLM key from an unselected leg is not used for environment-only resolution.
- Unsaved onboarding tokens are transported only in a JSON POST body, never in query parameters.
- Route responses and error messages contain no bearer tokens; cache signatures contain only a stable digest of the effective token.
- LiteLLM still uses its isolated cloud transport and does not enter the self-hosted `openai-compatible` body-injection path.
- Admin probes and onboarding connection tests invalidate late results on all relevant provider/URL/token/model inputs; discovery request cleanup also advances its generation synchronously.
- Existing Google provider configuration and all live station state were untouched.

## Concerns

None.

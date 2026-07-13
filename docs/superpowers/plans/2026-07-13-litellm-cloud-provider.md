# LiteLLM Cloud Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate, chat-only `litellm` provider that routes SUB/WAVE DJ calls through a configurable cloud LiteLLM endpoint without local llama.cpp request injections.

**Architecture:** Extend the provider registry with a gateway-safe OpenAI chat-completions client that uses `debugFetch` directly. Central resolver functions apply saved-setting → `LITELLM_*` → `OPENAI_*` precedence for URL and token, and all controller routes and UI surfaces consume those resolvers. The existing `openai-compatible`/locca transport and all embedding behavior remain unchanged.

**Tech Stack:** TypeScript, Vercel AI SDK 7, Express, Next.js 15/React, Node `assert`, existing `llm-bench` matrix harness.

## Global Constraints

- Provider id is exactly `litellm`; display label is `LiteLLM`.
- LiteLLM is available for chat primary and fallback legs, not in `EMBEDDING_PROVIDERS`.
- URL precedence is saved `baseUrl`, then `LITELLM_API_BASE`, then `OPENAI_API_BASE`.
- Token precedence is provider-scoped inline key, then `LITELLM_API_KEY`, then `OPENAI_API_KEY`.
- LiteLLM requests use `debugFetch` directly and never use `openAICompatibleFetch`.
- Do not inject `repeat_penalty`, `chat_template_kwargs`, `reasoning_format`, `thinking`, `reasoning`, or `parallel_tool_calls` for LiteLLM.
- Do not change the live station provider during development or benchmarking.
- Preserve the untracked `controller/scripts/__pycache__/` directory.

---

### Task 1: Provider contract, resolution, and transport

**Files:**
- Modify: `controller/scripts/llm-pure.test.ts`
- Create: `controller/src/litellm-config.ts`
- Modify: `controller/src/settings.ts`
- Modify: `controller/src/llm/internal/provider/capabilities.ts`
- Modify: `controller/src/llm/internal/provider/registry.ts`
- Modify: `controller/src/llm/internal/provider/legs.ts`

**Interfaces:**
- Produces: `effectiveLiteLlmBaseUrl(cfg, env?) -> string` from `controller/src/litellm-config.ts`.
- Produces: `effectiveLiteLlmApiKey(cfg, env?) -> string` from `controller/src/litellm-config.ts`.
- Produces: `createLiteLlmModel(cfg, fetchImpl?) -> LanguageModel`
- Consumes: existing `settings.llmKeyFor(provider)`, `debugFetch`, and `createOpenAI().chat()`.

- [ ] **Step 1: Create the isolated worktree and establish the baseline**

Use the `superpowers:using-git-worktrees` workflow to create branch
`feat/litellm-cloud-provider` under the ignored `.worktrees/` directory. Copy or
link only the dependency artifacts required by the repository workflow, then
run:

```bash
cd controller
npm install
npm test
npm run lint
cd ../web
npm install
npm run lint
```

Expected: controller tests pass, controller lint/typecheck exits 0, and web
lint/typecheck exits 0 before feature edits begin.

- [ ] **Step 2: Write failing resolver and capability tests**

Import `effectiveLiteLlmBaseUrl` and `effectiveLiteLlmApiKey` from
`../src/litellm-config.js`. Add these assertions:

```ts
await test('LiteLLM URL precedence: saved override, then LITELLM, then OPENAI fallback', () => {
  assert.equal(effectiveLiteLlmBaseUrl({ baseUrl: 'https://saved.example/v1' }, {
    LITELLM_API_BASE: 'https://litellm.example/v1',
    OPENAI_API_BASE: 'https://openai.example/v1',
  }), 'https://saved.example/v1');
  assert.equal(effectiveLiteLlmBaseUrl({ baseUrl: '' }, {
    LITELLM_API_BASE: 'https://litellm.example/v1/',
    OPENAI_API_BASE: 'https://openai.example/v1',
  }), 'https://litellm.example/v1');
  assert.equal(effectiveLiteLlmBaseUrl({ baseUrl: '' }, {
    OPENAI_API_BASE: 'https://openai.example/v1/',
  }), 'https://openai.example/v1');
  assert.equal(effectiveLiteLlmBaseUrl({ baseUrl: '' }, {}), '');
});

await test('LiteLLM token precedence is provider-scoped before environment fallbacks', () => {
  assert.equal(effectiveLiteLlmApiKey({ apiKey: 'saved' }, {
    LITELLM_API_KEY: 'litellm-env', OPENAI_API_KEY: 'openai-env',
  }), 'saved');
  assert.equal(effectiveLiteLlmApiKey({ apiKey: '' }, {
    LITELLM_API_KEY: 'litellm-env', OPENAI_API_KEY: 'openai-env',
  }), 'litellm-env');
  assert.equal(effectiveLiteLlmApiKey({ apiKey: '' }, {
    OPENAI_API_KEY: 'openai-env',
  }), 'openai-env');
});

await test('LiteLLM is a native cloud strategy with no body sampling injection', () => {
  assert.equal(needsToolCallObject({ provider: 'litellm' }), false);
  assert.equal(appliedRepeatPenalty({ provider: 'litellm', repeatPenalty: 1.2 }), null);
  assert.equal(reasoningFor({ provider: 'litellm', model: 'vendor/model', reasoning: false }), undefined);
});
```

Also assert that `LLM_PROVIDERS.includes('litellm')` is true and
`EMBEDDING_PROVIDERS.includes('litellm')` is false.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
cd controller
npm run test:llm
```

Expected: compilation/assertion failure because the LiteLLM resolver exports,
provider id, and capability descriptor do not exist.

- [ ] **Step 4: Implement provider membership, pure resolution, and capabilities**

In `controller/src/settings.ts`, add `litellm` to `LLM_PROVIDERS` immediately
after `openai-compatible`; do not add it to `EMBEDDING_PROVIDERS`.

Create `controller/src/litellm-config.ts` with:

```ts
type LiteLlmEnv = Partial<Record<'LITELLM_API_BASE' | 'OPENAI_API_BASE' | 'LITELLM_API_KEY' | 'OPENAI_API_KEY', string>>;

export function effectiveLiteLlmBaseUrl(cfg: any, env: LiteLlmEnv = process.env): string {
  return String(cfg?.baseUrl || env.LITELLM_API_BASE || env.OPENAI_API_BASE || '')
    .trim()
    .replace(/\/+$/, '');
}

export function effectiveLiteLlmApiKey(cfg: any, env: LiteLlmEnv = process.env): string {
  return String(cfg?.apiKey || env.LITELLM_API_KEY || env.OPENAI_API_KEY || '').trim();
}
```

Import these helpers into `registry.ts`. Keeping them in a root-level pure
module lets `settings.ts` validate effective configuration without importing
the provider barrel back into the registry and creating a circular dependency.

Add the capability descriptor in `capabilities.ts`:

```ts
litellm: {
  objectStrategy: 'native',
  repeatPenaltyApplies: false,
  reasoningLevel: NONE,
},
```

- [ ] **Step 5: Implement the gateway-safe model builder and leg resolution**

Add this builder to `registry.ts`:

```ts
export function createLiteLlmModel(cfg: any, fetchImpl: any = debugFetch) {
  const baseURL = effectiveLiteLlmBaseUrl(cfg);
  if (!baseURL) throw new Error('LiteLLM base URL is empty');
  const provider = createOpenAI({
    baseURL,
    apiKey: effectiveLiteLlmApiKey(cfg) || 'unused',
    name: 'litellm',
    fetch: fetchImpl,
  });
  return provider.chat(resolveModelId(cfg));
}
```

Update `llmCfg()` so `litellm` receives the provider-scoped saved token before
the environment resolver. Update the client cache's effective base URL
signature for `litellm`, and add this switch branch:

```ts
case 'litellm': {
  model = createLiteLlmModel(cfg);
  break;
}
```

In `legs.ts`, resolve fallback `apiKey` with `settings.llmKeyFor('litellm')` as
the current generic provider-scoped code does, and extend the reachability
branch so `litellm` probes `${effectiveLiteLlmBaseUrl(cfg)}/models`. Keep the
rule that any HTTP response means reachable; only fetch rejection returns
false.

- [ ] **Step 6: Add a request-body regression test and verify GREEN**

Import `createLiteLlmModel` and use a recording fetch in
`llm-pure.test.ts`:

```ts
await test('LiteLLM sends a plain OpenAI chat body without local-only fields', async () => {
  let sent: any;
  const fetchImpl = async (_url: any, init: any) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({
      id: 'chatcmpl-test', object: 'chat.completion', created: 0, model: 'vendor/model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const model = createLiteLlmModel({ model: 'vendor/model', baseUrl: 'https://gateway.example/v1', apiKey: 'secret' }, fetchImpl);
  await generateText({ model, prompt: 'Say OK', maxOutputTokens: 32 });
  for (const key of ['repeat_penalty', 'chat_template_kwargs', 'reasoning_format', 'thinking', 'reasoning', 'parallel_tool_calls']) {
    assert.equal(sent[key], undefined, `${key} must not be injected`);
  }
});
```

Run:

```bash
cd controller
npm run test:llm
```

Expected: all LLM pure tests pass.

- [ ] **Step 7: Commit Task 1**

```bash
git add controller/src/litellm-config.ts controller/src/settings.ts controller/src/llm/internal/provider/capabilities.ts \
  controller/src/llm/internal/provider/registry.ts controller/src/llm/internal/provider/legs.ts \
  controller/scripts/llm-pure.test.ts
git commit -m "feat(llm): add cloud-safe LiteLLM transport"
```

---

### Task 2: Settings, discovery, probes, and onboarding controller

**Files:**
- Create: `controller/scripts/litellm-config.test.ts`
- Modify: `controller/src/settings.ts`
- Modify: `controller/src/routes/settings.ts`
- Modify: `controller/src/routes/onboarding.ts`

**Interfaces:**
- Consumes: `effectiveLiteLlmBaseUrl()` and `effectiveLiteLlmApiKey()` from Task 1.
- Produces: settings response environment-presence flags for LiteLLM URL/key fallbacks.
- Produces: `provider=litellm` support in discovery, connection testing, and onboarding.

- [ ] **Step 1: Write failing configuration-validation tests**

Create `controller/scripts/litellm-config.test.ts`. Use a temporary
`STATE_DIR`, import settings only after setting that environment variable, and
assert these behaviors in separate subprocess-safe cases:

```ts
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STATE_DIR = mkdtempSync(join(tmpdir(), 'subwave-litellm-'));
const settings = await import('../src/settings.js');

process.env.LITELLM_API_BASE = 'https://env.example/litellm';
await settings.load();
let result = await settings.update({ llm: { provider: 'litellm', model: 'vendor/model', baseUrl: '' } });
assert.equal(result.saved.llm.provider, 'litellm');

delete process.env.LITELLM_API_BASE;
delete process.env.OPENAI_API_BASE;
await assert.rejects(
  () => settings.update({ llm: { provider: 'litellm', model: 'vendor/model', baseUrl: '' } }),
  /LiteLLM base URL is required/,
);

process.env.LITELLM_API_BASE = 'https://env.example/litellm';
await assert.rejects(
  () => settings.update({ llm: { provider: 'litellm', model: '', baseUrl: '' } }),
  /LiteLLM model is required/,
);

console.log('✓ LiteLLM settings accept env URL and reject a missing effective URL');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd controller
npx tsx scripts/litellm-config.test.ts
```

Expected: the missing-effective-URL case is not rejected yet.

- [ ] **Step 3: Implement effective-URL validation for primary and fallback legs**

Import `effectiveLiteLlmBaseUrl` from the dependency-free root module
`./litellm-config.js`. After applying each leg patch, validate:

```ts
if (next.llm.provider === 'litellm' && !effectiveLiteLlmBaseUrl(next.llm)) {
  throw new Error('LiteLLM base URL is required in Settings or LITELLM_API_BASE/OPENAI_API_BASE');
}
if (next.llm.provider === 'litellm' && !next.llm.model) {
  throw new Error('LiteLLM model is required');
}
```

Apply the same rule to an enabled LiteLLM fallback. Keep the existing
`openai-compatible` saved-URL validation unchanged.

- [ ] **Step 4: Extend settings discovery and connection probes**

In `controller/src/routes/settings.ts`:

- Add `LITELLM_API_BASE`, `OPENAI_API_BASE`, and `LITELLM_API_KEY` presence
  booleans to the redacted `env` response; keep the existing `OPENAI_API_KEY`
  boolean.
- Add `litellm` to the chat model-discovery switch. Resolve URL/key with the
  Task 1 helpers, call `${url}/models`, add an `Authorization: Bearer` header only
  when a key exists, and sort the returned `.data[].id` strings.
- Extend `POST /settings/llm/probe-compat` to accept `provider`. For
  `provider === 'litellm'`, resolve omitted URL/key from saved/environment
  configuration and build a one-off `createOpenAI({ baseURL, apiKey }).chat(model)`
  without `noThinkFetch`. Preserve the current local-compatible behavior when
  provider is absent or `openai-compatible`.

Return only `{ ok, message, latencyMs }`; never include the resolved token.

- [ ] **Step 5: Extend onboarding test and save behavior**

In `controller/src/routes/onboarding.ts`, add:

```ts
case 'litellm': {
  const cfg = { provider, model, baseUrl, apiKey };
  const resolvedBaseUrl = effectiveLiteLlmBaseUrl(cfg);
  if (!resolvedBaseUrl) throw new Error('LiteLLM base URL is required');
  m = createOpenAI({
    baseURL: resolvedBaseUrl,
    apiKey: effectiveLiteLlmApiKey(cfg) || 'unused',
  }).chat(model);
  break;
}
```

The save route already passes `llm.apiKey` through `settings.update`; verify it
lands in `settings.llm.keys.litellm`. Do not add LiteLLM to embedding settings
or `SECRET_ENV_KEYS` because environment values already arrive through the root
`.env`, while wizard-entered overrides are provider-scoped settings.

- [ ] **Step 6: Run controller tests and verify GREEN**

```bash
cd controller
npx tsx scripts/litellm-config.test.ts
npm run test:llm
npm test
npm run lint
```

Expected: the new focused test and every existing controller test pass; ESLint
and TypeScript exit 0.

- [ ] **Step 7: Commit Task 2**

```bash
git add controller/scripts/litellm-config.test.ts controller/src/settings.ts \
  controller/src/routes/settings.ts controller/src/routes/onboarding.ts
git commit -m "feat(settings): configure and probe LiteLLM gateways"
```

---

### Task 3: Admin and onboarding provider UI

**Files:**
- Create: `web/scripts/llm-provider-meta.test.ts`
- Modify: `web/package.json`
- Modify: `web/components/admin/llm/providerMeta.ts`
- Modify: `web/components/admin/settings/LlmSection.tsx`
- Modify: `web/components/onboarding/useWizard.ts`
- Modify: `web/components/onboarding/steps.tsx`

**Interfaces:**
- Consumes: controller provider id `litellm`, model-discovery route, probe route, and environment presence booleans.
- Produces: provider card, primary/fallback forms, onboarding form, model discovery, and provider-aware key status.

- [ ] **Step 1: Write failing provider-metadata tests**

Create `web/scripts/llm-provider-meta.test.ts`:

```ts
import assert from 'node:assert/strict';
import { PROVIDER_META, PROVIDER_IDS, LLM_PROVIDER_LABELS, providerStatus } from '../components/admin/llm/providerMeta.ts';

assert.equal(PROVIDER_IDS.includes('litellm'), true);
assert.equal(PROVIDER_META.litellm.label, 'LiteLLM');
assert.equal(PROVIDER_META.litellm.kind, 'cloud');
assert.equal(LLM_PROVIDER_LABELS.litellm, 'LiteLLM (custom cloud gateway)');
assert.deepEqual(providerStatus('litellm', { LITELLM_API_KEY: true }, true), { label: 'key set', tone: 'ok' });
assert.deepEqual(providerStatus('litellm', { OPENAI_API_KEY: true }, true), { label: 'key set', tone: 'ok' });
assert.deepEqual(providerStatus('litellm', {}, true), { label: 'key optional', tone: 'ok' });
console.log('✓ LiteLLM provider metadata');
```

Add the script:

```json
"test:llm-provider": "node --experimental-strip-types scripts/llm-provider-meta.test.ts"
```

- [ ] **Step 2: Run the metadata test and verify RED**

```bash
cd web
npm run test:llm-provider
```

Expected: `PROVIDER_META.litellm` is undefined.

- [ ] **Step 3: Add provider metadata with multi-key fallback awareness**

In `providerMeta.ts`, extend `ProviderMeta` with optional `envVars?: string[]`.
Add:

```ts
{ id: 'litellm', label: 'LiteLLM', blurb: 'Custom cloud gateway', kind: 'cloud', envVars: ['LITELLM_API_KEY', 'OPENAI_API_KEY'] },
```

Add label:

```ts
litellm: 'LiteLLM (custom cloud gateway)',
```

Update `providerStatus()` to treat any truthy entry in `envVars` as configured.
For LiteLLM only, an absent key returns `{ label: 'key optional', tone: 'ok' }`
because private gateways may be keyless. Keep the warning behavior for all
other cloud providers. Keep `LLM_ENV_VARS` limited to providers with one
dedicated `envVar`; LiteLLM inline-key saving is handled by the custom endpoint
form, not the generic cloud-secret form.

- [ ] **Step 4: Generalize the Admin custom-endpoint fields**

In `LlmSection.tsx`, introduce:

```ts
const primaryCustomProvider = form.llm.provider === 'openai-compatible' || form.llm.provider === 'litellm';
const fallbackCustomProvider = form.llm.fallback.provider === 'openai-compatible' || form.llm.fallback.provider === 'litellm';
```

Use these booleans for base URL, bearer token, connection test, model discovery,
save payload, and redacted-key placeholder visibility. Index the stored key by
the active provider rather than hard-coding `openai-compatible`. Pass
`provider: form.llm.provider` to the probe body.

Keep repetition-penalty controls restricted to `openai-compatible` and `locca`.
For LiteLLM, label the URL `LiteLLM base URL`, use the placeholder
`https://gateway.example/v1`, and explain that blank uses
`LITELLM_API_BASE`/`OPENAI_API_BASE`. The Test button is enabled with a blank
saved URL when the settings response reports either environment URL present.

Mirror the same behavior for the fallback form.

- [ ] **Step 5: Extend onboarding provider selection and discovery**

In `useWizard.ts`, rename `discoverLocca` to `discoverCustomModels` and include
both `provider` and optional `baseUrl` in the `/settings/llm/models` query.
When saving LiteLLM, pass `llm.apiKey` as the provider-scoped inline override;
do not add it to the generic `apiKeys` map.

In `steps.tsx`:

- Treat `litellm` as a custom endpoint with URL/token fields.
- Allow blank URL when the controller reports an environment URL.
- Use `discoverCustomModels` for LiteLLM model selection.
- Show `LiteLLM cloud gateway` copy, not the local-server reachability warning.
- Keep local repetition/context controls hidden.

- [ ] **Step 6: Run web tests and verify GREEN**

```bash
cd web
npm run test:llm-provider
npm run test:audio-format
npm run lint
npm run build
```

Expected: both script tests pass, lint/typecheck exits 0, and the production
Next.js build succeeds.

- [ ] **Step 7: Commit Task 3**

```bash
git add web/package.json web/scripts/llm-provider-meta.test.ts \
  web/components/admin/llm/providerMeta.ts web/components/admin/settings/LlmSection.tsx \
  web/components/onboarding/useWizard.ts web/components/onboarding/steps.tsx
git commit -m "feat(admin): expose LiteLLM cloud provider"
```

---

### Task 4: Real Mercury verification and final review

**Files:**
- Modify only if a test exposes a defect: files from Tasks 1–3
- Generated, gitignored report: `controller/scripts/llm-bench/reports/mercury-litellm-screen.json`

**Interfaces:**
- Consumes: completed `litellm` provider and the root `.env` Mercury values.
- Produces: benchmark evidence that real DJ calls reach Mercury without local-only parameter rejection.

- [ ] **Step 1: Run the representative Mercury screen outside the live controller**

From the worktree's `controller/`, load the root `.env` without printing
secrets and run:

```bash
set -a
. ../../.env
set +a
export STATE_DIR="$(cd ../../state && pwd)"
export LITELLM_API_BASE="$OPENAI_API_BASE"
export LITELLM_API_KEY="$OPENAI_API_KEY"
npm run llm-bench -- \
  --models 'litellm:mercury/devflow.default,litellm:claude-sonnet-4-6,litellm:gemini-3-flash-no-reasoning,litellm:gpt-5.4-mini,litellm:claude-haiku-4-5-20251001' \
  --kinds 'djAgentPick,djAgentSegment,generateLink,generateBanter' \
  --iterations 1 \
  --out scripts/llm-bench/reports/mercury-litellm-screen.json
```

Expected: requests reach model execution; no failure mentions
`chat_template_kwargs`, conflicting `thinking`, or injected
`repeat_penalty`. Model-quality failures are recorded for comparison rather
than treated as transport regressions.

- [ ] **Step 2: Deepen the two recommended finalists**

Run the recommended quality leader and value/latency leader across all scenario
groups at three iterations:

```bash
npm run llm-bench -- \
  --models 'litellm:claude-sonnet-4-6,litellm:gemini-3-flash-no-reasoning' \
  --iterations 3 \
  --out scripts/llm-bench/reports/mercury-litellm-finalists.json
```

If either finalist has a transport-level thrown rate above zero in Step 1, stop
instead of spending on the deep run and investigate that provider/model route.
Do not alter live settings.

- [ ] **Step 3: Run the full verification matrix**

```bash
cd controller
npm test
npm run lint
npm run typecheck
cd ../web
npm run test:llm-provider
npm run test:audio-format
npm run lint
npm run typecheck
npm run build
cd ..
git diff --check
git status -sb
```

Expected: all commands exit 0; only intentional feature commits and gitignored
benchmark reports are present.

- [ ] **Step 4: Review compatibility invariants**

Inspect the final diff and confirm:

- `openAICompatibleFetch` and the `openai-compatible`/locca capability entries
  are behaviorally unchanged.
- `EMBEDDING_PROVIDERS` excludes `litellm`.
- No token is included in settings responses, logs, benchmark reports, or git
  diff.
- Both primary and fallback forms use the provider-specific key slot.
- The live controller still reports `google:gemini-3.1-flash-lite`.

- [ ] **Step 5: Commit any verification-driven correction and request review**

If verification required a correction, return to the relevant task's
failing-test step, make the minimal correction, rerun its focused and full
verification commands, stage only the corrected files named by that task, and
commit:

```bash
git commit -m "fix(llm): correct LiteLLM provider integration"
```

Then use `superpowers:requesting-code-review`, address any confirmed findings,
and rerun Step 3 before presenting branch-integration options with
`superpowers:finishing-a-development-branch`.

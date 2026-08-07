# LiteLLM Discovery Environment-Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LiteLLM discovery and probes authenticate a saved gateway URL with an environment-only bearer token, then compare Haiku and Gemini on SUB/WAVE's real agent-picker scenarios.

**Architecture:** Keep endpoint trust in `resolveLiteLlmRouteConfig()`: only an explicit token, a saved provider endpoint, or the configured environment endpoint may receive an implicit bearer. For a saved endpoint, reuse `effectiveLiteLlmApiKey()` so route credential precedence matches the inference registry. Deploy the controller-only fix, then run the existing matrix harness with process-local provider/model overrides.

**Tech Stack:** TypeScript, Express, Node `assert`, Vercel AI SDK, SUB/WAVE `llm-bench`, GitHub Actions/Docker deployment.

## Global Constraints

- Never expose a gateway bearer in test output, git history, process arguments, or the benchmark report.
- Never forward a saved or environment bearer to an arbitrary URL supplied by the browser.
- Do not change the live station's configured provider, model, reasoning, discovery rounds, or deadline while benchmarking.
- Benchmark exactly `djAgentPick` in agent mode with three iterations per scenario and model.

---

### Task 1: Route credential parity

**Files:**
- Modify: `controller/scripts/litellm-routes.test.ts`
- Modify: `controller/src/routes/settings/model-discovery.ts:110-150`
- Modify: `controller/src/routes/settings/llm.ts:370-390`

**Interfaces:**
- Consumes: `effectiveLiteLlmApiKey(cfg, env?)`, `settings.llmKeyFor(provider)`, and the saved-endpoint binding checks in both route resolvers.
- Produces: discovery and probe resolvers returning the saved LiteLLM URL with the effective environment bearer when no saved bearer exists.

- [ ] **Step 1: Add the failing mounted-route regression**

Add a route-test phase that clears `LITELLM_API_BASE` and `LITELLM_API_KEY`, sets `OPENAI_API_KEY` to `openai-environment-token`, saves `primary.baseUrl` with an empty LiteLLM provider token, then calls model discovery and the compatibility probe. Assert each mounted route sends `Bearer openai-environment-token` to the saved gateway.

```ts
assert.deepEqual(primary.requests.at(-1), {
  method: 'GET',
  url: '/v1/models',
  authorization: 'Bearer openai-environment-token',
});
```

Keep the existing changed-origin assertion proving an arbitrary submitted URL receives `Bearer no-key`.

- [ ] **Step 2: Run the focused test and verify the production shape fails**

Run:

```bash
cd controller
npx tsx scripts/litellm-routes.test.ts
```

Expected first failure: model discovery sends an empty authorization header instead of `Bearer openai-environment-token`. After fixing discovery, the same test must fail at the probe assertion for the same reason.

- [ ] **Step 3: Implement the minimal trusted-endpoint fallback**

For chat model discovery, resolve the saved LiteLLM token through the shared
environment-aware helper while the connection is still bound to `savedBase`:

```ts
const inlineKey = savedBase ? settings.llmKeyFor(input.provider) : '';
savedKey = input.provider === 'litellm' && savedBase
  ? effectiveLiteLlmApiKey({ apiKey: inlineKey })
  : inlineKey;
```

Run the focused test and confirm discovery advances to the still-failing probe
assertion. Then change only the probe's saved-endpoint branch:

```ts
if (!apiKey && savedProviderEndpoints('litellm').has(baseUrl)) {
  apiKey = effectiveLiteLlmApiKey({
    apiKey: settings.llmKeyFor('litellm'),
  });
}
```

Leave the explicit-token and environment-owned URL branches unchanged.

- [ ] **Step 4: Verify focused and full controller checks**

Run:

```bash
cd controller
npx tsx scripts/litellm-routes.test.ts
npm test
npm run lint
npm run typecheck
```

Expected: all commands exit 0; route test confirms the environment token reaches only the saved gateway.

- [ ] **Step 5: Commit the fix**

```bash
git add controller/scripts/litellm-routes.test.ts controller/src/routes/settings/model-discovery.ts controller/src/routes/settings/llm.ts
git commit -m "fix: authenticate saved LiteLLM discovery URLs"
```

---

### Task 2: Publish and verify production discovery

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: Task 1's committed controller change and the existing GitHub/Docker deployment workflow.
- Produces: a production controller whose authenticated `/api/settings/llm/models` and `/api/settings/llm/probe-compat` routes use the same LiteLLM bearer as live inference.

- [ ] **Step 1: Review the branch diff and rerun the focused test**

```bash
git diff --check origin/develop...HEAD
git diff --stat origin/develop...HEAD
cd controller && npx tsx scripts/litellm-routes.test.ts
```

Expected: only the spec, plan, route test, and route resolver changed; the focused test exits 0.

- [ ] **Step 2: Push the branch and open a PR**

```bash
git push -u origin fix/litellm-discovery-env-key
gh pr create --base develop --head fix/litellm-discovery-env-key \
  --title "fix: authenticate saved LiteLLM discovery URLs" \
  --body "Fixes LiteLLM model discovery when the gateway URL is saved but its token comes from OPENAI_API_KEY. Preserves origin-bound credential forwarding and adds mounted-route regression coverage."
```

- [ ] **Step 3: Wait for required checks, merge, and deploy the controller**

Use the repository's normal PR merge and SUB/WAVE deployment workflow. Rebuild/recreate the controller so the compiled production image contains the route fix; a restart alone is insufficient.

- [ ] **Step 4: Verify live discovery and probe**

Using Basic auth from the root `.env`, POST:

```json
{"owner":"chat","provider":"litellm","leg":"primary"}
```

to `/api/settings/llm/models`. Expected: HTTP 200, `ok: true`, and a non-empty model list. Probe both benchmark aliases through `/api/settings/llm/probe-compat`; expected: `ok: true` without printing credentials.

---

### Task 3: Haiku versus Gemini agent-picker benchmark

**Files:**
- Create: `controller/scripts/llm-bench/reports/2026-08-07-haiku-vs-gemini-agent-pick.json` (gitignored generated report)

**Interfaces:**
- Consumes: the production LiteLLM URL and bearer from the deployment environment; `controller/scripts/llm-bench` real prompts, schemas, and fake library tools.
- Produces: per-model thrown rate, violation rate, dominant failure, and p50 latency for agent-picker scenarios.

- [ ] **Step 1: Make the production gateway credential available to the short-lived benchmark process without printing it**

Set `LITELLM_API_BASE` and `LITELLM_API_KEY` from the deployment environment in the benchmark shell. Do not echo either value and do not persist the token into a report or repository file.

- [ ] **Step 2: Run the controlled comparison**

```bash
cd controller
npm run llm-bench -- \
  --models 'litellm:claude-haiku-4-5-20251001,litellm:gemini-3-flash-no-reasoning' \
  --kinds 'djAgentPick' \
  --modes agent \
  --iterations 3 \
  --out scripts/llm-bench/reports/2026-08-07-haiku-vs-gemini-agent-pick.json
```

Expected: both routes execute the long-context and ordinary agent-picker scenarios through LiteLLM; no live settings are written.

- [ ] **Step 3: Validate and summarize the JSON report**

Confirm every requested model/scenario has three records. Compute, per model, thrown percentage, violation percentage, p50 wall-clock latency, and the most frequent violation or thrown bucket. Reject any model with hallucinated IDs or unreliable done-tool behavior even if it is faster.

- [ ] **Step 4: Report the recommendation**

Name the winning provider, model, and mode. Include the measured table, any disqualifier, the production discovery result, and the unchanged live model setting.

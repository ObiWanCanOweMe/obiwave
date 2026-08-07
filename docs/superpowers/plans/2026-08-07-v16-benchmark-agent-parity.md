# v1.6 Benchmark Agent Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the standalone picker test and pick/request matrix benchmarks use the same provider-discovery strategy settings as the live named agents.

**Architecture:** Add one pure `agentStrategyOptions()` adapter to the named-agent factory's public surface. Direct benchmark calls spread that adapter's result while retaining their synthetic prompts, schemas, tools, telemetry kinds, and documented command-line overrides.

**Tech Stack:** TypeScript, ESM, Node 22, Node's built-in test runner, tsx, ESLint.

## Global Constraints

- Do not change live provider behavior, prompts, schemas, failover, timeouts, authentication, persisted state, APIs, or deployment configuration.
- Do not change benchmark fixtures, scoring, reports, or published historical results.
- Keep duplicate-library deep-cut behavior and Caddy edge-health coverage outside this PR.
- Do not cut a release, publish images, or deploy.
- Use Node `v22.x`, matching CI.
- Follow strict red-green TDD: the regression test must fail for the missing parity helper before production code changes.

## File map

- `controller/src/llm/internal/agent-factory.ts`: defines the named-agent instance and the new pure strategy-options adapter.
- `controller/src/llm/agent.ts`: stable public barrel for the adapter and its type.
- `controller/scripts/llm-discovery-steps.test.ts`: regression contract proving benchmark-derived settings produce live discovery budgets.
- `controller/scripts/picker-test.mjs`: standalone picker reliability benchmark; retains CLI overrides.
- `controller/scripts/llm-bench/kinds/pick.ts`: matrix pick-agent benchmark.
- `controller/scripts/llm-bench/kinds/request.ts`: matrix request-agent benchmark.

---

### Task 1: Derive direct benchmark strategy options from live agents

**Files:**
- Modify: `controller/scripts/llm-discovery-steps.test.ts`
- Modify: `controller/src/llm/internal/agent-factory.ts`
- Modify: `controller/src/llm/agent.ts`
- Modify: `controller/scripts/picker-test.mjs`
- Modify: `controller/scripts/llm-bench/kinds/pick.ts`
- Modify: `controller/scripts/llm-bench/kinds/request.ts`

**Interfaces:**
- Consumes: `DjAgentInstance<TArgs, TExtras>` with resolved `maxSteps`, `timeoutMs`, `temperature`, `maxOutputTokens`, and boolean `providerDiscoveryBudget` properties.
- Produces: `agentStrategyOptions(agent: DjAgentInstance): AgentStrategyOptions` where `AgentStrategyOptions` contains those five fields and is safe to spread into a direct `djAgent()` call.

- [ ] **Step 1: Install locked dependencies and confirm the focused baseline**

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" node --version
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm ci --no-audit --no-fund
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm --prefix controller ci --no-audit --no-fund
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm --prefix controller exec -- tsx controller/scripts/llm-discovery-steps.test.ts
```

Expected: Node reports `v22.x`; both locked installs exit 0; the existing discovery-step test passes before modification.

- [ ] **Step 2: Write the failing parity test**

Append a Node test to `controller/scripts/llm-discovery-steps.test.ts`. Import the public barrel as a namespace so the pre-implementation run fails with an assertion, rather than a module-linking error:

```ts
test('direct benchmark options preserve the live agents provider discovery budget', async () => {
  const agentApi = await import('../src/llm/agent.js') as Record<string, any>;
  assert.equal(typeof agentApi.agentStrategyOptions, 'function', 'public parity helper exists');

  const { pickerAgent, requestAgent } = await import('../src/broadcast/dj-agent/agents.js');
  const { directorAgent } = await import('../src/skills/_agent.js');
  const { runDiscoverySteps } = await import('../src/llm/internal/provider/capabilities.js');

  const pickerOptions = agentApi.agentStrategyOptions(pickerAgent);
  const requestOptions = agentApi.agentStrategyOptions(requestAgent);
  const directorOptions = agentApi.agentStrategyOptions(directorAgent);

  assert.equal(pickerOptions.providerDiscoveryBudget, true);
  assert.equal(requestOptions.providerDiscoveryBudget, true);
  assert.equal(runDiscoverySteps({ provider: 'litellm' }, pickerOptions.providerDiscoveryBudget), 3);
  assert.equal(runDiscoverySteps({ provider: 'litellm' }, requestOptions.providerDiscoveryBudget), 3);
  assert.equal(runDiscoverySteps({ provider: 'litellm' }, directorOptions.providerDiscoveryBudget), 1);
});
```

This test catches removal or incorrect derivation of `providerDiscoveryBudget`: a native LiteLLM benchmark would fall from three rounds to one.

- [ ] **Step 3: Run the focused test and verify RED**

Run:

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm --prefix controller exec -- tsx controller/scripts/llm-discovery-steps.test.ts
```

Expected: exit non-zero with `public parity helper exists`, expected `function`, actual `undefined`. Existing cases before the new assertion must remain green.

- [ ] **Step 4: Add the pure strategy-options adapter**

In `controller/src/llm/internal/agent-factory.ts`, define the public result type and helper after `DjAgentInstance`:

```ts
export interface AgentStrategyOptions {
  maxSteps: number | undefined;
  timeoutMs: number | undefined;
  temperature: number | undefined;
  maxOutputTokens: number | undefined;
  providerDiscoveryBudget: boolean;
}

export function agentStrategyOptions(
  agent: DjAgentInstance<any, any>,
): AgentStrategyOptions {
  return {
    maxSteps: agent.maxSteps,
    timeoutMs: agent.timeoutMs,
    temperature: agent.temperature,
    maxOutputTokens: agent.maxOutputTokens,
    providerDiscoveryBudget: agent.providerDiscoveryBudget,
  };
}
```

The helper must remain pure. Explicit `undefined` values preserve `djAgent()`'s destructuring defaults.

Export the function and type from `controller/src/llm/agent.ts`:

```ts
export { defineAgent, agentStrategyOptions } from './internal/agent-factory.js';
export type {
  AgentDefinition,
  AgentRunResult,
  AgentStrategyOptions,
  DjAgentInstance,
} from './internal/agent-factory.js';
```

- [ ] **Step 5: Make all three direct benchmark paths use the adapter**

Import `agentStrategyOptions` from the stable `llm/agent.js` barrel in each benchmark file.

For `controller/scripts/picker-test.mjs`, spread the live options before the existing CLI overrides:

```js
      ...agentStrategyOptions(pickerAgent),
      maxSteps: TEST_MAX_STEPS,
      timeoutMs: TEST_TIMEOUT_MS,
      kind: 'pickerTest',
```

For `controller/scripts/llm-bench/kinds/pick.ts`:

```ts
        ...agentStrategyOptions(pickerAgent),
        kind: 'djAgentPick',
```

For `controller/scripts/llm-bench/kinds/request.ts`:

```ts
        ...agentStrategyOptions(requestAgent),
        kind: 'djAgentRequest',
```

Remove the now-redundant local `agentDeadlineMs` helpers and direct `maxSteps`/`timeoutMs` properties from both matrix files. Do not alter prompts, schemas, synthetic tools, result checks, or telemetry kinds.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm --prefix controller exec -- tsx controller/scripts/llm-discovery-steps.test.ts
```

Expected: exit 0; every discovery-step case passes, including the new LiteLLM parity case.

- [ ] **Step 7: Run focused static gates**

Run:

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm --prefix controller run lint
git diff --check
```

Expected: lint/typecheck exits 0 with no errors; whitespace check exits 0.

- [ ] **Step 8: Commit the tested fix**

```bash
git add controller/scripts/llm-discovery-steps.test.ts \
  controller/src/llm/internal/agent-factory.ts \
  controller/src/llm/agent.ts \
  controller/scripts/picker-test.mjs \
  controller/scripts/llm-bench/kinds/pick.ts \
  controller/scripts/llm-bench/kinds/request.ts
git commit -m "fix: align benchmark agent discovery budgets"
```

### Task 2: Verify and publish the follow-up

**Files:**
- Verify only: all Task 1 files and committed spec/plan.

**Interfaces:**
- Consumes: committed `agentStrategyOptions()` implementation and the three updated benchmark call sites.
- Produces: a reviewed GitHub pull request from `agent/v16-benchmark-parity` to `develop`.

- [ ] **Step 1: Run the complete controller suite under Node 22**

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm --prefix controller test
PATH="/opt/homebrew/opt/node@22/bin:$PATH" npm --prefix controller run lint
```

Expected: all controller test files pass; ESLint reports zero errors; TypeScript exits 0.

- [ ] **Step 2: Run repository CI/release contracts**

```bash
PATH="/opt/homebrew/opt/node@22/bin:$PATH" node --test scripts/ci/*.test.mjs scripts/release/*.test.mjs
```

Expected: all TAP tests pass with zero failed, cancelled, skipped, or todo tests.

- [ ] **Step 3: Verify exact scope and clean committed range**

```bash
git diff --check origin/develop..HEAD
git status --short
git diff --stat origin/develop..HEAD
git diff origin/develop..HEAD -- \
  controller/src/llm/internal/agent-factory.ts \
  controller/src/llm/agent.ts \
  controller/scripts/llm-discovery-steps.test.ts \
  controller/scripts/picker-test.mjs \
  controller/scripts/llm-bench/kinds/pick.ts \
  controller/scripts/llm-bench/kinds/request.ts
```

Expected: no whitespace errors; clean worktree; diff contains only the approved spec, plan, helper, regression test, and three benchmark updates.

- [ ] **Step 4: Push and open a draft PR**

```bash
git push -u origin agent/v16-benchmark-parity
gh pr create --draft --base develop --head agent/v16-benchmark-parity \
  --title "fix: align benchmark agent discovery budgets" \
  --body '## Summary

- derive direct benchmark strategy settings from the live named agents
- preserve the picker test command-line overrides
- add a LiteLLM discovery-budget parity regression test

## Impact

Production playback and provider behavior are unchanged. This fixes benchmark fidelity after the v1.6 integration audit.

## Verification

- red/green discovery-step parity test
- full controller test and lint/typecheck gates under Node 22
- repository CI and release contract tests'
```

The PR body must explain the v1.6 audit finding, why production was unaffected, the shared-adapter fix, red-green evidence, and exact verification results. Do not merge, tag, release, publish images, or deploy.

- [ ] **Step 5: Watch GitHub checks**

```bash
gh pr checks --watch --fail-fast=false
```

Expected: all required checks complete successfully. If a check fails, inspect its logs and stop for diagnosis; do not rerun or modify code without evidence.

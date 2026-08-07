# v1.6 benchmark agent parity design

## Context

The v1.6 integration made the live picker and request agents opt into provider-specific discovery budgets. Native-tool providers such as LiteLLM receive three discovery rounds by default, while callers that do not opt in retain the historical one-round behavior.

The standalone picker test and the pick/request matrix benchmarks call `djAgent()` directly so they can supply synthetic tools. They copy the live agents' step and timeout settings, but currently omit `providerDiscoveryBudget`. Their prompts can therefore describe three discovery rounds while the benchmark runtime permits only one. Production playback is unaffected; benchmark results are not live-equivalent.

## Goal

Make every direct picker/request benchmark call inherit the live named agent's strategy settings, including `providerDiscoveryBudget`, and protect that parity with a regression test.

## Non-goals

- Change live provider behavior, prompts, schemas, failover, timeouts, or authentication.
- Change benchmark fixtures, scoring, reports, or published historical results.
- Address duplicate-library deep-cut labeling or add the deferred Caddy edge-health smoke test.
- Cut a release, publish images, or deploy.

## Design

Add a small public helper beside `defineAgent()` that derives the strategy options needed by a direct `djAgent()` call from a `DjAgentInstance`. It will return:

- `maxSteps`
- the currently resolved `timeoutMs`
- `temperature`
- `maxOutputTokens`
- `providerDiscoveryBudget`

The helper will not copy the agent's prompt, schema, tools, validation callback, or telemetry `kind`. Benchmarks intentionally replace the first four with synthetic equivalents, and each benchmark retains its existing telemetry identity.

Export the helper through the stable `llm/agent.js` barrel. The standalone picker test and both matrix agent scenarios will spread the derived options into their direct `djAgent()` calls. The standalone test will apply its existing command-line step and timeout overrides after the spread so its documented tuning controls continue to win.

This shared derivation is preferred over adding one property independently at three call sites because it also prevents future drift in the other strategy settings already copied by the benchmarks.

## Testing

Extend the existing discovery-step contract test before changing production code. The regression test will derive strategy options from both live agents and assert that:

- picker and request benchmark options carry `providerDiscoveryBudget: true`;
- the derived option drives `runDiscoverySteps()` to the provider's native three-round budget;
- a non-opted-in agent remains on one round.

The test must fail against the current implementation because the shared derivation API does not yet exist. After the minimal implementation and call-site changes, run the focused discovery-step test, controller lint/typecheck, the complete controller test suite, and the repository's relevant release/CI contract tests before publication.

## Error handling and compatibility

The helper is pure and performs no I/O. Undefined optional settings remain undefined, preserving `djAgent()` defaults. `providerDiscoveryBudget` remains an explicit boolean from `DjAgentInstance`, so non-opted-in agents continue to resolve to `false`.

No persisted state, API shape, production runtime path, or deployment configuration changes.

## Acceptance criteria

1. All three direct benchmark callers derive strategy settings from the corresponding live named agent.
2. LiteLLM/native picker and request benchmarks receive the same provider discovery budget as live runs.
3. Existing standalone picker-test step and timeout overrides still take precedence.
4. The focused regression test demonstrates red then green.
5. Controller lint/typecheck and the full controller test suite pass.
6. The follow-up PR contains only the spec, plan, regression test, helper, and three call-site updates required for this fix.

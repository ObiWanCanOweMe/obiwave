// Public surface for the named-agent factory. Implementation in
// internal/agent-factory.ts. Barrel so call sites keep importing from
// `llm/agent.js` unchanged.

export { defineAgent, agentStrategyOptions } from './internal/agent-factory.js';
export type {
  AgentDefinition,
  AgentRunResult,
  AgentStrategyOptions,
  DjAgentInstance,
} from './internal/agent-factory.js';

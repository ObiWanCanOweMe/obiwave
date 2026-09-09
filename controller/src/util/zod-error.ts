// Turning a ZodError into something an operator can read.
//
// A raw ZodError's `.message` is a pretty-printed JSON array of issue objects —
// ~15 lines for one bad URL. Every route that surfaces a failure does
// `res.status(400).json({ error: err.message })`, so that blob lands verbatim
// in a toast. These two helpers are the one place that translation lives.
//
// Neutral on purpose: BOTH middleware/validate.ts (route boundary) and
// settings/validate.ts (the persistence chokepoint update() reaches from backup
// restore and POST /settings) import from here. Importing middleware/ into
// settings/ would invert the dependency direction, so neither owns it.
import type { ZodError } from 'zod';

// Dotted path ('webhooks.1.url'), which is also react-hook-form's setError syntax.
function pathOf(issue: ZodError['issues'][number]): string {
  return issue.path.join('.');
}

/**
 * One message per field, keyed by dotted path. The accumulator MUST stay a
 * null-prototype object: field names come from user data, and on a `{}` literal
 * `toString` is swallowed by the first-wins guard while `__proto__` is dropped
 * outright.
 */
export function flattenIssues(error: ZodError): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const issue of error.issues) {
    const key = pathOf(issue);
    // First error per field wins.
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/**
 * A flat, single-line message — what a 400's `error` string carries.
 *
 * The dotted path is prefixed UNCONDITIONALLY: zod's messages name a constraint
 * and never a location, and even a custom message never names the array index,
 * so without it two rows failing the same rule read identically. Don't
 * reintroduce a per-code heuristic; the set of field-agnostic codes is open.
 *
 * `root` names the value when the SCHEMA is unrooted — a validator parsing a
 * bare array passes its settings key so '0.url' reads as 'webhooks.0.url'.
 */
export function firstMessage(error: ZodError, root?: string): string {
  const issue = error.issues[0];
  if (!issue) return 'invalid request body';
  // pathOf is '' for a root-level issue, so a bare `root` survives on its own.
  const key = [root, pathOf(issue)].filter(Boolean).join('.');
  return key ? `${key}: ${issue.message}` : issue.message;
}

// Resolve retired built-ins only when no installed theme owns the exact ID.
import { LEGACY_THEME_IDS } from '../theme-tokens.js';

export function resolveThemeId(id: string, known: ReadonlySet<string>): string | undefined {
  if (known.has(id)) return id;
  const replacement = Object.hasOwn(LEGACY_THEME_IDS, id) ? LEGACY_THEME_IDS[id] : undefined;
  return replacement && known.has(replacement) ? replacement : undefined;
}

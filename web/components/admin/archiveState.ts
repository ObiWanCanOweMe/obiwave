export type ArchiveApiError = string | {
  operation?: unknown;
  code?: unknown;
};

function diagnosticToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  return token.length > 0 && token.length <= 64 && /^[a-zA-Z0-9._-]+$/.test(token)
    ? token
    : null;
}

export function archiveErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error;
  if (!error || typeof error !== 'object') return fallback;

  const structured = error as { operation?: unknown; code?: unknown };
  const operation = diagnosticToken(structured.operation);
  const code = diagnosticToken(structured.code);
  return operation && code ? `archive ${operation} failed (${code})` : fallback;
}

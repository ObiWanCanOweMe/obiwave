import { isRateLimited, isTransient, retryAfterMs } from '../llm/sdk.js';

export const CLOUD_EMBED_BATCH_SIZE = 64;
export const MAX_BULK_RETRY_AFTER_MS = 65_000;
export const BULK_RETRY_SAFETY_MS = 250;
export const MAX_CONSECUTIVE_RATE_LIMIT_WAITS = 3;
const TRANSIENT_RETRY_DELAYS_MS = [500, 1_500, 3_500];
const SAFE_TRANSPORT_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT',
]);

export interface BulkEmbeddingWaitNotice {
  seconds: number;
  attempt: number;
  kind: 'rate-limit' | 'transient';
  classification: string;
}

export interface BulkEmbeddingRetryOptions {
  sleep?: (ms: number) => Promise<void>;
  onWait?: (notice: BulkEmbeddingWaitNotice) => void;
}

export interface BulkEmbeddingCommitOptions<T> {
  result: T;
  commit: (result: T) => void;
  onCommitted: () => void;
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function bulkEmbeddingBatchSize(tagBatchSize: number, local: boolean): number {
  if (!local) return CLOUD_EMBED_BATCH_SIZE;
  return Math.max(8, Math.min(64, tagBatchSize * 2));
}

function usableRateLimitDelay(err: unknown): number | null {
  if (!isRateLimited(err as Parameters<typeof isRateLimited>[0])) return null;
  const hinted = retryAfterMs(err);
  if (hinted == null || hinted > MAX_BULK_RETRY_AFTER_MS) return null;
  return hinted;
}

type EmbeddingError = Record<string, unknown>;

function asEmbeddingError(value: unknown): EmbeddingError | null {
  return value != null && typeof value === 'object' ? value as EmbeddingError : null;
}

function unwrapEmbeddingError(error: unknown): EmbeddingError | null {
  const seen = new Set<object>();
  let current = asEmbeddingError(error);
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (seen.has(current)) return current;
    seen.add(current);
    const lastError = asEmbeddingError(current.lastError);
    const errors = Array.isArray(current.errors) ? current.errors : [];
    const finalError = asEmbeddingError(errors.at(-1));
    const cause = asEmbeddingError(current.cause);
    const next = lastError ?? finalError ?? cause;
    if (!next || seen.has(next)) return current;
    current = next;
  }
  return current;
}

export function safeEmbeddingFailureClass(error: unknown): string {
  const err = unwrapEmbeddingError(error);
  const status = err?.statusCode ?? err?.status;
  if (typeof status === 'number' && Number.isInteger(status)) return `HTTP ${status}`;
  const code = err?.code;
  if (typeof code === 'string' && SAFE_TRANSPORT_CODES.has(code)) return code;
  const name = err?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout';
  return 'unclassified error';
}

export function bulkEmbeddingFailureMessage(err: unknown): string {
  const message = isRateLimited(err as Parameters<typeof isRateLimited>[0])
    ? 'Embedding service rate limit could not be safely retried'
    : 'Embedding service request failed';
  return `${message} (${safeEmbeddingFailureClass(err)})`;
}

export function commitBulkEmbeddingBatch<T>(options: BulkEmbeddingCommitOptions<T>): void {
  options.commit(options.result);
  options.onCommitted();
}

export async function withBulkEmbeddingRateLimit<T>(
  request: () => Promise<T>,
  options: BulkEmbeddingRetryOptions = {},
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  let rateLimitWaits = 0;
  let transientWaits = 0;
  while (true) {
    try {
      return await request();
    } catch (err) {
      const hinted = usableRateLimitDelay(err);
      if (isRateLimited(err as Parameters<typeof isRateLimited>[0])) {
        if (hinted == null) throw err;
        if (rateLimitWaits >= MAX_CONSECUTIVE_RATE_LIMIT_WAITS) throw err;
        rateLimitWaits += 1;
        options.onWait?.({
          seconds: Math.ceil(hinted / 1000),
          attempt: rateLimitWaits,
          kind: 'rate-limit',
          classification: safeEmbeddingFailureClass(err),
        });
        await sleep(hinted + BULK_RETRY_SAFETY_MS);
        continue;
      }
      if (!isTransient(err as Parameters<typeof isTransient>[0])
        || transientWaits >= TRANSIENT_RETRY_DELAYS_MS.length) throw err;
      const delay = TRANSIENT_RETRY_DELAYS_MS[transientWaits];
      transientWaits += 1;
      options.onWait?.({
        seconds: Math.ceil(delay / 1000),
        attempt: transientWaits,
        kind: 'transient',
        classification: safeEmbeddingFailureClass(err),
      });
      await sleep(delay);
    }
  }
}

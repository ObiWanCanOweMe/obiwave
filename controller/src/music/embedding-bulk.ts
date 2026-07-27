import { isRateLimited, retryAfterMs } from '../llm/sdk.js';

export const CLOUD_EMBED_BATCH_SIZE = 64;
export const MAX_BULK_RETRY_AFTER_MS = 65_000;
export const BULK_RETRY_SAFETY_MS = 250;
export const MAX_CONSECUTIVE_RATE_LIMIT_WAITS = 3;

export interface BulkEmbeddingWaitNotice {
  seconds: number;
  attempt: number;
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

export function bulkEmbeddingFailureMessage(err: unknown): string {
  return isRateLimited(err as Parameters<typeof isRateLimited>[0])
    ? 'Embedding service rate limit could not be safely retried'
    : 'Embedding service request failed';
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
  let waits = 0;
  while (true) {
    try {
      return await request();
    } catch (err) {
      const hinted = usableRateLimitDelay(err);
      if (hinted == null || waits >= MAX_CONSECUTIVE_RATE_LIMIT_WAITS) throw err;
      waits += 1;
      options.onWait?.({ seconds: Math.ceil(hinted / 1000), attempt: waits });
      await sleep(hinted + BULK_RETRY_SAFETY_MS);
    }
  }
}

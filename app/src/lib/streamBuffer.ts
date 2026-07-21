import type { StreamFormat } from './streamFormat';
import type { StreamInfo } from './types';

/** Resolve the live-edge delay for the mount actually selected by RNTP. */
export function bufferSecondsForFormat(
  stream: StreamInfo | null | undefined,
  format: StreamFormat,
): number | null {
  const specific = stream?.bufferSecondsByFormat?.[format];
  const value = typeof specific === 'number' ? specific : stream?.bufferSeconds;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 60
    ? value
    : null;
}

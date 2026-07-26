export type StreamFormat = 'mp3' | 'aac' | 'opus' | 'flac';

/** Icecast mount path for a format — matches the Liquidsoap outputs and Caddy. */
export function mountFor(format: StreamFormat): string {
  return `/stream.${format}`;
}

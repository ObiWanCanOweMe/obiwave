export type StreamFormat = 'mp3' | 'opus' | 'aac' | 'flac';
export type StreamBufferSecondsByFormat = Record<StreamFormat, number>;

/**
 * Intended live-edge offsets for the Icecast mount renderer. MP3 and AAC are
 * exact CBR targets, Opus is a constrained-VBR target, and FLAC uses the
 * renderer's estimate. Active web playback measures its actual listener lag.
 */
export function streamBufferSecondsByFormat(seconds: number): StreamBufferSecondsByFormat {
  return { mp3: seconds, opus: seconds, aac: seconds, flac: seconds };
}

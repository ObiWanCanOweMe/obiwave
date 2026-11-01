export type StreamFormat = 'mp3' | 'opus' | 'aac' | 'flac';
export type StreamBufferSecondsByFormat = Record<StreamFormat, number>;

/**
 * Intended live-edge offsets for the Icecast mount renderer. MP3, AAC and Opus use CBR targets, while FLAC uses the
 * renderer's bitrate estimate. Pass the advertised rendered depth, not a
 * setting saved since the broadcast mounts last launched.
 */
export function streamBufferSecondsByFormat(seconds: number): StreamBufferSecondsByFormat {
  return { mp3: seconds, opus: seconds, aac: seconds, flac: seconds };
}

export type StreamFormat = 'mp3' | 'opus' | 'aac' | 'flac';
export type StreamBufferSecondsByFormat = Record<StreamFormat, number>;

/**
 * Exact live-edge offsets for the Icecast mount renderer. MP3 and AAC are CBR,
 * so they can turn seconds into bytes before startup. Opus uses constrained
 * VBR and FLAC is variable-rate, so no fixed byte count can promise a duration;
 * their explicit zero-byte mount overrides are the only exact pre-source value.
 */
export function streamBufferSecondsByFormat(seconds: number): StreamBufferSecondsByFormat {
  return { mp3: seconds, opus: 0, aac: seconds, flac: 0 };
}

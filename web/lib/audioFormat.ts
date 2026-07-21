export type AudioFormat = 'mp3' | 'opus' | 'aac' | 'flac';
export type StreamEnablement = Record<AudioFormat, boolean>;
export type BrowserSupport = Record<AudioFormat, boolean>;
export interface AudioStreamUrls {
  mp3: string;
  opus: string | null;
  aac: string | null;
  flac: string | null;
}
export type FormatAvailability = Record<AudioFormat, {
  available: boolean;
  reason: 'Not enabled by this station' | 'Not supported by this browser' | 'Stream failed; using MP3' | null;
}>;

type CanPlayAnswer = '' | 'maybe' | 'probably';

export const AUDIO_FORMATS = [
  { id: 'mp3', label: 'MP3', description: 'Universal compatibility' },
  { id: 'opus', label: 'Opus', description: 'Efficient, high-quality audio' },
  { id: 'aac', label: 'AAC', description: 'Modern compressed audio' },
  { id: 'flac', label: 'FLAC', description: 'Lossless broadcast audio' },
] as const satisfies readonly { id: AudioFormat; label: string; description: string }[];

export const AUDIO_MIME_TYPES: Record<AudioFormat, string> = {
  mp3: 'audio/mpeg',
  opus: 'audio/ogg; codecs=opus',
  aac: 'audio/aac',
  flac: 'audio/ogg; codecs=flac',
};

/** Resolve the live-edge delay for the mount actually selected by the player. */
export function bufferSecondsForFormat(
  stream: {
    bufferSeconds?: number | null;
    bufferSecondsByFormat?: Partial<Record<AudioFormat, number | null>>;
  } | null | undefined,
  format: AudioFormat,
): number | null {
  const specific = stream?.bufferSecondsByFormat?.[format];
  const value = typeof specific === 'number' ? specific : stream?.bufferSeconds;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 60
    ? value
    : null;
}

/** Translate the public station metadata into the playback engine's format
 * switches. MP3 is the universal floor even before the first feed poll. */
export function streamEnablementFor(stream: {
  opusEnabled?: boolean;
  aacEnabled?: boolean;
  flacEnabled?: boolean;
} | null | undefined): StreamEnablement {
  return {
    mp3: true,
    opus: stream?.opusEnabled === true,
    aac: stream?.aacEnabled === true,
    flac: stream?.flacEnabled === true,
  };
}

const FORMAT_SET = new Set<AudioFormat>(AUDIO_FORMATS.map(x => x.id));

export function deriveSiblingMounts(mp3: string): AudioStreamUrls {
  const marker = '/stream.mp3';
  const index = mp3.lastIndexOf(marker);
  if (index === -1) return { mp3, opus: null, aac: null, flac: null };
  const prefix = mp3.slice(0, index);
  const suffix = mp3.slice(index + marker.length);
  return {
    mp3,
    opus: `${prefix}/stream.opus${suffix}`,
    aac: `${prefix}/stream.aac${suffix}`,
    flac: `${prefix}/stream.flac${suffix}`,
  };
}

export function availabilityFor(
  enabled: StreamEnablement,
  supported: BrowserSupport,
  failed: ReadonlySet<AudioFormat> = new Set(),
): FormatAvailability {
  return Object.fromEntries(AUDIO_FORMATS.map(({ id }) => {
    const reason = !enabled[id]
      ? 'Not enabled by this station'
      : !supported[id]
        ? 'Not supported by this browser'
        : failed.has(id)
          ? 'Stream failed; using MP3'
          : null;
    return [id, { available: reason === null, reason }];
  })) as FormatAvailability;
}

export function browserSupportFor(
  codecs: Record<AudioFormat, CanPlayAnswer>,
  platform: { ios: boolean; firefox: boolean; safari?: boolean },
): BrowserSupport {
  return {
    mp3: codecs.mp3 !== '',
    opus: codecs.opus === 'probably' && !platform.ios && !platform.firefox && !platform.safari,
    aac: codecs.aac !== '',
    flac: codecs.flac !== '' && !platform.safari,
  };
}

export function preferenceKey(stationId: string): string {
  return `subwave:audio-format:${encodeURIComponent(stationId)}`;
}

export function loadFormatPreference(
  storage: Pick<Storage, 'getItem'>,
  stationId: string,
): AudioFormat | null {
  const value = storage.getItem(preferenceKey(stationId));
  return value && FORMAT_SET.has(value as AudioFormat) ? value as AudioFormat : null;
}

export function saveFormatPreference(
  storage: Pick<Storage, 'setItem'>,
  stationId: string,
  format: AudioFormat,
): void {
  storage.setItem(preferenceKey(stationId), format);
}

export function effectiveFormat(
  preferred: AudioFormat | null,
  availability: FormatAvailability,
): AudioFormat {
  return preferred && availability[preferred].available ? preferred : 'mp3';
}

export function resolveFormatPreference(
  preferred: AudioFormat | null,
  enabled: StreamEnablement,
  supported: BrowserSupport,
  streams: AudioStreamUrls,
  failed: ReadonlySet<AudioFormat> = new Set(),
): { format: AudioFormat; streamUrl: string } {
  const effectiveEnablement: StreamEnablement = {
    mp3: enabled.mp3,
    opus: enabled.opus && streams.opus !== null,
    aac: enabled.aac && streams.aac !== null,
    flac: enabled.flac && streams.flac !== null,
  };
  const format = effectiveFormat(preferred, availabilityFor(effectiveEnablement, supported, failed));
  return { format, streamUrl: streams[format] ?? streams.mp3 };
}

export function currentPlaybackTarget(
  streamUrl: { readonly current: string },
  volume: { readonly current: number },
): { streamUrl: string; volume: number } {
  return { streamUrl: streamUrl.current, volume: volume.current };
}

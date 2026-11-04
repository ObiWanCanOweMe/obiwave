import { open, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openPublicResource, type HttpTransport } from './http.js';
import { QobuzError, type ValidatedAudio } from './types.js';
const run = promisify(execFile);
export async function downloadQobuzAudio(url: string, partialPath: string, expectedDuration: number, caller?: AbortSignal, deps: { transport?: HttpTransport; maxBytes?: number } = {}): Promise<ValidatedAudio> {
  const signal = AbortSignal.any([AbortSignal.timeout(180_000), ...(caller ? [caller] : [])]);
  let created = false;
  try {
    const response = await openPublicResource(new URL(url), signal, deps.transport);
    if (response.status !== 200) throw new QobuzError('download unavailable');
    const limit = Math.min(deps.maxBytes ?? 200 * 1024 * 1024, 200 * 1024 * 1024);
    const declared = Number(response.headers['content-length']);
    if (declared > limit) throw new QobuzError('audio too large');
    const file = await open(partialPath, 'wx', 0o600); created = true;
    let bytes = 0;
    try {
      for await (const chunk of response.body) {
        signal.throwIfAborted(); bytes += chunk.length;
        if (bytes > limit) throw new QobuzError('audio too large');
        await file.writeFile(chunk);
      }
      await file.sync();
    } finally { await file.close(); }
    signal.throwIfAborted();
    if (!bytes || (Number.isFinite(declared) && declared > 0 && declared !== bytes)) throw new QobuzError('incomplete audio');
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', partialPath], { signal, maxBuffer: 128 * 1024 });
    const probe = JSON.parse(stdout);
    const audio = probe.streams?.find((stream: Record<string, unknown>) => stream.codec_type === 'audio');
    const duration = Number(probe.format?.duration);
    if (!audio || audio.codec_name !== 'flac' || Number(audio.sample_rate) !== 44100 || Number(audio.bits_per_raw_sample) !== 16 || !Number.isFinite(duration) || !Number.isFinite(expectedDuration) || expectedDuration <= 0 || Math.abs(duration - expectedDuration) > Math.max(3, expectedDuration * 0.02)) throw new QobuzError('invalid audio or duration');
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-xerror', '-i', partialPath, '-map', '0:a:0', '-f', 'null', '-'], { signal, maxBuffer: 128 * 1024 });
    return { bytes, duration, suffix: 'flac', samplingRate: 44100, bitDepth: 16, channelCount: Number(audio.channels) };
  } catch (error) {
    if (created) await unlink(partialPath).catch(() => {});
    if (error instanceof QobuzError) throw error;
    throw new QobuzError(signal.aborted ? 'download cancelled or timed out' : 'audio validation failed');
  }
}

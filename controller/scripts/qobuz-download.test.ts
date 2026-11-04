import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { downloadQobuzAudio } from '../src/music/qobuz/download.js';
const dir = await mkdtemp(join(tmpdir(), 'qobuz-download-'));
const fixture = join(dir, 'fixture.flac');
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '35', '-c:a', 'flac', '-sample_fmt', 's16', fixture]);
const bytes = await readFile(fixture);
const response = (data: Buffer) => ({ status: 200, headers: {}, body: (async function* () { yield data; })() });
test('complete FLAC is validated before becoming playable', async () => {
  const result = await downloadQobuzAudio('https://media.example/file?secret=hidden', join(dir, 'ok.part'), 35, undefined, { transport: async () => response(bytes) });
  assert.equal(result.suffix, 'flac');
  assert.equal(result.samplingRate, 44100);
  assert.equal(result.bitDepth, 16);
  assert.equal(result.duration, 35);
});
test('invalid audio and byte-cap failure remove their partial files', async () => {
  for (const [name, data, options] of [['bad', Buffer.from('not audio'), {}], ['cap', bytes, { maxBytes: 10 }]] as const) {
    const file = join(dir, `${name}.part`);
    await assert.rejects(downloadQobuzAudio('https://media.example/file?secret=hidden', file, 35, undefined, { ...options, transport: async () => response(data) }), error => { assert.equal(String(error).includes('hidden'), false); return true; });
    await assert.rejects(access(file));
  }
});
test('duration mismatch and cancellation cannot publish audio', async () => {
  await assert.rejects(downloadQobuzAudio('https://media.example/file', join(dir, 'duration.part'), 200, undefined, { transport: async () => response(bytes) }), /audio|duration/i);
  await assert.rejects(downloadQobuzAudio('https://media.example/file', join(dir, 'cancel.part'), 35, AbortSignal.abort(), { transport: async () => response(bytes) }));
});
test.after(async () => { await rm(dir, { recursive: true, force: true }); });

// Pins controller/src/audio/voice-library.ts — the single owner of the shared
// voice-clone folder (state/voices/ + the legacy state/chatterbox-voices/).
//
// Three properties are load-bearing and easy to regress:
//
//  - `resolve()` NEVER builds a path from caller input. It basenames, then
//    looks the name up in the real scan. Both the delete and the audition
//    route pass an operator-supplied :file straight into it, so a traversal
//    here is a filesystem read primitive behind the admin gate.
//  - Canonical dir wins over legacy on a filename clash, and a clash is a
//    refused import — silently clobbering a voice would swap it out from
//    under every persona pointing at that filename.
//  - The duration memo invalidates on size AND mtime. A stale duration on a
//    replaced file would show the wrong advisory forever.
//
// STATE_DIR is redirected at a throwaway dir BEFORE the first import so
// config.ts derives its voice dirs there — hence the dynamic import. Same
// style as scripts/voice-policy.test.ts.

import assert from 'node:assert/strict';
import {
  chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'subwave-voicelib-'));
process.env.STATE_DIR = root;
// These would move the canonical dir out from under the test.
delete process.env.TTS_VOICE_DIR;
delete process.env.CHATTERBOX_VOICE_DIR;
// chatterbox.ts starts a 30s /health probe loop at module load when this is
// set — that would hold the test process open forever.
delete process.env.TTS_HEAVY_URL;

const VOICES = join(root, 'voices');
const LEGACY = join(root, 'chatterbox-voices');
mkdirSync(VOICES, { recursive: true });
mkdirSync(LEGACY, { recursive: true });

const lib = await import('../src/audio/voice-library.js');

const fakeBin = join(root, 'bin');
const fakeFfmpeg = join(fakeBin, 'ffmpeg');
const ffmpegReady = join(root, 'ffmpeg-ready');
const ffmpegRelease = join(root, 'ffmpeg-release');
mkdirSync(fakeBin, { recursive: true });
writeFileSync(fakeFfmpeg, `#!/bin/sh
if [ "$1" = "-version" ]; then exit 0; fi
take_input=0
for arg do
  if [ "$take_input" = "1" ]; then input_path="$arg"; take_input=0; fi
  if [ "$arg" = "-i" ]; then take_input=1; fi
  output_path="$arg"
done
printf partial > "$output_path"
: > "$VOICE_FFMPEG_READY"
if [ -n "$VOICE_FFMPEG_READY_DIR" ]; then : > "$VOICE_FFMPEG_READY_DIR/$$"; fi
while [ ! -e "$VOICE_FFMPEG_RELEASE" ]; do sleep 0.01; done
if [ "$VOICE_FFMPEG_FAIL" = "1" ]; then
  echo "simulated transcode failure" >&2
  exit 7
fi
cp "$input_path" "$output_path"
`);
chmodSync(fakeFfmpeg, 0o755);
process.env.PATH = `${fakeBin}:${process.env.PATH || ''}`;
process.env.VOICE_FFMPEG_READY = ffmpegReady;
process.env.VOICE_FFMPEG_RELEASE = ffmpegRelease;

async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!existsSync(file)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${file}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function waitForReadyCount(dir: string, count: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!existsSync(dir) || readdirSync(dir).length < count) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${count} ffmpeg process(es)`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

let failures = 0;
function check(label: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ok  ${label}`))
    .catch((err) => { failures++; console.error(`  FAIL ${label}: ${err.message}`); });
}

// --- voiceWarning: the advisory band, pure ---------------------------------
await check('voiceWarning flags a clip under the floor', () => {
  assert.equal(lib.voiceWarning(2), 'short');
  assert.equal(lib.voiceWarning(lib.ADVISORY_MIN_SEC - 0.1), 'short');
});
await check('voiceWarning flags a clip over the ceiling', () => {
  assert.equal(lib.voiceWarning(45), 'long');
  assert.equal(lib.voiceWarning(lib.ADVISORY_MAX_SEC + 0.1), 'long');
});
await check('voiceWarning is silent inside the band and at its edges', () => {
  assert.equal(lib.voiceWarning(10), null);
  assert.equal(lib.voiceWarning(lib.ADVISORY_MIN_SEC), null);
  assert.equal(lib.voiceWarning(lib.ADVISORY_MAX_SEC), null);
});
await check('voiceWarning treats an unknown duration as no advice, not as bad', () => {
  // No ffprobe on a bare-host dev box — unknown must not render a warning.
  assert.equal(lib.voiceWarning(null), null);
  assert.equal(lib.voiceWarning(undefined), null);
  assert.equal(lib.voiceWarning(NaN), null);
});

// --- voiceFileName: slug + forced .wav -------------------------------------
await check('voiceFileName slugifies and forces .wav', () => {
  assert.equal(lib.voiceFileName('Morgan Freeman'), 'morgan-freeman.wav');
  assert.equal(lib.voiceFileName('  Late Night DJ  '), 'late-night-dj.wav');
});
await check('voiceFileName strips an audio extension the operator typed', () => {
  // The import modal defaults the name from the filename stem, but an operator
  // typing "morgan.wav" must not get "morgan-wav.wav".
  assert.equal(lib.voiceFileName('morgan.wav'), 'morgan.wav');
  assert.equal(lib.voiceFileName('Morgan.MP3'), 'morgan.wav');
});
await check('voiceFileName rejects a name with no slug left', () => {
  assert.throws(() => lib.voiceFileName('   '), /name is required/i);
  assert.throws(() => lib.voiceFileName('!!!'), /name is required/i);
});

// --- scan: merge, dedupe, filter, sort -------------------------------------
writeFileSync(join(VOICES, 'alpha.wav'), 'a');
writeFileSync(join(VOICES, 'shared.wav'), 'canonical');
writeFileSync(join(LEGACY, 'shared.wav'), 'legacy-loses');
writeFileSync(join(LEGACY, 'zulu.wav'), 'z');
writeFileSync(join(VOICES, 'notes.txt'), 'not audio');

await check('scan lists .wav from both dirs, sorted, non-wav excluded', async () => {
  const files = (await lib.scan()).map(e => e.file);
  assert.deepEqual(files, ['alpha.wav', 'shared.wav', 'zulu.wav']);
});
await check('scan dedupes a clash with the canonical dir winning', async () => {
  const shared = (await lib.scan()).find(e => e.file === 'shared.wav');
  assert.equal(shared?.legacy, false);
  assert.equal(shared?.dir, VOICES);
});
await check('scan flags a legacy-only file as legacy', async () => {
  const zulu = (await lib.scan()).find(e => e.file === 'zulu.wav');
  assert.equal(zulu?.legacy, true);
  assert.equal(zulu?.path, join(LEGACY, 'zulu.wav'));
});

// --- resolve: the traversal gate -------------------------------------------
await check('resolve returns the entry for a listed file', async () => {
  const e = await lib.resolve('alpha.wav');
  assert.equal(e?.path, join(VOICES, 'alpha.wav'));
});
await check('resolve refuses traversal and absolute paths', async () => {
  for (const bad of ['../alpha.wav', '../../etc/passwd', '/etc/passwd', 'sub/alpha.wav', '..']) {
    assert.equal(await lib.resolve(bad), null, `resolve(${bad}) must be null`);
  }
});
await check('resolve refuses an unlisted or non-wav name', async () => {
  assert.equal(await lib.resolve('nope.wav'), null);
  assert.equal(await lib.resolve('notes.txt'), null);
  assert.equal(await lib.resolve(''), null);
});

// --- duration memo key: invalidates on size AND mtime ----------------------
await check('durationMemoKey changes when size or mtime changes', () => {
  const base = { file: 'a.wav', dir: VOICES, path: join(VOICES, 'a.wav'), legacy: false, size: 10, mtimeMs: 100 };
  const same = lib.durationMemoKey({ ...base });
  assert.equal(lib.durationMemoKey(base), same, 'identical entry must reuse the memo');
  assert.notEqual(lib.durationMemoKey({ ...base, size: 11 }), same, 'a resized file must re-probe');
  assert.notEqual(lib.durationMemoKey({ ...base, mtimeMs: 101 }), same, 'a rewritten file must re-probe');
});

// --- importVoice: the guards that run before any ffmpeg work ---------------
await check('importVoice refuses a name that already exists in either dir', async () => {
  await assert.rejects(
    lib.importVoice(Buffer.from('x'), { name: 'alpha', originalName: 'alpha.wav' }),
    /already exists/i,
  );
  // zulu.wav lives only in the legacy dir — still a clash.
  await assert.rejects(
    lib.importVoice(Buffer.from('x'), { name: 'zulu', originalName: 'zulu.wav' }),
    /already exists/i,
  );
});
await check('importVoice refuses a non-audio upload', async () => {
  await assert.rejects(
    lib.importVoice(Buffer.from('x'), { name: 'notes', originalName: 'notes.txt' }),
    /unsupported audio type/i,
  );
});
await check('importVoice refuses an empty buffer', async () => {
  await assert.rejects(
    lib.importVoice(Buffer.alloc(0), { name: 'empty', originalName: 'empty.wav' }),
    /empty/i,
  );
});
await check('importVoice removes a failed transcode without publishing a partial voice', async () => {
  process.env.VOICE_FFMPEG_FAIL = '1';
  writeFileSync(ffmpegRelease, 'go');
  await assert.rejects(
    lib.importVoice(Buffer.from('not-real-audio'), { name: 'broken', originalName: 'broken.mp3' }),
    /ffmpeg failed/i,
  );
  assert.equal(await lib.resolve('broken.wav'), null, 'failed import must not become a selectable voice');
  assert.equal(existsSync(join(VOICES, 'broken.wav')), false, 'failed import must not leave the canonical file');
  assert.deepEqual(
    readdirSync(VOICES).filter(file => file.includes('broken.wav')),
    [],
    'failed import must remove its temporary sibling',
  );
});
await check('importVoice publishes the canonical filename only after transcode succeeds', async () => {
  process.env.VOICE_FFMPEG_FAIL = '0';
  if (existsSync(ffmpegReady)) unlinkSync(ffmpegReady);
  if (existsSync(ffmpegRelease)) unlinkSync(ffmpegRelease);

  const pending = lib.importVoice(
    Buffer.from('not-real-audio'),
    { name: 'atomic', originalName: 'atomic.mp3' },
  );
  await waitForFile(ffmpegReady);
  const visibleDuringTranscode = await lib.resolve('atomic.wav');
  const catalogDuringTranscode = (await lib.scan()).map(entry => entry.file);
  writeFileSync(ffmpegRelease, 'go');
  const imported = await pending;

  assert.equal(visibleDuringTranscode, null, 'canonical voice must stay hidden until promotion');
  assert.ok(!catalogDuringTranscode.some(file => file.includes('atomic')), 'temporary voice must stay out of the catalog');
  assert.equal(imported.file, 'atomic.wav');
  assert.equal(existsSync(join(VOICES, 'atomic.wav')), true);
  assert.deepEqual(
    readdirSync(VOICES).filter(file => file.startsWith('.atomic.wav.')),
    [],
    'successful import must leave no temporary sibling',
  );
});
await check('concurrent same-name imports publish exactly one winner without replacement', async () => {
  const readyDir = join(root, 'ffmpeg-concurrent-ready');
  mkdirSync(readyDir);
  process.env.VOICE_FFMPEG_READY_DIR = readyDir;
  if (existsSync(ffmpegRelease)) unlinkSync(ffmpegRelease);

  const firstBytes = 'first concurrent voice';
  const secondBytes = 'second concurrent voice';
  const attempts = [
    lib.importVoice(Buffer.from(firstBytes), { name: 'concurrent', originalName: 'first.mp3' })
      .then(entry => ({ entry, source: firstBytes })),
    lib.importVoice(Buffer.from(secondBytes), { name: 'concurrent', originalName: 'second.mp3' })
      .then(entry => ({ entry, source: secondBytes })),
  ];
  await waitForReadyCount(readyDir, 2);
  writeFileSync(ffmpegRelease, 'go');
  const results = await Promise.allSettled(attempts);

  const fulfilled = results.filter(result => result.status === 'fulfilled');
  const rejected = results.filter(result => result.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one import must claim the canonical filename');
  assert.equal(rejected.length, 1, 'the losing import must reject as a duplicate');
  const winner = fulfilled[0] as PromiseFulfilledResult<{ entry: { file: string }; source: string }>;
  const loser = rejected[0] as PromiseRejectedResult;
  assert.equal(winner.value.entry.file, 'concurrent.wav');
  assert.equal(loser.reason.code, 'EEXIST');
  assert.equal(
    loser.reason.message,
    'a voice named "concurrent.wav" already exists — delete it first',
  );
  assert.equal(
    readFileSync(join(VOICES, 'concurrent.wav'), 'utf8'),
    winner.value.source,
    'the canonical file must contain the successful importer\'s bytes',
  );
  assert.deepEqual(
    readdirSync(VOICES).filter(file => file.startsWith('.concurrent.wav.')),
    [],
    'the race must leave no hidden temporary siblings',
  );
  delete process.env.VOICE_FFMPEG_READY_DIR;
});
await check('promotion failure preserves the existing voice and removes the temporary sibling', async () => {
  const readyDir = join(root, 'ffmpeg-promotion-failure-ready');
  mkdirSync(readyDir);
  process.env.VOICE_FFMPEG_READY_DIR = readyDir;
  if (existsSync(ffmpegRelease)) unlinkSync(ffmpegRelease);

  const pending = lib.importVoice(
    Buffer.from('must not replace canonical'),
    { name: 'promotion-failure', originalName: 'promotion-failure.mp3' },
  );
  await waitForReadyCount(readyDir, 1);
  writeFileSync(join(VOICES, 'promotion-failure.wav'), 'existing canonical voice');
  writeFileSync(ffmpegRelease, 'go');

  await assert.rejects(
    pending,
    (error: NodeJS.ErrnoException) => error.code === 'EEXIST'
      && error.message === 'a voice named "promotion-failure.wav" already exists — delete it first',
  );
  assert.equal(
    readFileSync(join(VOICES, 'promotion-failure.wav'), 'utf8'),
    'existing canonical voice',
  );
  assert.deepEqual(
    readdirSync(VOICES).filter(file => file.startsWith('.promotion-failure.wav.')),
    [],
    'failed promotion must remove its temporary sibling',
  );
  delete process.env.VOICE_FFMPEG_READY_DIR;
});

// --- removeVoice -----------------------------------------------------------
await check('removeVoice deletes a legacy-dir file too', async () => {
  await lib.removeVoice('zulu.wav');
  assert.equal(await lib.resolve('zulu.wav'), null);
});
await check('removeVoice refuses an unknown name', async () => {
  await assert.rejects(lib.removeVoice('ghost.wav'), /unknown voice/i);
});

// --- chatterbox.listReferenceVoices delegates to the one scanner -----------
// Signature is load-bearing: routes/settings/core.ts publishes the result as
// both tts.chatterboxVoices and tts.pocketTtsCustomVoices on every 3s poll.
const chatterbox = await import('../src/audio/chatterbox.js');

await check('listReferenceVoices returns the same filenames scan() found', async () => {
  const scanned = (await lib.scan()).map(e => e.file);
  const listed = await chatterbox.listReferenceVoices();
  assert.deepEqual(listed, scanned);
});
await check('listReferenceVoices returns a plain string[] of .wav names', async () => {
  const listed = await chatterbox.listReferenceVoices();
  assert.ok(Array.isArray(listed));
  for (const v of listed) {
    assert.equal(typeof v, 'string', 'must be filenames, not objects');
    assert.match(v, /\.wav$/i);
  }
});
await check('a newly imported voice shows up without a restart', async () => {
  // No ffmpeg needed: a .wav upload is stored through untouched.
  writeFileSync(join(VOICES, 'seed-check.wav'), 'seed');
  assert.ok((await chatterbox.listReferenceVoices()).includes('seed-check.wav'));
});
await check('listReferenceVoices never offers a directory named *.wav', async () => {
  // The discriminating case for the delegation: the pre-refactor scanner
  // filtered on the extension alone and would hand a DIRECTORY to the picker,
  // where selecting it fails at render time with a confusing worker error.
  // scan() stats every entry, so only real files survive.
  mkdirSync(join(VOICES, 'bogus.wav'), { recursive: true });
  assert.ok(!(await chatterbox.listReferenceVoices()).includes('bogus.wav'));
  assert.ok(!(await lib.scan()).some(e => e.file === 'bogus.wav'));
});

rmSync(root, { recursive: true, force: true });
if (failures) {
  console.error(`\nvoice-library: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nvoice-library: all checks passed');

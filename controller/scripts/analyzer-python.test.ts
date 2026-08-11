// Shim that folds the lightweight Python suites into `npm test`'s *.test.ts
// auto-discovery, so they actually run with the rest of the suite instead of
// only when someone remembers `python3 scripts/<file>.py`. They deliberately
// avoid torch / demucs / librosa / real audio; vocal_gate_test.py needs NumPy,
// which the controller-quality CI job provisions in an isolated venv. A box
// without python3 skips cleanly (exit 0) rather than failing the suite.

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  'idle_release_test.py', // idle model release + heavy clock (#1099/#1204)
  'vocal_gate_test.py', // vocal-stem gate thresholds (#1125)
  'test_chatterbox_chunk.py', // chatterbox chunk_text (#1130)
  'test_tts_heavy_strict_device.py', // Ark CUDA worker startup + supervised restart
  'analyzer_noise_test.py', // decode-noise filter + capability loss (#1300)
];

const probe = spawnSync('python3', ['--version'], { stdio: 'ignore' });
if (probe.error || probe.status !== 0) {
  console.log('skipped: python3 not on PATH');
  process.exit(0);
}

const failed: string[] = [];
for (const file of SUITES) {
  console.log(`— ${file}`);
  const { status } = spawnSync('python3', [join(scriptsDir, file)], { stdio: 'inherit' });
  if (status !== 0) failed.push(file);
}

if (failed.length > 0) {
  console.error(`✗ python suite(s) failed: ${failed.join(', ')}`);
  process.exit(1);
}
console.log('✓ analyzer-python.test.ts passed');

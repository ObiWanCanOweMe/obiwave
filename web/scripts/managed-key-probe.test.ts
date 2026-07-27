import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const probeModule = await import('../lib/managedKeyProbe.ts').catch(() => null);
assert.ok(probeModule, 'managed key probe helper must exist');

let resolveTest!: (value: { ok: boolean; message: string; latencyMs: number }) => void;
const pendingTest = new Promise<{ ok: boolean; message: string; latencyMs: number }>(resolve => {
  resolveTest = resolve;
});
const generation = new probeModule.AsyncResultGeneration();
let resultCount = 0;
let saveCount = 0;
let clearCount = 0;
let finishCount = 0;

const staleProbe = probeModule.runManagedKeyProbe({
  generation,
  test: () => pendingTest,
  save: async () => {
    saveCount++;
    return true;
  },
  onStart: () => {},
  onResult: () => { resultCount++; },
  onSaved: () => { clearCount++; },
  onError: () => {},
  onFinish: () => { finishCount++; },
});

generation.invalidate();
resolveTest({ ok: true, message: 'old provider accepted the key', latencyMs: 4 });
await staleProbe;

assert.equal(resultCount, 0, 'stale provider verdict must not replace current UI state');
assert.equal(saveCount, 0, 'stale provider success must not persist its old key');
assert.equal(clearCount, 0, 'stale provider success must not clear replacement typing');
assert.equal(finishCount, 0, 'stale completion must not stop the current request spinner');

const [llmSource, ttsSource] = await Promise.all([
  readFile(new URL('../components/admin/settings/LlmSection.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/admin/settings/TtsSection.tsx', import.meta.url), 'utf8'),
]);
assert.match(llmSource, /primaryManagedKeyGeneration/);
assert.match(llmSource, /fallbackManagedKeyGeneration/);
assert.match(llmSource, /runManagedKeyProbe\(\{/);
assert.match(ttsSource, /cloudKeyGeneration/);
assert.match(ttsSource, /runManagedKeyProbe\(\{/);

console.log('✓ managed key probes suppress stale provider successes');

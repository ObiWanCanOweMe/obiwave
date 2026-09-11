// Exercise the real registered cron callback. A capability readiness probe stops
// before model generation and observes the policy scope delivered to the skill.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import cron from 'node-cron';

const root = mkdtempSync(join(tmpdir(), 'skill-cron-talk-scope-'));
process.env.STATE_DIR = root;
const settings = await import('../src/settings.js');
const { loadedCapabilities } = await import('../src/skills/loader.js');
const { runCapability } = await import('../src/skills/_agent.js');
const { syncSkillCrons } = await import('../src/broadcast/scheduler.js');
const { currentTalkAir, inTalkAirScope, suppressScheduledSpeechDuringHandoff } =
  await import('../src/broadcast/talk-air.js');

test('a skill cron carries automatic speech provenance while manual skill runs remain exempt', async () => {
  await settings.load();
  const seen: { automatic: boolean; air: string; suppressed: boolean }[] = [];
  const capabilities = loadedCapabilities();
  const previousCapabilities = capabilities.slice();
  const originalFetch = globalThis.fetch;
  // Weather is external to this contract; the cron still constructs real context.
  globalThis.fetch = async () => new Response(JSON.stringify({
    current: { weather_code: 0, temperature_2m: 20, is_day: 1 },
  }));
  capabilities.splice(0, capabilities.length, {
    kind: 'weather', skill: 'weather', seeded: true, cronExpression: '0 0 1 1 *',
    ready: () => {
      seen.push({
        automatic: inTalkAirScope(),
        air: currentTalkAir(),
        suppressed: suppressScheduledSpeechDuringHandoff('weather', true),
      });
      return false; // stop before any model or speech engine is called
    },
  });
  try {
    await assert.rejects(runCapability('weather', {}), /not ready/);
    assert.deepEqual(seen.shift(), { automatic: false, air: 'immediate', suppressed: false });
    syncSkillCrons();
    const tasks = [...cron.getTasks().values()];
    assert.equal(tasks.length, 1);
    await tasks[0].execute();
    assert.deepEqual(seen, [{ automatic: true, air: 'immediate', suppressed: true }],
      'the timer must keep automatic provenance, including when its placement is immediate');
  } finally {
    for (const task of cron.getTasks().values()) task.destroy();
    capabilities.splice(0, capabilities.length, ...previousCapabilities);
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

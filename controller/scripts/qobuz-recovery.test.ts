import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queue } from '../src/broadcast/queue.js';
import { duplicateAction, conversionAction } from '../src/stations/pure.js';
const ref = { provider: 'qobuz' as const, trackId: '123', accountKey: 'a'.repeat(64), generation: '11111111-1111-4111-8111-111111111111' };
test('all live queue references survive cleanup, including sent handoffs and recent crossfades', () => {
  queue.upcoming = [{ track: { id: 'qobuz:123', providerRef: ref }, sent: true }];
  queue.current = { track: { id: 'qobuz:123', providerRef: { ...ref, generation: 'current' } } };
  queue.history = [{ track: { id: 'qobuz:123', providerRef: { ...ref, generation: 'recent' } }, endedAt: new Date().toISOString() }, { track: { id: 'qobuz:123', providerRef: { ...ref, generation: 'old' } }, endedAt: new Date(Date.now()-600000).toISOString() }];
  assert.deepEqual(queue.qobuzReferences().map(r => r.generation), [ref.generation, 'current', 'recent']);
  queue.upcoming = []; queue.current = null; queue.history = [];
  assert.equal(duplicateAction('qobuz-cache'), 'skip'); assert.equal(conversionAction('qobuz-cache'), 'move');
});

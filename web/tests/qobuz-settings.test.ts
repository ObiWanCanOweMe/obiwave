import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settingsForm } from '../components/admin/settings/form-state';
import { qobuzSavePayload } from '../components/admin/settings/save-payload';
import { sectionById } from '../components/admin/settings/registry';
test('Qobuz hydration and save payload keep credentials out of ordinary settings', () => {
  const defaults = settingsForm({}); assert.deepEqual(defaults.qobuz, { enabled: false, cacheMaxGb: '5' });
  const form = settingsForm({ qobuz: { enabled: true, cacheMaxGb: 2 } });
  assert.deepEqual(qobuzSavePayload(form), { patch: { qobuz: { enabled: true, cacheMaxGb: 2 } }, fieldErrors: {} });
  form.qobuz.cacheMaxGb = ''; assert.ok(qobuzSavePayload(form).fieldErrors['qobuz.cacheMaxGb']);
  assert.ok((sectionById('station')?.formKeys as readonly string[]).includes('qobuz'));
});

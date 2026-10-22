// Retired built-in IDs must keep their palette on reads and settings saves.
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveThemeProvenance } from '../src/util/theme-provenance.js';
import { prepareUpdate, get } from '../src/settings.js';

const themeIds = new Set(['classic-light', 'phosphor', 'riso']);

for (const [legacy, replacement] of [['signal', 'phosphor'], ['flare', 'riso']]) {
  test(`${legacy} resolves to ${replacement} for an installed station and show`, async () => {
    const station = resolveThemeProvenance({ stationDefault: legacy, themeIds });
    assert.equal(station.active, replacement);
    const show = resolveThemeProvenance({
      stationDefault: 'classic-light', themeIds,
      activeShow: { id: 'show', name: 'Legacy show', themeId: legacy },
    });
    assert.equal(show.active, replacement);
    assert.equal(show.activeSource, 'show');
    assert.equal(show.activeShow?.themeId, replacement);
    const prepared = await prepareUpdate({ theme: { active: legacy } }, { themeIds });
    assert.equal(prepared.saved.theme.active, replacement);
    const savedShow = await prepareUpdate({ shows: [{
      id: 'legacy-show', name: 'Legacy show', personaId: get().personas[0].id,
      themeId: legacy,
    }] }, { themeIds });
    assert.equal(savedShow.saved.shows[0].themeId, replacement);
  });

  test(`a custom theme with exact ID ${legacy} outranks the retired alias`, async () => {
    const customIds = new Set([...themeIds, legacy]);
    const show = resolveThemeProvenance({
      stationDefault: legacy, themeIds: customIds,
      activeShow: { id: 'show', name: 'Custom show', themeId: legacy },
    });
    assert.equal(show.active, legacy);
    assert.equal(show.activeShow?.themeId, legacy);
    const prepared = await prepareUpdate({ theme: { active: legacy } }, { themeIds: customIds });
    assert.equal(prepared.saved.theme.active, legacy);
    const savedShow = await prepareUpdate({ shows: [{
      id: 'custom-show', name: 'Custom show', personaId: get().personas[0].id,
      themeId: legacy,
    }] }, { themeIds: customIds });
    assert.equal(savedShow.saved.shows[0].themeId, legacy);
  });
}


test('an alias without an installed replacement remains an unknown theme', async () => {
  const known = new Set(['classic-light']);
  const show = resolveThemeProvenance({
    stationDefault: 'classic-light', themeIds: known,
    activeShow: { id: 'show', name: 'Removed', themeId: 'signal' },
  });
  assert.equal(show.activeSource, 'station');
  assert.equal(show.activeShow, null);
  const prepared = await prepareUpdate({ theme: { active: 'signal' } }, { themeIds: known });
  assert.equal(prepared.saved.theme.active, 'classic-light');
});

test('the live built-in registry resolves both retired station selections', async () => {
  for (const [legacy, replacement] of [['signal', 'phosphor'], ['flare', 'riso']]) {
    const prepared = await prepareUpdate({ theme: { active: legacy } });
    assert.equal(prepared.saved.theme.active, replacement);
  }
});

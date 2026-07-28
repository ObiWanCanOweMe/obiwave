import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.STATE_DIR = mkdtempSync(join(tmpdir(), 'subwave-search-provider-settings-'));
delete process.env.SEARCH_API_KEY;
delete process.env.KAGI_API_KEY;

writeFileSync(join(process.env.STATE_DIR, 'settings.json'), JSON.stringify({
  search: { provider: 'brave', apiKey: 'legacy-brave' },
}));

const settings = await import('../src/settings.js');

assert.deepEqual(settings.normalizeSearchApiKeys({
  provider: 'tavily',
  apiKey: 'legacy-tavily',
}), { tavily: 'legacy-tavily', brave: '', kagi: '' });
assert.deepEqual(settings.normalizeSearchApiKeys({
  provider: 'duckduckgo',
  apiKey: 'owner-unknown',
}), { tavily: '', brave: '', kagi: '' });
assert.deepEqual(settings.normalizeSearchApiKeys({
  provider: 'brave',
  apiKey: 'legacy',
  apiKeys: { brave: 'mapped-wins', kagi: 'kagi-saved' },
}), { tavily: '', brave: 'mapped-wins', kagi: 'kagi-saved' });

await settings.load();
assert.equal(settings.get().search.apiKeys.brave, 'legacy-brave');
assert.equal(settings.getRedacted().search.apiKeys.brave, 'set');
assert.equal(JSON.stringify(settings.getRedacted()).includes('legacy-brave'), false);

await settings.update({ search: { apiKeys: {
  tavily: 'tvly-saved',
  brave: 'brave-saved',
  kagi: 'kagi-saved',
} } });
assert.equal(settings.searchKeyFor('kagi', { KAGI_API_KEY: 'kagi-env' }), 'kagi-saved');
assert.equal(settings.searchKeyFor('brave', { SEARCH_API_KEY: 'shared-env' }), 'brave-saved');
assert.equal(settings.searchKeyFor('tavily', { SEARCH_API_KEY: 'shared-env' }), 'tvly-saved');

await settings.update({ search: { apiKeys: { kagi: null } } });
assert.equal(settings.searchKeyFor('kagi', { KAGI_API_KEY: 'kagi-env' }), 'kagi-env');
assert.equal(settings.get().search.apiKeys.brave, 'brave-saved');

await settings.update({ search: { apiKeys: { brave: 'set' } } });
assert.equal(settings.get().search.apiKeys.brave, 'brave-saved');
await settings.update({ search: { apiKeys: { brave: '   ' } } });
assert.equal(settings.get().search.apiKeys.brave, 'brave-saved');

const persisted = JSON.parse(readFileSync(join(process.env.STATE_DIR, 'settings.json'), 'utf8'));
assert.equal('apiKey' in persisted.search, false);
assert.equal(persisted.search.apiKeys.kagi, '');
assert.equal(settings.searchKeyFor('kagi', { SEARCH_API_KEY: 'wrong-provider' }), '');
assert.equal(settings.searchKeyFor('unknown', { SEARCH_API_KEY: 'wrong-provider' }), '');

await assert.rejects(
  settings.update({ search: { apiKeys: { alien: 'nope' } } } as never),
  /unknown search key provider: alien/,
);
await assert.rejects(
  settings.update({ search: { apiKeys: { kagi: 42 } } } as never),
  /search\.apiKeys\.kagi must be a string or null/,
);
await assert.rejects(
  settings.update({ search: { apiKeys: { kagi: 'x'.repeat(201) } } }),
  /search\.apiKeys\.kagi must be 0-200 chars/,
);

console.log('search-provider-settings.test.ts: provider keys stay isolated and migrate safely');

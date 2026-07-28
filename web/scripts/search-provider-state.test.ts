import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SEARCH_PROVIDER_META,
  reconcileSearchKeyDraftsAfterSave,
  searchKeyDirty,
  searchKeyInputValue,
  searchKeyPatch,
  searchKeySource,
} from '../components/admin/settings/search-provider-state.ts';

assert.equal(SEARCH_PROVIDER_META.kagi.label, 'Kagi (paid Search API)');
assert.equal(SEARCH_PROVIDER_META.kagi.envVar, 'KAGI_API_KEY');
assert.equal(SEARCH_PROVIDER_META.brave.envVar, 'SEARCH_API_KEY');
assert.equal(searchKeyInputValue('set'), '');
assert.equal(searchKeyInputValue(null), '');
assert.equal(searchKeyInputValue('new-key'), 'new-key');
assert.equal(searchKeyPatch('set'), undefined);
assert.equal(searchKeyPatch(''), undefined);
assert.equal(searchKeyPatch('  new-key  '), 'new-key');
assert.equal(searchKeyPatch(null), null);
assert.equal(searchKeyDirty('set', 'set'), false);
assert.equal(searchKeyDirty('new-key', 'set'), true);
assert.equal(searchKeyDirty(null, 'set'), true);
assert.equal(searchKeyDirty(null, ''), false);
assert.equal(searchKeySource('set', true), 'saved');
assert.equal(searchKeySource('', true), 'environment');
assert.equal(searchKeySource('', false), 'missing');
assert.deepEqual(
  reconcileSearchKeyDraftsAfterSave(
    { tavily: '', brave: 'set', kagi: 'replacement-key' },
    { kagi: 'replacement-key' },
  ),
  { tavily: '', brave: 'set', kagi: 'set' },
);
assert.deepEqual(
  reconcileSearchKeyDraftsAfterSave(
    { tavily: '', brave: 'set', kagi: null },
    { kagi: null },
  ),
  { tavily: '', brave: 'set', kagi: null },
);
assert.deepEqual(
  reconcileSearchKeyDraftsAfterSave(
    { tavily: '', brave: 'set', kagi: 'unchanged' },
    { tavily: '', brave: 'set' },
  ),
  { tavily: '', brave: 'set', kagi: 'unchanged' },
);

const here = dirname(fileURLToPath(import.meta.url));
const section = readFileSync(
  resolve(here, '../components/admin/settings/SearchSection.tsx'),
  'utf8',
);
assert.match(
  section,
  /onValueChange=.*setKeyTest\(null\).*setSearxngTestResult\(null\)/s,
  'provider switch clears every stale test verdict',
);
assert.match(
  section,
  /key:\s*keyed\.envVar[\s\S]*provider/,
  'key probe uses the active provider environment variable and id',
);

console.log('✓ search provider state stays provider-scoped');

import assert from 'node:assert/strict';
import { webSearchNotReadyFinding } from '../src/doctor/checks-station.js';

const searxng = webSearchNotReadyFinding('searxng');
assert.equal(searxng.detail, 'searxng selected but no base URL');
assert.equal(
  searxng.hint,
  'Artist-news segments can\'t fetch. Configure the SearXNG base URL in Settings → Search, or select DuckDuckGo (keyless).',
);
assert.equal(/API key|SEARCH_API_KEY/i.test(searxng.hint || ''), false);

for (const [provider, envVar] of [
  ['kagi', 'KAGI_API_KEY'],
  ['tavily', 'SEARCH_API_KEY'],
  ['brave', 'SEARCH_API_KEY'],
] as const) {
  const finding = webSearchNotReadyFinding(provider);
  assert.equal(finding.detail, `${provider} selected but no API key`);
  assert.match(finding.hint || '', new RegExp(`Add the ${provider} key \\(${envVar}\\)`));
}

console.log('doctor search guidance: SearXNG needs a base URL; keyed providers retain key guidance');

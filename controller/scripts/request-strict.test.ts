// Strict listener request matching. Run: `npm test -- request-strict`.

import assert from 'node:assert/strict';
import {
  strictFailureMessage,
  strictRequestTarget,
  pickStrictCandidate,
  strictRequestSatisfied,
} from '../src/routes/request-strict.js';

const strictModule: any = await import('../src/routes/request-strict.js');
const strictRequestPlan = strictModule.strictRequestPlan;

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failures++;
    console.error(`  ✗ ${name}\n      ${err?.message || err}`);
  }
}

const midnight = { id: '1', title: 'Midnight City', artist: 'M83' };
const intro = { id: '2', title: 'Intro', artist: 'M83' };
const cover = { id: '3', title: 'Midnight City', artist: 'The Midnight' };

console.log('strict request matching:');

test('title and artist request only accepts the exact library hit', () => {
  const target = strictRequestTarget({
    search_terms: ['Midnight City', 'M83'],
    artist: 'M83',
  });

  assert.deepEqual(target, { title: 'Midnight City', artist: 'M83', specific: true });
  assert.equal(pickStrictCandidate(target, [intro, cover, midnight]), midnight);
  assert.equal(strictRequestSatisfied(target, intro), false);
  assert.equal(strictRequestSatisfied(target, cover), false);
  assert.equal(strictRequestSatisfied(target, midnight), true);
});

test('artist-only request is strict about the artist but not the song title', () => {
  const target = strictRequestTarget({
    search_terms: ['M83'],
    artist: 'M83',
  });

  assert.deepEqual(target, { title: null, artist: 'M83', specific: true });
  assert.equal(pickStrictCandidate(target, [cover, intro]), intro);
  assert.equal(strictRequestSatisfied(target, cover), false);
  assert.equal(strictRequestSatisfied(target, intro), true);
});

test('vibe request is not treated as an exact request', () => {
  const target = strictRequestTarget({
    search_terms: [],
    artist: null,
    mood: 'rainy',
  });

  assert.deepEqual(target, { title: null, artist: null, specific: false });
  assert.equal(pickStrictCandidate(target, [midnight]), null);
  assert.equal(strictRequestSatisfied(target, midnight), true);
});

test('strict failure message names the missing requested track', () => {
  assert.equal(
    strictFailureMessage({ title: 'Midnight City', artist: 'M83', specific: true }),
    `Couldn't find "Midnight City" by M83 in the library.`,
  );
});

test('regression: title cleaning must not erase unrequested remix/live/cover/tribute/karaoke editions', () => {
  const target = { title: 'Midnight City', artist: 'M83', specific: true };
  for (const title of [
    'Midnight City (Tribute Remix)',
    'Midnight City - Remix',
    'Midnight City (Live)',
    'Midnight City [Cover]',
    'Midnight City (Karaoke Version)',
  ]) {
    assert.equal(
      strictRequestSatisfied(target, { title, artist: 'M83' }),
      false,
      `unrequested edition was accepted: ${title}`,
    );
  }
});

test('regression: arbitrary artist containment must not accept tribute bands', () => {
  const target = { title: 'Midnight City', artist: 'M83', specific: true };
  for (const artist of ['M83 Tribute Band', 'The M83 Experience', 'Sounds Like M83']) {
    assert.equal(
      strictRequestSatisfied(target, { title: 'Midnight City', artist }),
      false,
      `tribute/containment artist was accepted: ${artist}`,
    );
  }
});

test('legitimate feature and collaboration separators remain valid artist credits', () => {
  const target = { title: 'Midnight City', artist: 'M83', specific: true };
  for (const artist of [
    'M83 feat. Susanne Sundfør',
    'Susanne Sundfør & M83',
    'M83, Susanne Sundfør',
    'Susanne Sundfør x M83',
    'M83 with Susanne Sundfør',
  ]) {
    assert.equal(
      strictRequestSatisfied(target, { title: 'Midnight City', artist }),
      true,
      `collaboration credit was rejected: ${artist}`,
    );
  }
});

test('an explicitly requested edition still matches that exact edition', () => {
  const target = { title: 'Midnight City (Live)', artist: 'M83', specific: true };
  assert.equal(
    strictRequestSatisfied(target, { title: 'Midnight City [Live]', artist: 'M83' }),
    true,
  );
});

test('specific strict requests bypass the conversational agent', () => {
  assert.equal(typeof strictRequestPlan, 'function');
  assert.deepEqual(
    strictRequestPlan(true, {
      artist: 'M83',
      search_terms: ['Midnight City', 'M83'],
    }),
    {
      target: { title: 'Midnight City', artist: 'M83', specific: true },
      allowAgent: false,
    },
  );
});

test('vibe and non-strict requests may use the conversational agent', () => {
  assert.deepEqual(
    strictRequestPlan(true, { artist: null, search_terms: [], mood: 'rainy' }),
    {
      target: { title: null, artist: null, specific: false },
      allowAgent: true,
    },
  );
  assert.deepEqual(
    strictRequestPlan(false, {
      artist: 'M83',
      search_terms: ['Midnight City', 'M83'],
    }),
    { target: null, allowAgent: true },
  );
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log('\nall strict request tests passed');

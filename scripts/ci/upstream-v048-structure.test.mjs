import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const settings = read('controller/src/settings.ts');
const routes = read('controller/src/routes/settings.ts');
const tagger = read('controller/src/music/tag-library.ts');

assert.match(settings, /from ['"]\.\/settings\/store\.js['"]/);
assert.match(settings, /from ['"]\.\/settings\/validate\.js['"]/);
assert.ok(settings.split('\n').length < 2100, 'settings entry must remain split');
assert.match(routes, /from ['"]\.\/settings\/core\.js['"]/);
assert.ok(routes.split('\n').length < 80, 'settings route entry must remain a mount table');
assert.match(tagger, /from ['"]\.\/tag-library\/embed\.js['"]/);
assert.ok(tagger.split('\n').length < 900, 'tag-library entry must remain an orchestrator');

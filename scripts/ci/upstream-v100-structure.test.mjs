import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const settings = read('controller/src/settings.ts');
const routes = read('controller/src/routes/settings.ts');
const tagger = read('controller/src/music/tag-library.ts');

for (const module of ['store', 'normalize', 'validate', 'liquidsoap']) {
  assert.match(
    settings,
    new RegExp(`from ['"]\\./settings/${module}\\.js['"]`),
    `settings entry must import upstream split module ${module}.js`,
  );
}
assert.ok(
  // The fork's provider-owned credentials, search providers, and private-station
  // settings extend the upstream entry point while preserving its split modules.
  // v1.13 adds scheduled backups, ducking, handover, and picker policies.
  settings.split('\n').length <= 2600,
  'settings entry must not exceed 2,600 lines',
);

for (const module of ['core', 'llm', 'tts', 'station']) {
  assert.match(
    routes,
    new RegExp(`from ['"]\\./settings/${module}\\.js['"]`),
    `settings route entry must import upstream split module ${module}.js`,
  );
}
assert.ok(routes.split('\n').length < 80, 'settings route entry must remain a mount table');

for (const module of ['embed', 'enrich', 'flags', 'tag']) {
  assert.match(
    tagger,
    new RegExp(`from ['"]\\./tag-library/${module}\\.js['"]`),
    `tag-library entry must import upstream split module ${module}.js`,
  );
}
assert.ok(tagger.split('\n').length < 900, 'tag-library entry must remain an orchestrator');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const clients = readFileSync(
  new URL('../components/manual/Clients.tsx', import.meta.url),
  'utf8',
);

assert.doesNotMatch(
  clients,
  /authenticated URL/,
  'the manual must not imply that Basic credentials ride in API or artwork URLs',
);
assert.match(
  clients,
  /API polls, station-hosted artwork, and the audio\s+stream all receive an explicit/,
  'the manual must describe the station-scoped Basic header shared by API, station artwork, and streaming',
);
assert.match(
  clients,
  /<code className="bs-code-inline">Authorization<\/code> header/,
  'the manual must name the explicit HTTP header',
);
assert.match(
  clients,
  /A remote persona\s+avatar does not receive the station login/,
  'the manual must retain the boundary that protects third-party artwork',
);

console.log('✓ manual client authentication copy matches header-based station auth');

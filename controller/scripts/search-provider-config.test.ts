import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

for (const path of [
  'controller/src/config.ts',
  'controller/src/setup/secrets.ts',
  'cli/src/util.ts',
  '.env.example',
]) {
  assert.match(read(path), /KAGI_API_KEY/, `${path} declares KAGI_API_KEY`);
}

console.log('search-provider-config.test.ts: canonical secrets declare KAGI_API_KEY');

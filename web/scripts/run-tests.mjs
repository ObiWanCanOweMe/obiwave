// Run the same focused contracts developers invoke locally, retaining each
// contract's Node/tsx runner (some use native ESM, others mount React via tsx).
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const { scripts } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
for (const [name, command] of Object.entries(scripts)) {
  if (!name.startsWith('test:')) continue;
  // Aggregates merely invoke the focused scripts already discovered here.
  if (/\bnpm run test:/.test(command)) continue;
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', name], {
    cwd: root, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

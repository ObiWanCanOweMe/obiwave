import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { spawnControllerTsx } from '../src/util/tsx-child.js';

test('the production child command executes TypeScript without npm or npx', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'subwave-production-command-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const binDirectory = join(directory, 'bin');
  await mkdir(binDirectory);
  await symlink(process.execPath, join(binDirectory, 'node'));

  const script = join(directory, 'probe.ts');
  await writeFile(script, [
    "import { spawnSync } from 'node:child_process';",
    "for (const command of ['npm', 'npx']) {",
    "  const packageManager = spawnSync(command, ['--version']);",
    "  if ((packageManager.error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') process.exit(91);",
    '}',
    'const value: number = Number(process.argv[2]);',
    "process.stdout.write(String(value * 2));",
  ].join('\n'));

  const errors: Error[] = [];
  const child = spawnControllerTsx(
    [script, '21'],
    { env: { ...process.env, PATH: `${binDirectory}:/usr/bin:/bin` } },
    (error) => errors.push(error),
  );
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  const [code, signal] = await once(child, 'close');

  assert.deepEqual(errors, []);
  assert.equal(code, 0);
  assert.equal(signal, null);
  assert.equal(stdout, '42');
});

test('the production child command reports spawn errors without an unhandled error event', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'subwave-production-command-error-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  let spawnError: NodeJS.ErrnoException | null = null;
  const child = spawnControllerTsx(
    ['--version'],
    { cwd: join(directory, 'missing-working-directory') },
    (error) => { spawnError = error as NodeJS.ErrnoException; },
  );
  await new Promise<void>((resolve) => child.once('close', () => resolve()));

  assert.equal(spawnError?.code, 'ENOENT');
});

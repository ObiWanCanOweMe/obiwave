import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const controllerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const tsxBinary = resolve(controllerRoot, 'node_modules/.bin/tsx');

// Production images intentionally remove npm/npx. Resolve the installed tsx
// dependency from this module's controller root and require every caller to
// handle the asynchronous ChildProcess `error` event before it can go unhandled.
export function spawnControllerTsx(
  args: string[],
  options: SpawnOptionsWithoutStdio,
  onError: (error: Error) => void,
): ChildProcessWithoutNullStreams {
  const child = spawn(tsxBinary, args, {
    cwd: controllerRoot,
    ...options,
    shell: false,
  });
  child.once('error', onError);
  return child;
}

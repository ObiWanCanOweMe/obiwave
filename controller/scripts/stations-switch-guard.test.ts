// Regression for the station-switch lifecycle race.
// Run: npx tsx scripts/stations-switch-guard.test.ts

import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const routeSource = readFileSync(
  fileURLToPath(new URL('../src/routes/stations.ts', import.meta.url)),
  'utf8',
);

for (const [label, start, next] of [
  ['create/duplicate', "router.post('/stations'", "router.patch('/stations/:id'"],
  ['rename', "router.patch('/stations/:id'", "router.delete('/stations/:id'"],
  ['delete', "router.delete('/stations/:id'", "router.post('/stations/:id/activate'"],
  ['activate', "router.post('/stations/:id/activate'", ''],
] as const) {
  const from = routeSource.indexOf(start);
  const to = next ? routeSource.indexOf(next, from + start.length) : routeSource.length;
  assert.ok(from >= 0 && to > from, `${label} route must be present`);
  assert.match(
    routeSource.slice(from, to),
    /stationMutationGuard\.run\(/,
    `${label} route must acquire the shared station lifecycle guard`,
  );
}

const root = mkdtempSync(join(tmpdir(), 'subwave-station-switch-guard-'));
process.env.STATE_DIR = root;
process.env.ADMIN_USER = 'station-guard-admin';
process.env.ADMIN_PASS = 'station-guard-password';

const {
  StationMutationConflictError,
  createStationMutationGuard,
  stationMutationGuard,
} = await import('../src/stations/lifecycle.js');
const manager = await import('../src/stations/manager.js');

// An ordinary async mutation owns the lifecycle until it settles, preventing
// activation from exiting the process halfway through a duplicate/copy.
const ordinary = createStationMutationGuard();
let finishOrdinary!: () => void;
const ordinaryPending = ordinary.run(
  () => new Promise<void>((resolve) => { finishOrdinary = resolve; }),
);
assert.equal(ordinary.state(), 'mutating');
await assert.rejects(
  ordinary.run(async () => undefined),
  (err: unknown) => {
    assert.ok(err instanceof StationMutationConflictError);
    assert.equal(err.message, 'station mutation in progress');
    assert.equal(err.switching, false);
    return true;
  },
);
finishOrdinary();
await ordinaryPending;
assert.equal(ordinary.state(), 'idle');

// Ordinary failures also release the lease so a validation error cannot wedge
// station management until the controller restarts.
await assert.rejects(
  ordinary.run(async () => { throw new Error('ordinary failure'); }),
  /ordinary failure/,
);
assert.equal(ordinary.state(), 'idle');
await ordinary.run(async () => undefined);

// Successful legacy conversion has already moved the live root and pointer:
// retain the guard until process exit.
const convertedSuccess = createStationMutationGuard();
const convertedResult = await convertedSuccess.run(
  async () => ({ id: 'new-station', converted: true }),
  { switchOnResult: (result) => result.converted },
);
assert.equal(convertedResult.converted, true);
assert.equal(convertedSuccess.state(), 'switching');
await assert.rejects(
  convertedSuccess.run(async () => undefined),
  (err: unknown) => {
    assert.ok(err instanceof StationMutationConflictError);
    assert.equal(err.message, 'station switch in progress');
    assert.equal(err.switching, true);
    return true;
  },
);

// A post-conversion create failure carries converted:true. It must retain the
// same permanent guard even though the route sends an error response.
const convertedFailure = createStationMutationGuard();
const createError = new manager.StationCreateError('backup failed', true);
await assert.rejects(
  convertedFailure.run(
    async () => { throw createError; },
    {
      switchOnError: (err) =>
        err instanceof manager.StationCreateError && err.converted,
    },
  ),
  (err: unknown) => err === createError,
);
assert.equal(convertedFailure.state(), 'switching');
await assert.rejects(
  convertedFailure.run(async () => undefined),
  (err: unknown) => {
    assert.ok(err instanceof StationMutationConflictError);
    assert.equal(err.message, 'station switch in progress');
    assert.equal(err.switching, true);
    return true;
  },
);

// Route integration: once switching, fresh create, duplicate, rename, delete,
// and activation all reject before touching either the new pointer target or
// the old boot-bound settings/library handles.
mkdirSync(join(root, 'stations', 'alpha'), { recursive: true });
mkdirSync(join(root, 'stations', 'beta'), { recursive: true });
writeFileSync(join(root, 'stations', 'active.json'), '{"activeId":"alpha"}');
writeFileSync(
  join(root, 'stations', 'alpha', 'station.json'),
  '{"name":"Alpha","createdAt":"2026-01-01T00:00:00.000Z"}',
);
writeFileSync(
  join(root, 'stations', 'beta', 'station.json'),
  '{"name":"Beta","createdAt":"2026-01-01T00:00:00.000Z"}',
);

await stationMutationGuard.run(
  async () => ({ converted: true }),
  { switchOnResult: (result) => result.converted },
);

const { router } = await import('../src/routes/stations.js');
const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});

try {
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const authorization =
    `Basic ${Buffer.from('station-guard-admin:station-guard-password').toString('base64')}`;
  const cases = [
    ['fresh create', 'POST', '/stations', { name: 'Gamma', mode: 'fresh' }],
    ['duplicate', 'POST', '/stations', { name: 'Gamma Copy', mode: 'duplicate' }],
    ['rename', 'PATCH', '/stations/alpha', { name: 'Renamed' }],
    ['delete', 'DELETE', '/stations/beta', undefined],
    ['activate', 'POST', '/stations/beta/activate', undefined],
  ] as const;

  for (const [label, method, path, body] of cases) {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: {
        authorization,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, 409, `${label} must be blocked during switching`);
    assert.deepEqual(
      await response.json(),
      { error: 'station switch in progress', switching: true },
      `${label} must return the deterministic switching response`,
    );
  }
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => err ? reject(err) : resolve()));
  rmSync(root, { recursive: true, force: true });
}

console.log('stations-switch-guard.test: OK');

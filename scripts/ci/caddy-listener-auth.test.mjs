import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

const listenerAuthCases = [
  ['/api/listener-auth', 404],
  ['/api/listener-auth/', 404],
  ['/api/listener-auth/status', 404],
  ['/api/listener-auth%2Fstatus', 404],
  ['/api/listener-authentication', 200],
];

const caddyfiles = ['docker/Caddyfile', 'docker/aio/Caddyfile'];

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return address.port;
}

async function stopContainer(name) {
  await execFile('docker', ['rm', '--force', name]).catch(() => {});
}

async function waitForCaddy(port) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/listener-authentication`);
      if (response.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error('Caddy did not become ready');
}

async function hostPort(name) {
  const { stdout } = await execFile('docker', ['port', name, '80/tcp']);
  const port = stdout.trim().match(/:(\d+)$/)?.[1];
  assert.ok(port, `unable to determine mapped port from ${stdout}`);
  return Number(port);
}

function caddyfileForStub(caddyfile, stubPort) {
  return caddyfile
    .replaceAll('controller:7701', `host.docker.internal:${stubPort}`)
    .replaceAll('127.0.0.1:7701', `host.docker.internal:${stubPort}`);
}

for (const relativeCaddyfile of caddyfiles) {
  test(`${relativeCaddyfile} reserves the complete listener-auth namespace at the edge`, async (t) => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'subwave-caddy-listener-auth-'));
    const containerName = `subwave-caddy-listener-auth-${process.pid}-${Date.now()}`;
    const stub = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('stub-upstream-marker');
    });

    t.after(async () => {
      await stopContainer(containerName);
      await new Promise((resolve, reject) => stub.close((error) => (error ? reject(error) : resolve())));
      await rm(temporaryDirectory, { recursive: true, force: true });
    });

    const stubPort = await listen(stub);
    const source = await readFile(relativeCaddyfile, 'utf8');
    const testCaddyfile = path.join(temporaryDirectory, 'Caddyfile');
    await writeFile(testCaddyfile, caddyfileForStub(source, stubPort));

    await execFile('docker', [
      'run',
      '--detach',
      '--name',
      containerName,
      '--add-host',
      'host.docker.internal:host-gateway',
      '--publish',
      '127.0.0.1::80',
      '--volume',
      `${testCaddyfile}:/etc/caddy/Caddyfile:ro`,
      'caddy:2-alpine',
      'caddy',
      'run',
      '--config',
      '/etc/caddy/Caddyfile',
      '--adapter',
      'caddyfile',
    ]);

    const caddyPort = await hostPort(containerName);
    await waitForCaddy(caddyPort);

    for (const [pathname, expectedStatus] of listenerAuthCases) {
      const methods = expectedStatus === 404 ? ['GET', 'POST'] : ['GET'];
      for (const method of methods) {
        const response = await fetch(`http://127.0.0.1:${caddyPort}${pathname}`, { method });
        assert.equal(response.status, expectedStatus, `${method} ${pathname}`);
        if (expectedStatus === 200) {
          assert.equal(await response.text(), 'stub-upstream-marker', `${method} ${pathname}`);
        }
      }
    }
  });
}

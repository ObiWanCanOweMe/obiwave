import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const downloader = fileURLToPath(
  new URL('../../docker/download-pinned-asset.sh', import.meta.url),
);
const piperDockerfiles = await Promise.all(
  ['Dockerfile.controller', 'Dockerfile.aio'].map(async (name) => ({
    name,
    contents: await readFile(new URL(`../../docker/${name}`, import.meta.url), 'utf8'),
  })),
);

function runDownloader(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', [downloader, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('pinned downloader retries redirected CDN transport failures and verifies the bytes', async () => {
  const payload = Buffer.from('pinned release asset fixture\n');
  const digest = createHash('sha256').update(payload).digest('hex');
  const directory = await mkdtemp(join(tmpdir(), 'subwave-pinned-download-'));
  const output = join(directory, 'asset.tar.gz');
  let attempts = 0;
  const server = createServer((request, response) => {
    if (request.url === '/asset.tar.gz') {
      response.writeHead(302, { Location: '/release-cdn/asset.tar.gz' });
      response.end();
      return;
    }
    attempts += 1;
    if (attempts < 3) {
      response.socket.destroy();
      return;
    }
    response.writeHead(200, { 'Content-Length': payload.length });
    response.end(payload);
  });

  try {
    const port = await listen(server);
    const result = await runDownloader([
      `http://127.0.0.1:${port}/asset.tar.gz`,
      digest,
      output,
    ]);

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.signal, null);
    assert.equal(attempts, 3);
    assert.deepEqual(await readFile(output), payload);
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('pinned downloader rejects corrupt bytes without publishing the output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'subwave-pinned-download-'));
  const output = join(directory, 'asset.tar.gz');
  const server = createServer((_request, response) => response.end('wrong bytes'));

  try {
    const port = await listen(server);
    const result = await runDownloader([
      `http://127.0.0.1:${port}/asset.tar.gz`,
      '0'.repeat(64),
      output,
    ]);

    assert.notEqual(result.code, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /FAILED|did NOT match/);
    await assert.rejects(access(output));
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('controller and AIO Piper installs pin release, architecture, and checksums', () => {
  for (const { name, contents } of piperDockerfiles) {
    assert.match(contents, /ARG PIPER_VERSION=2023\.11\.14-2/, name);
    assert.match(
      contents,
      /amd64\|""\) piper_arch=x86_64; piper_sha256=a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992/,
      name,
    );
    assert.match(
      contents,
      /arm64\)\s+piper_arch=aarch64; piper_sha256=fea0fd2d87c54dbc7078d0f878289f404bd4d6eea6e7444a77835d1537ab88eb/,
      name,
    );
    assert.match(
      contents,
      /download-pinned-asset\.sh \\\n\s+"https:\/\/github\.com\/rhasspy\/piper\/releases\/download\/\$\{PIPER_VERSION\}\/piper_linux_\$\{piper_arch\}\.tar\.gz" \\\n\s+"\$\{piper_sha256\}"/,
      name,
    );
  }
});

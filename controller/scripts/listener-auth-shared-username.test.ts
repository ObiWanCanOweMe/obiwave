// The fork's shared renderer owns every mount's URL-auth block. Duplicate
// usernames are required for the station's shared password and iOS probes.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const docker = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docker');

test('all four mounts let listeners share a username under the stream password', () => {
  const dir = mkdtempSync(join(tmpdir(), 'subwave-shared-username-'));
  try {
    writeFileSync(join(dir, 'icecast_listener_auth.txt'), 'true');
    const rendered = join(dir, 'icecast.xml');
    execFileSync('bash', [join(docker, 'icecast-render.sh')], {
      env: { ...process.env, ICECAST_STATE_DIR: dir,
        ICECAST_TEMPLATE: join(docker, 'icecast.xml.template'), ICECAST_RENDERED: rendered,
        ICECAST_TRUSTED_PROXY_IPS: '127.0.0.1',
        ICECAST_SOURCE_PASSWORD: 'test-source', ICECAST_ADMIN_PASSWORD: 'test-admin',
        ICECAST_RELAY_PASSWORD: 'test-relay' }, stdio: 'pipe',
    });
    const xml = readFileSync(rendered, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const blocks = xml.split('<authentication type="url">').slice(1);
    assert.equal(blocks.length, 4);
    for (const text of blocks) {
      const block = text.slice(0, text.indexOf('</authentication>'));
      assert.match(block, /listener_add/);
      assert.match(block, /<option name="allow_duplicate_users" value="1"\/>/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const file of ['broadcast-entrypoint.sh', join('aio', 'supervisor.sh')]) {
  test(`${file} uses the shared renderer`, () => {
    assert.match(readFileSync(join(docker, file), 'utf8'), /\/usr\/local\/bin\/icecast-render/);
  });
}

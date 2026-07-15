# Portainer Release Tag Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a release deployment succeed even when the existing Portainer stack environment has never contained `SUBWAVE_VERSION`.

**Architecture:** Keep the checked-in Compose manifest variable-based, but render its exact release placeholders inside the transactional deployment client before the Portainer update. The same update still upserts `SUBWAVE_VERSION` as operator metadata, and rollback still restores the untouched snapshot.

**Tech Stack:** Node.js 22 ESM, `node:test`, Portainer HTTP API, Docker Compose.

## Global Constraints

- Only a tag accepted by `parseForkTag` may reach the deployment client.
- Replace only the exact `${SUBWAVE_VERSION:?required}` token.
- Reject a manifest with no exact token or any unresolved `${SUBWAVE_VERSION...}` expression before the first Portainer update.
- Preserve one `SUBWAVE_VERSION` stack environment entry for operator metadata.
- Preserve the exact existing rollback snapshot and sanitized error behavior.
- Do not change ark, bender, registry credentials, persistent state, or release images.

---

### Task 1: Render the immutable tag before the Portainer update

**Files:**
- Modify: `scripts/deploy/portainer-client.mjs`
- Test: `scripts/deploy/portainer-client.test.mjs`
- Modify: `docs/deployment.md`

**Interfaces:**
- Consumes: `targetVersion: string` already validated by `parseForkTag`, and a manifest containing `${SUBWAVE_VERSION:?required}`.
- Produces: `renderReleaseManifest(manifest: string, targetVersion: string): string` and a `deployWithRollback` target whose `StackFileContent` contains the immutable tag with no release placeholder.

- [ ] **Step 1: Write the failing renderer and unseeded-stack tests**

Import the wished-for helper in `scripts/deploy/portainer-client.test.mjs`:

```js
import {
  // existing imports
  renderReleaseManifest,
} from './portainer-client.mjs';
```

Use a real manifest template and expected rendered value:

```js
const releaseManifest = `services:
  controller:
    image: ghcr.io/obiwancanoweme/subwave-controller:\${SUBWAVE_VERSION:?required}
`;
const renderedManifest = `services:
  controller:
    image: ghcr.io/obiwancanoweme/subwave-controller:v0.42.0-obiwave.1
`;
```

Add focused contract tests:

```js
test('renders every exact release placeholder with the immutable target tag', () => {
  const twice = `${releaseManifest}${releaseManifest.replace('controller:', 'web:')}`;
  const rendered = renderReleaseManifest(twice, 'v0.42.0-obiwave.1');

  assert.equal(rendered.match(/v0\.42\.0-obiwave\.1/g)?.length, 2);
  assert.doesNotMatch(rendered, /SUBWAVE_VERSION/);
});

test('rejects missing or unsupported release placeholders before deployment', () => {
  assert.throws(
    () => renderReleaseManifest('services: {}\n', 'v0.42.0-obiwave.1'),
    /no exact SUBWAVE_VERSION placeholder/,
  );
  assert.throws(
    () => renderReleaseManifest(
      `${releaseManifest}\n# \${SUBWAVE_VERSION:-latest}\n`,
      'v0.42.0-obiwave.1',
    ),
    /unresolved SUBWAVE_VERSION placeholder/,
  );
});

test('rejects an invalid release manifest before reading Portainer state', async () => {
  let snapshotCalled = false;
  await assert.rejects(deployWithRollback({
    client: {
      snapshotStack: async () => {
        snapshotCalled = true;
        return { Env: [], StackFileContent: oldFile };
      },
    },
    manifest: 'services: {}\n',
    targetVersion: 'v0.42.0-obiwave.1',
    healthUrl: 'https://radio.example/health',
    streamUrl: 'https://radio.example/stream.mp3',
  }), /no exact SUBWAVE_VERSION placeholder/);
  assert.equal(snapshotCalled, false);
});
```

Change the successful deployment fixture so its snapshot environment has no
`SUBWAVE_VERSION`, pass `releaseManifest`, and assert the one target API update
contains both `renderedManifest` and exactly one version environment entry:

```js
const unseededEnv = [{ name: 'ADMIN_USER', value: 'operator', preserved: 'exactly' }];

assert.equal(update.StackFileContent, renderedManifest);
assert.deepEqual(update.Env, [
  { name: 'ADMIN_USER', value: 'operator', preserved: 'exactly' },
  { name: 'SUBWAVE_VERSION', value: 'v0.42.0-obiwave.1' },
]);
assert.doesNotMatch(update.StackFileContent, /SUBWAVE_VERSION/);
```

Update that test's result assertion to reflect the genuinely unseeded snapshot:

```js
assert.deepEqual(result, {
  previousVersion: null,
  targetVersion: 'v0.42.0-obiwave.1',
});
```

- [ ] **Step 2: Run the focused suite and verify RED**

Run:

```bash
node --test scripts/deploy/portainer-client.test.mjs
```

Expected: FAIL because `portainer-client.mjs` does not export
`renderReleaseManifest`.

- [ ] **Step 3: Implement the minimal pure renderer and use it for the target**

Add to `scripts/deploy/portainer-client.mjs`:

```js
const RELEASE_VERSION_TOKEN = '${SUBWAVE_VERSION:?required}';
const UNRESOLVED_RELEASE_VERSION = /\$\{SUBWAVE_VERSION[^}]*\}/;

export function renderReleaseManifest(manifest, targetVersion) {
  if (!manifest.includes(RELEASE_VERSION_TOKEN)) {
    throw new Error('Portainer manifest has no exact SUBWAVE_VERSION placeholder');
  }
  const rendered = manifest.replaceAll(RELEASE_VERSION_TOKEN, targetVersion);
  if (UNRESOLVED_RELEASE_VERSION.test(rendered)) {
    throw new Error('Portainer manifest has an unresolved SUBWAVE_VERSION placeholder');
  }
  return rendered;
}
```

Render before constructing the target in `deployWithRollback`:

```js
const renderedManifest = renderReleaseManifest(manifest, targetVersion);
const snapshot = await client.snapshotStack();
const previousVersion = versionFrom(snapshot.Env);
const target = {
  Env: upsertEnv(snapshot.Env, 'SUBWAVE_VERSION', targetVersion),
  StackFileContent: renderedManifest,
};
```

Rendering must precede `snapshotStack()` so a bad manifest performs no
Portainer request at all.

- [ ] **Step 4: Run the deployment tests and verify GREEN**

Run:

```bash
node --test scripts/deploy/portainer-client.test.mjs
```

Expected: all deployment-client tests pass, including the unseeded environment
regression.

- [ ] **Step 5: Document the rendered Portainer revision**

In `docs/deployment.md`, update the release deployment description to state:

```markdown
Before the Portainer update, the client replaces every exact
`${SUBWAVE_VERSION:?required}` image placeholder with the validated release
tag. The deployed stack revision is therefore self-contained even when the
previous stack had no version variable. The client still records one
`SUBWAVE_VERSION` Environment entry as operator metadata.
```

- [ ] **Step 6: Run the full deployment contract verification**

Run:

```bash
node --test scripts/deploy/portainer-client.test.mjs
node --test scripts/ci/validate-portainer-compose.test.mjs
trap 'rm -f deploy/portainer/stack.env' EXIT
: > deploy/portainer/stack.env
SUBWAVE_VERSION=v0.42.0-obiwave.3 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org \
  node scripts/ci/validate-portainer-compose.mjs deploy/portainer/docker-compose.yml
SUBWAVE_VERSION=v0.42.0-obiwave.3 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org \
  docker compose -f deploy/portainer/docker-compose.yml config --quiet
```

Expected: both Node suites pass, the policy validator prints a success message,
and Docker Compose exits 0 without output.

- [ ] **Step 7: Commit the implementation**

```bash
git add scripts/deploy/portainer-client.mjs \
  scripts/deploy/portainer-client.test.mjs docs/deployment.md
git commit -m "fix: render Portainer release image tags"
```

- [ ] **Step 8: Review and publish the branch**

Run:

```bash
git diff --check obiwave/develop...HEAD
git status --short
git push -u obiwave agent/render-portainer-release-tag
```

Expected: no whitespace errors, a clean worktree, and the branch published for
a pull request into `develop`.

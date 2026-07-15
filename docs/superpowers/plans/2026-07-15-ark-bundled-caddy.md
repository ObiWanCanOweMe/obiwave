# Ark Bundled Caddy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the complete public SUB/WAVE origin through a bundled Caddy container on ark port 7700 so bender remains unchanged.

**Architecture:** Add the existing fork-owned Caddy image to the image-only Portainer stack. Caddy alone publishes ark's required IPv4 and IPv6 bindings; web, controller, and broadcast remain internal. The deployment contract renders Docker Compose's canonical JSON model with all profiles enabled and enforces port ownership, cardinality, and trusted-proxy configuration structurally before release; source text is inspected only for template-form invariants such as immutable image expressions.

**Tech Stack:** Docker Compose, Caddy, Node.js built-in test runner, GitHub Actions, Portainer, GHCR

## Global Constraints

- Do not change, reload, or connect to bender.
- Caddy is the only SUB/WAVE service allowed to publish a host port.
- The only approved bindings are `10.20.0.9:${WEB_PORT:-7700}:80` and `[2600:1700:3210:5314:10:20:0:9]:${WEB_PORT:-7700}:80`.
- Every fork-owned image uses `${SUBWAVE_VERSION:?required}`; never use `latest`.
- Persistent station data remains at `/mnt/NVMe/container-data/subwave/state:/var/sub-wave`.
- Public acceptance uses `https://radio.kener.org/api/health` and `https://radio.kener.org/stream.mp3`.
- Keep `v0.42.0-obiwave.2` immutable; release the correction as `v0.42.0-obiwave.3`.

## File Structure

- `scripts/ci/validate-portainer-compose.test.mjs`: regression examples for the seven-service Caddy topology.
- `scripts/ci/validate-portainer-compose.mjs`: source-template policy plus structural validation of `docker compose config --format json`.
- `deploy/portainer/docker-compose.yml`: image-only runtime deployed by Portainer on ark.

---

### Task 1: Encode the Caddy-Only Deployment Contract

**Files:**
- Modify: `scripts/ci/validate-portainer-compose.test.mjs`
- Modify: `scripts/ci/validate-portainer-compose.mjs`

**Interfaces:**
- Consumes: `validatePortainerCompose(source: string): string[]` for source-template invariants and `validateResolvedPortainerCompose(model: object): string[]` for Docker's resolved Compose model.
- Produces: errors for a missing/incorrect Caddy image or source-template requirement, any resolved non-Caddy publication, incorrect resolved Caddy binding ownership/cardinality, and an incorrect resolved trusted-proxy value.

> **Structural-validation amendment:** The source-key matching described in the
> original steps below is superseded. Regression fixtures must be rendered by
> Docker Compose, including tagged, quoted, and merged YAML keys, and policy is
> applied to the resulting JSON object rather than enumerating YAML spellings.

- [ ] **Step 1: Rewrite the valid fixture for bundled Caddy**

Add this fixture service before `broadcast`:

```yaml
  caddy:
    image: ghcr.io/obiwancanoweme/subwave-caddy:${SUBWAVE_VERSION:?required}
    logging: *default-logging
    depends_on:
      web:
        condition: service_started
      controller:
        condition: service_healthy
      broadcast:
        condition: service_healthy
    ports:
      - "10.20.0.9:${WEB_PORT:-7700}:80"
      - "[2600:1700:3210:5314:10:20:0:9]:${WEB_PORT:-7700}:80"
    volumes:
      - caddy-data:/data
      - caddy-config:/config
```

Make Caddy the fixture's only service with a `ports:` key: remove the existing declarations from `broadcast`, `controller`, and `web`, and do not declare `ports:` on any other service. Add `caddy-data:` and `caddy-config:` to its top-level `volumes:`. Rename the acceptance test to `accepts the full seven-service Caddy production contract`, and include `caddy` in the exact first-party image test.

Replace the old port tests with:

```js
const nonCaddyServices = [
  'broadcast',
  'controller',
  'docker-socket-proxy',
  'web',
  'tts-heavy',
  'analyzer',
];

test('rejects non-Caddy services that publish host ports', () => {
  for (const service of nonCaddyServices) {
    const marker = `\n  ${service}:\n`;
    const invalid = valid.replace(
      marker,
      `${marker}    ports:\n      - "10.20.0.9:9999:9999"\n`,
    );
    assertRejects(invalid, `service ${service} must not publish host ports`);
  }
});

test('rejects missing, off-contract, commented, or duplicated Caddy bindings', () => {
  const ipv4 = '10.20.0.9:${WEB_PORT:-7700}:80';
  const ipv6 = '[2600:1700:3210:5314:10:20:0:9]:${WEB_PORT:-7700}:80';
  assertRejects(valid.replace(`      - "${ipv4}"\n`, ''), `service caddy is missing published port ${ipv4}`);
  assertRejects(valid.replace(ipv4, '0.0.0.0:${WEB_PORT:-7700}:80'), 'manifest binds a published port to a wildcard address');
  assertRejects(valid.replace(`      - "${ipv6}"`, `      # - "${ipv6}"`), `service caddy is missing published port ${ipv6}`);
  assertRejects(valid.replace(`      - "${ipv4}"`, `      - "${ipv4}"\n      - "${ipv4}"`), `manifest must publish port ${ipv4} exactly once`);
});
```

Add topology-removal cases for Caddy's three `depends_on` conditions and two named volume mounts.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test scripts/ci/validate-portainer-compose.test.mjs
```

Expected: FAIL because the validator reports `manifest contains unexpected service caddy`, requires the superseded three-port topology, and does not reject non-Caddy `ports:` declarations.

- [ ] **Step 3: Implement the minimal policy**

Add the exact image:

```js
['caddy', 'ghcr.io/obiwancanoweme/subwave-caddy:${SUBWAVE_VERSION:?required}'],
```

Replace the port constants with:

```js
const approvedPorts = [
  '10.20.0.9:${WEB_PORT:-7700}:80',
  '[2600:1700:3210:5314:10:20:0:9]:${WEB_PORT:-7700}:80',
];
const servicePorts = new Map([['caddy', approvedPorts]]);
```

Add these service requirements:

```js
['caddy', 'logging: *default-logging', 'service caddy is missing default log rotation'],
['caddy', 'web:\n        condition: service_started', 'service caddy is missing web service_started dependency'],
['caddy', 'controller:\n        condition: service_healthy', 'service caddy is missing controller service_healthy dependency'],
['caddy', 'broadcast:\n        condition: service_healthy', 'service caddy is missing broadcast service_healthy dependency'],
['caddy', 'caddy-data:/data', 'service caddy is missing its data volume'],
['caddy', 'caddy-config:/config', 'service caddy is missing its config volume'],
```

Require `caddy-data` and `caddy-config` in the named-volume loop. For port policy,
render `docker compose --profile '*' config --format json` and pass the parsed object to the
resolved-model validator. Caddy must own exactly the two approved publications,
all other services must resolve to zero publications, and Caddy must contain the
exact bender trusted-proxy environment value. Do not inspect service-level YAML
key spellings or reject merge syntax in source text.

```js
validateResolvedPortainerCompose(model);
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run `node --test scripts/ci/validate-portainer-compose.test.mjs`.

Expected: every validator test passes with zero failures.

- [ ] **Step 5: Commit the policy**

```bash
git add scripts/ci/validate-portainer-compose.test.mjs scripts/ci/validate-portainer-compose.mjs
git commit -m "test: require bundled Caddy in Portainer stack"
```

---

### Task 2: Convert the Ark Manifest to Bundled Caddy

**Files:**
- Modify: `deploy/portainer/docker-compose.yml`

**Interfaces:**
- Consumes: immutable fork images, internal service DNS, and the Caddy image's baked route configuration.
- Produces: one HTTP origin at ark port 7700 for bender.

- [ ] **Step 1: Verify the old manifest fails the new policy**

Run `node scripts/ci/validate-portainer-compose.mjs deploy/portainer/docker-compose.yml`.

Expected: FAIL with `manifest is missing service caddy` and missing Caddy bindings.

- [ ] **Step 2: Add the production Caddy service**

Add first under `services:`:

```yaml
  caddy:
    image: ghcr.io/obiwancanoweme/subwave-caddy:${SUBWAVE_VERSION:?required}
    container_name: sub-wave-caddy
    restart: unless-stopped
    logging: *default-logging
    depends_on:
      web:
        condition: service_started
      controller:
        condition: service_healthy
      broadcast:
        condition: service_healthy
    ports:
      - "10.20.0.9:${WEB_PORT:-7700}:80"
      - "[2600:1700:3210:5314:10:20:0:9]:${WEB_PORT:-7700}:80"
    volumes:
      - caddy-data:/data
      - caddy-config:/config
```

Rewrite the header comment to say bender forwards the complete origin to ark port 7700 and Caddy performs path routing internally.

- [ ] **Step 3: Make application services internal-only**

Delete the complete `ports:` sections from `broadcast`, `controller`, and `web`. Do not alter their health checks, dependencies, environment, or state mounts. Add `caddy-data:` and `caddy-config:` before the existing top-level named volumes.

- [ ] **Step 4: Validate and render**

Run:

```bash
touch deploy/portainer/stack.env
SUBWAVE_VERSION=v0.42.0-obiwave.3 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org node scripts/ci/validate-portainer-compose.mjs deploy/portainer/docker-compose.yml
SUBWAVE_VERSION=v0.42.0-obiwave.3 ADMIN_USER=ci ADMIN_PASS=ci SITE_URL=https://radio.kener.org docker compose -f deploy/portainer/docker-compose.yml config --quiet
rm deploy/portainer/stack.env
```

Expected: the validator prints `validated deploy/portainer/docker-compose.yml`; Compose exits 0 without interpolation errors.

- [ ] **Step 5: Commit the manifest**

```bash
git add deploy/portainer/docker-compose.yml
git commit -m "fix: route ark stack through bundled Caddy"
```

---

### Task 3: Verify and Open the Pull Request

**Files:**
- Verify: `.github/workflows/ci.yml`
- Verify: `scripts/ci/workflow-contract.test.mjs`
- Verify: `scripts/deploy/portainer-client.test.mjs`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: a reviewable branch whose CI cannot deploy production.

- [ ] **Step 1: Run the full deployment contract suite**

```bash
node --test scripts/release/fork-tag.test.mjs scripts/ci/validate-portainer-compose.test.mjs scripts/ci/assert-image-tag-absent.test.mjs scripts/ci/workflow-contract.test.mjs scripts/deploy/portainer-client.test.mjs
```

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run repository checks**

```bash
git diff --check obiwave/develop...HEAD
git status --short
git log --oneline obiwave/develop..HEAD
```

Expected: no whitespace errors; only the approved spec, plan, validator, tests, and Portainer manifest differ from `develop`.

- [ ] **Step 3: Push and open a pull request**

```bash
git push -u obiwave agent/ark-bundled-caddy
gh pr create -R ObiWanCanOweMe/obiwave --base develop --head agent/ark-bundled-caddy --title "fix: route ark stack through bundled Caddy" --body "Adds the fork-owned Caddy edge to ark, publishes only port 7700 on the approved IPv4/IPv6 addresses, and enforces the topology in CI. Bender remains unchanged. Verified with the deployment contract suite, manifest policy validator, and Docker Compose render."
```

Expected: a PR targeting `develop`; branch CI runs and no production deployment occurs.

---

### Task 4: Release and Verify `v0.42.0-obiwave.3`

**Files:**
- No code changes.

**Interfaces:**
- Consumes: merged green `develop`, protected `production` environment, Portainer stack 98, endpoint 14, and public bender routes.
- Produces: immutable `.3` images and a publicly verified ark deployment.

- [ ] **Step 1: Confirm the PR is merged and green**

```bash
gh pr view -R ObiWanCanOweMe/obiwave --json state,mergeCommit,statusCheckRollup
```

Expected: state `MERGED`; every required check succeeds.

- [ ] **Step 2: Dispatch the release helper**

```bash
gh workflow run cut-fork-release.yml -R ObiWanCanOweMe/obiwave -f base_tag=v0.42.0 -f iteration=3 -f target=develop
```

Expected: immutable tag `v0.42.0-obiwave.3` is created on merged `develop`.

- [ ] **Step 3: Watch publication and deployment**

```bash
run_id=$(gh run list -R ObiWanCanOweMe/obiwave --workflow publish-images.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$run_id" -R ObiWanCanOweMe/obiwave --exit-status
```

Expected: nine image builds, five production scans, and `deploy-production` succeed.

- [ ] **Step 4: Verify the public origin**

```bash
curl -fsS https://radio.kener.org/api/health
curl -fsS --max-time 15 -o /dev/null -w '%{http_code} %{content_type} %{size_download}\n' https://radio.kener.org/stream.mp3
```

Expected: health reports `status: on-air`; stream reports HTTP 200, `audio/mpeg`, and a non-zero byte count.

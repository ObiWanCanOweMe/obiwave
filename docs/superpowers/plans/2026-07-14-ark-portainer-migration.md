# Ark Portainer Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the already-live SUB/WAVE v0.42.0-based runtime from the repository directory to a Portainer-managed stack on ark without losing state and with a tested return path.

**Architecture:** A harmless Portainer placeholder reserves the future stack identity, and the first release deployment waits behind a GitHub production approval. A two-pass `rsync` seeds ark while the station remains live, then a maintenance window stops the source, performs a quiesced final sync, changes bender's upstreams, and approves exact-tag deployment to ark.

**Tech Stack:** Portainer Web Editor, Docker Compose, ZFS-backed TrueNAS storage, rsync over SSH, GitHub Environments, curl.

## Global Constraints

- Upstream `v0.42.0` is already merged at `079851b` and deployed; do not merge it again.
- Destination state path: `/mnt/NVMe/container-data/subwave/state`.
- Initial production version: `v0.42.0-obiwave.1`.
- Bind published ports only on IPv4 `10.20.0.9` and IPv6 `2600:1700:3210:5314:10:20:0:9`.
- Never run old and new controllers as simultaneous public broadcasters after the final sync.
- Preserve the stopped old runtime and state until ark passes playback, admin, persistence, and restart checks.
- Bender retains public TLS and routing for `radio.kener.org`.
- Fork-owned GHCR packages remain private and require authenticated pulls.
- Verify bender's SSH fingerprint out of band before accepting its currently untrusted host key.
- Preserve `controller/scripts/__pycache__/`.

---

### Task 1: Preflight Source, Ark, and Release Artifacts

**Files:**
- Read only: `.env`, `state/`, `deploy/portainer/docker-compose.yml`
- Create outside Git: `/tmp/subwave-migration/`

**Interfaces:**
- Consumes: completed CI/CD implementation.
- Produces: non-secret evidence and a go/no-go result.

- [ ] **Step 1: Capture the source runtime**

```bash
mkdir -p /tmp/subwave-migration
docker compose ps > /tmp/subwave-migration/source-compose-ps.txt
docker compose images > /tmp/subwave-migration/source-compose-images.txt
curl -fsS https://radio.kener.org/api/health | tee /tmp/subwave-migration/source-health.json
```

Expected: required source services run and health is `{"status":"on-air"}`.

- [ ] **Step 2: Verify ark storage and both addresses**

```bash
ssh ark 'test -d /mnt/NVMe/container-data && df -h /mnt/NVMe/container-data && ip -brief address | grep -E "10\.20\.0\.9|2600:1700:3210:5314:10:20:0:9"'
```

Expected: the dataset has sufficient space and both addresses appear on ark.

- [ ] **Step 3: Inventory source state without exposing secrets**

```bash
find state -type f | sort > /tmp/subwave-migration/source-state-files.txt
du -sh state | tee /tmp/subwave-migration/source-state-size.txt
shasum -a 256 state/settings.json state/setup-config.json > /tmp/subwave-migration/source-critical.sha256
```

Expected: inventory and digests are non-empty; no file contents are captured.

### Task 2: Create the Portainer Placeholder and GitHub Environment

**Files:**
- Store in Portainer: Web Editor stack `subwave`
- Configure in GitHub: Environment `production`

**Interfaces:**
- Produces stable Portainer stack and endpoint IDs before the release workflow starts.
- Produces a required-reviewer gate for the first production deployment.

- [ ] **Step 1: Validate the existing root environment without printing values**

Run this from the live source checkout. It reports only a missing variable
name, never a value:

```bash
for name in ADMIN_USER ADMIN_PASS SITE_URL; do
  grep -Eq "^${name}=.+" .env || { printf 'Missing required variable name: %s\n' "$name" >&2; exit 1; }
done
```

Expected: exit 0 confirms that `ADMIN_USER`, `ADMIN_PASS`, and `SITE_URL` are
present and non-empty. Do not run `cat .env`, `env`, `set`, or any command that
copies values into the terminal, shell history, migration evidence, or chat.

- [ ] **Step 2: Configure ark's private GHCR credential**

Create a dedicated GitHub classic PAT with only `read:packages`. In Portainer,
open **Registries → Add registry → Custom registry**, use `ghcr.io`, the PAT's
GitHub username, and the PAT as the password, then restrict/associate the
registry with the ark environment. Store the PAT only in Portainer's registry
credential store. Never add it to GitHub repository/environment secrets, the
stack Environment, `stack.env`, the Web Editor manifest, or a shell command.
Do not use a personal all-scope token.

In GitHub Packages, confirm every fork-owned `subwave-*` package is Private
and does not inherit public repository access. The release and scan workflows
use scoped `GITHUB_TOKEN` credentials; the dedicated read PAT is for Portainer
only.

Expected: ark can authenticate to the private `ghcr.io/obiwancanoweme`
packages. This association must exist before the production approval.

- [ ] **Step 3: Create a harmless Web Editor stack and seed its Environment**

In Portainer, select ark and choose **Stacks → Add stack → Web editor**. Name it `subwave` and deploy exactly:

```yaml
services:
  migration-placeholder:
    image: busybox:1.36
    command: ["sh", "-c", "sleep infinity"]
    restart: unless-stopped
```

Before clicking **Deploy the stack**, expand **Environment variables** and use
Portainer's **Load variables from .env file** control to load the existing root
`.env` directly from the trusted workstation. Do not paste its contents into
the Web Editor. Add `SUBWAVE_VERSION=v0.42.0-obiwave.1` as a separate entry.
Review the variable names in the authenticated Portainer UI and update
host-specific values for ark, especially URLs/addresses that referred to the
old Docker host; confirm `SITE_URL` remains the public
`https://radio.kener.org`. Confirm the entries named `ADMIN_USER`,
`ADMIN_PASS`, and `SITE_URL` exist without copying, screenshotting, or printing
their values.

Expected: the stack exists with one container, no published ports, and no
state mounts; its Environment contains the full existing root `.env` plus the
exact `SUBWAVE_VERSION`. Record the numeric stack ID from the Portainer URL.
The later release update preserves every Environment entry and changes only
`SUBWAVE_VERSION`.

- [ ] **Step 4: Find ark's numeric endpoint ID**

```zsh
read -rs 'PORTAINER_API_KEY?Portainer access token: '; printf '\n'; curl -fsS -H "X-API-Key: ${PORTAINER_API_KEY}" https://portainer.kener.org/api/endpoints | jq '.[] | {Id, Name, URL}'
```

Expected: the response identifies ark and its numeric `Id`. Then run `unset PORTAINER_API_KEY`.

- [ ] **Step 5: Configure GitHub's production Environment**

In repository settings, add `PORTAINER_API_KEY` under **Settings → Environments → production → Environment secrets**. Add these Environment variables:

```text
PORTAINER_URL=https://portainer.kener.org
PORTAINER_STACK_ID=the numeric subwave stack ID
PORTAINER_ENDPOINT_ID=the numeric ark endpoint ID
SUBWAVE_HEALTH_URL=https://radio.kener.org/api/health
SUBWAVE_STREAM_URL=https://radio.kener.org/stream.mp3
```

Configure yourself as a required reviewer for `production` before creating the initial release. The secret may also be entered safely with:

```bash
gh secret set PORTAINER_API_KEY --env production --repo ObiWanCanOweMe/obiwave
```

- [ ] **Step 6: Confirm token scope, stack visibility, and registry association**

```zsh
read -rs 'PORTAINER_API_KEY?Portainer access token: '; printf '\n'; curl -fsS -H "X-API-Key: ${PORTAINER_API_KEY}" https://portainer.kener.org/api/stacks | jq '.[] | select(.Name == "subwave") | {Id, Name, EndpointId}'; unset PORTAINER_API_KEY
```

Expected: exactly one `subwave` stack appears on the recorded ark endpoint.
In Portainer, also reconfirm ark is associated with the dedicated GHCR
credential before approving any release deployment.

### Task 3: Seed the State Dataset and Start the First Release

**Files:**
- Create on ark: `/mnt/NVMe/container-data/subwave/state`

**Interfaces:**
- Produces a first-pass state copy and a release job waiting for approval after image publication.

- [ ] **Step 1: Create the destination directory**

```bash
ssh ark 'mkdir -p /mnt/NVMe/container-data/subwave/state/logs && chmod 0777 /mnt/NVMe/container-data/subwave/state /mnt/NVMe/container-data/subwave/state/logs'
```

Expected: command exits 0. Mode `0777` matches existing `scripts/setup.sh` behavior for containers using different service UIDs.

- [ ] **Step 2: Run the non-authoritative first sync while live**

```bash
rsync -aH --numeric-ids --info=progress2 state/ ark:/mnt/NVMe/container-data/subwave/state/
```

Expected: transfer exits 0; source remains live.

- [ ] **Step 3: Start the first fork release**

After the CI/CD implementation is merged to `main`, run:

```bash
gh workflow run cut-fork-release.yml --repo ObiWanCanOweMe/obiwave -f version=0.42.0 -f revision=1 -f target=main
```

Expected: `v0.42.0-obiwave.1` is created, all images publish, and `deploy production` waits for required-reviewer approval. Do not approve it yet.

- [ ] **Step 4: Compare initial state counts**

```bash
find state -type f | wc -l
ssh ark 'find /mnt/NVMe/container-data/subwave/state -type f | wc -l; du -sh /mnt/NVMe/container-data/subwave/state'
```

Expected: counts are close; writes may still differ before the final sync.

- [ ] **Step 5: Verify the published release matrix before maintenance**

```bash
docker buildx imagetools inspect ghcr.io/obiwancanoweme/subwave-broadcast:v0.42.0-obiwave.1
docker buildx imagetools inspect ghcr.io/obiwancanoweme/subwave-controller:v0.42.0-obiwave.1
docker buildx imagetools inspect ghcr.io/obiwancanoweme/subwave-web:v0.42.0-obiwave.1
docker buildx imagetools inspect ghcr.io/obiwancanoweme/subwave-analyzer:v0.42.0-obiwave.1
```

Expected: every image resolves for linux/amd64 while the deployment job remains at its approval gate.

All packages are private, so authenticate with a read-only GHCR credential
before these inspections. Do not place that credential on a command line.
If publication is partial, delete all GHCR package versions carrying
`v0.42.0-obiwave.1` across the complete release matrix, verify the tag no
longer resolves anywhere, and rerun the release. Never overwrite or retain
only a subset of that release tag.

### Task 4: Prepare Bender's Exact Cutover

**Files:**
- Read and later modify: the active bender configuration containing `radio.kener.org`.

**Interfaces:**
- Produces a validated proxy edit and timestamped recovery copy.

- [ ] **Step 1: Verify bender's host key**

Obtain the ED25519 fingerprint from bender's console or trusted inventory, then compare:

```bash
ssh-keyscan -t ed25519 bender.kener.org 2>/dev/null | ssh-keygen -lf -
```

Expected: fingerprints match exactly. Connect once using `ssh bender.kener.org` only after that comparison.

- [ ] **Step 2: Identify the active proxy and route source**

```bash
ssh bender.kener.org 'ps auxww | grep -E "[c]addy|[n]ginx|[h]aproxy|[t]raefik"; find /etc/caddy /etc/nginx /opt /srv -maxdepth 5 -type f \( -name Caddyfile -o -name "*.conf" -o -name "*.yml" \) 2>/dev/null | xargs grep -l "radio.kener.org" 2>/dev/null'
```

Expected: identify one active configuration source and its native validation/reload command.

- [ ] **Step 3: Prepare but do not reload the route edit**

Create a UTC-timestamped sibling backup. Edit only the existing SUB/WAVE upstream hosts so the routes become:

```text
/stream.mp3 and enabled stream mounts -> 10.20.0.9:7702
/api/* with existing prefix stripping  -> 10.20.0.9:7701
all other radio.kener.org traffic      -> 10.20.0.9:7700
```

Retain TLS, headers, WebSocket handling, and disabled stream buffering. Use IPv6 `2600:1700:3210:5314:10:20:0:9` as the configured fallback upstream if the proxy supports ordered upstreams. Validate the edited configuration but do not reload it before the final sync.

### Task 5: Quiesce, Final-Sync, Cut Over, and Approve

**Files:**
- Authoritative destination: `/mnt/NVMe/container-data/subwave/state`

**Interfaces:**
- Produces one public ark runtime using the exact release tag.

- [ ] **Step 1: Stop source application services without removing them**

```bash
docker compose stop web controller broadcast analyzer tts-heavy 2>/dev/null || docker compose stop web controller broadcast analyzer
docker compose ps
```

Expected: source services are stopped. Do not use `down`, `rm`, or prune commands.

- [ ] **Step 2: Run the authoritative final sync**

```bash
rsync -aH --numeric-ids --delete --itemize-changes state/ ark:/mnt/NVMe/container-data/subwave/state/ | tee /tmp/subwave-migration/final-rsync.txt
rsync -aHn --numeric-ids --delete --itemize-changes state/ ark:/mnt/NVMe/container-data/subwave/state/ | tee /tmp/subwave-migration/final-dry-run.txt
```

Expected: real sync exits 0 and dry run prints no changes.

- [ ] **Step 3: Reload bender toward ark**

Run the active proxy's validation and reload commands found in Task 4. Immediately confirm that the public health URL is temporarily unavailable because Portainer still runs only the placeholder; this proves traffic now targets ark rather than the stopped source.

- [ ] **Step 4: Approve the waiting GitHub production deployment**

Approve `deploy production` for `v0.42.0-obiwave.1`. The workflow replaces the placeholder manifest, pulls exact-tag images, and probes through bender.

Expected: the workflow succeeds and reports target version
`v0.42.0-obiwave.1` with on-air health and `audio/mpeg` stream data. The
Portainer Environment still contains the seeded entries and only
`SUBWAVE_VERSION` changed.

If it fails, automatic rollback restores the harmless placeholder rather than the old host. Immediately restore bender's timestamped configuration, reload the proxy, start the old services with `docker compose start broadcast controller web analyzer`, and verify public health before investigating the ark failure.

- [ ] **Step 5: Verify both ark addresses directly**

```bash
curl -fsS http://10.20.0.9:7701/health
curl -g -fsS 'http://[2600:1700:3210:5314:10:20:0:9]:7701/health'
curl -fsSI http://10.20.0.9:7702/stream.mp3 | sed -n '1,20p'
curl -g -fsSI 'http://[2600:1700:3210:5314:10:20:0:9]:7702/stream.mp3' | sed -n '1,20p'
```

Expected: both health calls return `{"status":"on-air"}` and both stream calls return HTTP 200 `audio/mpeg`.

### Task 6: Acceptance, Persistence, and Return Path

**Files:**
- Write evidence only under `/tmp/subwave-migration/`.

**Interfaces:**
- Produces acceptance evidence while preserving the old recovery copy.

- [ ] **Step 1: Verify the public experience**

```bash
curl -fsS https://radio.kener.org/api/health
curl -fsSI https://radio.kener.org/stream.mp3 | sed -n '1,20p'
curl -fsSI https://radio.kener.org/ | sed -n '1,20p'
```

Expected: health is on-air, stream is HTTP 200 `audio/mpeg`, and web succeeds.

- [ ] **Step 2: Exercise listener and admin behavior**

Open `https://radio.kener.org`; confirm current metadata, continuous audio, artwork, and listener requests. Sign into `/admin`; confirm settings, skills, jingles, session history, and debug/status data survived.

- [ ] **Step 3: Test persistence through controlled restarts**

Restart controller, then broadcast, then web using Portainer. After health returns:

```bash
curl -fsS https://radio.kener.org/api/health
ssh ark 'test -s /mnt/NVMe/container-data/subwave/state/settings.json && test -s /mnt/NVMe/container-data/subwave/state/setup-config.json'
```

Expected: the station returns on-air and both persistent files remain non-empty.

- [ ] **Step 4: Record the new and old states**

```bash
ssh ark 'find /mnt/NVMe/container-data/subwave/state -type f | wc -l; du -sh /mnt/NVMe/container-data/subwave/state' > /tmp/subwave-migration/ark-state-summary.txt
docker compose ps > /tmp/subwave-migration/old-runtime-stopped.txt
```

Expected: ark state is populated and old services remain stopped, not deleted.

- [ ] **Step 5: Record the emergency return sequence without running it**

The return sequence is: restore bender's timestamped proxy file and reload it; start old services with `docker compose start broadcast controller web analyzer`; verify public health. Never sync ark state backward while either controller runs.

- [ ] **Step 6: Decide whether to retain release approvals**

Keep the `production` required-reviewer rule for manual release promotion, or remove it after the migration if exact-tag releases should deploy automatically. In either case, only fork-qualified tag events can reach the production Environment.

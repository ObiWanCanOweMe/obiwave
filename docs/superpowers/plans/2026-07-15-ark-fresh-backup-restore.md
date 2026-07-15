# Ark Fresh Install and Backup Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy a clean, fork-tagged SUB/WAVE stack on ark and restore the validated v0.42.0 station backup through SUB/WAVE's supported disk-restore path.

**Architecture:** Portainer stack 98 begins as a harmless placeholder and is replaced by the immutable `v0.42.0-obiwave.1` release manifest. The new containers create host-specific runtime state on ark, onboarding supplies credentials that are absent from the backup, and the controller restores the 232 MB backup locally from the state directory. Bender is already configured correctly and is read-only throughout this plan.

**Tech Stack:** GitHub Actions, GHCR, Portainer API, Docker Compose, SUB/WAVE onboarding and backup APIs, SSH/SCP, curl, jq, ffmpeg.

## Global Constraints

- Fork repository: `ObiWanCanOweMe/obiwave`; its only remote release branch is `develop`.
- Initial production tag: `v0.42.0-obiwave.1` at the tested `develop` commit.
- Portainer production target: stack ID `98`, endpoint ID `14`.
- Persistent state path: `/mnt/NVMe/container-data/subwave/state`.
- Backup source: `/Users/akener/Downloads/subwave-backup-2026-07-15.zip`.
- The validated backup is format v1, was created by v0.42.0, is 232 MB compressed, and passes `unzip -t`.
- Ark runs the compose-managed heavy analyzer: `ANALYZER_HEAVY=1`, `ANALYZE_VOCAL_ACTIVITY=1`, with no `ANALYZE_URL` or `ANALYZE_HANDOFF` override.
- Bender needs no modification; all public verification continues through `https://radio.kener.org`.
- Do not manually extract the backup or replace `library.db` behind a running controller.
- Do not put the GHCR read PAT in GitHub Actions, stack variables, `stack.env`, a command line, or the repository.
- Do not create or reuse a partial fork release tag. If publication is partial, delete that tag from every package before retrying.
- Preserve the local backup unchanged until post-restart verification passes.
- Preserve the unrelated untracked `controller/scripts/__pycache__/` directory.

---

### Task 1: Correct the Fork Release Branch Contract

**Files:**
- Modify: `.github/workflows/cut-fork-release.yml`
- Modify: `scripts/ci/workflow-contract.test.mjs`
- Modify: `docs/deployment.md`
- Test: `scripts/ci/workflow-contract.test.mjs`

**Interfaces:**
- Consumes: the fork's actual default and only remote branch, `develop`.
- Produces: a release helper whose omitted `target` input resolves to `develop`, while still allowing an explicit commit, branch, or tag.

- [ ] **Step 1: Add a failing workflow-contract test**

Read the release helper beside the other workflow fixtures:

```js
const cutRelease = await readFile(
  new URL('../../.github/workflows/cut-fork-release.yml', import.meta.url),
  'utf8',
);
```

Add this test:

```js
test('fork release defaults to the fork release branch', () => {
  assert.match(
    cutRelease,
    /target:\s*[\s\S]*?description: Branch, tag, or commit to release[\s\S]*?default: develop/,
  );
});
```

- [ ] **Step 2: Run the contract test and observe the intended failure**

Run:

```bash
node --test scripts/ci/workflow-contract.test.mjs
```

Expected: the new test fails because the workflow currently contains `default: main`.

- [ ] **Step 3: Change the default and operator documentation**

In `.github/workflows/cut-fork-release.yml`, change only the target default:

```yaml
      target:
        description: Branch, tag, or commit to release
        required: false
        default: develop
        type: string
```

In `docs/deployment.md`, use this initial release command:

```bash
gh workflow run cut-fork-release.yml --repo ObiWanCanOweMe/obiwave -f version=0.42.0 -f revision=1 -f target=develop
```

Replace the adjacent claims about the fork's `main` branch with `develop`.

- [ ] **Step 4: Verify the workflow contract and deployment contract**

Run:

```bash
node --test scripts/ci/workflow-contract.test.mjs
node --test scripts/release/fork-tag.test.mjs scripts/ci/validate-portainer-compose.test.mjs scripts/deploy/portainer-client.test.mjs
git diff --check
```

Expected: all tests pass and `git diff --check` prints nothing.

- [ ] **Step 5: Commit and merge the corrective PR into `develop`**

```bash
git add .github/workflows/cut-fork-release.yml scripts/ci/workflow-contract.test.mjs docs/deployment.md
git commit -m "fix: target fork releases from develop"
git push -u obiwave HEAD
```

Open a PR targeting `develop`, wait for every CI check to pass, and merge it. Do not create the release tag from an unmerged feature branch.

### Task 2: Complete Production Credentials and Fresh-State Preflight

**Files:**
- Configure in GitHub: repository secret `RELEASE_PLEASE_TOKEN`
- Configure in Portainer: custom registry `ghcr.io`
- Configure in Portainer: stack 98 Environment
- Create on ark: `/mnt/NVMe/container-data/subwave/state`

**Interfaces:**
- Consumes: Portainer environment secret `PORTAINER_API_KEY` and the five existing production variables.
- Produces: authenticated image pulls, a tag-creating GitHub token, and an empty writable state directory.

- [ ] **Step 1: Add the repository release token**

Create a dedicated fine-grained GitHub PAT owned by `ObiWanCanOweMe`, restricted to repository `obiwave`, with repository **Contents: Read and write**. Store it as the repository secret, not an Environment secret:

```bash
gh secret set RELEASE_PLEASE_TOKEN --repo ObiWanCanOweMe/obiwave
```

Paste the token only at the interactive prompt. This non-`GITHUB_TOKEN` credential is required because the release-created tag must trigger the separate tag-push publication workflow.

Verify only the secret name:

```bash
gh secret list --repo ObiWanCanOweMe/obiwave | awk '$1 == "RELEASE_PLEASE_TOKEN" { found=1 } END { exit !found }'
```

Expected: exit 0 with no token value printed.

- [ ] **Step 2: Confirm Portainer's private GHCR pull credential**

In Portainer, open **Registries** and confirm a **Custom registry** with URL `ghcr.io`, username `ObiWanCanOweMe`, and a dedicated classic PAT carrying only `read:packages`. Confirm it is available to endpoint 14. Do not use the broader Business Edition GitHub registry-management scopes.

Expected: the registry entry is saved and associated with ark before any fork image exists.

- [ ] **Step 3: Set the minimal fresh-stack Environment**

In Portainer stack 98, retain the existing non-empty `ADMIN_USER` and
`ADMIN_PASS` entries without displaying or retyping them. Retain or create the
following non-secret entries exactly:

```text
SITE_URL=https://radio.kener.org
TZ=America/New_York
ANALYZER_HEAVY=1
ANALYZE_VOCAL_ACTIVITY=1
```

Remove `ANALYZE_URL`, `ANALYZE_HANDOFF`, `COMPOSE_PROFILES`, `OLD_KEY`, and every `MCP_HA_*` entry. Do not add `SUBWAVE_VERSION`; the deployment client atomically inserts the exact release tag. Navidrome, LiteLLM, and ElevenLabs credentials are supplied during onboarding in Task 4.

Expected: the placeholder remains running; no secret value is copied to terminal output or chat.

- [ ] **Step 4: Create and verify an empty writable state directory**

Run on ark:

```bash
sudo mkdir -p /mnt/NVMe/container-data/subwave/state
sudo chmod 0777 /mnt/NVMe/container-data/subwave/state
sudo find /mnt/NVMe/container-data/subwave/state -mindepth 1 -maxdepth 1 -print
```

Expected: the final command prints nothing. Mode `0777` matches the supported setup behavior for containers using mixed UIDs.

- [ ] **Step 5: Reconfirm GitHub's production configuration by name**

```bash
gh secret list --env production --repo ObiWanCanOweMe/obiwave
gh variable list --env production --repo ObiWanCanOweMe/obiwave
```

Expected: secret `PORTAINER_API_KEY` and variables `PORTAINER_URL`, `PORTAINER_STACK_ID`, `PORTAINER_ENDPOINT_ID`, `SUBWAVE_HEALTH_URL`, and `SUBWAVE_STREAM_URL` are present. Stack and endpoint values remain 98 and 14.

### Task 3: Cut, Publish, Scan, and Deploy the First Fork Release

**Files:**
- No local file changes.
- Create in GitHub: release/tag `v0.42.0-obiwave.1`.
- Replace in Portainer: stack 98 placeholder manifest.

**Interfaces:**
- Consumes: merged `develop`, private GHCR pull credentials, production Environment, and empty ark state.
- Produces: a running immutable stack on ark using `v0.42.0-obiwave.1`.

- [ ] **Step 1: Confirm the release tag and image namespace are unused**

```bash
git ls-remote --exit-code --tags obiwave refs/tags/v0.42.0-obiwave.1
```

Expected: exit 2 and no output. Any other result stops the release.

- [ ] **Step 2: Confirm the merged `develop` head contains the release implementation**

```bash
git fetch obiwave develop --prune
git merge-base --is-ancestor v0.42.0 obiwave/develop
git show obiwave/develop:.github/workflows/publish-images.yml >/dev/null
git show obiwave/develop:deploy/portainer/docker-compose.yml >/dev/null
```

Expected: every command exits 0.

- [ ] **Step 3: Dispatch the validated release helper**

```bash
gh workflow run cut-fork-release.yml \
  --repo ObiWanCanOweMe/obiwave \
  --ref develop \
  -f version=0.42.0 \
  -f revision=1 \
  -f target=develop
```

Capture the run ID:

```bash
gh run list --repo ObiWanCanOweMe/obiwave --workflow cut-fork-release.yml --limit 1
```

Expected: the helper creates release `v0.42.0-obiwave.1` at the tested `develop` SHA.

- [ ] **Step 4: Monitor the complete tag workflow**

```bash
gh run list --repo ObiWanCanOweMe/obiwave --workflow publish-images.yml --limit 5
```

Resolve and watch the run whose head branch/tag is `v0.42.0-obiwave.1`:

```bash
RELEASE_RUN_ID=$(gh run list --repo ObiWanCanOweMe/obiwave --workflow publish-images.yml --limit 10 --json databaseId,headBranch --jq '[.[] | select(.headBranch == "v0.42.0-obiwave.1")][0].databaseId')
test -n "$RELEASE_RUN_ID"
gh run watch "$RELEASE_RUN_ID" --repo ObiWanCanOweMe/obiwave --exit-status
```

Expected: reusable CI, nine-image absence preflight, nine immutable builds, authenticated scans, and `deploy-production` all pass. Portainer replaces the placeholder with the checked-in manifest and inserts exactly one `SUBWAVE_VERSION=v0.42.0-obiwave.1` entry.

- [ ] **Step 5: Verify the public deployment before onboarding**

```bash
curl -fsS https://radio.kener.org/api/health | jq -e '.status == "on-air"'
curl -fsS --max-time 15 --range 0-65535 https://radio.kener.org/stream.mp3 -o /tmp/subwave-first-stream.mp3
test -s /tmp/subwave-first-stream.mp3
rm /tmp/subwave-first-stream.mp3
```

Expected: health returns `true` and the stream sample is non-empty. The fresh station may still report that onboarding is required.

### Task 4: Complete Fresh Onboarding on Ark

**Files:**
- Create through the controller: `state/setup-config.json`, `state/secrets.env`, `state/settings.json`, and runtime files under `/mnt/NVMe/container-data/subwave/state`.

**Interfaces:**
- Consumes: fresh running stack and operator-held Navidrome, LiteLLM, and ElevenLabs credentials.
- Produces: a functional target whose secrets will survive the redacted backup restore.

- [ ] **Step 1: Open and authenticate to onboarding**

Open:

```text
https://radio.kener.org/onboarding
```

Sign in with the `ADMIN_USER` and `ADMIN_PASS` configured in Portainer.

- [ ] **Step 2: Configure host-specific services**

Enter the current Navidrome URL, username, and password. Select LiteLLM and enter the existing LiteLLM base URL and API key. Configure cloud TTS with ElevenLabs and enter the existing ElevenLabs API key. Complete the wizard.

Expected: the wizard reports completion and redirects to the station/admin UI. Do not paste credentials into terminal output, chat, screenshots, or the repository.

- [ ] **Step 3: Verify secret-bearing fresh state without printing it**

Run on ark:

```bash
sudo test -s /mnt/NVMe/container-data/subwave/state/setup-config.json
sudo test -s /mnt/NVMe/container-data/subwave/state/secrets.env
sudo test -s /mnt/NVMe/container-data/subwave/state/settings.json
sudo stat -c '%a %n' /mnt/NVMe/container-data/subwave/state/secrets.env
```

Expected: all tests exit 0 and `secrets.env` reports mode `600`.

### Task 5: Restore the Validated Backup Through the Station Folder

**Files:**
- Copy to ark: `/mnt/NVMe/container-data/subwave/state/subwave-backup-2026-07-15.zip`
- Restore through: `POST /backup/import-file` via the Admin UI.

**Interfaces:**
- Consumes: onboarded target credentials and validated local backup.
- Produces: restored settings, library database, jingles, SFX, themes, and skills while preserving fresh target secrets.

- [ ] **Step 1: Revalidate the unchanged source backup**

```bash
unzip -t /Users/akener/Downloads/subwave-backup-2026-07-15.zip
unzip -p /Users/akener/Downloads/subwave-backup-2026-07-15.zip manifest.json | jq -e '.format == "subwave-backup" and .version == 1 and .appVersion == "0.42.0"'
```

Expected: ZIP validation reports no errors and `jq` prints `true`.

- [ ] **Step 2: Copy only the ZIP into ark's state directory**

```bash
scp /Users/akener/Downloads/subwave-backup-2026-07-15.zip ark:/tmp/subwave-backup-2026-07-15.zip
ssh ark 'sudo install -m 0644 /tmp/subwave-backup-2026-07-15.zip /mnt/NVMe/container-data/subwave/state/subwave-backup-2026-07-15.zip && rm /tmp/subwave-backup-2026-07-15.zip'
```

Expected: the file exists under the state directory and the local source remains unchanged.

- [ ] **Step 3: Restore through the supported Admin UI**

Open:

```text
https://radio.kener.org/admin/backup
```

Under **Restore from the station folder**, click **Refresh**, select `subwave-backup-2026-07-15.zip`, click **Restore**, and type the required confirmation.

Expected: the UI reports restored `settings.json`, `library.db`, and the included media/theme/skill groups. The 232 MB ZIP never traverses bender.

- [ ] **Step 4: Apply mixer settings if requested**

If the restore reports `Mixer settings changed`, click **Restart mixer** once and wait for the action to complete.

Expected: broadcast returns without repeated restart attempts.

### Task 6: Verify Audio, Restored State, and Restart Persistence

**Files:**
- Read only: public endpoints and restored ark state.
- Remove after success: server-side backup ZIP copy.

**Interfaces:**
- Consumes: restored ark station.
- Produces: objective migration acceptance evidence.

- [ ] **Step 1: Verify health and restored now-playing data**

```bash
curl -fsS https://radio.kener.org/api/health | jq -e '.status == "on-air"'
curl -fsS https://radio.kener.org/api/now-playing | jq -e '.nowPlaying.title and .nowPlaying.artist'
```

Expected: both commands exit 0.

- [ ] **Step 2: Prove that the public stream contains audible signal**

```bash
ffmpeg -hide_banner -loglevel info -t 15 -i https://radio.kener.org/stream.mp3 -af volumedetect -f null - 2>&1 | tee /tmp/subwave-ark-volume.txt
```

Expected: `mean_volume` is present and is louder than `-50 dB`; normal programme audio is typically around `-8 dB` to `-16 dB`. A result near `-91 dB` is failure even if HTTP health is green.

- [ ] **Step 3: Confirm restored assets and database without exposing secrets**

Run on ark:

```bash
sudo test -s /mnt/NVMe/container-data/subwave/state/library.db
sudo test -s /mnt/NVMe/container-data/subwave/state/jingles.m3u
sudo test -d /mnt/NVMe/container-data/subwave/state/skills
sudo test -f /mnt/NVMe/container-data/subwave/state/themes/atlanta-99x.json
```

Expected: every command exits 0.

- [ ] **Step 4: Verify one controlled restart**

In Portainer, restart `sub-wave-controller`, `sub-wave-broadcast`, and `sub-wave-web` once. Wait for their health indicators, then repeat Steps 1 and 2.

Expected: health, metadata, and non-silent audio recover using the restored persistent state.

- [ ] **Step 5: Remove only the server-side transfer copy after acceptance**

```bash
ssh ark 'sudo rm /mnt/NVMe/container-data/subwave/state/subwave-backup-2026-07-15.zip'
```

Expected: the server-side ZIP is removed. Keep `/Users/akener/Downloads/subwave-backup-2026-07-15.zip` unchanged as the migration backup.

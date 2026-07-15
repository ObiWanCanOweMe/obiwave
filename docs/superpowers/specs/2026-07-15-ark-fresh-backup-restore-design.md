# Ark Fresh Install and Backup Restore Design

## Goal

Move the live SUB/WAVE station to the Portainer-managed stack on ark without
copying the old runtime state directory wholesale. The new stack starts with a
clean state directory, receives host-specific credentials through onboarding,
and imports the supported SUB/WAVE backup made from v0.42.0.

The validated source backup is:

```text
/Users/akener/Downloads/subwave-backup-2026-07-15.zip
```

It is a 232 MB `subwave-backup` format-v1 archive created by SUB/WAVE v0.42.0.
Its ZIP integrity check passes and its manifest contains settings, the library
database, operator media, themes, and skills.

## Migration Boundary

The backup restores station-owned configuration and content:

- personas, DJ prompt, shows, schedule, and other settings;
- the library tag database;
- jingles, SFX, reference voices, themes, and skills.

The backup intentionally excludes host-specific and secret state:

- Navidrome credentials;
- LLM, TTS, and other API keys;
- Icecast secrets;
- live queues, sessions, logs, and transient IPC files.

Those exclusions are desirable for a fresh host migration. Ark generates new
runtime files and Icecast secrets, while onboarding supplies credentials before
the restore.

## Deployment and Restore Flow

1. Create an empty host directory at
   `/mnt/NVMe/container-data/subwave/state` with permissions suitable for the
   mixed container UIDs used by the stack.
2. Confirm Portainer stack 98 on endpoint 14 has its private `ghcr.io`
   credential and the required operator Environment values.
3. Route `radio.kener.org` on bender to ark. The old stack is already stopped,
   so this intentionally points the public verification URLs at the pending ark
   deployment rather than at the retired host.
4. Cut the first immutable fork release, `v0.42.0-obiwave.1`. The release
   workflow publishes, scans, and deploys the checked-in Portainer manifest to
   the placeholder stack, then verifies that deployment through bender.
5. Open the fresh station's onboarding flow and configure Navidrome plus the
   active LiteLLM and ElevenLabs credentials on the
   fresh target. The controller persists wizard-managed secrets in the new
   state directory. Ark uses the compose-managed heavy analyzer rather than the
   previous remote Odin analyzer.
6. Copy only `subwave-backup-2026-07-15.zip` into
   `/mnt/NVMe/container-data/subwave/state/`.
7. In **Admin -> Backup**, refresh **Restore from the station folder**, select
   the copied ZIP, and confirm the restore.
8. If the restore reports that mixer settings changed, restart the mixer from
   the same panel.
9. Verify the public health response, now-playing metadata, and non-silent MP3
   audio through bender.

## Why Onboarding Comes First

The backup contains redacted key sentinels rather than secret values. Restore
passes settings through the normal validator and preserves credentials already
configured on the target. Completing onboarding first therefore produces a
working target whose secrets survive the subsequent restore.

## Large Backup Handling

The backup is 232 MB, which is too large for common reverse-proxy upload limits.
It must not be uploaded through the browser. Copying it into the state directory
allows the controller's `/backup/import-file` path to read it locally while the
Admin UI still drives the supported restore operation.

## Failure Handling

- If release deployment fails, the release workflow restores the preceding
  placeholder stack definition and reports the failure.
- If onboarding fails, correct the fresh target configuration before restoring;
  the backup remains untouched.
- If restore validation fails, stop and inspect the reported error. Do not
  extract the ZIP manually or replace `library.db` behind the running
  controller.
- Keep the source backup unchanged until the new station passes all health and
  audio checks.

## Success Criteria

- The Portainer stack runs fork images tagged `v0.42.0-obiwave.1` on ark.
- Persistent data resides only under
  `/mnt/NVMe/container-data/subwave/state`.
- The controller uses the analyzer service running on ark.
- Restored settings, library tags, media, themes, and skills appear in the new
  station.
- Navidrome, LiteLLM, and ElevenLabs calls succeed with newly configured target
  credentials.
- `https://radio.kener.org/api/health` reports `on-air`, now-playing metadata is
  populated, and the public MP3 stream carries non-silent audio.

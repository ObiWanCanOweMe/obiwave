# Portainer Release CI/CD Design

**Date:** 2026-07-14

## Goal

Give the `ObiWanCanOweMe/obiwave` fork a repeatable CI/CD pipeline that validates every pull request and push, publishes fork-owned images, and deploys production only from fork-qualified release tags. Move the production runtime and persistent state out of the Git checkout and into a Portainer-managed stack on `ark`.

Upstream `v0.42.0` has already been merged into `obiwave/develop` and deployed to the live station. This work codifies and relocates that known live baseline; it does not repeat the upstream merge.

## Decisions

- GitHub repository: `ObiWanCanOweMe/obiwave`.
- Container registry: fork-owned packages under GHCR.
- Production host: `ark`, managed as a Portainer stack.
- Public edge: the reverse proxy on `bender.kener.org` serving `https://radio.kener.org`.
- Persistent state: `/mnt/NVMe/container-data/subwave/state` on `ark`.
- Ark port bindings: IPv4 `10.20.0.9` and IPv6 `2600:1700:3210:5314:10:20:0:9` only.
- CI trigger: every pull request and every push.
- Production trigger: only tags matching `vX.Y.Z-obiwave.N`.
- Initial fork-qualified baseline: `v0.42.0-obiwave.1`.
- Deployment control: GitHub-hosted Actions runner calling the reachable Portainer API.
- Failed health verification automatically restores the preceding stack version.

## Runtime Architecture

Portainer owns an image-only Compose manifest. The production manifest contains no `build:` entries, repository-relative source mounts, or dependency on a Git checkout. Each SUB/WAVE service pulls its image from the fork's GHCR namespace using the exact `SUBWAVE_VERSION` value supplied to the stack.

All file-based IPC and durable application data use the bind mount:

```text
/mnt/NVMe/container-data/subwave/state:/var/sub-wave
```

The same host directory must be mounted into every service that participates in SUB/WAVE's shared-state contract. The Portainer stack owns boot configuration through stack environment variables. Application settings and generated secrets remain in the state directory using SUB/WAVE's existing persistence model.

The production stack uses the BYO-proxy topology. It publishes the web, controller, and broadcast ports on `ark`; it does not run the bundled Caddy service. Each published port is bound twice: to `10.20.0.9` and `[2600:1700:3210:5314:10:20:0:9]`. It must not bind those services to the IPv4 or IPv6 wildcard addresses. The reverse proxy on `bender.kener.org` remains responsible for TLS and routes `radio.kener.org` as follows:

- `/stream.mp3` and other enabled stream mounts to the broadcast port on `ark`;
- `/api/*` to the controller port, preserving the existing prefix-stripping behavior;
- all other traffic to the web port.

Where host firewall controls are available, the published application ports should accept traffic from bender and trusted administration networks only.

## Continuous Integration

A consolidated CI workflow runs on every `pull_request` and `push`, including release-tag pushes. It performs the repository's supported lint/type-check commands, unit tests, production build validation, and Compose rendering checks. The Portainer manifest is rendered with representative non-secret values so missing variables and invalid service definitions fail before release.

Docker image build checks use path-aware jobs where practical: the workflow itself always runs, while expensive image jobs run for the affected image inputs. A full image build is repeated by the release workflow before publication. Branch and pull-request concurrency groups cancel superseded CI runs without affecting production deployments.

Existing security and dependency scanning workflows remain separate required checks unless consolidation materially improves their behavior.

## Release Images

The release workflow accepts only a tag matching:

```regex
^v[0-9]+\.[0-9]+\.[0-9]+-obiwave\.[0-9]+$
```

Plain upstream tags such as `v0.42.0` cannot publish or deploy fork releases. A release run checks out the tagged commit, repeats the required release gates, builds every production image, and pushes each image to `ghcr.io/obiwancanoweme` with the exact fork-qualified tag. Deployment never references `latest`.

The workflow records published image digests in its summary and retains build provenance where supported. A tag must not be reused or overwritten. The deployment stage starts only after all required images are available from GHCR.

## Portainer Deployment

GitHub's protected `production` Environment supplies:

### Environment secret

- `PORTAINER_API_KEY`: access token for a deployment-only Portainer user.

### Environment variables

- `PORTAINER_URL=https://portainer.kener.org`
- `PORTAINER_STACK_ID`: numeric ID of the SUB/WAVE stack.
- `PORTAINER_ENDPOINT_ID`: numeric ID of ark's Portainer environment.
- `SUBWAVE_HEALTH_URL=https://radio.kener.org/api/health`
- `SUBWAVE_STREAM_URL=https://radio.kener.org/stream.mp3`

The token is sent only in Portainer's `X-API-Key` header. Workflow commands disable shell tracing, do not print API request headers or full environment payloads, and rely on GitHub secret masking as a secondary safeguard.

The deployment job uses a concurrency group with cancellation disabled. It reads and retains the current stack definition and environment, replaces only the release-controlled manifest/version values, and updates the stack through Portainer's API. Operator-owned environment values and secrets are preserved.

## Verification and Rollback

After Portainer reports a successful update, the workflow polls the public health endpoint with a bounded retry window. It then confirms that the MP3 stream endpoint responds and begins delivering stream data. Public checks exercise the real path through bender rather than only testing containers on ark.

If deployment or verification fails, the workflow restores the exact preceding stack definition and environment captured before the update. It then runs the same health checks against the restored version. The workflow fails visibly even when rollback succeeds and reports both the failed target version and restored version. If rollback verification also fails, it reports a production incident without attempting an unbounded retry loop.

## Migration to Ark

Migration is a deliberate maintenance operation independent of normal releases:

1. Create `/mnt/NVMe/container-data/subwave/state` on ark with ownership and permissions compatible with the containers.
2. Create the initial Portainer stack using the image-only manifest and exact fork-qualified baseline tag.
3. Stop the existing runtime briefly to quiesce file-based state.
4. Copy the current state directory to ark while preserving modes, timestamps, and symlinks.
5. Start the ark stack and verify container health locally.
6. Change bender's upstream targets to ark.
7. Verify the public health endpoint, stream playback, admin authentication, settings, and state persistence across a controlled restart.
8. Retain the old runtime and data unchanged until the ark deployment has passed the acceptance checks; then disable it without deleting the fallback copy.

The migration must prevent both old and new controllers from broadcasting concurrently against divergent state.

## Testing and Acceptance

The implementation is accepted when:

- a pull request and ordinary branch push run CI but cannot deploy;
- a plain upstream-style tag cannot enter the production job;
- a fork-qualified test release publishes all expected fork-owned images;
- Portainer deploys the exact tag without a checkout on ark;
- the live station passes health and stream checks through bender;
- a controlled bad health target demonstrates automatic restoration of the preceding version without exposing secrets;
- persistent files are present only under `/mnt/NVMe/container-data/subwave/state`, not the repository directory;
- restarting or redeploying the Portainer stack retains settings, secrets, generated audio, logs, and session state.

## Non-goals

- Re-merging upstream `v0.42.0`; it is already integrated.
- Moving TLS termination or public routing from bender to ark.
- Deploying untagged commits, branch heads, or `latest` to production.
- Replacing Portainer with SSH-driven Compose or a self-hosted GitHub Actions runner.

#!/usr/bin/env python3
"""Create and attest the deterministic library fixture for isolated verifiers.

This never copies a database.  `seed` refuses a non-empty state directory,
requires an explicit creation opt-in, and writes a marker-bound manifest only
after its own 60-track / 60-play catalogue has been created.
"""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

from verify_stack import PROVENANCE_ENV, PROVENANCE_RE


FIXTURE_FILE = ".subwave-verify-library-fixture.json"
FIXTURE_NAME = "subwave-library-verifier"
FIXTURE_VERSION = 1
TRACK_COUNT = 60
HISTORY_COUNT = 60
MOODS = ("bright", "calm", "driving", "night")
GENRES = ("Ambient", "Electronic", "House")
CREATE_OPT_IN = "SUBWAVE_VERIFY_ALLOW_STATE_CREATE"
STATE_ENV = "SUBWAVE_VERIFY_STATE_DIR"
REPO = Path(__file__).resolve().parents[2]
LIBRARY_MODULE = (REPO / "controller" / "src" / "music" / "library-db.ts").as_uri()


def abort(message: str) -> None:
    raise SystemExit(f"refusing library fixture: {message}")


def marker() -> str:
    value = os.environ.get(PROVENANCE_ENV, "").strip()
    if not PROVENANCE_RE.fullmatch(value):
        abort(f"{PROVENANCE_ENV} is not a fresh verifier marker")
    return value


def state_dir() -> Path:
    raw = os.environ.get(STATE_ENV, "").strip()
    if not raw:
        abort(f"{STATE_ENV} is required to prove the fixture state is owned")
    path = Path(raw)
    if not path.is_absolute():
        abort(f"{STATE_ENV} must be an absolute task-only directory")
    configured = os.environ.get("STATE_DIR", "").strip()
    if not configured or Path(configured).resolve() != path.resolve():
        abort(f"STATE_DIR must match {STATE_ENV}")
    return path


def provenance_digest(value: str) -> str:
    return hashlib.sha256(
        f"{FIXTURE_NAME}\\0{FIXTURE_VERSION}\\0{value}".encode(),
    ).hexdigest()


def manifest_path(directory: Path) -> Path:
    return directory / FIXTURE_FILE


def assert_owned_fixture() -> dict:
    directory = state_dir()
    path = manifest_path(directory)
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        abort(f"missing {FIXTURE_FILE}; run {Path(__file__).name} seed before booting the controller")
    except (OSError, json.JSONDecodeError) as error:
        abort(f"cannot read owned fixture manifest: {error}")
    expected = {
        "fixture": FIXTURE_NAME,
        "version": FIXTURE_VERSION,
        "provenance": provenance_digest(marker()),
        "tracks": TRACK_COUNT,
        "history": HISTORY_COUNT,
        "moods": list(MOODS),
        "genres": list(GENRES),
    }
    if manifest != expected:
        abort("fixture manifest does not belong to this marker and fixed catalogue")
    return manifest


def node_program() -> str:
    return f"""
        import * as db from {json.dumps(LIBRARY_MODULE)};

        const moods = ['night', 'calm', 'driving', 'bright'];
        const genres = ['Electronic', 'Ambient', 'House'];
        const tracks = Array.from({{ length: {TRACK_COUNT} }}, (_, offset) => {{
          const n = offset + 1;
          return {{
            id: `verify-track-${{n}}`,
            title: n <= 53 ? `Love Verify Track ${{n}}` : `Verify Track ${{n}}`,
            artist: `Verify Artist ${{n}}`,
            album: `Task Five Fixture Volume ${{Math.ceil(n / 20)}}`,
            albumId: `verify-album-${{Math.ceil(n / 20)}}`,
            artistId: `verify-artist-${{n}}`,
            duration: 180 + n,
            genres: [genres[(n - 1) % genres.length]],
            moods: n % 2 ? [moods[0], moods[1]] : [moods[2], moods[3]],
            energy: n % 3 === 0 ? 'high' : 'medium',
          }};
        }});

        await db.open({{ embeddingDim: 768, adoptStoredDim: true }});
        for (const track of tracks) {{
          db.upsertTrackMeta(track.id, track);
          db.upsertTrackTags(track.id, {{
            moods: track.moods,
            energy: track.energy,
            source: 'manual',
            confidence: 1,
          }});
        }}
        const base = Date.parse('2026-08-26T12:00:00.000Z');
        for (let index = 0; index < {HISTORY_COUNT}; index += 1) {{
          const track = tracks[index];
          db.recordPlay({{
            trackId: track.id,
            title: track.title,
            artist: track.artist,
            album: track.album,
            playedAt: new Date(base - index * 60_000).toISOString(),
            source: 'auto',
            requestedBy: null,
            showId: null,
            showName: null,
          }});
        }}
        db.close();
        console.log(JSON.stringify({{ tracks: tracks.length, history: {HISTORY_COUNT} }}));
    """


def seed() -> None:
    value = marker()
    directory = state_dir()
    if os.environ.get(CREATE_OPT_IN) != "1":
        abort(f"set {CREATE_OPT_IN}=1 only for a fresh task-owned state directory")
    if directory.exists() and any(directory.iterdir()):
        abort(f"{directory} is not empty; refusing to overwrite existing state or library.db")
    directory.mkdir(parents=True, exist_ok=True)
    home = directory / ".fixture-home"
    tmp = directory / ".fixture-tmp"
    home.mkdir()
    tmp.mkdir()
    env = {
        "PATH": os.environ.get("PATH", ""),
        # The seeding Node process receives no caller HOME/TMPDIR, so it
        # cannot inherit user config or credential-bearing cache locations.
        "HOME": str(home),
        "TMPDIR": str(tmp),
        "STATE_DIR": str(directory),
        "NEXT_TELEMETRY_DISABLED": "1",
    }
    result = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "--eval", node_program()],
        cwd=REPO,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise SystemExit(result.stdout + result.stderr)
    manifest = {
        "fixture": FIXTURE_NAME,
        "version": FIXTURE_VERSION,
        "provenance": provenance_digest(value),
        "tracks": TRACK_COUNT,
        "history": HISTORY_COUNT,
        "moods": list(MOODS),
        "genres": list(GENRES),
    }
    path = manifest_path(directory)
    path.write_text(json.dumps(manifest, sort_keys=True) + "\n", encoding="utf-8")
    path.chmod(0o600)
    print(f"seeded owned library fixture: {TRACK_COUNT} tracks, {HISTORY_COUNT} plays")


def main() -> None:
    if sys.argv[1:] == ["seed"]:
        seed()
    elif sys.argv[1:] == ["assert"]:
        assert_owned_fixture()
        print("owned library fixture attested")
    else:
        raise SystemExit(f"usage: {Path(__file__).name} seed|assert")


if __name__ == "__main__":
    main()

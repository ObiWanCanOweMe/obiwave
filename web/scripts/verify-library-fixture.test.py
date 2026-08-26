"""Contract tests for the owned, deterministic library verifier fixture."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPTS_DIR = Path(__file__).resolve().parent
REPO = SCRIPTS_DIR.parents[1]
HELPER = SCRIPTS_DIR / "verify-library-fixture.py"
NODE = Path("/opt/homebrew/opt/node@22/bin/node")
MARKER = "subwave-verify-11111111-1111-1111-1111-111111111111"


def fixture_env(state_dir: Path) -> dict[str, str]:
    return {
        "PATH": "/opt/homebrew/opt/node@22/bin:/usr/bin:/bin",
        "HOME": str(state_dir.parent / "home"),
        "TMPDIR": str(state_dir.parent / "tmp"),
        "STATE_DIR": str(state_dir),
        "SUBWAVE_VERIFY_STATE_DIR": str(state_dir),
        "SUBWAVE_VERIFY_PROVENANCE": MARKER,
        "SUBWAVE_VERIFY_ALLOW_STATE_CREATE": "1",
    }


class LibraryFixtureContractTest(unittest.TestCase):
    def test_seed_creates_the_fixed_catalogue_and_history_pages(self):
        self.assertTrue(HELPER.is_file(), "shared verifier fixture helper is missing")
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp) / "subwave-verify-state"
            env = fixture_env(state_dir)
            seeded = subprocess.run(
                [sys.executable, str(HELPER), "seed"],
                cwd=REPO,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(seeded.returncode, 0, seeded.stdout + seeded.stderr)

            program = f"""
                import * as db from {json.dumps((REPO / 'controller/src/music/library-db.ts').as_uri())};
                await db.open({{ embeddingDim: 768, adoptStoredDim: true }});
                const tracks = db.filter({{ limit: 100, sort: 'title' }});
                const historyFirst = db.listPlays({{ limit: 50, offset: 0 }});
                const historySecond = db.listPlays({{ limit: 50, offset: 50 }});
                console.log(JSON.stringify({{
                  total: tracks.total,
                  rows: tracks.rows.length,
                  firstTitle: tracks.rows[0]?.title,
                  moods: [...new Set(tracks.rows.flatMap(track => track.moods || []))].sort(),
                  genres: [...new Set(tracks.rows.flatMap(track => track.genres || []))].sort(),
                  historyTotal: historyFirst.total,
                  historyFirst: historyFirst.rows.length,
                  historySecond: historySecond.rows.length,
                }}));
                db.close();
            """
            checked = subprocess.run(
                [str(NODE), "--import", "tsx", "--input-type=module", "--eval", program],
                cwd=REPO,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(checked.returncode, 0, checked.stdout + checked.stderr)
            actual = json.loads(checked.stdout)
            self.assertEqual(actual["total"], 60)
            self.assertEqual(actual["rows"], 60)
            self.assertEqual(actual["firstTitle"], "Love Verify Track 1")
            self.assertEqual(actual["moods"], ["bright", "calm", "driving", "night"])
            self.assertEqual(actual["genres"], ["Ambient", "Electronic", "House"])
            self.assertEqual(actual["historyTotal"], 60)
            self.assertEqual(actual["historyFirst"], 50)
            self.assertEqual(actual["historySecond"], 10)

    def test_seed_refuses_to_overwrite_an_existing_library_database(self):
        self.assertTrue(HELPER.is_file(), "shared verifier fixture helper is missing")
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp) / "subwave-verify-state"
            state_dir.mkdir()
            foreign = state_dir / "library.db"
            foreign.write_bytes(b"not-a-verifier-fixture")
            seeded = subprocess.run(
                [sys.executable, str(HELPER), "seed"],
                cwd=REPO,
                env=fixture_env(state_dir),
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(seeded.returncode, 0)
            self.assertEqual(foreign.read_bytes(), b"not-a-verifier-fixture")

    def test_assert_refuses_a_fixture_bound_to_another_marker(self):
        with tempfile.TemporaryDirectory() as tmp:
            state_dir = Path(tmp) / "subwave-verify-state"
            env = fixture_env(state_dir)
            seeded = subprocess.run(
                [sys.executable, str(HELPER), "seed"],
                cwd=REPO,
                env=env,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(seeded.returncode, 0, seeded.stdout + seeded.stderr)

            other_run = {
                **env,
                "SUBWAVE_VERIFY_PROVENANCE": "subwave-verify-22222222-2222-2222-2222-222222222222",
            }
            asserted = subprocess.run(
                [sys.executable, str(HELPER), "assert"],
                cwd=REPO,
                env=other_run,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(asserted.returncode, 0)
            self.assertIn("does not belong to this marker", asserted.stdout + asserted.stderr)


if __name__ == "__main__":
    unittest.main()

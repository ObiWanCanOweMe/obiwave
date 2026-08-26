"""Ownership regressions for verify-forms.py's spawned-stack cleanup."""

import importlib.util
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock


SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))
SPEC = importlib.util.spec_from_file_location(
    "verify_forms", SCRIPTS_DIR / "verify-forms.py"
)
VERIFY_FORMS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY_FORMS)

LISTENER = """
import socket
import sys

sock = socket.socket()
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(("127.0.0.1", int(sys.argv[1])))
sock.listen()
while True:
    conn, _ = sock.accept()
    conn.close()
"""


def free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def wait_for_port(port, listening, timeout=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        sock = socket.socket()
        sock.settimeout(0.1)
        is_listening = sock.connect_ex(("127.0.0.1", port)) == 0
        sock.close()
        if is_listening == listening:
            return
        time.sleep(0.02)
    raise AssertionError(
        f"port {port} did not become {'open' if listening else 'closed'}"
    )


def stop_group(proc):
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


class SpawnedCleanupOwnershipTest(unittest.TestCase):
    def test_finished_wrapper_never_signals_listener_that_reused_its_port(self):
        """Removing the process-group cleanup must let broad port killing recur."""
        port = free_port()
        finished = subprocess.Popen(
            [sys.executable, "-c", "pass"], start_new_session=True
        )
        finished.wait(timeout=5)
        unrelated = subprocess.Popen(
            [sys.executable, "-c", LISTENER, str(port)], start_new_session=True
        )
        try:
            wait_for_port(port, True)
            # Give the current broad-port implementation a controlled lsof
            # result while still asserting the behavior of a real listener.
            # This keeps the regression deterministic on hosts whose fuser
            # cannot signal macOS TCP listeners.
            with tempfile.TemporaryDirectory() as tool_dir:
                lsof = Path(tool_dir) / "lsof"
                lsof.write_text(f"#!/bin/sh\nprintf '%s\\n' {unrelated.pid}\n")
                lsof.chmod(0o755)
                old_path = os.environ.get("PATH", "")
                os.environ["PATH"] = f"{tool_dir}:{old_path}"
                try:
                    VERIFY_FORMS._stop_spawned_process(finished, port)
                finally:
                    os.environ["PATH"] = old_path
            wait_for_port(port, True, timeout=1)
            self.assertIsNone(
                unrelated.poll(),
                "cleanup signalled the unrelated listener that later reused the port",
            )
        finally:
            stop_group(unrelated)
            wait_for_port(port, False)

    def test_finished_wrapper_still_stops_its_original_group_descendant(self):
        """Cleanup owns descendants through the wrapper's original process group."""
        port = free_port()
        wrapper = subprocess.Popen(
            [
                sys.executable,
                "-c",
                (
                    "import subprocess,sys; "
                    "subprocess.Popen([sys.executable, '-c', sys.argv[1], sys.argv[2]])"
                ),
                LISTENER,
                str(port),
            ],
            start_new_session=True,
        )
        try:
            wrapper.wait(timeout=5)
            wait_for_port(port, True)
            VERIFY_FORMS._stop_spawned_process(wrapper, port)
            wait_for_port(port, False)
        finally:
            stop_group(wrapper)


class OnboardingGeneratedFileCleanupTest(unittest.TestCase):
    def test_error_cleanup_preserves_concurrent_generated_file_edits(self):
        """The real onboarding finally path must not reset another writer's files.

        A temporary Git repository makes the old `git checkout -- …` behavior
        observable without ever editing this worktree.  The controller launch
        is intentionally pointed at an empty directory and `_wait_http` fails
        immediately, so this drives the onboarding ERROR cleanup path before a
        browser or a second web server starts.
        """
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)
            web_dir = repo / "web"
            controller_dir = repo / "controller"
            web_dir.mkdir()
            controller_dir.mkdir()
            tsconfig = web_dir / "tsconfig.json"
            next_env = web_dir / "next-env.d.ts"
            tsconfig.write_bytes(b'{"compilerOptions":{"strict":true}}\n')
            next_env.write_bytes(b'/// <reference types="next" />\n')
            tsconfig.chmod(0o644)
            next_env.chmod(0o644)
            subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
            subprocess.run(["git", "add", "web/tsconfig.json", "web/next-env.d.ts"], cwd=repo, check=True)
            subprocess.run(
                [
                    "git", "-c", "user.name=Verifier", "-c", "user.email=verifier@example.invalid",
                    "commit", "-qm", "fixture baseline",
                ],
                cwd=repo,
                check=True,
            )

            # Sentinel edits represent another author changing these files
            # while onboarding owns only its temporary Next process.
            tsconfig.write_bytes(b'// concurrent tsconfig sentinel\n')
            tsconfig.chmod(0o640)
            next_env.unlink()

            with mock.patch.object(VERIFY_FORMS, "WEB_DIR", web_dir), \
                 mock.patch.object(VERIFY_FORMS, "CONTROLLER_DIR", controller_dir), \
                 mock.patch.object(
                     VERIFY_FORMS,
                     "_wait_http",
                     side_effect=RuntimeError("forced onboarding startup failure"),
                 ):
                with self.assertRaisesRegex(RuntimeError, "forced onboarding startup failure"):
                    VERIFY_FORMS.onboarding(None)

            self.assertEqual(tsconfig.read_bytes(), b'// concurrent tsconfig sentinel\n')
            self.assertEqual(tsconfig.stat().st_mode & 0o777, 0o640)
            self.assertFalse(next_env.exists(), "cleanup recreated another writer's deleted file")


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Lightweight strict-device integration tests for Chatterbox + tts-heavy.

Runs the real worker and real sidecar supervisor with tiny fake dependency
modules. No torch, model weights, FastAPI, or network access are required.
"""

import asyncio
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "controller" / "scripts" / "chatterbox_worker.py"
SERVER = ROOT / "docker" / "tts-heavy" / "server.py"


def load_sidecar_module():
    fastapi = types.ModuleType("fastapi")

    class FastAPI:
        def __init__(self, *args, **kwargs):
            pass

        def get(self, *args, **kwargs):
            return lambda function: function

        def post(self, *args, **kwargs):
            return lambda function: function

    class HTTPException(Exception):
        def __init__(self, status_code, detail):
            super().__init__(detail)
            self.status_code = status_code

    pydantic = types.ModuleType("pydantic")

    class BaseModel:
        pass

    fastapi.FastAPI = FastAPI
    fastapi.HTTPException = HTTPException
    pydantic.BaseModel = BaseModel
    sys.modules["fastapi"] = fastapi
    sys.modules["pydantic"] = pydantic

    os.environ["TTS_HEAVY_DEVICE"] = "cuda"
    os.environ["TTS_HEAVY_STRICT_DEVICE"] = "1"
    spec = importlib.util.spec_from_file_location("tts_heavy_server_strict_test", SERVER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SIDECAR = load_sidecar_module()


def write_fake_dependencies(directory: Path):
    (directory / "numpy.py").write_text("", encoding="utf-8")
    (directory / "soundfile.py").write_text("", encoding="utf-8")
    (directory / "librosa.py").write_text("", encoding="utf-8")
    (directory / "torch.py").write_text(
        """\
import os
from pathlib import Path

attempt_file = Path(os.environ["CUDA_ATTEMPT_FILE"])
attempt = int(attempt_file.read_text() or "0") if attempt_file.exists() else 0
attempt_file.write_text(str(attempt + 1))
sequence = [part == "1" for part in os.environ.get("CUDA_SEQUENCE", "0").split(",")]
available = sequence[min(attempt, len(sequence) - 1)]

class _Cuda:
    @staticmethod
    def is_available():
        return available

cuda = _Cuda()
""",
        encoding="utf-8",
    )
    chatterbox = directory / "chatterbox"
    chatterbox.mkdir()
    (chatterbox / "__init__.py").write_text("", encoding="utf-8")
    (chatterbox / "tts_turbo.py").write_text(
        """\
import os
from pathlib import Path

class _Model:
    sr = 24000

class ChatterboxTurboTTS:
    @staticmethod
    def from_pretrained(device):
        marker = Path(os.environ["MODEL_LOAD_FILE"])
        with marker.open("a", encoding="utf-8") as handle:
            handle.write(device + "\\n")
        return _Model()
""",
        encoding="utf-8",
    )


def worker_env(directory: Path, *, strict: bool, sequence: str):
    attempt_file = directory / "attempts"
    model_file = directory / "model-loads"
    return {
        **os.environ,
        "PYTHONPATH": str(directory),
        "CHATTERBOX_DEVICE": "cuda",
        "CHATTERBOX_STRICT_DEVICE": "1" if strict else "0",
        "CUDA_ATTEMPT_FILE": str(attempt_file),
        "CUDA_SEQUENCE": sequence,
        "MODEL_LOAD_FILE": str(model_file),
    }, attempt_file, model_file


def protocol_messages(stdout: str):
    messages = []
    for line in stdout.splitlines():
        try:
            messages.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return messages


class StrictWorkerStartTest(unittest.TestCase):
    def test_strict_cuda_failure_is_fatal_before_cpu_model_load_or_ready(self):
        with tempfile.TemporaryDirectory(prefix="subwave-strict-worker-") as raw:
            directory = Path(raw)
            write_fake_dependencies(directory)

            portable_env, attempt_file, model_file = worker_env(
                directory, strict=False, sequence="0",
            )
            portable = subprocess.run(
                [sys.executable, str(WORKER)],
                input="",
                capture_output=True,
                text=True,
                env=portable_env,
                check=False,
            )
            self.assertEqual(portable.returncode, 0, portable.stderr)
            self.assertIn(
                {"id": None, "ready": True, "device": "cpu"},
                protocol_messages(portable.stdout),
            )
            self.assertEqual(model_file.read_text().splitlines(), ["cpu"])

            attempt_file.write_text("0", encoding="utf-8")
            model_file.unlink()
            strict_env, _, _ = worker_env(directory, strict=True, sequence="0")
            strict = subprocess.run(
                [sys.executable, str(WORKER)],
                input="",
                capture_output=True,
                text=True,
                env=strict_env,
                check=False,
            )
            messages = protocol_messages(strict.stdout)
            self.assertNotEqual(strict.returncode, 0)
            self.assertTrue(any(message.get("fatal") is True for message in messages), messages)
            self.assertFalse(any(message.get("ready") is True for message in messages), messages)
            self.assertFalse(model_file.exists(), "strict CUDA loss must not load a CPU model")


async def wait_until(predicate, timeout=3.0):
    deadline = asyncio.get_running_loop().time() + timeout
    while not predicate():
        if asyncio.get_running_loop().time() >= deadline:
            raise AssertionError("timed out waiting for supervised worker state")
        await asyncio.sleep(0.01)


class StrictSupervisorRestartTest(unittest.IsolatedAsyncioTestCase):
    async def test_supervised_restart_reapplies_strict_cuda_during_loss_race(self):
        with tempfile.TemporaryDirectory(prefix="subwave-strict-supervisor-") as raw:
            directory = Path(raw)
            write_fake_dependencies(directory)
            env, attempt_file, model_file = worker_env(directory, strict=True, sequence="1,0")
            inherited = dict(SIDECAR.chatterbox_worker.env_extra)
            inherited.update({
                "PYTHONPATH": env["PYTHONPATH"],
                "CUDA_ATTEMPT_FILE": env["CUDA_ATTEMPT_FILE"],
                "CUDA_SEQUENCE": env["CUDA_SEQUENCE"],
                "MODEL_LOAD_FILE": env["MODEL_LOAD_FILE"],
            })
            worker = SIDECAR.TtsWorker(
                "chatterbox-test",
                sys.executable,
                str(WORKER),
                env_extra=inherited,
            )
            worker.RUN_BACKOFF_S = 0.01
            worker.START_BACKOFF_S = 60.0
            supervisor = asyncio.create_task(worker.run())
            try:
                await wait_until(lambda: worker.ready)
                self.assertEqual(worker.ready_meta.get("device"), "cuda")
                first = worker.proc
                first.terminate()
                await wait_until(
                    lambda: attempt_file.exists() and int(attempt_file.read_text() or "0") >= 2,
                )
                await asyncio.sleep(0.05)
                self.assertFalse(worker.ready)
                self.assertEqual(
                    model_file.read_text().splitlines(),
                    ["cuda"],
                    "the supervised replacement must never load Chatterbox on CPU",
                )
            finally:
                supervisor.cancel()
                await asyncio.gather(supervisor, return_exceptions=True)


if __name__ == "__main__":
    unittest.main(verbosity=2)

"""Focused regression tests for the destructive verifier provenance guard."""

import importlib.util
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import unittest
from urllib.parse import urlparse


SCRIPTS_DIR = Path(__file__).resolve().parent
PROVENANCE_ENV = "SUBWAVE_VERIFY_PROVENANCE"
ALLOW_DESTRUCTIVE_ENV = "SUBWAVE_VERIFY_ALLOW_DESTRUCTIVE"
EXPECTED_MARKER = "subwave-verify-8de7ba8b-17f5-4d89-9f34-e0f625529b11"
EXPECTED_CONTROLLER_ATTESTATION = "38da5b3c3d40ccea2a9ac5188f0ab9edc55b7b2d9b0d42ea95b2b683b781ca9a"
EXPECTED_BACKEND_ATTESTATION = "185e93a687fce26d6a7cf4cdf0128ce7221ac6e5e4ab5be267ec6ed5614c9fb6"
OTHER_MARKER = "subwave-verify-333ca2f4-f8e3-4a59-a3df-c40105210611"
OTHER_CONTROLLER_ATTESTATION = "825d07a111bfa1b093942aaf2aaa1359108ea4bf889d0f99be74339c4e0e4319"


def load_verifier(module_name, filename):
    spec = importlib.util.spec_from_file_location(module_name, SCRIPTS_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class VerifyControllerHandler(BaseHTTPRequestHandler):
    backend_marker = OTHER_MARKER
    proxied_subsonic_requests = 0
    mutation_requests = 0

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/health":
            attestations = {
                EXPECTED_MARKER: EXPECTED_CONTROLLER_ATTESTATION,
                OTHER_MARKER: OTHER_CONTROLLER_ATTESTATION,
            }
            payload = {
                "status": "on-air",
                "verifyProvenance": attestations.get(self.backend_marker),
            }
        elif url.path == "/library/browse":
            payload = {"rows": [{"id": "isolated-fixture"}]}
        elif url.path == "/settings":
            payload = {"values": {"personas": [
                {"name": "Marlowe"}, {"name": "Wren"}, {"name": "Hale"},
            ]}}
        elif url.path == "/dj/search":
            type(self).proxied_subsonic_requests += 1
            payload = {"error": "provenance must not proxy to Subsonic"}
        else:
            self.send_error(404)
            return

        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        type(self).mutation_requests += 1
        self.send_error(500)

    def log_message(self, _format, *_args):
        pass


class DummyBackendHandler(BaseHTTPRequestHandler):
    backend_marker = OTHER_MARKER

    def do_GET(self):
        url = urlparse(self.path)
        if url.path != "/__subwave_verify_provenance":
            self.send_error(404)
            return
        attestations = {EXPECTED_MARKER: EXPECTED_BACKEND_ATTESTATION}
        body = json.dumps({
            "verifyProvenance": attestations.get(self.backend_marker),
        }).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        pass


class VerifierProvenanceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 7791), VerifyControllerHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.backend_server = ThreadingHTTPServer(("127.0.0.1", 9999), DummyBackendHandler)
        cls.backend_thread = threading.Thread(target=cls.backend_server.serve_forever, daemon=True)
        cls.backend_thread.start()
        cls.verifiers = [
            load_verifier("verify_admin_query", "verify-admin-query.py"),
            load_verifier("verify_forms", "verify-forms.py"),
            load_verifier("verify_library", "verify-library.py"),
            load_verifier("verify_query_cache", "verify-query-cache.py"),
        ]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        cls.backend_server.shutdown()
        cls.backend_server.server_close()
        cls.backend_thread.join(timeout=5)

    def setUp(self):
        self.previous_marker = os.environ.get(PROVENANCE_ENV)
        self.previous_allow_destructive = os.environ.get(ALLOW_DESTRUCTIVE_ENV)
        os.environ[ALLOW_DESTRUCTIVE_ENV] = "1"
        VerifyControllerHandler.proxied_subsonic_requests = 0
        VerifyControllerHandler.mutation_requests = 0

    def tearDown(self):
        if self.previous_marker is None:
            os.environ.pop(PROVENANCE_ENV, None)
        else:
            os.environ[PROVENANCE_ENV] = self.previous_marker
        if self.previous_allow_destructive is None:
            os.environ.pop(ALLOW_DESTRUCTIVE_ENV, None)
        else:
            os.environ[ALLOW_DESTRUCTIVE_ENV] = self.previous_allow_destructive
        self.assertEqual(
            VerifyControllerHandler.proxied_subsonic_requests,
            0,
            "provenance guard contacted a controller route that proxies to Subsonic",
        )
        self.assertEqual(
            VerifyControllerHandler.mutation_requests,
            0,
            "a verifier mutation ran before both provenance attestations passed",
        )

    def test_each_verifier_rejects_a_mismatched_controller_attestation(self):
        os.environ[PROVENANCE_ENV] = EXPECTED_MARKER
        VerifyControllerHandler.backend_marker = OTHER_MARKER
        DummyBackendHandler.backend_marker = EXPECTED_MARKER

        for verifier in self.verifiers:
            with self.subTest(verifier=verifier.__name__):
                with self.assertRaisesRegex(SystemExit, "verifier provenance"):
                    verifier.assert_throwaway_stack()

    def test_each_verifier_rejects_a_mismatched_dummy_backend_attestation(self):
        os.environ[PROVENANCE_ENV] = EXPECTED_MARKER
        VerifyControllerHandler.backend_marker = EXPECTED_MARKER
        DummyBackendHandler.backend_marker = OTHER_MARKER

        for verifier in self.verifiers:
            with self.subTest(verifier=verifier.__name__):
                with self.assertRaisesRegex(SystemExit, "dummy Subsonic provenance"):
                    verifier.assert_throwaway_stack()

    def test_each_verifier_rejects_a_missing_task_unique_marker(self):
        os.environ.pop(PROVENANCE_ENV, None)
        VerifyControllerHandler.backend_marker = EXPECTED_MARKER
        DummyBackendHandler.backend_marker = EXPECTED_MARKER

        for verifier in self.verifiers:
            with self.subTest(verifier=verifier.__name__):
                with self.assertRaisesRegex(SystemExit, PROVENANCE_ENV):
                    verifier.assert_throwaway_stack()

    def test_each_verifier_accepts_only_the_matching_dummy_backend(self):
        os.environ[PROVENANCE_ENV] = EXPECTED_MARKER
        VerifyControllerHandler.backend_marker = EXPECTED_MARKER
        DummyBackendHandler.backend_marker = EXPECTED_MARKER

        for verifier in self.verifiers:
            with self.subTest(verifier=verifier.__name__):
                verifier.assert_throwaway_stack()


if __name__ == "__main__":
    unittest.main()

"""Fail-closed provenance guard shared by destructive web verifiers."""

import hashlib
import json
import os
import re
import sys
import urllib.request


PROVENANCE_ENV = "SUBWAVE_VERIFY_PROVENANCE"
PROVENANCE_RE = re.compile(
    r"^subwave-verify-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)
DUMMY_SUBSONIC_URL = "http://127.0.0.1:9999"
DUMMY_PROVENANCE_URL = f"{DUMMY_SUBSONIC_URL}/__subwave_verify_provenance"


def assert_dummy_backend_provenance(health):
    """Prove controller launch config and the local dummy backend share a marker.

    Controller startup rejects a valid verifier marker unless Navidrome is the
    fixed loopback stub. Its health response attests that launch configuration;
    a separate local-only endpoint attests the cooperating stub. No controller
    route that proxies to Subsonic is called by this guard.
    """
    marker = os.environ.get(PROVENANCE_ENV, "").strip()
    if not PROVENANCE_RE.fullmatch(marker):
        sys.exit(
            f"refusing to run: {PROVENANCE_ENV} must be a fresh "
            "subwave-verify-<uuid> marker shared only with the dummy Subsonic backend"
        )

    expected_controller = hashlib.sha256(
        f"subwave-controller-verifier\0{marker}\0{DUMMY_SUBSONIC_URL}".encode()
    ).hexdigest()
    if not isinstance(health, dict) or health.get("verifyProvenance") != expected_controller:
        sys.exit("refusing to run: controller verifier provenance did not match this run")

    expected_backend = hashlib.sha256(
        f"subwave-dummy-backend\0{marker}".encode()
    ).hexdigest()
    try:
        with urllib.request.urlopen(DUMMY_PROVENANCE_URL, timeout=3) as response:
            payload = json.loads(response.read())
    except Exception as error:
        sys.exit(f"refusing to run: dummy Subsonic provenance challenge failed: {error}")
    if not isinstance(payload, dict) or payload.get("verifyProvenance") != expected_backend:
        sys.exit("refusing to run: dummy Subsonic provenance did not match this verifier run")

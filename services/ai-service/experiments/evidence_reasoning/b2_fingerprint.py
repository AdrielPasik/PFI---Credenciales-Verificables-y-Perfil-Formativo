from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


MODULE_ROOT = Path(__file__).resolve().parent
SERVICE_ROOT = MODULE_ROOT.parents[1]

BEHAVIOR_FILES = (
    "b2_versions.py",
    "b2_schemas.py",
    "b2_aligner.py",
    "b2_prompts.py",
    "b2_artifacts.py",
    "b2_validation.py",
    "b2_policy.py",
    "b2_renderer.py",
    "b2_runtime.py",
    "b2_evaluation.py",
    "b2_fingerprint.py",
    "cli.py",
    "local_env.py",
    "providers.py",
    "extraction.py",
    "policy.py",
    "schemas.py",
    "models.py",
    "fixtures.py",
    "gold.py",
    "evaluation.py",
    "versions.py",
    "fixtures/inputs/seed_v0_inputs.json",
    "fixtures/gold/seed_v0_gold.json",
)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def b2_behavior_fingerprint() -> dict[str, Any]:
    files = [
        {"path": relative, "sha256": _sha256(MODULE_ROOT / relative)}
        for relative in BEHAVIOR_FILES
    ]
    combined = hashlib.sha256(
        json.dumps(files, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return {
        "fingerprintSchemaVersion": "b2_behavior_fingerprint_v1",
        "combinedSha256": combined,
        "files": files,
    }

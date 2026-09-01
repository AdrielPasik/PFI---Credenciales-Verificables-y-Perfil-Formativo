from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

FILES = (
    "b24_versions.py",
    "b24_schemas.py",
    "b24_artifacts.py",
    "b24_prompts.py",
    "b24_validation.py",
    "b24_policy.py",
    "b24_renderer.py",
    "b24_runtime.py",
    "b24_evaluation.py",
    "b24_fingerprint.py",
    "b24_cli.py",
    "b2_aligner.py",
    "b2_artifacts.py",
    "b2_prompts.py",
    "b2_schemas.py",
    "extraction.py",
    "providers.py",
    "local_env.py",
    "fixtures.py",
    "gold.py",
    "policy.py",
    "models.py",
    "schemas.py",
    "fixtures/inputs/seed_v0_inputs.json",
    "fixtures/gold/seed_v0_gold.json",
)


def b24_behavior_fingerprint() -> dict[str, object]:
    files = [{"path": name, "sha256": hashlib.sha256((ROOT / name).read_bytes()).hexdigest()} for name in FILES]
    return {
        "fingerprintSchemaVersion": "b24_behavior_fingerprint_v1",
        "combinedSha256": hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
        "files": files,
    }

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# The successor's behavior surface is B2.4's, plus the two b241 modules that
# express the restoration. Every B2.4 semantic module is included because it is
# imported unchanged and therefore still behavior-defining here.
FILES = (
    "b241_versions.py",
    "b241_prompts.py",
    "b241_runtime.py",
    "b241_fingerprint.py",
    "b24_versions.py",
    "b24_schemas.py",
    "b24_artifacts.py",
    "b24_prompts.py",
    "b24_validation.py",
    "b24_policy.py",
    "b24_renderer.py",
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


def b241_behavior_fingerprint() -> dict[str, object]:
    files = [{"path": name, "sha256": hashlib.sha256((ROOT / name).read_bytes()).hexdigest()} for name in FILES]
    return {
        "fingerprintSchemaVersion": "b241_behavior_fingerprint_v1",
        "combinedSha256": hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
        "files": files,
    }

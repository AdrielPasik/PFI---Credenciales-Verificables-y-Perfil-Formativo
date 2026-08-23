from __future__ import annotations

import hashlib, json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
FILES = ("b21_versions.py", "b21_schemas.py", "b21_prompts.py", "b21_artifacts.py", "b21_validation.py", "b21_policy.py", "b21_renderer.py", "b21_runtime.py", "b21_evaluation.py", "b21_fingerprint.py", "b21_cli.py", "b2_aligner.py", "b2_artifacts.py", "local_env.py", "providers.py", "extraction.py", "policy.py", "schemas.py", "fixtures.py", "gold.py", "fixtures/inputs/seed_v0_inputs.json", "fixtures/gold/seed_v0_gold.json")
def b21_behavior_fingerprint() -> dict[str, Any]:
    files=[{"path": item, "sha256": hashlib.sha256((ROOT/item).read_bytes()).hexdigest()} for item in FILES]
    return {"fingerprintSchemaVersion": "b21_behavior_fingerprint_v1", "combinedSha256": hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest(), "files": files}

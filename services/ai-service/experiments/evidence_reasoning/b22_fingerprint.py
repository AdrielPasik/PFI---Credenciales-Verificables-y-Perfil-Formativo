from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FILES = ("b22_versions.py", "b22_schemas.py", "b22_artifacts.py", "b22_prompts.py", "b22_validation.py", "b22_policy.py", "b22_renderer.py", "b22_runtime.py", "b22_evaluation.py", "b22_fingerprint.py", "b22_cli.py", "b2_aligner.py", "b2_artifacts.py", "b2_prompts.py", "extraction.py", "providers.py", "local_env.py", "fixtures.py", "gold.py", "policy.py", "models.py", "schemas.py", "fixtures/inputs/seed_v0_inputs.json", "fixtures/gold/seed_v0_gold.json")

def b22_behavior_fingerprint() -> dict[str, object]:
    files = [{"path": name, "sha256": hashlib.sha256((ROOT / name).read_bytes()).hexdigest()} for name in FILES]
    return {"fingerprintSchemaVersion": "b22_behavior_fingerprint_v1", "combinedSha256": hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest(), "files": files}

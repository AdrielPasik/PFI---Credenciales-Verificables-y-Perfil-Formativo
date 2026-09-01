from __future__ import annotations
import hashlib, json
from pathlib import Path
ROOT = Path(__file__).resolve().parent
FILES = ("b23_versions.py", "b23_schemas.py", "b23_artifacts.py", "b23_prompts.py", "b23_validation.py", "b23_policy.py", "b23_renderer.py", "b23_runtime.py", "b23_evaluation.py", "b23_fingerprint.py", "b23_cli.py", "b2_aligner.py", "b2_artifacts.py", "b2_prompts.py", "extraction.py", "providers.py", "local_env.py", "fixtures.py", "gold.py", "policy.py", "models.py", "schemas.py", "fixtures/inputs/seed_v0_inputs.json", "fixtures/gold/seed_v0_gold.json")
def b23_behavior_fingerprint() -> dict[str, object]:
    files = [{"path": name, "sha256": hashlib.sha256((ROOT / name).read_bytes()).hexdigest()} for name in FILES]
    return {"fingerprintSchemaVersion": "b23_behavior_fingerprint_v1", "combinedSha256": hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest(), "files": files}

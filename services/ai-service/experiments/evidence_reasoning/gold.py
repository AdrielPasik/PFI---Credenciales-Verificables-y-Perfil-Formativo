from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .versions import VERSIONS

GOLD_PATH = Path(__file__).resolve().parent / "fixtures" / "gold" / "seed_v0_gold.json"


def load_gold() -> dict[str, dict[str, Any]]:
    payload = json.loads(GOLD_PATH.read_text(encoding="utf-8"))
    if payload["datasetVersion"] != VERSIONS["seedDataset"]:
        raise ValueError("gold_dataset_version_mismatch")
    return {item["caseId"]: item for item in payload["cases"]}


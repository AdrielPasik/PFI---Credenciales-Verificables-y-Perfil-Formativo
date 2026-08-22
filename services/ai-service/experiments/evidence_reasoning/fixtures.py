from __future__ import annotations

import json
from pathlib import Path
from .models import FixtureCase, SourceInput
from .versions import VERSIONS

ROOT = Path(__file__).resolve().parent / "fixtures"
INPUT_PATH = ROOT / "inputs" / "seed_v0_inputs.json"


def load_cases(*, split: str = "all", case_ids: set[str] | None = None) -> list[FixtureCase]:
    payload = json.loads(INPUT_PATH.read_text(encoding="utf-8"))
    if payload["datasetVersion"] != VERSIONS["seedDataset"]:
        raise ValueError("fixture_dataset_version_mismatch")
    cases: list[FixtureCase] = []
    for raw in payload["cases"]:
        if split != "all" and raw["split"] != split:
            continue
        if case_ids and raw["caseId"] not in case_ids:
            continue
        sources = tuple(
            SourceInput(
                source_id=item["sourceId"],
                credential_id=item["credentialId"],
                evidence_type=item["evidenceType"],
                content=item["content"],
                coverage_status=item["coverageStatus"],
                source_provenance=item["sourceProvenance"],
                lineage_id=item.get("lineageId"),
                technically_verified=bool(item.get("technicallyVerified", False)),
                diagnostics=tuple(item.get("diagnostics", [])),
            )
            for item in raw["sources"]
        )
        cases.append(FixtureCase(raw["caseId"], raw["split"], raw["domain"], raw["objective"], sources))
    return cases


def assert_input_gold_isolation() -> None:
    raw = INPUT_PATH.read_text(encoding="utf-8")
    forbidden = ["expectedState", "expectedRelations", "expectedClaimCeiling", "phenomenon"]
    leaked = [name for name in forbidden if name in raw]
    if leaked:
        raise AssertionError(f"gold_fields_leaked_into_model_input:{','.join(leaked)}")


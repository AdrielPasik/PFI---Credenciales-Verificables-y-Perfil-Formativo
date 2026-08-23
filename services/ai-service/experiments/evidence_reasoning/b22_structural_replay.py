from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def b21_structural_compatibility_replay(b21_runs: Path) -> dict[str, Any]:
    payload = json.loads(b21_runs.read_text(encoding="utf-8")); facet_runs = qualifier = direct_basis = discontinuous = 0; incompatible: list[dict[str, Any]] = []
    for run in payload["runs"]:
        for reasoning in run["05_unified_contextual_reasoning"]:
            facets = reasoning.get("facets", []); keys = [item.get("localFacetKey") for item in facets]
            if not keys: continue
            refs = reasoning["compositionAssessment"].get("missingFacetKeys", []) + reasoning["fullClaimAssessment"].get("coveredFacetKeys", []) + reasoning["fullClaimAssessment"].get("missingFacetKeys", []) + (reasoning.get("weakerClaimCandidate") or {}).get("droppedFacetKeys", [])
            if any(item["code"] == "FACET_REFERENCES_EXIST" and item["status"] in {"FAIL", "REJECTED"} for item in run["06_validation_repair"]):
                facet_runs += 1
                valid = len(keys) == len(set(keys)) and set(refs) <= set(keys)
                if not valid: incompatible.append({"caseId": run["metadata"]["caseId"], "repetition": run["metadata"].get("repetition"), "localKeys": keys, "references": refs})
    for item in payload["runs"]:
        qualifier += sum(validation["code"] == "QUALIFIER_QUOTE_INVALID" and validation["status"] in {"FAIL", "REJECTED"} for validation in item["06_validation_repair"])
        direct_basis += sum(validation["code"] == "FACET_BASIS_REQUIREMENT_ONLY" and validation["status"] in {"FAIL", "REJECTED"} for validation in item["06_validation_repair"])
        discontinuous += sum(validation["code"] == "CONTINUITY_CORE_REQUIREMENT_GROUNDED" and validation["status"] in {"FAIL", "REJECTED"} for validation in item["06_validation_repair"])
    return {"artifact": "B22_STRUCTURAL_COMPATIBILITY_REPLAY", "kind": "STRUCTURAL_COMPATIBILITY_REPLAY_NOT_B22_RESULT", "providerCalls": 0, "performanceClaims": "none", "b21FacetReferenceFailuresSeen": facet_runs, "facetOutputsRepresentableByB22LocalContract": facet_runs - len(incompatible), "incompatibleFacetOutputs": incompatible, "b21ScopedQualifierTraceFindingsSeen": qualifier, "b21DirectRequirementFacetBasisFindingsSeen": direct_basis, "b21DiscontinuousTraceFindingsSeen": discontinuous, "conclusion": "B2.2 validates local definitions/references before deterministic authoritative rewrite; it does not score or reinterpret frozen B2.1 model outputs."}

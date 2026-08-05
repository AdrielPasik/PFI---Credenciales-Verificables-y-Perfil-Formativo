from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator

from src.exporters.backend_contract import SOURCE_TYPE_ACADEMIC_PDF
from src.exporters.backend_contract.semantic_analysis_exporter import (
    export_semantic_analysis,
)
from src.profile_builder.formative_profile_result import (
    build_formative_profile_result,
)


def _repository_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "packages" / "schemas").is_dir():
            return parent
    raise RuntimeError("Could not locate packages/schemas from AI Service tests")


def _load_schema(file_name: str) -> dict[str, Any]:
    schema_path = _repository_root() / "packages" / "schemas" / file_name
    return json.loads(schema_path.read_text(encoding="utf-8"))


def _source_record() -> dict[str, Any]:
    return {
        "raw_normalized": {
            "course_code": "schema.test.001",
            "name": "Materia sintetica de contrato",
            "hours_total": 40,
            "source_file": "schema-test.pdf",
            "extraction_status": "ok",
        },
        "semantic_final": {
            "name": "Materia sintetica de contrato",
            "areas_detected": ["Software"],
            "areas_detected_detail": [
                {
                    "area_id": "area_software",
                    "area_label": "Software",
                    "evidence_strength": 0.9,
                }
            ],
            "skills_detected": [
                {
                    "skill": "Python",
                    "skill_id": "skill_python",
                    "skill_label": "Python",
                    "detection_mode": "explicit_exact_match",
                    "matched_signal": "python",
                    "evidence_source_section": "objectives_raw",
                    "confidence": 0.85,
                    "is_core_skill_in_course": True,
                }
            ],
            "concepts_detected": ["programacion"],
            "hours_distribution_estimate": {
                "by_area": [
                    {
                        "area": "Software",
                        "area_id": "area_software",
                        "estimated_hours": 40,
                        "weight": 1.0,
                    }
                ]
            },
            "evidence_map": {
                "areas": [
                    {
                        "area": "Software",
                        "area_id": "area_software",
                        "matched_signal": "software",
                        "evidence_source_section": "contents_raw",
                    }
                ],
                "skills": [
                    {
                        "skill": "Python",
                        "skill_id": "skill_python",
                        "matched_signal": "python",
                        "evidence_source_section": "objectives_raw",
                    }
                ],
            },
            "quality_flags": {
                "area_assignment_status": "confident",
                "semantic_quality_status": "high",
                "skills_detection_reliability": 0.85,
                "hours_distribution_reliability": 0.9,
            },
            "text_for_embedding": "Materia sintetica. Software. Python.",
        },
    }


def _generated_semantic_artifact() -> dict[str, Any]:
    return export_semantic_analysis(
        _source_record(),
        SOURCE_TYPE_ACADEMIC_PDF,
        "schema-test-document",
    ).to_dict()


def _validate(instance: dict[str, Any], schema_file: str) -> None:
    schema = _load_schema(schema_file)
    Draft202012Validator.check_schema(schema)
    Draft202012Validator(schema).validate(instance)


def test_generated_semantic_analysis_matches_shared_schema() -> None:
    artifact = _generated_semantic_artifact()

    assert artifact["schemaVersion"] == "semantic_analysis_v1"
    _validate(artifact, "semantic_analysis_v1.schema.json")


def test_generated_formative_profile_matches_shared_schema() -> None:
    semantic_artifact = _generated_semantic_artifact()
    profile_artifact = build_formative_profile_result([semantic_artifact])

    assert profile_artifact["profileVersion"] == "formative_profile_result_v0"
    _validate(profile_artifact, "formative_profile_result_v0.schema.json")

"""
Fixtures sinteticas minimas de artifacts `semantic_analysis_v1`, usadas
solo por los tests de `tests/profile_builder/`. Deliberadamente NO leen
nada de `output/backend_artifacts/` ni de ningun corpus real -- son dicts
construidos a mano que respetan la forma que produce
`src/exporters/backend_contract/models.py` (`SemanticAnalysisV1.to_dict()`).
"""
from __future__ import annotations

import copy
from typing import Any


def pdf_artifact(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "schemaVersion": "semantic_analysis_v1",
        "pipelineVersion": "unversioned_current",
        "taxonomyVersion": "unversioned_current",
        "status": "completed",
        "sourceType": "academic_pdf",
        "sourceRefs": {"documentId": "1.1.001", "fileName": "curso_python.pdf"},
        "areas": [
            {
                "id": "area_software",
                "label": "Software",
                "confidence": 0.9,
                "confidenceMethod": "measured",
                "source": "explicit",
            }
        ],
        "skills": [
            {
                "id": "skill_python",
                "label": "Python",
                "confidence": 0.8,
                "confidenceMethod": "measured",
                "source": "explicit",
            }
        ],
        "concepts": [
            {"id": "poo", "label": "POO", "confidence": None, "confidenceMethod": "unavailable"},
        ],
        "hoursDistribution": [
            {"areaId": "area_software", "hours": 40.0},
        ],
        "evidenceMap": {
            "areas": {"area_software": ["matched_signal:software"]},
            "skills": {"skill_python": ["matched_signal:python"]},
            "concepts": {},
        },
        "confidence": {
            "global": 0.85,
            "globalMethod": "derived",
            "coverage": None,
            "coverageMethod": "unavailable",
        },
        "qualityFlags": ["area_assignment_confident"],
        "textForEmbedding": "Curso de Python.",
        "warnings": [],
        "partialReasons": [],
    }
    base.update(copy.deepcopy(overrides))
    return base


def online_artifact(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "schemaVersion": "semantic_analysis_v1",
        "pipelineVersion": "unversioned_current",
        "taxonomyVersion": "unversioned_current",
        "status": "completed",
        "sourceType": "online_course_catalog",
        "sourceRefs": {"documentId": "online_00001", "fileName": None},
        "areas": [
            {
                "id": "area_software",
                "label": "Software",
                "confidence": None,
                "confidenceMethod": "unavailable",
                "source": "inferred",
            }
        ],
        "skills": [
            {
                "id": "skill_python",
                "label": "Python",
                "confidence": None,
                "confidenceMethod": "unavailable",
                "source": "inferred",
            }
        ],
        "concepts": [],
        "hoursDistribution": [],
        "evidenceMap": {"areas": {}, "skills": {}, "concepts": {}},
        "confidence": {
            "global": None,
            "globalMethod": "unavailable",
            "coverage": None,
            "coverageMethod": "unavailable",
        },
        "qualityFlags": [],
        "textForEmbedding": "Python for Everybody.",
        "warnings": [
            "confidence_not_available_in_source_pipeline",
            "no_holder_completion_evidence_in_source_dataset",
        ],
        "partialReasons": [],
    }
    base.update(copy.deepcopy(overrides))
    return base

"""Catalogo de EvidenceUnits productivo — slice F3.4."""

from src.api.evidence_units.contracts import (
    ARTIFACT_SCHEMA_VERSION,
    PRODUCT_ADAPTER_VERSION,
    PRODUCT_PROMPT_VERSION,
    REQUEST_SCHEMA_VERSION,
    RESPONSE_SCHEMA_VERSION,
    StageExecutionPlan,
)
from src.api.evidence_units.service import run_evidence_units

__all__ = [
    "ARTIFACT_SCHEMA_VERSION",
    "PRODUCT_ADAPTER_VERSION",
    "PRODUCT_PROMPT_VERSION",
    "REQUEST_SCHEMA_VERSION",
    "RESPONSE_SCHEMA_VERSION",
    "StageExecutionPlan",
    "run_evidence_units",
]

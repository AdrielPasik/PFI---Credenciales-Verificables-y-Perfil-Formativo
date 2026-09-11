"""Razonamiento contextual productivo — slice F3.5."""

from src.api.contextual_reasoning.contracts import (
    CONTEXTUAL_RESULT_SCHEMA_VERSION,
    PRODUCT_ADAPTER_VERSION,
    PRODUCT_PROMPT_VERSION,
    REQUEST_SCHEMA_VERSION,
    RESPONSE_SCHEMA_VERSION,
    STAGE_ARTIFACT_SCHEMA_VERSION,
    StageExecutionPlan,
)
from src.api.contextual_reasoning.service import run_contextual_reasoning

__all__ = [
    "CONTEXTUAL_RESULT_SCHEMA_VERSION",
    "PRODUCT_ADAPTER_VERSION",
    "PRODUCT_PROMPT_VERSION",
    "REQUEST_SCHEMA_VERSION",
    "RESPONSE_SCHEMA_VERSION",
    "STAGE_ARTIFACT_SCHEMA_VERSION",
    "StageExecutionPlan",
    "run_contextual_reasoning",
]

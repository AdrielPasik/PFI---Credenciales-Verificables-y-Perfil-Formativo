"""
`formative_profile_result_v0` (experimental) — resultado semántico del
perfil formativo, agnóstico de UI, pensado para que backend lo persista o
lo exponga por API. Reemplaza a `formative_profile_frontend_payload.py`
como contrato principal de esta capa (ver
docs/architecture/formative_profile_result_v0.md, sección "por qué no es
un frontend payload"). `formative_profile_frontend_payload.py` NO se
borró -- queda como demo auxiliar, no como contrato principal.

Esta capa NO decide nada de render: no arma cards, no calcula uiHints, no
genera labels pensadas para un botón/badge. Solo estructura el resultado
semántico ya calculado por las capas anteriores (Fase 5A, 3A/3B, 5B) en un
shape estable y versionado.

Reutiliza (sin modificarlas):
  - `artifact_profile_adapter.build_aggregated_profile_input` (Fase 5A)
  - `artifact_confidence_interpreter.interpret_aggregated_confidence` (Fase 3A/3B)
  - `formative_profile_narrative.build_formative_profile_narrative` (Fase 5B)
    -- de ahí sale el texto ya redactado con lenguaje prudente (summary,
    strengths, possibleDirections, limitations, warnings).

Puramente funcional: no hace I/O, no muta los artifacts de entrada, no
importa `profile_builder.py`/`course_adapter.py` productivos.
"""
from __future__ import annotations

from typing import Any, Optional

from src.profile_builder.artifact_confidence_interpreter import (
    WARNING_EXPLANATIONS,
    interpret_aggregated_confidence,
)
from src.profile_builder.artifact_profile_adapter import build_aggregated_profile_input
from src.profile_builder.formative_profile_narrative import build_formative_profile_narrative

__all__ = ["PROFILE_VERSION", "build_formative_profile_result"]

PROFILE_VERSION = "formative_profile_result_v0"
SUMMARY_LANGUAGE = "es"
SUMMARY_STYLE = "cautious_explanatory"


def _avg_ignore_none(values: list[Optional[float]]) -> Optional[float]:
    present = [v for v in values if v is not None]
    if not present:
        return None
    return round(sum(present) / len(present), 4)


def _concept_confidences(artifacts: list[dict[str, Any]]) -> dict[str, Optional[float]]:
    """
    `ConceptAggregate` (Fase 5A) no trackea confidence promedio por
    concept -- se deriva acá con una pasada extra sobre los artifacts ya
    validados (mismo patrón que `_completed_ratios` en
    `formative_profile_narrative.py`), sin tocar `artifact_profile_adapter.py`.
    Agrupa por `id` si está presente, sino por `label` (mismo criterio que
    `_group_key` de Fase 5A).
    """
    values: dict[str, list[Optional[float]]] = {}
    for artifact in artifacts:
        for concept in artifact.get("concepts") or []:
            group_id = concept.get("id") or concept.get("label") or "unknown"
            values.setdefault(group_id, []).append(concept.get("confidence"))
    return {k: _avg_ignore_none(v) for k, v in values.items()}


def _skill_source_category(sources: dict[str, int]) -> str:
    has_explicit = sources.get("explicit", 0) > 0
    has_inferred = sources.get("inferred", 0) > 0
    if has_explicit and has_inferred:
        return "mixed"
    if has_explicit:
        return "explicit"
    if has_inferred:
        return "inferred"
    return "unknown"


def _area_result(area: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": area["id"],
        "label": area["label"],
        "evidenceCount": area["count"],
        "hours": area["total_hours"] or None,
        "confidence": area["avg_confidence"],
        "sourceTypes": sorted(area["source_types"].keys()),
        "sourceRefs": area["source_ref_examples"],
    }


def _skill_result(skill: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": skill["id"],
        "label": skill["label"],
        "evidenceCount": skill["count"],
        "confidence": skill["avg_confidence"],
        "source": _skill_source_category(skill["sources"]),
        "sourceTypes": sorted(skill["source_types"].keys()),
        "sourceRefs": skill["source_ref_examples"],
    }


def _concept_result(concept: dict[str, Any], confidence: Optional[float]) -> dict[str, Any]:
    return {
        "id": concept["id"],
        "label": concept["label"],
        "evidenceCount": concept["count"],
        "confidence": confidence,
        "sourceTypes": sorted(concept["source_types"].keys()),
        "sourceRefs": concept["source_ref_examples"],
    }


def build_formative_profile_result(artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Construye `formative_profile_result_v0`: el resultado semántico del
    perfil formativo, agnóstico de UI, listo para que backend lo persista
    o lo exponga por API.

    No modifica `artifacts`. No hace I/O. No decide nada de render (sin
    cards, sin uiHints, sin labels de botón/badge).

    Levanta `InvalidArtifactError` (vía las capas reutilizadas) si algún
    artifact no pasa la validación mínima de consumidor.
    """
    aggregated = build_aggregated_profile_input(artifacts)  # valida; no muta
    aggregate_confidence = interpret_aggregated_confidence(aggregated)
    narrative = build_formative_profile_narrative(artifacts)

    concept_confidences = _concept_confidences(artifacts)

    band = aggregate_confidence["band"]
    score_method = "unavailable" if band == "unavailable" else "qualitative_only"

    raw_warning_codes = list(narrative["warnings"])  # ya deduplicado/ordenado por Fase 5B
    raw_partial_reason_codes = sorted(
        {reason for artifact in artifacts for reason in (artifact.get("partialReasons") or [])}
    )
    # `warnings` a nivel top es SEMANTICO (texto legible, mismo catalogo de
    # traducciones que Fase 3A) -- distinto de `audit.rawWarningCodes`, que
    # preserva los codigos crudos para trazabilidad/debugging. Repetir los
    # codigos crudos en ambos campos no aportaria nada nuevo.
    semantic_warnings = [WARNING_EXPLANATIONS.get(code, code) for code in raw_warning_codes]

    return {
        "profileVersion": PROFILE_VERSION,
        "generatedFrom": {
            "artifactSchema": "semantic_analysis_v1",
            "artifactCount": aggregated["source_artifacts_count"],
            "sourceTypes": aggregated["by_source_type"],
            "pipelineVersions": aggregated["metadata"]["pipeline_versions"],
            "taxonomyVersions": aggregated["metadata"]["taxonomy_versions"],
        },
        "summary": {
            "text": narrative["summary"],
            "language": SUMMARY_LANGUAGE,
            "style": SUMMARY_STYLE,
        },
        "confidence": {
            "band": band,
            # Nivel portfolio: nunca se fabrica un score numérico único al
            # mezclar fuentes PDF (medidas) y online (unavailable) -- misma
            # garantía que Fase 3A/3B, ver docs/architecture/confidence_model_v0.md.
            "score": None,
            "scoreMethod": score_method,
            "explanation": aggregate_confidence["explanation"],
            "drivers": aggregate_confidence["drivers"],
            "limitations": aggregate_confidence["limitations"],
        },
        "areas": [_area_result(a) for a in aggregated["areas"]],
        "skills": [_skill_result(s) for s in aggregated["skills"]],
        "concepts": [_concept_result(c, concept_confidences.get(c["id"])) for c in aggregated["concepts"]],
        "strengths": list(narrative["strengths"]),
        "possibleDirections": list(narrative["possibleDirections"]),
        "limitations": list(narrative["limitations"]),
        "warnings": semantic_warnings,
        "evidence": {
            "sourceCoverage": narrative["sourceCoverage"],
            "evidenceOverview": narrative["evidenceOverview"],
            "sourceRefs": narrative["sourceCoverage"]["sourceRefs"],
        },
        "audit": {
            "qualityFlags": aggregated["quality_summary"]["quality_flags"],
            "partialReasons": aggregated["partial_reasons"],
            "rawWarningCodes": raw_warning_codes,
            "rawPartialReasonCodes": raw_partial_reason_codes,
        },
    }

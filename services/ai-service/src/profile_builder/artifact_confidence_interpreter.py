"""
Fase 3A (experimental) — interpretación unificada de confidence sobre
artifacts `semantic_analysis_v1`, pensada como base de consumo para un
futuro `profile_builder_v2` y para la demo de front-end.

Problema que resuelve: hoy "confidence" llega de formas heterogéneas
(numérica medida/derivada en PDF, `null`/`unavailable` en online,
`qualityFlags`, `warnings`, `partialReasons`, `status` completed/partial,
`evidenceMap` más o menos completo) sin una interpretación consistente.
Esta capa NO reemplaza `confidence.global` del artifact -- lo interpreta
y lo complementa con una banda cualitativa explicable.

Ver docs/architecture/confidence_model_v0.md para la explicación completa
de las reglas y sus límites.

Puramente funcional: no hace I/O, no muta los artifacts/aggregate de
entrada, no reemplaza `profile_builder.py` ni `course_adapter.py`.
"""
from __future__ import annotations

from typing import Any, Optional

from src.profile_builder.artifact_loader import (
    InvalidArtifactError,
    load_artifacts_from_objects,
    validate_artifact_shape,
)

__all__ = [
    "InvalidArtifactError",
    "interpret_artifact_confidence",
    "interpret_artifacts_confidence",
    "interpret_aggregated_confidence",
]

# ─── Constantes de la fórmula (documentadas, no ocultas) ──────────────────────

HIGH_SCORE_THRESHOLD = 0.75
MEDIUM_SCORE_THRESHOLD = 0.5
# Umbral arbitrario pero explícito: por debajo se considera "poco contenido
# para evaluar semánticamente" al construir la banda (no afecta a
# `textForEmbedding` en si, solo a la interpretación de confidence).
TEXT_FOR_EMBEDDING_MIN_LENGTH = 40
# Cantidad de warnings NO estructurales a partir de la cual se consideran
# "muchas" (ver EXPECTED_STRUCTURAL_WARNINGS).
MANY_RELEVANT_WARNINGS_THRESHOLD = 2

BANDS = ("high", "medium", "low", "unavailable")
SCORE_METHODS = ("measured", "derived", "qualitative_only", "unavailable")

# Warnings que son esperadas/estructurales para ciertos sourceType (hoy:
# online) y que por si solas NO deben contar como señal de "muchas
# warnings" -- siguen generando una `limitation` legible, pero no bajan la
# banda por volumen.
EXPECTED_STRUCTURAL_WARNINGS = frozenset(
    {
        "confidence_not_available_in_source_pipeline",
        "no_holder_completion_evidence_in_source_dataset",
    }
)

# Traducciones legibles de warnings/partialReasons conocidos (ver
# semantic_analysis_exporter.py para el catálogo real emitido hoy). Un
# código no catalogado no rompe nada -- se traduce con un mensaje generico.
WARNING_EXPLANATIONS: dict[str, str] = {
    "no_skill_detected": "No se detectaron skills explícitas en esta credencial.",
    "no_area_detected": "No se pudo asignar un área con evidencia suficiente.",
    "confidence_not_available_in_source_pipeline": "La fuente no provee confidence cuantitativa.",
    "no_holder_completion_evidence_in_source_dataset": (
        "El curso describe una oferta/formación, pero no prueba finalización por parte del usuario."
    ),
    "area_could_not_be_confidently_resolved": (
        "El área detectada no pudo resolverse con confianza (candidato ambiguo)."
    ),
}


def _translate_warning(warning: str) -> str:
    return WARNING_EXPLANATIONS.get(warning, f"Advertencia no catalogada: {warning}")


def _translate_partial_reason(reason: str) -> str:
    if reason.startswith("kbs_area_assignment_status_"):
        status_value = reason[len("kbs_area_assignment_status_") :]
        return f"La asignación de área quedó en estado '{status_value}' (no confirmada como confiable)."
    if reason == "no_area_detected_in_online_pipeline":
        return "El pipeline online no detectó ningún área para este curso."
    return f"Razón de estado parcial no catalogada: {reason}"


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def _avg_ignore_none(values: list[Optional[float]]) -> Optional[float]:
    present = [v for v in values if v is not None]
    if not present:
        return None
    return round(sum(present) / len(present), 4)


# ─── Confidence por campo (areas / skills / concepts) ─────────────────────────

def _field_confidence(field_label: str, entries: list[dict[str, Any]], evidence_count: int) -> dict[str, Any]:
    """
    Resumen de confidence a nivel de artifact para un campo (areas, skills
    o concepts) -- NO es un desglose por elemento individual (eso ya lo
    hace la Fase 5A a nivel agregado). Domain-agnostic: nunca mira el
    `label`/`id` concreto, solo cuenta, evidencia y confidence declarada.
    """
    count = len(entries)
    has_evidence = evidence_count > 0
    avg_conf = _avg_ignore_none([e.get("confidence") for e in entries])

    if count == 0:
        band = "unavailable"
        explanation = f"No se detectaron {field_label} en este artifact."
    elif not has_evidence:
        band = "low"
        explanation = f"Se detectaron {count} {field_label} pero sin evidencia trazable en evidenceMap."
    elif avg_conf is not None and avg_conf >= HIGH_SCORE_THRESHOLD:
        band = "high"
        explanation = f"{count} {field_label} con evidencia trazable y confidence declarada promedio {avg_conf}."
    elif avg_conf is not None and avg_conf >= MEDIUM_SCORE_THRESHOLD:
        band = "medium"
        explanation = f"{count} {field_label} con evidencia trazable y confidence declarada promedio {avg_conf}."
    elif avg_conf is not None:
        band = "low"
        explanation = f"{count} {field_label} con evidencia trazable pero confidence declarada promedio baja ({avg_conf})."
    else:
        band = "medium"
        explanation = f"{count} {field_label} con evidencia trazable, sin confidence numérica declarada (evaluación cualitativa)."

    return {
        "count": count,
        "hasEvidence": has_evidence,
        "avgDeclaredConfidence": avg_conf,
        "band": band,
        "explanation": explanation,
    }


# ─── Decisión de banda (overallConfidence) ─────────────────────────────────────

def _decide_band_with_score(
    *,
    is_completed: bool,
    is_partial: bool,
    evidence_sufficient: bool,
    global_score: float,
    many_relevant_warnings: bool,
    has_any_content: bool,
    drivers: list[str],
    limitations: list[str],
) -> str:
    if is_completed and evidence_sufficient and global_score >= HIGH_SCORE_THRESHOLD and not many_relevant_warnings:
        drivers.append(
            f"status=completed, evidencia suficiente, confidence.global={global_score} >= {HIGH_SCORE_THRESHOLD}"
        )
        return "high"

    if is_completed and (evidence_sufficient or global_score >= MEDIUM_SCORE_THRESHOLD):
        if not evidence_sufficient:
            limitations.append("evidencia incompleta en areas/skills pese a status=completed")
        if global_score < HIGH_SCORE_THRESHOLD:
            limitations.append(f"confidence.global={global_score} por debajo del umbral alto ({HIGH_SCORE_THRESHOLD})")
        if many_relevant_warnings:
            limitations.append("hay múltiples warnings relevantes")
        drivers.append("status=completed con evidencia y/o confidence.global suficientes para banda media")
        return "medium"

    if is_partial and has_any_content:
        drivers.append("status=partial pero con áreas/skills/concepts útiles")
        return "medium"

    if not evidence_sufficient:
        limitations.append("evidencia insuficiente o ausente en evidenceMap")
    if many_relevant_warnings:
        limitations.append("hay múltiples warnings relevantes")
    return "low"


def _decide_band_without_score(
    *,
    evidence_sufficient: bool,
    has_any_content: bool,
    many_relevant_warnings: bool,
    text_poor: bool,
    drivers: list[str],
    limitations: list[str],
) -> str:
    if evidence_sufficient and has_any_content and not many_relevant_warnings and not text_poor:
        drivers.append("áreas y/o skills detectadas con evidencia trazable, sin warnings relevantes")
        return "medium"

    if has_any_content:
        if not evidence_sufficient:
            limitations.append("evidencia insuficiente o ausente en evidenceMap")
        if text_poor:
            limitations.append("textForEmbedding pobre (poco contenido para evaluar semánticamente)")
        if many_relevant_warnings:
            limitations.append("hay múltiples warnings relevantes")
        return "low"

    return "low"


def _build_explanation(*, band: str, score: Optional[float], is_completed: bool, score_method: str) -> str:
    status_label = "completed" if is_completed else "partial"

    if band == "unavailable":
        return (
            "No hay señales suficientes (ni confidence numérica, ni áreas/skills/concepts, "
            "ni texto) para estimar confidence."
        )
    if score_method == "qualitative_only" and band == "medium":
        return "La fuente tiene áreas y skills detectadas con evidencia, pero no provee confidence cuantitativa propia."
    if score_method == "qualitative_only":
        return (
            "La fuente no provee confidence cuantitativa propia y la evidencia disponible es limitada; "
            "evaluación cualitativa."
        )
    if band == "high":
        return f"Confidence alta: status={status_label}, evidencia suficiente y confidence.global={score}."
    if band == "medium":
        return (
            f"Confidence media: señales positivas presentes pero con alguna limitación "
            f"(status={status_label}, confidence.global={score})."
        )
    return f"Confidence baja: señales insuficientes o evidencia incompleta (status={status_label}, confidence.global={score})."


def _build_review_recommendations(
    *,
    band: str,
    has_areas: bool,
    has_skills: bool,
    area_evidence_ok: bool,
    skill_evidence_ok: bool,
    is_partial: bool,
    warnings: list[str],
) -> list[str]:
    recs: list[str] = []
    if band in ("low", "unavailable"):
        recs.append("Revisar manualmente antes de usar esta fuente como señal fuerte de confianza.")
    if has_areas and not area_evidence_ok:
        recs.append("Revisar evidencia de área: hay áreas asignadas sin evidencia trazable.")
    if has_skills and not skill_evidence_ok:
        recs.append("Revisar evidencia de skills: hay skills detectadas sin evidencia trazable.")
    if is_partial:
        recs.append("Considerar reprocesar la fuente: el análisis quedó en estado partial.")
    if "no_holder_completion_evidence_in_source_dataset" in warnings:
        recs.append("No usar esta fuente como prueba de finalización del usuario sin evidencia adicional.")
    return _dedupe(recs)


# ─── Entry point principal (un artifact) ───────────────────────────────────────

def interpret_artifact_confidence(artifact: dict[str, Any]) -> dict[str, Any]:
    """
    Interpreta confidence para UN artifact `semantic_analysis_v1`. No
    modifica `artifact`. No sobrescribe `artifact["confidence"]`.

    Levanta InvalidArtifactError si el artifact no pasa la validación
    mínima de consumidor (misma validación que Fase 5A).
    """
    validate_artifact_shape(artifact, source_label="interpret_artifact_confidence")

    status = artifact.get("status") or "unknown_status"
    is_completed = status == "completed"
    is_partial = status == "partial"

    areas = artifact.get("areas") or []
    skills = artifact.get("skills") or []
    concepts = artifact.get("concepts") or []

    evidence_map = artifact.get("evidenceMap") or {}
    ev_areas = evidence_map.get("areas") or {}
    ev_skills = evidence_map.get("skills") or {}
    ev_concepts = evidence_map.get("concepts") or {}
    area_evidence_count = sum(len(v) for v in ev_areas.values())
    skill_evidence_count = sum(len(v) for v in ev_skills.values())
    concept_evidence_count = sum(len(v) for v in ev_concepts.values())

    has_areas = bool(areas)
    has_skills = bool(skills)
    has_concepts = bool(concepts)
    has_any_content = has_areas or has_skills or has_concepts

    area_evidence_ok = (not has_areas) or area_evidence_count > 0
    skill_evidence_ok = (not has_skills) or skill_evidence_count > 0
    evidence_sufficient = (has_areas or has_skills) and area_evidence_ok and skill_evidence_ok

    text_for_embedding = artifact.get("textForEmbedding") or ""
    text_poor = len(text_for_embedding.strip()) < TEXT_FOR_EMBEDDING_MIN_LENGTH

    warnings = list(artifact.get("warnings") or [])
    partial_reasons = list(artifact.get("partialReasons") or [])
    relevant_warnings = [w for w in warnings if w not in EXPECTED_STRUCTURAL_WARNINGS]
    many_relevant_warnings = len(relevant_warnings) >= MANY_RELEVANT_WARNINGS_THRESHOLD

    confidence_obj = artifact.get("confidence") or {}
    global_score = confidence_obj.get("global")
    global_method = confidence_obj.get("globalMethod")

    drivers: list[str] = []
    limitations: list[str] = []

    if is_completed:
        drivers.append("status=completed")
    elif is_partial:
        limitations.append("status=partial: el análisis de la fuente quedó incompleto")

    if evidence_sufficient:
        drivers.append(
            f"evidencia trazable suficiente (areas: {area_evidence_count}, skills: {skill_evidence_count})"
        )
    elif has_areas or has_skills:
        limitations.append("hay áreas y/o skills detectadas sin evidencia trazable suficiente en evidenceMap")

    if text_poor:
        limitations.append("textForEmbedding pobre (poco contenido para evaluar semánticamente)")

    # warnings/partialReasons -> explicaciones legibles, SIEMPRE (independiente de la banda).
    for w in warnings:
        limitations.append(_translate_warning(w))
    for r in partial_reasons:
        limitations.append(_translate_partial_reason(r))

    totally_empty = not has_any_content and global_score is None and not text_for_embedding.strip()

    if totally_empty:
        band = "unavailable"
    elif global_score is not None:
        band = _decide_band_with_score(
            is_completed=is_completed,
            is_partial=is_partial,
            evidence_sufficient=evidence_sufficient,
            global_score=global_score,
            many_relevant_warnings=many_relevant_warnings,
            has_any_content=has_any_content,
            drivers=drivers,
            limitations=limitations,
        )
    else:
        band = _decide_band_without_score(
            evidence_sufficient=evidence_sufficient,
            has_any_content=has_any_content,
            many_relevant_warnings=many_relevant_warnings,
            text_poor=text_poor,
            drivers=drivers,
            limitations=limitations,
        )

    score = global_score  # nunca se inventa: solo se refleja lo que ya trae el artifact
    if score is not None:
        score_method = global_method if global_method in ("measured", "derived") else "derived"
    else:
        score_method = "unavailable" if band == "unavailable" else "qualitative_only"

    explanation = _build_explanation(band=band, score=score, is_completed=is_completed, score_method=score_method)

    overall_confidence = {
        "score": score,
        "band": band,
        "scoreMethod": score_method,
        "explanation": explanation,
        "drivers": _dedupe(drivers),
        "limitations": _dedupe(limitations),
    }

    area_confidence = _field_confidence("área(s)", areas, area_evidence_count)
    skill_confidence = _field_confidence("skill(s)", skills, skill_evidence_count)
    concept_confidence = _field_confidence("concepto(s)", concepts, concept_evidence_count)

    source_quality = {
        "sourceType": artifact.get("sourceType"),
        "status": status,
        "hasAreaEvidence": area_evidence_count > 0,
        "hasSkillEvidence": skill_evidence_count > 0,
        "hasConceptEvidence": concept_evidence_count > 0,
        "textForEmbeddingLength": len(text_for_embedding.strip()),
        "textForEmbeddingQuality": "poor" if text_poor else "sufficient",
        # qualityFlags: señal auxiliar, no decide la banda (ver docs/architecture/confidence_model_v0.md).
        "qualityFlags": list(artifact.get("qualityFlags") or []),
        # Códigos crudos preservados para trazabilidad -- `overallConfidence.limitations`
        # ya trae la version legible/traducida de estos mismos codigos.
        "warningCodes": warnings,
        "partialReasonCodes": partial_reasons,
    }

    review_recommendations = _build_review_recommendations(
        band=band,
        has_areas=has_areas,
        has_skills=has_skills,
        area_evidence_ok=area_evidence_ok,
        skill_evidence_ok=skill_evidence_ok,
        is_partial=is_partial,
        warnings=warnings,
    )

    return {
        "overallConfidence": overall_confidence,
        "areaConfidence": area_confidence,
        "skillConfidence": skill_confidence,
        "conceptConfidence": concept_confidence,
        "sourceQuality": source_quality,
        "reviewRecommendations": review_recommendations,
    }


def interpret_artifacts_confidence(artifacts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Interpreta confidence para una lista de artifacts. Cada interpretación
    depende únicamente de su propio artifact (no hay agregación cruzada
    acá -- para eso ver `interpret_aggregated_confidence`), asi que el
    resultado para cada artifact es independiente del orden de la lista.
    """
    validated = load_artifacts_from_objects(artifacts)
    return [interpret_artifact_confidence(a) for a in validated]


# ─── Entry point secundario (aggregate de Fase 5A) ─────────────────────────────

def interpret_aggregated_confidence(aggregated: dict[str, Any]) -> dict[str, Any]:
    """
    Interpretación de confidence a nivel portfolio, sobre la salida de
    `build_aggregated_profile_input` (Fase 5A). Deliberadamente más simple
    que `interpret_artifact_confidence` y SIN `score` numérico: mezclar
    confidence medida (PDF) con unavailable (online) en un único número a
    nivel portfolio inventaría una certeza que no existe. Solo banda
    cualitativa + explicación + limitaciones.
    """
    total = aggregated.get("source_artifacts_count") or 0
    if total == 0:
        return {
            "band": "unavailable",
            "explanation": "No hay artifacts agregados para evaluar.",
            "drivers": [],
            "limitations": ["source_artifacts_count=0"],
            "reviewRecommendations": [
                "Agregar al menos un artifact antes de interpretar confidence a nivel portfolio."
            ],
        }

    quality = aggregated.get("quality_summary") or {}
    status_counts = quality.get("status") or {}
    confidence_global = quality.get("confidence_global") or {"present": 0, "null": 0}
    evidence = aggregated.get("evidence_summary") or {}

    completed = status_counts.get("completed", 0)
    partial = status_counts.get("partial", 0)

    has_area_evidence = (evidence.get("artifacts_with_area_evidence") or 0) > 0
    has_skill_evidence = (evidence.get("artifacts_with_skill_evidence") or 0) > 0

    warnings = aggregated.get("warnings") or {}
    partial_reasons = aggregated.get("partial_reasons") or {}

    drivers: list[str] = []
    limitations: list[str] = []

    skills_count = len(aggregated.get("skills") or [])
    # Guardrail conservador: un portfolio donde NINGUN artifact llego a
    # completed (todos partial) y no hay ninguna skill detectada (ni en el
    # conteo agregado ni en evidenceMap) no debe leerse como "medium" solo
    # porque algunas areas tengan evidencia -- eso sobreinterpreta un
    # analisis sistematicamente incompleto. Se chequea ANTES de la rama
    # general de "hay evidencia de areas y/o skills" para que un perfil
    # claramente debil (ej. 8/8 artifacts partial, 0 skills) baje a "low"
    # en vez de "medium". No afecta portfolios con al menos 1 artifact
    # completed, o con alguna skill detectada/evidenciada -- esos siguen
    # el arbol de decision normal (ver tests en
    # test_artifact_confidence_interpreter.py).
    all_partial_and_no_skills = completed == 0 and partial == total and (skills_count == 0 or not has_skill_evidence)

    completed_ratio = completed / total
    if all_partial_and_no_skills:
        band = "low"
        drivers.append(f"0/{total} artifacts completed y sin evidencia de skills en el portfolio")
        limitations.append(
            "Todas las fuentes quedaron con análisis parcial y no se detectaron skills explícitas; "
            "la confianza agregada se reduce para evitar sobreinterpretar evidencia incompleta."
        )
    elif completed_ratio >= 0.8 and has_area_evidence and has_skill_evidence:
        band = "high" if confidence_global.get("present", 0) >= confidence_global.get("null", 0) else "medium"
        drivers.append(f"{completed}/{total} artifacts completed, con evidencia de areas y skills")
    elif has_area_evidence or has_skill_evidence:
        band = "medium"
        drivers.append("hay evidencia de areas y/o skills en al menos un artifact del portfolio")
    else:
        band = "low"
        limitations.append("no hay evidencia de areas ni skills en ningún artifact agregado")

    if confidence_global.get("null", 0) > 0:
        limitations.append(
            f"{confidence_global['null']}/{total} artifacts no proveen confidence cuantitativa propia (unavailable)"
        )
    if partial > 0:
        limitations.append(f"{partial}/{total} artifacts quedaron en status=partial")

    for w, count in sorted(warnings.items()):
        limitations.append(f"{_translate_warning(w)} ({count}x)")
    for r, count in sorted(partial_reasons.items()):
        limitations.append(f"{_translate_partial_reason(r)} ({count}x)")

    explanation = (
        f"Portfolio de {total} artifacts: {completed} completed, {partial} partial. "
        "Banda cualitativa basada en cobertura de evidencia y status, sin score numérico único "
        "(mezclar confidence PDF/online en un solo número no sería representativo)."
    )

    review_recommendations = _dedupe(
        ["Revisar portfolio manualmente: banda baja o evidencia insuficiente."] if band == "low" else []
    )

    return {
        "band": band,
        "explanation": explanation,
        "drivers": _dedupe(drivers),
        "limitations": _dedupe(limitations),
        "reviewRecommendations": review_recommendations,
    }

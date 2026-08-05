"""
Fase Demo 1 (experimental) — adaptador que convierte el perfil formativo
narrativo (`formative_profile_narrative.build_formative_profile_narrative`)
en un payload JSON compacto, estable y pensado para renderizar en un
front-end (cards, badges, paneles), sin depender de React ni de backend.

No cambia ninguna lógica semántica: no reinterpreta confidence, no
reordena áreas/skills/concepts, no agrega ni quita evidencia. Es
puramente una capa de PRESENTACIÓN sobre un dict que Fase 5B ya produjo.

Puramente funcional: no hace I/O, no muta el `profile` de entrada, no
importa `profile_builder.py`/`course_adapter.py` productivos.

Ver docs/architecture/formative_profile_frontend_payload_v0.md.
"""
from __future__ import annotations

from typing import Any, Optional

__all__ = ["PAYLOAD_VERSION", "build_formative_profile_frontend_payload"]

PAYLOAD_VERSION = "formative_profile_frontend_payload_v0"

# Mismos umbrales que artifact_confidence_interpreter.py (HIGH_SCORE_THRESHOLD /
# MEDIUM_SCORE_THRESHOLD) -- se repiten acá como constantes propias en vez de
# importarlas, porque esto es un mapeo de PRESENTACIÓN (label corto para una
# card), no una decisión de confidence: mismo valor numérico, distinto rol.
CARD_CONFIDENCE_HIGH_THRESHOLD = 0.75
CARD_CONFIDENCE_MEDIUM_THRESHOLD = 0.5

BAND_LABELS: dict[str, str] = {
    "high": "Confianza alta",
    "medium": "Confianza media",
    "low": "Confianza baja",
    "unavailable": "Confianza no disponible",
}

RISK_LEVEL_BY_BAND: dict[str, str] = {
    "high": "low",
    "medium": "medium",
    "low": "high",
    "unavailable": "high",
}

# Traduce codigos crudos de warning (los mismos que emite el exporter y que
# artifact_confidence_interpreter.WARNING_EXPLANATIONS ya traduce) a mensajes
# cortos aptos para una lista de advertencias de UI. Se define localmente
# (en vez de importar WARNING_EXPLANATIONS) para no acoplar el shape de
# presentacion al texto largo pensado para `limitations` -- estos son mas
# cortos, pensados para chips/badges, no para parrafos.
WARNING_UI_LABELS: dict[str, str] = {
    "no_skill_detected": "Sin skills detectadas",
    "no_area_detected": "Sin área asignada con confianza",
    "confidence_not_available_in_source_pipeline": "Sin confidence cuantitativa en la fuente",
    "no_holder_completion_evidence_in_source_dataset": "No hay prueba de finalización del curso",
    "area_could_not_be_confidently_resolved": "Área ambigua, no resuelta con confianza",
}

ONLINE_COMPLETION_WARNING_CODE = "no_holder_completion_evidence_in_source_dataset"


def _confidence_label(value: Optional[float]) -> str:
    if value is None:
        return "Confidence no disponible"
    if value >= CARD_CONFIDENCE_HIGH_THRESHOLD:
        return "Confidence alta"
    if value >= CARD_CONFIDENCE_MEDIUM_THRESHOLD:
        return "Confidence media"
    return "Confidence baja"


def _compact_subtitle(evidence_count: int, hours: Optional[float], confidence_label: Optional[str]) -> str:
    unit = "fuente" if evidence_count == 1 else "fuentes"
    parts = [f"{evidence_count} {unit}"]
    if hours:
        parts.append(f"{hours:g} h")
    if confidence_label:
        parts.append(confidence_label)
    return " · ".join(parts)


def _area_card(area: dict[str, Any]) -> dict[str, Any]:
    label = _confidence_label(area.get("confidence"))
    return {
        "title": area.get("label", ""),
        "subtitle": _compact_subtitle(area.get("evidenceCount", 0), area.get("hours"), label),
        "confidenceLabel": label,
        "evidenceCount": area.get("evidenceCount", 0),
        "hours": area.get("hours"),
        "sourceExamples": area.get("sourceExamples", []),
        # texto completo (ya redactado por Fase 5B) para un tooltip/expand
        # opcional -- el shape sugerido no lo pide, pero descartarlo pierde
        # contexto que ya existe sin costo; ver doc de la fase.
        "detail": area.get("explanation", ""),
    }


def _skill_card(skill: dict[str, Any]) -> dict[str, Any]:
    label = _confidence_label(skill.get("confidence"))
    return {
        "title": skill.get("label", ""),
        "subtitle": _compact_subtitle(skill.get("evidenceCount", 0), None, label),
        "confidenceLabel": label,
        "evidenceCount": skill.get("evidenceCount", 0),
        "sourceExamples": skill.get("sourceExamples", []),
        "detail": skill.get("explanation", ""),
    }


def _concept_card(concept: dict[str, Any]) -> dict[str, Any]:
    count = concept.get("evidenceCount", 0)
    unit = "fuente" if count == 1 else "fuentes"
    return {
        "title": concept.get("label", ""),
        "subtitle": f"{count} {unit}",
        "confidenceLabel": None,
        "evidenceCount": count,
        "sourceExamples": concept.get("sourceExamples", []),
        "detail": concept.get("explanation", ""),
    }


def build_formative_profile_frontend_payload(profile: dict[str, Any]) -> dict[str, Any]:
    """
    Transforma el dict de `build_formative_profile_narrative` (Fase 5B) en
    un payload JSON compacto para front-end.

    No modifica `profile`. No hace I/O. Función pura.
    """
    confidence_summary = profile.get("confidenceSummary") or {}
    band = confidence_summary.get("band", "unavailable")

    source_coverage = profile.get("sourceCoverage") or {}
    warnings_raw = profile.get("warnings") or []
    limitations = profile.get("limitations") or []

    warnings_ui = [WARNING_UI_LABELS.get(code, code) for code in warnings_raw]

    show_online_completion_warning = ONLINE_COMPLETION_WARNING_CODE in warnings_raw

    payload: dict[str, Any] = {
        "payloadVersion": PAYLOAD_VERSION,
        "profile": {
            "title": "Perfil formativo",
            "summary": profile.get("summary", ""),
            "confidence": {
                "band": band,
                "label": BAND_LABELS.get(band, "Confianza no disponible"),
                "description": confidence_summary.get("explanation", ""),
                "limitations": list(confidence_summary.get("limitations", [])),
            },
        },
        "cards": {
            "mainAreas": [_area_card(a) for a in profile.get("mainAreas") or []],
            "mainSkills": [_skill_card(s) for s in profile.get("mainSkills") or []],
            "mainConcepts": [_concept_card(c) for c in profile.get("mainConcepts") or []],
        },
        "sections": {
            "strengths": list(profile.get("strengths") or []),
            "possibleDirections": list(profile.get("possibleDirections") or []),
            "limitations": list(limitations),
            "warnings": warnings_ui,
        },
        "evidence": {
            "sourceCoverage": source_coverage,
            "evidenceOverview": profile.get("evidenceOverview") or {},
            "sources": list(source_coverage.get("sourceRefs") or []),
        },
        "uiHints": {
            "showConfidenceBadge": True,
            "showLimitationsPanel": bool(limitations),
            "showEvidencePanel": bool(source_coverage.get("sourceArtifactsCount")),
            "riskLevel": RISK_LEVEL_BY_BAND.get(band, "high"),
            # Booleano dedicado para que el front-end no tenga que buscar el
            # codigo crudo dentro de listas de texto -- si esta en True, se
            # espera que la UI muestre una advertencia visible de que la
            # fuente no prueba finalizacion del curso (ver instruccion
            # explicita de esta fase). Adicion justificada al shape sugerido.
            "showOnlineCompletionWarning": show_online_completion_warning,
        },
        "debug": {
            "profileVersion": profile.get("profileVersion"),
            "sourceArtifactsCount": source_coverage.get("sourceArtifactsCount", 0),
        },
    }
    return payload

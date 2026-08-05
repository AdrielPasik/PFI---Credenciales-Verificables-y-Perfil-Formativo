"""
Fase 5B (experimental) — perfil formativo textual, trazable y explicable,
construido sobre las capas experimentales ya existentes:

- `artifact_loader.py` (Fase 5A): validación mínima de consumidor.
- `artifact_profile_adapter.py` (Fase 5A): agregación determinística de
  areas/skills/concepts sobre una lista de artifacts `semantic_analysis_v1`.
- `artifact_confidence_interpreter.py` (Fase 3A/3B): interpretación
  unificada y explicable de confidence, a nivel artifact y portfolio.

Esta capa NO reemplaza `profile_builder.py`/`course_adapter.py`, NO
construye `UserProfile`, NO escribe en `profiles/`, NO genera
credenciales ni toca nada de blockchain/hash. Ver
docs/architecture/formative_profile_narrative_v0.md.

Puramente funcional: no hace I/O, no muta los artifacts de entrada.

## Qué NO afirma esta capa (importante, ver también el doc)

- No afirma que una persona "completó"/"finalizó" un curso -- ni para PDF
  ni para online. El campo `status` de `semantic_analysis_v1` describe si
  el ANÁLISIS SEMÁNTICO de la fuente fue completo o parcial, no si alguien
  aprobó o terminó el curso. Esta capa nunca conflacio esos dos conceptos.
- No afirma identidad, holder, issuer, ni finalización -- eso pertenece a
  `credential_candidate_v1` (no implementado en el repo).
- No usa lenguaje absoluto ("domina", "experto", "especialista",
  "garantizado", "certifica") ni recomendaciones laborales ("apto para",
  "perfil ideal para").
- No inventa un `domain` para skills -- `semantic_analysis_v1` no trae ese
  campo hoy; se expone como `None` explícito, nunca inferido/hardcodeado.
"""
from __future__ import annotations

from typing import Any, Optional

from src.profile_builder.artifact_confidence_interpreter import (
    interpret_aggregated_confidence,
    interpret_artifacts_confidence,
)
from src.profile_builder.artifact_loader import InvalidArtifactError, load_artifacts_from_objects
from src.profile_builder.artifact_profile_adapter import build_aggregated_profile_input

__all__ = [
    "InvalidArtifactError",
    "PROFILE_VERSION",
    "build_formative_profile_narrative",
    "render_formative_profile_markdown",
]

PROFILE_VERSION = "formative_profile_narrative_v0"

# Cuántos elementos entran en cada lista "principal" -- "evitar listas
# enormes" (consigna). Valores iniciales explícitos, no calibrados.
MAIN_AREAS_LIMIT = 5
MAIN_SKILLS_LIMIT = 8
MAIN_CONCEPTS_LIMIT = 10

# % de fuentes con status=partial a partir del cual se agrega una
# limitation explícita sobre cobertura de análisis.
PARTIAL_RATIO_WARNING_THRESHOLD = 0.3
# % mínimo de fuentes con evidencia de área por debajo del cual se agrega
# una limitation sobre cobertura de evidencia.
LOW_AREA_EVIDENCE_COVERAGE_THRESHOLD = 0.5

ONLINE_COMPLETION_LIMITATION = (
    "Para las fuentes de tipo curso online, el artifact describe una oferta/catálogo de "
    "formación, pero no constituye por sí sola una prueba de que el perfil haya completado "
    "dicho curso."
)


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


# ─── Tie-breaker secundario: "completed > partial" (ver reglas de selección) ──

def _completed_ratios(artifacts: list[dict[str, Any]], field_name: str) -> dict[str, float]:
    """
    Para cada area_id/skill_id, fracción de apariciones que provienen de
    artifacts con status=completed. Se usa únicamente como desempate de
    orden (señal secundaria) -- Fase 5A no trackea esto por grupo, así que
    se deriva acá con una pasada extra sobre los artifacts ya validados,
    sin tocar `artifact_profile_adapter.py`.
    """
    counts: dict[str, list[int]] = {}
    for artifact in artifacts:
        status = artifact.get("status")
        for entry in artifact.get(field_name) or []:
            group_id = entry.get("id") or entry.get("label") or "unknown"
            bucket = counts.setdefault(group_id, [0, 0])
            bucket[1] += 1
            if status == "completed":
                bucket[0] += 1
    return {k: (v[0] / v[1] if v[1] else 0.0) for k, v in counts.items()}


# ─── Redacción (lenguaje prudente, ver docstring del módulo) ───────────────────

def _area_explanation(area: dict[str, Any]) -> str:
    count = area["count"]
    hours = area["total_hours"]
    avg_conf = area["avg_confidence"]

    base = "se registra en 1 fuente analizada" if count == 1 else f"se registra en {count} fuentes analizadas"
    parts = [base]
    if hours > 0:
        parts.append(f"con {hours} horas curriculares acumuladas según las fuentes")
    if avg_conf is not None:
        parts.append(f"con confidence declarada promedio de {avg_conf}")
    else:
        parts.append("sin confidence numérica declarada en las fuentes (evaluación cualitativa)")

    return f"El área {area['label']} " + ", ".join(parts) + "."


def _skill_explanation(skill: dict[str, Any]) -> str:
    count = skill["count"]
    avg_conf = skill["avg_confidence"]
    explicit = skill["sources"].get("explicit", 0)
    inferred = skill["sources"].get("inferred", 0)

    if count == 1:
        base = f"se registra una única mención de {skill['label']} en las fuentes analizadas"
    else:
        base = f"se observa exposición reiterada a {skill['label']} ({count} menciones registradas en las fuentes analizadas)"

    detail: list[str] = []
    if explicit and not inferred:
        detail.append("detectada de forma explícita en el contenido curricular")
    elif inferred and not explicit:
        detail.append("detectada por inferencia, sin mención literal directa")
    elif explicit and inferred:
        detail.append(f"detectada de forma explícita en {explicit} fuente(s) e inferida en {inferred}")
    if avg_conf is not None:
        detail.append(f"confidence declarada promedio {avg_conf}")

    text = base
    if detail:
        text += " (" + "; ".join(detail) + ")"
    return text[0].upper() + text[1:] + "."


def _concept_explanation(concept: dict[str, Any]) -> str:
    count = concept["count"]
    return "Mencionado en 1 fuente." if count == 1 else f"Mencionado en {count} fuentes."


def _build_summary(
    aggregated: dict[str, Any],
    aggregate_confidence: dict[str, Any],
    main_areas: list[dict[str, Any]],
    main_skills: list[dict[str, Any]],
) -> str:
    total = aggregated["source_artifacts_count"]
    by_source = aggregated["by_source_type"]

    lead = f"Perfil formativo construido a partir de {total} fuente(s) analizada(s)"
    if by_source:
        breakdown = ", ".join(f"{v} de tipo {k}" for k, v in by_source.items())
        lead += f" ({breakdown})"
    lead += "."

    if main_areas:
        labels = ", ".join(a["label"] for a in main_areas[:3])
        areas_sentence = f"Las principales áreas con evidencia formativa son: {labels}."
    else:
        areas_sentence = "No se identificaron áreas con evidencia suficiente en las fuentes analizadas."

    if main_skills:
        labels = ", ".join(s["label"] for s in main_skills[:5])
        skills_sentence = f"Se observa exposición a las siguientes skills: {labels}."
    else:
        skills_sentence = "No se detectaron skills explícitas en las fuentes analizadas."

    band_phrase = {
        "high": "con un nivel de confianza alto según la evidencia disponible",
        "medium": "con un nivel de confianza medio según la evidencia disponible",
        "low": "con un nivel de confianza bajo; se recomienda revisión adicional",
        "unavailable": "sin señales suficientes para estimar un nivel de confianza",
    }.get(aggregate_confidence["band"], "con nivel de confianza no determinado")
    confidence_sentence = f"El análisis global se interpreta {band_phrase}."

    return " ".join([lead, areas_sentence, skills_sentence, confidence_sentence])


def _build_strengths(main_areas: list[dict[str, Any]], main_skills: list[dict[str, Any]]) -> list[str]:
    strengths: list[str] = []

    strong_areas = [a for a in main_areas if a["evidenceCount"] >= 2 or (a["confidence"] or 0) >= 0.75]
    if strong_areas:
        labels = ", ".join(a["label"] for a in strong_areas[:3])
        strengths.append(f"Se observa evidencia formativa consistente en: {labels}.")

    strong_skills = [s for s in main_skills if s["evidenceCount"] >= 2]
    if strong_skills:
        labels = ", ".join(s["label"] for s in strong_skills[:5])
        strengths.append(f"Presenta señales formativas repetidas en las siguientes skills: {labels}.")

    if not strengths:
        strengths.append(
            "La evidencia disponible en esta muestra de fuentes es limitada; no se identifican "
            "fortalezas consistentes con la información actual."
        )
    return strengths


def _build_possible_directions(main_areas: list[dict[str, Any]], main_skills: list[dict[str, Any]]) -> list[str]:
    if not main_areas and not main_skills:
        return []
    top_labels = [a["label"] for a in main_areas[:2]] + [s["label"] for s in main_skills[:3]]
    top_labels = _dedupe([label for label in top_labels if label])
    if not top_labels:
        return []
    joined = ", ".join(top_labels)
    return [
        f"Con la evidencia disponible, el perfil podría orientarse exploratoriamente hacia áreas "
        f"relacionadas con: {joined}. Esta orientación es exploratoria, no una recomendación laboral "
        f"ni una evaluación de aptitud."
    ]


def _build_limitations(
    artifacts: list[dict[str, Any]],
    aggregated: dict[str, Any],
    aggregate_confidence: dict[str, Any],
) -> tuple[list[str], list[str]]:
    """Devuelve (limitations legibles, codigos crudos de warnings vistos)."""
    limitations = list(aggregate_confidence.get("limitations", []))

    raw_codes: set[str] = set()
    for artifact in artifacts:
        raw_codes.update(artifact.get("warnings") or [])

    has_online = any(artifact.get("sourceType") == "online_course_catalog" for artifact in artifacts)
    if has_online:
        limitations.append(ONLINE_COMPLETION_LIMITATION)

    total = aggregated.get("source_artifacts_count") or 0
    partial_count = (aggregated.get("quality_summary", {}).get("status", {}) or {}).get("partial", 0)
    if total and (partial_count / total) >= PARTIAL_RATIO_WARNING_THRESHOLD:
        limitations.append(
            f"{partial_count} de {total} fuentes quedaron con análisis incompleto (status=partial): "
            "esto describe el estado del análisis semántico de esas fuentes, no una evaluación del "
            "perfil de la persona."
        )

    if not aggregated.get("skills"):
        limitations.append("No se detectaron skills explícitas en ninguna de las fuentes analizadas.")

    evidence = aggregated.get("evidence_summary", {})
    if total:
        area_evidence_ratio = (evidence.get("artifacts_with_area_evidence") or 0) / total
        if area_evidence_ratio < LOW_AREA_EVIDENCE_COVERAGE_THRESHOLD:
            limitations.append(
                "La cobertura de evidencia trazable de áreas es baja en el conjunto de fuentes analizado."
            )

    return _dedupe(limitations), sorted(raw_codes)


# ─── Entry point principal ─────────────────────────────────────────────────────

def build_formative_profile_narrative(artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Construye un perfil formativo textual (dict JSON-serializable) a
    partir de una lista de artifacts `semantic_analysis_v1`.

    No modifica los artifacts de entrada. No escribe nada en disco. No
    construye un `UserProfile`/perfil final ni reemplaza
    `profile_builder.py`/`course_adapter.py`.

    Levanta InvalidArtifactError si algún artifact no pasa la validación
    mínima de consumidor.
    """
    validated = load_artifacts_from_objects(artifacts)  # valida; no copia ni muta

    aggregated = build_aggregated_profile_input(validated)
    aggregate_confidence = interpret_aggregated_confidence(aggregated)
    per_artifact_confidence = interpret_artifacts_confidence(validated)

    completed_ratio_areas = _completed_ratios(validated, "areas")
    completed_ratio_skills = _completed_ratios(validated, "skills")

    sorted_areas = sorted(
        aggregated["areas"],
        key=lambda a: (
            -a["count"],
            -a["total_hours"],
            -(a["avg_confidence"] if a["avg_confidence"] is not None else -1),
            -completed_ratio_areas.get(a["id"], 0.0),
            a["id"],
        ),
    )[:MAIN_AREAS_LIMIT]

    sorted_skills = sorted(
        aggregated["skills"],
        key=lambda s: (
            -s["count"],
            -(s["avg_confidence"] if s["avg_confidence"] is not None else -1),
            -((s["sources"].get("explicit", 0) / s["count"]) if s["count"] else 0.0),
            -completed_ratio_skills.get(s["id"], 0.0),
            s["id"],
        ),
    )[:MAIN_SKILLS_LIMIT]

    sorted_concepts = sorted(aggregated["concepts"], key=lambda c: (-c["count"], c["id"]))[:MAIN_CONCEPTS_LIMIT]

    main_areas = [
        {
            "label": a["label"],
            "evidenceCount": a["count"],
            "hours": a["total_hours"],
            "confidence": a["avg_confidence"],
            "explanation": _area_explanation(a),
            "sourceExamples": a["source_ref_examples"],
        }
        for a in sorted_areas
    ]
    main_skills = [
        {
            "label": s["label"],
            # semantic_analysis_v1 no trae un campo `domain` hoy (ver SkillEntry
            # en src/exporters/backend_contract/models.py) -- se deja explicito
            # en None, nunca inferido/hardcodeado (ver docstring del modulo).
            "domain": None,
            "evidenceCount": s["count"],
            "confidence": s["avg_confidence"],
            "explanation": _skill_explanation(s),
            "sourceExamples": s["source_ref_examples"],
        }
        for s in sorted_skills
    ]
    main_concepts = [
        {
            "label": c["label"],
            "evidenceCount": c["count"],
            "explanation": _concept_explanation(c),
            "sourceExamples": c["source_ref_examples"],
        }
        for c in sorted_concepts
    ]

    limitations, warning_codes = _build_limitations(validated, aggregated, aggregate_confidence)

    return {
        "profileVersion": PROFILE_VERSION,
        "summary": _build_summary(aggregated, aggregate_confidence, main_areas, main_skills),
        "confidenceSummary": {
            "band": aggregate_confidence["band"],
            "explanation": aggregate_confidence["explanation"],
            "limitations": list(aggregate_confidence["limitations"]),
        },
        "mainAreas": main_areas,
        "mainSkills": main_skills,
        "mainConcepts": main_concepts,
        "strengths": _build_strengths(main_areas, main_skills),
        "possibleDirections": _build_possible_directions(main_areas, main_skills),
        "limitations": limitations,
        "evidenceOverview": aggregated["evidence_summary"],
        "sourceCoverage": {
            "sourceArtifactsCount": aggregated["source_artifacts_count"],
            "bySourceType": aggregated["by_source_type"],
            "sourceRefs": aggregated["metadata"]["source_refs"],
            "note": "sourceRefs es trazabilidad de origen, no identidad de usuario/holder/issuer.",
        },
        "warnings": warning_codes,
        "debug": {
            "aggregated": aggregated,
            "aggregateConfidence": aggregate_confidence,
            "perArtifactConfidence": per_artifact_confidence,
        },
    }


def render_formative_profile_markdown(profile: dict[str, Any]) -> str:
    """Renderiza el dict de `build_formative_profile_narrative` a Markdown legible."""
    lines: list[str] = [f"# Perfil formativo (experimental) — {profile['profileVersion']}", ""]
    lines.append(profile["summary"])
    lines.append("")

    cs = profile["confidenceSummary"]
    lines.append(f"## Confianza del análisis: {cs['band']}")
    lines.append(cs["explanation"])
    if cs["limitations"]:
        lines.append("")
        lines.append("Limitaciones de confianza:")
        for item in cs["limitations"]:
            lines.append(f"- {item}")
    lines.append("")

    lines.append("## Áreas principales")
    if profile["mainAreas"]:
        for area in profile["mainAreas"]:
            lines.append(f"### {area['label']}")
            lines.append(area["explanation"])
            lines.append("")
    else:
        lines.append("No se identificaron áreas con evidencia suficiente.")
        lines.append("")

    lines.append("## Skills principales")
    if profile["mainSkills"]:
        for skill in profile["mainSkills"]:
            lines.append(f"### {skill['label']}")
            lines.append(skill["explanation"])
            lines.append("")
    else:
        lines.append("No se detectaron skills explícitas.")
        lines.append("")

    if profile["mainConcepts"]:
        lines.append("## Conceptos principales")
        for concept in profile["mainConcepts"]:
            lines.append(f"- {concept['label']} ({concept['explanation']})")
        lines.append("")

    if profile["strengths"]:
        lines.append("## Fortalezas observadas")
        for item in profile["strengths"]:
            lines.append(f"- {item}")
        lines.append("")

    if profile["possibleDirections"]:
        lines.append("## Posibles orientaciones exploratorias")
        for item in profile["possibleDirections"]:
            lines.append(f"- {item}")
        lines.append("")

    if profile["limitations"]:
        lines.append("## Limitaciones")
        for item in profile["limitations"]:
            lines.append(f"- {item}")
        lines.append("")

    sc = profile["sourceCoverage"]
    lines.append("## Cobertura de fuentes")
    lines.append(f"- Total de fuentes analizadas: {sc['sourceArtifactsCount']}")
    lines.append(f"- Por tipo de fuente: {sc['bySourceType']}")
    lines.append(f"- Nota: {sc['note']}")
    lines.append("")

    return "\n".join(lines) + "\n"

"""
Funciones puras de normalizacion: areas, skills, concepts, quality flags,
status, confidence y evidence map. Sin efectos de lado — no leen ni
escriben archivos. Toda la logica de I/O vive en `semantic_analysis_exporter.py`
y `cli.py`.
"""
from __future__ import annotations

import re
from typing import Any, Optional

from src.text_utils import normalize_for_match

# Sentinel tecnico que el pipeline PDF usa hoy dentro de `areas_detected` /
# `areas_detected_detail` cuando no logra resolver un area con confianza
# suficiente. No debe copiarse al array publico `areas` — ver
# ai-backend-integration-contract-v0.md seccion 6.5 y el ejemplo de
# BM-... "unresolved_domain_candidate" en el reporte de viabilidad.
PDF_UNRESOLVED_AREA_SENTINEL = "unresolved_domain_candidate"

# Sentinels tecnicos internos que pueden filtrarse a texto libre generado
# por los pipelines (ej. `text_for_embedding` arma "Areas predominantes: ..."
# concatenando `areas_detected` tal cual, sentinel incluido). Se reemplazan
# por una descripcion neutral antes de exponer `textForEmbedding` en el
# artifact publico — la razon tecnica real sigue disponible en
# `partialReasons`, nunca se pierde, solo deja de filtrarse como si fuera
# taxonomia. Mapa deliberadamente acotado: solo sentinels conocidos, no un
# filtro generico de texto.
_TEXT_SENTINEL_REPLACEMENTS: dict[str, str] = {
    PDF_UNRESOLVED_AREA_SENTINEL: "área no resuelta",
}


def sanitize_text_for_embedding(text: Optional[str]) -> str:
    if not text:
        return text or ""
    sanitized = text
    for sentinel, replacement in _TEXT_SENTINEL_REPLACEMENTS.items():
        sanitized = sanitized.replace(sentinel, replacement)
    return sanitized

# detection_mode (PDF) → source ("explicit" | "inferred"). Los modos con
# match textual directo sobre el nombre/contenido del curso se consideran
# "explicit"; los modos semanticos/por similitud se consideran "inferred".
_PDF_SKILL_SOURCE_MAP: dict[str, str] = {
    "explicit_exact_match": "explicit",
    "explicit_alias_match": "explicit",
    "semantic_match_local_strong": "inferred",
    "semantic_match_local_weak": "inferred",
}


def slugify_id(label: str, fallback: str = "unknown") -> str:
    """Slug estable a partir de un label libre. Independiente de profile_builder
    (evita acoplar este exporter a las reglas de alias de skills del perfil)."""
    if not label:
        return fallback
    cleaned = normalize_for_match(label)
    slug = re.sub(r"\s+", "_", cleaned).strip("_")
    return slug or fallback


def safe_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if f == f else None  # descarta NaN


# ─── Status ────────────────────────────────────────────────────────────────

def derive_status_pdf(area_assignment_status: Optional[str]) -> str:
    """confident -> completed; cualquier otro valor (incluido ausente) -> partial."""
    return "completed" if area_assignment_status == "confident" else "partial"


def derive_status_online(areas_present: bool) -> str:
    """El pipeline online no tiene un status explicito hoy. Regla adoptada:
    completed si se detecto al menos un area; partial si no."""
    return "completed" if areas_present else "partial"


# ─── Areas ─────────────────────────────────────────────────────────────────

def normalize_pdf_areas(semantic_final: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    """
    Devuelve (areas_normalizadas, sentinel_encontrado).

    areas_normalizadas: list[dict] con id/label/confidence/confidenceMethod/source,
    ya sin el sentinel `unresolved_domain_candidate` si aparecia.
    """
    details = semantic_final.get("areas_detected_detail")
    if not isinstance(details, list) or not details:
        # Fallback: solo hay areas_detected (lista de labels), sin evidence_strength.
        details = [
            {"area_id": slugify_id(label, "area_unknown"), "area_label": label, "evidence_strength": None}
            for label in (semantic_final.get("areas_detected") or [])
            if label
        ]

    sentinel_found = False
    areas: list[dict[str, Any]] = []
    for detail in details:
        if not isinstance(detail, dict):
            continue
        label = detail.get("area_label", "")
        if label == PDF_UNRESOLVED_AREA_SENTINEL:
            sentinel_found = True
            continue

        area_id = detail.get("area_id") or slugify_id(label, "area_unknown")
        confidence = safe_float(detail.get("evidence_strength"))
        areas.append(
            {
                "id": area_id,
                "label": label,
                "confidence": confidence,
                "confidenceMethod": "measured" if confidence is not None else "unavailable",
                "source": "explicit",
            }
        )

    return areas, sentinel_found


def normalize_online_areas(semantic_final: dict[str, Any]) -> list[dict[str, Any]]:
    areas_detected = semantic_final.get("areas_detected") or []
    areas: list[dict[str, Any]] = []
    for label in areas_detected:
        if not label:
            continue
        areas.append(
            {
                "id": slugify_id(label, "area_unknown"),
                "label": label,
                "confidence": None,
                "confidenceMethod": "unavailable",
                "source": "inferred",
            }
        )
    return areas


# ─── Skills ────────────────────────────────────────────────────────────────

def normalize_pdf_skills(semantic_final: dict[str, Any]) -> list[dict[str, Any]]:
    skills_detected = semantic_final.get("skills_detected") or []
    skills: list[dict[str, Any]] = []
    for sk in skills_detected:
        if not isinstance(sk, dict):
            continue
        label = (sk.get("skill_label") or sk.get("skill") or "").strip()
        if not label:
            continue
        confidence = safe_float(sk.get("confidence"))
        detection_mode = sk.get("detection_mode")
        source = _PDF_SKILL_SOURCE_MAP.get(detection_mode, "inferred") if detection_mode else "inferred"
        skills.append(
            {
                "id": sk.get("skill_id") or slugify_id(label, "skill_unknown"),
                "label": label,
                "confidence": confidence,
                "confidenceMethod": "measured" if confidence is not None else "unavailable",
                "source": source,
            }
        )
    return skills


def normalize_online_skills(semantic_final: dict[str, Any]) -> list[dict[str, Any]]:
    skills_detected = semantic_final.get("skills_detected") or []
    skills_source = semantic_final.get("skills_source")
    explicit_labels: set[str] = set()
    if isinstance(skills_source, dict):
        explicit_labels = set(skills_source.get("explicit") or [])

    skills: list[dict[str, Any]] = []
    for label in skills_detected:
        if not isinstance(label, str) or not label.strip():
            continue
        source = "explicit" if label in explicit_labels else "inferred"
        skills.append(
            {
                "id": slugify_id(label, "skill_unknown"),
                "label": label,
                "confidence": None,
                "confidenceMethod": "unavailable",
                "source": source,
            }
        )
    return skills


# ─── Concepts ──────────────────────────────────────────────────────────────

def normalize_concepts(semantic_final: dict[str, Any]) -> list[dict[str, Any]]:
    """Comun a PDF y online: ninguno de los dos pipelines produce confidence
    por concepto hoy — se representa explicitamente como no disponible."""
    concepts_detected = semantic_final.get("concepts_detected") or []
    concepts: list[dict[str, Any]] = []
    for label in concepts_detected:
        if not label:
            continue
        concepts.append(
            {
                "id": slugify_id(label, "concept_unknown"),
                "label": label,
                "confidence": None,
                "confidenceMethod": "unavailable",
            }
        )
    return concepts


# ─── Hours distribution ────────────────────────────────────────────────────

def normalize_hours_distribution(semantic_final: dict[str, Any]) -> list[dict[str, Any]]:
    dist = semantic_final.get("hours_distribution_estimate")
    if not isinstance(dist, dict):
        return []

    by_area = dist.get("by_area")
    if not isinstance(by_area, list):
        return []

    result: list[dict[str, Any]] = []
    for item in by_area:
        if not isinstance(item, dict):
            continue
        label = item.get("area", "")
        area_id = item.get("area_id") or slugify_id(label, "area_unknown")
        hours = safe_float(item.get("estimated_hours"))
        if hours is None:
            continue
        result.append({"areaId": area_id, "hours": hours})
    return result


# ─── Evidence map ──────────────────────────────────────────────────────────

def normalize_pdf_evidence_map(semantic_final: dict[str, Any]) -> dict[str, dict[str, list[str]]]:
    """PDF: evidence_map.areas/skills son list[dict] ricos — se resumen a
    dict[id -> list[str]] con las señales clave (matched_signal, seccion),
    sin exponer scores internos crudos (raw_area_signal_score, validation_*)."""
    raw = semantic_final.get("evidence_map")
    if not isinstance(raw, dict):
        return {"areas": {}, "skills": {}, "concepts": {}}

    areas_out: dict[str, list[str]] = {}
    for entry in raw.get("areas") or []:
        if not isinstance(entry, dict):
            continue
        area_id = entry.get("area_id") or slugify_id(entry.get("area", ""), "area_unknown")
        if entry.get("area") == PDF_UNRESOLVED_AREA_SENTINEL:
            continue
        signals = []
        if entry.get("matched_signal"):
            signals.append(f"matched_signal:{entry['matched_signal']}")
        if entry.get("evidence_source_section"):
            signals.append(f"evidence_source_section:{entry['evidence_source_section']}")
        areas_out.setdefault(area_id, []).extend(signals)

    skills_out: dict[str, list[str]] = {}
    for entry in raw.get("skills") or []:
        if not isinstance(entry, dict):
            continue
        skill_id = entry.get("skill_id") or slugify_id(entry.get("skill", ""), "skill_unknown")
        signals = []
        if entry.get("matched_signal"):
            signals.append(f"matched_signal:{entry['matched_signal']}")
        if entry.get("evidence_source_section"):
            signals.append(f"evidence_source_section:{entry['evidence_source_section']}")
        skills_out.setdefault(skill_id, []).extend(signals)

    return {"areas": areas_out, "skills": skills_out, "concepts": {}}


def normalize_online_evidence_map(semantic_final: dict[str, Any]) -> dict[str, dict[str, list[str]]]:
    """Online: evidence_map.areas/skills ya son dict[str, list[str]] simples
    (ej. {"MongoDB": ["title"]}, {"Databases": ["skill:MongoDB"]}) — se
    re-clavan por id normalizado en vez de por label crudo."""
    raw = semantic_final.get("evidence_map")
    if not isinstance(raw, dict):
        return {"areas": {}, "skills": {}, "concepts": {}}

    areas_out: dict[str, list[str]] = {}
    raw_areas = raw.get("areas")
    if isinstance(raw_areas, dict):
        for label, signals in raw_areas.items():
            area_id = slugify_id(label, "area_unknown")
            areas_out[area_id] = list(signals) if isinstance(signals, list) else []

    skills_out: dict[str, list[str]] = {}
    raw_skills = raw.get("skills")
    if isinstance(raw_skills, dict):
        for label, signals in raw_skills.items():
            skill_id = slugify_id(label, "skill_unknown")
            skills_out[skill_id] = list(signals) if isinstance(signals, list) else []

    return {"areas": areas_out, "skills": skills_out, "concepts": {}}


# ─── Confidence ────────────────────────────────────────────────────────────

def compute_global_confidence_pdf(
    areas: list[dict[str, Any]], skills: list[dict[str, Any]]
) -> tuple[Optional[float], str]:
    """Promedio de los confidence "measured" disponibles (areas + skills).
    method="derived" porque el numero se calcula aca, no viene ya agregado
    del pipeline. Si no hay ningun valor measured, confidence=None,
    method="unavailable" — nunca se fabrica un numero sin base real."""
    measured = [
        item["confidence"]
        for item in (areas + skills)
        if item.get("confidenceMethod") == "measured" and item.get("confidence") is not None
    ]
    if not measured:
        return None, "unavailable"
    return round(sum(measured) / len(measured), 4), "derived"


def unavailable_confidence() -> tuple[Optional[float], str]:
    """Online: no hay ninguna base real de confidence hoy en el pipeline.
    Nunca se fabrica un numero — se declara explicitamente no disponible."""
    return None, "unavailable"


# ─── Texto (C2b.1) ──────────────────────────────────────────────────────────
# El pipeline de deteccion (semantic_builder.detect_skills / build_area_evidence)
# fue calibrado sobre PDFs con secciones curriculares explicitas
# (objetivos, contenidos minimos, etc.). Un texto de course sin esa
# estructura (titulo + descripcion declarados por el emisor) es evidencia
# estructuralmente mas debil, aunque el mismo hit de keyword produzca el
# mismo score numerico. Para no heredar una confianza que aparenta haber
# sido calibrada ("measured") sobre una fuente que nunca tuvo ese nivel de
# evidencia, se topea el valor y se re-etiqueta como "heuristic".
TEXT_CONFIDENCE_CEILING = 0.45


def apply_text_confidence_policy(entry: dict[str, Any], ceiling: float = TEXT_CONFIDENCE_CEILING) -> dict[str, Any]:
    confidence = entry.get("confidence")
    if confidence is None:
        return entry
    capped = min(float(confidence), ceiling)
    return {**entry, "confidence": round(capped, 2), "confidenceMethod": "heuristic"}


def normalize_text_areas(semantic_final: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    """Reusa la forma PDF (mismo build_semantic_output subyacente vía
    manual_text) pero aplica la politica de confidence conservadora de texto."""
    areas, sentinel_found = normalize_pdf_areas(semantic_final)
    return [apply_text_confidence_policy(a) for a in areas], sentinel_found


def normalize_text_skills(semantic_final: dict[str, Any]) -> list[dict[str, Any]]:
    skills = normalize_pdf_skills(semantic_final)
    return [apply_text_confidence_policy(s) for s in skills]


def derive_status_text(area_assignment_status: Optional[str], is_short_unstructured_text: bool) -> str:
    """Igual regla que PDF (confident -> completed), salvo que un texto
    corto/no estructurado nunca se declara "completed": la evidencia
    disponible no alcanza para afirmar un analisis completo."""
    if is_short_unstructured_text:
        return "partial"
    return derive_status_pdf(area_assignment_status)

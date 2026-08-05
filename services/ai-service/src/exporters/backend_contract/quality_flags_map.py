"""
Mapeo explicito entre los quality flags heterogeneos que producen hoy
los dos pipelines (PDF: dict de ~20 claves; online: list[str] de ~5
codigos) y una lista publica normalizada de codigos estables.

No inventa flags que no reflejen un dato real presente en la fuente.
Cualquier valor no reconocido se preserva con el prefijo
`unmapped_quality_flag:` en vez de descartarse en silencio.
"""
from __future__ import annotations

from typing import Any, Optional

# ─── PDF: area_assignment_status → codigo publico ────────────────────────────

PDF_AREA_ASSIGNMENT_STATUS_MAP: dict[str, str] = {
    "confident": "area_assignment_confident",
    "low_confidence_multi_candidate": "area_assignment_low_confidence",
    "insufficient_evidence_for_confident_area_assignment": "area_assignment_insufficient_evidence",
    "unresolved_domain_candidate": "area_assignment_unresolved",
}

# ─── Online: quality_flags (list[str]) → codigo publico ──────────────────────
# Identidad deliberada: los codigos que ya produce skill_inference.py
# (detect_quality_flags) son suficientemente estables y descriptivos como
# para no renombrarlos. Se mapean explicitamente de todos modos para que
# un flag nuevo y no contemplado no se cuele sin pasar por este archivo.

ONLINE_QUALITY_FLAGS_MAP: dict[str, str] = {
    "missing_description": "missing_description",
    "missing_category": "missing_category",
    "missing_explicit_skills": "missing_explicit_skills",
    "inferred_skills_only": "inferred_skills_only",
    "low_text_signal": "low_text_signal",
}


def _bucket_reliability(name: str, value: Any) -> Optional[str]:
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v >= 0.8:
        bucket = "high"
    elif v > 0.0:
        bucket = "medium"
    else:
        bucket = "low_or_absent"
    return f"{name}_{bucket}"


def flatten_pdf_quality_flags(qf: dict[str, Any]) -> list[str]:
    """
    Reduce el dict de ~20 claves del pipeline PDF a una lista publica de
    codigos estables. No expone los scores numericos internos crudos
    (family_signal_*, raw_area_signal_score, validation_flags, etc.) —
    esos quedan como debugging interno, fuera del artifact publico.
    """
    if not isinstance(qf, dict):
        return []

    flags: list[str] = []

    status = qf.get("area_assignment_status")
    if status in PDF_AREA_ASSIGNMENT_STATUS_MAP:
        flags.append(PDF_AREA_ASSIGNMENT_STATUS_MAP[status])
    elif status:
        flags.append(f"unmapped_quality_flag:area_assignment_status={status}")

    semantic_quality = qf.get("semantic_quality_status")
    if semantic_quality:
        flags.append(f"semantic_quality_{semantic_quality}")

    skills_bucket = _bucket_reliability("skills_detection_reliability", qf.get("skills_detection_reliability"))
    if skills_bucket:
        flags.append(skills_bucket)

    hours_bucket = _bucket_reliability("hours_distribution_reliability", qf.get("hours_distribution_reliability"))
    if hours_bucket:
        flags.append(hours_bucket)

    return flags


def flatten_online_quality_flags(flags_list: list[Any]) -> list[str]:
    """Mapea la lista de codigos del pipeline online a codigos publicos."""
    if not isinstance(flags_list, list):
        return []

    result: list[str] = []
    for flag in flags_list:
        if not isinstance(flag, str):
            continue
        result.append(ONLINE_QUALITY_FLAGS_MAP.get(flag, f"unmapped_quality_flag:{flag}"))
    return result

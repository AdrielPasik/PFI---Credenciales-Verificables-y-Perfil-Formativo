from __future__ import annotations

import re
from typing import Any

from src.profile_builder.confidence_scorer import score_csv_skill, score_pdf_skill
from src.profile_builder.profile_models import (
    NormalizedAreaRecord,
    NormalizedCourseRecord,
    NormalizedSkillRecord,
)
from src.profile_builder.skill_aliases import resolve_skill_alias
from src.text_utils import normalize_for_match


# ─── Skill canonicalization ───────────────────────────────────────────────────

# normalize_for_match strips punctuation, which collapses "C++" and "C" into "c".
# These overrides preserve meaningful distinctions before normalization runs.
_CANONICAL_OVERRIDES: dict[str, str] = {
    "c++": "cpp",
    "c#": "csharp",
    ".net": "dotnet",
    "node.js": "nodejs",
    "next.js": "nextjs",
    "vue.js": "vuejs",
    "express.js": "expressjs",
    "react.js": "react",
    "react router": "react_router",
    "asp.net": "aspnet",
    "angular.js": "angularjs",
}


def canonical_skill_id(label: str) -> str:
    lowered = label.lower().strip()
    # 1. Hard overrides for symbols that survive normalization incorrectly
    if lowered in _CANONICAL_OVERRIDES:
        return _CANONICAL_OVERRIDES[lowered]
    # 2. Conservative alias lookup (e.g. "python programming" → "python")
    alias = resolve_skill_alias(lowered)
    if alias:
        return alias
    # 3. General normalization: lowercase, strip accents, replace spaces with _
    cleaned = normalize_for_match(lowered)
    return re.sub(r"\s+", "_", cleaned).strip("_") or "unknown_skill"


def _area_id_from_label(label: str) -> str:
    cleaned = normalize_for_match(label)
    return re.sub(r"[^a-z0-9]+", "_", cleaned).strip("_") or "unknown_area"


# ─── Format detection ─────────────────────────────────────────────────────────

def _detect_format(data: dict[str, Any]) -> str:
    """
    Returns one of: "nested_pdf", "nested_csv", "flat_pdf".

    Detection strategy:
      - nested = has both "raw_normalized" and "semantic_final" keys
        - nested_csv: quality_flags is a list, OR skills_source key is present
        - nested_pdf: quality_flags is a dict
      - flat = top-level contains semantic fields directly (courses_semantic.json records)
    """
    if "raw_normalized" in data and "semantic_final" in data:
        sf = data["semantic_final"]
        qf = sf.get("quality_flags", {})
        if isinstance(qf, list) or "skills_source" in sf:
            return "nested_csv"
        return "nested_pdf"

    if any(k in data for k in ("name", "course_code", "areas", "skills_detected")):
        return "flat_pdf"

    raise ValueError(
        f"Cannot determine JSON format — top-level keys: {list(data.keys())[:10]}"
    )


# ─── Public entry point ───────────────────────────────────────────────────────

def adapt_course_json(data: dict[str, Any], source_name: str) -> NormalizedCourseRecord:
    """
    Convert any processed course JSON into a NormalizedCourseRecord.

    source_name: filename stem — used as stable course_id.
    """
    fmt = _detect_format(data)

    if fmt == "nested_pdf":
        return _adapt_nested_pdf(data, source_name)

    if fmt == "nested_csv":
        return _adapt_nested_csv(data, source_name)

    # flat_pdf: wrap into nested structure so _adapt_nested_pdf can be reused
    wrapped: dict[str, Any] = {
        "raw_normalized": {
            "name": data.get("name") or data.get("title", ""),
            "hours_total": data.get("hours_total"),
            "course_code": data.get("course_code", ""),
        },
        "semantic_final": data,
    }
    return _adapt_nested_pdf(wrapped, source_name)


# ─── PDF adapter ──────────────────────────────────────────────────────────────

def _adapt_nested_pdf(data: dict[str, Any], course_id: str) -> NormalizedCourseRecord:
    rn = data["raw_normalized"]
    sf = data["semantic_final"]

    qf = sf.get("quality_flags", {})
    if not isinstance(qf, dict):
        qf = {}

    skills_reliability = _safe_float(qf.get("skills_detection_reliability"), default=0.5)
    quality_level = qf.get("semantic_quality_status", "medium") or "medium"
    domain_family = qf.get("domain_family_detected")

    hours_total = _parse_hours(rn.get("hours_total") or sf.get("hours_total"))

    skills = _parse_pdf_skills(sf, skills_reliability)
    areas = _parse_pdf_areas(sf)

    return NormalizedCourseRecord(
        course_id=course_id,
        title=sf.get("name") or rn.get("name") or "",
        platform=rn.get("platform", "academic_pdf"),
        pipeline_type="academic_pdf",
        hours_total=hours_total,
        skills=skills,
        areas=areas,
        quality_level=quality_level,
        skills_reliability=skills_reliability,
        domain_family=domain_family,
        hours_estimation_method=None,
    )


def _parse_pdf_skills(
    sf: dict[str, Any], skills_reliability: float
) -> list[NormalizedSkillRecord]:
    records: list[NormalizedSkillRecord] = []
    for sk in sf.get("skills_detected", []):
        if not isinstance(sk, dict):
            continue
        label = sk.get("skill", "").strip()
        if not label:
            continue

        raw_conf = _safe_float(sk.get("confidence"), default=0.5)
        confidence = score_pdf_skill(raw_conf, skills_reliability)

        records.append(
            NormalizedSkillRecord(
                skill_label=label,
                skill_id=canonical_skill_id(label),
                source_type=sk.get("detection_mode", "unknown"),
                confidence=confidence,
                is_core=bool(sk.get("is_core_skill_in_course", False)),
                skill_weight=_safe_float(sk.get("skill_weight_in_course"), default=0.3),
                evidence_sources=[sk.get("evidence_source_section", "unknown")],
                evidence_text_span=sk.get("evidence_text_span") or None,
            )
        )
    return records


def _parse_pdf_areas(sf: dict[str, Any]) -> list[NormalizedAreaRecord]:
    dist = sf.get("hours_distribution_estimate", {})
    if not isinstance(dist, dict):
        dist = {}

    dist_by_label: dict[str, float] = {}
    for item in dist.get("by_area", []):
        if isinstance(item, dict) and item.get("area"):
            dist_by_label[item["area"]] = _safe_float(item.get("estimated_hours"), default=0.0)

    area_details = sf.get("areas_detected_detail", [])
    if not isinstance(area_details, list):
        area_details = []

    # Fallback: build minimal records from the plain "areas" list
    if not area_details:
        for label in sf.get("areas", sf.get("areas_detected", [])):
            if label:
                area_details.append(
                    {
                        "area_id": _area_id_from_label(label),
                        "area_label": label,
                        "evidence_strength": 0.5,
                    }
                )

    records: list[NormalizedAreaRecord] = []
    for detail in area_details:
        if not isinstance(detail, dict):
            continue
        label = detail.get("area_label", "")
        area_id = detail.get("area_id") or _area_id_from_label(label)
        estimated_hours = dist_by_label.get(label)

        records.append(
            NormalizedAreaRecord(
                area_id=area_id,
                area_label=label,
                area_group="academic",
                estimated_hours=estimated_hours if estimated_hours else None,
                evidence_strength=_safe_float(detail.get("evidence_strength"), default=0.5),
            )
        )
    return records


# ─── CSV adapter ──────────────────────────────────────────────────────────────

def _adapt_nested_csv(data: dict[str, Any], course_id: str) -> NormalizedCourseRecord:
    rn = data["raw_normalized"]
    sf = data["semantic_final"]

    duration = _parse_hours(rn.get("duration_hours_estimate"))

    quality_flags = sf.get("quality_flags", [])
    if not isinstance(quality_flags, list):
        quality_flags = []

    skills_source = sf.get("skills_source", {})
    if not isinstance(skills_source, dict):
        skills_source = {}

    explicit_labels: set[str] = set(skills_source.get("explicit", []))
    evidence_map_skills: dict[str, list[str]] = (
        sf.get("evidence_map", {}).get("skills", {})
    )
    if not isinstance(evidence_map_skills, dict):
        evidence_map_skills = {}

    all_detected: list[str] = sf.get("skills_detected", [])
    if not isinstance(all_detected, list):
        all_detected = []
    all_detected = [s for s in all_detected if isinstance(s, str) and s.strip()]

    n_skills = len(all_detected)
    hours_per_skill = (duration / n_skills) if (duration and n_skills > 0) else None
    hours_method = "prorated_equal_distribution" if hours_per_skill is not None else None

    skills: list[NormalizedSkillRecord] = []
    for sk_name in all_detected:
        source_type = _classify_csv_skill(sk_name, explicit_labels, evidence_map_skills)
        confidence = score_csv_skill(source_type, quality_flags)
        ev_sources = list(evidence_map_skills.get(sk_name, []))

        skills.append(
            NormalizedSkillRecord(
                skill_label=sk_name,
                skill_id=canonical_skill_id(sk_name),
                source_type=source_type,
                confidence=confidence,
                is_core=(source_type == "explicit_csv"),
                # Equal weight per skill: hours are split across all detected skills
                skill_weight=(1.0 / n_skills) if n_skills > 0 else 0.0,
                evidence_sources=ev_sources,
                evidence_text_span=None,
            )
        )

    areas_detected: list[str] = sf.get("areas_detected", [])
    if not isinstance(areas_detected, list):
        areas_detected = []
    n_areas = len(areas_detected)
    hours_per_area = (duration / n_areas) if (duration and n_areas > 0) else None

    areas: list[NormalizedAreaRecord] = []
    for area_name in areas_detected:
        if not area_name:
            continue
        areas.append(
            NormalizedAreaRecord(
                area_id=_area_id_from_label(area_name),
                area_label=area_name,
                area_group="online",
                estimated_hours=hours_per_area,
                evidence_strength=0.70,
            )
        )

    if "low_text_signal" in quality_flags or "missing_description" in quality_flags:
        quality_level = "low"
    else:
        quality_level = "medium"

    return NormalizedCourseRecord(
        course_id=course_id,
        title=rn.get("title", ""),
        platform=rn.get("platform", ""),
        pipeline_type="online_csv",
        hours_total=duration,
        skills=skills,
        areas=areas,
        quality_level=quality_level,
        skills_reliability=0.70 if skills else 0.0,
        domain_family=None,
        hours_estimation_method=hours_method,
    )


def _classify_csv_skill(
    skill_name: str,
    explicit_labels: set[str],
    evidence_map_skills: dict[str, list[str]],
) -> str:
    if skill_name in explicit_labels:
        return "explicit_csv"
    sources = evidence_map_skills.get(skill_name, [])
    if "title" in sources:
        return "inferred_title"
    return "inferred_description"


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _safe_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        result = float(value)
        return result if result == result else default  # NaN check
    except (TypeError, ValueError):
        return default


def _parse_hours(value: Any) -> float | None:
    """Return hours as a positive float, or None when the value is absent or non-positive."""
    if value is None:
        return None
    try:
        h = float(value)
        return h if (h == h and h > 0) else None  # NaN or ≤ 0 → None
    except (TypeError, ValueError):
        return None

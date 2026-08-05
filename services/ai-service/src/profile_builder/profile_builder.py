from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.profile_builder.area_aggregator import aggregate_areas
from src.profile_builder.course_adapter import adapt_course_json
from src.profile_builder.profile_models import (
    CompletenessBreakdown,
    CourseProcessedEntry,
    NormalizedCourseRecord,
    ProfileSummary,
    UserProfile,
)
from src.profile_builder.skill_aggregator import aggregate_skills, total_skill_hours

_PROFILE_VERSION = "1.1"
_TOP_N = 5


def build_profile(
    user_id: str,
    course_json_paths: list[Path],
    pipeline_type_filter: str | None = None,
) -> UserProfile:
    """
    Build a UserProfile from a list of processed course JSON paths.

    pipeline_type_filter: "academic_pdf" | "online_csv" | None (both)

    Duplicate course_ids within the same run are skipped — first occurrence wins.
    Safe to run against a directory that contains both individual JSONs and a
    consolidated file.
    """
    normalized: list[NormalizedCourseRecord] = []
    seen_ids: set[str] = set()

    for path in course_json_paths:
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            logging.warning("Skipping %s — read error: %s", path.name, exc)
            continue

        if _is_consolidated_file(data):
            logging.info("Skipping consolidated file: %s", path.name)
            continue

        try:
            record = adapt_course_json(data, source_name=path.stem)
        except Exception as exc:
            logging.warning("Skipping %s — adapt error: %s", path.name, exc)
            continue

        if pipeline_type_filter and record.pipeline_type != pipeline_type_filter:
            continue

        if record.course_id in seen_ids:
            logging.debug("Duplicate skipped: %s", record.course_id)
            continue

        seen_ids.add(record.course_id)
        normalized.append(record)

    skills = aggregate_skills(normalized)
    areas = aggregate_areas(normalized)
    summary = _build_summary(normalized, skills, areas)
    methodology = _build_methodology()

    courses_processed = [
        CourseProcessedEntry(
            course_id=c.course_id,
            title=c.title,
            platform=c.platform,
            hours_total=c.hours_total,
            pipeline_type=c.pipeline_type,
            quality_status=c.quality_level,
            hours_estimation_method=c.hours_estimation_method,
        )
        for c in normalized
    ]

    return UserProfile(
        user_id=user_id,
        profile_version=_PROFILE_VERSION,
        generated_at=datetime.now(timezone.utc).isoformat(),
        summary=summary,
        skills=skills,
        areas=areas,
        courses_processed=courses_processed,
        profile_methodology=methodology,
    )


# ─── Summary ──────────────────────────────────────────────────────────────────

def _build_summary(
    courses: list[NormalizedCourseRecord],
    skills: dict,
    areas: dict,
) -> ProfileSummary:
    total_learning = sum(c.hours_total for c in courses if c.hours_total)
    total_skill = total_skill_hours(skills)

    top_skills = sorted(
        skills.values(),
        key=lambda e: (e.composite_confidence, e.skill_hours_estimated),
        reverse=True,
    )[:_TOP_N]

    top_areas = sorted(
        areas.values(),
        key=lambda e: e.total_hours_estimated,
        reverse=True,
    )[:_TOP_N]

    completeness, breakdown = _completeness_score(courses)

    return ProfileSummary(
        total_courses=len(courses),
        total_learning_hours_estimated=round(total_learning, 2),
        total_skill_hours_estimated=round(total_skill, 2),
        top_skills=[e.skill_label for e in top_skills],
        top_areas=[e.area_label for e in top_areas],
        dominant_domain_family=_dominant_family(courses),
        profile_completeness_score=completeness,
        profile_completeness_breakdown=breakdown,
    )


def _dominant_family(courses: list[NormalizedCourseRecord]) -> str | None:
    families = [c.domain_family for c in courses if c.domain_family]
    if not families:
        return None
    return Counter(families).most_common(1)[0][0]


def _completeness_score(courses: list[NormalizedCourseRecord]) -> tuple[float, CompletenessBreakdown]:
    """
    Aggregate completeness: each component is independently interpretable.

    Score = 0.40 * pct_with_hours
          + 0.30 * pct_with_skills
          + 0.20 * pct_with_areas
          + 0.10 * avg_quality_signal

    Weights reflect information value:
      - Hours (0.40): most important for time-based learning evidence
      - Skills (0.30): direct competency signal, but recall is intentionally conservative in PDF pipeline
      - Areas (0.20): domain coverage
      - Quality (0.10): pipeline confidence in the extraction
    """
    if not courses:
        zero = CompletenessBreakdown(0.0, 0.0, 0.0, 0.0, "")
        return 0.0, zero

    n = len(courses)
    pct_hours = sum(1 for c in courses if c.hours_total) / n
    pct_skills = sum(1 for c in courses if c.skills) / n
    pct_areas = sum(1 for c in courses if c.areas) / n

    quality_map = {"high": 1.0, "medium": 0.5, "low": 0.0}
    avg_quality = sum(quality_map.get(c.quality_level, 0.5) for c in courses) / n

    score = round(0.40 * pct_hours + 0.30 * pct_skills + 0.20 * pct_areas + 0.10 * avg_quality, 3)

    breakdown = CompletenessBreakdown(
        pct_courses_with_hours=round(pct_hours, 3),
        pct_courses_with_skills=round(pct_skills, 3),
        pct_courses_with_areas=round(pct_areas, 3),
        avg_quality_signal=round(avg_quality, 3),
        score_formula="0.40*pct_hours + 0.30*pct_skills + 0.20*pct_areas + 0.10*avg_quality",
    )

    return score, breakdown


# ─── Methodology ──────────────────────────────────────────────────────────────

def _build_methodology() -> dict[str, Any]:
    return {
        "skills_aggregation": (
            "canonical_skill_id with conservative aliases; "
            "accumulation across courses; duplicate prevention per course_id"
        ),
        "confidence_calculation": (
            "weighted_average_by_skill_hours when available; "
            "fallback to simple_average when no hours"
        ),
        "pdf_skill_confidence": (
            "uses pipeline-computed confidence per skill "
            "(already encodes detection_mode); "
            "light course-level reliability adjustment when reliability < 0.5"
        ),
        "csv_skill_confidence": (
            "derived from source_type: "
            "explicit_csv=0.85, inferred_title=0.60, inferred_description=0.40; "
            "multiplied by quality_flag penalties"
        ),
        "pdf_hours_attribution": (
            "skill_weight_in_course * hours_total per skill; "
            "skills within the same course may share (overlap) hours"
        ),
        "csv_hours_attribution": (
            "equal proration: hours_total / n_detected_skills per skill; "
            "no overlap within a single CSV course"
        ),
        "area_namespace_strategy": (
            "academic (PDF pipeline) and online (CSV pipeline) areas "
            "kept in separate namespaces; no cross-ontology merge applied"
        ),
        "hours_semantics": {
            "total_learning_hours_estimated": (
                "sum of actual course hours; each course counted once; no skill overlap"
            ),
            "total_skill_hours_estimated": (
                "sum of per-skill attributed hours across all skills; "
                "may exceed total_learning_hours when PDF skills overlap"
            ),
            "skill_hours_estimated_per_skill": (
                "sum of hours_attributed from all sources for this skill; "
                "may overlap with hours counted for other skills from the same course"
            ),
        },
        "skill_alias_strategy": (
            "conservative alias map: only merges grammatical/cosmetic variants "
            "(e.g. 'Python Programming' -> 'Python'); "
            "never merges semantically distinct skills"
        ),
        "limitations": [
            "skill_detection_in_pdf_pipeline_is_conservative_high_precision_low_recall: "
            "many courses with programming content have no detected skills",
            "csv_skill_confidence_is_uniform_per_source_type_within_a_course: "
            "all explicit_csv skills of the same course get the same base confidence",
            "partial_semantic_overlap_in_skill_names_mitigated_by_conservative_aliases: "
            "some variants may still produce separate entries",
            "no_crosswalk_between_academic_areas_spanish_and_online_areas_english: "
            "area namespaces remain separate",
            "csv_hours_are_estimated_by_equal_proration: "
            "actual time per skill may differ from the equal split",
            "dominant_domain_family_only_computable_from_pdf_pipeline_courses: "
            "online CSV courses do not produce a domain_family signal",
        ],
    }


# ─── Serialization ───────────────────────────────────────────────────────────

def profile_to_dict(profile: UserProfile) -> dict[str, Any]:
    return {
        "user_id": profile.user_id,
        "profile_version": profile.profile_version,
        "generated_at": profile.generated_at,
        "summary": {
            "total_courses": profile.summary.total_courses,
            "total_learning_hours_estimated": profile.summary.total_learning_hours_estimated,
            "total_skill_hours_estimated": profile.summary.total_skill_hours_estimated,
            "top_skills": profile.summary.top_skills,
            "top_areas": profile.summary.top_areas,
            "dominant_domain_family": profile.summary.dominant_domain_family,
            "profile_completeness_score": profile.summary.profile_completeness_score,
            "profile_completeness_breakdown": {
                "pct_courses_with_hours": profile.summary.profile_completeness_breakdown.pct_courses_with_hours,
                "pct_courses_with_skills": profile.summary.profile_completeness_breakdown.pct_courses_with_skills,
                "pct_courses_with_areas": profile.summary.profile_completeness_breakdown.pct_courses_with_areas,
                "avg_quality_signal": profile.summary.profile_completeness_breakdown.avg_quality_signal,
                "score_formula": profile.summary.profile_completeness_breakdown.score_formula,
            },
        },
        "profile_methodology": profile.profile_methodology,
        "skills": {
            sk_id: {
                "skill_label": e.skill_label,
                "composite_confidence": e.composite_confidence,
                "skill_hours_estimated": e.skill_hours_estimated,
                "evidence_count": e.evidence_count,
                "is_core_in_at_least_one": e.is_core_in_at_least_one,
                "sources": [
                    {
                        "course_id": s.course_id,
                        "course_title": s.course_title,
                        "platform": s.platform,
                        "source_type": s.source_type,
                        "hours_attributed": s.hours_attributed,
                        "confidence": s.confidence,
                        "is_core": s.is_core,
                    }
                    for s in e.sources
                ],
            }
            for sk_id, e in profile.skills.items()
        },
        "areas": {
            ar_id: {
                "area_label": e.area_label,
                "area_group": e.area_group,
                "total_hours_estimated": e.total_hours_estimated,
                "course_count": e.course_count,
                "courses": e.courses,
            }
            for ar_id, e in profile.areas.items()
        },
        "courses_processed": [
            {
                "course_id": c.course_id,
                "title": c.title,
                "platform": c.platform,
                "hours_total": c.hours_total,
                "pipeline_type": c.pipeline_type,
                "quality_status": c.quality_status,
                "hours_estimation_method": c.hours_estimation_method,
            }
            for c in profile.courses_processed
        ],
    }


# ─── Guard against consolidated files ────────────────────────────────────────

def _is_consolidated_file(data: Any) -> bool:
    if isinstance(data, list):
        return True
    if isinstance(data, dict):
        return any(
            k in data and isinstance(data[k], list)
            for k in ("courses", "courses_semantic")
        )
    return False

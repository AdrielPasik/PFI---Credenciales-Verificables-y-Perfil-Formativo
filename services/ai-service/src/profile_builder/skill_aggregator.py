from __future__ import annotations

from src.profile_builder.profile_models import (
    NormalizedCourseRecord,
    SkillSource,
    UserSkillEntry,
)
from src.profile_builder.skill_aliases import preferred_label


def aggregate_skills(courses: list[NormalizedCourseRecord]) -> dict[str, UserSkillEntry]:
    """
    Fold over normalized courses and accumulate per-skill entries.

    Skill hours overlap across skills is intentional: a course on embedded systems
    contributes hours to both "C" and "Git" simultaneously, because both skills
    were practised during the same study period.  This is NOT the same as
    total_learning_hours in the summary, which counts each course only once.
    """
    entries: dict[str, UserSkillEntry] = {}

    for course in courses:
        hours_total = course.hours_total

        for sk in course.skills:
            skill_id = sk.skill_id
            if not skill_id:
                continue

            # Hours attributed to this skill in this course.
            # For PDF: skill_weight × hours_total (may overlap across skills of same course).
            # For CSV: skill_weight = 1/n_skills, so total per course = hours_total (no overlap within CSV course).
            if hours_total and hours_total > 0:
                hours_attr: float | None = round(sk.skill_weight * hours_total, 2)
            else:
                hours_attr = None

            source = SkillSource(
                course_id=course.course_id,
                course_title=course.title,
                platform=course.platform,
                source_type=sk.source_type,
                hours_attributed=hours_attr,
                confidence=sk.confidence,
                is_core=sk.is_core,
            )

            if skill_id not in entries:
                # Use preferred canonical label if available, otherwise first-seen label
                label = preferred_label(skill_id) or sk.skill_label
                entries[skill_id] = UserSkillEntry(
                    skill_id=skill_id,
                    skill_label=label,
                    composite_confidence=0.0,   # recomputed below
                    skill_hours_estimated=0.0,
                    evidence_count=0,
                    is_core_in_at_least_one=False,
                    sources=[],
                )

            entry = entries[skill_id]
            entry.sources.append(source)
            entry.evidence_count += 1

            if sk.is_core:
                entry.is_core_in_at_least_one = True

            if hours_attr is not None:
                entry.skill_hours_estimated += hours_attr

    for entry in entries.values():
        entry.composite_confidence = _composite_confidence(entry.sources)
        entry.skill_hours_estimated = round(entry.skill_hours_estimated, 2)

    return entries


def _composite_confidence(sources: list[SkillSource]) -> float:
    """
    Weighted average of per-source confidence, using hours_attributed as weight.
    Falls back to simple average when no hours are available.

    Confidence measures certainty of detection, not volume of evidence.
    A skill appearing in many low-quality courses will not surpass a skill
    detected precisely in one high-quality course with more hours.
    """
    weighted = [(s.confidence, s.hours_attributed) for s in sources if s.hours_attributed]
    if weighted:
        total_w = sum(h for _, h in weighted)
        if total_w > 0:
            return round(sum(c * h for c, h in weighted) / total_w, 4)

    if sources:
        return round(sum(s.confidence for s in sources) / len(sources), 4)

    return 0.0


def total_skill_hours(entries: dict[str, UserSkillEntry]) -> float:
    """Sum of skill_hours_estimated across all skill entries."""
    return round(sum(e.skill_hours_estimated for e in entries.values()), 2)

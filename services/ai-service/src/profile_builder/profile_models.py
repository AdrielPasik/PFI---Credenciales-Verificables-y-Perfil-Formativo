from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


# ─── Internal bridge types: pipeline JSON → profile ──────────────────────────

@dataclass
class NormalizedSkillRecord:
    skill_label: str
    skill_id: str
    source_type: str        # detection_mode (PDF) or explicit_csv / inferred_title / inferred_description (CSV)
    confidence: float       # final adjusted confidence (0–1)
    is_core: bool
    skill_weight: float     # fraction of course relevance attributed to this skill
    evidence_sources: list[str]
    evidence_text_span: Optional[str] = None


@dataclass
class NormalizedAreaRecord:
    area_id: str
    area_label: str
    area_group: str         # "academic" | "online" | "unknown"
    estimated_hours: Optional[float]
    evidence_strength: float


@dataclass
class NormalizedCourseRecord:
    course_id: str
    title: str
    platform: str
    pipeline_type: str      # "academic_pdf" | "online_csv"
    hours_total: Optional[float]
    skills: list[NormalizedSkillRecord]
    areas: list[NormalizedAreaRecord]
    quality_level: str      # "high" | "medium" | "low"
    skills_reliability: float
    domain_family: Optional[str]
    hours_estimation_method: Optional[str]   # None = real, "prorated_equal_distribution" = estimated


# ─── User profile output types ────────────────────────────────────────────────

@dataclass
class SkillSource:
    course_id: str
    course_title: str
    platform: str
    source_type: str
    hours_attributed: Optional[float]
    confidence: float
    is_core: bool


@dataclass
class UserSkillEntry:
    skill_id: str
    skill_label: str
    composite_confidence: float
    # "skill_hours" = hours × skill_weight per source, summed across courses.
    # These can overlap across skills (e.g. a course on embedded systems
    # contributes hours to both "C" and "Git" simultaneously).
    skill_hours_estimated: float
    evidence_count: int
    is_core_in_at_least_one: bool
    sources: list[SkillSource] = field(default_factory=list)


@dataclass
class UserAreaEntry:
    area_id: str
    area_label: str
    area_group: str
    total_hours_estimated: float
    course_count: int
    courses: list[str] = field(default_factory=list)


@dataclass
class CompletenessBreakdown:
    pct_courses_with_hours: float
    pct_courses_with_skills: float
    pct_courses_with_areas: float
    avg_quality_signal: float
    score_formula: str


@dataclass
class ProfileSummary:
    total_courses: int
    # Sum of actual course hours (each course counted once, no skill overlap)
    total_learning_hours_estimated: float
    # Sum of per-skill attributed hours across all skills (can exceed learning hours
    # because multiple skills may share the same course time)
    total_skill_hours_estimated: float
    top_skills: list[str]
    top_areas: list[str]
    dominant_domain_family: Optional[str]
    profile_completeness_score: float
    profile_completeness_breakdown: CompletenessBreakdown


@dataclass
class CourseProcessedEntry:
    course_id: str
    title: str
    platform: str
    hours_total: Optional[float]
    pipeline_type: str
    quality_status: str
    hours_estimation_method: Optional[str] = None


@dataclass
class UserProfile:
    user_id: str
    profile_version: str
    generated_at: str
    summary: ProfileSummary
    skills: dict[str, UserSkillEntry]
    areas: dict[str, UserAreaEntry]
    courses_processed: list[CourseProcessedEntry]
    profile_methodology: dict[str, Any] = field(default_factory=dict)

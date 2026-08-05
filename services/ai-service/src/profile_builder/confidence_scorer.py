from __future__ import annotations

# PDF pipeline already embeds detection_mode into the per-skill confidence field,
# so score_pdf_skill only applies a light course-level reliability adjustment.
#
# CSV pipeline has no per-skill confidence; score_csv_skill derives it from
# source type and quality flags.

_CSV_SOURCE_BASE: dict[str, float] = {
    "explicit_csv": 0.85,       # came from the CSV skills column (platform-certified)
    "inferred_title": 0.60,     # detected in course title (strong signal)
    "inferred_description": 0.40,  # detected in description only (weak signal)
}

# Multiplicative penalties — only applied to CSV (PDF already accounts for quality in its confidence)
_CSV_QUALITY_PENALTIES: dict[str, float] = {
    "low_text_signal": 0.75,
    "missing_description": 0.85,
    "inferred_skills_only": 0.95,   # minor; mainly informational
}


def score_pdf_skill(raw_confidence: float, skills_reliability: float) -> float:
    # Apply a light penalty only when course-level reliability is meaningfully degraded.
    # skills_reliability == 0.0 typically means no skills were detected (not that detection failed),
    # so we skip the adjustment in that case to avoid penalising courses that legitimately
    # have no skills.
    if 0.0 < skills_reliability < 0.5:
        adjusted = raw_confidence * (0.5 + skills_reliability)
        return round(min(adjusted, 1.0), 4)
    return round(raw_confidence, 4)


def score_csv_skill(source_type: str, quality_flags: list[str]) -> float:
    base = _CSV_SOURCE_BASE.get(source_type, 0.40)
    for flag in quality_flags:
        penalty = _CSV_QUALITY_PENALTIES.get(flag, 1.0)
        base *= penalty
    return round(min(max(base, 0.0), 1.0), 4)

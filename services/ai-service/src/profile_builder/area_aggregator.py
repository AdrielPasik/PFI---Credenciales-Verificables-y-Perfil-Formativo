from __future__ import annotations

from src.profile_builder.profile_models import (
    NormalizedCourseRecord,
    UserAreaEntry,
)


def aggregate_areas(courses: list[NormalizedCourseRecord]) -> dict[str, UserAreaEntry]:
    """
    Accumulate area entries across courses.

    Academic (PDF) and online (CSV) areas are kept in separate namespaces
    via area_group — merging them would require a cross-ontology mapping
    that does not exist yet.
    """
    entries: dict[str, UserAreaEntry] = {}

    for course in courses:
        for ar in course.areas:
            area_id = ar.area_id
            if not area_id:
                continue

            if area_id not in entries:
                entries[area_id] = UserAreaEntry(
                    area_id=area_id,
                    area_label=ar.area_label,
                    area_group=ar.area_group,
                    total_hours_estimated=0.0,
                    course_count=0,
                    courses=[],
                )

            entry = entries[area_id]

            if ar.estimated_hours is not None:
                entry.total_hours_estimated += ar.estimated_hours

            entry.course_count += 1

            title = course.title
            if title and title not in entry.courses:
                entry.courses.append(title)

    for entry in entries.values():
        entry.total_hours_estimated = round(entry.total_hours_estimated, 2)

    return entries

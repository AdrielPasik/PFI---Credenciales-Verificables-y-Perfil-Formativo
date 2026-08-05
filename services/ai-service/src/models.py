from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass
class ExtractionResult:
    raw_normalized: Dict[str, Any]
    semantic_final: Dict[str, Any]
    validation_errors: List[str]


@dataclass
class CourseCandidate:
    course_code: Optional[str]
    name: Optional[str]
    title_extracted: Optional[str]
    title_normalized: Optional[str]
    title_quality_status: str
    hours_total: Optional[int]
    source_file: str
    raw_sections: Dict[str, str]

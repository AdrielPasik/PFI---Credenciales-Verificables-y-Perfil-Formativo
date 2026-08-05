from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

# Valores aceptados para confidenceMethod — ver ai-backend-integration-contract-v0.md
# addendum y docs/architecture/ai-exporter-backend-contract-viability-v0.md seccion "Confidence".
CONFIDENCE_METHODS = ("measured", "derived", "heuristic", "unavailable")

STATUS_VALUES = ("completed", "partial")


@dataclass
class SourceRefs:
    documentId: str
    fileName: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {"documentId": self.documentId, "fileName": self.fileName}


@dataclass
class AreaEntry:
    id: str
    label: str
    confidence: Optional[float]
    confidenceMethod: str
    source: str  # "explicit" | "inferred"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "confidence": self.confidence,
            "confidenceMethod": self.confidenceMethod,
            "source": self.source,
        }


@dataclass
class SkillEntry:
    id: str
    label: str
    confidence: Optional[float]
    confidenceMethod: str
    source: str  # "explicit" | "inferred"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "confidence": self.confidence,
            "confidenceMethod": self.confidenceMethod,
            "source": self.source,
        }


@dataclass
class ConceptEntry:
    id: str
    label: str
    confidence: Optional[float]
    confidenceMethod: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "confidence": self.confidence,
            "confidenceMethod": self.confidenceMethod,
        }


@dataclass
class HoursDistributionEntry:
    areaId: str
    hours: float

    def to_dict(self) -> dict[str, Any]:
        return {"areaId": self.areaId, "hours": self.hours}


@dataclass
class EvidenceMap:
    areas: dict[str, list[str]] = field(default_factory=dict)
    skills: dict[str, list[str]] = field(default_factory=dict)
    concepts: dict[str, list[str]] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"areas": self.areas, "skills": self.skills, "concepts": self.concepts}


@dataclass
class ConfidenceSummary:
    global_value: Optional[float]
    global_method: str
    coverage_value: Optional[float] = None
    coverage_method: str = "unavailable"

    def to_dict(self) -> dict[str, Any]:
        return {
            "global": self.global_value,
            "globalMethod": self.global_method,
            "coverage": self.coverage_value,
            "coverageMethod": self.coverage_method,
        }


@dataclass
class SemanticAnalysisV1:
    schemaVersion: str
    pipelineVersion: str
    taxonomyVersion: str
    status: str
    sourceType: str
    sourceRefs: SourceRefs
    areas: list[AreaEntry]
    skills: list[SkillEntry]
    concepts: list[ConceptEntry]
    hoursDistribution: list[HoursDistributionEntry]
    evidenceMap: EvidenceMap
    confidence: ConfidenceSummary
    qualityFlags: list[str]
    textForEmbedding: str
    warnings: list[str] = field(default_factory=list)
    partialReasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "schemaVersion": self.schemaVersion,
            "pipelineVersion": self.pipelineVersion,
            "taxonomyVersion": self.taxonomyVersion,
            "status": self.status,
            "sourceType": self.sourceType,
            "sourceRefs": self.sourceRefs.to_dict(),
            "areas": [a.to_dict() for a in self.areas],
            "skills": [s.to_dict() for s in self.skills],
            "concepts": [c.to_dict() for c in self.concepts],
            "hoursDistribution": [h.to_dict() for h in self.hoursDistribution],
            "evidenceMap": self.evidenceMap.to_dict(),
            "confidence": self.confidence.to_dict(),
            "qualityFlags": self.qualityFlags,
            "textForEmbedding": self.textForEmbedding,
            "warnings": self.warnings,
            "partialReasons": self.partialReasons,
        }

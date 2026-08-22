from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any


class CoverageStatus(str, Enum):
    FULL = "FULL"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"


class Relation(str, Enum):
    DIRECT_SUPPORT = "DIRECT_SUPPORT"
    SPECIFIC_SUPPORT = "SPECIFIC_SUPPORT"
    CONTRIBUTORY_SUPPORT = "CONTRIBUTORY_SUPPORT"
    RELATED_NON_ENTAILING = "RELATED_NON_ENTAILING"
    LIMITED_SCOPE = "LIMITED_SCOPE"
    CONFLICTING = "CONFLICTING"


class FinalState(str, Enum):
    SUPPORTED = "SUPPORTED"
    PARTIALLY_SUPPORTED = "PARTIALLY_SUPPORTED"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    NOT_ASSESSABLE = "NOT_ASSESSABLE"
    ABSTAIN = "ABSTAIN"


class GuardStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"


@dataclass(frozen=True)
class SourceInput:
    source_id: str
    credential_id: str
    evidence_type: str
    content: str
    coverage_status: str
    source_provenance: str
    lineage_id: str | None = None
    technically_verified: bool = False
    diagnostics: tuple[str, ...] = ()


@dataclass(frozen=True)
class FixtureCase:
    case_id: str
    split: str
    domain: str
    objective: str
    sources: tuple[SourceInput, ...]


@dataclass(frozen=True)
class ProviderResult:
    output: dict[str, Any]
    provider: str
    requested_model: str
    effective_model: str
    latency_ms: int
    usage: dict[str, Any] = field(default_factory=dict)
    response_id: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


"""
Fase 5A (experimental) — adaptador de artifacts `semantic_analysis_v1` a
una estructura intermedia agregada, pensada como base para un futuro
`profile_builder_v2` que consuma artifacts versionados en vez de los
outputs internos del pipeline (`output_json/`, `output/online_courses_json/`).

Esta capa NO construye un `UserProfile`/`FormativeProfile` final, NO
escribe en `profiles/`, y NO reemplaza `profile_builder.py` ni
`course_adapter.py` (que siguen siendo el camino productivo actual). Ver
docs/architecture/profile_builder_semantic_analysis_v1_adapter.md.

Puramente funcional: no lee ni escribe archivos (eso vive en
`artifact_loader.py`), no muta los artifacts de entrada.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any, Optional

from src.profile_builder.artifact_loader import load_artifacts_from_objects

MAX_SOURCE_REF_EXAMPLES = 5


@dataclass
class AreaAggregate:
    id: str
    label: str
    count: int
    avg_confidence: Optional[float]
    total_hours: float
    source_types: dict[str, int]
    source_ref_examples: list[dict[str, Any]]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "count": self.count,
            "avg_confidence": self.avg_confidence,
            "total_hours": self.total_hours,
            "source_types": dict(self.source_types),
            "source_ref_examples": list(self.source_ref_examples),
        }


@dataclass
class SkillAggregate:
    id: str
    label: str
    count: int
    avg_confidence: Optional[float]
    source_types: dict[str, int]
    sources: dict[str, int]  # "explicit" / "inferred" -> count
    source_ref_examples: list[dict[str, Any]]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "count": self.count,
            "avg_confidence": self.avg_confidence,
            "source_types": dict(self.source_types),
            "sources": dict(self.sources),
            "source_ref_examples": list(self.source_ref_examples),
        }


@dataclass
class ConceptAggregate:
    id: str
    label: str
    count: int
    source_types: dict[str, int]
    source_ref_examples: list[dict[str, Any]]

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "count": self.count,
            "source_types": dict(self.source_types),
            "source_ref_examples": list(self.source_ref_examples),
        }


def _group_key(entry: dict[str, Any]) -> str:
    """Agrupa por id si esta presente, sino por label (ver consigna)."""
    identifier = entry.get("id")
    if isinstance(identifier, str) and identifier.strip():
        return identifier
    label = entry.get("label")
    if isinstance(label, str) and label.strip():
        return label
    return "unknown"


def _average_ignoring_none(values: list[Optional[float]]) -> Optional[float]:
    present = [v for v in values if v is not None]
    if not present:
        return None
    return round(sum(present) / len(present), 4)


def _source_ref(artifact: dict[str, Any]) -> dict[str, Any]:
    """
    `sourceRefs` se preserva unicamente como metadata de trazabilidad
    (que artifact/archivo origino un grupo agregado) -- nunca se usa como
    identidad de usuario, holder o issuer. Esta capa no tiene ni construye
    ningun concepto de "dueño" del artifact; eso pertenece a
    `credential_candidate_v1` (no implementado, ver docs/architecture/
    profile_builder_semantic_analysis_v1_adapter.md).
    """
    source_refs = artifact.get("sourceRefs") or {}
    return {
        "documentId": source_refs.get("documentId"),
        "fileName": source_refs.get("fileName"),
        "sourceType": artifact.get("sourceType"),
    }


def _sorted_counts(counter: Counter[str]) -> dict[str, int]:
    """dict determinístico (ordenado por clave), independiente del orden de encuentro."""
    return dict(sorted(counter.items()))


def _ref_sort_key(ref: dict[str, Any]) -> tuple[str, str]:
    return (ref.get("documentId") or "", ref.get("fileName") or "")


def build_aggregated_profile_input(artifacts: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Agrega una lista de artifacts `semantic_analysis_v1` (dicts ya
    cargados en memoria, tipicamente via `artifact_loader`) en una
    estructura intermedia agregada y trazable.

    NO construye un perfil formativo final. NO escribe nada en disco. NO
    modifica los artifacts de entrada (solo lectura via `.get`).

    Levanta `InvalidArtifactError` (re-exportado desde `artifact_loader`)
    si algun artifact no pasa la validacion minima de consumidor.
    """
    artifacts = load_artifacts_from_objects(artifacts)  # valida; no copia ni muta

    by_source_type: Counter[str] = Counter()

    area_accum: dict[str, dict[str, Any]] = {}
    skill_accum: dict[str, dict[str, Any]] = {}
    concept_accum: dict[str, dict[str, Any]] = {}
    hours_by_area: dict[str, float] = defaultdict(float)

    evidence_areas_artifacts = 0
    evidence_skills_artifacts = 0
    evidence_concepts_artifacts = 0
    evidence_area_entries_total = 0
    evidence_skill_entries_total = 0
    evidence_concept_entries_total = 0

    quality_flags_counter: Counter[str] = Counter()
    status_counter: Counter[str] = Counter()
    confidence_present = 0
    confidence_null = 0
    confidence_method_counter: Counter[str] = Counter()
    warnings_counter: Counter[str] = Counter()
    partial_reasons_counter: Counter[str] = Counter()

    schema_versions: set[str] = set()
    pipeline_versions: set[str] = set()
    taxonomy_versions: set[str] = set()
    source_refs_all: list[dict[str, Any]] = []

    for artifact in artifacts:
        source_type = artifact.get("sourceType") or "unknown_source_type"
        by_source_type[source_type] += 1
        ref = _source_ref(artifact)
        source_refs_all.append(ref)

        schema_versions.add(artifact.get("schemaVersion") or "unknown")
        pipeline_versions.add(artifact.get("pipelineVersion") or "unknown")
        taxonomy_versions.add(artifact.get("taxonomyVersion") or "unknown")

        # --- horas por areaId, para este artifact (normalmente 1 entrada por area) ---
        area_hours_by_id: dict[str, float] = {}
        for hd in artifact.get("hoursDistribution") or []:
            area_id = hd.get("areaId")
            hours = hd.get("hours")
            if area_id and isinstance(hours, (int, float)):
                area_hours_by_id[area_id] = area_hours_by_id.get(area_id, 0.0) + float(hours)
                hours_by_area[area_id] += float(hours)

        # --- areas ---
        for area in artifact.get("areas") or []:
            key = _group_key(area)
            bucket = area_accum.setdefault(
                key,
                {
                    "id": area.get("id") or key,
                    "label": area.get("label") or key,
                    "count": 0,
                    "confidences": [],
                    "total_hours": 0.0,
                    "source_types": Counter(),
                    "source_ref_examples": [],
                },
            )
            bucket["count"] += 1
            bucket["confidences"].append(area.get("confidence"))
            bucket["source_types"][source_type] += 1
            area_id = area.get("id")
            if area_id and area_id in area_hours_by_id:
                bucket["total_hours"] += area_hours_by_id[area_id]
            # No se trunca aca: se guardan todas las refs y se ordena +
            # trunca al final, para que el resultado no dependa del orden
            # de entrada (ver punto 3 de la validacion de estabilidad).
            bucket["source_ref_examples"].append(ref)

        # --- skills ---
        for skill in artifact.get("skills") or []:
            key = _group_key(skill)
            bucket = skill_accum.setdefault(
                key,
                {
                    "id": skill.get("id") or key,
                    "label": skill.get("label") or key,
                    "count": 0,
                    "confidences": [],
                    "source_types": Counter(),
                    "sources": Counter(),
                    "source_ref_examples": [],
                },
            )
            bucket["count"] += 1
            bucket["confidences"].append(skill.get("confidence"))
            bucket["source_types"][source_type] += 1
            source_value = skill.get("source")
            if source_value:
                bucket["sources"][source_value] += 1
            bucket["source_ref_examples"].append(ref)

        # --- concepts ---
        for concept in artifact.get("concepts") or []:
            key = _group_key(concept)
            bucket = concept_accum.setdefault(
                key,
                {
                    "id": concept.get("id") or key,
                    "label": concept.get("label") or key,
                    "count": 0,
                    "source_types": Counter(),
                    "source_ref_examples": [],
                },
            )
            bucket["count"] += 1
            bucket["source_types"][source_type] += 1
            bucket["source_ref_examples"].append(ref)

        # --- evidence summary ---
        evidence_map = artifact.get("evidenceMap") or {}
        ev_areas = evidence_map.get("areas") or {}
        ev_skills = evidence_map.get("skills") or {}
        ev_concepts = evidence_map.get("concepts") or {}
        if ev_areas:
            evidence_areas_artifacts += 1
            evidence_area_entries_total += sum(len(v) for v in ev_areas.values())
        if ev_skills:
            evidence_skills_artifacts += 1
            evidence_skill_entries_total += sum(len(v) for v in ev_skills.values())
        if ev_concepts:
            evidence_concepts_artifacts += 1
            evidence_concept_entries_total += sum(len(v) for v in ev_concepts.values())

        # --- quality ---
        status_counter[artifact.get("status") or "unknown_status"] += 1

        for flag in artifact.get("qualityFlags") or []:
            quality_flags_counter[flag] += 1
        for warning in artifact.get("warnings") or []:
            warnings_counter[warning] += 1
        for reason in artifact.get("partialReasons") or []:
            partial_reasons_counter[reason] += 1

        confidence = artifact.get("confidence") or {}
        if confidence.get("global") is None:
            confidence_null += 1
        else:
            confidence_present += 1
        confidence_method_counter[confidence.get("globalMethod") or "unknown"] += 1

    areas_out = sorted(
        (
            AreaAggregate(
                id=b["id"],
                label=b["label"],
                count=b["count"],
                avg_confidence=_average_ignoring_none(b["confidences"]),
                total_hours=round(b["total_hours"], 2),
                source_types=_sorted_counts(b["source_types"]),
                source_ref_examples=sorted(b["source_ref_examples"], key=_ref_sort_key)[:MAX_SOURCE_REF_EXAMPLES],
            ).to_dict()
            for b in area_accum.values()
        ),
        key=lambda d: (d["id"], d["label"]),
    )

    skills_out = sorted(
        (
            SkillAggregate(
                id=b["id"],
                label=b["label"],
                count=b["count"],
                avg_confidence=_average_ignoring_none(b["confidences"]),
                source_types=_sorted_counts(b["source_types"]),
                sources=_sorted_counts(b["sources"]),
                source_ref_examples=sorted(b["source_ref_examples"], key=_ref_sort_key)[:MAX_SOURCE_REF_EXAMPLES],
            ).to_dict()
            for b in skill_accum.values()
        ),
        key=lambda d: (d["id"], d["label"]),
    )

    concepts_out = sorted(
        (
            ConceptAggregate(
                id=b["id"],
                label=b["label"],
                count=b["count"],
                source_types=_sorted_counts(b["source_types"]),
                source_ref_examples=sorted(b["source_ref_examples"], key=_ref_sort_key)[:MAX_SOURCE_REF_EXAMPLES],
            ).to_dict()
            for b in concept_accum.values()
        ),
        key=lambda d: (d["id"], d["label"]),
    )

    # warnings/partial_reasons se exponen agregados (dict valor->count) a
    # nivel top -- no se duplican dentro de quality_summary para no repetir
    # la misma informacion dos veces con distinto formato.
    quality_summary = {
        "quality_flags": _sorted_counts(quality_flags_counter),
        "status": _sorted_counts(status_counter),
        "confidence_global": {
            "present": confidence_present,
            "null": confidence_null,
        },
        "confidence_global_method_distribution": _sorted_counts(confidence_method_counter),
    }

    evidence_summary = {
        "artifacts_with_area_evidence": evidence_areas_artifacts,
        "artifacts_with_skill_evidence": evidence_skills_artifacts,
        "artifacts_with_concept_evidence": evidence_concepts_artifacts,
        "total_area_evidence_entries": evidence_area_entries_total,
        "total_skill_evidence_entries": evidence_skill_entries_total,
        "total_concept_evidence_entries": evidence_concept_entries_total,
    }

    metadata = {
        "schema_versions": sorted(schema_versions),
        "pipeline_versions": sorted(pipeline_versions),
        "taxonomy_versions": sorted(taxonomy_versions),
        # source_refs es 1:1 con los artifacts de entrada (no es una
        # agregacion truncada) -- se ordena igual para que la salida no
        # dependa del orden de entrada, sin perder ninguna referencia.
        "source_refs": sorted(source_refs_all, key=_ref_sort_key),
    }

    return {
        "source_artifacts_count": len(artifacts),
        "by_source_type": _sorted_counts(by_source_type),
        "areas": areas_out,
        "skills": skills_out,
        "concepts": concepts_out,
        "hours_by_area": dict(sorted((k, round(v, 2)) for k, v in hours_by_area.items())),
        "evidence_summary": evidence_summary,
        "quality_summary": quality_summary,
        "warnings": _sorted_counts(warnings_counter),
        "partial_reasons": _sorted_counts(partial_reasons_counter),
        "metadata": metadata,
    }

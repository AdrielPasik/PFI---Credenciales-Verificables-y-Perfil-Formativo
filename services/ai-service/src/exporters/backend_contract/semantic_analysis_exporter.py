"""
Funcion principal: transforma un record ya existente del pipeline IA
(`{"raw_normalized": ..., "semantic_final": ...}`) en un artifact
`semantic_analysis_v1`.

Puramente funcional sobre el dict recibido: no lee ni escribe archivos,
no muta el `record` de entrada. El I/O vive en `cli.py`.
"""
from __future__ import annotations

from typing import Any, Mapping, Optional

from src.exporters.backend_contract import (
    PIPELINE_VERSION,
    SCHEMA_VERSION,
    SOURCE_TYPE_ACADEMIC_PDF,
    SOURCE_TYPE_ONLINE_COURSE_CATALOG,
    SOURCE_TYPE_TEXT,
    TAXONOMY_VERSION,
)
from src.exporters.backend_contract.models import (
    AreaEntry,
    ConceptEntry,
    ConfidenceSummary,
    EvidenceMap,
    HoursDistributionEntry,
    SemanticAnalysisV1,
    SkillEntry,
    SourceRefs,
)
from src.exporters.backend_contract.normalizers import (
    compute_global_confidence_pdf,
    derive_status_online,
    derive_status_pdf,
    derive_status_text,
    normalize_concepts,
    normalize_hours_distribution,
    normalize_online_areas,
    normalize_online_evidence_map,
    normalize_online_skills,
    normalize_pdf_areas,
    normalize_pdf_evidence_map,
    normalize_pdf_skills,
    normalize_text_areas,
    normalize_text_skills,
    sanitize_text_for_embedding,
    unavailable_confidence,
)
from src.exporters.backend_contract.quality_flags_map import (
    flatten_online_quality_flags,
    flatten_pdf_quality_flags,
)

VALID_SOURCE_TYPES = (SOURCE_TYPE_ACADEMIC_PDF, SOURCE_TYPE_ONLINE_COURSE_CATALOG, SOURCE_TYPE_TEXT)


def _clean_optional_str(value: Any) -> Optional[str]:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


class InvalidRecordShapeError(ValueError):
    """El record de entrada no tiene la forma esperada (raw_normalized + semantic_final)."""


def validate_record_shape(record: Any) -> None:
    if not isinstance(record, dict):
        raise InvalidRecordShapeError(f"El record no es un objeto JSON (dict) — tipo real: {type(record).__name__}")
    if "raw_normalized" not in record or "semantic_final" not in record:
        keys = list(record.keys())[:10]
        raise InvalidRecordShapeError(
            f"Faltan claves 'raw_normalized' y/o 'semantic_final'. Claves top-level presentes: {keys}"
        )
    if not isinstance(record["raw_normalized"], dict) or not isinstance(record["semantic_final"], dict):
        raise InvalidRecordShapeError("'raw_normalized' y 'semantic_final' deben ser objetos JSON (dict).")


def export_semantic_analysis(
    record: dict[str, Any],
    source_type: str,
    fallback_document_id: str,
    fallback_file_name: Optional[str] = None,
    *,
    source_refs: Optional[Mapping[str, Any]] = None,
    text_quality: Optional[Mapping[str, bool]] = None,
) -> SemanticAnalysisV1:
    """
    record: JSON ya existente tal cual (no se modifica).
    source_type: "academic_pdf" | "online_course_catalog" | "text".
    fallback_document_id: usado si el record no trae un ID propio mas estable
        (ej. course_code para PDF). Tipicamente el stem del archivo fuente.
    fallback_file_name: usado si el record no trae su propio nombre de
        archivo fuente (ej. raw_normalized.source_file en PDF).
    source_refs: solo para source_type="text" — {"textEvidenceId", "credentialId"}
        opacos provistos por el backend, ecoados en sourceRefs de salida.
    text_quality: solo para source_type="text" —
        {"short_unstructured_text": bool, "no_curricular_sections_detected": bool}.
    """
    validate_record_shape(record)

    if source_type not in VALID_SOURCE_TYPES:
        raise ValueError(f"source_type invalido: {source_type!r}. Valores validos: {VALID_SOURCE_TYPES}")

    if source_type == SOURCE_TYPE_ACADEMIC_PDF:
        return _export_pdf(record, fallback_document_id, fallback_file_name)
    if source_type == SOURCE_TYPE_TEXT:
        return _export_text(record, fallback_document_id, source_refs or {}, text_quality or {})
    return _export_online(record, fallback_document_id, fallback_file_name)


# ─── PDF academico ───────────────────────────────────────────────────────────

def _export_pdf(
    record: dict[str, Any],
    fallback_document_id: str,
    fallback_file_name: Optional[str],
) -> SemanticAnalysisV1:
    rn = record["raw_normalized"]
    sf = record["semantic_final"]
    qf = sf.get("quality_flags")
    if not isinstance(qf, dict):
        qf = {}

    document_id = rn.get("course_code") or fallback_document_id
    file_name = rn.get("source_file") or fallback_file_name

    areas_raw, sentinel_found = normalize_pdf_areas(sf)
    areas = [AreaEntry(**a) for a in areas_raw]

    skills_raw = normalize_pdf_skills(sf)
    skills = [SkillEntry(**s) for s in skills_raw]

    concepts_raw = normalize_concepts(sf)
    concepts = [ConceptEntry(**c) for c in concepts_raw]

    hours_raw = normalize_hours_distribution(sf)
    hours_distribution = [HoursDistributionEntry(**h) for h in hours_raw]

    evidence_map_raw = normalize_pdf_evidence_map(sf)
    evidence_map = EvidenceMap(**evidence_map_raw)

    quality_flags = flatten_pdf_quality_flags(qf)

    area_assignment_status = qf.get("area_assignment_status")
    status = derive_status_pdf(area_assignment_status)

    global_value, global_method = compute_global_confidence_pdf(areas_raw, skills_raw)
    confidence = ConfidenceSummary(global_value=global_value, global_method=global_method)

    warnings: list[str] = []
    partial_reasons: list[str] = []

    if sentinel_found:
        warnings.append("area_could_not_be_confidently_resolved")
        partial_reasons.append("kbs_area_assignment_status_unresolved_domain_candidate")
    elif area_assignment_status and area_assignment_status != "confident":
        partial_reasons.append(f"kbs_area_assignment_status_{area_assignment_status}")

    if not areas:
        warnings.append("no_area_detected")
    if not skills:
        warnings.append("no_skill_detected")

    return SemanticAnalysisV1(
        schemaVersion=SCHEMA_VERSION,
        pipelineVersion=PIPELINE_VERSION,
        taxonomyVersion=TAXONOMY_VERSION,
        status=status,
        sourceType=SOURCE_TYPE_ACADEMIC_PDF,
        sourceRefs=SourceRefs(documentId=str(document_id), fileName=file_name),
        areas=areas,
        skills=skills,
        concepts=concepts,
        hoursDistribution=hours_distribution,
        evidenceMap=evidence_map,
        confidence=confidence,
        qualityFlags=quality_flags,
        textForEmbedding=sanitize_text_for_embedding(sf.get("text_for_embedding")),
        warnings=warnings,
        partialReasons=partial_reasons,
    )


# ─── Curso online ────────────────────────────────────────────────────────────

def _export_online(
    record: dict[str, Any],
    fallback_document_id: str,
    fallback_file_name: Optional[str],
) -> SemanticAnalysisV1:
    rn = record["raw_normalized"]
    sf = record["semantic_final"]
    qf = sf.get("quality_flags")
    if not isinstance(qf, list):
        qf = []

    document_id = fallback_document_id
    file_name = fallback_file_name

    areas_raw = normalize_online_areas(sf)
    areas = [AreaEntry(**a) for a in areas_raw]

    skills_raw = normalize_online_skills(sf)
    skills = [SkillEntry(**s) for s in skills_raw]

    concepts_raw = normalize_concepts(sf)
    concepts = [ConceptEntry(**c) for c in concepts_raw]

    hours_raw = normalize_hours_distribution(sf)
    hours_distribution = [HoursDistributionEntry(**h) for h in hours_raw]

    evidence_map_raw = normalize_online_evidence_map(sf)
    evidence_map = EvidenceMap(**evidence_map_raw)

    quality_flags = flatten_online_quality_flags(qf)

    status = derive_status_online(areas_present=bool(areas))

    global_value, global_method = unavailable_confidence()
    confidence = ConfidenceSummary(global_value=global_value, global_method=global_method)

    warnings: list[str] = [
        "confidence_not_available_in_source_pipeline",
        "no_holder_completion_evidence_in_source_dataset",
    ]
    partial_reasons: list[str] = []

    if not areas:
        warnings.append("no_area_detected")
        partial_reasons.append("no_area_detected_in_online_pipeline")
    if not skills:
        warnings.append("no_skill_detected")

    return SemanticAnalysisV1(
        schemaVersion=SCHEMA_VERSION,
        pipelineVersion=PIPELINE_VERSION,
        taxonomyVersion=TAXONOMY_VERSION,
        status=status,
        sourceType=SOURCE_TYPE_ONLINE_COURSE_CATALOG,
        sourceRefs=SourceRefs(documentId=str(document_id), fileName=file_name),
        areas=areas,
        skills=skills,
        concepts=concepts,
        hoursDistribution=hours_distribution,
        evidenceMap=evidence_map,
        confidence=confidence,
        qualityFlags=quality_flags,
        textForEmbedding=sanitize_text_for_embedding(sf.get("text_for_embedding")),
        warnings=warnings,
        partialReasons=partial_reasons,
    )


# ─── Texto declarado sin PDF (C2b.1) ────────────────────────────────────────
#
# Reusa el mismo pipeline (`process_single_input(manual_text=...)` ->
# `build_semantic_output`) que ya corre para PDF: el record recibido tiene
# exactamente la misma forma {"raw_normalized", "semantic_final"}. La unica
# diferencia deliberada frente a `_export_pdf` es de politica, no de
# extraccion: areas/skills usan `normalize_text_*` (confidence topeada,
# metodo "heuristic") y el status nunca es "completed" para texto corto/no
# estructurado — ver el bundle de revision C2b.1 para el razonamiento
# completo.

def _export_text(
    record: dict[str, Any],
    fallback_document_id: str,
    source_refs: Mapping[str, Any],
    text_quality: Mapping[str, bool],
) -> SemanticAnalysisV1:
    sf = record["semantic_final"]
    qf = sf.get("quality_flags")
    if not isinstance(qf, dict):
        qf = {}

    text_evidence_id = _clean_optional_str(source_refs.get("textEvidenceId"))
    credential_id = _clean_optional_str(source_refs.get("credentialId"))
    document_id = text_evidence_id or credential_id or fallback_document_id

    areas_raw, sentinel_found = normalize_text_areas(sf)
    areas = [AreaEntry(**a) for a in areas_raw]

    skills_raw = normalize_text_skills(sf)
    skills = [SkillEntry(**s) for s in skills_raw]

    concepts_raw = normalize_concepts(sf)
    concepts = [ConceptEntry(**c) for c in concepts_raw]

    hours_raw = normalize_hours_distribution(sf)
    hours_distribution = [HoursDistributionEntry(**h) for h in hours_raw]

    evidence_map_raw = normalize_pdf_evidence_map(sf)
    evidence_map = EvidenceMap(**evidence_map_raw)

    quality_flags = flatten_pdf_quality_flags(qf)
    is_short_unstructured = bool(text_quality.get("short_unstructured_text"))
    no_curricular_sections = bool(text_quality.get("no_curricular_sections_detected"))
    if is_short_unstructured:
        quality_flags.append("short_unstructured_text")
    if no_curricular_sections:
        quality_flags.append("no_curricular_sections_detected")

    area_assignment_status = qf.get("area_assignment_status")
    status = derive_status_text(area_assignment_status, is_short_unstructured)

    global_value, global_method = compute_global_confidence_pdf(areas_raw, skills_raw)
    confidence = ConfidenceSummary(global_value=global_value, global_method=global_method)

    warnings: list[str] = []
    partial_reasons: list[str] = []

    if sentinel_found:
        warnings.append("area_could_not_be_confidently_resolved")
        partial_reasons.append("kbs_area_assignment_status_unresolved_domain_candidate")
    elif area_assignment_status and area_assignment_status != "confident":
        partial_reasons.append(f"kbs_area_assignment_status_{area_assignment_status}")

    if not areas:
        warnings.append("no_area_detected")
    if not skills:
        warnings.append("no_skill_detected")
    if is_short_unstructured:
        warnings.append("low_text_signal")
        partial_reasons.append("short_unstructured_text_source")

    return SemanticAnalysisV1(
        schemaVersion=SCHEMA_VERSION,
        pipelineVersion=PIPELINE_VERSION,
        taxonomyVersion=TAXONOMY_VERSION,
        status=status,
        sourceType=SOURCE_TYPE_TEXT,
        sourceRefs=SourceRefs(
            documentId=str(document_id),
            fileName=None,
            textEvidenceId=text_evidence_id,
            credentialId=credential_id,
        ),
        areas=areas,
        skills=skills,
        concepts=concepts,
        hoursDistribution=hours_distribution,
        evidenceMap=evidence_map,
        confidence=confidence,
        qualityFlags=quality_flags,
        textForEmbedding=sanitize_text_for_embedding(sf.get("text_for_embedding")),
        warnings=warnings,
        partialReasons=partial_reasons,
    )

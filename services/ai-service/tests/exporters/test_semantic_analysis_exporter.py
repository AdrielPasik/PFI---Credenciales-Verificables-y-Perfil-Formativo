"""
Tests unitarios del exporter semantic_analysis_v1. Usan records sinteticos
minimos (no dependen del corpus completo en output_json/ ni en
output/online_courses_json/). Ejecutar con:

    python -m unittest discover -s tests -t . -v
"""
from __future__ import annotations

import copy
import unittest

from src.exporters.backend_contract import (
    PIPELINE_VERSION,
    SCHEMA_VERSION,
    SOURCE_TYPE_ACADEMIC_PDF,
    SOURCE_TYPE_ONLINE_COURSE_CATALOG,
    TAXONOMY_VERSION,
)
from src.exporters.backend_contract.quality_flags_map import (
    flatten_online_quality_flags,
    flatten_pdf_quality_flags,
)
from src.exporters.backend_contract.semantic_analysis_exporter import (
    InvalidRecordShapeError,
    export_semantic_analysis,
)


# ─── Fixtures sinteticas (forma real, contenido minimo) ──────────────────────

def _pdf_confident_record() -> dict:
    return {
        "raw_normalized": {
            "course_code": "9.9.001",
            "name": "MATERIA DE PRUEBA",
            "hours_total": 40,
            "source_file": "9.9.001_MATERIA DE PRUEBA.pdf",
            "extraction_status": "ok",
        },
        "semantic_final": {
            "name": "MATERIA DE PRUEBA",
            "areas_detected": ["Area de Prueba"],
            "areas_detected_detail": [
                {"area_id": "area_de_prueba", "area_label": "Area de Prueba", "evidence_strength": 0.95}
            ],
            "skills_detected": [
                {
                    "skill": "SQL",
                    "skill_id": "skill_sql",
                    "skill_label": "SQL",
                    "detection_mode": "explicit_exact_match",
                    "matched_signal": "sql",
                    "evidence_source_section": "objectives_raw",
                    "confidence": 0.9,
                    "is_core_skill_in_course": True,
                }
            ],
            "concepts_detected": ["concepto uno", "concepto dos"],
            "hours_distribution_estimate": {
                "by_area": [{"area": "Area de Prueba", "area_id": "area_de_prueba", "estimated_hours": 40, "weight": 1.0}]
            },
            "evidence_map": {
                "areas": [
                    {
                        "area": "Area de Prueba",
                        "area_id": "area_de_prueba",
                        "matched_signal": "prueba",
                        "evidence_source_section": "contents_raw",
                    }
                ],
                "skills": [
                    {
                        "skill": "SQL",
                        "skill_id": "skill_sql",
                        "matched_signal": "sql",
                        "evidence_source_section": "objectives_raw",
                    }
                ],
            },
            "quality_flags": {
                "area_assignment_status": "confident",
                "semantic_quality_status": "high",
                "skills_detection_reliability": 0.9,
                "hours_distribution_reliability": 0.9,
            },
            "text_for_embedding": "MATERIA DE PRUEBA. Area de Prueba. SQL.",
        },
    }


def _pdf_unresolved_record() -> dict:
    return {
        "raw_normalized": {
            "course_code": "9.9.002",
            "name": "MATERIA AMBIGUA",
            "hours_total": 32,
            "source_file": "9.9.002_MATERIA AMBIGUA.pdf",
            "extraction_status": "ok",
        },
        "semantic_final": {
            "name": "MATERIA AMBIGUA",
            "areas_detected": ["unresolved_domain_candidate"],
            "areas_detected_detail": [
                {
                    "area_id": "area_unresolved_domain_candidate",
                    "area_label": "unresolved_domain_candidate",
                    "evidence_strength": 0.18,
                }
            ],
            "skills_detected": [],
            "concepts_detected": [],
            "hours_distribution_estimate": {"by_area": []},
            "evidence_map": {
                "areas": [
                    {
                        "area": "unresolved_domain_candidate",
                        "area_id": "area_unresolved_domain_candidate",
                        "matched_signal": "name_or_context_match",
                        "evidence_source_section": "course_name",
                    }
                ],
                "skills": [],
            },
            "quality_flags": {
                "area_assignment_status": "unresolved_domain_candidate",
                "semantic_quality_status": "low",
                "skills_detection_reliability": 0.0,
                "hours_distribution_reliability": 0.0,
            },
            "text_for_embedding": "MATERIA AMBIGUA. Areas predominantes: unresolved_domain_candidate.",
        },
    }


def _online_record_no_confidence() -> dict:
    return {
        "raw_normalized": {
            "title": "Curso de Prueba Online",
            "description": "Descripcion de prueba con Python y SQL.",
            "category": "",
            "sub_category": "",
            "skills": ["Python"],
            "platform": "udemy",
            "duration_hours_estimate": 10.0,
        },
        "semantic_final": {
            "areas_detected": ["Programming & Development"],
            "skills_detected": ["Python", "SQL"],
            "concepts_detected": ["Programming"],
            "domain_family_detected": "online_software_family",
            "hours_distribution_estimate": {
                "by_area": [{"area": "Programming & Development", "estimated_hours": 10.0, "weight": 1.0}]
            },
            "evidence_map": {
                "areas": {"Programming & Development": ["skill:Python", "skill:SQL"]},
                "skills": {"Python": ["title"], "SQL": ["description"]},
            },
            "quality_flags": ["missing_category"],
            "skills_source": {"explicit": ["Python"], "inferred_from_text": ["SQL"]},
            "text_for_embedding": "Curso de Prueba Online\nDescripcion de prueba con Python y SQL.",
        },
    }


class SemanticAnalysisExporterTests(unittest.TestCase):
    # 1. PDF confident -> status completed
    def test_pdf_confident_maps_to_status_completed(self):
        record = _pdf_confident_record()
        artifact = export_semantic_analysis(record, SOURCE_TYPE_ACADEMIC_PDF, "fallback_id")
        self.assertEqual(artifact.status, "completed")
        self.assertEqual(len(artifact.areas), 1)
        self.assertEqual(artifact.areas[0].label, "Area de Prueba")
        self.assertEqual(artifact.areas[0].confidence, 0.95)
        self.assertEqual(artifact.areas[0].confidenceMethod, "measured")
        self.assertEqual(artifact.partialReasons, [])

    # 2. PDF unresolved_domain_candidate -> partial, areas=[], warning, partialReason
    def test_pdf_unresolved_area_is_stripped_and_flagged(self):
        record = _pdf_unresolved_record()
        artifact = export_semantic_analysis(record, SOURCE_TYPE_ACADEMIC_PDF, "fallback_id")
        self.assertEqual(artifact.status, "partial")
        self.assertEqual(artifact.areas, [])
        self.assertIn("area_could_not_be_confidently_resolved", artifact.warnings)
        self.assertIn("kbs_area_assignment_status_unresolved_domain_candidate", artifact.partialReasons)
        # el sentinel no debe sobrevivir como area publica (label/id) en ningun lado
        # del artifact — solo puede aparecer, explicado, dentro de partialReasons.
        for area in artifact.areas:
            self.assertNotEqual(area.label, "unresolved_domain_candidate")
            self.assertNotEqual(area.id, "area_unresolved_domain_candidate")
        for area_id in artifact.evidenceMap.areas:
            self.assertNotEqual(area_id, "area_unresolved_domain_candidate")
        # el sentinel tampoco debe filtrarse via textForEmbedding (texto libre
        # que el pipeline arma concatenando areas_detected, sentinel incluido).
        self.assertNotIn("unresolved_domain_candidate", artifact.textForEmbedding)
        self.assertIn("área no resuelta", artifact.textForEmbedding)

    # 3. Online sin confidence -> confidence null, confidenceMethod unavailable, warning
    def test_online_confidence_is_explicitly_unavailable(self):
        record = _online_record_no_confidence()
        artifact = export_semantic_analysis(record, SOURCE_TYPE_ONLINE_COURSE_CATALOG, "fallback_id")
        self.assertIsNone(artifact.confidence.global_value)
        self.assertEqual(artifact.confidence.global_method, "unavailable")
        for skill in artifact.skills:
            self.assertIsNone(skill.confidence)
            self.assertEqual(skill.confidenceMethod, "unavailable")
        self.assertIn("confidence_not_available_in_source_pipeline", artifact.warnings)
        self.assertIn("no_holder_completion_evidence_in_source_dataset", artifact.warnings)

    # 4. quality_flags PDF dict -> lista normalizada
    def test_pdf_quality_flags_dict_flattens_to_list(self):
        qf = {
            "area_assignment_status": "confident",
            "semantic_quality_status": "high",
            "skills_detection_reliability": 0.9,
            "hours_distribution_reliability": 0.9,
        }
        flags = flatten_pdf_quality_flags(qf)
        self.assertIsInstance(flags, list)
        self.assertIn("area_assignment_confident", flags)
        self.assertIn("semantic_quality_high", flags)
        self.assertIn("skills_detection_reliability_high", flags)
        self.assertIn("hours_distribution_reliability_high", flags)

    def test_online_quality_flags_list_maps_to_known_codes(self):
        flags = flatten_online_quality_flags(["missing_category", "unknown_future_flag"])
        self.assertIn("missing_category", flags)
        self.assertIn("unmapped_quality_flag:unknown_future_flag", flags)

    # 5. skills_detected online list[string] -> list[object]
    def test_online_skills_detected_strings_become_objects(self):
        record = _online_record_no_confidence()
        artifact = export_semantic_analysis(record, SOURCE_TYPE_ONLINE_COURSE_CATALOG, "fallback_id")
        self.assertEqual(len(artifact.skills), 2)
        for skill in artifact.skills:
            self.assertIsInstance(skill.id, str)
            self.assertIsInstance(skill.label, str)

    # 6. skills_source explicit/inferred -> source
    def test_online_skill_source_from_skills_source(self):
        record = _online_record_no_confidence()
        artifact = export_semantic_analysis(record, SOURCE_TYPE_ONLINE_COURSE_CATALOG, "fallback_id")
        by_label = {s.label: s for s in artifact.skills}
        self.assertEqual(by_label["Python"].source, "explicit")
        self.assertEqual(by_label["SQL"].source, "inferred")

    # 7. schemaVersion / pipelineVersion / taxonomyVersion siempre presentes
    def test_version_fields_always_present(self):
        for record, source_type in (
            (_pdf_confident_record(), SOURCE_TYPE_ACADEMIC_PDF),
            (_online_record_no_confidence(), SOURCE_TYPE_ONLINE_COURSE_CATALOG),
        ):
            artifact = export_semantic_analysis(record, source_type, "fallback_id")
            self.assertEqual(artifact.schemaVersion, SCHEMA_VERSION)
            self.assertEqual(artifact.pipelineVersion, PIPELINE_VERSION)
            self.assertEqual(artifact.taxonomyVersion, TAXONOMY_VERSION)
            self.assertEqual(artifact.pipelineVersion, "unversioned_current")
            self.assertEqual(artifact.taxonomyVersion, "unversioned_current")

    # 8. El exporter no modifica el input original
    def test_exporter_does_not_mutate_input_record(self):
        for record, source_type in (
            (_pdf_confident_record(), SOURCE_TYPE_ACADEMIC_PDF),
            (_pdf_unresolved_record(), SOURCE_TYPE_ACADEMIC_PDF),
            (_online_record_no_confidence(), SOURCE_TYPE_ONLINE_COURSE_CATALOG),
        ):
            before = copy.deepcopy(record)
            export_semantic_analysis(record, source_type, "fallback_id")
            self.assertEqual(record, before, "el record de entrada no debe mutarse")

    # Extra: forma invalida no rompe, levanta un error claro y catalogable
    def test_invalid_record_shape_raises_clear_error(self):
        with self.assertRaises(InvalidRecordShapeError):
            export_semantic_analysis({"foo": "bar"}, SOURCE_TYPE_ACADEMIC_PDF, "fallback_id")


if __name__ == "__main__":
    unittest.main()

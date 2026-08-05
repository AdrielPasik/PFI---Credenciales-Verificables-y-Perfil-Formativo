"""
Tests de Fase 5A (experimental): `src.profile_builder.artifact_profile_adapter`.

Ejercita `build_aggregated_profile_input` directo, sobre artifacts
`semantic_analysis_v1` sinteticos definidos en `_fixtures.py` -- nunca
sobre `output/backend_artifacts/` ni ningun corpus real. No construye
`UserProfile`, no escribe en `profiles/`.
"""
import copy
import unittest

from src.profile_builder.artifact_loader import InvalidArtifactError
from src.profile_builder.artifact_profile_adapter import build_aggregated_profile_input
from tests.profile_builder._fixtures import online_artifact, pdf_artifact


class SingleArtifactAggregationTests(unittest.TestCase):
    def test_pdf_completed_artifact_with_area_skill_concept_and_hours(self):
        result = build_aggregated_profile_input([pdf_artifact()])

        self.assertEqual(result["source_artifacts_count"], 1)
        self.assertEqual(result["by_source_type"], {"academic_pdf": 1})

        self.assertEqual(len(result["areas"]), 1)
        area = result["areas"][0]
        self.assertEqual(area["id"], "area_software")
        self.assertEqual(area["count"], 1)
        self.assertEqual(area["avg_confidence"], 0.9)
        self.assertEqual(area["total_hours"], 40.0)
        self.assertEqual(area["source_types"], {"academic_pdf": 1})

        self.assertEqual(len(result["skills"]), 1)
        skill = result["skills"][0]
        self.assertEqual(skill["id"], "skill_python")
        self.assertEqual(skill["avg_confidence"], 0.8)
        self.assertEqual(skill["sources"], {"explicit": 1})

        self.assertEqual(len(result["concepts"]), 1)
        self.assertEqual(result["concepts"][0]["id"], "poo")

        self.assertEqual(result["hours_by_area"], {"area_software": 40.0})

    def test_pdf_partial_artifact_without_skills(self):
        artifact = pdf_artifact(
            status="partial",
            skills=[],
            warnings=["no_skill_detected"],
            partialReasons=["kbs_area_assignment_status_low_confidence_multi_candidate"],
        )
        result = build_aggregated_profile_input([artifact])

        self.assertEqual(result["skills"], [])
        self.assertEqual(result["quality_summary"]["status"], {"partial": 1})
        self.assertEqual(result["warnings"], {"no_skill_detected": 1})
        self.assertEqual(
            result["partial_reasons"],
            {"kbs_area_assignment_status_low_confidence_multi_candidate": 1},
        )

    def test_online_artifact_with_confidence_null(self):
        result = build_aggregated_profile_input([online_artifact()])

        self.assertEqual(result["by_source_type"], {"online_course_catalog": 1})
        self.assertEqual(result["quality_summary"]["confidence_global"], {"present": 0, "null": 1})
        self.assertEqual(
            result["quality_summary"]["confidence_global_method_distribution"],
            {"unavailable": 1},
        )
        # area/skill de un artifact online con confidence None -> avg_confidence None
        self.assertIsNone(result["areas"][0]["avg_confidence"])
        self.assertIsNone(result["skills"][0]["avg_confidence"])
        self.assertEqual(result["skills"][0]["sources"], {"inferred": 1})


class CrossArtifactAggregationTests(unittest.TestCase):
    def test_same_area_aggregated_across_two_artifacts(self):
        a1 = pdf_artifact(sourceRefs={"documentId": "1.1.001", "fileName": "a.pdf"})
        a2 = pdf_artifact(sourceRefs={"documentId": "1.1.002", "fileName": "b.pdf"})
        result = build_aggregated_profile_input([a1, a2])

        self.assertEqual(len(result["areas"]), 1)
        area = result["areas"][0]
        self.assertEqual(area["count"], 2)
        self.assertEqual(area["source_types"], {"academic_pdf": 2})
        self.assertEqual(len(area["source_ref_examples"]), 2)

    def test_same_skill_aggregated_across_two_artifacts(self):
        a1 = pdf_artifact(sourceRefs={"documentId": "1.1.001", "fileName": "a.pdf"})
        a2 = pdf_artifact(sourceRefs={"documentId": "1.1.002", "fileName": "b.pdf"})
        result = build_aggregated_profile_input([a1, a2])

        self.assertEqual(len(result["skills"]), 1)
        skill = result["skills"][0]
        self.assertEqual(skill["count"], 2)
        self.assertEqual(skill["sources"], {"explicit": 2})

    def test_average_confidence_ignores_null(self):
        a1 = pdf_artifact(
            sourceRefs={"documentId": "1.1.001", "fileName": "a.pdf"},
            skills=[
                {
                    "id": "skill_python",
                    "label": "Python",
                    "confidence": 1.0,
                    "confidenceMethod": "measured",
                    "source": "explicit",
                }
            ],
        )
        a2 = pdf_artifact(
            sourceRefs={"documentId": "1.1.002", "fileName": "b.pdf"},
            skills=[
                {
                    "id": "skill_python",
                    "label": "Python",
                    "confidence": None,
                    "confidenceMethod": "unavailable",
                    "source": "inferred",
                }
            ],
        )
        result = build_aggregated_profile_input([a1, a2])

        skill = result["skills"][0]
        self.assertEqual(skill["count"], 2)
        # promedio ignorando null: solo cuenta el 1.0 -> avg = 1.0, no (1.0+0)/2
        self.assertEqual(skill["avg_confidence"], 1.0)

    def test_hours_distribution_accumulated_by_area_id(self):
        a1 = pdf_artifact(
            sourceRefs={"documentId": "1.1.001", "fileName": "a.pdf"},
            hoursDistribution=[{"areaId": "area_software", "hours": 40.0}],
        )
        a2 = pdf_artifact(
            sourceRefs={"documentId": "1.1.002", "fileName": "b.pdf"},
            hoursDistribution=[{"areaId": "area_software", "hours": 20.0}],
        )
        result = build_aggregated_profile_input([a1, a2])

        self.assertEqual(result["hours_by_area"], {"area_software": 60.0})
        self.assertEqual(result["areas"][0]["total_hours"], 60.0)

    def test_quality_flags_warnings_and_partial_reasons_aggregated(self):
        a1 = pdf_artifact(
            sourceRefs={"documentId": "1.1.001", "fileName": "a.pdf"},
            qualityFlags=["area_assignment_confident", "semantic_quality_high"],
            warnings=["no_skill_detected"],
            partialReasons=[],
        )
        a2 = pdf_artifact(
            sourceRefs={"documentId": "1.1.002", "fileName": "b.pdf"},
            status="partial",
            qualityFlags=["area_assignment_confident"],
            warnings=["no_skill_detected", "no_area_detected"],
            partialReasons=["kbs_area_assignment_status_low_confidence_multi_candidate"],
        )
        result = build_aggregated_profile_input([a1, a2])

        self.assertEqual(
            result["quality_summary"]["quality_flags"],
            {"area_assignment_confident": 2, "semantic_quality_high": 1},
        )
        self.assertEqual(result["quality_summary"]["status"], {"completed": 1, "partial": 1})
        self.assertEqual(
            result["warnings"],
            {"no_skill_detected": 2, "no_area_detected": 1},
        )
        self.assertEqual(
            result["partial_reasons"],
            {"kbs_area_assignment_status_low_confidence_multi_candidate": 1},
        )


class RejectionTests(unittest.TestCase):
    def test_rejects_artifact_without_schema_version(self):
        artifact = pdf_artifact()
        del artifact["schemaVersion"]
        with self.assertRaises(InvalidArtifactError):
            build_aggregated_profile_input([artifact])

    def test_rejects_artifact_with_incorrect_schema_version(self):
        artifact = pdf_artifact(schemaVersion="semantic_analysis_v2")
        with self.assertRaises(InvalidArtifactError):
            build_aggregated_profile_input([artifact])

    def test_explicitly_rejects_credential_candidate_v1(self):
        artifact = pdf_artifact(schemaVersion="credential_candidate_v1")
        with self.assertRaises(InvalidArtifactError) as ctx:
            build_aggregated_profile_input([artifact])
        self.assertIn("credential_candidate_v1", str(ctx.exception))


class NoMutationTests(unittest.TestCase):
    def test_original_artifact_is_not_modified(self):
        artifact = pdf_artifact()
        snapshot = copy.deepcopy(artifact)

        build_aggregated_profile_input([artifact])

        self.assertEqual(artifact, snapshot)


if __name__ == "__main__":
    unittest.main()

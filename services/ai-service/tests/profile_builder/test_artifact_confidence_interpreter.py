"""
Tests de Fase 3A (experimental): `src.profile_builder.artifact_confidence_interpreter`.

Ejercita `interpret_artifact_confidence` / `interpret_artifacts_confidence` /
`interpret_aggregated_confidence` sobre fixtures sintéticas -- nunca sobre
corpus real. No construye `UserProfile`, no escribe en `profiles/`, no
sobrescribe `confidence` del artifact original.
"""
import copy
import json
import unittest

from src.profile_builder.artifact_confidence_interpreter import (
    interpret_aggregated_confidence,
    interpret_artifact_confidence,
    interpret_artifacts_confidence,
)
from src.profile_builder.artifact_loader import InvalidArtifactError
from src.profile_builder.artifact_profile_adapter import build_aggregated_profile_input
from tests.profile_builder._fixtures import online_artifact, pdf_artifact

LONG_TEXT = (
    "Curso de programación en Python: tipos de datos, estructuras de control, "
    "funciones y manejo de excepciones para desarrollo de software."
)


class PdfBandTests(unittest.TestCase):
    def test_completed_with_high_confidence_and_full_evidence_is_high(self):
        artifact = pdf_artifact(textForEmbedding=LONG_TEXT)  # confidence.global=0.85, evidencia completa
        result = interpret_artifact_confidence(artifact)

        overall = result["overallConfidence"]
        self.assertEqual(overall["band"], "high")
        self.assertEqual(overall["score"], 0.85)
        self.assertEqual(overall["scoreMethod"], "derived")
        self.assertTrue(overall["drivers"])

    def test_partial_with_useful_areas_is_medium(self):
        artifact = pdf_artifact(
            status="partial",
            textForEmbedding=LONG_TEXT,
            skills=[],
            warnings=["no_skill_detected"],
            partialReasons=["kbs_area_assignment_status_low_confidence_multi_candidate"],
        )
        result = interpret_artifact_confidence(artifact)

        self.assertEqual(result["overallConfidence"]["band"], "medium")

    def test_partial_without_useful_content_is_low(self):
        artifact = pdf_artifact(
            status="partial",
            areas=[],
            skills=[],
            concepts=[],
            confidence={"global": None, "globalMethod": "unavailable", "coverage": None, "coverageMethod": "unavailable"},
            evidenceMap={"areas": {}, "skills": {}, "concepts": {}},
            warnings=["no_area_detected", "no_skill_detected"],
            partialReasons=["kbs_area_assignment_status_unresolved_domain_candidate"],
            textForEmbedding=LONG_TEXT,
        )
        result = interpret_artifact_confidence(artifact)

        self.assertEqual(result["overallConfidence"]["band"], "low")

    def test_pdf_without_skills_but_with_area_and_concepts_does_not_fail_and_generates_limitation(self):
        artifact = pdf_artifact(
            textForEmbedding=LONG_TEXT,
            skills=[],
            warnings=["no_skill_detected"],
        )
        result = interpret_artifact_confidence(artifact)  # no debe levantar

        self.assertIn(
            "No se detectaron skills explícitas en esta credencial.",
            result["overallConfidence"]["limitations"],
        )
        self.assertEqual(result["skillConfidence"]["count"], 0)
        self.assertEqual(result["skillConfidence"]["band"], "unavailable")
        # el área y los concepts si estan presentes y no deben verse afectados
        self.assertEqual(result["areaConfidence"]["count"], 1)

    def test_empty_evidence_map_lowers_confidence_below_high(self):
        artifact = pdf_artifact(
            textForEmbedding=LONG_TEXT,
            evidenceMap={"areas": {}, "skills": {}, "concepts": {}},
        )
        result = interpret_artifact_confidence(artifact)

        overall = result["overallConfidence"]
        self.assertNotEqual(overall["band"], "high")
        self.assertIn(
            "hay áreas y/o skills detectadas sin evidencia trazable suficiente en evidenceMap",
            overall["limitations"],
        )
        self.assertFalse(result["sourceQuality"]["hasAreaEvidence"])
        self.assertFalse(result["sourceQuality"]["hasSkillEvidence"])


class OnlineBandTests(unittest.TestCase):
    def test_online_null_confidence_with_areas_skills_and_evidence_is_qualitative_medium(self):
        artifact = online_artifact(
            textForEmbedding=LONG_TEXT,
            evidenceMap={
                "areas": {"area_software": ["title:python"]},
                "skills": {"skill_python": ["skill:python"]},
                "concepts": {},
            },
        )
        result = interpret_artifact_confidence(artifact)
        overall = result["overallConfidence"]

        self.assertIsNone(overall["score"])
        self.assertEqual(overall["scoreMethod"], "qualitative_only")
        self.assertEqual(overall["band"], "medium")
        self.assertEqual(
            overall["explanation"],
            "La fuente tiene áreas y skills detectadas con evidencia, pero no provee confidence cuantitativa propia.",
        )
        # limitations en texto legible (traducido); los codigos crudos quedan en sourceQuality para trazabilidad
        self.assertIn("La fuente no provee confidence cuantitativa.", overall["limitations"])
        self.assertIn(
            "El curso describe una oferta/formación, pero no prueba finalización por parte del usuario.",
            overall["limitations"],
        )
        self.assertEqual(
            set(result["sourceQuality"]["warningCodes"]),
            {"confidence_not_available_in_source_pipeline", "no_holder_completion_evidence_in_source_dataset"},
        )

    def test_online_without_areas_or_skills_is_low(self):
        artifact = online_artifact(
            areas=[],
            skills=[],
            textForEmbedding=LONG_TEXT,
        )
        result = interpret_artifact_confidence(artifact)
        self.assertEqual(result["overallConfidence"]["band"], "low")


class WarningTranslationTests(unittest.TestCase):
    def test_no_holder_completion_evidence_warning_has_explicit_limitation(self):
        artifact = online_artifact(textForEmbedding=LONG_TEXT)  # trae este warning por defecto
        result = interpret_artifact_confidence(artifact)
        self.assertIn(
            "El curso describe una oferta/formación, pero no prueba finalización por parte del usuario.",
            result["overallConfidence"]["limitations"],
        )

    def test_confidence_not_available_warning_does_not_turn_null_into_zero(self):
        artifact = online_artifact(textForEmbedding=LONG_TEXT)
        result = interpret_artifact_confidence(artifact)
        self.assertIsNone(result["overallConfidence"]["score"])
        self.assertNotEqual(result["overallConfidence"]["score"], 0)

    def test_all_null_confidence_yields_none_score_not_zero(self):
        artifact = pdf_artifact(
            textForEmbedding=LONG_TEXT,
            confidence={"global": None, "globalMethod": "unavailable", "coverage": None, "coverageMethod": "unavailable"},
            areas=[{"id": "area_software", "label": "Software", "confidence": None, "confidenceMethod": "unavailable", "source": "inferred"}],
            skills=[{"id": "skill_python", "label": "Python", "confidence": None, "confidenceMethod": "unavailable", "source": "inferred"}],
        )
        result = interpret_artifact_confidence(artifact)

        self.assertIsNone(result["overallConfidence"]["score"])
        self.assertNotEqual(result["overallConfidence"]["score"], 0)
        self.assertIsNone(result["areaConfidence"]["avgDeclaredConfidence"])
        self.assertNotEqual(result["areaConfidence"]["avgDeclaredConfidence"], 0)
        self.assertIsNone(result["skillConfidence"]["avgDeclaredConfidence"])

    def test_warnings_and_partial_reasons_are_translated_to_readable_explanations(self):
        artifact = pdf_artifact(
            status="partial",
            textForEmbedding=LONG_TEXT,
            warnings=["no_area_detected", "no_skill_detected"],
            partialReasons=["kbs_area_assignment_status_unresolved_domain_candidate"],
        )
        result = interpret_artifact_confidence(artifact)
        limitations = result["overallConfidence"]["limitations"]

        self.assertIn("No se pudo asignar un área con evidencia suficiente.", limitations)
        self.assertIn("No se detectaron skills explícitas en esta credencial.", limitations)
        self.assertIn(
            "La asignación de área quedó en estado 'unresolved_domain_candidate' (no confirmada como confiable).",
            limitations,
        )
        # nunca el codigo crudo tal cual dentro de "limitations"
        self.assertNotIn("no_area_detected", limitations)
        self.assertNotIn("no_skill_detected", limitations)


class DeterminismAndMutationTests(unittest.TestCase):
    def test_same_input_produces_identical_output(self):
        artifact = pdf_artifact(textForEmbedding=LONG_TEXT)
        result_1 = interpret_artifact_confidence(copy.deepcopy(artifact))
        result_2 = interpret_artifact_confidence(copy.deepcopy(artifact))
        self.assertEqual(result_1, result_2)

    def test_output_is_json_serializable(self):
        artifact = pdf_artifact(textForEmbedding=LONG_TEXT)
        result = interpret_artifact_confidence(artifact)
        round_tripped = json.loads(json.dumps(result))
        self.assertEqual(result, round_tripped)

    def test_batch_interpretation_order_independent_per_artifact(self):
        a1 = pdf_artifact(sourceRefs={"documentId": "1.1.001", "fileName": "a.pdf"}, textForEmbedding=LONG_TEXT)
        a2 = online_artifact(
            sourceRefs={"documentId": "online_001", "fileName": None},
            textForEmbedding=LONG_TEXT,
            evidenceMap={
                "areas": {"area_software": ["title:python"]},
                "skills": {"skill_python": ["skill:python"]},
                "concepts": {},
            },
        )

        forward = interpret_artifacts_confidence([a1, a2])
        backward = interpret_artifacts_confidence([a2, a1])

        # cada interpretacion depende solo de su propio artifact -> mismo
        # contenido semantico sin importar el orden de la lista de entrada.
        forward_by_doc = {r["sourceQuality"]["sourceType"]: r for r in forward}
        backward_by_doc = {r["sourceQuality"]["sourceType"]: r for r in backward}
        self.assertEqual(forward_by_doc, backward_by_doc)

    def test_does_not_mutate_original_artifact(self):
        artifact = pdf_artifact(textForEmbedding=LONG_TEXT)
        snapshot = copy.deepcopy(artifact)

        interpret_artifact_confidence(artifact)

        self.assertEqual(artifact, snapshot)
        self.assertEqual(artifact["confidence"], snapshot["confidence"])  # no se sobrescribe confidence original

    def test_does_not_mutate_aggregated_input(self):
        artifacts = [pdf_artifact(textForEmbedding=LONG_TEXT), online_artifact(textForEmbedding=LONG_TEXT)]
        aggregated = build_aggregated_profile_input(artifacts)
        snapshot = copy.deepcopy(aggregated)

        interpret_aggregated_confidence(aggregated)

        self.assertEqual(aggregated, snapshot)


class MultiDomainSkillsTests(unittest.TestCase):
    def test_multi_domain_skills_treated_same_as_software_skills(self):
        multi_domain_skill_labels = [
            "PCR",
            "Cromatografía",
            "VHDL",
            "AutoCAD",
            "Six Sigma",
            "Evaluación de Impacto Ambiental",
            "Control Estadístico de Procesos",
            "Machine Learning",
            "Scrum",
            "SQL",
        ]
        skills = [
            {
                "id": f"skill_{i}",
                "label": label,
                "confidence": 0.9,
                "confidenceMethod": "measured",
                "source": "explicit",
            }
            for i, label in enumerate(multi_domain_skill_labels)
        ]
        evidence_skills = {f"skill_{i}": [f"matched_signal:{label.lower()}"] for i, label in enumerate(multi_domain_skill_labels)}

        artifact = pdf_artifact(
            skills=skills,
            textForEmbedding=LONG_TEXT,
            evidenceMap={
                "areas": {"area_software": ["matched_signal:software"]},
                "skills": evidence_skills,
                "concepts": {},
            },
        )
        result = interpret_artifact_confidence(artifact)

        self.assertEqual(result["skillConfidence"]["count"], 10)
        self.assertEqual(result["skillConfidence"]["band"], "high")
        self.assertTrue(result["skillConfidence"]["hasEvidence"])
        # la banda no depende de que dominio sean las skills -- solo de evidencia/confidence declarada
        self.assertEqual(result["overallConfidence"]["band"], "high")


class InvalidArtifactHandlingTests(unittest.TestCase):
    def test_invalid_artifact_raises_explicit_error(self):
        with self.assertRaises(InvalidArtifactError):
            interpret_artifact_confidence({"schemaVersion": "not_semantic_analysis_v1"})

    def test_credential_candidate_v1_rejected(self):
        artifact = pdf_artifact(schemaVersion="credential_candidate_v1")
        with self.assertRaises(InvalidArtifactError):
            interpret_artifact_confidence(artifact)

    def test_batch_raises_on_first_invalid_without_partial_results(self):
        with self.assertRaises(InvalidArtifactError):
            interpret_artifacts_confidence([pdf_artifact(textForEmbedding=LONG_TEXT), {"schemaVersion": "semantic_analysis_v1"}])


class AggregatedConfidenceTests(unittest.TestCase):
    def test_aggregated_confidence_has_no_numeric_score_and_is_json_serializable(self):
        artifacts = [
            pdf_artifact(sourceRefs={"documentId": "1.1.001", "fileName": "a.pdf"}, textForEmbedding=LONG_TEXT),
            online_artifact(
                sourceRefs={"documentId": "online_001", "fileName": None},
                textForEmbedding=LONG_TEXT,
                evidenceMap={
                    "areas": {"area_software": ["title:python"]},
                    "skills": {"skill_python": ["skill:python"]},
                    "concepts": {},
                },
            ),
        ]
        aggregated = build_aggregated_profile_input(artifacts)
        result = interpret_aggregated_confidence(aggregated)

        self.assertNotIn("score", result)  # deliberadamente no hay score numerico a nivel portfolio
        self.assertIn(result["band"], ("high", "medium", "low", "unavailable"))
        round_tripped = json.loads(json.dumps(result))
        self.assertEqual(result, round_tripped)

    def test_empty_aggregate_is_unavailable(self):
        aggregated = build_aggregated_profile_input([])
        result = interpret_aggregated_confidence(aggregated)
        self.assertEqual(result["band"], "unavailable")


class WeakPortfolioGuardrailTests(unittest.TestCase):
    """
    Guardrail conservador (ver interpret_aggregated_confidence): un
    portfolio donde NINGUN artifact llego a completed y no hay ninguna
    skill detectada no debe leerse como 'medium' -- baja a 'low' para no
    sobreinterpretar un analisis sistematicamente incompleto (caso real:
    Perfil 6 -- Debil/parcial de
    reports/formative_profile_result_real_sample_v0.md).
    """

    def _partial_artifact_no_skills(self, doc_id: str) -> dict:
        return pdf_artifact(
            sourceRefs={"documentId": doc_id, "fileName": f"{doc_id}.pdf"},
            status="partial",
            areas=[
                {
                    "id": "area_x",
                    "label": "Area X",
                    "confidence": 0.6,
                    "confidenceMethod": "measured",
                    "source": "explicit",
                }
            ],
            skills=[],
            concepts=[],
            confidence={"global": None, "globalMethod": "unavailable", "coverage": None, "coverageMethod": "unavailable"},
            evidenceMap={"areas": {"area_x": ["matched_signal:x"]}, "skills": {}, "concepts": {}},
            warnings=["no_skill_detected"],
            partialReasons=["kbs_area_assignment_status_low_confidence_multi_candidate"],
            textForEmbedding=LONG_TEXT,
        )

    def test_all_partial_no_skills_portfolio_is_low(self):
        artifacts = [self._partial_artifact_no_skills(f"p{i}") for i in range(8)]
        aggregated = build_aggregated_profile_input(artifacts)
        snapshot = copy.deepcopy(aggregated)

        result = interpret_aggregated_confidence(aggregated)

        self.assertEqual(result["band"], "low")
        self.assertEqual(aggregated, snapshot)  # no muta el aggregate de entrada

    def test_all_partial_no_skills_explanation_mentions_partial_and_no_skills(self):
        artifacts = [self._partial_artifact_no_skills(f"p{i}") for i in range(8)]
        aggregated = build_aggregated_profile_input(artifacts)
        result = interpret_aggregated_confidence(aggregated)

        joined = " ".join(result["limitations"])
        self.assertIn("análisis parcial", joined)
        self.assertIn("no se detectaron skills explícitas", joined)

    def test_partial_with_skills_and_evidence_still_medium(self):
        """Mismo escenario 'todo partial', PERO con skills detectadas -- no
        debe activarse el guardrail (regla explicita: solo aplica cuando
        skills_count==0 o sin evidencia de skills)."""
        artifacts = [
            pdf_artifact(
                sourceRefs={"documentId": f"p{i}", "fileName": f"{i}.pdf"},
                status="partial",
                areas=[
                    {
                        "id": "area_software",
                        "label": "Software",
                        "confidence": 0.6,
                        "confidenceMethod": "measured",
                        "source": "explicit",
                    }
                ],
                skills=[
                    {
                        "id": "skill_python",
                        "label": "Python",
                        "confidence": 0.6,
                        "confidenceMethod": "measured",
                        "source": "explicit",
                    }
                ],
                evidenceMap={
                    "areas": {"area_software": ["matched_signal:software"]},
                    "skills": {"skill_python": ["matched_signal:python"]},
                    "concepts": {},
                },
                textForEmbedding=LONG_TEXT,
            )
            for i in range(4)
        ]
        aggregated = build_aggregated_profile_input(artifacts)
        result = interpret_aggregated_confidence(aggregated)
        self.assertEqual(result["band"], "medium")

    def test_online_unavailable_with_good_evidence_still_medium(self):
        """Online: confidence.global unavailable no debe activar el
        guardrail si hay areas/skills con evidencia -- el guardrail exige
        completed==0 Y partial==total Y sin skills; online con buena
        senal normalmente tiene status=completed (ver derive_status_online),
        asi que completed>0 y el guardrail no aplica."""
        artifacts = [
            online_artifact(
                sourceRefs={"documentId": f"o{i}", "fileName": None},
                textForEmbedding=LONG_TEXT,
                evidenceMap={
                    "areas": {"area_software": ["title:python"]},
                    "skills": {"skill_python": ["skill:python"]},
                    "concepts": {},
                },
            )
            for i in range(3)
        ]
        aggregated = build_aggregated_profile_input(artifacts)
        result = interpret_aggregated_confidence(aggregated)
        self.assertEqual(result["band"], "medium")

    def test_completed_portfolio_with_evidence_does_not_regress(self):
        artifacts = [
            pdf_artifact(sourceRefs={"documentId": f"c{i}", "fileName": f"{i}.pdf"}, textForEmbedding=LONG_TEXT)
            for i in range(3)
        ]
        aggregated = build_aggregated_profile_input(artifacts)
        result = interpret_aggregated_confidence(aggregated)
        self.assertIn(result["band"], ("high", "medium"))

    def test_result_is_json_serializable(self):
        artifacts = [self._partial_artifact_no_skills(f"p{i}") for i in range(8)]
        aggregated = build_aggregated_profile_input(artifacts)
        result = interpret_aggregated_confidence(aggregated)
        round_tripped = json.loads(json.dumps(result))
        self.assertEqual(result, round_tripped)

    def test_deterministic(self):
        artifacts = [self._partial_artifact_no_skills(f"p{i}") for i in range(8)]
        aggregated_1 = build_aggregated_profile_input(copy.deepcopy(artifacts))
        aggregated_2 = build_aggregated_profile_input(copy.deepcopy(artifacts))
        result_1 = interpret_aggregated_confidence(aggregated_1)
        result_2 = interpret_aggregated_confidence(aggregated_2)
        self.assertEqual(result_1, result_2)


if __name__ == "__main__":
    unittest.main()

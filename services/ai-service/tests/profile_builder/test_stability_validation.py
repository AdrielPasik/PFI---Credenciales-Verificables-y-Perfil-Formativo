"""
Validacion final de estabilidad/trazabilidad de Fase 5A (experimental),
antes de cerrarla. Cubre, sobre fixtures sinteticas (nunca corpus real):

1. Serializabilidad JSON de la salida.
2. Determinismo para el mismo orden de entrada.
3. Independencia del contenido semantico respecto al orden de entrada
   (las listas agregadas se ordenan por id/label al final, ver
   artifact_profile_adapter.py).
4. No mutacion de los artifacts de entrada.
5. confidence=null ignorado correctamente en promedios.
6. Si todos los confidence son null, el promedio queda None (no 0).
7. sourceRefs es trazabilidad, no identidad -- documentId duplicado entre
   artifacts distintos no colapsa/deduplica artifacts.
8. No construye UserProfile ni hace ningun I/O de archivos.
9. Rechazo explicito de credential_candidate_v1 (ya cubierto en
   test_artifact_profile_adapter.py; se re-confirma aca por completitud
   de este reporte de validacion).
"""
import copy
import json
import unittest
from unittest.mock import patch

from src.profile_builder.artifact_loader import InvalidArtifactError
from src.profile_builder.artifact_profile_adapter import build_aggregated_profile_input
from src.profile_builder.profile_models import UserProfile
from tests.profile_builder._fixtures import online_artifact, pdf_artifact


class JsonSerializabilityTests(unittest.TestCase):
    def test_output_is_json_serializable_and_round_trips(self):
        artifacts = [pdf_artifact(), online_artifact()]
        result = build_aggregated_profile_input(artifacts)

        text = json.dumps(result)  # no debe levantar (no Counter/set/dataclass sin convertir)
        round_tripped = json.loads(text)

        self.assertEqual(result, round_tripped)


class DeterminismTests(unittest.TestCase):
    def test_same_input_order_produces_identical_output(self):
        artifacts = [pdf_artifact(), online_artifact()]

        result_1 = build_aggregated_profile_input(copy.deepcopy(artifacts))
        result_2 = build_aggregated_profile_input(copy.deepcopy(artifacts))

        self.assertEqual(result_1, result_2)
        self.assertEqual(json.dumps(result_1, sort_keys=True), json.dumps(result_2, sort_keys=True))

    def test_different_input_order_produces_same_semantic_content(self):
        a1 = pdf_artifact(sourceRefs={"documentId": "1.1.001", "fileName": "a.pdf"})
        a2 = pdf_artifact(
            sourceRefs={"documentId": "1.1.002", "fileName": "b.pdf"},
            areas=[
                {
                    "id": "area_datos",
                    "label": "Datos",
                    "confidence": 0.7,
                    "confidenceMethod": "measured",
                    "source": "explicit",
                }
            ],
            skills=[
                {
                    "id": "skill_sql",
                    "label": "SQL",
                    "confidence": 0.6,
                    "confidenceMethod": "measured",
                    "source": "explicit",
                }
            ],
            hoursDistribution=[{"areaId": "area_datos", "hours": 10.0}],
        )
        a3 = online_artifact(sourceRefs={"documentId": "online_00099", "fileName": None})

        forward = build_aggregated_profile_input([a1, a2, a3])
        reversed_order = build_aggregated_profile_input([a3, a2, a1])
        shuffled = build_aggregated_profile_input([a2, a3, a1])

        self.assertEqual(forward, reversed_order)
        self.assertEqual(forward, shuffled)

    def test_source_ref_examples_stable_across_input_order_with_more_than_max_examples(self):
        """MAX_SOURCE_REF_EXAMPLES=5: con mas de 5 artifacts aportando la
        misma skill, el subconjunto de ejemplos mostrado debe ser el mismo
        sin importar el orden de entrada (se ordena por documentId antes
        de truncar, no se trunca en el orden de llegada)."""
        artifacts_forward = [
            pdf_artifact(sourceRefs={"documentId": f"1.1.{i:03d}", "fileName": f"{i}.pdf"})
            for i in range(7)
        ]
        artifacts_backward = list(reversed(artifacts_forward))

        result_forward = build_aggregated_profile_input(artifacts_forward)
        result_backward = build_aggregated_profile_input(artifacts_backward)

        self.assertEqual(result_forward, result_backward)
        skill = result_forward["skills"][0]
        self.assertEqual(skill["count"], 7)
        self.assertEqual(len(skill["source_ref_examples"]), 5)


class NoMutationTests(unittest.TestCase):
    def test_multiple_artifacts_not_mutated(self):
        a1 = pdf_artifact(sourceRefs={"documentId": "1.1.001", "fileName": "a.pdf"})
        a2 = online_artifact(sourceRefs={"documentId": "online_00001", "fileName": None})
        snapshot_1 = copy.deepcopy(a1)
        snapshot_2 = copy.deepcopy(a2)

        build_aggregated_profile_input([a1, a2])

        self.assertEqual(a1, snapshot_1)
        self.assertEqual(a2, snapshot_2)


class ConfidenceNullHandlingTests(unittest.TestCase):
    def test_null_confidence_ignored_in_area_average(self):
        a1 = pdf_artifact(
            sourceRefs={"documentId": "1.1.001", "fileName": "a.pdf"},
            areas=[
                {
                    "id": "area_software",
                    "label": "Software",
                    "confidence": 0.6,
                    "confidenceMethod": "measured",
                    "source": "explicit",
                }
            ],
        )
        a2 = pdf_artifact(
            sourceRefs={"documentId": "1.1.002", "fileName": "b.pdf"},
            areas=[
                {
                    "id": "area_software",
                    "label": "Software",
                    "confidence": None,
                    "confidenceMethod": "unavailable",
                    "source": "inferred",
                }
            ],
        )
        result = build_aggregated_profile_input([a1, a2])

        area = result["areas"][0]
        self.assertEqual(area["count"], 2)
        self.assertEqual(area["avg_confidence"], 0.6)  # no (0.6 + 0) / 2

    def test_all_null_confidence_yields_none_average_not_zero(self):
        a1 = pdf_artifact(
            sourceRefs={"documentId": "1.1.001", "fileName": "a.pdf"},
            areas=[
                {
                    "id": "area_software",
                    "label": "Software",
                    "confidence": None,
                    "confidenceMethod": "unavailable",
                    "source": "inferred",
                }
            ],
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
        a2 = pdf_artifact(
            sourceRefs={"documentId": "1.1.002", "fileName": "b.pdf"},
            areas=[
                {
                    "id": "area_software",
                    "label": "Software",
                    "confidence": None,
                    "confidenceMethod": "unavailable",
                    "source": "inferred",
                }
            ],
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

        self.assertIsNone(result["areas"][0]["avg_confidence"])
        self.assertIsNone(result["skills"][0]["avg_confidence"])
        # explicitamente None, no 0 ni 0.0
        self.assertNotEqual(result["areas"][0]["avg_confidence"], 0)
        self.assertNotEqual(result["skills"][0]["avg_confidence"], 0)


class SourceRefsTraceabilityNotIdentityTests(unittest.TestCase):
    def test_duplicate_document_id_across_artifacts_does_not_deduplicate_or_merge_identity(self):
        """documentId repetido entre dos artifacts (ej. mismo curso
        reprocesado, o dato de prueba) no debe tratarse como "mismo
        usuario"/"mismo holder" ni colapsar los artifacts -- cada artifact
        se cuenta y agrega de forma independiente. sourceRefs es solo
        trazabilidad de origen, no una clave de identidad."""
        a1 = pdf_artifact(
            sourceRefs={"documentId": "same_id", "fileName": "a.pdf"},
            skills=[
                {
                    "id": "skill_python",
                    "label": "Python",
                    "confidence": 0.9,
                    "confidenceMethod": "measured",
                    "source": "explicit",
                }
            ],
        )
        a2 = pdf_artifact(
            sourceRefs={"documentId": "same_id", "fileName": "b.pdf"},
            skills=[
                {
                    "id": "skill_sql",
                    "label": "SQL",
                    "confidence": 0.5,
                    "confidenceMethod": "measured",
                    "source": "explicit",
                }
            ],
        )
        result = build_aggregated_profile_input([a1, a2])

        self.assertEqual(result["source_artifacts_count"], 2)
        skill_ids = {s["id"] for s in result["skills"]}
        self.assertEqual(skill_ids, {"skill_python", "skill_sql"})
        self.assertEqual(len(result["metadata"]["source_refs"]), 2)


class DoesNotBuildProfileOrDoIoTests(unittest.TestCase):
    def test_output_is_plain_dict_not_user_profile(self):
        result = build_aggregated_profile_input([pdf_artifact()])
        self.assertIsInstance(result, dict)
        self.assertNotIsInstance(result, UserProfile)
        self.assertNotIn("profile_version", result)
        self.assertNotIn("courses_processed", result)

    def test_does_not_perform_any_file_io(self):
        with patch("builtins.open") as mock_open:
            build_aggregated_profile_input([pdf_artifact(), online_artifact()])
        mock_open.assert_not_called()


class CredentialCandidateRejectionReconfirmationTests(unittest.TestCase):
    def test_credential_candidate_v1_still_rejected(self):
        artifact = pdf_artifact(schemaVersion="credential_candidate_v1")
        with self.assertRaises(InvalidArtifactError) as ctx:
            build_aggregated_profile_input([artifact])
        self.assertIn("credential_candidate_v1", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()

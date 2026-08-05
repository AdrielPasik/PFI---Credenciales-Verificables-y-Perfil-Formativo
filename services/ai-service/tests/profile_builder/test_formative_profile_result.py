"""
Tests de `src.profile_builder.formative_profile_result` (resultado
semántico agnóstico de UI, `formative_profile_result_v0`).

Ejercita `build_formative_profile_result` sobre fixtures sintéticas --
nunca sobre corpus real. No escribe en disco, no importa
`profile_builder.py` productivo.
"""
import copy
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from src.profile_builder.formative_profile_result import (
    PROFILE_VERSION,
    build_formative_profile_result,
)
from tests.profile_builder._fixtures import online_artifact, pdf_artifact

LONG_TEXT = (
    "Curso de programación en Python: tipos de datos, estructuras de control, "
    "funciones y manejo de excepciones para desarrollo de software."
)

FORBIDDEN_WORDS = ["experto", "domina", "garantizado", "completó", "certifica", "demuestra finalización"]

UI_ONLY_KEYS = {"cards", "uiHints", "confidenceLabel", "subtitle", "title", "riskLevel", "showConfidenceBadge"}


def _all_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _all_strings(v)
    elif isinstance(value, list):
        for item in value:
            yield from _all_strings(item)


def _all_keys(value):
    if isinstance(value, dict):
        for k, v in value.items():
            yield k
            yield from _all_keys(v)
    elif isinstance(value, list):
        for item in value:
            yield from _all_keys(item)


class SerializationDeterminismMutationTests(unittest.TestCase):
    def test_result_is_json_serializable(self):
        artifacts = [pdf_artifact(textForEmbedding=LONG_TEXT)]
        result = build_formative_profile_result(artifacts)
        round_tripped = json.loads(json.dumps(result))
        self.assertEqual(result, round_tripped)

    def test_same_input_produces_identical_output(self):
        artifacts = [pdf_artifact(textForEmbedding=LONG_TEXT), online_artifact(textForEmbedding=LONG_TEXT)]
        result_1 = build_formative_profile_result(copy.deepcopy(artifacts))
        result_2 = build_formative_profile_result(copy.deepcopy(artifacts))
        self.assertEqual(result_1, result_2)

    def test_does_not_mutate_input_artifacts(self):
        artifacts = [pdf_artifact(textForEmbedding=LONG_TEXT), online_artifact(textForEmbedding=LONG_TEXT)]
        snapshot = copy.deepcopy(artifacts)
        build_formative_profile_result(artifacts)
        self.assertEqual(artifacts, snapshot)


class NoUiDecisionsTests(unittest.TestCase):
    def test_does_not_contain_cards_or_ui_hints_or_render_keys(self):
        artifacts = [pdf_artifact(textForEmbedding=LONG_TEXT), online_artifact(textForEmbedding=LONG_TEXT)]
        result = build_formative_profile_result(artifacts)
        all_keys = set(_all_keys(result))
        found_ui_keys = UI_ONLY_KEYS.intersection(all_keys)
        self.assertEqual(found_ui_keys, set(), f"claves de UI encontradas en el resultado semántico: {found_ui_keys}")


class ShapeContentTests(unittest.TestCase):
    def test_contains_all_required_top_level_sections(self):
        artifacts = [pdf_artifact(textForEmbedding=LONG_TEXT)]
        result = build_formative_profile_result(artifacts)
        for key in (
            "profileVersion",
            "generatedFrom",
            "summary",
            "confidence",
            "areas",
            "skills",
            "concepts",
            "strengths",
            "possibleDirections",
            "limitations",
            "warnings",
            "evidence",
            "audit",
        ):
            self.assertIn(key, result)
        self.assertEqual(result["profileVersion"], PROFILE_VERSION)
        self.assertEqual(set(result["summary"].keys()), {"text", "language", "style"})
        self.assertEqual(
            set(result["confidence"].keys()),
            {"band", "score", "scoreMethod", "explanation", "drivers", "limitations"},
        )
        self.assertEqual(set(result["evidence"].keys()), {"sourceCoverage", "evidenceOverview", "sourceRefs"})
        self.assertEqual(
            set(result["audit"].keys()),
            {"qualityFlags", "partialReasons", "rawWarningCodes", "rawPartialReasonCodes"},
        )


class OnlineCompletionWarningTests(unittest.TestCase):
    def test_online_no_completion_evidence_is_semantic_limitation_and_warning(self):
        artifact = online_artifact(
            textForEmbedding=LONG_TEXT,
            evidenceMap={
                "areas": {"area_software": ["title:python"]},
                "skills": {"skill_python": ["skill:python"]},
                "concepts": {},
            },
        )
        result = build_formative_profile_result([artifact])

        joined_limitations = " ".join(result["limitations"])
        self.assertIn("no constituye por sí sola una prueba de que el perfil haya completado", joined_limitations)

        # warnings a nivel top es texto SEMANTICO, no el codigo crudo
        self.assertTrue(any("finalización" in w for w in result["warnings"]))
        self.assertNotIn("no_holder_completion_evidence_in_source_dataset", result["warnings"])

        # el codigo crudo SI debe estar preservado, pero en audit
        self.assertIn("no_holder_completion_evidence_in_source_dataset", result["audit"]["rawWarningCodes"])


class ForbiddenLanguageTests(unittest.TestCase):
    def test_no_forbidden_words_anywhere_in_result(self):
        artifacts = [
            pdf_artifact(textForEmbedding=LONG_TEXT),
            online_artifact(textForEmbedding=LONG_TEXT),
        ]
        result = build_formative_profile_result(artifacts)
        all_text = " ".join(_all_strings(result)).lower()
        for word in FORBIDDEN_WORDS:
            self.assertNotIn(word, all_text, f"palabra prohibida encontrada: {word!r}")


class DomainCoverageTests(unittest.TestCase):
    def test_works_without_skills(self):
        artifact = pdf_artifact(skills=[], warnings=["no_skill_detected"], textForEmbedding=LONG_TEXT)
        result = build_formative_profile_result([artifact])  # no debe levantar
        self.assertEqual(result["skills"], [])
        self.assertTrue(any("skills explícitas" in lim for lim in result["limitations"]))

    def test_works_multi_domain(self):
        labels = ["PCR", "VHDL", "Six Sigma", "AutoCAD"]
        skills = [
            {"id": f"skill_{i}", "label": label, "confidence": 0.8, "confidenceMethod": "measured", "source": "explicit"}
            for i, label in enumerate(labels)
        ]
        evidence_skills = {f"skill_{i}": [f"matched_signal:{label.lower()}"] for i, label in enumerate(labels)}
        artifact = pdf_artifact(
            skills=skills,
            evidenceMap={"areas": {"area_software": ["matched_signal:software"]}, "skills": evidence_skills, "concepts": {}},
            textForEmbedding=LONG_TEXT,
        )
        result = build_formative_profile_result([artifact])
        skill_labels = {s["label"] for s in result["skills"]}
        self.assertEqual(skill_labels, set(labels))


class TraceabilityAndVersioningTests(unittest.TestCase):
    def test_preserves_source_refs(self):
        a1 = pdf_artifact(sourceRefs={"documentId": "doc1", "fileName": "a.pdf"}, textForEmbedding=LONG_TEXT)
        result = build_formative_profile_result([a1])
        self.assertEqual(result["evidence"]["sourceRefs"], result["evidence"]["sourceCoverage"]["sourceRefs"])
        doc_ids = {ref["documentId"] for ref in result["evidence"]["sourceRefs"]}
        self.assertIn("doc1", doc_ids)
        area = result["areas"][0]
        self.assertTrue(any(ref["documentId"] == "doc1" for ref in area["sourceRefs"]))

    def test_preserves_pipeline_and_taxonomy_versions(self):
        artifacts = [pdf_artifact(textForEmbedding=LONG_TEXT)]
        result = build_formative_profile_result(artifacts)
        self.assertEqual(result["generatedFrom"]["pipelineVersions"], ["unversioned_current"])
        self.assertEqual(result["generatedFrom"]["taxonomyVersions"], ["unversioned_current"])
        self.assertEqual(result["generatedFrom"]["artifactSchema"], "semantic_analysis_v1")
        self.assertEqual(result["generatedFrom"]["artifactCount"], 1)


class NoDiskIoAndNoProductiveImportTests(unittest.TestCase):
    def test_does_not_perform_any_file_io(self):
        with patch("builtins.open") as mock_open:
            build_formative_profile_result([pdf_artifact(textForEmbedding=LONG_TEXT)])
        mock_open.assert_not_called()

    def test_module_does_not_import_productive_profile_builder_or_course_adapter(self):
        source_path = Path("src/profile_builder/formative_profile_result.py")
        import_lines = [
            line.strip()
            for line in source_path.read_text(encoding="utf-8").splitlines()
            if line.strip().startswith(("import ", "from "))
        ]
        for line in import_lines:
            self.assertNotIn("profile_builder.profile_builder", line)
            self.assertNotIn("course_adapter", line)


if __name__ == "__main__":
    unittest.main()

"""
Tests de Fase 5A (experimental): `src.profile_builder.artifact_loader`.

Los tests de directorio usan `tempfile.TemporaryDirectory` con artifacts
sinteticos escritos ahi mismo -- nunca `output/backend_artifacts/` ni
ningun corpus real.
"""
import json
import tempfile
import unittest
from pathlib import Path

from src.profile_builder.artifact_loader import (
    InvalidArtifactError,
    load_artifacts_from_directory,
    load_artifacts_from_objects,
    validate_artifact_shape,
)
from tests.profile_builder._fixtures import online_artifact, pdf_artifact


class ValidateArtifactShapeTests(unittest.TestCase):
    def test_valid_pdf_artifact_passes(self):
        validate_artifact_shape(pdf_artifact())  # no debe levantar

    def test_valid_online_artifact_passes(self):
        validate_artifact_shape(online_artifact())  # no debe levantar

    def test_non_dict_input_rejected(self):
        with self.assertRaises(InvalidArtifactError):
            validate_artifact_shape(["not", "a", "dict"])

    def test_missing_required_field_rejected(self):
        artifact = pdf_artifact()
        del artifact["hoursDistribution"]
        with self.assertRaises(InvalidArtifactError):
            validate_artifact_shape(artifact)


class LoadArtifactsFromObjectsTests(unittest.TestCase):
    def test_returns_same_objects_when_all_valid(self):
        artifacts = [pdf_artifact(), online_artifact()]
        result = load_artifacts_from_objects(artifacts)
        self.assertEqual(result, artifacts)

    def test_raises_on_first_invalid(self):
        artifacts = [pdf_artifact(), {"schemaVersion": "semantic_analysis_v1"}]
        with self.assertRaises(InvalidArtifactError):
            load_artifacts_from_objects(artifacts)


class LoadArtifactsFromDirectoryTests(unittest.TestCase):
    def test_loads_all_valid_json_files_in_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "a.semantic_analysis_v1.json").write_text(
                json.dumps(pdf_artifact()), encoding="utf-8"
            )
            (tmp_path / "b.semantic_analysis_v1.json").write_text(
                json.dumps(online_artifact()), encoding="utf-8"
            )

            result = load_artifacts_from_directory(tmp_path)

            self.assertEqual(len(result), 2)
            source_types = {a["sourceType"] for a in result}
            self.assertEqual(source_types, {"academic_pdf", "online_course_catalog"})

    def test_empty_directory_returns_empty_list(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = load_artifacts_from_directory(Path(tmp))
            self.assertEqual(result, [])

    def test_invalid_file_in_directory_raises_with_path_in_message(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            bad = pdf_artifact()
            del bad["schemaVersion"]
            bad_path = tmp_path / "bad.semantic_analysis_v1.json"
            bad_path.write_text(json.dumps(bad), encoding="utf-8")

            with self.assertRaises(InvalidArtifactError) as ctx:
                load_artifacts_from_directory(tmp_path)
            self.assertIn(str(bad_path), str(ctx.exception))

    def test_does_not_write_anything_to_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "a.semantic_analysis_v1.json").write_text(
                json.dumps(pdf_artifact()), encoding="utf-8"
            )
            before = sorted(p.name for p in tmp_path.iterdir())

            load_artifacts_from_directory(tmp_path)

            after = sorted(p.name for p in tmp_path.iterdir())
            self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()

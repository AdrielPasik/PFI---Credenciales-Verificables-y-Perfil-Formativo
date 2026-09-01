"""Identidad de extraccion y fingerprint de dependencias.

La propiedad que estos tests protegen es la ATRIBUIBILIDAD: `requirements.txt`
fija pdfplumber y pypdf por rango y no menciona pdfminer.six, que es el
componente que realmente determina el texto extraido. Un `pip install -U`
rutinario puede entonces cambiar el texto sin cambio de codigo. El fingerprint
no impide esa deriva; la vuelve visible.
"""

from __future__ import annotations

import pytest

from src.source_extraction import identity
from src.source_extraction.canonical import fingerprint
from src.source_extraction.errors import DependencyFingerprintUnavailable


def test_versions_are_frozen_not_placeholders() -> None:
    assert identity.SCHEMA_VERSION == "source_extraction_v1"
    assert identity.IMPLEMENTATION_VERSION == "source_extractor_v1.0.0"
    # `unversioned_current` es deuda del viejo contrato semantic_analysis_v1
    # (decision D2). F0 arranca limpio en vez de heredarla.
    assert "unversioned_current" not in identity.IMPLEMENTATION_VERSION


def test_fingerprinted_dependency_set_is_the_whole_parsing_stack() -> None:
    assert set(identity.FINGERPRINTED_DEPENDENCIES) == {
        "pdfminer.six",
        "pdfplumber",
        "pypdf",
        "pypdfium2",
    }


def test_resolved_versions_are_exact_not_ranges() -> None:
    versions = identity.resolved_dependency_versions()
    assert set(versions) == set(identity.FINGERPRINTED_DEPENDENCIES)
    for package, version in versions.items():
        assert version, package
        assert not any(token in version for token in (">", "<", "=", ",", "*")), package


def test_dependency_fingerprint_is_deterministic() -> None:
    assert identity.dependency_fingerprint() == identity.dependency_fingerprint()


def test_dependency_fingerprint_preimage_is_the_frozen_canonicalization() -> None:
    """El preimage reutiliza `MINIMAL_DETERMINISTIC_JSON_V1`, no un segundo formato."""
    assert identity.dependency_fingerprint() == fingerprint(identity.resolved_dependency_versions())


def test_dependency_version_variation_changes_the_fingerprint(monkeypatch: pytest.MonkeyPatch) -> None:
    """Deriva de dependencias -> identidad distinta, nunca un match silencioso."""
    baseline = identity.dependency_fingerprint()
    real = identity.metadata.version

    def drifted(package: str) -> str:
        if package == "pdfminer.six":
            return "20991231"
        return real(package)

    monkeypatch.setattr(identity.metadata, "version", drifted)
    assert identity.dependency_fingerprint() != baseline


def test_missing_dependency_aborts_instead_of_inventing_a_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Ni UNKNOWN, ni null, ni un hash ficticio, ni omitir la dependencia."""
    real = identity.metadata.version

    def absent(package: str) -> str:
        if package == "pypdfium2":
            raise identity.metadata.PackageNotFoundError(package)
        return real(package)

    monkeypatch.setattr(identity.metadata, "version", absent)
    with pytest.raises(DependencyFingerprintUnavailable) as error:
        identity.dependency_fingerprint()
    assert error.value.package == "pypdfium2"


def test_pdf_identity_carries_all_four_fields() -> None:
    built = identity.pdf_extraction_identity(identity.PARSER_PDFPLUMBER)
    assert set(built) == {
        "schemaVersion",
        "implementationVersion",
        "parserProfile",
        "dependencyFingerprint",
    }
    assert built["parserProfile"] == "PDFPLUMBER"


def test_parser_profile_distinguishes_two_identities_of_one_source() -> None:
    """A y B son representaciones alternativas de UNA fuente (Q3).

    Si el fallback fuera una nota al pie y no parte de la identidad, dos
    extracciones podrian diferir materialmente declarando la misma version.
    """
    primary = identity.pdf_extraction_identity(identity.PARSER_PDFPLUMBER)
    fallback = identity.pdf_extraction_identity(identity.PARSER_PYPDF)
    assert primary != fallback
    assert primary["dependencyFingerprint"] == fallback["dependencyFingerprint"]


def test_text_direct_profile_is_not_accepted_by_the_pdf_identity_builder() -> None:
    """`TEXT_DIRECT` pertenece a F0.3 y prohibe `dependencyFingerprint`."""
    with pytest.raises(ValueError):
        identity.pdf_extraction_identity("TEXT_DIRECT")

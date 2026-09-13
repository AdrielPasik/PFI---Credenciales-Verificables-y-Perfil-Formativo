"""Marco de direccionamiento de los segmentos de PDF — P2.4 / F3.4.

EL PUNTO CIEGO QUE ESTO CIERRA. Todo el corpus previo de Evidence Units armaba
sus fixtures con `text.index(block)` sobre el documento concatenado y
`segmentId` con prefijo `d:` —la convencion de TEXT—. Ningun test uso jamas un
artifact de PDF con segmentos `p{N}:` relativos a su pagina, y por eso el
defecto llego a produccion: el primer PDF multipagina real devolvio 422.

Aca los artifacts NO se inventan: los produce el extractor REAL sobre los
fixtures congelados de F0. Si el productor cambia su convencion, estos tests se
enteran.
"""

from __future__ import annotations

import hashlib
import pathlib

import pytest

from src.api.evidence_units.contracts import GroundingInputError
from src.api.evidence_units.service import (
    assert_grounding_set_usable,
    resolve_segment_page_index,
    to_document_absolute_sources,
)
from src.source_extraction import extract_pdf_source, extract_text_source

SOURCES = (
    pathlib.Path(__file__).resolve().parents[1]
    / "contracts"
    / "fixtures"
    / "source_extraction_v1"
    / "sources"
)


def pdf_artifact(name: str) -> dict:
    data = (SOURCES / name).read_bytes()
    return extract_pdf_source(
        pdf_bytes=data,
        document_evidence_id="de-1",
        source_sha256=hashlib.sha256(data).hexdigest(),
        storage_key="k/1.pdf",
    )


def text_artifact(content: str) -> dict:
    return extract_text_source(
        content=content,
        text_evidence_id="te-1",
        source_sha256=hashlib.sha256(content.encode("utf-8")).hexdigest(),
    )


def transport(artifact: dict, source_id: str = "src_01") -> dict:
    """La MISMA proyeccion que hace `toTransportSource()` en NestJS."""
    return {
        "sourceId": source_id,
        "sourceSha256": artifact["source"]["sourceSha256"],
        "coverageStatus": artifact["coverageStatus"],
        "canonicalText": artifact["documentCanonicalText"],
        "segments": [
            {
                "segmentId": segment["segmentId"],
                "pageIndex": segment["pageIndex"],
                "charStart": segment["charStart"],
                "charEnd": segment["charEnd"],
                "exactExcerpt": segment["exactExcerpt"],
            }
            for segment in artifact["segments"]
        ],
        "pages": [
            {
                "pageNumber": page["pageNumber"],
                "pageOffsetStart": page["pageOffsetStart"],
                "pageOffsetEnd": page["pageOffsetEnd"],
            }
            for page in artifact["pages"]
        ],
        "diagnostics": [entry["code"] for entry in artifact["diagnostics"]],
    }


# ---------------------------------------------------------------------------
# El caso que rompio el primer run remoto
# ---------------------------------------------------------------------------


def test_multipage_pdf_has_a_segment_past_the_first_page() -> None:
    """Premisa del test de abajo. Sin esto, pasaria por vacio."""
    artifact = pdf_artifact("normal-multipage.pdf")
    pages = {segment["pageIndex"] for segment in artifact["segments"]}
    assert max(pages) > 0, "el fixture dejo de ejercitar paginas > 0"
    # Y su direccion es RELATIVA: arranca en 0 aunque no este al principio.
    beyond = next(s for s in artifact["segments"] if s["pageIndex"] > 0)
    assert beyond["charStart"] == 0
    assert beyond["segmentId"].startswith("p1:")


def test_multipage_pdf_grounding_is_accepted() -> None:
    # Antes de P2.4: grounding_segment_excerpt_mismatch, y 422 al llamante.
    assert_grounding_set_usable([transport(pdf_artifact("normal-multipage.pdf"))])


@pytest.mark.parametrize(
    "name",
    [
        "astral-unicode.pdf",
        "blank-page.pdf",
        "fully-scanned.pdf",
        "non-breaking-space.pdf",
        "scanned-image-only-page.pdf",
        "normal-multipage.pdf",
    ],
)
def test_every_frozen_pdf_fixture_is_accepted(name: str) -> None:
    assert_grounding_set_usable([transport(pdf_artifact(name))])


# ---------------------------------------------------------------------------
# La traduccion al marco del documento
# ---------------------------------------------------------------------------


def test_absolute_segments_slice_the_document_canonical() -> None:
    source = transport(pdf_artifact("normal-multipage.pdf"))
    canonical = source["canonicalText"]

    for segment in to_document_absolute_sources([source])[0]["segments"]:
        assert canonical[segment["charStart"] : segment["charEnd"]] == (
            segment["exactExcerpt"]
        )


def test_segment_id_survives_the_translation() -> None:
    # La identidad sigue siendo la direccion RELATIVA al contenedor: es lo que el
    # proveedor cita, y reescribirla la desalinearia del artifact persistido.
    source = transport(pdf_artifact("normal-multipage.pdf"))
    before = [segment["segmentId"] for segment in source["segments"]]
    after = [
        segment["segmentId"]
        for segment in to_document_absolute_sources([source])[0]["segments"]
    ]
    assert after == before
    assert any(identifier.startswith("p1:") for identifier in after)


def test_text_sources_are_untouched() -> None:
    # Tres de las cuatro fuentes del run remoto eran TextEvidence y NO eran la
    # causa. Su direccionamiento es del documento y no puede moverse.
    artifact = text_artifact("Contenido declarado. Segunda oracion del texto.")
    source = transport(artifact)
    assert_grounding_set_usable([source])

    assert [segment["pageIndex"] for segment in source["segments"]] == [None]
    assert to_document_absolute_sources([source])[0]["segments"] == [
        {
            "segmentId": segment["segmentId"],
            "charStart": segment["charStart"],
            "charEnd": segment["charEnd"],
            "exactExcerpt": segment["exactExcerpt"],
        }
        for segment in source["segments"]
    ]


# ---------------------------------------------------------------------------
# Puente de compatibilidad: una API vieja no manda `pageIndex`
# ---------------------------------------------------------------------------


def test_page_index_is_derived_from_the_authoritative_segment_id() -> None:
    assert resolve_segment_page_index({"segmentId": "d:0-19"}) is None
    assert resolve_segment_page_index({"segmentId": "p0:0-19"}) == 0
    assert resolve_segment_page_index({"segmentId": "p7:3-9"}) == 7
    # Un `pageIndex` explicito manda sobre la derivacion.
    assert resolve_segment_page_index({"segmentId": "p7:3-9", "pageIndex": 2}) == 2


def test_a_request_without_page_index_still_grounds() -> None:
    source = transport(pdf_artifact("normal-multipage.pdf"))
    legacy = {
        **source,
        "segments": [
            {key: value for key, value in segment.items() if key != "pageIndex"}
            for segment in source["segments"]
        ],
    }
    assert_grounding_set_usable([legacy])


def test_an_unparseable_segment_id_without_page_index_is_rejected() -> None:
    # NUNCA se asume la pagina 0: eso es exactamente el defecto que se cierra.
    source = transport(pdf_artifact("normal-multipage.pdf"))
    broken = {
        **source,
        "segments": [{**source["segments"][0], "segmentId": "loquesea", "pageIndex": None}],
    }
    with pytest.raises(GroundingInputError) as error:
        assert_grounding_set_usable([broken])
    assert "grounding_segment_page_unresolvable" in str(error.value)


# ---------------------------------------------------------------------------
# Fail-closed: direccionamiento invalido
# ---------------------------------------------------------------------------


def multipage_with(**segment_overrides) -> dict:
    source = transport(pdf_artifact("normal-multipage.pdf"))
    beyond = next(s for s in source["segments"] if s["pageIndex"] == 1)
    return {**source, "segments": [{**beyond, **segment_overrides}]}


@pytest.mark.parametrize(
    "overrides,expected",
    [
        # La pagina equivocada: el excerpt existe, pero no ahi.
        ({"pageIndex": 0}, "grounding_segment_excerpt_mismatch"),
        ({"pageIndex": 99}, "grounding_segment_page_out_of_range"),
        ({"charStart": 1}, "grounding_segment_excerpt_mismatch"),
        ({"charEnd": 4}, "grounding_segment_excerpt_mismatch"),
        ({"exactExcerpt": "otra cosa"}, "grounding_segment_excerpt_mismatch"),
        ({"charStart": 10_000, "charEnd": 10_001}, "grounding_segment_out_of_range"),
    ],
)
def test_invalid_addressing_fails_closed(overrides: dict, expected: str) -> None:
    with pytest.raises(GroundingInputError) as error:
        assert_grounding_set_usable([multipage_with(**overrides)])
    assert expected in str(error.value)


def test_a_correct_excerpt_on_the_wrong_page_is_still_rejected() -> None:
    """El caso mas engañoso: la cita es real, la pagina no.

    Aceptarlo produciria un `sourceTrace` que apunta a otro lugar del documento
    —una coordenada verificable y falsa, que es peor que un rechazo—.
    """
    source = transport(pdf_artifact("normal-multipage.pdf"))
    page_zero = next(s for s in source["segments"] if s["pageIndex"] == 0)
    moved = {**source, "segments": [{**page_zero, "pageIndex": 1, "segmentId": "p1:0-89"}]}

    with pytest.raises(GroundingInputError):
        assert_grounding_set_usable([moved])

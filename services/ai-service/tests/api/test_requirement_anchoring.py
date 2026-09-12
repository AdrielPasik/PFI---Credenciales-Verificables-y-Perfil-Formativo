"""Anclaje determinista de la base al Requirement — P2.4.

Lo que estos tests defienden no es "el modelo cita bien": es que la cita ya NO
la escribe el modelo. Si alguno de estos falla, la literalidad volvio a depender
de la obediencia del proveedor.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from src.api.contextual_reasoning.contracts import ProviderInvalidOutputError
from src.api.contextual_reasoning.requirement_anchoring import (
    derive_basis_phrase,
    derive_basis_phrases,
    indexed_requirement_view,
    tokenize_requirement,
)

FAILED_REQUIREMENT = (
    "Contar con al menos 3 años de experiencia profesional en un rol equivalente."
)


def phrase(text: str, start: int, end: int) -> str:
    return derive_basis_phrase(
        text,
        tokenize_requirement(text),
        {"startTokenIndex": start, "endTokenIndexExclusive": end},
    )


def find_range(text: str, wanted: str) -> tuple[int, int]:
    """El rango de tokens cuyo recorte es exactamente `wanted`."""
    tokens = tokenize_requirement(text)
    starts = {token.char_start: token.index for token in tokens}
    ends = {token.char_end: token.index for token in tokens}
    position = -1
    while True:
        position = text.find(wanted, position + 1)
        if position < 0:
            raise AssertionError(f"no representable: {wanted!r} en {text!r}")
        stop = position + len(wanted)
        if position in starts and stop in ends:
            return starts[position], ends[stop] + 1


# ---------------------------------------------------------------------------
# EL CASO QUE HIZO FALLAR DOS SMOKES REALES
# ---------------------------------------------------------------------------


def test_el_caso_exacto_que_fallo_produce_las_tres_bases():
    tokens = tokenize_requirement(FAILED_REQUIREMENT)
    assert [token.text for token in tokens][:6] == [
        "Contar", "con", "al", "menos", "3", "años",
    ]

    assert phrase(FAILED_REQUIREMENT, 4, 6) == "3 años"
    assert phrase(FAILED_REQUIREMENT, 7, 9) == "experiencia profesional"
    assert phrase(FAILED_REQUIREMENT, 11, 13) == "rol equivalente"


def test_ninguna_posicion_puede_producir_tres_anos_en_palabra():
    """La intencion semantica del modelo era "tres años". Ya no puede escribirla.

    Sea cual sea el rango que elija, el recorte sale del texto congelado, y ese
    texto dice "3". Este test recorre TODOS los rangos posibles.
    """
    tokens = tokenize_requirement(FAILED_REQUIREMENT)
    for start in range(len(tokens)):
        for end in range(start + 1, len(tokens) + 1):
            derived = phrase(FAILED_REQUIREMENT, start, end)
            assert "tres" not in derived
            assert derived in FAILED_REQUIREMENT


def test_toda_base_derivada_es_subcadena_por_construccion():
    tokens = tokenize_requirement(FAILED_REQUIREMENT)
    for start in range(len(tokens)):
        for end in range(start + 1, len(tokens) + 1):
            assert phrase(FAILED_REQUIREMENT, start, end) in FAILED_REQUIREMENT


# ---------------------------------------------------------------------------
# Requirement mixto
# ---------------------------------------------------------------------------


def test_requirement_mixto_representa_las_dos_componentes():
    text = "3 años de experiencia desarrollando APIs REST"
    duration = find_range(text, "3 años")
    capability = find_range(text, "APIs REST")

    assert phrase(text, *duration) == "3 años"
    assert phrase(text, *capability) == "APIs REST"
    # Son rangos DISJUNTOS: el Requirement no se colapsa a una sola base.
    assert duration[1] <= capability[0]


def test_caso_formativo_conserva_el_anclaje_de_case_01():
    text = "Diseño e implementación de APIs REST"
    assert phrase(text, *find_range(text, "Diseño")) == "Diseño"
    assert phrase(text, *find_range(text, "implementación")) == "implementación"
    assert phrase(text, *find_range(text, "APIs REST")) == "APIs REST"


# ---------------------------------------------------------------------------
# Texto duplicado — la razon principal para anclar por posicion
# ---------------------------------------------------------------------------


def test_ocurrencias_repetidas_se_distinguen_por_posicion():
    text = "Experiencia en APIs y experiencia en bases de datos"
    tokens = tokenize_requirement(text)
    primera = [t.index for t in tokens if t.text == "Experiencia"][0]
    segunda = [t.index for t in tokens if t.text == "experiencia"][0]
    assert primera != segunda

    # La misma palabra en dos lugares: el rango dice CUAL, cosa que una busqueda
    # por texto no puede decidir.
    assert phrase(text, primera, primera + 3) == "Experiencia en APIs"
    assert phrase(text, segunda, segunda + 3) == "experiencia en bases"


# ---------------------------------------------------------------------------
# Espaciado y puntuacion
# ---------------------------------------------------------------------------


def test_el_espaciado_interior_se_conserva_exacto():
    # Un `" ".join(tokens)` romperia esto: el recorte es sobre el original.
    text = "Experiencia   con    APIs\nREST"
    start, end = find_range(text, "Experiencia   con    APIs\nREST")
    assert phrase(text, start, end) == "Experiencia   con    APIs\nREST"


def test_la_puntuacion_se_puede_incluir_o_excluir():
    text = "Nivel avanzado (C1) de inglés."
    assert phrase(text, *find_range(text, "Nivel avanzado")) == "Nivel avanzado"
    assert phrase(text, *find_range(text, "(C1)")) == "(C1)"
    assert phrase(text, *find_range(text, "inglés.")) == "inglés."


def test_termino_con_guion_o_barra():
    text = "Experiencia en e-mail y CI/CD"
    assert phrase(text, *find_range(text, "e-mail")) == "e-mail"
    assert phrase(text, *find_range(text, "CI/CD")) == "CI/CD"


# ---------------------------------------------------------------------------
# Unicode
# ---------------------------------------------------------------------------


def test_acentos_y_caracteres_astrales():
    text = "Diseño 🚀 de APIs REST en producción"
    # El emoji es su propio token y no rompe las coordenadas de lo que sigue.
    assert phrase(text, *find_range(text, "Diseño")) == "Diseño"
    assert phrase(text, *find_range(text, "APIs REST")) == "APIs REST"
    assert phrase(text, *find_range(text, "producción")) == "producción"
    assert phrase(text, *find_range(text, "🚀")) == "🚀"


def test_astral_antes_de_la_base_no_desplaza_el_recorte():
    text = "🚀 experiencia profesional"
    assert phrase(text, *find_range(text, "experiencia profesional")) == (
        "experiencia profesional"
    )


def test_los_offsets_son_code_points_no_utf16():
    text = "🚀 APIs"
    tokens = tokenize_requirement(text)
    # En UTF-16 el emoji ocuparia 2 unidades; en code points ocupa 1.
    assert tokens[0].char_start == 0
    assert tokens[0].char_end == 1
    assert tokens[1].char_start == 2
    assert text[tokens[1].char_start : tokens[1].char_end] == "APIs"


# ---------------------------------------------------------------------------
# Rangos invalidos — sin clamp, sin reparacion
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad,expected",
    [
        ({"startTokenIndex": -1, "endTokenIndexExclusive": 2},
         "contextual_facet_basis_range_out_of_bounds"),
        ({"startTokenIndex": 2, "endTokenIndexExclusive": 2},
         "contextual_facet_basis_range_out_of_bounds"),
        ({"startTokenIndex": 5, "endTokenIndexExclusive": 3},
         "contextual_facet_basis_range_out_of_bounds"),
        ({"startTokenIndex": 0, "endTokenIndexExclusive": 999},
         "contextual_facet_basis_range_out_of_bounds"),
        ({"startTokenIndex": "0", "endTokenIndexExclusive": 2},
         "contextual_facet_basis_range_malformed"),
        ({"startTokenIndex": 0.5, "endTokenIndexExclusive": 2},
         "contextual_facet_basis_range_malformed"),
        ({"startTokenIndex": True, "endTokenIndexExclusive": 2},
         "contextual_facet_basis_range_malformed"),
        ({"startTokenIndex": 0},
         "contextual_facet_basis_range_malformed"),
        ({"startTokenIndex": 0, "endTokenIndexExclusive": 2, "extra": 1},
         "contextual_facet_basis_range_malformed"),
        ("0-2", "contextual_facet_basis_range_malformed"),
        (None, "contextual_facet_basis_range_malformed"),
    ],
)
def test_rangos_invalidos_fallan_con_su_subcodigo(bad, expected):
    tokens = tokenize_requirement(FAILED_REQUIREMENT)
    with pytest.raises(ProviderInvalidOutputError) as error:
        derive_basis_phrase(FAILED_REQUIREMENT, tokens, bad)
    assert str(error.value) == expected


def test_lista_de_rangos_vacia_en_una_facet_es_invalida():
    tokens = tokenize_requirement(FAILED_REQUIREMENT)
    with pytest.raises(ProviderInvalidOutputError) as error:
        derive_basis_phrases(FAILED_REQUIREMENT, tokens, [])
    assert str(error.value) == "contextual_facet_basis_empty"


def test_la_continuidad_si_admite_base_vacia():
    # El contrato anterior lo permitia y esta slice no endurece de paso.
    tokens = tokenize_requirement(FAILED_REQUIREMENT)
    assert derive_basis_phrases(FAILED_REQUIREMENT, tokens, [], allow_empty=True) == []


def test_rangos_no_lista():
    tokens = tokenize_requirement(FAILED_REQUIREMENT)
    with pytest.raises(ProviderInvalidOutputError) as error:
        derive_basis_phrases(FAILED_REQUIREMENT, tokens, "0-2")
    assert str(error.value) == "contextual_facet_basis_range_malformed"


# ---------------------------------------------------------------------------
# Vista indexada
# ---------------------------------------------------------------------------


def test_la_vista_del_modelo_no_lleva_coordenadas():
    view = indexed_requirement_view(tokenize_requirement(FAILED_REQUIREMENT))
    assert view[4] == {"index": 4, "text": "3"}
    # Solo indice y texto: al modelo no se le pide aritmetica sobre Unicode.
    assert all(set(entry) == {"index", "text"} for entry in view)


# ---------------------------------------------------------------------------
# Regresion contra el corpus congelado
# ---------------------------------------------------------------------------

CORPUS = (
    pathlib.Path(__file__).resolve().parents[4]
    / "mejoras post 50%"
    / "b241-full-dev-reexecution"
    / "runs"
)


@pytest.mark.skipif(not CORPUS.is_dir(), reason="corpus congelado no disponible")
def test_las_122_bases_historicas_siguen_siendo_representables():
    """Si una base aceptada historicamente no se puede anclar, el diseño falla.

    No se comprueba que el modelo elegiria ese rango — se comprueba que el
    mecanismo PUEDE expresar todo lo que el sistema ya acepto como valido.
    """
    total = reproducible = 0
    for path in sorted(CORPUS.glob("*.json")):
        run = json.loads(path.read_text(encoding="utf-8"))
        requirements = (
            (run.get("03_objective_analysis") or {})
            .get("proposal", {})
            .get("requirements")
            or []
        )
        contextual = run.get("05_unified_contextual_reasoning")
        if not requirements or not isinstance(contextual, list):
            continue
        text = requirements[0]["requirementQuote"]
        for item in contextual:
            for facet in item.get("facets") or []:
                for historical in facet.get("requirementBasisPhrases") or []:
                    total += 1
                    start, end = find_range(text, historical)
                    assert phrase(text, start, end) == historical
                    reproducible += 1

    assert total == 122, f"el corpus cambio: {total} frases"
    assert reproducible == total

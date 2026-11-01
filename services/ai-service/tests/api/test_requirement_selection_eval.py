"""Set de referencia del P0 de seleccion: integridad del gold, metrica y pipeline.

    REAL_PROVIDER_CALLS = 0

Prueba tres cosas, y ninguna es "el modelo elige bien":

  - que el gold sea utilizable (citas literales y unicas, etiquetas validas, un
    aviso largo de 40-50 candidatos, al menos uno que obliga a seleccionar);
  - que la metrica distinga una propuesta buena de las fallas conocidas
    (actitudes infladas, duplicados, slice por orden);
  - que el pipeline PRODUCTIVO, con un proveedor stub que hace lo que la
    politica pide, cumpla todos los criterios de aceptacion.

La calidad real se mide con `run_real_eval.py`, que no corre sin autorizacion.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import pytest

EVAL_ROOT = Path(__file__).resolve().parents[2] / "experiments" / "requirement_selection_eval"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(f"rse_{name}", EVAL_ROOT / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


eval_lib = _load("eval_lib")
POSTINGS = eval_lib.load_postings()
IDS = [p.posting_id for p in POSTINGS]
MAXIMUM = 15

CATEGORIES = {
    "TECHNICAL_KNOWLEDGE", "EDUCATION_ACCREDITATION", "EXPERIENCE", "LANGUAGE_LEVEL",
    "PROFESSIONAL_CAPABILITY", "RESPONSIBILITY_ACTIVITY", "ATTITUDE_GENERIC", "CONTEXT",
    "NON_FORMATIVE_CONDITION",
}


# ---------------------------------------------------------------------------
# Integridad del gold
# ---------------------------------------------------------------------------


def test_hay_al_menos_cinco_avisos_y_uno_largo() -> None:
    assert len(POSTINGS) >= 5
    largos = [p for p in POSTINGS if 40 <= len(p.items) <= 50]
    assert largos, "falta el aviso largo de 40-50 candidatos"
    assert any(len(eval_lib.keep_groups(p)) > MAXIMUM for p in POSTINGS)


@pytest.mark.parametrize("posting", POSTINGS, ids=IDS)
def test_cada_cita_del_gold_es_literal_y_unica(posting) -> None:
    for item in posting.items:
        assert posting.text.count(item["quote"]) == 1, item["id"]


@pytest.mark.parametrize("posting", POSTINGS, ids=IDS)
def test_etiquetas_y_categorias_validas(posting) -> None:
    ids = [item["id"] for item in posting.items]
    assert len(ids) == len(set(ids))
    for item in posting.items:
        assert item["label"] in {"KEEP", "DISCARD", "BORDERLINE"}
        assert item["category"] in CATEGORIES
        if item["label"] == "KEEP":
            assert item["priority"] in {"MANDATORY", "REQUIRED", "DESIRABLE"}
            assert item["group"]
        if item["category"] in {"ATTITUDE_GENERIC", "CONTEXT", "NON_FORMATIVE_CONDITION"}:
            assert item["label"] != "KEEP", item["id"]
    assert "PENDIENTE de adjudicacion humana" in posting.gold["authorship"]


def test_la_seleccion_humana_existe_donde_hace_falta_y_no_es_una_jerarquia_rigida() -> None:
    for posting in POSTINGS:
        groups = eval_lib.keep_groups(posting)
        human = posting.gold.get("humanSelection")
        if len(groups) <= MAXIMUM:
            continue
        assert human is not None and len(human["groups"]) == MAXIMUM
        assert set(human["groups"]) <= groups
        priority = eval_lib._group_priority(posting)
        # Hay al menos un DESEABLE que entra y un REQUERIDO que queda afuera.
        assert any(priority[g] == "DESIRABLE" for g in human["groups"])
        assert any(priority[g] == "REQUIRED" for g in groups - set(human["groups"]))


def test_hay_condiciones_no_formativas_legitimas_en_el_set() -> None:
    """Disponibilidad, edad, documentacion: existen y tienen que quedar visibles."""
    conditions = [
        item for p in POSTINGS for item in p.items if item["category"] == "NON_FORMATIVE_CONDITION"
    ]
    assert len(conditions) >= 4


def test_una_condicion_no_formativa_emitida_no_es_falso_positivo_pero_se_cuenta() -> None:
    posting = next(p for p in POSTINGS if p.posting_id == "RSE_05")
    edad = "Edad máxima de 32 años al cierre de la convocatoria."
    result = eval_lib.score(posting, [{"text": edad, "quote": edad}], MAXIMUM, unresolved=[])
    assert result["falsePositives"] == 0
    assert result["nonFormativeAsRequirement"] == 1


def test_una_condicion_que_desaparece_no_pasa_la_aceptacion() -> None:
    posting = next(p for p in POSTINGS if p.posting_id == "RSE_04")
    result = eval_lib.score(posting, eval_lib.oracle_extraction(posting), MAXIMUM, unresolved=[])
    assert result["nonFormativeVisible"] == 0.0
    assert not eval_lib.acceptance(result, MAXIMUM)["nonFormativeConditionsVisible"]


def test_la_relevancia_no_depende_de_la_evidencia() -> None:
    """Python, SQL, ingles y titulo son requisitos aunque nadie sepa si se cumplen."""
    keep_quotes = " ".join(
        eval_lib.fold(item["quote"]) for p in POSTINGS for item in p.items if item["label"] == "KEEP"
    )
    for requisito in ("python", "sql", "ingles", "titulo"):
        assert requisito in keep_quotes


# ---------------------------------------------------------------------------
# La metrica distingue lo bueno de las fallas conocidas
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("posting", POSTINGS, ids=IDS)
def test_la_falla_observada_no_pasa_la_aceptacion(posting) -> None:
    result = eval_lib.score(posting, eval_lib.observed_failure_extraction(posting), MAXIMUM)
    assert result["falsePositives"] > 0
    assert result["precision"] < eval_lib.MIN_PRECISION
    assert not all(eval_lib.acceptance(result, MAXIMUM).values())


def test_el_slice_por_orden_pierde_excluyentes_en_el_aviso_largo() -> None:
    largo = next(p for p in POSTINGS if p.posting_id == "RSE_06")
    sliced = eval_lib.naive_slice(eval_lib.observed_failure_extraction(largo), MAXIMUM)
    result = eval_lib.score(largo, sliced, MAXIMUM)
    assert result["mandatoryCoverage"] < 1.0
    assert not eval_lib.acceptance(result, MAXIMUM)["mandatoryKeptWhenFits"]


def test_una_cita_inventada_y_una_inflacion_se_detectan() -> None:
    posting = POSTINGS[0]
    result = eval_lib.score(
        posting,
        [
            {"text": "Experiencia con Rust", "quote": "Experiencia con Rust."},
            {"text": "Capacidad de liderazgo de equipos", "quote": "Participar en reuniones diarias del equipo."},
        ],
        MAXIMUM,
    )
    assert result["unanchored"] == 1
    assert result["inflations"] == ["Capacidad de liderazgo de equipos"]


def test_una_cita_desde_el_encabezado_cuenta_solo_la_vineta_citada() -> None:
    """OU_A2 cita del encabezado a la vineta para conservar "Excluyente". Visto
    en la corrida real del 2026-11-01: no es duplicado ni fusion."""
    posting = next(p for p in POSTINGS if p.posting_id == "RSE_06")
    lines = [
        "**Requisitos excluyentes**",
        "- Título de grado en Ingeniería en Sistemas, Informática o carrera afín.",
        "- Al menos 5 años de experiencia en roles de infraestructura, SRE o plataforma.",
    ]
    quote = chr(10).join(lines)
    assert posting.text.count(quote) == 1
    result = eval_lib.score(posting, [{"text": "Excluyente: 5 años", "quote": quote}], MAXIMUM)
    assert result["coveredGroups"] == ["exp_infra"]
    assert result["duplicates"] == 0
    assert result["mergedIndependent"] == []


def test_fusionar_condiciones_independientes_se_detecta() -> None:
    posting = next(p for p in POSTINGS if p.posting_id == "RSE_01")
    line = "Título universitario en Sistemas, inglés avanzado y experiencia en Unix."
    result = eval_lib.score(posting, [{"text": line, "quote": line}], MAXIMUM)
    assert result["mergedIndependent"] == [line]


def test_la_permutacion_conserva_el_contenido() -> None:
    for posting in POSTINGS:
        permuted = eval_lib.permute_paragraphs(posting.text, seed=7)
        assert sorted(b.strip() for b in permuted.split("\n\n")) == sorted(
            b.strip() for b in posting.text.split("\n\n")
        )
        assert permuted != posting.text
        for item in posting.items:
            assert permuted.count(item["quote"]) == 1


# ---------------------------------------------------------------------------
# El pipeline productivo, con un stub que sigue la politica
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("posting", POSTINGS, ids=IDS)
def test_el_pipeline_productivo_cumple_la_aceptacion_con_un_stub_fiel(
    posting, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OBJECTIVE_UNDERSTANDING_OPENAI_MODEL", "stub")
    simulations = _load("run_simulations")
    result, calls = simulations.oracle_pipeline(posting, posting.text)

    assert all(eval_lib.acceptance(result, MAXIMUM).values()), result
    assert result["precision"] == 1.0
    assert result["nonFormativeVisible"] in (None, 1.0)
    assert result["nonFormativeAsRequirement"] == 0
    assert calls == (2 if len(eval_lib.keep_groups(posting)) > MAXIMUM else 1)
    if posting.gold.get("humanSelection"):
        assert result["humanSelectionAgreement"] == 1.0
    else:
        assert result["keepRecall"] == 1.0

    permuted, _ = simulations.oracle_pipeline(posting, eval_lib.permute_paragraphs(posting.text, 7))
    assert eval_lib.stability(result, permuted) == 1.0


def test_el_runner_real_no_corre_sin_todas_las_barreras(monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    runner = _load("run_real_eval")
    monkeypatch.delenv(runner.ENV_GATE, raising=False)
    priced = ["--max-cost-usd", "5", "--input-usd-per-mtok", "1", "--output-usd-per-mtok", "10"]

    assert runner.main([]) == 2
    assert runner.main(["--allow-billable-provider-calls", *priced]) == 2
    monkeypatch.setenv(runner.ENV_GATE, "1")
    assert runner.main(["--allow-billable-provider-calls", "--max-calls", "25", *priced]) == 2
    # Sin presupuesto de costo, o sin precios explicitos, tampoco.
    assert runner.main(["--allow-billable-provider-calls"]) == 2
    assert runner.main(["--allow-billable-provider-calls", "--max-cost-usd", "5"]) == 2
    assert runner.main(["--allow-billable-provider-calls", "--max-cost-usd", "11",
                        "--input-usd-per-mtok", "1", "--output-usd-per-mtok", "10"]) == 2
    assert "NO SE EJECUTA" in capsys.readouterr().out


def test_el_presupuesto_de_costo_corta_antes_de_la_llamada_que_lo_pasaria() -> None:
    runner = _load("run_real_eval")

    class Inner:
        calls = 0

        def complete(self, **_):
            Inner.calls += 1
            return object()

    # 1 USD por llamada (0 entrada, 100k salida a 10 USD/Mtok); tope 2,5 USD.
    budgeted = runner.BudgetedProvider(
        Inner(), budget=24, max_cost_usd=2.5, input_usd_per_mtok=0.0001,
        output_usd_per_mtok=10, assumed_max_output_tokens=100_000,
    )
    budgeted.complete(prompt="x", schema_name="objective_understanding_proposal_v1")
    budgeted.complete(prompt="x", schema_name="requirement_selection_v1")
    with pytest.raises(runner.BudgetExceeded):
        budgeted.complete(prompt="x")
    assert Inner.calls == 2
    assert [entry["stage"] for entry in budgeted.stage_log] == ["extraction", "selection"]


def test_el_presupuesto_corta_antes_de_la_llamada_de_mas() -> None:
    runner = _load("run_real_eval")

    class Inner:
        calls = 0

        def complete(self, **_):
            Inner.calls += 1
            return object()

    budgeted = runner.BudgetedProvider(Inner(), budget=2)
    budgeted.complete()
    budgeted.complete()
    with pytest.raises(runner.BudgetExceeded):
        budgeted.complete()
    assert Inner.calls == 2

"""Replay de conformidad investigacion -> producto — slice P2.2.

QUE HACE. Toma las observaciones estructuradas de `OU_A2` que P2.1 dejo grabadas,
las vuelve a pasar por el parser, el builder confiable y el constructor de
artefacto PRODUCTIVOS, y compara el resultado contra los artefactos confiables
experimentales.

QUE NO ES. No es una evaluacion semantica nueva y no llama al proveedor:

    REAL_PROVIDER_CALLS = 0

Lee ficheros de datos congelados. Eso NO es un import de runtime del arbol
experimental: el codigo productivo no importa nada de `experiments/` — este test
si lee sus JSON, que es exactamente lo que un replay de conformidad necesita.

QUE SE EXIGE IDENTICO:

    textos de Requirement propuestos      orden de candidatos
    clasificacion de cada cita            referencias primaria/auxiliares
    excerpts exactos                      offsets en code points Unicode
    comportamiento de duplicados exactos  pasajes no resueltos

DIFERENCIAS DE REPRESENTACION ADMITIDAS, y solo estas: el experimento guardaba
`primaryAnchor.status` junto a la cita; el producto separa el mismo hecho en
`primarySourceGrounding` + `primarySourceReference | null`. Es la misma
informacion con otra forma, y la proyeccion de abajo la hace explicita.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.api.objective_understanding.builder import build_proposal_artifact
from src.api.objective_understanding.validation import validate_provider_output

AI_SERVICE_ROOT = Path(__file__).resolve().parents[2]
EXPERIMENT_ROOT = AI_SERVICE_ROOT / "experiments" / "objective_understanding"
RUNS_ROOT = EXPERIMENT_ROOT / "runs"
POOL_ROOT = EXPERIMENT_ROOT / "corpus" / "raw_pool"

OU_A2_RUN_DIRECTORIES = (
    "OU_A2_development",
    "OU_A2_holdout",
    "OU_A2_crossDomain",
)

#: Fenomenos que el subconjunto de replay tiene que cubrir, con el Objective que
#: los aporta. Si alguno faltara, el replay estaria probando el camino facil.
REQUIRED_PHENOMENA = {
    "modalidad preferida gobernada por encabezado": "EMP_069",
    "negacion explicita / no excluyente": "EMP_066",
    "Requirement compuesto": "EMP_070",
    "misma cita repetida en varias secciones": "EMP_043",
    "disyuncion cross-domain preservada": "ADM_005",
}


def _raw_objective_text(objective_id: str) -> str:
    matches = list(POOL_ROOT.rglob(f"{objective_id}.md"))
    assert matches, f"no se encontro el Objective congelado {objective_id}"
    content = matches[0].read_text(encoding="utf-8")
    return content.split("## Texto original del Objective", 1)[1].strip()


def _load_runs() -> list[tuple[str, dict]]:
    runs: list[tuple[str, dict]] = []
    for directory in OU_A2_RUN_DIRECTORIES:
        path = RUNS_ROOT / directory
        if not path.is_dir():
            continue
        for run_file in sorted(path.glob("*.run.json")):
            runs.append((directory, json.loads(run_file.read_text(encoding="utf-8"))))
    return runs


def _project_experimental(candidate: dict) -> dict:
    """Proyecta el candidato experimental a la forma comparable."""
    anchor = candidate["primaryAnchor"]
    primary = None
    if anchor["status"] == "UNIQUE":
        primary = {
            "exactExcerpt": candidate["primarySourceQuote"],
            "charStart": anchor["charStart"],
            "charEnd": anchor["charEnd"],
        }
    auxiliary = [
        {
            "exactExcerpt": item["quote"],
            "charStart": item["charStart"],
            "charEnd": item["charEnd"],
        }
        for item in candidate["auxiliaryAnchors"]
        if item["status"] == "UNIQUE"
    ]
    ambiguous = [
        {"exactExcerpt": item["quote"], "occurrences": item["occurrences"]}
        for item in candidate["auxiliaryAnchors"]
        if item["status"] == "AMBIGUOUS"
    ]
    if anchor["status"] == "AMBIGUOUS":
        ambiguous.insert(
            0,
            {
                "exactExcerpt": candidate["primarySourceQuote"],
                "occurrences": anchor["occurrences"],
            },
        )
    unmatched = [
        item["quote"] for item in candidate["auxiliaryAnchors"] if item["status"] == "NOT_FOUND"
    ]
    if anchor["status"] == "NOT_FOUND" and candidate["primarySourceQuote"]:
        unmatched.insert(0, candidate["primarySourceQuote"])
    return {
        "candidateId": candidate["candidateId"],
        "order": candidate["order"],
        "proposedRequirementText": candidate["proposedRequirementText"],
        "primarySourceGrounding": anchor["status"],
        "primarySourceReference": primary,
        "auxiliarySourceReferences": auxiliary,
        "ambiguousReferences": ambiguous,
        "unmatchedReferences": unmatched,
        "sourceSectionLabel": candidate["sourceSectionLabel"],
        "exactDuplicateOfEarlier": candidate["exactDuplicateOfEarlier"],
        "confirmableAsSourceDerived": candidate["persistableAsDerived"],
    }


def _project_product(candidate: dict) -> dict:
    primary = candidate["primarySourceReference"]
    return {
        "candidateId": candidate["candidateId"],
        "order": candidate["order"],
        "proposedRequirementText": candidate["proposedRequirementText"],
        "primarySourceGrounding": candidate["primarySourceGrounding"],
        "primarySourceReference": (
            None
            if primary is None
            else {
                "exactExcerpt": primary["exactExcerpt"],
                "charStart": primary["charStart"],
                "charEnd": primary["charEnd"],
            }
        ),
        "auxiliarySourceReferences": [
            {
                "exactExcerpt": item["exactExcerpt"],
                "charStart": item["charStart"],
                "charEnd": item["charEnd"],
            }
            for item in candidate["auxiliarySourceReferences"]
        ],
        "ambiguousReferences": [
            {"exactExcerpt": item["exactExcerpt"], "occurrences": item["occurrences"]}
            for item in candidate["ambiguousReferences"]
        ],
        "unmatchedReferences": list(candidate["unmatchedReferences"]),
        "sourceSectionLabel": candidate["sourceSectionLabel"],
        "exactDuplicateOfEarlier": candidate["exactDuplicateOfEarlier"],
        "confirmableAsSourceDerived": candidate["confirmableAsSourceDerived"],
    }


RUNS = _load_runs()

pytestmark = pytest.mark.skipif(
    not RUNS,
    reason="artefactos congelados de P2.1 no disponibles en este arbol",
)


def test_replay_subset_covers_the_required_phenomena() -> None:
    """El replay tiene que tocar los fenomenos dificiles, no solo los faciles."""
    replayed = {run["objectiveId"] for _, run in RUNS}
    for phenomenon, objective_id in REQUIRED_PHENOMENA.items():
        assert objective_id in replayed, f"falta el fenomeno: {phenomenon}"


@pytest.mark.parametrize(
    "partition,run",
    RUNS,
    ids=[f"{directory}:{run['objectiveId']}" for directory, run in RUNS],
)
def test_productive_builder_matches_evaluated_candidate(partition: str, run: dict) -> None:
    """Conformidad determinista, sin ninguna llamada al proveedor."""
    assert run["candidateVersion"] == "OU_A2"
    raw = _raw_objective_text(run["objectiveId"])

    proposals, unresolved = validate_provider_output(run["providerOutput"])
    artifact = build_proposal_artifact(raw, proposals, unresolved)

    expected = [_project_experimental(c) for c in run["trusted"]["candidates"]]
    actual = [_project_product(c) for c in artifact["candidates"]]

    assert len(actual) == len(expected), "difiere la cantidad de candidatos"
    for index, (got, want) in enumerate(zip(actual, expected)):
        assert got == want, f"divergencia en el candidato {index + 1} de {run['objectiveId']}"

    # Los contadores confiables tambien tienen que coincidir.
    counts = run["trusted"]["counts"]
    grounding = artifact["grounding"]
    assert grounding["candidateCount"] == counts["candidates"]
    assert grounding["primaryUnique"] == counts["primaryUnique"]
    assert grounding["primaryAmbiguous"] == counts["primaryAmbiguous"]
    assert grounding["primaryNotFound"] == counts["primaryNotFound"]
    assert grounding["exactDuplicates"] == counts["exactDuplicates"]

    # Pasajes no resueltos: misma cantidad y mismos excerpts, en el mismo orden.
    experimental_unresolved = run["unresolvedPassages"]
    assert len(artifact["unresolvedPassages"]) == len(experimental_unresolved)
    for got, want in zip(artifact["unresolvedPassages"], experimental_unresolved):
        assert got["exactExcerpt"] == want["quote"]
        assert got["reason"] == want["reason"]


def test_productive_prompt_is_byte_identical_to_ou_a2() -> None:
    """El cuerpo de instrucciones productivo es el mismo texto que se evaluo."""
    import re

    from src.api.objective_understanding.prompt import (
        INSTRUCTIONS,
        build_objective_understanding_prompt,
    )

    experimental_file = RUNS_ROOT / "prompts_v3.py"
    if not experimental_file.exists():
        pytest.skip("prompt experimental no disponible en este arbol")

    source = experimental_file.read_text(encoding="utf-8")
    body = re.search(r'INSTRUCTIONS = """(.*?)"""', source, re.S).group(1)
    assert INSTRUCTIONS == body, "el prompt productivo diverge del candidato evaluado"

    namespace: dict[str, object] = {}
    exec(compile(source, str(experimental_file), "exec"), namespace)  # noqa: S102
    experimental_prompt = namespace["build_prompt"](
        "EMPLOYMENT", "Ingeniero de Datos", "Texto crudo del Objective."
    )
    productive_prompt = build_objective_understanding_prompt(
        objective_type="EMPLOYMENT",
        title="Ingeniero de Datos",
        raw_objective_text="Texto crudo del Objective.",
    )
    assert productive_prompt == experimental_prompt


def test_productive_provider_schema_matches_ou_a2() -> None:
    """Misma forma de salida estructurada y mismo nombre de schema."""
    import re

    from src.api.objective_understanding.schema import (
        OBJECTIVE_UNDERSTANDING_OUTPUT_SCHEMA,
        PROVIDER_SCHEMA_NAME,
    )

    experimental_file = RUNS_ROOT / "prompts_v3.py"
    if not experimental_file.exists():
        pytest.skip("schema experimental no disponible en este arbol")

    namespace: dict[str, object] = {}
    exec(  # noqa: S102
        compile(experimental_file.read_text(encoding="utf-8"), str(experimental_file), "exec"),
        namespace,
    )
    assert PROVIDER_SCHEMA_NAME == namespace["SCHEMA_NAME"]

    def normalise(node: object) -> object:
        """Compara forma y vocabulario, ignorando las `description` en prosa."""
        if isinstance(node, dict):
            return {
                key: normalise(value)
                for key, value in sorted(node.items())
                if key != "description"
            }
        if isinstance(node, list):
            return [normalise(item) for item in node]
        return node

    assert normalise(OBJECTIVE_UNDERSTANDING_OUTPUT_SCHEMA) == normalise(namespace["SCHEMA"])

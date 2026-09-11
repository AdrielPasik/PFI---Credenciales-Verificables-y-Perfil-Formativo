"""Guards estructurales de Objective Understanding — slice P2.2.

Estos tests no ejercitan comportamiento: fijan lo que el paquete NO puede hacer.
Son los invariantes que una refactorización distraída rompería en silencio.
"""

from __future__ import annotations

import ast
import hashlib
import re
from pathlib import Path

import pytest

AI_SERVICE_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_ROOT = AI_SERVICE_ROOT / "src" / "api" / "objective_understanding"
PRODUCTION_ROOT = AI_SERVICE_ROOT / "src"

PACKAGE_FILES = sorted(PACKAGE_ROOT.glob("*.py"))


def _imported_modules(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    modules: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            modules.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            modules.add(node.module)
    return modules


def test_el_paquete_existe_y_tiene_los_modulos_esperados() -> None:
    nombres = {path.stem for path in PACKAGE_FILES}
    assert {
        "contracts",
        "prompt",
        "schema",
        "builder",
        "validation",
        "provider",
        "service",
        "errors",
    } <= nombres


def test_ningun_modulo_productivo_importa_el_arbol_experimental() -> None:
    """§46. El árbol experimental es investigación congelada, no una dependencia.

    Se revisa TODO `src/`, no sólo este paquete: un import desde cualquier otro
    módulo productivo tendría el mismo efecto.
    """
    ofensores: list[str] = []
    for path in PRODUCTION_ROOT.rglob("*.py"):
        for module in _imported_modules(path):
            if "experiments" in module.split("."):
                ofensores.append(f"{path.relative_to(AI_SERVICE_ROOT)} -> {module}")
    assert ofensores == [], f"imports del árbol experimental: {ofensores}"


def test_el_paquete_no_alcanza_dominios_de_holder_ni_de_reasoning() -> None:
    """§45. Evidence-blind también a nivel de grafo de imports.

    Si el paquete no puede alcanzar EvidenceUnits, Contextual Reasoning ni el
    constructor de perfil formativo, no puede filtrarlos aunque alguien quisiera.
    """
    prohibidos = (
        "evidence_units",
        "contextual_reasoning",
        "objective_analysis",
        "profile_builder",
        "source_extraction",
    )
    for path in PACKAGE_FILES:
        for module in _imported_modules(path):
            for prohibido in prohibidos:
                assert prohibido not in module, f"{path.name} importa {module}"


def test_el_paquete_no_persiste_nada() -> None:
    """No hay ORM, ni base, ni escritura a disco en el paquete."""
    prohibidos = ("prisma", "sqlalchemy", "psycopg", "sqlite3", "shelve", "pickle")
    for path in PACKAGE_FILES:
        modules = _imported_modules(path)
        for module in modules:
            for prohibido in prohibidos:
                assert prohibido not in module.lower(), f"{path.name} importa {module}"
        source = path.read_text(encoding="utf-8")
        # `open(` como builtin. El lookbehind excluye `urlopen(`, que es
        # transporte HTTP y no escritura a disco.
        assert not re.search(r"(?<![A-Za-z_.])open\s*\(", source), (
            f"{path.name} abre ficheros"
        )


def test_el_paquete_no_lleva_credenciales_en_el_codigo() -> None:
    """Sólo NOMBRES de variables de entorno. Nunca un valor."""
    patron = re.compile(r"(?<![A-Za-z])sk-[A-Za-z0-9]{20}|Bearer [A-Za-z0-9._-]{20}")
    for path in PACKAGE_FILES:
        assert not patron.search(path.read_text(encoding="utf-8")), path.name


def test_el_prompt_productivo_conserva_el_hash_del_candidato_evaluado() -> None:
    """§14 y §58. Editar el prompt rompe esto a propósito.

    El hash vive en el módulo, así que el guard funciona aunque el árbol
    experimental no esté presente en el despliegue.
    """
    from src.api.objective_understanding.prompt import (
        INSTRUCTIONS,
        OU_A2_INSTRUCTIONS_SHA256,
    )

    digest = hashlib.sha256(INSTRUCTIONS.encode("utf-8")).hexdigest()
    assert digest == OU_A2_INSTRUCTIONS_SHA256, (
        "el prompt productivo diverge del candidato OU_A2 evaluado en P2.1"
    )


def test_el_prompt_no_pide_deduplicacion_semantica() -> None:
    """§1. Ninguna instrucción nueva después del Holdout, y ésta en particular."""
    from src.api.objective_understanding.prompt import INSTRUCTIONS

    for prohibido in ("deduplic", "embedding", "similitud semantica", "colapsa los duplicados"):
        assert prohibido not in INSTRUCTIONS.lower()


def test_el_prompt_no_pide_traducir() -> None:
    """§10. El claim propuesto queda en el idioma de la fuente."""
    from src.api.objective_understanding.prompt import INSTRUCTIONS

    for prohibido in ("traduc", "translate", "en espanol el resultado"):
        assert prohibido not in INSTRUCTIONS.lower()


def test_la_identidad_productiva_no_reutiliza_el_nombre_del_ancestro() -> None:
    from src.api.objective_understanding.contracts import (
        PRODUCT_ADAPTER_VERSION,
        PRODUCT_PROMPT_VERSION,
        RESEARCH_ANCESTOR,
    )

    assert RESEARCH_ANCESTOR == "OU_A2"
    assert PRODUCT_PROMPT_VERSION != RESEARCH_ANCESTOR
    assert PRODUCT_ADAPTER_VERSION != RESEARCH_ANCESTOR


def test_el_schema_del_proveedor_prohibe_los_campos_de_autoridad() -> None:
    """§44. `additionalProperties: false` lo hace estructuralmente imposible."""
    from src.api.objective_understanding.schema import (
        OBJECTIVE_UNDERSTANDING_OUTPUT_SCHEMA as SCHEMA,
        PROVIDER_FORBIDDEN_FIELDS,
    )

    assert SCHEMA["additionalProperties"] is False
    item = SCHEMA["properties"]["proposedRequirements"]["items"]
    assert item["additionalProperties"] is False
    for campo in PROVIDER_FORBIDDEN_FIELDS:
        assert campo not in item["properties"]
        assert campo not in SCHEMA["properties"]


@pytest.mark.parametrize(
    "variable",
    [
        "OBJECTIVE_UNDERSTANDING_OPENAI_API_KEY",
        "OBJECTIVE_UNDERSTANDING_OPENAI_MODEL",
    ],
)
def test_las_variables_de_entorno_dedicadas_estan_declaradas(variable: str) -> None:
    from src.api.objective_understanding import provider as provider_module

    source = Path(provider_module.__file__).read_text(encoding="utf-8")
    assert variable in source


def test_el_env_example_declara_las_variables_sin_valores() -> None:
    example = AI_SERVICE_ROOT / ".env.example"
    if not example.exists():
        pytest.skip(".env.example no presente en este árbol")
    content = example.read_text(encoding="utf-8")
    for variable in (
        "OBJECTIVE_UNDERSTANDING_OPENAI_API_KEY",
        "OBJECTIVE_UNDERSTANDING_OPENAI_MODEL",
    ):
        assert variable in content
        for line in content.splitlines():
            if line.startswith(f"{variable}="):
                assert line.split("=", 1)[1].strip() == "", f"{variable} tiene un valor"

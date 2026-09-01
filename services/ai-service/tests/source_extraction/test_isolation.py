"""Aislamiento del camino paralelo F0.

Lo que se protege es la decision D1: F0 construye un camino PARALELO, y es esa
decision la que vuelve alcanzables por construccion los criterios de
compatibilidad hacia atras, en vez de a fuerza de editar con cuidado.

Se comprueba sobre el CIERRE de imports, no sobre el modulo de entrada: un
import indirecto a traves de un submodulo romperia el aislamiento igual que uno
directo.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

import src.source_extraction as package

PACKAGE_ROOT = Path(package.__file__).resolve().parent
SERVICE_ROOT = PACKAGE_ROOT.parents[1]

FROZEN_PRODUCTIVE_EXTRACTOR = (
    "io_utils",
    "text_utils",
    "section_detector",
    "pipeline",
)


def module_files() -> list[Path]:
    return sorted(PACKAGE_ROOT.glob("*.py"))


def imported_names(path: Path) -> list[str]:
    """Nombres importados por un modulo, resolviendo los imports relativos.

    Un `from . import x` se registra como `.x`, para poder distinguir lo que es
    interno al paquete de lo que sale de el.
    """
    names: list[str] = []
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            prefix = "." * node.level
            if node.module:
                names.append(prefix + node.module)
            names.extend(prefix + alias.name for alias in node.names)
    return names


def test_the_module_set_is_not_empty() -> None:
    assert len(module_files()) >= 6


@pytest.mark.parametrize("path", module_files(), ids=lambda path: path.name)
def test_no_module_imports_the_frozen_experiment(path: Path) -> None:
    for name in imported_names(path):
        assert "evidence_reasoning" not in name, f"{path.name} -> {name}"
        assert "experiments" not in name, f"{path.name} -> {name}"


@pytest.mark.parametrize("path", module_files(), ids=lambda path: path.name)
def test_no_module_imports_the_old_productive_extractor(path: Path) -> None:
    for name in imported_names(path):
        bare = name.lstrip(".")
        assert bare not in FROZEN_PRODUCTIVE_EXTRACTOR, f"{path.name} -> {name}"
        for frozen in FROZEN_PRODUCTIVE_EXTRACTOR:
            assert not bare.endswith(f".{frozen}"), f"{path.name} -> {name}"


@pytest.mark.parametrize("path", module_files(), ids=lambda path: path.name)
def test_no_module_imports_test_code(path: Path) -> None:
    for name in imported_names(path):
        assert not name.lstrip(".").startswith("tests"), f"{path.name} -> {name}"


@pytest.mark.parametrize("path", module_files(), ids=lambda path: path.name)
def test_relative_imports_stay_inside_the_package(path: Path) -> None:
    """Ni un solo `..`: el paquete no alcanza al resto de `src/`."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            assert node.level <= 1, f"{path.name} importa fuera del paquete"


def test_the_old_extractor_still_behaves_as_before() -> None:
    """El pipeline viejo sigue viendo lo mismo que veia antes de F0.2.

    No es un test de F0 — es el gate de compatibilidad hacia atras. Si F0.2
    hubiera tocado `io_utils` o `text_utils`, este resultado cambiaria.
    """
    from src.io_utils import extract_text_from_pdf
    from tests.source_extraction.conftest import SOURCES

    text = extract_text_from_pdf(SOURCES / "normal-multipage.pdf")
    assert text.startswith("Programa de la materia Bases de Datos.")
    # `normalize_whitespace` colapsa y hace strip: exactamente el comportamiento
    # que F0 NO hereda, y que aca se confirma intacto.
    assert not text.startswith(" ")
    assert not text.endswith("\n")


def test_the_two_normalizations_diverge_where_it_matters() -> None:
    """`normalize_whitespace` destruye informacion que el texto canonico preserva.

    No es un bug del extractor viejo: es la razon por la que sus offsets no son
    direccionables, y por la que F0 es un camino paralelo en vez de un refactor.

    La divergencia es condicional al contenido, no universal: para una fuente
    sin whitespace redundante los dos caminos coinciden. El test compara
    entonces las transformaciones sobre una entrada que si la ejerce.
    """
    from src.source_extraction.segmentation import canonical_text
    from src.text_utils import normalize_whitespace

    raw = "  Uno\t\tdos   tres  \n\n\n\nCuatro  "
    assert canonical_text(raw) == raw
    assert normalize_whitespace(raw) != raw
    assert normalize_whitespace(raw) != canonical_text(raw)


def test_no_provider_or_network_client_is_imported() -> None:
    forbidden = ("requests", "httpx", "urllib3", "openai", "anthropic", "aiohttp", "socket")
    for path in module_files():
        for name in imported_names(path):
            assert name.split(".")[0] not in forbidden, f"{path.name} -> {name}"

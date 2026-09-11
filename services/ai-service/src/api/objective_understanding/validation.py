"""Validacion estructural de la salida del proveedor — slice P2.2.

EL SCHEMA `strict` DEL PROVEEDOR NO ALCANZA, y por eso esto existe. Un despliegue
puede apuntar a una base URL distinta, un proveedor puede degradar el modo
estructurado, y el contrato tiene que fallar cerrado en vez de pasarle basura al
builder. Esta capa comprueba la FORMA; la fidelidad semantica no es comprobable
aca y no se afirma.

Lo que rechaza:

    la raiz no es un objeto, o le faltan las dos claves obligatorias
    `proposedRequirements` o `unresolvedPassages` no son listas
    un elemento no es un objeto
    un campo obligatorio falta o no es del tipo esperado
    aparece CUALQUIER campo que el proveedor no puede aportar con autoridad
      (candidateId, charStart, finalState, confidence, ...) o cualquier otro
      campo desconocido

`proposedRequirementText` vacio se rechaza: un claim sin texto no es un claim.
Una lista de candidatos VACIA, en cambio, es valida — un Objective sin criterios
evaluables es un resultado legitimo, no un fallo del proveedor.
"""

from __future__ import annotations

from typing import Any

from src.api.objective_understanding.contracts import ProviderInvalidOutputError

PROPOSAL_REQUIRED_KEYS = (
    "proposedRequirementText",
    "primarySourceQuote",
    "auxiliarySourceQuotes",
    "sourceSectionLabel",
)
PROPOSAL_ALLOWED_KEYS = frozenset(PROPOSAL_REQUIRED_KEYS)

UNRESOLVED_REQUIRED_KEYS = ("quote", "reason")
UNRESOLVED_ALLOWED_KEYS = frozenset(UNRESOLVED_REQUIRED_KEYS)


def _require_object(value: Any, code: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ProviderInvalidOutputError(code)
    return value


def _require_list(value: Any, code: str) -> list[Any]:
    if not isinstance(value, list):
        raise ProviderInvalidOutputError(code)
    return value


def _require_str(value: Any, code: str) -> str:
    if not isinstance(value, str):
        raise ProviderInvalidOutputError(code)
    return value


def validate_provider_output(output: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Devuelve `(proposals, unresolved)` normalizados o levanta un fallo tipado."""
    root = _require_object(output, "provider_output_not_an_object")

    if "proposedRequirements" not in root:
        raise ProviderInvalidOutputError("provider_output_missing_proposed_requirements")
    if "unresolvedPassages" not in root:
        raise ProviderInvalidOutputError("provider_output_missing_unresolved_passages")

    unknown_root = set(root) - {"proposedRequirements", "unresolvedPassages"}
    if unknown_root:
        raise ProviderInvalidOutputError("provider_output_unknown_root_field")

    raw_proposals = _require_list(
        root["proposedRequirements"], "provider_output_proposed_requirements_not_a_list"
    )
    raw_unresolved = _require_list(
        root["unresolvedPassages"], "provider_output_unresolved_passages_not_a_list"
    )

    proposals: list[dict[str, Any]] = []
    for item in raw_proposals:
        entry = _require_object(item, "provider_output_proposal_not_an_object")
        unknown = set(entry) - PROPOSAL_ALLOWED_KEYS
        if unknown:
            # Cubre el intento de aportar `candidateId`, `charStart`, `finalState`,
            # `confidence` y cualquier otro campo cuya autoridad no le corresponde.
            raise ProviderInvalidOutputError("provider_output_forbidden_proposal_field")
        for key in PROPOSAL_REQUIRED_KEYS:
            if key not in entry:
                raise ProviderInvalidOutputError("provider_output_proposal_missing_field")

        text = _require_str(
            entry["proposedRequirementText"], "provider_output_proposal_text_not_a_string"
        )
        if not text.strip():
            raise ProviderInvalidOutputError("provider_output_proposal_text_empty")

        primary = _require_str(
            entry["primarySourceQuote"], "provider_output_primary_quote_not_a_string"
        )
        auxiliary_raw = _require_list(
            entry["auxiliarySourceQuotes"], "provider_output_auxiliary_quotes_not_a_list"
        )
        auxiliary = [
            _require_str(quote, "provider_output_auxiliary_quote_not_a_string")
            for quote in auxiliary_raw
        ]
        section = _require_str(
            entry["sourceSectionLabel"], "provider_output_section_label_not_a_string"
        )

        proposals.append(
            {
                "proposedRequirementText": text,
                "primarySourceQuote": primary,
                "auxiliarySourceQuotes": auxiliary,
                "sourceSectionLabel": section,
            }
        )

    unresolved: list[dict[str, Any]] = []
    for item in raw_unresolved:
        entry = _require_object(item, "provider_output_unresolved_not_an_object")
        unknown = set(entry) - UNRESOLVED_ALLOWED_KEYS
        if unknown:
            raise ProviderInvalidOutputError("provider_output_forbidden_unresolved_field")
        for key in UNRESOLVED_REQUIRED_KEYS:
            if key not in entry:
                raise ProviderInvalidOutputError("provider_output_unresolved_missing_field")
        unresolved.append(
            {
                "quote": _require_str(
                    entry["quote"], "provider_output_unresolved_quote_not_a_string"
                ),
                "reason": _require_str(
                    entry["reason"], "provider_output_unresolved_reason_not_a_string"
                ),
            }
        )

    return proposals, unresolved

"""Orquestacion de Objective Understanding productivo — slice P2.2.

Orden causal, y el orden ES la regla:

    guard de tamano del Objective     (ANTES de tocar al proveedor)
        v
    guard de configuracion local      (ANTES de tocar al proveedor)
        v
    UNA sola llamada logica al proveedor
        v
    validacion estructural de la salida
        v
    construccion confiable de la propuesta (anclaje, offsets, ids)
        v
    guard del modelo efectivo informado
        v
    envelope de respuesta

Si un guard previo falla, `provider calls = 0`.

LO QUE ESTA ETAPA NO HACE, y la ausencia es el contrato:

    no crea el Objective            no confirma Requirements
    no ejecuta Evidence Reasoning   no mira credenciales del holder
    no persiste nada                no deduplica semanticamente
    no traduce                      no segmenta
    no reintenta por su cuenta      no llama al proveedor para reparar anclaje
"""

from __future__ import annotations

from typing import Any

from src.api.objective_understanding.builder import build_proposal_artifact
from src.api.objective_understanding.contracts import (
    ProviderInvalidOutputError,
    ARTIFACT_SCHEMA_VERSION,
    MAX_OBJECTIVE_CHARACTERS,
    PRODUCT_ADAPTER_VERSION,
    PRODUCT_PROMPT_VERSION,
    PROVIDER_PROPOSAL_SCHEMA_VERSION,
    RESEARCH_ANCESTOR,
    RESPONSE_SCHEMA_VERSION,
    SUPPORTED_PROVIDER,
    SUPPORTED_REASONING_EFFORT,
    VALIDATED_PRIMARY_LANGUAGE,
    ObjectiveInputError,
    ObjectiveTooLargeError,
)
from src.api.objective_understanding.prompt import (
    EXTRACTION_POLICY_VERSION,
    OU_A2_INSTRUCTIONS_SHA256,
    build_objective_understanding_prompt,
)
from src.api.objective_understanding.provider import (
    OpenAIObjectiveUnderstandingProvider,
    configured_model,
)
from src.api.objective_understanding.schema import (
    OBJECTIVE_UNDERSTANDING_OUTPUT_SCHEMA,
    PROVIDER_SCHEMA_NAME,
)
from src.api.objective_understanding.selection import (
    SELECTION_OUTPUT_SCHEMA,
    SELECTION_POLICY_VERSION,
    SELECTION_SCHEMA_NAME,
    build_selection_prompt,
    validate_selection_output,
)
from src.api.objective_understanding.validation import validate_provider_output

EFFECTIVE_MODEL_MATCH = "MATCH"

#: Techo de candidatos que puede devolver la EXTRACCION. No es el tope del
#: producto (ese lo aplica la seleccion): es un limite de cordura. Una extraccion
#: con mas candidatos que esto no respeto la politica, y elegir sobre ella seria
#: elegir sobre basura. Falla cerrado como salida invalida.
MAX_EXTRACTED_CANDIDATES = 60
EFFECTIVE_MODEL_UNAVAILABLE = "UNAVAILABLE"


def assert_objective_fits(raw_objective_text: str) -> None:
    """Falla cerrado si el Objective no puede procesarse en UNA llamada.

    No hay truncado silencioso y no hay segmentacion automatica: `ONE_CALL_PER_OBJECTIVE`
    es parte de la topologia que P2.1 evaluo, y partir el Objective produciria un
    comportamiento que nadie midio.
    """
    if not raw_objective_text.strip():
        raise ObjectiveInputError("raw_objective_text_empty")
    if len(raw_objective_text) > MAX_OBJECTIVE_CHARACTERS:
        raise ObjectiveTooLargeError("objective_exceeds_single_call_budget")


def _verify_reported_model(requested: str, reported: str | None) -> str:
    """Igualdad EXACTA de string, sin alias ni canonicalizacion.

    Si el despliegue configura un ALIAS y el proveedor responde con el snapshot
    concreto, esto NO falla la propuesta: a diferencia de un ReasoningRun, aca no
    hay una fila cuya vida dependa del guard. Se informa la discrepancia como
    hecho verificable y quien decide es el consumidor.
    """
    if reported is None:
        return EFFECTIVE_MODEL_UNAVAILABLE
    return EFFECTIVE_MODEL_MATCH if reported == requested else "MISMATCH"


def run_objective_understanding(
    *,
    objective_type: str,
    title: str,
    raw_objective_text: str,
    max_proposed_requirements: int | None = None,
    provider: Any | None = None,
) -> dict[str, Any]:
    """Ejecuta la etapa completa y devuelve el envelope productivo.

    `provider` se inyecta en tests. En produccion se construye aca, DESPUES de los
    guards: construirlo antes leeria configuracion que quiza no vamos a usar.

    SIN `max_proposed_requirements` el comportamiento es exactamente el evaluado
    en P2.1: un prompt, un schema, una llamada, sin politica ni seleccion.

    CON `max_proposed_requirements` (los dos consumidores productivos):

        1. EXTRACCION   prompt congelado + politica de extraccion, SIN cupo.
        2. SELECCION    solo si la extraccion supera el maximo: una segunda
                        llamada que devuelve NUMEROS de candidatos ya extraidos.
        3. el resto queda en `omittedCandidates`, anclado igual que los elegidos,
           para que el titular vea que hubo seleccion y pueda sustituir.

    Nunca se recorta por orden y nunca hay reintentos: una seleccion invalida es
    un fallo explicito de la propuesta.
    """
    assert_objective_fits(raw_objective_text)
    if max_proposed_requirements is not None and max_proposed_requirements < 1:
        raise ObjectiveInputError("max_proposed_requirements_not_positive")

    # Lee configuracion y falla cerrado si falta, antes de cualquier llamada.
    requested_model = configured_model()

    client = provider if provider is not None else OpenAIObjectiveUnderstandingProvider()
    governed = max_proposed_requirements is not None

    prompt = build_objective_understanding_prompt(
        objective_type=objective_type,
        title=title,
        raw_objective_text=raw_objective_text,
        extraction_policy=governed,
    )

    observation = client.complete(
        prompt=prompt,
        schema_name=PROVIDER_SCHEMA_NAME,
        schema=OBJECTIVE_UNDERSTANDING_OUTPUT_SCHEMA,
        model=requested_model,
        reasoning_effort=SUPPORTED_REASONING_EFFORT,
    )

    proposals, unresolved = validate_provider_output(observation.output)

    selected = proposals
    omitted: list[dict[str, Any]] = []
    selection_applied = False
    if governed:
        if len(proposals) > MAX_EXTRACTED_CANDIDATES:
            raise ProviderInvalidOutputError("extraction_exceeds_candidate_ceiling")
        if len(proposals) > max_proposed_requirements:
            selected_indexes = _select(
                client,
                requested_model,
                objective_type=objective_type,
                title=title,
                raw_objective_text=raw_objective_text,
                proposals=proposals,
                maximum=max_proposed_requirements,
            )
            chosen = set(selected_indexes)
            selected = [proposals[index] for index in selected_indexes]
            omitted = [p for index, p in enumerate(proposals) if index not in chosen]
            selection_applied = True

    artifact = build_proposal_artifact(raw_objective_text, selected, unresolved)
    if governed:
        artifact["omittedCandidates"] = _omitted_candidates(
            raw_objective_text, omitted, first_number=len(selected) + 1
        )

    execution: dict[str, Any] = {
        "artifactSchemaVersion": ARTIFACT_SCHEMA_VERSION,
        "promptVersion": PRODUCT_PROMPT_VERSION,
        "adapterVersion": PRODUCT_ADAPTER_VERSION,
        "providerProposalSchemaVersion": PROVIDER_PROPOSAL_SCHEMA_VERSION,
        "provider": SUPPORTED_PROVIDER,
        "requestedModel": requested_model,
        "reasoningEffort": SUPPORTED_REASONING_EFFORT,
        "effectiveModelVerification": _verify_reported_model(
            requested_model, observation.reported_model
        ),
        "researchAncestor": RESEARCH_ANCESTOR,
        "promptBodySha256": OU_A2_INSTRUCTIONS_SHA256,
        "validatedPrimaryLanguage": VALIDATED_PRIMARY_LANGUAGE,
        "providerAuthority": "PROPOSAL_ONLY",
        "persistence": "NONE",
    }
    if observation.reported_model is not None:
        execution["reportedEffectiveModel"] = observation.reported_model
    if governed:
        # Se declara lo que ESTA ejecucion aplico, para que NestJS lo verifique
        # contra lo que pidio en vez de confiar en que el pedido llego.
        execution["requestedMaxProposedRequirements"] = max_proposed_requirements
        execution["extractionPolicyVersion"] = EXTRACTION_POLICY_VERSION
        execution["selectionPolicyVersion"] = SELECTION_POLICY_VERSION
        execution["selection"] = {
            "applied": selection_applied,
            "extractedCandidateCount": len(proposals),
            "selectedCandidateCount": len(selected),
            "omittedCandidateCount": len(omitted),
            "providerLogicalCalls": 2 if selection_applied else 1,
        }

    # Sin respuesta cruda, sin prompt, sin tokens, sin razonamiento interno. El
    # artifact estructurado construido por codigo confiable ES la salida.
    return {
        "schemaVersion": RESPONSE_SCHEMA_VERSION,
        "execution": execution,
        "artifact": artifact,
    }


def _select(
    client: Any,
    requested_model: str,
    *,
    objective_type: str,
    title: str,
    raw_objective_text: str,
    proposals: list[dict[str, Any]],
    maximum: int,
) -> list[int]:
    """UNA llamada de seleccion. Devuelve indices base 0 en orden de fuente."""
    observation = client.complete(
        prompt=build_selection_prompt(
            objective_type=objective_type,
            title=title,
            raw_objective_text=raw_objective_text,
            proposals=proposals,
            maximum=maximum,
        ),
        schema_name=SELECTION_SCHEMA_NAME,
        schema=SELECTION_OUTPUT_SCHEMA,
        model=requested_model,
        reasoning_effort=SUPPORTED_REASONING_EFFORT,
    )
    return validate_selection_output(observation.output, len(proposals), maximum)


def _omitted_candidates(
    raw_objective_text: str,
    omitted: list[dict[str, Any]],
    *,
    first_number: int,
) -> list[dict[str, Any]]:
    """Ancla los candidatos que quedaron afuera con el MISMO builder confiable.

    Ids que siguen la numeracion de los elegidos, para que ningun id se repita
    entre las dos listas; `order` es la posicion dentro de esta lista.
    """
    built = build_proposal_artifact(raw_objective_text, omitted, [])["candidates"]
    for offset, candidate in enumerate(built):
        candidate["candidateId"] = "cand_%02d" % (first_number + offset)
    return built

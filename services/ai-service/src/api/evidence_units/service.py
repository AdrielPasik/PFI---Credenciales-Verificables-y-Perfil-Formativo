"""Orquestacion del catalogo de EvidenceUnits productivo — slice F3.4.

Orden causal, y el orden ES la regla:

    guard del plan de ejecucion              ANTES de tocar al proveedor
        v
    verificacion del grounding set COMPLETO  ANTES de tocar al proveedor
        v
    una sola llamada logica, con TODAS las fuentes
        v
    validacion estructural de la propuesta
        v
    grounding determinista contra el canonico verificado
        v
    guard del modelo efectivo informado
        v
    envelope de respuesta

PRECHEQUEO COMPLETO DEL GROUNDING SET. Si una sola fuente del run no es utilizable,
`provider calls = 0` y la etapa falla entera. No se procesa parcialmente: convertir
el fallo tardio de una fuente en un catalogo "casi completo" produciria un universo
observado que nadie planifico, y el artifact no diria que falta algo.

CERO FUENTES INCLUIDAS -> CERO LLAMADAS. Con el grounding set vacio, toda propuesta
posible seria rechazada por `SOURCE_OUTSIDE_FROZEN_SET`: el catalogo vacio es el
UNICO resultado alcanzable, asi que la llamada no puede aportar informacion. No es
una optimizacion oportunista — es que su salida es demostrablemente irrelevante.
"""

from __future__ import annotations

from typing import Any

from src.api.evidence_units.builder import (
    build_evidence_units,
    exact_redundancy_groups,
    source_observability_facts,
)
from src.api.evidence_units.contracts import (
    ARTIFACT_SCHEMA_VERSION,
    COVERAGE_STATUS_TOKENS,
    PRODUCT_ADAPTER_VERSION,
    PRODUCT_PROMPT_VERSION,
    RESPONSE_SCHEMA_VERSION,
    SOURCE_PROVENANCE,
    SUPPORTED_PROVIDER,
    SUPPORTED_REASONING_EFFORT,
    ExecutionPlanMismatchError,
    GroundingInputError,
    ProviderInvalidOutputError,
    StageExecutionPlan,
)
from src.api.evidence_units.prompt import build_evidence_units_prompt
from src.api.evidence_units.provider import (
    OpenAIEvidenceUnitsProvider,
    configured_model,
)
from src.api.evidence_units.schema import (
    EVIDENCE_UNITS_OUTPUT_SCHEMA,
    EVIDENCE_UNITS_SCHEMA_NAME,
)

EFFECTIVE_MODEL_MATCH = "MATCH"
EFFECTIVE_MODEL_UNAVAILABLE = "UNAVAILABLE"

_SOURCE_KEYS = {
    "sourceId",
    "sourceSha256",
    "coverageStatus",
    "canonicalText",
    "segments",
    "pages",
    "diagnostics",
}
_SEGMENT_KEYS = {"segmentId", "charStart", "charEnd", "exactExcerpt"}
_PAGE_KEYS = {"pageNumber", "pageOffsetStart", "pageOffsetEnd"}


def assert_plan_matches_local_configuration(plan: StageExecutionPlan) -> None:
    """Falla cerrado si el plan congelado no describe lo que esta etapa hara.

    El error NUNCA lleva valores: decir "esperaba X, encontre Y" meteria
    configuracion de despliegue en un log.
    """
    if plan.artifactSchemaVersion != ARTIFACT_SCHEMA_VERSION:
        raise ExecutionPlanMismatchError("artifact_schema_version_mismatch")
    if plan.promptVersion != PRODUCT_PROMPT_VERSION:
        raise ExecutionPlanMismatchError("prompt_version_mismatch")
    if plan.adapterVersion != PRODUCT_ADAPTER_VERSION:
        raise ExecutionPlanMismatchError("adapter_version_mismatch")
    if plan.provider != SUPPORTED_PROVIDER:
        raise ExecutionPlanMismatchError("provider_mismatch")
    if plan.reasoningEffort != SUPPORTED_REASONING_EFFORT:
        raise ExecutionPlanMismatchError("reasoning_effort_mismatch")
    if plan.model != configured_model():
        raise ExecutionPlanMismatchError("model_mismatch")


def assert_grounding_set_usable(sources: list[dict[str, Any]]) -> None:
    """Verifica el material de grounding COMPLETO antes de la primera llamada.

    Estructural, no semantica: NestJS ya verifico el artifact de extraccion contra
    su verificador productivo y contra los SHA congelados. Aca se comprueba que lo
    que llego tenga la forma que el grounding necesita, porque anclar contra un
    canonico ausente o contra segmentos fuera de rango produciria coordenadas sin
    sentido.
    """
    seen: set[str] = set()
    for index, source in enumerate(sources):
        where = f"sources[{index}]"
        if not isinstance(source, dict) or not _SOURCE_KEYS.issubset(source):
            raise GroundingInputError(f"grounding_source_shape_invalid:{where}")

        source_id = source["sourceId"]
        if not isinstance(source_id, str) or not source_id:
            raise GroundingInputError(f"grounding_source_id_invalid:{where}")
        if source_id in seen:
            raise GroundingInputError(f"grounding_source_id_duplicated:{source_id}")
        seen.add(source_id)

        canonical = source["canonicalText"]
        if not isinstance(canonical, str):
            raise GroundingInputError(f"grounding_canonical_text_invalid:{source_id}")
        if source["coverageStatus"] not in COVERAGE_STATUS_TOKENS:
            raise GroundingInputError(f"grounding_coverage_status_invalid:{source_id}")
        if not isinstance(source["sourceSha256"], str) or not source["sourceSha256"]:
            raise GroundingInputError(f"grounding_source_sha_invalid:{source_id}")

        for segment in source["segments"]:
            if not isinstance(segment, dict) or not _SEGMENT_KEYS.issubset(segment):
                raise GroundingInputError(f"grounding_segment_shape_invalid:{source_id}")
            start, end = segment["charStart"], segment["charEnd"]
            if not isinstance(start, int) or not isinstance(end, int):
                raise GroundingInputError(f"grounding_segment_offsets_invalid:{source_id}")
            if not 0 <= start <= end <= len(canonical):
                raise GroundingInputError(f"grounding_segment_out_of_range:{source_id}")
            if canonical[start:end] != segment["exactExcerpt"]:
                # El segmento no describe el canonico que vino con el: uno de los
                # dos esta corrupto, y anclar contra cualquiera seria adivinar.
                raise GroundingInputError(f"grounding_segment_excerpt_mismatch:{source_id}")

        for page in source["pages"]:
            if not isinstance(page, dict) or not _PAGE_KEYS.issubset(page):
                raise GroundingInputError(f"grounding_page_shape_invalid:{source_id}")


def _verify_reported_model(plan: StageExecutionPlan, reported: str | None) -> str:
    """Igualdad EXACTA de string, sin alias ni canonicalizacion.

    Misma regla que F3.3B: si el despliegue configura un alias y el proveedor
    responde con el snapshot concreto, el guard falla cerrado. Es el guard pidiendo
    que el plan fije un modelo concreto, no un bug.
    """
    if reported is None:
        return EFFECTIVE_MODEL_UNAVAILABLE
    if reported != plan.model:
        raise ExecutionPlanMismatchError("effective_model_mismatch")
    return EFFECTIVE_MODEL_MATCH


def _build_artifact(
    accepted: list[dict[str, Any]],
    validations: list[dict[str, Any]],
    sources: list[dict[str, Any]],
    proposal_count: int,
) -> dict[str, Any]:
    """Arma `evidence_units_v1` completo.

    `sources[]` y `sourceObservabilityFacts[]` se construyen recorriendo el
    GROUNDING SET, nunca las unidades producidas: una fuente incluida sin unidades
    igual entro al razonamiento y tiene que quedar declarada.
    """
    return {
        "schemaVersion": ARTIFACT_SCHEMA_VERSION,
        "sources": [
            {"sourceId": source["sourceId"], "sourceProvenance": SOURCE_PROVENANCE}
            for source in sources
        ],
        "evidenceUnits": accepted,
        "preparation": {
            "mode": "FULL_SCAN",
            "evidenceUnitIds": [item["evidenceUnitId"] for item in accepted],
            "exactRedundancyGroups": exact_redundancy_groups(accepted),
            "sourceObservabilityFacts": source_observability_facts(sources, accepted),
            "discardedEvidenceProposalCount": proposal_count - len(accepted),
        },
        "validations": validations,
    }


def _validate_proposal(output: Any) -> list[dict[str, Any]]:
    """Forma de la propuesta. Sin reparacion semantica y sin defaults."""
    if not isinstance(output, dict) or set(output) != {"evidenceUnits"}:
        raise ProviderInvalidOutputError("provider_output_unexpected_keys")
    proposals = output["evidenceUnits"]
    if not isinstance(proposals, list):
        raise ProviderInvalidOutputError("provider_evidence_units_not_a_list")

    required = {
        "sourceId",
        "segmentId",
        "quoteText",
        "normalizedProposition",
        "claimType",
        "semanticQualifiers",
    }
    for item in proposals:
        if not isinstance(item, dict) or set(item) != required:
            raise ProviderInvalidOutputError("provider_proposal_unexpected_keys")
        for field in ("sourceId", "segmentId", "quoteText", "normalizedProposition"):
            if not isinstance(item[field], str) or not item[field].strip():
                raise ProviderInvalidOutputError(f"provider_proposal_{field}_invalid")
        if not isinstance(item["semanticQualifiers"], list):
            raise ProviderInvalidOutputError("provider_proposal_qualifiers_invalid")
        for qualifier in item["semanticQualifiers"]:
            if not isinstance(qualifier, dict) or set(qualifier) != {"kind", "value"}:
                raise ProviderInvalidOutputError("provider_qualifier_unexpected_keys")
            if not all(isinstance(qualifier[key], str) for key in ("kind", "value")):
                raise ProviderInvalidOutputError("provider_qualifier_not_text")
    return proposals


def run_evidence_units(
    *,
    plan: StageExecutionPlan,
    sources: list[dict[str, Any]],
    provider: Any | None = None,
) -> dict[str, Any]:
    """Ejecuta la etapa completa y devuelve el envelope productivo.

    `provider` se inyecta en tests. En produccion se construye aca, DESPUES de los
    dos guards: construirlo antes leeria configuracion que quiza no vamos a usar.
    """
    assert_plan_matches_local_configuration(plan)
    assert_grounding_set_usable(sources)

    execution: dict[str, Any] = {
        "artifactSchemaVersion": ARTIFACT_SCHEMA_VERSION,
        "promptVersion": PRODUCT_PROMPT_VERSION,
        "adapterVersion": PRODUCT_ADAPTER_VERSION,
        "provider": SUPPORTED_PROVIDER,
        "requestedModel": plan.model,
        "reasoningEffort": SUPPORTED_REASONING_EFFORT,
    }

    if not sources:
        # Catalogo vacio SIN llamada. Ver la nota del encabezado: con cero fuentes
        # toda propuesta seria rechazada, asi que la llamada no puede cambiar el
        # resultado.
        execution["providerCalled"] = False
        execution["effectiveModelVerification"] = EFFECTIVE_MODEL_UNAVAILABLE
        return {
            "schemaVersion": RESPONSE_SCHEMA_VERSION,
            "execution": execution,
            "artifact": _build_artifact([], [], [], 0),
        }

    client = provider if provider is not None else OpenAIEvidenceUnitsProvider()
    observation = client.complete(
        prompt=build_evidence_units_prompt(sources),
        schema_name=EVIDENCE_UNITS_SCHEMA_NAME,
        schema=EVIDENCE_UNITS_OUTPUT_SCHEMA,
        plan=plan,
    )

    proposals = _validate_proposal(observation.output)
    accepted, validations = build_evidence_units(proposals, sources)
    verification = _verify_reported_model(plan, observation.reported_model)

    execution["providerCalled"] = True
    execution["effectiveModelVerification"] = verification
    if observation.reported_model is not None:
        execution["reportedEffectiveModel"] = observation.reported_model

    # Sin respuesta cruda, sin prompt, sin tokens, sin razonamiento interno.
    return {
        "schemaVersion": RESPONSE_SCHEMA_VERSION,
        "execution": execution,
        "artifact": _build_artifact(accepted, validations, sources, len(proposals)),
    }

from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Annotated, Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse

from src.api.error_envelope import (
    EXECUTION_PLAN_MISMATCH,
    PROVIDER_CONFIGURATION_FAILURE,
    PROVIDER_INVALID_OUTPUT,
    PROVIDER_TRANSPORT_FAILURE,
    application_error,
)
from src.api.internal_auth import (
    InternalAuthSettings,
    load_internal_auth_settings,
    require_internal_service,
)
from src.api.models import (
    ContextualReasoningRequest,
    EvidenceUnitsRequest,
    FormativeProfileBuildRequest,
    ObjectiveAnalysisRequest,
    ObjectiveRequirementProposalRequest,
    SemanticAnalysisTextRequest,
    SourceExtractionTextRequest,
)
from src.api.objective_analysis.contracts import (
    REQUEST_SCHEMA_VERSION as OBJECTIVE_ANALYSIS_REQUEST_SCHEMA_VERSION,
    ExecutionPlanMismatchError,
    ProviderConfigurationError,
    ProviderInvalidOutputError,
    ProviderTransportError,
    ProviderUnavailableError,
    StageExecutionPlan,
)
from src.api.evidence_units.contracts import (
    REQUEST_SCHEMA_VERSION as EVIDENCE_UNITS_REQUEST_SCHEMA_VERSION,
    ExecutionPlanMismatchError as EvidenceUnitsPlanMismatchError,
    GroundingInputError,
    ProviderConfigurationError as EvidenceUnitsProviderConfigurationError,
    ProviderInvalidOutputError as EvidenceUnitsInvalidOutputError,
    ProviderTransportError as EvidenceUnitsTransportError,
    ProviderUnavailableError as EvidenceUnitsProviderUnavailableError,
    StageExecutionPlan as EvidenceUnitsStageExecutionPlan,
)
from src.api.evidence_units.service import run_evidence_units
from src.api.contextual_reasoning.contracts import (
    REQUEST_SCHEMA_VERSION as CONTEXTUAL_REASONING_REQUEST_SCHEMA_VERSION,
    ExecutionPlanMismatchError as ContextualPlanMismatchError,
    ProviderConfigurationError as ContextualProviderConfigurationError,
    ProviderInvalidOutputError as ContextualInvalidOutputError,
    ProviderTransportError as ContextualTransportError,
    ProviderUnavailableError as ContextualProviderUnavailableError,
    ReasoningInputError,
    StageExecutionPlan as ContextualStageExecutionPlan,
)
from src.api.contextual_reasoning.service import run_contextual_reasoning
from src.api.objective_analysis.service import run_objective_analysis
from src.api.objective_understanding.contracts import (
    REQUEST_SCHEMA_VERSION as OBJECTIVE_UNDERSTANDING_REQUEST_SCHEMA_VERSION,
    ObjectiveInputError,
    ObjectiveTooLargeError,
    ProviderConfigurationError as ObjectiveUnderstandingConfigurationError,
    ProviderInvalidOutputError as ObjectiveUnderstandingInvalidOutputError,
    ProviderTransportError as ObjectiveUnderstandingTransportError,
    ProviderUnavailableError as ObjectiveUnderstandingUnavailableError,
)
from src.api.objective_understanding.errors import (
    OBJECTIVE_TOO_LARGE,
    objective_understanding_error,
)
from src.api.objective_understanding.service import run_objective_understanding
from src.api.service import (
    InvalidPdfUploadError,
    UnsupportedVersionError,
    analyze_academic_pdf,
    analyze_text,
    build_formative_profile,
    save_pdf_upload,
)
from src.api.source_extraction_transport import (
    ArtifactInvariantViolation,
    SourceExtractionDependencyError,
    SourceExtractionInputError,
    extract_pdf_over_transport,
    extract_text_over_transport,
    read_upload_bytes,
)
from src.profile_builder.artifact_loader import InvalidArtifactError


def health() -> dict[str, str]:
    return {"status": "ok", "service": "pfi-ai-service"}


def formative_profile_build(payload: FormativeProfileBuildRequest) -> dict[str, Any]:
    try:
        return build_formative_profile(payload.artifacts)
    except InvalidArtifactError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"invalid_semantic_analysis_v1: {exc}",
        ) from exc
    except (AttributeError, KeyError, TypeError, ValueError) as exc:
        # The existing consumer validates required top-level fields but not
        # every nested entry; malformed nested JSON is still a client error.
        raise HTTPException(
            status_code=422,
            detail=f"invalid_semantic_analysis_v1_structure: {exc}",
        ) from exc


def semantic_analysis_pdf(
    file: Annotated[UploadFile, File(description="Academic program in PDF format")],
    document_id: Annotated[str | None, Form(alias="documentId")] = None,
    file_name: Annotated[str | None, Form(alias="fileName")] = None,
    pipeline_version: Annotated[str | None, Form(alias="pipelineVersion")] = None,
    taxonomy_version: Annotated[str | None, Form(alias="taxonomyVersion")] = None,
) -> dict[str, Any]:
    effective_file_name = (file_name or file.filename or "uploaded.pdf").strip()
    if not effective_file_name:
        effective_file_name = "uploaded.pdf"

    try:
        with TemporaryDirectory(prefix="pfi-ai-pdf-") as temp_dir:
            temp_path = Path(temp_dir) / "upload.pdf"
            save_pdf_upload(file.file, temp_path)
            return analyze_academic_pdf(
                temp_path,
                document_id=document_id.strip() if document_id and document_id.strip() else None,
                file_name=effective_file_name,
                pipeline_version=pipeline_version.strip() if pipeline_version else None,
                taxonomy_version=taxonomy_version.strip() if taxonomy_version else None,
            )
    except InvalidPdfUploadError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except UnsupportedVersionError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ModuleNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"PDF processing dependency is unavailable: {exc}",
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"pdf_could_not_be_processed: {exc}",
        ) from exc
    finally:
        file.file.close()


def semantic_analysis_text(payload: SemanticAnalysisTextRequest) -> dict[str, Any]:
    try:
        return analyze_text(
            payload.content,
            metadata=payload.metadata.model_dump() if payload.metadata else None,
            source_refs=payload.sourceRefs.model_dump() if payload.sourceRefs else None,
            pipeline_version=payload.requestedPipelineVersion,
            taxonomy_version=payload.requestedTaxonomyVersion,
        )
    except UnsupportedVersionError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"text_could_not_be_processed: {exc}",
        ) from exc


def source_extraction_pdf(
    file: Annotated[UploadFile, File(description="Authoritative PDF bytes")],
    document_evidence_id: Annotated[str, Form(alias="documentEvidenceId")],
    source_sha256: Annotated[str, Form(alias="sourceSha256")],
    storage_key: Annotated[str, Form(alias="storageKey")],
) -> dict[str, Any]:
    """Transporte hacia F0.2. No verifica, no repara y no es un segundo productor.

    `coverageStatus = FAILED` es un resultado de extraccion EXITOSO —un PDF
    escaneado o cifrado produce un artifact valido y degradado— asi que se
    devuelve 2xx. Convertirlo en un error HTTP borraria la distincion entre "la
    fuente es inobservable" y "la peticion fallo", que es justamente lo que F0
    trabajo para separar.
    """
    try:
        payload = read_upload_bytes(file.file)
        return extract_pdf_over_transport(
            pdf_bytes=payload,
            document_evidence_id=document_evidence_id.strip(),
            source_sha256=source_sha256.strip(),
            storage_key=storage_key.strip(),
        )
    except InvalidPdfUploadError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except SourceExtractionInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except SourceExtractionDependencyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except ArtifactInvariantViolation as exc:
        # Bug de contrato del productor, no de la peticion.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="source_extraction_invariant_violation",
        ) from exc
    finally:
        file.file.close()


def source_extraction_text(payload: SourceExtractionTextRequest) -> dict[str, Any]:
    """Transporte hacia F0.3. El contenido llega y se entrega SIN normalizar."""
    try:
        return extract_text_over_transport(
            content=payload.content,
            text_evidence_id=payload.textEvidenceId,
            source_sha256=payload.sourceSha256,
        )
    except SourceExtractionInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except SourceExtractionDependencyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    except ArtifactInvariantViolation as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="source_extraction_invariant_violation",
        ) from exc


def objective_analysis(payload: ObjectiveAnalysisRequest) -> Any:
    """Objective Analysis productivo — UNA llamada logica por Objective.

    Evidence-blind: el request no admite credenciales, inventario, EvidenceUnits
    ni excerpts, y `extra="forbid"` lo hace estructural en vez de una promesa.

    LOS FALLOS DE APLICACION LLEVAN `ai_service_error_v1`, Y ESE ES EL PUNTO. El
    status HTTP describe el transporte; el `code` del envelope es la afirmacion de
    ESTA aplicacion. NestJS decide con el `code` —validado y coherente con el
    status—, nunca con el status a secas, porque un 502 de un proxy no demuestra
    que un proveedor haya respondido nada:

        409 + EXECUTION_PLAN_MISMATCH
            el plan congelado no describe lo que este servicio ejecutaria
            -> el run termina failed, y NO hubo llamada al proveedor

        502 + PROVIDER_INVALID_OUTPUT
            el proveedor respondio ENTERO y su salida no cumple el contrato
            -> el run termina failed, y NO se le vuelve a preguntar

        503 + PROVIDER_TRANSPORT_FAILURE
            no se obtuvo respuesta semantica utilizable, o falta configuracion
            -> el run sigue pending y puede reintentarse

        424 + PROVIDER_CONFIGURATION_FAILURE
            el proveedor rechazo la peticion de forma DETERMINISTA
            -> el run termina failed; repetir el mismo plan no puede funcionar

    La salida invalida del proveedor va en 502 y NO en 422 a proposito. FastAPI ya
    usa 422 para su propia validacion de request, y colapsar las dos cosas haria
    que un request mal armado por NestJS —un bug de despliegue— se leyera como un
    fallo terminal del run. Por la misma razon el 422 de abajo NO lleva envelope:
    es un problema del borde, no un juicio sobre el ReasoningRun.

    Ningun campo lleva valores de configuracion, texto del Objective ni la
    respuesta cruda del proveedor. `message` es prosa para un log y no clasifica.

    El retorno se anota `Any` y no `dict | JSONResponse` porque FastAPI intenta
    derivar un response model de la anotacion, y una union con `Response` no es un
    tipo Pydantic valido. El envelope viaja como `JSONResponse` para quedar EN LA
    RAIZ del body, no anidado bajo el `detail` de una `HTTPException`.
    """
    if payload.schemaVersion != OBJECTIVE_ANALYSIS_REQUEST_SCHEMA_VERSION:
        # Sin envelope: no es un desenlace del run.
        raise HTTPException(status_code=422, detail="objective_analysis_request_schema_unsupported")

    plan = StageExecutionPlan(**payload.executionPlan.model_dump())
    try:
        return run_objective_analysis(
            plan=plan,
            objective_type=payload.objectiveType,
            objective_context=payload.objectiveContext,
            requirements=[item.model_dump() for item in payload.requirements],
        )
    except ExecutionPlanMismatchError as exc:
        return application_error(
            EXECUTION_PLAN_MISMATCH,
            f"objective_analysis_execution_plan_mismatch:{exc}",
        )
    except ProviderInvalidOutputError as exc:
        return application_error(
            PROVIDER_INVALID_OUTPUT,
            f"objective_analysis_invalid_provider_output:{exc}",
        )
    except ProviderConfigurationError as exc:
        # Modelo inexistente, credencial invalida, peticion rechazada. Reintentar
        # el MISMO plan es un bucle, no resiliencia.
        return application_error(
            PROVIDER_CONFIGURATION_FAILURE,
            f"objective_analysis_provider_configuration_failure:{exc}",
        )
    except ProviderUnavailableError as exc:
        # Colapsa con el fallo de transporte, y a proposito: los dos significan
        # "no se obtuvo respuesta semantica utilizable" y dejan el run intacto y
        # reintentable. Distinguirlos en el vocabulario cerrado agregaria un token
        # que ningun consumidor necesita para decidir nada. La diferencia
        # operativa sobrevive en `message`, que no clasifica.
        return application_error(
            PROVIDER_TRANSPORT_FAILURE,
            f"objective_analysis_provider_unavailable:{exc}",
        )
    except ProviderTransportError as exc:
        return application_error(
            PROVIDER_TRANSPORT_FAILURE,
            f"objective_analysis_provider_transport_failure:{exc}",
        )


def evidence_units(payload: EvidenceUnitsRequest) -> Any:
    """Catalogo de EvidenceUnits productivo — UNA llamada logica por run.

    OBJECTIVE-INDEPENDENT, y estructuralmente. El request no admite Objective,
    Requirements, analisis previo, SemanticAnalysis ni perfiles: no hay campo
    donde ponerlos. Auditado sobre el runtime congelado, donde este stage corre
    ANTES del Objective Analysis y solo recibe las fuentes materializadas.

    Los codigos de aplicacion son los mismos que F3.3B/F3.3B.2, con el mismo
    envelope `ai_service_error_v1`, porque el desenlace del run se decide igual:

        409 + EXECUTION_PLAN_MISMATCH         plan != configuracion desplegada
        502 + PROVIDER_INVALID_OUTPUT         respuesta completa que no cumple
        503 + PROVIDER_TRANSPORT_FAILURE      sin respuesta semantica utilizable
        424 + PROVIDER_CONFIGURATION_FAILURE  rechazo determinista del proveedor

    Un grounding set inutilizable NO llega al proveedor y tampoco es culpa suya:
    va como 422 sin envelope, igual que un request mal armado, porque describe un
    problema del llamante y no un desenlace del run.
    """
    if payload.schemaVersion != EVIDENCE_UNITS_REQUEST_SCHEMA_VERSION:
        raise HTTPException(status_code=422, detail="evidence_units_request_schema_unsupported")

    plan = EvidenceUnitsStageExecutionPlan(**payload.executionPlan.model_dump())
    try:
        return run_evidence_units(
            plan=plan,
            sources=[item.model_dump() for item in payload.sources],
        )
    except GroundingInputError as exc:
        # Sin envelope: el material congelado que mando NestJS no sirve, y eso no
        # es un hecho sobre el proveedor.
        raise HTTPException(
            status_code=422, detail=f"evidence_units_grounding_input_invalid:{exc}"
        ) from exc
    except EvidenceUnitsPlanMismatchError as exc:
        return application_error(
            EXECUTION_PLAN_MISMATCH, f"evidence_units_execution_plan_mismatch:{exc}"
        )
    except EvidenceUnitsInvalidOutputError as exc:
        return application_error(
            PROVIDER_INVALID_OUTPUT, f"evidence_units_invalid_provider_output:{exc}"
        )
    except EvidenceUnitsProviderConfigurationError as exc:
        return application_error(
            PROVIDER_CONFIGURATION_FAILURE,
            f"evidence_units_provider_configuration_failure:{exc}",
        )
    except EvidenceUnitsProviderUnavailableError as exc:
        return application_error(
            PROVIDER_TRANSPORT_FAILURE, f"evidence_units_provider_unavailable:{exc}"
        )
    except EvidenceUnitsTransportError as exc:
        return application_error(
            PROVIDER_TRANSPORT_FAILURE,
            f"evidence_units_provider_transport_failure:{exc}",
        )


def contextual_reasoning(payload: ContextualReasoningRequest) -> Any:
    """Razonamiento contextual productivo — UNA llamada por Requirement.

    La granularidad congelada del stage es una llamada por Requirement, no por
    run: `_context(case, requirement, ...)` es singular, el prompt dice "para un
    Requirement", el schema tiene `requirementId` string en el tope y el runtime
    congelado aborta con `PROVIDER_CALL_BUDGET_ANOMALY` si hay mas de uno. Por eso
    esta ruta atiende UN Requirement: NestJS recorre los suyos en orden del
    snapshot y corta en el primero que falla.

    "Unificado" es a traves de las DIMENSIONES DE JUICIO —relations, facets,
    composicion, ceiling, weaker claim, continuidad, utilidad, observabilidad se
    resuelven en una sola decision— no a traves de Requirements.

    NO EMITE ESTADO FINAL. `finalState`, `policyTrace` y `explanation` son de
    F3.6, determinista.

    Codigos de aplicacion, los mismos que las otras dos etapas:

        409 + EXECUTION_PLAN_MISMATCH         plan != configuracion desplegada
        502 + PROVIDER_INVALID_OUTPUT         respuesta completa que no cumple
        503 + PROVIDER_TRANSPORT_FAILURE      sin respuesta semantica utilizable
        424 + PROVIDER_CONFIGURATION_FAILURE  rechazo determinista del proveedor
    """
    if payload.schemaVersion != CONTEXTUAL_REASONING_REQUEST_SCHEMA_VERSION:
        raise HTTPException(
            status_code=422, detail="contextual_reasoning_request_schema_unsupported"
        )

    plan = ContextualStageExecutionPlan(**payload.executionPlan.model_dump())
    try:
        return run_contextual_reasoning(
            plan=plan,
            requirement=payload.requirement.model_dump(),
            objective_context=payload.objectiveContext,
            evidence_units=[item.model_dump() for item in payload.evidenceUnits],
            preparation=payload.preparation.model_dump(),
            sources=[item.model_dump() for item in payload.sources],
        )
    except ReasoningInputError as exc:
        # Sin envelope: el material que mando NestJS no sirve, y eso no es un
        # hecho sobre el proveedor.
        raise HTTPException(
            status_code=422, detail=f"contextual_reasoning_input_invalid:{exc}"
        ) from exc
    except ContextualPlanMismatchError as exc:
        return application_error(
            EXECUTION_PLAN_MISMATCH, f"contextual_reasoning_execution_plan_mismatch:{exc}"
        )
    except ContextualInvalidOutputError as exc:
        return application_error(
            PROVIDER_INVALID_OUTPUT, f"contextual_reasoning_invalid_provider_output:{exc}"
        )
    except ContextualProviderConfigurationError as exc:
        return application_error(
            PROVIDER_CONFIGURATION_FAILURE,
            f"contextual_reasoning_provider_configuration_failure:{exc}",
        )
    except ContextualProviderUnavailableError as exc:
        return application_error(
            PROVIDER_TRANSPORT_FAILURE, f"contextual_reasoning_provider_unavailable:{exc}"
        )
    except ContextualTransportError as exc:
        return application_error(
            PROVIDER_TRANSPORT_FAILURE,
            f"contextual_reasoning_provider_transport_failure:{exc}",
        )


def objective_requirement_proposal(payload: ObjectiveRequirementProposalRequest) -> Any:
    """Objective Understanding productivo — UNA llamada logica por Objective.

    PROPONE, NO CONFIRMA. Devuelve candidatos anclados en la fuente para que un
    humano los revise. No crea el Objective, no finaliza Requirements, no ejecuta
    Evidence Reasoning y no persiste nada — ni la propuesta, ni la respuesta cruda
    del proveedor.

    Evidence-blind: el request no admite credenciales, perfil, skills,
    EvidenceUnits ni ReasoningRuns, y `extra="forbid"` lo hace estructural.

    LOS FALLOS DE APLICACION LLEVAN `ai_service_error_v1`, con el vocabulario
    CERRADO de esta etapa. NO existe `EXECUTION_PLAN_MISMATCH`: no hay plan
    congelado de un tercero contra el cual divergir.

        413 + OBJECTIVE_TOO_LARGE
            el Objective no entra en UNA llamada
            -> no se trunca y no se segmenta; el llamante decide

        502 + PROVIDER_INVALID_OUTPUT
            el proveedor respondio ENTERO y su salida no cumple el contrato
            -> no se le vuelve a preguntar dentro de esta peticion

        503 + PROVIDER_TRANSPORT_FAILURE
            no se obtuvo respuesta utilizable, o falta configuracion
            -> como no hay nada persistido, el llamante puede volver a pedirla,
               y eso produce una observacion NUEVA

        424 + PROVIDER_CONFIGURATION_FAILURE
            el proveedor rechazo la peticion de forma DETERMINISTA
            -> repetir la misma peticion no puede funcionar

    El 422 de abajo NO lleva envelope: un `schemaVersion` que este borde no
    soporta es un problema del llamante, no un juicio sobre la propuesta.
    """
    if payload.schemaVersion != OBJECTIVE_UNDERSTANDING_REQUEST_SCHEMA_VERSION:
        raise HTTPException(
            status_code=422,
            detail="objective_requirement_proposal_request_schema_unsupported",
        )

    try:
        return run_objective_understanding(
            objective_type=payload.objectiveType,
            title=payload.title,
            raw_objective_text=payload.rawObjectiveText,
        )
    except ObjectiveTooLargeError as exc:
        return objective_understanding_error(
            OBJECTIVE_TOO_LARGE, f"objective_too_large:{exc}"
        )
    except ObjectiveInputError as exc:
        # Entrada invalida del llamante. Sin envelope, por la misma razon que el
        # 422 de schemaVersion: no es un desenlace de la propuesta.
        raise HTTPException(
            status_code=422, detail=f"objective_requirement_proposal_input_invalid:{exc}"
        ) from exc
    except ObjectiveUnderstandingInvalidOutputError as exc:
        return objective_understanding_error(
            PROVIDER_INVALID_OUTPUT,
            f"objective_understanding_invalid_provider_output:{exc}",
        )
    except ObjectiveUnderstandingConfigurationError as exc:
        return objective_understanding_error(
            PROVIDER_CONFIGURATION_FAILURE,
            f"objective_understanding_provider_configuration_failure:{exc}",
        )
    except ObjectiveUnderstandingUnavailableError as exc:
        # Falta configuracion productiva: el proveedor nunca vio nada. Colapsa con
        # el fallo de transporte porque la consecuencia es la misma —no hay
        # propuesta y volver a pedirla es legitimo.
        return objective_understanding_error(
            PROVIDER_TRANSPORT_FAILURE,
            f"objective_understanding_provider_unavailable:{exc}",
        )
    except ObjectiveUnderstandingTransportError as exc:
        return objective_understanding_error(
            PROVIDER_TRANSPORT_FAILURE,
            f"objective_understanding_provider_transport_failure:{exc}",
        )


def create_app(
    internal_auth_settings: InternalAuthSettings | None = None,
) -> FastAPI:
    settings = internal_auth_settings or load_internal_auth_settings()
    application = FastAPI(
        title="PFI AI Service",
        version="0.1.0",
        description="HTTP adapter over the existing semantic and formative-profile pipelines.",
    )
    application.state.internal_auth_settings = settings
    auth_dependency = Depends(require_internal_service)

    application.add_api_route("/health", health, methods=["GET"])
    application.add_api_route(
        "/v1/formative-profile/build",
        formative_profile_build,
        methods=["POST"],
        dependencies=[auth_dependency],
    )
    application.add_api_route(
        "/v1/semantic-analysis/pdf",
        semantic_analysis_pdf,
        methods=["POST"],
        dependencies=[auth_dependency],
    )
    application.add_api_route(
        "/v1/semantic-analysis/text",
        semantic_analysis_text,
        methods=["POST"],
        dependencies=[auth_dependency],
    )
    # F1.3: dos rutas explicitas en vez de un endpoint union. PDF y TEXT tienen
    # transportes distintos —multipart contra JSON— y mezclarlos obligaria a una
    # API con dos formas mutuamente excluyentes en el mismo contrato.
    application.add_api_route(
        "/v1/source-extraction/pdf",
        source_extraction_pdf,
        methods=["POST"],
        dependencies=[auth_dependency],
    )
    application.add_api_route(
        "/v1/source-extraction/text",
        source_extraction_text,
        methods=["POST"],
        dependencies=[auth_dependency],
    )
    # F3.3B: una sola ruta. La granularidad congelada es ONE_CALL_PER_OBJECTIVE,
    # asi que no existe un endpoint por Requirement.
    application.add_api_route(
        "/v1/objective-analysis",
        objective_analysis,
        methods=["POST"],
        dependencies=[auth_dependency],
    )
    # F3.4: una sola ruta, igual que la etapa 1. La granularidad congelada del
    # stage de EvidenceUnits es una llamada por run con TODAS las fuentes, asi que
    # no existe un endpoint por fuente.
    application.add_api_route(
        "/v1/evidence-units",
        evidence_units,
        methods=["POST"],
        dependencies=[auth_dependency],
    )
    # F3.5: una ruta que atiende UN Requirement. La granularidad congelada es una
    # llamada por Requirement, asi que el bucle vive en NestJS, que es quien puede
    # cortar en el primero que falla.
    application.add_api_route(
        "/v1/contextual-reasoning",
        contextual_reasoning,
        methods=["POST"],
        dependencies=[auth_dependency],
    )
    # P2.2: una sola ruta. La granularidad congelada y evaluada es
    # ONE_CALL_PER_OBJECTIVE, asi que no existe un endpoint por seccion ni por
    # Requirement, ni una llamada de reparacion de anclaje.
    application.add_api_route(
        "/v1/objective-requirement-proposal",
        objective_requirement_proposal,
        methods=["POST"],
        dependencies=[auth_dependency],
    )
    return application


app = create_app()

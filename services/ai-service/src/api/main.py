from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Annotated, Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status

from src.api.internal_auth import (
    InternalAuthSettings,
    load_internal_auth_settings,
    require_internal_service,
)
from src.api.models import FormativeProfileBuildRequest
from src.api.service import (
    InvalidPdfUploadError,
    UnsupportedVersionError,
    analyze_academic_pdf,
    build_formative_profile,
    save_pdf_upload,
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
    return application


app = create_app()

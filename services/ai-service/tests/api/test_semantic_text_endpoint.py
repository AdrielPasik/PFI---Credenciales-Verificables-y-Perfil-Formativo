from __future__ import annotations

from fastapi.testclient import TestClient

from src.api.internal_auth import InternalAuthSettings
from src.api.main import app, create_app


client = TestClient(app)

PYTHON_BOOTCAMP_CONTENT = (
    "The Complete Python Bootcamp From Zero to Hero in Python\n\n"
    "Learn Python like a Professional. Start from the basics and go all the "
    "way to creating your own applications and games."
)


def _text_request(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "content": PYTHON_BOOTCAMP_CONTENT,
        "metadata": {
            "platformName": "Plataforma de Cursos Demo",
            "hours": 22,
            "modality": "Online",
            "credentialType": "course",
            "languageHint": "en",
        },
        "sourceRefs": {
            "textEvidenceId": "text-evidence-demo",
            "credentialId": "credential-demo",
        },
        "requestedPipelineVersion": "unversioned_current",
        "requestedTaxonomyVersion": "unversioned_current",
    }
    payload.update(overrides)
    return payload


def test_text_endpoint_returns_semantic_analysis_v1() -> None:
    response = client.post("/v1/semantic-analysis/text", json=_text_request())

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["schemaVersion"] == "semantic_analysis_v1"
    assert body["sourceType"] == "text"
    assert isinstance(body["areas"], list)
    assert isinstance(body["skills"], list)
    assert isinstance(body["concepts"], list)
    assert isinstance(body["hoursDistribution"], list)


def test_text_endpoint_requires_internal_auth_like_pdf_endpoint() -> None:
    jwt_client = TestClient(
        create_app(
            InternalAuthSettings(
                mode="jwt",
                secret="internal-test-secret-that-is-not-a-user-secret-and-is-long-enough",
                issuer="traza-api",
                audience="traza-ai-service",
                clock_skew_seconds=0,
            )
        )
    )

    response = jwt_client.post("/v1/semantic-analysis/text", json=_text_request())

    assert response.status_code == 401
    assert response.json() == {"detail": "Internal service credential required."}


def test_text_endpoint_rejects_blank_content() -> None:
    response = client.post("/v1/semantic-analysis/text", json=_text_request(content="   \n\t  "))

    assert response.status_code == 422
    assert response.json()["detail"]


def test_text_endpoint_rejects_missing_content() -> None:
    payload = _text_request()
    del payload["content"]

    response = client.post("/v1/semantic-analysis/text", json=payload)

    assert response.status_code == 422


def test_text_endpoint_rejects_content_over_length_limit() -> None:
    response = client.post(
        "/v1/semantic-analysis/text",
        json=_text_request(content="x" * 30_001),
    )

    assert response.status_code == 422


def test_text_endpoint_rejects_external_url_in_metadata() -> None:
    payload = _text_request()
    payload["metadata"]["externalUrl"] = "https://example.com/course"  # type: ignore[index]

    response = client.post("/v1/semantic-analysis/text", json=payload)

    assert response.status_code == 422


def test_text_endpoint_respects_requested_pipeline_version() -> None:
    response = client.post(
        "/v1/semantic-analysis/text",
        json=_text_request(requestedPipelineVersion="future-version"),
    )

    assert response.status_code == 409
    assert "unversioned_current" in response.json()["detail"]


def test_text_endpoint_respects_requested_taxonomy_version() -> None:
    response = client.post(
        "/v1/semantic-analysis/text",
        json=_text_request(requestedTaxonomyVersion="future-taxonomy"),
    )

    assert response.status_code == 409
    assert "unversioned_current" in response.json()["detail"]


def test_text_endpoint_propagates_safe_source_refs() -> None:
    response = client.post("/v1/semantic-analysis/text", json=_text_request())

    assert response.status_code == 200
    source_refs = response.json()["sourceRefs"]
    assert source_refs["textEvidenceId"] == "text-evidence-demo"
    assert source_refs["credentialId"] == "credential-demo"
    assert source_refs["documentId"] == "text-evidence-demo"


def test_text_endpoint_python_bootcamp_case() -> None:
    response = client.post("/v1/semantic-analysis/text", json=_text_request())

    assert response.status_code == 200, response.text
    body = response.json()

    skill_labels = {skill["label"] for skill in body["skills"]}
    assert "Python" in skill_labels
    assert "Programming & Development" not in skill_labels

    python_skill = next(skill for skill in body["skills"] if skill["label"] == "Python")
    assert python_skill["confidenceMethod"] == "heuristic"
    assert python_skill["confidence"] is not None
    assert python_skill["confidence"] <= 0.45

    assert body["hoursDistribution"] == []
    assert body["confidence"]["global"] is None or body["confidence"]["global"] <= 0.45
    assert body["confidence"]["globalMethod"] in {"derived", "unavailable"}
    assert body["status"] == "partial"
    assert "short_unstructured_text" in body["qualityFlags"]

    # "Bootcamp" must never be read as evidence for "Manufactura y CAD/CAM"
    # (substring "cam") — regression guard for the infer_name_hints fix.
    area_labels = {area["label"] for area in body["areas"]}
    assert "Manufactura y CAD/CAM" not in area_labels
    assert body["areas"] == []


def test_text_endpoint_short_text_without_signals_does_not_invent_anything() -> None:
    response = client.post(
        "/v1/semantic-analysis/text",
        json=_text_request(
            content="Curso introductorio sobre temas variados de gestion general.",
            sourceRefs=None,
            metadata=None,
        ),
    )

    assert response.status_code == 200, response.text
    body = response.json()

    assert body["skills"] == []
    assert body["hoursDistribution"] == []
    assert body["status"] == "partial"
    assert "no_area_detected" in body["warnings"] or body["areas"] == []
    assert "short_unstructured_text" in body["qualityFlags"]
    assert "no_curricular_sections_detected" in body["qualityFlags"]


def test_pdf_endpoint_still_works_after_text_endpoint_changes() -> None:
    response = client.post("/v1/semantic-analysis/pdf")

    # No file provided -> 422, same as before this change (endpoint still wired).
    assert response.status_code == 422

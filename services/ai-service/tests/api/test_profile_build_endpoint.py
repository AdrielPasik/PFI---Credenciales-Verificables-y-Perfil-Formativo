from fastapi.testclient import TestClient

from src.api.main import app
from tests.profile_builder._fixtures import pdf_artifact


client = TestClient(app)


def test_profile_endpoint_uses_formative_profile_result_contract() -> None:
    response = client.post(
        "/v1/formative-profile/build",
        json={"artifacts": [pdf_artifact()]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["profileVersion"] == "formative_profile_result_v0"
    assert body["generatedFrom"]["artifactSchema"] == "semantic_analysis_v1"
    assert body["generatedFrom"]["artifactCount"] == 1
    assert "userId" not in body


def test_profile_endpoint_rejects_invalid_artifact() -> None:
    response = client.post(
        "/v1/formative-profile/build",
        json={"artifacts": [{"schemaVersion": "wrong_version"}]},
    )

    assert response.status_code == 422
    assert "invalid_semantic_analysis_v1" in response.json()["detail"]


def test_profile_endpoint_rejects_non_list_payload() -> None:
    response = client.post(
        "/v1/formative-profile/build",
        json={"artifacts": "not-a-list"},
    )

    assert response.status_code == 422


def test_profile_endpoint_rejects_malformed_nested_artifact() -> None:
    response = client.post(
        "/v1/formative-profile/build",
        json={"artifacts": [pdf_artifact(areas="not-a-list")]},
    )

    assert response.status_code == 422
    assert "invalid_semantic_analysis_v1_structure" in response.json()["detail"]

"""Wrapper productivo del proveedor — slice P2.2.

SIN SDK, igual que el resto de las etapas productivas: `urllib.request` de la
biblioteca estandar. `requirements-api.txt` no instala ningun SDK de proveedor, asi
que

    HIDDEN_PROVIDER_RETRIES: NONE, POR CONSTRUCCION

No hay una capa que pueda comprar observaciones adicionales del modelo por su
cuenta. Como la propuesta es transitoria y no persiste nada, un fallo transitorio
se resuelve repitiendo la peticion desde arriba — y eso produce una observacion
NUEVA, no la continuacion de la anterior.

UNA SOLA LLAMADA. `ONE_CALL_PER_OBJECTIVE` es parte de la topologia evaluada en
P2.1. No hay llamada por seccion, por Requirement, de reparacion de anclaje, de
deduplicacion semantica ni de traduccion.

MODELO SOLICITADO vs INFORMADO. `reported_model` es `None` cuando el proveedor no
informa modelo. No se rellena con el solicitado: colapsar los dos hechos haria que
el guard de modelo efectivo pasara vacuamente.

CONFIGURACION PROPIA DE LA ETAPA. Nombres dedicados, en el entorno del AI service
y solo ahi. Los VALORES nunca se loguean, ni viajan en la respuesta, ni llegan a
NestJS, ni aparecen en un mensaje de error.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any

from src.api.objective_understanding.contracts import (
    ObjectiveUnderstandingError,
    ProviderConfigurationError,
    ProviderInvalidOutputError,
    ProviderObservation,
    ProviderTransportError,
    ProviderUnavailableError,
)

ENV_API_KEY = "OBJECTIVE_UNDERSTANDING_OPENAI_API_KEY"
ENV_MODEL = "OBJECTIVE_UNDERSTANDING_OPENAI_MODEL"
ENV_BASE_URL = "OBJECTIVE_UNDERSTANDING_OPENAI_BASE_URL"
ENV_TIMEOUT = "OBJECTIVE_UNDERSTANDING_PROVIDER_TIMEOUT_SECONDS"

DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_TIMEOUT_SECONDS = 300


def configured_model() -> str:
    """El modelo que ESTE despliegue va a solicitar.

    Es configuracion de despliegue, no una constante de contrato. Si falta, la
    etapa no puede construir la peticion y el proveedor nunca ve nada.
    """
    model = (os.environ.get(ENV_MODEL) or "").strip()
    if not model:
        raise ProviderUnavailableError(f"missing_{ENV_MODEL}")
    return model


_DETERMINISTIC_ERROR_TYPES = frozenset(
    {
        "invalid_request_error",
        "authentication_error",
        "permission_error",
        "not_found_error",
        "permission_denied_error",
    }
)

_TRANSIENT_ERROR_TYPES = frozenset(
    {
        "rate_limit_error",
        "overloaded_error",
        "server_error",
        "service_unavailable_error",
    }
)

#: `408` y `429` son 4xx que SI son transitorios —timeout del lado del proveedor y
#: rate limit—, asi que no basta con "4xx es determinista".
_TRANSIENT_STATUSES = frozenset({408, 409, 425, 429})

#: Solo tokens de maquina. El cuerpo de error del proveedor puede traer prosa y
#: esa prosa no viaja a ningun lado.
_SAFE_TOKEN = re.compile(r"[a-z0-9_]{1,64}")


def _safe_token(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    candidate = value.strip().lower()
    return candidate if _SAFE_TOKEN.fullmatch(candidate) else None


def _structured_error_tokens(raw_body: str) -> tuple[str | None, str | None]:
    """Extrae `error.type` y `error.code` del cuerpo de error, si son tokens."""
    try:
        body = json.loads(raw_body)
    except (json.JSONDecodeError, TypeError):
        return None, None
    if not isinstance(body, dict):
        return None, None
    error = body.get("error")
    if not isinstance(error, dict):
        return None, None
    return _safe_token(error.get("type")), _safe_token(error.get("code"))


def classify_provider_http_failure(status: int, raw_body: str) -> ObjectiveUnderstandingError:
    """Traduce un fallo HTTP del proveedor a la categoria que le toca.

    Orden: tipo estructurado -> status. El detalle que viaja es un token cerrado
    construido aca, nunca el cuerpo del proveedor. Nunca se lee la prosa.
    """
    error_type, error_code = _structured_error_tokens(raw_body)
    detail = f"provider_http_{status}"
    if error_code:
        detail = f"{detail}:{error_code}"
    elif error_type:
        detail = f"{detail}:{error_type}"

    if error_type in _TRANSIENT_ERROR_TYPES:
        return ProviderTransportError(detail)
    if error_type in _DETERMINISTIC_ERROR_TYPES:
        return ProviderConfigurationError(detail)

    if status in _TRANSIENT_STATUSES:
        return ProviderTransportError(detail)
    if 400 <= status < 500:
        return ProviderConfigurationError(detail)
    return ProviderTransportError(detail)


class OpenAIObjectiveUnderstandingProvider:
    """Cliente minimo de la Responses API para salida estructurada."""

    def __init__(self) -> None:
        self._api_key = (os.environ.get(ENV_API_KEY) or "").strip()
        if not self._api_key:
            raise ProviderUnavailableError(f"missing_{ENV_API_KEY}")
        self._base_url = (os.environ.get(ENV_BASE_URL) or DEFAULT_BASE_URL).rstrip("/")
        self._timeout = int(os.environ.get(ENV_TIMEOUT) or DEFAULT_TIMEOUT_SECONDS)

    def complete(
        self,
        *,
        prompt: str,
        schema_name: str,
        schema: dict[str, Any],
        model: str,
        reasoning_effort: str,
    ) -> ProviderObservation:
        payload = {
            "model": model,
            "input": prompt,
            "store": False,
            "reasoning": {"effort": reasoning_effort},
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": schema_name,
                    "schema": schema,
                    "strict": True,
                }
            },
        }
        body = self._post(payload)

        reported = body.get("model")
        reported_model = (
            reported.strip() if isinstance(reported, str) and reported.strip() else None
        )
        return ProviderObservation(
            output=self._extract_structured_output(body),
            reported_model=reported_model,
        )

    # ------------------------------------------------------------------
    # Interno
    # ------------------------------------------------------------------

    def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        request = urllib.request.Request(
            f"{self._base_url}/responses",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {self._api_key}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            try:
                error_body = exc.read().decode("utf-8", errors="replace")
            except Exception:  # noqa: BLE001
                error_body = ""
            raise classify_provider_http_failure(exc.code, error_body) from exc
        except urllib.error.URLError as exc:
            raise ProviderTransportError("provider_network_error") from exc
        except TimeoutError as exc:
            raise ProviderTransportError("provider_timeout") from exc

        try:
            body = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ProviderInvalidOutputError("provider_body_not_json") from exc

        if not isinstance(body, dict):
            raise ProviderInvalidOutputError("provider_body_not_an_object")
        return body

    def _extract_structured_output(self, body: dict[str, Any]) -> dict[str, Any]:
        texts: list[str] = []
        for item in body.get("output") or []:
            if not isinstance(item, dict):
                continue
            for chunk in item.get("content") or []:
                if isinstance(chunk, dict) and isinstance(chunk.get("text"), str):
                    texts.append(chunk["text"])

        if not texts:
            raise ProviderInvalidOutputError("provider_output_text_missing")

        try:
            output = json.loads("".join(texts))
        except json.JSONDecodeError as exc:
            raise ProviderInvalidOutputError("provider_output_not_json") from exc

        if not isinstance(output, dict):
            raise ProviderInvalidOutputError("provider_output_not_an_object")
        return output

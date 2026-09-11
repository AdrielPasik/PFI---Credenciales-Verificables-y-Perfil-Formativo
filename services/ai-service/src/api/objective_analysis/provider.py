"""Wrapper productivo del proveedor — slice F3.3B.

SIN SDK, A PROPOSITO. Se usa `urllib.request` de la biblioteca estandar, igual
que el wrapper congelado. Auditado: `requirements-api.txt` no instala ningun SDK
de proveedor —solo fastapi, uvicorn, python-multipart y PyJWT—, asi que

    HIDDEN_PROVIDER_RETRIES: NONE, POR CONSTRUCCION

No hay una capa que pueda comprar observaciones adicionales del modelo por su
cuenta. La politica de reintentos pertenece enteramente al contrato de
orquestacion, y ese es justamente el punto: un reintento invisible seria un
intento al proveedor que el plan de ejecucion no describe.

MODELO SOLICITADO vs INFORMADO. El wrapper congelado hacia

    effective_model = str(response.get("model") or self.model)

y ese `or self.model` COLAPSA dos hechos distintos: "el proveedor informo un
modelo" y "no informo ninguno". Con esa forma, el guard de modelo efectivo pasaria
VACUAMENTE cuando la respuesta no trae `model`. Aca se distinguen: `reported_model`
es `None` cuando el proveedor no informo nada, y quien decide es el llamador.

FALLO DETERMINISTA CONTRA TRANSITORIO (F3.3B.2). Un `HTTPError` NO es por
definicion transitorio. Un modelo inexistente, una credencial invalida o una
peticion rechazada estructuralmente van a fallar igual cuantas veces se repitan
bajo el MISMO plan congelado, asi que se separan en `ProviderConfigurationError`.
Se clasifica por el tipo estructurado que informa el proveedor y, como respaldo,
por el status. Nunca por el texto del mensaje.

Sin fallback de proveedor. Sin fallback de modelo. Sin fallback de effort.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any

from src.api.objective_analysis.contracts import (
    ObjectiveAnalysisError,
    ProviderConfigurationError,
    ProviderInvalidOutputError,
    ProviderObservation,
    ProviderTransportError,
    ProviderUnavailableError,
    StageExecutionPlan,
)

#: Nombres de variables de entorno. Los VALORES viven solo en el entorno del AI
#: service y nunca se loguean, ni viajan en la respuesta, ni llegan a NestJS.
ENV_API_KEY = "OBJECTIVE_ANALYSIS_OPENAI_API_KEY"
ENV_MODEL = "OBJECTIVE_ANALYSIS_OPENAI_MODEL"
ENV_BASE_URL = "OBJECTIVE_ANALYSIS_OPENAI_BASE_URL"
ENV_TIMEOUT = "OBJECTIVE_ANALYSIS_PROVIDER_TIMEOUT_SECONDS"

DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_TIMEOUT_SECONDS = 180


def configured_model() -> str:
    """El modelo que ESTE despliegue va a solicitar.

    Es configuracion de despliegue, no una constante de contrato: por eso el plan
    congelado lo lleva por run y el guard lo compara antes de cada llamada.
    """
    model = (os.environ.get(ENV_MODEL) or "").strip()
    if not model:
        raise ProviderUnavailableError(f"missing_{ENV_MODEL}")
    return model


#: FALLO DETERMINISTA CONTRA FALLO TRANSITORIO — F3.3B.2.
#:
#: La diferencia decide el destino del run, asi que no puede quedar en "todo
#: HTTPError es transitorio", que es lo que el wrapper hacia antes. Con esa forma,
#: un modelo inexistente —`404`— dejaba el run `pending` reintentando para siempre
#: un plan que nunca puede funcionar.
#:
#: Se prefiere el TIPO ESTRUCTURADO que informa el proveedor cuando existe, y solo
#: se cae al status como respaldo. Nunca se lee la prosa del mensaje.
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

#: Respaldo por status. `408` y `429` son 4xx que SI son transitorios —timeout del
#: lado del proveedor y rate limit—, asi que no basta con "4xx es determinista".
_TRANSIENT_STATUSES = frozenset({408, 409, 425, 429})

#: Solo tokens de maquina. Un valor que no tenga esta forma se descarta en vez de
#: viajar: el cuerpo de error del proveedor puede traer prosa.
_SAFE_TOKEN = re.compile(r"[a-z0-9_]{1,64}")


def _safe_token(value: object) -> str | None:
    """Devuelve el valor SOLO si es un token de maquina. Nunca prosa."""
    if not isinstance(value, str):
        return None
    candidate = value.strip().lower()
    return candidate if _SAFE_TOKEN.fullmatch(candidate) else None


def _structured_error_tokens(raw_body: str) -> tuple[str | None, str | None]:
    """Extrae `error.type` y `error.code` del cuerpo de error, si son tokens.

    Devuelve `(None, None)` para un cuerpo vacio, no-JSON, HTML o con una forma
    que no reconocemos. En ese caso la clasificacion cae al status: no se inventa
    un hecho estructurado que el proveedor no dio.
    """
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


def classify_provider_http_failure(status: int, raw_body: str) -> ObjectiveAnalysisError:
    """Traduce un fallo HTTP del proveedor a la categoria productiva que le toca.

    Orden: tipo estructurado -> status. Y el detalle que viaja es un token cerrado
    construido aca, nunca el cuerpo del proveedor.
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
        # Un 4xx sin tipo estructurado igual es determinista para ESTE plan: el
        # mismo request va a ser rechazado igual. Incluye el caso de una base URL
        # mal configurada que devuelve 404 opaco.
        return ProviderConfigurationError(detail)
    return ProviderTransportError(detail)


class OpenAIObjectiveAnalysisProvider:
    """Cliente minimo de la Responses API para salida estructurada."""

    def __init__(self) -> None:
        self._api_key = (os.environ.get(ENV_API_KEY) or "").strip()
        if not self._api_key:
            raise ProviderUnavailableError(f"missing_{ENV_API_KEY}")
        self._base_url = (
            os.environ.get(ENV_BASE_URL) or DEFAULT_BASE_URL
        ).rstrip("/")
        self._timeout = int(
            os.environ.get(ENV_TIMEOUT) or DEFAULT_TIMEOUT_SECONDS
        )

    def complete(
        self,
        *,
        prompt: str,
        schema_name: str,
        schema: dict[str, Any],
        plan: StageExecutionPlan,
    ) -> ProviderObservation:
        payload = {
            "model": plan.model,
            "input": prompt,
            "store": False,
            "reasoning": {"effort": plan.reasoningEffort},
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

        # `model` puede no venir. NO se rellena con el solicitado.
        reported = body.get("model")
        reported_model = reported.strip() if isinstance(reported, str) and reported.strip() else None

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
            # Una sola llamada. `urlopen` no reintenta por su cuenta.
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                raw = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            # El cuerpo se LEE para clasificar por su tipo estructurado, pero NO
            # se propaga: puede traer prosa del proveedor.
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
            # Se recibio una respuesta completa que no es JSON. Eso NO es un fallo
            # de transporte: el proveedor contesto y su salida no sirve.
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

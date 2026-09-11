"""Wrapper productivo del proveedor para EvidenceUnits — slice F3.4.

Misma disciplina que F3.3B, y la clasificacion de fallos HTTP se REUTILIZA en vez
de reimplementarse: dos taxonomias sutilmente distintas para el mismo proveedor
serian una fuente de divergencia silenciosa, y F3.3B.2 ya adjudico la separacion
entre fallo transitorio y fallo determinista.

CONFIGURACION POR ETAPA. Variables propias, no compartidas con Objective Analysis:
el plan congelado tiene una entrada por etapa justamente para que un despliegue
pueda darles modelos distintos sin migracion.

    EVIDENCE_UNITS_OPENAI_API_KEY
    EVIDENCE_UNITS_OPENAI_MODEL
    EVIDENCE_UNITS_OPENAI_BASE_URL              opcional
    EVIDENCE_UNITS_PROVIDER_TIMEOUT_SECONDS     opcional

Sin fallback a las variables `ER_*` del experimento: ese arbol es investigacion
congelada, y dejar que su credencial alimente produccion volveria decorativa la
frontera que P1 puso.

Sin SDK, igual que F3.3B: `urllib.request` de la biblioteca estandar, asi que
`HIDDEN_PROVIDER_RETRIES: NONE, POR CONSTRUCCION`.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

from src.api.evidence_units.contracts import (
    ProviderConfigurationError,
    ProviderInvalidOutputError,
    ProviderObservation,
    ProviderTransportError,
    ProviderUnavailableError,
    StageExecutionPlan,
)
from src.api.objective_analysis.provider import (
    classify_provider_http_failure as _classify_shared,
)
from src.api.objective_analysis.contracts import (
    ProviderConfigurationError as _SharedConfigurationError,
)

ENV_API_KEY = "EVIDENCE_UNITS_OPENAI_API_KEY"
ENV_MODEL = "EVIDENCE_UNITS_OPENAI_MODEL"
ENV_BASE_URL = "EVIDENCE_UNITS_OPENAI_BASE_URL"
ENV_TIMEOUT = "EVIDENCE_UNITS_PROVIDER_TIMEOUT_SECONDS"

DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_TIMEOUT_SECONDS = 180


def configured_model() -> str:
    """El modelo que ESTE despliegue va a solicitar para la etapa 2."""
    model = (os.environ.get(ENV_MODEL) or "").strip()
    if not model:
        raise ProviderUnavailableError(f"missing_{ENV_MODEL}")
    return model


def classify_http_failure(status: int, raw_body: str) -> Exception:
    """Traduce el fallo HTTP a la categoria de ESTA etapa.

    La decision —determinista contra transitorio— se delega en el clasificador de
    F3.3B.2 para que exista UNA sola regla; solo se re-tipa al espacio de errores
    de esta etapa.
    """
    shared = _classify_shared(status, raw_body)
    detail = str(shared)
    if isinstance(shared, _SharedConfigurationError):
        return ProviderConfigurationError(detail)
    return ProviderTransportError(detail)


class OpenAIEvidenceUnitsProvider:
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

        # `model` puede no venir. NO se rellena con el solicitado: ausencia e
        # igualdad son hechos distintos.
        reported = body.get("model")
        reported_model = (
            reported.strip() if isinstance(reported, str) and reported.strip() else None
        )
        return ProviderObservation(
            output=self._extract_structured_output(body), reported_model=reported_model
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
            raise classify_http_failure(exc.code, error_body) from exc
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

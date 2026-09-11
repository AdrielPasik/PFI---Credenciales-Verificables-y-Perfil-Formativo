"""Superficie de error de Objective Understanding — slice P2.2.

REUSA EL SCHEMA `ai_service_error_v1`, NO EL VOCABULARIO DE F3. La forma del
envelope es la misma —`schemaVersion` + `code` cerrado + `message` que no
clasifica— y los cuatro codigos compartidos conservan exactamente su significado.

POR QUE UN VOCABULARIO PROPIO Y NO UNA ENTRADA MAS EN `error_envelope.py`. Ese
modulo documenta su vocabulario como "desenlaces del RUN", y un test congelado de
F3.3B fija su tamano en cuatro. P2.2 no tiene run: su unico codigo nuevo
—`OBJECTIVE_TOO_LARGE`— no es un desenlace de ningun ReasoningRun. Meterlo alli
romperia el test de F3 y, peor, contradiria la invariante que ese archivo declara
sobre si mismo.

    EXECUTION_PLAN_MISMATCH NO EXISTE EN ESTA ETAPA

y no por olvido: no hay un plan congelado de un tercero contra el cual divergir.
La identidad de etapa la declara este servicio y NestJS la verifica contra sus
propias constantes; una discrepancia ahi la reporta NestJS, no el AI service.
"""

from __future__ import annotations

from typing import Any

from fastapi import status
from fastapi.responses import JSONResponse

from src.api.error_envelope import (
    ERROR_SCHEMA_VERSION,
    PROVIDER_CONFIGURATION_FAILURE,
    PROVIDER_INVALID_OUTPUT,
    PROVIDER_TRANSPORT_FAILURE,
)

#: Codigo propio de esta etapa. El Objective excede lo que puede procesarse en UNA
#: llamada. No se trunca y no se segmenta: truncar cambiaria el Objective sin que
#: nadie lo sepa, y segmentar romperia la topologia evaluada.
OBJECTIVE_TOO_LARGE = "OBJECTIVE_TOO_LARGE"

#: Vocabulario CERRADO de la etapa. Sin `OTHER`, sin `UNKNOWN`.
OBJECTIVE_UNDERSTANDING_ERROR_CODES = (
    PROVIDER_INVALID_OUTPUT,
    PROVIDER_TRANSPORT_FAILURE,
    PROVIDER_CONFIGURATION_FAILURE,
    OBJECTIVE_TOO_LARGE,
)

#: Correspondencia CONGELADA status <-> code, biyectiva igual que la de F3: un par
#: incoherente significa que la frontera emite un contrato internamente
#: inconsistente y el consumidor debe descartarlo.
#:
#: `413` para el Objective demasiado grande: es una afirmacion sobre la ENTRADA,
#: no sobre el proveedor, y por eso no puede compartir status con ninguno de los
#: tres codigos de proveedor.
STATUS_BY_CODE: dict[str, int] = {
    PROVIDER_INVALID_OUTPUT: status.HTTP_502_BAD_GATEWAY,
    PROVIDER_TRANSPORT_FAILURE: status.HTTP_503_SERVICE_UNAVAILABLE,
    PROVIDER_CONFIGURATION_FAILURE: status.HTTP_424_FAILED_DEPENDENCY,
    # 413. Se escribe el numero para no atarse al nombre de la constante de
    # Starlette, que cambio entre versiones (`HTTP_413_REQUEST_ENTITY_TOO_LARGE`
    # quedo deprecado a favor de `HTTP_413_CONTENT_TOO_LARGE`).
    OBJECTIVE_TOO_LARGE: 413,
}


def objective_understanding_error(code: str, message: str | None = None) -> JSONResponse:
    """Construye la respuesta de error para un codigo cerrado de esta etapa.

    El status NO se elige por separado: sale de `STATUS_BY_CODE`. `message` es
    prosa para un log y no clasifica; nunca lleva texto del Objective, ni la
    respuesta cruda del proveedor, ni valores de configuracion, ni un secreto.
    """
    if code not in STATUS_BY_CODE:
        raise ValueError(f"unknown objective understanding error code: {code}")

    body: dict[str, Any] = {"schemaVersion": ERROR_SCHEMA_VERSION, "code": code}
    if message is not None:
        body["message"] = message

    return JSONResponse(status_code=STATUS_BY_CODE[code], content=body)

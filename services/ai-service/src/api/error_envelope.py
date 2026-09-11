"""Envelope de error de aplicacion — slice F3.3B.1.

    ai_service_error_v1

    {
      "schemaVersion": "ai_service_error_v1",
      "code": <token cerrado>,
      "message": <texto humano OPCIONAL, que NO clasifica>
    }

EL PROBLEMA QUE ESTO RESUELVE. Hasta F3.3B, NestJS derivaba el desenlace del run
del status HTTP a secas:

    502 -> PROVIDER_INVALID_OUTPUT -> el run muere

Y eso hacia representable un hecho FALSO. Un `502` puede venir de un proxy, de un
gateway, de un balanceador o de cualquier pieza de infraestructura que jamas
ejecuto Objective Analysis. Ese 502 no demuestra

    el proveedor devolvio una respuesta semantica completa
    Y
    el Objective Analysis productivo la rechazo

pero el run moria como si lo demostrara. Matar un run es destruir trabajo: la
afirmacion que lo justifica tiene que venir de nuestra aplicacion, no de la capa
de transporte.

DE AHI LA REGLA CONGELADA:

    HTTP_STATUS_ALONE_TERMINAL: NO

El status sigue siendo util como status. La AUTORIDAD SEMANTICA es el `code`, y
solo cuenta cuando viene dentro de este envelope y es coherente con el status.

QUE NO LLEVA, NUNCA. Ni `requirementText`, ni `objectiveContext`, ni la respuesta
cruda del proveedor, ni el prompt, ni la salida del modelo, ni un stack trace, ni
un secreto. `message` es prosa para un humano que lee un log; el unico campo que
decide algo es `code`.
"""

from __future__ import annotations

from typing import Any

from fastapi import status
from fastapi.responses import JSONResponse

ERROR_SCHEMA_VERSION = "ai_service_error_v1"

#: Vocabulario CERRADO. Sin `OTHER` y sin `UNKNOWN`: un catch-all terminal seria
#: exactamente la ambiguedad que este contrato existe para eliminar. Cualquier
#: cosa que no encaje aca NO es un desenlace del run, y por eso no necesita —ni
#: puede tener— un token propio.
EXECUTION_PLAN_MISMATCH = "EXECUTION_PLAN_MISMATCH"
PROVIDER_INVALID_OUTPUT = "PROVIDER_INVALID_OUTPUT"
PROVIDER_TRANSPORT_FAILURE = "PROVIDER_TRANSPORT_FAILURE"
#: F3.3B.2. El proveedor rechazo la peticion de forma DETERMINISTA: repetir el
#: mismo plan no puede dar otro resultado. Se separa de
#: `PROVIDER_TRANSPORT_FAILURE` porque la consecuencia es la opuesta —aquel deja
#: el run reintentable, este lo mata—, y confundirlos dejaria runs reintentando
#: para siempre una configuracion que nunca va a funcionar.
PROVIDER_CONFIGURATION_FAILURE = "PROVIDER_CONFIGURATION_FAILURE"

APPLICATION_ERROR_CODES = (
    EXECUTION_PLAN_MISMATCH,
    PROVIDER_INVALID_OUTPUT,
    PROVIDER_TRANSPORT_FAILURE,
    PROVIDER_CONFIGURATION_FAILURE,
)

#: Correspondencia CONGELADA status <-> code. Es biyectiva a proposito: un par
#: incoherente —`502` con `EXECUTION_PLAN_MISMATCH`, por ejemplo— significa que la
#: frontera esta emitiendo un contrato internamente inconsistente, y el consumidor
#: debe descartarlo en vez de elegir cual de las dos mitades creer.
STATUS_BY_CODE: dict[str, int] = {
    EXECUTION_PLAN_MISMATCH: status.HTTP_409_CONFLICT,
    PROVIDER_INVALID_OUTPUT: status.HTTP_502_BAD_GATEWAY,
    PROVIDER_TRANSPORT_FAILURE: status.HTTP_503_SERVICE_UNAVAILABLE,
    # 424 Failed Dependency: la dependencia de la que depende esta etapa esta
    # mal configurada. Necesita un status PROPIO —la tabla es biyectiva— y no
    # puede compartir el 503 del fallo transitorio, que significa lo contrario.
    PROVIDER_CONFIGURATION_FAILURE: status.HTTP_424_FAILED_DEPENDENCY,
}


def application_error(code: str, message: str | None = None) -> JSONResponse:
    """Construye la respuesta de error de aplicacion para un codigo cerrado.

    El status NO se elige por separado: sale de `STATUS_BY_CODE`. Permitir que el
    llamador pasara los dos abriria la puerta a emitir justamente el par
    incoherente que el consumidor tiene que rechazar.
    """
    if code not in STATUS_BY_CODE:
        raise ValueError(f"unknown application error code: {code}")

    body: dict[str, Any] = {"schemaVersion": ERROR_SCHEMA_VERSION, "code": code}
    if message is not None:
        body["message"] = message

    return JSONResponse(status_code=STATUS_BY_CODE[code], content=body)

# ADR 0008 - AI service transport and authentication

## Estado

Aceptado para P4i/P5.

## Contexto

NestJS ya consume FastAPI por HTTP. El deployment debe impedir acceso directo
del navegador y separar identidad humana de identidad servicio-a-servicio.

## Decision

Usar HTTP privado entre servicios y un JWT interno distinto del JWT de
usuarios. Validar `iss`, `aud`, `sub`, `iat`, `exp` y `jti`, expiracion corta,
algoritmo fijo, rotacion current/previous y correlation IDs.

## Consecuencias

- FastAPI valida auth antes del payload;
- NestJS conserva permisos, ownership y persistencia;
- los access tokens de usuarios no se propagan a FastAPI;
- Render guarda secretos separados;
- produccion futura debe preferir workload identity o mTLS.

## Alternativas consideradas

- reutilizar JWT de usuario: mezcla dominios de autoridad;
- secreto estatico en header: menor trazabilidad/expiracion;
- FastAPI publico protegido solo por CORS: CORS no es autenticacion;
- mTLS/workload identity ahora: demasiado operativo para demo.


# Lifecycle de analisis v0

## Proposito

Definir un lifecycle operacional para analisis IA sin mezclarlo con el estado de
la credencial ni introducir infraestructura asincrona antes de medirla.

## Decision

P5b incorporara un modelo futuro `AnalysisRun` y procesamiento sincrono
controlado para Entrega 50%. El request crea el run, lo marca `running`, invoca
FastAPI y termina en `completed`, `partial` o `failed`.

`AnalysisRun` no existe hoy en Prisma. P4d solo documenta el contrato.

```text
requested -> running -> completed
                     -> partial
                     -> failed
```

`queued` se reserva para la evolucion con worker. No se agregan Redis, Kafka ni
colas en P5 inicial.

## Datos futuros minimos

- `id`, `credentialId`, `requestedByUserId` y `analysisMode`;
- status, `startedAt`, `completedAt` y error seguro;
- `correlationId` e `idempotencyKey`;
- pipeline/taxonomy version;
- cantidad de intentos y duracion;
- relacion con artifacts persistidos y fuentes exactas.

La idempotency key debe derivarse de credencial, referencias/hashes de fuentes,
modo y versiones del pipeline. Una reejecucion forzada debe ser explicita.

## Timeouts y retries iniciales

| Operacion | Timeout inicial | Retry |
| --- | --- | --- |
| Conexion | 5 s | incluido en retry controlado |
| Texto | 30 s | maximo 1 para network/502/503/504 |
| Documento/combinado | 60 s | maximo 1 para network/502/503/504 |

No reintentar `400`, `401`, `403`, `409` o `422` automaticamente.

## Evolucion asincrona

Luego de medir duracion, volumen y fallos, el trigger podra responder `202`, un
worker reclamara runs con lease y el frontend consultara estado. La cola no debe
cambiar la identidad de fuente ni el schema del artifact.

## Alcance

- lifecycle operacional separado de `Credential.status`;
- ejecucion sincrona auditable para demo;
- idempotencia y fallos seguros;
- camino compatible con worker posterior.

## Fuera de alcance

- implementar `AnalysisRun` o migracion;
- cola, scheduler, worker, Redis o Kafka;
- progreso porcentual inventado;
- cancelacion distribuida;
- readiness o emision automatica.

## Impacto en modulos actuales

P5b afectara Prisma y un modulo de orquestacion; `SemanticAnalysis` seguira
representando el resultado oficial, no el job operacional.

## Riesgos

- runs detenidos en `running` tras crash;
- duplicados por retry;
- request HTTP demasiado largo;
- exponer errores internos;
- confundir run fallido con credencial invalida.

## Proximos slices relacionados

P5b ejecucion sincrona, P5g UI de estado y P9 worker asincrono posterior.


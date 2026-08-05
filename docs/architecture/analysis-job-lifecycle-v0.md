# Lifecycle de analisis v0

## Proposito

Definir un lifecycle operacional para analisis IA sin mezclarlo con el estado de
la credencial ni introducir infraestructura asincrona antes de medirla.

## Decision

P5a implementa `AnalysisRun` y `AnalysisRunSource` como foundation de
persistencia, sin ejecutar IA. El servicio interno crea un run `pending` y
captura referencias y hashes de las evidencias `current` exactas. P5b/P5c
agregaran ejecucion y transiciones controladas. `partial` pertenece al artifact
semantico, no al lifecycle operacional del run.

```text
pending -> running -> completed
                   -> failed
        -> canceled
```

`queued` se reserva para la evolucion con worker. No se agregan Redis, Kafka ni
colas en P5 inicial.

## Datos implementados

- `id`, `credentialId`, `requestedByUserId` e `inputMode`;
- status, `startedAt`, `completedAt` y error seguro;
- pipeline/taxonomy version;
- fuentes exactas, hash persistido y estado al crear;
- relacion opcional desde `SemanticAnalysis`.

El actor es requerido para trigger `manual` y puede ser null para `system`.
`combined` exige documento y texto current; no degrada a otro modo.

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

- ejecutar FastAPI o leer contenido/storage;
- transiciones del run en P5a;
- cola, scheduler, worker, Redis o Kafka;
- progreso porcentual inventado;
- cancelacion distribuida;
- readiness o emision automatica.

## Impacto en modulos actuales

P5a agrega Prisma y un servicio interno sin controller. `SemanticAnalysis`
sigue representando el resultado oficial, no el job operacional.

## Riesgos

- runs detenidos en `running` tras crash;
- duplicados por retry;
- request HTTP demasiado largo;
- exponer errores internos;
- confundir run fallido con credencial invalida.

## Proximos slices relacionados

P5b ejecucion sincrona, P5g UI de estado y P9 worker asincrono posterior.

# Lifecycle de analisis v0

## Proposito

Definir un lifecycle operacional para analisis IA sin mezclarlo con el estado de
la credencial ni introducir infraestructura asincrona antes de medirla.

## Decision

P5a implementa `AnalysisRun` y `AnalysisRunSource` como foundation de
persistencia. P5b agrega la ejecucion interna sincronica para runs `document`:
reclama el run `pending`, lee la evidencia exacta capturada y persiste el
resultado semantico antes de completar el run. `partial` pertenece al artifact
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

La ejecucion P5b separa tres tramos cortos: claim transaccional, lectura de
storage y llamada HTTP fuera de transaccion, y completion transaccional. Ante
un fallo posterior al claim, registra `failed` con codigo y mensaje
sanitizados. Un artifact semantico `partial` persistido correctamente deja el
run en `completed`.

## Fuera de alcance

- ejecucion de modos `text` o `combined`;
- cola, scheduler, worker, Redis o Kafka;
- endpoint generico/publico o frontend de ejecucion;
- progreso porcentual inventado;
- cancelacion distribuida;
- readiness o emision automatica.

## Impacto en modulos actuales

P5a agrega Prisma, P5b el ejecutor interno y P5c un trigger HTTP protegido y
scoped por issuer para admin/operator. El trigger crea un run manual document
con actor y versiones controlados por NestJS; ignora el body como fuente de
identidad o configuracion.
`SemanticAnalysis` sigue representando el resultado oficial, queda asociado
mediante `analysisRunId` y no reemplaza el lifecycle operacional.

## Riesgos

- runs detenidos en `running` tras crash;
- duplicados por retry;
- request HTTP demasiado largo;
- exponer errores internos;
- confundir run fallido con credencial invalida.

## Proximos slices relacionados

P5d/P5e agregaran modos restantes, P5g la UI de estado y P9 un worker
asincrono posterior.

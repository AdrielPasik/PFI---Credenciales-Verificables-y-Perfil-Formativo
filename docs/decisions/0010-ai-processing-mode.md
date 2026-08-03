# ADR 0010 - AI processing mode

## Estado

Aceptado para Entrega 50%.

## Contexto

El analisis necesita lifecycle, idempotencia y errores auditables, pero aun no
existen mediciones que justifiquen una cola o worker.

## Decision

Introducir `AnalysisRun` y procesamiento sincrono controlado en P5b. Persistir
`running` y finalizar en `completed`, `partial` o `failed`. Postergar `queued`,
worker, lease y polling hasta medir latencia/volumen.

## Consecuencias

- P5b requiere migracion Prisma;
- el request queda sujeto a timeouts controlados;
- idempotency key evita duplicados;
- un crash puede dejar runs stale y requiere recuperacion posterior;
- el futuro worker reutilizara run, fuentes y artifacts.

## Alternativas consideradas

- llamada sin `AnalysisRun`: insuficiente para trazabilidad;
- cola/worker desde P5: complejidad prematura;
- procesamiento automatico al subir: costo y comportamiento inesperado;
- job en FastAPI con persistencia propia: rompe autoridad backend.


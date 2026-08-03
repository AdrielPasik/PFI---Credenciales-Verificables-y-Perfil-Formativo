# ADR 0009 - AI document delivery mode

## Estado

Aceptado para P5 inicial.

## Contexto

FastAPI debe analizar una `DocumentEvidence` privada sin conocer S3 ni resolver
ownership. El limite actual de upload es compatible con un doble salto
controlado para la demo.

## Decision

NestJS resuelve la evidencia, lee bytes mediante `DocumentStoragePort` y los
envia a FastAPI como multipart binario. No se usa base64 JSON, presigned URL ni
credenciales S3 en FastAPI.

## Consecuencias

- funciona con storage local y S3;
- NestJS controla fuente exacta, auth y limites;
- hay transferencia y memoria adicionales en NestJS;
- P5a requiere capacidad de lectura en el port;
- presigned GET puede evaluarse con worker/volumen mayor.

## Alternativas consideradas

- presigned GET para FastAPI: eficiente pero acopla el contrato al storage;
- endpoint NestJS de streaming interno: salto adicional sin beneficio inicial;
- FastAPI con AWS credentials: amplia superficie de secretos;
- base64 en JSON: aumenta payload y uso de memoria.


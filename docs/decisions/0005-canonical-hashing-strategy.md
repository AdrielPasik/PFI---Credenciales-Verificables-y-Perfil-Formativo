# ADR 0005 - Canonical Hashing Strategy

## Contexto

El proyecto necesita vincular una credencial completa off-chain con evidencia minima on-chain sin que diferencias de serializacion, metadata mutable o datos operativos alteren el resultado verificable.

## Decision

Usar una representacion canonica versionada de la credencial para calcular un hash reproducible, excluyendo datos operativos, semanticos, blockchain, auditoria y metadata mutable. Ese hash funcionara como puente entre `credential_v1` off-chain y `blockchain_record_v1` on-chain.

## Justificacion

- evita que cambios irrelevantes del almacenamiento modifiquen el hash;
- permite recalculo deterministico en backend durante emision y verificacion;
- conserva separacion clara entre hecho educativo emitido y estado operativo del sistema;
- facilita evolucion controlada mediante `canonicalization_version`.

## Consecuencias

- el backend debe centralizar la canonizacion y el calculo del hash;
- en v0 el calculo ocurre off-chain y el contrato Solidity no lo recalcula;
- blockchain solo persiste o compara el valor equivalente a `bytes32`;
- los schemas deben almacenar el resultado y su version de canonizacion;
- `hash_algorithm` documenta esta decision y permite evolucion controlada;
- una credencial `draft` puede existir sin hash definitivo hasta su emision;
- cualquier cambio en reglas de canonizacion exigira versionado explicito;
- si en el futuro se migra a `keccak256`, ese cambio debera introducirse mediante nueva `canonicalization_version` o nueva ADR.

## Alternativas descartadas

- calcular hash sobre el JSON persistido completo;
- incluir metadata mutable o resultados semanticos en el hash;
- delegar el calculo al frontend;
- usar blockchain como origen de verdad del contenido completo de la credencial.

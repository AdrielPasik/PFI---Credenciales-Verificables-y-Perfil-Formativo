# ADR 0002 - Separacion Off-chain / On-chain

## Contexto

Las credenciales educativas contienen datos personales y academicos que no deben exponerse ni quedar inmovilizados en blockchain. Al mismo tiempo, se necesita evidencia verificable y resistente a manipulacion.

## Decision

Mantener on-chain solo evidencia minima verificable y conservar off-chain el contenido completo de credenciales, analisis y perfiles.

## Justificacion

- reduce exposicion de datos sensibles;
- evita costos innecesarios de almacenamiento on-chain;
- permite actualizar metadatos y enriquecer informacion off-chain;
- conserva trazabilidad mediante hashes y estados verificables.

## Consecuencias

- el backend debe garantizar la relacion entre dato completo y evidencia blockchain;
- la estrategia de hashing y canonizacion se vuelve critica;
- la verificacion siempre combina consulta local y consulta on-chain.

## Alternativas descartadas

- almacenar la credencial completa en blockchain;
- usar blockchain como unica base de datos del sistema;
- exponer datos personales o academicos completos on-chain.

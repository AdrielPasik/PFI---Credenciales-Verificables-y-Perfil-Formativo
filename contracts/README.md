# Smart Contracts

Modulo blockchain del proyecto basado en Solidity + Foundry.

## Objetivo

Registrar evidencia minima verificable on-chain sin almacenar el contenido completo de las credenciales.

## Alcance implementado

- contrato `CredentialRegistry.sol`;
- registro on-chain de hashes de credenciales;
- revocacion on-chain del hash por el registrant original;
- consulta simple de estado por hash;
- tests locales con Forge.
- herramientas locales con Anvil;
- manifiesto canónico de despliegue en Base Sepolia;
- integración backend de lectura, escritura, preflight y reconciliación mediante
  `ethers`.

## Activacion y verificacion pendientes

- comprobación directa del contrato y de la transacción en Base Sepolia;
- configuración efectiva del backend contra la red de prueba;
- confirmación de registros reales de credenciales en la red;
- verificación de fuente en explorador, opcional y no bloqueante.

## Alcance futuro

- emisores autorizados;
- politicas mas finas de autorizacion.

## Entornos

- desarrollo local con Anvil;
- tests con Forge;
- Base Sepolia como red de prueba declarada por el manifiesto;
- backend activable mediante configuración externa validada.

## Estado actual

Estado actual del slice:

- se guarda on-chain solo evidencia minima:
  - `credentialHash`
  - `issuer`/registrant
  - `registeredAt`
  - `revoked`
  - `revokedAt`
- no se guarda:
  - PII
  - JSON de credencial
  - `SemanticAnalysis`
  - texto sensible
  - `revocationReason` como `string`

Este contrato es deliberadamente un registry minimo de hashes, no un NFT, no un
DID registry y no un contrato de negocio completo. El registro blockchain aporta
evidencia técnica de integridad; no certifica por sí solo el contenido académico
ni reemplaza la autoridad del emisor.

# Smart Contracts

Modulo blockchain del proyecto basado en Solidity + Foundry.

## Objetivo

Registrar evidencia minima verificable on-chain sin almacenar el contenido completo de las credenciales.

## Alcance implementado en v0

- contrato `CredentialRegistry.sol`;
- registro on-chain de hashes de credenciales;
- revocacion on-chain del hash por el registrant original;
- consulta simple de estado por hash;
- tests locales con Forge.

## Alcance futuro

- emisores autorizados;
- integracion backend real contra contrato;
- despliegue controlado a redes de prueba;
- politicas mas finas de autorizacion.

## Entorno esperado

- desarrollo local con Anvil;
- tests con Forge;
- despliegue de pruebas en Base Sepolia;
- integracion inicial desde backend mediante ethers.js.

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

Este contrato es deliberadamente un registry minimo de hashes, no un NFT, no un DID registry y no un contrato de negocio completo.

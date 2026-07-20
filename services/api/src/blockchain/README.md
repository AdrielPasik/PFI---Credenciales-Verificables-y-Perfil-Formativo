# Blockchain Module

Responsabilidad futura:

- adaptador de evidencia blockchain;
- persistencia y consulta de `BlockchainRecord`;
- consulta read-only a `CredentialRegistry` en Anvil;
- escritura local/dev a `CredentialRegistry` en Anvil;
- integracion posterior con escritura real hacia Anvil o Base Sepolia;
- revocacion on-chain futura.

Alcance actual:

- modulo NestJS minimo;
- `BlockchainEvidenceService` para mock/local DB ya existente;
- `BlockchainEvidenceService` con modo configurable para mock o `credential_registry_anvil`;
- `CredentialRegistryReadClient` read-only contra contrato EVM;
- `CredentialRegistryWriteClient` para transacciones locales de prueba contra Anvil;
- `ethers@6.15.0` se usa solo dentro de los clientes blockchain encapsulados;
- CLI local `blockchain:status` para consultar `getCredentialStatus(bytes32)`;
- CLI local `blockchain:register` para ejecutar `registerCredential(bytes32)`;
- CLI local `blockchain:revoke` para ejecutar `revokeCredential(bytes32)`;
- sin controllers;
- sin integracion con el flujo de emision;
- sin cambios en `Credential`, `BlockchainRecord` o endpoints existentes;
- sin persistencia real on-chain desde backend;
- sin persistencia real en DB desde estas operaciones;
- sin dependencia de ABI generada en runtime;
- sin Base Sepolia;
- sin MetaMask.

Principios:

- `blockchain` maneja evidencia tecnica, no ownership de `Credential`;
- no debe decidir reglas de emision;
- debe evitar dependencias circulares con `credentials`;
- la integracion Web3 queda encapsulada dentro de clientes propios del backend;
- no se exportan tipos de `ethers` fuera del cliente;
- `CREDENTIAL_REGISTRY_PRIVATE_KEY` se usa solo para pruebas locales/dev con Anvil;
- nunca deben commitearse private keys ni usarse claves reales en este slice;
- cuando haya implementacion real, deberia recibir datos normalizados desde el modulo orquestador.

Configuracion local:

- `CREDENTIAL_REGISTRY_RPC_URL`;
- `CREDENTIAL_REGISTRY_CONTRACT_ADDRESS`.
- `CREDENTIAL_REGISTRY_PRIVATE_KEY`.

Uso local:

```bash
npm run blockchain:status --workspace @credential-intelligence/api -- --hash 0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab
```

```bash
npm run blockchain:register --workspace @credential-intelligence/api -- --hash 0x1111111111111111111111111111111111111111111111111111111111111111
```

```bash
npm run blockchain:revoke --workspace @credential-intelligence/api -- --hash 0x1111111111111111111111111111111111111111111111111111111111111111
```

Notas de uso:

- `BLOCKCHAIN_EVIDENCE_MODE=mock` es el default, incluso si la variable no existe;
- `BLOCKCHAIN_EVIDENCE_MODE=credential_registry_anvil` activa registro on-chain local/dev;
- si `BLOCKCHAIN_EVIDENCE_MODE` tiene otro valor, el backend falla con error claro;
- si falta RPC URL, contract address o private key en contract mode, no hay fallback silencioso a mock;
- `blockchain:register` y `blockchain:revoke` son solo para Anvil/local-dev;
- no escriben en la base de datos;
- no crean `BlockchainRecord`;
- no se integran todavia con `POST /credentials/:id/issue`;
- el estado final de una credencial debe consultarse luego con `blockchain:status`;
- no hay Base Sepolia ni signer productivo en este slice.

Integracion con `BlockchainEvidenceService`:

- en `mock`, el comportamiento sigue siendo el actual: tx hash deterministico local y `BlockchainRecord` local;
- en `credential_registry_anvil`, el service llama a `registerCredential(bytes32)` mediante `CredentialRegistryWriteClient`;
- solo despues de una tx `success` se crea `BlockchainRecord` con `txHash` real de Anvil;
- no hay read-after-write obligatorio en el issue flow.

Riesgo conocido:

- DB transaction != blockchain transaction;
- si la tx on-chain sale bien y luego falla el write de `BlockchainRecord` en PostgreSQL, la blockchain no puede rollbackearse;
- para este slice local/dev se acepta esa limitacion, pero queda documentada como deuda tecnica para una estrategia futura de reconciliacion/idempotencia/outbox.

La salida se normaliza a tipos serializables:

```json
{
  "credentialHash": "0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab",
  "exists": true,
  "revoked": true,
  "issuer": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "registeredAt": "1784382395",
  "revokedAt": "1784382462"
}
```

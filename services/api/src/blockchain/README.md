# Blockchain Module

Responsabilidad futura:

- adaptador de evidencia blockchain;
- persistencia y consulta de `BlockchainRecord`;
- consulta read-only a `CredentialRegistry` en Anvil;
- integracion posterior con escritura real hacia Anvil o Base Sepolia;
- revocacion on-chain futura.

Alcance actual:

- modulo NestJS minimo;
- `BlockchainEvidenceService` para mock/local DB ya existente;
- `CredentialRegistryReadClient` read-only contra contrato EVM;
- `ethers@6.15.0` se usa solo dentro del cliente read-only;
- CLI local `blockchain:status` para consultar `getCredentialStatus(bytes32)`;
- sin controllers;
- sin transacciones on-chain;
- sin signer o private key;
- sin escritura blockchain desde backend;
- sin persistencia real on-chain desde backend;
- sin dependencia de ABI generada en runtime;
- sin cambios en `Credential`, `BlockchainRecord` o endpoints existentes.

Principios:

- `blockchain` maneja evidencia tecnica, no ownership de `Credential`;
- no debe decidir reglas de emision;
- debe evitar dependencias circulares con `credentials`;
- la integracion Web3 queda encapsulada dentro de un cliente read-only propio;
- no se exportan tipos de `ethers` fuera del cliente;
- cuando haya implementacion real, deberia recibir datos normalizados desde el modulo orquestador.

Configuracion local:

- `CREDENTIAL_REGISTRY_RPC_URL`;
- `CREDENTIAL_REGISTRY_CONTRACT_ADDRESS`.

Uso local:

```bash
npm run blockchain:status --workspace @credential-intelligence/api -- --hash 0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab
```

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

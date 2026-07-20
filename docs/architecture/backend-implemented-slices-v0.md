# Backend Implemented Slices v0

## 1. Resumen ejecutivo

El backend ya tiene implementado un flujo inicial y funcional de credenciales verificables con persistencia local y lectura compuesta.

Estado actual del flujo:

```text
Credential draft/issue
-> canonical hash canon_v1
-> BlockchainRecord mock o credential_registry_anvil
-> semantic_analysis_v1 ingestion
-> SemanticAnalysis persistido
-> lectura latest semantic analysis
-> endpoint de verificacion compuesto
```

Este estado ya permite demostrar un backend real que:

- crea y emite credenciales;
- calcula y persiste hash canonico;
- registra evidencia blockchain mock/local o en contrato Anvil segun configuracion;
- persiste artifacts semanticos validados;
- expone lectura read-only para verificadores.

## 2. Slices implementados

### Credential draft

Endpoint:

```text
POST /credentials/draft
```

Que hace:

- crea una `Credential` en estado `draft`;
- valida campos minimos del request;
- persiste `credentialSubject`, `metadata` y `rawData` si corresponden.

Que no hace:

- no emite la credencial;
- no calcula hash;
- no crea `BlockchainRecord`;
- no ejecuta IA.

### Credential issue

Endpoint:

```text
POST /credentials/:id/issue
```

Que hace:

- cambia la credencial a estado `issued`;
- fija `issuedAt`;
- calcula `canonicalHash`;
- fija `canonicalizationVersion = canon_v1`;
- crea un `BlockchainRecord` asociado;
- en modo default usa evidencia mock/local;
- en modo `credential_registry_anvil` registra el hash on-chain y persiste `txHash` real.

Estado resultante esperado:

```text
status issued
issuedAt
canonicalHash
canonicalizationVersion canon_v1
BlockchainRecord mock o credential_registry_anvil
```

### Credential read/status

Endpoints:

```text
GET /credentials/:id
GET /credentials/:id/status
```

Que hacen:

- permiten consultar la credencial persistida;
- exponen estado general;
- exponen hash canonico y evidencia blockchain disponible segun el caso.

### Canonical hashing

Componente principal:

```text
CredentialHashingService
```

Resumen tecnico:

- usa `canon_v1`;
- usa `sha-256`;
- calcula hash deterministico sobre la proyeccion canonica de la credencial emitida.

A nivel conceptual:

- incluye datos centrales de la credencial emitida;
- excluye datos operativos e internos;
- `semantic_analysis_v1` no participa del hash;
- `BlockchainRecord` no participa del hash.

### Smart contract y evidencia blockchain

Estado implementado:

```text
contracts/src/CredentialRegistry.sol
Foundry tests locales
deploy manual en Anvil
cast registerCredential(bytes32)
cast revokeCredential(bytes32)
backend read-only client
backend write client local/dev
BlockchainEvidenceService con modo configurable
```

Componente persistido principal:

```text
BlockchainRecord
```

Capacidades actuales:

```text
CredentialRegistry.sol probado con Foundry
flujo manual Anvil documentado
backend read-only client contra CredentialRegistry
backend write client local/dev contra CredentialRegistry
BLOCKCHAIN_EVIDENCE_MODE=mock por default
BLOCKCHAIN_EVIDENCE_MODE=credential_registry_anvil como modo opcional explicito
```

En modo `mock`:

```text
se preserva el comportamiento anterior
network anvil
chainId 31337
txHash mock/deterministic
status registered
```

En modo `credential_registry_anvil`:

```text
registerCredential(canonicalHash) on-chain
BlockchainRecord con txHash real de Anvil
network anvil
chainId 31337
contractAddress desde env
status registered
```

Esto permite validar tanto el flujo local/mock como un flujo local/dev contra contrato real sin acoplar todavia blockchain al resto del dominio de forma productiva.

### semantic_analysis_v1 backend contract

Estado implementado:

```text
validator/mapper backend
SemanticService.persistForCredential()
script semantic:ingest:file
GET /credentials/:id/semantic-analysis/latest
```

Aclaraciones clave:

```text
no ejecuta IA
no consume outputs crudos
no modifica Credential
no recalcula hash
no toca canon_v1
```

El backend solo consume artifacts `semantic_analysis_v1` ya exportados y validados.

### Verification endpoint

Endpoint:

```text
GET /verify/credentials/:id
```

Compone en una sola lectura:

```text
Credential
canonicalHash
canonicalizationVersion
BlockchainRecord(s)
latest SemanticAnalysis resumido
verificationStatus
```

Logica actual de `verificationStatus`:

```text
revoked     -> credential.status === revoked
draft       -> credential.status === draft
valid       -> issued + canonicalHash + canonicalizationVersion + al menos un BlockchainRecord status registered
incomplete  -> cualquier otro caso
```

No realiza verificacion criptografica real ni consulta blockchain externa.

## 3. Que fue probado

Validaciones ya ejecutadas:

```text
test:hashing
test:blockchain-read-client
test:blockchain-write-client
test:blockchain-evidence
test:semantic-artifact
test:semantic-service
test:semantic-cli
test:semantic-read
test:verification-read
build
prisma:validate
prueba manual con PostgreSQL real
prueba manual con Anvil real
```

Prueba manual conceptual realizada:

```text
semantic_analysis_v1 JSON real
-> semantic:ingest:file
-> SemanticAnalysis en PostgreSQL
-> GET latest semantic analysis
-> GET verify credential
```

Pruebas manuales blockchain realizadas:

```text
CredentialRegistry.sol
-> deploy manual en Anvil
-> registerCredential(bytes32) con cast
-> revokeCredential(bytes32) con cast
-> backend blockchain:status
-> backend blockchain:register
-> backend blockchain:revoke
-> issue flow en modo mock
-> issue flow en modo credential_registry_anvil
```

## 4. Que sigue siendo mock/local

Todavia sigue siendo local/dev o parcial:

```text
Anvil es la unica red integrada
Base Sepolia no esta integrada
MetaMask no esta integrado
el modo credential_registry_anvil es local/dev y explicito
no hay wallet real de usuario
no hay hardening productivo de transacciones blockchain
```

Riesgo/deuda tecnica conocida:

```text
DB transaction != blockchain transaction
si la tx on-chain sale bien pero falla el write en DB, la blockchain no puede rollbackearse
esto se acepta en este slice local/dev
futuro: idempotencia, reconciliacion, outbox o estrategia equivalente
```

## 5. Que NO esta implementado todavia

Pendientes importantes:

```text
Base Sepolia
MetaMask
frontend
revocacion backend completa
wallet real del usuario
DID completo
integracion mobile
hardening productivo de transacciones blockchain
FormativeProfile aggregation
IA HTTP integration
mobile app
```

## 6. Proximos pasos recomendados

Orden sugerido:

```text
1. Revocation flow backend completo usando el contrato ya existente
2. Endurecimiento de transacciones blockchain con estrategia de reconciliacion/idempotencia
3. Verifier frontend minimo
4. Base Sepolia cuando el flujo local/dev este suficientemente estable
5. FormativeProfile cuando el modulo IA este mas estable
```

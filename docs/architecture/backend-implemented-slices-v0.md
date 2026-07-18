# Backend Implemented Slices v0

## 1. Resumen ejecutivo

El backend ya tiene implementado un flujo inicial y funcional de credenciales verificables con persistencia local y lectura compuesta.

Estado actual del flujo:

```text
Credential draft/issue
-> canonical hash canon_v1
-> BlockchainRecord mock/local
-> semantic_analysis_v1 ingestion
-> SemanticAnalysis persistido
-> lectura latest semantic analysis
-> endpoint de verificacion compuesto
```

Este estado ya permite demostrar un backend real que:

- crea y emite credenciales;
- calcula y persiste hash canonico;
- registra evidencia blockchain mock/local;
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
- crea un `BlockchainRecord` mock/local asociado.

Estado resultante esperado:

```text
status issued
issuedAt
canonicalHash
canonicalizationVersion canon_v1
BlockchainRecord mock/local
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

### Blockchain evidence mock/local

Componente persistido:

```text
BlockchainRecord
```

Estado actual:

```text
network anvil
chainId 31337
txHash mock/deterministic
status registered
no smart contract real todavia
no Base Sepolia todavia
```

Esto permite probar el flujo de evidencia blockchain sin depender aun de contrato real ni red externa.

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
test:semantic-artifact
test:semantic-service
test:semantic-cli
test:semantic-read
test:verification-read
build
prisma:validate
prueba manual con PostgreSQL real
```

Prueba manual conceptual realizada:

```text
semantic_analysis_v1 JSON real
-> semantic:ingest:file
-> SemanticAnalysis en PostgreSQL
-> GET latest semantic analysis
-> GET verify credential
```

## 4. Que sigue siendo mock/local

Todavia sigue siendo mock/local:

```text
BlockchainRecord todavia no viene de smart contract real
txHash todavia es mock/local
Anvil/Base Sepolia todavia no integrados al backend
no hay adapter ethers.js todavia
```

## 5. Que NO esta implementado todavia

Pendientes importantes:

```text
smart contract real
Foundry project
backend adapter real contra contrato
revocation endpoint
FormativeProfile aggregation
IA HTTP integration
frontend
mobile app
MetaMask integration
Base Sepolia deployment
```

## 6. Proximos pasos recomendados

Orden sugerido:

```text
1. Foundry + CredentialRegistry.sol + tests locales
2. Backend adapter real hacia Anvil/contrato
3. Revocation flow
4. Verifier frontend minimo
5. FormativeProfile cuando el modulo IA este mas estable
```

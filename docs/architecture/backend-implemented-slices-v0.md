# Backend Implemented Slices v0

## 1. Resumen ejecutivo

El backend NestJS ya implementa un flujo local/dev funcional de credenciales verificables, autenticacion demo-grade, wallet interna de holder y perfil formativo agregado.

```text
User login
-> protected credential issue
-> canonical hash canon_v1
-> BlockchainRecord mock o credential_registry_anvil
-> semantic_analysis_v1 ingestion
-> SemanticAnalysis persistido
-> holder wallet read
-> FormativeProfile current rebuild/read
-> verifier read compuesto
```

El flujo usa PostgreSQL real, Prisma y Anvil local cuando se habilita el modo de contrato. No hay frontend, mobile, IA HTTP ni red blockchain publica integrados.

## 2. Slices implementados

### Auth foundation demo-grade

Endpoints:

```text
POST /auth/login
GET  /auth/me
```

- `AuthCredential` mantiene el password hash separado de `User`;
- passwords hasheados con `scrypt`;
- JWT minimo con `sub = userId`;
- `AuthGuard` y `CurrentUser` resuelven la identidad para endpoints protegidos;
- el seed local crea `Issuer Admin` y `Demo Holder` con credenciales demo.

No incluye refresh tokens, recuperacion de password, MFA ni proveedor de identidad externo.

### Credential draft y protected issuance

Endpoints:

```text
POST /credentials/draft
POST /credentials/:id/issue
GET  /credentials/:id
GET  /credentials/:id/status
```

El issue requiere JWT. La autoridad no proviene del `issuerId` del body: el emisor efectivo es `credential.issuerId` persistido y el usuario debe tener `IssuerMembership` activa, rol emisor permitido e `Issuer` autorizado. El holder no puede emitir.

Al emitir, el backend fija `issuedAt`, calcula `canonicalHash` con `canon_v1`, guarda `canonicalizationVersion` y crea un `BlockchainRecord` asociado.

### Canonical hashing

`CredentialHashingService` usa `sha-256` y una proyeccion deterministica `canon_v1`.

- incluye datos centrales de la credencial emitida;
- excluye datos operativos e internos;
- `semantic_analysis_v1`, `FormativeProfile` y `BlockchainRecord` no participan del hash;
- el contrato esta protegido con tests unitarios y golden test.

### Evidencia blockchain local

Estado actual:

```text
CredentialRegistry.sol
Foundry tests locales
deploy y pruebas manuales con Anvil/cast
read client backend
write client local/dev
BlockchainEvidenceService con modo configurable
```

Modos:

- `mock` es el default y conserva `txHash` mock/deterministico;
- `credential_registry_anvil` es explicito y registra el hash en `CredentialRegistry`, guardando un `txHash` real de Anvil.

Ambos persisten `BlockchainRecord` con `network = anvil`, `chainId = 31337` y estado `registered`. No hay Base Sepolia, MetaMask ni signer productivo.

Riesgo aceptado local/dev: una transaccion de PostgreSQL no puede rollbackear una transaccion on-chain. Idempotencia, reconciliacion u outbox quedan para una etapa posterior.

### semantic_analysis_v1

Capacidades implementadas:

```text
validator/mapper backend
SemanticService.persistForCredential()
semantic:ingest:file
GET /credentials/:id/semantic-analysis/latest
```

El backend recibe solo artifacts JSON versionados y validados. No ejecuta Python, no consume formatos internos crudos del extractor, no modifica `Credential`, no recalcula hash y no toca `canon_v1`.

### Holder wallet read

Endpoints protegidos:

```text
GET /me/credentials
GET /me/credentials/:id
```

La identidad sale exclusivamente del JWT. El holder solo ve credenciales propias en estado `issued` o `revoked`; drafts y credenciales de otros holders se ocultan. Las respuestas no exponen `rawData`, `AuthCredential` ni `passwordHash`.

### FormativeProfile persistence/read

Endpoints protegidos:

```text
GET  /me/profile/current
POST /me/profile/rebuild
```

El rebuild local/dev toma credenciales `issued` del holder y el ultimo `SemanticAnalysis` de cada una. Agrega solo areas, skills, concepts, confidence y evidencia ya persistidos; conserva `credentialIds`, `semanticAnalysisIds` y `evidenceCount` en `profileJson`.

- drafts y credenciales revoked no participan;
- una credencial sin analisis genera warning y no rompe el rebuild;
- catalogos online se marcan como no equivalentes a evidencia de completion;
- el backend no genera NLP, skills o areas nuevas;
- una transaccion Prisma desmarca perfiles anteriores y crea un unico snapshot `isCurrent = true`.

El modelo reutilizado es `FormativeProfile`; no se ingiere todavia `formative_profile_result_v0` externo ni existe integracion HTTP con IA.

### Verification endpoint

```text
GET /verify/credentials/:id
```

Compone `Credential`, hash, evidencia blockchain y ultimo `SemanticAnalysis` resumido. Su estado es:

```text
revoked     -> credential.status === revoked
draft       -> credential.status === draft
valid       -> issued + hash + canon + BlockchainRecord registered
incomplete  -> cualquier otro caso
```

No ejecuta una verificacion criptografica externa en tiempo real.

## 3. Que fue probado

Se ejecutan tests separados para hashing, auth, protected issuance, holder wallet, perfiles, semantic artifact/service/CLI/read, blockchain read/write/evidence y verification read, ademas de `build` y `prisma:validate`.

Pruebas manuales realizadas:

```text
semantic_analysis_v1 JSON real
-> semantic:ingest:file
-> SemanticAnalysis en PostgreSQL
-> POST /me/profile/rebuild
-> FormativeProfile current en PostgreSQL
-> GET /me/profile/current
```

Tambien se probaron deploy, register y revoke de `CredentialRegistry.sol` en Anvil, junto con issue flow en modo `mock` y `credential_registry_anvil`.

## 4. Limites actuales

No esta implementado todavia:

- frontend, PWA o app mobile;
- Base Sepolia, MetaMask o wallet externa del holder;
- signer institucional productivo, custodia segura o multiples signers por issuer;
- revocacion backend completa;
- sharing/link/QR;
- endpoint issuer-facing para listar credenciales institucionales;
- IA HTTP, jobs/colas o ejecucion Python desde Nest;
- ingestion de `credential_candidate_v1`;
- ingestion externa de `formative_profile_result_v0`;
- hardening productivo de transacciones blockchain;
- constraint de base de datos parcial para garantizar `FormativeProfile.isCurrent`.

## 5. Proximos pasos recomendados

```text
1. Revocation flow protegido y sincronizado con BlockchainRecord/contrato.
2. Reconciliacion e idempotencia de evidencia blockchain.
3. Endpoint issuer-facing de lectura institucional.
4. Verifier frontend minimo sobre los endpoints existentes.
5. Definir si formative_profile_result_v0 externo reemplaza, complementa o compara el agregado backend actual.
6. Base Sepolia y signer institucional seguro solo despues de estabilizar el flujo local/dev.
```

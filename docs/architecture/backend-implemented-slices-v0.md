# Backend Implemented Slices v0

## 1. Resumen ejecutivo

El backend NestJS ya implementa un flujo local/dev funcional de credenciales verificables, autenticacion demo-grade, operaciones issuer-facing, evidencias documental/textual, integracion HTTP con IA, wallet interna de holder y perfil formativo agregado.

```text
User login
-> protected credential issue
-> canonical hash canon_v1
-> BlockchainRecord mock o credential_registry_anvil
-> semantic_analysis_v1 ingestion
-> SemanticAnalysis persistido
-> formative_profile_result_v0 validado/persistido
-> holder wallet read
-> FormativeProfile current rebuild/read
-> verifier read compuesto
```

El flujo usa PostgreSQL real, Prisma y Anvil local cuando se habilita el modo de contrato. El frontend consume endpoints NestJS protegidos; no hay mobile nativo, storage cloud, servicio IA desplegado privado ni red blockchain publica integrados.

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
- `/auth/me` devuelve memberships activas con resumen seguro del issuer
  (`issuerId`, nombre, DID nullable y estado de autorizacion);
- el seed local crea `Issuer Admin` y `Demo Holder` con credenciales demo.

No incluye refresh tokens, recuperacion de password, MFA ni proveedor de identidad externo.

### Resolucion institucional de titulares

Endpoint protegido:

```text
POST /issuers/:issuerId/holders/resolve
```

Un usuario autenticado puede resolver un titular por email exacto solo si
tiene membership `active`, rol `admin` u `operator` y el issuer esta
`authorized`. La busqueda ocurre despues de la autorizacion, acepta usuarios
`active` con DID nullable y devuelve exclusivamente `id`, `email`, `did` y
`displayLabel`.

Es una lectura sin efectos secundarios: no crea ni modifica usuarios,
memberships, drafts o credenciales. No es listado, autocomplete ni buscador
global. El ID retornado queda destinado a `subjectUserId` command-only.

### Credential draft y protected issuance

Endpoints:

```text
POST /credentials/draft
POST /credentials/:id/issue
GET  /credentials/:id
GET  /credentials/:id/status
```

Crear un draft requiere JWT, `IssuerMembership` activa, rol `admin` u `operator` e `Issuer` autorizado. El `issuerId` del body selecciona el contexto institucional, pero no es autoridad por si solo.

El issue tambien requiere JWT. La autoridad no proviene del `issuerId` del body: el emisor efectivo es `credential.issuerId` persistido y el usuario debe tener `IssuerMembership` activa, rol emisor permitido e `Issuer` autorizado. El holder no puede emitir.

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
AiServiceClient / AiIntegrationService
POST /credentials/:id/semantic-analysis/from-pdf
```

El backend recibe solo artifacts JSON versionados y validados. NestJS no ejecuta
Python: consume FastAPI por HTTP. No modifica `Credential`, no recalcula hash y
no toca `canon_v1` al persistir analisis.

### Operaciones issuer-facing y evidencias

Estan implementados el read model institucional, PATCH controlado del draft,
resolucion de holder, catalogo/curricula y creacion guiada. Las evidencias usan:

```text
POST /issuers/:issuerId/credentials/:credentialId/evidence/documents
POST /issuers/:issuerId/credentials/:credentialId/evidence/texts
```

`DocumentEvidence` conserva metadata/hash e historial, mientras los bytes se
guardan con `DocumentStoragePort` y `LocalDocumentStorageAdapter`. `TextEvidence`
conserva texto normalizado/hash e historial. Ambas fuentes son independientes,
draft-only para escritura y no modifican claims, canon, IA o blockchain.

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

El modelo reutilizado es `FormativeProfile`. El backend puede ingerir
`formative_profile_result_v0` real desde archivo o FastAPI, validarlo y
persistirlo con `generationMethod = ai_artifact_ingest_v0`. El rebuild
deterministico conserva el contrato distinto
`backend_formative_profile_snapshot_v0`.

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

Se ejecutan tests separados para hashing, auth, resolucion de titulares,
protected issuance, holder wallet, perfiles, semantic artifact/service/CLI/read,
blockchain read/write/evidence y verification read, ademas de `build` y
`prisma:validate`.

Pruebas manuales realizadas:

```text
semantic_analysis_v1 JSON o FastAPI
-> validator backend
-> SemanticAnalysis en PostgreSQL
-> formative_profile_result_v0 file/HTTP o rebuild fallback
-> FormativeProfile current en PostgreSQL
-> GET /me/profile/current
```

Tambien se probaron deploy, register y revoke de `CredentialRegistry.sol` en Anvil, junto con issue flow en modo `mock` y `credential_registry_anvil`.

## 4. Limites actuales

No esta implementado todavia:

- app mobile nativa o holder wallet frontend completa;
- Base Sepolia, MetaMask o wallet externa del holder;
- signer institucional productivo, custodia segura o multiples signers por issuer;
- revocacion backend completa;
- sharing/link/QR;
- listado/paginacion institucional completa de credenciales;
- `AnalysisRun`, jobs/colas o worker;
- auth interna de servicio desplegada entre NestJS y FastAPI;
- trazabilidad relacional de analisis a `DocumentEvidence`/`TextEvidence`;
- propuestas IA revisables y revision humana;
- S3/Neon/Render/Vercel desplegados;
- ingestion de `credential_candidate_v1`;
- hardening productivo de transacciones blockchain;
- constraint de base de datos parcial para garantizar `FormativeProfile.isCurrent`.

## 5. Proximos pasos recomendados

```text
1. Implementar `S3DocumentStorageAdapter` sin cambiar el endpoint publico.
2. Desplegar Neon, NestJS, Next.js y FastAPI privado con auth interna.
3. Resolver fuentes exactas y crear `AnalysisRun` sincrono.
4. Trazar `SemanticAnalysis` a documento/texto concretos.
5. Agregar propuestas IA y revision humana antes de readiness.
6. Decidir `canon_v2`, emision/testnet y verificador despues de ese cierre.
```

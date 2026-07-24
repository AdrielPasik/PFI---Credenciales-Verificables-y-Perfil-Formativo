# Backend API

Backend NestJS + TypeScript con Prisma sobre PostgreSQL. El estado actual soporta una demo local/dev de autenticacion, emision protegida, evidencia blockchain local, ingestion semantica, wallet interna de holder y perfiles formativos.

## Endpoints actuales

Publicos:

```text
GET  /health
GET  /credentials/:id
GET  /credentials/:id/status
GET  /credentials/:id/semantic-analysis/latest
GET  /verify/credentials/:id
POST /credentials/draft
```

Protegidos por JWT:

```text
POST /auth/login
GET  /auth/me
POST /credentials/:id/issue
GET  /me/credentials
GET  /me/credentials/:id
GET  /me/profile/current
POST /me/profile/rebuild
```

`POST /credentials/:id/issue` requiere un usuario autenticado con `IssuerMembership` activa, rol permitido y un issuer autorizado. El `issuerId` del body no es fuente de autoridad: la credencial persistida define el issuer efectivo.

`/me/*` toma siempre la identidad desde el JWT. No acepta `userId` externo, no expone `rawData`, `AuthCredential` ni `passwordHash`, y el holder solo puede consultar sus credenciales `issued` o `revoked`.

## Perfil formativo

`POST /me/profile/rebuild` es un trigger local/dev explicito. Construye un snapshot `FormativeProfile` desde credenciales `issued` del holder y el ultimo `SemanticAnalysis` persistido por credencial.

- no ejecuta IA ni Python;
- no inventa areas, skills o concepts;
- no modifica `Credential`, `SemanticAnalysis` ni `BlockchainRecord`;
- conserva evidencia por `credentialId` y `semanticAnalysisId` dentro de `profileJson`;
- si una credencial no tiene analisis, genera warning y continua;
- mantiene un perfil actual mediante transaccion Prisma.

No se ingiere todavia `formative_profile_result_v0` externo ni existe integracion HTTP con el modulo IA.

## Desarrollo

Instalar dependencias desde la raiz del monorepo y ejecutar:

- `npm run dev --workspace @credential-intelligence/api`
- `npm run build --workspace @credential-intelligence/api`
- `npm run prisma:validate --workspace @credential-intelligence/api`

Tests de slices:

- `npm run test:auth --workspace @credential-intelligence/api`
- `npm run test:protected-issuance --workspace @credential-intelligence/api`
- `npm run test:me-wallet --workspace @credential-intelligence/api`
- `npm run test:profiles --workspace @credential-intelligence/api`
- `npm run test:hashing --workspace @credential-intelligence/api`

## PostgreSQL local

```text
docker compose -f infra/docker/docker-compose.postgres.yml up -d
npm run prisma:migrate:dev --workspace @credential-intelligence/api -- --name <migration-name>
npm run prisma:seed --workspace @credential-intelligence/api
```

El seed idempotente crea `Demo University`, `Issuer Admin` y `Demo Holder`. Las credenciales demo local/dev son:

- `issuer.admin@example.com / DemoIssuer123!`
- `holder.demo@example.com / DemoHolder123!`

Usar `services/api/.env.example` como referencia. `.env` no debe versionarse.

## Limites

El backend no tiene frontend, mobile, MetaMask, Base Sepolia, IA HTTP, ejecucion Python desde NestJS, sharing/link/QR, revocacion completa ni hardening productivo blockchain. El modo `credential_registry_anvil` es exclusivamente local/dev; `mock` sigue siendo el comportamiento por default.

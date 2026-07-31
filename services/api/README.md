# Backend API

Backend NestJS + TypeScript con Prisma sobre PostgreSQL. El estado actual soporta una demo local/dev de autenticacion, emision protegida, evidencia blockchain local, ingestion semantica, wallet interna de holder y perfiles formativos.

## Endpoints actuales

Publicos:

```text
GET  /health
POST /auth/login
GET  /credentials/:id
GET  /credentials/:id/status
GET  /credentials/:id/semantic-analysis/latest
GET  /verify/credentials/:id
```

Protegidos por JWT:

```text
POST /credentials/draft
GET  /auth/me
POST /issuers/:issuerId/holders/resolve
GET  /issuers/:issuerId/credentials/:credentialId
POST /credentials/:id/issue
GET  /me/credentials
GET  /me/credentials/:id
GET  /me/profile/current
POST /me/profile/rebuild
```

`POST /credentials/draft` requiere un usuario autenticado con `IssuerMembership` activa, rol `admin` u `operator` y un issuer autorizado. El `issuerId` del body selecciona el contexto institucional, pero no es autoridad por si solo.

`POST /credentials/:id/issue` aplica las mismas reglas institucionales sobre el issuer persistido de la credencial. El `issuerId` del body no puede cambiar el issuer efectivo.

`GET /auth/me` devuelve solo memberships activas y agrega para cada una un
resumen seguro del issuer: `issuerId`, `issuerName`, `issuerDid` e
`issuerAuthorizationStatus`. Una membership activa solo es un contexto emisor
operativo si ademas tiene rol `admin` u `operator` y el issuer esta
`authorized`.

`POST /issuers/:issuerId/holders/resolve` permite a un `admin` u `operator`
activo de un issuer autorizado resolver un titular por igualdad exacta de
email normalizado. Devuelve solo `id`, `email`, `did` nullable y
`displayLabel`; no lista usuarios, no busca parcialmente y no produce
escrituras. El `id` resultante se usa como `subjectUserId` command-only al
crear un draft.

`GET /issuers/:issuerId/credentials/:credentialId` aplica el mismo contexto
institucional operativo antes de buscar la credencial por `credentialId` e
`issuerId`. Devuelve un read model allowlisted con resumen humano del issuer y
holder; no expone IDs relacionales, auth, wallet, metadata, raw data, hashes,
blockchain ni analisis. El read generico `GET /credentials/:id` sigue
coexistiendo sin cambios hasta la migracion frontend de P1b.

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

Para consumir el API desde la futura web local en
`http://127.0.0.1:3000`, iniciar NestJS en otro puerto y habilitar CORS
exclusivamente para ese origen:

```powershell
$env:PORT="3001"
$env:WEB_ORIGIN="http://127.0.0.1:3000"
npm run dev --workspace @credential-intelligence/api
```

Si `WEB_ORIGIN` no esta definida o esta vacia, el API inicia sin habilitar
CORS. Un valor no vacio debe ser un origen HTTP o HTTPS valido y no puede
incluir path, query, fragmento ni credenciales. La configuracion permite
`Authorization`, `Content-Type` y preflight `OPTIONS`, pero no usa wildcard,
cookies ni `credentials: true`.

Bearer JWT no requiere cookies. En multipart, el navegador agrega el boundary
de `Content-Type` automaticamente; el frontend no debe establecer ese header
manualmente al enviar `FormData`. `localhost` y `127.0.0.1` son origenes
distintos, por lo que la URL del navegador debe coincidir exactamente con
`WEB_ORIGIN`.

Tests de slices:

- `npm run test:web-cors --workspace @credential-intelligence/api`
- `npm run test:auth --workspace @credential-intelligence/api`
- `npm run test:holder-resolution --workspace @credential-intelligence/api`
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

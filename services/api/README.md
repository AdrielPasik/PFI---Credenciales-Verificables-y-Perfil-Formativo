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
GET  /issuers/:issuerId/catalog/academic-subjects
GET  /issuers/:issuerId/catalog/academic-programs
GET  /issuers/:issuerId/catalog/curriculum-versions/:curriculumReference/academic-subjects
GET  /issuers/:issuerId/credentials/:credentialId
PATCH /issuers/:issuerId/credentials/:credentialId/draft
POST /issuers/:issuerId/credentials/:credentialId/evidence/documents
POST /issuers/:issuerId/credentials/:credentialId/evidence/texts
POST /credentials/:id/issue
GET  /me/credentials
GET  /me/credentials/:id
GET  /me/profile/current
POST /me/profile/rebuild
POST /me/profile/build-from-ai
POST /credentials/:id/semantic-analysis/from-pdf
```

`POST /credentials/draft` requiere un usuario autenticado con `IssuerMembership` activa, rol `admin` u `operator` y un issuer autorizado. El `issuerId` del body selecciona el contexto institucional, pero no es autoridad por si solo.

Para crear directamente un `academic_subject` curricular, el body puede omitir
`title` y `credentialSubject` manuales y enviar el par
`academicCourseReference` + `curriculumReference`. El backend valida dentro de
una transaccion Serializable que la materia, carrera, version y relacion
curricular esten activas y pertenezcan al mismo issuer. Luego persiste
`academicCourseId` y `programCourseId` internamente y deriva el snapshot de
nombre, descripcion, horas, institucion y programa. No acepta IDs internos,
referencias incompletas ni textos oficiales ambiguos desde el cliente.

El body curricular es una allowlist cerrada de `issuerId`, `subjectUserId`,
`type`, `sourceType`, `academicCourseReference` y `curriculumReference`.
Requiere `type=academic_subject` y `sourceType=manual_issuer`. Rechaza por
presencia cualquier otra propiedad, incluidos `credentialSubject`, `metadata`,
`rawData` y `externalCourseId`, aun cuando sean vacios o `null`.

La seleccion curricular no prueba aprobacion del holder. Los datos del logro
o enriquecimiento no forman parte del snapshot inicial y se completan despues
mediante el PATCH issuer-facing del draft. Este flujo no calcula readiness, no
emite, no llama a blockchain y no ejecuta PDF ni IA. La creacion manual
existente se mantiene por compatibilidad para todos los tipos.

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
holder, `description` nullable y `hours` como decimal string nullable; no
expone IDs relacionales, auth, wallet, metadata, raw data, hashes, blockchain
ni analisis. El read generico `GET /credentials/:id` sigue coexistiendo sin
cambios.

`GET /issuers/:issuerId/catalog/academic-subjects` busca `AcademicCourse`
activos del issuer por codigo o nombre. Usa limite default `20`, maximo `50`,
orden deterministico y una response allowlisted. El seed demo importa para
`Universidad Argentina de la Empresa (UADE)` las 617 materias de
`data/academic_catalog/demo-academic-courses-v0.json` sin inventar descripcion,
horas ni enriquecimiento. UADE es la institucion academica de demostracion;
el modelo sigue siendo multi-issuer.

`GET /issuers/:issuerId/catalog/academic-programs` busca programas activos por
codigo o nombre y devuelve su version curricular activa. El endpoint
`GET /issuers/:issuerId/catalog/curriculum-versions/:curriculumReference/academic-subjects`
devuelve exclusivamente las materias activas vinculadas a esa curricula del
mismo issuer. Ambos reutilizan la autorizacion institucional, limites `20/50`,
orden deterministico y DTOs allowlisted.

`PATCH /issuers/:issuerId/credentials/:credentialId/draft` actualiza campos
comunes y campos controlados por `CredentialType` de una credencial `draft`.
Requiere el `expectedUpdatedAt` exacto del read institucional, rechaza claves
fuera de la allowlist y usa compare-and-swap atomico para evitar lost updates.
Los campos omitidos permanecen sin cambios y los nullables se limpian segun su
contrato. El nombre queda sincronizado entre `title` y
`credentialSubject.achievement_name`, mientras la institucion se deriva de
`Issuer.name`. Un cambio de tipo elimina campos controlados incompatibles,
conserva los compatibles y preserva claves legacy sin exponerlas. La response
issuer-facing devuelve solo la allowlist tipada. Este slice no calcula
readiness, no emite, no llama a blockchain y no cambia `canon_v1`.
Para `academic_subject`, el PATCH acepta `academicCourseReference`, valida una
asignatura activa del mismo issuer y copia un snapshot de nombre, descripcion
y horas. No puede combinarse con valores manuales para esos mismos campos. El
campo opcional `curriculumReference` exige la referencia de asignatura y
valida la relacion carrera-materia dentro de la transaccion. En ese caso
persiste la relacion curricular exacta y deriva `program_name` desde
`Program.name`; no acepta un `programName` manual simultaneo. La seleccion
plana de P3.1a sigue soportada. El catalogo no prueba aprobacion; fecha,
periodo y nota siguen describiendo el
logro concreto del holder.

`POST /issuers/:issuerId/credentials/:credentialId/evidence/documents` recibe
`multipart/form-data` con exactamente un archivo `file` y un maximo de 20 MB.
Solo admite PDF, PNG y JPEG detectados por firma; valida MIME y extension,
normaliza el formato, calcula SHA-256 sobre los bytes exactos y persiste metadata
en `DocumentEvidence`. Los bytes se guardan mediante `DocumentStoragePort` con
el adapter local por default o el adapter S3 privado cuando se selecciona de
forma explicita. Una evidencia vigente anterior pasa a `replaced`
sin borrado fisico, mientras un indice unico parcial y una transaccion
`Serializable` garantizan una sola `current` por credencial. El endpoint es
draft-only, no modifica `Credential`, no expone storage keys ni historial y no
ejecuta IA, readiness, emision, hashing canonico o blockchain.

El detalle issuer-facing devuelve siempre
`documentEvidence.currentDocument`, con `null` cuando no existe evidencia. La
respuesta allowlisted incluye referencia, tipo, estado, nombre, MIME, tamano,
SHA-256 documental y fecha; no incluye provider, key, path ni uploader.

`POST /issuers/:issuerId/credentials/:credentialId/evidence/texts` recibe JSON
con `content` requerido y `label` opcional. Aplica una allowlist exacta,
normaliza Unicode a NFC, saltos CRLF/CR a LF y whitespace exterior, conserva
saltos internos y admite hasta 50.000 caracteres Unicode. El contenido
normalizado se persiste en PostgreSQL y su SHA-256 se calcula sobre los bytes
UTF-8 exactos.

La evidencia textual es draft-only y complementaria de la documental. Cada
credencial puede tener una `TextEvidence` `current`; reemplazarla marca la
anterior como `replaced` dentro de una transaccion `Serializable`. El detalle
issuer-facing devuelve `textEvidence.currentText`, separado de
`documentEvidence.currentDocument`. Registrar texto no modifica description,
skills, competencies, learning outcomes, `Credential.updatedAt`, canon,
readiness, emision, IA ni blockchain, y no expone historial o submitter.

`/me/*` toma siempre la identidad desde el JWT. No acepta `userId` externo, no expone `rawData`, `AuthCredential` ni `passwordHash`, y el holder solo puede consultar sus credenciales `issued` o `revoked`.

## Perfil formativo

`POST /me/profile/rebuild` es un trigger local/dev explicito. Construye un snapshot `FormativeProfile` desde credenciales `issued` del holder y el ultimo `SemanticAnalysis` persistido por credencial.

- no ejecuta IA ni Python;
- no inventa areas, skills o concepts;
- no modifica `Credential`, `SemanticAnalysis` ni `BlockchainRecord`;
- conserva evidencia por `credentialId` y `semanticAnalysisId` dentro de `profileJson`;
- si una credencial no tiene analisis, genera warning y continua;
- mantiene un perfil actual mediante transaccion Prisma.

El backend tambien puede validar y persistir artifacts IA reales mediante la
integracion HTTP existente. `POST /credentials/:id/semantic-analysis/from-pdf`
y `POST /me/profile/build-from-ai` permanecen protegidos por el JWT humano en
NestJS; el navegador nunca llama FastAPI ni recibe la credencial interna entre
servicios.

## AI Service interno

`AiServiceClient` valida auth y cualquier URL configurada al construirse. En
modo `jwt`, la URL tambien es obligatoria y el proceso falla antes de aceptar
trafico si falta. En local, ambos servicios pueden ejecutarse sin auth interna:

```dotenv
AI_SERVICE_BASE_URL=http://127.0.0.1:8000
AI_SERVICE_TIMEOUT_MS=60000
AI_SERVICE_AUTH_MODE=none
```

Para demo/production, NestJS genera por request un JWT interno HS256, diferente
del JWT humano y con TTL maximo de 300 segundos:

```dotenv
AI_SERVICE_AUTH_MODE=jwt
AI_SERVICE_JWT_SECRET=
AI_SERVICE_JWT_ISSUER=traza-api
AI_SERVICE_JWT_AUDIENCE=traza-ai-service
AI_SERVICE_JWT_EXPIRES_IN_SECONDS=60
```

En modo `jwt`, secreto, issuer, audience y TTL son obligatorios, y el secreto
no puede coincidir con `JWT_SECRET`. La base URL debe ser HTTP/HTTPS y no puede
contener credenciales, query ni fragment. `GET /health` no recibe Authorization;
las llamadas `/v1` reciben solamente el token de servicio con
`iss/aud/sub/iat/exp/jti`, sin identidad ni permisos del usuario.

En modo local `none`, omitir `AI_SERVICE_BASE_URL` no bloquea modulos ajenos;
una llamada IA falla de forma controlada hasta que se configure la URL.

En demo, P4i-6a registra temporalmente una URL HTTPS publica del Web Service
FastAPI; `AI_SERVICE_AUTH_MODE` permanece en `jwt` y el browser nunca consume
esa URL. La red privada sigue siendo el objetivo. `none` es solo local, no una
estrategia de rollback. Ver
`../../docs/architecture/render-ai-cloud-deployment-record-v0.md` y el runbook
privado para configuracion, smoke y migracion futura.

## Desarrollo

Suite focalizada de create-draft:

```powershell
npm run test:create-draft --workspace @credential-intelligence/api
```

Instalar dependencias desde la raiz del monorepo y ejecutar:

- `npm run dev --workspace @credential-intelligence/api`
- `npm run build --workspace @credential-intelligence/api`
- `npm run prisma:validate --workspace @credential-intelligence/api`

## Deployment Render

P4g deja preparada la API para un Render Web Service, sin crear ni desplegar el
servicio. La configuracion recomendada usa la raiz del monorepo para conservar
`package-lock.json` y los workspaces.

Build command:

```text
npm ci && npm run prisma:generate --workspace @credential-intelligence/api && npm run build --workspace @credential-intelligence/api
```

Start command:

```text
npm run start --workspace @credential-intelligence/api
```

Health check: `GET /health`. El runtime usa pooled `DATABASE_URL`, storage `s3`,
`WEB_ORIGIN` exacto y blockchain `mock`. Migraciones y seed no se ejecutan en el
start; `prisma:migrate:deploy` se corre manualmente/one-off con la conexion
administrativa apropiada y `db:verify-demo` permanece como smoke read-only.

Variables, orden operativo, rollback y troubleshooting estan documentados en
`docs/architecture/render-api-deployment-runbook-v0.md`.

Operaciones demo/staging de base:

- `npm run prisma:migrate:status --workspace @credential-intelligence/api`
- `npm run prisma:migrate:deploy --workspace @credential-intelligence/api`
- `npm run db:seed --workspace @credential-intelligence/api`
- `npm run db:verify-demo --workspace @credential-intelligence/api`
- `npm run test:db-verify-demo --workspace @credential-intelligence/api`

`db:seed` usa la `DATABASE_URL` ya cargada por el ambiente; `prisma:seed`
conserva el flujo local historico con `.env`. `db:verify-demo` es read-only,
valida claves estables y conteos del seed, y nunca imprime la connection string
ni datos personales.

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
- `npm run test:academic-catalog --workspace @credential-intelligence/api`
- `npm run test:document-evidence --workspace @credential-intelligence/api`
- `npm run test:text-evidence --workspace @credential-intelligence/api`
- `npm run test:issuer-credential-read --workspace @credential-intelligence/api`
- `npm run test:issuer-credential-draft-update --workspace @credential-intelligence/api`
- `npm run test:issuer-credential-type-fields --workspace @credential-intelligence/api`
- `npm run test:protected-issuance --workspace @credential-intelligence/api`
- `npm run test:me-wallet --workspace @credential-intelligence/api`
- `npm run test:profiles --workspace @credential-intelligence/api`
- `npm run test:hashing --workspace @credential-intelligence/api`
- `npm run test:ai-service-client --workspace @credential-intelligence/api`

## PostgreSQL local

```text
docker compose -f infra/docker/docker-compose.postgres.yml up -d
npm run prisma:migrate:dev --workspace @credential-intelligence/api -- --name <migration-name>
npm run prisma:seed --workspace @credential-intelligence/api
```

El seed idempotente crea o actualiza el mismo issuer estable como
`Universidad Argentina de la Empresa (UADE)`, ademas de `Issuer Admin`,
`Demo Holder`, 617 `AcademicCourse`, 22 `Program`, 22 `CurriculumVersion` y
977 `ProgramCourse`. Los codigos institucionales y las relaciones pertenecen
al catalogo demo UADE y provienen de los artifacts locales versionados en
`data/academic_catalog`. Las credenciales demo
local/dev son:

- `issuer.admin@example.com / DemoIssuer123!`
- `holder.demo@example.com / DemoHolder123!`

Usar `services/api/.env.example` como referencia. `.env` no debe versionarse.

Para Neon demo/staging, configurar `DATABASE_URL` fuera del repositorio y usar
`prisma:migrate:deploy`; nunca ejecutar `migrate dev` o `migrate reset`. Neon
puede entregar una URL pooled de runtime y una URL directa para migraciones. El
procedimiento completo esta en
`docs/architecture/neon-demo-database-runbook-v0.md`.

El storage documental local usa por default
`services/api/.local-storage/document-evidence`, fuera de rutas publicas y de
Git. Puede configurarse con:

```dotenv
DOCUMENT_STORAGE_PROVIDER=local
DOCUMENT_STORAGE_LOCAL_ROOT=
```

Para usar S3 privado, seleccionar el provider y configurar credenciales IAM de
minimo privilegio del lado NestJS:

```dotenv
DOCUMENT_STORAGE_PROVIDER=s3
AWS_REGION=
AWS_S3_BUCKET=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_PREFIX=document-evidence
AWS_S3_ENDPOINT=
AWS_S3_FORCE_PATH_STYLE=
```

`AWS_S3_ENDPOINT` y `AWS_S3_FORCE_PATH_STYLE` son opcionales para servicios
S3-compatible controlados. En modo `s3`, region, bucket y credenciales son
obligatorios y una configuracion incompleta impide iniciar el modulo. El modo
local no instancia el SDK ni requiere variables AWS.

Ambos adapters implementan guardado, borrado compensatorio y lectura interna
por `storageKey`. La lectura devuelve un `Buffer` limitado a 20 MB y queda
reservada para la orquestacion backend de P5; streaming sera preferible para
hardening productivo. No existe endpoint de descarga, preview, URL presignada
ni upload directo desde navegador. Si S3 guarda correctamente y luego falla la
transaccion PostgreSQL, NestJS intenta borrar el objeto nuevo; esto es una
compensacion best-effort, no una transaccion distribuida ni un reconciliador.

La seleccion del provider no modifica `Credential`, canon, IA, emision o
blockchain, y los DTOs publicos no exponen provider, bucket, key o path.

Renombrar el issuer no modifica snapshots historicos de credenciales. Un draft
antiguo puede conservar `Demo University` en `credentialSubject`, mientras un
draft nuevo deriva `Universidad Argentina de la Empresa (UADE)` desde el
issuer persistido. Para una demo sin datos historicos, usar una base local
nueva, aplicar las migraciones existentes y ejecutar el seed; el seed no
resetea ni limpia la base automaticamente.

## Limites

El backend no tiene frontend para evidencia textual, descarga/preview,
Firebase/cloud storage, mobile, MetaMask, Base Sepolia, sharing/link/QR,
revocacion completa ni hardening productivo blockchain. El modo
`credential_registry_anvil` es exclusivamente local/dev; `mock` sigue siendo
el comportamiento por default.

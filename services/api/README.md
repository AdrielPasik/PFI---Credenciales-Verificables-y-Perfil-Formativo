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
GET  /verify/credentials/:credentialId
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
POST /issuers/:issuerId/credentials/:credentialId/issue
PATCH /issuers/:issuerId/credentials/:credentialId/draft
POST /issuers/:issuerId/credentials/:credentialId/evidence/documents
POST /issuers/:issuerId/credentials/:credentialId/evidence/texts
GET  /issuers/:issuerId/course-templates
POST /issuers/:issuerId/course-templates
POST /issuers/:issuerId/course-templates/from-credential/:credentialId
PATCH /issuers/:issuerId/course-templates/:templateId
POST /issuers/:issuerId/course-templates/:templateId/approved-analysis/from-semantic-analysis/:semanticAnalysisId
GET  /issuers/:issuerId/course-templates/:templateId/approved-analysis/candidate/from-semantic-analysis/:semanticAnalysisId
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

`POST /issuers/:issuerId/credentials/:credentialId/issue` es el contrato
issuer-facing recomendado. No recibe body autoritativo: deriva scoping del path
y actor desde JWT, valida el contexto institucional antes del lookup y
reutiliza la emision existente. Devuelve el read model institucional actualizado.
`POST /credentials/:id/issue` permanece disponible como endpoint legacy.

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
holder, `description` nullable y `hours` como decimal string nullable. Tambien
incluye `issuedAt`, `canonicalHash`, `canonicalizationVersion` y un resumen
nullable del ultimo `BlockchainRecord` con `network`, `chainId`, `txHash`,
`status` y `registeredAt`. No expone IDs relacionales, auth, wallet, metadata,
raw data, payload canonico, direcciones internas, RPC, storage ni artifacts IA.
El read generico `GET /credentials/:id` sigue coexistiendo sin cambios.

El hash se calcula off-chain en NestJS y el registro blockchain conserva
evidencia tecnica de integridad; no reemplaza la validez academica del emisor.
`SemanticAnalysis` no participa en `canon_v1` y no es requisito para emitir.

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

### C3a: catalogo reusable de cursos por issuer (`IssuerCourseTemplate`)

`IssuerCourseTemplate` es un catalogo propio de cada issuer para reutilizar
cursos que carga manualmente (ej. "Plataforma de Cursos Demo" guarda su curso
de Python una vez y lo reutiliza despues). Es deliberadamente **distinto** de
`ExternalCourse`: `ExternalCourse` no tiene `issuerId` ni los campos
correctos para este caso de uso (fue pensado para import externo, no para un
catalogo propio por emisor), y el bundle de auditoria C2b-C3 ya habia
recomendado no reutilizarlo. C3a no migra ni borra `ExternalCourse` -- queda
sin uso para este flujo, sin cambios.

`IssuerCourseTemplate` **no** es una credencial emitida: no participa en
`canon_v1`, no se registra en blockchain y no modifica `Credential` ni
`SemanticAnalysis` existentes. Tampoco hay scraping ni import masivo de
catalogos externos (Udemy/Coursera/AWS no son integraciones reales en este
slice).

### C3a.2: `IssuerCourseTemplate` tambien cubre `certification`

C3a limitaba `from-credential` a `credential.type === 'course'`. C3a.2
extiende el mismo modelo (sin crear una tabla nueva) para que tambien se
pueda guardar como reutilizable una credencial `certification`:

- Se agrego `credentialType: CredentialType` (`@default(course)`, solo
  `course`/`certification` son validos en este catalogo) y los campos
  `certificationCode`, `expirationDate`, `providerName`, `level`,
  `skills: String[]` -- los mismos campos que `credentialSubject` ya
  permite para `certification` en el draft (ver seccion mas abajo).
- **Deuda de naming documentada**: el modelo sigue llamandose
  `IssuerCourseTemplate` (no se renombro fisicamente para no agrandar la
  migracion de C3a.2). El nombre es historico de cuando solo cubria
  `course`; hoy cubre `course` y `certification` por igual.
- `academic_subject` y `degree` **nunca** son validos en este catalogo --
  pertenecen al catalogo academico formal (`AcademicCourse`/`Program`),
  no a un catalogo libre por issuer. `from-credential` los rechaza con
  `400`.
- `credentialType` es **inmutable** despues de creado: no se acepta en
  `PATCH` (define que campos aplican, igual criterio que
  `createdFromCredentialId`).

Endpoints (todos requieren `AuthGuard` + membership `admin`/`operator`
activa del issuer autorizado, mismo patron que el resto de endpoints
issuer-scoped):

- `GET /issuers/:issuerId/course-templates?search=&status=&credentialType=`
  lista templates del issuer solicitado (nunca de otro issuer). `status`
  default `active`; acepta `archived` o `all`. `credentialType` (C3c,
  opcional) acepta `course`, `certification` o `all`; **default `all` --
  sin el parametro, el comportamiento es idéntico a C3a.2** (`course` y
  `certification` mezclados). Cualquier valor invalido responde `400`.
  `search` compara contra `title`, `platformName`, `providerName` y
  `description` con la misma normalizacion (NFD + minusculas es-AR) que
  el catalogo academico. Orden `updatedAt desc`. Limite fijo `20`.
- `POST /issuers/:issuerId/course-templates` crea un template
  manualmente. `credentialType` opcional (`course` por default, para
  compatibilidad con C3a). `title` requerido; `hours` es un `number` JSON
  (no decimal string) >= 0, redondeado a 2 decimales; `externalUrl` debe
  ser HTTP/HTTPS; `competencies` (comun a ambos tipos) se normaliza y
  dedupea case-insensitive. Campos exclusivos de `course`
  (`modality`/`platformName`/`learningOutcomes`) se rechazan si
  `credentialType=certification`, y viceversa para los exclusivos de
  `certification` (`certificationCode`/`expirationDate`/`providerName`/
  `level`/`skills`). Rechaza `issuerId`, `createdByUserId` y `status` en
  el body (siempre se crea `active`).
- `POST /issuers/:issuerId/course-templates/from-credential/:credentialId`
  crea un template a partir de una credencial `course` **o**
  `certification` del mismo issuer (`draft` o `issued`, ambos
  permitidos). Copia `title` (prioridad:
  `credentialSubject.achievement_name`, luego `Credential.title`; si
  ninguno es usable, rechaza con 400), `description`, `hours` y
  `externalUrl` (comunes a ambos tipos), mas los campos exclusivos del
  tipo detectado: `course` copia `platformName`/`modality`/
  `competencies`/`learningOutcomes`; `certification` copia
  `certificationCode`/`expirationDate`/`providerName`/`level`/`skills`/
  `competencies`. **Nunca cruza campos entre tipos** (un `course` nunca
  copia `skills`/`providerName`/`level`; un `certification` nunca copia
  `modality`/`platformName`), y nunca copia `rawData`, `metadata`, datos
  de blockchain/holder ni referencias academicas
  (`academicCourseReference`/`curriculumReference`/`programCourseId`).
  `lastSemanticAnalysisId` toma el ultimo `SemanticAnalysis` de la
  credencial si existe, o `null`. Deduplicacion (separada por
  `createdFromCredentialId`, y por lo tanto por tipo -- una credencial
  fija un solo `credentialType`): si ya existe un template `active` del
  mismo issuer con el mismo `createdFromCredentialId` y un titulo igual
  tras normalizar (trim, espacios colapsados, case-insensitive), responde
  `409 Conflict` con *"Este curso ya fue guardado como reutilizable."*
  (`course`) o *"Esta certificacion ya fue guardada como reutilizable."*
  (`certification`).
- `PATCH /issuers/:issuerId/course-templates/:templateId` actualiza los
  mismos campos que el create (segun el `credentialType` ya fijado del
  template) mas `status` (`active`/`archived`) para archivar. Nunca
  acepta `issuerId`, `createdByUserId`, `credentialType`,
  `createdFromCredentialId` ni `lastSemanticAnalysisId` desde el body.

`hours` se serializa como decimal string (`"22.00"`) en la response, nunca
como objeto `Decimal` crudo -- mismo patron que `Credential.hours` en
`issuer-credential-read.mapper.ts`. La response nunca expone `issuerId` ni
`createdByUserId`, y siempre incluye `credentialType` para que el cliente
distinga `course` de `certification`.

C3b agrego el boton/consumo issuer-facing desde el detalle de credencial
(guardar como reutilizable, sin pantalla de catalogo). C3c cierra el ciclo
del lado de la creacion: agrega `credentialType` como filtro opcional al
`GET` de arriba y agrega el selector en
`POST /credentials/draft` (`/issuer/credentials/new`) que busca, previsualiza
y aplica un template para precargar el formulario -- ver
`docs/architecture/api-contracts-v0.md` (seccion C3c) para el detalle del
consumo frontend y el `PATCH` best-effort que aplica los campos despues de
crear el draft. Pendiente, explicitamente fuera de alcance: usar templates
para reconstruir el perfil formativo (`FormativeProfileService` no cambia,
no aplica).

### C4a.1: aprobacion explicita de una interpretacion semantica como snapshot reutilizable

C4a.1 permite que un issuer apruebe explicitamente una `SemanticAnalysis` ya
generada (por una credencial `course`/`certification` propia) y la persista
como snapshot reutilizable dentro del `IssuerCourseTemplate`. **No** es una
certificacion de la IA sobre el contenido: es una decision del emisor de que
esa interpretacion es reutilizable para futuros templates. No modifica
`Credential`, no crea una nueva `SemanticAnalysis`, no llama a la IA, no
entra en `canon_v1`/hash/blockchain y no reconstruye `FormativeProfile` en
este slice (eso queda para C4b -- ver mas abajo).

Campos agregados a `IssuerCourseTemplate` (aditivos, todos nullable, mismo
patron sin FK que `lastSemanticAnalysisId`/`createdFromCredentialId`):

```prisma
approvedSemanticAnalysisId          String?
approvedSemanticSnapshot            Json?
approvedSemanticApprovedByUserId    String?
approvedSemanticApprovedAt          DateTime?
approvedSemanticPipelineVersion     String?
approvedSemanticTaxonomyVersion     String?
approvedSemanticSourceCredentialId  String?
```

Deliberadamente **no** se agrego `approvedSemanticProfileId`: la aprobacion
no se acopla a ningun perfil en este slice.

- `POST /issuers/:issuerId/course-templates/:templateId/approved-analysis/from-semantic-analysis/:semanticAnalysisId`
  (requiere `AuthGuard` + membership `admin`/`operator` activa del issuer,
  mismo patron que el resto del modulo). Reglas de validacion, en orden:
  - El template debe existir y pertenecer al issuer solicitado (`404` si
    no).
  - La `SemanticAnalysis` debe existir y su `credential.issuerId` debe
    coincidir con el issuer solicitado; si pertenece a otro issuer se
    responde el mismo `404` que "no existe" (nunca se filtra su
    existencia con un `403`).
  - `semanticAnalysis.credential.type` debe ser exactamente igual a
    `template.credentialType` (`400` si no). Como `template.credentialType`
    solo puede ser `course`/`certification`, esta misma regla rechaza por
    construccion cualquier intento de aprobar un analisis de una credencial
    `academic_subject` o `degree`.
  - `semanticAnalysis.status` debe ser usable: se permite `completed` y
    **`partial`** (el emisor puede aprobar una interpretacion parcial a su
    criterio -- Traza no la trata como completa por eso). No existe un
    estado `failed` en `SemanticAnalysis` (un analisis fallido nunca llega a
    persistirse como fila; queda solo como `AnalysisRun` con
    `status: failed`), pero el guard rechaza explicitamente cualquier valor
    que no sea `completed`/`partial` de forma defensiva. **El emisor
    aprueba esta interpretacion parcial para reutilizacion, no se afirma
    completitud automatica.**
  - Si `template.createdFromCredentialId` esta definido, la
    `SemanticAnalysis` debe pertenecer exactamente a esa credencial
    (`400` si no). Si `template.createdFromCredentialId` es `null` (template
    creado manualmente), se permite aprobar un analisis de **cualquier**
    credencial del mismo issuer y del mismo `credentialType` -- comportamiento
    intencional, documentado aca y en `domain-rules-v0.md`.
  - Al aprobar, se actualizan los 7 campos de arriba:
    `approvedSemanticAnalysisId`/`approvedSemanticSourceCredentialId` desde
    la `SemanticAnalysis`; `approvedSemanticApprovedByUserId` desde
    `currentUser.id`; `approvedSemanticApprovedAt` con la fecha de
    aprobacion; `approvedSemanticPipelineVersion`/
    `approvedSemanticTaxonomyVersion` copiados de la `SemanticAnalysis`;
    `approvedSemanticSnapshot` construido por
    `buildApprovedTemplateSemanticSnapshot` (ver mas abajo).

**Snapshot allowlisted** (`buildApprovedTemplateSemanticSnapshot` en
`issuer-course-templates.helpers.ts`) -- nunca una copia ciega de
`analysisJson`. Copia unicamente: `status`, `areas`/`skills`/`concepts`
(cada entrada reducida a `{id, label, confidence}`, entradas malformadas se
descartan en silencio), `hoursDistribution` (leido defensivamente de
`analysisJson`, con el mismo fallback de dos rutas que usa
`FormativeProfileService`), `confidence` (numero, `[0,1]`, convertido desde
el `Decimal`), `warnings` y `qualityFlags`. **Nunca copia**: `analysisJson`
completo, `sourceRefs`, `evidenceMap`, `textForEmbedding`, IDs de
`DocumentEvidence`/`TextEvidence`, `storageKey`/paths, texto crudo de PDF,
metadata de debug/audit, datos de holder/blockchain ni tokens/secrets --
hay tests que fallan explicitamente si cualquiera de esas claves aparece en
el snapshot serializado. **Decision de diseño documentada**: el snapshot
**omite** `competencies` y `learningOutcomes` -- esos campos no existen en
`SemanticAnalysis` (solo existen como dato *emitido* por el issuer en
`Credential.credentialSubject`); incluirlos como arrays vacios inventaria
un dato que no aplica a esta fuente, violando el principio "emitido vs
inferido" ya establecido para `FormativeProfileService`.

La response del template (mismo `CourseTemplateResponseDto` de C3a/C3a.2,
extendido de forma aditiva) nunca expone el snapshot completo -- solo
`approvedSemanticSnapshotSummary` (`schema`, `status`, `areaCount`,
`skillCount`, `conceptCount`, `hasHoursDistribution`, `warningCount`,
`qualityFlagCount`, o `null` si no hay aprobacion), ademas de
`approvedSemanticAnalysisId`, `approvedSemanticApprovedAt`,
`approvedSemanticPipelineVersion`, `approvedSemanticTaxonomyVersion` y
`approvedSemanticSourceCredentialId`.

**Migracion no aplicada en este slice**: la migracion
`20260811193253_add_approved_semantic_snapshot_to_issuer_course_template`
fue creada con `prisma migrate dev --create-only` (nunca ejecutada contra la
base remota) porque `DATABASE_URL` en este entorno resuelve a un Neon
compartido -- ver seccion de migraciones mas abajo. Queda pendiente que el
usuario la aplique manualmente (`prisma migrate dev` o `prisma migrate
deploy`) cuando lo decida.

**Pendiente, explicitamente fuera de alcance de C4a.1**:

- La UI de revision/aprobacion (botones, pantalla) es C4a.2 -- ver seccion
  propia mas abajo (ya implementada).
- Aplicar la interpretacion aprobada a credenciales nuevas o reconstruir
  `FormativeProfile` a partir de ella es C4b.
- Un endpoint para revocar/limpiar la aprobacion (ej.
  `DELETE /issuers/:issuerId/course-templates/:templateId/approved-analysis`)
  no se implemento en este slice -- queda documentado como pendiente.

### C4a.2: endpoint `candidate` de solo lectura para revisar antes de aprobar

C4a.2 agrega la UI issuer-facing en `apps/web` (ver
`apps/web/README.md`) para el flujo de aprobacion de C4a.1, y un endpoint
backend nuevo de solo lectura que permite mostrar un resumen seguro **antes**
de aprobar (el endpoint de aprobacion de C4a.1 solo devuelve el resumen
*despues* de aprobar):

```
GET /issuers/:issuerId/course-templates/:templateId/approved-analysis/candidate/from-semantic-analysis/:semanticAnalysisId
```

Requiere `AuthGuard` + membership `admin`/`operator` activa del issuer.
Reutiliza exactamente las mismas reglas de validacion que
`approveTemplateSemanticAnalysisForIssuer` (C4a.1): ambos metodos del
`IssuerCourseTemplatesService` llaman a un unico metodo privado compartido,
`resolveApprovableSemanticAnalysis`, extraido especificamente para que las
reglas de scoping/tipo/status/`createdFromCredentialId` nunca puedan
divergir entre el `GET` y el `POST`. Nunca actualiza
`IssuerCourseTemplate`, nunca crea una `SemanticAnalysis`, nunca llama a la
IA -- es puramente de lectura.

Response (`TemplateSemanticApprovalCandidateResponseDto`):

```json
{
  "semanticAnalysisId": "...",
  "status": "completed",
  "pipelineVersion": "...",
  "taxonomyVersion": "...",
  "sourceCredentialId": "...",
  "summary": {
    "schema": "approved_template_semantic_snapshot_v1",
    "status": "completed",
    "areaCount": 0,
    "skillCount": 0,
    "conceptCount": 0,
    "hasHoursDistribution": false,
    "warningCount": 0,
    "qualityFlagCount": 0
  }
}
```

`summary` usa el mismo allowlist que `approvedSemanticSnapshotSummary` de
C4a.1 (construido a partir de `buildApprovedTemplateSemanticSnapshot`, sin
duplicar la logica de saneamiento) -- nunca expone el snapshot completo,
`analysisJson`, `sourceRefs`, `evidenceMap`, `textForEmbedding`, IDs de
evidencia, storage paths, texto crudo, debug/audit, datos de
holder/blockchain ni tokens/secrets.

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

Después de una emisión issuer-scoped exitosa, el backend intenta crear y
ejecutar un `AnalysisRun` documental `system` cuando existe un PDF `current`.
El intento ocurre fuera de la transacción de emisión, reutiliza la evidencia
exacta y evita duplicar un run activo o completado para esa misma fuente. La
ausencia de PDF o un fallo de storage/AI/persistencia semántica no bloquean ni
revierten la emisión. Los endpoints manuales de análisis permanecen limitados
a drafts; `combined` sigue sin ejecutarse (todavía no implementado, ver
abajo).

### C2b.2 — `AnalysisRun` textual (manual, sin auto-trigger)

`POST /issuers/:issuerId/credentials/:credentialId/analysis-runs/text` crea y
ejecuta, de forma sincrónica y draft-only, un `AnalysisRun` con
`inputMode=text` sobre la `TextEvidence` `current` de la credencial. Sigue
exactamente el mismo patrón que el endpoint `.../analysis-runs/document`:
`AuthGuard`, admin/operator activo del issuer autorizado, credencial scoped al
issuer, y el mismo DTO de respuesta seguro (`analysisRunId`, `credentialId`,
`status`, `semanticAnalysisId`, `artifactStatus`, `sourceCount`,
`completedAt` — nunca `content`, el artifact crudo, `textForEmbedding` ni
storage keys).

- Reusa `AnalysisRunService.createPendingRun` (nunca crea `AnalysisRun` o
  `AnalysisRunSource` a mano) y el mismo `claim -> ejecutar -> completar/failed`
  que ya prueba el flujo documental, ahora también para `inputMode=text`
  (`AnalysisRunExecutionService.executePendingTextRun`).
- Lee `TextEvidence.content` a partir de la fuente asociada al run (nunca
  desde parámetros libres del request) y envía al AI Service `content` +
  metadata declarada (`credentialType`, `platform_name`, `modality`, `hours`
  cuando existen en `Credential`/`credentialSubject`) + `sourceRefs`
  (`textEvidenceId`, `credentialId`) — nunca `externalUrl` ni contenido
  textual dentro de la metadata.
- Si no hay `TextEvidence` vigente: `422` con
  *"La credencial no tiene evidencia textual vigente para analizar."*
- Deduplicación por fuente exacta: si ya existe un `AnalysisRun` `text` en
  estado `pending`/`running`/`completed` para la MISMA `TextEvidence.id`
  vigente, se rechaza con `409` en vez de crear o reejecutar un run
  duplicado. Reemplazar la evidencia (nueva `TextEvidence` `current`) libera
  un análisis nuevo, porque el filtro es por `textEvidenceId` exacto, no por
  `credentialId`.
- `combined` sigue rechazado explícitamente con
  *"El análisis combinado todavía no está implementado."* en ambos puntos de
  entrada (documental y textual).
- Todavía NO genera `TextEvidence` automáticamente desde los campos
  declarados de un `course` (`achievementName`/`description`/
  `competencies`/`learningOutcomes`) y todavía NO se dispara al emitir una
  credencial sin PDF — eso ya lo hace C2b.3 (ver abajo). Este endpoint
  sigue existiendo para disparar manualmente un análisis textual
  puntual (por ejemplo, reanalizar una `TextEvidence` reemplazada).

### C2b.3 — Análisis textual automático de `course` sin PDF al emitir

Después de una emisión issuer-scoped exitosa, si la credencial es
`type=course` y **no** tiene un PDF `current`, el backend intenta generar o
reutilizar una `TextEvidence` y ejecutar un análisis textual `system`
best-effort — el mismo camino de C2b.2, ahora disparado automáticamente,
igual que ya ocurre con PDFs desde antes de C2b.

- **Prioridad PDF sobre texto, siempre:** `AutomaticCourseTextAnalysisService`
  hace su propio chequeo de `DocumentEvidence` `current` `kind=pdf` y se
  salta por completo si existe uno — nunca genera ni analiza texto en ese
  caso. `AutomaticDocumentAnalysisService` (documental) no fue modificado;
  ambos servicios se llaman siempre, uno detrás del otro, pero por
  construcción nunca ejecutan un análisis real los dos en la misma emisión.
- **Texto analizable:** `buildCourseTextAnalysisContent` (función pura,
  `services/api/src/credentials/course-text-analysis-content.ts`) construye
  el contenido SOLO desde `achievementName`/`title`, `description`,
  `competencies` y `learningOutcomes` — nunca `platformName`, `providerName`,
  `modality`, `externalUrl`, issuer, holder, credential id, blockchain ni
  metadata completa. Regla de suficiencia conservadora: una descripción con
  señal propia (≥ 30 caracteres) alcanza sola; si no, se exige al menos dos
  fuentes formativas distintas presentes (por ejemplo, título + una
  competencia) y que el contenido final normalizado supere los 30
  caracteres. Un título genérico solo (`"Curso"`, `"Python"`,
  `"Capacitación online"`) nunca dispara análisis, aunque sea largo.
- **Prioridad de fuentes textuales:** si la credencial ya tiene una
  `TextEvidence` `current` (cargada manualmente por el emisor, o de una
  ejecución anterior), **nunca se reemplaza ni se genera una nueva** — se
  usa esa evidencia tal cual como fuente. Solo se genera una `TextEvidence`
  nueva cuando no existe ninguna `current`. El schema actual no distingue
  origen manual vs. generado por sistema; esta es la regla conservadora
  elegida para no pisar contenido cargado por el emisor.
- **`TextEvidence` generada por sistema:** `TextEvidenceService.
  ensureSystemGeneratedCurrentTextEvidenceForCredential` crea la fila con
  `label` explícito *"Texto generado para análisis desde datos declarados
  del curso"* (nunca dice "cargado por el emisor"), `submittedByUserId` es
  el usuario que ejecutó la emisión (un usuario real y autenticado, no un
  usuario de sistema inventado — el schema exige un `submittedByUserId` no
  nulo), y `sha256` real sobre el contenido normalizado. No borra historial,
  no cambia `Credential` ni `credentialSubject`.
- **Deduplicación por `TextEvidence.id` exacta, más estricta que la manual:**
  a diferencia del endpoint manual de C2b.2 (que permite reintentar después
  de un `failed`), el auto-trigger nunca reintenta si ya existe CUALQUIER
  `AnalysisRun` `text` — `pending`, `running`, `completed` o `failed` — para
  la misma `TextEvidence.id`. Best-effort significa "se intenta una vez",
  no "se reintenta indefinidamente en cada emisión o reintento de request".
- **Nunca revierte la emisión:** `AutomaticCourseTextAnalysisService`
  atrapa y loguea de forma segura cualquier error interno (generación de
  evidencia, creación del run, ejecución IA) — nunca lanza. El caller
  (`IssuerCredentialIssueService`) además envuelve la llamada en su propio
  `try/catch` como segunda red de seguridad.
- **No toca canon/hash/blockchain:** ningún paso de este flujo modifica
  `Credential.canonicalHash`, `BlockchainRecord` ni el flujo de emisión —
  corre después de que la emisión (con su hashing/blockchain) ya se
  completó.
- **Rebuild de perfil:** desde C2b.4 (ver abajo), un análisis textual
  automático exitoso SI reconstruye el `FormativeProfile` del holder,
  best-effort. Antes de C2b.4 esto requería `POST /me/profile/rebuild`
  manual; ese endpoint sigue existiendo para reconstrucciones explícitas
  o para credenciales analizadas antes de C2b.4.
- **Contenido permitido para el análisis automático:** `course` incluye
  título, descripción, competencias y `learningOutcomes` cuando existen;
  `certification` incluye título, descripción, código, vencimiento,
  proveedor, nivel, skills y competencias. Cada builder usa allowlist por
  tipo: nunca incorpora plataforma, referencias académicas, snapshots o
  análisis anteriores, hashes, blockchain, `rawData` ni datos privados del
  holder.
- **Pendiente (C2c/C3/C4):** presentación de horas/cobertura semántica
  mejorada, catálogo reutilizable de cursos y aprobación curada de
  interpretaciones IA quedan fuera de este slice — ver
  `c2b-c3-text-ai-course-catalog-design-review-bundle.txt`.

### C2b.4 — Reconstrucción automática del perfil holder tras análisis IA exitoso

### C5 — Revisión semántica antes de reutilizar

Una credencial `course` o `certification` solo puede convertirse en un
template reutilizable cuando ya está `issued`. El emisor revisa labels
allowlisted de áreas, habilidades y conceptos y el backend persiste un
snapshot `approved_template_semantic_snapshot_v2`; no modifica el
`SemanticAnalysis` original, la credencial ni el perfil. Los templates legacy
con snapshot v1 siguen siendo compatibles y pueden revisarse nuevamente. C4b
sigue pendiente: ningún snapshot aprobado se aplica a una credencial futura o
al perfil.

Después de que un análisis IA **automático** (`trigger=system`, documental
o textual) termina `completed` y ya persistió un `SemanticAnalysis`, el
backend reconstruye el `FormativeProfile` actual del holder de forma
best-effort — sin esperar a que alguien llame
`POST /me/profile/rebuild` manualmente.

- **Dónde se dispara:** `AutomaticProfileRebuildService` (nuevo, en
  `services/api/src/analysis-run/`), llamado desde
  `AutomaticDocumentAnalysisService` y `AutomaticCourseTextAnalysisService`
  — únicamente después de que `executePendingDocumentRun`/
  `executePendingTextRun` retorna exitosamente (nunca antes). No se
  dispara desde `AnalysisRunExecutionService` a propósito: ese servicio
  no distingue `trigger=system` de `trigger=manual` en su lógica de
  ejecución, y disparar el rebuild ahí habría afectado también al
  endpoint manual issuer-facing (C2b.2), que **no** reconstruye perfil en
  este slice.
- **Cómo obtiene el holder:** `Credential.subjectUserId` — leído desde la
  misma credencial que ya se está analizando (columna requerida, siempre
  presente si la credencial existe).
- **Aplica a:** análisis documental automático post-emisión Y análisis
  textual automático post-emisión de `course` sin PDF. Como máximo uno de
  los dos ejecuta un análisis real por emisión (ver C2b.3), así que como
  máximo hay un rebuild por emisión.
- **NO aplica a `trigger=manual`:** ni el endpoint manual documental
  (P5c) ni el manual textual (C2b.2) disparan rebuild automático en este
  slice — el flujo manual puede querer revisión antes de impactar el
  perfil holder; la reconstrucción explícita sigue disponible vía
  `POST /me/profile/rebuild`.
- **Best-effort observable:** si `rebuildForUser` falla, el error se atrapa,
  devuelve y loguea con el código estable
  `formative_profile_rebuild_failed` (sin copiar el mensaje de excepción,
  `analysisJson`, contenido textual, storage path ni secretos). El
  `AnalysisRun` ya quedó `completed` antes
  de intentar el rebuild — un fallo aquí nunca lo revierte a `failed` ni
  afecta la emisión.
- **No llama IA de nuevo:** `rebuildForUser` solo lee/escribe Postgres.
- **No cambia la lógica del perfil:** este slice solo automatiza el
  disparo; la separación horas emitidas/estimadas, skills inferidas y
  demás reglas de `FormativeProfileService` quedan exactamente igual
  (mejorarlas es C2c, fuera de alcance aquí).

La emisión issuer-scoped no convierte el PDF en requisito universal: una
`TextEvidence` vigente también puede respaldarla y una evidencia documental no
PDF sigue siendo evidencia institucional aunque no active el análisis actual.
Sin fuentes, el contrato backend se conserva para modos futuros; el Portal
Emisor solicita una confirmación adicional y no considera skills ni
competencias como evidencia por sí mismas.

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

### C4x fix — `certification` gana analisis textual automatico; `platformName` se cierra tambien backend-side

C4x (ver `docs/architecture/domain-rules-v0.md`, seccion 20) fue
exclusivamente frontend y dejo documentada deuda funcional: para
`certification` sin PDF, la UI ya afirmaba que los datos declarados
sirven de base textual, pero el backend nunca disparaba nada real desde
ahi; y `platformName` dejo de ser un input en el editor de `course`, pero
el backend seguia aceptando/persistiendo un valor arbitrario via API
directa. Este fix (docs/architecture/domain-rules-v0.md, seccion 20.1)
cierra ambos riesgos, sin implementar C4b, sin tocar
`FormativeProfileService`, `services/ai-service`, `contracts`,
blockchain, canonicalizacion/hash ni Prisma/migrations.

- **`certification` sin PDF gana el mismo camino que C2b.3 (ver arriba)**:
  `AutomaticCourseTextAnalysisService.analyzeIssuedCredentialIfEligible`
  (metodo renombrado desde `analyzeIssuedCourseIfEligible` -- el nombre
  de la clase quedo de cuando solo cubria `course`, no se renombro para
  no agrandar el diff de DI/wiring en 4 archivos) ahora evalua tambien
  `certification` `issued` sin `DocumentEvidence` PDF `current`.
  `buildCertificationTextAnalysisContent`
  (`services/api/src/credentials/course-text-analysis-content.ts`) usa
  exclusivamente `achievementName`/`title`, `description`,
  `certificationCode`, `expirationDate`, `providerName`, `level`,
  `skills`, `competencies` -- nunca `modality`, `platformName`,
  `academicCourseReference`/`curriculumReference`,
  `approvedSemanticSnapshot`/`approvedSemanticAnalysisId`/
  `lastSemanticAnalysisId`, ninguna `SemanticAnalysis` existente, datos
  de blockchain/canonical/hash ni `rawData` completo.
  `learningOutcomes` nunca se envia para `certification` (no existe en
  su contrato). Misma regla de suficiencia conservadora, mismo
  mecanismo de deduplicacion por `TextEvidence.id` exacta (incluye
  `failed`), mismo patron best-effort/nunca-revierte, y mismo rebuild
  automatico de perfil de C2b.4 sin cambios si el analisis completa.
  `TextEvidenceService.ensureSystemGeneratedCurrentTextEvidenceForCredential`
  ahora recibe un `label` explicito por tipo: course conserva *"Texto
  generado para analisis desde datos declarados del curso"`,
  certification usa *"Texto generado para analisis desde datos
  declarados de la certificacion"*.
- **`platformName` se cierra tambien backend-side para `course`**:
  - `PATCH` de borrador (`issuer-credential-draft-subject.ts`): se
    rechaza con `400` explicito en cuanto se envia (con o sin valor
    `null`), para cualquier tipo. Se mantiene en el set "aplicable" de
    `course` unicamente para que un `platform_name` legacy ya persistido
    sobreviva sin cambios a un `PATCH` que edita otro campo -- nunca se
    borra como efecto secundario de un patch no relacionado.
  - Creacion de borrador (`credentials.service.ts#createDraft`): el
    `credentialSubject` de entrada es JSON crudo sin allowlist por
    campo (a diferencia del `PATCH`); se **ignora** (descarta)
    `platform_name` si llega en el payload para `type=course`, en vez
    de rechazar toda la creacion por esa unica clave -- asimetria
    intencional y documentada respecto al `PATCH`.
  - Templates reutilizables (`issuer-course-templates.validator.ts`):
    `platformName` deja de estar en el allowlist de entrada de
    `create`/`PATCH` -- se **rechaza con `400`** para cualquier
    `credentialType`, mismo mecanismo que ya rechaza `issuerId`/
    `createdByUserId`. `createTemplateFromCredentialForIssuer` deja de
    copiar `platform_name` hacia un template nuevo creado desde una
    credencial `course`.
  - En los tres casos, un `platform_name`/`platformName` legacy ya
    persistido sigue leyendose/mostrandose sin cambios -- nunca se
    borra, nunca se migra, Prisma no se toco.
  - **Ajuste puntual de frontend expuesto por este cierre backend**: el
    `PATCH` best-effort que `apps/web` dispara tras aplicar un template
    de `course` en C3c (`applyTemplateToNewDraft`, `new-credential-route.tsx`)
    todavia enviaba `platformName`. Al ser un unico body, el nuevo `400`
    del backend habria tumbado tambien `modality`/`externalUrl`/
    `competencies`/`learningOutcomes` de ese mismo request. Se quito esa
    unica linea del payload -- ver `apps/web/README.md`, seccion C4x, para
    el detalle completo.

### C4y — contenido declarado y rebuild observable

Para `course` y `certification`, el análisis textual automático usa una
allowlist de datos declarados por el emisor. `course` incorpora título,
descripción, competencias y `learningOutcomes`; `certification` incorpora
título, descripción, código, vencimiento, proveedor, nivel, skills y
competencias. No usa plataforma, referencias académicas, snapshots ni análisis
anteriores, hashes, blockchain, `rawData` ni datos privados del titular.

Después de persistir el análisis, el rebuild del perfil crea un nuevo snapshot
`isCurrent` y mantiene separadas las declaraciones del emisor de áreas, skills
y conceptos inferidos. Si el rebuild falla, el análisis y la emisión se
conservan; se registra el código seguro `formative_profile_rebuild_failed`.
No se aplica `approvedSemanticSnapshot`: C4b permanece pendiente.

## V1: verificacion publica de credenciales

`GET /verify/credentials/:credentialId` es un read model publico, sin JWT y
sin efectos secundarios. Solo devuelve credenciales `issued` o `revoked`; un
`draft` responde igual que una referencia inexistente. La respuesta usa una
allowlist con titulo, tipo, emisor/DID, titular minimo/DID, fechas, hash corto
y evidencia tecnica de blockchain. No devuelve email del titular, datos de
membership, `credentialSubject`, `rawData`, metadata, evidencia documental o
textual, analisis IA, rutas de storage, secretos ni datos internos.

No consulta RPC ni blockchain en vivo: presenta solo el ultimo registro ya
persistido. Esa evidencia tecnica no reemplaza la validez academica del emisor.

## Perfil formativo

`POST /me/profile/rebuild` es un trigger local/dev explicito. Construye un snapshot `FormativeProfile` desde credenciales `issued` del holder y el ultimo `SemanticAnalysis` persistido por credencial.

- no ejecuta IA ni Python;
- no inventa areas, skills o concepts;
- no modifica `Credential`, `SemanticAnalysis` ni `BlockchainRecord`;
- conserva evidencia por `credentialId` y `semanticAnalysisId` dentro de `profileJson`;
- si una credencial no tiene analisis, genera warning y continua;
- para `course`, ignora `credentialSubject.skills` legacy durante la
  agregacion; conserva `competencies` y `learning_outcomes`, y solo toma
  habilidades desde `SemanticAnalysis` cuando exista;
- mantiene un perfil actual mediante transaccion Prisma.

### C2c: horas oficiales y cobertura semantica

`profileJson.summary` agrega tres campos derivados, sin migracion y sin
tocar como se calculan `areas`/`skills`/`concepts`:

- `totalOfficialHours`: igual a `totalHours` (suma de `Credential.hours`
  de credenciales `issued`). Nombre inequivoco: nunca es una distribucion
  por area ni una estimacion de IA.
- `credentialsWithoutHours`: cantidad de credenciales `issued` con
  `hours === null`. Solo cuenta, nunca infiere ni completa un valor.
- `credentialsWithoutSemanticCoverage`: cantidad de credenciales `issued`
  sin `SemanticAnalysis` utilizable (mismo criterio que ya generaba el
  warning `credential_without_semantic_analysis`).

Los dos contadores son independientes: una credencial puede faltar en
uno, el otro, ambos o ninguno. El nombre de la credencial nunca participa
del calculo de horas/areas -- el `select` de Prisma en `rebuildForUser` no
incluye `title` ni `achievementName`.

`GET /me/profile/current` y `POST /me/profile/rebuild` exponen estos
campos vía `holder-current-profile.mapper.ts` sin nuevo endpoint.
Perfiles generados antes de C2c (sin `profileJson.summary` con estos
campos) se sirven con `totalOfficialHours` calculado desde `totalHours` y
los contadores en `null` (no `0` -- "no sabemos" es distinto de "cero
credenciales sin cobertura").

El backend tambien puede validar y persistir artifacts IA reales mediante la
integracion HTTP existente. `POST /credentials/:id/semantic-analysis/from-pdf`
y `POST /me/profile/build-from-ai` permanecen protegidos por el JWT humano en
NestJS; el navegador nunca llama FastAPI ni recibe la credencial interna entre
servicios.

### Reanalysis/backfill interno (IA-Q1c)

`SemanticAnalysis` ya persistido no se recalcula solo porque el AI Service
mejore su taxonomia (IA-Q1/IA-Q1b). `npm run analysis:reprocess:documents`
es una herramienta interna de admin/demo -no un endpoint publico- para volver
a analizar credenciales `issued` con `DocumentEvidence` PDF vigente, usando el
mismo pipeline que el analisis automatico
(`AnalysisRunService.createPendingRun` + `AnalysisRunExecutionService`):

```bash
# dry-run (default): no escribe, no llama IA
npm run analysis:reprocess:documents --workspace @credential-intelligence/api -- \
  --holderEmail holder.demo@example.com

# ejecuta de verdad, fuerza reanalisis aunque ya haya un run completed,
# y reconstruye el perfil del holder al final
npm run analysis:reprocess:documents --workspace @credential-intelligence/api -- \
  --holderEmail holder.demo@example.com --force --rebuildProfile --execute

npm run analysis:reprocess:documents --workspace @credential-intelligence/api -- \
  --credentialId <id> --force --execute

npm run analysis:reprocess:documents --workspace @credential-intelligence/api -- --help
```

- `--execute` es obligatorio para escribir en la base y llamar al AI Service;
  sin el, el script es dry-run puro.
- Requiere exactamente uno de `--holderEmail` o `--credentialId` (sin
  busquedas parciales; falla con uso seguro si falta o si vienen ambos).
- Sin `--force`, saltea una credencial que ya tenga un `AnalysisRun`
  `completed` para el `DocumentEvidence` `current` exacto (si la evidencia
  fue reemplazada, la evidencia nueva SI se reanaliza sin `--force`). Con
  `--force`, un run `pending`/`running` para esa misma evidencia sigue
  bloqueando -nunca se toma control de un run en curso.
- No borra `AnalysisRun` ni `SemanticAnalysis` anteriores, no muta
  `Credential`, no cambia `issued`/`revoked`/`draft`.
- No agrega enums Prisma nuevos: usa `inputMode=document`,
  `trigger=system`, `requestedByUserId=null`, igual que el analisis
  automatico best-effort al emitir.
- `--rebuildProfile` llama a `FormativeProfileService.rebuildForUser`
  directamente (no al endpoint HTTP) despues de procesar el batch, solo si
  hubo al menos una ejecucion exitosa con `--execute`.
- Logs seguros: id/status/titulo truncado de la credencial, skip reason,
  run id, errorCode ya sanitizado por `AnalysisRunExecutionService`. Nunca
  storageKey, bytes de PDF, artifact crudo, `analysisJson` ni secretos.

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

P6d clasifica los fallos documentales de IA sin exponer internals en el read
model: `ai_input_rejected` indica revisar la evidencia; `ai_version_conflict`
indica revisar despliegue/versiones; `ai_dependency_unavailable` apunta a la
imagen o dependencias FastAPI; `ai_network_unreachable` apunta a conectividad o
base URL; `ai_invalid_configuration` a variables de entorno; y
`ai_invalid_response` a contrato/respuesta upstream. Esto no repara el fallo
por si solo. El log interno de NestJS conserva solamente la categoria, status
HTTP si existe, causa de red segura y un detalle sanitizado/truncado. Para
analisis documentales, `X-Analysis-Run-Id` transporta la correlacion interna;
no contiene identidad de usuario ni secretos.

En cloud demo se observo un fallo transitorio de cold start/gateway del Web
Service Free: un run automatico registro `ai_invalid_response` con HTTP `502`
antes de recibir JSON valido. Health posterior y un nuevo analisis funcionaron.
La emision no se revierte porque el analisis es best-effort. Antes de una demo
IA, consultar el health tecnico del AI Service; no registrar ni compartir URL,
token, storage key, PDF ni logs crudos. La solucion estructural futura es una
instancia sin spin-down y Private Service o equivalente cuando sea viable.

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
- `npm run test:issuer-course-templates --workspace @credential-intelligence/api`
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
`Universidad Argentina de la Empresa (UADE)`, ademas de `Administrador UADE`,
`Demo Holder`, 617 `AcademicCourse`, 22 `Program`, 22 `CurriculumVersion` y
977 `ProgramCourse`. Los codigos institucionales y las relaciones pertenecen
al catalogo demo UADE y provienen de los artifacts locales versionados en
`data/academic_catalog`. Las credenciales demo
local/dev son:

- `emisor.uade@uade.edu.ar / UadeDemo123!`
- `holder.demo@example.com / DemoHolder123!`

El seed tambien crea (o actualiza de forma idempotente) un segundo issuer
demo generico, `Plataforma de Cursos Demo`
(`prisma/demo-course-platform-issuer-seed.ts`), con su propio usuario y
membership `admin` activa:

- `cursos.demo@example.com / CursosDemo123!`

Este issuer existe para habilitar el flujo manual de credenciales `course`
(login como emisor -> crear draft -> completar datos -> emitir -> el holder
ve el impacto en su wallet) sin depender de una integracion real con ninguna
plataforma de cursos. No representa a Udemy, Coursera, AWS ni ninguna marca
real; el nombre del issuer es deliberadamente generico. El seed no crea
credenciales `course` de ejemplo: la emision queda para probarse manualmente
o para un slice posterior de datos demo. Ni el issuer UADE ni el holder demo
existentes se modifican al agregar este issuer.

En el MVP, solo el issuer UADE identificado por `did:example:issuer-demo`
puede crear `academic_subject` y `degree`; cualquier otro issuer autorizado
solo puede crear `course` o `certification`. Para cursos, el PATCH acepta
`competencies` y `learningOutcomes`, pero no `providerName`, `level` ni
`skills`; `modality` solo acepta `Presencial`, `Online` o `Asincrónica`.
El analisis semantico textual de cursos aun no esta implementado: el flujo IA
actual procesa PDF y no infiere habilidades desde datos declarados.

Los emails y nombres demo de ambos administradores (UADE y Cursos Demo)
cambiaron una vez (naming en espanol, sin sabor "generado por IA"; ver
`issuer.admin@example.com`/`Issuer Admin` y
`platform.issuer.demo@example.com`/`Demo Course Platform Admin` como
identidades legadas). El seed y el bootstrap puntual ubican al usuario
existente por su identidad legada (email o DID anterior) y lo renombran en
el lugar preservando su `id`, en vez de un upsert simple por email -que
duplicaria el usuario si el email cambia y el registro viejo ya existe en
el ambiente-. El DID de ambos administradores no cambio junto con el email:
sigue siendo `did:example:issuer-admin-demo` (UADE) y ahora
`did:example:cursos-demo-admin` (Cursos Demo, el unico DID que si cambio,
documentado en `demo-course-platform-issuer-seed.ts`). Si por accidente
coexistieran un registro con la identidad legada y otro ya con la nueva, el
seed falla con un mensaje explicito en vez de borrar o fusionar nada
automaticamente.

`prisma/seed.ts` es un script monolitico: si falla en un paso posterior (por
ejemplo, la carga del catalogo academico, que inserta cientos de filas), todo
lo que se crea despues de ese punto -incluyendo el usuario, la membership y el
AuthCredential de cualquiera de los dos administradores demo- queda sin
crear, aunque el issuer correspondiente ya haya quedado persistido (los
issuers se crean antes en el script). Para reparar ese estado parcial contra
un ambiente cloud/demo sin correr el seed completo (y sin tocar
`AcademicCourse`, `Program`, `CurriculumVersion`, `ProgramCourse` ni el
holder demo), el comando recomendado es:

```text
npm run prisma:seed:demo-identities --workspace @credential-intelligence/api
```

Ejecuta `prisma/seed-demo-identities.ts`, que asegura AMBAS identidades de
emisor demo en una sola corrida -UADE (`emisor.uade@uade.edu.ar`) y
"Plataforma de Cursos Demo" (`cursos.demo@example.com`)- reutilizando
integramente `bootstrapDemoUadeAdmin` (exportado desde `seed.ts`) y
`bootstrapDemoCoursePlatformUser`, sin reimplementar ninguna logica de
upsert o renombrado. Es el comando recomendado para cloud/demo porque
actualiza ambas identidades sin el riesgo ni el costo de tiempo del seed
completo. Imprime un resumen seguro:

```json
{
  "uadeIssuerReady": true,
  "uadeUserReady": true,
  "uadeAuthCredentialReady": true,
  "uadeMembershipReady": true,
  "courseIssuerReady": true,
  "courseUserReady": true,
  "courseAuthCredentialReady": true,
  "courseMembershipReady": true
}
```

sin exponer `passwordHash` ni `DATABASE_URL`. Correrlo dos veces no duplica
nada. Si el usuario de UADE o el de Cursos Demo tiene ya la identidad legada
(`issuer.admin@example.com` / `platform.issuer.demo@example.com`), lo
renombra en el lugar preservando su `id`; si por accidente coexisten la
identidad legada y la nueva para el mismo administrador, falla con un
mensaje explicito y no borra ni fusiona nada.

Tambien sigue disponible (y sin cambios de comportamiento) el bootstrap
puntual que asegura unicamente la identidad de Cursos Demo:

```text
npm run prisma:seed:course-platform-user --workspace @credential-intelligence/api
```

Ejecuta `prisma/seed-course-platform-user.ts`, util cuando solo hace falta
reparar/asegurar esa identidad especifica.

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

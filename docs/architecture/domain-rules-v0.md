# Domain Rules v0

> Este documento registra reglas de negocio minimas acordadas antes de modificar `schema.prisma`, crear migraciones o construir APIs del backend.

## Objetivo

Dejar explicitadas las decisiones preliminares que deben guiar:

- futuros ajustes del modelo Prisma;
- validadores y DTOs;
- reglas transaccionales del backend;
- consistencia entre credenciales, perfiles, blockchain, sharing y permisos.

## 1. User.email

- `User.email` debe ser opcional pero unico.
- Puede haber usuarios importados, holders creados por emision o identidades aun sin login inicial.
- Si un usuario tiene email, ese email no debe duplicarse.

### Regla preliminar

```prisma
email String? @unique
```

### Implicancias

- impacta un futuro ajuste de `schema.prisma`;
- afecta decisiones de auth/login y recuperacion de acceso;
- el backend debera impedir duplicidad de email cuando se asigne o actualice.

## 2. User.did

- `User.did` se mantiene opcional y unico.
- Una credencial emitida no deberia existir sin identidad verificable del titular, mediante `subject_did` o una estrategia equivalente.
- No se vuelve obligatorio en `User` todavia porque puede haber usuarios creados antes de asignarles DID.

### Implicancias

- la obligatoriedad se resolvera por logica de emision, no por constraint general del usuario;
- los DTOs y servicios de emision deberan validar identidad verificable del titular antes de emitir.
- **A2.1**: la estrategia de provisioning quedo resuelta (`did:web`
  platform-managed, condicional a `PUBLIC_DID_BASE_URL`) -- ver seccion 27.

## 3. Issuer.did

- `Issuer.did` se mantiene opcional y unico por ahora.
- Debe quedar entendido como identificador institucional fuerte futuro.
- No se vuelve obligatorio hasta cerrar la estrategia final de identidad institucional.

### Implicancias

- puede impactar un ajuste futuro del schema;
- los servicios de autorizacion institucional deberan contemplar esta transicion.

## 4. Issuer.walletAddress

- `Issuer.walletAddress` se mantiene opcional y unico.
- Un `Issuer` no puede pasar a `authorized` sin `walletAddress`.
- Esta regla se valida en servicio, no necesariamente en Prisma.

### Implicancias

- impacta validadores y servicios de autorizacion;
- no requiere cambio inmediato del schema si se mantiene como regla de aplicacion.

## 5. Credential.canonicalHash

- `Credential.canonicalHash` se mantiene indexado, no `unique`, por ahora.
- No se impone unicidad todavia para no bloquear reemisiones, pruebas, ambientes locales o ajustes futuros de negocio.
- Una credencial `issued` debe tener `canonicalHash` y `canonicalizationVersion`.
- La emision issuer-scoped no acepta hash, version, red, signer ni actor desde
  el body: NestJS deriva el contexto y reutiliza el flujo de emision existente.
- `BlockchainRecord` representa evidencia tecnica de integridad del hash. No
  reemplaza la autoridad academica del issuer ni prueba por si solo cursada o
  aprobacion.
- `SemanticAnalysis` es apoyo formativo y no es requisito de emision ni parte
  de `canon_v1`.

### Implicancias

- la obligatoriedad por estado debe validarse en servicio;
- la discusion de unicidad queda abierta para una revision posterior del schema.

### Verificacion publica V1

- La referencia publica identifica una `Credential` por su id; `canonicalHash`
  no se usa como identificador porque no es unico.
- Solo `issued` y `revoked` se exponen mediante el read model publico. Un
  `draft` no confirma existencia, titulo, emisor, titular ni estado.
- El verificador muestra una allowlist minima y no consulta blockchain en vivo.
  El registro persistido es evidencia tecnica de integridad y no validacion
  academica; `SemanticAnalysis` no participa en la verificacion.

## 6. FormativeProfile.isCurrent

- `FormativeProfile.isCurrent` se mantiene.
- El backend debe garantizar un unico perfil actual por usuario mediante logica transaccional.
- Cuando un perfil pase a actual, deben desmarcarse los otros perfiles actuales del mismo `userId` en la misma transaccion.
- No se agrega una constraint compleja en esta etapa.

### Implicancias

- impacta directamente en servicios de regeneracion de perfil;
- puede motivar una optimizacion o constraint futura si el comportamiento queda estable.

## 7. SharingGrant

- Todo `SharingGrant` debe apuntar al menos a `credentialId` o `profileId`.

### V2: perfil público controlado

- Un share de perfil usa `SharingGrant.scope = profile`, `profileId` y un token
  opaco cuyo hash SHA-256 es el único valor persistido.
- El token no puede derivarse de identidad del holder ni reutilizar la
  referencia de una credencial o su hash canónico.
- La vista pública incluye solo un resumen limitado; las credenciales de
  respaldo se restringen a `issued` y enlazan al verificador V1.
- Un `GET` puede usar un fallback narrativo determinístico para perfiles legacy,
  pero no debe mutar `FormativeProfile`.
- `scope = credential` requiere `credentialId`.
- `scope = profile` requiere `profileId`.
- `scope = credential_and_profile` requiere `credentialId` y `profileId`.
- `tokenHash @unique` es correcto.
- No se expresa esta logica en Prisma todavia; debe validarse en servicio.

### Implicancias

- impacta futuros DTOs y validadores;
- evita grants huerfanos o ambiguos;
- prepara sharing por link/QR sin redisenar la tabla.

## 8. IssuerMembership

- Se mantiene:

```prisma
@@unique([userId, issuerId])
```

- `IssuerMembership` representa el estado actual de pertenencia institucional.
- El historial fino de cambios se conserva en `AuditLog`, no con multiples filas historicas de membresia en esta etapa.

### Implicancias

- no hace falta historizar membresias dentro del schema por ahora;
- las altas, bajas y cambios de rol deben auditarse correctamente.

## 9. BlockchainRecord

- Se permiten multiples registros por credencial.
- El registro blockchain vigente se resolvera por:
  - `credentialId`;
  - `network` o `chainId` objetivo;
  - `status`;
  - `registeredAt` mas reciente.
- No se agrega `isPrimary` todavia.
- Para la primera implementacion, el backend podra pedir una red objetivo o asumir una red activa por configuracion.

### Implicancias

- impacta la definicion de servicios de lectura blockchain;
- evita una restriccion prematura sobre un solo registro por credencial;
- deja abierta una futura regla explicita de seleccion de registro principal si hiciera falta.

## 10. Matriz minima de campos obligatorios por estado de Credential

### Estado `draft`

Requiere:

- `issuerId`
- `subjectUserId`
- `type`
- `title`
- `sourceType`
- `credentialSubject`

### Estado `issued`

Requiere:

- todo lo de `draft`;
- `issuedAt`;
- `canonicalHash`;
- `canonicalizationVersion`;
- issuer con `walletAddress`;
- identidad verificable del subject mediante DID o estrategia equivalente.

### Estado `revoked`

Requiere:

- todo lo de `issued`;
- `revokedAt`;
- `revocationReason`.

### Implicancias

- esta matriz debe guiar DTOs, validadores y servicios;
- puede motivar constraints adicionales en schema mas adelante si la logica queda estable;
- evita APIs ambiguas entre borrador, emision y revocacion.

## 11. Campos controlados de Credential por tipo

P2b1 define un contrato v0 de edicion de drafts para los tipos existentes:
`academic_subject`, `course`, `certification` y `degree`. No agrega tipos ni
modifica Prisma.

Reglas transversales:

- `title` y `credentialSubject.achievement_name` permanecen sincronizados;
- `credentialSubject.institution_name` siempre se deriva de `Issuer.name`;
- los campos especificos se aceptan solo cuando aplican al tipo final;
- cambiar el tipo elimina campos controlados incompatibles y conserva los
  compatibles;
- claves legacy desconocidas se preservan en DB, pero no pueden entrar por el
  PATCH ni salir por el read model issuer-facing;
- strings controlados usan maximo 255 caracteres;
- `external_url` usa HTTP/HTTPS y maximo 2048 caracteres;
- arrays controlados usan hasta 30 strings de hasta 500 caracteres (R2:
  antes 80 -- incompatible con `learningOutcomes` de `course`, relabeled
  en la UI como "Contenido e información adicional" e invitando
  explicitamente contenido/temario mas largo por linea que un tag corto);
- `completion_date` y `expiration_date` son fechas reales `YYYY-MM-DD`, y la
  expiracion no puede ser anterior a la finalizacion;
- toda actualizacion sigue siendo exclusiva de `draft` y participa del CAS
  atomico por `updatedAt`.

Aplicabilidad:

| Tipo | Campos especificos |
| --- | --- |
| `academic_subject` | `completion_date`, `academic_period`, `program_name`, `grade`, `skills`, `competencies` |
| `course` | `completion_date`, `platform_name`, `modality`, `external_url`, `competencies`, `learning_outcomes` |
| `certification` | `completion_date`, `certification_code`, `expiration_date`, `external_url`, `provider_name`, `level`, `skills`, `competencies` |
| `degree` | `completion_date`, `program_name`, `level`, `grade`, `competencies`, `learning_outcomes` |

Estas reglas no representan readiness ni requisitos suficientes de emision.
Los campos `program_name`, `provider_name`, `platform_name`, `modality`,
`level`, `certification_code`, `expiration_date`, `external_url` y
`learning_outcomes` no participan actualmente en `canon_v1`. Antes de P7 debe
decidirse si permanecen como metadata no canonica o requieren una nueva
version de canonicalizacion.

### Regla demo de tipos por emisor

En el MVP, solo el issuer con DID `did:example:issuer-demo` puede crear o
dejar como tipo final de un draft `academic_subject` y `degree`. Cualquier
otro issuer autorizado puede crear o actualizar drafts solamente como `course`
o `certification`. Esta es una regla temporal de demo;
una futura capacidad de dominio debe reemplazarla por `issuer.kind` o
`issuer.capabilities`.

Para `course`, `provider_name`, `level` y `skills` no forman parte del
contrato editable. Las `skills` legacy ya persistidas se conservan en la
credencial, pero el rebuild de `FormativeProfile` las ignora para `course`.
`competencies` y `learning_outcomes` son datos declarados por el emisor; las
habilidades visibles deben provenir de un
`SemanticAnalysis` cuando exista. La modalidad solo admite `Presencial`,
`Online` o `Asincrónica`.

### Gap C2b: analisis textual de cursos

`TextEvidence` y `AnalysisRunInputMode.text` existen para trazabilidad desde
antes de C2b. C2b.1 agrego `POST /v1/semantic-analysis/text` en el AI Service
(reusa el pipeline de deteccion existente sobre texto declarado, sin PDF,
con reglas conservadoras para texto corto/no estructurado). C2b.2 conecto el
backend a ese endpoint:

- `AnalysisRunExecutionService.executePendingTextRun` ejecuta de verdad
  `inputMode=text` (leer `TextEvidence.content` vigente, llamar
  `AiServiceClient.analyzeText`, validar/persistir `SemanticAnalysis` con
  `sourceType: "text"`, completar/marcar failed) — ya no rechaza este modo
  genericamente.
- `POST /issuers/:issuerId/credentials/:credentialId/analysis-runs/text` es
  el trigger manual, draft-only, con deduplicacion por `TextEvidence.id`
  vigente exacto.
- `SemanticAnalysisArtifactSourceType` (backend) acepta `"text"` ademas de
  `"academic_pdf"`/`"online_course_catalog"`.

C2b.3 cierra este gap: al emitir un `course` sin PDF vigente,
`AutomaticCourseTextAnalysisService.analyzeIssuedCourseIfEligible` genera o
reutiliza una `TextEvidence` (nunca reemplaza una `current` existente,
manual o previa) y dispara el analisis textual `system` best-effort, igual
patron que el flujo documental automatico ya existente. Reglas clave:

- PDF siempre tiene prioridad: si hay `DocumentEvidence` `current` PDF, este
  servicio se salta sin generar ni analizar texto.
- El texto se construye SOLO desde `achievementName`/`title`, `description`,
  `competencies`, `learningOutcomes` (`buildCourseTextAnalysisContent`,
  `services/api/src/credentials/course-text-analysis-content.ts`) — nunca
  `platformName`, `providerName`, `modality`, `externalUrl`, issuer, holder
  ni blockchain. Regla de suficiencia conservadora: rechaza un titulo
  generico solo, exige descripcion con senal propia o al menos dos fuentes
  formativas distintas.
- Si ya existe una `TextEvidence` `current` (de cualquier origen), se usa
  tal cual, nunca se reemplaza -- el schema no distingue manual vs.
  sistema, asi que la regla conservadora es no pisar nunca contenido
  existente.
- Dedup por `TextEvidence.id` exacta incluye `failed` (mas estricta que el
  endpoint manual de C2b.2): el auto-trigger nunca reintenta indefinidamente.
- Best-effort real: cualquier error se atrapa y se loguea de forma segura
  dentro del propio servicio, ademas del `try/catch` ya existente en
  `IssuerCredentialIssueService` — nunca revierte la emision.
- C2c (presentacion de horas/cobertura), C3 (catalogo reutilizable) y C4
  (interpretacion aprobada) siguen pendientes y fuera de alcance de C2b.3.

### C2b.4: reconstruccion automatica del perfil holder tras analisis IA exitoso

Antes de C2b.4, ni el flujo documental automatico ni el textual automatico
(C2b.3) reconstruian `FormativeProfile` -- dependia de
`POST /me/profile/rebuild` manual. C2b.4 cierra ese gap para los dos
caminos **automaticos** (`trigger=system`). **P1.1 (seccion 28) agrega
ademas un rebuild baseline inmediatamente tras la emision, independiente
de que este camino IA-exitoso llegue a ocurrir** -- el gap de que la
existencia del perfil dependiera del exito/elegibilidad de IA queda
cerrado; este rebuild "enriquecido" descripto aca sigue funcionando igual,
como una segunda generacion que reemplaza el baseline cuando corresponde.

- `AutomaticProfileRebuildService` (nuevo, `services/api/src/analysis-run/`)
  llama `FormativeProfileService.rebuildForUser(holderUserId)` -- sin
  modificar `FormativeProfileService` ni su logica semantica (eso es C2c).
- Se invoca desde `AutomaticDocumentAnalysisService` y
  `AutomaticCourseTextAnalysisService`, unicamente DESPUES de que la
  ejecucion automatica termino `completed` y persistio un
  `SemanticAnalysis` -- nunca antes, nunca si hubo skip/dedup/fallo de
  ejecucion.
- `holderUserId` = `Credential.subjectUserId`, leido de la misma
  credencial que se esta analizando.
- **No aplica a `trigger=manual`** (ni el endpoint documental P5c ni el
  textual de C2b.2): el flujo manual puede requerir revision antes de
  impactar el perfil holder; queda pendiente para una decision futura,
  no es un descuido.
- Best-effort observable: un fallo de `rebuildForUser` se atrapa y se
  registra con `automatic_profile_rebuild_failed` y el codigo estable
  `formative_profile_rebuild_failed`, sin copiar mensajes de excepcion,
  `analysisJson`, contenido textual, storage path ni secretos. Nunca marca
  `failed` un `AnalysisRun` que ya quedo `completed`, ni revierte la emision.
- No llama IA de nuevo (`rebuildForUser` solo lee/escribe Postgres). No
  toca canon, hash ni blockchain.
- Como maximo un rebuild por emision: documental y textual automaticos
  son mutuamente excluyentes por diseno (ver C2b.3); si ambos llegaran a
  completar en la misma emision (no deberia ocurrir dado el chequeo de
  PDF), un segundo rebuild no rompe nada -- `rebuildForUser` es
  idempotente (reconstruye el snapshot completo desde cero cada vez), solo
  seria trabajo redundante.

### C2c: horas oficiales y cobertura semantica en el perfil holder

C2c no rediseña `FormativeProfileService` ni cambia como se calculan
areas/skills/concepts -- agrega campos derivados, adicionales, a
`profileJson.summary` para que el holder pueda distinguir horas oficiales
de estimaciones de IA, y para que sepa cuando el perfil todavia no tiene
evidencia suficiente:

- `summary.totalOfficialHours`: igual a `summary.totalHours` (la suma de
  `Credential.hours` de credenciales `issued`). Es el mismo dato con un
  nombre que nunca se confunde con una distribucion por area o con una
  estimacion de IA.
- `summary.credentialsWithoutHours`: cantidad de credenciales `issued`
  con `hours === null`. No se infiere ni se completa ese valor -- solo se
  cuenta.
- `summary.credentialsWithoutSemanticCoverage`: cantidad de credenciales
  `issued` sin un `SemanticAnalysis` utilizable (mismo criterio que ya
  generaba el warning `credential_without_semantic_analysis`).
- Los dos contadores son independientes entre si: una credencial puede
  faltar en uno, en el otro, en ambos o en ninguno.
- `areasSummary`/`hoursDistribution` siguen siendo la unica fuente de
  horas estimadas por area, y solo existen cuando un `SemanticAnalysis`
  trae `hoursDistribution`. El nombre de la credencial (`title`,
  `achievementName`) nunca participa del calculo -- el `select` de Prisma
  en `rebuildForUser` no lo incluye.
- Compatibilidad con perfiles generados antes de C2c: `profileJson.summary`
  puede no tener estos campos. El mapper (`holder-current-profile.mapper.ts`)
  y el adaptador del frontend (`holder.adapter.ts`) hacen fallback en
  capas independientes: `totalOfficialHours` cae a `totalHours`; los
  contadores ausentes se exponen como `null` (no como `0` -- "no sabemos"
  es distinto de "cero credenciales sin cobertura").
- El wallet (`/wallet`) usa "Horas oficiales declaradas" para el total y
  "Horas estimadas por IA" para las areas, y muestra avisos suaves cuando
  los contadores son mayores a cero. Nunca muestra "0h" para un area sin
  estimacion.
- Pendiente, fuera de alcance de C2c: catalogo reutilizable de areas/horas
  (C3), interpretacion aprobada (C4) y distribucion de horas estimadas por
  credencial individual en el detalle holder (requeriria exponer
  `hoursDistribution` por credencial en el read model, no solo agregado
  por perfil).

## 12. Catalogo y curricula institucional para academic_subject

P3.1a vincula opcionalmente un draft `academic_subject` con un
`AcademicCourse` activo del mismo issuer. P3.1b agrega `Program.code`, una
`CurriculumVersion` activa por codigo demo, relaciones `ProgramCourse` y la
referencia curricular exacta opcional en `Credential.programCourseId`.
P3.1d-a permite que `POST /credentials/draft` cree directamente el snapshot
curricular a partir del par publico `academicCourseReference` y
`curriculumReference`, sin requerir un nombre provisional manual.

- el catalogo aporta codigo y nombre oficial; descripcion y horas son
  nullables;
- seleccionar una asignatura no demuestra cursada, finalizacion ni aprobacion
  del titular;
- `completion_date`, `academic_period` y `grade` describen el logro concreto
  del holder y no se derivan del catalogo;
- `skills` y `competencies` existentes se preservan, pero el catalogo demo no
  las inventa ni las completa;
- `learning_outcomes` sigue fuera de la matriz de `academic_subject`;
- la busqueda y seleccion estan siempre scoped por issuer autorizado;
- una seleccion curricular valida que la materia pertenezca al programa y
  version indicados, y deriva `program_name` desde `Program.name`;
- en create-draft curricular, el cliente no envia IDs internos ni reemplaza
  `title`, `description`, `hours`, `achievement_name`, `institution_name` o
  `program_name`; el backend deriva esos valores dentro de la misma transaccion
  que crea la credencial;
- el body curricular usa una allowlist exacta y no acepta `credentialSubject`,
  `metadata`, `rawData`, `externalCourseId` ni datos de aprobacion o
  enriquecimiento. El `credentialSubject` inicial se construye exclusivamente
  con `achievement_name`, `institution_name` y `program_name` derivados;
- `completion_date`, `academic_period`, `grade`, `skills` y `competencies` se
  agregan despues mediante el PATCH issuer-facing del draft;
- el camino manual de create-draft se mantiene por compatibilidad, aunque la
  seleccion curricular es el flujo recomendado para `academic_subject`;
- los codigos de carrera distintos se preservan aunque sus nombres coincidan;
- el draft conserva `academicCourseId` como referencia y copia un snapshot de
  nombre, descripcion y horas para no depender de mutaciones posteriores del
  catalogo;
- `academicCourseId`, `programCourseId` y las referencias de programa o
  curricula no participan en `canon_v1`; los campos copiados a
  `title`, `description`, `hours` y `achievement_name` si pueden afectar el
  hash futuro al emitir;
- `program_name` tampoco participa actualmente en `canon_v1`;
- la credencial emitida se verifica contra su snapshot y no contra futuros
  cambios del catalogo o la curricula.

Estas relaciones no constituyen readiness ni evidencia de aprobacion. Tampoco
disparan emision, hashing, blockchain, PDF o IA.

## 13. Evidencia documental de un draft

Una `Credential` puede conservar varias filas `DocumentEvidence`, pero en P4a
tiene como maximo una evidencia `current`; las anteriores se mantienen como
`replaced` con `replacedAt` y sin borrado fisico automatico.

- solo un usuario institucional `admin` u `operator` activo de un issuer
  autorizado puede adjuntar evidencia;
- la credencial debe pertenecer al issuer solicitado y estar en `draft`;
- PDF, PNG y JPEG son los unicos formatos admitidos y se detectan por firma;
- el nombre, extension y MIME declarados no son fuente suficiente de verdad;
- los bytes se guardan fuera de PostgreSQL mediante `DocumentStoragePort`;
- el adapter local genera una clave UUID y no usa el nombre original como path;
- cada fila conserva SHA-256 lowercase de los bytes exactos, separado del hash
  canonico de la credencial;
- reemplazar evidencia no cambia `Credential.status`, `updatedAt`, contenido,
  hash, analisis ni blockchain;
- el indice unico parcial PostgreSQL y la transaccion `Serializable` sostienen
  la invariante de una sola evidencia vigente por credencial;
- P4a no expone descarga, preview ni historial por API.

La evidencia es documentacion institucional asociada. No demuestra por si sola
aprobacion, finalizacion, readiness ni validez publica de una credencial.

## 14. Evidencia textual de un draft

Una `Credential` puede conservar varias filas `TextEvidence`, con una sola
`current`. La fuente textual convive con `DocumentEvidence` y no la reemplaza.

- solo un `admin` u `operator` activo de un issuer autorizado puede registrar
  texto para una credencial `draft` del mismo issuer;
- `content` se normaliza a NFC, LF y trim, conserva saltos internos y admite
  hasta 50.000 caracteres; controles C0 no permitidos se rechazan;
- `label` es descriptivo de la fuente, nullable y no es el titulo de la
  credencial;
- SHA-256 se calcula sobre los bytes UTF-8 exactos del contenido persistido;
- `characterCount` cuenta code points mediante `Array.from(content).length`;
- reemplazar siempre crea una fila nueva, aun con el mismo hash, y conserva la
  anterior como `replaced` con `replacedAt`;
- la unicidad vigente se refuerza con indice unico parcial y transaccion
  `Serializable`;
- registrar texto no modifica `Credential`, `updatedAt`, `credentialSubject`,
  metadata, raw data, `canonicalHash`, `DocumentEvidence`, `SemanticAnalysis`
  ni `BlockchainRecord`;
- la fuente no genera automaticamente description, skills, competencies o
  learning outcomes. La IA futura podra proponer cambios que el emisor debera
  confirmar;
- no participa en `canon_v1`, readiness, emision, blockchain ni verificacion
  publica;
- el read issuer-facing expone solo `textEvidence.currentText`; el historial y
  submitter permanecen internos.

## 15. Que no decidir todavia

Por ahora no se decide:

- normalizar `areas` o `concepts` provenientes de IA fuera de sus artifacts;
- agregar jobs de IA;
- separar `SharingGrant` en multiples tablas;
- agregar soft delete global;
- resolver auth completa;
- correr migraciones;
- modificar schema antes de documentar estas reglas.

## Impacto sobre cambios futuros en schema.prisma

Estos temas probablemente impacten una futura iteracion del schema:

- `User.email` como `@unique`;
- posible aclaracion futura sobre obligatoriedad por estado en `Credential`;
- decision posterior sobre unicidad o no de `Credential.canonicalHash`;
- posibles indices o constraints adicionales para `FormativeProfile.isCurrent`;
- posible constraint mas fuerte o estrategia adicional sobre `SharingGrant`.

## Impacto sobre DTOs, validadores y servicios

Estas reglas impactaran directamente:

- emision de credenciales;
- revocacion;
- autorizacion de emisores;
- asignacion de email y DID;
- sharing por link/QR;
- seleccion del registro blockchain vigente;
- regeneracion de perfil actual;
- validacion de cambios de estado.

## Decisiones que quedan abiertas

- si `Credential.canonicalHash` debe pasar a `@unique` mas adelante;
- cuando `User.did` y `Issuer.did` pasaran de opcionales a requeridos en ciertos flujos;
- si en el futuro conviene constraint de unicidad operativa para `FormativeProfile.isCurrent`;
- si se necesitara modelar historial de membresias institucionales en tabla propia;
- si `SharingGrant` debera endurecerse con mas reglas estructurales en base de datos.

## 16. Fronteras de deployment e IA aprobadas en P4d

- el navegador consume NestJS y nunca llama FastAPI, S3 o blockchain;
- NestJS autentica, autoriza, resuelve fuentes y valida artifacts;
- FastAPI procesa temporalmente y no persiste dominio;
- `DocumentEvidence` se guarda mediante `DocumentStoragePort`; S3 es un adapter,
  no una nueva fuente de autoridad;
- P5 inicial entrega documentos a FastAPI como bytes leidos por NestJS;
- `semantic_analysis_v1` es resultado oficial validado, no claim humano;
- propuestas IA se persisten separadas y requieren revision del emisor;
- `DocumentEvidence` y `TextEvidence` no entran automaticamente en `canon_v1`;
- P5a crea `AnalysisRun` `pending` para triggers manuales sobre drafts y captura
  evidencias current por referencia/hash; P6b permite exclusivamente un trigger
  interno `system` sobre la credencial recien emitida;
- document exige documento, text exige texto y combined exige ambos;
- cada source referencia documento XOR texto y no guarda contenido, bytes,
  storage key, paths ni payloads IA;
- P5b ejecuta solo runs `document`, siempre contra la referencia exacta
  capturada; no reselecciona evidencia `current`;
- el claim y completion son transacciones cortas, mientras storage y FastAPI se
  ejecutan fuera de una transaccion de base de datos;
- un artifact `partial` persistido implica run `completed`; los fallos
  operativos se guardan sanitizados y no alteran `Credential`, `canon_v1`,
  emision ni blockchain;
- P5c permite el trigger documental solo a membership activa admin/operator de
  un issuer autorizado y exige una credencial draft scoped al mismo issuer;
- params, usuario autenticado y defaults backend-controlled son las unicas
  fuentes de identidad, modo, trigger y versiones; el body no es autoritativo;
- P5d permite leer runs historicos de credenciales `draft`, `issued` o
  `revoked`; `draft` es requisito de trigger, no de lectura;
- despues de emitir, un PDF `current` puede disparar un AnalysisRun documental
  `system` fuera de la transaccion de emision; la ausencia de PDF o cualquier
  fallo IA/storage no bloquea ni revierte la credencial emitida;
- `TextEvidence` vigente tambien constituye respaldo institucional para emitir,
  pero no dispara analisis documental; analisis textual y `combined` permanecen
  futuros. Una emision sin `DocumentEvidence` ni `TextEvidence` requiere una
  confirmacion explicita del emisor en el Portal, sin tratar skills o
  competencias como sustitutos de una fuente;
- el autoanalisis evita otro run activo/completado para la misma evidencia y no
  modifica `canon_v1`, hash canonico, blockchain ni la fuente documental;
- P6d clasifica fallos IA de forma segura: errores HTTP, timeout,
  configuracion, red y respuesta invalida se distinguen mediante `errorCode`
  allowlisted. El detalle crudo solo se usa para logging interno sanitizado y
  truncado; no llega al read model, frontend ni a la persistencia expuesta;
- la ejecucion documental envia el `AnalysisRun.id` en `X-Analysis-Run-Id`
  como correlacion interna. FastAPI no necesita cambiar su contrato para este
  header; su consumo en logs es una mejora futura opcional;
- latest sin runs devuelve null y un run ausente/cross-credential devuelve 404
  uniforme; el read model no llama IA/storage ni expone artifact o JSON crudo;
- `text`, `combined`, propuestas, endpoint generico y worker siguen futuros.

`canon_v2` no se decide en P4d. Debe esperar a que revision humana y readiness
definan que claims oficiales forman parte de la emision.

## Holder wallet v1

- El titular consulta únicamente sus credenciales `issued` o `revoked`; un
  borrador institucional no forma parte de la Wallet.
- La Wallet es de solo lectura: no emite, edita, reemplaza evidencia ni
  reintenta análisis.
- El perfil formativo organiza información disponible de credenciales y
  análisis; no certifica capacidades, niveles ni completitud individual.
- La UI no atribuye un área, habilidad o concepto del perfil a una credencial
  concreta sin una relación de procedencia segura entregada por el backend.
- La evidencia de integridad es técnica. En `anvil` o `mock` se presenta como
  entorno técnico/demo, nunca como red pública productiva.

## 17. C3a — Catalogo reusable de cursos por issuer (`IssuerCourseTemplate`)

Cada issuer puede tener su propio catalogo reusable de cursos, separado del
draft/credencial concreto que los origina. Objetivo: si "Plataforma de
Cursos Demo" carga un curso de Python a mano, despues puede guardarlo como
reutilizable y seleccionarlo la proxima vez (el selector/autocomplete es
C3b/C3c; C3a es solo el modelo y la API).

- `IssuerCourseTemplate` es **issuer-scoped**: `issuerId` es obligatorio y
  todas las operaciones (list/create/patch/create-from-credential) validan
  membership `admin`/`operator` activa sobre un issuer `authorized`, mismo
  patron que el resto de endpoints issuer-facing.
- **Por que no `ExternalCourse`**: `ExternalCourse` no tiene `issuerId` (no
  es scoped a un emisor) ni los campos que necesita un curso institucional
  propio (`modality`, `platformName`, `externalUrl`, `competencies`,
  `learningOutcomes` controlados como en `course`). Fue modelado para un
  futuro import de catalogos externos, no para este caso de uso, y el
  bundle de auditoria C2b-C3 ya habia señalado que no correspondia
  reutilizarlo. C3a no migra datos desde `ExternalCourse` ni lo borra;
  queda intacto y sin uso para este flujo.
- **Campos que replican el dominio `course` ya limpio (C2)**: `modality`
  (`Presencial`/`Online`/`Asincrónica`), `platformName`, `externalUrl`,
  `competencies`, `learningOutcomes`. **Nunca** `providerName`, `level` ni
  `skills` -- esos campos no aplican a `course` desde C2 y `C3a` los
  rechaza explicitamente en create/patch/create-from-credential.
- **Resolucion de titulo al crear desde credencial**: prioridad
  `credentialSubject.achievement_name`, despues `Credential.title`; si
  ninguno alcanza, se rechaza con un error controlado (nunca se inventa un
  titulo ni se usa un string vacio).
- **Deduplicacion**: al crear desde credencial, si ya existe un template
  `active` del mismo issuer con el mismo `createdFromCredentialId` y un
  titulo igual tras normalizar (trim, espacios colapsados,
  case-insensitive), se rechaza con `409` en vez de duplicar. La
  normalizacion de titulo es solo para comparar en el momento de la
  request -- no se persiste un campo `normalizedTitle` (no hizo falta para
  C3a).
- **`hours`**: `Decimal(10,2)` igual que `Credential.hours`; en el body de
  create/patch se acepta como `number` JSON (no decimal string) para
  simplificar el contrato de este endpoint nuevo; en la response se expone
  como decimal string, nunca como objeto `Decimal` crudo.
- **No participa en canon ni blockchain**: `IssuerCourseTemplate` no es una
  credencial emitida, no entra a `canon_v1`, no se registra on-chain y no
  modifica `Credential` ni `SemanticAnalysis` existentes al crearse o
  editarse.
- **`lastSemanticAnalysisId`**: referencia informativa opcional al ultimo
  `SemanticAnalysis` de la credencial de origen (sin FK, ver Prisma) --
  nunca dispara ni recalcula un analisis nuevo.
- Pendiente, explicitamente fuera de alcance de C3a: boton/selector en el
  frontend (C3b), crear un draft de credencial a partir de un template
  (C3c), aprobar la interpretacion de IA sobre un template (resuelto en
  C4a.1, ver seccion propia mas abajo), usar templates para
  `FormativeProfileService`/rebuild del perfil (no aplica -- el perfil
  sigue derivando solo de credenciales emitidas reales, ver seccion C2c
  mas arriba), y cualquier integracion real con Udemy, Coursera o AWS (no
  existe, no se afirma, no se simula).

### C3a.2 — `IssuerCourseTemplate` extendido a `certification`

C3a limitaba el catalogo reusable a `course`. C3a.2 corrige eso: el
catalogo tambien acepta `certification`, porque ambos son ofertas
reutilizables de un emisor (una plataforma de cursos, una universidad o
cualquier institucion privada puede reofrecer un curso o una
certificacion), independientemente de si el issuer es UADE o "Plataforma
de Cursos Demo" -- la restriccion depende del **tipo de credencial**, no
del tipo de issuer.

- **Por que `academic_subject` y `degree` siguen excluidos**:
  `academic_subject` pertenece al catalogo academico formal de una
  universidad -- plan de estudio, carrera y materia oficial
  (`AcademicCourse`/`Program`/`CurriculumVersion`). `degree` tambien
  pertenece a una estructura academica formal. Ninguno de los dos
  corresponde a un template reutilizable libre desde una credencial
  individual. `course` y `certification` si, porque son ofertas que un
  emisor puede repetir tal cual para distintos titulares.
- **Decision de modelado (Opcion A extendida)**: se agrego
  `credentialType: CredentialType` (`@default(course)`, solo
  `course`/`certification` validos aca) y los campos
  `certificationCode`, `expirationDate`, `providerName`, `level`,
  `skills: String[]` al mismo modelo `IssuerCourseTemplate`, en vez de
  crear `IssuerCertificationTemplate` (Opcion B) o un
  `IssuerCredentialTemplate` nuevo (Opcion C). Motivo: `course` y
  `certification` comparten la mayoria de los campos (`title`,
  `description`, `hours`, `externalUrl`, `competencies`) y el mismo
  catalogo/busqueda/dedup; duplicar el modelo habria significado
  duplicar tambien el service, el validator, el mapper y el controller
  casi entero. Se documenta como **deuda de naming**: el modelo sigue
  llamandose `IssuerCourseTemplate` aunque ya no es solo de cursos; no se
  renombra fisicamente para no agrandar la migracion.
- **`credentialType` es inmutable** despues de creado -- no se acepta en
  `PATCH`. Define que subconjunto de campos aplica (ver mas abajo), y
  cambiarlo despues de creado abriria la puerta a un template con datos
  de un tipo y `credentialType` de otro.
- **Campos exclusivos de `course`** (igual que antes de C3a.2):
  `modality`, `platformName`, `learningOutcomes`.
- **Campos exclusivos de `certification`** (nuevos en C3a.2):
  `certificationCode`, `expirationDate`, `providerName`, `level`,
  `skills` -- los mismos que `credentialSubject` ya permite para
  `certification` en el draft (`issuer-credential-draft-subject.ts`).
  `skills` SI aplica a `certification` (a diferencia de `course`, que
  nunca lo permitio desde C2).
- **Campos comunes a ambos**: `title`, `description`, `hours`,
  `externalUrl`, `competencies`. `learningOutcomes` se lee de forma
  defensiva al copiar desde una credencial `certification` (por si
  existiera como dato legacy), pero no es un campo controlado de
  `certification` en el contrato actual -- no se puede setear
  manualmente en un template `certification` via API.
- **Nunca se cruzan campos entre tipos**: un template `course` nunca
  copia ni acepta `certificationCode`/`providerName`/`level`/`skills`; un
  template `certification` nunca copia ni acepta
  `modality`/`platformName`. Verificado con tests dedicados en ambas
  direcciones (create manual, patch y create-from-credential).
- **Deduplicacion separada por tipo**: la regla de C3a
  (`issuerId` + `createdFromCredentialId` + titulo normalizado, solo
  contra templates `active`) ya separa por tipo de forma natural, porque
  cada `Credential` tiene un unico `type` fijo -- un `course` y un
  `certification` con el mismo titulo nunca comparten
  `createdFromCredentialId` y por lo tanto nunca colisionan entre si.
- **No se creo un endpoint nuevo**: se mantiene
  `POST /issuers/:issuerId/course-templates/from-credential/:credentialId`
  (y el resto de la familia `course-templates`) pese al nombre historico
  -- ahora acepta `course` y `certification`. No se creo
  `reusable-credential-templates` ni un nombre mas generico para no
  agrandar el cambio; queda documentado aca como la fuente de verdad de
  que, pese al nombre, el endpoint ya no es exclusivo de `course`.

### C3b — Guardar como reutilizable desde el detalle issuer-facing

`/issuer/credentials/[credentialId]` agrega una accion "Guardar como
curso/certificación reutilizable" (`SaveReusableTemplateSection`) que
llama al endpoint de C3a/C3a.2 descripto arriba
(`POST .../course-templates/from-credential/:credentialId`). Reglas de
UX:

- Visible **unicamente** cuando `credential.type` es `course` o
  `certification` Y `credential.status === 'issued'` (nunca `draft`,
  nunca `revoked`), dentro del mismo `IssuerRouteBoundary` que ya
  protege el resto del portal emisor. Nunca visible para
  `academic_subject`, `degree`, en la wallet holder, en paginas de
  verifier/publico ni en pantallas de creacion de credencial.
- **`draft` explicitamente excluido**: el backend exige
  `credential.status === issued` (400 si no) -- la accion solo puede
  ejecutarse con exito despues de emitir, asi que la UI nunca la ofrece
  antes.
- **Nunca depende de `SemanticAnalysis`/`approvedSemanticSnapshot`**: la
  condicion de visibilidad usa exclusivamente `type`/`status`, ya
  disponibles en el detalle -- nunca dispara un request adicional solo
  para decidir si mostrar el boton. Esto es deliberadamente distinto de
  `SemanticApprovalSection` (revisar/aprobar interpretacion semantica,
  seccion "C4a.1/C4a.2" abajo), que si exige una `SemanticAnalysis`
  usable. Ambas acciones coexisten en la misma vista: "guardar como
  reutilizable" es la accion primaria, simple, siempre disponible tras
  emitir; "revisar/aprobar interpretacion" es el enriquecimiento
  opcional posterior, nunca una condicion para la primera.
- La accion **no modifica la credencial visible** ni **crea una
  credencial nueva** -- solo agrega un registro aparte en el catalogo
  reutilizable del issuer. El copy lo aclara explicitamente en la UI
  ("Reutilizá estos datos en futuras credenciales.").
- Duplicados: un segundo intento sobre la misma Credential devuelve
  `409` (`IssuerCourseTemplatesService.createTemplateFromCredentialForIssuer`,
  deteccion por `createdFromCredentialId` + titulo normalizado) --
  `SaveReusableTemplateSection` lo muestra como aviso distinto de un
  error generico ("Este curso/Esta certificación ya fue guardado/a como
  reutilizable"), nunca lo esconde ni lo confunde con un fallo.
- No hay pantalla de gestion del catalogo ni selector en la creacion de
  credenciales en C3b -- eso queda para un slice futuro (analogo a C3c).

**R1.1 (correccion post-auditoria)**: entre C3b y este slice, el
componente `SaveReusableTemplateSection` fue construido y probado
(incluido su API client, `saveCourseTemplateFromCredential`) pero **nunca
llego a montarse** en `credential-detail-route.tsx` -- el trabajo
posterior de C4/C5 (revision semantica) introdujo en su lugar un
checkbox de intencion puramente local (`ReusableTemplateIntentSection`,
visible solo en `draft`, sin ningun efecto de persistencia) sin terminar
de reemplazarlo por la accion real. La auditoria
`final-r1-save-as-reusable-audit-review-bundle.txt` documenta el gap
completo. R1.1 elimina el checkbox (componente y copy) y conecta el
boton real -- esta seccion ya describe el comportamiento final,
correcto.

### C3c — Usar templates reutilizables al crear course/certification

C3c cierra el ciclo: guardar como reutilizable (C3b) -> buscar template
-> seleccionarlo -> precargar el formulario de creacion
(`/issuer/credentials/new`). Decision de alcance explicita del
enunciado: este slice cierra la reutilizacion **solo a nivel de datos
declarados** -- no toca aprobacion semantica reusable, no copia
`SemanticAnalysis`, no usa `lastSemanticAnalysisId` para precargar
analisis. Motivo: C4 requiere una revision explicita de que
interpretacion semantica se aprueba; en C3c el template solo precarga
campos editables del formulario, nada relacionado a IA.

- **Solo course y certification muestran el selector.** `academic_subject`
  y `degree` mantienen su flujo academico existente sin cambios -- nunca
  vieron ni veran este selector, porque no usan el catalogo reutilizable
  (ver seccion C3a.2).
- **El formulario de creacion es minimo por diseño** (captura solo
  `achievementName` para tipos manuales; el resto de los campos se
  completan despues en el editor de borrador de la pantalla de detalle,
  patron ya existente desde C2). C3c respeta ese diseño en vez de
  agrandar el formulario de creacion: seleccionar un template precarga
  `achievementName` ahi mismo (visible, editable) y el resto de los
  campos aplicables se aplican con un `PATCH` best-effort inmediatamente
  despues de crear el draft, reusando el mismo endpoint que ya usa el
  editor de borrador -- el usuario los revisa/edita en la pantalla de
  detalle, no en la de creacion.
- **Nunca cruza campos entre tipos**, mismo criterio que C3a/C3a.2: un
  template `course` nunca precarga `skills`/`providerName`/`level`; uno
  `certification` nunca precarga `modality`/`platformName`. Tampoco se
  precargan referencias academicas (`academicCourseReference`/
  `curriculumReference`) ni datos de blockchain/canonical/hash.
- **`learningOutcomes` para `certification` es defensivo, no
  garantizado**: el template lo guarda si existiera como dato legacy
  (ver C3a.2), pero el contrato de `PATCH .../credentials/:credentialId/draft`
  no admite `learningOutcomes` para `certification`
  (`assertRequestedFieldsApplyToType` lo rechazaria con 400). C3c nunca
  lo envia en ese caso -- se descarta en silencio en vez de romper la
  aplicacion del resto de los campos.
- **Nunca se envia `templateId` al backend**: `Credential` no tiene ese
  campo y C3c no lo agrega ni migra nada. La relacion "esta credencial
  vino de este template" simplemente no se persiste en ningun lado --
  es una conveniencia de una sola vez al momento de crear.
- **El PATCH que aplica el template es best-effort**: si falla, el draft
  ya fue creado exitosamente y la redireccion ocurre igual. Nunca
  bloquea ni revierte la creacion del draft por un fallo en esta
  operacion secundaria.
- **Nunca copia interpretacion de IA**: seleccionar un template no copia
  `SemanticAnalysis`, no copia `lastSemanticAnalysisId` a la credencial
  nueva como si fuera su propio analisis, no llama a IA, no reconstruye
  el perfil formativo. La credencial nueva sigue su ciclo normal completo
  (crear draft -> emitir -> analisis automatico propio si corresponde ->
  `SemanticAnalysis` propio -> rebuild de perfil automatico si aplica),
  totalmente independiente del template usado para precargarla.
- **Filtro `credentialType` en list** (`course`/`certification`/`all`,
  default `all` sin cambios de comportamiento respecto a C3a.2): se
  agrego para que el selector pueda pedir solo el tipo que necesita, sin
  arriesgarse a que el limite fijo de 20 resultados del catalogo
  mezclado oculte templates del tipo buscado.
- **No hay pantalla de gestion del catalogo** en C3c (list/archivar
  templates existentes desde una UI dedicada) -- explicitamente fuera de
  alcance, igual que en C3b.

## 18. C4a.1 — Aprobacion explicita de una interpretacion semantica como snapshot reutilizable

C4a.1 permite que un issuer apruebe explicitamente una `SemanticAnalysis`
ya generada (para una credencial `course`/`certification` propia) y la
persista como snapshot reutilizable dentro del `IssuerCourseTemplate`
correspondiente. Es exclusivamente backend (sin UI, eso es C4a.2) y no
aplica la interpretacion a ninguna credencial futura ni al perfil
formativo (eso es C4b).

- **Que significa aprobar**: es una decision del **emisor**, tomada sobre
  una interpretacion que la IA ya genero para una credencial concreta, de
  que esa interpretacion es reutilizable a futuro desde el template. **No
  significa que la IA certifico el contenido** -- sigue siendo una
  inferencia de IA, solo que ahora tiene el respaldo explicito de una
  revision humana del emisor.
- **Aplica solo a `course`/`certification`**: igual que el resto del
  catalogo (`IssuerCourseTemplate.credentialType`), nunca a
  `academic_subject` ni `degree`. La regla que lo garantiza no es un chequeo
  adicional: como `template.credentialType` nunca puede ser esos dos
  valores, comparar `semanticAnalysis.credential.type` contra
  `template.credentialType` los rechaza por construccion.
- **No modifica la credencial original**: `Credential` no se toca. No crea
  una `SemanticAnalysis` nueva. No llama a la IA (no hay ningun cliente de
  IA en el flujo de aprobacion). No escribe en blockchain. No entra al
  hash canonico (`canon_v1`). No reconstruye `FormativeProfile` ni ningun
  perfil de holder en este slice.
- **No reemplaza el analisis independiente de una credencial futura**:
  aprobar una interpretacion para el template no significa que una
  credencial nueva creada desde ese template "hereda" el analisis. Cada
  credencial nueva sigue generando su propio `SemanticAnalysis`
  independiente cuando corresponda (esa relacion -- aplicar el snapshot
  aprobado a una credencial nueva -- es exactamente lo que C4b resuelve;
  C4a.1 solo persiste la aprobacion en el template).
- **Persistencia aditiva, sin tabla nueva**: se agregaron 7 campos
  nullable a `IssuerCourseTemplate` (migracion
  `20260811193253_add_approved_semantic_snapshot_to_issuer_course_template`):
  `approvedSemanticAnalysisId`, `approvedSemanticSnapshot`,
  `approvedSemanticApprovedByUserId`, `approvedSemanticApprovedAt`,
  `approvedSemanticPipelineVersion`, `approvedSemanticTaxonomyVersion`,
  `approvedSemanticSourceCredentialId`. `approvedSemanticAnalysisId` y
  `approvedSemanticSourceCredentialId` son referencias informativas sin FK
  -- mismo patron que `lastSemanticAnalysisId`/`createdFromCredentialId`
  de C3a/C3a.2. **No se agrego** `approvedSemanticProfileId`: la aprobacion
  no se acopla a ningun perfil en este slice.
- **Regla `createdFromCredentialId`**: si el template fue creado desde una
  credencial concreta (`createdFromCredentialId` no nulo), solo se puede
  aprobar una `SemanticAnalysis` de esa misma credencial -- coherente con
  que el template representa la oferta de esa credencial especifica. Si el
  template fue creado a mano (`createdFromCredentialId` nulo), se permite
  aprobar un analisis de **cualquier** credencial del mismo issuer y del
  mismo `credentialType` -- regla intencional, ya que un template manual no
  tiene una credencial de origen unica que lo restrinja.
- **`completed` y `partial` son ambos aprobables**: Traza trata `partial`
  como un analisis valido pero incompleto, y aprobarlo es una decision del
  emisor, no un error. **El emisor aprueba esta interpretacion parcial
  para reutilizacion, no se afirma completitud automatica.** Un analisis
  con estado invalido (estructuralmente, `SemanticAnalysisStatus` solo
  admite `completed`/`partial` -- un analisis fallido nunca llega a
  persistirse como fila, solo como `AnalysisRun` con `status: failed`) se
  rechaza con `400` de forma defensiva. Nunca se llama a la IA para
  "completar" o "mejorar" un analisis `partial` antes de aprobarlo.
- **Snapshot allowlisted, nunca un clon de `analysisJson`**: el snapshot
  aprobado (`buildApprovedTemplateSemanticSnapshot`) copia unicamente
  `status`, `areas`/`skills`/`concepts` (reducidos a
  `{id, label, confidence}` cada entrada), `hoursDistribution`,
  `confidence` (numero, no el `Decimal` crudo), `warnings` y
  `qualityFlags`. **Nunca copia**: `analysisJson` completo, `sourceRefs`,
  `evidenceMap`, `textForEmbedding`, IDs de `DocumentEvidence`/
  `TextEvidence`, `storageKey`/paths de almacenamiento, texto crudo de PDF,
  metadata de debug/auditoria interna, `rawData` de `Credential`, datos de
  holder/blockchain, ni tokens/secrets.
- **Omision deliberada de `competencies`/`learningOutcomes` en el
  snapshot**: esos dos campos no existen en `SemanticAnalysis` -- solo
  existen como dato **emitido** por el issuer en
  `Credential.credentialSubject` (ver seccion C2c: separacion
  "emitido vs inferido"). Incluirlos en el snapshot como arrays vacios
  inventaria un concepto que no aplica a esta fuente de datos; se omiten
  por completo en vez de fingir que existen.
- **Response siempre segura**: la respuesta del template nunca expone el
  snapshot completo, solo un resumen (`approvedSemanticSnapshotSummary`:
  `schema`, `status`, `areaCount`, `skillCount`, `conceptCount`,
  `hasHoursDistribution`, `warningCount`, `qualityFlagCount`, o `null` sin
  aprobacion), junto con `approvedSemanticAnalysisId`,
  `approvedSemanticApprovedAt`, `approvedSemanticPipelineVersion`,
  `approvedSemanticTaxonomyVersion` y
  `approvedSemanticSourceCredentialId`.
- **Aislamiento por issuer, igual que el resto del modulo**: el template y
  la `SemanticAnalysis` deben pertenecer al mismo issuer autorizado. Un
  `SemanticAnalysis` de otro issuer responde `404` (nunca `403`, para no
  filtrar su existencia). Un usuario sin membership activa, o con rol
  `viewer`, no puede aprobar nada -- mismo `IssuersService.assertUserCanManageCourseTemplatesForIssuer`
  que ya protege el resto de `course-templates`.
- Pendiente, explicitamente fuera de alcance de C4a.1: la UI de
  revision/aprobacion (resuelta en C4a.2, ver seccion 19), aplicar la
  interpretacion aprobada a credenciales nuevas o al perfil formativo
  (C4b), y un endpoint de revocacion/limpieza de la aprobacion (no
  implementado en este slice).

## 19. C4a.2 — UI issuer-facing de revision/aprobacion de interpretacion semantica

C4a.2 agrega la UI issuer-facing para revisar y aprobar la interpretacion
semantica de C4a.1, y un endpoint de solo lectura (`candidate`) para poder
mostrar un resumen seguro ANTES de aprobar. No aplica la interpretacion a
credenciales nuevas ni al perfil formativo (eso sigue siendo C4b).

### C5 — Revisión humana antes de persistir un reusable

- Un borrador `course`/`certification` puede registrar intención local de
  reutilización, pero no crea un template. La persistencia exige que la
  credencial esté `issued` y que el emisor apruebe explícitamente una revisión
  de la interpretación disponible.
- El endpoint de revisión acepta únicamente etiquetas allowlisted normalizadas
  (NFC, trim, deduplicación case-insensitive, límites de cantidad y longitud);
  el backend reconstruye un snapshot v2. No actualiza `SemanticAnalysis`, no
  utiliza ids externos como autoridad y no acepta HTML ni JSON como labels.
- Los `qualityFlags` se traducen a observaciones de usuario; códigos técnicos
  desconocidos no se exponen. Los templates legacy conservan sus snapshots
  v1 y pueden revisarse nuevamente para generar v2.
- El perfil formativo conserva fuentes separadas: datos declarados del emisor,
  inferencias de IA, horas oficiales y estimaciones. Su síntesis es
  determinística y prudente; no certifica habilidades ni reemplaza C4b.

- **La revision es obligatoria antes de aprobar**: la UI nunca muestra el
  boton "Aprobar interpretación para reutilización" hasta que el resumen
  candidato (endpoint `candidate` de solo lectura) cargo con exito. Si la
  carga del resumen falla, se muestra un aviso seguro y **no se permite
  aprobar a ciegas** -- este es un requisito de diseño explicito, no un
  efecto secundario.
- **El endpoint `candidate` es de solo lectura**: reutiliza exactamente
  las mismas validaciones de scoping/tipo/status/createdFromCredentialId
  que el `POST` de aprobacion de C4a.1 (extraidas a un metodo compartido
  en el servicio, `resolveApprovableSemanticAnalysis`, para que ambos
  endpoints nunca puedan divergir en sus reglas). Nunca actualiza
  `IssuerCourseTemplate`, nunca crea una `SemanticAnalysis`, nunca llama a
  la IA. Devuelve el mismo tipo de resumen allowlisted que
  `approvedSemanticSnapshotSummary` (schema, status, counts, flags) --
  nunca el snapshot completo ni evidencia cruda.
- **Descubrimiento de template sin endpoint nuevo de busqueda**: se
  reutiliza `listCourseTemplates` (ya existente desde C3c) en vez de
  agregar un endpoint dedicado a "buscar template por credencial". El
  filtro por `createdFromCredentialId` se aplica del lado del cliente
  porque el backend no lo expone como query param directo en este
  endpoint.
- **Orden de fuentes para conocer el template** (documentado y testeado):
  1) el template que devuelve un guardado exitoso via C3b en la misma
  sesion; 2) si no, una busqueda automatica al cargar/recargar la pagina;
  3) si el guardado devuelve `409` duplicado, se reintenta la busqueda
  automatica para recuperar el template existente y habilitar la
  aprobacion sin romper el aviso de duplicado que ya muestra C3b; 4) si
  ninguna fuente resuelve un template, no se muestra ningun boton de
  aprobacion -- la tarjeta de "guardar como reutilizable" de C3b sigue
  disponible sin cambios.
- **`lastSemanticAnalysisId` nulo**: se muestra un aviso suave ("Este
  contenido reutilizable todavía no tiene una interpretación semántica
  asociada para aprobar.") y nunca se llama a ningun endpoint de
  aprobacion o de candidate.
- **Template ya aprobado**: se muestra "Interpretación ya aprobada para
  reutilización." con la metadata segura y el boton de aprobar queda
  deshabilitado. Re-aprobar o revocar una aprobacion existente no esta
  soportado en este slice -- queda documentado como pendiente, no
  implementado.
- **Copy obligatorio** (verificado con tests, nunca reemplazado por texto
  ad-hoc): "Interpretación semántica revisable", "Aprobar interpretación
  para reutilización", "La interpretación aprobada quedará asociada al
  contenido reutilizable de este emisor.", "No modifica la credencial
  original.", "No crea una nueva credencial.", "No implica que la IA
  certifique el contenido.", "Se guarda un resumen semántico saneado, sin
  evidencias crudas." **Nunca** aparece "IA certificó", "blockchain
  valida", "verificado por Udemy/Coursera/AWS", "aprobación automática" ni
  "certificación de competencias por IA".
- **Aislamiento por tipo y por rol de usuario**: nunca aparece para
  `academic_subject`/`degree` (mismo criterio que C3a.2 -- esos tipos
  nunca tienen `IssuerCourseTemplate`), nunca para credenciales `revoked`,
  y nunca en la wallet del titular (la wallet no importa ni renderiza
  ningun componente de este modulo -- es exclusivamente issuer-facing).
- Pendiente, explicitamente fuera de alcance de C4a.2: aplicar la
  interpretacion aprobada a credenciales nuevas creadas desde el template,
  o usarla para reconstruir `FormativeProfile` (C4b); y un endpoint de
  revocacion/re-aprobacion (no implementado, mismo estado que documento
  C4a.1).

## 20. C4x — Hardening de UX/dominio para course/certification

C4x corrige inconsistencias de dominio y UX detectadas en pruebas manuales
del Portal Emisor, sin avanzar a C4b. Es exclusivamente frontend
(`apps/web`) -- no se toco Prisma, migrations, `services/api`,
`services/ai-service`, contracts, blockchain, canonicalizacion/hash ni
`FormativeProfile`.

- **`platformName` deja de ser un input libre para `course`**: antes el
  editor del draft permitia escribir cualquier texto en "Plataforma"
  (`credentialSubject.platform_name`), lo que permitia contradicciones con
  el issuer real (ej. "Plataforma de Cursos Demo" emitiendo un curso
  marcado como "Udemy"). Ahora la UI muestra **"Entidad emisora"**
  (read-only, derivada de `issuer.displayName`, nunca texto libre) en su
  lugar; `platformName` ya no es un campo editable de `course`
  (`credentialDraftFieldsByType.course` en
  `apps/web/src/features/credentials/credential-draft-editor.ts`), por lo
  tanto nunca se renderiza como input ni se incluye en el `PATCH` desde el
  editor. Un valor legacy de `platformName` (credenciales creadas antes de
  este slice) se sigue mostrando, pero exclusivamente como nota de solo
  lectura, nunca editable. El backend (`Credential.credentialSubject`,
  columna JSON, y `IssuerCourseTemplate.platformName`) no se modifico --
  el campo sigue existiendo y sigue siendo valido para datos historicos;
  solo cambio que el frontend deja de ofrecerlo como input principal.
- **No se afirma integracion oficial con plataformas externas**: no
  aparece copy tipo "verificado por Udemy/Coursera/AWS" en ningun punto de
  la UI de `course`/`certification`.
- **`course`/`certification` no muestran carga textual manual ni una
  tarjeta tecnica sustituta**: los datos declarados se usan cuando el
  analisis asistido aplica, sin exponer detalles de `TextEvidence` como
  complejidad permanente del detalle. `academic_subject`/`degree` conservan
  la carga manual previa. El PDF es evidencia documental opcional, no un
  requisito universal de analisis para estos dos tipos.
- **"Resultados de aprendizaje" se renombra en la UI a "Contenido e
  informacion adicional" para `course`**: el campo sigue siendo
  `learningOutcomes`/`learning_outcomes` en el modelo y el backend, sin
  ningun cambio de contrato -- es unicamente un cambio de label/help text
  en la UI issuer-facing (`credential-draft-editor-form.tsx`). Para
  `certification` (que nunca tuvo `learningOutcomes`, ver C1a-c/C3a.2) se
  ajustaron los help text de `description`/`competencies`/`skills` para
  aclarar que alimentan la interpretacion asistida, sin agregar ningun
  campo nuevo al contrato. `degree` conserva el label academico original
  sin cambios -- el renombre es especifico de `course`/`certification`.
- **Helper `hasInstitutionalTextualBacking`**
  (`apps/web/src/features/credentials/institutional-textual-backing.ts`):
  unica fuente de verdad para decidir si `course`/`certification` tienen
  suficiente informacion declarada como respaldo textual institucional.
  Nunca aplica a `academic_subject`/`degree`. Criterio conservador: solo
  el titulo nunca alcanza; una descripcion corta o generica (menos de 20
  caracteres efectivos) tampoco; una descripcion sustancial, o al menos
  una entrada real en `competencies`/`learningOutcomes`/`skills`, si
  alcanza. Se usa para el warning de emision; no agrega una tarjeta tecnica
  permanente al detalle.
- **El warning de "emitir sin respaldo" ya no es incorrecto para
  `course`/`certification` con datos declarados suficientes**: antes, ese
  warning se basaba exclusivamente en si habia `DocumentEvidence`/
  `TextEvidence` cargada, ignorando por completo la informacion declarada.
  Ahora, para `course`/`certification`, contar con respaldo declarativo
  suficiente (via `hasInstitutionalTextualBacking`) cuenta igual que
  evidencia cargada: nunca se afirma "sin fuente de respaldo" en ese caso.
  Cuando hay respaldo declarativo pero no evidencia cargada, se muestra un
  aviso informativo (no bloqueante) solo cuando aporta una accion concreta.
  Cuando no hay ni evidencia cargada ni respaldo declarativo suficiente,
  se exige la misma confirmacion
  explicita que ya existia (checkbox "Confirmo emitir..."), solo que con
  copy ajustado a "informacion declarada insuficiente" en vez de "sin
  fuente de respaldo" -- **no se agrego ningun bloqueo nuevo, ni se quito
  el bloqueo que ya existia**. `academic_subject`/`degree` conservan el
  copy y el comportamiento original sin cambios.
- **Seleccion atomica de templates reutilizables**: al aplicar un template
  en `/issuer/credentials/new`, `credentialType` y `achievementName`
  quedan bloqueados (deshabilitados en la UI y, ademas, los handlers
  correspondientes rechazan el cambio aunque se dispare el evento
  igual -- defensa en profundidad). La accion para deseleccionar es
  "Quitar contenido reutilizable" (antes "Cambiar seleccion"); solo al
  quitarlo se desbloquean tipo y nombre. Esto cierra una inconsistencia de
  C3c: antes se podia aplicar un template y despues escribir otro nombre,
  o cambiar de `course` a `certification` con un template de `course` ya
  aplicado, generando una seleccion no atomica/contradictoria. El resto
  del flujo de C3c no cambia: sigue sin enviarse `templateId` en la
  creacion del draft, el `PATCH` best-effort posterior sigue aplicando el
  resto de los campos, y `?templateApply=failed` sigue funcionando. Nunca
  se copia `SemanticAnalysis`, `lastSemanticAnalysisId` ni
  `approvedSemanticSnapshot` del template en este flujo -- eso sigue
  siendo exclusivo de C4a.1/C4a.2, y aplicarlo a una credencial nueva
  sigue siendo C4b.
- **Layout desktop del Portal Emisor**: se agrego una variable CSS nueva
  (`--traza-issuer-reading-width`, mas ancha que
  `--traza-reading-width`) usada unicamente por `IssuerShell`. La wallet
  del titular (`WalletShell`/`ContextShell`) sigue usando
  `--traza-reading-width` sin cambios -- este slice explicitamente no
  rediseña la wallet.
- Pendiente, explicitamente fuera de alcance de C4x: C4b (aplicar la
  interpretacion aprobada a credenciales nuevas y al perfil formativo)
  sigue sin implementarse.

### 20.1 C4x fix — certification sin PDF gana analisis textual automatico; platformName se cierra tambien backend-side

C4x (arriba) fue exclusivamente frontend y dejo dos riesgos funcionales
documentados como deuda: (1) para `certification`, la UI ya indicaba que
los datos declarados podian alimentar el analisis asistido, pero el backend
nunca disparaba un analisis real desde esos datos cuando no habia PDF; (2)
`platformName` dejo de ser un input en el
editor de `course`, pero el backend seguia aceptando/persistiendo un
valor arbitrario si se llamaba directamente a la API (creacion de
borrador, PATCH, o templates reutilizables). Este fix cierra ambos
riesgos, sin implementar C4b, sin copiar `approvedSemanticSnapshot`/
`SemanticAnalysis` a credenciales nuevas, sin tocar
`FormativeProfileService`, `services/ai-service`, `contracts`,
blockchain, canonicalizacion/hash, ni Prisma/migrations.

**Analisis textual automatico para `certification` sin PDF** (mismo
mecanismo que C2b.3 para `course`, extendido a certification):

- `AutomaticCourseTextAnalysisService` (el nombre quedo de C2b.3, cuando
  solo cubria `course` -- se documenta aca que desde este fix cubre
  ambos tipos; no se renombro la clase para no agrandar el diff de
  DI/wiring en 4 archivos, solo se renombro su metodo publico a
  `analyzeIssuedCredentialIfEligible`, igual convencion que
  `AutomaticDocumentAnalysisService`) ahora tambien evalua
  `certification` issued sin `DocumentEvidence` PDF `current`.
- Texto analizable exclusivamente desde: `achievementName`/`title`,
  `description`, `certificationCode`, `expirationDate`, `providerName`,
  `level`, `skills`, `competencies`. **Nunca** `modality`,
  `platformName`, `academicCourseReference`, `curriculumReference`,
  `approvedSemanticSnapshot`/`approvedSemanticAnalysisId`/
  `lastSemanticAnalysisId`, ninguna `SemanticAnalysis` existente, datos
  de blockchain/canonical/hash, datos privados del holder ni `rawData`
  completo. `learningOutcomes` no existe en el contrato de
  `certification` (ver C1a-c/C3a.2) y nunca se envia para este tipo.
- Regla de suficiencia conservadora, mismo espiritu que `course`: solo
  el titulo nunca alcanza; una descripcion sustancial alcanza sola;
  titulo + skills/competencies alcanza; skills/competencies sin
  descripcion puede alcanzar si el texto resultante es coherente y hay
  al menos una fuente formativa real. Si el texto es insuficiente, la
  emision continua sin crear `TextEvidence` ni `AnalysisRun` -- nunca
  falla.
- Reusa `TextEvidenceService.
  ensureSystemGeneratedCurrentTextEvidenceForCredential` (ahora recibe
  un `label` explicito por tipo): si ya existe una `TextEvidence`
  `current`, se reusa tal cual y nunca se reemplaza; si no existe, se
  crea una con el label *"Texto generado para analisis desde datos
  declarados de la certificacion"* (course conserva su label original,
  *"...del curso"*), y `submittedByUserId` es el usuario real que
  emitio, no un usuario de sistema inventado.
- Mismo mecanismo de deduplicacion que `course`: cualquier `AnalysisRun`
  `text` previo para la MISMA `TextEvidence.id`, en cualquier estado
  (`pending`/`running`/`completed`/`failed`), bloquea un run nuevo --
  evita reintentos infinitos en emisiones repetidas.
- Mismo patron best-effort/nunca-revierte que `course`: cualquier error
  (generacion de evidencia, creacion del run, ejecucion IA) se atrapa y
  se loguea de forma segura; el caller
  (`IssuerCredentialIssueService`) envuelve la llamada en su propio
  `try/catch` como segunda red de seguridad.
- Si el analisis automatico completa, el rebuild automatico de perfil de
  C2b.4 (`AutomaticProfileRebuildService.rebuildAfterAutomaticAnalysis`)
  se sigue disparando sin cambios -- no se agrego logica nueva de
  perfil, no se toco `FormativeProfileService`.
- `academic_subject`/`degree` siguen completamente fuera de este flujo,
  sin cambios.

**`platformName` se cierra tambien backend-side para `course`** (antes
de este fix, el backend seguia aceptando el campo aunque el frontend ya
no lo ofreciera como input):

- **`PATCH` de borrador** (`issuer-credential-draft-subject.ts`):
  `platformName` deja de ser un dato editable para cualquier tipo (antes
  solo aplicaba a `course`) -- se rechaza explicitamente con `400` en
  cuanto se envia, con o sin valor `null`, antes de evaluar aplicabilidad
  por tipo. `platformName` se mantiene en el set "aplicable" de `course`
  unicamente para que un `platform_name` legacy ya persistido sobreviva
  sin cambios a un `PATCH` que edita otro campo -- nunca se borra como
  efecto secundario de un patch no relacionado.
- **Creacion de borrador** (`credentials.service.ts#createDraft`): el
  `credentialSubject` de entrada es JSON crudo sin allowlist por campo
  (a diferencia del `PATCH`) -- rechazar toda la creacion por una unica
  clave desconocida seria desproporcionado. Se opto por **ignorar**
  (descartar) `platform_name` si llega en el payload para `type=course`,
  documentado como asimetria intencional respecto al `PATCH`.
- **Templates reutilizables** (`issuer-course-templates.validator.ts`):
  `platformName` deja de estar en el allowlist de campos de entrada para
  `create`/`PATCH` de template (antes solo era exclusivo de `course`,
  ahora se rechaza para cualquier `credentialType` con el mismo
  mecanismo de "campo no permitido" que ya rechaza `issuerId`/
  `createdByUserId`) -- **rechazo explicito con `400`**, no ignorado.
  `createTemplateFromCredentialForIssuer` deja de copiar
  `platform_name` hacia un template nuevo creado desde una credencial
  `course`, aunque exista como dato legacy en `credentialSubject`.
- **Compatibilidad de lectura preservada en los tres casos**: un
  `platform_name`/`platformName` legacy ya persistido (en
  `Credential.credentialSubject` o en `IssuerCourseTemplate.
  platformName`) sigue leyendose y mostrandose sin cambios -- nunca se
  borra, nunca se migra, nunca se toca Prisma. Solo deja de poder
  escribirse/reenviarse como dato nuevo.
- **Efecto colateral corregido en frontend**: cerrar `platformName` en el
  `PATCH` de borrador expuso que `apps/web` (`new-credential-route.tsx`,
  flujo de aplicar template en C3c) todavia lo enviaba en el `PATCH`
  best-effort posterior a crear el draft. Al ser un unico body, el nuevo
  `400` habria tumbado tambien el resto de los campos de ese request
  (`modality`/`externalUrl`/`competencies`/`learningOutcomes`). Se quito
  esa unica linea -- unico cambio de codigo frontend de este fix.

### C4y — hardening post-pruebas de issuer, semántica y perfil

`course`/`certification` no exponen una carga manual de `TextEvidence` ni una
tarjeta técnica sustituta en el detalle issuer-facing. El análisis asistido usa
datos declarados por el emisor cuando existen; el PDF continúa como evidencia
documental opcional. El builder de `course` permite título, descripción,
competencias y `learningOutcomes`; el de `certification` permite título,
descripción, código, vencimiento, proveedor, nivel, skills y competencias.
Ambos excluyen plataforma, referencias curriculares, snapshots aprobados,
análisis previos, datos de holder, canon, hash, blockchain y `rawData`.

La taxonomía conserva el área existente `Gestión de Proyectos Tecnológicos`
para señales ágiles distintivas (Scrum, Kanban, backlog, sprint,
retrospectiva y metodologías ágiles). No convierte menciones genéricas de
gestión en una clasificación forzada ni modifica los casos de comunicación y
humanidades. El rebuild automático, posterior a un análisis persistido,
mantiene separado lo declarado por el emisor de las inferencias IA y comunica
fallos best-effort mediante `formative_profile_rebuild_failed`. C4b sigue
pendiente: no se aplican snapshots aprobados a nuevas credenciales ni perfiles.

## 21. V3 — layouts públicos desktop-first y hardening de UX post-emisión (frontend/docs-only)

V3 es exclusivamente frontend/docs: no cambia `schema.prisma`, migraciones,
contratos, canon/hash, reglas de emisión, taxonomía IA ni contratos de
blockchain. No aplica `approvedSemanticSnapshot` a credenciales ni perfiles
nuevos (C4b/C5b siguen pendientes, sin cambios respecto a la sección 20/C5).

- **Layouts públicos desktop-first:** `/share/profile/[token]` y `/verify`
  pasan de un contenedor angosto (`max-w-4xl`) a `max-w-7xl`, con grillas de
  varias columnas en desktop. La Wallet privada del holder se mantiene
  mobile-first sin cambios (sección "Holder wallet v1").
- **Issuer detail sin "Verificación pública":** se retira el link operativo
  hacia `/verify` del detalle del emisor (`draft`/`issued`/`revoked`). No se
  modifica el endpoint público de verificación (`GET
  /verify/credentials/:credentialId`, ver `api-contracts-v0.md`), el sharing
  de wallet (`SharingGrant`, sección 7) ni el link `Ver credencial` del
  perfil público.
- **Issuer detail — hueco de layout en `issued`:** causa raíz frontend pura
  (grid de dos columnas donde la evidencia se renderizaba en una sección
  aparte, debajo de ambas columnas, sin compartir tracks de fila con la
  sidebar de acciones). Se reubica evidencia documental/análisis dentro de la
  columna principal, sin tocar qué datos expone cada tipo de credencial.
- **Análisis asistido — retry acotado a `draft`:** la UI ya no muestra un
  botón de refresh manual (`Consultar último análisis`). Se agrega un botón
  `Reintentar análisis` limitado exactamente al caso ya permitido por el
  contrato existente: `AnalysisRun` `status=failed`, `trigger!=system`, y
  credencial todavía `draft` — el mismo alcance `draft`-only ya documentado
  para `POST /issuers/:issuerId/credentials/:credentialId/analysis-runs/
  document` (sección 7 de `api-contracts-v0.md`). No se agrega ningún
  endpoint, no se relaja el alcance `draft`-only, y para un run `failed` con
  `trigger=system` (post-emisión) no se ofrece ninguna acción de reintento,
  igual que antes.

## 22. C4b.1a/C4b.1b — Aplicar una interpretacion semantica reutilizable aprobada a una credencial

C4b.1a agrego la persistencia foundation (modelo
`CredentialReusableSemanticInterpretation`, migracion
`20260814150000_add_credential_reusable_semantic_interpretation`, validada
contra Postgres real -- bundle C4b.1a-V) sin ningun endpoint. C4b.1b agrega
los tres endpoints issuer-facing (`candidate`/`apply`/lectura, ver
`api-contracts-v0.md`) que aplican la aprobacion ya persistida por C4a.1 a
una credencial `issued` concreta. Sigue sin tocar frontend ni perfil.

- **Aplicacion siempre post-emision, nunca automatica**: la interpretacion
  aprobada de un template **nunca** se aplica sola al emitir una credencial
  ni al aprobar el template. Es siempre una accion explicita posterior del
  emisor (`apply`), decidida credencial por credencial.
- **Snapshot congelado en el momento de aplicar**: los campos copiados a la
  fila `active` (`source*`, `approvedSnapshot`, `snapshotVersion`) son una
  foto de la aprobacion del template en ese instante. Si el template se
  vuelve a aprobar despues, la fila ya aplicada **no cambia sola** -- queda
  desactualizada (`approvalDriftStatus: different_approval_available`)
  hasta que el emisor decida volver a aplicar.
- **Tres senales de drift, deliberadamente distintas** (correccion de diseno
  de C4b.0.2, ver bundle de esa sesion): la version original del diseno
  comparaba la credencial destino contra el **template actual**, lo cual
  permitia que una interpretacion semanticamente incorrecta se aplicara si
  el template se editaba sin re-aprobar. La correccion separa tres
  conceptos que nunca se mezclan:
  - `approvalDriftStatus`: identidad de la aprobacion ya aplicada vs. la
    aprobacion actual del template.
  - `templateContentStatus`: template actual vs. la credencial fuente real
    -- advertencia editorial pura, **nunca bloquea**.
  - `destinationCompatibility`: credencial destino vs. la credencial fuente
    real -- el unico control que gatea `apply`. `unknown` es un bloqueo
    duro sin acknowledgment posible; `modified` requiere
    `acknowledgeDestinationDrift: true` explicito.
- **La fuente real es la credencial, nunca el template -- pero "la fuente
  real" significa cosas distintas segun el contexto, y nunca se mezclan**:
  `destinationCompatibility` y `templateContentStatus` nunca comparan
  contra el estado mutable del template en si mismo, siempre contra una
  credencial fuente (revalidada server-side en cada llamada, nunca confiada
  del frontend) -- pero CUAL credencial fuente depende de que se esta
  describiendo:
  - Para el nivel superior de `candidate` (lo que se aplicaria SI el
    emisor aplica ahora): la fuente ACTUAL del template,
    `template.approvedSemanticSourceCredentialId`, releida en cada
    llamada -- puede cambiar si el template se re-aprueba.
  - Para `currentApplication` (dentro de `candidate`) y para el `GET` de
    solo lectura (lo que YA esta aplicado): la fuente CONGELADA de la fila
    `active`, `active.sourceCredentialId`, copiada una unica vez al
    momento de `apply` -- una re-aprobacion posterior del template con una
    fuente distinta **nunca** cambia retroactivamente esta comparacion.
    Si esa fuente congelada ya no puede resolverse, el resultado es
    `unknown` -- nunca se sustituye silenciosamente por la fuente actual
    del template, y la aplicacion nunca deja de ser legible por esto.
  Confirmado con tests dedicados (`reusable-semantic-interpretation.service.test.ts`,
  seccion "frozen source") que fuerzan un escenario de re-aprobacion con una
  segunda credencial fuente de contenido completamente distinto, y verifican
  que `candidate` top-level y `currentApplication`/`GET` puedan diferir
  legitimamente entre si en la misma respuesta sin contaminarse.
- **Una fuente revocada sigue siendo fuente valida**: revocar una credencial
  solo agrega `revokedAt`/`revocationReason`; nunca muta `title`/
  `description`/`credentialSubject`. La resolucion de la fuente
  (`resolveSourceCredential`) nunca filtra por `status` -- una fuente
  `revoked` sigue siendo una referencia semantica historica valida.
- **Idempotencia por identidad de aprobacion, nunca por `templateId`**: la
  identidad que decide si una aplicacion es "la misma" es
  `(sourceSemanticAnalysisId, sourceApprovedAt)`. Re-aplicar la misma
  aprobacion no escribe nada; aplicar una aprobacion distinta del mismo
  template supersede la anterior en la misma transaccion, preservando el
  historial (`superseded`, nunca borrado).
- **Invariante fisico**: `Credential -> 0..1 active, 0..N superseded`,
  garantizado por el indice unico parcial
  `crsi_one_active_per_credential_uq` de C4b.1a. C4b.1b nunca duplica esa
  garantia en aplicacion -- la usa como ultima linea de defensa ante una
  carrera real entre dos `apply` concurrentes, confirmada empiricamente
  contra Postgres real (ver bundle C4b.1b): el `P2002` resultante se
  reconcilia leyendo el estado post-commit, nunca reintentando la escritura
  a ciegas.
- **TOCTOU explicito**: `candidate` devuelve una precondicion opaca
  (`approvalRevision`, el ISO string de `approvedSemanticApprovedAt`) que
  identifica exactamente la aprobacion que el emisor revisó. `apply` la
  revalida dentro de la transaccion contra el estado actual del template; si
  no coincide exactamente, rechaza con `409` sin persistir nada y obliga a
  volver a `candidate`. Deliberadamente no se expone
  `sourceSemanticAnalysisId` al frontend para esto -- `approvedSemanticApprovedAt`
  alcanza porque las 7 columnas `approvedSemantic*` del template siempre se
  escriben juntas y atomicamente (mismo `update()` que ya usa C4a.1).
- **Aislamiento por issuer, igual que el resto del modulo**: mismo permiso
  que C4a.1/C4a.2/C5
  (`IssuersService.assertUserCanApplyReusableSemanticInterpretationForIssuer`),
  y mismo criterio de no filtrar existencia entre issuers (`404`, nunca
  `403`, para credencial o template de otro issuer).
- **Nunca toca**: `Credential.canonicalHash`/`canonicalizationVersion`,
  blockchain, ninguna ruta de holder o `/verify` publica. No se llama a la
  IA en ningun punto de este flujo. (`FormativeProfile` -- cierto en
  C4b.1a/C4b.1b tal como se implementaron aca; C5b.1, seccion 23, agrega
  DESPUES un rebuild best-effort post-`apply`, siempre fuera de la
  transaccion de este slice, nunca modificando su contrato.)
- Pendiente, explicitamente fuera de alcance de C4b.1a/C4b.1b: frontend
  issuer-facing para estos tres endpoints (resuelto en C4b.2); consumo de la
  interpretacion aplicada al reconstruir `FormativeProfile` (resuelto en
  C5b.1, seccion 23); exposicion al holder de esa distincion (C5b.2, si se
  decide implementar) -- **nunca en `/verify` publico**, decision ya
  cerrada que no cambia por C4b/C5b: `/verify` sigue enfocado en
  estado/integridad verificable, sin mostrar perfil ni interpretacion
  semantica; y `Credential.sourceTemplateId`, diferido desde C4b.0.1 (nunca
  agregado a `schema.prisma` en ningun slice
  de C4b).

## 23. C5b.1 — Consumir una interpretacion aplicada en el perfil formativo

C5b.1 hace que `FormativeProfileService.rebuildForUser` consuma
`CredentialReusableSemanticInterpretation` (C4b.1a/C4b.1b) como fuente
semantica preferida de una `Credential`, y dispara el mismo rebuild
best-effort ya existente despues de un `apply` exitoso (C4b.1b). Sin
migracion, sin cambio de `schema.prisma` -- el cambio es aditivo dentro del
JSON existente (`profileJson`, `areasSummary`, `skillsSummary`).

- **Prioridad estrictamente por-Credential, nunca global**: para cada
  `Credential` `issued` del holder, se resuelve como maximo UNA fuente
  semantica: (1) su fila `CredentialReusableSemanticInterpretation`
  `status=active` (`issuer_reviewed`); si no existe, (2) su ultimo
  `SemanticAnalysis` propio (`ai_inferred`); si ninguna existe, la
  `Credential` queda sin fuente semantica (solo declared/emitted). Nunca se
  combinan ambas fuentes para la MISMA `Credential`. La prioridad nunca es
  global entre `Credential`s distintas: una skill `issuer_reviewed` de la
  `Credential` A nunca elimina ni reemplaza la contribucion `ai_inferred`
  de la misma skill aportada por la `Credential` B -- ambas se acumulan en
  el mismo agregado, con su propia `source` (ver mas abajo).
- **Solo `active`, nunca `superseded`**: la query anidada
  (`Credential.reusableSemanticInterpretations`) usa
  `where: { status: 'active' }, take: 1` -- garantizado por el indice unico
  parcial de C4b.1a. Nunca se relee ni se reconsidera una fila superseded.
- **El perfil consume el snapshot congelado, nunca reinterpreta el
  template**: la fuente semantica de una `Credential` con interpretacion
  aplicada es exclusivamente
  `CredentialReusableSemanticInterpretation.approvedSnapshot`, ya congelado
  al momento de `apply` (C4b.1b). El perfil **nunca** vuelve a leer
  `IssuerCourseTemplate.approvedSemanticSnapshot`, nunca reconstruye desde
  el `SemanticAnalysis` fuente, nunca consulta la aprobacion viva actual
  del template ni `sourceCredentialId` para reconstruir contenido -- de
  hecho, `FormativeProfileService` nunca consulta `IssuerCourseTemplate` en
  absoluto. Una re-aprobacion posterior del template (con contenido
  distinto) **no** cambia retroactivamente que interpretacion consume el
  perfil de una `Credential` que sigue con una version anterior aplicada.
- **Version de snapshot soportada, confirmada por auditoria de codigo**:
  unicamente `approved_template_semantic_snapshot_v2`
  (`REVIEWED_APPROVED_TEMPLATE_SEMANTIC_SNAPSHOT_SCHEMA`). Confirmado
  releyendo `issuer-course-templates.service.ts`: los dos unicos paths que
  persisten `IssuerCourseTemplate.approvedSemanticSnapshot`
  (`approveTemplateSemanticAnalysisForIssuer`/
  `approveCredentialSemanticAnalysisForIssuer`) usan exclusivamente
  `buildReviewedApprovedTemplateSemanticSnapshot` (v2) -- la version v1
  (`buildApprovedTemplateSemanticSnapshot`) solo se usa en los endpoints de
  candidate de solo lectura, nunca se persiste. No se asumio esto desde la
  documentacion: se confirmo leyendo el codigo real antes de implementar.
- **Fail-safe ante snapshot no soportado/corrupto -- nunca un fallback
  silencioso a la IA cruda**: si una `Credential` tiene una fila `active`
  pero su `snapshotVersion` no es la soportada, o su `approvedSnapshot` no
  pasa la validacion defensiva ya existente
  (`buildApprovedSemanticSnapshotSummary`, reutilizada sin duplicar), esa
  `Credential` queda **sin fuente semantica utilizada** (mismo bucket que
  "sin cobertura"), agregando el warning
  `reusable_interpretation_snapshot_unsupported` ademas del ya existente
  `credential_without_semantic_analysis`. **Nunca** cae a su propio
  `SemanticAnalysis` en este caso: una interpretacion humana aplicada no se
  ignora en silencio para volver a la IA cruda -- ese comportamiento esta
  testeado explicitamente (casos P/P2 de la suite de C5b.1).
- **Provenance por contribucion, nunca un escalar unico sobre el
  agregado**: cada `ProfileArea`/`ProfileSkill`/`ProfileConcept` agrega
  `sources: ProfileEvidenceSource[]` (nuevo, aditivo) --
  `{ credentialId, provenance: 'issuer_reviewed' | 'ai_inferred',
  reusableInterpretationId? | semanticAnalysisId? }`, exactamente uno de
  los dos ultimos campos presente segun `provenance` (el otro literalmente
  ausente, no `null`). Una misma `Credential` nunca aporta mas de una
  `source` a la misma etiqueta, aunque la aporte varias veces dentro de su
  propio snapshot/analisis (dedup por `credentialId` antes de contar
  provenance). `provenanceSummary: { issuerReviewedCount, aiInferredCount }`
  se deriva de `sources` (conteo de `Credential`s/fuentes contribuyentes
  distintas, nunca ocurrencias duplicadas). `evidenceCount` ahora significa
  `sources.length` (antes, cantidad de `SemanticAnalysis` distintos --
  coincide numericamente en el caso 100% `ai_inferred`, unico caso posible
  antes de C5b.1). `credentialIds`/`semanticAnalysisIds` se preservan por
  compatibilidad; `semanticAnalysisIds` contiene **unicamente** ids
  efectivamente consumidos como `ai_inferred` -- nunca el
  `sourceSemanticAnalysisId` historico de una interpretacion aplicada (esa
  referencia es provenance de la aprobacion fuente del template, no la
  fuente que el perfil consume para esta `Credential`; testeado
  explicitamente, caso G).
- **`generatedFrom` extendido**: agrega
  `reusableSemanticInterpretationIds: string[]` (solo filas `active`
  efectivamente consumidas como `issuer_reviewed`, nunca `superseded`,
  nunca inferido desde `sourceSemanticAnalysisId`). `semanticAnalysisIds`
  sigue existiendo, ahora acotado a lo efectivamente consumido como
  `ai_inferred`.
- **Contadores**: `summary.analyzedCredentialsCount` ahora es
  `issuer_reviewed + ai_inferred` (antes, solo `ai_inferred`). Nuevo
  `summary.credentialsWithReviewedInterpretation` (cuantas `Credential`s
  eligieron `issuer_reviewed`). `credentialsWithoutSemanticCoverage` sigue
  siendo exhaustivo junto con `analyzedCredentialsCount`
  (`credentialsCount = analyzedCredentialsCount + credentialsWithoutSemanticCoverage`),
  ahora incluyendo tambien el caso de snapshot no soportado.
- **Horas oficiales nunca cambian de fuente**: `Credential.hours`/
  `totalOfficialHours`/`credentialsWithoutHours` siguen viniendo
  exclusivamente de `Credential.hours` declarado por el emisor -- una
  interpretacion aplicada nunca los reemplaza ni recalcula. Lo unico que
  puede aportar una interpretacion aplicada es `estimatedHours` por area,
  leido de `approvedSnapshot.hoursDistribution` (mismo campo/semantica que
  ya usaba `SemanticAnalysis.analysisJson.hoursDistribution` para
  `ai_inferred` -- ambos alimentan el mismo acumulador de horas
  *estimadas*, nunca oficiales).
- **Confidence sin cambiar de significado**: `approvedSnapshot.confidence`
  participa en el mismo algoritmo de agregacion derivada que ya usaba
  `SemanticAnalysis.confidence` para `ai_inferred` (promedio, redondeado).
  Semanticamente sigue siendo la confianza del analisis de IA original que
  origino esa interpretacion -- **nunca** se reinterpreta como "confianza
  de la revision humana", y ningun copy nuevo debe sugerir eso (C5b.1 no
  toca ningun mapper visible al usuario).
- **Determinismo preservado**: mismo conjunto de `Credential`s + mismas
  filas `active` + mismos `SemanticAnalysis` elegidos -> mismo `profileJson`
  semantico, sin importar el orden de la query. `sources[]` siempre se
  ordena por `credentialId` antes de derivar `credentialIds`/
  `semanticAnalysisIds`/`provenanceSummary`.
- **Rebuild post-`apply`, reutilizando el mecanismo existente**:
  `ReusableSemanticInterpretationModule` ahora importa `AnalysisRunModule`
  (que exporta `AutomaticProfileRebuildService` ademas de a sus dos
  consumidores existentes) en vez de duplicar logica de rebuild/try-catch/
  logging. Tras construir la respuesta de `apply` (siempre DESPUES de que
  la transaccion de escritura ya commiteo, nunca dentro de ella), se llama
  `rebuildAfterAutomaticAnalysis({ credentialId, holderUserId })` --
  `holderUserId` viene de un nuevo campo `subjectUserId` agregado al select
  de la credencial destino (nunca expuesto en ningun DTO, todos siguen
  construyendose campo a campo). Se intenta para **todo** resultado
  exitoso de `apply`, incluido `changed:false` (idempotente) y el path
  reconciliado tras un `P2002` -- un apply idempotente puede servir de
  reintento si un rebuild anterior fallo, sin crear ninguna fila de
  interpretacion nueva por eso. Si el rebuild falla,
  `AutomaticProfileRebuildService` ya lo atrapa y loguea de forma segura
  (mismo contrato usado por el resto del repo) -- nunca revierte ni
  invalida el `apply`, nunca lo reintenta. No se agrego cola, cron ni event
  bus nuevo.
- **`profileRebuildStatus` evaluado y descartado para este slice**: el
  contrato de `POST .../apply` (C4b.1b) no cambia -- se decidio no exponer
  el resultado del rebuild en la response, tratandolo como efecto interno
  best-effort (mismo criterio que ya aplica el resto del repo para el
  rebuild automatico tras un analisis). Evita romper el contrato ya
  consumido por C4b.2 (frontend) sin necesidad real detectada.
- **Auditoria de privacidad, sin leak activo**: se releyeron
  `holder-current-profile.mapper.ts` y `profile-sharing.service.ts`
  completos antes de este cambio. Ambos construyen sus DTOs campo a campo
  (`{label, estimatedHours}`/`{label, confidence}`/`string[]`) leyendo
  `profileJson`/`areasSummary`/`skillsSummary`, sin spread ni passthrough
  de los objetos internos -- `sources[]`/`provenanceSummary` nuevos quedan
  inertes para ambos consumidores. `profile-sharing.service.ts` sigue
  reutilizando la salida YA MAPEADA (segura) del holder mapper con
  `.slice()`, nunca `profileJson` crudo -- el riesgo latente ya documentado
  (si C5b.2 agrega `provenanceSummary` directo al mapper del holder, ese
  `.slice()` lo heredaria automaticamente hacia el share publico) sigue
  **latente, no activo**: C5b.1 no toca ninguno de los dos mappers.
  `/verify` no referencia `FormativeProfile` en ningun punto (confirmado
  por busqueda en el codigo).
- Pendiente, explicitamente fuera de alcance de C5b.1: exponer
  `provenanceSummary`/la distincion `issuer_reviewed` vs `ai_inferred` al
  holder o al perfil publico compartido (resuelto en C5b.2, seccion 24);
  cualquier cambio a `/verify` (decision cerrada, no cambia);
  `Credential.sourceTemplateId` (sigue diferido desde C4b.0.1).

## 24. C5b.2 — Provenance del holder y hardening de privacidad del perfil publico

C5b.2 cierra el riesgo latente documentado en la seccion 23: expone
`provenanceSummary` agregada al holder autenticado y endurece
`profile-sharing.service.ts` con un remapeo explicito, en ese orden dentro
del mismo slice (primero el hardening, recien despues el campo nuevo en el
mapper). Sin migracion, sin cambio de `schema.prisma` -- consume campos ya
persistidos por C5b.1 (`profileJson.areas[].provenanceSummary`,
`profileJson.skills[].provenanceSummary`,
`profileJson.summary.credentialsWithReviewedInterpretation`).

- **El holder puede conocer provenance agregada de sus propios elementos,
  nunca la traza tecnica interna**: `GET /me/profile/current`/
  `POST /me/profile/rebuild` exponen, por area/skill,
  `provenanceSummary: {issuerReviewedCount, aiInferredCount} | null` y, a
  nivel de perfil, `credentialsWithReviewedInterpretation: number | null`.
  Nunca se expone `sources[]`, `credentialId` de una entrada de provenance,
  `reusableInterpretationId`, `semanticAnalysisId`, ni los enums
  `issuer_reviewed`/`ai_inferred` como tales -- el holder recibe solo los
  dos contadores agregados, nunca la lista de Credentials/analisis que los
  componen.
- **`concepts` no gana provenance en C5b.2**: sigue siendo `string[]`
  (contrato holder sin cambios); C5b.1 persiste `provenanceSummary` tambien
  por concept internamente, pero exponerlo hubiera requerido romper el
  shape actual del campo (`string` -> objeto) sin necesidad directa para el
  objetivo de producto de este slice (que habla de "habilidad", no de
  "concepto"). Queda disponible para un slice futuro si se decide
  necesario.
- **Perfil publico compartido: contrato inalterado**. `GET /share/profile/:token`
  nunca recibe `provenanceSummary`, `sources` ni
  `credentialsWithReviewedInterpretation` -- ni antes ni despues de C5b.2.
- **Orden obligatorio dentro del slice, para que el riesgo de la seccion 23
  nunca se active ni transitoriamente**: primero se cambio
  `profile-sharing.service.ts` para construir `areas`/`skills` publicos con
  un remapeo explicito campo-por-campo
  (`.map(({label, estimatedHours}) => ({label, estimatedHours}))`/
  `.map(({label, confidence}) => ({label, confidence}))`), reemplazando el
  `.slice()` que antes reenviaba el objeto holder completo. Recien despues
  se agrego `provenanceSummary` a `areas()`/`skills()` en
  `holder-current-profile.mapper.ts`. Con el remapeo explicito ya en su
  lugar, agregar el campo nuevo al mapper del holder nunca lo propaga al
  share publico -- verificado con un test end-to-end que corre el pipeline
  real (`mapHolderCurrentProfileResponse` incluido, no mockeado) con un
  `profileJson` que trae `sources[]`/`provenanceSummary` y confirma su
  ausencia total (incluida via `JSON.stringify`) en la respuesta publica.
- **Defensive parsing, nunca fabricar provenance**: un `provenanceSummary`
  valido exige `issuerReviewedCount`/`aiInferredCount` enteros finitos
  `>= 0`; cualquier otra forma (string, negativo, no-entero, objeto,
  ausente) se trata como `null` -- "no sabemos", nunca "cero" ni un valor
  inferido de otro campo (`evidenceCount`, `credentialIds`, etc.). Un
  `FormativeProfile` legado (generado antes de C5b.1) no tiene esta forma
  en absoluto: su ausencia nunca se completa a partir de `evidenceCount`
  (que en un perfil legado siempre fue 100% `ai_inferred`, pero inferir eso
  igual cuenta como fabricar provenance historica que el dato no afirma
  explicitamente) -- se sirve `provenanceSummary: null` y el frontend no
  muestra ningun indicador de procedencia para ese item.
- **Copy de producto, nunca lenguaje tecnico**: el frontend (adapter +
  `HolderProfilePanel`) traduce los dos contadores a texto de producto
  ("Revisado por el emisor" / "N aportes revisados por el emisor",
  "Interpretado con IA" / "N aportes interpretados con IA"); nunca muestra
  `issuer_reviewed`/`ai_inferred`/`provenanceSummary`/`sources`/`snapshot`/
  `SemanticAnalysis`, y nunca usa "verificado" para esta semantica (esa
  palabra ya significa autenticidad/integridad de credencial en Traza,
  concepto distinto). Cuando ambos contadores son positivos se muestran
  ambos sin sugerir que uno invalida al otro.
- **Integracion visual discreta**: la provenance se renderiza como un
  indicador chico (dos iconos, texto completo solo en el `title`/
  `aria-label` nativo) dentro del mismo `Badge` de cada area/skill, nunca
  como una tarjeta propia por item -- con perfiles de muchas skills, la
  provenance no debe dominar la pantalla. Un contador en cero no genera
  badge para esa fuente (nunca "0 aportes revisados"); ausencia total de
  provenance no genera ninguna fila vacia.
- **Adapter frontend degrada, nunca lanza, ante un `provenanceSummary`
  malformado**: a diferencia del resto de `holder.adapter.ts` (que rechaza
  el payload completo ante un campo invalido, `IncompatiblePayloadError`),
  `provenanceSummary` es secundario -- un shape invalido nunca tira abajo
  el perfil holder completo, solo omite el indicador para ese item.
- Pendiente, fuera de alcance de C5b.2: provenance para `concepts`; mostrar
  `credentialsWithReviewedInterpretation` fuera del resumen ya existente
  (por ejemplo un dashboard dedicado); cualquier cambio a `/verify`
  (decision cerrada, no cambia); `Credential.sourceTemplateId` (sigue
  diferido desde C4b.0.1).

## 25. A1 — Registro de titular: crear cuenta con email + contraseña + auto-login

A1 agrega `POST /auth/register` para que una persona nueva cree su propia
cuenta holder. Sin migracion -- `AuthCredential.passwordHash` y
`User.did`/`User.email` nullable-unique ya existian en `schema.prisma`
antes de A1 (no se toco el schema).

- **Registro publico crea unicamente `User` comun**: `status: active`,
  nunca `Issuer`, `IssuerMembership`, `Credential`, `FormativeProfile` ni
  ningun otro dato. No existe seleccion de rol/issuer en el registro --
  toda cuenta nueva empieza como holder sin membership institucional
  alguna (verificado: `register()` nunca toca la tabla
  `IssuerMembership`).
- **No hay verificacion de email en esta version**: el `User` queda
  `active` de inmediato, igual que los usuarios seed -- ningun OTP, magic
  link, ni envio de correo.
- **Password**: reutiliza integramente `hashPassword`/`verifyPasswordHash`
  ya existentes (`auth/password-hashing.ts`, scrypt) -- A1 no crea un
  segundo mecanismo de hashing. Politica minima nueva (no existia
  ninguna): 8-128 caracteres, sin reglas de complejidad inventadas.
  Backend es la autoridad final; frontend valida temprano con la misma
  politica.
- **Email**: misma normalizacion que login (trim + lowercase) mas
  validacion de formato (login no la necesita porque un email invalido
  simplemente no matchea ningun usuario existente; register si debe
  rechazar un formato invalido antes de crear la cuenta).
- **Email duplicado**: `409` seguro, nunca crea un segundo `User`, nunca
  filtra `P2002`/detalle de Prisma. Cubre tanto el caso comun (pre-check
  antes de hashear password) como la carrera real de dos registros
  concurrentes con el mismo email (constraint de DB como autoridad final,
  mapeada de forma segura).
- **Creacion atomica**: `User.create` + `AuthCredential.create` en una
  sola `$transaction` -- nunca un `User` sin `AuthCredential` ni viceversa.
- **Auto-login reutilizando el mecanismo real, nunca uno paralelo**:
  `register()` devuelve exactamente el mismo shape (`AuthLoginResponseDto`)
  que `login()`, firmado con el mismo `JwtService`/secret/expiration/
  claims. El frontend (`SessionProvider.register`) reutiliza integramente
  el flujo de `login` (mismo adapter, mismo `SessionStore`, mismo
  `resolveSession` via `GET /auth/me`) -- nunca hace una segunda llamada a
  `POST /auth/login` con la password, nunca un segundo tipo de sesion.
- **`User.did` queda `null` al registrarse -- decision consciente, no un
  descuido**: auditoria completa en `auth-and-permissions-v0.md` seccion
  2.3. Resumen: `createDraft` nunca exige `did`; `issueCredential` si lo
  exige (unico punto real del repo); no existe ningun mecanismo canonico
  de provisioning de DID -- los DID existentes son literales hardcodeados
  en seeds. A1 NO inventa un esquema `did:...` nuevo. Un holder
  auto-registrado puede: autenticarse, ver su wallet/perfil vacios sin
  error, y ser destinatario de un draft de credencial. Queda bloqueado
  unicamente en el paso final de emision (`issueCredential`) hasta que se
  diseñe conscientemente un mecanismo de DID -- decision pendiente
  documentada, no oculta dentro de auth.
- **Wallet/perfil inicial**: una wallet sin `Credential` y un perfil
  inexistente son el contrato real ya existente (`findMany`/
  `findFirst` con cero coincidencias), no un caso especial que A1 deba
  construir -- nunca se crea un `FormativeProfile` artificial al
  registrarse.
- **DTO de request allowlisted por lectura de campos, no por decorators**:
  igual que `LoginDto`, `RegisterDto` no usa `class-validator` (no hay
  `ValidationPipe` global en el repo) -- `AuthService.register` lee
  unicamente `dto.email`/`dto.password` campo a campo, nunca hace spread
  del body. Cualquier campo extra (`role`, `issuerId`, `did`, `isAdmin`,
  etc.) que un cliente mande queda ignorado sin excepcion ni efecto sobre
  privilegios.
- **`POST /auth/register` es publico**: sin `@UseGuards(AuthGuard)`, igual
  que `login`. Ningun otro endpoint pierde proteccion por esta feature.
- Pendiente, explicitamente fuera de alcance de A1: verificacion de email,
  recuperacion/cambio de password, MFA, OAuth, CAPTCHA, seleccion de rol
  durante el registro, onboarding institucional, edicion de perfil,
  provisioning de DID (ver arriba), refresh tokens.

## 26. A1.1 — Identidad humana del titular: nombre en registro + holder + presentacion de credenciales

A1 dejo `POST /auth/register` sin ningun dato de identidad humana --
CASO A confirmado por auditoria: `User.firstName`/`lastName`/`displayName`
YA EXISTIAN en `schema.prisma` (nunca hizo falta elegir entre `User` y un
modelo `Person`/`Profile` separado, ni migracion nueva).

- **Fuente canonica unica**: `User.firstName`/`User.lastName` (obligatorios
  desde `register`) + `User.displayName` (nunca escrito por register,
  reservado para seeds/herramientas futuras). Proyeccion de presentacion
  SIEMPRE via el helper YA EXISTENTE `buildHolderDisplayLabel` (`services/api/src/issuers/holder-display-label.ts`)
  -- prioridad `displayName` > `firstName+lastName` > solo uno de los dos >
  `email` > fallback fijo. Nunca una segunda implementacion de
  concatenacion de nombre con reglas propias en ningun lugar nuevo que A1.1
  toco (`AuthService`, `MeService`).
- **Validacion de nombre sin restriccion cultural**: string no vacio (tras
  trim + colapso de espacios), longitud maxima 100 -- sin exigir ASCII,
  mayuscula inicial, ni prohibir acentos/apostrofes/guiones. "José",
  "María José", "O'Connor", "Jean-Pierre" son validos por diseño, tanto en
  el backend (`AuthService.assertValidRegistrationName`) como en la
  validacion temprana del frontend (mismos limites).
- **`POST /auth/register` pide nombre + apellido**: `RegisterDto` gana
  `firstName`/`lastName` obligatorios. Igual que `email`/`password`, el
  backend los lee campo a campo (nunca spread del body) -- `displayName`,
  `role`, `issuerId`, `did`, `status`, `isAdmin` etc. enviados por un
  cliente siguen sin tener ningun efecto.
- **`displayLabel` en la respuesta de auth, nunca los campos crudos**:
  `AuthUserResponseDto` (compartido por login/register/`/auth/me`) gana
  `displayLabel: string` -- siempre presente (cae a email si no hay
  nombre), nunca `firstName`/`lastName` sueltos en esa respuesta.
- **El nombre nunca es identificador tecnico**: la asociacion
  Credential↔holder sigue siendo exclusivamente
  `Credential.subjectUserId` -- confirmado que ni `credentialSubject` ni
  ningun campo de `Credential` almacena nombre humano. Dos `User`
  homonimos siguen siendo perfectamente distinguibles porque ninguna
  resolucion real (login, `IssuerHolderResolutionService.resolveHolder`,
  creacion de draft) pasa por el nombre -- `email` es el unico canal de
  busqueda humano-amigable, `userId`/`subjectUserId` el vinculo interno
  estable, `did` la identidad tecnica pendiente de A2. Nunca se usa el
  nombre para generar IDs ni para derivar DID.
- **Sin snapshot historico de nombre en Credential**: auditado --
  `Credential`/`credentialSubject` nunca copian el nombre del titular al
  emitir. Toda vista que muestra "Titular: ..." (issuer, holder, `/verify`,
  perfil publico) resuelve el nombre EN VIVO desde el `User` actual via
  `subjectUserId`. Si el `User` cambiara de nombre en el futuro (edicion de
  perfil, fuera de alcance de A1.1), todas esas vistas reflejarian el
  cambio de inmediato -- no existe (ni A1.1 introduce) ninguna semantica de
  "nombre congelado al momento de emision".
- **Correccion de asimetria holder vs. issuer**: `MeService.getCredentialForUser`
  (el holder viendo su PROPIA credencial) no combinaba `firstName`/
  `lastName` -- solo pasaba `displayName` crudo, a diferencia de
  `issuer-credential-read.mapper.ts` (la vista del issuer de la misma
  credencial), que ya usaba `buildHolderDisplayLabel`. A1.1 corrige esa
  asimetria reusando el mismo helper -- self-view, sin riesgo de privacidad
  nuevo.
- **Header de identidad compartido**: `AccountMenu`/`WalletShell`/
  `ContextShell`/`IssuerShell` mostraban el email crudo del usuario
  autenticado en toda pantalla protegida (holder e issuer por igual).
  Ahora muestran `currentUser.displayLabel` -- mismo componente
  compartido, mejora identica para ambos roles, sin rediseño.
- **Privacidad publica: sin ampliacion, con hallazgo documentado**:
  `GET /verify/credentials/:credentialId` y `GET /share/profile/:token` YA
  exponian un `holder.displayLabel` (nombre, sin fallback a email) ANTES
  de A1/A1.1 -- A1.1 audito ambos casos y NO los toco (contrato intacto).
  Lo que cambia en la practica es que, al no existir antes ningun flujo
  que pidiera nombre a un holder self-registrado, ese campo publico casi
  siempre devolvia `null`; desde A1.1 puede devolver un nombre real. Ver
  `auth-and-permissions-v0.md` seccion 2.4 para el detalle completo -- es
  una activacion de exposicion ya diseñada, no una ampliacion de
  superficie nueva, pero queda documentada para revision consciente de
  producto.
- **`FormativeProfile` no se toca**: `profileJson`/areas/skills/concepts/
  provenance semantica nunca incorporan `firstName`/`lastName` -- la
  identidad humana vive exclusivamente en la proyeccion holder/auth
  correspondiente.
- **Legacy sin romper**: un `User` con `firstName`/`lastName`/`displayName`
  `null` (cualquier cuenta creada antes de A1.1, incluidos los usuarios
  seed y los registrados via A1 antes de este slice) sigue autenticando y
  operando con normalidad -- `buildHolderDisplayLabel` cae a `email` sin
  fabricar ningun nombre falso. Ningun backfill masivo de nombres.
- Pendiente, explicitamente fuera de alcance de A1.1: provisioning de DID
  (A2); edicion de nombre/perfil; verificacion legal de identidad (DNI,
  fecha de nacimiento, telefono, direccion, genero, avatar, username
  publico -- ninguno se agrego); consentimiento/copy adicional en
  `/register` sobre la exposicion publica preexistente via `/verify`/
  `/share` (hallazgo documentado, decision de producto pendiente); unificar
  las 3 implementaciones de "combinar nombre" que hoy coexisten
  (`holder-display-label.ts` compartido, y las mini-versiones privadas en
  `verification.service.ts` y `profile-sharing.service.ts`, cada una con
  su propia regla de fallback a email por razones de privacidad
  deliberadas -- unificarlas exigiria una decision de diseño aparte).

## 27. A2.1 — Provisioning canonico de DID para holders (did:web)

Decision arquitectonica cerrada en A2.0
(`docs/decisions/0015-holder-did-method.md`), implementada en A2.1.

- **Metodo**: `did:web`, platform-managed. El holder nunca posee ni opera
  una clave privada; Traza es el unico controlador. Nunca se usa lenguaje
  de "identidad autosoberana" -- seria falso dado que no hay ninguna clave
  del holder involucrada.
- **Forma**: `did:web:<host>:did:users:<userId>`, resoluble en
  `https://<host>/did/users/<userId>/did.json`. `<host>` proviene
  exclusivamente de `PUBLIC_DID_BASE_URL` (nunca del `Host` header, nunca
  de `NEXT_PUBLIC_API_URL`, nunca inferido en tiempo de lectura).
  `<userId>` es siempre `User.id` -- nunca `firstName`/`lastName`/
  `displayName`/`email`. Cambiar nombre o email de un `User` nunca cambia
  su DID.
- **Write-once**: `User.did` no-null nunca se recalcula ni se
  sobreescribe. Ni un cambio de `PUBLIC_DID_BASE_URL`, ni un retry, ni una
  emision posterior, ni una condicion de carrera pueden reemplazar un DID
  ya persistido. Concurrencia resuelta mediante UPDATE condicional
  (`WHERE did IS NULL`) + relectura del valor realmente persistido por
  quien pierde la carrera -- nunca dos DIDs logicos para el mismo `User`,
  nunca overwrite.
- **Cuando se provisiona**: automaticamente en `POST /auth/register`
  (dentro de la misma transaccion atomica que crea `User`+
  `AuthCredential` -- si el provisioning falla por configuracion invalida,
  toda la transaccion se revierte, nunca queda una cuenta a medio crear) y
  de forma perezosa en `issueCredential` para holders legacy con
  `did = null`. En ambos casos, unica implementacion compartida:
  `ensureDidForUser` (`services/api/src/identity/ensure-did-for-user.ts`).
- **Orden de side effects en emision**: el provisioning perezoso ocurre
  DESPUES de superar autenticacion, membership del issuer, rol y estado
  `authorized` del issuer -- nunca antes. Una emision que de todas formas
  iba a ser rechazada nunca tiene el side effect de tocar `User.did`.
- **Sin PUBLIC_DID_BASE_URL configurada**: comportamiento identico a
  A1/A1.1 en todo -- `register` sigue creando el `User` con `did: null`,
  `issueCredential` sigue rechazando con el mismo
  `BadRequestException` ya existente. Nunca se inventa un DID falso ni se
  trata una configuracion ausente distinto de una configuracion invalida
  (invalida = falla clara, nunca silenciosa).
- **DID Document minimo**: `{ "@context": "https://www.w3.org/ns/did/v1", "id": "..." }`,
  sin `verificationMethod` -- respaldado por chequeo normativo contra W3C
  DID Core 1.0 (`verificationMethod` es `OPTIONAL`; la unica propiedad
  requerida del modelo de datos es `id`) documentado en ADR 0015. Sin PII:
  nunca email/nombre/apellido/displayName/status/credenciales.
- **Resolver publico**: `GET /did/users/:userId/did.json`, sin
  `@UseGuards`, exclusivamente de lectura -- nunca provisiona, nunca muta
  `User`. `User.did` es la unica autoridad: el resolver nunca recalcula
  contra la configuracion actual ni transforma silenciosamente un
  `did:example` de seed, un `did` nulo, o un DID de otro `userId` en un
  documento inventado -- responde `404` en esos casos.
- **`Credential` no snapshotea el DID de emision**: dado el invariante
  write-once, el DID leido hoy de `User` es, por construccion, el mismo
  que participo en el `canonicalHash` de cualquier Credential ya emitida
  a ese holder. No se agrega `subjectDidAtIssuance` ni ningun otro campo
  nuevo a `Credential`. Si en el futuro se permite rotar el DID de un
  holder, esta garantia deja de sostenerse y debera reconsiderarse.
- **`canon_v1` sin cambios**: A2.1 solo garantiza que
  `subjectUser.did` tenga un valor antes de canonizar -- el DID sigue
  participando en el hash exactamente donde ya participaba (no se agrega
  ningun campo nuevo al proyecto canonico por A2.1).
- **`Issuer.did` fuera de alcance**: issuer y holder pueden evolucionar
  con metodos DID distintos; A2.1 no toca `Issuer.did` ni el flujo de
  autorizacion institucional.
- **Migracion de host**: un DID provisionado bajo un host queda fijo a ese
  host para siempre, aunque `PUBLIC_DID_BASE_URL` cambie despues. Si en el
  futuro se migra de dominio, la resolucion de DIDs historicos es
  responsabilidad de infraestructura (mantener el host anterior resolviendo)
  o de una migracion explicita en un slice futuro -- A2.1 no la resuelve.

## 28. P1.1 — Lifecycle automatico de FormativeProfile (baseline post-issuance + fallback holder)

Auditoria previa (P1, `p1-formative-profile-lifecycle-audit-review-bundle.txt`,
gitignored) confirmo CASO B -- gap de lifecycle: `issueCredential` nunca
disparaba ningun rebuild de perfil; el unico rebuild automatico dependia
del exito de un analisis de IA (documental o textual), estructuralmente
excluido para `academic_subject` sin PDF. P1.1 cierra ese gap.

- **Baseline post-issuance**: `IssuerCredentialIssueService.issueForIssuer`
  llama `AutomaticProfileRebuildService.rebuildAfterIssuance({ credentialId,
  holderUserId })` inmediatamente despues de que
  `CredentialsService.issueCredential` commitea, AWAITED, ANTES de
  intentar `AutomaticDocumentAnalysisService`/
  `AutomaticCourseTextAnalysisService` -- nunca en paralelo con esos dos
  pasos, para que un rebuild enriquecido posterior (si un analisis
  automatico completa) nunca corra una carrera contra el baseline y
  termine dejando `isCurrent` una generacion mas vieja.
  `FormativeProfileService.rebuildForUser` ya seleccionaba TODAS las
  Credential `issued` del holder sin exigir `SemanticAnalysis` (ver
  seccion 6, `FormativeProfile.isCurrent`) -- P1.1 no cambia esa logica,
  solo agrega el trigger que faltaba.
- **holderUserId siempre es `Credential.subjectUserId`**, tomado
  directamente de la respuesta de `issueCredential` (`CredentialSummaryResponseDto.subjectUserId`,
  sin lectura extra) -- NUNCA `currentUser.id` (el issuer admin/operator
  que ejecuta la emision). Confirmado por test dedicado que usa un actor y
  un holder deliberadamente distintos.
- **Best-effort, nunca bloqueante**: si el baseline falla, la emision
  sigue `issued`, la respuesta HTTP sigue exitosa, y los pasos de analisis
  automatico posteriores igual se intentan (son independientes). El
  rebuild NUNCA ocurre dentro de la transaccion de `issueCredential` --
  esa transaccion sigue conteniendo unicamente el update de `Credential`
  y el `create` de `BlockchainRecord`, sin IA ni I/O de red.
  `CredentialsService` sigue sin conocer `FormativeProfileService` --
  la orquestacion post-issuance vive exclusivamente en
  `IssuerCredentialIssueService`, igual que los 2 pasos de analisis
  automatico preexistentes.
- **`AutomaticProfileRebuildService` refactorizado, sin romper
  call-sites**: `rebuildBestEffort({ holderUserId, credentialId?, reason,
  analysisRunId? })` es ahora la unica implementacion (try/catch, log
  seguro). Tres wrappers explicitos delegan en ella sin duplicar logica:
  `rebuildAfterIssuance` (P1.1, reason `post_issuance`),
  `rebuildAfterAutomaticAnalysis` (C2b.4, sin cambios de firma/
  comportamiento para sus call-sites existentes, reason
  `post_automatic_analysis`), y `rebuildAfterReviewedInterpretationApply`
  (C5b.1 -- `ReusableSemanticInterpretationService` ahora llama este
  wrapper en vez de `rebuildAfterAutomaticAnalysis`, porque un apply de
  interpretacion revisada nunca fue realmente "un analisis automatico";
  el `reason` solo sirve para observabilidad/logs, nunca cambia
  comportamiento ni persistencia). El log de fallo
  (`automatic_profile_rebuild_failed`) ahora incluye `reason`.
- **Doble rebuild es esperado y correcto** para una Credential elegible
  para IA: el baseline crea una generacion, y si el analisis automatico
  completa despues, el rebuild enriquecido crea una generacion nueva que
  reemplaza `isCurrent` -- nunca se intenta "optimizar" evitando el
  segundo rebuild. `rebuildForUser` sigue garantizando exactamente un
  `isCurrent=true` por holder (ver seccion 6).
- **`academic_subject` sin PDF y `course` sin contenido analizable YA
  obtienen un `FormativeProfile`** inmediatamente tras la emision -- el
  baseline nunca depende de elegibilidad de tipo, disponibilidad de PDF,
  contenido declarado suficiente, ni de que el servicio de IA responda.
  Esto cierra directamente el caso observado en la auditoria P1 (holder
  con 2 `academic_subject` + 1 `course` sin `currentProfile`).
- **`POST /me/profile/share` sin cambios**: sigue exigiendo unicamente
  que exista un `currentProfile` -- nunca un minimo de credenciales,
  skills, horas ni analisis. Con el baseline, la primera Credential
  emitida ya habilita compartir, como consecuencia natural, no por logica
  nueva en `ProfileSharingService`.
- **Revocacion -- NO implementado, gap distinto documentado
  explicitamente**: P1.1 audito `services/api/src` completo buscando el
  call-path real de revocacion de una `Credential` y confirmo que NO
  EXISTE ningun endpoint, controller ni service que transicione una
  Credential a `CredentialStatus.revoked` hoy. El unico archivo
  relacionado, `blockchain/scripts/revoke-credential-on-registry.ts`, es
  un script CLI que solo llama al contrato on-chain (`CredentialRegistryWriteClient.revokeCredential`)
  y nunca escribe Prisma. `CredentialStatus.revoked` solo aparece como
  fixture en tests, nunca como resultado real de un flujo de produccion.
  Por lo tanto P1.1 NO agrega un rebuild post-revocacion (no hay ningun
  call-site real donde engancharlo) y NO inventa un endpoint de
  revocacion nuevo -- seria un slice completo aparte (autorizacion,
  orquestacion on-chain/off-chain, DTOs, contrato HTTP), fuera del
  alcance explicito de este slice. Cuando ese feature exista, debera
  llamar `AutomaticProfileRebuildService.rebuildBestEffort({ holderUserId,
  credentialId, reason: <nuevo valor de ProfileRebuildReason> })`
  siguiendo exactamente el mismo patron best-effort documentado aca --
  nunca dentro de la transaccion de revocacion, siempre con el
  `subjectUserId` de la Credential revocada, nunca el actor.
  `rebuildForUser` ya excluye credenciales no-`issued` de forma natural
  (seccion 6) -- ese feature futuro no necesitaria logica especial de
  "restar" nada.
- **Fallback manual conectado, nunca la via principal**:
  `POST /me/profile/rebuild` (ya existente, sin cambios de contrato) ahora
  tiene un consumidor real en `apps/web` -- una accion "Actualizar
  perfil" (`ProfileRebuildAction`), discreta junto a "Compartir perfil"
  cuando ya existe un `currentProfile`, y como accion de recuperacion
  dentro del empty state cuando el holder tiene Credentials `issued` pero
  `currentProfile === null` (holder legacy afectado por el gap historico,
  o baseline que fallo). Nunca se ofrece si el holder no tiene ninguna
  Credential -- el empty state simple alcanza en ese caso. El copy del
  empty state se corrigio: ya no implica que el perfil espera
  "informacion analizable" para existir.

## 29. R2 — Course draft no guardaba competencias/contenido + save-before-issue

Bug real reportado en demo: un `course` draft con "Competencias" y
"Contenido e información adicional" (`learningOutcomes`, relabeled en la
UI para `course`) completos con texto realista fallaba al guardar con
`400`. Auditoria (`final-r2-course-draft-save-fix-review-bundle.txt`,
gitignored) confirmo la causa exacta:

- **Root cause**: `CONTROLLED_ARRAY_ITEM_MAX_LENGTH` (compartido por
  `skills`/`competencies`/`learningOutcomes` en
  `issuer-credential-draft-update.validator.ts`, reusado tambien por
  `issuer-course-templates.validator.ts`) era `80` caracteres por
  elemento -- calibrado para tags cortos (`skills`/`competencies` de
  `academic_subject`, ej. "TypeScript", "modelado de datos"), pero
  incompatible con `learningOutcomes` de `course`, cuya UI invita
  explicitamente contenido/temario mas largo por linea ("Agregá
  contenidos, temario, herramientas, conocimientos abordados u otra
  información relevante del curso"). Cualquier oracion realista supera
  80 caracteres, disparando `BadRequestException` (400) en TODO el PATCH
  -- no solo se perdia ese campo, se perdian TODOS los campos editados
  en el mismo request. **Fix**: subido a `500` caracteres por elemento
  (un unico limite compartido, sin distincion por tipo/campo -- ver
  seccion 11 arriba, actualizada). `CONTROLLED_ARRAY_MAX_ITEMS` (30) no
  cambio -- sin evidencia de que fuera un problema real.
- **NO era un bug de mapper/DTO/service** -- el frontend (`linesToStringArray`/
  `buildDraftUpdateCommand`) y el backend (persistencia en
  `credentialSubject`, merge de campos) ya funcionaban correctamente; el
  unico punto de falla era el limite de longitud en el validador.

**R2 tambien simplifica la UX de guardado — save-before-issue**:

- "Guardar cambios" (persistir el draft sin emitir) y "Emitir credencial"
  (transicionar a `issued`) siguen siendo DOS acciones distintas y
  deliberadamente separadas -- no son "casi lo mismo" (una persiste
  progreso sin comprometer la credencial, la otra es irreversible). Se
  evaluo eliminar "Guardar cambios" (seccion 13 del diseno aprobado) y se
  decidio conservarlo: sigue siendo la unica forma de guardar progreso
  sin emitir todavia.
- Lo que SI cambio: `CredentialDraftEditorForm` expone un handle
  imperativo (`CredentialDraftEditorFormHandle.flush()`) que
  `CredentialDetailView` invoca automaticamente ANTES de ejecutar
  `onIssue` real -- si el usuario tiene ediciones sin guardar (o campos
  localmente invalidos) y presiona "Emitir credencial" directamente
  (sin haber presionado antes "Guardar cambios"), esas ediciones se
  persisten primero, usando EXACTAMENTE la misma funcion de guardado
  (`performSave`) que "Guardar cambios" -- nunca un segundo mapper/
  payload. Si no hay cambios pendientes, `flush()` es un no-op (no
  dispara ningun request).
- **Invariante fuerte**: si ese guardado automatico falla (validacion
  local o error de backend), `onIssue` NUNCA se llama -- la emision
  jamas procede con una version stale o invalida del borrador. El error
  se muestra en el propio editor de borrador (mismo feedback que un
  "Guardar cambios" fallido); el usuario puede corregir y reintentar sin
  haber perdido nada.
- **Nunca autosave por tecla** -- `flush()` solo se dispara por una
  accion explicita del usuario (presionar "Guardar cambios" o "Emitir
  credencial"), nunca por un debounce en cada cambio de input.
- Sin cambios de contrato HTTP: `flush()` reusa el mismo
  `PATCH .../draft` que ya existia; no se agrego ningun endpoint nuevo.

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
- arrays controlados usan hasta 30 strings de hasta 80 caracteres;
- `completion_date` y `expiration_date` son fechas reales `YYYY-MM-DD`, y la
  expiracion no puede ser anterior a la finalizacion;
- toda actualizacion sigue siendo exclusiva de `draft` y participa del CAS
  atomico por `updatedAt`.

Aplicabilidad:

| Tipo | Campos especificos |
| --- | --- |
| `academic_subject` | `completion_date`, `academic_period`, `program_name`, `grade`, `skills`, `competencies` |
| `course` | `completion_date`, `provider_name`, `platform_name`, `modality`, `level`, `skills`, `competencies`, `learning_outcomes` |
| `certification` | `completion_date`, `certification_code`, `expiration_date`, `external_url`, `provider_name`, `level`, `skills`, `competencies` |
| `degree` | `completion_date`, `program_name`, `level`, `grade`, `competencies`, `learning_outcomes` |

Estas reglas no representan readiness ni requisitos suficientes de emision.
Los campos `program_name`, `provider_name`, `platform_name`, `modality`,
`level`, `certification_code`, `expiration_date`, `external_url` y
`learning_outcomes` no participan actualmente en `canon_v1`. Antes de P7 debe
decidirse si permanecen como metadata no canonica o requieren una nueva
version de canonicalizacion.

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

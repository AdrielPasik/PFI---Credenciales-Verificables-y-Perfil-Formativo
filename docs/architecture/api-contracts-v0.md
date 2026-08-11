# Contratos API v0

> Este documento define contratos HTTP iniciales por dominio. No implica implementacion de controllers ni OpenAPI ejecutable.

## Estados de implementacion

- `future`: documentado, fuera de la primera implementacion.
- `mock`: esperable como stub o contrato compatible antes de la logica final.
- `v1_candidate`: candidato directo a una primera version implementable.

## 1. Identity / Users

### `GET /auth/me`

- Proposito: devolver identidad y contexto basico del usuario autenticado.
- Actor: `holder`, `issuer_admin`, `system_admin`.
- Request conceptual: token de sesion o auth bearer.
- Response conceptual: usuario autenticado y memberships activas. Cada
  membership incluye `issuerId`, `issuerName`, `issuerDid`,
  `issuerAuthorizationStatus`, `role` y `status`.
- Errores esperados: `401 unauthorized`.
- Estado: implementado, demo-grade.

### `GET /users/:id`

- Proposito: consultar datos basicos de un usuario por id segun permisos.
- Actor: `holder`, `system_admin`.
- Request conceptual: path `id`.
- Response conceptual: resumen de usuario sin datos sensibles innecesarios.
- Errores esperados: `401`, `403`, `404`.
- Estado: `future`.

### `GET /users/:id/credentials`

- Proposito: listar credenciales visibles para un usuario.
- Actor: `holder`, `system_admin`.
- Request conceptual: path `id`, filtros por `status` o `type`.
- Response conceptual: lista resumida de credenciales.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

### `GET /users/:id/profile`

- Proposito: consultar el perfil formativo consolidado.
- Actor: `holder`, `system_admin`.
- Request conceptual: path `id`.
- Response conceptual: `formative_profile_v1`.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

## 2. Issuers

### `GET /issuers`

- Proposito: listar emisores registrados.
- Actor: `issuer_admin`, `system_admin`, `verifier`.
- Request conceptual: filtros por estado o nombre.
- Response conceptual: lista resumida de emisores.
- Errores esperados: `401`, `403`.
- Estado: `v1_candidate`.

### `POST /issuers`

- Proposito: registrar un emisor en el sistema.
- Actor: `system_admin`.
- Request conceptual: nombre institucional, did, wallet address y metadata basica.
- Response conceptual: emisor creado.
- Errores esperados: `400 validation_error`, `409 duplicate`, `403`.
- Estado: `future`.

### `GET /issuers/:id`

- Proposito: consultar detalle de un emisor.
- Actor: `issuer_admin`, `system_admin`, `verifier`.
- Request conceptual: path `id`.
- Response conceptual: resumen institucional y estado de autorizacion.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

### `POST /issuers/:issuerId/holders/resolve`

- Proposito: resolver un titular elegible por igualdad exacta de email dentro
  de un contexto institucional autorizado.
- Actor: usuario autenticado con membership `active`, rol `admin` u
  `operator` e issuer `authorized`.
- Request: JSON `{ "email": "holder.demo@example.com" }`.
- Response `200 OK`: `{ id, email, did, displayLabel }`; `did` puede ser
  `null`.
- Privacidad: no lista usuarios, no realiza busqueda parcial, no refleja el
  email en errores y usa el mismo `404` para usuario inexistente o inactivo.
- Efectos: operacion read-only; el `id` se usa luego como `subjectUserId`
  command-only.
- Errores esperados: `400`, `401`, `403`, `404`.
- Estado: `implemented`.

### `GET /issuers/:issuerId/catalog/academic-subjects`

- Proposito: buscar asignaturas activas del catalogo institucional por codigo
  o nombre oficial.
- Actor: usuario autenticado con membership `active`, rol `admin` u
  `operator` e issuer `authorized`.
- Query params: `query` opcional con trim y `limit` opcional, default `20`,
  rango `1..50`.
- Scoping: la autorizacion institucional ocurre antes de consultar
  `AcademicCourse`; la busqueda filtra siempre por `issuerId` y
  `status = active`.
- Orden: `code asc`, luego `name asc`.
- Response `200 OK`:

```json
{
  "items": [
    {
      "academicCourseReference": "internal-command-reference",
      "code": "3.4.213",
      "name": "Ingenieria de Datos II",
      "description": null,
      "hours": null
    }
  ]
}
```

- Allowlist: no devuelve `issuerId`, `metadata`, programas, versiones
  curriculares ni relaciones internas. `academicCourseReference` es una
  referencia command-only.
- Errores esperados: `400`, `401`, `403`.
- Estado: `implemented` en P3.1a.

### `GET /issuers/:issuerId/catalog/academic-programs`

- Proposito: buscar programas activos por codigo institucional o nombre.
- Actor y scoping: mismo contexto institucional autorizado que el catalogo
  plano; filtra `Program.issuerId`, `Program.status = active` y exige una
  `CurriculumVersion` activa.
- Query params: `query` opcional y `limit` default `20`, rango `1..50`.
- Orden: `programCode asc`, `programName asc` y referencia como desempate.
- Response `200 OK` allowlisted:

```json
{
  "items": [
    {
      "programReference": "internal-command-reference",
      "programCode": "1621",
      "programName": "Ingenieria en Informatica",
      "curriculumReference": "internal-command-reference",
      "curriculumCode": "1621"
    }
  ]
}
```

- No devuelve `issuerId`, metadata ni objetos Prisma.
- Estado: `implemented` en P3.1b.

### `GET /issuers/:issuerId/catalog/curriculum-versions/:curriculumReference/academic-subjects`

- Proposito: buscar asignaturas activas vinculadas a una version curricular
  activa del issuer autorizado.
- Scoping: autoriza antes de buscar; una curricula inexistente, inactiva o de
  otro issuer produce el mismo `404`. Solo devuelve `ProgramCourse` de esa
  curricula cuyo `AcademicCourse` pertenece al mismo issuer y esta activo.
- Query params y limites: iguales al catalogo plano.
- Orden: codigo y nombre de materia, con referencia interna como desempate.
- Response `200 OK` allowlisted:

```json
{
  "items": [
    {
      "academicCourseReference": "internal-command-reference",
      "code": "3.4.213",
      "name": "Ingenieria de Datos II",
      "description": null,
      "hours": null,
      "programReference": "internal-command-reference",
      "programCode": "1621",
      "programName": "Ingenieria en Informatica",
      "curriculumReference": "internal-command-reference",
      "curriculumCode": "1621"
    }
  ]
}
```

- Estado: `implemented` en P3.1b.

### `GET /issuers/:issuerId/credentials/:credentialId`

- Proposito: leer una credencial dentro de un contexto institucional
  autenticado y autorizado.
- Actor: usuario autenticado con membership `active`, rol `admin` u
  `operator` e issuer `authorized`.
- Scoping: primero valida el contexto institucional y luego busca por
  `credentialId + issuerId`. Una credencial inexistente y una credencial de
  otro issuer producen el mismo `404`.
- Response `200 OK`:

```json
{
  "id": "credential-resource-reference",
  "status": "draft",
  "type": "course",
  "title": "Arquitectura de Software",
  "description": "Descripcion opcional",
  "hours": "24.50",
  "sourceType": "manual_issuer",
  "credentialSubject": {
    "achievement_name": "Arquitectura de Software",
    "institution_name": "Nombre guardado en el draft",
    "completion_date": "2026-07-30",
    "academic_period": null,
    "program_name": null,
    "grade": null,
    "provider_name": "Traza Academy",
    "platform_name": "Campus",
    "modality": "Hibrida",
    "level": "Avanzado",
    "certification_code": null,
    "expiration_date": null,
    "external_url": null,
    "skills": ["TypeScript"],
    "competencies": ["Diseno de sistemas"],
    "learning_outcomes": ["Construir APIs"]
  },
  "createdAt": "2026-07-30T12:00:00.000Z",
  "updatedAt": "2026-07-30T12:05:00.000Z",
  "issuedAt": null,
  "canonicalHash": null,
  "canonicalizationVersion": null,
  "blockchainEvidence": null,
  "issuer": {
    "displayName": "Demo University",
    "did": "did:example:issuer-demo"
  },
  "holder": {
    "displayLabel": "Demo Holder",
    "email": "holder.demo@example.com",
    "did": null
  },
  "academicCourse": {
    "academicCourseReference": "internal-command-reference",
    "code": "3.4.213",
    "name": "Ingenieria de Datos II",
    "description": null,
    "hours": null,
    "program": {
      "programReference": "internal-command-reference",
      "programCode": "1621",
      "programName": "Ingenieria en Informatica",
      "curriculumReference": "internal-command-reference",
      "curriculumCode": "1621"
    }
  },
  "documentEvidence": {
    "currentDocument": null
  },
  "textEvidence": {
    "currentText": null
  }
}
```

- Nullability: `description`, `hours` y los campos string de
  `credentialSubject` pueden ser `null`; sus tres arrays siempre se devuelven
  como `string[]`. `issuer.did`, `holder.email` y `holder.did` tambien pueden
  ser `null`. `hours` se serializa como decimal string cuando existe.
  `academicCourse` es `null` cuando no hay vinculacion; su `description` y
  `hours` tambien son nullables. `academicCourse.program` es `null` para una
  seleccion plana y contiene el contexto curricular allowlisted cuando fue
  seleccionado explicitamente.
  `documentEvidence.currentDocument` siempre existe en la forma de respuesta y
  es `null` cuando no hay evidencia vigente. Cuando existe, contiene solo la
  referencia publica, tipo, estado, nombre visible, MIME canonico, tamano,
  SHA-256 documental y fecha de upload.
  `textEvidence.currentText` tambien existe siempre y es `null` cuando no hay
  fuente textual vigente. Cuando existe, contiene solo referencia, estado,
  label nullable, contenido, conteo de caracteres, SHA-256 textual y fecha.
  `issuedAt`, `canonicalHash`, `canonicalizationVersion` y
  `blockchainEvidence` son `null` antes de emitir. El ultimo registro se elige
  por `registeredAt desc` e `id desc` y expone solo `network`, `chainId`,
  `txHash`, `status` y `registeredAt`.
- Identidad institucional: `issuer.displayName` proviene de `Issuer.name`;
  `credentialSubject.institution_name` es solamente el dato guardado en la
  credencial y puede diferir.
- Holder historico: la lectura no exige que el usuario titular siga activo.
- Allowlist: no devuelve `issuerId`, `subjectUserId`, datos de autenticacion,
  wallet, metadata, rawData, payload canonico, direcciones de contrato o
  signer, RPC/provider, registros blockchain completos, analisis, eventos ni
  grants.
- Errores esperados: `401` sin autenticacion valida, `403` sin contexto
  institucional operativo y `404` para credencial inexistente o de otro
  issuer.
- Diferencia con `GET /credentials/:id`: este read model es issuer-facing,
  protegido y minimizado. El endpoint generico anterior conserva por ahora su
  comportamiento para compatibilidad tecnica y no es el endpoint publico
  final del verificador.
- Estado: `implemented`.

### `POST /issuers/:issuerId/credentials/:credentialId/issue`

- Proposito: emitir una credencial dentro del contexto institucional seguro y
  devolver el read model issuer-facing actualizado.
- Autorizacion: JWT, usuario activo, membership `active`, rol `admin` u
  `operator` e issuer `authorized` antes del lookup scoped.
- Request: sin body autoritativo. `issuerId` y `credentialId` provienen solo
  del path; identidad del actor proviene de `CurrentUser`.
- Scoping: valida `credentialId + issuerId`; credencial inexistente o de otro
  issuer devuelve el mismo `404`.
- Dominio: reutiliza `CredentialsService.issueCredential`; conserva los
  requisitos de estado `draft`, DID del holder, DID/wallet del issuer,
  canonizacion y registro de evidencia configurado.
- Response `200 OK`: el mismo read model issuer-facing de GET, ya con estado,
  fecha, hash canonico, version y evidencia tecnica cuando la transaccion se
  completa.
- Errores: conserva `400`, `401`, `403`, `404` y `409` de dominio. Un fallo
  inesperado de hashing/transporte/blockchain se devuelve como `502`
  sanitizado.
- No expone body malicioso, payload canonico, secretos, RPC, signer, storage
  ni artifacts IA.
- Estado: `implemented` en P6a-1.

### `POST /issuers/:issuerId/credentials/:credentialId/evidence/documents`

- Proposito: adjuntar o reemplazar la evidencia documental vigente de una
  credencial `draft` dentro del contexto institucional autorizado.
- Actor: usuario autenticado con membership `active`, rol `admin` u `operator`
  e issuer `authorized`.
- Request: `multipart/form-data` con exactamente un campo archivo llamado
  `file`; no acepta metadata adicional.
- Formatos: PDF, PNG y JPEG, detectados por firma de bytes y normalizados a
  `application/pdf`, `image/png` o `image/jpeg`.
- Limite: 20 MB.
- Response `201 Created`:

```json
{
  "evidenceReference": "safe-reference",
  "kind": "pdf",
  "status": "current",
  "originalFileName": "programa.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 123456,
  "sha256": "64-lowercase-hex-characters",
  "uploadedAt": "2026-08-03T12:00:00.000Z"
}
```

- Reemplazo: una evidencia `current` anterior pasa a `replaced` dentro de una
  transaccion `Serializable`; sus bytes no se eliminan. El nuevo documento pasa
  a `current` y un indice unico parcial garantiza una sola evidencia vigente.
- Scoping: primero valida auth y autorizacion institucional, luego busca por
  `credentialId + issuerId`. Una credencial inexistente o de otro issuer usa el
  mismo `404` seguro. `issued` y `revoked` responden `409`.
- Errores: `400` para archivo ausente/body invalido, `413` sobre 20 MB, `415`
  para firma, MIME o extension no admitidos, `401/403/404/409` segun auth y
  dominio.
- Seguridad: no devuelve provider, storage key, path, uploader, historial ni
  objetos Prisma. No existe endpoint de descarga en P4a.
- Limites: no modifica la credencial, no calcula readiness, no ejecuta IA, no
  emite, no crea evidencia blockchain y no modifica `canon_v1`.
- Estado: `implemented` en P4a.

### `POST /issuers/:issuerId/credentials/:credentialId/evidence/texts`

- Proposito: registrar o reemplazar la fuente textual institucional vigente de
  una credencial `draft`.
- Actor: usuario autenticado con membership `active`, rol `admin` u `operator`
  e issuer `authorized`.
- Content-Type: `application/json`.
- Body cerrado:

```json
{
  "label": "Descripcion oficial del curso",
  "content": "Texto institucional..."
}
```

- `label` es opcional y nullable; describe la fuente, no la credencial.
- `content` es requerido, se normaliza a NFC, LF y trim, conserva saltos
  internos y admite hasta 50.000 caracteres Unicode.
- Response `201 Created` allowlisted:

```json
{
  "textEvidenceReference": "internal-safe-reference",
  "status": "current",
  "label": "Descripcion oficial del curso",
  "content": "Texto institucional...",
  "characterCount": 24,
  "sha256": "64-lowercase-hex-characters",
  "submittedAt": "2026-08-03T12:00:00.000Z"
}
```

- Reemplazo: la fila anterior pasa a `replaced` y se conserva; una transaccion
  `Serializable` y un indice unico parcial sostienen una sola `current`.
- Errores: `400` body/texto invalido, `401` sesion, `403` contexto, `404`
  credencial ausente o cross-issuer, `409` estado no draft.
- Separacion: no modifica description, skills, competencies, learning outcomes,
  `Credential.updatedAt`, hash canonico, IA, readiness, emision o blockchain.
- No se expone en verificacion publica ni wallet.
- Estado: `implemented` en P4c-a.

### `PATCH /issuers/:issuerId/credentials/:credentialId/draft`

- Proposito: actualizar los campos comunes y especificos por
  `CredentialType` de una credencial `draft`, incluido un cambio de tipo
  controlado, dentro de un contexto institucional autenticado y autorizado.
- Actor: usuario autenticado con membership `active`, rol `admin` u
  `operator` e issuer `authorized`.
- Scoping: primero valida el contexto institucional y luego busca por
  `credentialId + issuerId`. Una credencial inexistente y una credencial de
  otro issuer producen el mismo `404`.
- Request exacto:

```json
{
  "expectedUpdatedAt": "2026-07-30T12:05:00.000Z",
  "academicCourseReference": "internal-command-reference",
  "curriculumReference": "internal-command-reference",
  "completionDate": "2026-07-30",
  "academicPeriod": "2026-1",
  "grade": "9",
  "skills": ["TypeScript"],
  "competencies": ["Diseno de sistemas"]
}
```

- Allowlist top-level: `expectedUpdatedAt`, `academicCourseReference`,
  `curriculumReference`,
  `achievementName`, `description`, `hours`, `type`, `completionDate`,
  `academicPeriod`, `programName`, `grade`,
  `providerName`, `platformName`, `modality`, `level`, `certificationCode`,
  `expirationDate`, `externalUrl`, `skills`, `competencies` y
  `learningOutcomes`. Cualquier otra clave produce `400`; siguen prohibidos
  `issuerId`, `subjectUserId`, `status`, `sourceType`, `credentialSubject`,
  nombres snake_case directos, hashes, metadata, datos blockchain y secretos.
- Semantica: `expectedUpdatedAt` es obligatorio y debe coincidir exactamente
  con la version leida. Debe enviarse al menos un campo editable.
  `achievementName` es opcional pero no admite `null`; `description` y
  `hours` admiten `null` para limpiar. `type` es opcional, no admite `null` y
  solo acepta `academic_subject`, `course`, `certification` o `degree`. Los
  campos omitidos conservan su valor.
- La restriccion temporal de tipos por issuer tambien se aplica al PATCH:
  solo el issuer UADE demo puede terminar un draft como `academic_subject` o
  `degree`; los demas emisores solo pueden terminarlo como `course` o
  `certification`.
- Seleccion de catalogo: `academicCourseReference` es un string no vacio y
  solo aplica cuando la credencial actual y final son `academic_subject`. El
  backend resuelve dentro de la transaccion una asignatura `active` del mismo
  issuer. Referencias inexistentes, inactivas o de otro issuer producen el
  mismo `404` seguro.
- Contexto curricular: `curriculumReference` es opcional pero requiere
  `academicCourseReference`. Dentro de la misma transaccion Serializable se
  valida que `Program`, `CurriculumVersion`, `ProgramCourse` y
  `AcademicCourse` esten activos, relacionados y pertenezcan al issuer. Una
  combinacion inexistente, cruzada o inactiva devuelve el mismo `404` seguro.
  La seleccion plana de P3.1a sigue admitida.
- Snapshot: la seleccion asigna `Credential.academicCourseId`, copia el nombre
  oficial a `title` y `credentialSubject.achievement_name`, copia
  `description` y `hours` incluyendo sus valores `null`, y deriva
  `institution_name` de `Issuer.name`. Preserva `completion_date`,
  `academic_period`, `grade`, `skills` y `competencies`.
- Snapshot curricular: cuando se envia `curriculumReference`, tambien asigna
  `Credential.programCourseId` y deriva `credentialSubject.program_name`
  desde `Program.name`. El nombre o codigo no se aceptan como sustitutos de
  referencias. El catalogo sigue sin demostrar aprobacion del titular.
- Ambiguedad: `academicCourseReference` no puede combinarse con
  `achievementName`, `description` ni `hours`; estas combinaciones producen
  `400`. No se acepta `academicCourseId`, un objeto de curso ni datos de
  catalogo enviados por el cliente.
- Ambiguedad curricular: `curriculumReference` no puede combinarse con un
  `programName` manual.
- Normalizacion: el nombre se recorta y compacta, y actualiza tanto `title`
  como `credentialSubject.achievement_name`. En toda actualizacion exitosa,
  `credentialSubject.institution_name` se deriva de `Issuer.name`.
- Strings controlados: `trim`, colapso de whitespace, vacio a `null` y maximo
  255 caracteres. Fechas: fecha calendario real `YYYY-MM-DD` o `null`;
  `expirationDate` no puede ser anterior a `completionDate`. `externalUrl`
  acepta solo HTTP/HTTPS y hasta 2048 caracteres, sin requests externos.
- Arrays: `string[] | null`; `null` limpia a `[]`, se eliminan vacios, se
  deduplica case-insensitive conservando el primer casing, maximo 30 elementos
  y 80 caracteres por elemento.
- Horas: decimal string positiva con precision compatible con
  `Decimal(10,2)` o `null`; la response la serializa como `string | null`.
- Aplicabilidad por tipo:

| Tipo final | Campos especificos permitidos |
| --- | --- |
| `academic_subject` | `completionDate`, `academicPeriod`, `programName`, `grade`, `skills`, `competencies` |
| `course` | `completionDate`, `platformName`, `modality`, `externalUrl`, `competencies`, `learningOutcomes` |
| `certification` | `completionDate`, `certificationCode`, `expirationDate`, `externalUrl`, `providerName`, `level`, `skills`, `competencies` |
| `degree` | `completionDate`, `programName`, `level`, `grade`, `competencies`, `learningOutcomes` |

- Un campo enviado que no aplique al tipo final produce `400`, incluso si su
  valor es `null`.
- Cambio de tipo: solo sobre `draft` y dentro del mismo CAS. El backend elimina
  todos los campos controlados que no aplican al tipo final, conserva los que
  siguen aplicando, aplica valores nuevos y preserva claves legacy
  desconocidas. Las claves legacy no se aceptan por request ni se devuelven en
  el read model.
- Concurrencia: usa compare-and-swap atomico dentro de una transaccion
  `Serializable`, condicionado por `id`, `issuerId`, `status = draft` y el
  `updatedAt` leido. Un timestamp desactualizado o una carrera produce `409`.
- Response `200 OK`: el mismo read model issuer-facing seguro documentado en
  `GET /issuers/:issuerId/credentials/:credentialId`, incluyendo
  `description`, `hours`, la allowlist completa de `credentialSubject` y un
  `updatedAt` nuevo. Incluye `academicCourse` allowlisted o `null`, y un
  `academicCourse.program` allowlisted o `null`.
- Errores esperados: `400` payload invalido, `401` sin autenticacion valida,
  `403` sin contexto institucional operativo, `404` para credencial
  inexistente o de otro issuer y `409` para lifecycle no draft o conflicto de
  concurrencia.
- Limites: no calcula readiness, no emite, no llama a blockchain y no modifica
  canonicalizacion. El catalogo no demuestra cursada ni aprobacion del holder.
- Cobertura actual de `canon_v1`:

| Campo controlado | Persistido en draft | Devuelto por read model | En `canon_v1` |
| --- | --- | --- | --- |
| `type` | Si | Si | Si |
| `achievementName` / `title` / `achievement_name` | Si | Si | Si |
| `description` | Si | Si | Si |
| `hours` | Si | Si | Si |
| `Issuer.name` / `institution_name` | Si | Si | Si |
| `completionDate` / `completion_date` | Si | Si | Si |
| `academicPeriod` / `academic_period` | Si | Si | Si |
| `grade` | Si | Si | Si |
| `skills` | Si | Si | Si |
| `competencies` | Si | Si | Si |
| `programName` / `program_name` | Si | Si | No |
| `providerName` / `provider_name` | Si | Si | No |
| `platformName` / `platform_name` | Si | Si | No |
| `modality` | Si | Si | No |
| `level` | Si | Si | No |
| `certificationCode` / `certification_code` | Si | Si | No |
| `expirationDate` / `expiration_date` | Si | Si | No |
| `externalUrl` / `external_url` | Si | Si | No |
| `learningOutcomes` / `learning_outcomes` | Si | Si | No |
| `academicCourseReference` / `academicCourseId` | Relacion | Resumen command-only | No |
| `curriculumReference` / `programCourseId` | Relacion | Resumen command-only | No |

Antes de emision debe decidirse si los campos controlados no incluidos en
`canon_v1` permanecen como metadata no canonica o requieren una nueva version
de canonicalizacion. Esta decision es un gap previo a P7; P2b1 no cambia hash
ni afirma que un draft este listo para emitir.
- Estado: `implemented`, incluida la seleccion curricular P3.1b.

### `PATCH /issuers/:id`

- Proposito: actualizar metadata basica del emisor.
- Actor: `issuer_admin`, `system_admin`.
- Request conceptual: campos editables institucionales.
- Response conceptual: emisor actualizado.
- Errores esperados: `400`, `403`, `404`.
- Estado: `future`.

### `POST /issuers/:id/authorize`

- Proposito: marcar un emisor como autorizado para emision.
- Actor: `system_admin`.
- Request conceptual: motivo, wallet address o referencia operativa.
- Response conceptual: estado actualizado de autorizacion.
- Errores esperados: `400`, `403`, `404`, `409`.
- Estado: `future`.

### `POST /issuers/:id/revoke-authorization`

- Proposito: revocar autorizacion de un emisor.
- Actor: `system_admin`.
- Request conceptual: motivo de revocacion.
- Response conceptual: estado revocado.
- Errores esperados: `400`, `403`, `404`.
- Estado: `future`.

### `GET /issuers/:id/credentials`

- Proposito: listar credenciales emitidas por un emisor.
- Actor: `issuer_admin`, `system_admin`.
- Request conceptual: filtros por fecha, estado o usuario.
- Response conceptual: lista resumida de credenciales.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

## 3. Credentials

### `POST /credentials/draft`

- Proposito: crear o persistir un borrador de credencial.
- Actor: `issuer_admin`.
- Request manual: datos base de `credential_v1` sin `issued_at`. Este camino se
  mantiene para `academic_subject`, `course`, `certification` y `degree`.
- Request curricular recomendado para `academic_subject`:

```json
{
  "issuerId": "issuer-reference",
  "subjectUserId": "holder-reference",
  "type": "academic_subject",
  "sourceType": "manual_issuer",
  "academicCourseReference": "academic-course-reference",
  "curriculumReference": "curriculum-reference"
}
```

- `academicCourseReference` y `curriculumReference` son strings no vacios y se
  envian siempre como par. No se aceptan `academicCourseId`,
  `programCourseId`, objetos relacionales ni una sola referencia aislada.
- El body curricular es cerrado: solo acepta exactamente `issuerId`,
  `subjectUserId`, `type`, `sourceType`, `academicCourseReference` y
  `curriculumReference`. `type` debe ser `academic_subject` y `sourceType`
  debe ser `manual_issuer`.
- Por presencia de propiedad se rechazan `credentialSubject`, `metadata`,
  `rawData`, `externalCourseId`, datos oficiales manuales y cualquier otra
  clave fuera de esa allowlist, incluso si su valor es `null`, vacio o un
  objeto sin propiedades.
- La seleccion se resuelve en una transaccion Serializable. Valida que
  `AcademicCourse`, `Program`, `CurriculumVersion` y su relacion
  `ProgramCourse` esten activos, pertenezcan al mismo issuer autorizado y
  coincidan con las referencias recibidas.
- El snapshot deriva `title`, `description`, `hours`,
  `credentialSubject.achievement_name`, `credentialSubject.institution_name`
  y `credentialSubject.program_name`. Estos valores oficiales no pueden
  enviarse manualmente junto con las referencias curriculares.
- La seleccion curricular no prueba cursada, finalizacion ni aprobacion. El
  snapshot inicial no contiene fecha, periodo, nota, skills, competencias ni
  learning outcomes; esos datos se completan posteriormente mediante el PATCH
  issuer-facing del draft.
- Response conceptual: credencial en estado `draft`.
- Autorizacion: JWT, membership activa `admin` u `operator` sobre el `issuerId` solicitado e issuer `authorized`.
- Errores esperados: `400`, `401`, `403`, `404`.
- Limites: no calcula readiness, no emite, no crea evidencia blockchain y no
  ejecuta PDF ni IA.
- Estado: implementado para creacion manual y curricular.

### `POST /credentials/:id/issue`

- Proposito: emitir una credencial y fijar hash canonico.
- Actor: `issuer_admin`.
- Request conceptual: path `id`, confirmacion de emision, datos finales.
- Response conceptual: credencial emitida con estado, hash y referencia blockchain si aplica.
- Errores esperados: `400`, `403`, `404`, `409`.
- Estado: implementado y preservado como endpoint legacy. El Portal del Emisor
  debe usar el wrapper issuer-scoped.

### `GET /credentials/:id`

- Proposito actual: obtener el resumen tecnico existente de una credencial.
- Actor actual: consumidor tecnico/demo; el runtime mantiene este endpoint sin
  auth por compatibilidad transitoria.
- Request conceptual: path `id`.
- Response actual: `CredentialSummaryResponseDto`.
- Errores esperados: `400`, `404`.
- Estado: implementado, transitorio. El Portal del Emisor debe migrar en P1b
  al read institucional seguro y el verificador no debe reutilizar este DTO
  como contrato publico final.

### `GET /credentials/:id/status`

- Proposito: obtener el estado operativo y verificable de una credencial.
- Actor: `holder`, `issuer_admin`, `verifier`, `system_admin`.
- Request conceptual: path `id`.
- Response conceptual: `status`, `issued_at`, `revoked_at`, presencia de hash y registro blockchain.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

### `POST /credentials/:id/revoke`

- Proposito: revocar una credencial emitida.
- Actor: `issuer_admin`, `system_admin`.
- Request conceptual: motivo de revocacion.
- Response conceptual: credencial revocada y evidencia operativa resultante.
- Errores esperados: `400`, `403`, `404`, `409`.
- Estado: `future`.

### `GET /credentials/:id/blockchain-record`

- Proposito: recuperar la evidencia blockchain asociada.
- Actor: `holder`, `issuer_admin`, `system_admin`.
- Request conceptual: path `id`.
- Response conceptual: `blockchain_record_v1`.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

### `GET /credentials/:id/semantic-analysis`

- Proposito: consultar el ultimo analisis semantico disponible.
- Actor: `holder`, `issuer_admin`, `system_admin`.
- Request conceptual: path `id`.
- Response conceptual: `semantic_analysis_v1`.
- Errores esperados: `401`, `403`, `404`.
- Estado: `mock`.

## 4. Verification

### `POST /verification/credentials`

- Proposito: verificar una credencial a partir de payload o identificador.
- Actor: `verifier`, `system_admin`.
- Request conceptual: `credential_id`, token compartido o payload de credencial.
- Response conceptual: resultado de verificacion, emisor, hash, estado y revocacion.
- Errores esperados: `400`, `404`, `409`.
- Estado: `v1_candidate`.

### `GET /verification/credentials/:credentialId`

- Proposito: consultar un resultado de verificacion por credential id.
- Actor: `verifier`, `system_admin`.
- Request conceptual: path `credentialId`.
- Response conceptual: resumen verificable.
- Errores esperados: `401`, `403`, `404`.
- Estado: `mock`.

### `POST /verification/shared-link/:token`

- Proposito: verificar acceso mediante token o link compartido.
- Actor: `verifier`.
- Request conceptual: path `token`, contexto opcional del verificador.
- Response conceptual: credencial o perfil compartido segun alcance del token.
- Errores esperados: `400 invalid_token`, `403 expired_or_revoked`, `404`.
- Estado: `future`.

### `GET /verification/events/:id`

- Proposito: consultar un evento de verificacion registrado.
- Actor: `system_admin`, `issuer_admin`.
- Request conceptual: path `id`.
- Response conceptual: detalle resumido de `VerificationEvent`.
- Errores esperados: `401`, `403`, `404`.
- Estado: `future`.

## 5. Semantic / Profile

### `POST /semantic/analyze/credentials/:id`

- Proposito: disparar el analisis semantico de una credencial.
- Actor: `issuer_admin`, `system_admin`.
- Request conceptual: path `id`, flags operativas opcionales.
- Response conceptual: estado de solicitud o analisis generado.
- Errores esperados: `400`, `403`, `404`, `409`.
- Estado: `mock`.

### `GET /semantic/credentials/:id/analysis`

- Proposito: recuperar el analisis de una credencial.
- Actor: `holder`, `issuer_admin`, `system_admin`.
- Request conceptual: path `id`.
- Response conceptual: `semantic_analysis_v1`.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

### `POST /profiles/users/:id/rebuild`

- Proposito: recalcular el perfil formativo de un usuario.
- Actor: `system_admin`, `issuer_admin`.
- Request conceptual: path `id`, alcance opcional de reconstruccion.
- Response conceptual: perfil regenerado o job aceptado.
- Errores esperados: `400`, `403`, `404`.
- Estado: `future`.

### `GET /profiles/users/:id`

- Proposito: consultar el perfil formativo actual del usuario.
- Actor: `holder`, `system_admin`, `verifier` con grant explicito.
- Request conceptual: path `id`.
- Response conceptual: `formative_profile_v1`.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

## 6. Blockchain

### `POST /blockchain/credentials/:id/register`

- Proposito: registrar el hash canonico de una credencial en blockchain.
- Actor: `issuer_admin`, `system_admin`.
- Request conceptual: path `id`, parametros operativos de red si aplica.
- Response conceptual: `blockchain_record_v1`.
- Errores esperados: `400`, `403`, `404`, `409`.
- Estado: `mock`.

### `GET /blockchain/credentials/:id/record`

- Proposito: obtener el registro blockchain asociado a una credencial.
- Actor: `holder`, `issuer_admin`, `system_admin`.
- Request conceptual: path `id`.
- Response conceptual: `blockchain_record_v1`.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

### `POST /blockchain/credentials/:id/revoke`

- Proposito: registrar la revocacion on-chain cuando corresponda.
- Actor: `issuer_admin`, `system_admin`.
- Request conceptual: path `id`, motivo de revocacion.
- Response conceptual: `blockchain_record_v1` actualizado o referencia operativa.
- Errores esperados: `400`, `403`, `404`, `409`.
- Estado: `future`.

### `GET /blockchain/issuers/:id/status`

- Proposito: consultar el estado verificable de autorizacion de un emisor.
- Actor: `issuer_admin`, `system_admin`, `verifier`.
- Request conceptual: path `id`.
- Response conceptual: estado del emisor, wallet y referencias de red.
- Errores esperados: `401`, `403`, `404`.
- Estado: `future`.

## 7. Contratos IA issuer-facing de P5

P5c implementa:

```text
POST /issuers/:issuerId/credentials/:credentialId/analysis-runs/document
```

- Actor: membership `active`, rol `admin|operator`, issuer `authorized`.
- Scope: credential `draft` perteneciente al issuer del path.
- Body: no autoritativo; IDs, actor, source, modo, trigger y versiones se
  derivan de params, JWT y defaults backend-controlled.
- Response: `analysisRunId`, `credentialId`, `status`, `semanticAnalysisId`,
  `artifactStatus`, `sourceCount` y `completedAt`.
- Errores: `401`, `403`, `404`, `409`, fuente faltante `400` y fallos de
  ejecucion sanitizados.
- Efectos: crea/ejecuta un run document y persiste `SemanticAnalysis`; no
  modifica Credential, canon, emision ni blockchain.

P6b agrega una via interna, no publica, posterior a la emision issuer-scoped:

- despues de una emision exitosa, NestJS busca la `DocumentEvidence` `current`;
- solo un PDF vigente habilita el intento automatico `document` con trigger
  `system`;
- el run se crea y ejecuta fuera de la transaccion de emision;
- un run activo o completado para la misma evidencia evita duplicados;
- cualquier fallo de storage, IA o persistencia semantica queda sanitizado en
  el run cuando corresponde y nunca convierte la emision exitosa en error;
- el response de emision no expone el run ni artifacts: el cliente consulta los
  reads P5d existentes.

El endpoint manual anterior permanece `draft`-only. No existe modo
`combined` todavia (C2b.2 implementa el trigger manual textual descripto
abajo; C2b.3 implementa el auto-trigger post-emision para `course` sin PDF,
descripto despues).

C2b.2 implementa:

```text
POST /issuers/:issuerId/credentials/:credentialId/analysis-runs/text
```

- Actor: membership `active`, rol `admin|operator`, issuer `authorized`
  (mismo chequeo que el trigger documental — no se agrego un permiso nuevo).
- Scope: credential `draft` perteneciente al issuer del path (draft-only,
  igual que el trigger documental manual; issued/revoked quedan
  operativamente read-only para triggers manuales).
- Precondicion: requiere una `TextEvidence` `current` vigente para la
  credencial; sin ella responde `422` con
  *"La credencial no tiene evidencia textual vigente para analizar."*
- Dedup: por `TextEvidence.id` vigente exacto, no solo por `credentialId` —
  si ya existe un `AnalysisRun` `text` en `pending`/`running`/`completed`
  para la misma evidencia, responde `409` sin crear ni reejecutar un run
  duplicado. Reemplazar la evidencia (nueva `TextEvidence` `current`) libera
  un analisis nuevo.
- Body: no autoritativo; IDs, actor, source, modo, trigger y versiones se
  derivan de params, JWT y defaults backend-controlled (mismo patron que
  `analysis-runs/document`).
- Response: `analysisRunId`, `credentialId`, `status`, `semanticAnalysisId`,
  `artifactStatus`, `sourceCount` y `completedAt` — nunca `content`, el
  artifact crudo, `textForEmbedding`, `evidenceMap` completo ni storage keys.
- Errores: `401`, `403`, `404`, `409` (credencial no-draft, o run duplicado
  para la misma evidencia), `422` (sin evidencia textual vigente) y fallos
  de ejecucion sanitizados (mismos codigos `ai_*`/`text_unavailable`/
  `semantic_persistence_failed` que ya usa el flujo documental).
- Efectos: crea/ejecuta un run `text` y persiste `SemanticAnalysis` con
  `sourceType: "text"`; no modifica Credential, canon, emision ni
  blockchain; no genera `TextEvidence` nueva; no cambia el `status` de la
  `TextEvidence` leida.
- `AnalysisRunExecutionService` envia al AI Service `content` (desde
  `TextEvidence.content`) mas metadata declarada separada
  (`credentialType`, `platform_name`, `modality`, `hours` cuando existen) y
  `sourceRefs` (`textEvidenceId`, `credentialId`) — nunca `externalUrl` ni
  contenido dentro de la metadata.

P6c mantiene este contrato de emision flexible: el endpoint issuer-scoped no
requiere un PDF universalmente. Una evidencia textual o documental no-PDF puede
respaldar la emision; solo un PDF vigente habilita el intento documental
automatico. La ausencia de fuentes no bloquea el contrato backend actual: el
Portal Emisor exige una confirmacion adicional y no infiere evidencia desde
skills, competencias o catalogo.

P6d no corrige por si solo una falla del servicio IA: la vuelve diagnosticable
sin exponer detalles crudos. Los `AnalysisRun` fallidos pueden persistir los
codigos internos allowlisted `ai_input_rejected`, `ai_endpoint_not_found`,
`ai_version_conflict`, `ai_input_too_large`, `ai_dependency_unavailable`,
`ai_invalid_response`, `ai_invalid_configuration` o
`ai_network_unreachable`, ademas de los codigos existentes. Los reads P5d
devuelven exclusivamente el codigo y un mensaje estatico seguro; nunca URL,
tokens, headers, storage keys, contenido, artifacts ni stack traces. NestJS
envia `X-Analysis-Run-Id` al analisis documental como correlacion interna y
registra un evento sanitizado con categoria, status HTTP cuando exista y causa
de red segura cuando Node la exponga.

P5d implementa:

```text
GET /issuers/:issuerId/credentials/:credentialId/analysis-runs/latest
GET /issuers/:issuerId/credentials/:credentialId/analysis-runs/:analysisRunId
```

- Actor: membership `active`, rol `admin|operator`, issuer `authorized`.
- Scope: credential perteneciente al issuer; puede estar `draft`, `issued` o
  `revoked`.
- Latest: devuelve el run mas reciente por `createdAt desc, id desc`, o `null`.
- By ID: busca por `analysisRunId + credentialId`; missing/cross-scope devuelve
  404 uniforme.
- Response: lifecycle, modo, trigger, versiones, tipos/conteo de fuentes,
  timestamps, error sanitizado y resumen semantico nullable.
- Excluye: `analysisJson`, `textForEmbedding`, `evidenceMap`, contenido,
  storage internals, artifacts crudos y errores persistidos no allowlisted.
- Efectos: lectura pura; no IA, storage, Credential, canon, emision o
  blockchain.

C2b.3 agrega una via interna, no publica, posterior a la emision
issuer-scoped, analoga a P6b pero para `course` sin PDF:

- despues de una emision exitosa, si `type=course` y no hay `DocumentEvidence`
  `current` PDF, NestJS busca la `TextEvidence` `current`;
- si ya existe una `TextEvidence` `current` (manual o de una ejecucion
  anterior), se usa tal cual — nunca se reemplaza ni se genera una nueva;
- si no existe ninguna, se construye texto desde `achievementName`/`title`,
  `description`, `competencies`, `learningOutcomes` (nunca `platformName`,
  `modality`, `externalUrl`, issuer, holder, blockchain) y, solo si supera
  una regla de suficiencia conservadora (rechaza titulo generico solo), se
  genera una `TextEvidence` nueva marcada explicitamente como generada por
  sistema;
- si el texto declarado es insuficiente, la emision continua sin crear
  ningun analisis — no es un error;
- el run se crea y ejecuta fuera de la transaccion de emision, con
  `trigger=system` y `requestedByUserId=null`, igual patron que P6b;
- dedup por `TextEvidence.id` exacta incluye estado `failed` (mas estricto
  que el endpoint manual de C2b.2): nunca reintenta automaticamente sobre
  la misma evidencia;
- PDF tiene prioridad absoluta: si hay un PDF vigente, este camino nunca se
  ejecuta (el flujo documental automatico existente aplica en su lugar);
- ambos automaticos (documental y textual) se invocan siempre tras emitir,
  pero por construccion nunca ejecutan un analisis real los dos a la vez;
- cualquier fallo (generacion de evidencia, creacion del run, ejecucion IA)
  queda atrapado y logueado de forma segura, nunca convierte la emision
  exitosa en error;
- el response de emision no expone el run ni artifacts: el cliente consulta
  los reads P5d/C2b.2 existentes;
- desde C2b.4, si el run automatico completa y persiste `SemanticAnalysis`,
  reconstruye `FormativeProfile` del holder best-effort (ver abajo); no
  modifica canon, hash ni blockchain.

C2b.4 agrega, sin exponer ningun endpoint nuevo, un paso interno posterior
a P6b y a C2b.3:

- si el run automatico (`trigger=system`, documental o textual) termina
  `completed` y persistio `SemanticAnalysis`, `AutomaticProfileRebuildService`
  llama `FormativeProfileService.rebuildForUser(Credential.subjectUserId)`;
- NO aplica a `trigger=manual` (ni P5c ni C2b.2): esos siguen sin
  reconstruir perfil en este slice; `POST /me/profile/rebuild` sigue
  disponible para reconstruccion explicita;
- si `rebuildForUser` falla, se loguea de forma segura y no se relanza; el
  `AnalysisRun` (ya `completed`) no cambia de estado y la emision no se ve
  afectada;
- no llama IA de nuevo, no toca canon/hash/blockchain, no cambia la logica
  semantica del perfil (horas/skills/areas/concepts siguen igual -- C2c).

Permanece candidato futuro:

```text
POST /issuers/:issuerId/credentials/:credentialId/analysis-runs/combined
```

- Actor: membership `active`, rol `admin|operator`, issuer `authorized`.
- Identidad: issuer y credential vienen del path; el backend valida scoping.
- Fuentes: referencias backend exactas de `DocumentEvidence`/`TextEvidence`;
  el frontend no envia `storageKey`, path, provider ni contenido arbitrario.
- Resultado: resumen allowlisted de `AnalysisRun` y `semantic_analysis_v1`.
- Persistencia: NestJS valida artifacts antes de persistirlos.
- Efectos prohibidos: no PATCH automatico de `Credential`, no readiness, no
  emision, no hash y no blockchain.
- Estado: trigger document, trigger text (C2b.2) y reads implementados;
  `combined` sigue `future_p5` — `AnalysisRunExecutionService` lo rechaza
  explicitamente con *"El analisis combinado todavia no esta implementado."*
  en ambos puntos de entrada (documental y textual).

Las propuestas y revision humana tendran contratos separados en P5h/P6a. No se
debe reutilizar el artifact crudo como command de actualizacion.

## Holder wallet v1

Los reads autenticados del titular son `GET /me/credentials`,
`GET /me/credentials/:id` y `GET /me/profile/current`. El backend deriva el
titular exclusivamente del token y limita las credenciales a estados `issued`
o `revoked`. El detalle holder entrega un resumen de emisor, campos formativos
allowlisted (incluyendo `providerName`, `platformName`, `modality`, `level` y
`externalUrl` cuando el emisor los declaró en `credentialSubject`), evidencia
documental y textual actual en modo lectura, integridad abreviable y el último
resumen semántico disponible.

Estos reads no exponen `rawData`, `metadata`, direcciones de contrato, claves
de storage, contenido completo de evidencia textual, `analysisJson`,
`textForEmbedding`, `evidenceMap`, identificadores de fuentes ni artifacts
crudos. `GET /me/profile/current` proyecta el snapshot persistido a áreas,
habilidades, conceptos, confianza, observaciones y totales seguros; no entrega
`profileJson`, IDs de perfil ni referencias de fuentes.
`POST /me/profile/rebuild` aplica la misma proyección holder-safe antes de
responder: reconstruir no habilita la exposición del snapshot interno.

La Wallet carga el perfil y la biblioteca de credenciales como recursos
independientes. Mientras no exista un mapeo seguro de procedencia, el contrato
no afirma que una credencial individual haya sido fuente de un perfil concreto.

### C2c: horas oficiales y cobertura semantica

`GET /me/profile/current` y `POST /me/profile/rebuild` agregan, sin nuevo
endpoint, tres campos adicionales al `currentProfile` ya existente:

- `totalOfficialHours: number | null` — igual a `totalHours`; nombre
  inequivoco para el total declarado por las credenciales, nunca una
  distribucion por area.
- `credentialsWithoutHours: number | null` — cantidad de credenciales
  `issued` con `hours` nulo. `null` cuando el perfil se genero antes de
  C2c y el contador no esta disponible (no significa cero).
- `credentialsWithoutSemanticCoverage: number | null` — cantidad de
  credenciales `issued` sin `SemanticAnalysis` utilizable. Mismo criterio
  de `null` vs `0` que el campo anterior.

Estos campos son additivos: los clientes que todavia no los lean siguen
funcionando igual, y los perfiles persistidos antes de C2c (sin
`profileJson.summary.totalOfficialHours`/contadores) se sirven con
`totalOfficialHours` calculado desde `totalHours` y los contadores en
`null`. `areasSummary`/la distribucion de horas estimadas por area no
cambian: siguen dependiendo exclusivamente de `SemanticAnalysis.hoursDistribution`
cuando existe.

## C3a: catalogo reusable de cursos por issuer

Cuatro endpoints nuevos, todos protegidos por `AuthGuard` y issuer-scoped
(membership `admin`/`operator` activa, issuer `authorized`):

```text
GET   /issuers/:issuerId/course-templates?search=&status=
POST  /issuers/:issuerId/course-templates
POST  /issuers/:issuerId/course-templates/from-credential/:credentialId
PATCH /issuers/:issuerId/course-templates/:templateId
```

`GET` devuelve un array (no `{ items: [...] }`) de templates del issuer
solicitado:

```json
[
  {
    "id": "...",
    "title": "...",
    "description": "...",
    "hours": "22.00",
    "modality": "Online",
    "platformName": "...",
    "externalUrl": "...",
    "competencies": ["..."],
    "learningOutcomes": ["..."],
    "status": "active",
    "createdFromCredentialId": "...",
    "lastSemanticAnalysisId": "...",
    "createdAt": "2026-08-11T12:00:00.000Z",
    "updatedAt": "2026-08-11T12:00:00.000Z"
  }
]
```

Nunca expone `issuerId` ni `createdByUserId`, y nunca devuelve templates de
otro issuer. `status` default `active`; acepta `archived` o `all`. `search`
compara contra `title`, `platformName` y `description` (normalizado NFD +
minusculas es-AR, mismo criterio que el catalogo academico). Orden
`updatedAt desc`, limite fijo `20`.

`POST` (creacion manual) acepta `title` (requerido), `description`, `hours`
(**`number` JSON**, no decimal string -- distinto del contrato de
`PATCH .../credentials/:credentialId/draft` que usa decimal string para
`hours`), `modality` (`Presencial`/`Online`/`Asincrónica`), `platformName`,
`externalUrl` (HTTP/HTTPS), `competencies` y `learningOutcomes` (arrays de
string, normalizados y dedupeados case-insensitive). Rechaza `skills`,
`providerName`, `level`, `issuerId`, `createdByUserId` y `status` en el
body -- el template siempre se crea `active`.

`POST .../from-credential/:credentialId` crea un template a partir de una
credencial `course` del mismo issuer (`draft` o `issued`). Resuelve el
titulo con prioridad `credentialSubject.achievement_name` sobre
`Credential.title`; si ninguno alcanza, responde `400`. Copia
`description`, `hours`, `platformName`, `modality`, `externalUrl`,
`competencies` y `learningOutcomes` desde la credencial. Nunca copia
`skills`, `providerName`, `level` ni `rawData`. Si ya existe un template
`active` del mismo issuer con el mismo `createdFromCredentialId` y un
titulo igual tras normalizar, responde `409 Conflict`:
*"Este curso ya fue guardado como reutilizable."*

`PATCH .../:templateId` acepta los mismos campos que `POST` mas `status`
(`active`/`archived`, para archivar). Nunca acepta `issuerId`,
`createdByUserId`, `createdFromCredentialId` ni `lastSemanticAnalysisId`
desde el body -- son derivados o inmutables despues de creado el template.

`IssuerCourseTemplate` no es una credencial emitida: no participa en
`canon_v1`, no se registra en blockchain, no modifica `Credential` ni
`SemanticAnalysis` existentes. No hay endpoint para crear un draft de
credencial a partir de un template, ni un endpoint de aprobacion de
interpretacion IA sobre un template -- eso queda para C3c/C4. No hay UI ni
selector en este slice (C3b).

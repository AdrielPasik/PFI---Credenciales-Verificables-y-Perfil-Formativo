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
- Identidad institucional: `issuer.displayName` proviene de `Issuer.name`;
  `credentialSubject.institution_name` es solamente el dato guardado en la
  credencial y puede diferir.
- Holder historico: la lectura no exige que el usuario titular siga activo.
- Allowlist: no devuelve `issuerId`, `subjectUserId`, datos de autenticacion,
  wallet, metadata, rawData, hash canonico, registros blockchain, analisis,
  eventos ni grants.
- Errores esperados: `401` sin autenticacion valida, `403` sin contexto
  institucional operativo y `404` para credencial inexistente o de otro
  issuer.
- Diferencia con `GET /credentials/:id`: este read model es issuer-facing,
  protegido y minimizado. El endpoint generico anterior conserva por ahora su
  comportamiento para compatibilidad tecnica y no es el endpoint publico
  final del verificador.
- Estado: `implemented`.

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
| `course` | `completionDate`, `providerName`, `platformName`, `modality`, `level`, `skills`, `competencies`, `learningOutcomes` |
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
- Request conceptual: datos base de `credential_v1` sin `issued_at`.
- Response conceptual: credencial en estado `draft`.
- Autorizacion: JWT, membership activa `admin` u `operator` sobre el `issuerId` solicitado e issuer `authorized`.
- Errores esperados: `400`, `401`, `403`, `404`.
- Estado: `v1_candidate`.

### `POST /credentials/:id/issue`

- Proposito: emitir una credencial y fijar hash canonico.
- Actor: `issuer_admin`.
- Request conceptual: path `id`, confirmacion de emision, datos finales.
- Response conceptual: credencial emitida con estado, hash y referencia blockchain si aplica.
- Errores esperados: `400`, `403`, `404`, `409`.
- Estado: `v1_candidate`.

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

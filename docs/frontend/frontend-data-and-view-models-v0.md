# Traza: Datos y view models frontend v0

## 1. Resumen ejecutivo

Este documento define la frontera normativa entre los contratos HTTP reales
del backend NestJS y los datos que pueden consumir los componentes de Traza.

La cadena obligatoria es:

```text
Backend response
-> API client
-> transport model
-> frontend adapter
-> view model
-> componente UI
```

Los componentes reciben view models seguros, explícitos y adaptados al
contexto. No reciben:

- responses completas;
- entidades Prisma;
- DTOs usados como props;
- artifacts IA;
- objetos FastAPI;
- estructuras de ethers;
- datos crudos o de debugging.

Los adapters aplican allowlists. Seleccionan, validan, normalizan y descartan.
No completan información ausente con suposiciones.

Estado:

```text
versión: v0
carácter: normativo
alcance: datos, adapters y view models frontend
locale: es-AR
aplicación: Traza web
```

## 2. Alcance

Este documento cubre:

- autenticación y sesión;
- resolución de contexto;
- Portal del Emisor;
- credenciales institucionales por ID;
- creación de draft;
- emisión;
- análisis formativo desde PDF;
- Wallet del Titular;
- detalle de credencial del titular;
- perfil formativo;
- construcción del perfil mediante IA;
- Verificador Público;
- evidencia de integridad;
- estados de dominio;
- estados de request;
- errores;
- formatos locales;
- campos prohibidos.

No cubre:

- layouts;
- wireframes;
- diseño visual;
- props definitivas;
- hooks;
- librería de fetching;
- state management;
- almacenamiento del JWT;
- estructura final de carpetas;
- implementación TypeScript productiva;
- componentes, páginas o rutas.

Las pseudo-interfaces son contratos conceptuales. No obligan todavía a una
estructura de archivos.

## 3. Fuentes de verdad

Aplicar este orden ante contradicciones:

1. Controllers, services, DTOs y serializers actuales de `services/api/src`.
2. `frontend-brand-and-design-system-v0.md` para marca, tono, terminología y
   semántica visual.
3. `frontend-information-architecture-v0.md` para rutas, actores,
   navegación y disponibilidad A/B/C/D.
4. Documentación vigente de integración IA, auth, permisos y flujos.
5. Prisma como apoyo para comprender enums y relaciones, nunca como contrato
   frontend.
6. Documentación histórica como contexto no vinculante.

El frontend consume exclusivamente NestJS. No consume directamente FastAPI,
PostgreSQL, Prisma, Anvil, contratos Solidity ni clientes blockchain.

## 4. Snapshot de inspección

```text
fecha: 2026-07-27
branch: main
commit: e7319e1
backend inspeccionado: services/api/src
modelo consultado: services/api/prisma/schema.prisma
documentación inspeccionada: docs/frontend, docs/architecture, docs/demo
```

Se inspeccionaron especialmente:

```text
services/api/src/auth
services/api/src/credentials
services/api/src/ai
services/api/src/me
services/api/src/profiles
services/api/src/verification
services/api/src/semantic
services/api/src/blockchain
services/api/src/issuers
```

El inventario de responses, nullability, permisos y errores corresponde a este
snapshot.

Actualizaciones posteriores al snapshot base:

- P0.1 protegió `POST /credentials/draft`.
- P0.2 agregó issuer summaries seguros en `GET /auth/me`.
- P0.3 agregó resolución autorizada del titular por email exacto.

> Cuando cambien controllers, DTOs, serializers, permisos o responses del
> backend, deberán revisarse los adapters y view models definidos por este
> documento.

## 5. Principios normativos

### Frontera de presentación

- no importar tipos Prisma en componentes;
- no usar entidades Prisma como modelos frontend;
- no importar tipos FastAPI;
- no consumir FastAPI directamente;
- no usar DTOs backend directamente en JSX;
- no pasar responses completas a componentes;
- no construir view models con spread de una response;
- no convertir objetos desconocidos en UI mediante render genérico;
- no usar IDs internos como identidad principal;
- no usar nombres internos como labels visibles.

### Datos internos

No pasar a componentes:

- `analysisJson`;
- `profileJson`;
- `textForEmbedding`;
- `rawData`;
- artifacts completos;
- prompts;
- embeddings;
- stack traces;
- configuración interna.

Un adapter puede inspeccionar un campo amplio únicamente para extraer una
allowlist validada. Debe descartar el contenedor original antes de devolver el
view model.

### Texto y contenido no confiable

Todo texto proveniente de:

- formularios del emisor;
- `credentialSubject`;
- metadata allowlisted;
- IA;
- warnings;
- quality flags;
- errores backend;
- nombres de archivos;

se trata como contenido no confiable.

Reglas:

- renderizar como texto plano por defecto;
- el escaping de React no autoriza `dangerouslySetInnerHTML`;
- no renderizar HTML recibido del backend;
- no interpretar Markdown automáticamente;
- no insertar strings backend como HTML, CSS, nombre de clase o URL;
- limitar longitudes de forma razonable en el adapter o view model;
- preservar el valor original solo cuando sea necesario y seguro;
- mostrar nombres de archivo como nombre, nunca interpretarlos como paths;
- pasar el detail de errores por allowlist o mapping y no mostrarlo
  directamente por defecto;
- validar protocolo y origen de links externos futuros.

Si en el futuro se admite rich text o Markdown, debe existir:

- contrato específico;
- sanitizer probado;
- allowlist de elementos y atributos;
- revisión de seguridad explícita.

### Honestidad semántica

- `artifactCount` no equivale automáticamente a credenciales;
- `confidence` no representa capacidad de una persona;
- `online_course_catalog` no demuestra finalización;
- un syllabus no demuestra aprobación;
- evidencia registrada no equivale por sí sola a verificación válida;
- un estado de request no es un estado persistido;
- no inventar `pending`, `processing`, jobs, progreso ni porcentajes;
- no convertir ausencia en `0`;
- no ampliar contratos demo-grade por conveniencia.

### Seguridad

- los guards frontend son UX, no seguridad;
- el backend decide ownership, membership y permisos;
- una pantalla autenticada no vuelve seguro un endpoint público;
- no guardar artifacts o responses internas en `localStorage`;
- no exponer `POST /me/profile/rebuild` como acción del MVP.

### Autoridad institucional

Para cursos sin PDF o una futura carga textual, la carga corresponde a un
usuario institucional autorizado, `admin` u `operator`. Nunca corresponde al
titular como autodeclaración de formación completada.

## 6. Cadena de transformación

### API client

Responsabilidades:

- llamar exclusivamente al backend NestJS;
- enviar método, headers y body correctos;
- adjuntar Bearer token cuando corresponda;
- tratar JSON, multipart y respuestas sin asumir su validez;
- capturar status HTTP y body seguro;
- no decidir labels ni semántica visual.

### Transport model

Es la representación mínima de lo recibido por HTTP.

Reglas:

- modela únicamente campos que el adapter necesita;
- conserva nullability y opcionalidad del response;
- no se usa directamente en UI;
- no importa Prisma;
- puede mantener nombres del backend;
- requiere validación mínima en runtime antes del mapping.

### Frontend adapter

Responsabilidades:

- verificar que la shape mínima sea compatible;
- aplicar allowlist;
- descartar campos desconocidos;
- diferenciar `null`, ausencia y lista vacía;
- traducir enums a modelos de dominio frontend;
- construir labels visibles centralizados;
- conservar valores de máquina;
- derivar elegibilidad solo con reglas confirmadas;
- mapear errores por operación y contexto.

El adapter no:

- repara artifacts inválidos;
- inventa issuer, estado o evidencia;
- consulta endpoints adicionales para completar silenciosamente un response;
- persiste respuestas para simular continuidad;
- convierte un DTO demo-grade en contrato estable.

### View model

Es el contrato consumible por la capa de presentación.

Debe:

- ser seguro para el actor;
- tener estados discriminados;
- contener únicamente datos necesarios;
- separar valor de máquina y label;
- impedir combinaciones imposibles;
- evitar objetos `unknown` sin normalización.

### Componente

El componente:

- renderiza el view model;
- emite intenciones de usuario;
- no interpreta responses;
- no conoce Prisma, FastAPI ni artifacts;
- no deriva permisos de IDs;
- no traduce enums backend de forma local.

## 7. Tipos conceptuales de modelos

| Modelo | Propósito | Uso en UI |
|---|---|---|
| Transport model | Representar la respuesta HTTP mínima | Nunca directo |
| Read view model | Mostrar una entidad o resultado | Sí |
| Form model | Representar valores editables y errores del formulario | Sí |
| Command payload | Enviar una operación al backend | No como dato visible |
| Action state | Representar una operación transitoria | Sí, como feedback |
| Display primitive | Formatear fechas, IDs, estados o detalles | Sí |

### Transport model

Mantiene la forma del transporte solo en la frontera del cliente.

### Read view model

Ejemplos:

- credencial;
- análisis;
- perfil;
- verificación;
- evidencia.

### Form model

Usa términos humanos y puede contener:

- valores editables;
- selección actual;
- errores por campo;
- estado de validación local.

No replica necesariamente el body del backend.

### Command payload

Se construye después de validar y adaptar el form model.

Un form model y un command payload nunca son el mismo objeto por referencia.

### Action state

Modelo base:

```text
idle | submitting | success | error
```

Para lecturas:

```text
idle | loading | success | error
```

Un flujo específico puede agregar `validating` como estado local, sin
convertirlo en estado de dominio.

### Display primitive

Conserva valor de máquina y presentación. Evita formateos dispersos dentro de
componentes.

## 8. Convenciones conceptuales de nombres

### Auth y sesión

- `SessionVM`;
- `CurrentUserVM`;
- `UserContextVM`;
- `IssuerMembershipVM`;
- `LoginFormModel`;
- `LoginCommand`.

### Portal del Emisor

- `IssuerHomeVM`;
- `CreateCredentialDraftFormModel`;
- `CreateCredentialDraftCommand`;
- `IssuerCredentialDetailVM`;
- `CredentialLifecycleVM`;
- `IssueCredentialCommand`;
- `IssueCredentialActionVM`;
- `PdfAnalysisFormModel`;
- `AnalyzePdfCommand`;
- `PdfAnalysisResultVM`;
- `SemanticAnalysisSummaryVM`.

`IssuerHomeVM` no representa un dashboard analítico. Solo contiene información
real disponible para la entrada institucional.

### Titular

- `HolderCredentialListItemVM`;
- `HolderCredentialDetailVM`;
- `ProfileCredentialEligibilityVM`;
- `CurrentProfileVM`;
- `FormativeProfileAreaVM`;
- `FormativeProfileSkillVM`;
- `FormativeProfileConceptVM`;
- `BuildProfileFormModel`;
- `BuildProfileCommand`;
- `BuildProfileResultVM`.

### Verificador

- `VerificationResultVM`;
- `VerificationCredentialVM`;
- `VerificationEvidenceVM`;
- `VerificationAnalysisSummaryVM`;
- `VerificationTechnicalDetailVM`.

### Compartidos

- `CredentialStatusVM`;
- `AnalysisStatusVM`;
- `VerificationStatusVM`;
- `EvidenceStatusVM`;
- `FeedbackErrorVM`;
- `DisplayDateVM`;
- `DisplayIdentifierVM`;
- `TechnicalDetailVM`;
- `AsyncActionStateVM`.

Estos nombres describen responsabilidades. No fijan archivos ni carpetas.

## 9. Clasificación de campos

Cada adapter clasifica los campos que recibe.

| Clase | Definición | Ejemplos |
|---|---|---|
| Visible principal | Información dominante | título, issuer, estado, fecha |
| Visible secundario | Detalle contextual o técnico | hash abreviado, red, warnings |
| Adapter-only | Necesario para derivar o navegar | IDs, enums crudos, versiones |
| Command-only | Necesario para ejecutar una acción | `issuerId`, `credentialIds` |
| Prohibido | Debe descartarse | `rawData`, artifacts, secretos |
| No disponible | El contrato no lo entrega | issuer en verify |

Reglas:

- adapter-only no implica que el componente reciba el campo;
- command-only no debe presentarse como atributo principal;
- un campo técnico puede llegar a un bloque técnico explícito mediante un
  `DisplayIdentifierVM`;
- todo campo no incluido en la allowlist se descarta;
- `unknown` no habilita render genérico.

### Visibilidad y privacidad por actor

Persistencia no equivale a exposición pública. Ante duda, el adapter omite el
campo y registra el gap.

| Dato | Emisor autorizado | Titular | Verificador público | Regla |
|---|---|---|---|---|
| Título de credencial | Sí | Sí | Sí | Visible cuando el DTO seguro lo entrega |
| Institución emisora | Sí, con summary seguro | Sí | No disponible hoy | No inventar ni encadenar reads públicos |
| Nombre o referencia del titular | Solo si es necesario y autorizado | Sí, datos propios | No | Requiere política y DTO explícitos |
| Email del titular | Solo si la operación autorizada lo requiere | Sí, dato propio | No | PII; nunca inferir exposición |
| DID del titular | Solo con finalidad autorizada | Sí, dato propio | No disponible hoy | PII/identidad; no asumir que es público |
| Grade | Según finalidad y política | Sí, si está allowlisted | No por defecto | Puede ser dato educativo sensible |
| Fechas de lifecycle | Sí | Sí | Sí, las incluidas en verify | Aplicar minimización por contexto |
| `credentialSubject` | Solo allowlist y operación autorizada | Allowlist propia | No disponible hoy | No renderizar JSON ni propiedades desconocidas |
| Análisis resumido | Sí, mediante DTO/adaptación segura | Sí | Sí, resumen permitido | Nunca artifact completo |
| Warnings | Sí, sanitizados | Sí, sanitizados | Solo los entregados por verify | Texto no confiable |
| Canonical hash | Detalle técnico | Detalle técnico | Detalle técnico | No usar como identidad principal |
| Transaction hash | Detalle técnico si el DTO lo incluye | Detalle técnico | Detalle técnico | No implica consulta on-chain actual |
| IDs internos | Navegación o soporte técnico | Navegación o soporte técnico | Solo referencia técnica necesaria | No sustituyen identidad humana |
| Metadata | No por defecto | No por defecto | No | Requiere allowlist y política específicas |
| `rawData` | No | No | No | Prohibido |
| Artifacts IA | No | No | No | Prohibidos |

Reglas transversales:

- el titular puede ver sus datos propios mediante endpoints `/me/*`;
- el emisor ve solo los datos necesarios para una operación autorizada;
- el acceso por credential ID no constituye consentimiento;
- no exponer email, DID, nombre ni otra PII al verificador sin contrato y
  política explícitos;
- la UI no encadena endpoints públicos demo-grade para obtener PII ausente;
- metadata, `rawData`, artifacts y campos desconocidos permanecen prohibidos.

## 10. Presencia, nullability y listas

El adapter debe distinguir:

| Caso | Semántica |
|---|---|
| `null` | El contrato reconoce el campo, pero no hay valor |
| Propiedad ausente | El DTO no la expuso o la versión no la contiene |
| `[]` | La lista es conocida y está vacía |
| Ocultado | El adapter descartó el dato por seguridad |
| No soportado | El backend no provee esa capacidad |
| `unknown` | No puede determinarse honestamente |

No se representan todos esos casos como `""`, `0` o `—` dentro del adapter.
La presentación del placeholder pertenece al componente o al formatter,
después de conservar la semántica.

Casos obligatorios:

- `currentProfile: null` es un empty state;
- `confidence: null` no es `0`;
- issuer ausente en verify no confirma que el issuer sea desconocido;
- records vacíos significan que no hay evidencia disponible en el response;
- warnings vacíos indican que no se recibieron warnings conocidos;
- una lista vacía no es automáticamente un error;
- propiedad opcional omitida en `CredentialSummaryResponseDto` no debe
  reinterpretarse como string vacío.

Modelo conceptual:

```text
DataPresence<T>
= { kind: "present", value: T }
| { kind: "null" }
| { kind: "absent" }
| { kind: "hidden" }
| { kind: "unsupported" }
| { kind: "unknown" }
```

No todos los componentes deben recibir `DataPresence`; el adapter puede
resolverlo en una variante de view model más específica.

## 11. Modelos compartidos

### `DisplayDateVM`

```text
iso: string | null
label: string
dateTimeValue: string | null
```

`iso` conserva el valor recibido. `label` usa `es-AR`.
`dateTimeValue` permite semántica HTML y ordenamiento cuando corresponda.

### `DisplayIdentifierVM`

```text
raw: string
short: string
copyable: boolean
visibleInTechnicalDetails: boolean
```

El adapter no destruye el hash o ID original. El componente usa `short` para
la lectura y `raw` solo para copiar o expandir.

### `TechnicalDetailVM`

```text
label: string
value: string
copyable: boolean
visibility: "secondary" | "technical"
```

No acepta objetos arbitrarios.

### `FeedbackErrorVM`

```text
kind: frontend error category
titleKey: semantic message key
detail: safe optional detail
recoverable: boolean
recoveryAction: retry | review_input | login | go_back | none
fieldErrors: optional normalized field errors
```

No contiene stack trace, response completa ni artifact.

La categoría distingue:

```text
invalid_credentials
authentication_required
session_expired
```

No se decide únicamente por status HTTP. También se usa la operación y el
estado previo de sesión.

### `AsyncActionStateVM`

```text
{ kind: "idle" }
| { kind: "submitting" }
| { kind: "success" }
| { kind: "error", error: FeedbackErrorVM }
```

### Estado visible

Los view models de estado contienen:

```text
code: normalized frontend code
label: visible es-AR label
token: semantic design-system token
explanationKey: optional centralized explanation
```

El componente no decide color a partir del enum backend.

## 12. Mappings de dominio

### Credencial

| Backend | Código VM | Label |
|---|---|---|
| `draft` | `draft` | Borrador |
| `issued` | `issued` | Emitida |
| `revoked` | `revoked` | Revocada |
| Otro | `unknown` | Estado no disponible |

### Tipo de credencial

| Backend | Label es-AR |
|---|---|
| `academic_subject` | Asignatura académica |
| `course` | Curso |
| `certification` | Certificación |
| `degree` | Título académico |

### Fuente de credencial

| Backend | Label es-AR |
|---|---|
| `academic_pdf` | Documento académico |
| `course_dataset` | Catálogo de cursos |
| `manual_issuer` | Carga institucional |
| `institutional_system` | Sistema institucional |
| `external_import` | Importación externa |

`course_dataset` no demuestra completion.

### Análisis

| Origen | Código VM | Label |
|---|---|---|
| `latestSemanticAnalysis === null` | `not_analyzed` | Sin análisis formativo |
| `completed` | `completed` | Análisis completado |
| `partial` | `partial` | Análisis parcial |
| Otro | `unknown` | Estado no disponible |

No agregar `processing` ni `failed` como estados persistidos.

### Verificación

| Backend o transporte | Código VM | Label |
|---|---|---|
| `valid` | `valid` | Credencial válida |
| `revoked` | `revoked` | Revocada |
| `draft` | `draft` | Credencial no emitida |
| `incomplete` | `incomplete` | Verificación incompleta |
| HTTP `404` | `not_found` | Credencial no encontrada |

`not_found` es una variante frontend derivada del contexto HTTP.

### Membership

| Backend | Capacidad operativa |
|---|---|
| `admin` activa | Contexto emisor operativo |
| `operator` activa | Contexto emisor operativo |
| `viewer` activa | Sin experiencia issuer-facing útil en el MVP |
| Otra combinación | Sin contexto emisor operativo |

## 13. Modelos discriminados

### `CurrentProfileVM`

```text
{ kind: "empty" }
| {
    kind: "available",
    profile: SafeFormativeProfileVM
  }
| {
    kind: "unsupported",
    generatedAt: DisplayDateVM | null,
    profileReference: adapter-only
  }
```

Reglas:

- `empty` corresponde únicamente a `currentProfile: null`;
- `unsupported` indica que existe un perfil, pero su versión o shape no puede
  presentarse de forma segura;
- `unsupported` no se muestra como si no existiera un perfil;
- no renderizar `profileJson` como fallback;
- no inventar contenido desde una versión desconocida;
- la variante no depende de conservar un perfil anterior en memoria;
- una futura estrategia de caché podrá mantener la última información
  confirmada solo si lo define expresamente.

### `SemanticAnalysisSummaryVM`

```text
{ kind: "not_analyzed" }
| {
    kind: "completed",
    analyzedAt,
    confidence,
    warnings,
    qualityFlags
  }
| {
    kind: "partial",
    analyzedAt,
    confidence,
    warnings,
    qualityFlags
  }
| { kind: "unknown" }
```

Warnings y quality flags pueden estar vacíos. Un análisis parcial no es un
error de request.

### `VerificationResultVM`

```text
{ kind: "valid", credential, evidence, analysis, issuer }
| { kind: "revoked", credential, evidence, analysis, issuer }
| { kind: "draft", credential, evidence, analysis, issuer }
| { kind: "incomplete", credential, evidence, analysis, issuer }
| { kind: "not_found" }
| { kind: "error", error: FeedbackErrorVM }
```

En el contrato actual `issuer` es:

```text
{ kind: "unsupported" }
```

No se completa mediante otro endpoint público.

### `ProfileCredentialEligibilityVM`

```text
eligible: boolean
reasonCode:
  | "revoked"
  | "missing_analysis"
  | "unsupported"
  | "unknown"
reasonLabel: string | null
```

Cuando `eligible` es `true`, `reasonCode` y `reasonLabel` son `null`.

## 14. Inventario de endpoints y adapters

La disponibilidad usa las categorías del documento de arquitectura de
información.

### Parámetros y bodies confirmados

| Endpoint | Path/query | Body real |
|---|---|---|
| `POST /auth/login` | Sin parámetros | JSON con `email`, `password` |
| `GET /auth/me` | Sin parámetros | Sin body |
| `POST /issuers/:issuerId/holders/resolve` | `issuerId` institucional | JSON con `email` |
| `POST /credentials/draft` | Sin parámetros | `CreateCredentialDraftDto` |
| `POST /credentials/:id/issue` | `id` de credencial | `IssueCredentialDto`: `issuerId`, `issuedAt?` |
| `POST /credentials/:id/semantic-analysis/from-pdf` | `id` de credencial | Multipart `file`; `documentId?`, `fileName?`, `pipelineVersion?`, `taxonomyVersion?` |
| `GET /credentials/:id` | `id` de credencial | Sin body |
| `GET /credentials/:id/status` | `id` de credencial | Sin body |
| `GET /credentials/:id/semantic-analysis/latest` | `id` de credencial | Sin body |
| `GET /me/credentials` | Sin parámetros | Sin body |
| `GET /me/credentials/:id` | `id` de credencial | Sin body |
| `GET /me/profile/current` | Sin parámetros | Sin body |
| `POST /me/profile/build-from-ai` | Sin parámetros | JSON con `credentialIds` |
| `POST /me/profile/rebuild` | Sin parámetros | Sin body |
| `GET /verify/credentials/:id` | `id` de credencial | Sin body |

No existe un `ValidationPipe` global en el bootstrap inspeccionado. La
validación runtime actual se realiza en controllers, services y validators
específicos. El frontend valida para UX, pero no debe asumir que su validación
reemplaza esas reglas.

### Nullability confirmada en responses

#### Auth

- `AuthLoginResponseDto.accessToken` es string requerido;
- `AuthLoginResponseDto.user` es requerido;
- `user.id`, `email` y `status` son requeridos;
- `user.did` es `string | null`;
- `AuthMeResponseDto.issuerMemberships` es array requerido y puede estar
  vacío;
- las memberships devueltas por `/auth/me` ya están filtradas a `active`;
- cada membership conserva `issuerId`, `role` y `status`, y agrega
  `issuerName: string`, `issuerDid: string | null` e
  `issuerAuthorizationStatus: pending | authorized | revoked`.

#### Credential summary y status

`CredentialSummaryResponseDto` usa propiedades opcionales que pueden omitirse:

```text
description?
hours?
academicCourseId?
externalCourseId?
issuedAt?
canonicalHash?
canonicalizationVersion?
latestBlockchainRecord?
```

`metadata` se devuelve como objeto o `null`. `credentialSubject` es requerido,
pero su contenido sigue siendo una estructura amplia que requiere allowlist.

`CredentialStatusResponseDto.hasBlockchainRecord` es boolean requerido. Los
datos concretos del record, las fechas de emisión/revocación, el hash y la
versión pueden omitirse.

#### Análisis

- `SemanticAnalysisFromPdfResponseDto.confidence` es `number | null`;
- `warnings` y `qualityFlags` son arrays requeridos y pueden estar vacíos;
- los conteos de áreas, skills y conceptos son números requeridos;
- `CredentialLatestSemanticAnalysisResponseDto.latestSemanticAnalysis` es
  objeto o `null`;
- dentro del latest, `confidence` y `analysisJson` pueden ser `null`;
- arrays semánticos y quality flags son requeridos;
- `textForEmbedding` es string requerido en el DTO amplio actual.

#### Wallet

- `GET /me/credentials` devuelve siempre un array, posiblemente vacío;
- en cada item, `issuedAt`, `revokedAt`, `canonicalHash` y
  `canonicalizationVersion` son nullable;
- `latestBlockchainRecord` y `latestSemanticAnalysis` son objeto o `null`;
- en detalle, `description`, campos del subject, fechas, motivo de revocación,
  hash, versión y metadata pueden ser `null`;
- `blockchainRecords` es array requerido y puede estar vacío;
- `latestSemanticAnalysis` es objeto o `null`.

#### Perfil

- `CurrentProfileResponseDto.userId` es requerido;
- `currentProfile` es objeto o `null`;
- dentro del perfil, `totalHours` es `number | null`;
- `areasSummary`, `skillsSummary`, `qualityFlags` y `profileJson` son
  estructuras amplias en el transport;
- aunque el tipo de `profileJson` sea `unknown`, la persistencia permite que
  no exista contenido útil; el adapter debe validar por versión.

#### Verificación

- `verificationStatus` siempre es una de las cuatro variantes backend;
- fechas, motivo de revocación, hash y canonicalization version son nullable;
- `blockchain.records` es array requerido y puede estar vacío;
- `semanticAnalysis.latest` es objeto o `null`;
- confidence del latest es `number | null`;
- HTTP `404` ocurre fuera del DTO exitoso y se adapta a `not_found`.

### Auth

| Endpoint | Actor | Disp. | Auth/permiso | Response real | Adapter | VM o command | Permitidos | Descartados | Estados derivados | Errores | Notas UX |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `POST /auth/login` | Institucional/titular | A | Público; usuario activo | `AuthLoginResponseDto` | `adaptLoginResponse` | `SessionVM`; `LoginCommand` | token para sesión; user email, DID, status | response desconocida; token fuera de componentes | authenticated | `invalid_credentials`, network, unexpected | El 401 de login no se presenta como sesión expirada |
| `GET /auth/me` | Usuario autenticado | A | Bearer JWT | `AuthMeResponseDto` | `adaptCurrentUserContext` | `CurrentUserVM`; `UserContextVM` | id adapter-only; email, DID, status, memberships activas con issuer name, DID y authorization status | campos desconocidos | issuer operational/personal destination | `authentication_required` o `session_expired`, network, unexpected | Una membership solo es operativa con rol admin/operator e issuer authorized |

### Credenciales y Portal del Emisor

| Endpoint | Actor | Disp. | Auth/permiso | Response real | Adapter | VM o command | Permitidos | Descartados | Estados derivados | Errores | Notas UX |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `POST /issuers/:issuerId/holders/resolve` | Emisor | A dentro de ruta B | JWT; membership activa admin/operator; issuer autorizado | `HolderSummaryResponseDto` | `adaptHolderResolution` | `HolderResolutionFormModel`; `HolderResolutionCommand`; `HolderSummaryVM`; `HolderResolutionStateVM` | `id` se transforma en `holderReference` adapter-only; email, DID nullable, displayLabel | cualquier campo extra; referencias internas no se presentan | idle/invalid/resolving/resolved/not_found/error/session_expired/forbidden | 400, 401, 403, 404, network | `200 OK`; igualdad exacta; no listado ni autocomplete |
| `POST /credentials/draft` | Emisor | B | JWT; membership activa admin/operator; issuer autorizado | `CredentialSummaryResponseDto` | `adaptIssuerCredentialSummary` | `CreateCredentialDraftCommand`; `IssuerCredentialDetailVM` parcial | id, title, type, status, fechas, hash/evidencia si existen | metadata desconocida; credentialSubject no allowlisted; campos extra | draft lifecycle | 400, 401, 403, 404, network | `issuerId` es command-only y se valida contra la sesión |
| `POST /credentials/:id/issue` | Emisor | A dentro de ruta B | JWT; membership activa admin/operator; issuer autorizado | `CredentialSummaryResponseDto` | `adaptIssuedCredentialSummary` | `IssueCredentialCommand`; `IssueCredentialActionVM` | estado, issuedAt, hash, canon, latest record | metadata amplia; campos desconocidos | issued y evidence | 400, 401, 403, 404, 409, network | `issuerId` es command-only y no editable |
| `POST /credentials/:id/semantic-analysis/from-pdf` | Emisor | A dentro de ruta B | JWT; membership admin/operator sobre issuer | `SemanticAnalysisFromPdfResponseDto` | `adaptPdfAnalysisResult` | `AnalyzePdfCommand`; `PdfAnalysisResultVM` | status, fecha, conteos, confidence, warnings, quality flags | campos extra; nunca artifact | completed/partial | 400, 401, 403, 404, 409, 422, 502, 503, 504 | Request síncrono; PDF máximo 20 MB |
| `GET /credentials/:id` | Emisor/demo | B | Público en runtime | `CredentialSummaryResponseDto` | `adaptIssuerCredentialSummary` | `IssuerCredentialDetailVM` parcial | identidad, lifecycle, campos allowlisted, evidencia resumida | metadata/credentialSubject no allowlisted; campos extra | credential/evidence | 400, 404, network | No usar como read productivo |
| `GET /credentials/:id/status` | Emisor/demo | B | Público en runtime | `CredentialStatusResponseDto` | `adaptCredentialLifecycle` | `CredentialLifecycleVM` | estado, fechas, hash, canon, evidencia resumida | campos extra | credential/evidence | 400, 404, network | No reemplaza detalle protegido |
| `GET /credentials/:id/semantic-analysis/latest` | Emisor/demo | B | Público en runtime | `CredentialLatestSemanticAnalysisResponseDto` | `adaptLatestSemanticSummary` | `SemanticAnalysisSummaryVM` parcial | status, fecha, confidence y descriptores sanitizados | `analysisJson`, `textForEmbedding`, `evidenceMap`, campos extra | not analyzed/completed/partial | 400, 404, network, unexpected | Adapter debe descartar antes de componentes |

### Titular

| Endpoint | Actor | Disp. | Auth/permiso | Response real | Adapter | VM o command | Permitidos | Descartados | Estados derivados | Errores | Notas UX |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `GET /me/credentials` | Titular | A | JWT; ownership desde token | `MeCredentialSummaryResponseDto[]` | `adaptHolderCredentialList` | `HolderCredentialListItemVM[]` | título, tipo, issuer, fechas, estado, evidencia/análisis resumidos | IDs no necesarios en child components; campos extra | credential, analysis, evidence, eligibility | 401, network, unexpected | Backend ya excluye drafts y credenciales ajenas |
| `GET /me/credentials/:id` | Titular | A | JWT; ownership; issued/revoked | `MeCredentialDetailResponseDto` | `adaptHolderCredentialDetail` | `HolderCredentialDetailVM` | identidad, issuer, titular, lifecycle, subject allowlisted, evidencia, análisis sanitizado | metadata no allowlisted; objetos unknown; campos extra | credential, analysis, evidence | 401, 404, network, unexpected | 404 también evita filtrar credencial ajena |
| `GET /me/profile/current` | Titular | A | JWT | `CurrentProfileResponseDto` | `adaptCurrentProfile` | `CurrentProfileVM` | profile fields extraídos por versión | `profileJson` completo, campos desconocidos | empty/available | 401, network, unexpected | Response actual es amplio y requiere parser por versión |
| `POST /me/profile/build-from-ai` | Titular | A | JWT; ownership; issued; latest analysis | `CurrentProfileResponseDto` | `adaptBuiltProfile` | `BuildProfileCommand`; `BuildProfileResultVM` | perfil seguro extraído | `profileJson` completo; userId del transporte no visible | available | 400, 401, 403, 404, 409, 422, 502, 503, 504 | Command contiene solo `credentialIds` |
| `POST /me/profile/rebuild` | Interno | Implementado; fuera UI MVP | JWT | `CurrentProfileResponseDto` | Sin adapter de acción visible | Ningún CTA o navegación | Un current profile preexistente puede leerse | nombres internos; `profileJson` | no aplica a UI | no aplica a flujo MVP | Reservado para soporte/herramientas internas |

### Verificador

| Endpoint | Actor | Disp. | Auth/permiso | Response real | Adapter | VM o command | Permitidos | Descartados | Estados derivados | Errores | Notas UX |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `GET /verify/credentials/:id` | Público | B | Sin auth | `VerifyCredentialResponseDto` | `adaptVerificationResult` | `VerificationResultVM` | resultado, credential, records, semantic summary sanitizado | campos desconocidos; IDs no técnicos; ningún artifact | valid/revoked/draft/incomplete; 404→not_found | 404, network, unexpected | No trae issuer; no consulta on-chain en tiempo real |

## 15. Auth, sesión y contexto

### `LoginFormModel`

```text
email
password
fieldErrors
actionState
```

### `LoginCommand`

```text
email: normalized string
password: original string
```

El password:

- nunca se conserva en view models;
- no se registra;
- no se persiste después del login;
- no vuelve como parte del response.

### `SessionVM`

```text
{ kind: "anonymous" }
| {
    kind: "authenticated",
    currentUser: CurrentUserVM,
    recommendedDestination
  }
| { kind: "expired" }
```

El `accessToken` pertenece a la capa de sesión y API client. No es prop de
componentes.

Errores de auth:

- `invalid_credentials`: falla `POST /auth/login`; revisar email y password;
  no presupone una sesión anterior;
- `authentication_required`: una ruta protegida se llamó sin sesión;
  iniciar sesión y conservar solo un `returnTo` interno seguro;
- `session_expired`: una sesión antes válida dejó de ser aceptada; limpiar la
  sesión local e iniciar nuevamente.

El status `401` por sí solo no distingue estas variantes. El mapper usa la
operación y el estado previo de sesión.

### `CurrentUserVM`

Visible:

- email;
- DID cuando aporta contexto;
- estado activo implícito en sesión válida.

Adapter-only:

- user ID;
- status crudo.

No disponible:

- display name en auth responses;
- avatar;
- preferencias.

El nombre, DID y estado de autorización del issuer pertenecen al contexto de
membership, no a `CurrentUserVM`.

### `IssuerMembershipVM`

```text
issuerReference: adapter-only issuerId
issuerName: string
issuerDid: string | null
issuerAuthorizationStatus: pending | authorized | revoked
role: admin | operator | viewer | unknown
status: active
operational: boolean
```

`GET /auth/me` ya filtra memberships activas. El frontend no debe asumir que
una membership omitida está pendiente o revocada.

`operational` solo puede ser verdadero cuando la membership está `active`, el
rol es `admin` u `operator` y `issuerAuthorizationStatus` es `authorized`. Un
issuer `pending` o `revoked` se conserva como contexto conocido, pero no
habilita creación ni emisión.

### `UserContextVM`

```text
personalContext: available
issuerContexts: active memberships con estado operativo derivado
operationalIssuerContexts:
  memberships activas admin/operator con issuer authorized
recommendedDestination:
  /issuer
  | /wallet/credentials
  | null
multiIssuerSelection:
  not_required
  | required
  | unsupported
```

Semántica:

```text
cero operationalIssuerContexts
-> multiIssuerSelection: not_required
-> recommendedDestination: /wallet/credentials

un operationalIssuerContext
-> multiIssuerSelection: not_required
-> recommendedDestination: /issuer

más de un operationalIssuerContext
-> multiIssuerSelection: required
-> recommendedDestination: null
-> nunca seleccionar por orden del array
```

El vertical actual trata `required` como un estado bloqueado porque el selector
y la persistencia del contexto todavía están `unsupported`. No debe degradarlo
a una selección silenciosa.

`viewer` no abre el Portal del Emisor en v0.

## 16. Portal del Emisor

### `IssuerHomeVM`

Puede contener:

- identidad del usuario;
- rol operativo;
- disponibilidad del contexto institucional;
- acción de crear credencial;
- explicación del flujo.

No puede contener:

- métricas;
- credenciales recientes;
- actividad;
- nombre de issuer inventado;
- UUID mostrado como institución.

Estado de issuer:

```text
{ kind: "available", summary: safe issuer summary }
| { kind: "known_non_operational", summary: safe issuer summary }
| { kind: "unavailable" }
```

### `CreateCredentialDraftFormModel`

Campos humanos:

- tipo de credencial;
- título;
- descripción;
- fuente;
- horas opcionales;
- referencia a una resolución autorizada vigente del titular;
- nombre del logro;
- institución del logro;
- campos formativos explícitamente aprobados.

No incluye como inputs libres:

- `issuerId`;
- `subjectUserId`;
- JSON arbitrario;
- `rawData`;
- private key;
- hash;
- status;
- canonicalization version.

La captura editable y los estados de resolución se mantienen en modelos
separados.

### `HolderResolutionFormModel`

```text
email: string
```

Representa exclusivamente el valor editable. Aplica validación local de
formato, conserva el email ante errores y debe invalidar una resolución previa
cuando cambia. No contiene IDs ni referencias internas.

### `HolderResolutionCommand`

```text
issuerReference: adapter-only issuerId
email: string normalizado
```

`issuerReference` proviene de `UserContextVM`: no es editable, no se muestra y
no puede ser escrito por el operador. La orquestación construye el command y el
API client usa `issuerReference` para formar el path. El backend vuelve a
validarlo mediante membership; la identidad del actor sigue proviniendo de la
sesión.

### `HolderSummaryVM`

```text
holderReference: adapter-only user id
email: string
did: string | null
displayLabel: string
```

El adapter transforma `response.id` en `holderReference`.
`holderReference` no se renderiza, no es un input y no se persiste en
`localStorage`. Se usa únicamente para construir
`CreateCredentialDraftCommand.subjectUserId`.

### `HolderResolutionStateVM`

```text
idle
invalid_email
resolving
resolved(HolderSummaryVM)
not_found
network_error
session_expired
forbidden
```

Cambiar el email o el issuer invalida inmediatamente cualquier resultado
`resolved`. La carga de resolución es independiente de la carga de creación
del draft.

### Institución emisora e institución del logro

Son conceptos distintos.

**Institución emisora activa**

- determina la autoridad institucional;
- proviene de sesión y membership;
- se asocia mediante `issuerId`;
- no es un campo libre editable;
- no puede definirse escribiendo un nombre en el formulario.

**Institución del logro**

- corresponde a `credentialSubject.institution_name`;
- describe la institución asociada al logro documentado;
- usa el label conceptual `Institución del logro`;
- no concede autoridad ni reemplaza al issuer.

Un valor escrito por el usuario nunca reemplaza:

- `issuerId`;
- membership;
- autorización backend.

El issuer summary ya es confiable como contexto institucional, pero todavía no
existe una regla de dominio que obligue a que coincida con
`credentialSubject.institution_name`. Hasta definir esa regla, el frontend no
debe precompletar o bloquear `Institución del logro`, ni mostrar dos campos
indistinguibles llamados `Institución`.

### `CreateCredentialDraftCommand`

El backend actual requiere:

```text
issuerId
subjectUserId
type
title
sourceType
credentialSubject
description?
hours?
academicCourseId?
externalCourseId?
metadata?
```

Reglas:

- `issuerId` proviene del contexto institucional, no de un campo editable;
- `subjectUserId` proviene de una selección/resolución autorizada;
- `credentialSubject` se construye desde campos conocidos;
- el MVP frontend no envía `rawData`;
- `academicCourseId` y `externalCourseId` son mutuamente excluyentes;
- `hours`, si existe, es mayor a cero;
- la validación frontend no reemplaza validación backend.

La resolución autorizada ya existe. El frontend debe completarla antes de
construir el command y nunca aceptar un UUID escrito por el operador.

### Allowlist frontend v0 de `credentialSubject`

El backend y `CredentialSummaryResponseDto` tratan `credentialSubject` como
objeto amplio. Esta allowlist frontend v0 limita qué puede normalizarse y
mostrarse.

| Campo | Soporte contractual actual | Tipo aceptado | Visibilidad |
|---|---|---|---|
| `achievement_name` | Schema compartido, hashing y emisión | String no vacío | Principal |
| `institution_name` | Schema compartido, hashing y emisión | String no vacío | Principal como `Institución del logro` |
| `program_name` | Contrato IA/backend contextual; fuera de `canon_v1` | String no vacío | Secundaria, cuando exista |
| `academic_period` | Schema compartido y hashing | String no vacío | Secundaria |
| `completion_date` | Schema compartido y hashing | Fecha `YYYY-MM-DD` válida | Secundaria |
| `grade` | Schema compartido y hashing | String no vacío o número finito | Condicionada por actor y política |
| `skills` | Schema compartido y hashing | Array de strings no vacíos | Lista estructurada opcional |
| `competencies` | Schema compartido y hashing | Array de strings no vacíos | Lista estructurada opcional |

Reglas:

- usar snake case como contrato frontend v0;
- aliases camelCase aceptados internamente por el hashing no se convierten en
  un contrato de presentación;
- descartar propiedades desconocidas;
- no renderizar claves arbitrarias;
- no mostrar objetos JSON;
- no asumir que todos los tipos de credencial contienen todos los campos;
- normalizar listas como strings limpios y descartar entradas inválidas;
- no aceptar objetos en `skills` o `competencies` con el contrato actual;
- `program_name` es contextual, no participa en `canon_v1`;
- grade y datos del titular requieren minimización por actor;
- cualquier ampliación de la allowlist exige revisión explícita.

Un DTO backend tipado para `credentialSubject` sigue siendo recomendable. La
allowlist frontend reduce exposición, pero no reemplaza ese contrato.

### `IssuerCredentialDetailVM`

Separar:

```text
identity
lifecycle
evidence
semanticAnalysis
allowedActions
readLimitations
```

`identity`:

- credential ID como navegación/technical detail;
- título;
- tipo;
- descripción;
- issuer solo si existe resumen seguro;
- titular solo si existe dato seguro.

`lifecycle`:

- estado de credencial;
- creación;
- emisión;
- revocación cuando exista;
- canonical hash y versión solo en detalle técnico.

`allowedActions`:

- emitir cuando el backend acepte la operación;
- analizar PDF para admin/operator;
- no inferir permisos por el contenido del DTO.

Limitación:

- el read actual es público y demo-grade;
- no existe ownership issuer-facing;
- el read de credencial no incluye issuer summary, aunque `/auth/me` sí lo
  expone para el contexto de sesión;
- no se puede reconstruir de forma completa y segura tras recarga.

### `IssueCredentialCommand`

```text
issuerId: command-only, derivado y no editable
issuedAt?: normalmente omitido para que el backend lo determine
```

`issuedAt` recibido desde UI no debe ofrecerse como edición general. Su soporte
es transitorio.

### `IssueCredentialActionVM`

```text
actionState
resultingCredentialStatus
issuedAt
canonicalHash: technical
canonicalizationVersion: technical
evidenceSummary
```

El resultado no se interpreta como verificación válida.

## 17. PDF y análisis formativo

### `PdfAnalysisFormModel`

```text
selectedFile
displayFileName
sizeBytes
mimeType
documentId?
pipelineVersion?
taxonomyVersion?
fieldErrors
actionState
```

Las versiones de pipeline y taxonomía no deben ser inputs visibles ordinarios.
Se reservan para configuración controlada o debugging autorizado.

### Validación local

- archivo requerido;
- MIME esperado `application/pdf`;
- tamaño mayor a cero;
- máximo 20 MB;
- nombre legible.

El backend además valida presencia de header PDF. La validación local no
garantiza que el documento sea procesable.

### `AnalyzePdfCommand`

Multipart real:

```text
file
documentId?
fileName?
pipelineVersion?
taxonomyVersion?
```

No envía:

- `issuerId`;
- `userId`;
- `credentialId` en body;
- hash;
- artifact.

El credential ID sale de la ruta.

### Estado de acción

```text
idle
| validating
| submitting
| success
| error
```

`validating` y `submitting` son estados locales. No significan que exista un
job persistido.

### `PdfAnalysisResultVM`

Visible principal:

- status;
- fecha;
- conteos de áreas, skills y conceptos;
- confidence del análisis;
- warnings;
- quality flags.

Visible técnico:

- schema version;
- semantic analysis ID;
- credential ID para navegación interna.

Prohibido:

- artifact completo;
- `analysisJson`;
- `textForEmbedding`;
- `evidenceMap`;
- payload FastAPI.

### Errores del flujo PDF

| Caso | Categoría frontend | Recuperación |
|---|---|---|
| Sin archivo o MIME inválido | `validation_error` | Revisar archivo |
| Más de 20 MB | `unprocessable_input` | Elegir archivo menor |
| Header/PDF inválido | `unprocessable_input` | Elegir PDF válido |
| Credencial inexistente | `resource_not_found` | Volver al contexto |
| Sin membership | `permission_denied` | Volver |
| AI Service sin configurar o caído | `ai_service_unavailable` | Reintentar luego |
| Timeout | `timeout` | Reintentar de forma explícita |
| Upstream inválido o no JSON | `ai_gateway_error` | Reintentar/reportar |
| Artifact inválido | `unexpected_response` | Reportar incompatibilidad |

No mostrar progreso porcentual ni procesamiento en segundo plano.

## 18. Wallet y credenciales del titular

### `HolderCredentialListItemVM`

```text
id: navegación interna
title
issuer
credentialType
issuedDate
revokedDate
credentialStatus
analysisStatus
evidenceStatus
profileEligibility
technicalIdentifiers: optional
```

El response real incluye:

- `status`;
- `latestSemanticAnalysis`;
- issuer summary;
- latest BlockchainRecord;
- canonical hash y versión.

Por eso contiene datos suficientes para derivar elegibilidad:

```text
status === issued
AND latestSemanticAnalysis !== null
```

Ownership no se deriva en frontend: el endpoint ya filtra por usuario del JWT.

### Elegibilidad

| Condición | `eligible` | `reasonCode` |
|---|---:|---|
| issued con latest analysis | true | null |
| revoked | false | `revoked` |
| issued sin latest analysis | false | `missing_analysis` |
| status desconocido | false | `unknown` |
| shape insuficiente | false | `unsupported` |

Las no elegibles:

- siguen visibles;
- no se pueden seleccionar;
- muestran razón centralizada;
- no aparecen como pendientes.

### `HolderCredentialDetailVM`

Visible principal:

- título;
- issuer name;
- tipo;
- estado;
- fecha de emisión;
- descripción cuando existe.

Visible secundario:

- titular;
- campos permitidos de `credentialSubject`;
- análisis resumido;
- evidencia;
- revocación y motivo;
- warnings.

Detalle técnico:

- credential ID;
- schema version;
- canonical hash;
- canonicalization version;
- contract address;
- transaction hash;
- issuer address;
- pipeline y taxonomy version cuando aportan trazabilidad.

Estos campos son condicionales:

- solo llegan al view model cuando el DTO inspeccionado los contiene de forma
  segura;
- un campo permitido en detalle técnico no está disponible necesariamente en
  todos los endpoints;
- ausencia, null o falta de soporte se expresa con `DataPresence` o una
  variante específica;
- no inventar contract address ni issuer address;
- no leer artifacts u objetos amplios para completarlos;
- no encadenar endpoints públicos para obtenerlos;
- el futuro inventario de componentes debe aceptar detalles técnicos
  opcionales y normalizados, nunca la response original.

Descartado:

- metadata desconocida por defecto;
- cualquier propiedad de `credentialSubject` no allowlisted;
- campos adicionales de áreas, skills o conceptos no reconocidos;
- IDs no requeridos por el componente.

No disponible:

- artifact semántico completo;
- `rawData`;
- historial de análisis;
- estado on-chain en tiempo real.

### Descriptores semánticos seguros

Para áreas, skills y conceptos, el adapter acepta como mínimo:

```text
id: string
label: non-empty string
confidence: number | null, si existe y es válida
confidenceMethod: known value, si existe
```

Descarta propiedades adicionales antes del view model.

## 19. Perfil formativo

### Responses reales

`GET /me/profile/current` y `POST /me/profile/build-from-ai` devuelven
`CurrentProfileResponseDto`.

La response incluye:

```text
userId
currentProfile:
  id
  profileVersion
  isCurrent
  credentialsCount
  totalHours
  areasSummary
  skillsSummary
  qualityFlags
  generatedAt
  profileJson
```

`profileJson` es adapter-only y se descarta después de extraer datos
allowlisted.

### Versiones soportadas

El adapter discrimina:

```text
formative_profile_result_v0
backend_formative_profile_snapshot_v0
unknown
```

Para `formative_profile_result_v0`:

- validar la shape conocida del artifact;
- extraer summary, áreas, skills, conceptos, confidence, fuentes, warnings,
  limitaciones y fecha;
- no entregar el artifact al componente.

Para `backend_formative_profile_snapshot_v0`:

- validar su shape mínima;
- extraer áreas, skills, conceptos, confidence y warnings;
- no mostrar su nombre interno ni método;
- no ofrecer rebuild.

Para una versión desconocida:

- no renderizar objetos arbitrarios;
- devolver una variante segura `unsupported`;
- no renderizar `profileJson` como fallback;
- no inventar contenido;
- no tratarla como `empty`;
- no depender de conservar un perfil anterior en memoria.

### `CurrentProfileVM`

```text
{ kind: "empty" }
| {
    kind: "available",
    profile: SafeFormativeProfileVM
  }
| {
    kind: "unsupported",
    generatedAt: DisplayDateVM | null,
    profileReference: adapter-only
  }
```

`SafeFormativeProfileVM` contiene:

```text
id: adapter-only
generatedAt: DisplayDateVM
summary
areas: FormativeProfileAreaVM[]
skills: FormativeProfileSkillVM[]
concepts: FormativeProfileConceptVM[]
totalHours: known value or unavailable
sourceCount: discriminated
confidence: analysis confidence
warnings
limitations
technicalDetails
```

Esta es la misma definición normativa de la sección de modelos discriminados.
No existe una cuarta variante implícita.

### Conteos

Para perfil IA:

- `credentialsCount` persistido usa hoy `generatedFrom.artifactCount` como
  aproximación técnica;
- no debe mostrarse como `Credenciales`;
- usar `Fuentes analizadas` solo si `profileJson.generatedFrom.artifactCount`
  valida y confirma esa semántica.

Para fallback backend:

- `credentialsCount` se deriva de credenciales issued;
- puede presentarse como credenciales consideradas si la versión fue
  validada;
- no exponer el nombre técnico del método.

Si la semántica no puede confirmarse, omitir el conteo.

### Horas

- no transformar `null` en `0`;
- mostrar horas solo cuando el adapter las reconoce como confiables;
- en el artifact IA, las horas provienen de suma de `areas[].hours`;
- un `0` persistido puede significar ausencia técnica en algunos perfiles IA;
- el adapter debe revisar el artifact antes de presentar `0 h`.

### `BuildProfileFormModel`

```text
availableCredentials
selectedCredentialIds
selectionErrors
actionState
```

### `BuildProfileCommand`

```text
credentialIds: non-empty unique string array
```

No contiene `userId`. El backend lo obtiene del JWT.

### Reglas de build

- no enviar selección vacía;
- el backend revalida ownership, issued y latest analysis;
- revoked y missing analysis no son seleccionables;
- un error transitorio no elimina el perfil current anterior en la UI;
- el frontend no ejecuta Python;
- el frontend no envía artifacts;
- `POST /me/profile/rebuild` no tiene CTA, navegación ni alternativa visible.

## 20. Verificador Público

### `VerificationResultVM`

El adapter produce una variante según `verificationStatus` o HTTP `404`.

Campos comunes para variantes con resultado:

- credential title;
- credential status;
- issued/revoked dates;
- revocation reason cuando existe;
- evidence summary;
- semantic summary;
- technical details.

### Issuer

`VerifyCredentialResponseDto` no incluye issuer.

El view model usa:

```text
issuer: { kind: "unsupported" }
```

Reglas:

- no inventar nombre, DID o address;
- no consultar `GET /credentials/:id` para completarlo;
- no mostrar UUID como identidad;
- omitir el bloque o presentar ausencia transparente;
- pasar a issuer disponible solo cuando verify entregue un summary seguro.

### Evidencia

El DTO entrega records persistidos:

```text
id
network
chainId
transactionHash
recordedAt
status
```

No entrega:

- contract address;
- issuer address;
- evidencia mode;
- resultado de una consulta on-chain en tiempo real.

La UI no afirma que verificó el contrato en ese momento.

### Semantic summary

Puede mostrar:

- completed/partial;
- fecha;
- confidence;
- áreas, skills y conceptos sanitizados;
- quality flags.

No muestra artifact, evidence map, embedding ni pipeline internals como
contenido principal.

### Deep link

Acceso por credential ID:

- no equivale a sharing seguro;
- no afirma QR;
- no implica consentimiento;
- no registra historial visible.

## 21. Evidencia y entorno

La evidencia usa dimensiones separadas.

### Estado de registro

```text
registrationStatus:
  registered
  | unavailable
  | unknown
```

Además se conserva:

```text
recordStatus:
  registered
  | revoked
  | unknown
```

Un record revocado sigue demostrando que existió un registro; su lifecycle no
debe perderse.

### Entorno

```text
environment:
  public_network
  | local_anvil
  | mock
  | unknown
```

### Limitación actual

El backend persiste tanto el modo mock como
`credential_registry_anvil` con:

```text
network = anvil
chainId = 31337
```

Por lo tanto, el DTO actual no permite distinguir honestamente:

- transacción real en Anvil;
- record mock con txHash determinístico.

Regla v0:

- no inferir mock por contract address o formato del txHash;
- conservar `network = anvil` como dato técnico;
- usar `environment = unknown`;
- el label visible puede indicar `Entorno local/demo`;
- no afirmar blockchain productiva.

Cuando el backend exponga un origen confiable:

- `credential_registry_anvil` se mapea a `local_anvil`;
- `mock` se mapea a `mock`;
- `base_sepolia` o `base_mainnet`, si existe evidencia real confirmada, se
  mapea a `public_network`.

### `EvidenceStatusVM`

```text
registrationStatus
recordStatus
environment
networkLabel
registeredAt
transactionId: DisplayIdentifierVM | null
technicalDetails
provenanceKnown: boolean
```

No se expone ethers ni un cliente blockchain.

## 22. Confidence

Confidence pertenece al análisis, no a la persona.

### Modelo conceptual

```text
score: number | null
band: high | medium | low | unavailable | null
method:
  measured
  | derived
  | heuristic
  | qualitative_only
  | unavailable
  | unknown
explanation: optional safe text
drivers: safe string list
limitations: safe string list
```

Reglas:

- no mostrar `84% competente`;
- no usarla como nivel de skill;
- no usar estrellas, ranking o progreso personal;
- `null`, ausencia y `unavailable` no son cero;
- mostrar `Confianza no disponible` cuando corresponda;
- no inventar thresholds para alta, media o baja;
- conservar score, band y provenance como dimensiones separadas;
- mantener warnings y partial reasons aunque el score sea alto;
- no exponer detalles experimentales del pipeline.

En `semantic_analysis_v1`, el backend puede entregar score global numérico y
método en estructuras internas. Los DTOs seguros actuales no siempre exponen
el método.

En `formative_profile_result_v0`, el contrato usa confidence cualitativa:
`band`, `score: null` y `scoreMethod`.

## 23. Fechas, números y formato `es-AR`

### Fechas

- preservar ISO original;
- parsear una sola vez en formatter compartido;
- mostrar fecha legible, por ejemplo `25 jul 2026`;
- usar horario de 24 horas cuando se muestre hora;
- no usar ISO como label principal;
- si el ISO es inválido, producir estado `unknown`, no `Invalid Date`;
- no asumir timezone local para ordenar sin conservar el instante.

### Identificadores

- abreviar solo para presentación;
- conservar valor raw para copiar;
- mostrar completos solo en detalle técnico;
- no usar ID como nombre del issuer, titular o credencial;
- no truncar destructivamente en el adapter.

### Horas

- mostrar `64 h`;
- conservar valor numérico para orden o cálculo;
- no convertir `null` en `0`;
- no sumar horas en componentes;
- no mostrar horas si la procedencia es ambigua.

### Números

- usar formatter central `es-AR`;
- no recibir strings preformateados como única representación;
- normalizar `hours` string del transport a número solo si es finito y válido;
- conservar precision necesaria para datos técnicos.

## 24. Taxonomía de errores

Categorías:

```text
validation_error
invalid_credentials
authentication_required
session_expired
permission_denied
resource_not_found
state_conflict
unprocessable_input
ai_service_unavailable
ai_gateway_error
timeout
network_error
unexpected_response
unknown_error
```

El mapping considera:

```text
operación
+ status HTTP
+ error code o detail seguro
+ contexto
```

No existe un único mensaje global por status.

Reglas auth:

- `invalid_credentials` corresponde al fallo de login y permite revisar email
  y password;
- `authentication_required` corresponde a una ruta protegida sin sesión y
  permite iniciar sesión con `returnTo` interno seguro;
- `session_expired` corresponde a una sesión previamente válida rechazada y
  exige limpiar sesión local antes de volver a login;
- ninguna de estas categorías se decide solo por `401`.

### Matriz orientativa

| Operación | Señal | Categoría | Interpretación |
|---|---|---|---|
| Login | 401 | `invalid_credentials` | Email/password inválidos o usuario inactivo |
| Ruta protegida sin sesión | 401 | `authentication_required` | Debe iniciar sesión |
| `/auth/me` con sesión previa rechazada | 401 | `session_expired` | Limpiar sesión y volver a autenticar |
| Draft | 400 | `validation_error` | Campos o reglas inválidas |
| Draft | 404 | `resource_not_found` | Issuer o titular no existe |
| Issue | 401 | `authentication_required` | Falta sesión |
| Issue | 403 | `permission_denied` | Sin membership o rol |
| Issue | 404 | `resource_not_found` | Credencial inexistente |
| Issue | 409 | `state_conflict` | Credencial no está draft |
| PDF | 400 | `unprocessable_input` | Archivo o metadata inválidos |
| PDF | 403 | `permission_denied` | Sin permiso institucional |
| PDF | 422 | `unprocessable_input` | AI Service no procesa input |
| PDF | 502 | `ai_gateway_error` | Respuesta upstream inválida |
| PDF | 503 | `ai_service_unavailable` | Configuración o servicio caído |
| PDF | 504 | `timeout` | Tiempo agotado |
| Wallet detail | 404 | `resource_not_found` | No existe, es draft o no pertenece |
| Profile build | 400 | `validation_error` | Selección vacía, no issued o sin análisis |
| Profile build | 403 | `permission_denied` | Credencial ajena |
| Profile build | 404 | `resource_not_found` | Credencial inexistente |
| Profile build | 502/503/504 | error IA correspondiente | Fallo de integración |
| Verify | 404 | variante `not_found` | Credencial no encontrada |
| Cualquier operación | sin response | `network_error` | Backend no accesible |
| Cualquier lectura | shape inválida | `unexpected_response` | Contract drift |

### Mensajes visibles

- no usan el status HTTP como título;
- no muestran stack trace;
- no exponen detail interno sin sanitizar;
- ofrecen recuperación cuando es posible;
- conservan datos editables del formulario;
- no modifican estados persistidos por un fallo transitorio;
- diferencian 404 privado de 404 público;
- no muestran sesión expirada como credenciales incorrectas;
- no muestran detail backend o upstream sin mapping y sanitización.

## 25. Responses demo-grade

Endpoints afectados:

```text
POST /credentials/draft
GET  /credentials/:id
GET  /credentials/:id/status
GET  /credentials/:id/semantic-analysis/latest
```

Reglas:

- no son contratos frontend productivos;
- usar transport models mínimos;
- aplicar allowlists;
- nunca usar spread de response;
- no encadenarlos para inventar datos;
- no completar issuer en verify;
- no persistirlos para simular continuidad;
- no ampliar el producto apoyándose en su exposición pública;
- una restricción de UI no corrige la exposición backend.

### Latest semantic analysis

`CredentialLatestSemanticAnalysisResponseDto` contiene:

- `analysisJson`;
- `textForEmbedding`;
- `evidenceMap`;
- arrays semánticos amplios.

El adapter:

- extrae solo status, fecha, confidence, quality flags y descriptores
  allowlisted;
- descarta `analysisJson`;
- descarta `textForEmbedding`;
- descarta `evidenceMap` salvo que exista un futuro contrato visible;
- no entrega el transport model a componentes.

### Continuidad durante el request

La respuesta de `POST .../from-pdf` ya es un resumen seguro y puede alimentar
el resultado inmediato.

Después de recargar:

- el read público puede recuperar latest analysis;
- sigue siendo demo-grade y sobredimensionado;
- no debe guardarse el artifact en `localStorage`;
- un read protegido y resumido es el contrato backend recomendado.

## 26. Campos prohibidos y niveles de acceso

### Prohibidos para todos los componentes

- `analysisJson`;
- `profileJson` completo;
- `textForEmbedding`;
- artifacts IA completos;
- `rawData`;
- prompts;
- embeddings;
- stack traces;
- configuración interna;
- secrets;
- private keys;
- modelos internos de Prisma;
- objetos ethers;
- clientes blockchain;
- responses completas de FastAPI;
- campos desconocidos de DTOs amplios;
- HTML crudo;
- Markdown no validado;
- URLs no validadas;
- mensajes backend o upstream sin sanitizar.

### Permitidos solo en detalle técnico

- canonical hash completo;
- canonicalization version;
- schema version;
- pipeline version;
- taxonomy version;
- network;
- chain ID;
- contract address;
- transaction hash;
- issuer address;
- IDs de análisis cuando aportan trazabilidad.

### Permitidos solo para navegación interna

- credential ID;
- profile ID;
- user ID cuando la capa de sesión lo requiere;
- semantic analysis ID;
- BlockchainRecord ID.

### Command-only

- `issuerId`;
- `subjectUserId`;
- `credentialIds`;
- `issuedAt`, si se utiliza;
- metadata opcional aprobada;
- versiones opcionales controladas del análisis.

### Adapter-only

- enums crudos;
- IDs usados para relacionar;
- `profileVersion`;
- estructuras amplias usadas para extraer una allowlist;
- status HTTP y códigos upstream;
- valores raw de fecha y número.

Regla:

> Un adapter utiliza una allowlist explícita. Nunca construye un view model
> mediante spread de la response completa.

## 27. Gaps backend y contratos recomendados

| Gap | View model afectado | Dato faltante | Workaround demo permitido | Workaround prohibido | Contrato recomendado |
|---|---|---|---|---|---|
| Sin listado issuer-facing | `IssuerCredentialListItemVM` | Colección institucional | Navegar al detalle recién creado o ID preparado | Lista hardcodeada | Read protegido por issuer con paginación |
| Issuer activo vs `institution_name` sin regla | Draft y detalle | Relación entre autoridad emisora e institución del logro | Labels diferenciados | Tratar texto libre como autorización | Regla de dominio y DTO que indiquen coincidencia o diferencia |
| Reads institucionales públicos | `IssuerCredentialDetailVM` | Ownership issuer-facing | Direct ID demo con allowlist | Reutilizar para producto | Reads protegidos por membership |
| Latest semantic público amplio | `SemanticAnalysisSummaryVM` | DTO seguro | Usar resumen inmediato del POST | Guardar artifact o pasar response | Read protegido y resumido |
| Verify sin issuer | `VerificationResultVM` | Issuer name, DID y referencia | Omitir bloque o ausencia transparente | Encadenar GET genérico | Issuer summary dentro de verify DTO |
| Sin política pública explícita de PII | `VerificationResultVM` | Titular, DID, email y grade permitidos | Omitir PII | Exponer por estar persistida o por ID | Política de exposición y DTO público minimizado |
| `credentialSubject` sin DTO cerrado | Draft y detalles | Shape y visibilidad por actor | Allowlist frontend v0 | Render genérico de JSON | DTO versionado y tipado |
| Sin análisis desde texto | PDF/form futuro | Command y resultado textual | No mostrar acción | Simular análisis | Endpoint institucional protegido |
| Sin jobs/progreso | Action state | Job ID y status | Loader indeterminado del request | Porcentaje fake | Job async con polling/eventos |
| Sin storage de PDFs | PDF form | Referencia durable | Selección local durante request | Persistir PDF en browser | Storage + referencia autorizada |
| Sin QR/sharing | Verify/navigation | Grant o token | Ingreso manual de ID | QR que solo disfraza un ID | Sharing grant revocable |
| Sin revocación completa | Lifecycle | Command y permisos | No mostrar acción | Botón sin backend | Endpoint protegido de revocación |
| Sin paginación issuer-facing | Lista issuer | Cursor/total/filtros | No implementar lista completa | Filtrar datos hardcodeados | Endpoint paginado |
| Evidencia mock/Anvil indistinguible | `EvidenceStatusVM` | Origen o mode | Label local/demo y `unknown` | Inferir por hash/address | `evidenceOrigin` seguro en DTO |
| Perfil DTO expone `profileJson` | `CurrentProfileVM` | DTO de presentación seguro | Parser por versión y descarte | Pasar JSON a componentes | DTO tipado sin artifact completo |
| `credentialsCount` ambiguo en perfil IA | `CurrentProfileVM` | Semántica de conteo | Validar `artifactCount` como fuentes | Mostrar como credenciales | Campo discriminado `sourceCount` |
| Perfil sin generation method en DTO | `CurrentProfileVM` | Provenance visible segura | Discriminar por profileVersion | Inventar método | Provenance resumida y controlada |

No se modifica backend en esta tarea.

## 28. Orden recomendado de implementación

1. Cliente HTTP exclusivo para NestJS.
2. Transport models mínimos por endpoint.
3. Validación runtime mínima de transport.
4. Adapters con allowlists.
5. Formatters compartidos `es-AR`.
6. Taxonomía de errores por operación.
7. Display primitives compartidos.
8. Mappings de estados de dominio.
9. Modelos de auth y contexto.
10. Modelos del Portal del Emisor mínimo.
11. Modelos de Wallet y credenciales.
12. Modelos de perfil formativo.
13. Modelos del Verificador.
14. Inventario de componentes.
15. Especificaciones de pantallas.
16. Implementación visual.

No pasar a pantallas consumiendo responses crudas como solución temporal.

## 29. Riesgos y mitigaciones

| Riesgo | Consecuencia | Mitigación |
|---|---|---|
| DTO directo en JSX | Acoplamiento y fuga de campos | Adapter obligatorio |
| Spread de response amplia | Contract drift invisible | Allowlist explícita |
| Artifacts en componentes | Datos internos y payload pesado | Extraer y descartar |
| Opcionales mal interpretados | UI falsa | Presencia discriminada |
| Error por HTTP sin contexto | Mensaje incorrecto | Mapping por operación |
| Confidence como habilidad | Claim dañino | Modelo de confianza del análisis |
| Artifact count como credenciales | Conteo engañoso | Source count discriminado |
| Mock como blockchain real | Claim falso | Entorno separado y provenance |
| Anvil confundido con mock | Pérdida de trazabilidad | No inferir; gap backend |
| Request state como dominio | Pending ficticio | Namespaces separados |
| Form model igual a command | IDs y campos técnicos visibles | Adapter de comando |
| ID como identidad | UX pobre y fuga de modelo | Display labels y technical detail |
| View model enorme opcional | Combinaciones imposibles | Unions discriminadas |
| Solo dato preformateado | Sin orden ni semántica | Conservar machine value |
| Adapter inventa faltantes | UI no defendible | Unsupported/unknown explícitos |
| LocalStorage con responses | Persistencia insegura | Cache controlada futura |
| Parser genérico de JSON | XSS conceptual y datos crudos | Shapes versionadas y allowlists |
| DTO cambia sin revisión | Regresión silenciosa | Revisar al cambiar snapshot |
| Issuer activo confundido con `institution_name` | Autoridad falsa | Labels y modelos separados |
| Allowlist de `credentialSubject` indefinida | JSON arbitrario en UI | Allowlist v0 explícita |
| PII expuesta al verificador | Incidente de privacidad | Matriz por actor y omisión por defecto |
| HTML o Markdown no confiable | Inyección de contenido | Texto plano y sanitización contractual futura |
| Detail backend mostrado directamente | Fuga de información interna | Error mapping y allowlist |
| Sesión expirada como login inválido | Recuperación confusa | Tres categorías auth separadas |
| Campos técnicos asumidos presentes | Datos inventados o errores | `DataPresence` y DTO confirmado |

## 30. Decisiones cerradas

- componentes consumen view models, no DTOs;
- API client consume únicamente NestJS;
- transport models no llegan a JSX;
- adapters usan allowlists;
- estados de request y dominio están separados;
- null, ausencia, vacío, ocultado y no soportado son distintos;
- profile y verification usan modelos discriminados;
- `profileJson` y `analysisJson` no llegan a componentes;
- elegibilidad usa issued y latest analysis;
- el build de perfil no envía user ID;
- rebuild queda fuera de la UI MVP;
- `CurrentProfileVM` tiene exactamente tres variantes;
- institución emisora e institución del logro son conceptos distintos;
- `credentialSubject` usa una allowlist frontend v0;
- la privacidad se define por actor, no por persistencia;
- contenido dinámico se trata como texto no confiable;
- auth diferencia credenciales inválidas, falta de sesión y sesión expirada;
- issuer ausente en verify no se inventa;
- mock y Anvil no se infieren desde heurísticas;
- labels visibles son `es-AR`;
- valores de máquina se preservan;
- IDs completos se reservan para detalle técnico.

## 31. Decisiones pendientes

No cerrar todavía:

- estructura definitiva de carpetas;
- nombres exactos de archivos;
- librería HTTP;
- React Query o SWR;
- state management;
- Zod u otra librería de validación;
- almacenamiento de sesión;
- refresh de sesión;
- componentes finales;
- props definitivas;
- layouts;
- microcopy definitivo;
- i18n completo;
- estrategia de cache;
- persistencia offline;
- telemetría frontend.

Se pueden aplicar estos criterios sin seleccionar dependencias.

## 32. Criterios de aceptación

El documento es aceptable si:

- inspecciona endpoints y DTOs reales;
- registra branch y commit;
- separa transport, adapter, view model, form y command;
- clasifica campos;
- exige allowlists;
- `CurrentProfileVM` tiene una única definición con `empty`, `available` y
  `unsupported`;
- `empty` corresponde solo a `currentProfile: null`;
- diferencia institución emisora e institución del logro;
- define una allowlist explícita para `credentialSubject`;
- incluye una matriz de visibilidad y privacidad por actor;
- trata contenido dinámico como texto no confiable;
- diferencia `invalid_credentials`, `authentication_required` y
  `session_expired`;
- incluye datos técnicos solo cuando el DTO los provee;
- diferencia ausencia, null, vacío, ocultado y no soportado;
- usa modelos discriminados;
- separa estados de dominio y request;
- no mezcla mock y Anvil;
- define errores por operación;
- protege artifacts;
- no confunde conteos;
- trata confidence como confianza del análisis;
- mantiene formato `es-AR`;
- conserva valores de máquina;
- respeta actores y rutas aprobadas;
- no expone rebuild al titular;
- documenta gaps;
- no diseña pantallas;
- no implementa código;
- no modifica backend.

## 33. Próximo documento recomendado

Crear después:

```text
docs/frontend/frontend-component-inventory-v0.md
```

Ese documento debe usar estos view models para definir:

- componentes;
- responsabilidades;
- variantes;
- estados;
- reutilización;
- límites entre componentes de dominio y primitivas visuales;
- qué componente acepta cada view model;
- qué componente nunca recibe datos de transporte.

No debe reabrir marca, arquitectura de información ni contratos de datos.

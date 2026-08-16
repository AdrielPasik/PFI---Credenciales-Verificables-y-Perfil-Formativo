# Traza: Especificación de pantallas del Portal del Emisor v0

## 1. Propósito

Este documento define la primera especificación normativa de pantallas de
Traza. Su alcance es el vertical institucional mínimo:

```text
Login
-> Entrada del Emisor
-> Crear draft
-> Detalle recién creado
-> Emitir credencial
-> Mostrar evidencia
-> Subir PDF
-> Mostrar resultado del análisis
```

La especificación traduce la arquitectura de información, los view models y
el inventario de componentes en composiciones implementables. No contiene
wireframes gráficos ni decisiones de implementación React.

Estado:

```text
versión: v0
carácter: normativo
alcance: primer vertical slice del Portal del Emisor
locale: es-AR
```

## 2. Snapshot y fuentes

Snapshot usado:

```text
fecha: 2026-07-27
branch: main
commit: e7319e1
backend inspeccionado:
  services/api/src/auth
  services/api/src/credentials
  services/api/src/issuers
  services/api/src/ai
  services/api/src/blockchain
documentación inspeccionada:
  docs/frontend/frontend-brand-and-design-system-v0.md
  docs/frontend/frontend-information-architecture-v0.md
  docs/frontend/frontend-data-and-view-models-v0.md
  docs/frontend/frontend-component-inventory-v0.md
  docs/frontend/frontend-roadmap-v0.md
  docs/frontend/ui-ux-handoff-context-v0.md
  docs/demo/ai-end-to-end-demo-script-v0.md
  docs/architecture/ai-frontend-ready-flow-v0.md
  docs/architecture/ai-http-backend-integration-v0.md
```

Esta screen specification corresponde a ese snapshot. Debe revisarse si
cambian endpoints, DTOs, permisos, view models o componentes normativos.

Actualizaciones posteriores al snapshot base:

- P0.1 protegió `POST /credentials/draft`.
- P0.2 agregó issuer summaries seguros en `GET /auth/me`.
- P0.3 agregó resolución autorizada del titular por email exacto.

Precedencia:

1. Backend real para comportamiento, requiredness, permisos y errores.
2. `frontend-data-and-view-models-v0.md` para modelos, adapters y privacidad.
3. `frontend-information-architecture-v0.md` para rutas y disponibilidad.
4. `frontend-brand-and-design-system-v0.md` para marca y reglas visuales.
5. `frontend-component-inventory-v0.md` para componentes y responsabilidades.
6. Este documento para composición, jerarquía e interacción por pantalla.

## 3. Rutas y alcance

Rutas cubiertas:

```text
/login
/issuer
/issuer/credentials/new
/issuer/credentials/[credentialId]
```

Rutas no implementables desde esta especificación:

```text
/issuer/credentials
/issuer/settings
/issuer/users
```

`/issuer/credentials` permanece reservada y bloqueada porque no existe un
listado issuer-facing protegido. No se crea página, navegación, tabla ni
placeholder para esa ruta.

### Matriz de rutas

| Ruta | Actor | Objetivo | Disponibilidad | Backend principal | Dependencia o límite |
|---|---|---|---|---|---|
| `/login` | Usuario sin sesión válida | Autenticar y resolver contexto | A | `POST /auth/login`, `GET /auth/me` | Sin refresh token |
| `/issuer` | `admin` u `operator` activo | Entrada institucional honesta | B | `GET /auth/me` | Issuer summary disponible; selector multi-issuer no implementado |
| `/issuer/credentials/new` | `admin` u `operator` activo | Resolver titular y crear draft demo-grade | B | `POST /issuers/:issuerId/holders/resolve`, `POST /credentials/draft` | Flujo disponible; selector multi-issuer pendiente |
| `/issuer/credentials/[credentialId]` | `admin` u `operator` activo | Emitir, ver evidencia y analizar PDF | B | Reads por ID, issue y análisis PDF | Reads públicos y acceso por ID conocido |

La disponibilidad B no permite datos fake ni seguridad simulada. Exige hacer
visibles las limitaciones cuando afecten la operación.

## 4. Fuera de alcance

Este documento no define:

- JSX;
- CSS;
- archivos o carpetas;
- hooks;
- API client;
- React Query o SWR;
- state management;
- almacenamiento del JWT;
- validación runtime frontend;
- props TypeScript definitivas;
- implementación de adapters;
- componentes nuevos;
- páginas o rutas Next.js;
- wireframes gráficos;
- mockups.

Tampoco incorpora:

- listado institucional;
- analytics;
- revocación;
- sharing o QR;
- jobs;
- progreso porcentual;
- storage de PDFs;
- MetaMask;
- frontend blockchain;
- conexión directa con FastAPI;
- carga de formación por el titular.

## 5. Principios obligatorios

- la pantalla obtiene view models mediante orquestación;
- los componentes no reciben DTOs ni responses crudas;
- ninguna pantalla llama FastAPI directamente;
- no se renderizan artifacts, `analysisJson`, `profileJson`,
  `textForEmbedding`, `evidenceMap` ni `rawData`;
- no se inventa issuer summary;
- no se usa un UUID como nombre de institución o titular;
- un route guard frontend no representa seguridad backend;
- no se inventa listado institucional;
- no se inventa búsqueda de titulares;
- no se inventan jobs, progreso ni segundo plano;
- emisión, evidencia, análisis y verificación conservan estados separados;
- evidencia local/demo no se presenta como blockchain productiva;
- el holder no usa MetaMask ni firma transacciones;
- el Portal del Emisor funciona en pantallas pequeñas;
- una futura carga textual corresponde a `admin` u `operator`, nunca al
  titular.

Todo texto dinámico se trata como no confiable y se presenta como texto plano.

## 6. Orquestación y presentación

### Orquestación de pantalla

Responsable de:

- leer y resolver sesión;
- cargar datos desde NestJS;
- validar transport models;
- ejecutar adapters;
- mantener read y action states;
- construir commands;
- ejecutar requests;
- manejar navegación y redirects;
- coordinar foco después de una transición;
- preservar datos editables ante errores recuperables;
- aplicar una nueva response adaptada o realizar un refetch controlado;
- seleccionar los view models para cada componente.

### Presentación

Responsable de:

- renderizar view models;
- capturar datos del formulario;
- emitir intenciones;
- mostrar estados y feedback;
- presentar errores seguros;
- aplicar responsive;
- cumplir los contratos de accesibilidad.

Los componentes no hacen fetching, no interpretan DTOs y no deciden permisos
efectivos.

## 7. Flujo institucional global

```text
sesión ausente
-> /login

login exitoso
-> /auth/me
-> membership activa admin/operator
-> /issuer

/issuer
-> Crear credencial
-> /issuer/credentials/new

draft creado
-> /issuer/credentials/[credentialId]

credencial draft
-> emitir
-> credencial issued + evidencia

credencial issued
-> seleccionar PDF
-> analizar
-> resultado completed o partial
```

No existe una transición hacia `/issuer/credentials`.

### Matriz de acciones y habilitación

| Ruta | Acción primaria | Acciones secundarias | Regla de habilitación | Resultado esperado |
|---|---|---|---|---|
| `/login` | Iniciar sesión | Ninguna funcional en v0 | Campos mínimos válidos y request idle | Resolver contexto y redirigir |
| `/issuer` | Crear credencial | Cerrar sesión | Contexto emisor operativo | Abrir nueva credencial |
| `/issuer/credentials/new` | Guardar borrador | Volver al inicio | Form válido, issuer contextual y titular resuelto vigente | Crear draft y redirigir al detalle |
| `/issuer/credentials/[credentialId]` draft | Emitir credencial | Copiar identificador técnico; volver al inicio | VM draft, allowed action y request idle | Actualizar lifecycle y evidencia |
| `/issuer/credentials/[credentialId]` issued sin análisis | Analizar contenido | Seleccionar/reemplazar PDF; copiar detalle técnico | VM issued, PDF válido y request idle | Persistir y mostrar análisis |
| `/issuer/credentials/[credentialId]` analyzed | Ninguna primaria nueva | Expandir detalle y copiar valores permitidos | Resultado seguro disponible | Mantener lectura del resultado |

Las reglas visuales de habilitación no sustituyen la autorización backend.
Una acción disabled conserva una explicación cuando la causa sea útil y
segura.

## 8. Especificación de `/login`

### Contrato de pantalla

| Dimensión | Definición |
|---|---|
| Actor | Usuario sin sesión o con sesión inválida |
| Objetivo | Iniciar sesión y resolver el contexto correcto |
| Disponibilidad | A |
| Precondición | Backend disponible y configuración JWT válida |
| Entrada | Navegación directa, redirect de ruta protegida o sesión expirada |
| Salida | `/issuer` o `/wallet/credentials` |
| Modelos | `LoginFormModel`, `LoginCommand`, `SessionVM`, `FeedbackErrorVM`, `AsyncActionStateVM` |
| Componentes | `AuthLayout`, logo Traza para superficie clara, `LoginForm`, `FormField`, `TextInput`, `Button`, `InlineError`, `FeedbackAlert`, `ActionFeedback` |

No requiere un `ProductHeader` completo. `AuthLayout` ofrece una composición
focal y mínima.

### Composición conceptual

| Orden | Región | Componente o contenido | Responsabilidad |
|---:|---|---|---|
| 1 | Marca | Logo Traza para superficie clara | Identificar el producto |
| 2 | Mensaje | Tagline institucional | Explicar propósito |
| 3 | Encabezado | Título de acceso | Nombrar la tarea |
| 4 | Formulario | `LoginForm` | Capturar email y password |
| 5 | Acción | `Button` primary | Emitir `onSubmitLogin` |
| 6 | Feedback | `InlineError`, `FeedbackAlert` | Errores de campo, auth o conectividad |
| 7 | Ayuda | Texto breve, solo si existe contenido real | Recuperación sin inventar soporte |

### Campos

| Campo visible | Modelo | Requerido | Normalización | Autocomplete | Preservación |
|---|---|---:|---|---|---|
| Email | `LoginFormModel.email` | Sí | Trim y lowercase al construir command | `email` o `username` según decisión técnica | Se conserva ante error |
| Contraseña | `LoginFormModel.password` | Sí | No trim ni transformación del valor | `current-password` | No se persiste después del request |

Validación local mínima:

- email no vacío y con formato plausible;
- password no vacío;
- validación útil sin bloquear la escritura;
- errores asociados al campo;
- password nunca registrado ni incluido en view models.

### Estados

| Estado | Presentación | Acción |
|---|---|---|
| `idle` | Formulario habilitado | Iniciar sesión |
| `submitting` | Inputs y submit protegidos de duplicación | Esperar request |
| `invalid_credentials` | Error persistente y comprensible | Revisar email y contraseña |
| `network_error` | Backend no alcanzable | Reintentar |
| Backend no disponible | Feedback de servicio | Reintentar más tarde |
| `unexpected_response` | Error seguro | Reintentar o reportar |
| `session_expired` | Explicación de sesión vencida | Iniciar nuevamente |
| Sesión ya válida | Sin mostrar formulario | Resolver `/auth/me` y redirigir |

`invalid_credentials`, `authentication_required` y `session_expired` no se
mezclan.

### Orquestación

```text
onSubmitLogin
-> validar LoginFormModel
-> construir LoginCommand
-> POST /auth/login
-> guardar sesión según decisión técnica futura
-> GET /auth/me
-> adaptar CurrentUserVM y UserContextVM
-> redirigir
```

Redirect:

```text
exactamente una membership operativa
-> /issuer

más de una membership operativa
-> selección explícita requerida
-> no elegir una silenciosamente
-> estado bloqueado para el vertical actual

ninguna membership operativa
-> /wallet/credentials
```

Una membership es operativa solo si está `active`, tiene rol `admin` u
`operator` y su `issuerAuthorizationStatus` es `authorized`. Una membership
activa con issuer `pending` o `revoked` es contexto conocido, pero no habilita
creación ni emisión.

No se crea selector de rol ni selector multi-issuer. Para la demo controlada se
asume un usuario con exactamente una membership operativa.

### Foco y accesibilidad

- un único `h1`;
- foco inicial en email cuando corresponde;
- labels visibles y asociados;
- submit mediante teclado;
- foco en el primer campo inválido;
- error de autenticación anunciado sin repetirlo;
- al volver por sesión expirada, foco en el mensaje y luego flujo lógico;
- tagline no reemplaza el título;
- password usa control semántico apropiado.

### Responsive

- columna focal;
- campos y CTA con target táctil;
- logo Traza y tagline legibles;
- sin header sobredimensionado;
- sin contenido decorativo que desplace el formulario;
- ancho de lectura contenido en desktop.

### Limitaciones

- no existe refresh token;
- logout es frontend;
- almacenamiento técnico de sesión queda pendiente;
- no existe recuperación de contraseña en el MVP.

## 9. Especificación de `/issuer`

### Contrato de pantalla

| Dimensión | Definición |
|---|---|
| Actor | Usuario autenticado con membership activa `admin` u `operator` |
| Objetivo | Entrada institucional operativa y honesta |
| Disponibilidad | B |
| Precondición | Sesión válida y contexto emisor operativo |
| Entrada | Redirect posterior a login o navegación interna |
| Salida principal | `/issuer/credentials/new` |
| Modelos | `CurrentUserVM`, `UserContextVM`, `IssuerHomeVM`, `FeedbackErrorVM` |
| Componentes | `IssuerShell`, `ProductHeader`, `AuthenticatedUserMenu`, `IssuerNavigation`, `IssuerHomeIntro`, `Card`, `Button`, `FeedbackAlert`, `UnsupportedDataState` |

La disponibilidad se mantiene en B: `/auth/me` ya devuelve un issuer summary
seguro, pero el frontend y la selección explícita entre múltiples contextos
todavía no están implementados.

### Composición conceptual

| Orden | Región | Componente | Contenido permitido |
|---:|---|---|---|
| 1 | Shell | `IssuerShell` | Marca, sesión y navegación real |
| 2 | Identidad de sesión | `AuthenticatedUserMenu` | Email y cierre de sesión |
| 3 | Contexto | `IssuerHomeIntro` | Nombre, DID nullable, autorización institucional y rol |
| 4 | Introducción | Copy operativo | Explicación breve del flujo |
| 5 | Acción | `Button` primary | Crear credencial |
| 6 | Limitación | `FeedbackAlert` o `UnsupportedDataState` | Solo una limitación relevante para la demo |

### Contenido permitido

- marca Traza para header navy;
- identidad de sesión;
- rol operativo cuando aporte claridad;
- contexto institucional seguro;
- explicación del flujo;
- CTA de creación;
- logout.

### Contenido prohibido

- métricas;
- gráficos;
- actividad reciente;
- credenciales recientes;
- lista institucional;
- datos seed presentados como colección;
- UUID del issuer como nombre;
- selector multi-issuer;
- enlaces a rutas bloqueadas;
- cards vacías para llenar el inicio.

### Estados

| Estado | Tratamiento |
|---|---|
| Cargando contexto | `LoadingState` o skeleton estructural |
| Contexto operativo | Mostrar issuer name, DID cuando exista y rol |
| Issuer `pending` o `revoked` | Mostrar contexto conocido como no operativo y no habilitar creación |
| Contexto emisor no disponible | `UnsupportedDataState` y salida segura |
| Membership viewer | No habilitar portal; resolver contexto personal |
| Sesión expirada | Limpiar sesión y redirigir a login |
| Forbidden | Mensaje seguro sin exponer datos |
| Backend no disponible | `ErrorState` recuperable |

### Acción principal

```text
Crear credencial
-> /issuer/credentials/new
```

No se muestra un enlace a `Credenciales` mientras el listado permanezca
bloqueado.

### Foco y accesibilidad

- `IssuerShell` incluye skip link y landmarks;
- el `h1` identifica la entrada institucional;
- el CTA tiene label explícito;
- el rol no se comunica solo mediante badge o color;
- el menú de usuario es operable por teclado;
- el contexto ausente se explica, no se representa con UUID.

### Responsive

- contenido simple y focal;
- CTA visible;
- navegación adaptable;
- logout siempre accesible;
- no se establece tablet como mínimo;
- ningún bloque depende de hover;
- la navegación móvil conserva las funciones reales.

## 10. Especificación de `/issuer/credentials/new`

### Contrato de pantalla

| Dimensión | Definición |
|---|---|
| Actor | `admin` u `operator` autenticado |
| Objetivo | Crear una credencial draft dentro del vertical demo-grade |
| Disponibilidad | B |
| Precondición | Contexto emisor operativo |
| Entrada | CTA desde `/issuer` |
| Salida exitosa | `/issuer/credentials/[credentialId]` |
| Modelos | `HolderResolutionFormModel`, `HolderResolutionStateVM`, `HolderSummaryVM`, `HolderResolutionCommand` solo en orquestación, `CreateCredentialDraftFormModel`, `CreateCredentialDraftCommand`, `IssuerCredentialDetailVM` parcial, `FeedbackErrorVM`, `AsyncActionStateVM` |
| Componentes | `IssuerShell`, `HolderResolutionField`, `HolderSummary`, `CreateCredentialDraftForm`, `FormField`, `TextInput`, `Textarea`, `Select`, `Button`, `InlineError`, `FeedbackAlert`, `ActionFeedback` |

`CredentialDraftSummary` puede alimentar feedback breve antes de la navegación,
pero no crea una pantalla intermedia.

### Limitaciones de backend

- `POST /credentials/draft` requiere JWT, membership activa `admin` u
  `operator` e issuer autorizado;
- `issuerId` permanece en el command y selecciona contexto, pero se valida
  contra la sesión;
- `POST /issuers/:issuerId/holders/resolve` resuelve por email exacto dentro
  del mismo contexto autorizado;
- la resolución no lista usuarios, no busca parcialmente y devuelve un DTO
  minimizado;
- `issuerId` y `subjectUserId` siguen siendo requeridos por el command;
- la protección de la ruta frontend no reemplaza la autorización backend.

### Composición conceptual

| Orden | Región | Componente o contenido | Responsabilidad |
|---:|---|---|---|
| 1 | Encabezado | Título, subtítulo y contexto | Explicar creación de borrador |
| 2 | Contexto emisor | Resumen genérico no editable | Indicar autoridad sin UUID |
| 3 | Resolución del titular | `HolderResolutionField` y `HolderSummary` | Resolver email exacto y conservar `holderReference` interno |
| 4 | Datos principales | `CreateCredentialDraftForm` | Tipo, título, fuente y descripción |
| 5 | Datos del logro | Campos allowlisted mínimos | Construir `credentialSubject` |
| 6 | Datos opcionales | Horas y contexto formativo | Completar información útil |
| 7 | Feedback | Errores y action state | Recuperación sin perder datos |
| 8 | Acción | Guardar borrador | Emitir `onCreateDraft` |

### Matriz de campos

| Campo visible | Campo del modelo | Requerido | Fuente | Editable | Validación | Ayuda | Responsive | Clasificación |
|---|---|---:|---|---:|---|---|---|---|
| Institución emisora | Contexto de `UserContextVM`; `issuerId` command-only | Sí para command | Sesión/membership y preparación demo | No | Contexto operativo disponible | La institución en cuyo nombre se opera | Bloque compacto antes del form | Backend requerido; no input |
| Email del titular | `HolderResolutionFormModel.email` y `HolderResolutionStateVM` | Sí para resolver | Usuario institucional | Sí | Email válido; resolución exacta requerida | Buscar titular sin exponer UUID | Input, acción y resultado se apilan | Backend requerido |
| Titular resuelto | `HolderSummaryVM.holderReference`; `subjectUserId` command-only | Sí para command | Response minimizada adaptada | No | Debe corresponder al email e issuer vigentes | DID puede no estar disponible | Bloque compacto | Backend requerido; no input |
| Tipo de credencial | `CreateCredentialDraftFormModel.type` | Sí | Selección de opciones normalizadas | Sí | Valor soportado de `CredentialType` | Explica el tipo de logro | Full-width en mobile | Backend requerido |
| Título | `CreateCredentialDraftFormModel.title` | Sí | Usuario institucional | Sí | String no vacío; límite de UI razonable | Nombre principal de la credencial | Full-width | Backend requerido |
| Descripción | `CreateCredentialDraftFormModel.description` | No | Usuario institucional | Sí | Texto plano; opcional | Contexto breve del logro | Full-width | Opcional inicial |
| Tipo de fuente | `CreateCredentialDraftFormModel.sourceType` | Sí | Selección de opciones normalizadas | Sí | Valor soportado de `CredentialSourceType` | Origen del contenido formativo | Full-width en mobile | Backend requerido |
| Horas | `CreateCredentialDraftFormModel.hours` | No | Usuario institucional | Sí | Decimal finito mayor a cero | Carga horaria cuando sea confiable | Control corto, full-width mobile | Opcional inicial |
| Nombre del logro | `credentialSubject.achievement_name` | Sí en F1 | Usuario institucional | Sí | String no vacío | Puede coincidir con el título si la regla futura lo define | Full-width | Requerido para emitir |
| Institución del logro | `credentialSubject.institution_name` | Sí en F1 | Usuario institucional | Sí | String no vacío | No reemplaza la institución emisora | Full-width | Requerido para emitir |
| Programa | `credentialSubject.program_name` | No | Usuario institucional | Sí | String no vacío si se informa | Contexto del programa; fuera de `canon_v1` | Full-width | Opcional inicial |
| Período académico | `credentialSubject.academic_period` | No | Usuario institucional | Sí | String no vacío si se informa | Ejemplo: período o ciclo académico | Full-width en mobile | Opcional inicial |
| Fecha de finalización | `credentialSubject.completion_date` | No | Usuario institucional | Sí | Fecha válida `YYYY-MM-DD` | Solo si la fuente respalda el dato | Full-width en mobile | Opcional inicial |
| Calificación | `credentialSubject.grade` | No | Usuario institucional | Diferida en UI v0 | String no vacío o número finito | Dato potencialmente sensible | No se renderiza en F1 | Avanzado/diferido |
| Habilidades | `credentialSubject.skills` | No | Usuario institucional | Diferida en UI v0 | Lista de strings no vacíos | No reemplaza análisis IA | No se renderiza en F1 | Avanzado/diferido |
| Competencias | `credentialSubject.competencies` | No | Usuario institucional | Diferida en UI v0 | Lista de strings no vacíos | No reemplaza análisis IA | No se renderiza en F1 | Avanzado/diferido |

No se incluyen como inputs:

- `issuerId`;
- `subjectUserId`;
- `academicCourseId`;
- `externalCourseId`;
- metadata genérica;
- `rawData`;
- hash;
- status;
- canonicalization version;
- JSON arbitrario.

Elegir `course_dataset` como fuente no prueba aprobación ni finalización. La
pantalla no completa `completion_date`, grade u otros datos de logro a partir
de un catálogo.

### Institución emisora e institución del logro

**Institución emisora**

- representa autoridad;
- proviene del contexto de sesión y membership;
- se asocia al command mediante `issuerId`;
- no es editable;
- no se muestra como UUID.

**Institución del logro**

- corresponde a `credentialSubject.institution_name`;
- es un campo descriptivo;
- no concede autorización;
- usa un label diferente y explícito.

Aunque ya existe issuer summary, todavía no hay una regla de dominio que lo
iguale a `credentialSubject.institution_name`. La pantalla no debe
precompletar una identidad del logro basándose solo en el contexto emisor.

### Resolución del titular

Flujo v0:

```text
HolderResolutionField
-> emite intencion con email
-> orquestacion agrega issuerReference
-> construye HolderResolutionCommand
-> API client construye path
-> adapter transforma response.id en holderReference
-> HolderSummaryVM
-> subjectUserId interno al crear el draft
```

Estados obligatorios:

- `idle`;
- email inválido;
- `resolving`;
- `resolved`;
- titular no encontrado;
- error de red o inesperado;
- sesión expirada;
- operación prohibida.

Reglas:

- cambiar el email invalida inmediatamente el holder resuelto;
- cambiar el issuer invalida inmediatamente el holder resuelto;
- el submit permanece bloqueado hasta una resolución vigente;
- resolución y creación tienen estados de carga separados;
- `id`, `issuerId` y `subjectUserId` nunca se muestran ni se editan;
- el ID no se persiste en storage de presentación;
- el `404` no revela si el usuario no existe o está inactivo.

Está prohibido:

- escribir o pegar `subjectUserId`;
- mostrar un selector de UUID;
- convertir el control en búsqueda parcial, autocomplete o listado global;
- usar una lista hardcodeada presentada como real.

### Submit

```text
onCreateDraft
-> validar form model
-> exigir HolderResolutionStateVM resolved y vigente
-> construir CreateCredentialDraftCommand en orquestación
-> mapear issuerReference a issuerId command-only
-> mapear holderReference a subjectUserId command-only
-> POST /credentials/draft
-> validar response
-> adaptar resultado
-> redirigir
```

Reglas:

- conservar campos ante error recuperable;
- deshabilitar submit duplicado;
- no usar el frontend como autorización;
- no enviar `rawData`;
- construir `credentialSubject` solo con la allowlist;
- no usar spread del form model hacia el request.

### Éxito

```text
draft creado correctamente
-> /issuer/credentials/[credentialId]
```

En destino:

```text
Borrador creado.
```

El feedback es persistente dentro de la nueva pantalla hasta que el usuario lo
descarta o inicia otra acción. No existe pantalla de éxito intermedia.

El ID se usa para navegación, no como identidad principal.

### Errores

| Caso | Presentación | Recuperación |
|---|---|---|
| Validación local | Errores por campo y resumen si son múltiples | Corregir |
| Issuer inexistente | Error de contexto institucional | Volver a `/issuer` |
| Titular inexistente | Dependencia demo inválida | Corregir preparación externa |
| Request inválido | Mensaje seguro | Revisar campos |
| Network error | Feedback persistente | Reintentar |
| Backend no disponible | Error de servicio | Reintentar más tarde |
| Response inesperada | Error de compatibilidad | Reintentar o reportar |
| Sesión expirada en UI | Redirect a login | Login con `returnTo` seguro |

El status HTTP no es el mensaje principal.

### Cambios sin guardar

Decisión v0:

- los errores del request preservan el formulario;
- refresh no promete persistencia;
- no existe autosave;
- al abandonar mediante navegación interna o Back con cambios, solicitar
  confirmación;
- no mostrar confirmación si no hay cambios o el submit terminó correctamente;
- el comportamiento técnico de cierre de pestaña queda para implementación,
  respetando capacidades del navegador.

### Foco y accesibilidad

- `h1` único;
- contexto emisor y titular se leen antes del formulario;
- labels persistentes;
- required accesible;
- error summary cuando existan varios errores;
- foco al primer campo inválido;
- foco al feedback de request cuando el error no pertenece a un campo;
- orden de tabulación coincide con el orden visual;
- el botón bloqueado por falta de titular tiene explicación visible.

### Responsive

- varias columnas solo cuando el espacio y la relación de campos lo justifica;
- una columna en mobile;
- orden lógico conservado;
- errores junto al campo;
- CTA al final del formulario;
- no usar sticky CTA si oculta contenido;
- targets mínimos de 44 x 44 px.

## 11. Especificación de `/issuer/credentials/[credentialId]`

### Contrato de pantalla

| Dimensión | Definición |
|---|---|
| Actor | `admin` u `operator` autenticado |
| Objetivo | Concentrar el flujo operativo de una credencial |
| Disponibilidad | B |
| Precondición | ID conocido y contexto emisor operativo |
| Entrada | Redirect desde draft o deep link protegido por UX |
| Salida | Permanecer después de emitir o analizar; volver a `/issuer` |
| Modelos | `IssuerCredentialDetailVM`, `CredentialLifecycleVM`, `IssueCredentialActionVM`, `PdfAnalysisFormModel`, `PdfAnalysisResultVM`, `SemanticAnalysisSummaryVM`, `EvidenceStatusVM`, `TechnicalDetailVM[]`, `FeedbackErrorVM`, action states |
| Componentes | Componentes de identidad, lifecycle, emisión, evidencia, PDF, análisis, feedback y detalle técnico del inventario |

La ruta funciona por ID conocido, pero los reads actuales son públicos y
demo-grade. Autenticar la pantalla no vuelve privados esos endpoints.

### Orquestación de entrada

```text
resolver sesión y contexto
-> leer credentialId de ruta
-> GET /credentials/:id
-> opcionalmente GET /credentials/:id/status cuando el contrato de pantalla lo requiera
-> validar transport
-> adaptar IssuerCredentialDetailVM y CredentialLifecycleVM
-> comparar referencias adapter-only con memberships para UX
-> construir allowedActions
```

La comparación frontend mejora la experiencia, pero no autoriza emisión ni
análisis.

No se encadenan endpoints públicos para obtener PII, issuer summary o artifacts.

### Composición conceptual

| Orden | Región | Componentes | Responsabilidad |
|---:|---|---|---|
| 1 | Feedback | `FeedbackAlert`, `ActionFeedback` | Resultado de navegación o acción |
| 2 | Identidad | `CredentialIdentitySummary` | Título, tipo e identidad segura |
| 3 | Lifecycle | `IssuerCredentialLifecycleSection`, `CredentialLifecycleTimeline` | Estado e hitos confirmados |
| 4 | Datos del logro | `CredentialSubjectSummary` | Allowlist de `credentialSubject` |
| 5 | Emisión | `IssueCredentialSection`, `Dialog` | Confirmar y emitir |
| 6 | Evidencia | `IssuerCredentialEvidenceSection`, `EvidenceSummary` | Integridad y provenance disponible |
| 7 | Análisis | `PdfAnalysisUploadSection`, `PdfAnalysisResultSection`, `SemanticAnalysisSummary` | Selección, request y resultado |
| 8 | Advertencias | `WarningsList`, `QualityFlagsList` | Límites del análisis |
| 9 | Técnico | `TechnicalEvidenceDetails`, `TechnicalDetailsDisclosure`, `CopyButton` | IDs y datos técnicos permitidos |

No se crea una card gigante. Las regiones usan secciones, divisores y
superficies únicamente cuando existe jerarquía.

### Información omitida

- metadata no allowlisted;
- `rawData`;
- artifacts;
- `analysisJson`;
- `textForEmbedding`;
- `evidenceMap`;
- issuer summary inventado;
- titular sin DTO seguro;
- private keys;
- gas;
- signer interno;
- response FastAPI;
- objetos blockchain.

### Deep link

Si la ruta se abre sin sesión:

```text
-> /login?returnTo=<ruta interna validada>
```

Después de login:

- resolver contexto;
- cargar el recurso;
- no asumir permiso por conocer el ID;
- mostrar 403 seguro si la operación no está permitida;
- usar 404 como error de pantalla cuando el recurso no existe;
- nunca redirigir hacia la lista institucional bloqueada.

## 12. Máquina de estados del detalle

| Estado compuesto | Credential | Evidence | Analysis | Acción primaria | Secciones visibles | Copy o feedback |
|---|---|---|---|---|---|---|
| Cargando | Desconocido | Desconocida | Desconocido | Ninguna | Skeleton estructural | `Cargando credencial…` |
| Draft cargado | `draft` | No disponible | `not_analyzed` en flujo F1 | Emitir | Identidad, lifecycle, logro, emisión | `Borrador` |
| Emisión en curso | `draft` persistido | No disponible | Sin cambios | Ninguna duplicada | Toda la información previa | `Emitiendo credencial…` |
| Emisión fallida | `draft` | No crear evidencia local | Sin cambios | Reintentar cuando aplique | Información previa + error | Mensaje contextual |
| Emitida | `issued` | Record disponible o ausencia explícita | `not_analyzed` | Analizar contenido | Identidad, lifecycle, evidencia, PDF | `La credencial fue emitida.` |
| Emitida sin evidencia | `issued` | No disponible/unknown | Cualquier estado permitido | Revisar error; análisis según response seguro | Lifecycle, warning de evidencia, análisis | `La evidencia no está disponible.` |
| Análisis en curso | `issued` | Se conserva | Último persistido o none | Ninguna duplicada | Credencial, evidencia y upload | `Analizando contenido…` |
| Análisis completado | `issued` | Se conserva | `completed` | Ninguna de reanálisis | Resumen, conteos, confidence, warnings, fecha | Resultado neutral |
| Análisis parcial | `issued` | Se conserva | `partial` | Ninguna de reanálisis | Resultado + advertencias visibles | `El análisis se completó parcialmente.` |
| Análisis fallido | `issued` | Se conserva | Último persistido no se reemplaza | Reintentar request si corresponde | Estado persistido + error | Mensaje recuperable |
| Shape no soportada | Estado conocido | Según VM | `unknown` o unsupported | Ninguna inventada | `UnsupportedDataState` | `No podemos mostrar este análisis de forma segura.` |
| Resource not found | Desconocido | Desconocida | Desconocido | Volver a inicio | `ErrorState` | `No encontramos esta credencial.` |
| Forbidden | Oculto/minimizado | Oculta | Oculto | Volver a inicio | `ErrorState` seguro | `No tenés permiso para operar sobre esta credencial.` |

Reglas:

- un action state no reemplaza el estado persistido;
- emisión en curso conserva `draft` hasta recibir success;
- análisis en curso no crea `processing` persistido;
- evidencia no disponible no implica credencial inválida;
- emisión no implica verificación válida;
- error de IA no modifica lifecycle ni evidencia;
- no se muestra porcentaje;
- no se afirma procesamiento en segundo plano.

### Reanálisis

No se incluye `Analizar nuevamente` en v0.

Queda pendiente definir:

- múltiples análisis;
- reemplazo del latest;
- trazabilidad;
- expectativas de usuario;
- idempotencia.

## 13. Emisión

### Condición visual

La sección de emisión aparece como accionable cuando el VM adaptado indica:

```text
credential status = draft
AND contexto emisor operativo
AND action state no está submitting
```

El backend vuelve a validar:

- JWT;
- current user activo;
- membership activa;
- rol `admin` u `operator`;
- issuer real de la credencial;
- issuer autorizado;
- DID y wallet institucional;
- DID del titular;
- campos necesarios para hash.

El componente no replica esa autorización.

### Command

- `issuerId` es command-only;
- proviene del issuer persistido/contexto técnico;
- no es editable;
- si no coincide, el backend falla;
- `issuedAt` no es un campo visible ordinario y se omite en UI v0.

### Confirmación

`IssueCredentialSection` emite `onIssueCredential`. La orquestación abre un
`Dialog`.

Contenido mínimo:

```text
Título: Confirmar emisión

Consecuencia:
La credencial pasará a estado emitido y se generará su evidencia de
integridad. Revisá los datos antes de continuar.

Acciones:
Cancelar
Emitir credencial
```

### Estados

| Estado | UI |
|---|---|
| Disponible | CTA `Emitir credencial` |
| Confirmación | Dialog con consecuencia |
| Submitting | Confirmación bloqueada para duplicados y loading |
| Success | Actualizar VM y mostrar feedback persistente |
| Conflict | Recuperar estado actual y conservar contexto |
| Forbidden | Mensaje seguro; no revelar datos adicionales |
| Bad request | Explicar requisito faltante mediante mapping seguro |
| Network error | Mantener draft y permitir retry explícito |

Después del éxito:

- permanecer en el detalle;
- adaptar la response o ejecutar refetch controlado;
- actualizar lifecycle;
- mostrar evidencia recibida;
- mover foco al feedback de éxito;
- no navegar a otra ruta;
- no afirmar verificación válida.

No se mencionan private keys, gas, signer ni contrato.

## 14. Evidencia de integridad

Nombre visible:

```text
Evidencia de integridad
```

### Estados

| Estado VM | Presentación | Afirmación permitida |
|---|---|---|
| Registrada | Badge y resumen | Existe evidencia persistida asociada |
| No disponible | Estado neutral o warning | No hay evidencia disponible en el response |
| Entorno local/demo | Label explícito | La evidencia corresponde al entorno de demostración |
| Provenance desconocida | Explicación prudente | No se puede distinguir honestamente mock de Anvil |
| Record revocado futuro | Lifecycle del record, si el VM lo contiene | Existió registro y su estado cambió |

Reglas:

- no afirmar blockchain productiva;
- no afirmar consulta on-chain en vivo;
- no confundir evidencia con validez;
- hash y transaction ID completos solo en detalle técnico;
- mostrar environment solo cuando el VM lo permite;
- no inferir mock frente a Anvil por address o tx hash;
- no mostrar Base Sepolia o mainnet si el DTO no lo confirma;
- no hardcodear red;
- no mostrar links de explorer inventados.

Copy base:

```text
La evidencia registrada permite comprobar la integridad del contenido emitido.
```

Cuando provenance no permite distinguir el origen:

```text
Evidencia registrada en entorno local/demo.
```

`EvidenceSummary` recibe `EvidenceStatusVM`.
`TechnicalEvidenceDetails` recibe únicamente `TechnicalDetailVM[]`.

## 15. Análisis de PDF

### Condición visual

En F1, la sección de upload es accionable solo cuando la credencial está
`issued`.

Esta secuencia visual:

```text
draft
-> issue
-> analyze
```

no sustituye una regla backend. El endpoint de análisis valida usuario,
credential e issuer membership, pero el runtime inspeccionado no exige status
`issued`.

### Archivo

Requisitos:

- un archivo;
- MIME `application/pdf`;
- tamaño mayor a cero;
- máximo 20 MB;
- nombre visible;
- tamaño visible;
- reemplazo posible antes de enviar;
- input operable sin drag and drop;
- no mostrar path local;
- no persistir archivo en browser storage.

El backend también valida que exista un header PDF en los primeros bytes.

### Campos técnicos opcionales

`documentId`, `fileName`, `pipelineVersion` y `taxonomyVersion` pertenecen al
command o configuración controlada.

En UI v0:

- el archivo aporta un nombre seguro;
- no se muestran pipeline ni taxonomy version como inputs ordinarios;
- no se permite editar configuración experimental;
- no se muestra path;
- el credential ID proviene de la ruta.

### Flujo

```text
seleccionar PDF
-> validar localmente
-> onAnalyzePdf
-> construir AnalyzePdfCommand
-> POST /credentials/:id/semantic-analysis/from-pdf
-> backend llama AI Service
-> backend valida y persiste SemanticAnalysis
-> adaptar resumen seguro
-> mostrar resultado
```

La pantalla nunca llama FastAPI.

### Estados

| Estado | Presentación | Acción |
|---|---|---|
| Sin archivo | Instrucción y `FileInput` | Seleccionar |
| Archivo seleccionado | Nombre, tamaño y reemplazo | Analizar contenido |
| Validating | Error local si corresponde | Corregir |
| Submitting | Loading indeterminado; conservar credencial y evidencia | Esperar |
| Completed | Resumen, conteos, confidence y fecha | Sin reanálisis v0 |
| Partial | Resultado y warnings prominentes | Revisar limitaciones |
| Invalid PDF | Error asociado al archivo | Reemplazar |
| Más de 20 MB | Error asociado | Elegir otro archivo |
| AI unavailable | Feedback persistente | Reintentar más tarde |
| Timeout | Feedback recuperable | Reintentar explícitamente |
| Gateway/response inválida | Error seguro | Reintentar o reportar |

Reglas:

- loading indeterminado;
- no mostrar porcentaje;
- no afirmar segundo plano;
- no mostrar artifact;
- no mostrar `analysisJson`;
- no mostrar `textForEmbedding`;
- no mostrar `evidenceMap`;
- no afirmar almacenamiento durable;
- error de análisis no cambia Credential ni BlockchainRecord;
- último análisis persistido válido no se reemplaza por un error transitorio.

La response inmediata segura puede mostrarse.

Después de refresh:

- latest analysis puede leerse mediante adapter y allowlist;
- el endpoint actual sigue siendo demo-grade;
- el artifact nunca se guarda en `localStorage`;
- una shape desconocida produce `UnsupportedDataState`.

### Resultado

`PdfAnalysisResultSection` muestra:

- status completed o partial;
- analyzedAt;
- conteos de áreas, skills y conceptos;
- confidence del análisis;
- warnings;
- quality flags.

No muestra:

- prompts;
- evidence map;
- embeddings;
- versiones técnicas como contenido principal;
- payload de FastAPI.

Después del success o partial:

- permanecer en detalle;
- mover foco al encabezado del resultado;
- anunciar el estado una vez;
- conservar warnings visibles;
- no usar `Análisis exitoso` si existen limitaciones.

## 16. Errores por operación

| Operación | Señal | Categoría | Tratamiento |
|---|---|---|---|
| Login | 401 | `invalid_credentials` | Revisar email y password |
| Ruta protegida sin sesión | 401 | `authentication_required` | Ir a login con `returnTo` seguro |
| Sesión previa rechazada | 401 | `session_expired` | Limpiar sesión y volver a login |
| Draft | 400 | `validation_error` | Corregir campos sin perder datos |
| Draft | 404 | `resource_not_found` | Revisar issuer/titular demo |
| Issue | 403 | `permission_denied` | Mantener estructura segura y volver |
| Issue | 404 | `resource_not_found` | Error de pantalla |
| Issue | 409 | `state_conflict` | Recuperar estado actual |
| PDF | 400/422 | `unprocessable_input` | Revisar o reemplazar archivo |
| PDF | 403 | `permission_denied` | No revelar datos adicionales |
| PDF | 404 | `resource_not_found` | Error de pantalla |
| PDF | 502 | `ai_gateway_error` | Reintentar o reportar |
| PDF | 503 | `ai_service_unavailable` | Reintentar más tarde |
| PDF | 504 | `timeout` | Reintentar explícitamente |
| Cualquier request | Sin response | `network_error` | Reintentar |
| Cualquier lectura | Shape inválida | `unexpected_response` | Estado seguro/unsupported |

Reglas:

- 401 con sesión previa limpia sesión y redirige;
- 403 no expone issuer, holder ni recurso adicional;
- 404 del detalle ofrece volver a `/issuer`;
- nunca navegar hacia `/issuer/credentials`;
- 409 conserva datos y recupera el estado;
- error IA no modifica estado persistido;
- un error crítico no aparece solo en toast;
- detail backend/upstream nunca se presenta sin mapping.

## 17. Navegación, redirects y foco

### Transiciones cerradas

```text
/login exitoso emisor
-> /issuer

/issuer: Crear credencial
-> /issuer/credentials/new

draft creado
-> /issuer/credentials/[credentialId]

emisión exitosa
-> permanecer en detalle

análisis completed o partial
-> permanecer en detalle

logout
-> /login

401/session expired
-> /login con returnTo interno seguro

404 detalle
-> ErrorState con acción /issuer
```

### Reglas de foco

- navegación de ruta coloca foco en el `h1`;
- redirect después del draft coloca foco en `Borrador creado`;
- emisión exitosa coloca foco en el feedback persistente;
- análisis completed/partial coloca foco en el heading del resultado;
- error de formulario coloca foco en el primer campo inválido;
- error de acción coloca foco en su `FeedbackAlert`;
- dialog devuelve foco a la acción que lo abrió;
- loading no mueve foco repetidamente;
- un retry conserva contexto y datos editables.

### Botón Back

- desde detalle vuelve según historial, pero la UI ofrece una salida segura a
  `/issuer`, nunca a la lista bloqueada;
- desde draft con cambios se confirma abandono;
- después de submit exitoso no se conserva el estado dirty;
- un deep link sin historial usa la acción explícita `Volver al inicio`.

## 18. Matriz de estados comunes de página

| Ruta | Initial loading | Empty | Error | Forbidden | Success transitorio | Unsupported |
|---|---|---|---|---|---|---|
| `/login` | Resolución opcional de sesión | No aplica | Auth, red o backend | No aplica | Redirect | Response de auth inválida |
| `/issuer` | Contexto desde `/auth/me` | No es dashboard vacío | Backend o sesión | Sin contexto operativo | No aplica | Varias memberships operativas requieren selección; bloqueado en el vertical actual |
| `/issuer/credentials/new` | Contexto demo | No aplica | Validación, red o backend | Ruta UX sin contexto emisor | Draft creado antes del redirect | Titular demo o issuer context ausente |
| `/issuer/credentials/[credentialId]` | Credential por ID | No aplica | 404, red, conflict o IA | 403 al operar | Draft, issue o analysis feedback | Shape de detalle/análisis no segura |

Los action states no reemplazan el estado general de la página.

## 19. Responsive por pantalla

### `/login`

- columna focal;
- campos y CTA táctiles;
- logo Traza y tagline legibles;
- sin header sobredimensionado.

### `/issuer`

- contenido simple;
- CTA visible;
- navegación adaptable;
- identidad de sesión accesible;
- sin cards de métricas.

### `/issuer/credentials/new`

- múltiples columnas solo con espacio suficiente;
- una columna en mobile;
- orden de campos lógico;
- errores cerca del campo;
- acción principal al finalizar;
- no sticky CTA si tapa contenido.

### `/issuer/credentials/[credentialId]`

- desktop puede usar una región principal y una secundaria si mejora la
  jerarquía;
- esa distribución no queda fijada hasta implementación;
- mobile apila secciones;
- emisión, evidencia y análisis siguen accesibles;
- detalle técnico colapsado progresivamente;
- acciones apilables;
- no depender de scroll horizontal;
- targets mínimos de 44 x 44 px.

No se definen breakpoints nuevos.

## 20. Accesibilidad por pantalla

| Pantalla | Landmarks y heading | Foco | Formularios/acciones | Feedback |
|---|---|---|---|---|
| Login | `main`, un `h1` | Email o mensaje de sesión | Labels, autocomplete, submit por teclado | Auth error anunciado una vez |
| Entrada emisor | Header, nav, main, un `h1` | Heading después de navegación | CTA explícito y menú accesible | Contexto ausente persistente |
| Nueva credencial | Header, nav, main, un `h1` | Primer error o feedback | Labels, required, ayudas y error summary | Submit y errores anunciados |
| Detalle | Header, nav, main, un `h1` | Feedback, resultado o error según transición | Dialog de emisión, file input y disclosures | Loading y resultados sin anuncios repetidos |

Contratos transversales:

- skip link;
- orden de foco lógico;
- color acompañado por label e ícono;
- timeline como lista ordenada o estructura equivalente;
- file input operable sin drag and drop;
- technical details mediante disclosure;
- copy button anunciable;
- disabled con motivo visible;
- `aria-live` no se usa indiscriminadamente.

## 21. Copy operativo v0

### Login

| Elemento | Copy v0 | Estado/contexto | Observación |
|---|---|---|---|
| Tagline | Credenciales verificables para trayectorias formativas confiables. | Marca | Oficial |
| Título | Iniciá sesión | Default | Voseo moderado |
| Email | Email | Campo | Label permanente |
| Password | Contraseña | Campo | Label permanente |
| CTA | Iniciar sesión | Idle | Acción principal |
| Loading | Iniciando sesión… | Submitting | No cambia ancho |
| Inválidas | El email o la contraseña no son correctos. | `invalid_credentials` | No revela cuál falló |
| Sesión | Tu sesión venció. Iniciá sesión nuevamente. | `session_expired` | No se presenta como password incorrecta |
| Servicio | No pudimos conectar con Traza. Intentá nuevamente. | Red/backend | Recuperable |

### Entrada del Emisor

| Elemento | Copy v0 | Estado/contexto | Observación |
|---|---|---|---|
| Título | Inicio institucional | Default | No dice dashboard |
| Introducción | Creá, emití y analizá credenciales educativas desde un flujo trazable. | Default | Operativo |
| Contexto | Contexto institucional activo | Issuer sin summary | No muestra UUID |
| CTA | Crear credencial | Default | Navega a nueva |
| Contexto ausente | No pudimos resolver un contexto emisor operativo para esta sesión. | Unsupported | Acción segura |

### Nueva credencial

| Elemento | Copy v0 | Estado/contexto | Observación |
|---|---|---|---|
| Título | Crear credencial | Default | Acción institucional |
| Subtítulo | Cargá los datos del logro y guardá un borrador antes de emitir. | Default | Explica secuencia |
| Emisor | Institución emisora | Contexto | No editable |
| Titular | Email del titular | Resolución | Búsqueda exacta institucional |
| Acción titular | Buscar titular | Idle válido | No crea el draft |
| Titular resuelto | `displayLabel` y email | Resolved | No muestra UUID; DID puede ser null |
| Logro | Nombre del logro | Campo | `achievement_name` |
| Institución logro | Institución del logro | Campo | No confundir con issuer |
| CTA | Guardar borrador | Idle | No dice emitir |
| Loading | Guardando borrador… | Submitting | Indeterminado |
| Success | Borrador creado. | Redirect | Se muestra en detalle |
| Sin titular | Buscá y seleccioná un titular antes de guardar el borrador. | Dependencia | No expone UUID |

### Detalle, emisión y evidencia

| Elemento | Copy v0 | Estado/contexto | Observación |
|---|---|---|---|
| Eyebrow | Detalle de credencial | Default | Título real proviene del VM |
| Draft | Borrador | Lifecycle | Token draft |
| CTA issue | Emitir credencial | Draft | Acción principal |
| Dialog | Confirmar emisión | Confirmación | Consecuencia visible |
| Confirmar | Emitir credencial | Dialog | No `Aceptar` genérico |
| Cancelar | Cancelar | Dialog | Acción secundaria |
| Loading | Emitiendo credencial… | Submitting | No altera estado persistido |
| Success | La credencial fue emitida. | Success | No dice verificada |
| Evidence title | Evidencia de integridad | Sección | Tecnología secundaria |
| Local | Evidencia registrada en entorno local/demo. | Provenance limitada | No blockchain productiva |
| Unavailable | La evidencia no está disponible. | Sin record | No implica invalidez |
| Forbidden | No tenés permiso para operar sobre esta credencial. | 403 | Sin detalle sensible |
| Not found | No encontramos esta credencial. | 404 | Acción volver al inicio |

### Análisis PDF

| Elemento | Copy v0 | Estado/contexto | Observación |
|---|---|---|---|
| Título | Análisis formativo | Default | No `IA mágica` |
| Ayuda | Subí un PDF del contenido formativo. El análisis identificará áreas, habilidades y conceptos. | Sin archivo | No promete certeza |
| Restricción | PDF de hasta 20 MB | Sin archivo | Visible antes de elegir |
| CTA | Analizar contenido | Archivo válido | No llama a FastAPI en copy |
| Loading | Analizando contenido… | Submitting | Sin porcentaje |
| Completed | El análisis identificó habilidades y áreas a partir del contenido aportado. | Completed | Resultado neutral |
| Partial | El análisis se completó parcialmente. Revisá las advertencias. | Partial | No es error total |
| Invalid | El archivo no es un PDF válido. Elegí otro archivo. | Input inválido | Recuperable |
| Error | No pudimos analizar el PDF. Revisá el archivo e intentá nuevamente. | Error procesable | Sin código 422 |
| Service | El servicio de análisis no está disponible en este momento. Intentá más tarde. | 503 | No modifica credencial |
| Unsupported | No podemos mostrar este análisis de forma segura. | Shape desconocida | No renderiza JSON |

No usar:

```text
La IA certificó tu formación
100% verificado por blockchain
Análisis mágico
Error 422
Wallet cripto
NFT
```

Este copy es operativo v0. Su consolidación futura pertenece al documento de
contenido y microcopy.

## 22. Limitaciones demo-grade

| Limitación | Pantalla afectada | Impacto UX | Tratamiento permitido | Tratamiento prohibido | Contrato futuro |
|---|---|---|---|---|---|
| Resolución de holder ausente | Nueva credencial | No hay selección humana autorizada | Titular demo preparado fuera de UI | Campo UUID o búsqueda fake | Resolver por email/DID autorizado |
| Reads institucionales públicos | Detalle | Ownership no se valida al leer | ID preparado y adapter mínimo | Presentarlo como acceso productivo | Reads protegidos por membership |
| Latest analysis amplio | Detalle | Puede incluir campos internos | Adapter allowlist y descarte | Pasar response o guardar artifact | DTO protegido y resumido |
| Sin listado issuer-facing | Inicio/navegación | No hay colección ni regreso a lista | Volver a `/issuer` | Lista o tabla fake | Listado paginado protegido |
| Sin análisis desde texto | Detalle | Solo PDF | No mostrar acción | Simular input textual | Endpoint institucional protegido |
| Sin jobs/progreso | PDF | Request síncrono | Loading indeterminado | Porcentaje o background ficticio | Jobs y status |
| Sin storage durable | PDF | Archivo vive durante request | Selección local | Afirmar que quedó almacenado | Object storage autorizado |
| Sin revocación | Detalle | Lifecycle incompleto | No mostrar acción | Botón placeholder | Endpoint protegido |
| Sin sharing/QR | Detalle | No hay grant | No mostrar | QR con ID simple presentado como seguro | Grants revocables |
| Mock/Anvil indistinguibles | Evidencia | Provenance limitada | Entorno local/demo y unknown | Inferir por txHash/address | `evidenceOrigin` |
| Sin verificación on-chain live | Evidencia | Se ve record persistido | Explicar evidencia persistida | Indicador live | Read model on-chain controlado |

## 23. Qué no se implementa

- dashboard analítico;
- lista o tabla institucional;
- filtros;
- búsqueda falsa de titulares;
- selector multi-issuer;
- issuer UUID como identidad;
- revocación;
- sharing;
- QR;
- jobs;
- progreso porcentual;
- storage ficticio;
- metadata genérica;
- artifacts;
- JSON viewer;
- FastAPI client frontend;
- cliente blockchain frontend;
- MetaMask;
- acciones de titular;
- pantalla del verificador;
- rutas separadas de emisión o análisis;
- placeholders `Próximamente`.

## 24. Recorrido de demo

### Preparación

- PostgreSQL activo;
- backend NestJS activo;
- AI Service activo;
- seed ejecutado;
- usuario emisor demo disponible;
- titular demo existente y resoluble por email;
- issuer autorizado;
- issuer con DID y wallet address;
- holder con DID;
- PDF válido menor a 20 MB;
- modo de evidencia conocido para la demo.

### Flujo

1. Abrir `/login`.
2. Iniciar sesión como emisor.
3. Resolver `/auth/me`.
4. Entrar a `/issuer`.
5. Abrir `/issuer/credentials/new`.
6. Resolver el titular por email exacto y crear el draft.
7. Redirigir al detalle.
8. Emitir la credencial.
9. Mostrar evidencia.
10. Seleccionar PDF.
11. Ejecutar análisis.
12. Mostrar resultado completed o partial.

### Fallbacks honestos

| Problema | Tratamiento |
|---|---|
| AI Service caído | Mantener credential y evidence; permitir retry explícito |
| PDF inválido | Conservar pantalla y pedir reemplazo |
| Evidencia no disponible | Mostrar ausencia sin afirmar invalidez |
| Titular demo no configurado | Bloquear draft y corregir preparación externa |
| Issuer no autorizado | Mostrar error de operación; corregir backend/seed |
| Detail ID perdido | Volver a `/issuer`; no inventar lista |
| Análisis partial | Mostrar resultado y warnings |
| Shape desconocida | `UnsupportedDataState`; no JSON |

La preparación técnica no se disfraza mediante UI falsa.

## 25. Riesgos y mitigaciones

| Riesgo | Consecuencia | Mitigación |
|---|---|---|
| Screen spec convertida en wireframe | Layout prematuro | Definir jerarquía, no coordenadas |
| Draft con demasiados campos | Fricción y datos pobres | F1 mínimo; diferir grade/skills/competencies |
| UUID del holder visible | UX técnica y fuga de modelo | Contexto demo externo y referencia humana |
| Issuer genérico presentado como nombre | Identidad falsa | Label de contexto, no nombre inventado |
| Análisis habilitado antes de emisión | Secuencia confusa | Habilitar después de issued en UI v0 |
| Emisión presentada como verificación | Claim incorrecto | Badges y copy separados |
| Progreso falso | Engaño operativo | Loading indeterminado |
| Error crítico solo en toast | Feedback perdido | Alert o ErrorState persistente |
| Reanálisis indefinido | Múltiples latest ambiguos | No mostrar CTA en v0 |
| Artifacts filtrados | Exposición interna | Adapter allowlist obligatorio |
| Datos perdidos ante error | Repetición y frustración | Preservar form/file en sesión cuando sea seguro |
| Mobile recortado | Flujo institucional incompleto | Apilar y reorganizar acciones |
| Detalle como card gigante | Jerarquía débil | Secciones y divisores |
| Acciones duplicadas | Doble submit | Action state único y controles disabled |
| Copy técnico | Baja comprensión | Términos de producto y detalle progresivo |
| Limitaciones demo ocultas | Demo no defendible | Tabla y fallback honestos |
| Spec presupone P0 resuelto | Implementación insegura | Mantener categoría B y camino demo controlado |
| Read público tratado como ownership | Falsa seguridad | Backend futuro y disclaimer técnico |
| `institution_name` tratado como issuer | Autoridad falsa | Labels y modelos separados |

## 26. Decisiones pendientes

No cerrar todavía:

- librería HTTP;
- React Query o SWR;
- validación runtime;
- state management;
- almacenamiento JWT;
- estructura de carpetas;
- implementación de componentes;
- props finales;
- breakpoints nuevos;
- breadcrumbs;
- sticky actions;
- reanálisis;
- autosave;
- storage;
- revocación;
- sharing;
- QR;
- selector multi-issuer;
- comportamiento productivo de salida con cambios en cierre de pestaña.

## 27. Criterios de aceptación

El documento queda aprobado si:

- usa los cuatro documentos normativos;
- registra snapshot real;
- cubre exactamente cuatro rutas;
- no especifica lista institucional;
- separa orquestación y presentación;
- define jerarquía y composición;
- incluye la matriz del draft;
- define titular demo sin UUID visible;
- fija redirect automático después del draft;
- define máquina de estados del detalle;
- habilita análisis después de emisión en UI v0;
- no inventa reanálisis;
- define estados y errores por ruta;
- define navegación, redirects y foco;
- define responsive;
- define accesibilidad;
- incluye copy operativo v0;
- documenta limitaciones demo-grade;
- no expone artifacts;
- no inventa endpoints;
- no implementa código;
- no modifica backend.

## 28. Recomendación de implementación

### Camino recomendado

Resolver primero los gaps P0:

1. Completado: proteger `POST /credentials/draft`.
2. Completado: enriquecer el contexto del issuer.
3. Completado: resolver titulares por email exacto autorizado.

Después, implementar F0/F1.

### Camino demo controlado

Implementar F0 y las partes del slice respaldadas por runtime:

- login;
- entrada institucional genérica;
- draft con issuer/titular preparados externamente;
- redirect a detalle por ID;
- emisión protegida;
- evidencia local/demo;
- análisis PDF;
- resultado seguro.

Este camino debe conservar las limitaciones documentadas y no presentarlas
como producto final.

No iniciar una implementación productiva completa fingiendo que los gaps P0
ya están resueltos.

## 29. Próximos documentos

Después de cerrar o aceptar explícitamente los gaps P0:

```text
docs/frontend/frontend-holder-wallet-profile-screen-spec-v0.md
docs/frontend/frontend-public-verifier-screen-spec-v0.md
```

Esos documentos no forman parte de esta especificación.

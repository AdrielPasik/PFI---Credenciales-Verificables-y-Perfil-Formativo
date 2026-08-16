# Traza: Arquitectura de información frontend v0

## 1. Propósito

Este documento define la arquitectura de información, las rutas conceptuales,
la navegación, la jerarquía funcional y el orden de construcción del frontend
web de Traza.

Es la fuente de verdad para:

- experiencias y contextos de uso;
- rutas públicas y protegidas;
- entrada y navegación por actor;
- relación entre funcionalidades;
- disponibilidad real de cada sección;
- dependencias de backend;
- recorrido de demo;
- prioridad de implementación.

No define layouts, wireframes, estilos visuales, props de componentes ni
decisiones técnicas de implementación de Next.js.

Estado:

```text
versión: v0
carácter: normativo
alcance: arquitectura de información frontend
aplicación: una única aplicación web Next.js
locale: es-AR
```

## 2. Alcance

Este documento cubre tres experiencias dentro de una sola aplicación:

```text
Portal del Emisor
Wallet y Perfil del Titular
Verificador Público
```

También cubre:

- login único;
- resolución inicial de contexto;
- navegación global y contextual;
- rutas de credenciales;
- análisis formativo desde PDF;
- perfil formativo;
- verificación pública;
- estados estructurales;
- responsive a nivel de arquitectura;
- gaps que impiden una experiencia completa.

No cubre:

- diseño visual de pantallas;
- wireframes;
- componentes React;
- implementación de rutas;
- estrategia de almacenamiento del JWT;
- librería de data fetching;
- microcopy definitivo;
- sharing, QR o revocación no implementados;
- administración institucional avanzada.

## 3. Fuentes de verdad y precedencia

Aplicar este orden ante contradicciones:

1. Controllers, services y DTOs actuales de `services/api/src` para endpoints,
   permisos y respuestas realmente implementadas.
2. `frontend-brand-and-design-system-v0.md` para marca, terminología, tono,
   estados visuales y responsive.
3. `ai-frontend-ready-flow-v0.md` y
   `ai-http-backend-integration-v0.md` para integración IA vigente.
4. `auth-and-permissions-v0.md`, documentación de módulos y guion de demo para
   intención de producto y pruebas ya realizadas.
5. `architecture-v1.md`, `api-contracts-v0.md` y documentos de flujos como
   referencias conceptuales o históricas.

### Snapshot de inspección

```text
fecha: 2026-07-27
branch: main
commit: e7319e1
backend inspeccionado: services/api/src
modelo inspeccionado: services/api/prisma
documentación inspeccionada: docs/architecture, docs/frontend, docs/demo
```

El inventario de endpoints, DTOs, permisos y limitaciones de este documento
corresponde a ese snapshot. No debe interpretarse como una descripción
automáticamente vigente ante cambios posteriores del repositorio.

Actualizaciones posteriores al snapshot base:

- P0.1 protegió `POST /credentials/draft`.
- P0.2 agregó issuer summaries seguros en `GET /auth/me`.
- P0.3 agregó resolución autorizada del titular por email exacto.

> Cuando cambien controllers, DTOs, permisos o rutas del backend, debe
> revisarse la clasificación A/B/C/D de este documento.

### Contradicciones detectadas

| Fuente histórica | Estado más reciente | Decisión aplicada |
|---|---|---|
| `architecture-v1.md` propone `/verifier` | El controller real expone `GET /verify/credentials/:id` | Usar `/verify`, no `/verifier` |
| `frontend-roadmap-v0.md` y el handoff anterior dicen `desktop-first` | El design system vigente define Portal del Emisor web responsive | El portal es responsive y no excluye mobile |
| `backend-implemented-slices-v0.md` y algunos README dicen que no existe IA HTTP | Controllers y documentación posterior exponen endpoints IA protegidos | Considerar IA HTTP implementada |
| `api-contracts-v0.md` enumera rutas candidatas | Varias no tienen controller real | No tratarlas como implementadas |
| Flujos históricos asumen link, QR, auditoría y consulta on-chain | El runtime actual resuelve por ID y evidencia persistida | Clasificarlos como futuro o dependencia |

Los documentos históricos no deben usarse para justificar navegación hacia
funcionalidades inexistentes.

## 4. Estado actual del producto

### Backend implementado

El backend permite un vertical real:

```text
login institucional
-> draft
-> issue
-> canonicalHash
-> BlockchainRecord
-> PDF
-> SemanticAnalysis
-> login titular
-> credenciales propias
-> build de perfil IA
-> FormativeProfile current
-> verificación pública por ID
```

### Endpoints públicos reales

```text
GET  /health
POST /auth/login
GET  /credentials/:id
GET  /credentials/:id/status
GET  /credentials/:id/semantic-analysis/latest
GET  /verify/credentials/:id
```

Los tres reads genéricos bajo `/credentials/:id` son públicos en el código
actual. Esto es una limitación, no una decisión de seguridad que el frontend
deba consolidar. `POST /credentials/draft` ya requiere JWT, membership activa
`admin` u `operator` e issuer autorizado.

### Límite de los endpoints públicos demo-grade

Los siguientes endpoints públicos son soporte transitorio del slice y no
contratos frontend productivos:

```text
GET  /credentials/:id
GET  /credentials/:id/status
GET  /credentials/:id/semantic-analysis/latest
```

Reglas:

- autenticarlos únicamente desde la UI no corrige la seguridad del backend;
- los route guards frontend no reemplazan autorización backend;
- no deben reutilizarse para ampliar el producto por conveniencia;
- la navegación institucional completa permanece bloqueada hasta contar con
  reads protegidos por membership;
- nunca se deben renderizar `analysisJson`, `textForEmbedding` ni artifacts
  crudos;
- esos campos no deben pasar a componentes aunque el componente los omita
  visualmente;
- si temporalmente se consume un DTO amplio, el adapter HTTP debe descartar
  los campos no autorizados antes de construir el view model;
- tras recargar un detalle, la UI institucional puede no disponer de un
  resumen seguro persistido hasta que exista un endpoint protegido y
  controlado;
- no debe compensarse esa limitación persistiendo artifacts internos en
  `localStorage`.

### Endpoints protegidos reales

```text
GET  /auth/me
POST /issuers/:issuerId/holders/resolve
POST /credentials/:id/issue
POST /credentials/:id/semantic-analysis/from-pdf
GET  /me/credentials
GET  /me/credentials/:id
GET  /me/profile/current
POST /me/profile/rebuild
POST /me/profile/build-from-ai
```

### Límites relevantes

- no existe listado de credenciales por institución emisora;
- existe resolución exacta de un titular por email dentro de un issuer
  autorizado; no existe listado, autocomplete ni búsqueda parcial;
- `/auth/me` devuelve memberships activas con `issuerId`, nombre, DID nullable,
  estado de autorización institucional, rol y estado de membership;
- `/auth/me` devuelve issuer summaries para memberships activas, pero todavía
  no existe un contrato de selección y persistencia del contexto multi-issuer;
- no existe análisis desde texto;
- no existe revocación backend completa;
- no existen sharing links ni QR;
- no existe historial de verificaciones;
- no existen jobs ni progreso;
- no existe storage de PDFs;
- no existen paginación ni filtros issuer-facing;
- el endpoint de verificación no devuelve una institución emisora resumida;
- la verificación consulta evidencia persistida y no el contrato en tiempo
  real;
- el endpoint público de latest semantic analysis expone campos internos que
  no deben renderizarse sin un DTO seguro.

## 5. Niveles de disponibilidad

Toda ruta, sección y acción usa una categoría:

| Categoría | Significado |
|---|---|
| **A. Implementable ahora** | Existe soporte backend suficiente para consumir datos reales |
| **B. Parcial o demo** | El flujo funciona con limitaciones explícitas, IDs preparados o soporte demo-grade |
| **C. Bloqueada por backend** | Requiere endpoint, permiso, filtro o contrato que no existe |
| **D. Futuro** | Está fuera del MVP y no debe mostrarse como disponible |

Reglas:

- una ruta A puede implementarse y publicarse;
- una ruta B puede implementarse solo con sus limitaciones visibles y
  documentadas; B no habilita datos fake ni hardcodeados;
- una ruta C queda reservada en la arquitectura, pero no debe generar página
  vacía, placeholder, navegación ni botón;
- una ruta D tampoco debe implementarse ni mostrarse como `Próximamente`;
- una ruta puede ser B aunque su endpoint exista si faltan identidad,
  autorización o datos esenciales para una experiencia completa.

Reservar una URL en este documento no significa crear su carpeta ni su
`page` en Next.js. Esta regla aplica expresamente a:

```text
/issuer/credentials
/issuer/settings
/issuer/users
/wallet/share
/verify/shared/[token]
```

## 6. Principios de arquitectura de información

### Una aplicación, contextos separados

Traza es una única aplicación Next.js con marca y base técnica compartidas.
No es una navegación única donde todos ven todas las funciones.

### Autoridad desde sesión y backend

La UI usa `GET /auth/me` para resolver contexto. Los permisos efectivos siempre
los valida NestJS.

Ocultar una acción mejora la UX, pero no constituye seguridad.

### Dominio antes que tecnología

La navegación usa conceptos de producto:

- institución emisora;
- titular;
- credencial;
- análisis formativo;
- perfil formativo;
- evidencia de integridad;
- verificación.

No usa nombres de tablas, DTOs, artifacts o librerías.

### Acciones dentro de su objeto

Emitir, analizar y consultar evidencia son acciones o secciones de una
credencial. No son módulos globales de navegación.

Construir un perfil es una acción dentro de Perfil formativo. No necesita una
sección primaria independiente.

### Deep links honestos

Las rutas por ID son válidas para demo y crecimiento, pero no equivalen a
sharing seguro. Un ID directo no debe presentarse como grant, consentimiento o
link revocable.

### Sin navegación ficticia

No incluir:

- dashboard analítico sin agregados;
- lista institucional hardcodeada;
- filtros que solo cambian datos fake;
- botones sin acción;
- estados persistidos solo en memoria;
- páginas vacías para capacidades futuras.

## 7. Actores y contextos

### Usuario institucional

Es un `User` autenticado con una `IssuerMembership` activa.

Para emitir o analizar PDF necesita rol:

```text
admin | operator
```

El rol `viewer` existe en Prisma, pero no tiene hoy una experiencia
institucional de lectura respaldada por endpoints issuer-facing.

### Titular

Es el `User` autenticado que consulta recursos donde:

```text
Credential.subjectUserId === currentUser.id
```

No necesita un rol específico. Los endpoints `/me/*` resuelven identidad
exclusivamente desde el JWT.

### Verificador

Es un tercero sin sesión en v0. Accede por ID a una respuesta pública y no
posee dashboard ni navegación privada.

### Institución emisora

Es una entidad `Issuer`, no una cuenta que inicia sesión. Los usuarios operan
en su nombre mediante memberships.

### Contextos no implementados

- `system_admin` no tiene endpoints ni navegación runtime;
- un `viewer` institucional no tiene todavía lectura institucional útil;
- no existe gestión de miembros, signers o instituciones desde frontend;
- no existe contexto autenticado de recruiter/verificador.

## 8. Mapa global de experiencias

```text
/
├── login
├── issuer
│   └── credentials
│       ├── new
│       └── [credentialId]
├── wallet
│   ├── credentials
│   │   └── [credentialId]
│   └── profile
└── verify
    └── credentials
        └── [credentialId]
```

Decisiones:

- `/issuer` es la entrada institucional y reemplaza una ruta
  `/issuer/overview`;
- `/wallet` es el scope técnico de la experiencia personal;
- `/wallet` redirige a `/wallet/credentials`;
- `/wallet/profile` incluye selección y build de perfil;
- `/verify` permite introducir manualmente un ID;
- `/verify/credentials/[credentialId]` es el resultado público;
- no se crea `/verifier`;
- no existen rutas separadas para emitir, analizar o ver evidencia;
- no existe ruta separada para construir perfil.

## 9. Propuesta de rutas

### Segmentos URL y labels visibles

Los segmentos URL son identificadores técnicos estables y pueden conservar
términos en inglés. Los labels visibles pertenecen al producto y se definen en
español `es-AR`.

Reglas:

- `/wallet` no obliga a mostrar `Wallet`;
- `/issuer` no obliga a mostrar `Issuer`;
- `/verify` se presenta como `Verificar credencial`;
- los nombres de ruta no se trasladan automáticamente a títulos, breadcrumbs
  o navegación;
- los breadcrumbs deben consumir metadata de ruta o labels centralizados, no
  capitalizar automáticamente el `pathname`;
- `Mi Traza` y `Mis credenciales` siguen siendo decisiones verbales
  pendientes.

### `/`

Entrada técnica y resolvedor de contexto.

Comportamiento conceptual:

```text
sin sesión -> /login
sesión institucional demo válida -> /issuer
sesión sin contexto emisor operativo -> /wallet/credentials
```

No debe convertirse en un dashboard genérico.

### `/login`

Login único para usuarios institucionales y titulares.

No se crean:

- login del emisor;
- login del titular;
- login del verificador.

### `/issuer`

Entrada institucional simple y honesta.

Puede explicar el flujo, mostrar identidad de sesión y ofrecer la acción
principal disponible. No muestra métricas ni actividad reciente hasta tener un
endpoint agregado.

### `/issuer/credentials`

Ruta reservada para listado institucional. Está bloqueada por backend y no debe
implementarse como lista fake.

### `/issuer/credentials/new`

Creación de draft. El endpoint y la resolución autorizada del titular existen;
la experiencia institucional completa sigue limitada por la selección de
contexto multi-issuer y los reads issuer-facing pendientes.

### `/issuer/credentials/[credentialId]`

Detalle operativo por ID. Concentra:

- estado de credencial;
- emisión;
- evidencia;
- upload de PDF;
- resultado de análisis;
- detalle técnico.

Es parcial porque el acceso depende de un ID conocido y los reads genéricos no
validan ownership institucional.

### `/wallet`

Redirect autenticado a `/wallet/credentials`.

### `/wallet/credentials`

Lista real de credenciales propias `issued` y `revoked`.

### `/wallet/credentials/[credentialId]`

Detalle propio con institución emisora, datos de credencial, evidencia y latest
semantic analysis.

### `/wallet/profile`

Perfil actual y construcción desde credenciales elegibles. La selección vive
dentro del flujo del perfil y no es navegación primaria separada.

### `/verify`

Entrada pública opcional para introducir un credential ID y navegar a la ruta
de resultado.

No crea sharing ni consulta adicional.

### `/verify/credentials/[credentialId]`

Resultado público por ID. No debe afirmar que el acceso provino de QR o link
seguro.

## 10. Matriz de rutas por disponibilidad

| Ruta conceptual | Label tentativo | Actor | Auth | Permiso | Objetivo | API o dato | Disponibilidad | Dependencia |
|---|---|---|---|---|---|---|---|---|
| `/` | Inicio | Todos | Opcional | Ninguno | Resolver entrada | Sesión local + `/auth/me` | A | Estrategia técnica de sesión |
| `/login` | Iniciar sesión | Institucional y titular | No | Usuario activo | Obtener JWT | `POST /auth/login` | A | Sin refresh token |
| `/issuer` | Inicio | Admin/operator | Sí | Membership activa e issuer autorizado | Entrada institucional | `GET /auth/me` | B | Summary disponible; selector multi-issuer no implementado |
| `/issuer/credentials` | Credenciales | Admin/operator | Sí | Membership activa | Listar credenciales institucionales | No existe | C | Endpoint issuer-facing, paginación y filtros. No implementar ni enlazar en MVP |
| `/issuer/credentials/new` | Nueva credencial | Admin/operator | Sí | Emisión institucional | Resolver titular y crear draft | `POST /issuers/:issuerId/holders/resolve`, `POST /credentials/draft` | B | Flujo transaccional disponible; selector multi-issuer no implementado |
| `/issuer/credentials/[credentialId]` | Detalle de credencial | Admin/operator | Sí en UI | Membership del issuer | Consultar y operar por ID | `GET /credentials/:id`, status, issue, AI PDF, latest analysis | B | Reads sin autorización, ID conocido y DTO semántico demasiado amplio |
| `/wallet` | Entrada personal | Titular | Sí | Usuario activo | Entrar a experiencia personal | `/auth/me` | A | Redirect interno |
| `/wallet/credentials` | Mis credenciales | Titular | Sí | Ownership por JWT | Listar credenciales propias | `GET /me/credentials` | A | Sin paginación |
| `/wallet/credentials/[credentialId]` | Detalle de credencial | Titular | Sí | Ownership por JWT | Ver detalle propio | `GET /me/credentials/:id` | A | Ninguna para MVP |
| `/wallet/profile` | Perfil formativo | Titular | Sí | Usuario actual | Leer y construir perfil | `GET /me/profile/current`, `POST /me/profile/build-from-ai` | A | AI Service disponible para build |
| `/verify` | Verificar credencial | Verificador | No | Ninguno | Ingresar ID manual | Navegación frontend | A | No equivale a sharing |
| `/verify/credentials/[credentialId]` | Resultado de verificación | Verificador | No | Acceso público por ID | Mostrar resultado y evidencia | `GET /verify/credentials/:id` | B | Falta institución emisora en DTO y política de exposición más fina |
| `/issuer/settings` | Configuración | Institucional | Sí | No implementado | Gestionar institución | No existe | D | Fuera del MVP. No implementar ni enlazar en MVP |
| `/issuer/users` | Equipo | Institucional | Sí | No implementado | Gestionar memberships | No existe | D | Fuera del MVP. No implementar ni enlazar en MVP |
| `/wallet/share` | Compartir | Titular | Sí | No implementado | Crear grants o links | No existe | D | Sharing y consentimiento. No implementar ni enlazar en MVP |
| `/verify/shared/[token]` | Verificación compartida | Verificador | No | Token válido | Resolver un grant | No existe | D | Token, expiración y revocación. No implementar ni enlazar en MVP |

## 11. Matriz de capacidades por actor

| Capacidad | Emisor | Titular | Verificador | Estado actual | Observación |
|---|---|---|---|---|---|
| Iniciar sesión | Sí | Sí | No requerido | A | Login único |
| Resolver contexto | Parcial | Sí | No aplica | B | Issuer summaries disponibles; selección y persistencia multi-issuer pendientes |
| Crear draft | Sí | No | No | B | JWT + membership; holder todavía por ID |
| Emitir | Sí | No | No | A | Requiere admin/operator e issuer autorizado |
| Listar por institución | Sí | No | No | C | No existe endpoint |
| Abrir detalle institucional | Sí, por ID | No | No | B | Read genérico sin ownership |
| Analizar PDF | Sí | No | No | A | Request síncrono y protegido |
| Analizar texto | Futuro | No | No | C | No existe endpoint |
| Ver credenciales propias | No | Sí | No | A | Solo `issued` y `revoked` |
| Ver detalle propio | No | Sí | No | A | Respuesta segura, sin `rawData` |
| Construir perfil IA | No | Sí | No | A | Requiere credenciales issued con análisis |
| Reconstruir fallback backend | No | No en UI MVP | No | Implementado técnicamente, no expuesto en UI MVP | Reservado para soporte o herramientas internas |
| Ver perfil actual | No | Sí | No | A | Puede devolver `currentProfile: null` |
| Verificar por ID | No | No | Sí | B | Resultado real, DTO institucional incompleto |
| Consultar evidencia | Parcial | Sí | Sí parcial | B | Persistida; no consulta on-chain en tiempo real |
| Revocar credencial | Futuro | No | No | C | Sin endpoint de dominio |
| Compartir por link o QR | No | Futuro | Futuro | D | Sin grants, tokens ni QR |
| Ver historial de verificaciones | Futuro | Futuro | Futuro | D | Modelo Prisma sin endpoint |

## 12. Matriz de navegación

| Experiencia | Entrada | Navegación primaria | Navegación secundaria | Acción principal |
|---|---|---|---|---|
| Portal del Emisor | `/issuer` | Inicio; Credenciales solo cuando exista listado | Identidad, contexto institucional y cerrar sesión | Crear credencial |
| Wallet y Perfil | `/wallet/credentials` | Mis credenciales; Perfil formativo | Cuenta y cerrar sesión | Abrir credencial o construir perfil |
| Verificador Público | `/verify` o deep link | Sin navegación de aplicación | Logo Traza para superficie clara y volver a verificar | Verificar un ID |

En el MVP parcial del emisor, `Credenciales` no debe aparecer como lista
funcional hasta que exista su endpoint. El detalle se alcanza desde el draft
recién creado o mediante un ID preparado para demo.

## 13. Auth y resolución de contexto

### Flujo base

```text
POST /auth/login
-> guardar sesión según decisión técnica futura
-> GET /auth/me
-> resolver contexto
-> redirect
```

### Redirect del MVP

```text
exactamente una membership operativa
-> /issuer

más de una membership operativa
-> selección explícita requerida
-> no seleccionar silenciosamente la primera

ninguna membership operativa
-> /wallet/credentials
```

Una membership es operativa únicamente cuando está `active`, su rol es `admin`
u `operator` y `issuerAuthorizationStatus` es `authorized`. Para la demo
controlada puede usarse una cuenta con exactamente una membership operativa.

### Usuario solo titular

Si no posee ninguna membership operativa, redirigir a:

```text
/wallet/credentials
```

Una lista vacía es un estado válido.

### Usuario con exactamente una membership operativa

Para la demo, redirigir a:

```text
/issuer
```

`GET /auth/me` permite mostrar nombre, DID nullable, rol y estado institucional.
La UI no debe presentar el ID como nombre institucional. Si el issuer está
`pending` o `revoked`, el contexto es conocido pero no operativo.

### Usuario con varias memberships operativas

El schema y `/auth/me` permiten varias memberships y entregan summaries
comprensibles. Si más de una es operativa, la selección explícita es
obligatoria, pero el selector y la persistencia de la elección todavía no
están implementados.

Comportamiento:

- no inventar un selector en el MVP demo;
- no elegir silenciosamente la primera institución ni depender del orden del
  array;
- mantener el acceso institucional bloqueado hasta implementar selección y
  persistencia del contexto.

Las cuentas demo separadas y con una sola membership operativa permiten
posponer este selector. En producto real, un usuario con múltiples memberships
operativas debe elegir explícitamente la institución antes de operar.

### Usuario titular e institucional

El modelo permite ambos contextos. La demo puede usar cuentas separadas.

Evolución:

- agregar un cambio de contexto explícito;
- conservar los scopes separados `/issuer/*` y `/wallet/*`;
- no mezclar acciones institucionales y personales en la misma navegación.

### Membership viewer

No habilita emisión ni análisis PDF. Como no existe lectura issuer-facing, no
justifica hoy una experiencia institucional propia y se redirige a
`/wallet/credentials`.

### Sin contexto válido

Un `User` activo puede entrar a su wallet aunque no tenga credenciales. Si
`GET /auth/me` falla o el usuario deja de estar activo, volver a login.

### Sesión expirada

Ante `401`:

- limpiar estado local de autenticación;
- redirigir a `/login`;
- conservar un `returnTo` solo para rutas internas seguras;
- validar `returnTo` contra rutas internas permitidas para impedir open
  redirects o destinos públicos externos arbitrarios;
- no mostrar el código HTTP como mensaje principal;
- no intentar refresh porque el backend no lo implementa.

### Logout

No existe endpoint backend de logout. En v0 es una acción frontend que elimina
la sesión local y redirige a `/login`.

### Guards frontend

Los guards de ruta sirven para experiencia y redirects. Nunca reemplazan
`AuthGuard`, ownership o validaciones de membership del backend.

## 14. Portal del Emisor

### Entrada institucional

Debe comunicar:

- contexto de institución emisora cuando exista dato seguro;
- identidad del usuario;
- rol `admin` u `operator` cuando aporte claridad;
- acceso a cerrar sesión;
- próximo paso operativo.

No debe mostrar un `issuerId` como identidad principal.

### Inicio institucional

`/issuer` funciona como inicio, no como dashboard analítico.

Contenido funcional permitido:

- explicación breve del flujo;
- acción para crear una credencial;
- acceso a un detalle recién creado;
- estado de dependencias de demo cuando corresponda.

No incluir:

- métricas;
- gráficos;
- credenciales recientes;
- actividad institucional;
- estados que requieren atención;

hasta que exista un endpoint que provea esos datos.

### Credenciales

Jerarquía futura:

```text
Credenciales
-> Lista institucional
-> Nueva credencial
-> Detalle
   -> Estado de credencial
   -> Emisión
   -> Evidencia de integridad
   -> Análisis formativo
```

### Crear draft

El backend requiere:

- `issuerId`;
- `subjectUserId`;
- tipo;
- título;
- source type;
- credential subject.

Límites:

- el endpoint exige JWT, membership activa `admin` u `operator` e issuer
  autorizado;
- `issuerId` sigue siendo command-only en el body y se valida contra la sesión;
- el titular se resuelve por email exacto mediante
  `POST /issuers/:issuerId/holders/resolve`;
- la respuesta segura aporta un `subjectUserId` interno, DID nullable y label
  humano; no ofrece listado ni búsqueda parcial;
- no existe catálogo frontend de instituciones;
- el `subjectUserId` nunca es un input editable ni visible.

El frontend no debe hardcodear IDs ni presentarlos como UX definitiva.

La ruta permanece B solo por la falta de selector/persistencia del contexto
multi-issuer y por las limitaciones de continuidad de los reads
institucionales. La resolución humana y la seguridad efectiva de creación ya
residen en el backend; los route guards frontend siguen siendo únicamente UX.

### Emitir

La emisión:

- ocurre desde el detalle;
- usa el issuer persistido de la credencial;
- requiere JWT;
- valida membership activa;
- permite `admin` u `operator`;
- exige issuer autorizado;
- calcula hash y crea evidencia.

El `issuerId` requerido todavía por el body es compatibilidad técnica. No debe
ser editable ni presentarse como autoridad.

### Analizar PDF

Ocurre desde el detalle de credencial.

El flujo:

```text
seleccionar PDF
-> request síncrono al backend
-> AI Service
-> validación
-> SemanticAnalysis persistido
-> resumen seguro
```

No existe progreso, job ni segundo plano. El estado de request es transitorio.

Para la demo, analizar después de emitir aunque el servicio actual no compruebe
el status de la credencial.

### Consultar análisis

La respuesta inmediata del upload es un resumen seguro.

El endpoint de latest analysis existe, pero es público y contiene
`analysisJson` y `textForEmbedding`. Una UI issuer-facing completa requiere un
read protegido con DTO controlado.

Mientras se use temporalmente:

- el adapter HTTP debe extraer únicamente el resumen permitido;
- `analysisJson`, `textForEmbedding` y artifacts crudos no deben llegar a
  componentes;
- no debe encadenarse este read para ampliar otras vistas institucionales;
- después de recargar, puede no existir un resumen seguro recuperable;
- no se deben persistir artifacts internos en `localStorage` para simular esa
  continuidad.

Lo mismo aplica a `GET /credentials/:id` y
`GET /credentials/:id/status`: autenticar sus pantallas en frontend no
reemplaza reads autorizados por membership. La navegación institucional
completa continúa bloqueada hasta contar con esos contratos.

### Dependencias para completar el portal

Prioridad alta:

1. Completado: proteger create draft y validar membership.
2. Completado: exponer contexto institucional con nombre, DID, autorización y rol.
3. Resolver o buscar titulares de forma autorizada.
4. Agregar listado de credenciales por issuer.
5. Proteger detalle, status y latest analysis según issuer.
6. Definir paginación y filtros.

## 15. Wallet y Perfil del Titular

### Entrada

La entrada canónica es:

```text
/wallet/credentials
```

Label visible tentativo:

```text
Mis credenciales
```

`Mi Traza` sigue siendo una opción verbal, no un label definitivo.

### Mis credenciales

El listado muestra datos reales de:

```text
GET /me/credentials
```

Incluye solo credenciales propias `issued` o `revoked`.

Cada item permite:

- abrir detalle;
- reconocer institución emisora;
- distinguir estado;
- identificar evidencia disponible;
- identificar si existe análisis.

### Detalle

`GET /me/credentials/:id` devuelve un modelo apropiado para el titular:

- institución emisora;
- titular;
- credential subject;
- metadata;
- evidencia;
- latest semantic analysis;
- sin `rawData`;
- sin credenciales ajenas o drafts.

### Perfil formativo

`/wallet/profile` reúne:

- perfil actual;
- estado sin perfil;
- selección de credenciales;
- build con IA;
- resultado persistido;
- errores de dependencia.

No se crea una ruta primaria `profile/select`.

### Elegibilidad para build IA

Una credencial es elegible cuando:

```text
pertenece al titular
AND status === issued
AND latestSemanticAnalysis !== null
```

La lista de wallet permite determinarlo con datos reales.

Las credenciales revocadas o sin análisis:

- siguen visibles en Mis credenciales;
- no se ocultan;
- aparecen no elegibles dentro del flujo de perfil;
- incluyen una razón comprensible.

No usar `pendiente` si no existe un job.

### Perfil inexistente

`GET /me/profile/current` puede devolver:

```json
{
  "userId": "...",
  "currentProfile": null
}
```

Esto es un empty state, no un error.

### Build IA

La acción primaria de demo usa:

```text
POST /me/profile/build-from-ai
```

El backend valida ownership, status y latest analysis. El frontend no envía
`userId`.

### Rebuild backend

`POST /me/profile/rebuild` existe y produce
`backend_formative_profile_snapshot_v0`.

No tendrá CTA visible, no formará parte de la navegación y no se mostrará como
alternativa a `Construir perfil` en el MVP del titular. Se reserva para
herramientas internas, soporte técnico o una decisión futura explícita.

La UI no expone los nombres `backend_formative_profile_snapshot_v0` ni
`backend_deterministic_aggregation_v0`. La única acción visible de construcción
del perfil es `POST /me/profile/build-from-ai`.

`GET /me/profile/current` puede mostrar un perfil persistido sin importar su
método de generación, siempre que el DTO permita presentarlo honestamente. El
mapping de esa diferenciación técnica se define en el documento de datos y
view models.

### Estados necesarios

- sin credenciales;
- credenciales issued sin análisis;
- credenciales elegibles;
- perfil inexistente;
- perfil existente;
- build en curso;
- análisis parcial;
- confianza no disponible;
- AI Service no disponible;
- timeout;
- error de ownership o dato inválido.

## 16. Verificador Público

### Objetivo

Resolver una pregunta:

```text
¿Qué puede confirmarse sobre esta credencial con la evidencia disponible?
```

No es un dashboard.

### Entrada manual

`/verify` puede ofrecer ingreso manual de ID. Es implementable sin endpoint
adicional porque solo navega al resultado.

No debe presentarse como sharing seguro.

### Resultado por ID

Ruta:

```text
/verify/credentials/[credentialId]
```

Backend:

```text
GET /verify/credentials/:id
```

Estados reales:

```text
valid
revoked
draft
incomplete
```

Un recurso inexistente devuelve HTTP `404`; el frontend lo traduce a
`Credencial no encontrada`.

### Jerarquía conceptual

1. Resultado de verificación.
2. Identidad de la credencial.
3. Institución emisora: bloque objetivo, actualmente dependiente de backend.
4. Estado y fechas.
5. Evidencia de integridad.
6. Análisis formativo permitido.
7. Detalle técnico expandible.

### Límite del DTO actual

El DTO real incluye:

- título;
- status;
- fechas;
- hash;
- canonicalization version;
- BlockchainRecords;
- latest semantic analysis resumido.

No incluye:

- institución emisora;
- titular o subject DID;
- consulta on-chain en tiempo real;
- VerificationEvent;
- consentimiento o grant.

Por eso el resultado es categoría B hasta incorporar al menos una institución
emisora segura en el DTO.

La institución emisora sigue siendo obligatoria en la experiencia objetivo,
pero hoy no puede mostrarse con datos reales. No debe inventarse ni recuperarse
encadenando `GET /credentials/:id` u otro endpoint público genérico.

En la demo actual se omite el bloque o se presenta una ausencia transparente,
cuyo texto se definirá en microcopy. La ruta solo pasa a categoría A cuando el
DTO de verificación incluya un issuer summary seguro y suficiente.

### Estados de resultado

- `valid`: hash, versión y BlockchainRecord `registered`;
- `revoked`: credential status revoked;
- `draft`: mostrar `Credencial no emitida`;
- `incomplete`: mostrar `Verificación incompleta`;
- `404`: mostrar `Credencial no encontrada`;
- records vacíos: `Evidencia no disponible`.

No inferir invalidez cuando falta evidencia.

### Fuera del verificador v0

- login;
- dashboard;
- QR activo;
- token compartido;
- historial;
- descarga de certificado;
- contacto con la institución;
- cuenta recruiter;
- tracking visible.

## 17. Navegación global y contextual

### Elementos compartidos

- marca Traza mediante asset de superficie o fallback textual accesible;
- sistema visual;
- acceso al contexto actual;
- identidad de sesión en áreas autenticadas;
- cerrar sesión;
- ayuda contextual futura, solo si existe contenido.

### Portal del Emisor

Navegación v0:

```text
Inicio
```

`Credenciales` se agrega cuando el listado sea real. `Nueva credencial` puede
ser una acción principal sin convertirse en sección global.

### Wallet y Perfil

Navegación primaria:

```text
Mis credenciales
Perfil formativo
```

### Verificador

Sin navegación de aplicación. Mantiene la marca Traza, volver a verificar y contexto
del resultado.

### Cambio de contexto futuro

Un usuario con más de un contexto puede requerir un switcher.

No implementarlo hasta disponer de:

- nombre de institución;
- issuerId;
- rol;
- estado;
- contexto personal explícito.

## 18. Continuidad entre experiencias

### Elementos que permanecen

- marca Traza;
- paleta y tipografía;
- terminología visible;
- cards de credencial;
- badges de dominio;
- representación de institución emisora;
- evidencia de integridad;
- análisis formativo;
- copy y estados;
- detalle técnico progresivo.

### Elementos que cambian

| Dimensión | Emisor | Titular | Verificador |
|---|---|---|---|
| Densidad | Operativa y mayor | Personal y acotada | Focal |
| Navegación | Contextual institucional | Dos áreas principales | Mínima |
| Acciones | Crear, emitir, analizar | Consultar y construir perfil | Verificar |
| Mobile | Funcional y completa | Prioridad mobile-first | Prioridad mobile-first |
| Detalle técnico | Operativo | Progresivo | Evidencia secundaria |
| Identidad | Usuario + institución | Titular | Sin sesión |

Compartir componentes no significa compartir permisos ni jerarquía.

## 19. Recorrido principal de demo

### Preparación

Antes de la demo:

- PostgreSQL, backend y AI Service activos;
- seed ejecutado;
- issuer admin y holder demo existentes;
- issuer autorizado;
- PDF académico liviano;
- `subjectUserId` del holder disponible;
- modo de evidencia definido como mock o Anvil local;
- credential ID conservado entre pasos.

### Recorrido completo

1. Abrir `/login`.
2. Iniciar sesión como usuario institucional.
3. Resolver `/auth/me` y entrar a `/issuer`.
4. Crear draft con titular preparado.
5. Navegar al detalle con el ID devuelto.
6. Emitir la credencial.
7. Subir PDF.
8. Ejecutar análisis formativo.
9. Mostrar el resumen persistido.
10. Cerrar sesión.
11. Iniciar sesión como titular.
12. Ver la credencial en `/wallet/credentials`.
13. Abrir su detalle.
14. Ir a `/wallet/profile`.
15. Seleccionar la credencial issued y analizada.
16. Construir el perfil IA.
17. Mostrar el perfil current.
18. Abrir `/verify/credentials/[credentialId]`.
19. Mostrar resultado y evidencia disponible.

### Limitaciones que deben declararse

- create draft requiere JWT y autorización institucional backend;
- el titular se resuelve mediante dato preparado, no búsqueda UI;
- no hay lista institucional;
- el detalle emisor usa ID directo;
- el verificador no recibe todavía issuer summary;
- el acceso público por ID no es sharing seguro;
- el análisis es síncrono;
- el modo mock debe rotularse como local/demo;
- Anvil requiere preparación previa para evidencia on-chain local real.

### Demo corta

```text
Emisor
-> crea, emite y analiza

Titular
-> ve credencial y construye perfil

Verificador
-> abre el ID y revisa evidencia
```

La demo debe demostrar separación de responsabilidades, no solo continuidad
visual.

## 20. Orden de implementación

### Prerrequisitos backend inmediatos

Para una experiencia institucional defendible:

1. Completado: proteger `POST /credentials/draft`.
2. Completado: enriquecer contexto de issuer en `/auth/me`.
3. Completado: agregar resolución autorizada de titular por email exacto.

P0 queda cerrado para comenzar F0/F1. El listado issuer-facing y los reads
protegidos permanecen como P1 y pueden llegar después del primer flujo
transaccional por ID.

### Fase 0: fundamentos compartidos

- shell de aplicación;
- rutas conceptuales;
- cliente HTTP a NestJS;
- sesión y manejo de `401`;
- guards de experiencia;
- tokens y tipografía;
- primitivas de estado;
- errores y loading;
- view models iniciales.

### Fase 1: Portal del Emisor mínimo

- login;
- resolución del contexto institucional;
- `/issuer` simple;
- create draft;
- redirect al detalle creado;
- issue;
- upload PDF;
- resumen de análisis;
- evidencia y estados separados.

No construir lista institucional falsa.

### Fase 2: Wallet y Perfil

- login titular;
- lista real;
- detalle propio;
- elegibilidad para perfil;
- selección dentro de `/wallet/profile`;
- build IA;
- perfil current;
- estados vacíos y errores.

### Fase 3: Verificador Público

- `/verify`;
- deep link por ID;
- estados de verificación;
- evidencia;
- análisis permitido;
- detalle técnico.

El DTO del verificador debe revisarse temprano, aunque la UI se implemente en
esta fase, para no descubrir tarde la ausencia de issuer.

### Fase 4: completar navegación institucional

Solo después de implementar:

- listado issuer-facing;
- paginación;
- filtros;
- reads protegidos;
- contexto institucional completo.

### Fase 5: capacidades futuras

- revocación;
- sharing;
- QR;
- jobs;
- storage;
- auditoría;
- gestión institucional.

## 21. Estados estructurales

| Sección | Loading | Empty | Error | Auth/permiso | Parcial/dependencia |
|---|---|---|---|---|---|
| Login | Envío de credenciales | No aplica | Credenciales inválidas, config JWT | Sesión ya válida redirige | Backend caído |
| Context resolver | `/auth/me` | Usuario sin contexto emisor | Sesión inválida | `401` | Membership incompleta |
| Holder resolution | Request exacto por email | Sin selección | Email inválido, `404`, network | JWT + membership + issuer autorizado | Sin listado ni autocomplete |
| Create draft | Envío | No aplica | `400`, `401`, `403`, `404` | JWT + membership | Requiere holder resuelto vigente |
| Detalle emisor | Carga por ID | No aplica | `404`, conflicto de estado | `403` al operar | Read genérico sin ownership |
| Issue | Acción en curso | No aplica | `400`, `403`, `409` | JWT + membership | Blockchain local/config caída |
| PDF analysis | Request indeterminado | Sin análisis | PDF inválido, `502/503/504` | `401/403` | `partial`, confidence unavailable |
| Wallet list | Carga | Sin credenciales | Backend no disponible | `401` | Sin paginación |
| Wallet detail | Carga | No aplica | `404` también oculta recurso ajeno | `401` | Sin análisis o evidencia |
| Perfil current | Carga | `currentProfile: null` | Error backend | `401` | Perfil fallback o IA |
| Build perfil IA | Acción indeterminada | Sin elegibles | Sin análisis, AI caído, timeout | `401/403` | Resultado con warnings |
| Verificación | Carga pública | No aplica | No encontrada | No requiere auth | `draft`, `incomplete`, sin evidencia |
| Lista issuer | Futuro | Futuro | Futuro | Futuro | Bloqueada por endpoint |

Reglas:

- no mostrar códigos HTTP como labels;
- `401` conduce a recuperación de sesión;
- `403` explica falta de permiso sin revelar datos;
- `404` protege recursos ajenos en wallet;
- `partial` no equivale a error;
- dependencia externa caída no modifica estados persistidos;
- loading IA es indeterminado;
- no inventar porcentaje ni background job.

## 22. Responsive a nivel de arquitectura

### Portal del Emisor

- navegación adaptable;
- funcionalidad completa en pantallas pequeñas;
- formularios apilables;
- acciones agrupables;
- tablas transformables en listas o cards;
- detalle por secciones;
- optimización de densidad para resoluciones medianas y amplias;
- sin tablet como mínimo funcional;
- sin scroll horizontal como única adaptación.

### Wallet y Perfil

- mobile-first;
- navegación corta;
- cards táctiles;
- contenido prioritario;
- selección operable con targets mínimos de `44 x 44 px`;
- detalle técnico progresivo;
- acciones persistentes solo cuando no oculten contenido.

### Verificador

- mobile-first;
- una columna focal;
- resultado reconocible temprano;
- evidencia secundaria;
- hash y datos técnicos expandibles;
- preparado visualmente para acceso futuro desde QR, sin afirmar que QR existe.

## 23. Dependencias backend

| Prioridad | Dependencia | Experiencia afectada | Resultado esperado |
|---|---|---|---|
| P0 completado | Proteger create draft | Emisor | Solo miembros autorizados crean para su issuer |
| P0 completado | Resolver titular | Emisor | Selección por email exacto autorizado, no UUID visible |
| P0 completado | Enriquecer contexto issuer | Emisor | Nombre, DID, autorización y rol visibles |
| P1 | Listado issuer-facing | Emisor | Lista real filtrada por membership |
| P1 | Reads issuer protegidos | Emisor | Detalle, status y análisis con ownership |
| P1 | DTO seguro latest analysis | Emisor | Sin `analysisJson` o texto interno |
| P1 | Issuer summary en verify DTO | Verificador | Identidad institucional verificable |
| P1 | Paginación y filtros | Emisor | Lista escalable y honesta |
| P2 | Análisis desde texto | Emisor | Cursos sin PDF cargados por institución |
| P2 | Revocación protegida | Emisor y verificador | Flujo completo de lifecycle |
| P3 | Sharing grants y QR | Titular y verificador | Acceso controlado |
| P3 | Jobs y progreso | IA | Procesamiento asíncrono real |
| P3 | Storage de PDFs | Emisor | Upload durable y controlado |
| P3 | VerificationEvent endpoint | Auditoría | Historial verificable |

Estas dependencias no requieren que la arquitectura de rutas se rehaga.

## 24. Fuera de alcance

No incorporar al MVP actual:

- analytics;
- auditoría avanzada;
- configuración institucional;
- gestión de usuarios;
- templates de credenciales;
- billing;
- marketplace;
- integraciones externas;
- app mobile nativa;
- MetaMask para titular;
- firma del titular;
- Base Sepolia como requisito frontend;
- edición de credenciales emitidas;
- carga unilateral del titular;
- frontend directo a FastAPI;
- frontend directo a blockchain;
- frontend directo a PostgreSQL.

## 25. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Navegar a funciones sin backend | Pantallas vacías o fake | Clasificar C/D y no publicarlas |
| Mezclar emisor y titular | Confusión de autoridad | Shells contextuales y rutas separadas |
| Dashboard institucional vacío | Métricas inventadas | `/issuer` como inicio operativo simple |
| Deep link sin contexto | Acceso inconsistente | Resolver sesión y validar permiso backend |
| Exponer IDs internos | UX pobre y fuga de modelo | Mostrar nombres; usar IDs solo en rutas/detalle técnico |
| Mostrar artifacts | Contrato interno filtrado | DTOs y view models seguros |
| Confundir evidencia con validez | Claim incorrecto | Estados y secciones separados |
| Diseñar sharing antes de grants | Falsa privacidad | Mantener verificación por ID como demo |
| Hardcodear seed en UI | Demo no reproducible | Preparación externa y datos obtenidos del backend |
| Ocultar gaps con estado local | Mentir sobre persistencia | Mostrar solo estados backend o de request |
| Navegación sobredimensionada | MVP vacío | Dos áreas holder, inicio emisor y verificador focal |
| Mobile recortado | Portal inoperable | Reorganización responsive, no eliminación de acciones |
| Selector multi-issuer prematuro | Selección sin contrato persistente | Mantenerlo bloqueado hasta definir selección y persistencia |
| Usar latest analysis público | Exposición de datos internos | Crear read protegido y DTO seguro |
| Asumir verificación on-chain en vivo | Confianza incorrecta | Explicar evidencia persistida actual |

## 26. Decisiones cerradas por este documento

- una única aplicación Next.js;
- login único;
- `/issuer` como entrada institucional;
- `/wallet/credentials` como entrada canónica del titular;
- `/wallet/profile` para perfil, selección y build;
- `POST /me/profile/build-from-ai` como única acción visible de construcción
  del perfil en el MVP;
- `POST /me/profile/rebuild` fuera de navegación y CTA del titular;
- `/verify` como ingreso manual;
- `/verify/credentials/[credentialId]` como resultado público;
- ausencia de dashboard del verificador;
- ausencia de dashboard analítico del issuer;
- emisión y análisis dentro del detalle;
- navegación contextual por actor;
- Portal del Emisor web responsive;
- wallet y verificador mobile-first;
- recorrido de demo por ID;
- clasificación A/B/C/D;
- orden de implementación.

## 27. Decisiones pendientes

Deben esperar:

- label final `Mi Traza` o `Mis credenciales`;
- diseño visual de navegación;
- layout de cada vista;
- props de componentes;
- microcopy definitivo;
- librería de auth;
- almacenamiento técnico del JWT;
- state management;
- data fetching y caché;
- selector multi-contexto;
- DTOs y view models finales;
- QR;
- sharing;
- revocación;
- permisos productivos;
- paginación y filtros definitivos.

No hay una pregunta de producto bloqueante para redactar el próximo documento.
La implementación completa del Portal del Emisor sí está bloqueada por las
dependencias P0 identificadas.

## 28. Criterios de aceptación

La arquitectura es aceptable si:

- mantiene una sola aplicación;
- diferencia emisor, titular y verificador;
- no mezcla permisos ni navegación;
- clasifica todas las rutas;
- usa endpoints reales;
- declara gaps sin datos fake;
- define rutas públicas y protegidas;
- explica sesión, redirects y contexto;
- registra el snapshot de código inspeccionado;
- no implementa rutas C o D como placeholders;
- no consume endpoints públicos demo-grade como contratos productivos;
- no filtra `analysisJson`, `textForEmbedding` ni artifacts a la UI;
- no inventa una institución emisora en verificación;
- no expone `POST /me/profile/rebuild` al titular;
- mantiene separados labels visibles y segmentos URL;
- define redirects MVP sin confundir viewer, titular y admin/operator;
- mantiene el portal responsive;
- mantiene wallet y verificador mobile-first;
- permite una demo end-to-end real;
- separa credencial, análisis, perfil, evidencia y verificación;
- no presenta sharing o QR como implementados;
- no presenta evidence mock como blockchain productiva;
- no diseña pantallas ni wireframes;
- prepara DTOs y view models sin adelantarlos.

## 29. Próximo documento recomendado

Crear después:

```text
docs/frontend/frontend-data-and-view-models-v0.md
```

Ese documento debe cerrar:

- inventario de DTOs reales;
- view models por experiencia;
- mappings de estados;
- normalización de datos;
- campos visibles por actor;
- adaptación de respuestas parciales;
- formato `es-AR`;
- errores y recuperación;
- adapters del cliente HTTP;
- contratos esperados por componentes.

No debe modificar endpoints ni usar tipos Prisma, FastAPI, ethers o artifacts
como modelos directos de UI.

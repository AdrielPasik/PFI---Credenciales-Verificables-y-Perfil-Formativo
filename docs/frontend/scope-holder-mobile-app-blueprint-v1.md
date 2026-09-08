# Scope: Holder Mobile Application Blueprint v1

> **PLANIFICACIÓN / SUPERSEDIDO POR LA IMPLEMENTACIÓN (2026-09-07).** La
> aplicación móvil del Titular ya está implementada en `apps/mobile`. La
> documentación de implementación vigente vive en
> `mejoras post 50%/Implementación a aplicación móvil/` y es la fuente de
> verdad cuando este blueprint y el runtime difieran. Este documento se
> conserva por su razonamiento de producto y de diseño, que sigue siendo
> válido; sus supuestos técnicos, en cambio, fueron reemplazados por lo que
> se verificó contra el backend real.

## 1. Estado, propósito y precedencia

~~~
versión: v1
carácter: normativo para dirección mobile; no implementa runtime
audiencia: Titular / Holder exclusivamente
marca: Scope
tagline: Una nueva forma de entender tu trayectoria.
~~~

Este es el blueprint maestro para una futura aplicación móvil del Titular. Define
objetivos, arquitectura de información, límites, dependencias, criterios
técnicos y fases sin elegir framework ni crear una aplicación.

Precedencia: contratos y permisos reales del backend; producto en
scope-product-positioning-v1.md; diseño compartido en
frontend-brand-and-design-system-v1.md; arquitectura web en
frontend-information-architecture-v0.md. Este documento reemplaza al handoff
inicial scope-holder-mobile-handoff-v0.md como fuente principal mobile.

## 2. Clasificación de fidelidad

| Etiqueta | Significado |
| --- | --- |
| CURRENT | Existe en runtime y tiene contrato inspeccionado. |
| TARGET MOBILE | Forma móvil deseada sobre capacidad actual reutilizable. |
| REQUIRES BACKEND | Necesita endpoint, DTO, permiso, token, paginación o contrato adicional. |
| FUTURE / UNDECIDED | Dirección sin decisión implementable todavía. |

Nunca presentar TARGET, REQUIRES BACKEND o FUTURE como pantalla, acción o dato
existente. La app móvil mantiene la frontera cliente -> NestJS; no llama FastAPI,
storage, blockchain, base de datos ni servicios internos.

## 3. Decisión Holder Web versus Holder Mobile

Scope mantiene un contexto personal y contratos compartidos, pero dos
superficies distintas:

| Dimensión | Holder Web | Holder Mobile App |
| --- | --- | --- |
| Propósito | Consulta personal en navegador. | Consulta breve, táctil y personal. |
| Jerarquía | Profile-first. | Profile-first. |
| Layout | Web responsive y desktop-capable. | Mobile-first, vertical y one-hand friendly. |
| Navegación | Shell web y enlaces contextuales. | Dos destinos primarios y drill-down. |
| Reuso | Contratos, VMs, terminología, formatos y estados. | No presupone componentes React web. |

La web del Titular no es un mock de la futura app móvil. Ser profile-first no
obliga a una columna estrecha. La app móvil reutiliza arquitectura conceptual y
contratos, no necesariamente layout, navegación ni componentes visuales web.

## 4. Hallazgos actuales de runtime

Inspección read-only confirmada:

~~~
/wallet
  -> WalletHomeRoute
  -> Mi perfil formativo, perfil actual y resumen de credenciales

/wallet/credentials
  -> WalletCredentialsRoute
  -> Mis credenciales propias issued/revoked

/wallet/credentials/[credentialId]
  -> WalletCredentialDetailRoute
  -> detalle propio, evidencia y lectura técnica progresiva
~~~

No existe /wallet/profile. La wallet actual usa WalletShell y
--traza-reading-width; esa restricción actual no define la futura composición
desktop deseada.

Capacidades CURRENT:

- login y sesión autenticada;
- GET /me/credentials y GET /me/credentials/:id;
- GET /me/profile/current y POST /me/profile/rebuild; la Wallet Web expone
  hoy `Actualizar perfil` como recuperación manual y determinística;
- POST /me/profile/build-from-ai también existe, recibe
  `{ credentialIds: string[] }`, usa los análisis almacenados y persiste una
  proyección asistida, pero no tiene CTA en la Wallet Web actual;
- credenciales propias issued y revoked;
- perfil con narrativa, áreas, habilidades, conceptos, información declarada,
  cobertura, confianza y quality flags humanizados;
- evidencia documental/textual y registro de integridad en lectura;
- sharing de perfil con token opaco: POST /me/profile/share y
  GET /share/profile/:token;
- verificación pública web de credenciales.

La sesión web persiste el access token en sessionStorage; no hay refresh token
documentado. Esto no autoriza reutilizar sessionStorage en una app móvil.

## 5. Objetivos y non-goals

Objetivos mobile:

1. comprender rápidamente el perfil formativo;
2. explorar áreas, habilidades y conceptos;
3. distinguir datos declarados, evidencia e interpretación asistida;
4. consultar credenciales y su detalle;
5. entender limitaciones, cobertura y estados sin score theatre;
6. compartir solo mediante contratos reales;
7. operar en sesiones breves y con una mano.

No es Portal del Emisor, administración institucional, emisión, upload
institucional, blockchain wallet, MetaMask, crypto wallet, signer, explorador
técnico, ATS, recruiter app, red social ni CV builder.

## 6. Principios de producto mobile

- Profile-first: el inicio personal es el perfil, no un dashboard.
- Evidence-backed: toda interpretación importante debe poder conducir
  conceptualmente a fuentes cuando el contrato lo permita.
- Progressive disclosure: comprensión primero; evidencia y técnica después.
- Personal, not institutional: hablar de tu perfil, tu formación y tus
  credenciales.
- Short-session friendly y one-hand friendly.
- Honest uncertainty: partial, cobertura limitada, falta de evidencia y
  revoked se explican.
- No score theatre: no gamificar habilidades ni expresar empleabilidad.

## 7. Arquitectura de información y navegación

Navegación principal TARGET MOBILE mientras no aparezca otra capacidad real:

~~~
Perfil
  resumen
  áreas, habilidades y conceptos
  cobertura y limitaciones
  fuentes destacadas

Credenciales
  listado
  detalle
    identidad y estado
    información emitida
    aporte formativo
    evidencia
    integridad técnica progresiva
~~~

Perfil y Credenciales son las únicas áreas primarias recomendadas. Cuenta,
logout y ayuda viven en menú contextual; no justifican una tab principal. Desde
una fuente del Perfil se abre el mismo detalle de credencial, no una pantalla
duplicada.

## 8. Mapa de pantallas

| Pantalla | Clasificación | Propósito |
| --- | --- | --- |
| Launch / resolución de sesión | TARGET MOBILE | Restaurar sesión segura o llegar a login. |
| Login | CURRENT + TARGET MOBILE | Autenticar sin exponer token. |
| Perfil loading / empty / available / partial | CURRENT + TARGET MOBILE | Comprensión principal de trayectoria. |
| Mis credenciales / empty / error | CURRENT + TARGET MOBILE | Biblioteca de evidencia emitida. |
| Detalle issued / revoked | CURRENT + TARGET MOBILE | Comprender una fuente personal. |
| Evidence / integrity disclosure | CURRENT + TARGET MOBILE | Detalle permitido y secundario. |
| Compartir perfil | CURRENT + TARGET MOBILE | Acción dentro de Perfil; token opaco y share sheet futuro. |
| Perfil público compartido | CURRENT web + TARGET MOBILE | Vista resumida por token. |
| Área, skill o concepto detallado | REQUIRES BACKEND | Requiere provenance direccionable. |
| Contextual Analysis | FUTURE / UNDECIDED | No hay contrato de pantalla cerrado. |
| Offline cache / notificaciones | FUTURE / REQUIRES BACKEND | Requiere arquitectura adicional. |

## 9. Especificación profunda: Perfil mobile

**Propósito:** en cinco segundos, reconocer perfil, leer una síntesis prudente
y detectar formación o cobertura disponible.

**Datos CURRENT:** HolderProfileVM aporta narrativa, cantidad de credenciales,
horas oficiales, notices de cobertura, áreas, habilidades, conceptos, datos
declarados, confidence, flags humanizados y fecha de generación. La lista de
credenciales puede cargarse en paralelo.

**Above the fold TARGET MOBILE:**

1. encabezado personal y síntesis narrativa;
2. estado de disponibilidad y limitación relevante;
3. áreas principales, no una grilla de métricas;
4. acceso a fuentes o credenciales destacadas.

**Exploración posterior:** habilidades y conceptos con volumen controlado,
horas oficiales separadas de estimadas por IA, información emitida separada de
inferencias, notices de cobertura y credenciales fuente disponibles.

**Estados:** skeleton estable; empty que no niega capacidades; partial con
limitación clara; error recuperable que conserva acceso a credenciales; no
inventar cero cuando faltan horas o confidence.

**Acciones:** abrir credencial, abrir biblioteca, compartir perfil si existe
current profile y `Actualizar perfil`. La acción actual llama
`POST /me/profile/rebuild`, no ejecuta IA y no debe ser automática ni
optimista. `POST /me/profile/build-from-ai` es una capacidad backend disponible
sin CTA Web vigente; su visibilidad Mobile requiere una decisión de producto y
un contrato de selección explícito.

**Touch/accesibilidad:** scroll vertical, targets de 44 x 44 px, labels de
estado, orden de lectura coherente y alternativa visible a cualquier gesto.

## 10. Especificación: Mis credenciales mobile

Es la biblioteca personal de fuentes de respaldo, no una wallet de
certificados ni tabla institucional.

Datos CURRENT: HolderCredentialListItemVM con referencia interna, título, tipo,
estado issued/revoked, emisor, fecha, señal de integridad y señal de análisis.
El backend actual ordena por fecha de emisión descendente; no inventar
favoritos, filtros, búsqueda o agrupaciones.

Card TARGET MOBILE:

- título y tipo;
- emisor y fecha si existen;
- estado emitida/revocada con texto;
- indicadores discretos de análisis/evidencia confirmados por VM;
- target completo que abre detalle.

Paginación, carga incremental y filtros son REQUIRES BACKEND si el volumen deja
de ser razonable. Estados: loading, empty, error recuperable y revoked visible.

## 11. Especificación: Detalle de credencial mobile

Jerarquía TARGET MOBILE:

1. identidad de la formación: título, tipo, estado e institución;
2. aporte formativo: información emitida e interpretación si existe;
3. evidencia documental/textual en modo lectura;
4. integridad técnica como disclosure secundario;
5. verificación pública solo cuando el estado sea elegible.

HolderCredentialDetailVM actual incluye descripción, horas, emisor/DID, titular
propio, subject allowlisted, evidencia documental, preview textual, hash corto,
registros técnicos y análisis completed/partial. No usar holder email para
sharing ni mostrarlo en superficie pública.

No hay acciones de emisor, upload, emisión, edición ni análisis directo. issued,
revoked, loading, no encontrado, sin evidencia, sin análisis y análisis partial
requieren presentación explícita.

## 12. Evidence, provenance y perfil -> fuente

CURRENT: Perfil y detalle separan información declarada, interpretación,
evidencias y un resumen seguro de provenance. El perfil no expone una relación
navegable exacta área/skill/concept -> credential con IDs de fuente.

TARGET MOBILE: explicar que áreas y habilidades se organizan a partir de
credenciales y análisis disponibles, y enlazar a credenciales destacadas reales.

REQUIRES BACKEND: responder “qué evidencia respalda esta habilidad o área”
requiere un read model allowlisted, provenance direccionable, orden estable,
límites de volumen y política de privacidad. No inferir vínculo desde textos o
labels.

## 13. Sharing y deep links

**Profile sharing CURRENT:** la acción vive dentro de `/wallet`, no en
`/wallet/share`. `POST /me/profile/share` crea un grant `profile` con token
aleatorio; solo se persiste `tokenHash`. `GET /share/profile/:token` es público
y valida scope, revocación y expiración antes de devolver una vista allowlisted:
holder label, narrativa, hasta 6 áreas, 12 habilidades, 20 conceptos y 10
credenciales emitted. No devuelve email ni evidencia cruda. El backend soporta
`expiresAt` y `revokedAt`, pero no existe UI Holder para listar, revocar o
configurar grants.

**Credential public verification CURRENT:** usa la referencia de la credencial
en `/verify`; no es un profile grant ni usa token opaco. Draft no debe obtener
enlace público.

**QR:** FUTURE. No se deduce de la existencia de enlaces.

**Contextual Analysis sharing:** FUTURE / REQUIRES BACKEND. Requiere una
política independiente; no hereda el scope de un profile share.

TARGET MOBILE: system share sheet para una URL ya autorizada, fallback de copia
manual y explicación de que el enlace muestra una versión pública resumida.

REQUIRES BACKEND: gestión/revocación de grants desde Holder, expiración
configurable por persona, previews seguros y analytics de acceso.

FUTURE / UNDECIDED: app/universal links. Recursos candidatos: perfil
autenticado, detalle propio, verificación pública y resultado contextual futuro.
No definir scheme o dominio antes de framework/deployment. Nunca usar userId,
email, DID, profileId o canonical hash como token.

## 14. Auth, red y offline

CURRENT web: login, token de acceso, logout y sessionStorage; no refresh token
documentado.

TARGET MOBILE:

- secure storage de plataforma;
- no token en UI, logs, URLs, clipboard o errores;
- revalidación en arranque y retorno de background;
- 401 limpia estado sensible y lleva a login;
- backend mantiene autoridad de permisos.

REQUIRES BACKEND: refresh/rotación, dispositivos o revocación remota si hacen
falta. Biometric unlock es FUTURE y protege acceso local, no autentica contra
backend.

La app es online required para datos actuales. TARGET: retry explícito,
feedback de conexión, cargas parciales y lazy disclosure. Offline persistente,
stale snapshots, sincronización y cola de mutaciones son FUTURE / REQUIRES
BACKEND.

## 15. Accesibilidad, touch, tablet y orientación

Aplicar WCAG y compatibilidad conceptual VoiceOver/TalkBack:

- texto escalable, contraste y estados no solo por color;
- labels para navegación, cards, disclosure y share;
- targets mínimos de 44 x 44 px;
- safe areas en header, bottom navigation y sheets;
- reduced motion; haptics opcionales y funcionales;
- gestos con alternativa visible;
- portrait-first; landscape no se bloquea;
- keyboard externo y focus lógico cuando la plataforma lo soporte.

Tablet no se convierte automáticamente en web: puede centrar contenido, usar
split view de credenciales o cards de perfil más anchas cuando aporten lectura.

## 16. Sistema visual e inventario mobile

Scope Mobile comparte logo, navy, teal, cloud, tono y límites epistemológicos
del design system. No copia layout web.

| Grupo | Componentes conceptuales | Reuso |
| --- | --- | --- |
| Navigation | Perfil/Credenciales, back, account menu | Contratos/copy; no JSX web |
| Layout | safe page, section, stack, sheet, action bar | Principios/tokens |
| Profile | hero narrativo, groups, coverage, source preview | HolderProfileVM |
| Credential | card, status, header, contribution | HolderCredential VMs |
| Evidence | summary, integrity disclosure, verify link | DTO allowlisted |
| Feedback | loading, empty, error, session expired | Semántica/copy |
| Auth | login, session gate, logout | Contrato; secure storage nuevo |
| System | share sheet, copy fallback, future deep link | Plataforma |

El app icon se deriva del isotipo aprobado: legible pequeño, con márgenes
seguros, sin wordmark, tagline, redibujo ni efectos crypto/AI. No generar asset
en esta fase.

## 17. Matriz de reutilización Web -> Mobile

| Concepto | Web actual | Equivalente mobile | Contrato/VM | Visual |
| --- | --- | --- | --- | --- |
| Perfil current | HolderProfileVM | Perfil home | Reutilizable con adapter | Rediseñar |
| Lista propia | HolderCredentialListItemVM | Biblioteca | Reutilizable | Rediseñar |
| Detalle propio | HolderCredentialDetailVM | Drill-down | Reutilizable | Rediseñar |
| Estados | badges/alerts | feedback mobile | Copy/semántica | Rediseñar |
| Fechas/horas | formatters es-AR | labels mobile | Reutilizable | No JSX web |
| Sesión | SessionProvider/store | session boundary | Contrato | Secure storage |
| Profile share | token/path | share sheet | Reutilizable | Plataforma |
| Integridad | disclosure web | sheet/disclosure | Allowlist | Rediseñar |

## 18. Matriz de gaps backend

| Capacidad | Soporte actual | Gap | Prioridad |
| --- | --- | --- | --- |
| Perfil current | GET /me/profile/current | Ninguno para lectura. | Alta |
| Rebuild manual | POST /me/profile/rebuild | CURRENT en Wallet Web; decidir su paridad Mobile. | Media |
| Build asistido | POST /me/profile/build-from-ai | Existe sin CTA Web; requiere selección explícita y decisión de producto Mobile. | Media |
| Lista/detalle | GET /me/credentials, GET /me/credentials/:id | Paginación/filtros si crece volumen. | Media |
| Provenance por item | Resumen no direccionable | DTO seguro hacia fuentes. | Alta |
| Profile sharing | Token opaco | Gestión/revocación/expiración configurable. | Media |
| Credential sharing | Verificación pública | Grant privado solo si se justifica. | Baja |
| Deep links | No contrato app | Links universales y validación. | Media |
| Refresh session | No documentado | Refresh/rotación/dispositivos. | Alta |
| Offline | No soporte | Cache/versionado/invalidación. | Baja |
| Notificaciones | No soporte | Infra, preferencias, eventos. | Baja |
| Contextual Analysis | Dirección | Contratos, reasoning, fuentes, permisos. | Futuro |

## 19. Evidence Reasoning y Contextual Analysis

Dirección de producto FUTURE:

~~~
objetivo -> requisitos -> evidencia -> reasoning
-> respaldo / parcial / ausencia de evidencia -> fuentes -> explicación
~~~

No hay contrato mobile cerrado. Debe extender Perfil y la relación
evidencia/fuente, no reemplazar credenciales ni crear un tercer tab anticipado.
Podría ser acción contextual desde Perfil o flujo independiente solo si
requisitos, permisos y fuentes lo justifican.

Nunca traducir falta de evidencia a falta de capacidad, ni usar match,
compatibility o expertise scores sin política y contrato auditados.

## 20. Framework, migración y pruebas futuras

No hay framework elegido. Evaluar TypeScript/API reuse, integraciones nativas
(secure storage, share sheet, links, push, biometría), accesibilidad,
performance, builds/releases, alcance académico, paridad iOS/Android y
mantenimiento. React Native, Expo, Flutter, PWA y native siguen abiertos.

| Fase | Alcance | Salida |
| --- | --- | --- |
| M0 | Contratos/readiness | Gaps, privacidad y auth auditados. |
| M1 | Diseño foundation | Tokens, icono, navegación, accesibilidad. |
| M2 | Auth/session | Secure storage, logout y 401. |
| M3 | Perfil | current, empty/error/partial, profile-first. |
| M4 | Credenciales | Lista/detalle, evidencia e integridad. |
| M5 | Sharing/deep links | Solo contratos aprobados. |
| M6 | Hardening | Dispositivos, red, seguridad, accesibilidad, E2E. |
| M7 | Contextual Analysis | Solo tras contrato estable. |

Validar luego adapters, API integration, navegación, auth, accesibilidad,
dispositivos, red/offline, deep links, seguridad y E2E. No publicar por
completar pantallas.

## 21. Release readiness, demo y mantenimiento

Release readiness futura incluye API URL segura, auth/privacidad, icono/splash,
crash handling, decisión de analytics, store metadata, screenshots,
accesibilidad y QA. No es un plan de publicación actual.

Para defensa: login -> Perfil -> Credenciales -> Detalle -> evidencia o
integridad secundaria -> compartir perfil solo si existe perfil current. Debe
demostrar que la trayectoria pertenece a la persona y puede comprenderse desde
evidencia; no usar Contextual Analysis hasta que esté integrado.

Riesgos: no confundir componentes con contratos reusables; no inventar
provenance; no exponer email/artifacts/tokens; no presentar hash como validez
académica; no convertir IDs en sharing privado; no ampliar con issuer, ATS,
crypto wallet o red social.

## 22. Documento graph

~~~
scope-product-positioning-v1.md
  -> producto y límites de evolución

frontend-brand-and-design-system-v1.md
  -> identidad compartida y Holder Web responsive

scope-ui-ux-handoff-context-v1.md
  -> handoff web activo

scope-holder-mobile-app-blueprint-v1.md
  -> blueprint maestro mobile activo

scope-holder-mobile-handoff-v0.md
  -> handoff inicial histórico/preliminar
~~~

Ante cambios de contrato Holder, actualizar esta clasificación, matriz de gaps y
screen specs. No crear una segunda fuente móvil normativa sin declarar
precedencia.

## 23. Detailed Mobile Screen Contracts

Esta sección es normativa para una implementación futura. Describe intención,
datos y estados; no fija framework, archivos, navegación nativa ni componentes
de una plataforma concreta.

### A. Launch / Session Resolution

| Aspecto | Contrato TARGET MOBILE |
| --- | --- |
| Propósito | Restaurar una sesión autorizada o conducir a Login sin mostrar contenido privado antes de validarla. |
| Entrada | Apertura inicial, retorno desde background o deep link autenticado. |
| Almacenamiento | Secure storage de plataforma, nunca `sessionStorage` ni token en UI, URL, clipboard o logs. |
| Revalidación | Resolver sesión contra backend al abrir y después de retorno relevante a foreground. |
| Loading | Breve y funcional; sin splash artificialmente larga ni progreso inventado. |
| Falla auth | Limpiar estado sensible y navegar a Login. |
| Falla de red | Mostrar retry; no simular perfil offline si no existe cache versionada. |
| Destino | Perfil con sesión válida; Login sin ella. |
| Accesibilidad | Anunciar carga solo mientras sea transitoria, evitar foco agresivo y respetar safe areas. |

### B. Login

Propósito y entrada: autenticar desde Launch, logout o sesión vencida. No agrega
recuperación de contraseña, registro ni biometría porque no son capacidades
actuales.

- Campos: email y contraseña con labels persistentes.
- Keyboard conceptual: email apropiado y contraseña segura; control de
  visibilidad solo si la plataforma lo aporta sin alterar autenticación.
- Autocomplete: `email` y `current-password`.
- Submit: `POST /auth/login`; evita doble envío, anuncia loading indeterminado
  y no conserva contraseña tras una falla.
- Credenciales inválidas: mensaje seguro y no enumerador.
- Network: feedback recuperable y retry, sin detalles internos.
- Sesión válida: resolución redirige a Perfil.
- Layout: respeta safe areas y teclado virtual; el CTA no queda oculto.
- Accesibilidad: labels, errores asociados, foco al primer error y contraste.

### C. Perfil

| Aspecto | Contrato |
| --- | --- |
| Entradas | Destino por defecto tras sesión, tab Perfil y retorno desde credencial. |
| Salidas | Credenciales, detalle de fuente disponible, compartir perfil y cuenta/logout. |
| Datos CURRENT | `GET /me/profile/current` y `GET /me/credentials`, adaptados a `HolderProfileVM` y `HolderCredentialListItemVM[]`. |
| Acción primaria | Abrir una fuente o Mis credenciales; no convertir métricas en CTA ficticia. |
| Secundarias CURRENT | Compartir perfil si hay profile current; `Actualizar perfil` mediante `POST /me/profile/rebuild`. |
| Build asistido | `POST /me/profile/build-from-ai` existe y recibe `credentialIds`, pero no tiene CTA Web vigente. Mobile no lo expone sin selección y decisión de producto. |
| Refresh | Recarga ambos recursos; conserva contenido previo ante error transitorio cuando exista estado seguro. |
| Scroll | Restaura posición al volver desde detalle cuando la plataforma lo permita. |
| Estados | loading, empty, available, partial/cobertura limitada, unsupported, request error y sesión vencida. |
| Accesibilidad | Headings, procedencia visible, alertas persistentes y targets de 44 x 44 px. |

Un perfil `empty` no afirma ausencia de capacidades. `partial` describe
cobertura o análisis disponibles. `unsupported` no se degrada a JSON ni a
datos inventados.

### D. Mis credenciales

| Aspecto | Contrato |
| --- | --- |
| Entradas | Tab Credenciales, CTA desde Perfil y back desde detalle. |
| Salidas | Detalle propio y Perfil mediante navegación primaria. |
| Datos CURRENT | `GET /me/credentials`, adaptado a `HolderCredentialListItemVM[]`. |
| Orden CURRENT | `issuedAt` descendente e `id` ascendente como desempate backend; sin favoritos, filtros ni búsqueda inventados. |
| Anatomía | Título, tipo, emisor, fecha si existe, estado issued/revoked y señales permitidas de análisis/evidencia. |
| Estados | loading, empty, error con retry; no contenido local ficticio. |
| Lista extensa | Paginación, filtros y carga incremental son REQUIRES BACKEND si el volumen lo exige. |
| Revocada | Permanece visible y navegable; no se trata como eliminada. |
| Accesibilidad | Lista semántica, orden estable y feedback no dependiente solo de color. |

### E. Detalle de credencial

| Aspecto | Contrato |
| --- | --- |
| Entradas | Fuente desde Perfil con referencia segura, item de Credenciales o deep link autenticado tras SessionGate. |
| Back | Vuelve a Credenciales; desde Perfil puede restaurar origen sin duplicar detalle. |
| Datos CURRENT | `GET /me/credentials/:id`, adaptado a `HolderCredentialDetailVM`. |
| Jerarquía | Identidad/estado, información declarada, interpretación si existe, evidencia en lectura e integridad progresiva. |
| Issued/revoked | Ambos consultables; revoked muestra estado/razón permitida y no habilita acciones de emisor. |
| Sin análisis / partial | Estado honesto; partial usa observaciones humanizadas, nunca flags técnicos o conclusiones fuertes. |
| Evidencia faltante | Ausencia explícita, sin preview, archivo ni hash de reemplazo. |
| Integridad | Disclosure opcional, no hero ni prueba de validez académica. |
| Verificación / share | Solo path público autorizado; credential sharing por referencia es distinto de profile sharing. |
| Accesibilidad | Heading principal, `dl`, disclosure operable y estados legibles por lector de pantalla. |

### F. Compartir perfil

CURRENT: acción dentro de Perfil, no ruta `/wallet/share`. Requiere profile
current. `POST /me/profile/share` devuelve path con token opaco y `expiresAt`,
que hoy puede ser `null`.

TARGET MOBILE: usar sheet o dialog accesible porque es una acción contextual.
Tras crear el grant, ofrecer URL pública, copia y system share sheet; input
readonly es fallback si clipboard o share sheet fallan.

- Precondición: profile current disponible.
- Privacidad: advertir vista pública resumida, sin email ni evidencia cruda;
  nunca mostrar token separado del enlace necesario.
- Falla: conservar Perfil, feedback seguro y retry.
- Expiración: mostrarla solo si response la devuelve; no afirmar vigencia
  indefinida.
- Gap: no existe UI Holder para listar, revocar o configurar grants.

### G. Sesión vencida

Tratamiento transversal, no pantalla de producto independiente salvo necesidad
de plataforma. Un `401` limpia estado sensible y conduce a Login. Puede
preservar solo un destino seguro posterior a login, nunca tokens, formularios
sensibles ni contenido privado visible.

### H. Error global / sin conectividad

Usar error inline cuando queda contenido útil y full-screen solo sin contenido
cargado o sin resolución de sesión. Incluir retry explícito; no presentar cache,
modo offline ni sincronización hasta contar con contratos de cache, versión e
invalidación. Una caída de red no modifica un estado de dominio ya recibido.

## 24. Mobile User Flows

### Flow 1 - App open

```text
launch
-> session resolution
-> valid session -> Perfil
-> no valid session / 401 -> Login
-> network unavailable -> retry state (sin datos offline falsos)
```

### Flow 2 - Profile to evidence

```text
Perfil
-> fuente o credencial disponible
-> detalle propio
-> evidencia documental/textual en lectura
-> disclosure de integridad técnica opcional
```

La navegación directa área/habilidad/concepto a credencial es REQUIRES BACKEND:
el perfil actual no expone provenance direccionable por item.

### Flow 3 - Credential library

```text
Credenciales
-> item de credencial
-> detalle propio issued o revoked
-> back -> Credenciales
```

### Flow 4 - Profile sharing CURRENT

```text
Perfil current
-> Compartir perfil
-> POST /me/profile/share
-> URL pública allowlisted
-> copiar o system share sheet
-> GET /share/profile/:token para quien recibe el enlace
```

No incluye gestión, revocación ni QR desde Holder.

### Flow 5 - Session expiration

```text
request autenticado
-> 401 / sesión expirada
-> limpiar estado sensible
-> Login
-> resolución de sesión
-> Perfil o destino seguro pendiente
```

### Flow 6 - Future Contextual Analysis

```text
Perfil
-> extension point FUTURE
-> objetivo y requisitos con contrato aprobado
-> evidencia y reasoning allowlisted
-> explicación prudente con fuentes
```

No define pantalla, tab, score ni endpoint actual.

## 25. Navigation Contract

### Primary navigation

`Perfil` es el destino default después de Session Resolution y el primer tab.
`Credenciales` es el segundo y único destino primario adicional. El estado
activo debe estar indicado con texto, no solo color o icono.

| Situación | Comportamiento TARGET MOBILE |
| --- | --- |
| Abrir aplicación autenticada | Llegar a Perfil. |
| Abrir Credenciales | Mantener Perfil y Credenciales como tabs pares; no crear una tercera tab para sharing, cuenta o Contextual Analysis. |
| Abrir detalle desde Perfil | Push a detalle; conservar contexto/origen cuando sea posible. |
| Abrir detalle desde Credenciales | Push a detalle; back devuelve a Credenciales y conserva su scroll. |
| Abrir mismo detalle desde otro origen | Reutilizar la pantalla de detalle y no duplicar rutas visuales. |
| Deep link autenticado | Resolver sesión antes de mostrar detalle; destino inválido o no autorizado usa error seguro. |
| Account/logout | Menú contextual, no tab primaria. |
| Detail | Bottom navigation puede ocultarse para foco o permanecer si no reduce contenido; elegir una sola regla por plataforma y probarla. |
| Sheet/dialog | Preferir para compartir, copy feedback y confirmaciones breves; usar navegación para recursos con historia propia. |

La restauración de estado debe priorizar tab activa, scroll de listas y destino
seguro, sin persistir tokens, texto sensible ni respuestas privadas como estado
de navegación.

## 26. Mobile Component Contracts

Los nombres son conceptuales. Un equipo futuro puede agruparlos de otro modo,
pero debe conservar responsabilidad, input allowlisted y límites de privacidad.

| Componente | Responsabilidad e input | Variantes/estados | Touch y accesibilidad | Mobile / Web |
| --- | --- | --- | --- | --- |
| `MobileAppShell` | Safe areas, SessionGate y región de contenido. | resolving, authenticated, recoverable error. | Landmarks; no contenido privado antes de sesión. | Mobile específico; comparte reglas de sesión. |
| `BottomNavigation` | Perfil/Credenciales y active state. | dos destinos; detalle según contrato. | Targets 44 px, labels visibles y lector de pantalla. | Mobile específico; comparte IA. |
| `MobileTopBar` | Contexto, back y cuenta. | root, detail, sheet trigger. | Back con nombre claro; safe-area superior. | Rediseñar. |
| `ProfileHero` | `HolderProfileVM` narrativo y resumen prudente. | available, partial, no narrative. | Heading, lectura escalable. | Comparte VM, no JSX. |
| `ProfileAreaGroup` | Áreas allowlisted con horas si existen. | data, empty, partial. | Lista y metadata textual. | Comparte VM. |
| `SkillGroup` | Habilidades allowlisted y procedencia visible. | data, empty. | Chips no son único control; texto Emisor/IA. | Comparte semántica. |
| `ConceptGroup` | Conceptos con volumen controlado. | data, empty. | Lista legible, sin dump técnico. | Comparte VM. |
| `ProfileSourcePreview` | Credential summary disponible, no provenance inferido. | available, unavailable. | Navega solo con referencia segura. | Comparte contratos. |
| `CredentialListItem` | `HolderCredentialListItemVM`. | issued, revoked, analysis/evidence disponible. | Card accesible y foco claro. | Rediseñar. |
| `CredentialDetailHeader` | Título, tipo, issuer y lifecycle. | issued, revoked. | Heading y status textual. | Comparte VM. |
| `DeclaredInformationSection` | Datos emitidos allowlisted. | populated, omitted fields. | `dl` y labels persistentes. | Comparte separación de fuente. |
| `AssistedInterpretationSection` | Análisis resumido permitido. | none, completed, partial, unsupported. | Quality notes humanizadas, sin artifacts. | Comparte VM. |
| `EvidenceSummary` | Evidencia documental/textual en lectura. | available, missing. | Disclosure o lectura lineal. | Rediseñar. |
| `IntegrityDisclosure` | Hash corto y registro técnico permitido. | available, unavailable, technical demo. | Expand/collapse con estado visible. | Comparte allowlist. |
| `ProfileShareAction` | Crear grant y presentar path seguro. | idle, creating, ready, error. | Sheet/dialog, copy fallback y mensaje anunciable. | Comparte contrato; UI plataforma. |
| `LoadingState` | Request transitorio. | profile, list, detail, session. | `aria-live` o equivalente sin anuncios repetidos. | Comparte semántica. |
| `EmptyState` | Ausencia honesta, no negación de capacidades. | profile empty, credentials empty. | Heading, recuperación solo si existe. | Comparte copy. |
| `ErrorState` | Error recuperable seguro. | network, not found, unavailable. | Retry claro, no códigos internos. | Comparte mapeo. |
| `SessionGate` | Resolver/auth failure. | loading, expired, unauthenticated. | Limpia estado sensible antes de Login. | Comparte contrato, no storage web. |

Ningún componente acepta DTO crudo, `profileJson`, artifacts IA, token,
storage path o modelos Prisma. Ningún componente decide permisos por
visibilidad.

## 27. Mobile State Matrix

Cada fila separa dominio, request, conectividad y sesión. Un mismo recurso no
debe usar `partial`, `401` o `loading` como si fueran equivalentes.

| Pantalla | Loading/request | Empty/dominio | Success/dominio | Partial/revoked/unsupported | Network / unavailable | 401 | 404 |
| --- | --- | --- | --- | --- | --- | --- |
| Launch | resolving session | no aplica | session válida | no aplica | retry de resolución | Login | no aplica |
| Login | submitting | no aplica | sesión creada | credenciales inválidas | retry seguro | no aplica | no aplica |
| Perfil | carga current + lista | `currentProfile: null` | perfil available | cobertura limitada o versión unsupported | inline/full-screen según contenido | limpiar y Login | no aplica |
| Credenciales | carga lista | sin credenciales | lista issued/revoked | revoked por item | error con retry | limpiar y Login | no aplica |
| Detalle | carga por referencia | no aplica | issued/revoked | sin análisis, análisis partial, evidencia faltante | error con retry | limpiar y Login | no encontrada/ajena seguro |
| Compartir perfil | creating grant | sin profile current: acción no disponible | URL pública creada | expiresAt `null` es ausencia, no vigencia infinita | feedback y retry | limpiar y Login | grant no disponible seguro |
| Perfil público compartido | carga token | no aplica | resumen allowlisted | datos parciales permitidos | error público y retry | no aplica | grant inexistente/revocado/expirado usa not found público |
| Contextual Analysis futuro | no implementar | no implementar | no implementar | no implementar | no implementar | no implementar | no implementar |

Reglas adicionales:

- `loading` y `submitting` son estados de request transitorios, no persistidos.
- `partial`, `issued` y `revoked` son estados de dominio visibles aunque haya
  una falla de red posterior.
- `401` es estado de sesión y prevalece sobre un error inline.
- `404` en detalle propio no revela ownership ni existencia de otro recurso.
- No hay estado offline con datos cacheados hasta soporte explícito.

## 28. Document Graph and Maintenance Rule

`scope-holder-mobile-app-blueprint-v1.md` sigue siendo la única fuente
normativa mobile activa. `scope-holder-mobile-handoff-v0.md` es histórico y no
define el layout Web ni contratos Mobile.

```text
scope-product-positioning-v1.md
  -> narrativa y límites epistemológicos
frontend-brand-and-design-system-v1.md
  -> identidad compartida y Holder Web responsive
scope-ui-ux-handoff-context-v1.md
  -> handoff de experiencia Web actual
frontend-data-and-view-models-v0.md
  -> VMs, adapters y disponibilidad de contratos
frontend-component-inventory-v0.md
  -> inventario conceptual Web y límites de componentes
scope-holder-mobile-app-blueprint-v1.md
  -> blueprint Mobile normativo y contratos de pantalla
scope-holder-mobile-handoff-v0.md
  -> antecedente histórico/preliminar
```

Cuando cambie un endpoint, DTO, grant o comportamiento Holder, primero
reconciliar este blueprint con runtime y luego actualizar referencias Web. No
crear v2 mientras esta corrección siga dentro del mismo slice aprobado.

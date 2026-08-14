# Traza Web

Aplicación web de Traza dentro del workspace
`@credential-intelligence/web`.

## Estado actual

F1a/F1b, F1c, P1b, P3, P3.1c, P3.1d-b, P3.2 y P4b incorporan los primeros
flujos reales del navegador sobre la base F0.1:

- Next.js con App Router, React y TypeScript estricto;
- Tailwind CSS 4 con variables CSS de Traza como fuente de tokens;
- componentes code-owned compatibles con shadcn/ui;
- Radix UI para primitives que requieren comportamiento accesible;
- variantes centralizadas con CVA y composición mediante `cn()`;
- iconografía funcional Lucide;
- Vitest, Testing Library y ESLint;
- login real contra `POST /auth/login`;
- validación y rehidratación de sesión mediante `GET /auth/me`;
- derivación de contexto institucional para cero, una o varias memberships
  operativas;
- portal emisor mínimo y protegido en cliente;
- resolución exacta de un titular existente por email;
- creación real de drafts dentro del issuer seleccionado;
- detalle institucional seguro del draft;
- edición manual de campos comunes y específicos por tipo con guardado
  explícito y control de concurrencia;
- selección de carrera y asignatura oficial para drafts `academic_subject`,
  con búsqueda curricular scoped y snapshot oficial aceptado desde el backend.
- creación guiada de `academic_subject` desde carrera y materia oficial, sin
  nombre provisional ni PATCH posterior al alta;
- carga multipart de evidencia documental PDF, PNG o JPEG, con validación
  preliminar, metadata segura y reemplazo explícito mientras la credencial
  permanece en borrador;
- H1.2: `/wallet` distingue el perfil interpretado por análisis (áreas,
  habilidades, conceptos) de la información declarada por instituciones
  emisoras (`emittedSkills`/`emittedCompetencies`/`emittedLearningOutcomes`),
  sin mezclar ambos orígenes ni sugerir que la IA certifica lo declarado.
- C1a-c: el editor de borrador habilita `externalUrl` ("URL del curso o
  certificado") también para `course`, con copy que aclara que es un dato
  declarado por el emisor. `/wallet/credentials/[credentialId]` agrega una
  sección "Información declarada del curso" (plataforma, proveedor,
  modalidad y URL) para credenciales `course` con esos datos, separada
  de la interpretación asistida por IA. El detalle post-emisión del emisor
  agrega una tarjeta de solo lectura equivalente para `issued`/`revoked`.
- C2: los tipos académicos se habilitan en UI únicamente para UADE mediante
  su DID, con fallback temporal por nombre para compatibilidad. Los cursos
  editan plataforma, modalidad controlada, URL, competencias y resultados de
  aprendizaje; no muestran proveedor, nivel ni skills declaradas. Las skills
  visibles requieren un análisis IA cuando exista; el análisis textual de
  cursos queda pendiente de C2b.
- C2c: `/wallet` etiqueta el total del perfil como "Horas oficiales
  declaradas" (nunca "Horas" ambiguo) y aclara que es la suma de horas
  informadas por credenciales emitidas, no una distribución por área. Las
  áreas con estimación de IA se marcan como "Horas estimadas por IA"; las
  áreas sin estimación nunca muestran "0h". Cuando corresponde, se muestran
  avisos suaves ("N credenciales no informan horas.", "N credenciales
  todavía no tienen análisis semántico.") a partir de los contadores
  `credentialsWithoutHours`/`credentialsWithoutSemanticCoverage` del
  backend. `/wallet/credentials/[credentialId]` usa la misma etiqueta
  "Horas oficiales declaradas" para el campo `hoursLabel` del detalle. La
  distribución de horas estimadas por credencial individual (no solo
  agregada por perfil) queda pendiente — requeriría exponer
  `hoursDistribution` por credencial en el read model.
- C3b: en el detalle issuer-facing (`/issuer/credentials/[credentialId]`),
  una credencial `course` o `certification` en estado `draft` o `issued`
  muestra una tarjeta "Catálogo reutilizable del emisor" con un botón
  ("Guardar como curso reutilizable" / "Guardar como certificación
  reutilizable") que llama a
  `POST /issuers/:issuerId/course-templates/from-credential/:credentialId`
  (C3a/C3a.2). Nunca aparece para `academic_subject`, `degree`, credenciales
  `revoked`, holder wallet, verifier/public ni pantallas de creación. Estados:
  idle → "Guardando…" → éxito ("Curso/Certificación guardado/a como
  reutilizable.") o aviso no-danger en 409 ("Este curso/Esta certificación
  ya fue guardado/a como reutilizable."). El botón nunca modifica la
  credencial visible ni crea una credencial nueva -- solo llama al catálogo
  reutilizable del issuer. No hay pantalla de gestión del catálogo ni
  selector en creación de credencial en este slice (quedan para un slice
  futuro tipo C3c).
- C3c: `/issuer/credentials/new` cierra el ciclo de C3b -- al elegir
  `type=course` o `type=certification` aparece "Usar contenido
  reutilizable", que busca en el catálogo del issuer actual
  (`GET /issuers/:issuerId/course-templates?search=&credentialType=`,
  siempre filtrado al tipo elegido) y permite previsualizar un resultado
  antes de aplicarlo ("Usar este contenido"). Aplicar un template
  precarga `achievementName` (visible y editable en el mismo formulario)
  y, best-effort, el resto de los campos aplicables al tipo
  (`description`/`hours`/`platformName`/`modality`/`externalUrl`/
  `competencies`/`learningOutcomes` para `course`;
  `description`/`hours`/`certificationCode`/`expirationDate`/
  `providerName`/`level`/`skills`/`competencies` para `certification`)
  mediante un `PATCH` inmediatamente después de crear el draft, reusando
  el mismo endpoint que ya usa el editor de borrador -- nunca envía
  `templateId` (no existe ese campo) ni copia `skills`/`providerName`/
  `level` a un `course`, ni `platformName`/`modality`/`learningOutcomes`
  a una `certification`. Nunca copia `SemanticAnalysis`,
  `lastSemanticAnalysisId` como si fuera análisis propio, ni datos de
  aprobación semántica (eso es C4). Cambiar el tipo de credencial limpia
  la selección de template. `academic_subject`/`degree` no muestran este
  selector -- siguen su flujo académico existente sin cambios. No hay
  pantalla de gestión del catálogo en este slice.
- C4a.2: en el mismo detalle issuer-facing, justo después de la tarjeta de
  C3b, aparece "Interpretación semántica revisable" cuando la credencial
  ya fue guardada como reutilizable **y** tiene un `lastSemanticAnalysisId`
  usable. El template se determina en este orden: (1) el que devuelve el
  guardado exitoso de C3b; (2) si no, una búsqueda automática al
  cargar/recargar la página vía `listCourseTemplates` (filtrando por
  `credentialType` + `search` por título, y despúes por
  `createdFromCredentialId === credentialId` del lado del cliente -- no se
  agregó un endpoint de búsqueda por credencial); (3) si el guardado
  devuelve `409`, se reintenta la misma búsqueda para recuperar el
  template existente. Si no se puede determinar el template, o si no tiene
  análisis semántico asociado, **nunca se muestra el botón de
  aprobación** -- en el segundo caso se muestra el aviso suave "Este
  contenido reutilizable todavía no tiene una interpretación semántica
  asociada para aprobar."
  Antes de habilitar "Aprobar interpretación para reutilización" se carga
  un resumen seguro (`GET .../course-templates/:templateId/approved-analysis/candidate/from-semantic-analysis/:semanticAnalysisId`,
  agregado en C4a.2): áreas/habilidades/conceptos detectados, si hay
  distribución horaria, warnings y quality flags -- nunca el snapshot
  completo ni evidencia cruda. El botón solo se habilita si ese resumen
  cargó con éxito (nunca se aprueba a ciegas). Aprobar llama
  `POST .../course-templates/:templateId/approved-analysis/from-semantic-analysis/:semanticAnalysisId`
  (el mismo endpoint de C4a.1). Si el template ya tenía
  `approvedSemanticAnalysisId` (recarga de página), se muestra
  "Interpretación ya aprobada para reutilización." con la metadata segura
  (fecha, pipeline, taxonomía, credencial de origen, resumen) y el botón
  queda deshabilitado -- re-aprobar o revocar queda pendiente. Aprobar
  **nunca** significa que la IA certificó el contenido, nunca modifica la
  credencial visible, nunca crea una credencial nueva, nunca llama a la
  IA. Nunca aparece para `academic_subject`, `degree`, credenciales
  `revoked`, ni en la wallet del titular. Aplicar la interpretación
  aprobada a credenciales nuevas o al perfil formativo queda pendiente
  para C4b.
- C4x: corrección de inconsistencias de dominio/UX detectadas en pruebas
  manuales del Portal Emisor para `course`/`certification` -- ver sección
  propia "C4x — Hardening de UX de course/certification" más abajo.

El `BrandMark` actual es un wordmark textual temporal. No representa el logo
definitivo.

Las rutas implementadas son:

- `/login`: autenticación;
- `/`: resolución del contexto institucional;
- `/issuer`: portal mínimo del emisor;
- `/issuer/credentials/new`: resolución de titular y creación de draft;
- `/issuer/credentials/[credentialId]`: detalle y edición manual del draft.
- `/wallet`: perfil formativo del titular;
- `/wallet/credentials`: biblioteca de credenciales del titular;
- `/wallet/credentials/[credentialId]`: detalle holder de solo lectura.

F1c obtiene la institución exclusivamente del contexto autenticado, conserva
el ID del titular como referencia interna y no permite crear usuarios ni
buscar por coincidencias parciales. El detalle usa el read institucional
seguro y P3 actualiza drafts mediante un PATCH sparse con el `updatedAt` de la
última respuesta aceptada. Ninguna de estas pantallas expone UUIDs como datos
de producto.

P3.1c reemplaza la edición manual de nombre, descripción, horas y carrera para
`academic_subject` por un flujo de catálogo: primero se selecciona una carrera
o plan y luego una materia perteneciente a su currícula. La selección local se
muestra como pendiente hasta que el PATCH devuelve el nuevo snapshot oficial.
Los datos de aprobación, skills y competencias continúan editables; el catálogo
no constituye por sí mismo evidencia de aprobación.

P3.1d-b aplica el mismo orden curricular al alta de una asignatura académica.
La pantalla resuelve al titular, selecciona carrera y materia, presenta un
resumen local y envía un único `POST /credentials/draft` con las dos
referencias. El backend deriva el título y el snapshot oficial. La creación
manual permanece disponible para `course`, `certification` y `degree`; el
backend restringe los tipos académicos al issuer UADE. Los emisores no-UADE
solo ven `course` y `certification`.

P3.2 presenta el issuer academico seed como
`Universidad Argentina de la Empresa (UADE)` usando siempre el nombre recibido
desde la sesion y los read models, sin hardcodearlo en componentes. El campo
opcional de calificacion de `academic_subject` conserva un decimal entre 0 y
10 con hasta dos decimales, elimina signos y caracteres incompatibles en el
estado controlado y mantiene el backend como autoridad final.

P4b agrega la sección `Evidencia documental` al detalle institucional. El
frontend acepta archivos PDF, PNG o JPEG de hasta 20 MB y los envía como
`FormData`, sin establecer manualmente el `Content-Type`. El backend continúa
siendo la autoridad sobre la firma real, MIME, extensión y SHA-256. En drafts
se puede cargar o reemplazar explícitamente la evidencia vigente; en
credenciales issued o revoked se presenta únicamente en modo lectura.

P4b no incorporaba descarga, preview, historial visible, eliminación, evidencia
textual, análisis IA automático, readiness, emisión ni blockchain. La Wallet y
el listado holder se incorporaron posteriormente en H1.
La edición P3 y el reemplazo documental P4b se limitan a credenciales en estado
`draft`.

Las reglas operativas para nuevas pantallas están en
[`frontend-ui-implementation-guidelines-v1.md`](../../docs/frontend/frontend-ui-implementation-guidelines-v1.md).

## Evidencia textual P4c-b

P4c-b agrega `Evidencia textual` al detalle institucional como una fuente
original separada de la descripcion, skills, competencias y resultados de
aprendizaje oficiales. El textarea conserva el valor raw mientras se escribe
y normaliza NFC, saltos de linea y bordes solamente al enviar. El contador y
el limite de 50.000 se calculan por code points Unicode.

La etiqueta es opcional y el body siempre la envia como string normalizado o
`null`. La fuente vigente puede reemplazarse solamente en drafts; el historial
se conserva en backend pero no es visible en este slice. Credenciales `issued`
o `revoked` muestran la fuente en modo read-only.

La evidencia textual convive con `Evidencia documental` y no modifica
automaticamente campos oficiales. P4c-b no incorpora IA automatica, readiness,
emision, blockchain, eliminacion ni historial visible.

## Análisis documental P5e-web

P5e-web agrega `Análisis inteligente del documento` al detalle institucional.
El navegador llama exclusivamente a NestJS: al cargar consulta el último
`AnalysisRun` registrado y, al iniciar una ejecución, usa el trigger documental
protegido seguido por la lectura exacta del run creado. El frontend nunca llama
FastAPI ni conoce su URL o credenciales internas.

El endpoint manual backend permanece `draft`-only, pero el Portal Emisor ya no
lo ofrece como acción visible. Un PDF vigente habilita el intento documental
automático al emitir; PNG y JPEG continúan siendo evidencia válida, aunque no
son analizables en este slice. Las credenciales `issued` o `revoked` pueden
mostrar su último análisis únicamente en modo lectura.

La sección representa estados `pending`, `running`, `completed`, `failed` y
`canceled`, y distingue un resultado semántico `completed` de uno `partial`.
Áreas, habilidades y conceptos se muestran como conteos derivados, incluso
cuando valen cero. La confianza describe la fiabilidad del análisis, no el
nivel del titular; `null` se presenta como `No informada`. Los `qualityFlags`
se transforman en observaciones legibles y nunca se expone el artifact raw.

No hay polling: después de emitir, el frontend vuelve a consultar `latest` y
deja el análisis en modo lectura. P5e-web no incorpora análisis textual o
combinado, proposals ni readiness.

## Polish del detalle emisor

Para credenciales `academic_subject`, el detalle presenta primero la referencia
académica oficial ya guardada. La carrera, la asignatura y sus códigos visibles
provienen del read model institucional; los buscadores de catálogo aparecen
únicamente después de elegir `Cambiar carrera` o `Cambiar asignatura`. Una
selección nueva continúa siendo local y pendiente hasta guardar el PATCH.

Los datos de aprobación y las competencias/habilidades permanecen editables en
secciones diferenciadas. La evidencia documental, el contenido textual y el
análisis inteligente se agrupan como evidencia de respaldo sin cambiar sus
contratos, permisos ni comportamiento. Este polish no agrega creación libre de
materias, enriquecimiento reutilizable del catálogo ni endpoints nuevos.

## Emisión institucional P6a-2

El detalle institucional permite confirmar y emitir una credencial en borrador
mediante `POST /issuers/:issuerId/credentials/:credentialId/issue`. El request
es issuer-scoped, no envía body autoritativo y acepta como nueva fuente de
verdad el read model completo devuelto por NestJS.

El navegador llama exclusivamente al backend: no firma transacciones, no usa
MetaMask, ethers, claves privadas ni RPC, y no accede a FastAPI. Tras una
emisión exitosa, la credencial queda en modo lectura y puede mostrar fecha de
emisión, huella canónica, versión de canonicalización y evidencia técnica de
integridad cuando el backend la provee. Los entornos `anvil` o `mock` se
identifican expresamente como entornos técnicos/demo, no como blockchain
pública productiva.

Las credenciales `issued` y `revoked` conservan evidencia documental, textual
y análisis inteligente en modo lectura. P6a-2 no incorpora revocación, Wallet
del holder, verificador público, QR, sharing ni operaciones blockchain desde el
frontend.

P6b agrega un intento automático documental controlado por NestJS después de
una emisión exitosa cuando existe un PDF vigente. La IA es best-effort: no
bloquea ni invalida la emisión y no participa en `canon_v1`. El navegador solo
refresca el último `AnalysisRun`; no llama FastAPI, no hace polling y no ofrece
trigger manual sobre credenciales `issued` o `revoked`. Documento y texto
permanecen visibles sin controles de carga o reemplazo en modo lectura.

P6c agrega una preparación de emisión visible. PDF vigente habilita el análisis
documental automático; evidencia textual o documental no-PDF permite emitir sin
prometer ese análisis; sin ninguna fuente, el emisor debe confirmar de forma
adicional que emitirá sin respaldo cargado en Traza. Skills, competencias y
campos de aprobación pueden generar advertencias, pero no reemplazan evidencia
ni bloquean por sí solos. El análisis textual, `combined`, worker, queue y retry
automático siguen pendientes.

## C4x — Hardening de UX de course/certification

C4x corrige inconsistencias de dominio/UX detectadas en pruebas manuales del
Portal Emisor, sin avanzar a C4b. Es exclusivamente frontend -- no se tocó
`services/api`, Prisma, `services/ai-service`, contracts ni blockchain.

**Plataforma (`platformName`) deja de ser un input libre para `course`.**
Antes, el editor del draft (`/issuer/credentials/[credentialId]`) mostraba
"Plataforma" como un `TextField` editable, lo que permitía contradicciones
(ej. el issuer es "Plataforma de Cursos Demo" pero el campo dice "Udemy").
Ahora, para `course`, se muestra en su lugar **"Entidad emisora"**
(read-only, derivada de `detail.issuer.displayName`) con el copy "El curso
será emitido por la institución activa." `platformName` ya no forma parte
de `credentialDraftFieldsByType.course`
(`credential-draft-editor.ts`) -- nunca se renderiza como input, nunca se
incluye en el `PATCH`. Un valor legacy de `platformName` (credenciales
creadas antes de este slice) se sigue mostrando, pero solo como nota de
solo lectura ("Plataforma declarada (dato legacy, solo lectura): ..."),
tanto en el editor como en la tarjeta "Datos declarados del curso" del
detalle no-draft. Nunca se afirma integración oficial con plataformas
externas ni copy tipo "verificado por Udemy/Coursera/AWS".

**`course`/`certification` no muestran una carga textual manual ni una
tarjeta técnica sustituta.** El Portal Emisor usa los datos declarados de la
credencial cuando el análisis asistido aplica, sin pedir al emisor una fuente
textual duplicada ni explicar detalles de `TextEvidence` permanentemente.
`academic_subject`/`degree` conservan su flujo manual previo. El PDF sigue
siendo una evidencia documental opcional, no un requisito conceptual de
análisis para `course`/`certification`.

**"Resultados de aprendizaje" se renombra en la UI para `course`.** El
campo sigue siendo `learningOutcomes` en el modelo/backend (sin cambios de
contrato); la UI issuer-facing ahora muestra **"Contenido e información
adicional"**, con el copy "Agregá contenidos, temario, herramientas,
conocimientos abordados u otra información relevante del curso." Para
`certification` (que no tiene `learningOutcomes`) se ajustaron los help
text de `description`/`competencies`/`skills` para aclarar que alimentan
la interpretación asistida, sin agregar ningún campo nuevo. `degree`
conserva el label académico original ("Resultados de aprendizaje") sin
cambios -- el renombre es específico de `course`/`certification`.

**El warning de "emitir sin respaldo" ahora considera el respaldo
declarativo.** Se agregó el helper puro
`hasInstitutionalTextualBacking` (`institutional-textual-backing.ts`),
que devuelve `true` para `course`/`certification` cuando hay una
descripción sustancial (≥20 caracteres) o al menos una entrada real en
`competencies`/`learningOutcomes`/`skills` -- nunca alcanza con solo el
título. Se usa tanto en `credential-issuance-section.tsx` (para no
mostrar "Sin fuente de respaldo" cuando hay respaldo declarativo
suficiente). Cuando no hay evidencia cargada ni respaldo declarativo
suficiente, se muestra una advertencia útil para completar la información
antes de emitir; no se agrega una tarjeta técnica permanente al detalle.
`academic_subject`/`degree` no se ven afectados -- conservan el copy y el
comportamiento de bloqueo original ("Sin fuente de respaldo" +
confirmación explícita). No se afirma que la IA certifica el contenido ni
que blockchain valida la información declarada.

**Selección atómica de templates reutilizables.** En
`/issuer/credentials/new`, al aplicar un template (`ReusableTemplateSearchSection`),
`credentialType` y el nombre del logro (`achievementName`) quedan
bloqueados (`disabled` en el `<select>`/`TextField`, reforzado también en
los handlers `changeCredentialType`/`onChange` para que un intento de
cambio se ignore por completo, no solo visualmente). La acción para
deseleccionar es **"Quitar contenido reutilizable"** (antes "Cambiar
selección"); solo al quitarlo se desbloquean tipo y nombre para edición
manual normal. El resto del flujo de C3c no cambia: sigue sin enviarse
`templateId` en la creación del draft, sigue aplicándose el resto de
campos mediante el `PATCH` best-effort posterior, y el aviso
`?templateApply=failed` sigue funcionando sin cambios. Nunca se copia
`SemanticAnalysis`, `lastSemanticAnalysisId` ni `approvedSemanticSnapshot`
del template -- eso sigue siendo exclusivo de C4a.1/C4a.2/C4b.

**Layout desktop más amplio para el Portal Emisor.** Se agregó la
variable CSS `--traza-issuer-reading-width` (`90rem`, contra los `75rem`
de `--traza-reading-width`) y `IssuerShell` (`components/layout/issuer-shell.tsx`)
pasó a usarla como su `max-w-*`. **La wallet del titular
(`WalletShell`/`ContextShell`) sigue usando `--traza-reading-width` sin
cambios** -- este slice explícitamente no rediseña la wallet. El resto de
la estructura (grids `lg:grid-cols-[...]` ya existentes en
`credential-draft-form.tsx`/`credential-detail-route.tsx`) se beneficia
del contenedor más ancho sin requerir cambios adicionales de layout.

Pendiente para C4b: aplicar la interpretación semántica aprobada a
credenciales nuevas creadas desde un template, y su relación con el
perfil formativo.

**C4x fix (mayormente backend, con un ajuste puntual de frontend):** el
backend genera/reutiliza `TextEvidence` y ejecuta un análisis textual
automático desde los datos declarados de `certification`, igual que ya hacía
para `course` (ver
`services/api/README.md`, sección "C4x fix", y
`docs/architecture/domain-rules-v0.md`, sección 20.1). `platformName`
también se cerró backend-side (PATCH de borrador, creación de borrador y
templates reutilizables), lo que expuso una inconsistencia real en esta
hoja: `applyTemplateToNewDraft` (`new-credential-route.tsx`) todavía
enviaba `platformName: template.platformName` en el `PATCH` best-effort
posterior a aplicar un template de `course` en C3c. Como el backend ahora
rechaza esa clave con `400` sin importar su valor, y el `PATCH` es un
único body, ese `400` habría tumbado también `modality`/`externalUrl`/
`competencies`/`learningOutcomes` -- es decir, aplicar un template de
`course` habría dejado de precargar cualquier campo, no solo la
plataforma. Se quitó esa única línea; el resto de la sección (selección
atómica, `?templateApply=failed`, etc.) no cambió. Se re-corrió la suite
completa de tests de `apps/web` (612/612, incluyendo el test actualizado
que ahora verifica que `platformName` nunca se envía) y se confirmó
manualmente que la sección de `TextEvidence` manual sigue oculta para
`certification` sin contradicción, que el warning de respaldo declarativo
sigue funcionando, que el editor de `course` sigue sin enviar
`platformName`, y que ningún copy prohibido ("IA certificó", "blockchain
valida", "verificado por Udemy/Coursera/AWS") aparece en la UI.

**C4y — hardening post-pruebas:** el detalle de `course`/`certification`
elimina también la tarjeta técnica de respaldo textual; los datos declarados
alimentan el análisis sin presentar la fuente interna. La acción de catálogo
reutilizable pasó al área de acciones, con copy compacto. Para estos tipos el
análisis puede usar título, descripción y los campos formativos declarados; el
PDF sigue siendo evidencia opcional. El estado de un run textual se describe
como información declarada, no como evidencia documental.

El perfil holder se reconstruye solo tras un análisis automático completado y
persistido. La reconstrucción conserva por separado las declaraciones del
emisor y las inferencias de IA; si falla es best-effort y queda identificada
por un código seguro. C4b sigue pendiente: ningún snapshot semántico aprobado
de un template se copia a credenciales nuevas ni al perfil.

**C5 — revisión semántica antes de reutilizar:** un borrador de
`course`/`certification` conserva solo la intención local de reutilizar. El
template se crea recién desde una credencial `issued`, después de que el
emisor revisa y aprueba etiquetas de áreas, habilidades y conceptos. La UI no
expone flags técnicos: los presenta como observaciones claras. La wallet
muestra una síntesis formativa determinística y prudente, separada de las
declaraciones institucionales y de las inferencias de IA. C4b continúa
pendiente: el snapshot aprobado no se aplica a futuras credenciales ni al
perfil.

## Verificacion publica

`/verify` permite consultar una credencial emitida o revocada sin iniciar
sesion. Acepta una referencia directa o un enlace con `?credential=...` y el
navegador consulta exclusivamente `GET /verify/credentials/:credentialId` en
NestJS, sin token y sin llamadas a FastAPI o blockchain. La vista no muestra
email del titular, evidencias crudas ni analisis IA. QR y sharing avanzado
siguen pendientes. Desde V3, el layout es desktop-first (ver seccion "V3 —
layouts publicos" mas abajo).

## Prerrequisitos

- Node.js `^20.19.0 || ^22.13.0 || >=24.0.0`;
- dependencias instaladas desde la raíz del monorepo;
- API local prevista en `http://127.0.0.1:3001`;
- web local en `http://127.0.0.1:3000`.

El rango de Node refleja la intersección soportada por Next.js, Vitest y
`jsdom@29.1.1`. Los tipos de Node se mantienen en la rama 24, alineada con el
runtime utilizado actualmente por el repositorio.

## Entorno local

Crear `apps/web/.env.local` a partir de `.env.example`:

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
```

Variable pública disponible:

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001
```

No deben guardarse secretos en variables `NEXT_PUBLIC_*`.

Para desarrollo local, la API debe ejecutarse con un secreto JWT local y CORS
restringido al origen web:

```powershell
$env:PORT="3001"
$env:WEB_ORIGIN="http://127.0.0.1:3000"
npm run dev --workspace @credential-intelligence/api
```

## Sesión demo

La sesión F1a es explícitamente demo-grade:

- `sessionStorage` guarda únicamente el access token y, cuando corresponde, la
  referencia interna del issuer elegido;
- nombres, roles y estados institucionales no se persisten como fuente de
  verdad;
- cada carga o refresh revalida la sesión mediante `/auth/me`;
- un `401` limpia la sesión y solicita un nuevo login;
- un error temporal conserva el token y ofrece reintentar o cerrar sesión;
- logout limpia token, selección y estado en memoria;
- con una institución operativa se abre `/issuer`;
- con varias se exige una elección explícita y se permite cambiarla sin cerrar
  sesión;
- sin instituciones operativas se abre `/wallet` como espacio personal del
  titular.

`sessionStorage` sigue siendo accesible al JavaScript de la página y, por lo
tanto, vulnerable ante XSS. Una evolución productiva debería evaluar cookies
`HttpOnly` y un BFF, además de rotación o refresh de sesión.

No existe un endpoint de logout: la operación es local.

## Ejecución local

Con PostgreSQL y la API disponibles, iniciar la web desde la raíz:

```powershell
npm run dev --workspace @credential-intelligence/web
```

La API debe responder en `http://127.0.0.1:3001` y la web en
`http://127.0.0.1:3000`. No documentar ni guardar credenciales, tokens o
secretos reales en este workspace.

## Comandos

Ejecutar desde la raíz:

```powershell
npm run dev --workspace @credential-intelligence/web
npm run typecheck --workspace @credential-intelligence/web
npm run lint --workspace @credential-intelligence/web
npm run test --workspace @credential-intelligence/web
npm run build --workspace @credential-intelligence/web
npm run start --workspace @credential-intelligence/web
```

## Holder Wallet v1

La experiencia del titular usa rutas propias y mobile-first:

- `/wallet`: perfil formativo actual construido a partir de credenciales y análisis disponibles;
- `/wallet/credentials`: biblioteca de credenciales emitidas o revocadas del titular;
- `/wallet/credentials/[credentialId]`: detalle de solo lectura con información emitida, fuentes de respaldo, análisis disponible y evidencia de integridad.

El navegador consume únicamente los endpoints autenticados `/me/credentials`,
`/me/credentials/:id` y `/me/profile/current` mediante NestJS. No llama a
FastAPI, S3, RPC ni servicios blockchain. Las referencias internas se usan solo
para requests y rutas; la interfaz no las presenta como datos de producto.

La Wallet no permite emitir, editar, cargar evidencia, reconstruir perfiles ni
reintentar análisis. QR, sharing, verificador público y aplicación nativa/PWA
siguen fuera de alcance.

El perfil formativo y la biblioteca de credenciales se cargan de forma
independiente. La Wallet no afirma que una credencial concreta haya sido fuente
de un perfil mientras no exista una relación de procedencia segura expuesta por
el backend; presenta ambas vistas como información disponible para el titular.

## Deployment en Vercel

P4h deja preparado el workspace para un proyecto Vercel conectado al
monorepo, sin ejecutar el deploy desde el repositorio:

- Framework Preset: `Next.js`;
- Root Directory: `apps/web`;
- Install Command: deteccion automatica de npm workspaces y del lockfile raiz;
- Build Command: `npm run build`;
- Output Directory: valor predeterminado de Next.js;
- Node.js: `24.x`, compatible con el rango declarado por el workspace;
- variable publica: `NEXT_PUBLIC_API_BASE_URL=https://<render-api-domain>`.

El frontend solo recibe la URL publica de NestJS. JWT secret, base de datos,
AWS, S3, IA y blockchain permanecen fuera de Vercel. Despues del primer deploy
de produccion, Render debe configurar `WEB_ORIGIN` con el origin HTTPS exacto
de Vercel, sin trailing slash ni wildcard. Los previews dinamicos no quedan
habilitados automaticamente por la politica CORS de un unico origin.

El procedimiento completo y el smoke Vercel -> Render -> Neon/S3 estan en
[`vercel-frontend-deployment-runbook-v0.md`](../../docs/architecture/vercel-frontend-deployment-runbook-v0.md).
V2 mantiene `/verify` sin sesión: se puede pegar un enlace público o una
referencia de credencial. La huella canónica se muestra como evidencia técnica
del resultado, pero no se acepta como código de consulta.

Desde una credencial de wallet, `Compartir credencial` construye el enlace con
el origen actual del navegador y permite copiar enlace o referencia con
fallback manual. No se genera un token nuevo para compartir una credencial.

Un holder con perfil current puede usar `Compartir perfil`. Ese flujo crea un
token opaco y abre `/share/profile/[token]`, una vista pública resumida que no
incluye email, evidencia cruda ni artefactos de IA. QR y sharing avanzado siguen
pendientes.

## V3 — layouts públicos desktop-first y hardening de UX post-emisión

V3 no cambia contratos, canon/hash, emisión, IA ni blockchain: es
exclusivamente frontend/docs. Regla de diseño explícita a partir de esta
iteración:

- Wallet privada del holder → sigue mobile-first (sin cambios en V3);
- Perfil público compartido (`/share/profile/[token]`), verificador público
  (`/verify`) e Issuer Portal → desktop-first responsive.

**Perfil público compartido:** el contenedor pasó de `max-w-4xl` a `max-w-7xl`
y las tres listas (áreas/habilidades/conceptos) usan `lg:grid-cols-3` en vez
de apilarse en una sola columna angosta. Los chips de área/habilidad/concepto
ya no dependían del ancho de la card: el `Badge` base usa `whitespace-nowrap`
para las variantes cortas del resto de la UI, así que en esta vista se
sobrescribe con `whitespace-normal break-words max-w-full` para que un chip
largo haga wrap en vez de desbordar la card. Las credenciales de respaldo se
muestran en grilla (`sm:grid-cols-2 xl:grid-cols-3`), no en una lista vertical
única. Se agregó un resumen breve (cantidad de credenciales incluidas, horas
oficiales declaradas si existen) en el header. El aviso de alcance público
("no incluye email ni evidencias crudas") se mantiene, ahora en el header.

**Verificador público (`/verify`):** mismo cambio de ancho (`max-w-7xl`). El
resultado separa "Datos de la credencial" (título, tipo, emisor, titular,
fecha) de un bloque secundario "Evidencia técnica de integridad" (huella
canónica, versión de canonicalización, red, chain id, transacción, estado y
fecha de registro) — la información técnica sigue expuesta, solo con menor
jerarquía visual. Se agregó copy explícito para que la huella canónica no se
confunda con el código que se comparte para verificar, y para explicar
`networkLabel` ("Entorno técnico/demo" para `anvil`, "Testnet" para redes de
prueba) sin exponer el nombre crudo de la red. El input inicial ahora aclara
explícitamente que no debe pegarse la huella canónica.

**Issuer detail — hueco post-emisión:** el detalle usaba un grid de dos
columnas (`items-start`, contenido principal + sidebar de acciones) y
renderizaba evidencia documental/análisis en una `<section>` aparte, después
de cerrar ese grid. Como las dos columnas del grid no comparten track de
fila, cuando la sidebar (acciones de emisión + revisión semántica) terminaba
siendo más alta que la columna principal en estado `issued` — típicamente
porque el editor de borrador ya no se muestra —, quedaba un hueco visual
debajo de "Datos declarados del curso" hasta que la sidebar terminaba y recién
ahí arrancaba evidencia documental. V3 mueve `DocumentEvidenceSection`,
`TextEvidenceSection` y `DocumentAnalysisSection` dentro de la misma columna
principal (después de los datos declarados/editor), en vez de en una sección
separada debajo de todo el grid. Esto funciona igual para `draft` e `issued`.

**Issuer detail — sin "Verificación pública":** se quitó el link/botón
`Verificación pública` del detalle del emisor (`issued`, `revoked` y
`draft`). El actor que comparte una credencial pública es el holder (wallet,
`Compartir credencial`) y el actor que consulta es el verificador (`/verify`)
o el perfil público (`Ver credencial`); el emisor no necesitaba ese atajo
operativo. No se tocó `/verify`, el endpoint público, el sharing de wallet ni
los links de credenciales dentro del perfil público.

**Issuer detail — análisis en lenguaje de producto:** se quitó el botón
`Consultar último análisis` y su copy ("La actualización es manual…"). El
estado inicial ya se carga solo al montar la vista y se refresca
automáticamente después de emitir; ya no depende de un refresh manual visible.
`DocumentAnalysisSection` ahora habla en términos de producto —
"Interpretación asistida pendiente", "Analizando…", "Interpretación lista
para revisar" (con `SemanticApprovalSection` cuando corresponde) — sin
mencionar `AnalysisRun` como concepto. Para un análisis manual fallido
mientras la credencial sigue en `draft` (el único caso en que el endpoint
`POST .../analysis-runs/document` permite reintentar, según el contrato
`draft`-only ya documentado), se agregó un botón `Reintentar análisis` que
reutiliza el `trigger()` ya existente del hook `useIssuerDocumentAnalysis` —
no se agregó ningún endpoint nuevo. Para un análisis automático fallido tras
la emisión (`trigger: "system"`, `issued`/`revoked`), donde el backend no
permite reintento manual, se mantiene únicamente el aviso seguro sin acción
inventada.

**Evidencia documental:** se confirmó que la jerarquía ya simplificada en V2
sigue sin duplicar títulos equivalentes ("Fuentes institucionales",
"Evidencia de respaldo", "Respaldo institucional" no coexisten como bloques
separados junto a "Evidencia documental"); V3 no modificó esa sección más
allá de reubicarla dentro de la columna principal.

QR y C4b/C5b (aplicar un snapshot semántico aprobado a credenciales nuevas o
al perfil formativo) siguen pendientes.

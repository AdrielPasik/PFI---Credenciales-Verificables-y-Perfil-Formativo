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
  permanece en borrador.

El `BrandMark` actual es un wordmark textual temporal. No representa el logo
definitivo.

Las rutas implementadas son:

- `/login`: autenticación;
- `/`: resolución del contexto institucional;
- `/issuer`: portal mínimo del emisor;
- `/issuer/credentials/new`: resolución de titular y creación de draft;
- `/issuer/credentials/[credentialId]`: detalle y edición manual del draft.

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
manual permanece disponible exclusivamente para `course`, `certification` y
`degree`.

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

P4b no incorpora descarga, preview, historial visible, eliminación, evidencia
textual, análisis IA automático, readiness, emisión ni blockchain. Todavía no
están implementadas la Wallet ni el listado de credenciales desde la interfaz.
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

El trigger está disponible solo para credenciales `draft` con evidencia
documental vigente en PDF. PNG y JPEG continúan siendo evidencia válida, pero
no son analizables en este slice. Las credenciales `issued` o `revoked` pueden
mostrar su último análisis únicamente en modo lectura.

La sección representa estados `pending`, `running`, `completed`, `failed` y
`canceled`, y distingue un resultado semántico `completed` de uno `partial`.
Áreas, habilidades y conceptos se muestran como conteos derivados, incluso
cuando valen cero. La confianza describe la fiabilidad del análisis, no el
nivel del titular; `null` se presenta como `No informada`. Los `qualityFlags`
se transforman en observaciones legibles y nunca se expone el artifact raw.

El reanálisis y la actualización de estado son manuales. P5e-web no incorpora
polling, análisis textual o combinado, proposals, readiness, emisión ni
blockchain.

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
- sin instituciones operativas se muestra un estado autenticado honesto, sin
  redirigir a una Wallet inexistente.

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

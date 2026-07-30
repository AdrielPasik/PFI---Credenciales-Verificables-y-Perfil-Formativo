# Traza Web

Aplicación web de Traza dentro del workspace
`@credential-intelligence/web`.

## Estado actual

F1a/F1b y F1c incorporan los primeros flujos reales del navegador sobre la
base F0.1:

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
- detalle mínimo del draft recién creado.

El `BrandMark` actual es un wordmark textual temporal. No representa el logo
definitivo.

Las rutas implementadas son:

- `/login`: autenticación;
- `/`: resolución del contexto institucional;
- `/issuer`: portal mínimo del emisor;
- `/issuer/credentials/new`: resolución de titular y creación de draft;
- `/issuer/credentials/[credentialId]`: detalle mínimo del registro.

F1c obtiene la institución exclusivamente del contexto autenticado, conserva
el ID del titular como referencia interna y no permite crear usuarios ni
buscar por coincidencias parciales. El read genérico de credencial todavía no
incluye un resumen seguro del titular; por eso el detalle no expone UUIDs ni
inventa nombre, email o DID al recargar.

Todavía no están implementadas la Wallet, la emisión, la carga de PDF, la
integración IA, la evidencia blockchain ni el listado o edición de
credenciales desde la interfaz.

Las reglas operativas para nuevas pantallas están en
[`frontend-ui-implementation-guidelines-v1.md`](../../docs/frontend/frontend-ui-implementation-guidelines-v1.md).

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

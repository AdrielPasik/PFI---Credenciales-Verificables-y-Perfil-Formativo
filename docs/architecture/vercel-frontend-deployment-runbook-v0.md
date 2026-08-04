# Runbook de frontend Next.js en Vercel v0

## Objetivo

Preparar el Portal del Emisor de Traza para un despliegue demo en Vercel,
consumiendo exclusivamente la API NestJS publica ya desplegada en Render.
Este documento describe configuracion y validacion; no crea el proyecto Vercel,
no ejecuta un deploy real y no contiene tokens, dominios reales ni secretos.

La frontera de runtime es:

```text
Browser -> Vercel/Next.js -> HTTPS -> Render/NestJS -> Neon + S3 privado
```

El browser nunca accede directamente a Neon, S3, FastAPI o blockchain. NestJS
continua siendo la unica API publica de dominio.

## Estado previo confirmado

- NestJS esta desplegado y operativo como Render Web Service;
- Render usa Neon pooled, S3 privado y blockchain `mock`;
- el frontend local ya completo un smoke contra la API publica de Render;
- `apps/web` usa `NEXT_PUBLIC_API_BASE_URL` como unica base URL de API;
- no existen URLs Render hardcodeadas ni fallbacks productivos a localhost;
- P4h no habilita IA, emision o blockchain real.

## Prerequisitos

- commit y branch de demo identificados;
- Web Service Render healthy;
- dominio publico Render conocido por el operador;
- proyecto Git accesible desde Vercel;
- `package-lock.json` raiz actualizado y sin lockfiles secundarios;
- dominio final de Vercel disponible despues del primer deploy;
- acceso operativo para actualizar `WEB_ORIGIN` en Render;
- ningun secreto en Git, variables `NEXT_PUBLIC_*`, logs o bundles.

## Inspeccion del frontend

El workspace `@credential-intelligence/web` expone:

```text
dev       -> next dev --hostname 127.0.0.1 --port 3000
build     -> next build
start     -> next start --hostname 127.0.0.1 --port 3000
lint      -> eslint .
typecheck -> tsc --noEmit
test      -> vitest run
```

Next.js usa App Router y no necesita `output: export`, rewrites, proxy, BFF ni
output directory custom. `next.config.ts` puede permanecer minimo.

`readClientEnv()` exige una `NEXT_PUBLIC_API_BASE_URL` no vacia, valida URL
HTTP/HTTPS, rechaza credenciales/query/fragmento y normaliza el slash final.
`ApiClient` combina esa base con paths relativos. No hay host local o Render
hardcodeado en codigo productivo.

## Configuracion recomendada en Vercel

Importar el repositorio desde el dashboard y crear un unico proyecto para la
aplicacion web.

| Campo Vercel | Valor recomendado |
| --- | --- |
| Framework Preset | Next.js, autodetectado |
| Root Directory | `apps/web` |
| Install Command | automatico/default de Vercel |
| Build Command | `npm run build` |
| Output Directory | default de Next.js; no override |
| Development Command | default; P4h no usa Vercel CLI |
| Production Branch | branch aprobada de demo |
| Node.js | 24.x, compatible con `apps/web/package.json` |

`apps/web` es el Root Directory porque contiene el proyecto Next.js real y su
script `build`. Vercel reconoce npm workspaces y detecta el package manager por
el `package-lock.json` de la raiz del repositorio. No crear un lockfile dentro
de `apps/web`.

Dejar Install Command en automatico permite que Vercel use el lockfile/workspace
detectado. No sobrescribirlo con `npm ci` ejecutado desde `apps/web`, donde no
existe lockfile. Si una version futura necesita un override, debe validarse en
un build limpio antes de cambiar el dashboard.

No se agrega `vercel.json`: el framework preset ya cubre build, routing y output
de este proyecto. Una configuracion versionada se justificara solo cuando exista
una necesidad real.

Referencias oficiales consultadas:

- https://vercel.com/docs/monorepos
- https://vercel.com/docs/package-managers
- https://vercel.com/docs/builds
- https://vercel.com/docs/environment-variables

## Variable publica del frontend

Configurar en el ambiente **Production** de Vercel:

```dotenv
NEXT_PUBLIC_API_BASE_URL=https://<render-api-domain>
```

La URL es publica por diseno: Next.js incluye variables `NEXT_PUBLIC_*` en el
bundle durante build. No debe contener credenciales, query, fragmento o slash
final. Cambiarla requiere un nuevo deployment; no afecta builds ya creados.

No configurar en Vercel:

- `JWT_SECRET`;
- `DATABASE_URL`;
- `AWS_REGION`, bucket, provider o credenciales AWS;
- `AI_SERVICE_BASE_URL`;
- RPC, contract address, signer o private keys blockchain;
- tokens internos NestJS-FastAPI;
- passwords demo.

El frontend no necesita secretos. El JWT de usuario se obtiene mediante login y
la sesion demo-grade existente lo conserva en `sessionStorage`; nunca se define
como variable de build.

## Coordinacion con Render WEB_ORIGIN

Despues del primer deploy, obtener el dominio HTTPS de produccion de Vercel y
actualizar manualmente en el Web Service Render:

```dotenv
WEB_ORIGIN=https://<vercel-domain>
```

Usar el origin exacto, sin trailing slash, path, query, fragmento ni wildcard.
Guardar la variable y reiniciar/redeployar Render segun el flujo operativo del
proveedor. Luego validar preflight y requests reales desde el browser Vercel.

Durante una prueba local, Render puede usar temporalmente:

```dotenv
WEB_ORIGIN=http://127.0.0.1:3000
```

Ese valor no permite simultaneamente el dominio Vercel. El backend v0 acepta un
unico origin. Para la demo final debe coincidir con produccion Vercel.

## Preview deployments

Vercel puede crear previews para branches y pull requests, pero sus dominios no
quedan autorizados automaticamente por Render. P4h no agrega wildcard, regex ni
lista dinamica de CORS.

Politica inicial:

- permitir que previews validen build/render estatico si resulta util;
- no ejecutar flujos autenticados contra Render desde previews no allowlisted;
- usar el deployment de produccion para el smoke end-to-end de la demo;
- evaluar despues un dominio de preview estable y un ambiente API separado, o
  evolucionar CORS mediante una decision de seguridad explicita.

No cambiar `WEB_ORIGIN` de produccion por cada preview aleatorio, porque puede
interrumpir el frontend estable.

## Orden del primer deploy

1. confirmar commit, branch y working tree;
2. ejecutar typecheck, lint, tests y build local con una URL placeholder segura;
3. importar el repo en Vercel;
4. seleccionar `apps/web` como Root Directory y Next.js como framework;
5. mantener install automatico, build `npm run build` y output default;
6. cargar `NEXT_PUBLIC_API_BASE_URL` en Production;
7. ejecutar el primer deploy desde el dashboard;
8. obtener el dominio final Vercel;
9. actualizar `WEB_ORIGIN` exacto en Render;
10. esperar health de Render y ejecutar el smoke desde browser;
11. revisar Network y consola sin capturar passwords, JWT o PII.

## Build local equivalente

Desde la raiz del monorepo:

```powershell
$env:NEXT_PUBLIC_API_BASE_URL="https://example.invalid"
npm run typecheck --workspace @credential-intelligence/web
npm run lint --workspace @credential-intelligence/web
npm run test --workspace @credential-intelligence/web
npm run build --workspace @credential-intelligence/web
Remove-Item Env:NEXT_PUBLIC_API_BASE_URL
```

`example.invalid` solo valida compilacion y nunca debe usarse para smoke
funcional. Para un smoke local contra Render, cargar la URL publica real en un
archivo ignorado o en la sesion, sin versionarla.

## Smoke Vercel -> Render -> Neon -> S3

Realizarlo desde un navegador normal sobre el dominio de produccion:

- abrir `/login`;
- login issuer demo: `POST /auth/login -> 200` contra Render;
- `GET /auth/me -> 200` y contexto institucional operativo;
- redireccion a `/issuer`;
- refresh conserva la sesion segun el comportamiento demo-grade actual;
- logout limpia la sesion y protege rutas issuer;
- login holder no habilita un portal emisor;
- busqueda de carrera/materia retorna catalogo real;
- crear un draft academico mediante referencias curriculares reales;
- abrir el detalle issuer-facing y refrescarlo;
- upload PDF via Render persiste evidencia en S3;
- reemplazo PNG/JPEG via Render deja una evidencia current;
- registrar/reemplazar evidencia textual;
- read model no expone provider, bucket, storage key, path o endpoint;
- Network no contiene requests directos a S3, Neon, FastAPI o blockchain;
- no se ejecutan IA, emision ni blockchain real;
- consola sin errores ni tokens/PII registrados.

No guardar passwords, JWT, IDs internos o responses sensibles en capturas y
bundles.

## Troubleshooting

### Build no encuentra dependencias o lockfile

Confirmar Root Directory `apps/web`, repo importado como monorepo npm y lockfile
solo en la raiz. Restaurar Install Command automatico antes de inventar un
override.

### `NEXT_PUBLIC_API_BASE_URL` requerida

Configurarla para Production y volver a desplegar. Las variables publicas se
inlinean en build; actualizar el dashboard no cambia deployments anteriores.

### Login funciona local pero falla en Vercel

Revisar Network. Confirmar URL Render HTTPS y `WEB_ORIGIN` igual al origin exacto
de Vercel. Un fallo CORS no se resuelve con wildcard ni enviando secrets al
frontend.

### Preview no puede consumir Render

Es esperado si su origin no esta allowlisted. Usar produccion para el smoke o
crear despues una estrategia de preview/API separada. No rotar `WEB_ORIGIN` por
cada URL efimera.

### Requests apuntan a una URL anterior

Confirmar la variable del ambiente correcto y crear un nuevo deployment. El
valor `NEXT_PUBLIC_*` queda asociado al build.

### Upload documental falla

El browser debe enviar `FormData` a NestJS sin fijar manualmente
`Content-Type`. Revisar status seguro de Render; no buscar el objeto directamente
en S3 ni agregar credenciales AWS al cliente.

### Refresh pierde sesion

Confirmar que se mantiene el mismo origin Vercel y que `/auth/me` responde. La
sesion v0 usa `sessionStorage`; no existe cookie HttpOnly ni refresh token.

## Seguridad

- ninguna variable secreta en Vercel;
- ningun secret en `NEXT_PUBLIC_*`;
- browser solo llama Render por HTTPS;
- Render conserva DB, S3, IA y blockchain del lado servidor;
- no exponer JWT, `Authorization`, passwords, PII o DTOs crudos en logs;
- no agregar proxy o rewrite que oculte una llamada directa a servicios internos;
- proteger deployments preview si contienen datos de demo sensibles;
- mantener dependency/build logs sin valores de entorno.

## Checklist antes de defensa/demo

- [ ] commit de demo identificado;
- [ ] Root Directory `apps/web`;
- [ ] Next.js detectado;
- [ ] install automatico y lockfile raiz detectado;
- [ ] build `npm run build`;
- [ ] output default;
- [ ] `NEXT_PUBLIC_API_BASE_URL` configurada solo con URL Render publica;
- [ ] deploy de produccion finalizado;
- [ ] `WEB_ORIGIN` actualizado en Render con origin exacto Vercel;
- [ ] preflight/login/auth.me en verde;
- [ ] portal, catalogo, draft y detalle en verde;
- [ ] PDF, reemplazo de imagen y texto en verde;
- [ ] read model sin storage internals;
- [ ] Network sin llamadas directas a servicios internos;
- [ ] IA, emision y blockchain real no invocados;
- [ ] responsive y consola revisados;
- [ ] logout y refresh verificados;
- [ ] capturas y logs sanitizados.

## Limites

P4h deja readiness documental y build validado, pero no crea el proyecto
Vercel, no ejecuta deploy, no configura un dominio real, no cambia Render, no
agrega BFF/cookies HttpOnly, no resuelve previews multi-origin y no implementa
holder wallet, verificador, IA, readiness, emision o blockchain real.

## Referencias operativas

- [Vercel: monorepos](https://vercel.com/docs/monorepos)
- [Vercel: package managers](https://vercel.com/docs/package-managers)
- [Vercel: builds](https://vercel.com/docs/builds)
- [Vercel: environment variables](https://vercel.com/docs/environment-variables)

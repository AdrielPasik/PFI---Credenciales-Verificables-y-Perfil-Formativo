# Runbook de API NestJS en Render v0

## Objetivo

Preparar el despliegue demo/staging de la API publica de Traza como Render Web
Service, conectada a Neon mediante pooled connection y a un bucket Amazon S3
privado. Este documento describe configuracion y operacion; no crea recursos,
no ejecuta un deploy real y no contiene secretos.

La frontera se mantiene:

```text
Vercel/Browser -> HTTPS -> Render/NestJS -> Neon + S3
                                      -> FastAPI privado (futuro P4i)
```

NestJS sigue siendo la unica API publica de dominio. El navegador no accede
directamente a Neon, S3, FastAPI ni blockchain.

## Prerequisitos

- branch y commit de demo identificados;
- base Neon migrada, seeded y verificada de forma controlada;
- pooled connection string de Neon disponible para runtime;
- Direct Connection de Neon disponible solo para administracion/migraciones;
- bucket S3 privado con Block Public Access, ACLs deshabilitadas y SSE-S3;
- principal IAM tecnico sin consola y limitado a `PutObject`, `GetObject` y
  `DeleteObject` bajo el prefijo configurado;
- origen web definitivo o placeholder operativo conocido;
- ningun secreto en Git, archivos de ejemplo, logs o bundles.

## Configuracion del Web Service

Crear manualmente un **Web Service** con runtime Node. No se agrega Blueprint ni
Docker en P4g.

| Campo Render | Valor recomendado |
| --- | --- |
| Repository | repositorio de Traza |
| Branch | branch aprobada para demo |
| Root Directory | vacio; usar la raiz del repositorio |
| Build Command | `npm ci && npm run prisma:generate --workspace @credential-intelligence/api && npm run build --workspace @credential-intelligence/api` |
| Start Command | `npm run start --workspace @credential-intelligence/api` |
| Health Check Path | `/health` |
| Auto-Deploy | deshabilitado durante preparacion; habilitar solo con proceso de release acordado |

Se usa la raiz porque el lockfile npm y la declaracion de workspaces estan en el
root del monorepo. Configurar `services/api` como Root Directory dejaria fuera
`package-lock.json` y perderia el flujo validado de `npm ci` por workspace.

El repositorio no fija actualmente Node a nivel root/API. Para evitar cambios
de runtime por defaults del proveedor, configurar `NODE_VERSION=24.11.1` en el
servicio, que coincide con el runtime usado para validar P4g. Este pin es una
decision operativa del servicio; una futura normalizacion puede versionarlo en
el repositorio con `engines` o `.node-version`.

Render provee `PORT`; no hardcodear el puerto en el start command. `main.ts`
escucha `process.env.PORT` y usa `3000` solo como fallback local.

Referencias oficiales consultadas:

- https://render.com/docs/web-services
- https://render.com/docs/monorepo-support
- https://render.com/docs/node-version
- https://render.com/docs/deploys

## Variables de entorno

Configurar los valores reales exclusivamente en el dashboard/secret manager de
Render. La tabla distingue secretos, configuracion y variables condicionales.

| Variable | Requerida | Regla demo Render |
| --- | --- | --- |
| `DATABASE_URL` | si | pooled URL de Neon para runtime; secreto |
| `PORT` | provista por Render | respetar el valor del servicio |
| `WEB_ORIGIN` | si para browser | origen HTTPS exacto de Vercel; sin path ni wildcard |
| `JWT_SECRET` | si | secreto largo, aleatorio y distinto de local |
| `JWT_EXPIRES_IN` | si | valor acordado, por ejemplo `1h` para demo |
| `DOCUMENT_STORAGE_PROVIDER` | si | `s3` |
| `AWS_REGION` | si con S3 | region del bucket |
| `AWS_S3_BUCKET` | si con S3 | nombre privado; secreto operativo |
| `AWS_ACCESS_KEY_ID` | si con S3 | credencial IAM tecnica; secreto |
| `AWS_SECRET_ACCESS_KEY` | si con S3 | credencial IAM tecnica; secreto |
| `AWS_S3_PREFIX` | si | `document-evidence` |
| `BLOCKCHAIN_EVIDENCE_MODE` | si | `mock` para el primer deploy Render |
| `AI_SERVICE_BASE_URL` | no hasta P4i | omitir mientras no exista FastAPI privado |
| `AI_SERVICE_TIMEOUT_MS` | no hasta P4i | `60000` cuando se habilite la integracion |
| `NODE_VERSION` | recomendada | `24.11.1`, pin operativo de P4g |

No configurar `AWS_S3_ENDPOINT` ni `AWS_S3_FORCE_PATH_STYLE` para AWS S3 real.
Esas variables existen solo para servicios S3-compatible controlados.

Mientras Vercel no exista, `WEB_ORIGIN` puede usar temporalmente el origen HTTPS
exacto elegido para una prueba web controlada. No usar `*`, no cargar varios
origins en una sola cadena y no agregar previews automaticamente. Cada preview
requiere una decision explicita; el runtime v0 admite un unico origen.

Mientras P4i no este desplegado, omitir `AI_SERVICE_BASE_URL` y no ejecutar los
endpoints IA. La API puede arrancar sin esa variable; una llamada accidental se
rechaza con error de configuracion mapeado a `503`, sin fallback ni persistencia
cruda. No usar una URL publica de FastAPI como placeholder.

## Neon: runtime y administracion

`DATABASE_URL` del Web Service debe ser la pooled connection string de Neon. No
copiar la Direct Connection al runtime si la estrategia aprobada es pooled.

Las operaciones administrativas se ejecutan fuera del proceso web, con la
Direct Connection cargada de forma temporal y sin imprimirla:

```text
npm run prisma:migrate:status --workspace @credential-intelligence/api
npm run prisma:migrate:deploy --workspace @credential-intelligence/api
npm run db:verify-demo --workspace @credential-intelligence/api
```

No ejecutar automaticamente migraciones o seed en el start command.

## Estrategia de migraciones y seed

Para la demo inicial:

1. revisar las migraciones incluidas en el commit;
2. cargar la Direct Connection en una sesion administrativa aislada;
3. ejecutar `prisma:migrate:status`;
4. ejecutar `prisma:migrate:deploy` como paso manual/one-off antes del deploy;
5. ejecutar `db:verify-demo`;
6. desplegar la API con pooled `DATABASE_URL`;
7. repetir `db:verify-demo` como smoke administrativo si corresponde.

No incorporar `prisma:migrate:deploy` ni `db:seed` a `start`. Esto evita
escrituras de DB en cada reinicio/cold start, repeticion accidental del seed,
fallos por permisos de runtime y acoplamiento entre disponibilidad HTTP y tareas
administrativas.

`db:seed` solo se ejecuta de forma explicita al preparar un ambiente demo nuevo.
Nunca forma parte del boot normal. No usar en Neon `migrate dev`, `migrate
reset`, `db push`, drop o reparaciones automaticas.

## Health y CORS

`GET /health` devuelve solamente:

```json
{"status":"ok"}
```

Es un liveness HTTP apropiado para el health check basico de Render: no expone
secretos y no depende de S3, FastAPI o blockchain. Tampoco demuestra salud de
Neon; `db:verify-demo` cubre esa verificacion administrativa. Un readiness
separado para DB puede evaluarse en hardening futuro sin sobrecargar `/health`.

`WEB_ORIGIN` habilita CORS solo cuando contiene un origen HTTP/HTTPS valido. La
configuracion actual permite `Authorization` y `Content-Type`, no usa wildcard,
cookies ni `credentials: true`. Para Vercel configurar el dominio exacto. Los
preview domains no quedan autorizados por patron. FastAPI privado no necesita
CORS de browser.

## Orden del primer deploy

1. confirmar commit, branch y working tree esperados;
2. validar localmente Prisma, tests y build;
3. ejecutar migraciones manuales con Direct Connection si hay pendientes;
4. ejecutar `db:verify-demo` contra Neon;
5. configurar el Web Service y sus secretos, sin desplegar todavia;
6. comprobar que runtime usa pooled Neon, S3 y blockchain `mock`;
7. ejecutar el deploy del commit aprobado;
8. esperar `/health` en verde;
9. ejecutar el smoke funcional sanitizado;
10. revisar logs sin PII, JWT, URLs privadas, bucket o storage keys.

## Smoke de Render

Con el servicio real creado y las variables cargadas, validar sin imprimir
passwords, JWT, IDs internos ni secretos:

- `GET /health` retorna `200`;
- `POST /auth/login` retorna `200`;
- `GET /auth/me` retorna contexto issuer operativo;
- busqueda de catalogo retorna resultados;
- abrir un draft existente o crear uno por el endpoint oficial;
- upload PDF crea evidencia documental `current` en S3;
- reemplazo PNG/JPEG deja una `current` y la anterior `replaced`;
- el read model issuer-facing no expone provider, bucket, key, path o endpoint;
- evidencia textual se registra y se lee por el DTO seguro;
- no se invocan IA, blockchain ni emision.

La policy IAM no necesita `ListBucket`; verificar objetos mediante el flujo
`PutObject`/`GetObject` del adapter, no mediante listados.

## Check production-like local

Con variables de operador ya cargadas y sin archivos versionados de secretos:

```powershell
npm ci
npm run prisma:generate --workspace @credential-intelligence/api
npm run build --workspace @credential-intelligence/api
npm run db:verify-demo --workspace @credential-intelligence/api
npm run start --workspace @credential-intelligence/api
```

Desde otra terminal ejecutar el mismo smoke de health, login, `/auth/me` y
catalogo. Para S3, agregar upload/reemplazo y lectura interna. Detener el proceso
y limpiar variables al finalizar. P4g no agrega un script porque los comandos
existentes ya cubren el flujo sin encapsular secretos.

## Rollback basico

- detener el deploy si build, migraciones o verificacion sanitaria fallan;
- no resetear ni modificar datos para forzar un deploy;
- si el nuevo runtime no queda healthy, volver al ultimo deploy exitoso desde
  Render y conservar la DB sin cambios destructivos;
- si hubo una migracion compatible hacia adelante, mantenerla y corregir la
  aplicacion; cualquier rollback de schema requiere plan explicito y backup;
- si falla S3, revisar IAM/configuracion sin hacer publico el bucket ni ampliar
  permisos globalmente;
- rotar inmediatamente cualquier secreto que haya sido expuesto.

## Troubleshooting

### Build no encuentra workspaces o lockfile

Confirmar Root Directory vacio y ejecutar los comandos desde la raiz. No mover
el lockfile ni instalar por separado dentro de `services/api`.

### `dist/main.js` no existe

Confirmar que el build workspace termino correctamente y que el start usa
`npm run start --workspace @credential-intelligence/api`.

### Render no detecta el puerto

No hardcodear un puerto. Confirmar que `PORT` llega al proceso y que `main.ts`
usa esa variable.

### Prisma Client ausente o desactualizado

El build command debe ejecutar `prisma:generate` antes de compilar. No usar `db
push` como reparacion.

### Conexion Neon falla

Confirmar que runtime usa pooled URL, TLS y ambiente correctos. Para migraciones
usar la Direct Connection administrativa fuera del Web Service. No imprimir la
URL en logs.

### S3 responde acceso denegado

Confirmar region, bucket, prefijo y permisos de objeto. No agregar `ListBucket`,
ACL publica ni wildcard global. Errores de aplicacion no deben mostrar bucket o
storage key.

### CORS bloquea Vercel

Comparar `WEB_ORIGIN` con el origin exacto del navegador, incluido esquema. No
usar wildcard como solucion y no confundir previews con el dominio principal.

### Endpoints IA devuelven `503`

Es el comportamiento esperado antes de P4i si `AI_SERVICE_BASE_URL` no esta
configurada. No publicar FastAPI para evitar el error.

## Seguridad

- secretos solo en Render/Neon/AWS, nunca en variables `NEXT_PUBLIC_*`;
- JWT de usuarios distinto del futuro JWT interno NestJS-FastAPI;
- bucket privado, SSE-S3 y IAM por prefijo;
- logs sin passwords, JWT, `Authorization`, connection strings, PII, contenido,
  bucket, storage key, presigned URL o private keys;
- `BLOCKCHAIN_EVIDENCE_MODE=mock` para esta etapa;
- holder sin MetaMask ni firma blockchain;
- no exponer endpoints internos de administracion.

## Checklist antes de defensa

- [ ] commit de demo identificado;
- [ ] Node fijado en configuracion Render;
- [ ] build y tests locales en verde;
- [ ] migraciones aplicadas manualmente;
- [ ] `db:verify-demo` en verde;
- [ ] pooled `DATABASE_URL` cargada en runtime;
- [ ] S3 privado e IAM minimo verificados;
- [ ] `WEB_ORIGIN` exacto;
- [ ] `/health` en verde;
- [ ] login, `/auth/me`, catalogo y draft verificados;
- [ ] upload/reemplazo documental y evidencia textual verificados;
- [ ] read models sin internals;
- [ ] IA, emision y blockchain no invocados;
- [ ] logs y capturas sanitizados;
- [ ] rollback al deploy anterior conocido.

## Limites

P4g deja readiness documental y comandos reproducibles, pero no crea el Web
Service, no despliega, no agrega CI/CD, deep health, observabilidad productiva,
backup/restore automatizado, FastAPI privado, Vercel, IA, readiness de
credenciales, emision ni blockchain productiva.

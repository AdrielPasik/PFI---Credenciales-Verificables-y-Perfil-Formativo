# Estrategia de ambientes v0

## Proposito

Definir diferencias explicitas entre local, demo/staging y produccion futura sin
permitir fallbacks silenciosos entre servicios o secretos.

## Decision

| Capacidad | Local | Demo/staging | Produccion futura |
| --- | --- | --- | --- |
| Frontend | Next.js `127.0.0.1:3000` | Vercel | Vercel Pro o equivalente |
| API | NestJS `127.0.0.1:3001` | Render Web Service | servicio dimensionado y observable |
| DB | PostgreSQL Docker | Neon demo | Neon plan productivo o equivalente |
| Storage | local default o S3 explicito | S3 privado | S3 privado con lifecycle/auditoria |
| IA | FastAPI local | Render Private Service | servicio privado dimensionado/worker |
| Blockchain | mock o Anvil | mock/Anvil garantizado | testnet/mainnet segun ADR futura |
| Secrets | `.env` local no versionado | secret manager del proveedor | KMS/workload identity cuando aplique |
| Migraciones | `migrate dev` solo desarrollo | `migrate deploy` | pipeline controlado + backup |
| Seed | datos demo locales | seed demo explicito e idempotente | no seed demo automatico |

Base Sepolia es stretch posterior de la demo; no reemplaza mock/Anvil hasta que
emision, idempotencia y reconciliacion esten cerradas.

## Reglas

- no copiar secretos entre ambientes;
- no usar `NEXT_PUBLIC_*` para secretos;
- no habilitar fallback demo -> local o IA -> mock silencioso;
- URLs y origins deben ser allowlists explicitas;
- migraciones se aplican antes de arrancar una version que las requiere;
- el seed demo nunca forma parte del boot productivo;
- artifacts y catalogos importados conservan version/checksum.

P4f agrega scripts separados para `migrate status`, `migrate deploy`, seed con
`DATABASE_URL` ya cargada y verificacion sanitaria read-only. Neon puede proveer
una URL pooled para runtime y otra directa para migraciones; ambas se configuran
fuera del repo y nunca se intercambian mediante fallback silencioso.

P4g concreta el Web Service NestJS desde la raiz del monorepo: build reproducible
con `npm ci`, Prisma Client generado antes de compilar, start mediante el script
workspace y migraciones manuales/one-off fuera del arranque. Render usa la URL
pooled de Neon, S3 privado, `WEB_ORIGIN` exacto y blockchain `mock`. El detalle
operativo esta en `render-api-deployment-runbook-v0.md`.

El Web Service P4g ya esta operativo. P4h prepara Vercel con Root Directory
`apps/web`, instalacion npm workspace detectada, build Next.js y una unica
variable publica: `NEXT_PUBLIC_API_BASE_URL` apuntando a Render. Despues del
primer deploy, Render debe recibir el origin HTTPS exacto de Vercel en
`WEB_ORIGIN`. El detalle esta en `vercel-frontend-deployment-runbook-v0.md`.

## Variables por responsabilidad

Frontend solo conoce URL publica de API. NestJS conoce DB, S3, FastAPI y signer
del ambiente. FastAPI conoce su JWT interno y configuracion analitica, pero no
credenciales de usuarios, DB de dominio, S3 o blockchain en P5 inicial.

## Alcance

- matriz de servicios, secretos, migraciones y seeds;
- estrategia reproducible para demo;
- frontera de variables publicas/privadas.

## Fuera de alcance

- archivos `.env` reales;
- secretos, manifests o pipelines ejecutables;
- disaster recovery productivo;
- multi-region o alta disponibilidad.

## Impacto en modulos actuales

Los modulos actuales deben leer configuracion explicita. P4e ya permite
`DOCUMENT_STORAGE_PROVIDER=local|s3`, valida las variables S3 obligatorias y no
instancia AWS en local. P4f deja operativas migraciones deploy, seed y
verificacion demo, ya validadas contra un Neon real administrado fuera del repo.
P4g ya opera en Render y P4h deja preparada la web sin ejecutar el deploy;
P4i-4 deja documentada la configuracion del servicio IA privado, su URL interna,
JWT service-to-service, smoke y rollback. El servicio real y su direccion deben
crearse y confirmarse manualmente durante el deploy.

## Riesgos

- drift de schema entre local y Neon;
- seed demo en base equivocada;
- CORS de previews;
- private service inaccesible por region/red;
- confundir variables publicas con secretos.

## Proximos slices relacionados

P4e-P4i, ejecucion del deploy IA y hardening posterior.

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
| Storage | `LocalDocumentStorageAdapter` | S3 privado | S3 privado con lifecycle/auditoria |
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

Los modulos actuales deben leer configuracion explicita. P4e-P4i agregaran las
variables concretas y su validacion; este documento no las implementa.

## Riesgos

- drift de schema entre local y Neon;
- seed demo en base equivocada;
- CORS de previews;
- private service inaccesible por region/red;
- confundir variables publicas con secretos.

## Proximos slices relacionados

P4e-P4i y hardening de deployment posterior.


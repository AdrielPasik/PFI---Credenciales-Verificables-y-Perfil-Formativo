# Seguridad y secretos de despliegue v0

## Proposito

Definir controles minimos para desplegar Web, API, storage y AI Service sin
trasladar secretos o autoridad al navegador.

## Decision

El JWT interno NestJS-FastAPI es distinto del JWT de usuarios. Para demo se
usa un secreto dedicado gestionado fuera del repo, con validacion estricta de:

- `iss = traza-api`;
- `aud = traza-ai-service`;
- `sub` de servicio;
- `iat`, `exp` corto y `jti` unico;
- algoritmo allowlisted;
- secreto interno distinto de `JWT_SECRET`.

P4i-3 fija HS256 y una duracion maxima de cinco minutos. FastAPI valida el
token antes de leer payloads; `/health` permanece publico. La rotacion
`current/previous` no esta implementada todavia y es el siguiente hardening.
En produccion futura se prefiere workload identity o mTLS.

## Inventario de secretos

| Componente | Secretos permitidos |
| --- | --- |
| Vercel/Next.js | ninguno en `NEXT_PUBLIC_*`; URL API no es secreta |
| Render/NestJS | DB, JWT usuarios, JWT servicio IA, AWS, signer si aplica |
| Render/FastAPI | JWT servicio IA vigente y configuracion del pipeline |
| Neon | credencial PostgreSQL solo en NestJS/migraciones |
| AWS | credenciales IAM minimas solo en NestJS |

Para Neon, `DATABASE_URL` se configura en la sesion operativa o secret manager,
nunca en Git. La URL administrativa directa puede diferir de la pooled de
runtime; migraciones y seed usan la primera cuando Neon asi lo requiere, y el
API usa la segunda. Scripts sanitarios no imprimen ninguna de ellas.

El holder no firma blockchain. La clave de testnet futura pertenece al signer
backend/issuer y nunca se guarda en PostgreSQL, Vercel o frontend.

## Red y CORS

- FastAPI objetivo es privado; la demo actual usa temporalmente un Web Service
  publico con JWT interno segun ADR 0014;
- una URL publica no autoriza consumo del navegador;
- NestJS es la unica API publica de dominio;
- CORS de NestJS usa origins explicitos de Vercel/local;
- S3 no necesita CORS para upload actual;
- TLS se exige fuera de local;
- health no expone secretos ni detalles internos.

## Correlation IDs y logs

Registrar correlation/analysis run, operacion, duracion, status, versiones y
conteos seguros. No registrar JWT, `Authorization`, password, PII, contenido
textual, bytes, prompt, respuesta cruda, storage key, presigned URL o private
key.

## S3 IAM minimo

El principal de NestJS recibe solo las acciones necesarias sobre el bucket y
prefijo de Traza. No recibe administracion global, bucket publico ni permisos
para cambiar Block Public Access.

P4e carga region, bucket y credenciales exclusivamente desde variables privadas
del API cuando `DOCUMENT_STORAGE_PROVIDER=s3`. El adapter requiere
`PutObject`, `GetObject` y `DeleteObject` sobre el prefijo configurado, aplica
cifrado server-side `AES256` y no usa ACL publica. Errores y logs no deben
incluir secretos, bucket, key completa, endpoint ni contenido documental.

En Render, esos valores y la pooled `DATABASE_URL` se cargan exclusivamente como
variables privadas del Web Service. La Direct Connection de Neon se reserva para
sesiones administrativas de migracion; no se copia al runtime. El start no
ejecuta migraciones ni seed. Con P4i-3, una `AI_SERVICE_BASE_URL` configurada y
el modo de auth se validan al construir el cliente; en modo `jwt` la URL es
obligatoria. Un deployment que aun no tenga FastAPI debe coordinar esas
variables antes de activar JWT, en lugar de publicar un servicio temporal.
La configuracion completa se encuentra en
`render-api-deployment-runbook-v0.md`. La configuracion coordinada del servicio
IA privado se encuentra en `render-ai-private-service-runbook-v0.md`.
El deployment demo real, sus riesgos y controles compensatorios se registran en
`render-ai-cloud-deployment-record-v0.md`.

Vercel recibe solamente `NEXT_PUBLIC_API_BASE_URL`, que es publica por diseno y
apunta a NestJS. No recibe JWT secret, DB, AWS, IA o blockchain. El access token
de usuario se obtiene en runtime y conserva el alcance demo-grade actual en
`sessionStorage`; no es una variable de deployment. Render debe allowlistar el
origin Vercel exacto. Los previews no quedan autorizados automaticamente ni
justifican un wildcard CORS. Ver `vercel-frontend-deployment-runbook-v0.md`.

## Alcance

- secretos por servicio;
- auth interna inicial;
- red privada, CORS, IAM y logging seguro;
- JWT interno inicial; rotacion current/previous queda pendiente.

## Fuera de alcance

- KMS/HSM, mTLS o workload identity implementados;
- auditoria/SIEM productivo;
- rate limiting distribuido;
- WAF, pentest o certificacion formal.

## Impacto en modulos actuales

P4i-3 evoluciono `AiServiceClient` y FastAPI auth middleware. P4e agrego
configuracion AWS del lado API. Auth de usuarios y `AuthGuard` no se reutilizan
como auth de servicio.

## Riesgos

- reutilizar `JWT_SECRET` de usuarios;
- aceptar audiencia/algoritmo incorrectos;
- secretos en logs o previews;
- AWS con permisos excesivos;
- token interno de larga duracion.

## Proximos slices relacionados

P4e IAM/storage, P4g deployment API, P4i-6a excepcion cloud documentada y
rotacion futura. `none/disabled` queda solo para local y no es un rollback
aceptable en demo/production. La URL publica demo conserva riesgos residuales
de scanning, abuso y disponibilidad hasta migrar a red privada.

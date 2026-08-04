# Seguridad y secretos de despliegue v0

## Proposito

Definir controles minimos para desplegar Web, API, storage y AI Service sin
trasladar secretos o autoridad al navegador.

## Decision

El JWT interno NestJS-FastAPI sera distinto del JWT de usuarios. Para demo se
usara un secreto dedicado gestionado por Render, con validacion estricta de:

- `iss = traza-api`;
- `aud = traza-ai-service`;
- `sub` de servicio;
- `iat`, `exp` corto y `jti` unico;
- algoritmo allowlisted;
- secreto `current` y `previous` durante una ventana de rotacion.

La duracion objetivo es de hasta cinco minutos. FastAPI valida el token antes
de leer payloads. En produccion futura se prefiere workload identity o mTLS.

## Inventario de secretos

| Componente | Secretos permitidos |
| --- | --- |
| Vercel/Next.js | ninguno en `NEXT_PUBLIC_*`; URL API no es secreta |
| Render/NestJS | DB, JWT usuarios, JWT servicio IA, AWS, signer si aplica |
| Render/FastAPI | JWT servicio IA current/previous y configuracion del pipeline |
| Neon | credencial PostgreSQL solo en NestJS/migraciones |
| AWS | credenciales IAM minimas solo en NestJS |

El holder no firma blockchain. La clave de testnet futura pertenece al signer
backend/issuer y nunca se guarda en PostgreSQL, Vercel o frontend.

## Red y CORS

- FastAPI es privado y no acepta trafico del navegador;
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

## Alcance

- secretos por servicio;
- auth interna inicial;
- red privada, CORS, IAM y logging seguro;
- rotacion basica current/previous.

## Fuera de alcance

- KMS/HSM, mTLS o workload identity implementados;
- auditoria/SIEM productivo;
- rate limiting distribuido;
- WAF, pentest o certificacion formal.

## Impacto en modulos actuales

P4i evolucionara `AiServiceClient` y FastAPI auth middleware. P4e agrego
configuracion AWS del lado API. Auth de usuarios y `AuthGuard` no se reutilizan
como auth de servicio.

## Riesgos

- reutilizar `JWT_SECRET` de usuarios;
- aceptar audiencia/algoritmo incorrectos;
- secretos en logs o previews;
- AWS con permisos excesivos;
- token interno de larga duracion.

## Proximos slices relacionados

P4e IAM/storage, P4g deployment API y P4i FastAPI privado/auth.

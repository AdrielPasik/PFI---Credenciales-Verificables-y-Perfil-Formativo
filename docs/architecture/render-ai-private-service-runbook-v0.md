# Runbook de AI Service privado en Render v0

## Objetivo

Preparar el despliegue demo/staging del FastAPI de Traza como servicio privado
o interno de Render, conectado exclusivamente desde el Web Service NestJS.
P4i-4 documenta configuracion y operacion: no crea servicios, no ejecuta deploy
y no incorpora secretos reales.

## Estado previo verificado

- `services/ai-service` contiene el runtime FastAPI real dentro del monorepo;
- el Dockerfile usa Python 3.12 slim, usuario no root y dependencias HTTP;
- `python -m src.api.run` escucha en `0.0.0.0` y respeta `PORT`;
- `GET /health` es un liveness tecnico sin pipelines;
- `/v1/*` requiere JWT interno cuando `AI_INTERNAL_AUTH_MODE=jwt`;
- NestJS genera un JWT HS256 de servicio por request y no reenvia el JWT humano;
- artifacts Python se validan contra los schemas compartidos;
- no existe conexion automatica desde `DocumentEvidence` o `TextEvidence`.

## Arquitectura

```text
Browser/Vercel
  -> HTTPS publico
NestJS/Render Web Service
  -> red interna + JWT de servicio
FastAPI/Render Private Service
```

El navegador nunca conoce la direccion interna, el secreto ni el token del AI
Service. FastAPI no autoriza usuarios ni persiste dominio: NestJS conserva
autenticacion, permisos, asociacion a `Credential`/`User`, validacion de
artifacts y persistencia.

## Por que un servicio privado

- evita publicar endpoints de procesamiento para consumo directo del browser;
- mantiene secretos y trafico service-to-service fuera del frontend;
- permite dimensionar Python independientemente de NestJS;
- conserva el limite de responsabilidad y el contrato HTTP ya probado;
- reduce la superficie publica sin sustituir el JWT interno.

La red privada y el JWT son controles complementarios. La red no reemplaza la
autenticacion y el JWT no justifica publicar FastAPI.

## Decision de runtime

Para demo se recomienda **Docker**, no Python native. El Dockerfile ya fue
validado, fija Python 3.12, instala solo `requirements-api.txt`, copia solo
`src` y `config`, y usa el mismo entrypoint en Windows/Linux. Esto reduce drift
respecto de un build nativo configurado manualmente.

Configuracion conceptual recomendada:

| Propiedad | Valor |
| --- | --- |
| Tipo | Private Service o servicio interno equivalente disponible |
| Root/build context | `services/ai-service` |
| Runtime | Docker |
| Dockerfile | `./Dockerfile` desde ese contexto |
| Build | gestionado por el Dockerfile; sin comando ad hoc |
| Start | CMD existente: `python -m src.api.run`; sin override |
| Puerto | `PORT` provisto por el ambiente |
| Health path | `/health` |

Los nombres de campos y capacidades pueden variar en la interfaz vigente de
Render. Durante el deploy se deben confirmar manualmente el tipo privado, root
directory, contexto, Dockerfile, health path, region/red compartida con NestJS
y direccion interna que muestre la plataforma. No asumir un hostname.

Si la plataforma toma el repositorio como contexto en lugar del root indicado,
el Dockerfile sera `services/ai-service/Dockerfile`; no mezclar ese caso con
`./Dockerfile`. La opcion elegida debe producir un contexto cuyo `.dockerignore`
excluya tests, docs, datasets, outputs, caches, modelos, PDFs, embeddings y
secretos. El build no instala `requirements-embeddings.txt`.

## Variables de FastAPI

Configurar en el servicio privado, sin versionar valores reales:

```dotenv
PORT=
AI_SERVICE_MAX_PDF_BYTES=26214400
AI_INTERNAL_AUTH_MODE=jwt
AI_INTERNAL_JWT_SECRET=
AI_INTERNAL_JWT_ISSUER=traza-api
AI_INTERNAL_JWT_AUDIENCE=traza-ai-service
AI_INTERNAL_JWT_CLOCK_SKEW_SECONDS=30
```

Reglas:

- `jwt` es obligatorio en demo/production; `disabled` queda solo para local;
- usar un secreto aleatorio de alta entropia, recomendado 32+ caracteres;
- la longitud es hardening operativo, no una validacion actual del runtime;
- el secreto debe ser distinto de `JWT_SECRET` de usuarios;
- issuer y audience deben coincidir exactamente con NestJS;
- FastAPI valida HS256, `iss`, `aud`, `sub`, `iat`, `exp` y `jti`;
- `/health` permanece sin Authorization para liveness;
- `/v1/*` permanece protegido;
- no configurar CORS para browser.

FastAPI no recibe `DATABASE_URL`, AWS keys, bucket S3, claves blockchain,
`JWT_SECRET`, `WEB_ORIGIN` ni variables `NEXT_PUBLIC_*`.

## Variables de NestJS

Configurar en el Web Service NestJS ya desplegado:

```dotenv
AI_SERVICE_BASE_URL=<private-ai-service-url>
AI_SERVICE_TIMEOUT_MS=60000
AI_SERVICE_AUTH_MODE=jwt
AI_SERVICE_JWT_SECRET=<same-internal-secret-as-fastapi>
AI_SERVICE_JWT_ISSUER=traza-api
AI_SERVICE_JWT_AUDIENCE=traza-ai-service
AI_SERVICE_JWT_EXPIRES_IN_SECONDS=60
```

`<private-ai-service-url>` significa la direccion interna exacta mostrada por
la plataforma para el servicio creado. Debe copiarse y verificarse manualmente;
no usar una URL publica ni inferir su formato. Confirmar que ambos servicios
puedan comunicarse en la region/red disponibles en la cuenta.

El secreto debe coincidir con `AI_INTERNAL_JWT_SECRET`, pero no con
`JWT_SECRET`. Estas variables pertenecen solo a Render/NestJS, nunca a Vercel,
`NEXT_PUBLIC_*`, responses o logs. En modo `jwt`, NestJS falla al iniciar si
falta la URL o una variable obligatoria.

## Orden de configuracion

1. Crear el servicio privado sin exponer secretos en source control.
2. Configurar las variables FastAPI con auth `jwt` antes de aceptar trafico.
3. Desplegar y comprobar `/health` mediante el mecanismo interno disponible.
4. Copiar la direccion interna indicada por la plataforma.
5. Configurar en NestJS la URL, modo `jwt`, secreto compartido y claims.
6. Confirmar issuer/audience identicos y secretos de usuario/servicio distintos.
7. Reiniciar o redeployar NestJS segun el flujo operativo vigente.
8. Ejecutar el smoke de servicio a servicio.

No activar `AI_SERVICE_AUTH_MODE=jwt` con configuracion incompleta. No cambiar
la auth a `none` para resolver un problema de deploy.

## Health check

`GET /health` debe responder `200` con el shape tecnico actual. No ejecuta PDF,
perfil, DB, S3 ni blockchain. Es liveness del proceso, no prueba integracion
NestJS-FastAPI ni estado de pipelines.

No enviar JWT a `/health`: `AiServiceClient.getHealth()` lo llama sin header de
autorizacion. El health no debe imprimir configuracion o secretos.

## Smoke operativo

### A. Servicio privado

- [ ] `/health` responde `200` por el mecanismo interno disponible;
- [ ] `/v1/semantic-analysis/pdf` sin token responde `401`;
- [ ] `/v1/formative-profile/build` sin token responde `401`;
- [ ] un request con JWT interno valido y fixture sintetico pequeno responde;
- [ ] issuer, audience, algoritmo y expiracion incorrectos son rechazados;
- [ ] logs no contienen token, documento, artifact completo ni secreto.

No se debe abrir FastAPI publicamente para ejecutar estas comprobaciones. Si la
plataforma no ofrece acceso operativo interno directo, realizarlas desde el
servicio NestJS o el mecanismo privado oficialmente disponible y confirmado al
momento del deploy.

### B. NestJS hacia FastAPI

Desde el runtime NestJS, con variables privadas ya cargadas:

```text
npm run ai:health --workspace @credential-intelligence/api
```

Debe confirmar health sin persistir. Para probar PDF sin asociarlo a una
credencial, usar un fixture sintetico pequeno y omitir `--credentialId`:

```text
npm run ai:analyze-pdf --workspace @credential-intelligence/api -- --file <synthetic-pdf-path>
```

- [ ] NestJS alcanza la direccion privada;
- [ ] `/v1` recibe un JWT de servicio nuevo, no el JWT humano;
- [ ] el artifact recibido valida como `semantic_analysis_v1`;
- [ ] sin `--credentialId`, el script no persiste `SemanticAnalysis`;
- [ ] un secreto desalineado produce error autenticado sanitizado;
- [ ] restaurar inmediatamente el secreto correcto y repetir el smoke;
- [ ] no usar `DocumentEvidence`, `TextEvidence` ni `AnalysisRun` en P4i-4.

La prueba deliberada con secreto incorrecto debe limitarse a staging/demo y a
una ventana controlada. Nunca registrar el token ni el valor de los secretos.

### C. Browser

- [ ] Network muestra llamadas del browser solo a NestJS;
- [ ] no aparecen llamadas directas a FastAPI, S3, Neon o blockchain;
- [ ] ninguna variable interna existe en el bundle Vercel;
- [ ] errores IA llegan como DTO HTTP sanitizado por NestJS.

## Rollback y desactivacion segura

`none/disabled` es exclusivamente local. No usarlo como rollback de un servicio
desplegado.

Si FastAPI falla durante demo/staging:

1. excluir temporalmente los endpoints/acciones IA del guion de demo;
2. pausar el servicio IA si la plataforma y el plan lo permiten, tras confirmar
   manualmente el efecto operativo;
3. conservar NestJS como API publica y verificar que los flujos no IA siguen;
4. redeployar FastAPI desde la ultima revision conocida y repetir health/smoke;
5. si se decide retirar `AI_SERVICE_BASE_URL`, coordinarlo con el fail-fast de
   modo `jwt`: una nueva instancia NestJS no iniciara sin esa URL.

No reemplazar la URL privada por un placeholder resolvible ni por una URL
publica. Remover o invalidar la URL es una desactivacion de configuracion, no
un fallback: debe coordinarse para no provocar un redeploy fallido de NestJS.

### Rotacion del secreto actual

P4i-3 admite un unico secreto vigente. No hay ventana `current/previous`.
Rotar requiere una ventana coordinada: generar un secreto nuevo fuera del repo,
actualizar ambos servicios de forma controlada, reiniciar y repetir smoke. Puede
existir una interrupcion breve entre despliegues. Rotacion sin downtime, mTLS y
workload identity quedan como hardening futuro, no como P4i-4.

## Sizing inicial

Para demo, comenzar con una unica instancia privada y el menor tamaño que
permita iniciar Python y procesar un PDF sintetico dentro del timeout de 60 s.
El plan exacto, CPU y memoria deben decidirse con metricas reales y la oferta
vigente de Render; este documento no asume nombres ni capacidades de planes.

Observar como minimo:

- memoria maxima durante parsing de PDF;
- latencia p50/p95 y timeouts;
- reinicios/OOM;
- tamaño de payload y limite de 25 MiB configurado;
- concurrencia efectiva del proceso;
- tiempos de cold start si aplican al servicio elegido.

No agregar workers ni replicas antes de medir. Los endpoints actuales ejecutan
trabajo sincrono; colas y workers pertenecen a P5/hardening.

## Seguridad operacional

- servicio privado y sin CORS para browser;
- JWT HS256 interno de TTL corto y secreto dedicado;
- secretos solo en configuracion privada del proveedor;
- no reenviar JWT humano ni PII dentro del token;
- no registrar `Authorization`, documentos o artifacts completos;
- no otorgar DB, S3 o blockchain al contenedor FastAPI;
- no instalar datasets, embeddings o modelos locales en la imagen;
- no publicar `.env`, URLs internas ni rutas absolutas locales;
- revisar logs por categorias y status, no por payload.

## Troubleshooting

### El servicio no inicia

Verificar `PORT`, modo `jwt` y presencia de secreto, issuer y audience. El
runtime falla temprano ante configuracion JWT incompleta. No bajar auth a
`disabled` fuera de local.

### Health responde pero `/v1` devuelve 401

Comparar de forma segura modo, issuer, audience y secreto configurados en ambos
servicios. Confirmar reloj y clock skew. No imprimir tokens para diagnosticar.

### NestJS no alcanza FastAPI

Confirmar manualmente la direccion interna vigente y conectividad de
region/red. Verificar que `AI_SERVICE_BASE_URL` no tenga credenciales, query o
fragmento. No sustituir por una URL publica.

### Timeout o 5xx con PDF

Usar primero un fixture sintetico pequeño, revisar memoria/latencia y confirmar
que el archivo respeta el limite. No activar embeddings ni pipelines batch.

### El browser intenta llamar FastAPI

Es un defecto de frontera: retirar la llamada del frontend. Vercel solo debe
tener `NEXT_PUBLIC_API_BASE_URL` para NestJS.

## Checklist antes de defensa/demo

- [ ] servicio configurado como privado/interno segun la UI vigente;
- [ ] Docker build desde `services/ai-service` exitoso;
- [ ] variables FastAPI completas y auth `jwt`;
- [ ] variables NestJS completas y auth `jwt`;
- [ ] secretos dedicados, iguales entre servicios y distintos del JWT humano;
- [ ] direccion interna confirmada manualmente, sin URL publica;
- [ ] `/health` en `200`;
- [ ] `/v1` sin token en `401`;
- [ ] smoke NestJS -> FastAPI exitoso con fixture sintetico;
- [ ] browser sin requests directos a FastAPI;
- [ ] logs sin tokens, documentos o secretos;
- [ ] plan de desactivacion sin usar `none/disabled` desplegado;
- [ ] flujos no IA de Traza siguen operativos.

## Limites de P4i-4

Este slice deja readiness documental. No crea ni despliega servicios, no valida
una URL privada real, no usa secretos, no conecta evidencias, no agrega
`AnalysisRun`, no cambia schemas, frontend, emision, canon o blockchain. La
integracion de fuentes reales y lifecycle pertenece a P5.

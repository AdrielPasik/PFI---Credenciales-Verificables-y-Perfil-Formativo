# Registro de deployment cloud del AI Service v0

## Objetivo

Registrar el despliegue real del AI Service de Traza y la desviacion temporal
respecto de la arquitectura privada recomendada en P4i-4. Este documento es un
registro sanitizado para demo/defensa: no contiene URLs, secretos, tokens,
hosts, documentos ni capturas reales.

## Fecha y estado

- fecha de registro: 2026-08-05;
- estado: desplegado y validado para demo;
- modo adoptado: Render Web Service Free con HTTPS publico y JWT interno;
- modo objetivo: Render Private Service o equivalente con red privada y JWT;
- decision formal: ADR 0014.

La razon es una limitacion operativa y de costo observada por el operador en el
entorno demo y en la oferta vigente durante el despliegue: habilitar el servicio
privado requeria un plan pago. No se presenta como una capacidad permanente ni
como una afirmacion general sobre futuras ofertas del proveedor.

## Arquitectura cloud actual

```text
Vercel
  -> NestJS Render Web Service
      -> Neon
      -> S3 privado

NestJS AI Client
  -> HTTPS publico + JWT interno HS256
FastAPI Render Web Service Free
```

FastAPI tiene una URL HTTPS publicamente direccionable en la demo. Esto no
cambia la frontera de producto: el browser solo llama NestJS, NestJS sigue
siendo el orquestador y FastAPI no recibe identidad humana como autoridad.

## Arquitectura objetivo

```text
Vercel
  -> NestJS Render Web Service
      -> Neon
      -> S3 privado

NestJS AI Client
  -> red privada + JWT interno HS256
FastAPI Render Private Service o equivalente
```

La migracion futura elimina la exposicion de red publica, pero conserva JWT
interno como defensa en profundidad.

## Desviacion temporal

P4i-4 recomendaba red privada y JWT interno. La implementacion demo conserva
el JWT, pero sustituye la red privada por HTTPS publico porque el servicio
privado no estaba disponible dentro de las restricciones operativas y de costo
del entorno demo actual.

La URL publica introduce una superficie adicional:

- terceros pueden descubrir y alcanzar el host;
- `/health` revela que el proceso esta disponible;
- `/v1/*` puede recibir trafico no autorizado, aunque sea rechazado;
- aumenta el riesgo de scanning, abuso de recursos y denegacion de servicio;
- una filtracion del secreto interno tendria mayor impacto al existir ruta de
  red publica.

No hay afirmacion de equivalencia de seguridad con un servicio privado. La
excepcion es aceptada temporalmente para demo, no como baseline productivo.

## Controles compensatorios

- HTTPS para transporte;
- `AI_INTERNAL_AUTH_MODE=jwt` en FastAPI;
- `AI_SERVICE_AUTH_MODE=jwt` en NestJS;
- HS256 fijo y contrastado contra configuracion;
- secreto dedicado, diferente del `JWT_SECRET` humano;
- `iss`, `aud`, `sub`, `iat`, `exp` y `jti` obligatorios;
- TTL corto del token interno;
- `/v1/*` devuelve `401` sin credencial interna valida;
- `/health` es tecnico y no ejecuta pipelines;
- FastAPI no recibe DB, S3, blockchain ni permisos de usuario;
- el token humano nunca se reenvia a FastAPI;
- AI Service URL, secreto y tokens no llegan a Vercel ni al browser;
- logs y documentacion no deben incluir secretos, documentos o artifacts
  completos.

CORS no es el control de seguridad de FastAPI. Aunque el frontend no lo
consume, la proteccion efectiva de `/v1/*` es el JWT interno. La exposicion
publica conserva riesgos residuales de disponibilidad que P4i-6a no resuelve.

## Configuracion sanitizada

### FastAPI Render Web Service

```dotenv
PORT=
AI_SERVICE_MAX_PDF_BYTES=26214400
AI_INTERNAL_AUTH_MODE=jwt
AI_INTERNAL_JWT_SECRET=<secret>
AI_INTERNAL_JWT_ISSUER=traza-api
AI_INTERNAL_JWT_AUDIENCE=traza-ai-service
AI_INTERNAL_JWT_CLOCK_SKEW_SECONDS=30
```

### NestJS Render API

```dotenv
AI_SERVICE_BASE_URL=<fastapi-render-url>
AI_SERVICE_TIMEOUT_MS=60000
AI_SERVICE_AUTH_MODE=jwt
AI_SERVICE_JWT_SECRET=<same-secret-as-fastapi>
AI_SERVICE_JWT_ISSUER=traza-api
AI_SERVICE_JWT_AUDIENCE=traza-ai-service
AI_SERVICE_JWT_EXPIRES_IN_SECONDS=60
```

Los valores reales permanecen fuera del repositorio. No se agregan a Vercel,
no usan el secreto JWT humano y no se exponen mediante `NEXT_PUBLIC_*`. Los
modos `none/disabled` quedan exclusivamente para local.

## Smoke cloud sanitizado

El operador reporto el siguiente smoke sobre los servicios desplegados. P4i-6a
lo documenta; Codex no lo repitio ni accedio al ambiente cloud.

| Comprobacion | Resultado |
| --- | --- |
| AI Service health | `200` |
| NestJS health | `200` |
| `/v1/*` sin JWT | `401 Unauthorized` |
| `ai:health` desde NestJS | PASS |
| `ai:analyze-pdf` desde NestJS | PASS |
| Contrato de respuesta | `semantic_analysis_v1` valido |
| `status` | `partial` |
| `areasCount` | `1` |
| `skillsCount` | `0` |
| `conceptsCount` | `4` |
| Persistencia | `persisted: null` |

El smoke comprobo transporte HTTPS, JWT interno, ejecucion FastAPI, respuesta
JSON y validacion contractual. No persistio resultados, no uso
`DocumentEvidence` ni `TextEvidence`, no creo `AnalysisRun` y no modifico
emision, canon o blockchain.

## Browser boundary

- el frontend no conoce `AI_SERVICE_BASE_URL`;
- Vercel no almacena variables internas del AI Service;
- el browser no llama FastAPI aunque su URL sea publica;
- usuarios autentican y autorizan acciones solamente en NestJS;
- NestJS emite una credencial de servicio nueva para cada llamada `/v1`;
- FastAPI no acepta el JWT humano como sustituto del JWT interno.

Una URL publica no convierte a FastAPI en API de frontend. Cualquier llamada
directa desde browser seria una violacion arquitectonica.

## Limites de seguridad

El modo actual no aporta aislamiento de red privada, WAF, rate limiting
distribuido, mTLS, workload identity ni mitigacion completa de abuso. El JWT
controla autenticacion de `/v1`, pero no evita que trafico no autenticado llegue
al servicio y consuma capacidad basica antes del rechazo.

No se deben commitear ni compartir en capturas URLs reales, secretos, tokens,
headers `Authorization`, hostnames o logs completos. `/health` no debe crecer
para exponer configuracion o dependencias internas.

## Rollback operativo

Si el AI Service falla durante la demo:

1. excluir acciones/endpoints IA del guion sin afectar flujos no IA;
2. pausar o restaurar el servicio segun las capacidades vigentes confirmadas
   por el operador;
3. redeployar una revision conocida y repetir health y smoke sanitizado;
4. conservar `jwt` en ambos servicios;
5. no publicar secretos ni pasar temporalmente a `none/disabled` en cloud.

Retirar `AI_SERVICE_BASE_URL` requiere coordinacion porque NestJS en modo `jwt`
falla temprano al iniciar sin URL. La desactivacion no debe provocar un
redeploy fallido de la API publica.

## Known limitation - semantic skill extraction quality

El servicio responde y cumple el contrato compartido; el smoke cloud demuestra
integracion tecnica. Sin embargo, algunas entradas reales o sanitizadas pueden
producir una deteccion baja de skills. El resultado observado tuvo
`skillsCount=0`.

Esto no bloquea infraestructura ni deployment y no debe resolverse dentro de
P4i. Un slice posterior de tuning/evaluacion debe incorporar:

- fixtures representativos y pequenos;
- expected outputs revisados;
- metricas de areas, skills y concepts;
- ajuste controlado de taxonomia y reglas;
- regression tests;
- revision de `qualityFlags` y `warnings`.

Esta deuda no habilita emision automatica, no prueba validez de una credencial
y no debe transformarse en claims oficiales sin revision.

## Relacion con P5

P4i-6a prueba y registra conectividad cloud con un archivo suministrado al
script tecnico. P5 sigue pendiente porque todavia debe resolver fuentes
persistidas, ownership, lifecycle y trazabilidad:

- `DocumentEvidence` y `TextEvidence` actuales;
- `AnalysisRun`;
- `SemanticAnalysisSource`;
- proposals y revision humana;
- persistencia controlada de artifacts.

El deploy cloud no implementa ninguna de esas capacidades.

## Proximos pasos

1. mantener el smoke sanitizado como gate de deployment;
2. monitorear trafico, latencia, memoria y rechazos sin registrar payloads;
3. migrar a servicio privado cuando el entorno demo/produccion lo permita;
4. ejecutar P5 con resolucion de fuentes y trazabilidad;
5. abordar calidad semantica en un slice separado con metricas y regresiones;
6. evaluar rate limiting, WAF o controles equivalentes si se mantiene una URL
   publica mas alla de la demo.

## Fuera de alcance

P4i-6a no modifica runtime, no ejecuta deploy, no conecta evidencias, no crea
jobs ni proposals, no cambia schemas, Prisma, frontend, emision, canon o
blockchain. Tampoco implementa Private Service, rate limiting, rotacion de
secretos sin downtime, mTLS o workload identity.

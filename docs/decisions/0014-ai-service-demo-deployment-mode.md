# ADR 0014 - AI Service demo deployment mode

## Estado

Accepted for demo / temporary.

## Contexto

ADR 0008 define como opcion ideal HTTP privado y JWT interno entre NestJS y
FastAPI. Durante el despliegue demo, el operador verifico que el servicio
privado requeria un plan pago dentro de la oferta y cuenta vigentes. Esa es una
restriccion operativa/costo del entorno actual, no una afirmacion permanente
sobre el proveedor.

## Decision

Desplegar temporalmente FastAPI como Render Web Service Free con URL HTTPS
publica y conservar JWT interno HS256 obligatorio para `/v1/*`.

La opcion objetivo sigue siendo Render Private Service o servicio interno
equivalente, tambien con JWT interno. `/health` permanece publico y tecnico.
NestJS sigue siendo el unico orquestador; Vercel y el browser no conocen ni
consumen la URL FastAPI.

## Razones

- permite completar la demo cloud dentro de las restricciones actuales;
- reutiliza Docker y auth P4i ya validados;
- mantiene separada la identidad humana de la identidad de servicio;
- evita desactivar seguridad o introducir secretos en frontend;
- permite validar conectividad y contratos antes de P5.

## Consecuencias

- existe una superficie de red publica adicional;
- trafico no autenticado puede alcanzar el servicio y recibe `401` en `/v1`;
- `/health` puede ser consultado publicamente;
- crecen riesgos de scanning, abuso de recursos y disponibilidad;
- HTTPS + JWT no equivalen al aislamiento de una red privada;
- no cambia el contrato ni la responsabilidad de NestJS;
- el deploy no conecta evidencias ni persiste automaticamente resultados.

## Controles compensatorios

- HTTPS;
- JWT HS256 interno con algoritmo fijo, claims obligatorios y TTL corto;
- secreto dedicado y distinto del JWT humano;
- `/v1/*` protegido y `/health` limitado a liveness;
- FastAPI sin DB, AWS, blockchain o autoridad de usuario;
- URL, secreto y token ausentes del frontend y de Vercel;
- logs y documentacion sanitizados;
- modos `none/disabled` restringidos a local.

## Riesgos residuales

No se implementan aislamiento privado, WAF, rate limiting distribuido, mTLS o
workload identity. Una filtracion del secreto seria mas grave al existir
conectividad publica. Esta excepcion no debe asumirse productiva.

La modalidad demo tambien puede introducir riesgo de disponibilidad por cold
start o gateway temporal. Un incidente posterior, diagnosticado por P6d,
registro un `AnalysisRun` automatico con `ai_invalid_response` y HTTP `502`
antes de que FastAPI respondiera JSON. El health posterior fue exitoso y el
analisis volvio a funcionar, por lo que no se atribuyo a JWT, S3, Prisma ni al
contrato FastAPI. La emision no se revierte ante este fallo best-effort.

La mitigacion de demo es consultar `/health` antes de usar IA. La solucion
estructural es usar una instancia sin spin-down y, cuando sea viable, migrar a
Private Service o equivalente. Esta observacion no altera la decision de que
NestJS sigue siendo el orquestador ni habilita llamadas browser -> FastAPI.

## Condiciones para migrar

Migrar a Private Service o equivalente cuando:

- el plan/entorno permita red privada dentro del presupuesto aprobado;
- NestJS y FastAPI tengan conectividad interna verificada;
- exista una ventana coordinada de cambio de URL;
- health y smoke JWT pasen por la ruta privada;
- se confirme que el browser sigue sin acceso directo;
- la URL publica anterior pueda retirarse de forma controlada.

El JWT interno se conserva despues de migrar como defensa en profundidad.

## Relacion con P5

Esta decision resuelve solamente el modo de deployment demo. P5 debe conectar
`DocumentEvidence`/`TextEvidence`, crear lifecycle y trazabilidad, y controlar
persistencia. El smoke tecnico sin persistencia no sustituye P5.

## Alternativas consideradas

- Private Service pago ahora: opcion ideal, descartada temporalmente por la
  restriccion operativa/costo del entorno demo actual;
- Web Service publico sin JWT: rechazado;
- llamada directa desde browser: rechazada;
- desactivar auth en cloud: rechazado;
- postergar todo deploy IA: descartado porque impedia validar el puente cloud.

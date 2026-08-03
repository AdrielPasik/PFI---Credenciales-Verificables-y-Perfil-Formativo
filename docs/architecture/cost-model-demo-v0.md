# Modelo de costos para demo v0

## Proposito

Proveer una estimacion orientativa para elegir servicios de demo sin presentar
precios temporales como compromisos permanentes.

## Decision

La demo prioriza previsibilidad durante la defensa: Vercel para web, Render para
API/IA, Neon para DB y S3 para documentos. Los precios y limites deben
verificarse en documentacion oficial antes de contratar o habilitar billing.

## Demo universitaria

| Componente | Estrategia | Driver principal |
| --- | --- | --- |
| Vercel | tier personal si cumple uso | builds, bandwidth, politica del plan |
| Render API | instancia pequena activa para defensa | horas y memoria |
| Render IA | pequena o superior segun medicion | RAM, CPU y cold start |
| Neon | tier demo/free si alcanza | storage, compute hours, conexiones |
| S3 | bucket privado de bajo volumen | GB-mes, requests y egress |
| Blockchain | mock/Anvil | costo nulo de gas real |
| Base Sepolia | stretch | RPC y fondos de testnet |

Orden de magnitud conceptual: una demo local/free puede acercarse a costo nulo;
mantener API e IA activas durante la defensa puede requerir decenas bajas de USD
por mes. No es una cotizacion.

## Produccion futura

Una operacion pequena debe presupuestar planes de equipo, mas memoria para IA,
DB con soporte/backups, storage, worker, observabilidad, dominio, RPC y cualquier
API/modelo externo. El orden de magnitud puede pasar a decenas o centenas bajas
de USD mensuales antes de soporte y crecimiento.

## Riesgos de costo

- FastAPI sobredimensionado o modelos siempre cargados;
- reanalisis automaticos sin idempotencia;
- egress entre S3, Render y usuarios;
- logs con retencion excesiva;
- objetos reemplazados sin lifecycle;
- previews/ramas permanentes;
- RPC administrado y APIs IA externas;
- falta de budgets, alertas y spend limits.

## Controles recomendados

- medir memoria, latencia y volumen antes de elegir plan;
- activar budgets/alertas donde existan;
- apagar recursos temporales fuera de demo;
- limitar payloads, retries y reanalisis;
- revisar factura y limites una semana antes de la defensa;
- documentar supuestos y fecha de cada estimacion.

## Alcance

- comparacion demo vs produccion futura;
- drivers y riesgos de cobro;
- pautas para validar precios.

## Fuera de alcance

- cotizacion contractual;
- precios exactos garantizados;
- modelo financiero comercial;
- costos de personal, soporte o compliance.

## Impacto en modulos actuales

No hay impacto de runtime. P4e-P4i deben agregar metricas suficientes para
revisar memoria, latencia, storage y egress.

## Riesgos

La principal deuda es tomar cifras de un proveedor sin fecha ni verificacion.
Este documento evita fijarlas como verdad permanente.

## Proximos slices relacionados

Revalidar en P4e-P4i y antes de cualquier upgrade o despliegue productivo.


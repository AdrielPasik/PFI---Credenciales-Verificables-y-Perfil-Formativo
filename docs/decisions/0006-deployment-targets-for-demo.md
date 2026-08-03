# ADR 0006 - Deployment targets for demo

## Estado

Aceptado para demo/PFI.

## Contexto

Traza necesita desplegar Next.js, NestJS, FastAPI, PostgreSQL y storage con baja
carga operativa, manteniendo FastAPI privado y NestJS como unica API publica de
dominio.

## Decision

Usar Vercel para Next.js, Render Web Service para NestJS, Render Private
Service para FastAPI, Neon para PostgreSQL y S3 privado para documentos.
Mantener `mock`/Anvil como blockchain garantizada y Base Sepolia como stretch.

## Consecuencias

- NestJS y FastAPI pueden compartir red privada en Render;
- la solucion usa varios proveedores y requiere configurar region/egress;
- P4e-P4i deben validar variables, CORS, migraciones y health;
- el navegador no obtiene acceso directo a FastAPI, S3 o blockchain;
- precios y limites deben revisarse antes de contratar.

## Alternativas consideradas

- Cloud Run + GCS: mejor workload identity, mayor complejidad inmediata;
- desplegar todo en un unico host: menor separacion y peor ajuste para Next.js;
- servicios gratuitos dormidos para defensa: riesgo de cold start;
- Anvil persistente en cloud: descartado para demo desplegada.


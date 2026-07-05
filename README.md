# Credential Intelligence Platform

Repositorio monorepo para el Proyecto Final de Ingenieria Informatica orientado a credenciales educativas digitales verificables con soporte de blockchain y analisis semantico del perfil formativo.

## Objetivo

Preparar una base tecnica ordenada para evolucionar el sistema en fases, manteniendo separadas las responsabilidades de frontend, backend, inteligencia artificial, smart contracts, contratos de datos y documentacion arquitectonica.

## Alcance actual del repositorio

El estado actual es de bootstrap tecnico. Este repositorio incluye:

- estructura inicial del monorepo;
- documentacion base de arquitectura y flujos;
- ADRs iniciales;
- JSON Schemas para credenciales, analisis semantico, perfil formativo y evidencia blockchain;
- placeholders minimos para app web, API, servicio de IA y contratos.

## Modulos principales

- `apps/web`: aplicacion web Next.js prevista para las rutas `/issuer`, `/verifier` y `/wallet`.
- `services/api`: backend orquestador en NestJS con Prisma y PostgreSQL.
- `services/ai-service`: servicio Python/FastAPI desacoplado para analisis semantico.
- `contracts`: smart contracts Solidity con Foundry para registro verificable on-chain.
- `packages/schemas`: contratos JSON Schema versionados para intercambio entre modulos.
- `docs`: documentacion tecnica, flujos y decisiones de arquitectura.
- `data`: muestras sinteticas y futuros insumos de procesamiento controlado.
- `infra`: preparacion para entornos locales y despliegues posteriores.

## Stack definido

- Frontend: Next.js, TypeScript, Tailwind CSS, mobile-first, PWA.
- Backend: Node.js, NestJS, TypeScript, Prisma.
- Base de datos: PostgreSQL.
- IA: Python, FastAPI.
- Blockchain: Solidity, Foundry, Anvil local, Base Sepolia.

## Estado actual

Este repositorio todavia no implementa la logica de negocio final ni las aplicaciones ejecutables completas. Se priorizo dejar:

- una separacion clara por dominios y responsabilidades;
- contratos de datos iniciales;
- documentacion para orientar la implementacion incremental;
- decisiones tecnicas explicitadas.

## Organizacion general

```text
apps/        Frontend web
services/    Backend API y servicio de IA
contracts/   Smart contracts y configuracion Foundry
packages/    Contratos compartidos y artefactos comunes
data/        Datos sinteticos, muestras y futuros procesados
docs/        Arquitectura, flujos, ADRs y notas tecnicas
infra/       Preparacion para dockerizacion y despliegues
```

## Que no esta implementado todavia

- pantallas funcionales de emision, verificacion o wallet;
- modulos NestJS productivos;
- endpoints reales del AI service;
- contrato de blockchain con reglas completas;
- schema Prisma final;
- integracion real entre frontend, backend, IA y blockchain;
- despliegue productivo.

## Proximo uso recomendado

1. Scaffold real de `apps/web` con Next.js y Tailwind.
2. Scaffold real de `services/api` con NestJS y Prisma.
3. Scaffold real de `services/ai-service` con FastAPI.
4. Evolucion de los schemas y definicion del modelo Prisma.
5. Implementacion incremental de los flujos documentados en `docs/`.

# ADR 0001 - Tech Stack

## Contexto

El proyecto requiere una app web, un backend orquestador, persistencia relacional, un servicio de IA desacoplado y un modulo blockchain verificable. El stack debia permitir evolucion incremental y separacion clara de responsabilidades.

## Decision

Adoptar el siguiente stack base:

- Next.js + TypeScript + Tailwind CSS para frontend web;
- Node.js + NestJS + TypeScript + Prisma para backend API;
- PostgreSQL para persistencia relacional;
- Python + FastAPI para el AI service;
- Solidity + Foundry + Anvil para blockchain.

## Justificacion

- alinea el frontend, backend y contratos de datos con TypeScript;
- NestJS facilita modularidad y escalado del backend orquestador;
- Prisma simplifica acceso relacional y uso de JSONB cuando haga falta;
- FastAPI desacopla el pipeline semantico del backend Node;
- Foundry ofrece un flujo liviano y moderno para contratos y testing.

## Consecuencias

- el repositorio sera poliglota;
- la integracion entre Node y Python se resuelve por HTTP interno;
- se requiere disciplina de versionado entre schemas, DTOs y contratos;
- el equipo necesita toolchains separadas para Node, Python y Foundry.

## Alternativas descartadas

- app mobile nativa inicial;
- backend unico que embeba scripts de IA;
- Hardhat o Ganache para la capa blockchain;
- base de datos puramente documental como origen principal.

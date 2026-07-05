# Backend API

Backend principal previsto en Node.js + NestJS + TypeScript con Prisma como capa ORM sobre PostgreSQL.

## Rol arquitectonico

Actua como orquestador central entre:

- frontend web;
- base de datos off-chain;
- servicio de IA;
- integracion blockchain.

## Responsabilidades futuras

- gestion de usuarios e instituciones emisoras;
- construccion y persistencia de credenciales;
- calculo de hashes y evidencia verificable;
- verificacion de estado on-chain;
- invocacion del AI service;
- exposicion de APIs para issuer, wallet y verifier;
- trazabilidad y auditoria.

## Estado actual

Se dejo preparado el modulo y su documentacion. El scaffold real de NestJS, los modulos internos y el schema Prisma quedan para la siguiente fase de implementacion.

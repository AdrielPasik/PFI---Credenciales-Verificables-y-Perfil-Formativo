# Backend API

Backend principal en Node.js + NestJS + TypeScript con Prisma como capa ORM sobre PostgreSQL.

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

En esta iteracion `services/api` quedo convertido en un backend NestJS minimo ejecutable.

Incluye:

- bootstrap tecnico de NestJS;
- endpoint `GET /health` con respuesta `{ "status": "ok" }`;
- `PrismaModule` y `PrismaService` minimos;
- scripts para compilar, ejecutar y validar `schema.prisma`;
- uso del schema existente en `services/api/prisma/schema.prisma`.

## Desarrollo

Instalar dependencias del monorepo con `npm install` desde la raiz y luego ejecutar:

- `npm run dev --workspace @credential-intelligence/api`
- `npm run build --workspace @credential-intelligence/api`
- `npm run start --workspace @credential-intelligence/api`

## Prisma

Scripts disponibles:

- `npm run prisma:validate --workspace @credential-intelligence/api`
- `npm run prisma:format --workspace @credential-intelligence/api`
- `npm run prisma:generate --workspace @credential-intelligence/api`

`prisma generate` solo genera el cliente local y no corre migraciones ni crea base de datos.

## Variables de entorno

Ver `services/api/.env.example` para el set minimo esperado:

- `PORT`
- `DATABASE_URL`

## Que no esta implementado todavia

- modulos de dominio (`users`, `issuers`, `credentials`, `verification`, `semantic`, `profiles`, `blockchain`, `sharing`, `audit`);
- controllers o endpoints de negocio;
- auth, permisos y sesiones;
- logica de emision, verificacion, hashing o revocacion;
- integracion real con blockchain;
- integracion real con AI service;
- migraciones Prisma;
- generacion automatica de la base de datos.

## Notas

- No se corrieron migraciones en esta etapa.
- El schema Prisma sigue siendo la base v0 existente, sin cambios funcionales de dominio.
- `PrismaService` queda configurado, pero sin forzar conexion al iniciar el proceso.
- Los modulos de dominio se crearan en iteraciones posteriores.

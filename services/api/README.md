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
- `npm run prisma:migrate:dev --workspace @credential-intelligence/api -- --name init`
- `npm run prisma:seed --workspace @credential-intelligence/api`

`prisma generate` solo genera el cliente local y no corre migraciones ni crea base de datos.

## PostgreSQL local

La opcion local minima del repo usa Docker Compose en:

- `infra/docker/docker-compose.postgres.yml`

Levantar PostgreSQL:

- `docker compose -f infra/docker/docker-compose.postgres.yml up -d`

Bajar PostgreSQL:

- `docker compose -f infra/docker/docker-compose.postgres.yml down`

La configuracion queda alineada con `services/api/.env.example`:

- host: `localhost`
- port: `5432`
- db: `credential_intelligence`
- user: `postgres`
- password: `postgres`

## Migraciones y seed

Secuencia recomendada para desarrollo local:

1. Levantar PostgreSQL con Docker Compose.
2. Ejecutar `npm run prisma:migrate:dev --workspace @credential-intelligence/api -- --name init`.
3. Ejecutar `npm run prisma:seed --workspace @credential-intelligence/api`.

El seed es idempotente y crea un set minimo reproducible:

- `Demo University` como emisor autorizado;
- `Demo Holder` como titular con DID;
- `Issuer Admin` como usuario institucional;
- membresia `admin` activa entre `Issuer Admin` y `Demo University`.

## Variables de entorno

Ver `services/api/.env.example` para el set minimo esperado:

- `PORT`
- `DATABASE_URL`

Para trabajo local con Prisma, copiar `services/api/.env.example` a `services/api/.env` antes de correr migraciones o seed.

## Que no esta implementado todavia

- modulos de dominio (`users`, `issuers`, `credentials`, `verification`, `semantic`, `profiles`, `blockchain`, `sharing`, `audit`);
- controllers o endpoints de negocio;
- auth, permisos y sesiones;
- logica de emision, verificacion, hashing o revocacion;
- integracion real con blockchain;
- integracion real con AI service;
- endpoints de credenciales;
- logica de BlockchainRecord mock/local;
- integracion semantica real del primer vertical slice.

## Notas

- El backend ya tiene scripts y compose preparados para correr migraciones y seed locales.
- El schema Prisma sigue siendo la base v0 existente, sin cambios funcionales de dominio.
- `PrismaService` queda configurado, pero sin forzar conexion al iniciar el proceso.
- Los modulos de dominio se crearan en iteraciones posteriores.

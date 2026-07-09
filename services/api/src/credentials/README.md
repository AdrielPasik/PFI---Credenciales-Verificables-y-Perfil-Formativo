# Credentials Module

Responsabilidad futura:

- ciclo de vida de `Credential`;
- borradores;
- emision;
- revocacion;
- coordinacion con `issuers`, `blockchain` y `semantic`.

Alcance actual:

- modulo NestJS minimo;
- service vacio sin metodos de negocio;
- sin controllers;
- sin queries Prisma;
- sin hashing;
- sin logica de emision o revocacion.

Principios:

- `credentials` sera el orquestador futuro del dominio de emision;
- no debe delegar ownership de `Credential` a `blockchain` ni a `semantic`;
- evitar dependencias circulares;
- evitar acceso directo a tablas ajenas cuando existan servicios exportados por otros modulos.

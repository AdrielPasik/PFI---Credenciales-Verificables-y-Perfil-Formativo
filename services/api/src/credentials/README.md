# Credentials Module

Responsabilidad futura:

- ciclo de vida de `Credential`;
- borradores;
- emision;
- revocacion;
- coordinacion con `issuers`, `blockchain` y `semantic`.

Alcance actual:

- modulo NestJS con primer vertical slice implementado;
- controllers HTTP minimos para draft, issue, get y status;
- persistencia Prisma para `Credential`;
- hashing canonico `sha-256`;
- creacion de `BlockchainRecord` mock/local;
- sin revocacion;
- sin auth;
- sin integracion IA.

Principios:

- `credentials` es el orquestador del flujo de emision;
- no debe delegar ownership de `Credential` a `blockchain` ni a `semantic`;
- evitar dependencias circulares;
- evitar acceso directo a tablas ajenas cuando existan servicios exportados por otros modulos.

Notas operativas del slice:

- `rawData` puede persistirse al crear un draft;
- `rawData` no se expone por defecto en `GET /credentials/:id`;
- esto es intencional para no devolver datos crudos o internos en respuestas publicas u operativas;
- si en el futuro se necesita consultar `rawData`, deberia hacerse mediante endpoint administrativo o controlado.

Decision transitoria:

- en este slice `issuedAt` puede venir en el request de emision;
- esto existe para pruebas manuales y reproducibilidad del flujo;
- mas adelante, con auth, roles y reglas de negocio maduras, puede restringirse o pasar a ser controlado por backend.

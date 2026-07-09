# Issuers Module

Responsabilidad futura:

- gestion de `Issuer`;
- gestion de `IssuerMembership`;
- validacion institucional para `issuer_admin`;
- validacion operativa de emisores autorizados.

Alcance actual:

- modulo NestJS minimo;
- service vacio sin metodos de negocio;
- sin controllers;
- sin auth;
- sin validaciones reales;
- sin queries Prisma.

Principios:

- `issuers` sera la fuente de validacion institucional;
- no debe convertirse en el orquestador de emision;
- no debe contener integracion blockchain;
- debe exportar servicios de dominio cuando otras areas necesiten validar emisor o membresia.

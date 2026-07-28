# Issuers Module

Responsabilidad futura:

- gestion de `Issuer`;
- gestion de `IssuerMembership`;
- validacion institucional para `issuer_admin`;
- validacion operativa de emisores autorizados.

Alcance actual:

- modulo NestJS sin controllers;
- validacion de membership activa y roles `admin`/`operator`;
- validacion de issuer autorizado para crear drafts;
- validaciones adicionales de DID y wallet exclusivamente al emitir;
- queries Prisma acotadas a issuer y membership.

Principios:

- `issuers` sera la fuente de validacion institucional;
- no debe convertirse en el orquestador de emision;
- no debe contener integracion blockchain;
- debe exportar servicios de dominio cuando otras areas necesiten validar emisor o membresia.

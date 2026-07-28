# Issuers Module

Responsabilidad futura:

- gestion de `Issuer`;
- gestion de `IssuerMembership`;
- validacion institucional para `issuer_admin`;
- validacion operativa de emisores autorizados.

Alcance actual:

- endpoint protegido `POST /issuers/:issuerId/holders/resolve`;
- validacion de membership activa y roles `admin`/`operator`;
- validacion de issuer autorizado para crear drafts;
- validacion institucional equivalente para resolver titulares;
- resolucion read-only por email exacto normalizado;
- response minimizada con `id`, `email`, DID nullable y `displayLabel`;
- validaciones adicionales de DID y wallet exclusivamente al emitir;
- queries Prisma acotadas a issuer y membership.

Principios:

- `issuers` sera la fuente de validacion institucional;
- no debe convertirse en el orquestador de emision;
- no debe contener integracion blockchain;
- no debe convertirse en un buscador global ni listar usuarios;
- no debe registrar emails consultados ni exponer credenciales de autenticacion;
- debe exportar servicios de dominio cuando otras areas necesiten validar emisor o membresia.

El `subjectUserId` resuelto es un dato interno command-only. La resolucion no
crea usuarios, drafts, credenciales ni memberships. Un usuario activo es
elegible aunque no tenga DID; la emision mantiene su validacion posterior de
DID.

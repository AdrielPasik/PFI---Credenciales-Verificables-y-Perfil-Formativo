# Auth Module

Responsabilidad actual:

- autenticacion minima demo-grade por `email + password`;
- emision de JWT para acceso backend;
- resolucion reutilizable de current user;
- exposicion de `POST /auth/login` y `GET /auth/me`.

Alcance actual:

- usa `AuthCredential` separado para no mezclar password hash con `User`;
- persiste solo `passwordHash`, nunca password plana;
- `GET /auth/me` devuelve membresias activas del usuario autenticado con
  `issuerId`, nombre, DID nullable, estado de autorizacion institucional, rol
  y estado de membership;
- una membership es contexto emisor operativo solo si esta `active`, su rol es
  `admin` u `operator` y el issuer esta `authorized`;
- falla con error claro si falta `JWT_SECRET`.

Fuera de alcance en este slice:

- protected issuance;
- roles/permissions efectivos sobre emision;
- refresh tokens;
- recuperacion de password;
- auth institucional avanzada;
- MetaMask o wallets externas.

Notas local/dev:

- usuarios demo seed:
  - `issuer.admin@example.com / DemoIssuer123!`
  - `holder.demo@example.com / DemoHolder123!`
- esas passwords solo se documentan para entorno local;
- en base de datos se guarda un hash `scrypt:v1:...`.

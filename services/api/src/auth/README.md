# Auth Module

Responsabilidad actual:

- autenticacion minima demo-grade por `email + password`;
- registro publico de una cuenta holder (`email + password`, A1);
- emision de JWT para acceso backend;
- resolucion reutilizable de current user;
- exposicion de `POST /auth/login`, `POST /auth/register` y `GET /auth/me`.

Alcance actual:

- usa `AuthCredential` separado para no mezclar password hash con `User`;
- persiste solo `passwordHash`, nunca password plana;
- `POST /auth/register` (A1) crea unicamente `User` (`status: active`) +
  `AuthCredential` en una transaccion -- nunca `Issuer`/`IssuerMembership`.
  Devuelve el mismo shape que login (auto-login, mismo mecanismo de
  sesion/JWT). `User.did` queda `null`: no existe en el repo ningun
  mecanismo real de provisioning de DID para holders (los DID existentes
  son literales hardcodeados en los seeds) -- ver
  `docs/architecture/auth-and-permissions-v0.md` seccion 2.3 para el
  detalle completo y el gap de emision que esto implica;
- politica de password para register: 8-128 caracteres, sin reglas de
  complejidad inventadas;
- email ya registrado -> `409` seguro (nunca filtra `P2002`/Prisma), cubre
  tambien la carrera de dos registros concurrentes via la unique
  constraint real de `User.email`;
- `GET /auth/me` devuelve membresias activas del usuario autenticado con
  `issuerId`, nombre, DID nullable, estado de autorizacion institucional, rol
  y estado de membership;
- una membership es contexto emisor operativo solo si esta `active`, su rol es
  `admin` u `operator` y el issuer esta `authorized`;
- falla con error claro si falta `JWT_SECRET`.

Fuera de alcance en este slice:

- verificacion de email, OTP, magic link o cualquier confirmacion externa;
- recuperacion de password, cambio de password;
- protected issuance;
- roles/permissions efectivos sobre emision;
- seleccion de rol/issuer durante el registro (siempre crea un `User` comun);
- refresh tokens;
- auth institucional avanzada;
- MetaMask o wallets externas;
- provisioning de DID durante el registro (ver arriba).

Notas local/dev:

- usuarios demo seed:
  - `issuer.admin@example.com / DemoIssuer123!`
  - `holder.demo@example.com / DemoHolder123!`
- esas passwords solo se documentan para entorno local;
- en base de datos se guarda un hash `scrypt:v1:...`.

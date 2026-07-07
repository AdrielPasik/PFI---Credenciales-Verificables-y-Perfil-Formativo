# Domain Rules v0

> Este documento registra reglas de negocio minimas acordadas antes de modificar `schema.prisma`, crear migraciones o construir APIs del backend.

## Objetivo

Dejar explicitadas las decisiones preliminares que deben guiar:

- futuros ajustes del modelo Prisma;
- validadores y DTOs;
- reglas transaccionales del backend;
- consistencia entre credenciales, perfiles, blockchain, sharing y permisos.

## 1. User.email

- `User.email` debe ser opcional pero unico.
- Puede haber usuarios importados, holders creados por emision o identidades aun sin login inicial.
- Si un usuario tiene email, ese email no debe duplicarse.

### Regla preliminar

```prisma
email String? @unique
```

### Implicancias

- impacta un futuro ajuste de `schema.prisma`;
- afecta decisiones de auth/login y recuperacion de acceso;
- el backend debera impedir duplicidad de email cuando se asigne o actualice.

## 2. User.did

- `User.did` se mantiene opcional y unico.
- Una credencial emitida no deberia existir sin identidad verificable del titular, mediante `subject_did` o una estrategia equivalente.
- No se vuelve obligatorio en `User` todavia porque puede haber usuarios creados antes de asignarles DID.

### Implicancias

- la obligatoriedad se resolvera por logica de emision, no por constraint general del usuario;
- los DTOs y servicios de emision deberan validar identidad verificable del titular antes de emitir.

## 3. Issuer.did

- `Issuer.did` se mantiene opcional y unico por ahora.
- Debe quedar entendido como identificador institucional fuerte futuro.
- No se vuelve obligatorio hasta cerrar la estrategia final de identidad institucional.

### Implicancias

- puede impactar un ajuste futuro del schema;
- los servicios de autorizacion institucional deberan contemplar esta transicion.

## 4. Issuer.walletAddress

- `Issuer.walletAddress` se mantiene opcional y unico.
- Un `Issuer` no puede pasar a `authorized` sin `walletAddress`.
- Esta regla se valida en servicio, no necesariamente en Prisma.

### Implicancias

- impacta validadores y servicios de autorizacion;
- no requiere cambio inmediato del schema si se mantiene como regla de aplicacion.

## 5. Credential.canonicalHash

- `Credential.canonicalHash` se mantiene indexado, no `unique`, por ahora.
- No se impone unicidad todavia para no bloquear reemisiones, pruebas, ambientes locales o ajustes futuros de negocio.
- Una credencial `issued` debe tener `canonicalHash` y `canonicalizationVersion`.

### Implicancias

- la obligatoriedad por estado debe validarse en servicio;
- la discusion de unicidad queda abierta para una revision posterior del schema.

## 6. FormativeProfile.isCurrent

- `FormativeProfile.isCurrent` se mantiene.
- El backend debe garantizar un unico perfil actual por usuario mediante logica transaccional.
- Cuando un perfil pase a actual, deben desmarcarse los otros perfiles actuales del mismo `userId` en la misma transaccion.
- No se agrega una constraint compleja en esta etapa.

### Implicancias

- impacta directamente en servicios de regeneracion de perfil;
- puede motivar una optimizacion o constraint futura si el comportamiento queda estable.

## 7. SharingGrant

- Todo `SharingGrant` debe apuntar al menos a `credentialId` o `profileId`.
- `scope = credential` requiere `credentialId`.
- `scope = profile` requiere `profileId`.
- `scope = credential_and_profile` requiere `credentialId` y `profileId`.
- `tokenHash @unique` es correcto.
- No se expresa esta logica en Prisma todavia; debe validarse en servicio.

### Implicancias

- impacta futuros DTOs y validadores;
- evita grants huerfanos o ambiguos;
- prepara sharing por link/QR sin redisenar la tabla.

## 8. IssuerMembership

- Se mantiene:

```prisma
@@unique([userId, issuerId])
```

- `IssuerMembership` representa el estado actual de pertenencia institucional.
- El historial fino de cambios se conserva en `AuditLog`, no con multiples filas historicas de membresia en esta etapa.

### Implicancias

- no hace falta historizar membresias dentro del schema por ahora;
- las altas, bajas y cambios de rol deben auditarse correctamente.

## 9. BlockchainRecord

- Se permiten multiples registros por credencial.
- El registro blockchain vigente se resolvera por:
  - `credentialId`;
  - `network` o `chainId` objetivo;
  - `status`;
  - `registeredAt` mas reciente.
- No se agrega `isPrimary` todavia.
- Para la primera implementacion, el backend podra pedir una red objetivo o asumir una red activa por configuracion.

### Implicancias

- impacta la definicion de servicios de lectura blockchain;
- evita una restriccion prematura sobre un solo registro por credencial;
- deja abierta una futura regla explicita de seleccion de registro principal si hiciera falta.

## 10. Matriz minima de campos obligatorios por estado de Credential

### Estado `draft`

Requiere:

- `issuerId`
- `subjectUserId`
- `type`
- `title`
- `sourceType`
- `credentialSubject`

### Estado `issued`

Requiere:

- todo lo de `draft`;
- `issuedAt`;
- `canonicalHash`;
- `canonicalizationVersion`;
- issuer con `walletAddress`;
- identidad verificable del subject mediante DID o estrategia equivalente.

### Estado `revoked`

Requiere:

- todo lo de `issued`;
- `revokedAt`;
- `revocationReason`.

### Implicancias

- esta matriz debe guiar DTOs, validadores y servicios;
- puede motivar constraints adicionales en schema mas adelante si la logica queda estable;
- evita APIs ambiguas entre borrador, emision y revocacion.

## 11. Que no decidir todavia

Por ahora no se decide:

- normalizar `skills`, `areas` o `concepts`;
- agregar jobs de IA;
- separar `SharingGrant` en multiples tablas;
- agregar soft delete global;
- resolver auth completa;
- correr migraciones;
- modificar schema antes de documentar estas reglas.

## Impacto sobre cambios futuros en schema.prisma

Estos temas probablemente impacten una futura iteracion del schema:

- `User.email` como `@unique`;
- posible aclaracion futura sobre obligatoriedad por estado en `Credential`;
- decision posterior sobre unicidad o no de `Credential.canonicalHash`;
- posibles indices o constraints adicionales para `FormativeProfile.isCurrent`;
- posible constraint mas fuerte o estrategia adicional sobre `SharingGrant`.

## Impacto sobre DTOs, validadores y servicios

Estas reglas impactaran directamente:

- emision de credenciales;
- revocacion;
- autorizacion de emisores;
- asignacion de email y DID;
- sharing por link/QR;
- seleccion del registro blockchain vigente;
- regeneracion de perfil actual;
- validacion de cambios de estado.

## Decisiones que quedan abiertas

- si `Credential.canonicalHash` debe pasar a `@unique` mas adelante;
- cuando `User.did` y `Issuer.did` pasaran de opcionales a requeridos en ciertos flujos;
- si en el futuro conviene constraint de unicidad operativa para `FormativeProfile.isCurrent`;
- si se necesitara modelar historial de membresias institucionales en tabla propia;
- si `SharingGrant` debera endurecerse con mas reglas estructurales en base de datos.

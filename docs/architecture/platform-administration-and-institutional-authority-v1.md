# Administración de plataforma y autoridad institucional v1

> Este documento describe el modelo **ya implementado** en el repositorio y
> validado ejecutablemente por el E2E integrado del circuito institucional.
> No propone capacidades futuras: lo que todavía no existe está marcado
> explícitamente como pendiente de S7c (deployment) o S8 (identidad técnica).

Complementa `auth-and-permissions-v0.md`, que describe el plano institucional
(`IssuerMembership`) y la autenticación de personas. Lo que agrega este
documento es el **plano de plataforma** (`PlatformAdmin`) y la relación exacta
entre ambos.

---

## 1. Modelo de identidad

En Scope existe **un solo tipo de cuenta**: `User`, que representa la
identidad de una **persona**.

No existen, y no deben nombrarse como si existieran:

- "cuenta holder";
- "cuenta issuer";
- "cuenta institucional";
- login institucional separado.

`Holder` **no es un tipo de cuenta ni un rol exclusivo**: es una capacidad
personal disponible para cualquier `User` (su espacio personal, sus
credenciales, su perfil formativo). Una `Issuer` es una **organización** que
existe como fila en la base; no inicia sesión, no tiene password propia.

Una misma persona puede, al mismo tiempo:

- usar su espacio personal;
- ser `PlatformAdmin`;
- administrar una o más instituciones.

Las tres cosas son independientes entre sí.

### Las cuatro entidades

| Entidad | Qué representa |
|---|---|
| `User` | la identidad de una persona |
| `AuthCredential` | el hash de password con el que ese `User` inicia sesión |
| `PlatformAdmin` | capacidad **global** de administración de la plataforma |
| `IssuerMembership` | autoridad **explícita** de una persona sobre una institución |

`PlatformAdmin` es una tabla propia (`id`, `userId @unique`, `grantedAt`), no
un campo de `User`. La razón es consistente con el resto del modelo: en este
sistema **toda** capacidad vive en una arista, nunca en el nodo `User`
—igual que `IssuerMembership`.

---

## 2. Las cuatro separaciones

Son las invariantes centrales del modelo. Cada una está verificada por tests.

### 2.1 `onboardingIntent` ≠ autoridad institucional

`UserOnboardingIntent` tiene exactamente dos valores (`personal`,
`institutional`) y la columna es nullable, así que un `User` puede estar en
tres estados: `personal`, `institutional` o `null` (cuenta creada antes de que
Scope preguntara).

**Es una preferencia de UX. No autoriza ni desautoriza nada.**

Elegir `institutional` en el signup **no**:

- crea una `Issuer`;
- crea una `IssuerMembership`;
- crea un `PlatformAdmin`;
- crea una solicitud de institución;
- genera una invitación;
- otorga ningún permiso.

Lo único que decide es **a dónde aterriza** la persona cuando no tiene ningún
contexto institucional operativo: con `institutional` va a
`/institutional-access-pending`; con `personal` o `null`, a su espacio
personal.

Y la precedencia es clara: **una membership operativa siempre gana sobre la
intención**. Una persona con intención `institutional` y una membership activa
va al portal institucional; una persona con intención `personal` y una
membership activa, también.

### 2.2 `PlatformAdmin` ≠ autoridad sobre una institución

Un `PlatformAdmin` puede, sin tener ninguna membership:

- observar **todas** las instituciones;
- resolver personas por email;
- crear instituciones;
- asignar administradores.

Un `PlatformAdmin` **no** puede, sólo por serlo:

- operar una institución por las rutas institucionales (`/issuers/...`).

Para eso necesita además una `IssuerMembership` explícita. `IssuersService`
no tiene ningún bypass para la capacidad de plataforma, y ningún archivo de
`src/platform-admin` importa `IssuersService` —una invariante congelada por
un guard estructural.

La consecuencia práctica, verificada: un `PlatformAdmin` que crea una
institución y designa a otra persona como administradora **recibe 403** en las
rutas institucionales de esa misma institución. Si quiere operarla, tiene que
asignarse a sí mismo explícitamente, y entonces su acceso viene de la
membership, no de su capacidad global.

### 2.3 Identidad de persona ≠ identidad técnica del emisor

Son **tres capas distintas**:

```
PERSONA                      ORGANIZACIÓN                 IDENTIDAD TÉCNICA
User                         IssuerMembership             Issuer.did
(identidad de la persona)    (autoridad institucional)    Issuer.walletAddress
                                                          signer / registry
```

Una persona puede tener identidad personal propia —`User.did`, provisionado
como `did:web` cuando `PUBLIC_DID_BASE_URL` está configurada; ver
`auth-and-permissions-v0.md` §2.5— y eso **no implica nada** sobre la
identidad técnica de una institución.

Dicho al revés: que una persona tenga o no un DID personal es irrelevante
para la autoridad institucional, y la intención institucional del signup no
provisiona identidad criptográfica de ningún emisor —porque en ese momento no
hay emisor.

La tercera capa es objeto de **S8** y hoy no está resuelta.

### 2.4 `authorized` ≠ `readyToIssue`

`IssuerAuthorizationStatus.authorized` significa **exactamente una cosa**:

> habilitación **operacional** dentro de Scope.

**No** significa, y la UI no puede insinuarlo:

- institución verificada;
- acreditada;
- validada legalmente;
- KYB completado;
- identidad real confirmada;
- DID configurado;
- wallet configurada.

Una institución puede estar simultáneamente:

```
authorizationStatus = authorized
didConfigured       = false
walletConfigured    = false
readyToIssue        = false
```

Eso es comportamiento **deliberado**, no un estado inconsistente. Es
exactamente el estado en el que nace toda institución creada desde `/admin`.

La fórmula de `readyToIssue`, tal como está implementada en
`PlatformAdminReadService`:

```
readyToIssue = authorizationStatus === authorized
               && didConfigured
               && walletConfigured
```

que proyecta la precondición real de
`IssuersService.assertIssuerCanIssue`, la cual rechaza en este orden:

1. `authorizationStatus !== authorized`;
2. falta `walletAddress`;
3. falta `did`.

La UI muestra los dos booleanos derivados y nunca el valor del DID ni de la
dirección: el backend no los expone en la superficie administrativa.

---

## 3. Onboarding institucional

```
persona completa el signup
        │
        ├─ elige intención "institucional"
        │
        ▼
User creado (status: active) + AuthCredential
        │
        │   sin PlatformAdmin
        │   sin IssuerMembership
        │   sin Issuer
        │
        ▼
/institutional-access-pending
        │
        │   … espera una acción explícita de un PlatformAdmin
```

El registro crea **únicamente** `User` + `AuthCredential` (más el DID personal
si la configuración lo habilita). No hay aprobación automática por haber
elegido `institutional`.

**No existe autoservicio de creación de instituciones.** No hay, en ninguna
superficie pública, personal ni institucional:

- "Registrar mi universidad";
- "Crear mi institución";
- "Solicitar institución";
- "Convertirme en emisor".

Tampoco existe un sistema de invitaciones: no hay invitation tokens, ni emails
de invitación, ni aceptación, ni expiración. El modelo es más simple y más
auditable: **la persona crea su propia cuenta, y un PlatformAdmin le asigna
autoridad explícitamente**.

---

## 4. Quién crea instituciones

**Sólo un `PlatformAdmin`**, y sólo desde `/admin`.

Tiene dos acciones:

| | Acción | Efecto |
|---|---|---|
| **A** | crear una institución nueva | `Issuer` + su primer administrador |
| **B** | agregar un administrador | una `IssuerMembership` más sobre una institución existente |

La capacidad `PlatformAdmin` no se otorga por HTTP: no hay ningún endpoint que
la cree. Se otorga fuera de banda con un script idempotente que vive en
`prisma/` —deliberadamente fuera de `src/`, para que siga siendo cierto que
ningún archivo de `src/` escribe `PlatformAdmin`.

---

## 5. Flujo de autoridad

```
persona crea su User
        │
        ▼
intención institucional declarada
        │
        ▼
pending — sin ninguna autoridad
        │
        ▼
un PlatformAdmin entra a /admin
        │
        ├─ resuelve la persona por email          (confirmación visual)
        │
        ├─ confirma explícitamente qué persona,
        │  sobre qué institución, con qué rol
        │
        ▼
se crea IssuerMembership(admin, active)
        │
        ▼
la persona revalida su sesión / contexto
        │
        ▼
acceso institucional
```

La autoridad viene de **la `IssuerMembership`**. No de la intención de
onboarding, no de la capacidad global de plataforma, no de tener un DID
personal.

Un detalle importante del paso de revalidación: el token que la persona ya
tenía **sigue siendo válido**, porque el JWT sólo lleva `sub` y el contexto se
relee de la base en cada request. No hay nada cacheado del lado del servidor
que haya que invalidar: basta con que el cliente vuelva a pedir `/auth/me`
(o inicie sesión de nuevo).

---

## 6. Resolución de personas por email

El `PlatformAdmin` identifica a una persona con `POST /admin/users/resolve`,
mandando un email y recibiendo:

```json
{ "email": "...", "displayLabel": "..." }
```

**La respuesta no incluye `userId`, y eso es deliberado.** Si el cliente
pudiera capturar un identificador, terminaría transportándolo como si fuera
autoridad. Todo el frontend administrativo opera **por email**, y las dos
mutaciones vuelven a resolver la persona server-side antes de escribir nada.

Propiedades de seguridad del endpoint:

- sólo una cuenta `active` con email válido es elegible;
- **todo** caso no elegible —inexistente, `pending`, `suspended`, `archived`,
  email nulo— responde el **mismo 404 uniforme**. El frontend no los
  distingue, porque hacerlo filtraría el estado de la cuenta de otra persona;
- una ambigüedad de mayúsculas (dos filas que difieren sólo en capitalización)
  **falla closed** con un error interno genérico: nunca se elige una
  arbitrariamente.

Y una consecuencia que conviene tener presente: **este endpoint nunca fue
autoridad.** Entre el resolve y la confirmación, la persona puede dejar de ser
elegible; si eso pasa, la mutación responde el mismo 404 uniforme y la
resolución se invalida. El frontend vuelve al paso de búsqueda.

---

## 7. Crear una institución

`POST /admin/issuers` recibe exactamente tres campos (`name`, `legalName`,
`initialAdminUserEmail`) y crea **atómicamente**, en una sola transacción:

1. la `Issuer`;
2. la `IssuerMembership` inicial (`admin`, `active`);
3. un `AuditLog` `issuer_provisioned`;
4. un `AuditLog` `issuer_membership_granted`.

Cualquier fallo revierte las cuatro: no existe provisioning parcial.

La institución **nace** así:

```
authorizationStatus = authorized
authorizedAt        = now          (lo fija el servidor)
did                 = null
walletAddress       = null
```

El cliente no puede imponer `authorizationStatus`, `authorizedAt`, `did`,
`walletAddress`, `role`, `status` ni `metadata`: el validador los rechaza con
400.

En esa operación **no** hay: provisioning técnico, DID, wallet, signer,
blockchain, ni copia de catálogo académico. La institución nace
académicamente vacía, y sus contadores de catálogo en 0 son el estado
correcto.

### Nombres duplicados

El schema **no** tiene unique sobre `name` ni sobre `legalName`, y el
frontend **no** inventa esa restricción. Dos instituciones pueden llamarse
igual.

La razón no es descuido: una comprobación application-level tendría una
ventana de carrera y, sobre todo, asumiría que dos nombres iguales son
necesariamente la misma entidad —lo cual es falso, hay instituciones
homónimas en jurisdicciones distintas. Una identidad institucional fuerte
sería un mecanismo propio y explícito (un identificador fiscal o de registro,
con su constraint y su migración), no un efecto colateral de este endpoint.

---

## 8. Agregar un administrador

`POST /admin/issuers/:issuerId/memberships` recibe **un** campo (`userEmail`)
y crea una `IssuerMembership(admin, active)` más un `AuditLog`, en una
transacción.

- la institución sale **del path**, nunca del body;
- `role` y `status` los fija el **servidor**; no hay selector de rol;
- el actor sale del token.

**Es create-only.** Si ya existe *cualquier* membership para ese par
(persona, institución) responde **409** y no escribe nada —incluso si la
existente está `revoked`, `pending`, o es `viewer` u `operator`.

No hay reactivación, ni update, ni upsert, ni en el backend ni en la UI. La
copy del 409 dice que *"ya tiene una membresía asociada"* y deliberadamente
**no** dice *"ya es administrador"*, porque la membership existente podría ser
de otro rol o estar revocada.

> Consecuencia conocida: una membership `revoked` deja a esa persona
> permanentemente sin acceso a esa institución por esta vía. Reactivar
> requeriría un mecanismo nuevo y explícito, con su propia auditoría. Hoy no
> existe.

---

## 9. La superficie `/admin`

Sólo renderiza para un `PlatformAdmin`, y eso es **UX, no seguridad**: la
autoridad real son `AuthGuard` + `PlatformAdminGuard`, server-side, que
releen la tabla en cada request. Quien escriba `/admin` a mano no obtiene
ningún dato.

Funcionalmente, un `PlatformAdmin` puede:

- listar todas las instituciones;
- seleccionar una;
- ver sus personas con acceso, **en cualquier estado** (las revocadas y
  pendientes también se muestran: el objetivo es diagnóstico);
- ver su readiness técnica como booleanos;
- agregar un administrador;
- crear una institución.

El flujo de toda escritura de autoridad es el mismo:

```
email → resolve → ver a quién se le va a dar acceso → confirmación explícita → mutación
```

No existe el camino "email + Enter → membership creada". La confirmación
muestra los tres datos juntos —persona, institución y rol— precisamente para
que un grant accidental requiera ignorar los tres.

---

## 10. Auditoría

Tres eventos, con `action` en snake_case y `resourceType` igual al nombre del
modelo Prisma:

| `action` | `resourceType` | `actorType` | `actorId` | Cuándo |
|---|---|---|---|---|
| `platform_admin_granted` | `PlatformAdmin` | `system` | `null` | el bootstrap otorga la capacidad de plataforma |
| `issuer_provisioned` | `Issuer` | `system_admin` | el `PlatformAdmin` | se da de alta una institución |
| `issuer_membership_granted` | `IssuerMembership` | `system_admin` | el `PlatformAdmin` | se otorga autoridad institucional |

Los dos `actorType` distintos no son una inconsistencia: `system_admin` es un
`PlatformAdmin` humano actuando por HTTP, mientras que el bootstrap corre
fuera de una request y no tiene actor —de ahí `system` con `actorId: null`.
Ambos valores son del enum `ActorType` existente.

Toda escritura de autoridad queda auditada, en la **misma transacción** que la
produce. Un 409 duplicado no genera ninguna fila nueva, y una corrida
idempotente del bootstrap tampoco: no hubo un hecho nuevo que auditar.

La `metadata` evita PII innecesaria. El `issuer_provisioned`, por ejemplo,
registra el nombre de la institución, su estado inicial y el id de quien queda
al mando —pero no el email de esa persona, ni su nombre, ni DID, ni wallet.

**No existe ninguna superficie para consultar la auditoría.** Las filas están
en la base; no hay endpoint ni pantalla que las muestre, y S7b no inventa uno.

---

## 11. Matriz de endpoints

| Método y ruta | Actor | Propósito | ¿Muta autoridad? |
|---|---|---|---|
| `GET /auth/me` | cualquier `User` autenticado | contexto propio: capacidad de plataforma, memberships activas, intención de onboarding | no |
| `GET /admin/issuers` | `PlatformAdmin` | padrón completo de instituciones con readiness y contadores | no |
| `GET /admin/issuers/:issuerId/memberships` | `PlatformAdmin` | personas con acceso a una institución, en cualquier estado | no |
| `POST /admin/users/resolve` | `PlatformAdmin` | confirmación visual de una persona por email | no |
| `POST /admin/issuers/:issuerId/memberships` | `PlatformAdmin` | otorga autoridad admin sobre una institución existente | **sí** |
| `POST /admin/issuers` | `PlatformAdmin` | crea una institución y designa su primer administrador | **sí** |

No hay `PUT`, `PATCH` ni `DELETE` en la superficie administrativa, y un guard
estructural del frontend congela que sólo existan estas cinco rutas bajo
`/admin`.

La superficie administrativa **no** incluye: editar nombre o razón social,
revocar o deshabilitar una institución, eliminarla, ni editar su DID o wallet.

---

## 12. Modelo de seguridad

Principios que el código sostiene hoy:

- **el frontend no es autoridad.** Ocultar un botón o una ruta es UX; la
  decisión la toma el backend en cada request;
- **el backend decide los grants**, y vuelve a resolver la persona
  server-side por email antes de escribir;
- **`role` y `status` son server-owned.** El cliente no los propone; si lo
  intenta, 400;
- **el cliente nunca transporta un identificador de persona** como objetivo de
  autoridad: `POST /admin/users/resolve` no devuelve `userId`;
- **`PlatformAdminGuard`** protege las operaciones de plataforma;
  **`IssuerMembership`** protege las operaciones institucionales. Son dos
  planos separados y ninguno sustituye al otro;
- **ningún privilegio proviene del onboarding**;
- **fail-closed en la readiness técnica**: una institución habilitada sin DID
  ni wallet no puede emitir, y la regla rechaza por defecto;
- **confirmación explícita en la UI** antes de toda escritura de autoridad;
- **ninguna mutación se reintenta automáticamente.** Un POST con resultado
  ambiguo (red caída, 5xx) no se reenvía solo: el alta de instituciones no es
  idempotente y un reintento automático podría crear dos. Lo que se ofrece es
  releer el estado autoritativo;
- **un 201 ya recibido no se desconfirma** porque falle el refresh posterior:
  son dos operaciones distintas y la UI las distingue.

### Claves privadas

La superficie administrativa actual **no**:

- solicita claves privadas;
- almacena claves privadas;
- configura un signer;
- configura una wallet;
- configura un DID;
- configura una red blockchain.

No hay ningún campo, input ni clave de body para nada de eso en `/admin`, y un
guard del frontend lo congela.

**Este documento no afirma cómo se custodiarán esas claves.** El modelo de
identidad técnica del emisor —derivación de DID, signer global o por
institución, custodia— se diseña en **S8**. `auth-and-permissions-v0.md` §8.1
ya fija un principio previo (la clave privada no vive en PostgreSQL), pero la
decisión completa está pendiente.

---

## 13. Qué quedó demostrado ejecutablemente

El E2E integrado del circuito institucional ejecuta **código productivo real**
de: el servidor HTTP de Nest con su routing y su mapeo de excepciones a
status, `AuthController`/`AuthService` (registro, login, `/auth/me`), firma y
verificación de JWT, hashing de password, `AuthGuard`, `PlatformAdminGuard`,
los cuatro controllers de `/admin` con sus validadores y DTOs, los services
administrativos, `IssuersService.assertUserCanOperateAuthorizedIssuer`,
`assertIssuerCanIssue`, una lectura institucional protegida, el bootstrap de
la capacidad de plataforma, y —en la capa web— `AdminRoute`, su boundary, los
flujos administrativos, el cliente de API y los adapters con toda su
validación de contrato.

Comportamientos comprobados:

- el signup institucional **no** otorga autoridad: ni `Issuer`, ni membership,
  ni `PlatformAdmin`, ni auditoría;
- una persona con intención institucional y sin membership queda **pending**;
- un `User` con intención institucional **no puede** crear una institución
  (403);
- un `PlatformAdmin` **sin ninguna membership** usa `/admin`;
- sin token, `/admin` responde **401**, no 403;
- el bootstrap de la capacidad de plataforma es **idempotente**: una segunda
  corrida no crea una fila ni una auditoría más;
- `POST /admin/users/resolve` **no expone `userId`**, y un email no elegible
  —inexistente o con la cuenta suspendida— devuelve el **mismo 404**, sin
  filtrar el estado;
- `POST /admin/issuers` crea la institución y su primer administrador, con
  exactamente **dos** AuditLogs, y revierte **todo** si el email no resuelve;
- la persona **sale de pending** tras revalidar, por los dos caminos reales
  (token existente y login nuevo), y su intención de onboarding **no cambia**;
- con membership, la persona **opera** la institución (200); un tercero sin
  membership recibe **403**; y el `PlatformAdmin` que la creó **también
  recibe 403**;
- ese mismo `PlatformAdmin` gana acceso **sólo** tras asignarse
  explícitamente, y el acceso queda respaldado por una fila real;
- un grant duplicado da **409** sin tocar la membership ni la auditoría; una
  membership `revoked` **también** da 409, sin reactivarse;
- intención `personal` + membership explícita → acceso, sin que la intención
  se modifique;
- intención `null` (cuenta legacy) + membership explícita → acceso;
- la institución recién creada, con autoridad administrativa **completa**,
  **falla closed** en la regla de emisión por identidad técnica incompleta.

### Alcance de la evidencia

> El circuito institucional fue validado de extremo a extremo a nivel de
> superficies, contratos y reglas de autorización productivas, manteniendo
> aisladas las dependencias externas mediante infraestructura local y test
> doubles, con blockchain en modo mock.

Esto **no** es un "E2E de producción". No se usó: browser real, deployment
desplegado, PostgreSQL o RDS real, AWS, Vercel, ni blockchain real (Base
Sepolia). La persistencia se sustituyó por un doble en memoria y el transporte
HTTP del frontend por un backend de test con estado.

---

## 14. Limitaciones de lo demostrado

El doble de persistencia **no demuestra compatibilidad completa con Prisma y
PostgreSQL reales**. Implementa exactamente las operaciones y las formas de
consulta que estos caminos ejercitan; si Prisma real difiere en un borde que
el E2E no toca, el doble no lo delata.

Lo que el E2E sí prueba es la **composición**: rutas, guards, códigos HTTP,
el token real viajando entre superficies, los contratos, la temporalidad del
grant, y que frontend y backend respetan el mismo modelo de autoridad. La
cobertura de cada service por separado la dan las suites unitarias, con sus
propios dobles.

### Pendiente de S7c — validación de deployment

- aplicar las migraciones contra la base real;
- re-ejecutar el grant SQL de permisos sobre los objetos nuevos;
- ejecutar el bootstrap de la capacidad de plataforma en el entorno real;
- validación de Docker (el daemon estaba apagado al cerrar G1a);
- smokes sobre el deployment.

### Pendiente de S8 — identidad técnica del emisor

- signer;
- DID de la institución;
- wallet;
- custodia de claves;
- registry on-chain;
- blockchain real / Base Sepolia.

Hasta que esa capa exista, **ninguna institución creada desde `/admin` puede
emitir**, y eso es el comportamiento correcto.

---

## 15. Diagrama

```
  persona
    │
    │  signup + intención de onboarding
    ▼
  User  ──────────────────────────────────────────┐
    │                                             │
    │  sin autoridad                              │ capacidad personal
    ▼                                             ▼
  /institutional-access-pending            espacio personal (holder)


  PlatformAdmin  (capacidad global, otorgada fuera de banda)
    │
    ├──▶ crea Issuer  ──────────────┐
    │                               │
    └──▶ otorga IssuerMembership ───┤
                                    ▼
                            autoridad institucional
                                    │
                                    ▼
                            acceso a /issuer


  Issuer
    │
    ├──▶ habilitación operacional   (authorizationStatus = authorized)   ✔ hoy
    │
    └──▶ identidad técnica          (did / walletAddress / signer)       ✗ S8
                                    │
                                    ▼
                               readyToIssue
```

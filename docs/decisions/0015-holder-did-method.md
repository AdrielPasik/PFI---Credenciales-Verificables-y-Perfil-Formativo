# ADR 0015 - Holder DID Provisioning Method

## Contexto

A1 introdujo el registro publico de holders (`POST /auth/register`), que crea
un `User` con `did = null`. `CredentialsService.issueCredential` exige
`subjectUser.did != null` para poder canonizar y emitir. Antes de A2 no
existia en el repo ningun mecanismo real de provisioning de DID para
holders: los unicos valores de `User.did`/`Issuer.did` eran literales
`did:example:*` hardcodeados en seeds. Tampoco existia resolucion de DID,
DID Document, `verificationMethod`, ni ninguna clave criptografica asociada
a un holder.

A2.0 (auditoria + decision, sin implementacion) evaluo las alternativas
reales disponibles. A2.1 implementa la decision aprobada.

## Decision

Provisionar automaticamente un identificador `did:web` platform-managed
para cada holder, derivado deterministicamente de `User.id`:

```
did:web:<host>:did:users:<userId>
```

resoluble en:

```
https://<host>/did/users/<userId>/did.json
```

- `<host>` proviene de una variable de configuracion explicita,
  `PUBLIC_DID_BASE_URL` (origen HTTPS publico y estable del backend
  NestJS), nunca inferida del `Host` header ni de `NEXT_PUBLIC_API_URL`.
- `<userId>` es el UUID interno de `User.id` -- nunca firstName, lastName,
  displayName ni email.
- El DID Document servido es minimo: `{"@context": "...", "id": "..."}`,
  sin `verificationMethod`. El chequeo normativo contra W3C DID Core 1.0
  (seccion 4, modelo de datos) confirma que `verificationMethod` es
  `OPTIONAL` -- la unica propiedad requerida del documento es `id`. La
  especificacion did:web (W3C-CCG) solo exige, para la operacion Read, que
  el `id` del documento resuelto coincida exactamente con el DID
  solicitado; su descripcion de la operacion Create menciona un keypair
  como ejemplo, no como requisito normativo.
- `User.did` es write-once: una vez persistido, nunca se recalcula ni se
  sobreescribe (ni por login, ni por una nueva emision, ni por un cambio de
  `PUBLIC_DID_BASE_URL`, ni por cambio de nombre/email).
- El provisioning ocurre automaticamente en dos puntos: al registrar
  (`AuthService.register`, dentro de la misma transaccion que crea
  `User`+`AuthCredential`) y de forma perezosa antes de emitir
  (`CredentialsService.issueCredential`, para holders legacy con
  `did = null`), ambos a traves de una unica funcion compartida,
  `ensureDidForUser`.

## Justificacion

- did:web no requiere que el holder posea una wallet, firme transacciones
  ni custodie una clave privada -- coincide con la arquitectura actual,
  donde el backend es el unico orquestador y el holder no tiene MetaMask;
- es determinista y sin I/O externo (a diferencia de did:key o
  did:pkh/did:ethr, que requieren generar/gestionar material criptografico),
  lo que hace que el provisioning sea trivialmente idempotente y seguro
  ante condiciones de carrera: dos intentos concurrentes de provisioning
  para el mismo `User` calculan el mismo valor candidato; la persistencia
  usa un UPDATE condicional (`WHERE did IS NULL`) y relee el valor
  realmente persistido si pierde la carrera, nunca sobreescribe;
- es resoluble mediante HTTPS estandar, sin infraestructura blockchain
  adicional ni dependencias nuevas;
- mantiene `User.id` como el identificador interno canonico -- el DID no
  lo reemplaza, solo lo proyecta publicamente de forma estable;
- evita cualquier lenguaje de "identidad autosoberana": el control es
  explicitamente platform-managed (Traza controla la resolucion), lo cual
  es honesto dado que no existe ninguna clave del holder involucrada.

## Consecuencias

- se agrega `PUBLIC_DID_BASE_URL` como variable de configuracion opcional;
  si esta ausente, el registro y la emision siguen funcionando exactamente
  como antes de A2.1 (`did = null`, emision bloqueada con el mismo
  `BadRequestException` ya existente) -- nunca se inventa un DID falso;
- se agrega un endpoint publico de solo lectura,
  `GET /did/users/:userId/did.json`, que nunca provisiona (solo lee
  `User.did` ya persistido) y nunca expone PII (email, nombre, apellido,
  displayName, status, credenciales);
- si el operador cambia `PUBLIC_DID_BASE_URL` despues de que un holder ya
  tiene DID, ese holder conserva su DID del host anterior -- la
  infraestructura debera seguir resolviendo hosts historicos, o se
  disenara una migracion explicita en un slice futuro; A2.1 no la
  implementa;
- `Credential` no persiste un snapshot del DID usado al emitir
  (`subjectDidAtIssuance`): dado que `User.did` es write-once, el DID leido
  posteriormente del `User` es, por construccion, el mismo que participo en
  el `canonicalHash` de sus Credentials ya emitidas. Si en el futuro Traza
  permite rotar/cambiar el DID de un holder, esta ADR queda invalidada en
  ese punto y debera reconsiderarse un snapshot historico;
- `Issuer.did` no se toca en A2.1 -- issuer y holder pueden evolucionar con
  metodos DID distintos; ese analisis queda fuera de este ADR;
- Traza no afirma proveer prueba criptografica de control del DID por
  parte del holder, ni produce un W3C Verifiable Credential completo. El
  DID es un identificador tecnico pseudonimo, resoluble y estable -- no
  una prueba de identidad legal ni de competencia academica. La validez
  academica sigue siendo responsabilidad del issuer; la integridad/estado
  de la credencial sigue usando el mecanismo de evidencia existente
  (`canonicalHash` + `BlockchainRecord`), sin relacion con el DID.

## Alternativas descartadas

- **did:key**: autocertificante e inmutable (el DID literalmente ES la
  clave publica) -- exigiria generar y custodiar una clave privada por
  holder sin que el holder tenga control real ni beneficio criptografico
  actual (Traza nunca verifica firmas del holder). Sin rotacion posible:
  perder la clave significa perder el DID para siempre. Descartado por
  introducir un problema de custodia sin justificacion funcional.
- **did:pkh / did:ethr**: metodos derivados de una cuenta blockchain --
  exigirian una wallet o direccion propia del holder (`MetaMask` u
  equivalente), lo que contradice el diseno actual donde solo el
  issuer/backend firma transacciones. Descartado para holder; podria
  evaluarse a futuro y por separado unicamente para `Issuer.did`
  (`did:pkh:eip155:<chainId>:<issuer.walletAddress>`), fuera de alcance de
  este ADR.
- **did:example**: reservado por el propio W3C exclusivamente para
  ejemplos de documentacion -- nunca valido como metodo productivo.
  Permanece unicamente en seeds/fixtures de demo, sin relacion con el
  mecanismo real descrito aqui.
- **did:traza (metodo custom)**: descartado porque definir un DID Method
  propio exige una especificacion formal (sintaxis, operaciones CRUD,
  seguridad, privacidad) equivalente a la de un metodo W3C real -- alcance
  claramente fuera de este PFI. Usar la sintaxis `did:traza:...` sin esa
  especificacion no produce, por si sola, un metodo DID interoperable.

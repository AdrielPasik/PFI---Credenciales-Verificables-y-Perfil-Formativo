# Auth y permisos v0

> Este documento define una estrategia inicial de autenticacion y autorizacion. No implementa login ni selecciona un proveedor definitivo.

## 1. Actores

- `holder`: titular de credenciales y perfil formativo.
- `issuer_admin`: operador autorizado de una institucion emisora.
- `verifier`: tercero que verifica credenciales o perfiles compartidos.
- `system_admin`: operador tecnico con privilegios globales.

## 2. Principios de autorizacion

- minimo privilegio por defecto;
- acceso a datos personales solo cuando sea necesario;
- verificacion publica limitada a lo explicitamente compartido;
- el backend es el unico punto que decide permisos efectivos.

## 2.1 Quien se autentica realmente

En este sistema la autenticacion corresponde a usuarios humanos del modelo `User`, no a la institucion `Issuer` como entidad abstracta.

Esto implica:

- un operador institucional inicia sesion como `User`;
- un holder inicia sesion como `User`;
- la institucion emisora existe como `Issuer` en DB;
- el `Issuer` no "loguea" directamente con password propia.

Modelo mental esperado:

```text
Issuer
= universidad / institucion / entidad emisora

User
= persona o cuenta que usa el sistema

IssuerMembership
= vinculo entre User e Issuer

AuthCredential
= password hash para que ese User pueda iniciar sesion
```

Ejemplo institucional:

```text
issuer.admin@example.com
-> User real
-> tiene AuthCredential
-> tiene IssuerMembership admin con Demo University
-> puede operar en nombre de esa institucion
```

Ejemplo holder:

```text
holder.demo@example.com
-> User real
-> tiene AuthCredential
-> tiene DID propio
-> entra a su wallet/app interna
-> ve sus credenciales y perfil formativo
-> no firma transacciones blockchain
-> no necesita MetaMask
```

## 3. Acciones por rol

### `holder`

- ver sus credenciales;
- ver su perfil formativo;
- generar links o tokens de comparticion cuando exista esa funcionalidad;
- no emitir ni revocar credenciales institucionales.

### `issuer_admin`

- siempre esta limitado a uno o mas `issuer_id`;
- no existe un `issuer_admin` global salvo que tambien tenga rol `system_admin`;
- crear borradores;
- emitir credenciales para su institucion;
- consultar credenciales emitidas por su institucion;
- solicitar analisis semantico sobre credenciales autorizadas;
- revocar credenciales emitidas por su institucion cuando la politica lo permita;
- no acceder libremente a todos los perfiles de usuarios fuera de su alcance;
- toda accion de emision, consulta o revocacion debe validar pertenencia al emisor.

### `verifier`

- verificar credenciales o perfiles compartidos;
- consultar solo la informacion habilitada por el flujo de verificacion;
- no modificar credenciales, emisores ni perfiles.
- para la demo basica puede operar sin login mediante endpoint publico controlado o link/token de sharing;
- no necesita cuenta propia salvo que en el futuro se agreguen auditoria avanzada, paneles privados o controles finos de acceso.

### `system_admin`

- administrar emisores y estados globales;
- consultar auditoria y eventos;
- ejecutar reconstrucciones o acciones de mantenimiento;
- acceso ampliado sujeto a trazabilidad reforzada.

## 4. Datos visibles por actor

### Holder

- detalle completo de sus credenciales;
- estado de verificacion;
- perfil formativo completo propio;
- historial de comparticion futuro si se implementa.

### Issuer admin

- credenciales emitidas por su institucion;
- datos suficientes para emitir, corregir o revocar;
- estado blockchain y analisis asociados a sus credenciales.

### Verifier

- resultado de verificacion;
- identidad basica del emisor;
- estado de revocacion;
- datos de perfil solo si el titular los compartio explicitamente.

### System admin

- acceso operativo amplio para soporte y auditoria;
- no implica exposicion irrestricta fuera del backend ni fuera de trazabilidad.

## 5. Datos que no debe ver cada actor

- un `verifier` no debe ver datos personales completos no compartidos;
- un `issuer_admin` no debe ver credenciales de otros emisores salvo permisos excepcionales;
- un `holder` no debe ver configuraciones internas ni logs sensibles del sistema;
- ningun actor de frontend debe ver secretos de infraestructura ni claves blockchain.

## 6. Acceso publico por link o QR

- debe resolverse mediante token o grant de acceso;
- el token debe poder expirar y revocarse;
- el acceso debe estar acotado a una credencial o perfil especifico;
- el backend debe registrar el evento de verificacion derivado del link.

## 7. Sharing grants como concepto futuro

- grant ligado a recurso, alcance y expiracion;
- scope posible: credencial individual, subconjunto de credenciales o perfil;
- opcion de revocacion temprana por el titular;
- no hace falta modelar todavia el token definitivo ni el proveedor de auth.

## 8. Relacion con wallet mobile-first / PWA

- la wallet web debe exponer permisos y consentimiento de forma clara en pantallas pequenas;
- la experiencia mobile no cambia las reglas de autorizacion del backend;
- una futura app nativa deberia reutilizar el mismo modelo de roles y grants.
- el holder usa una wallet/app interna del sistema y no depende de MetaMask para la demo;
- el holder no firma transacciones blockchain en este modelo.

## 8.1 Wallet institucional y signer blockchain

La blockchain se firma del lado institucional, no del lado holder.

Principios:

- el signer blockchain corresponde al issuer autorizado o a un signer backend local/dev controlado por ese issuer;
- la direccion publica puede persistirse en base de datos;
- la private key no debe guardarse en PostgreSQL;
- la private key debe vivir fuera de la DB, por ejemplo en variable de entorno local/dev o en custodia institucional futura.

En el estado actual del modelo:

- `Issuer.walletAddress` representa la direccion publica institucional activa;
- esto alcanza para la demo inicial y para el flujo actual con Anvil;
- la emision blockchain no requiere MetaMask del holder.

Evolucion futura posible:

```text
Issuer
= entidad legal/institucional

IssuerMembership
= que usuarios humanos pueden operar en nombre del issuer

IssuerSigner o IssuerWallet
= que direcciones publicas estan autorizadas para firmar evidencia blockchain por ese issuer
```

Esa separacion todavia no es obligatoria para el slice actual, pero el principio funcional ya queda fijado:

```text
solo instituciones autorizadas pueden emitir,
y dentro de cada institucion solo usuarios autorizados pueden operar,
usando signers institucionales registrados.
```

## 9. Consideraciones de privacidad

- no exponer datos personales completos en blockchain;
- evitar respuestas de verificacion sobredimensionadas;
- separar claramente datos verificables, datos operativos y datos semanticos;
- registrar accesos sensibles mediante auditoria.

## 10. Decisiones pendientes

- proveedor definitivo de identidad y autenticacion;
- formato final de sesiones, JWT o equivalente;
- soporte futuro para multi-factor o wallet-based auth institucional;
- modelo exacto de grants compartibles y expiracion;
- politica de retencion de eventos de verificacion.

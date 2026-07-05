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

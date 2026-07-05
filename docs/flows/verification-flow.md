# Flujo de verificacion

## Objetivo

Permitir que un tercero valide autenticidad, emisor y estado de una credencial compartida por el usuario.

## Actores

- Usuario titular
- Verificador externo
- Backend API
- Blockchain

## Precondiciones

- la credencial fue emitida previamente;
- existe un identificador, link o QR compartible;
- el backend puede acceder al registro off-chain y a la evidencia on-chain.

## Secuencia

1. El usuario comparte una credencial, link o QR.
2. El verificador envia el identificador al backend desde `/verifier`.
3. El backend recupera la credencial o su referencia estructurada.
4. Se valida integridad, estructura y estado local.
5. Se recalcula el hash de la credencial canonica.
6. Se consulta blockchain para verificar:
   - existencia del hash;
   - emisor autorizado;
   - estado de revocacion;
   - metadatos minimos de registro.
7. El backend consolida el resultado.
8. El verificador recibe una respuesta clara y auditable.

## Resultados posibles

- valida y activa;
- valida pero revocada;
- invalida por inconsistencia de hash;
- invalida por emisor no autorizado;
- no encontrada.

## Consideraciones

- el frontend no consulta blockchain directamente;
- el resultado debe ser interpretable para usuarios no tecnicos;
- cada verificacion puede generar un evento de auditoria.

# Contratos API v0

> Este documento define contratos HTTP iniciales por dominio. No implica implementacion de controllers ni OpenAPI ejecutable.

## Estados de implementacion

- `future`: documentado, fuera de la primera implementacion.
- `mock`: esperable como stub o contrato compatible antes de la logica final.
- `v1_candidate`: candidato directo a una primera version implementable.

## 1. Identity / Users

### `GET /users/me`

- Proposito: devolver identidad y contexto basico del usuario autenticado.
- Actor: `holder`, `issuer_admin`, `system_admin`.
- Request conceptual: token de sesion o auth bearer.
- Response conceptual: `user_id`, rol, did, permisos principales.
- Errores esperados: `401 unauthorized`, `403 forbidden`.
- Estado: `v1_candidate`.

### `GET /users/:id`

- Proposito: consultar datos basicos de un usuario por id segun permisos.
- Actor: `holder`, `system_admin`.
- Request conceptual: path `id`.
- Response conceptual: resumen de usuario sin datos sensibles innecesarios.
- Errores esperados: `401`, `403`, `404`.
- Estado: `future`.

### `GET /users/:id/credentials`

- Proposito: listar credenciales visibles para un usuario.
- Actor: `holder`, `system_admin`.
- Request conceptual: path `id`, filtros por `status` o `type`.
- Response conceptual: lista resumida de credenciales.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

### `GET /users/:id/profile`

- Proposito: consultar el perfil formativo consolidado.
- Actor: `holder`, `system_admin`.
- Request conceptual: path `id`.
- Response conceptual: `formative_profile_v1`.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

## 2. Issuers

### `GET /issuers`

- Proposito: listar emisores registrados.
- Actor: `issuer_admin`, `system_admin`, `verifier`.
- Request conceptual: filtros por estado o nombre.
- Response conceptual: lista resumida de emisores.
- Errores esperados: `401`, `403`.
- Estado: `v1_candidate`.

### `POST /issuers`

- Proposito: registrar un emisor en el sistema.
- Actor: `system_admin`.
- Request conceptual: nombre institucional, did, wallet address y metadata basica.
- Response conceptual: emisor creado.
- Errores esperados: `400 validation_error`, `409 duplicate`, `403`.
- Estado: `future`.

### `GET /issuers/:id`

- Proposito: consultar detalle de un emisor.
- Actor: `issuer_admin`, `system_admin`, `verifier`.
- Request conceptual: path `id`.
- Response conceptual: resumen institucional y estado de autorizacion.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

### `PATCH /issuers/:id`

- Proposito: actualizar metadata basica del emisor.
- Actor: `issuer_admin`, `system_admin`.
- Request conceptual: campos editables institucionales.
- Response conceptual: emisor actualizado.
- Errores esperados: `400`, `403`, `404`.
- Estado: `future`.

### `POST /issuers/:id/authorize`

- Proposito: marcar un emisor como autorizado para emision.
- Actor: `system_admin`.
- Request conceptual: motivo, wallet address o referencia operativa.
- Response conceptual: estado actualizado de autorizacion.
- Errores esperados: `400`, `403`, `404`, `409`.
- Estado: `future`.

### `POST /issuers/:id/revoke-authorization`

- Proposito: revocar autorizacion de un emisor.
- Actor: `system_admin`.
- Request conceptual: motivo de revocacion.
- Response conceptual: estado revocado.
- Errores esperados: `400`, `403`, `404`.
- Estado: `future`.

### `GET /issuers/:id/credentials`

- Proposito: listar credenciales emitidas por un emisor.
- Actor: `issuer_admin`, `system_admin`.
- Request conceptual: filtros por fecha, estado o usuario.
- Response conceptual: lista resumida de credenciales.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

## 3. Credentials

### `POST /credentials/draft`

- Proposito: crear o persistir un borrador de credencial.
- Actor: `issuer_admin`.
- Request conceptual: datos base de `credential_v1` sin `issued_at`.
- Response conceptual: credencial en estado `draft`.
- Errores esperados: `400`, `403`, `409`.
- Estado: `v1_candidate`.

### `POST /credentials/:id/issue`

- Proposito: emitir una credencial y fijar hash canonico.
- Actor: `issuer_admin`.
- Request conceptual: path `id`, confirmacion de emision, datos finales.
- Response conceptual: credencial emitida con estado, hash y referencia blockchain si aplica.
- Errores esperados: `400`, `403`, `404`, `409`.
- Estado: `v1_candidate`.

### `GET /credentials/:id`

- Proposito: obtener detalle de una credencial segun permisos.
- Actor: `holder`, `issuer_admin`, `system_admin`.
- Request conceptual: path `id`.
- Response conceptual: `credential_v1` y metadatos operativos visibles.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

### `GET /credentials/:id/status`

- Proposito: obtener el estado operativo y verificable de una credencial.
- Actor: `holder`, `issuer_admin`, `verifier`, `system_admin`.
- Request conceptual: path `id`.
- Response conceptual: `status`, `issued_at`, `revoked_at`, presencia de hash y registro blockchain.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

### `POST /credentials/:id/revoke`

- Proposito: revocar una credencial emitida.
- Actor: `issuer_admin`, `system_admin`.
- Request conceptual: motivo de revocacion.
- Response conceptual: credencial revocada y evidencia operativa resultante.
- Errores esperados: `400`, `403`, `404`, `409`.
- Estado: `future`.

### `GET /credentials/:id/blockchain-record`

- Proposito: recuperar la evidencia blockchain asociada.
- Actor: `holder`, `issuer_admin`, `system_admin`.
- Request conceptual: path `id`.
- Response conceptual: `blockchain_record_v1`.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

### `GET /credentials/:id/semantic-analysis`

- Proposito: consultar el ultimo analisis semantico disponible.
- Actor: `holder`, `issuer_admin`, `system_admin`.
- Request conceptual: path `id`.
- Response conceptual: `semantic_analysis_v1`.
- Errores esperados: `401`, `403`, `404`.
- Estado: `mock`.

## 4. Verification

### `POST /verification/credentials`

- Proposito: verificar una credencial a partir de payload o identificador.
- Actor: `verifier`, `system_admin`.
- Request conceptual: `credential_id`, token compartido o payload de credencial.
- Response conceptual: resultado de verificacion, emisor, hash, estado y revocacion.
- Errores esperados: `400`, `404`, `409`.
- Estado: `v1_candidate`.

### `GET /verification/credentials/:credentialId`

- Proposito: consultar un resultado de verificacion por credential id.
- Actor: `verifier`, `system_admin`.
- Request conceptual: path `credentialId`.
- Response conceptual: resumen verificable.
- Errores esperados: `401`, `403`, `404`.
- Estado: `mock`.

### `POST /verification/shared-link/:token`

- Proposito: verificar acceso mediante token o link compartido.
- Actor: `verifier`.
- Request conceptual: path `token`, contexto opcional del verificador.
- Response conceptual: credencial o perfil compartido segun alcance del token.
- Errores esperados: `400 invalid_token`, `403 expired_or_revoked`, `404`.
- Estado: `future`.

### `GET /verification/events/:id`

- Proposito: consultar un evento de verificacion registrado.
- Actor: `system_admin`, `issuer_admin`.
- Request conceptual: path `id`.
- Response conceptual: detalle resumido de `VerificationEvent`.
- Errores esperados: `401`, `403`, `404`.
- Estado: `future`.

## 5. Semantic / Profile

### `POST /semantic/analyze/credentials/:id`

- Proposito: disparar el analisis semantico de una credencial.
- Actor: `issuer_admin`, `system_admin`.
- Request conceptual: path `id`, flags operativas opcionales.
- Response conceptual: estado de solicitud o analisis generado.
- Errores esperados: `400`, `403`, `404`, `409`.
- Estado: `mock`.

### `GET /semantic/credentials/:id/analysis`

- Proposito: recuperar el analisis de una credencial.
- Actor: `holder`, `issuer_admin`, `system_admin`.
- Request conceptual: path `id`.
- Response conceptual: `semantic_analysis_v1`.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

### `POST /profiles/users/:id/rebuild`

- Proposito: recalcular el perfil formativo de un usuario.
- Actor: `system_admin`, `issuer_admin`.
- Request conceptual: path `id`, alcance opcional de reconstruccion.
- Response conceptual: perfil regenerado o job aceptado.
- Errores esperados: `400`, `403`, `404`.
- Estado: `future`.

### `GET /profiles/users/:id`

- Proposito: consultar el perfil formativo actual del usuario.
- Actor: `holder`, `system_admin`, `verifier` con grant explicito.
- Request conceptual: path `id`.
- Response conceptual: `formative_profile_v1`.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

## 6. Blockchain

### `POST /blockchain/credentials/:id/register`

- Proposito: registrar el hash canonico de una credencial en blockchain.
- Actor: `issuer_admin`, `system_admin`.
- Request conceptual: path `id`, parametros operativos de red si aplica.
- Response conceptual: `blockchain_record_v1`.
- Errores esperados: `400`, `403`, `404`, `409`.
- Estado: `mock`.

### `GET /blockchain/credentials/:id/record`

- Proposito: obtener el registro blockchain asociado a una credencial.
- Actor: `holder`, `issuer_admin`, `system_admin`.
- Request conceptual: path `id`.
- Response conceptual: `blockchain_record_v1`.
- Errores esperados: `401`, `403`, `404`.
- Estado: `v1_candidate`.

### `POST /blockchain/credentials/:id/revoke`

- Proposito: registrar la revocacion on-chain cuando corresponda.
- Actor: `issuer_admin`, `system_admin`.
- Request conceptual: path `id`, motivo de revocacion.
- Response conceptual: `blockchain_record_v1` actualizado o referencia operativa.
- Errores esperados: `400`, `403`, `404`, `409`.
- Estado: `future`.

### `GET /blockchain/issuers/:id/status`

- Proposito: consultar el estado verificable de autorizacion de un emisor.
- Actor: `issuer_admin`, `system_admin`, `verifier`.
- Request conceptual: path `id`.
- Response conceptual: estado del emisor, wallet y referencias de red.
- Errores esperados: `401`, `403`, `404`.
- Estado: `future`.

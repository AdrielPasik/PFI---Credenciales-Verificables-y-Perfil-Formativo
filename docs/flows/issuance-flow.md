# Flujo de emision

## Objetivo

Emitir una credencial educativa verificable, almacenarla off-chain y registrar evidencia minima on-chain.

## Actores

- Emisor institucional
- Backend API
- Base de datos off-chain
- Blockchain
- AI service

## Precondiciones

- el emisor esta autenticado;
- existe una identidad institucional registrada;
- los datos academicos requeridos estan disponibles;
- la red blockchain y el backend estan operativos.

## Secuencia

1. El emisor inicia la emision desde el portal `/issuer`.
2. El frontend envia al backend los datos de la credencial.
3. El backend valida formato, consistencia y permisos del emisor.
4. El backend normaliza el payload segun `credential_v1`.
5. Se genera un `credential_id` y se establece estado inicial.
6. Se calcula el hash de la representacion canonica de la credencial.
7. El backend registra en blockchain la evidencia minima.
8. Se guarda el registro blockchain asociado a la credencial.
9. Se persiste la credencial completa en almacenamiento off-chain.
10. La credencial se vincula al usuario titular.
11. Se programa o habilita el analisis semantico posterior.

## Entradas clave

- datos institucionales del emisor;
- identificacion del usuario titular;
- contenido academico estructurado o semiestructurado;
- metadatos de origen.

## Salidas esperadas

- credencial persistida off-chain;
- registro blockchain asociado;
- estado inicial de verificabilidad;
- disponibilidad para analisis semantico.

## Consideraciones

- no almacenar datos personales completos on-chain;
- separar el registro verificable del contenido completo;
- dejar trazabilidad suficiente para revocaciones futuras.

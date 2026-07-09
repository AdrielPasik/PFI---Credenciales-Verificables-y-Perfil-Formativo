# Blockchain Module

Responsabilidad futura:

- adaptador de evidencia blockchain;
- persistencia y consulta de `BlockchainRecord`;
- integracion con Anvil o Base Sepolia;
- revocacion on-chain futura.

Alcance actual:

- modulo NestJS minimo;
- `BlockchainEvidenceService` vacio;
- sin controllers;
- sin `ethers`;
- sin contratos;
- sin llamadas de red;
- sin persistencia real.

Principios:

- `blockchain` maneja evidencia tecnica, no ownership de `Credential`;
- no debe decidir reglas de emision;
- debe evitar dependencias circulares con `credentials`;
- cuando haya implementacion real, deberia recibir datos normalizados desde el modulo orquestador.

# Blockchain y evidencia verificable

Scope utiliza blockchain como capa de evidencia técnica de integridad. La
credencial, los documentos y los datos personales permanecen fuera de la
cadena; el backend construye una representación canónica y registra la
evidencia mínima correspondiente según el modo configurado.

## Referencias principales

- [Separación off-chain / on-chain](../decisions/0002-off-chain-on-chain-separation.md):
  alcance y límites de la evidencia blockchain.
- [Canonicalización y hashing](../architecture/canonicalization-and-hashing-v0.md):
  construcción y uso del hash canónico.
- [Verificación independiente](independent-verification.md): lectura técnica
  de una credencial y límites de la verificación pública.
- [Activación de Base Sepolia](base-sepolia-activation-runbook.md): procedimiento
  operativo para una red EVM de prueba; no implica una red productiva.
- [`contracts/README.md`](../../contracts/README.md): contrato Solidity,
  pruebas locales y herramientas asociadas.

La evidencia blockchain no valida el contenido académico ni reemplaza la
autoridad del emisor. Las operaciones de despliegue o activación requieren los
controles indicados en los procedimientos operativos correspondientes.

# Anvil Local Testing

Esta guia documenta la prueba local minima de `CredentialRegistry.sol` sobre Anvil, sin backend, sin Base Sepolia y sin MetaMask.

## Alcance

- deploy local del contrato en Anvil;
- registro de un `canonicalHash` real del backend;
- consulta de estado on-chain;
- revocacion del hash;
- nueva consulta de estado.

## Requisitos

- WSL/Ubuntu con Foundry instalado;
- `anvil`, `forge` y `cast` disponibles;
- repo abierto en la ruta:

```bash
cd "/mnt/c/Users/Personal/Documents/Universidad/PFI/PFI ADRIEL PASIK/PFI---Credenciales-Verificables-y-Perfil-Formativo/contracts"
```

## 1. Levantar Anvil

En una terminal WSL separada:

```bash
anvil --host 127.0.0.1 --port 8545
```

Esto levanta una blockchain local/dev con `chainId = 31337`.

## 2. Variables de entorno para la sesion

En otra terminal WSL:

```bash
export RPC_URL=http://127.0.0.1:8545
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export CREDENTIAL_HASH=0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab
```

`PRIVATE_KEY` es una publicly known Anvil dev key, never use outside local development.

## 3. Compilar

```bash
forge build
```

## 4. Deployar `CredentialRegistry`

```bash
forge create src/CredentialRegistry.sol:CredentialRegistry \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast
```

La salida muestra:

- `Deployed to`: direccion del contrato;
- `Transaction hash`: hash del deploy.

Guardar la direccion para los siguientes pasos:

```bash
export CONTRACT_ADDRESS=<deployed-contract-address>
```

## 5. Registrar un hash

```bash
cast send "$CONTRACT_ADDRESS" \
  'registerCredential(bytes32)' \
  "$CREDENTIAL_HASH" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY"
```

Que hace este paso:

- envia una transaccion local desde la cuenta dev de Anvil;
- registra el `bytes32` canonico ya calculado off-chain;
- guarda `issuer = msg.sender`;
- guarda `registeredAt = block.timestamp`;
- emite el evento `CredentialRegistered`.

## 6. Consultar el estado luego del registro

```bash
cast call "$CONTRACT_ADDRESS" \
  'getCredentialStatus(bytes32)(bool,bool,address,uint256,uint256)' \
  "$CREDENTIAL_HASH" \
  --rpc-url "$RPC_URL"
```

Interpretacion esperada de la salida:

1. `exists`
2. `revoked`
3. `issuer`
4. `registeredAt`
5. `revokedAt`

Despues del registro deberia verse conceptualmente:

```text
true
false
<issuer-address>
<registeredAt>
0
```

## 7. Revocar el hash

```bash
cast send "$CONTRACT_ADDRESS" \
  'revokeCredential(bytes32)' \
  "$CREDENTIAL_HASH" \
  --rpc-url "$RPC_URL" \
  --private-key "$PRIVATE_KEY"
```

Que hace este paso:

- exige que el hash exista;
- exige que el caller sea el mismo issuer que registro;
- marca `revoked = true`;
- guarda `revokedAt = block.timestamp`;
- emite el evento `CredentialRevoked`.

## 8. Consultar el estado luego de la revocacion

```bash
cast call "$CONTRACT_ADDRESS" \
  'getCredentialStatus(bytes32)(bool,bool,address,uint256,uint256)' \
  "$CREDENTIAL_HASH" \
  --rpc-url "$RPC_URL"
```

Despues de revocar deberia verse conceptualmente:

```text
true
true
<issuer-address>
<registeredAt>
<revokedAt>
```

## Notas importantes

- Esto es solo local/dev.
- No usa backend todavia.
- No usa Base Sepolia.
- No usa MetaMask.
- No guarda PII ni JSON de credencial on-chain.
- El contrato solo almacena evidencia minima: hash, issuer, timestamps y estado de revocacion.
- El `canonicalHash` se calcula fuera de la blockchain y luego se registra en el contrato.

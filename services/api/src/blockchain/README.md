# Blockchain Module

## Estado vigente (S8c5 – S8c10.1)

Esta seccion es la que manda. **Todo lo que sigue debajo describe el tooling
historico/local (Anvil) y se conserva solo como referencia**; donde contradice a
esta seccion, esta seccion es la correcta.

- **Target.** El modo de evidencia (`mock` | `credential_registry`) y la red
  (`anvil` | `base_sepolia`) son ejes independientes. `credential_registry_anvil`
  **ya no existe** como modo. La red final obligatoria es `base_sepolia`
  (`chainId` 84532). `blockchain-target.ts` es el unico lugar que lee
  `BLOCKCHAIN_EVIDENCE_MODE`, `CREDENTIAL_REGISTRY_NETWORK`,
  `CREDENTIAL_REGISTRY_CHAIN_ID`, `CREDENTIAL_REGISTRY_CONTRACT_ADDRESS`,
  `CREDENTIAL_REGISTRY_DEPLOYMENT_ID` y `CREDENTIAL_REGISTRY_RPC_URL`. Un target real
  incompleto o mal formado **falla cerrado**, nunca degrada a mock; el
  `deploymentId` reservado `unset` se rechaza.
- **Quien firma en runtime.** Las escrituras de produccion (registro y revocacion)
  las firma el **anchor `SignerProfile` por issuer**, cuya clave vive en SSM y se
  resuelve por perfil (S8c2/S8c6/S8c8). **No** es la variable global
  `CREDENTIAL_REGISTRY_PRIVATE_KEY`, que sobrevive solo como entrada de las CLI
  locales `blockchain:register|revoke|status` contra Anvil y **no** es autoridad de
  runtime ni la clave de deployment.
- **Deployment del contrato.** Se hace con una herramienta de operacion aparte
  (`deployment/`), **no** con `forge create` ni con ninguna clave en la linea de
  comandos: keystore cifrado, frase de paso sin eco, una sola transmision, evidencia
  verificada de recibo / bytecode / bloque y un manifest append-only en
  `contracts/deployments/`. El runtime Nest **no** importa esa herramienta. Ver
  `contracts/DEPLOYMENT_BASE_SEPOLIA.md`.
- **Una sola deployment canonica.** Los records congelan su deployment, pero la
  resolucion operativa solo soporta el target configurado hoy: no cambiar
  `contractAddress` / `deploymentId` despues del primer `BlockchainRecord` real.
- **Limitaciones abiertas (S8c11).** El preflight de runtime prueba presencia de
  codigo, no identidad del contrato (la identidad la prueba el manifest);
  la reconciliacion no tiene invocacion de produccion ni busqueda en chunks; el nonce
  es local al proceso (un solo escritor efectivo); y el migrator comparte tag con la API.

Responsabilidad actual:

- adaptador de evidencia blockchain;
- persistencia y consulta de `BlockchainRecord`;
- consulta read-only a `CredentialRegistry` en Anvil;
- escritura local/dev a `CredentialRegistry` en Anvil;
- integracion posterior con escritura real hacia Anvil o Base Sepolia;
- resolver record-bound para reconciliacion segura de evidencia on-chain.

Alcance actual:

- modulo NestJS minimo;
- `BlockchainEvidenceService` para mock/local DB ya existente;
- `BlockchainEvidenceService` con modo configurable para mock o `credential_registry_anvil`;
- `CredentialRegistryReadClient` read-only contra contrato EVM;
- `CredentialRegistryWriteClient` para transacciones locales de prueba contra Anvil;
- `CredentialRegistryDeploymentResolver`: resuelve un deployment solo cuando
  `BlockchainRecord.network`, `chainId` y `contractAddress` coinciden
  exactamente con una configuracion Anvil allowlisted;
- `BlockchainRecordReconciliationService`: clasifica de forma read-only la
  relacion entre estado PostgreSQL y el registro on-chain, sin mutar ninguno;
- `ethers@6.15.0` se usa solo dentro de los clientes blockchain encapsulados;
- CLI local `blockchain:status` para consultar `getCredentialStatus(bytes32)`;
- CLI local `blockchain:register` para ejecutar `registerCredential(bytes32)`;
- CLI local `blockchain:revoke` para ejecutar `revokeCredential(bytes32)`;
- revocacion coordinada issuer-scoped desde `CredentialsModule`, solo para un
  record Anvil resuelto y corroborado record-bound;
- sin integracion con el flujo de emision;
- sin cambios en `Credential`, `BlockchainRecord` o endpoints existentes;
- sin persistencia real on-chain desde backend;
- sin persistencia real en DB desde estas operaciones;
- sin dependencia de ABI generada en runtime;
- sin Base Sepolia configurada;
- sin MetaMask.

Principios:

- `blockchain` maneja evidencia tecnica, no ownership de `Credential`;
- no debe decidir reglas de emision;
- debe evitar dependencias circulares con `credentials`;
- la integracion Web3 queda encapsulada dentro de clientes propios del backend;
- no se exportan tipos de `ethers` fuera del cliente;
- `CREDENTIAL_REGISTRY_PRIVATE_KEY` se usa solo para pruebas locales/dev con Anvil;
- nunca deben commitearse private keys ni usarse claves reales en este slice;
- cuando haya implementacion real, deberia recibir datos normalizados desde el modulo orquestador.

## Foundation de revocacion record-bound

La revocacion coordinada implementada en `CredentialsModule` resuelve el
deployment desde el record persistido, nunca desde un
registry global por defecto, y validar:

1. coincidencia exacta de red, `chainId` y direccion de contrato;
2. `eth_chainId` del RPC contra el `chainId` persistido;
3. presencia de bytecode en la direccion del contrato;
4. lectura exitosa de `getCredentialStatus(bytes32)` mediante el ABI esperado;
5. existencia del hash canonico y coincidencia del registrante on-chain con el
   `issuerAddress` persistido.

Una falla en cualquiera de esos pasos es fail-closed. Un record `mock` se
clasifica como `MOCK_UNSUPPORTED`: no tiene una autoridad on-chain y no puede
usar una futura revocacion coordinada ni degradarse a una mutacion solo en DB.

La clasificacion read-only distingue, entre otros, `DB_ISSUED_CHAIN_ACTIVE`,
`DB_ISSUED_CHAIN_REVOKED`, `DB_REVOKED_CHAIN_REVOKED`,
`DB_REVOKED_CHAIN_ACTIVE`, `CHAIN_RECORD_MISSING`,
`DEPLOYMENT_UNRESOLVED`, `MOCK_UNSUPPORTED` y `LEGACY_UNRESOLVABLE`. Este
ultimo se usa para un record Anvil cuyo hash o registrante esperado ya no puede
correlacionarse tras un reset/redeploy. El orquestador hace
read -> write -> receipt exitoso -> re-read -> transaccion PostgreSQL;
nunca debe mantener una transaccion PostgreSQL abierta durante I/O blockchain.

`chainId` y direccion de contrato no identifican por si solos una instancia
Anvil reiniciada. La correlacion hash + registrante detecta el reset normal en
el que el registro esperado ya no existe; una reconstruccion byte-identica del
mismo registry y registro no puede distinguirse sin persistir una huella de
deployment/genesis adicional. Esa ampliacion de identidad requeriria revision
de arquitectura y schema antes de una futura politica multi-deployment.

El signer se obtiene exclusivamente de `CREDENTIAL_REGISTRY_PRIVATE_KEY` en
configuracion del servidor despues de resolver el deployment; `BlockchainRecord`
nunca selecciona un signer. Antes de escribir, la revocacion compara la
direccion derivada del signer con el registrante persistido/on-chain. El
contrato conserva la autorizacion final.

## Revocacion coordinada issuer-scoped

`POST /issuers/:issuerId/credentials/:credentialId/revoke` requiere JWT,
membership `admin`/`operator` activa e issuer autorizado. Nunca abre una
transaccion PostgreSQL durante I/O de cadena y solo permite una escritura on-chain
desde `DB_ISSUED_CHAIN_ACTIVE`. Confirma el resultado por relectura y persiste
`Credential` y el `BlockchainRecord` elegido como `revoked` en una transaccion
corta. `revokedAt` procede del timestamp que devuelve el contrato.

Si la cadena ya estaba revocada y PostgreSQL todavia marcaba `issued`, el
endpoint recupera el estado local sin enviar otra transaccion. Un `reason`
opcional se guarda solo cuando esta solicitud confirmo la escritura; un
reintento no puede adjudicarse una revocacion previa. Si perfil formativo falla
despues de la persistencia, el endpoint responde un codigo seguro reintentable;
la revocacion no se revierte.

`mock`, deployment no resuelto, record legacy/no correlacionable, signer no
autorizado y DB revocada con cadena activa fallan cerrados. No hay fallback a
una mutacion solo en DB ni consulta RPC en `/verify` publico.

Configuracion local:

- `CREDENTIAL_REGISTRY_RPC_URL`;
- `CREDENTIAL_REGISTRY_CONTRACT_ADDRESS`.
- `CREDENTIAL_REGISTRY_PRIVATE_KEY`.

Uso local:

```bash
npm run blockchain:status --workspace @credential-intelligence/api -- --hash 0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab
```

```bash
npm run blockchain:register --workspace @credential-intelligence/api -- --hash 0x1111111111111111111111111111111111111111111111111111111111111111
```

```bash
npm run blockchain:revoke --workspace @credential-intelligence/api -- --hash 0x1111111111111111111111111111111111111111111111111111111111111111
```

Notas de uso:

- `BLOCKCHAIN_EVIDENCE_MODE=mock` es el default, incluso si la variable no existe;
- `BLOCKCHAIN_EVIDENCE_MODE=credential_registry_anvil` activa registro on-chain local/dev;
- si `BLOCKCHAIN_EVIDENCE_MODE` tiene otro valor, el backend falla con error claro;
- si falta RPC URL, contract address o private key en contract mode, no hay fallback silencioso a mock;
- `blockchain:register` y `blockchain:revoke` son solo para Anvil/local-dev;
- no escriben en la base de datos;
- no crean `BlockchainRecord`;
- no se integran todavia con `POST /credentials/:id/issue`;
- el estado final de una credencial debe consultarse luego con `blockchain:status`;
- no hay Base Sepolia ni signer productivo en este slice.

Integracion con `BlockchainEvidenceService`:

- en `mock`, el comportamiento sigue siendo el actual: tx hash deterministico local y `BlockchainRecord` local;
- en `credential_registry_anvil`, el service llama a `registerCredential(bytes32)` mediante `CredentialRegistryWriteClient`;
- solo despues de una tx `success` se crea `BlockchainRecord` con `txHash` real de Anvil;
- no hay read-after-write obligatorio en el issue flow.

Riesgo conocido:

- DB transaction != blockchain transaction;
- si la tx on-chain sale bien y luego falla el write de `BlockchainRecord` en PostgreSQL, la blockchain no puede rollbackearse;
- para este slice local/dev se acepta esa limitacion, pero queda documentada como deuda tecnica para una estrategia futura de reconciliacion/idempotencia/outbox.

La salida se normaliza a tipos serializables:

```json
{
  "credentialHash": "0xaf032042c1bcfb72f9caac350eb3cb576f44ab07b1c1968f4b36264da44ff2ab",
  "exists": true,
  "revoked": true,
  "issuer": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "registeredAt": "1784382395",
  "revokedAt": "1784382462"
}
```

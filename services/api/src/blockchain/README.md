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
  codigo, no identidad del contrato (la identidad la prueba el manifest); el nonce
  es local al proceso (un solo escritor efectivo); y el migrator comparte tag con la API.
  (S8: la reconciliacion ya tiene invocacion de produccion --
  `POST /issuers/:issuerId/credentials/:credentialId/blockchain/reconcile` -- y busca
  con la estrategia de `reconciliation-log-scan.ts`: ubica por timestamp el bloque de la emision (el
  bloque de deploy del manifest es solo el piso), barre hacia adelante en ventanas que
  parten de 10.000 bloques y, si el proveedor rechaza el rango (HTTP 413 o equivalente),
  las achica a la mitad y reutiliza el tamano aprendido, con un tope de 1.000 pedidos.
  Un error de proveedor o un barrido incompleto nunca se informa como "no registrada":
  queda `CHAIN_UNAVAILABLE` y la fila sigue `pending`. Nunca retransmite.)

## Escritor unico (S8)

`AnchorWriteCoordinator` serializa por `SignerProfile.id` **dentro de UN proceso**.
No coordina dos tareas ECS. El repositorio lo mitiga limitando el despliegue de la API
a una tarea y evitando el solapamiento entre la tarea vieja y la nueva.

Lo que **declara el repositorio** (Terraform; no se verifico ningun estado vivo):

| Concepto | Valor declarado | Efecto sobre el escritor |
|---|---|---|
| `desired_count` del servicio de la API | `var.enable_services ? var.api_desired_count : 0` | Con los servicios habilitados, la cantidad sale de `api_desired_count`; con `enable_services = false`, 0. |
| `api_desired_count` | validado en `{0, 1}`, por defecto 1 | Regimen: a lo sumo **una** tarea de API deseada. |
| Autoscaling | no existe | No hay camino a mas de una tarea deseada. |
| `deployment_minimum_healthy_percent` / `deployment_maximum_percent` | `0 / 100` | **Sin solapamiento intencional** entre tarea vieja y nueva durante un reemplazo. |

Estado estable: `enable_services = true` y `api_desired_count = 1` equivalen a exactamente
**una** tarea de API deseada.

Despliegue: con `0 / 100`, ECS puede detener la tarea existente **antes** de que la
reemplazante este sana. Eso evita que dos procesos firmen a la vez con la misma cuenta de
anclaje (dos `NonceManager` independientes podrian elegir el mismo nonce y una transaccion
se reemplazaria o se perderia). Es, hoy, la mitigacion del repositorio para la
coordinacion de nonce local al proceso.

Costo: **disponibilidad por seguridad del escritor unico.** Un reemplazo puede dejar la API
temporalmente sin servicio, y si la tarea nueva no arranca la API queda no disponible; el
`deployment_circuit_breaker` con rollback puede restaurar la task definition anterior,
pero `0 / 100` no garantiza disponibilidad durante ese proceso. No se midio ninguna
duracion de indisponibilidad en vivo; el ALB tiene un drenaje configurado de
`alb_deregistration_delay_seconds` (900 s en el repositorio), que puede alargarla.

Lo que esto **no** es: no es exclusividad global. Scripts manuales, otras tareas o otras
maquinas con la misma clave quedan fuera de lo que Terraform puede garantizar.

**Decision de S8:** no se cambio ningun porcentaje ni `desired_count`. Para el E2E
controlado la compuerta operativa es: despliegue `COMPLETED`, `desiredCount = 1`,
`runningCount = 1`, `pendingCount = 0`, una sola tarea de API y ninguna emision concurrente
durante la ventana de prueba. Para uso sostenido sigue pendiente una decision de
arquitectura (coordinacion de nonce entre procesos o una politica de recuperacion de
`pending`); no se resuelve aqui.

Responsabilidad vigente:

- persistencia y consulta de `BlockchainRecord`;
- administración de evidencia técnica, sin decidir las reglas de emisión de
  credenciales;
- modo `mock` separado, sin I/O de red;
- modo `credential_registry` con red explícita `anvil` o `base_sepolia`;
- preflight de red y contrato antes de escritura;
- registro, revocación, lectura y reconciliación record-bound;
- clientes `ethers` encapsulados y coordinación por perfil de firma de anclaje.

El modo real requiere `CREDENTIAL_REGISTRY_NETWORK`,
`CREDENTIAL_REGISTRY_CHAIN_ID`, `CREDENTIAL_REGISTRY_RPC_URL`,
`CREDENTIAL_REGISTRY_CONTRACT_ADDRESS` y `CREDENTIAL_REGISTRY_DEPLOYMENT_ID`.
Una configuración incompleta o incompatible falla cerrada y no degrada a
`mock`. La existencia del manifiesto Base Sepolia no activa esas variables ni
confirma su valor efectivo en runtime.

`CREDENTIAL_REGISTRY_PRIVATE_KEY` queda limitado a las CLI locales. El runtime
usa el perfil de firma de anclaje del emisor; el navegador nunca firma ni recibe
secretos.

PostgreSQL y la cadena no comparten una transacción atómica. Antes de escribir
en la red, el servicio persiste un intento `pending`; la escritura y su
confirmación ocurren después del commit. Si el envío falla o el comprobante no
queda disponible, no se revierte la credencial ni se reenvía automáticamente:
el intento permanece pendiente para su reconciliación. Solo una evidencia
confirmada actualiza el registro a `registered`.

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

- `BLOCKCHAIN_EVIDENCE_MODE=mock` es el default cuando la variable falta;
- `BLOCKCHAIN_EVIDENCE_MODE=credential_registry` habilita el mecanismo real y
  exige una red explícita `anvil` o `base_sepolia`;
- el valor legado `credential_registry_anvil` se rechaza;
- las CLI `blockchain:status`, `blockchain:register` y `blockchain:revoke` son
  herramientas locales y no crean `BlockchainRecord`;
- el flujo de emisión y la revocación issuer-scoped usan servicios de registro
  y reconciliación propios, con persistencia de intención antes de la escritura.

La operación contra una cadena no forma parte de la transacción de dominio. Si
la escritura o su confirmación falla, el registro queda pendiente o se
reconcilia; nunca se presenta como evidencia on-chain confirmada sin lectura
del contrato.

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

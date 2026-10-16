# Activacion de Base Sepolia en produccion (S8) -- runbook

> Estado: **el repositorio esta listo; produccion sigue en `mock`**. Este documento
> ordena la activacion posterior. Ningun paso se ejecuta por un despliegue comun.

Objetivo del primer E2E: **UNA** credencial `course` emitida por
`055bb876-b98d-4925-a38c-e7e65aeea535`, anclada en Base Sepolia (`84532`) en
`0xCb7401e268f61b1242B17fE141453471CFbdc6e1`.

## Dos compuertas independientes

| Compuerta | Que controla | Donde |
|---|---|---|
| **A** | Si la task definition de la API *referencia* el secreto del RPC (y su execution role puede leerlo). | variable de Terraform `blockchain_evidence_mode` en el `terraform.tfvars` del operador (no versionado). |
| **B** | Si la API *opera* en `credential_registry`. | valor SSM `/scope/prod/api/BLOCKCHAIN_EVIDENCE_MODE` (Terraform lo ignora despues de crearlo). |

Mientras **B** valga `mock`, la API emite con evidencia simulada. **Emitir una
credencial real en `mock` crea evidencia irreversible**: no existe re-anclaje.

## FASE 1 -- capacidad, produccion en mock

1. Imagen de la API con este cambio (incluye `contracts/deployments/base-sepolia-*.json`).
2. Migraciones al dia (`prisma migrate deploy` via el migrator). Confirmar el head.
3. Plan **de revision** de Terraform; confirmar que NO contiene cambios de AI ni del
   Sync Probe no aprobados. Cambios esperados para la API: politica
   `api_task_signers`, `SIGNER_SECRET_REF_PREFIX`, secrets `CREDENTIAL_REGISTRY_*`
   (4 parametros String `unset`, **nuevos respecto al estado vivo**) y la dependencia del
   servicio de la API de esos parametros y de la politica del execution role.
4. Apply aprobado por separado.
5. Verificar: servicio 1/1 estable, task role con `api-task-signers`, `/health` 200.

## FASE 2 -- activacion explicita

Solo si la Fase 1 esta verificada y no hay emisiones ni despliegues en curso.

1. Crear **fuera de banda** la SecureString `/scope/prod/api/CREDENTIAL_REGISTRY_RPC_URL`
   (clave `alias/aws/ssm`). Terraform nunca la crea ni conoce su valor.
2. Cargar en SSM (String) los valores **publicos** del manifest:
   - `CREDENTIAL_REGISTRY_NETWORK = base_sepolia`
   - `CREDENTIAL_REGISTRY_CHAIN_ID = 84532`
   - `CREDENTIAL_REGISTRY_CONTRACT_ADDRESS = 0xCb7401e268f61b1242B17fE141453471CFbdc6e1`
   - `CREDENTIAL_REGISTRY_DEPLOYMENT_ID = base-sepolia-84532-0xcb7401e268f61b1242b17fe141453471cfbdc6e1`
   Comprobar con `npm run blockchain:check-target` (compara contra el manifest).
3. **Compuerta A**: `blockchain_evidence_mode = "credential_registry"` en el tfvars
   local, plan de revision y apply. Con el secreto del paso 1 ya creado: si no
   existiera, ECS no podria resolver el secreto y el despliegue fallaria.
4. Validacion previa (ver abajo) en `mock` todavia.
5. **Compuerta B**: poner `BLOCKCHAIN_EVIDENCE_MODE = credential_registry` en SSM y
   forzar un despliegue nuevo (el secreto se resuelve al arrancar la tarea).
6. Confirmar estable 1/1 y que no hay otro despliegue.

## Orden de dependencias del arranque de secretos (verificado contra el repositorio)

Invariante: **ECS nunca debe lanzar una tarea cuya task definition referencia un
parametro SSM que no existe o que su execution role no puede leer.** ECS resuelve los
`secrets` al ARRANCAR cada tarea, no al registrar la task definition.

| Pieza | Quien la decide | Cuando se resuelve |
|---|---|---|
| Referencia al RPC en la task definition + permiso `ssm:GetParameters` del execution role | variable Terraform `blockchain_evidence_mode` (compuerta A) | al `apply` |
| Existencia de la SecureString del RPC | **operador, fuera de banda** | al arrancar la tarea |
| Valor del modo que la API lee | parametro SSM `BLOCKCHAIN_EVIDENCE_MODE` (compuerta B) | al arrancar la tarea |
| Parametros `CREDENTIAL_REGISTRY_*` | Terraform los crea en `unset`; el operador carga los valores | al arrancar la tarea |

Detalles que importan:

- `blockchain_evidence_mode` SOLO cablea la referencia y el permiso. El valor SSM existente
  **no cambia** al aplicar (`ignore_changes = [value]`): aplicar la compuerta A con la
  variable en `credential_registry` deja el modo operativo en `mock`. Ese es el paso 3 de
  abajo, y es seguro.
- **El primer apply de un entorno NUEVO debe hacerse con `mock`**: el parametro se crea con
  el valor de la variable, y crearlo ya en `credential_registry` activaria el modo real.
  Produccion ya tiene el parametro en `mock`, asi que no aplica.
- El servicio de la API declara `depends_on` de `aws_ssm_parameter.managed_strings` y de
  `aws_iam_role_policy.execution`: en un mismo apply, los parametros nuevos y el permiso
  existen **antes** de que el despliegue lance tareas. (Antes de S8 no habia esa dependencia.)
- Terraform **no puede** comprobar que la SecureString del RPC existe sin copiar su valor
  al estado, y eso esta prohibido. Por eso el orden es operativo: crear el secreto ANTES
  del apply de la compuerta A. Red de seguridad: el servicio usa 100/200 con
  `deployment_circuit_breaker { rollback = true }`; si la tarea nueva no arranca, la vieja
  sigue sirviendo y el despliegue revierte.
- Si luego se vuelve a `mock` en Terraform pero SSM sigue en `credential_registry`, la API
  queda sin RPC y **falla cerrada** (`BLOCKCHAIN_TARGET_CONFIG_INVALID`); nunca degrada a mock.

Secuencia segura completa:

1. **Fase 1**: desplegar codigo + IAM de signers con produccion en `mock` (pasos de arriba).
   Resultado: tarea sana, modo `mock`, ninguna escritura real posible.
2. Crear la SecureString del RPC fuera de banda y cargar los 4 valores publicos del target.
   (Todavia no hay ninguna task definition activa que la referencie.)
3. **Compuerta A**: apply con `blockchain_evidence_mode = "credential_registry"`. La nueva
   task definition inyecta el RPC existente; el modo SSM sigue en `mock`.
4. Verificar que la tarea nueva arranco, `desiredCount = runningCount = 1` y `/health` 200.
5. Validacion de solo lectura (abajo): salud de red, identidad del contrato, saldo.
6. **Compuerta B**: poner SSM `BLOCKCHAIN_EVIDENCE_MODE = credential_registry` solo si todas
   las compuertas pasaron.
7. **Reiniciar la tarea** (`force-new-deployment`): el modo SSM se inyecta al arrancar; sin
   reinicio la API sigue en `mock`.

## Validacion antes de emitir (todo de solo lectura)

- `POST /issuers/:issuerId/technical-identity/network-health`: cadena 84532, codigo
  en el contrato, cuenta de anclaje **fondeada**.
- Identidad del contrato: la presencia de bytecode NO prueba el contrato correcto.
  Comparar el bytecode runtime con `runtimeBytecodeHash` del manifest y probar
  `getCredentialStatus` con un hash conocido.
- ECS: `desiredCount = 1`, `runningCount = 1`, `pendingCount = 0`, un solo
  despliegue `PRIMARY/COMPLETED`.
- Un usuario institucional con membership activa y un titular activo.

## Una emision

1. Crear el draft `course`; emitir. Una sola vez.
2. Capturar `txHash`, bloque y estado del detalle del issuer.
3. Si el registro queda `pending`: `POST .../blockchain/reconcile`. **No reenviar.**
4. Verificar con `GET /verify/credentials/:id` (`VERIFIED`) y, con el contenido del
   titular, con `docs/blockchain/independent-verification.md`.
5. La prueba de manipulacion se hace sobre una copia en memoria (script) o con los
   tests; nunca sobre filas reales.

## Un solo escritor

El nonce y la cola del ancla viven en el proceso. Durante la prueba: ningun otro
despliegue ni emision concurrente. Ver el analisis de `0/100` vs `100/200` en
`services/api/src/blockchain/README.md`.

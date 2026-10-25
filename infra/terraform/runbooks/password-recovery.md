# Runbook — Recuperación de contraseña en AWS (Scope)

**Estado de este documento: PREPARADO, NO EJECUTADO.** Reescrito en la Etapa 5.2 para el entorno **real**:
AWS está **encendido y sirviendo** (no hay "capacidad cero"). Nada de lo que sigue se corrió contra AWS.
La funcionalidad **no está desplegada ni activada**.

Raíz Terraform: `infra/terraform/prod/` · Tests: `infra/terraform/prod/tests/` · Guarda previa al plan:
`infra/terraform/guards/` · Reconciliación de entradas: `infra/terraform/reconciliation/`.

> ## Cómo se integra y se publica (dos PR) — decisión aprobada
> - **PR-A (este):** API, migración PostgreSQL, Terraform, documentación, guardas y pruebas. **No contiene `apps/web`.**
>   Al mergearlo, Vercel debe omitir el deploy (*"Skipped – Not affected"*): **verificarlo en los checks de la PR antes de
>   mergear** (la excepción posible es el `package-lock.json` raíz). Con PR-A solo se publica la API con
>   `MAIL_TRANSPORT=disabled`; el enlace "¿Olvidaste tu contraseña?" **no** aparece.
> - **PR-B (frontend, exclusivamente `apps/web`):** se mergea **dentro de la ventana de activación** (§10), **después** de
>   la API y **antes** de habilitar el envío real de correo.
> - Estado de validación de infraestructura (25-oct-2026): **Plan A** (`origin/main`, `986a8c1`) = `No changes`; **Plan B**
>   (integrado, recuperación `disabled`) = solo reemplazo de la task definition de la API (4 variables) y actualización del
>   servicio, aceptado por `plan-acceptance --mode integrated`. Ambos planes se hicieron sobre `986a8c1` / el código integrado de entonces.
>   Desde entonces `origin/main` avanzó (hoy `6d429f6`, PR #149: app móvil y **un `GET` autenticado aditivo de Profile Sharing** en
>   `services/api/src/profile-sharing`; sin cambios en `infra/`, `.github/`, `prisma/` ni en el lockfile). Por eso la imagen de API
>   que se publique **incluirá también ese endpoint** (no es «solo Password Recovery»; usa tablas y permisos que la API desplegada
>   ya usa con el `PUT` existente: sin migración ni grants nuevos). Tras el merge hay que **repetir** el plan en un árbol limpio
>   del SHA mergeado (§9). Nada de esto autoriza un `apply`.

> ## ADVERTENCIA 1 — NUNCA ejecutar el paso `seed` contra producción
> `prisma/seed.ts` (y `seed-course-platform-user.ts`) hacen `authCredential.upsert` con
> `update: { passwordHash: hash(<contraseña demo conocida>) }` para el administrador UADE, el titular demo
> y el usuario de plataforma de cursos. **Ejecutarlo repone contraseñas conocidas** (y revierte cualquier
> cambio posterior, como el del 22-oct). El paso `seed` del workflow **no forma parte** del despliegue de
> recuperación y **no debe ejecutarse** contra producción. `verify` (`db:verify-demo`) solo lee. Este
> runbook no reemplaza el seed ni lo modifica: solo corrige el procedimiento.
>
> ## ADVERTENCIA 2 — Cada cambio de la task definition de la API es un CORTE
> La API se despliega **0/100** (`minimumHealthyPercent=0`, `maximumPercent=100`) con **una** tarea: la
> tarea vieja se **detiene antes** de que arranque la nueva. Es deliberado (el coordinador de nonce de
> blockchain es local al proceso: no puede haber dos escritores). **No se modifica 0/100 para evitar el
> corte.** Cada `apply` que cambie esa task definition (imagen, variables de entorno, secretos) exige
> una **ventana planificada** y pruebas posteriores.
>
> ## ADVERTENCIA 3 — No usar el `terraform.tfvars` local viejo
> Está fechado el 2026-10-11; el último `apply` fue el 2026-10-22. Con ese archivo un `apply` apagaría API
> e IA, devolvería imágenes anteriores, dejaría CORS vacío y cambiaría blockchain. Usar siempre la
> guarda (§3) y la reconciliación (`infra/terraform/reconciliation/`).

---

## 0. Cómo leer los comandos

Cada bloque lleva una etiqueta. **Sin etiqueta, no lo ejecutes.**

| Etiqueta | Significado |
|---|---|
| `[SOLO LECTURA]` | No modifica nada, ni en AWS ni en la base. Puede repetirse. |
| `[REQUIERE APROBACIÓN HUMANA — MODIFICA AWS]` | Cambia recursos AWS (apply, update-service, put-parameter…). Lo revisa y lo ejecuta una persona. |
| `[REQUIERE APROBACIÓN HUMANA — MODIFICA LA BASE]` | Escribe en PostgreSQL (migraciones, grants, UPDATE). |
| `[REQUIERE APROBACIÓN HUMANA — IRREVERSIBLE]` | No se puede deshacer o afecta a todas las personas usuarias (p. ej. rotar `JWT_SECRET`). |

Los comandos asumen `bash` (Git Bash o WSL en Windows) y la región `us-east-1`.

---

## 1. Estado real y qué es permanente

**Observado el 24-oct-2026 (solo lectura; puede haber cambiado — releerlo antes de actuar):**

| Elemento | Observación |
|---|---|
| Cluster | `scope-prod-cluster`, ACTIVE |
| API (`scope-prod-api`) | desired **1** / running **1**; task def `:11`; imagen `scope/api:<tag actual de la API>` (**anterior a la recuperación**: no verifica `sv`, no tiene la migración) |
| IA (`scope-prod-ai`) | desired **1** / running **1**; task def `:7`; imagen `scope/ai:<tag actual de la IA>` |
| Despliegue de la API | **0/100**, circuit breaker `enable=true, rollback=true`; el último rollout está `COMPLETED` |
| Migrador | última revisión ACTIVA `:8`, imagen `scope/api:<tag actual del migrador>` (**sin** la migración de recuperación). La `:7` (imagen por digest, usada por el workflow de admin) sigue ACTIVA |
| Provisioner / sonda ECS | `scope-prod-provisioner:1` (por digest) y el log group de la sonda existen: **ya están aplicados** |
| RDS `scope-prod-db` | `available`, `db.t4g.micro`, PG 16, Single-AZ, protección contra borrado **activa** |
| ALB | activo; 443 HTTPS → forward; 80 → redirect; **`xff_header_processing.mode = append`** |
| Certificado ACM | `api.scopeedu.technology`, **ISSUED**, en uso |
| DNS de la API | `api.scopeedu.technology` → **CNAME al ALB** (DNS externo; **no** lo gestiona Terraform) |
| Web | **`https://scopeedu.technology`** (Vercel); `/reset-password` hoy da **404** (frontend de recuperación no publicado) |
| Salud | `GET https://api.scopeedu.technology/health` → 200; preflight CORS con ese origen → OK |
| Esquema de recuperación | **No migrado** en producción (tabla `PasswordResetToken` y columna `sessionVersion` no existen), salvo evidencia posterior |
| Resend | **No configurado**: sin cuenta/dominio/clave; no existe `/scope/prod/api/RESEND_API_KEY` |
| Blockchain | `BLOCKCHAIN_EVIDENCE_MODE = credential_registry`, la API referencia `CREDENTIAL_REGISTRY_RPC_URL` |

**Condiciones permanentes (de diseño, no de una fecha):** la API es 0/100; el migrador tiene
`migrator_image_tag` obligatorio y sin fallback; el provisioner se referencia por digest; la capacidad la
gobierna Terraform (`enable_services`), y `scope-on/off.ps1` pueden desviarla; el limitador por IP es por
task; solo `/auth/password-reset/request` responde 503 cuando el correo está deshabilitado.

---

## 2. Matriz de configuración de producción

| Valor | Dónde | Valor | Estado |
|---|---|---|---|
| Origen de Scope Web | Vercel | `https://scopeedu.technology` | **Confirmado** (sirve; está en el `WEB_ORIGIN` desplegado) |
| Origen de la API | `api_hostname` | `https://api.scopeedu.technology` | **Confirmado** (DNS, certificado y `/health`) |
| `WEB_ORIGIN` (CORS) | `web_origin` | `https://scopeedu.technology` | Confirmado **en AWS**; debe estar **explícito** en el tfvars que se use (el viejo lo tiene vacío) |
| `WEB_PUBLIC_BASE_URL` | `web_public_base_url` | vacío hasta activar; al activar, `https://scopeedu.technology` | Pendiente de activación (distinto de `WEB_ORIGIN` aunque coincida el valor) |
| `NEXT_PUBLIC_API_BASE_URL` | Vercel (variable pública, de build) | esperado `https://api.scopeedu.technology` | **No verificado** el valor en Vercel (la web funciona contra la API) |
| `MAIL_TRANSPORT` | `mail_transport` | `disabled` | `log` rechazado por Terraform |
| `MAIL_FROM` | `mail_from` | `Scope <no-responder@mail.scopeedu.technology>` | **Propuesto**; el dominio **no** está verificado |
| `TRUST_PROXY_HOPS` | `locals.tf` (fijo) | `1` | Justificado (§5) |
| `RESEND_API_KEY` | SSM SecureString `/scope/prod/api/RESEND_API_KEY` | — | **No existe**; solo se referencia con `mail_transport = "resend"` |

`WEB_ORIGIN` (lista de CORS), `WEB_PUBLIC_BASE_URL` (dónde abre el enlace del correo) y
`NEXT_PUBLIC_API_BASE_URL` (dónde encuentra la web a la API) son tres cosas distintas; **no se unifican**.

---

## 3. Guarda previa al plan (obligatoria antes de CUALQUIER `plan`/`apply`)

```bash
# [SOLO LECTURA]  (node >= 20; solo emite operaciones AWS de lectura de una lista cerrada)
node infra/terraform/guards/pre-plan-guard.mjs \
  --tfvars infra/terraform/prod/terraform.tfvars \
  --tfvars infra/terraform/prod/ecs_sync_probe.auto.tfvars \
  --profile <perfil>
```

Pasá **los mismos archivos que usará Terraform**, en su orden de carga (el último gana).

- **Lee solo:** `sts get-caller-identity`, `ecs describe-clusters/services/task-definition` y **un**
  parámetro SSM de tipo `String` (modo de blockchain) sin descifrado. No recupera secretos, no corrige nada.
- **Compara:** región/cluster; desired/running/pending de API e IA contra lo que Terraform impondría
  (`enable_services ? N : 0`); imagen efectiva de API, IA, migrador (última revisión ACTIVA) y provisioner;
  despliegue de la API **0/100**; `WEB_ORIGIN`; flags de embeddings; modo y secreto RPC de blockchain; y, si ya
  están desplegadas, las variables de recuperación.
- **Fail-closed:** exit `0` solo si nada material difiere; `1` si hay diferencias; `2` si no pudo comprobar
  (variable obligatoria ausente, permiso denegado, formato, cluster/región/identidad incorrectos). Con `1` o `2`
  **no se ejecuta `terraform apply`**.
- **Qué NO es:** un plan. `0` **no** significa "cero cambios": el plan completo se revisa siempre línea por línea.

---

## 4. Qué cambió en Terraform (resumen, sobre `origin/main`)

| Cambio | Archivo | Efecto |
|---|---|---|
| Variables `mail_transport`, `mail_from`, `web_public_base_url`, `enable_recovery_alarms`, `recovery_alarm_action_arns` | `variables.tf` | Defaults seguros: recuperación **deshabilitada**, alarmas **apagadas** |
| `api_mail_secret_parameters` (condicional) | `locals.tf` | `RESEND_API_KEY` entra a la task definition **solo** con `mail_transport = "resend"` y con él el permiso de ARN exacto del *execution role* de la API |
| Variables de entorno de la API: `WEB_PUBLIC_BASE_URL`, `MAIL_TRANSPORT`, `MAIL_FROM`, `TRUST_PROXY_HOPS=1` | `locals.tf` | Solo la API (no IA, migrador ni provisioner) |
| Preconditions de la task definition de la API | `ecs.tf` | `resend` exige `web_public_base_url` y `web_origin` (falla en `plan`) |
| `xff_header_processing_mode = "append"` fijado | `alb.tf` | Ya es el valor real (observado); evita cambios silenciosos |
| Alarmas de CloudWatch preparadas (apagadas) | `recovery_alarms.tf` | Sin recursos mientras `enable_recovery_alarms = false` |
| Output `password_recovery_configuration` | `outputs.tf` | Estado de activación; nunca un secreto |

**No cambió:** `migrator_image_tag` (se **conserva el diseño de `origin/main`**: obligatoria, sin default, sin
fallback), `provisioner_image_digest`, la sonda ECS, el despliegue 0/100, IAM, security groups, RDS, DNS,
blockchain, bootstrap, SQL, workflows. El *task role* de la API **no** recibe permisos nuevos.

> Consecuencia: **el primer despliegue de esta funcionalidad cambia la task definition de la API** (variables
> nuevas) ⇒ **corte** (ADVERTENCIA 2), incluso con la recuperación deshabilitada.

---

## 5. `TRUST_PROXY_HOPS=1`

Cadena real: `Internet → ALB (única entrada 0.0.0.0/0) → tarea de la API:3000`. El security group de la API
admite entrada **solo** del security group del ALB; no hay CloudFront/WAF ⇒ **un** salto. El ALB está en
`append` (**observado**): agrega la dirección desde la que recibió la conexión a `X-Forwarded-For`; con
`trust proxy = 1` Express usa la entrada **más a la derecha** (la del ALB) e ignora lo que escriba el cliente.
`preserve` haría la IP falsificable; `remove` haría que todos compartan la IP del ALB; `0` y `2+` fallan en
sentidos opuestos. Es un valor **fijo** (propiedad de la topología) protegido por tests.

Límite: el contador por IP es **en memoria y por tarea** (hoy 1 tarea).

```bash
# [SOLO LECTURA]
aws elbv2 describe-load-balancer-attributes \
  --load-balancer-arn "$(aws elbv2 describe-load-balancers --names scope-prod-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text)" \
  --query "Attributes[?Key=='routing.http.xff_header_processing.mode']"
# esperado: "Value": "append"
```

---

## 6. Migración antes del despliegue (el riesgo principal)

### 6.1 Compatibilidad real

| Combinación | Resultado |
|---|---|
| API anterior + esquema nuevo | Compatible (la migración es **aditiva**: una columna con DEFAULT constante y una tabla) |
| API nueva + esquema nuevo | Compatible |
| **API nueva + esquema anterior** | **No compatible**: `resolveAuthenticatedUser` lee `AuthCredential.sessionVersion` en **cada** request autenticado; toda ruta protegida devuelve 500 y `/auth/me` deja de andar |

Orden obligatorio: **migrar primero, desplegar la API después**.

### 6.2 El migrador con tag obligatorio (diseño de `origin/main`)

`migrator_image_tag` es **obligatoria**, **sin default** y **sin fallback** a `api_image_tag`: mover un tag
nunca mueve el otro. `run-production-migrator.yml` lanza `--task-definition scope-prod-migrator` **sin fijar
revisión** (usa la **última ACTIVA**; hoy `:8`, imagen `<tag actual del migrador>`, que **no** contiene la migración de
recuperación). Por lo tanto:

- Hay que **publicar una revisión nueva del migrador con la imagen nueva** antes de correr `migrate`.
- **Después de migrar, `migrator_image_tag` se queda en esa imagen**: no se "restablece" ni se vacía (vacía
  falla el `plan` por diseño). El próximo despliegue lo sube **explícitamente** otra vez.

### 6.3 GATE obligatorio: comprobar la imagen efectiva ANTES de migrar

Un migrador con imagen vieja ejecuta `migrate deploy`, informa *"already in sync / up to date"* y **no
significa nada**: el esquema nuevo no se aplicó. **Ese mensaje nunca autoriza publicar la API nueva.**

```bash
# [SOLO LECTURA] 1) la ultima revision ACTIVA usa el tag esperado
aws ecs describe-task-definition --task-definition scope-prod-migrator \
  --query 'taskDefinition.{revision:revision,status:status,image:containerDefinitions[?name==`migrator`].image|[0]}'
#    -> el tag de `image` DEBE ser el SHA publicado (TAG_NUEVO). Si no: DETENER.
```

```bash
# [SOLO LECTURA] 2) la migracion esperada esta DENTRO de esa imagen (ls en una tarea del migrador)
NETCFG='awsvpcConfiguration={subnets=[subnet-075ecbc2b61716fef,subnet-0d58aa21130801c05],securityGroups=[sg-0b7284f9025ac2749],assignPublicIp=ENABLED}'
OVR='{"containerOverrides":[{"name":"migrator","command":["ls","prisma/migrations"]}]}'
# (mismo run-task / wait / get-log-events de §6.4; ver abajo) y buscar en la salida:
#    20261023120000_add_password_reset_token_and_session_version
```

(Los ids de subredes y del security group salen de `run-production-migrator.yml`; confirmar con
`terraform output public_subnet_ids security_group_ids`. `run-task` con un `command` distinto **no modifica**
nada: el `ls` y el `migrate status` son lecturas.)

### 6.4 Ejecutar con la identidad correspondiente

Las migraciones y los grants corren como **`scope_admin`** (credencial maestra de RDS inyectada solo al
migrador desde Secrets Manager); la API corre como `scope_app`. No hay otra forma sancionada.

```bash
# [SOLO LECTURA] estado de migraciones (lista pendientes; no aplica nada)
OVR='{"containerOverrides":[{"name":"migrator","command":["npx","prisma","migrate","status","--schema","prisma/schema.prisma"]}]}'
TASK_ARN="$(aws ecs run-task --cluster scope-prod-cluster --task-definition scope-prod-migrator \
  --launch-type FARGATE --network-configuration "$NETCFG" --overrides "$OVR" \
  --query 'tasks[0].taskArn' --output text)"
aws ecs wait tasks-stopped --cluster scope-prod-cluster --tasks "$TASK_ARN"
aws logs get-log-events --log-group-name /scope/prod/migrator \
  --log-stream-name "ecs/migrator/${TASK_ARN##*/}" --query 'events[].message' --output text
```

Secuencia: **`status` → `migrate` → `status`**.

1. `status` **antes**: debe listar como **pendiente** `…add_password_reset_token_and_session_version` (y solo
   las que esperás). Si no la lista, la imagen **no** la contiene: DETENER.
2. `migrate`: GitHub → Actions → **Run production migrator** → `step = migrate`.
   `[REQUIERE APROBACIÓN HUMANA — MODIFICA LA BASE]` (DDL aditivo).
3. `status` **después**: debe decir *"Database schema is up to date!"* **y** el recuento de migraciones debe
   incluir la nueva (25 en esta base). Solo con ambas cosas el gate se considera pasado.

### 6.5 Grants sobre la tabla nueva

`infra/terraform/sql/02-grant-scope-app-on-existing-objects.sql` sigue siendo el mecanismo (idempotente; su
encabezado exige correrlo tras cada lote de migraciones y **antes** de que el código nuevo salga).
GitHub → **Run production migrator** → `step = 02`. `[REQUIERE APROBACIÓN HUMANA — MODIFICA LA BASE]`.

El `GRANT` es **por tabla**: `scope_app` no tiene privilegios sobre `PasswordResetToken` salvo que los
`ALTER DEFAULT PRIVILEGES` de `01` ya existieran al crearla o que corras `02`. Si se omite, la API arranca
"sana", login y `/auth/me` funcionan, pero `POST /auth/password-reset/request` falla en la base **después**
de responder `202` y solo deja `request.failed` en el log: fallo silencioso.

### 6.6 Verificar esquema y permisos

```bash
# [SOLO LECTURA] corre como scope_admin y pregunta por los privilegios de scope_app
SQL='SELECT
  has_table_privilege($$scope_app$$, $$public."PasswordResetToken"$$, $$SELECT$$)  AS prt_select,
  has_table_privilege($$scope_app$$, $$public."PasswordResetToken"$$, $$INSERT$$)  AS prt_insert,
  has_table_privilege($$scope_app$$, $$public."PasswordResetToken"$$, $$UPDATE$$)  AS prt_update,
  has_table_privilege($$scope_app$$, $$public."PasswordResetToken"$$, $$DELETE$$)  AS prt_delete,
  has_table_privilege($$scope_app$$, $$public."PasswordResetToken"$$, $$TRUNCATE$$) AS prt_truncate,
  has_table_privilege($$scope_app$$, $$public."AuthCredential"$$, $$UPDATE$$)      AS cred_update,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = $$AuthCredential$$ AND column_name = $$sessionVersion$$) AS session_version_column,
  has_table_privilege($$scope_app$$, $$public._prisma_migrations$$, $$SELECT$$)    AS migrations_readable;'
OVR="$(jq -cn --arg sql "$SQL" '{containerOverrides:[{name:"migrator",command:["psql","-v","ON_ERROR_STOP=1","-x","-c",$sql]}]}')"
# …mismo run-task / wait / logs que arriba con "$OVR"
```

Esperado (cualquier otra cosa **bloquea** el despliegue de la API): `prt_select/insert/update/delete = t`,
`prt_truncate = f`, `cred_update = t`, `session_version_column = t`, `migrations_readable = f`.
(Este SQL se ensayó en esta etapa contra un PostgreSQL descartable con los scripts `01`/`02` reales.)

### 6.7 Snapshot, prechequeos de bloqueo y qué hacer si `migrate` falla

**Snapshot de RDS (recuperación ante desastre, NO rollback).** `[REQUIERE APROBACIÓN HUMANA — MODIFICA AWS]`, antes de migrar,
en la franja de baja actividad (en Single-AZ puede suspender la E/S unos instantes), con una identidad que tenga
`rds:CreateDBSnapshot`, `rds:DescribeDBSnapshots` y `rds:AddTagsToResource` (el rol de planificación **no** las tiene):
```bash
aws rds create-db-snapshot --db-instance-identifier scope-prod-db \
  --db-snapshot-identifier scope-prod-db-pre-pwreset-<AAAAMMDD-HHMM> \
  --tags Key=Purpose,Value=pre-password-recovery-migration --profile <perfil de escritura>
aws rds wait db-snapshot-available --db-snapshot-identifier scope-prod-db-pre-pwreset-<AAAAMMDD-HHMM> --profile <perfil>
# [SOLO LECTURA] Status=available, PercentProgress=100, SnapshotType=manual, mismo cifrado y versión de motor que la instancia
aws rds describe-db-snapshots --db-snapshot-identifier scope-prod-db-pre-pwreset-<AAAAMMDD-HHMM> \
  --query "DBSnapshots[0].{Status:Status,Progress:PercentProgress,Type:SnapshotType,Encrypted:Encrypted,Version:EngineVersion,Created:SnapshotCreateTime}" --profile <perfil>
```
**Restaurar un snapshot crea OTRA instancia** (identificador y endpoint nuevos): **no** es un rollback inmediato. Se pierden las
escrituras posteriores al snapshot, hay que indicar grupos de seguridad/parámetros/subredes, apuntar API y migrador al endpoint
nuevo y conciliar Terraform (`aws_db_instance.main` cambia de identidad física: un plan posterior propondría reemplazarla).
Es recuperación ante un daño de datos; **el rollback de esta migración aditiva es desplegar la imagen anterior** (§12.2).

**Prechequeos** `[SOLO LECTURA]` (tarea del migrador con `psql`, como `scope_admin`), inmediatamente antes de `migrate`:
```sql
SHOW server_version;     -- >= 11 (ADD COLUMN con DEFAULT constante sin reescribir la tabla); esperado 16.x
SELECT current_user, current_setting('lock_timeout') AS lock_timeout, current_setting('statement_timeout') AS statement_timeout;
SELECT tablename, tableowner FROM pg_tables WHERE schemaname='public' AND tablename IN ('AuthCredential','User','_prisma_migrations');  -- dueño scope_admin
SELECT has_schema_privilege(current_user,'public','CREATE') AS can_create;
SELECT pid, state, now()-xact_start AS xact_age, wait_event_type, left(query,60) AS q FROM pg_stat_activity
 WHERE datname=current_database() AND xact_start IS NOT NULL AND pid<>pg_backend_pid() ORDER BY xact_start;  -- sin transacciones largas ni "idle in transaction"
SELECT count(*) FROM pg_prepared_xacts;  -- 0
```
**Bloqueo.** `ALTER TABLE "AuthCredential" ADD COLUMN … DEFAULT 0` toma `ACCESS EXCLUSIVE` unos milisegundos, pero **espera** a
cualquier transacción abierta sobre esa tabla y, mientras espera, **encola** las consultas siguientes (casi toda petición
autenticada lee `AuthCredential`): un bloqueador largo se vería como estancamiento de login/API, no como pérdida de datos. La FK
a `"User"` toma `SHARE ROW EXCLUSIVE` (bloquea escrituras en `User`, no lecturas) con la misma salvedad. Mitigación: los
prechequeos de arriba, franja de baja actividad y, **opcional y con aprobación** (cambia la configuración de la base),
`ALTER ROLE scope_admin SET lock_timeout = '5s'` justo antes y `ALTER ROLE scope_admin RESET lock_timeout` después. **No** se edita el
SQL de la migración (su test fija "exactamente seis sentencias" y su checksum).

**Si `prisma migrate deploy` falla.** El script corre en **una transacción**: se revierte completo y no queda esquema a medias,
pero Prisma deja la migración marcada *failed* en `_prisma_migrations` y los siguientes `migrate deploy` **se niegan a continuar**.
El workflow *Run production migrator* **no tiene paso `resolve`**. Procedimiento (con aprobación, por `run-task` con `command` explícito):
1. **No** desplegar la API. Leer el error en `/scope/prod/migrator` y confirmar que el esquema sigue siendo el anterior
   (`session_version_column = f`, sin la tabla `PasswordResetToken`).
2. Corregir la causa (típicamente un bloqueo: repetir los prechequeos).
3. `npx prisma migrate resolve --rolled-back 20261023120000_add_password_reset_token_and_session_version --schema prisma/schema.prisma`
   (`[REQUIERE APROBACIÓN HUMANA — MODIFICA LA BASE]`: toca solo `_prisma_migrations`).
4. Repetir `status` → `migrate` → `status` → `02` → verificación de privilegios (§6.4 a §6.6).
**Nunca** `migrate reset`, `db push` ni borrar filas de `_prisma_migrations` a mano.

---

## 7. Secuencia completa de despliegue (recuperación DESHABILITADA)

Principios: no interrumpir lo existente más de lo inevitable; no reducir capacidad; no publicar la API antes de
migrar; **no aplicar un plan no revisado**; Resend no se necesita.

### Fase 0 — Reconciliar (sin tocar AWS)
0. **Hecho el 25-oct-2026:** guarda `0`, Plan A (`No changes`) y Plan B aceptado (§ cabecera). Falta: PR-A mergeado y los planes
   repetidos sobre el SHA mergeado (§9). PR-A y PR-B son **dos** PR (la web no sale con PR-A).
1. Integrar el trabajo de recuperación con `origin/main` (rama de integración; commits los hace una persona).
2. Reconstruir el tfvars real a partir de `infra/terraform/reconciliation/prod.reconciled.tfvars.template`
   completando cada marcador `<...>` con evidencia (los valores reales no se versionan). **No** usar el `terraform.tfvars` viejo.
3. **Guarda (§3)** con esos archivos: debe dar `0`.
4. **Plan de línea base** (requiere autorización explícita de un `plan` remoto) sobre un worktree limpio de
   `origin/main` con las mismas entradas: lo ideal es `No changes.`. Cualquier otra cosa se **entiende y se
   resuelve** antes de seguir (ver `reconciliation/README.md`). Un `0` de la guarda **no sustituye** esto.

### Fase 1 — Construir la imagen
GitHub → **Publish production images** (despachar desde `main`; el SHA debe estar en `origin/main`;
`publish_ai = false` si solo cambió la API). `[REQUIERE APROBACIÓN HUMANA — MODIFICA AWS]`. Anotar:
```
TAG_NUEVO       = <sha publicado>            TAG_VIEJO = <tag de la imagen que corre la API hoy; leerlo de scope-prod-api y registrarlo antes de cambiar nada>
MIN_ROLLBACK_SHA = TAG_NUEVO  (la primera imagen que verifica sessionVersion; ver §12)
```
```bash
# [SOLO LECTURA]
aws ecr describe-images --repository-name scope/api --image-ids imageTag="$TAG_NUEVO" \
  --query 'imageDetails[0].{digest:imageDigest,pushed:imagePushedAt}'
```

### Fase 2 — Publicar el migrador SIN mover la API (sin corte)
Un `apply` completo desde el árbol integrado cambiaría también la task definition de la API (variables
nuevas) y **cortaría** la API sin ninguna ventaja. Para publicar **solo** el migrador:

- **Preferida (sin `-target`):** en el worktree **base** (un árbol **sin** los cambios de recuperación de Terraform, p. ej. el
  de `986a8c1` o de `6d429f6` —commits de `main` **sin** los cambios de Terraform de recuperación—; el árbol del SHA mergeado cambiaría también la task definition de la API y cortaría el servicio antes de
  migrar) fijar `migrator_image_tag = "<TAG_NUEVO>"` dejando `api_image_tag` y todo lo demás igual; **guarda**, `plan` y
  `apply` completos. El plan debe mostrar **únicamente** `aws_ecs_task_definition.migrator` con la imagen
  nueva, y se acepta con el verificador estricto (comando exacto en §10b):
  `node infra/terraform/guards/plan-acceptance.mjs --mode migrator-only --expected-image-tag <TAG_NUEVO> --plan plan.json`.
  `[REQUIERE APROBACIÓN HUMANA — MODIFICA AWS]`. Es una revisión nueva de una task definition que no es
  un servicio: **no hay corte**. Terraform **desregistra** la revisión anterior del migrador (`delete+create`, sin `skip_destroy`):
  queda `INACTIVE`; para volver atrás se fija otra vez el `migrator_image_tag` anterior (crea una revisión nueva).
- **Excepcional:** `terraform apply -target=aws_ecs_task_definition.migrator` desde el árbol integrado, solo si
  no hay worktree base. La documentación de Terraform lo desaconseja como práctica habitual: el plan acotado
  debe mostrar **un único recurso**, y después se hace un `plan` completo para ver lo pendiente. Un apply
  dirigido **no equivale** a uno completo.

Luego repetir el **GATE de §6.3** (imagen efectiva y migración dentro de la imagen).

### Fase 3 — Migrar, grants y verificación
Primero el snapshot y los prechequeos de §6.7; luego §6.4 (`status` → `migrate` → `status`), §6.5 (`02`), §6.6. Si `migrate`
falla: procedimiento de §6.7 (resolve), **no** desplegar la API. **No ejecutar `seed`.**

### Fase 4 — Desplegar la API nueva (VENTANA PLANIFICADA; con corte)
1. Avisar la ventana. Duración **no medida** (tarea vieja se detiene → tarea nueva arranca → 120 s de gracia de
   health check): medirla en el primer despliegue y registrarla. **Minutos antes del corte:** iniciar sesión con una cuenta propia en
   la API **actual** y guardar el JWT solo en memoria (vence en 1 h): se usa en S2b. Comprobar que no hay emisiones/anclajes
   blockchain en vuelo (la tarea saliente tiene hasta 120 s para terminar lo que esté en curso).
2. En el árbol **limpio del SHA mergeado**, con el tfvars reconciliado: `api_image_tag = "<TAG_NUEVO>"` y `migrator_image_tag = "<TAG_NUEVO>"`
   (**sin cambios** en este plan: ya se aplicó en la Fase 2); recuperación en sus defaults (`mail_transport = "disabled"`, sin
   `RESEND_API_KEY`, `web_public_base_url` vacío). **Guarda → `plan`**, aceptado con `--mode integrated --allow-api-image-change`
   más las comprobaciones previas de §10b (el flag no valida *qué* imagen).
3. Revisión del plan (§9). `[REQUIERE APROBACIÓN HUMANA — MODIFICA AWS]` `terraform apply <plan>`.
4. Smoke tests (§8), incluido **S2b**.

Si el rollout falla, el *circuit breaker* intenta volver a la revisión `:11` (V0, sin `sessionVersion`); hay corte hasta que esa vuelta
termine. **Limitación:** el `apply` desregistra la revisión `:11` (`delete+create` de la task definition): queda `INACTIVE`. Si ECS puede
o no relanzar una revisión desregistrada en un rollback automático **no está verificado**; el plan de vuelta **no debe depender de
ello**: el rollback fiable es manual por Terraform (`api_image_tag` anterior → guarda → plan → apply; otro corte, §12.2).
Antes de la primera activación es **seguro respecto de sesiones** (§12), pero se verifica igual (§8 S2/S2b).

### Fase 5 — Web (PR-B): solo dentro de la ventana de activación
La web **no** sale con PR-A. En la ventana de activación (§10), **antes** de habilitar el envío real de correo: mergear PR-B, esperar
el deploy de Production en Vercel y comprobar la privacidad de `/reset-password` **sobre el despliegue** (§11). Hasta ese momento el
enlace "¿Olvidaste tu contraseña?" no existe en producción.

### Fase 6 — Activar el correo (misma ventana coordinada; §10)
Solo tras la configuración externa y con PR-B publicada y verificada. Nueva revisión de la task definition ⇒ **otro corte planificado**.

---

## 8. Smoke tests (con la API nueva y la recuperación **deshabilitada**)

Asumen `API=https://api.scopeedu.technology` y una cuenta de pruebas. Ninguno envía correo.

| # | Qué | Esperado |
|---|---|---|
| S1 | `curl -sS -o /dev/null -w '%{http_code}\n' "$API/health"` `[SOLO LECTURA]` | `200` |
| S2 | login (abajo) | `200` y JWT **con claim `sv`** |
| S2b | `GET /auth/me` con el JWT **emitido por la API anterior** (guardado minutos antes del corte, §7 Fase 4), sin volver a iniciar sesión | `200`: un JWT sin `sv` vale mientras la cuenta esté en versión 0 (`legacy-token-compat*.test` lo cubre; esta es la prueba real) |
| S3 | `GET /auth/me` con ese token | `200` (lee `AuthCredential.sessionVersion`) |
| S4 | `POST /auth/password-reset/request` con un correo cualquiera | `503` `PASSWORD_RECOVERY_UNAVAILABLE` |
| S5 | `POST /auth/password-reset/verify` con un token inventado de 43 caracteres | **`400` `PASSWORD_RESET_TOKEN_INVALID`** (no `500`) |
| S6 | preflight CORS con `Origin: https://scopeedu.technology` | `204` + `access-control-allow-origin` |
| S7 | identidad del limitador (abajo) | ver abajo |
| S8 | `GET /me/profile/shares/<id inexistente>/verification-policy` **sin** token, y luego **con** un JWT propio (PR #149) | `401` sin token; con token `404` `SHARE_NOT_FOUND` (la autenticación con `sv` no cambia este endpoint; nunca devuelve el token del enlace) |

```bash
# S2/S3 — la contraseña nunca va en argv ni en el historial
read -rs SMOKE_PASS; read -r SMOKE_EMAIL; export SMOKE_PASS SMOKE_EMAIL
TOKEN="$(jq -cn '{email:env.SMOKE_EMAIL,password:env.SMOKE_PASS}' \
  | curl -sS -X POST "$API/auth/login" -H 'Content-Type: application/json' --data-binary @- | jq -r '.accessToken')"
unset SMOKE_PASS SMOKE_EMAIL
curl -sS -o /dev/null -w 'auth/me -> %{http_code}\n' -H "Authorization: Bearer $TOKEN" "$API/auth/me"
printf '%s' "$TOKEN" | python -c 'import sys,base64,json;p=sys.stdin.read().split(".")[1];p+="="*(-len(p)%4);print("sv =",json.loads(base64.urlsafe_b64decode(p)).get("sv"))'
```
```bash
# S4 y S5
curl -sS -w '\n%{http_code}\n' -X POST "$API/auth/password-reset/request" \
  -H 'Content-Type: application/json' -d '{"email":"nadie@example.com"}'
curl -sS -w '\n%{http_code}\n' -X POST "$API/auth/password-reset/verify" \
  -H 'Content-Type: application/json' -d '{"token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}'
```

**S5 es el test de permisos con la identidad operativa**: la API se conecta como `scope_app` y `verify` hace
un `findUnique` sobre `PasswordResetToken`. `400` con el código de token inválido ⇒ la consulta llegó a la
tabla y `scope_app` pudo leerla. Un `500` (y `permission denied` en `/scope/prod/api`) ⇒ falta el grant: §6.5.

**S7 — que el limitador distinga clientes** `[REQUIERE APROBACIÓN HUMANA — ocupa el cupo por IP 15 min]`.
`verify`/`confirm` comparten **20 solicitudes por 15 min por IP**; ese limitador solo protege los endpoints de
recuperación (con la recuperación sin activar, nadie más los usa), así que el riesgo de dejar a otros sin
servicio es bajo; igual conviene hacerlo en la ventana. (1) 21 `verify` desde tu red ⇒ la 21.ª da `429`;
(2) repetir variando `X-Forwarded-For`: **no** debe reiniciar el contador; (3) desde otra red, un `verify`
debe dar `400`, **no** `429` (si da `429`, todos comparten IP ⇒ `TRUST_PROXY_HOPS` quedó en `0`).

---

## 9. Qué revisar en el primer `plan` (y qué es inaceptable)

La guarda (§3) **no** reemplaza esta revisión.

**Plan de línea base (sin recuperación), sobre `origin/main` con el tfvars reconciliado:** idealmente
`No changes.`. Todo cambio se explica antes de seguir.

**Plan del árbol integrado con los mismos valores y la recuperación en defaults — aceptable:**
1. `aws_ecs_task_definition.api`: reemplazo; **solo** las variables nuevas `WEB_PUBLIC_BASE_URL` (vacía),
   `MAIL_TRANSPORT=disabled`, `MAIL_FROM`, `TRUST_PROXY_HOPS=1`, y —en la Fase 4— la imagen nueva. Sin
   `RESEND_API_KEY` en `secrets`.
2. `aws_ecs_service.api`: **solo** `task_definition` (esto es el corte).
3. `aws_lb.api`: sin cambios (`xff_header_processing_mode` ya es `append`).
4. Ningún recurso `aws_cloudwatch_*`.
5. Salidas: `password_recovery_configuration` nueva; ninguna con secretos.

**Inaceptable (detener):** cualquier cambio en `desired_count` (debe quedar **1/1**); cualquier cambio en la IA
(task definition, imagen, flags); cualquier cambio de imagen de API o migrador distinto del planeado;
`WEB_ORIGIN` ≠ `https://scopeedu.technology`; despliegue de la API ≠ 0/100; **cualquier destrucción**
(provisioner, sonda, SG, IAM, log groups); desaparición de `CREDENTIAL_REGISTRY_RPC_URL` de los secretos o de
`SIGNER_SECRET_REF_PREFIX`; `blockchain_evidence_mode` ≠ `credential_registry`; cambios en RDS, ALB (salvo
ninguno), certificado o DNS; `RESEND_API_KEY` presente con `mail_transport = disabled`; recursos de
`Scope/*/PasswordRecovery` con `enable_recovery_alarms = false`.

---

## 10. Estados de activación

**RECOVERY DISABLED (punto de partida seguro, primer despliegue):** API nueva, esquema migrado con grants
verificados, frontend publicado, `MAIL_TRANSPORT=disabled`, **sin** `RESEND_API_KEY` (ni referenciada), `request`
→ `503`, login y registro sin cambios, sin envíos. `verify`/`confirm` **siguen respondiendo** (no dependen de la
disponibilidad): sin enlaces emitidos devuelven `400`; un enlace **ya emitido** sigue válido hasta 30 min.

**RECOVERY ENABLED:** solo con **todo** esto cumplido:

- [ ] Decisión de producto sobre el **correo no verificado** (§13.1) tomada e implementada si corresponde.
- [ ] Decisión sobre **abuso/cupos** (§13.2): responsable nombrado y alarmas encendidas, o riesgo aceptado por escrito.
- [ ] Cuenta Resend con **MFA**; dominio `mail.scopeedu.technology` **Verified** (DKIM/SPF/Return-Path/DMARC con valores de Resend).
- [ ] **Tracking** de aperturas y clics deshabilitado y sin subdominio de tracking.
- [ ] Parámetro `/scope/prod/api/RESEND_API_KEY` **creado y comprobado antes** de aplicar (§12.1).
- [ ] `web_public_base_url` y `web_origin` **correctos** (`https://scopeedu.technology`).
- [ ] Grants aplicados y S1–S7 pasados con la recuperación deshabilitada.
- [ ] **PR-B (frontend) mergeada y publicada en Vercel, y `/reset-password` verificado sobre ese despliegue (§11), ANTES de habilitar
      el envío real de correo.** Todo dentro de una ventana coordinada: con la API aún en `disabled` el enlace "¿Olvidaste tu
      contraseña?" ya es visible y responde "no disponible" (503) por unos minutos; el corte de activación sigue de inmediato.
- [ ] Guarda `0` y plan revisado (§9) con solo estos cambios: `RESEND_API_KEY` en `secrets`, `MAIL_TRANSPORT=resend`,
      `WEB_PUBLIC_BASE_URL`, y **un ARN más** (`…/api/RESEND_API_KEY`) en la política del *execution role* de la API.
- [ ] **Ventana planificada:** cambiar `mail_transport` cambia la task definition ⇒ **otro corte** (0/100).

Si el parámetro no existiera al aplicar, la tarea nueva **no arranca** (`ResourceInitializationError`): con
0/100 la tarea vieja ya se detuvo ⇒ **hay corte** hasta que el *circuit breaker* devuelva la revisión anterior.
Por eso el parámetro se crea y se verifica **antes**.

Prueba real (cuenta propia, nunca de otra persona), tras activar:
1. `POST /auth/password-reset/request` con tu correo ⇒ `202`. 2. En `/scope/prod/api`: `resend.accepted` y `email.sent`
(`resend.rejected` ⇒ dominio sin verificar o clave inválida). 3. Llega el correo (revisar spam). 4. Remitente =
`Scope <no-responder@mail.scopeedu.technology>`. 5. SPF/DKIM/DMARC = pass. 6. El enlace conserva `#token=…`
intacto (sin `%23` ni reescritura). 7. Abrirlo: la barra queda en `/reset-password`. 8. Cambiar la contraseña.
9. Login con la nueva ⇒ OK. 10. Contraseña anterior y JWT anterior ⇒ `401`. 11. Reabrir el enlace ⇒ "ya no es válido".
12. Ensayar la desactivación (§12.3).

---

### 10b. Cómo repetir y aceptar los planes (sin relajar ningún verificador)

Cada plan tiene su criterio; ninguno se acepta con el modo de otro. Todos usan la guarda `0` previa, los mismos tfvars y el archivo de plan
guardado fuera del repositorio (con ruta nativa en Windows: `cygpath -m`).

| Plan | Cuándo | Verificador | Qué debe contener |
|---|---|---|---|
| Plan en el SHA mergeado, **sin cambio de imagen** | después del merge de PR-A | `plan-acceptance.mjs --mode integrated --plan plan.json` | reemplazo de la task def de la API (4 variables) + servicio con solo `task_definition` |
| Migrador | Fase 2 (árbol sin la recuperación de Terraform) | `plan-acceptance.mjs --mode migrator-only --expected-image-tag <TAG_NUEVO> --plan plan.json` | solo `aws_ecs_task_definition.migrator`, `delete+create`, solo cambia la imagen a `<repo>:<TAG_NUEVO>` |
| API con imagen nueva | Fase 4 | `plan-acceptance.mjs --mode integrated --allow-api-image-change --plan plan.json` | lo mismo que el primero **más** la imagen nueva |

`--allow-api-image-change` solo permite que la imagen cambie; **no** valida cuál. Antes de usarlo, comprobar y registrar: (i) el
`api_image_tag` del plan = `TAG_NUEVO` y su digest en ECR = el del run de *Publish production images*; (ii) `migrator_image_tag` = `TAG_NUEVO`
y **sin cambios** en este plan; (iii) la IA y `desired_count` sin tocar; (iv) las 4 variables y nada más; (v) tu autorización expresa de esa
imagen concreta. `--mode migrator-only` exige `--expected-image-tag` (SHA completo de 40 caracteres), rechaza cualquier otro recurso,
atributo, variable de entorno, secreto, comando u output, y no admite `--allow-api-image-change`. Entre `plan` y `apply` se aplica **solo el
archivo de plan aceptado**; si el estado o el tfvars cambian, se rehace el plan.

---

## 11. Privacidad de `/reset-password` (pendiente de test automático)

`Cache-Control: no-store` depende de `dynamic = 'force-dynamic'` en la página; hoy no hay un test que detecte que
alguien lo quite (recomendado: un cambio acotado en `apps/web`, **separado** de Terraform). Hasta entonces,
verificar **sobre el build que se publica** (local) y **sobre el despliegue de Vercel**:

```bash
# [SOLO LECTURA] local: compila y sirve; no toca AWS ni Vercel
cd apps/web
NEXT_PUBLIC_API_BASE_URL=https://api.scopeedu.technology npx next build
NEXT_PUBLIC_API_BASE_URL=https://api.scopeedu.technology npx next start -p 3100 &
sleep 5
curl -sI http://localhost:3100/reset-password | grep -iE 'referrer-policy|cache-control'
curl -s  http://localhost:3100/reset-password | grep -o '<meta name="robots"[^>]*>'
for p in /login /forgot-password /; do echo "$p"; curl -sI "http://localhost:3100$p" | grep -iE 'referrer-policy|cache-control'; done
kill %1
# [SOLO LECTURA] desplegado
curl -sI https://scopeedu.technology/reset-password | grep -iE '^HTTP|referrer-policy|cache-control'
```
Esperado en `/reset-password`: `Referrer-Policy: no-referrer`, `Cache-Control: no-store, max-age=0`, `noindex, nofollow`;
las otras rutas conservan su política. (`next build` reescribe `apps/web/next-env.d.ts`: restaurarlo.)

---

## 12. Resend, SSM, desactivación y rollback

### 12.1 Resend y DNS (manual, externo a AWS; no se inventan valores DNS)
Cuenta con **MFA**; agregar el dominio **`mail.scopeedu.technology`**; publicar en el DNS real los registros que
muestra Resend (tipos esperables: **DKIM** `TXT`/`CNAME`, **SPF** `TXT`, **Return-Path/MAIL FROM** `MX`+`TXT`, **DMARC**
`TXT` en `_dmarc`) hasta ver **Verified**. Verificar y registrar con captura: open tracking **off**, click tracking
**off**, **sin** subdominio de tracking. La API de envío no tiene parámetro por mensaje para esto. No se afirma que
filtros de terceros (Safe Links, etc.) conserven siempre el enlace: solo una prueba con buzones reales lo confirma.
Crear una API key **solo de envío**, restringida al dominio si el panel lo permite; guardarla en un gestor.

Crear el parámetro **sin exponer el secreto** `[REQUIERE APROBACIÓN HUMANA — MODIFICA AWS]`:
```bash
umask 077
SECRET_FILE="$(mktemp)"; trap 'rm -f "$SECRET_FILE"' EXIT
read -rs RESEND_KEY                                   # no se muestra ni va al historial
printf '%s' "$RESEND_KEY" > "$SECRET_FILE"            # printf es interno del shell: no aparece en `ps`
unset RESEND_KEY
aws ssm put-parameter --region us-east-1 --name "/scope/prod/api/RESEND_API_KEY" \
  --type SecureString --value "file://$SECRET_FILE" --no-overwrite
rm -f "$SECRET_FILE"; trap - EXIT
```
Comprobar sin revelar el valor:
```bash
# [SOLO LECTURA]
aws ssm describe-parameters --parameter-filters "Key=Name,Values=/scope/prod/api/RESEND_API_KEY" \
  --query 'Parameters[].{Name:Name,Type:Type,Version:Version,Modified:LastModifiedDate}'   # Type = SecureString
ROLE_ARN="$(terraform output -json iam_role_arns | jq -r .api_execution)"
aws iam simulate-principal-policy --policy-source-arn "$ROLE_ARN" --action-names ssm:GetParameters \
  --resource-arns "arn:aws:ssm:us-east-1:$(aws sts get-caller-identity --query Account --output text):parameter/scope/prod/api/RESEND_API_KEY" \
  --query 'EvaluationResults[].EvalDecision'    # "allowed" solo despues de aplicar mail_transport = "resend"
```

### 12.2 Rollback — DOS situaciones distintas
Hechos (verificados en código): `JWT_SECRET` firma **solo** los JWT de sesión humana; la IA usa otro secreto y las
comparticiones otra clave; los JWT duran `jwt_expires_in` (1 h); el esquema es aditivo (no se revierte).
`MIN_ROLLBACK_SHA` = la primera imagen que verifica `sv` (anotarla al publicar, Fase 1).

**A. ANTES de la primera activación (hoy y durante todo el despliegue con recuperación deshabilitada).**
La API viva es **V0** (anterior a `sessionVersion`). Mientras la recuperación **nunca** haya estado activa, no
existen enlaces ni `confirm.succeeded`: **ningún** JWT fue revocado por un restablecimiento, así que volver a V0 **no
revive** nada. Se puede volver al `<tag anterior de la API, registrado antes del corte>` (`api_image_tag`), y el esquema aditivo lo tolera. Comprobarlo antes de
afirmarlo: Logs Insights en `/scope/prod/api` con `filter @message like /confirm.succeeded/` ⇒ **0** resultados en toda
la historia de la imagen V1.

**B. DESPUÉS de la primera activación.** Volver a V0 **sí** puede revivir JWT revocados (hasta su vencimiento). Antes:
desactivar (§12.3) → esperar a que venzan los enlaces (30 min) o invalidarlos → comprobar el último `confirm.succeeded`:
si pasó **más de `jwt_expires_in`**, ningún token revocado sigue vivo y el rollback es seguro; si no, esperar **o** rotar
`JWT_SECRET`. **No** subir ni bajar `api_image_tag` por debajo de `MIN_ROLLBACK_SHA` sin este procedimiento.

**Compatibilidad de JWT (verificada por `legacy-token-compat.test.ts` y `legacy-token-compat.pg.test.ts`):** un JWT de la API anterior (sin
`sv`) vale en la API nueva mientras la cuenta esté en versión 0 (el valor tras migrar, sin backfill); un JWT nuevo (con `sv`) vale en la lógica
de verificación anterior, que lo ignora. Esto es lo que hace seguro volver a la imagen anterior **antes** de la primera activación.

**Limitación: task definitions `INACTIVE`.** Un `apply` que reemplaza la task definition (`delete+create`, sin `skip_destroy`) **desregistra**
la revisión anterior. Tras el corte de la API, la revisión `:11` queda `INACTIVE`; lo mismo ocurre con la revisión previa del migrador. Que
el rollback automático de ECS pueda relanzar una revisión desregistrada no está verificado. **El plan de vuelta no depende de ello:** se
fija el `api_image_tag` (o `migrator_image_tag`) anterior en el tfvars, guarda → plan → apply, y Terraform registra una **revisión nueva**
con la imagen anterior (otro corte para la API).

**El rollback automático de ECS NO es una garantía.** `deployment_circuit_breaker { rollback = true }` devuelve la
**revisión anterior** si un despliegue falla, sin que nadie lo decida. Con 0/100 la tarea vieja ya estaba detenida: hay
corte hasta que termine. Que lo haga AWS **no** lo vuelve seguro: tras *cualquier* rollback automático hay que verificar
(i) la imagen que corre (`describe-services` → task definition → imagen), (ii) el claim `sv` en un JWT nuevo (S2) y
(iii) la situación (A o B). El primer despliegue de V1 revertido automáticamente cae en **A** (seguro); después de la
primera activación, una reversión a una revisión **V0** (p. ej. por un `api_image_tag` viejo en un tfvars) cae en **B**.

**Rotar `JWT_SECRET`** `[REQUIERE APROBACIÓN HUMANA — IRREVERSIBLE]`: no se recomienda por defecto; solo si hay que volver
a código sin `sv` sin poder esperar `jwt_expires_in`, o por sospecha de filtración. Cierra **todas** las sesiones de **todas**
las personas (vuelven al login; no se pierden datos); no afecta al JWT de la IA ni a las comparticiones; se lee al iniciar
la tarea ⇒ hay que reiniciar (otro corte); el valor nuevo debe ser distinto de `AI_SERVICE_JWT_SECRET`. No se rotó aquí.

**Prohibido:** `UPDATE … sessionVersion = 0`; DROP de la columna/tabla; ejecutar `seed`.

**Base de datos: rollback ≠ restauración.** La migración es aditiva y la API anterior la ignora: **no se revierte** para volver al código
anterior. El snapshot de §6.7 es **recuperación ante desastre** (un daño inesperado de datos), no un rollback inmediato: restaurarlo
crea otra instancia, pierde las escrituras posteriores y exige repuntar la aplicación y conciliar Terraform (§6.7).

### 12.3 Desactivar la recuperación sin restaurar la versión anterior
Apagar por **configuración**: `mail_transport = "disabled"` ⇒ guarda → `plan` → `apply`. `[REQUIERE APROBACIÓN HUMANA — MODIFICA AWS]`.
**No es un cambio sin consecuencias:** cambia la task definition de la API ⇒ **corte con 0/100** (tarea vieja se
detiene, la nueva arranca); no existe un interruptor instantáneo sin despliegue. Planificar la ventana.

Comprobar `[SOLO LECTURA]`: `POST /auth/password-reset/request` ⇒ `503`; S2/S3 (login y `/auth/me`) ⇒ `200`.
Los enlaces ya emitidos siguen válidos hasta 30 min; para invalidarlos ya:
```bash
# [REQUIERE APROBACIÓN HUMANA — MODIFICA LA BASE]  (scope_admin vía el migrador; UPDATE sobre datos productivos)
SQL='UPDATE "PasswordResetToken" SET "invalidatedAt" = now()
     WHERE "consumedAt" IS NULL AND "invalidatedAt" IS NULL AND "expiresAt" > now();'
```
Si hay sospecha de filtración de la clave: eliminarla en Resend (los envíos fallan con `resend.rejected` pero `request`
sigue dando `202`: por eso **además** se desactiva).

---

## 13. Gates de producción: identidad, abuso y observabilidad

### 13.1 Correo no verificado — BLOQUEA la activación pública
El registro **no verifica la propiedad del correo**; la recuperación convierte "controla el buzón" en "controla la
cuenta". Casos: typo o alias compartido; cuentas privilegiadas (miembros de emisoras, `PlatformAdmin`) cuya toma permite
emitir/revocar credenciales en nombre de una institución; datos y credenciales de titulares. **Recomendación:**
(1) verificación de correo y recuperación solo para cuentas verificadas (esquema + flujo + decisión sobre cuentas
existentes, hoy todas sin verificar); (2) interina: excluir de la recuperación a las cuentas privilegiadas y aceptar por
escrito el riesgo residual, o limitarla a cuentas de demostración; (3) **no** habilitarla públicamente para todas. No
impide la prueba técnica con cuenta propia en entorno controlado. **No se implementó nada de esto en la Etapa 5.2.**

### 13.2 Abuso de cupos
Existente: `202` uniforme; por IP 5 `request` y 20 `verify+confirm` / 15 min (por tarea); por cuenta 1 min y 3/h; global
80 / 24 h; token SHA-256, 30 min, un solo uso. **Brecha:** una sola IP (≈480 solicitudes/día) con 80 correos de cuentas
existentes agota el cupo global y deja sin recuperación al resto (denegación de la función, no compromiso de cuentas);
también se puede quemar la cuota de una persona. Sin CAPTCHA/WAF/Redis. Las alarmas **detectan**; no previenen.

### 13.3 Alarmas (preparadas, apagadas)
`recovery_alarms.tf`, `enable_recovery_alarms = false` ⇒ cero recursos. Señales (texto literal de los logs de la API;
patrones fijados por test): `request.dropped (global_cap)`, `request.dropped (account_quota)`, `email.failed` /
`email.ambiguous` / `resend.rejected`, `request.failed` / `confirm.failed` / `token.invalidate_failed` (fallo interno,
p. ej. falta el grant), `dropped (shutting down)` / `dropped (too many in flight)`, y —solo con `resend`—
`recovery.unavailable` / `mail.config_invalid`. **Pendiente de decisión:** quién recibe las notificaciones
(`recovery_alarm_action_arns`); costo: verificar el plan gratuito antes de encender.

---

## 14. Cierre técnico (pendientes independientes)

- Test automático de `force-dynamic` / `Cache-Control: no-store` para `/reset-password` (cambio web acotado, aparte).
- Validación externa de Resend (cuenta, dominio, tracking, entrega real).
- Protección pública frente al agotamiento de cupos y verificación de propiedad del correo (§13).
- `alb.tf` ya estaba sin formatear en `origin/main` (no se reformateó).
- Los dos tests históricos de migraciones (`test:technical-identity`, `test:key-rotation`) pasan sobre la base integrada; confirmar en CI.
- `static-checks.sh` compara contra la base y valida invariantes (sin hashes fijos).

---

## 15. Problemas conocidos

| Síntoma | Causa probable | Cómo verificar | Remedio |
|---|---|---|---|
| El plan pide `migrator_image_tag` o `provisioner_image_digest` | Variables obligatorias de `origin/main` sin valor | mensaje del plan | Completarlas con valores **verificados** (reconciliation/); nunca vaciar ni derivar |
| `apply` propone `desired_count` 0 o imágenes viejas | tfvars viejo | guarda (§3) y plan | **No aplicar**; reconciliar |
| El migrador dice "up to date" pero la migración nueva no figura | Migrador con imagen vieja | §6.3 / `status` | Publicar la revisión nueva del migrador (Fase 2); **no** desplegar la API |
| Tareas nuevas no arrancan: `unable to pull secrets … RESEND_API_KEY` | `resend` sin el parámetro | `describe-parameters` | Con 0/100 ya hay corte: crear el parámetro o volver a `disabled`; esperar al circuit breaker |
| `permission denied for table PasswordResetToken`; `verify` da 500 | Falta el grant | §6.6, S5 | Paso `02`; re-verificar |
| `request` da 202 y no llega correo; log `request.failed` | Idem permiso/BD **después** del 202 | log + alarma `internal_failure` | Idem |
| Error de CORS en el navegador | `web_origin` vacío o distinto del origen real | S6 | Corregir (un solo origen, sin `/`) y aplicar (corte) |
| 429 generalizado en `verify` | `TRUST_PROXY_HOPS` en `0` | S7 / atributo del ALB | Debe ser `1` (test lo impide) |
| `resend.rejected (403/422)` | Dominio sin verificar / remitente | panel de Resend | Verificar el dominio / corregir `mail_from` |
| `resend.rejected (401)` | Clave inválida/revocada | panel | Rotar la clave y reiniciar tareas (otro corte) |
| `recovery.unavailable (web_url:…)` | `WEB_PUBLIC_BASE_URL` vacío/ inválido | log | Completar `web_public_base_url` |
| `request.dropped (global_cap)` | Cupo global agotado | alarma | §13.2 |
| "pidió el correo y no llegó" | Envío *best-effort*: 202 no garantiza entrega | logs `email.sent`/`dropped`/`resend.*` | Que lo pida de nuevo |
| "Este enlace ya no es válido" | Venció (30 min), usado o reemplazado | — | Pedir uno nuevo |
| Todas las rutas protegidas dan 500 tras desplegar | API nueva sobre esquema anterior | log: columna `sessionVersion` | §6; es la razón del orden |
| Tras un rollback, sesiones revocadas funcionan | Se volvió a código sin `sv` tras la primera activación | JWT sin `sv` aceptado | §12.2 B |
| Contraseña demo conocida vuelve a funcionar | Se ejecutó `seed` | — | **No ejecutar `seed`**; rotar esas contraseñas |
| `migrate deploy` se niega a seguir: "failed migration" | Una ejecución anterior falló y Prisma la dejó marcada | `migrate status` | §6.7 (`migrate resolve --rolled-back`), tras entender la causa |
| El plan del migrador es rechazado por `--mode migrator-only` | Cambió algo más que la imagen autorizada (o el tag no es el esperado) | los motivos que imprime el verificador | **No relajar el verificador**: entender y corregir la entrada; nunca aplicar |

---

## 16. Decisiones que siguen necesitando autorización (no están tomadas)

| # | Decisión | Estado |
|---|---|---|
| 1 | Commit, push, apertura y merge de PR-A y PR-B (los hace una persona) | pendiente |
| 2 | Identidad y perfil puente de **escritura** para Terraform en Windows (el rol de planificación nunca escribe) | pendiente |
| 3 | Snapshot de RDS previo a migrar y la identidad que lo crea (`rds:CreateDBSnapshot`) | pendiente |
| 4 | `ALTER ROLE scope_admin SET lock_timeout` durante la migración (opcional) | pendiente |
| 5 | Publicar la imagen (*Publish production images*), el migrador y ejecutar la migración y los grants | pendiente |
| 6 | Franja y comunicación de los dos cortes de API (release y activación del correo) | pendiente |
| 7 | Gate de **correo no verificado** (§13.1) antes de la activación pública; abuso de cupos y destino de alarmas (§13.2–13.3) | pendiente |
| 8 | Resend: cuenta, dominio verificado, tracking desactivado, clave en SSM | pendiente |
| 9 | Merge de PR-B dentro de la ventana de activación (§10) | pendiente |

# Readiness de deployment productivo v1 — lote incremental S1→S7b

> **Nada de este documento fue ejecutado.** Es un checklist operativo
> construido auditando el repositorio en modo lectura. Durante su redacción no
> se tocó AWS, RDS, ECS, ECR, SSM, Secrets Manager, GitHub Actions, Vercel ni
> Base Sepolia, ni se arrancó el daemon de Docker.

## Alcance

Cubre el despliegue del **lote incremental** que agrega al producto ya
desplegado:

| Slice | Qué agrega |
|---|---|
| S1 | tabla `PlatformAdmin` + guard |
| S2 | bootstrap del primer PlatformAdmin |
| S3 | lecturas administrativas + flag en `/auth/me` |
| S4 | resolución de personas por email |
| O1 | enum + columna `User.onboardingIntent` |
| S5a | alta de membership administrativa |
| S5b | alta de instituciones |
| S6a / S6b | superficie web `/admin` (lectura y acciones) |
| S7a / S7b | E2E integrado y documentación |

### Relación con el runbook de bootstrap

`infra/terraform/README.md` §5 ("Full rollout order") describe el **bootstrap
inicial**: de una cuenta vacía a servicios corriendo. Ese procedimiento es
histórico y ya fue ejecutado.

Este documento describe el **lote incremental (B)** sobre infraestructura ya
corriendo. Son procedimientos distintos y no se solapan: no hay dos fuentes de
verdad para la misma operación.

Un eventual **rebuild de datos demo (C)** es una tercera cosa, y se trata en
§7.

---

## 0. El mecanismo real de deployment

Esto **no es obvio** desde los workflows, y entenderlo mal rompe el rollout.
Hay tres piezas y ninguna despliega sola:

```
1. publish-production-images.yml   →  construye y publica imágenes. NO despliega.
2. terraform apply                 →  registra task definitions y ROLLEA servicios.
3. run-production-migrator.yml     →  corre un paso de migración on-demand.
```

**Pieza 1 — publicación de imágenes.** `workflow_dispatch` con input
`source_sha` (exactamente 40 hex minúsculas). Valida que el checkout coincida
con ese SHA y que el SHA sea **ancestro de `origin/main`**. Publica:

```
309490997821.dkr.ecr.us-east-1.amazonaws.com/scope/api:<sha>
309490997821.dkr.ecr.us-east-1.amazonaws.com/scope/ai:<sha>
```

No existe tag `latest` en ningún lado. **El pinning por SHA inmutable ya está
implementado correctamente.** No hay imagen de migrator: el migrator **reusa
la imagen de la API**.

**Pieza 2 — Terraform es el deployer.** Las task definitions leen el tag de
variables de Terraform:

| Task definition | Imagen |
|---|---|
| `scope-prod-api` | `scope/api:${var.api_image_tag}` |
| `scope-prod-migrator` | `scope/api:${var.api_image_tag}` ← **la misma variable** |
| `scope-prod-ai` | `scope/ai:${var.ai_image_tag}` |

El service referencia `aws_ecs_task_definition.api.arn`, así que cambiar
`api_image_tag` y aplicar **registra una revisión nueva y rollea el servicio
en el acto** (rolling, `minimum_healthy_percent = 100`, `maximum = 200`).

**Pieza 3 — el migrator.** `workflow_dispatch` con un input `step` que elige
entre cinco comandos:

| `step` | Comando real |
|---|---|
| `01` | `psql -f /app/infra/terraform/sql/01-bootstrap-scope-app-role.sql` |
| `migrate` | `npx prisma migrate deploy --schema prisma/schema.prisma` |
| `02` | `psql -f /app/infra/terraform/sql/02-grant-scope-app-on-existing-objects.sql` |
| `seed` | `npm run db:seed` |
| `verify` | `npm run db:verify-demo` |

Corre con `aws ecs run-task --task-definition scope-prod-migrator` **sin
revisión**, es decir con la revisión ACTIVE más reciente — la que dejó el
último `terraform apply`.

### La consecuencia crítica

> El migrator sólo puede aplicar las migraciones **nuevas** después de que un
> `terraform apply` haya fijado el tag nuevo. Pero ese mismo apply **también
> rollea la API**, porque ambas task definitions leen `var.api_image_tag`.

Y la combinación "API nueva + base sin migrar" **no es degradada, es una
caída**: `/auth/me` selecciona la relación `platformAdmin` y la columna
`onboardingIntent`; contra una base sin ellas, Prisma falla y el endpoint
devuelve 500. `/auth/me` se llama al arrancar toda sesión, así que la
aplicación queda inutilizable aunque el login siga respondiendo.

**Solución con los mecanismos que ya existen** (ver Fase 3): aplicar primero
**sólo** la task definition del migrator con `-target`, migrar, otorgar
grants, y recién después aplicar el resto. No requiere ningún cambio de
código.

La solución limpia sería una variable `migrator_image_tag` separada. Es un
cambio de Terraform y queda **fuera de S7c** (ver §10).

---

## 1. Inventario de migraciones

20 migraciones en total. Las dos del lote son las dos últimas por orden
lexicográfico, que es el orden en que Prisma las aplica:

| # | Directorio | Slice |
|---|---|---|
| 19 | `20261003120000_add_platform_admin` | S1 |
| 20 | `20261004120000_add_user_onboarding_intent` | O1 |

**`20261003120000_add_platform_admin`** — 3 sentencias:

```sql
CREATE TABLE "PlatformAdmin" (id TEXT PK, userId TEXT NOT NULL, grantedAt TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "PlatformAdmin_userId_key" ON "PlatformAdmin"("userId");
ALTER TABLE "PlatformAdmin" ADD CONSTRAINT ... FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- puramente aditiva: tabla nueva, ningún `ALTER` sobre tablas existentes;
- sin backfill, sin default de negocio, sin enum;
- `ON DELETE CASCADE`: borrar el `User` revoca la capacidad;
- **requiere grants de tabla** → el paso `02` es obligatorio (§2).

**`20261004120000_add_user_onboarding_intent`** — 2 sentencias:

```sql
CREATE TYPE "UserOnboardingIntent" AS ENUM ('personal', 'institutional');
ALTER TABLE "User" ADD COLUMN "onboardingIntent" "UserOnboardingIntent";
```

- columna **nullable, sin default, sin índice**;
- `ADD COLUMN` nullable sin default es una operación de **metadata** en
  PostgreSQL: no reescribe la tabla ni bloquea lecturas;
- las filas existentes quedan en `NULL`, que significa exactamente "esta
  cuenta se creó antes de que Scope preguntara" y conserva su comportamiento;
- **no bloquea cuentas legacy** y no es autorización;
- los grants de tabla ya vigentes alcanzan para la columna; `USAGE` sobre un
  tipo es público por defecto en PostgreSQL.

**Dependencia entre ellas:** ninguna. Son independientes y ambas aditivas. El
orden lexicográfico las aplica S1 → O1, que es también el orden histórico.

**Rollback:** no hay SQL de rollback preparado en el repositorio, y S7c **no
lo inventa**. Ver §8.

---

## 2. La regla de los grants SQL

`infra/terraform/sql/02-grant-scope-app-on-existing-objects.sql` lo dice en su
propio header:

> RUN THIS: as scope_admin, connected to the `scope_app` database; after the
> FIRST `prisma migrate deploy`; **again after every later migration batch,
> before the new code goes live.** It is idempotent.

Aplica a este lote porque **S1 crea una tabla nueva**. `ALTER DEFAULT
PRIVILEGES` (script `01`) no es retroactivo, y sólo cubre objetos creados
*después* de haberse ejecutado. Si `scope_app` no tiene privilegios sobre
`PlatformAdmin`, el guard que la lee falla en runtime por permisos — y ese
guard protege toda la superficie `/admin`.

Qué hace el `02`:

1. aborta si no está conectado a la base `scope_app` o si el rol no existe;
2. `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public`;
3. `GRANT USAGE, SELECT ON ALL SEQUENCES`;
4. `REVOKE ALL ON public._prisma_migrations` (el runtime no debe poder
   reescribir la historia de migraciones);
5. tres consultas de verificación **read-only** y un conteo.

No otorga `TRUNCATE`, `REFERENCES` ni `TRIGGER`.

**Tres éxitos distintos que no hay que confundir:**

| | Qué significa | Cómo se comprueba |
|---|---|---|
| migration success | el DDL se aplicó | paso `migrate` exit 0 |
| grant success | `scope_app` puede leer lo nuevo | paso `02` exit 0 **y** las 3 verificaciones en 0 filas / `f` |
| code rollout success | la API nueva corre y responde | health + smokes (§6) |

Que el primero funcione no implica nada sobre los otros dos.

> **Importante — el workflow NO cadena los pasos.** `02` es una opción
> separada del input `step`. Hay que dispararlo explícitamente después de
> `migrate`. No hay automatismo que lo haga.

---

## 3. Matriz de compatibilidad cross-version

| Combinación | Veredicto | Por qué |
|---|---|---|
| web vieja + API vieja + DB sin migrar | SAFE | estado actual |
| web vieja + API vieja + **DB migrada** | **SAFE** | ambas migraciones son aditivas; Prisma selecciona campos explícitos, nunca `SELECT *` |
| web vieja + **API nueva** + DB migrada | **SAFE** | `onboardingIntent` es opcional en el registro (`undefined` → Prisma omite la columna); la web vieja simplemente no manda el campo ni lee los nuevos |
| **web nueva** + API vieja + DB migrada | **DEGRADED** | el adapter es tolerante: `isPlatformAdmin: response.platformAdmin === true` (fail-closed si falta) y `onboardingIntent` fail-safe a `null`. Resultado: nadie ve el acceso a `/admin` y todos aterrizan en el espacio personal. No rompe, pero `/admin` escrito a mano daría 404 del backend viejo |
| **API nueva + DB sin migrar** | **UNSAFE — CAÍDA** | `/auth/me` selecciona la relación `platformAdmin` y la columna `onboardingIntent`; Prisma falla y devuelve 500. Se llama al arrancar toda sesión ⇒ app inutilizable |

**Conclusión de orden:** la base **tiene que** migrarse antes de que la API
nueva reciba tráfico, y la web nueva debe ir **después** de la API nueva. Esto
fija el orden de las fases 3 → 5 → 6.

La única ventana incompatible inevitable es la de la cuarta fila (web vieja +
API nueva), y es segura.

---

## 4. Inventario de configuración (sólo nombres)

No se leyó ningún valor. `terraform.tfvars` está gitignoreado y no se abrió.

### SecureString en SSM — creados fuera de banda, nunca por Terraform

| Parámetro | Consumidor | Propósito |
|---|---|---|
| `/scope/prod/api/DATABASE_URL` | API + migrator | credenciales del rol `scope_app` |
| `/scope/prod/api/JWT_SECRET` | API | firma de los JWT de sesión |
| `/scope/prod/api/PROFILE_SHARE_TOKEN_KEY` | API | clave AES-256-GCM de sobres de share (§4.1) |
| `/scope/prod/shared/AI_INTERNAL_JWT_SECRET` | API + AI | autenticación interna API→AI |
| `/scope/prod/ai/OBJECTIVE_ANALYSIS_OPENAI_API_KEY` | AI | proveedor |
| `/scope/prod/ai/EVIDENCE_UNITS_OPENAI_API_KEY` | AI | proveedor |
| `/scope/prod/ai/CONTEXTUAL_REASONING_OPENAI_API_KEY` | AI | proveedor |
| `/scope/prod/ai/OBJECTIVE_UNDERSTANDING_OPENAI_API_KEY` | AI | proveedor |

### String en SSM — gestionados por Terraform, flipables sin apply

| Parámetro | Valor que fija Terraform |
|---|---|
| `/scope/prod/api/BLOCKCHAIN_EVIDENCE_MODE` | `mock` |
| `/scope/prod/api/REASONING_EXECUTION_MODEL` | `unset` |
| `/scope/prod/ai/*_OPENAI_MODEL` (4) | `unset` |

`unset` no es un modelo válido, así que nada puede llamar a un proveedor por
accidente. **`BLOCKCHAIN_EVIDENCE_MODE` queda en `mock`: S7c no lo cambia.**

### No secretos, en la task definition de la API

`PORT`, `WEB_ORIGIN`, `JWT_EXPIRES_IN`, `PUBLIC_DID_BASE_URL`,
`AI_SERVICE_BASE_URL`, `AI_SERVICE_TIMEOUT_MS`, `AI_SERVICE_AUTH_MODE=jwt`,
`AI_SERVICE_JWT_ISSUER`, `AI_SERVICE_JWT_AUDIENCE`,
`AI_SERVICE_JWT_EXPIRES_IN_SECONDS`, `DOCUMENT_STORAGE_PROVIDER=s3`,
`AWS_REGION`, `AWS_S3_BUCKET`, `AWS_S3_PREFIX`.

### Secrets Manager

La contraseña master de RDS vive **sólo** en el secreto que RDS mismo posee
(`manage_master_user_password`). Nunca se copia a SSM. El migrator la recibe
como `RDS_MASTER_PASSWORD` por el bloque `secrets` de ECS, seleccionando la
clave `:password::`.

### Web (Vercel)

`NEXT_PUBLIC_API_BASE_URL` — único requisito. El código la valida: debe ser
http/https, sin credenciales, query ni fragmento, y le quita la barra final.
**Ningún otro secreto va al frontend**: no hay variable de base de datos, de
S3, de RPC ni de firma en la web.

### El lote S1→S7b no agrega ninguna variable nueva

Ni `PlatformAdmin`, ni el onboarding, ni `/admin` introducen configuración.
Es una propiedad útil: no hay que provisionar nada antes de desplegar.

### 4.1 `PROFILE_SHARE_TOKEN_KEY`

Hoy se provisiona como SecureString en `/scope/prod/api/PROFILE_SHARE_TOKEN_KEY`
(creado fuera de banda; Terraform sólo le da permiso de lectura al execution
role de la API). No se recuperó ni se imprimió su valor.

El código (`share-token-recovery.ts`) exige exactamente **32 bytes en base64 o
hex** y **falla cerrado** si falta (`KEY_NOT_CONFIGURED`): sin clave no se
puede crear un enlace recuperable, en vez de guardar algo débil.

**Si se rotara**, los sobres ya persistidos dejarían de abrirse
(`ENVELOPE_UNUSABLE`): el prefijo de versión `v1` existe precisamente para
poder migrar clave o formato sin adivinar. Lo que se pierde es la
**recuperación** del enlace por parte de su dueño; el token en sí vive en la
fila y la verificación pública no usa esta clave.

> No tracé exhaustivamente el camino de lectura pública para afirmar con
> certeza total que un visitante no se vería afectado. **El lote S1→S7b no
> necesita rotarla**, así que la recomendación es no tocarla y tratar la
> decisión de rotación como un tema aparte.

---

## 5. Modelo de task role y S3

| Componente | Identidad | Permisos |
|---|---|---|
| API | `scope-prod-api-task` | `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` sobre el prefijo del bucket de evidencia |
| AI | `scope-prod-ai-task` | sólo `ecs-exec` |
| migrator | `scope-prod-migrator-task` | sólo `ecs-exec` |

- **no hay access keys de larga vida en ninguna env var**: la API firma con el
  task role;
- el **navegador no accede a S3 directamente**: no hay credencial ni URL
  firmada en la configuración de la web;
- hay un **execution role por workload** (no uno compartido): el agente de ECS
  de cada tarea puede resolver sólo los parámetros que su propia task
  definition declara. Sólo el del migrator puede leer el secreto master de
  RDS;
- el bucket es **preexistente** y Terraform lo referencia sólo por ARN para
  construir la política: nunca lo crea, importa, modifica ni destruye.

---

## 6. Dependencia API → AI

La API resuelve el AI service por **Cloud Map DNS privado**:

```
AI_SERVICE_BASE_URL = http://ai.scope.internal:8000
```

(namespace `scope.internal`, servicio `ai`, puerto desde
`var.ai_container_port`). Autenticación interna por JWT compartido
(`AI_INTERNAL_JWT_SECRET`), con issuer/audience que ambos lados deben
compartir.

**Para el lote S1→S7b esto es irrelevante**: ninguna ruta administrativa
toca el AI service. Si el AI estuviera caído, `/admin` funciona igual. Lo que
sí requiere AI listo son las features de análisis, que no forman parte de este
lote.

---

## 7. Política de seed y preservación académica

El seed (`npm run db:seed` → `prisma/seed.ts`) usa **sólo `upsert`** sobre:
`user`, `authCredential`, `academicCourse`, `program`, `curriculumVersion`,
`programCourse`.

Mezcla dos clases de datos:

| Clase | Modelos | Política |
|---|---|---|
| **Referencia académica** | `AcademicCourse`, `Program`, `CurriculumVersion`, `ProgramCourse` | **preservar**. Ya están cargados |
| **Demo / transaccional** | `User` + `AuthCredential` demo | regenerable, pero un `upsert` **reescribe el hash de password** de las cuentas demo |

**El lote S1→S7b NO requiere seed.** Ninguna de las dos migraciones necesita
backfill y ningún código nuevo depende de datos sembrados.

| Cuándo | Veredicto |
|---|---|
| después de este lote | **no correr** — innecesario, y reescribiría credenciales demo |
| en un rebuild deliberado de datos demo (escenario C) | requerido, con decisión explícita |
| "por costumbre después de migrar" | **peligroso** — no es una operación neutra |

### Verificación de preservación — no mutante

`npm run db:verify-demo` (`prisma/verify-demo-database.ts`) es **read-only**:
sólo hace `count` y asserts, sin un solo `create`/`update`/`delete`. Comprueba
que exista el issuer demo esperado y que los conteos de su catálogo académico
coincidan con valores esperados.

Dos matices importantes:

- es una verificación de **datos demo**, no del esquema. Si los datos demo se
  hubieran recortado, fallaría sin que haya nada roto en el esquema;
- el `02-grant` termina con `SELECT count(*) FROM "AcademicCourse"` cuyo
  comentario dice *"Expected 617"*. Ese número es un **valor de referencia
  histórico**, no un invariante de esquema: sirve como sanity check de que el
  catálogo sigue ahí, y una diferencia pide investigación, no un fallo
  automático del deploy.

---

## 8. Fases del rollout

Cada fase tiene precondición, acción, verificación, criterio de parada y
recuperación. **Ninguna fue ejecutada.**

### GATE 0 — Revisión fuente y Docker

**Precondition**
- el commit a desplegar está en `origin/main` y se conoce su SHA de 40 hex;
- la suite local está verde en ese commit (referencia: 62 suites / 4166 tests
  de API; 91 archivos / 1467 tests de web);
- worktree sin cambios relevantes sin commitear.

**Action**
- el operador decide arrancar Docker Desktop (decisión suya, no automática);
- construir localmente la imagen de la API desde `services/api/Dockerfile`
  con contexto en la raíz del repo;
- verificar que el build complete `npm ci`, `prisma:generate` y `build`;
- verificar que el entrypoint del migrator exista y sea ejecutable dentro de
  la imagen;
- si corresponde, construir la imagen del AI service.

**Verify**
- build exit 0;
- `psql` presente en la imagen (el Dockerfile instala `postgresql-client`, y
  los pasos `01`/`02` lo necesitan);
- `/app/infra/terraform/sql/` existe dentro de la imagen (el workflow referencia
  esos paths absolutos);
- `/app/data/academic_catalog` existe.

**Stop if**
- el build falla, o falta `psql`, o faltan los paths que el workflow asume.

**Recovery**
- no publicar nada. Es el único gate totalmente reversible: todavía no se
  tocó AWS.

> **Estado actual: `NOT_VALIDATED_LOCAL_ENV`.** En G1a el CLI de Docker estaba
> instalado (28.3.2) pero el daemon apagado, y S7c no lo arranca. Este gate
> está **pendiente y es obligatorio** antes del deploy real.

### GATE 1 — Publicación de imágenes

**Precondition** — GATE 0 verde.

**Action**
- disparar `Publish production images` con `source_sha = <SHA de 40 hex>`.

**Verify**
- los tres jobs (`validate`, `publish-api`, `publish-ai`) en verde;
- existen `scope/api:<sha>` y `scope/ai:<sha>` en ECR;
- registrar el SHA desplegado en la bitácora del release.

**Stop if**
- `validate` rechaza el SHA (formato, o no es ancestro de `origin/main`);
- cualquier push a ECR falla.

**Recovery**
- publicar una imagen no cambia nada en ejecución. Se puede repetir.

### GATE 2 — Preparar el migrator SIN rollear la API

Esta fase existe por la restricción de §0.

**Precondition**
- GATE 1 verde;
- RDS disponible;
- política de checkpoint satisfecha (ver la nota de snapshot más abajo).

**Action**
- fijar `api_image_tag = <sha>` en `terraform.tfvars`;
- aplicar **sólo** la task definition del migrator:

```
terraform -chdir=infra/terraform/prod plan   -target=aws_ecs_task_definition.migrator -out=migrator.tfplan
terraform -chdir=infra/terraform/prod apply  migrator.tfplan
```

**Verify**
- el plan afecta **exactamente un** recurso: la task definition del migrator;
- en particular **no** aparece `aws_ecs_task_definition.api` ni
  `aws_ecs_service.api`;
- la nueva revisión de `scope-prod-migrator` apunta a `scope/api:<sha>`.

**Stop if**
- el plan incluye cualquier otro recurso. No aplicar: significa que hay drift
  o que `-target` no acotó lo esperado.

**Recovery**
- una task definition nueva sin servicio asociado no ejecuta nada. Se puede
  dejar registrada sin consecuencias.

> **Checkpoint de base.** El repositorio no define una política de backup
> previa a migraciones. RDS tiene `deletion_protection` y un
> `final_snapshot_identifier` para el destroy, pero eso **no es** un backup
> pre-migración. Antes de GATE 3 el operador debería tomar un snapshot manual
> o confirmar que los backups automáticos cubren el punto en el tiempo. S7c no
> inventa el procedimiento ni lo ejecuta.

### GATE 3 — Migraciones

**Precondition**
- GATE 2 verde: la revisión ACTIVE del migrator usa la imagen del SHA
  objetivo;
- checkpoint de base resuelto.

**Action**
- disparar `Run production migrator` con `step = migrate`.

**Verify**
- exit code 0 (el workflow falla explícitamente si no lo es);
- en los logs del migrator aparecen aplicadas **las dos** migraciones del
  lote: `20261003120000_add_platform_admin` y
  `20261004120000_add_user_onboarding_intent`;
- opcionalmente, `prisma migrate status` reporta el esquema al día.

**Stop if**
- exit distinto de 0;
- se aplicó una sola de las dos;
- aparece cualquier migración inesperada (significaría que la imagen no es la
  del SHA que se cree).

**Recovery**
- **no avanzar a GATE 5.** La API vieja sigue corriendo y es compatible con
  la base migrada (§3), así que el sistema sigue en pie;
- inspeccionar los logs del migrator en su log group;
- no hay rollback de migración preparado (§9). Si el DDL quedó a medias, la
  recuperación depende del modo de fallo y es una intervención manual
  consciente, no un paso de checklist.

### GATE 4 — Grants

**Precondition** — GATE 3 verde.

**Action**
- disparar `Run production migrator` con `step = 02`.

**Verify**
- exit 0;
- las tres verificaciones del propio script:
  - tablas sin `SELECT` para `scope_app` → **0 filas**;
  - tablas con `TRUNCATE` para `scope_app` → **0 filas**;
  - `scope_app_reads_migration_history` → **`f`**;
- el conteo de `AcademicCourse` sigue en su valor de referencia (617).

**Stop if**
- exit distinto de 0;
- cualquier verificación devuelve filas;
- el conteo académico cambió (señal de pérdida de datos, no de permisos).

**Recovery**
- **no desplegar la API nueva.** Sin grants, `/admin` fallaría por permisos;
- el script es idempotente: se puede repetir sin daño.

### GATE 5 — Rollout de la API

**Precondition**
- GATE 3 y GATE 4 verdes.

**Action**
- aplicar el resto del plan (ya con `api_image_tag = <sha>`):

```
terraform -chdir=infra/terraform/prod plan  -out=prod.tfplan
terraform -chdir=infra/terraform/prod apply prod.tfplan
```

**Verify**
- el plan registra una revisión nueva de `scope-prod-api` y actualiza el
  servicio;
- revisar que el plan **no** traiga cambios no deseados (drift de
  infraestructura mezclado con el deploy);
- el deployment de ECS llega a estado estable;
- `GET /health` responde 200 por el ALB;
- los logs de la tarea de API no muestran errores de arranque ni de conexión.

**Stop if**
- el plan incluye cambios de infraestructura no revisados;
- el deployment no estabiliza.

**Recovery**
- **el circuit breaker de ECS está activo con `rollback = true`**: un
  deployment que no estabiliza vuelve automáticamente a la task definition
  anterior;
- rollback manual: volver `api_image_tag` al SHA previo y aplicar. Las
  migraciones **se dejan aplicadas** (§9).

### GATE 6 — Smoke de auth y admin

Ver §9. **No continuar a la web si falla.**

### GATE 7 — Bootstrap del primer PlatformAdmin

**Orden decidido: DESPUÉS del rollout de la API.** Justificación:

- la tabla `PlatformAdmin` debe existir → después de GATE 3;
- los grants deben estar → después de GATE 4;
- el `User` objetivo debe existir y estar `active`, y la forma natural de
  conseguirlo es que la persona se registre por la app → requiere la API
  corriendo;
- la capacidad no se necesita para que la API arranque: el guard existe pero
  sólo se evalúa cuando alguien pide `/admin`.

**Precondition**
- `<PLATFORM_ADMIN_EMAIL>` corresponde a un `User` ya existente, `status =
  active`, con email válido. **El script nunca crea cuentas.**

**Action** — ver el blocker de §10.3. Hoy **no existe un paso soportado** en
el workflow, y el script npm no funciona dentro de la imagen. El camino
disponible con los mecanismos actuales es un `run-task` manual con override de
comando:

```
node -r ts-node/register/transpile-only prisma/bootstrap-platform-admin.ts --email <PLATFORM_ADMIN_EMAIL>
```

(el `WORKDIR` de la imagen es `/app/services/api`, así que la ruta relativa
resuelve; el entrypoint del migrator ya exporta `DATABASE_URL`).

**Verify**
- salida `status = created` y el `platformAdminId` devuelto;
- una segunda corrida devuelve `already_exists` con el mismo id
  (idempotencia);
- se escribió **un** `AuditLog` `platform_admin_granted`
  (`actorType = system`, `actorId = null`);
- `GET /auth/me` con la sesión de esa persona devuelve `platformAdmin: true`.

**Stop if**
- el script reporta que el `User` no existe → registrar primero la cuenta por
  la app, no forzar nada en la base;
- reporta que no está `active` → resolver el estado de la cuenta primero;
- reporta más de un `User` con el mismo email difiriendo en mayúsculas →
  **falla cerrado a propósito**; resolver la inconsistencia a mano antes de
  otorgar nada.

**Qué NO hace el bootstrap:** no crea `User`, no crea ni cambia passwords, no
crea `AuthCredential`, no crea `IssuerMembership`, no crea `Issuer`.

**Recovery**
- otorgar la capacidad es **forward-only**: no hay procedimiento de revocación
  soportado por producto (§9).

### GATE 8 — Rollout de la web

**Precondition** — GATE 6 verde (la API nueva responde y `/admin` autoriza).

**Action**
- desplegar la web del mismo SHA en Vercel, con
  `NEXT_PUBLIC_API_BASE_URL` apuntando al host estable de la API.

**Verify**
- la raíz pública carga;
- login y sesión funcionan;
- `/admin` renderiza para el PlatformAdmin y redirige para quien no lo es;
- no hay secretos en la configuración de la web: sólo
  `NEXT_PUBLIC_API_BASE_URL`.

**Stop if**
- la web no puede resolver la API (CORS: `WEB_ORIGIN` de la API debe incluir
  el origen público de la web).

**Recovery**
- redeploy de la versión previa conocida-buena. Es la capa **más** reversible
  de todas.

---

## 9. Smoke tests

Todos **pendientes**, ninguno ejecutado. Preferencia general: verificar con
**lecturas** antes de crear cualquier dato.

### Auth

| # | Acción | Esperado |
|---|---|---|
| 1 | login con una cuenta conocida | 200 + token |
| 2 | `GET /auth/me` | 200 |
| 3 | `platformAdmin` para una cuenta normal | `false` |
| 4 | `platformAdmin` para el target del bootstrap | `true` |
| 5 | `onboardingIntent` de una cuenta legacy | `null`, no un valor inventado |
| 6 | `GET /auth/me` sin token | **401** (no 403) |

### Admin — sólo lecturas

| # | Actor | Acción | Esperado |
|---|---|---|---|
| 1 | PlatformAdmin | `GET /admin/issuers` | 200 |
| 2 | User normal | `GET /admin/issuers` | **403** |
| 3 | sin token | `GET /admin/issuers` | **401** |
| 4 | PlatformAdmin **sin** membership | `/admin` en la web | renderiza |
| 5 | PlatformAdmin | `GET /admin/issuers/:id/memberships` de un issuer existente | 200 |

Esto ya ejercita la tabla nueva y los grants, **sin escribir nada**. Si el
grant de GATE 4 hubiera fallado, el caso 1 fallaría acá.

### S5a — grant de membership (crea datos)

**Preferencia: usar un `User` demo y un `Issuer` demo existentes.** No tocar
una institución canónica sin intención explícita.

| # | Acción | Esperado |
|---|---|---|
| 1 | `POST /admin/issuers/:demoIssuerId/memberships` con el email de un User demo | **201**, `role: admin`, `status: active` |
| 2 | repetir la misma llamada | **409** |

**Dato que queda:** una `IssuerMembership` sobre el issuer demo. Es
descartable sólo en el sentido de que pertenece al conjunto demo regenerable —
pero **no existe endpoint de borrado**, así que queda hasta un rebuild
deliberado.

### S5b — alta de institución (crea datos permanentes)

**Recomendación: no correr este smoke en producción por defecto.**

`POST /admin/issuers` es create-only y **no hay endpoint de borrado ni de
deshabilitación**. Un smoke dejaría una institución permanente en el padrón
productivo. Validarlo en local o preprod (ya cubierto por el E2E de S7a), y
en producción sólo cuando sea parte de un alta real o de un rebuild
deliberado.

Si de todos modos se decide correrlo, usar un nombre inequívocamente
desechable (p. ej. `Scope Deployment Smoke <timestamp>`) y asumir que queda.

### Acceso institucional

| # | Situación | Esperado |
|---|---|---|
| 1 | la persona del grant revalida sesión (`/auth/me` o login nuevo) | aparece la membership; deja de estar pending |
| 2 | esa persona entra a `/issuer` | acceso |
| 3 | el PlatformAdmin **sin** membership sobre ese issuer | **sigue sin** autoridad institucional |

### readyToIssue — comportamiento esperado, no fallo

Una institución creada por S5b queda:

```
authorizationStatus = authorized
didConfigured       = false
walletConfigured    = false
readyToIssue        = false
```

**Eso es correcto y esperado.** No clasificarlo como fallo de deployment.

Y: **la emisión exitosa de una credencial NO forma parte del smoke de este
lote.** Un issuer sin identidad técnica falla cerrado en
`assertIssuerCanIssue` por diseño. La emisión on-chain pertenece a S8.

---

## 10. Rollback y acciones irreversibles

### Matriz por capa

| Capa | Reversibilidad | Mecanismo |
|---|---|---|
| **Web (Vercel)** | **REVERSIBLE** | redeploy de la versión previa |
| **API (ECS)** | **REVERSIBLE** | volver `api_image_tag` y aplicar. Además el circuit breaker rollea solo si un deployment no estabiliza |
| **AI (ECS)** | **REVERSIBLE** | ídem con `ai_image_tag` |
| **Migraciones de base** | **FORWARD-ONLY** | no hay SQL de rollback preparado |
| **Grants (`02`)** | idempotente, **no hace falta revertir** | sólo otorga |
| **Bootstrap PlatformAdmin** | **FORWARD-ONLY** | no hay revocación soportada |
| **Membership (S5a)** | **CREATE-ONLY** | no hay update, upsert ni delete |
| **Issuer (S5b)** | **CREATE-ONLY** | no hay delete ni disable |

### La regla importante

> Si hay que volver atrás, **se rollea la aplicación y se dejan las
> migraciones aplicadas.** No se finge un rollback de base de datos.

Es seguro precisamente porque las dos migraciones son aditivas y la API vieja
es compatible con la base migrada (§3, fila 2). Revertir el DDL sería más
riesgoso que dejarlo.

### Puntos de no retorno

En orden de aparición en el rollout:

1. **aplicar las migraciones** (GATE 3) — forward-only;
2. **bootstrapear el PlatformAdmin** (GATE 7) — otorga autoridad global;
3. **crear una membership con S5a** — create-only;
4. **crear una institución con S5b** — create-only, y sin borrado;
5. **rotar cualquier secreto** — `PROFILE_SHARE_TOKEN_KEY` invalida sobres
   existentes; `JWT_SECRET` invalida todas las sesiones;
6. **escrituras on-chain** — fuera de alcance hasta S8.

Algunas de estas podrían deshacerse con intervención manual en la base. **No
se documentan como rollback rutinario** porque no existe producto que las
soporte, y tratarlas como reversibles invitaría a usarlas sin cuidado.

---

## 11. Observabilidad

Dónde mirar cuando algo falla, por capa:

| Síntoma | Dónde |
|---|---|
| publicación de imagen falla | logs del workflow `Publish production images` en GitHub |
| migración o grant falla | logs del workflow `Run production migrator`, **y** el log group del migrator en CloudWatch (el workflow imprime exit code, reason y last status en una tabla) |
| la API no arranca o falla en runtime | log group de la API en CloudWatch; eventos del servicio ECS |
| el deployment no estabiliza | eventos del servicio ECS (el circuit breaker deja rastro) |
| health check falla | estado del target group del ALB; `/health` por el ALB |
| la web no habla con la API | logs de Vercel; red del navegador sólo para confirmar CORS/origen |

Las tareas tienen `enableExecuteCommand` por los roles de `ecs-exec`, lo que
permite una sesión interactiva en un contenedor si hace falta diagnóstico
profundo.

No se accedió a CloudWatch durante S7c, y no se inventa ningún dashboard: no
hay ninguno configurado.

### Timeouts vigentes (verificados contra Terraform)

| Parámetro | Valor |
|---|---|
| ALB idle timeout | **1200 s** |
| ALB deregistration delay | 900 s |
| ECS `stopTimeout` (api, ai, migrator) | **120 s** |
| health check | `/health`, matcher 200, interval 30 s, healthy 2, unhealthy 3 |

Los dos valores que el brief daba por conocidos (1200 s y 120 s) **siguen
vigentes**. No se cambian.

---

## 12. Blockers y contradicciones encontradas

### 12.1 El migrator y la API comparten `api_image_tag` — BLOCKER DE ORDEN

Descrito en §0. Avanzar el migrator obliga a avanzar la API, y "API nueva +
base sin migrar" es una caída de `/auth/me`.

**Mitigación con lo que ya existe:** el `-target` de GATE 2.

**Arreglo limpio (fuera de S7c):** una variable `migrator_image_tag` separada
en `infra/terraform/prod/variables.tf`, usada sólo por la task definition del
migrator. Es un cambio de Terraform y S7c no lo hace.

### 12.2 El workflow del migrator no cadena `migrate` → `02`

El input `step` es una elección entre cinco comandos independientes. **No hay
ningún automatismo** que corra los grants después de migrar. El checklist los
trata como GATE 3 y GATE 4 separados y ambos obligatorios.

No es un defecto: un paso manual explícito es preferible a un encadenamiento
implícito. Pero hay que saberlo.

### 12.3 No hay camino soportado para el bootstrap en producción — BLOCKER

Dos razones concurrentes:

1. `npm run bootstrap:platform-admin` es
   `node --env-file=.env -r ts-node/... prisma/bootstrap-platform-admin.ts`.
   **`.dockerignore` excluye `.env`**, así que la imagen no lo tiene y el
   comando fallaría por archivo inexistente;
2. el input `step` del workflow del migrator **no tiene** una opción de
   bootstrap.

Lo que **sí** funciona: el script en sí es correcto dentro de la imagen.
Instancia `PrismaClient` dentro de `main()` leyendo `process.env.DATABASE_URL`
—que el entrypoint del migrator exporta—, y `ts-node` está disponible porque
`npm ci` corre **antes** de que el Dockerfile fije `NODE_ENV=production`, así
que las devDependencies quedan instaladas.

**Opciones, en orden de preferencia:**

| | Opción | Costo |
|---|---|---|
| A | `aws ecs run-task` manual con override de comando (§8, GATE 7) | ninguno; usa lo existente |
| B | agregar un `step: bootstrap` al workflow | cambio de workflow, fuera de S7c |
| C | agregar un script npm sin `--env-file` | cambio de `package.json`, fuera de S7c |

La opción B sería la correcta a mediano plazo: deja el bootstrap auditado
detrás del GitHub Environment con reviewer, igual que los demás pasos.

### 12.4 Headers de los SQL desactualizados

Ambos scripts dicen **`STATUS: reviewed, not run`**, y el de `01` agrega
*"Nothing in this repository executes this file"*. Eso ya **no es cierto**:
`run-production-migrator.yml` ejecuta los dos por `psql`. Además
`infra/terraform/README.md` lista *"Any GitHub Actions workflow file"* y
*"`sql/` is a design artifact"* entre lo que la configuración deliberadamente
no crea — ambas afirmaciones quedaron atrás.

No las corregí: están fuera del alcance documental de S7c y tocarlas mezclaría
slices. **Queda reportado como limpieza pendiente.**

### 12.5 No hay política de backup pre-migración

El repositorio define `deletion_protection` y un snapshot final para el
destroy, pero **nada** sobre un checkpoint antes de una tanda de migraciones.
El checklist lo marca como decisión explícita del operador en GATE 2 en vez de
asumir que existe.

### 12.6 Runbooks de deployment obsoletos

`docs/architecture/` contiene `render-api-deployment-runbook-v0.md`,
`render-ai-private-service-runbook-v0.md`,
`render-ai-cloud-deployment-record-v0.md` y
`neon-demo-database-runbook-v0.md`, que describen un stack **anterior**
(Render + Neon). El stack actual es AWS ECS + RDS.
`vercel-frontend-deployment-runbook-v0.md` sigue siendo pertinente para la
web.

No los toqué. **Limpieza pendiente**, a decidir si se archivan o se marcan
como históricos.

### 12.7 README raíz — recordatorio

Sigue muy desactualizado (ya reportado en S7b). S7c **no** lo aprovechó para
reescribirlo.

---

## 13. Frontera con S8

Este lote deja el circuito **administrativo** completo y desplegable. Lo que
**no** resuelve, y que ninguna parte de este checklist habilita:

- signer (global o por institución);
- provisioning del DID de la institución;
- wallet institucional;
- custodia de claves;
- contrato de registry;
- blockchain real / Base Sepolia.

`BLOCKCHAIN_EVIDENCE_MODE` permanece en `mock`, fijado por Terraform como
parámetro String flipable en runtime. **S7c no lo cambia.**

Consecuencia operativa que conviene tener presente: después de este deploy, un
PlatformAdmin podrá dar de alta instituciones y asignar administradores, y esas
instituciones **no podrán emitir credenciales**. Eso no es un defecto del
deployment: es el límite que S8 levanta.

> La identidad técnica del emisor queda pendiente de S8. Este documento no
> decide cómo se custodiarán las claves ni afirma nada sobre su diseño.

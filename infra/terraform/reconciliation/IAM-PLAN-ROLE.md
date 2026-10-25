# Rol IAM dedicado para `terraform plan` — PROPUESTA (no creada)

**Estado: PROPUESTA REVISABLE. El rol NO existe, nada se adjuntó, nada se probó en AWS.** Archivos de esta propuesta: [`iam/terraform-plan-role.permissions.template.json`](iam/terraform-plan-role.permissions.template.json) (política de permisos), [`iam/terraform-plan-role.trust.template.json`](iam/terraform-plan-role.trust.template.json) (confianza) e [`iam/provider-reads.inventory.json`](iam/provider-reads.inventory.json) (lecturas por tipo de recurso). Verificador local: `infra/terraform/guards/iam-plan-policy-check.mjs`.

Las plantillas **no son operativas tal cual**: llevan `__ACCOUNT_ID__` y `__STATE_BUCKET__`; no se inventó ningún id. Fuera de eso, todo nombre (`scope-prod-*`, `us-east-1`, clave de estado) proviene del código o de lecturas ya hechas.

## 1. Contrato del backend S3 (evidencia)

Configuración real (`prod/versions.tf` + `backend.hcl` local): `key = envs/prod/terraform.tfstate`, `region = us-east-1`, `encrypt = true`, `use_lockfile = true`, workspace `default`, sin `kms_key_id`. Bucket (`bootstrap/main.tf`): versionado ON, cifrado **SSE-S3 (`AES256`)**, bloqueo de acceso público, política que **solo** niega transporte no TLS (no restringe principales), expiración de versiones no actuales.

| Permiso | Recurso | ¿Lo concede la propuesta? | Fundamento |
|---|---|---|---|
| `s3:ListBucket` | el bucket | **Sí** | Documentación oficial del backend S3 (existencia de la clave y enumeración de workspaces). Sin condición `s3:prefix` (la oficial la usa como ejemplo; endurecerla **no se probó**) |
| `s3:GetObject` | `…/envs/prod/terraform.tfstate` | **Sí** | Leer el estado para refrescar |
| `s3:PutObject` | la **clave de estado** | **No — Deny explícito** | La documentación lo lista para el backend en general, **pero no dice si un `plan` lo necesita** (solo aclara que `DeleteObject` no hace falta sobre el estado). Hipótesis a falsar: *un plan no persiste el estado*. Si fuera falsa, el primer `init`/`plan` falla con `AccessDenied` **sin modificar nada** (ver 3) |
| `s3:DeleteObject` | la clave de estado | **No — Deny** | La documentación indica que Terraform no la borra |
| `s3:GetObject` / `PutObject` / `DeleteObject` | `…/envs/prod/terraform.tfstate.tflock` | **Sí** (solo ese objeto) | `use_lockfile = true`: el *lock* es el objeto `<clave>.tflock` (escritura condicional al adquirir, borrado al liberar, lectura para informar quién lo tiene) |
| `kms:*` | — | **No — Deny** | El bucket es SSE-S3: no hay clave de cliente que usar. Si algún día se cambia a KMS, habrá que agregar `kms:Decrypt`/`GenerateDataKey` acotados a esa clave y quitar el Deny **a propósito** |
| acceso a otros objetos/estados | `…/*` | **No** | Ningún `Resource` de S3 lleva comodín; `Deny` de escritura sobre todo lo que no sea el `.tflock` |

**¿Se puede una identidad que no modifique el estado?** *Probablemente sí, no probado.* El *lock* es otro objeto, así que se puede permitir su escritura sin permitir la del estado; y un plan no debería escribir el estado. Por eso la propuesta **deniega** la escritura del estado (explícito, no solo ausente) y trata el primer `plan` como la **prueba** de la hipótesis. **Alternativa si resultara falsa** (decisión humana, no automática): conceder `s3:PutObject` solo sobre la clave de estado, aprovechando el **versionado del bucket** (cada escritura es una versión recuperable durante `noncurrent_state_version_retention_days`) y documentando que el rol deja de ser "no puede modificar el estado". **No** se usa `-lock=false` como atajo, **no** se descarga una copia del estado (contiene datos sensibles) y **no** se concede acceso general a S3.

**Si el primer plan falla por `s3:PutObject` sobre el estado, NO se amplía automáticamente.** La falta de ese permiso es una hipótesis deliberada: el fallo se documenta (acción, recurso, momento), se detiene el procedimiento y la ampliación queda como decisión humana separada.

**Advertencia — `terraform.tfstate` puede contener información sensible.** Que el rol no pueda consultar SSM `SecureString`, Secrets Manager ni KMS **no** protege lo que el propio estado ya almacena: atributos que el provider guarda en claro (p. ej. valores de parámetros `String`, variables de entorno de task definitions, identificadores y ARN internos, políticas de roles, endpoint y usuario de la base). Quien puede hacer `s3:GetObject` sobre `envs/prod/terraform.tfstate` puede leer todo eso, aunque nunca llame a los servicios de secretos. Por eso: `GetObject` sobre el estado queda limitado a **esa única clave**; la sesión dura ≤ 1 h; nunca se descarga, imprime ni adjunta el estado ni el plan (`PLAN-PROCEDURE.md`); y el acceso queda registrado en CloudTrail (eventos de datos de S3 solo si están habilitados: **no verificado**).

## 2. Inventario de permisos del provider AWS (refresh de un plan)

Tipos de recurso del root integrado: **31** (`resource "aws_*"` de `prod/*.tf`); solo `data.aws_caller_identity` llama a AWS (`sts:GetCallerIdentity`, sin permiso IAM). Cada tipo → lecturas en `provider-reads.inventory.json` (**propuesta sin probar**). El verificador exige que **todo tipo de recurso del código tenga entrada** y que la política conceda esas lecturas: un tipo nuevo obliga a revisar permisos.

| Servicio | Acciones | Recurso al que se restringe | ¿AWS exige `"*"`? | Terraform lee… | Riesgo residual |
|---|---|---|---|---|---|
| EC2/VPC | `DescribeVpcs`, `DescribeVpcAttribute`, `DescribeSubnets`, `DescribeInternetGateways`, `DescribeRouteTables`, `DescribeNetworkAcls`, `DescribeSecurityGroups`, `DescribeSecurityGroupRules`, `DescribeVpcEndpoints`, `DescribePrefixLists`, `DescribeTags` | `*` + `aws:RequestedRegion = us-east-1` | **Sí** (los `Describe*` de EC2 no admiten recurso) | `aws_vpc`, `aws_subnet`, `aws_internet_gateway`, `aws_route_table(_association)`, `aws_vpc_endpoint`, `aws_security_group`, 27 reglas | Ve metadatos (ids, etiquetas, CIDR) de **toda** la región, no solo de Scope |
| ELBv2 | `DescribeLoadBalancers/Attributes`, `DescribeTargetGroups/Attributes`, `DescribeListeners`, `DescribeListenerAttributes`, `DescribeTags` | `*` + región | **Sí** | `aws_lb`, `aws_lb_target_group`, `aws_lb_listener` ×3 | Idem (todos los balanceadores de la región) |
| ECS | `DescribeClusters`; `DescribeServices`; `ListTagsForResource` | cluster `scope-prod-cluster`; servicios `scope-prod-cluster/scope-prod-*`; task defs `scope-prod-*:*` | no | `aws_ecs_cluster`, `aws_ecs_service` ×2 | bajo |
| ECS | `DescribeTaskDefinition` | `*` + región | **Sí** | `aws_ecs_task_definition` ×5 | Lee cualquier task definition de la región (incluye variables de entorno **no secretas**; los secretos son referencias a SSM) |
| ECR | `DescribeRepositories`, `ListTagsForResource`, `GetLifecyclePolicy` | `repository/scope/*` | no | `aws_ecr_repository` ×3, `aws_ecr_lifecycle_policy` ×2 | bajo (no incluye `GetAuthorizationToken` ni lectura de imágenes) |
| CloudWatch Logs | `DescribeLogGroups` | `*` + `aws:RequestedRegion = us-east-1` | **Sí** (Service Reference de AWS: sin tipos de recurso; un ARN de log group **nunca** la autoriza) | `aws_cloudwatch_log_group` ×5 | Ve **nombres** y metadatos de todos los log groups de la región (nunca eventos) |
| CloudWatch Logs | `ListTagsForResource`, `ListTagsLogGroup` | `log-group:/scope/prod/*` | no | etiquetas | bajo (nunca `GetLogEvents`) |
| IAM | `GetRole`, `GetRolePolicy`, `ListRolePolicies`, `ListAttachedRolePolicies`, `ListRoleTags` | los **14** roles `scope-prod-*` que el código declara (incluido el rol operador de la sonda, por si está en el estado) | no | `aws_iam_role` ×12, `aws_iam_role_policy` ×13 | Lee políticas de confianza y de permisos de esos roles (no son secretos; sí información de seguridad) |
| IAM | `GetOpenIDConnectProvider`, `ListOpenIDConnectProviderTags` | proveedor `token.actions.githubusercontent.com` | no | `aws_iam_openid_connect_provider` | bajo |
| RDS | `DescribeDBInstances` | `db:*` (cuenta/región) — **corregido tras el Plan A**: el provider refresca la instancia por id de recurso y AWS autoriza contra `db:*` (AccessDenied real sobre `…:db:*`) | no | `aws_db_instance` | Ve las instancias RDS de la región (metadatos; sin `DescribeDBSnapshots` ni Secrets Manager) |
| RDS | `DescribeDBSubnetGroups`, `ListTagsForResource` | `db:scope-prod-db`, `subgrp:scope-prod-db` (sin cambios) | no | `aws_db_instance`, `aws_db_subnet_group` | bajo (sin `DescribeDBSnapshots`; sin Secrets Manager: la contraseña la gestiona RDS y el provider solo ve el ARN) |
| ACM | `DescribeCertificate`, `ListTagsForCertificate` | `certificate/*` (ids no conocidos de antemano) | no | `aws_acm_certificate` | Ve certificados de la región |
| SSM | `GetParameter`, `ListTagsForResource` | **10 ARN exactos** (los `String` que Terraform crea; derivados de `locals.tf`) | no | `aws_ssm_parameter` ×10 | El provider lee con `WithDecryption`; por eso **solo** esos 10, **ninguno** SecureString |
| SSM | `DescribeParameters` | `*` + región | **Sí** | metadatos del parámetro | Lista nombres/tipos/fechas, **no valores** |
| Cloud Map | `GetNamespace` (`namespace/*`), `GetService` (`service/*`) | `namespace/*`, `service/*` | no (ids desconocidos) | `aws_service_discovery_*` | bajo |
| Cloud Map | `ListTagsForResource` | `*` + `aws:RequestedRegion = us-east-1` | **Sí** (Service Reference de AWS: sin tipos de recurso) | etiquetas de `aws_service_discovery_*` | Lee etiquetas de cualquier namespace/servicio de la región |
| Step Functions | `DescribeStateMachine`, `ListStateMachineVersions` (**agregada tras el Plan A**; AccessDenied real), `ListTagsForResource` | 2 state machines (`scope-prod-ecs-sync-probe`, `scope-prod-issuer-provisioner`) | no | `aws_sfn_state_machine` ×2 | bajo (sin `StartExecution`/historial) |
| S3 | ver sección 1 | bucket / estado / `.tflock` | no | backend | ver sección 1 |

**No incluidos a propósito:** `route53:*`, `cloudwatch:*`, `logs:DescribeMetricFilters` (recursos con `count = 0`; si alguno estuviera en el estado el refresh daría `AccessDenied` nombrando la acción y el plan lo mostraría como destrucción, que se rechaza); Secrets Manager; KMS; lectura de objetos del bucket de evidencias; cualquier escritura de infraestructura.

**Limitaciones de IAM** (por qué quedan comodines): los `Describe*` de EC2 y ELBv2, `ecs:DescribeTaskDefinition`, `ssm:DescribeParameters`, **`logs:DescribeLogGroups`** y **`servicediscovery:ListTagsForResource`** no admiten `Resource` por ARN (la Service Reference oficial de AWS no les lista tipos de recurso); se compensa con `aws:RequestedRegion = us-east-1`. Los ids de ACM/Cloud Map no son conocidos de antemano. `ec2:DescribeVpcAttribute` sí admite el tipo `vpc`, pero se deja con `*` porque el id de la VPC no se conoce antes del plan (un `*` siempre autoriza; no se estrecha).

**Contraste con la referencia oficial (5.4b):** cada acción `Allow` y cada acción de los `Deny` se comparó con la Service Reference de AWS (`https://servicereference.us-east-1.amazonaws.com/v1/<servicio>/<servicio>.json`, forma programática del *Service Authorization Reference*). Resultado: **2 incompatibilidades** (`logs:DescribeLogGroups`, `servicediscovery:ListTagsForResource`), corregidas; el resto es coherente. `iam-plan-policy-check.mjs` conserva la lista `WILDCARD_ONLY_ACTIONS` y falla si alguna de esas acciones vuelve a quedar limitada a un ARN. Es una verificación **de la referencia**, no del motor de IAM: la prueba definitiva es el análisis de AWS (sección 8) y el primer plan.

## 3. Cómo se falsa la propuesta (sin riesgo)

Cualquier acción de lectura faltante produce `AccessDenied` **que nombra la acción**: no cambia nada. Cualquier intento de escribir el estado produce `AccessDenied` y el estado queda intacto (hay versionado). Procedimiento ante un `AccessDenied`: **detenerse**, anotar la acción, revisión humana, agregar **solo** esa lectura a la plantilla y volver a verificarla con `iam-plan-policy-check.mjs`. **Nunca** cambiar a `scope-provisioner-apply` ni a `default` (ese perfil local es **root**) para "que pase".

**Evidencia empírica adicional (pendiente, solo lectura):** CloudTrail conserva 90 días de eventos de gestión, que incluyen las lecturas que hizo el provider durante el apply del 22-oct con el rol de aplicación. Extrayendo `eventSource:eventName` (sin parámetros ni respuestas) se obtiene la lista real de lecturas, que se contrasta con la política con `--observed`:

```bash
# [SOLO LECTURA] (requiere cloudtrail:LookupEvents; la sesión AWS de esta etapa estaba vencida, no se ejecutó)
aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventSource,AttributeValue=ecs.amazonaws.com \
  --start-time 2026-10-22T00:00:00Z --end-time 2026-10-23T00:00:00Z --max-results 50 --output json \
  | jq -r '.Events[].CloudTrailEvent | fromjson | select(.userIdentity.sessionContext.sessionIssuer.userName=="scope-prod-terraform-provisioner-apply") | "\(.eventSource):\(.eventName)"' | sort -u
# repetir por servicio (ec2, elasticloadbalancing, ecr, iam, rds, ssm, acm, logs, states, servicediscovery, s3) y juntar en eventos.txt
node infra/terraform/guards/iam-plan-policy-check.mjs --observed eventos.txt
```
(No imprimas ni guardes `requestParameters`/`responseElements`.)

## 4. Diseño de la identidad

- **Rol** `scope-prod-terraform-plan` (nombre propuesto; mismo patrón que `scope-prod-terraform-provisioner-apply`, que el perfil `scope-provisioner-apply` asume desde `scope-signin`).
- **Permisos:** **una política inline** (8 136 caracteres según el verificador, 24 sentencias: **no cabe** como política gestionada, 6 144; el límite inline es 10 240) = la plantilla. Sin políticas gestionadas de AWS adjuntas. *Opcional:* usar la misma política como **límite de permisos** para que nadie pueda ampliar el rol sin tocar el límite.
- **Confianza:** `sts:AssumeRole` para **`arn:aws:iam::<ACCOUNT_ID>:user/scope-operator`** (el usuario real, no la raíz de la cuenta) con `StringLike sts:RoleSessionName = tf-plan-*` y `Bool aws:MultiFactorAuthPresent = true`. En la misma cuenta, nombrar al usuario en la confianza **basta**: no hace falta modificar la política de `scope-operator`.
  - *Riesgo de la condición MFA:* no se sabe si una sesión de `aws login` transporta el contexto MFA; si no, el `assume-role` **fallará** (falla segura). Decisión humana: mantenerla o quitarla y documentar. **La MFA NO se quita por conveniencia.**
  - **Revisión de la confianza (5.4b)** sobre `iam/terraform-plan-role.trust.template.json`: una sola sentencia `Allow` / `sts:AssumeRole`; principal = el usuario `scope-operator` (no `:root`, no `*`, sin cuenta entera, sin `Service`, sin federación); sesión `tf-plan-*`; `aws:MultiFactorAuthPresent = true`. Un rol **no tiene claves permanentes**: solo credenciales temporales de STS. La duración máxima (1 h) **no es parte de la política de confianza**: es la propiedad del rol `MaxSessionDuration = 3600`, que se fija al crearlo (`--max-session-duration 3600`, también es el valor por defecto) y se **verifica** con `aws iam get-role` tras el aprovisionamiento. Ningún otro principal puede asumirlo mientras la confianza nombre solo a ese usuario (en la misma cuenta, ni siquiera un administrador sin permiso explícito en la confianza lo asume por la vía de la confianza; sí podría modificarla, por eso la creación/edición del rol es una acción IAM humana y auditada).
  - **Cómo verificar MFA con la sesión real `scope-signin` (después de aprovisionar, solo lectura/`assume-role`):** (1) `aws sts get-caller-identity --profile scope-signin` (debe ser el usuario `scope-operator`); (2) `aws sts assume-role --role-arn <ARN del rol> --role-session-name tf-plan-verificacion --duration-seconds 900 --profile scope-signin` y descartar el resultado sin imprimir credenciales (o usar el perfil `scope-terraform-plan` con `get-caller-identity`); (3) `AccessDenied` ⇒ la sesión no transporta MFA **o** la confianza no coincide: mirar el evento `AssumeRole` en CloudTrail (`errorMessage`, `userIdentity`, `mfaAuthenticated`) antes de tocar nada. **Opción de AWS CLI compatible, solo explicada (no se aplicó ni se modificó `~/.aws/config`):** si la fuente son credenciales de largo plazo de un usuario IAM, el perfil de rol admite `mfa_serial = arn:aws:iam::<ACCOUNT_ID>:mfa/<dispositivo>` junto a `source_profile`, y la CLI pide el código TOTP en cada asunción; una sesión de `aws login` es temporal, así que esta vía exige verificar antes si ese tipo de sesión admite `mfa_serial`/`get-session-token` (no verificado). Si no hubiera forma compatible, la decisión (mantener MFA y cambiar el mecanismo de inicio de sesión del operador, o aceptar un control compensatorio) es humana y se documenta; el `Bool aws:MultiFactorAuthPresent` se mantiene hasta entonces.
- **Duración:** `MaxSessionDuration = 3600` (la mínima) y sesiones nombradas `tf-plan-…`: identidad **temporal**, sin claves de acceso.
- **Perfil local del operador** (archivo local, no versionado):
  ```ini
  [profile scope-terraform-plan]
  role_arn = arn:aws:iam::<ACCOUNT_ID>:role/scope-prod-terraform-plan
  source_profile = scope-signin
  role_session_name = tf-plan-operator
  duration_seconds = 3600
  region = us-east-1
  ```
- **No se modifica** `scope-provisioner-apply`, ni `scope-operator`, ni ninguna política vigente.

## 5. Alternativas evaluadas

| Alternativa | Veredicto | Motivo |
|---|---|---|
| **A. Rol dedicado de auditoría** (esta propuesta) | **Recomendada** | Mínimo privilegio **impuesto por IAM**: aunque el operador quisiera, el rol no puede aplicar. Confianza restrictiva, sesiones de 1 h, evidencia en CloudTrail por rol |
| B. Sesión temporal restringida de una identidad existente (asumir el rol de aplicación con una *session policy* de solo lectura) | **Descartada** | La *session policy* la elige quien asume el rol: omitirla devuelve todos los permisos de aplicación. Es una promesa operativa, no una garantía de IAM. Además `scope-operator` no tiene claves de acceso, así que `GetFederationToken` no aplica |
| C. Usar `scope-operator` tal cual | Descartada | Ya se vio `AccessDenied` en varios servicios; ampliarlo cambiaría una identidad humana |
| D. `scope-provisioner-apply` para planificar | Descartada | Es la identidad que **puede aplicar**; la decisión fue separarla |
| E. `-lock=false` con permisos de solo lectura | Descartada por el arquitecto | Peligroso si hay operaciones concurrentes; solo como excepción documentada |
| F. Descargar una copia del estado para planificar offline | Descartada | El estado puede contener datos sensibles; prohibido en esta etapa |
| G. `AdministratorAccess` / perfil `default` (**root**) | Prohibidas | — |

## 6. Habilitación (acciones EXTERNAS con aprobación humana; no ejecutadas)

1. Revisión de la política por el arquitecto/seguridad. Completar valores: la cuenta (`aws sts get-caller-identity`, que ya conoce el operador) y el bucket (`backend.hcl`).
2. Renderizar en un archivo temporal **fuera del repositorio** (`sed -e 's/__ACCOUNT_ID__/<id>/g' -e 's/__STATE_BUCKET__/<bucket>/g'`), y volver a validar con `iam-plan-policy-check.mjs` (sobre la plantilla).
3. **Validación de AWS (solo lectura, sin crear nada) — ver sección 8:** `aws accessanalyzer validate-policy` sobre ambas plantillas renderizadas. Debe estar sin errores antes del paso 4. Opcional además: `aws iam simulate-custom-policy --policy-input-list file://<renderizada> --action-names … --resource-arns …` para contrastar el motor real de IAM con el evaluador local (requiere `iam:SimulateCustomPolicy` y sesión vigente).
4. **Crear el rol** `[REQUIERE APROBACIÓN HUMANA — MODIFICA AWS (IAM)]`, por quien tenga autoridad IAM (propietario de la cuenta, **no** esta herramienta):
   ```bash
   aws iam create-role --role-name scope-prod-terraform-plan --assume-role-policy-document file://trust.rendered.json --max-session-duration 3600 --tags Key=Project,Value=scope Key=Purpose,Value=terraform-plan-readonly
   aws iam put-role-policy --role-name scope-prod-terraform-plan --policy-name terraform-plan-read --policy-document file://permissions.rendered.json
   ```
   (Quién ejecuta esto es una **decisión pendiente**: ver informe 5.4, sección K.)
5. Perfil local `scope-terraform-plan` (sección 4).
6. Verificación **sin tocar datos** `[SOLO LECTURA]`: `aws sts get-caller-identity --profile scope-terraform-plan` (debe mostrar `assumed-role/scope-prod-terraform-plan`) y pruebas negativas con **`aws iam simulate-principal-policy`** (no con llamadas reales): `ssm:GetParameter` sobre un SecureString, `s3:PutObject` sobre el estado, `ecs:UpdateService`, `iam:PassRole` ⇒ deben dar denegado.
7. Solo entonces, el procedimiento de planes (`PLAN-PROCEDURE.md`).
8. **Revocación:** al terminar, eliminar el perfil local y, según decisión, borrar el rol o dejarlo con la confianza deshabilitada.

## 7. Qué está probado y qué no

| Probado (localmente) | Propuesta | Requiere acción externa |
|---|---|---|
| JSON válido; estructura; ausencia de permisos de despliegue/secretos; alcance S3 (bucket, estado, `.tflock`); 10 parámetros SSM derivados del código; cobertura de los 31 tipos de recurso; tamaño inline 8 136/10 240; 65 escenarios permitir/denegar con un evaluador **local simplificado**; 55 pruebas (incluye 40 mutaciones —33 de la política y 7 de la confianza— y las regresiones de 5.4b: `logs:DescribeLogGroups` y `servicediscovery:ListTagsForResource` con ARN); cada acción contrastada con la Service Reference de AWS | Lista de lecturas del provider; que un plan no escribe el estado; que `aws login` transporte MFA | Crear el rol; sesión AWS vigente; **Access Analyzer `validate-policy` (PENDIENTE)**; CloudTrail; primer `init`/`plan` |

## 8. Validación con AWS Access Analyzer (solo lectura) — PENDIENTE

Requiere sesión vigente (`aws login`, acción humana) y `access-analyzer:ValidatePolicy`. **No crea ni modifica nada** (no necesita un analizador). Renderizar las plantillas en un directorio **fuera del repositorio**, con los valores reales ya conocidos por el operador; **no** guardar ni pegar esos valores en el repositorio:

```bash
aws accessanalyzer validate-policy --policy-type IDENTITY_POLICY \
  --policy-document file://permissions.rendered.json --locale EN --region us-east-1 --profile scope-signin

aws accessanalyzer validate-policy --policy-type RESOURCE_POLICY \
  --validate-policy-resource-type AWS::IAM::AssumeRolePolicyDocument \
  --policy-document file://trust.rendered.json --locale EN --region us-east-1 --profile scope-signin
```

Revisar los `findings` (`ERROR`, `SECURITY_WARNING`, `WARNING`, `SUGGESTION`): acciones inválidas, recursos incompatibles con la acción (el tipo de error de `logs:DescribeLogGroups`), condiciones mal formadas. Cualquier `ERROR` o `SECURITY_WARNING` se resuelve **antes** de crear el rol. Los hallazgos `WARNING`/`SUGGESTION` se evalúan uno a uno (p. ej. avisos por `Resource "*"` en los `Describe*` son esperados y están compensados por `aws:RequestedRegion`). Hasta ejecutarlo con una sesión real, **la validación local no equivale a la evaluación de IAM de AWS**.

## 9. Comparar la política local con la guardada en IAM (identidad con `iam:GetRolePolicy`)

No se asume que la política guardada en IAM sea idéntica a la plantilla: se compara. Con un perfil explícito autorizado (nunca root) y la plantilla renderizada fuera del repositorio:

```bash
diff <(aws iam get-role-policy --role-name scope-prod-terraform-plan --policy-name terraform-plan-read --query PolicyDocument --output json --profile <perfil> | jq -S .) <(jq -S . permissions.rendered.json) && echo identica
```

El diff debe mostrar **solo** las ampliaciones aprobadas (tras el Plan A: `rds:DescribeDBInstances` sobre `db:*` y `states:ListStateMachineVersions` sobre las dos state machines). Todo otro cambio detiene el procedimiento. Antes de actualizarla, validar el JSON renderizado con Access Analyzer (sección 8).

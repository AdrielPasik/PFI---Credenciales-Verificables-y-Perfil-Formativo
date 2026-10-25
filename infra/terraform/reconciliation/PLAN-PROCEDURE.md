# Procedimiento — primer `terraform plan` real (baseline e integrado)

**Estado: PREPARADO, NO EJECUTADO.** Ningún comando de este documento que toque el estado remoto se ejecutó.
Requiere **autorización explícita** (ver informe 5.3, sección N).

Etiquetas: `[LOCAL]` solo archivos locales · `[LEE ESTADO REMOTO]` lee el backend S3 (y toma el *lock*) pero **no modifica recursos** · `[APLICA]` modifica AWS (no forma parte de este procedimiento).

## 0. Reglas

- **No `-lock=false` por defecto.** El bloqueo del estado se usa normalmente, en una **ventana coordinada** en la que nadie despliega ni ejecuta Terraform. `-lock=false` es peligroso si puede haber operaciones concurrentes (HashiCorp). Solo como **excepción documentada** (p. ej. bloqueo huérfano, con el dueño confirmado ausente y aprobación escrita); nunca `force-unlock` sin investigar quién lo tiene.
- Prohibidos en este procedimiento: `apply`, `refresh` suelto, `import`, `state push|rm|mv`, `taint`, `destroy`.
- El plan puede contener valores de recursos (variables de entorno, nombres de buckets). **No se versiona ni se comparte**: vive en un directorio local protegido y se borra al terminar; solo se conserva evidencia **sanitizada** (direcciones y acciones).
- Un resultado "sin cambios" del plan **no** autoriza un `apply`: es evidencia de reconciliación.

## 0 bis. Identidad (PRERREQUISITO de los pasos de plan)

Los planes se ejecutan con una identidad **dedicada y temporal** de solo lectura, **no** con `scope-provisioner-apply` (puede aplicar), **ni** con `scope-operator` (insuficiente), **ni** con el perfil `default` (**es root**). Diseño y política propuestos: [`IAM-PLAN-ROLE.md`](IAM-PLAN-ROLE.md). Perfil local previsto: `scope-terraform-plan` (rol `scope-prod-terraform-plan`, sesiones de 1 h). **Mientras ese rol no esté creado, aprobado y verificado, los pasos 8–12 de la lista de control (sección 11) no se ejecutan.**

Detalle del bloqueo de S3: el backend con `use_lockfile` **escribe y borra el objeto `…terraform.tfstate.tflock`** aun en un plan (eso es el bloqueo normal; no se usa `-lock=false`). La política **no** concede escritura sobre el objeto de estado; si un plan la necesitara, fallará con `AccessDenied` sin modificar nada y se decide a mano (ver `IAM-PLAN-ROLE.md`, sección 1).

## 1. Identificar sin ambigüedad qué se usa

Registrar en la evidencia (no contiene secretos):

```bash
# [LOCAL] en cada árbol
git rev-parse HEAD
git status --short | sha256sum                     # el integrado NO está commiteado
git diff origin/main --binary | sha256sum          # huella del código exacto (árbol integrado)
sha256sum infra/terraform/prod/terraform.tfvars infra/terraform/prod/*.auto.tfvars
```
Árboles: **A (baseline)** = worktree limpio de `origin/main` (`git worktree add ../PFI-baseline origin/main`);
**B (integrado)** = `integration/password-recovery-5-2`. **Mismo `terraform.tfvars` en ambos.**

## 2. Preparar entradas (nunca el tfvars viejo)

1. Copiar `reconciliation/prod.reconciled.tfvars.template` a `infra/terraform/prod/terraform.tfvars` **de cada árbol** (archivo ignorado por git) y **completar cada marcador `<...>`** con evidencia de solo lectura (cómo, en la propia plantilla); los valores reales **no** se versionan. Un marcador sin completar hace fallar la guarda (§3). El `terraform.tfvars` viejo del repo original **no se toca**.
2. Resolver con evidencia cualquier `[PENDIENTE]`/`[INFERIDO]` que el informe 5.3 marque como bloqueante (hoy ninguno bloquea el plan; los inferidos se confirman *con* el plan).
3. `backend.hcl` (ya existente localmente, ignorado): copiarlo al árbol A; el B ya lo tiene si se reutiliza.

## 3. Guarda de solo lectura (cada árbol, antes del plan)

```bash
# [LOCAL + lecturas AWS] debe terminar en 0; con 1 o 2 NO se continúa
node infra/terraform/guards/pre-plan-guard.mjs \
  --tfvars infra/terraform/prod/terraform.tfvars \
  --tfvars infra/terraform/prod/ecs_sync_probe.auto.tfvars \
  --profile <perfil de lectura>
```
Un `0` solo dice que unas propiedades críticas coinciden con AWS; **no** predice el plan.

## 4. Verificar identidad, cuenta, región, backend y workspace

```bash
# [LEE AWS] la cuenta esperada la conoce el operador (no se imprime en informes)
aws sts get-caller-identity --query Arn --output text         # usuario/rol esperado, NO root
grep -E 'bucket' infra/terraform/prod/backend.hcl             # scope-tfstate-<cuenta>-us-east-1
# versions.tf fija: key envs/prod/terraform.tfstate, region us-east-1, encrypt, use_lockfile
```
Workspace esperado: **`default`** (no existe `.terraform/environment` en el árbol original). Se comprueba tras `init`.

## 5. Inicializar y validar

```bash
cd infra/terraform/prod
terraform init -input=false -backend-config=backend.hcl      # [LEE ESTADO REMOTO] con la identidad de plan (AWS_PROFILE=scope-terraform-plan); escribe solo .terraform/ local
terraform workspace show                                     # debe decir: default
terraform validate
```
Los providers vienen de `.terraform.lock.hcl` (versionado): `hashicorp/aws 6.66.0`. Si `init` quisiera actualizar el lock, **detenerse**.

## 6. El plan (lock normal, ventana coordinada)

```bash
EVID="$HOME/scope-plan-evidence-$(date +%Y%m%d-%H%M)"; (umask 077; mkdir -p "$EVID")   # fuera del repo
# Terraform para Windows NO entiende rutas de Git Bash (/c/Users/...): "Failed to write plan file ... cannot find the path".
# Pasarle SIEMPRE una ruta nativa (C:/Users/... o C:\Users\...). En Git Bash: cygpath -m. En Linux/macOS cygpath no existe y la ruta ya es valida.
EVID_TF="$(cygpath -m "$EVID" 2>/dev/null || printf '%s' "$EVID")"
terraform plan -input=false -lock-timeout=5m -detailed-exitcode -out="$EVID_TF/plan.tfplan"
echo "exit=$?"     # 0 = sin cambios · 2 = hay cambios · 1 = error (no hay plan utilizable)
```
Las mismas rutas nativas (`$EVID_TF`) valen para `terraform show` y cualquier otro argumento de Terraform. El plan se guarda fuera del repositorio (puede contener datos sensibles).

**Credenciales en Windows:** si el perfil de plan se apoya en `aws login` (`login_session`), el SDK de Terraform no lo resuelve (`failed to load assume role ... of profile scope-signin`). Se usa un perfil puente `scope-terraform-plan-sdk` con `credential_process = aws configure export-credentials --profile scope-terraform-plan --format process` y `AWS_PROFILE=scope-terraform-plan-sdk` solo para Terraform (el perfil no contiene claves).
`-lock-timeout=5m` espera el bloqueo normal sin desactivarlo. Si vence: **no** forzar; averiguar quién lo tiene.

Lectura humana obligatoria del plan completo en pantalla (`terraform show -no-color "$EVID/plan.tfplan" | less`, sin redirigir a un archivo compartido).

## 7. Verificador automático y evidencia sanitizada

```bash
terraform show -json "$EVID_TF/plan.tfplan" > "$EVID/plan.json"                      # contiene valores: local, protegido
node ../../../infra/terraform/guards/plan-acceptance.mjs --mode baseline   --plan "$EVID/plan.json"   # árbol A
node ../../../infra/terraform/guards/plan-acceptance.mjs --mode integrated --plan "$EVID/plan.json"   # árbol B
# evidencia SANITIZADA (solo direcciones y acciones, sin valores):
jq '[.resource_changes[] | select(.change.actions != ["no-op"] and .change.actions != ["read"]) | {address, actions: .change.actions}]' "$EVID/plan.json" > "$EVID/resumen-sanitizado.json"
# al terminar, destruir el plan y el JSON (puede contener valores de recursos):
shred -u "$EVID/plan.tfplan" "$EVID/plan.json" 2>/dev/null || rm -f "$EVID/plan.tfplan" "$EVID/plan.json"
```
`plan-acceptance.mjs` solo lee el JSON (no ejecuta Terraform ni llama a AWS), imprime direcciones/acciones/nombres de variables y **nunca valores**, y rechaza (exit 1) o declara no evaluable (exit 2) ante cualquier cosa fuera de lo esperado.

Modos (cada plan se acepta solo con el suyo; ninguno se relaja para aceptar otro): `baseline` (solo "No changes"), `integrated` (la API con las 4 variables de recuperación; `--allow-api-image-change` solo en el paso de despliegue) y `migrator-only` (publicar la imagen del migrador: `--expected-image-tag <sha40>` obligatorio; solo se acepta el reemplazo de `aws_ecs_task_definition.migrator` cuya única diferencia es la imagen `<repo>:<sha40>`). Detalle y comandos exactos en `../runbooks/password-recovery.md` §10b.

## 8. Plan A — baseline (`origin/main` sin recuperación)

Objetivo: demostrar que *Terraform + entradas reconciliadas = estado productivo* **antes** de agregar la recuperación.

- **Aceptable:** `No changes.` (exit 0).
- **Cualquier otra cosa se entiende, no se corrige automáticamente.** Tabla de triaje (hipótesis, **no** resultados):

| Diferencia posible | Qué indicaría | Qué NO hacer |
|---|---|---|
| `aws_ecs_service.*` `desired_count` ≠ 1 | `enable_services`/`*_desired_count` mal | aplicar o "escalar para igualar" |
| imagen/`task_definition` de API, IA o migrador distinta | tag del tfvars ≠ el desplegado | aplicar |
| `aws_acm_certificate.api[0]` a **destruir** | `request_acm_certificate` mal (o el certificado no es de esta raíz) | poner `acm_certificate_arn` para "arreglarlo" |
| `aws_acm_certificate.api[0]` a **crear** | el certificado NO está en el estado: es externo ⇒ habría que usar `acm_certificate_arn` | aplicar |
| `aws_db_instance.main[0]` `final_snapshot_identifier` | `rds_final_snapshot_suffix` distinto del aplicado | aplicar sin entender; corregir el suffix al valor real |
| rol/proveedor OIDC, política del rol de deploy | owner/repo/entorno/`create_github_oidc_provider` mal | **ampliar o debilitar** la confianza para igualar |
| `aws_iam_role.ecs_sync_probe_operator[0]` a destruir | existe el rol del operador de la sonda ⇒ `enable_ecs_sync_probe_github_oidc_caller` debería ser `true` (+ ids numéricos de GitHub) | destruirlo |
| `thumbprint_list` del proveedor OIDC | AWS completó el campo (config vacía) | aplicar sin entender |
| cualquier **destrucción** | entradas incompletas/erróneas | aplicar |

## 9. Plan B — integrado (misma configuración + recuperación `disabled`)

Árbol B, mismo `terraform.tfvars`, **sin** variables de recuperación (defaults: `mail_transport = "disabled"`, sin `RESEND_API_KEY`, alarmas apagadas).

- **Aceptable (`--mode integrated`):** solo `aws_ecs_task_definition.api` reemplazada (nueva revisión) con **únicamente** las 4 variables nuevas `WEB_PUBLIC_BASE_URL` (vacía), `MAIL_TRANSPORT=disabled`, `MAIL_FROM`, `TRUST_PROXY_HOPS=1`; y `aws_ecs_service.api[0]` con **solo** `task_definition`. La imagen **no** cambia en este plan (el cambio de imagen es el paso de despliegue, con `--allow-api-image-change` y la imagen publicada).
- **Rechazo:** ver sección K del informe 5.3 (cambio de capacidad, IA, imagen no planeada, secretos, 0/100, destrucciones, DNS/ACM/RDS/IAM/red/blockchain, alarmas, Resend).
- La diferencia esperada **entre A y B** es solo lo anterior. Si el plan A no fue `No changes.`, B no se interpreta hasta entenderlo.

## 11. Lista de control (orden obligatorio; nada de esto se ejecutó)

| # | Paso | Cómo / evidencia | Requiere identidad de plan |
|---|---|---|---|
| 1 | Confirmar que **no hay otro operador de Terraform** | Pregunta explícita al equipo y ventana acordada; sin despliegues ni workflows de Terraform en curso; si `plan` informa un bloqueo, **no** forzar | no |
| 2 | SHA exacto de `origin/main` | `git ls-remote origin refs/heads/main` = el SHA registrado (hoy `6d429f6…`, tras la PR #149; el código de recuperación se validó sobre `986a8c1`/`6c37168`); árbol A en ese SHA; árbol B con la huella de su diff | no |
| 3 | Cuenta y región | `aws sts get-caller-identity` (cuenta esperada, nunca root) y región `us-east-1` | sí (solo para ver la identidad) |
| 4 | Workspace `default` | `terraform workspace show` tras `init` | sí |
| 5 | Bucket y clave del estado | `backend.hcl` (`scope-tfstate-<cuenta>-us-east-1`) y `versions.tf` (`envs/prod/terraform.tfstate`, `use_lockfile`) | no |
| 6 | Identidad IAM de auditoría | `aws sts get-caller-identity --profile scope-terraform-plan` ⇒ `assumed-role/scope-prod-terraform-plan`; pruebas negativas con `simulate-principal-policy` (`IAM-PLAN-ROLE.md` §6) | sí |
| 7 | `pre-plan-guard` | Sección 3 ⇒ exit `0` (con 1/2: detenerse) sí (la guarda solo usa `sts:GetCallerIdentity`, `ecs:DescribeClusters/Services/TaskDefinition` y `ssm:GetParameter` de `BLOCKCHAIN_EVIDENCE_MODE`, que el rol de plan concede; comprobado con el evaluador local) |
| 8 | Inicializar el backend | `terraform init -input=false -backend-config=backend.hcl` (config conocida y protegida) | **sí** |
| 9 | **Plan A** con bloqueo normal | Sección 6 (`-lock-timeout=5m`, sin `-lock=false`) | **sí** |
| 10 | Revisión humana + `plan-acceptance --mode baseline` | Secciones 6–8 | no (lee archivo) |
| 11 | Detenerse ante cualquier cambio inesperado | Triaje de la sección 8; nada se "arregla" aplicando | — |
| 12 | Solo tras **aprobar A**: **Plan B** y su revisión (`--mode integrated`) | Sección 9 | **sí** |
| 13 | Revisar B | Criterios del informe 5.3 §K | no |
| 14 | **No aplicar ningún plan** | Ningún `apply`; un plan limpio no autoriza uno | — |
| 15 | Eliminar archivos temporales sensibles | `shred -u` (o `rm`) del `.tfplan` y del JSON; conservar solo `resumen-sanitizado.json`; cerrar la sesión del rol (expira en 1 h) y borrar el perfil local si ya no se usa | no |

Nota sobre el paso 7: si la guarda fallara por permisos con el rol de plan, se ejecuta con `scope-signin` (lectura limitada ya autorizada), **nunca** con el rol de aplicación.

## 10. Lo que este procedimiento NO autoriza

`apply`, publicar imágenes, ejecutar migraciones, activar Resend, tocar DNS o secretos, ni usar `-lock=false`. Cada uno requiere su propia autorización y ventana (runbook `runbooks/password-recovery.md`).

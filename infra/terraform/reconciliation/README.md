# Reconciliación de entradas de Terraform con AWS — SOLO PREPARACIÓN

**Nada de lo que describe este documento se ejecutó.** No hubo `terraform plan` contra el estado remoto, ni `apply`, ni escritura en AWS.

## Por qué existe

El `terraform.tfvars` local (ignorado por git, modificado el 2026-10-11) **no** representa lo desplegado: el último `apply` fue el 2026-10-22 y movió la API a otra imagen. Un `apply` con ese archivo apagaría API e IA (`desired_count = enable_services ? N : 0`, sin `ignore_changes`), devolvería imágenes anteriores, dejaría `WEB_ORIGIN` vacío (CORS apagado) y cambiaría la configuración de blockchain. El diagnóstico completo está en `mejoras post 50%/recuperacion-de-cuenta/07-auditoria-5-1-reconciliacion-aws.md`.

Esta carpeta contiene:

| Archivo | Qué es |
|---|---|
| `prod.reconciled.tfvars.template` | **Plantilla** de entradas con marcadores `<...>` para todo valor que describe el estado desplegado (tags/digests de imagen, origen web, propietario/repositorio de GitHub), y la forma de obtener cada uno. **No** se carga sola (extensión `.template`) y **no** reemplaza al tfvars local: los valores reales de producción **no se versionan** (viven en el `terraform.tfvars` local, ignorado por git; el repositorio es público). |
| `../guards/pre-plan-guard.mjs` | Guarda de **solo lectura** que compara tus tfvars con lo que corre en AWS **antes** del plan. |
| `PLAN-PROCEDURE.md` | Procedimiento del plan baseline e integrado (bloqueo normal, evidencia sanitizada). |
| `../guards/plan-acceptance.mjs` | Verificador que lee `terraform show -json` y aplica los criterios de aceptación/rechazo (no ejecuta Terraform). |

## Qué NO hay que concluir de la propuesta

- Que ECS muestre un valor **no** prueba que el **estado remoto** de Terraform lo contenga. Solo el plan lo dirá.
- Los valores marcados `[VIEJO-NO-VERIF]` y `[PENDIENTE]` no están verificados.
- La guarda compara unas pocas propiedades críticas; **no** garantiza un plan de cero cambios.

## Cómo se obtendría la línea base "no-op" (futuro; requiere autorización de un `plan` remoto)

Objetivo: demostrar que **Terraform + entradas reconciliadas = AWS actual** *antes* de agregar nada de la recuperación. Un resultado de cero cambios sería la mejor evidencia, pero **no se afirma hasta ejecutarlo**.

1. **Dos árboles, mismas entradas.**
   - *Base:* un worktree limpio de `origin/main` (sin la recuperación):
     `git worktree add ../PFI-baseline origin/main`
   - *Integrado:* la rama `integration/password-recovery-5-2`.
2. **Preparar las entradas** a partir de la propuesta: copiarla a `terraform.tfvars` **de cada árbol** (archivo local, ignorado por git) y resolver los `[PENDIENTE]`. No sobrescribir el tfvars viejo: guardarlo aparte.
3. **Guarda** (solo lectura), en cada árbol, con los mismos archivos que se usarán:
   `node infra/terraform/guards/pre-plan-guard.mjs --tfvars infra/terraform/prod/terraform.tfvars --tfvars infra/terraform/prod/ecs_sync_probe.auto.tfvars --profile <perfil de solo lectura>`
   Debe terminar en `0`. Si termina en `1` o `2`, **no se sigue**.
4. **Plan de línea base** (en el árbol *Base*), con el **bloqueo normal** del estado y una **ventana coordinada** en la que nadie despliega. **No se usa `-lock=false`** (HashiCorp lo desaconseja si puede haber operaciones concurrentes; solo como excepción documentada y aprobada). Procedimiento exacto, comandos y evidencia sanitizada: **`PLAN-PROCEDURE.md`**. El plan y su JSON viven en un directorio local protegido y se borran al terminar.
   - **Aceptable:** `No changes.`
   - **Inaceptable** (detener y reconciliar las entradas): cualquier cambio en `desired_count`, en imágenes, en `WEB_ORIGIN`, en blockchain, en flags de embeddings, **cualquier destrucción**, o cualquier cambio en RDS/ALB/DNS/IAM.
5. **Plan del árbol integrado** con **las mismas** entradas y recuperación en sus defaults (`mail_transport = "disabled"`, alarmas apagadas). La diferencia contra el paso 4 debe ser **solo** lo esperado de la recuperación (ver runbook §10 y el informe 5.2, sección N).
6. Recién entonces se evalúa un `apply`, con ventana planificada (la API se despliega 0/100: todo cambio de su task definition es un corte).

## Identidad

`terraform plan` **refresca** todos los recursos del estado, así que la identidad necesita leer cada servicio que Terraform administra. `scope-signin` (usuario `scope-operator`) **no alcanza** (se observó `AccessDenied` en ECR, IAM, Step Functions, ACM, RDS, ELB…); `scope-provisioner-apply` (rol `scope-prod-terraform-provisioner-apply`) **puede aplicar** y no se usa para planificar; el perfil `default` es **root** y nunca se usa.

**Decisión del arquitecto:** identidad dedicada y temporal, separada de las de aplicación. Propuesta de rol `scope-prod-terraform-plan` (solo lectura + lock del backend S3, sin escritura del objeto de estado, sin secretos): **`IAM-PLAN-ROLE.md`** y `iam/*.template.json` (plantillas con placeholders; el rol **no está creado**). Verificador local: `node infra/terraform/guards/iam-plan-policy-check.mjs`.

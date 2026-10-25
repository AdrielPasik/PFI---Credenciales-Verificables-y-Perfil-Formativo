#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Chequeos estaticos de la infraestructura de recuperacion de contrasena.
#
# Inspeccion pura de archivos y de git: sin Terraform, sin red, sin AWS, sin credenciales.
# Complementa a tests/password_recovery.tftest.hcl (comportamiento con provider simulado).
#
#   bash infra/terraform/prod/tests/static-checks.sh                 # contra BASE_REF=origin/main
#   BASE_REF=origin/main bash infra/terraform/prod/tests/static-checks.sh
#   bash infra/terraform/prod/tests/static-checks.sh --no-base       # solo invariantes (declarado)
#
# POR QUE NO HAY HASHES FIJOS. La version anterior fijaba el hash de 24 archivos: cualquier
# cambio legitimo de infraestructura de otro trabajo la rompia (5 de 24 al integrar origin/main)
# y habia que regenerarla "a ciegas". Ahora hay dos protecciones que no envejecen:
#
#  1. COMPARACION CONTRA LA BASE. Todo lo que este cambio toca de infra/ y .github/ debe estar
#     en una lista de rutas permitidas (ALLOWED), y en los archivos Terraform existentes las
#     lineas ELIMINADAS deben estar en una lista cerrada (ALLOWED_REMOVALS). La base se
#     actualiza sola: si origin/main cambia iam.tf, la rama integrada ya lo tiene y no aparece
#     como cambio; si alguien edita iam.tf POR ENCIMA de la base, falla. Si BASE_REF esta
#     desactualizada, el fallo lo dice (se ven cambios ajenos): se actualiza la base, no la prueba.
#  2. INVARIANTES SEMANTICOS. Propiedades que importan aunque el archivo cambie: el migrador es
#     obligatorio y sin fallback, la API se despliega 0/100, la sonda y el provisioner existen,
#     ningun secreto aparece en Terraform, etc.
#
# Limite honesto: contra una base igual al arbol (despues de integrar la rama) la parte 1 pasa
# trivialmente; la parte 2 y los tests de Terraform siguen protegiendo.
# ---------------------------------------------------------------------------
set -u

ROOT="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)}"
BASE_REF="${BASE_REF:-origin/main}"
USE_BASE=1
[ "${1:-}" = "--no-base" ] && USE_BASE=0
cd "$ROOT" || exit 2

failures=0
pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; failures=$((failures + 1)); }
PROD=infra/terraform/prod

# --- helpers -----------------------------------------------------------------
hcl_block() { # imprime el bloque HCL que empieza en la linea que coincide con $2 (hasta la llave de cierre de columna 0)
  tr -d '\r' < "$1" | awk -v pat="$2" 'index($0, pat) == 1 { p = 1 } p { print } p && /^}/ { exit }'
}

# ---------------------------------------------------------------------------
echo "== 1. cambios respecto de la base ($BASE_REF) — solo rutas permitidas, solo aditivos"
# Rutas que ESTE cambio puede tocar (expresiones regulares, relativas a la raiz del repo).
ALLOWED=(
  '^infra/terraform/README\.md$'
  '^infra/terraform/prod/(alb|ecs|locals|outputs|variables)\.tf$'
  '^infra/terraform/prod/terraform\.tfvars\.example$'
  '^infra/terraform/prod/recovery_alarms\.tf$'
  '^infra/terraform/prod/tests/'
  '^infra/terraform/runbooks/'
  '^infra/terraform/guards/'
  '^infra/terraform/reconciliation/'
  '^\.github/workflows/api-postgres-tests\.yml$'
)
# Lineas que SI pueden desaparecer de un archivo existente (recortadas). Hoy: la unica es el
# ultimo argumento de `merge(...)` al que se le agrega una coma para anadir el secreto de correo.
ALLOWED_REMOVALS=(
  'local.api_rpc_secret_parameters'
)

if [ "$USE_BASE" -eq 0 ]; then
  echo "  --    omitida por --no-base (solo se evaluan los invariantes)"
elif ! git rev-parse --verify --quiet "$BASE_REF^{commit}" >/dev/null; then
  fail "la base $BASE_REF no existe: sin base no hay comparacion (usa --no-base solo si es intencional)"
else
  changed="$( { git diff --name-only "$BASE_REF" -- infra .github; git ls-files -o --exclude-standard -- infra .github; } | sort -u )"
  if [ -z "$changed" ]; then
    pass "sin cambios en infra/ ni .github/ respecto de la base"
  else
    outside=0
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      ok=0
      for re in "${ALLOWED[@]}"; do [[ "$f" =~ $re ]] && { ok=1; break; }; done
      if [ "$ok" -eq 0 ]; then fail "ruta fuera de la lista permitida: $f"; outside=1; fi
    done <<< "$changed"
    [ "$outside" -eq 0 ] && pass "todas las rutas cambiadas estan permitidas ($(echo "$changed" | wc -l | tr -d ' ') archivos)"

    removal_bad=0
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      git cat-file -e "$BASE_REF:$f" 2>/dev/null || continue            # archivo nuevo: nada que eliminar
      while IFS= read -r line; do
        trimmed="$(printf '%s' "${line#-}" | tr -d '\r' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
        [ -z "$trimmed" ] && continue
        allowed=0
        for r in "${ALLOWED_REMOVALS[@]}"; do [ "$trimmed" = "$r" ] && allowed=1; done
        if [ "$allowed" -eq 0 ]; then fail "$f elimina una linea de la base: $trimmed"; removal_bad=1; fi
      done < <(git diff -U0 --ignore-space-at-eol "$BASE_REF" -- "$f" | grep -E '^-[^-]' || true)
    done <<< "$changed"
    [ "$removal_bad" -eq 0 ] && pass "ningun archivo existente pierde lineas de la base (salvo las permitidas)"
  fi
fi

# ---------------------------------------------------------------------------
echo "== 2. invariantes del despliegue vigente (upstream) que la recuperacion no puede romper"
vars_tf="$PROD/variables.tf"; ecs_tf="$PROD/ecs.tf"; locals_tf="$PROD/locals.tf"

n=$(grep -c '^variable "migrator_image_tag"' "$PROD"/*.tf | awk -F: '{s+=$2} END {print s}')
[ "$n" = "1" ] && pass "migrator_image_tag se declara exactamente una vez" || fail "migrator_image_tag declarada $n veces (debe ser 1)"
blk="$(hcl_block "$vars_tf" 'variable "migrator_image_tag"')"
if echo "$blk" | grep -qE '^\s*default\s*='; then fail "migrator_image_tag tiene default (debe ser obligatoria)"; else pass "migrator_image_tag es obligatoria (sin default)"; fi
echo "$blk" | grep -q 'validation' && pass "migrator_image_tag valida que no este vacia" || fail "migrator_image_tag sin validacion"
if grep -rnE 'local\.migrator_image_tag|migrator_image_tag\s*=\s*var\.api_image_tag|var\.migrator_image_tag\s*!=\s*""\s*\?' "$PROD"/*.tf; then fail "hay una derivacion/fallback de migrator_image_tag"; else pass "sin fallback de migrator_image_tag"; fi
mig="$(hcl_block "$ecs_tf" 'resource "aws_ecs_task_definition" "migrator"')"
echo "$mig" | grep -q 'repository_url}:${var.migrator_image_tag}' && pass "el migrador usa var.migrator_image_tag" || fail "el migrador no usa var.migrator_image_tag"
if echo "$mig" | grep -q 'api_image_tag'; then fail "el recurso del migrador menciona api_image_tag"; else pass "el migrador no depende de api_image_tag"; fi

pblk="$(hcl_block "$vars_tf" 'variable "provisioner_image_digest"')"
[ -n "$pblk" ] && ! echo "$pblk" | grep -qE '^\s*default\s*=' && pass "provisioner_image_digest se conserva y es obligatoria" || fail "provisioner_image_digest ausente o con default"
grep -q 'resource "aws_ecs_task_definition" "provisioner"' "$ecs_tf" && pass "task definition del provisioner conservada" || fail "falta la task definition del provisioner"
[ -f "$PROD/provisioner_invocation.tf" ] && pass "provisioner_invocation.tf conservado" || fail "falta provisioner_invocation.tf"
[ -f "$PROD/ecs_sync_probe.tf" ] && grep -qE '^\s*enable_ecs_sync_probe\s*=\s*true' "$PROD/ecs_sync_probe.auto.tfvars" && pass "sonda ECS conservada y habilitada por su auto.tfvars" || fail "sonda ECS ausente o deshabilitada"

api_svc="$(hcl_block "$ecs_tf" 'resource "aws_ecs_service" "api"')"
echo "$api_svc" | grep -qE 'deployment_minimum_healthy_percent\s*=\s*0\b' && echo "$api_svc" | grep -qE 'deployment_maximum_percent\s*=\s*100\b' && pass "API se despliega 0/100 (escritor unico de nonce)" || fail "el despliegue de la API ya no es 0/100"
echo "$api_svc" | grep -q 'desired_count   = var.enable_services' && pass "la capacidad sigue gobernada por enable_services (modelo vigente)" || fail "cambio en el modelo de capacidad"
if grep -nE 'ignore_changes\s*=\s*\[[^]]*desired_count' "$PROD"/*.tf; then fail "se agrego ignore_changes sobre desired_count (decision cerrada: no en esta etapa)"; else pass "sin ignore_changes sobre desired_count"; fi
grep -q 'SIGNER_SECRET_REF_PREFIX' "$locals_tf" && pass "SIGNER_SECRET_REF_PREFIX conservado" || fail "falta SIGNER_SECRET_REF_PREFIX"

# ---------------------------------------------------------------------------
echo "== 3. invariantes de la recuperacion"
tr '\n' ' ' < "$vars_tf" | sed 's/}/}\n/g' | grep -qE 'variable "mail_transport"[^}]*default\s*=\s*"disabled"' && pass "mail_transport por defecto = disabled" || fail "mail_transport no es disabled por defecto"
grep -qE 'TRUST_PROXY_HOPS\s*=\s*"1"' "$locals_tf" && pass "TRUST_PROXY_HOPS = 1 (solo API)" || fail "TRUST_PROXY_HOPS no es 1"
grep -qE 'xff_header_processing_mode\s*=\s*"append"' "$PROD/alb.tf" && pass "ALB: X-Forwarded-For en append" || fail "ALB sin XFF append fijado"
tr '\n' ' ' < "$vars_tf" | sed 's/}/}\n/g' | grep -qE 'variable "enable_recovery_alarms"[^}]*default\s*=\s*false' && pass "alarmas apagadas por defecto" || fail "alarmas no apagadas por defecto"
tr '\n' ' ' < "$vars_tf" | sed 's/}/}\n/g' | grep -qE 'variable "create_api_dns_record"[^}]*default\s*=\s*false' && pass "create_api_dns_record = false por defecto" || fail "create_api_dns_record no es false por defecto"
grep -q 'api_mail_secret_parameters' "$locals_tf" && pass "secreto de correo condicional presente" || fail "falta el secreto de correo condicional"

# ---------------------------------------------------------------------------
echo "== 4. ningun secreto en Terraform, ejemplos, pruebas ni documentacion de recuperacion"
SCAN=("$PROD"/*.tf "$PROD"/*.example "$PROD/tests" infra/terraform/runbooks infra/terraform/guards infra/terraform/reconciliation infra/terraform/README.md)
if grep -rInE '(^|[^A-Za-z0-9_])re_[A-Za-z0-9_]{20,}' "${SCAN[@]}" 2>/dev/null; then fail "aparece una clave con forma de Resend (re_...)"; else pass "sin claves con forma re_<...>"; fi
if grep -rInEi 'RESEND_API_KEY[[:space:]]*(=|:)[[:space:]]*"?[A-Za-z0-9_]{8,}' "${SCAN[@]}" 2>/dev/null | grep -vE '^\S+:[0-9]+:\s*(#|//)'; then fail "RESEND_API_KEY recibe un literal"; else pass "RESEND_API_KEY nunca recibe un literal"; fi
if grep -nE '"SecureString"' "$PROD"/*.tf; then fail "un .tf declara un parametro SecureString"; else pass "Terraform no declara SecureString"; fi
if grep -nE 'data\s+"(aws_ssm_parameter|aws_ssm_parameters_by_path|aws_secretsmanager_secret_version)"' "$PROD"/*.tf; then fail "un data source lee un valor secreto"; else pass "ningun data source lee valores secretos"; fi
if grep -nE '^\s*sensitive\s*=\s*false' "$PROD/outputs.tf"; then fail "un output desactiva sensitive"; else pass "ningun output desactiva sensitive"; fi
if grep -nE '^\s*(enable_services\s*=\s*true|api_desired_count\s*=\s*[2-9]|create_api_dns_record\s*=\s*true)' "$PROD/terraform.tfvars.example"; then fail "tfvars.example enciende capacidad o DNS"; else pass "tfvars.example no enciende capacidad ni DNS"; fi

# ---------------------------------------------------------------------------
echo "== 5. runbook"
RB=infra/terraform/runbooks/password-recovery.md
if [ -f "$RB" ]; then
  for s in "0/100" "migrator_image_tag" "seed" "TRUST_PROXY_HOPS" "sessionVersion" "MIN_ROLLBACK_SHA" "circuit breaker" "pre-plan-guard" "ventana" "SOLO LECTURA" "REQUIERE APROBACI" "Desactivar" "Activar" "Rollback" "Problemas conocidos"; do
    grep -qi "$s" "$RB" && pass "menciona: $s" || fail "falta: $s"
  done
  # Instrucciones que ya no son validas (entorno real: AWS activo, API 0/100, migrador obligatorio)
  for stale in 'migrator_image_tag = ""' 'migrator_image_tag = \\"\\"' 'rodante [(]minimo 100' 'min 100 %.*max 200' 'las viejas siguen sirviendo' 'login no se cae' 'Login y registro \*\*no se interrumpen\*\*'; do
    if grep -qiE "$stale" "$RB"; then fail "instruccion obsoleta en el runbook: $stale"; else pass "sin la instruccion obsoleta: $stale"; fi
  done
else
  fail "$RB no existe"
fi

echo
if [ "$failures" -eq 0 ]; then echo "STATIC CHECKS: all passed"; exit 0; else echo "STATIC CHECKS: $failures failure(s)"; exit 1; fi

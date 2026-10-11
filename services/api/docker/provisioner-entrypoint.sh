#!/bin/sh
# Provisioner execution gate -- S8c11.4a.
#
# A fixed, minimal command surface for INITIAL ISSUER PROVISIONING. It is meant
# to be the entryPoint of a future dedicated ECS task definition, invoked as
#   ["/bin/sh", "/app/services/api/docker/provisioner-entrypoint.sh"]
# so it does not depend on the file's executable bit. The only accepted command
# is, in exactly this order and with exactly these five arguments:
#
#   provision --issuer <uuid> --types <comma-separated-list>
#
# Everything else is rejected with a fixed message and a non-zero exit BEFORE any
# provisioning code runs. This script does not generate keys, call SSM, touch the
# database or implement any provisioning logic: it only decides whether the one
# existing CLI may be started, and with which arguments.
#
# WHAT THIS SCRIPT ENFORCES
#   - one literal operation, one fixed argument shape, argv-only delegation (no
#     eval, no command string, no shell built from input);
#   - the issuer is a UUID; the types list is non-empty and uses a restricted
#     character set (the domain service still validates the actual values);
#   - SIGNER_SECRET_REF_PREFIX is set to the hardcoded signer namespace inside
#     this process, replacing whatever value arrived;
#   - a best-effort reset of NODE_OPTIONS, NODE_PATH and the AWS endpoint
#     overrides before the CLI starts;
#   - the three required settings are present, naming only the variable on error.
#
# WHAT THIS SCRIPT DOES NOT ENFORCE (the future trusted layer must)
#   - It is NOT an authorization decision and NOT a sandbox. It cannot tell a
#     value injected by the task definition from one supplied through RunTask
#     container overrides, so DATABASE_URL provenance and every other variable
#     (PATH, HTTPS_PROXY, AWS_CA_BUNDLE, AWS_CONTAINER_CREDENTIALS_*, LD_PRELOAD,
#     AWS_REGION, PUBLIC_DID_BASE_URL, SIGNER_SECRET_KMS_KEY_ID, ...) are trusted
#     as received. The resets above are defence in depth, not a guarantee.
#   - Who may start the task, which role it runs as, which database identity it
#     uses and whether a human approved the run belong to the task definition,
#     the invocation role and the workflow authorization. None exist yet.
#
# Wrapper-generated errors are fixed messages. Delegated CLI output passes
# through unchanged. DATABASE_URL and the input arguments are never printed
# by this wrapper.

set -eu

reject() {
  echo "$1" >&2
  exit "$2"
}

# --- command surface ---------------------------------------------------------

[ "$#" -eq 5 ] || reject "Usage: provision --issuer <uuid> --types <list>" 64
[ "$1" = "provision" ] || reject "Unsupported operation." 64
[ "$2" = "--issuer" ] || reject "Unsupported argument." 64
[ "$4" = "--types" ] || reject "Unsupported argument." 64

HEX='[0-9a-fA-F]'
case "$3" in
  $HEX$HEX$HEX$HEX$HEX$HEX$HEX$HEX-$HEX$HEX$HEX$HEX-$HEX$HEX$HEX$HEX-$HEX$HEX$HEX$HEX-$HEX$HEX$HEX$HEX$HEX$HEX$HEX$HEX$HEX$HEX$HEX$HEX) ;;
  *) reject "The issuer must be a UUID." 64 ;;
esac

case "$5" in
  "" | *[!A-Za-z0-9_,]* | ,* | *, | *,,*) reject "The types list is invalid." 64 ;;
esac

# --- required settings (names only, never values) ---------------------------

[ -n "${DATABASE_URL:-}" ] || reject "Required configuration is missing: DATABASE_URL" 78
[ -n "${PUBLIC_DID_BASE_URL:-}" ] || reject "Required configuration is missing: PUBLIC_DID_BASE_URL" 78
[ -n "${AWS_REGION:-}" ] || reject "Required configuration is missing: AWS_REGION" 78

# --- fixed configuration -----------------------------------------------------

unset NODE_OPTIONS NODE_PATH AWS_ENDPOINT_URL AWS_ENDPOINT_URL_SSM

SIGNER_SECRET_REF_PREFIX="/scope/prod/signers/"
export SIGNER_SECRET_REF_PREFIX

# --- delegation --------------------------------------------------------------

case "$0" in
  */*) script_dir="${0%/*}" ;;
  *) script_dir="." ;;
esac
cd "$script_dir/.." || reject "The runtime layout is not as expected." 70

exec node -r reflect-metadata dist/identity/scripts/technical-identity-cli.js provision --issuer "$3" --types "$5"

#!/bin/sh
# Dedicated one-shot UADE gate. Task environment and overrides must be trusted.
set -eu
[ "$#" -eq 0 ] || { echo 'Arguments are not permitted.' >&2; exit 64; }
[ -n "${DATABASE_URL:-}" ] || { echo 'DATABASE_URL is required.' >&2; exit 78; }
[ "${PUBLIC_DID_BASE_URL:-}" = 'https://api.scopeedu.technology' ] || { echo 'Unexpected DID origin.' >&2; exit 78; }
[ "${AWS_REGION:-}" = 'us-east-1' ] || { echo 'Unexpected region.' >&2; exit 78; }
unset NODE_OPTIONS NODE_PATH AWS_ENDPOINT_URL AWS_ENDPOINT_URL_SSM SIGNER_SECRET_KMS_KEY_ID
export SIGNER_SECRET_REF_PREFIX='/scope/prod/signers/'
cd /app/services/api
exec node -r reflect-metadata dist/identity/scripts/technical-identity-cli.js provision-uade

#!/bin/sh
set -eu

: "${RDS_MASTER_PASSWORD:?RDS_MASTER_PASSWORD is required}"
: "${SCOPE_APP_DATABASE_URL:?SCOPE_APP_DATABASE_URL is required}"
: "${RDS_ADDRESS:?RDS_ADDRESS is required}"
: "${RDS_MASTER_USERNAME:?RDS_MASTER_USERNAME is required}"
: "${RDS_DATABASE_NAME:?RDS_DATABASE_NAME is required}"

if [ "$#" -eq 0 ]; then
  echo "A migrator command is required." >&2
  exit 64
fi

SCOPE_APP_PASSWORD="$(
  node <<'NODE'
const raw = process.env.SCOPE_APP_DATABASE_URL;

let url;
try {
  url = new URL(raw);
} catch {
  console.error('SCOPE_APP_DATABASE_URL is not a valid PostgreSQL URL.');
  process.exit(1);
}

if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
  console.error('SCOPE_APP_DATABASE_URL must use postgres:// or postgresql://.');
  process.exit(1);
}

const username = decodeURIComponent(url.username);
const password = decodeURIComponent(url.password);
const database = url.pathname.replace(/^\/+/, '');
const port = url.port || '5432';

if (username !== 'scope_app') {
  console.error('SCOPE_APP_DATABASE_URL must use the scope_app role.');
  process.exit(1);
}

if (url.hostname !== process.env.RDS_ADDRESS) {
  console.error('SCOPE_APP_DATABASE_URL points to an unexpected database host.');
  process.exit(1);
}

if (database !== process.env.RDS_DATABASE_NAME) {
  console.error('SCOPE_APP_DATABASE_URL points to an unexpected database name.');
  process.exit(1);
}

if (port !== '5432') {
  console.error('SCOPE_APP_DATABASE_URL points to an unexpected database port.');
  process.exit(1);
}

if (!password) {
  console.error('SCOPE_APP_DATABASE_URL contains an empty password.');
  process.exit(1);
}

process.stdout.write(password);
NODE
)"

export SCOPE_APP_PASSWORD

DB_PASSWORD_ENCODED="$(
  node -e 'process.stdout.write(encodeURIComponent(process.env.RDS_MASTER_PASSWORD))'
)"

export DATABASE_URL="postgresql://${RDS_MASTER_USERNAME}:${DB_PASSWORD_ENCODED}@${RDS_ADDRESS}:5432/${RDS_DATABASE_NAME}?schema=public&sslmode=require&connect_timeout=15"

export PGHOST="$RDS_ADDRESS"
export PGPORT="5432"
export PGDATABASE="$RDS_DATABASE_NAME"
export PGUSER="$RDS_MASTER_USERNAME"
export PGPASSWORD="$RDS_MASTER_PASSWORD"
export PGSSLMODE="require"
export PGCONNECT_TIMEOUT="15"

unset RDS_MASTER_PASSWORD
unset SCOPE_APP_DATABASE_URL
unset DB_PASSWORD_ENCODED

exec "$@"

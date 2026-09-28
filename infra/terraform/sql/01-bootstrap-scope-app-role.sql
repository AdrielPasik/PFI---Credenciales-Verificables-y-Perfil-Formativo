-- ===========================================================================
-- Scope — RDS runtime role bootstrap (DESIGN ARTIFACT, NOT EXECUTED)
-- ===========================================================================
--
-- STATUS: reviewed, not run. Nothing in this repository executes this file.
-- It is applied manually, once, in the slice that provisions the database.
--
-- WHY THIS EXISTS
--   The NestJS service must not connect as the RDS master user. The master owns
--   every object, can drop the schema, and its credential is the one Secrets
--   Manager rotates for administrative use. The runtime therefore connects as
--   scope_app: a dedicated LOGIN role with data privileges and no DDL authority.
--
-- IDENTITY SPLIT (final)
--   scope_admin  RDS master, password generated and held by AWS Secrets Manager
--                (manage_master_user_password = true). Used ONLY by:
--                  - this bootstrap script;
--                  - `prisma migrate deploy`;
--                  - `db:seed` and `db:verify-demo`;
--                run from the one-off ECS migrator task, which reads the secret
--                directly from Secrets Manager. The master password is NEVER
--                copied into SSM Parameter Store.
--   scope_app    NestJS runtime. Password generated out of band and stored as
--                the SSM SecureString /scope/prod/api/DATABASE_URL. Independent
--                of the master credential; never in Terraform state.
--
-- ORDER OF EXECUTION
--   1. terraform apply (RDS exists, empty)
--   2. THIS FILE, connected as scope_admin to the `scope` database
--   3. prisma migrate deploy      (as scope_admin)
--   4. 02-grant-scope-app-on-existing-objects.sql  (as scope_admin)
--   5. db:seed, db:verify-demo    (as scope_admin)
--   6. enable_services = true     (API connects as scope_app)
--
--   Step 4 is separate and mandatory: ALTER DEFAULT PRIVILEGES below only
--   affects objects created AFTER it runs, and step 3 creates the tables. Step 4
--   is idempotent and is re-run after every future migration batch.
--
-- HOW TO RUN IT (manual, from the migrator task or a psql session inside the VPC)
--   The password is read from Secrets Manager at that moment and is not written
--   to a file, a shell history entry or a CLI argument.
--
-- ===========================================================================

\set ON_ERROR_STOP on

-- Session guard: refuse to run against the wrong database.
DO $$
BEGIN
  IF current_database() <> 'scope' THEN
    RAISE EXCEPTION 'Wrong database: expected "scope", connected to "%"', current_database();
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. The role itself
-- ---------------------------------------------------------------------------
--
-- NOLOGIN attributes that are deliberately absent: SUPERUSER, CREATEDB,
-- CREATEROLE, REPLICATION, BYPASSRLS. None is grantable by the RDS master
-- anyway, and stating the omission is the point.
--
-- CONNECTION LIMIT: Prisma's default pool is 2 * cores + 1 per process. One
-- Fargate task with 0.5 vCPU asks for a small pool; 20 leaves room for a rolling
-- deployment running two task generations at once, and still stops a runaway
-- client from exhausting db.t4g.micro's max_connections.
--
-- :app_password is a psql variable. Pass it with
--   psql -v app_password="'<value>'" -f 01-bootstrap-scope-app-role.sql
-- so the literal never appears in this file or in the repository.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scope_app') THEN
    CREATE ROLE scope_app LOGIN CONNECTION LIMIT 20;
  END IF;
END
$$;

ALTER ROLE scope_app WITH PASSWORD :app_password;

-- ---------------------------------------------------------------------------
-- 2. Database-level access
-- ---------------------------------------------------------------------------

-- CONNECT is what lets scope_app open a session at all.
GRANT CONNECT ON DATABASE scope TO scope_app;

-- Explicitly NOT granted: CREATE on the database (no new schemas), TEMPORARY
-- (no temp tables from the runtime).
REVOKE CREATE ON DATABASE scope FROM PUBLIC;
REVOKE TEMPORARY ON DATABASE scope FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. Schema-level access
-- ---------------------------------------------------------------------------
--
-- USAGE lets scope_app resolve names inside `public`. CREATE is withheld, so the
-- runtime cannot add, rename or drop a table even by accident, and an SQL
-- injection that reaches a DDL statement fails on permissions.
--
-- PostgreSQL 15 already removed the implicit CREATE grant on `public` for
-- PUBLIC; the REVOKE below makes that explicit and also covers a database
-- restored from an older major.

GRANT USAGE ON SCHEMA public TO scope_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM scope_app;

-- Enum types: the schema declares 35 of them. USAGE on a type is granted to
-- PUBLIC by default in PostgreSQL, so no explicit grant is needed; this comment
-- records that the omission is intentional and verified, not forgotten.

-- ---------------------------------------------------------------------------
-- 4. Default privileges for objects that FUTURE migrations create
-- ---------------------------------------------------------------------------
--
-- These apply only to objects created by scope_admin, only in schema public, and
-- only from this point forward. They are what keeps a future `prisma migrate
-- deploy` from producing a table the API cannot read.
--
-- Note the asymmetry with section 5: default privileges are not retroactive.

ALTER DEFAULT PRIVILEGES FOR ROLE scope_admin IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO scope_app;

-- No sequence exists today (the Prisma schema uses no @default(autoincrement());
-- every identifier is a generated uuid or a natural key). This grant is here so
-- that the day a migration introduces one, the runtime does not start failing on
-- nextval().
ALTER DEFAULT PRIVILEGES FOR ROLE scope_admin IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO scope_app;

-- Deliberately NOT granted by default: EXECUTE on functions, and anything on
-- types beyond the PUBLIC default. Add them explicitly if a migration ever needs
-- them, so the addition is reviewed.

-- ---------------------------------------------------------------------------
-- 5. Verification (read-only, prints what was just configured)
-- ---------------------------------------------------------------------------

SELECT
  rolname,
  rolcanlogin,
  rolsuper,
  rolcreatedb,
  rolcreaterole,
  rolreplication,
  rolbypassrls,
  rolconnlimit
FROM pg_roles
WHERE rolname IN ('scope_admin', 'scope_app')
ORDER BY rolname;

SELECT
  has_database_privilege('scope_app', 'scope', 'CONNECT') AS can_connect,
  has_database_privilege('scope_app', 'scope', 'CREATE')  AS can_create_schema,
  has_schema_privilege('scope_app', 'public', 'USAGE')    AS schema_usage,
  has_schema_privilege('scope_app', 'public', 'CREATE')   AS schema_create;

-- Expected: can_connect = t, can_create_schema = f, schema_usage = t,
-- schema_create = f.

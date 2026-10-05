-- ===========================================================================
-- Scope — grant scope_app on objects that already exist (DESIGN, NOT EXECUTED)
-- ===========================================================================
--
-- STATUS: reviewed, not run.
--
-- ALTER DEFAULT PRIVILEGES (01-bootstrap-scope-app-role.sql, section 4) is not
-- retroactive: it only covers objects created after it runs. Every table that
-- `prisma migrate deploy` has ALREADY created needs an explicit grant.
--
-- RUN THIS:
--   - as scope_admin, connected to the `scope_app` database;
--   - after the FIRST `prisma migrate deploy`;
--   - again after every later migration batch, before the new code goes live.
--
-- It is idempotent: re-granting an existing privilege is a no-op.
-- ===========================================================================

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF current_database() <> 'scope_app' THEN
    RAISE EXCEPTION 'Wrong database: expected "scope_app", connected to "%"', current_database();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'scope_app') THEN
    RAISE EXCEPTION 'scope_app does not exist: run 01-bootstrap-scope-app-role.sql first';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Data privileges on the existing tables
-- ---------------------------------------------------------------------------
--
-- SELECT/INSERT/UPDATE/DELETE and nothing else. In particular NOT: TRUNCATE
-- (a single statement that would empty the academic catalog), REFERENCES
-- (no new foreign keys from the runtime), TRIGGER (no new triggers).

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO scope_app;

GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public
  TO scope_app;

-- ---------------------------------------------------------------------------
-- 2. Prisma's own bookkeeping table
-- ---------------------------------------------------------------------------
--
-- _prisma_migrations belongs to the migration identity. The runtime never reads
-- it (the generated Prisma Client does not touch it), and it must not be able to
-- rewrite migration history, so the blanket grant above is taken back.

REVOKE ALL ON TABLE public._prisma_migrations FROM scope_app;

-- ---------------------------------------------------------------------------
-- 3. Verification (read-only)
-- ---------------------------------------------------------------------------

-- Any table the runtime cannot read is a deployment blocker. Expected: 0 rows.
SELECT
  c.relname AS table_without_select
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname <> '_prisma_migrations'
  AND NOT has_table_privilege('scope_app', c.oid, 'SELECT')
ORDER BY c.relname;

-- Any table the runtime could TRUNCATE is a privilege leak. Expected: 0 rows.
SELECT
  c.relname AS table_with_truncate
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND has_table_privilege('scope_app', c.oid, 'TRUNCATE')
ORDER BY c.relname;

-- Expected: f. The runtime must not be able to read migration history.
SELECT has_table_privilege('scope_app', 'public._prisma_migrations', 'SELECT')
  AS scope_app_reads_migration_history;

-- Row count the API can see, as a smoke test after the seed. Expected 617.
-- (Table name is quoted because Prisma maps models to PascalCase identifiers.)
SELECT count(*) AS academic_courses FROM public."AcademicCourse";

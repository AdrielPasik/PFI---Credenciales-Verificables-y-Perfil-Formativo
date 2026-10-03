-- S1 -- Capacidad de administracion de plataforma.
--
-- PURAMENTE ADITIVA. Crea UNA tabla nueva y nada mas: ningun ALTER sobre una
-- tabla existente mas alla de la FK propia, ningun enum, ningun backfill,
-- ninguna sentencia destructiva. `User` no gana ninguna columna -- la relacion
-- inversa `platformAdmin` del schema es metadata de Prisma Client, no DDL.
--
-- UN SOLO INDICE SOBRE userId. El `@unique` ya emite
-- "PlatformAdmin_userId_key", que es el que sirve al unico lookup del guard
-- (findUnique por userId). No se agrega un CREATE INDEX no-unique redundante
-- sobre la misma columna; mismo criterio que "AuthCredential_userId_key".
--
-- ON DELETE CASCADE: borrar el User revoca la capacidad. ON UPDATE CASCADE es
-- lo que Prisma emite por convencion para una FK con onDelete: Cascade.
--
-- ---------------------------------------------------------------------------
-- REQUISITO DE DEPLOY -- PENDIENTE, NO EJECUTADO EN S1
-- ---------------------------------------------------------------------------
--
-- Despues de aplicar esta migration en RDS hay que VERIFICAR/OTORGAR los
-- privilegios de `scope_app` sobre la tabla nueva, ANTES de poner en
-- produccion codigo que consulte `PlatformAdmin`. Si no, el guard que la lee
-- (`src/platform-admin/platform-admin.guard.ts`) falla en runtime por permisos.
--
-- El mecanismo ya existe y es idempotente -- no hay que inventar nada:
--
--     infra/terraform/sql/02-grant-scope-app-on-existing-objects.sql
--
-- cuyo propio header dice: "RUN THIS: as scope_admin ... again after every
-- later migration batch, before the new code goes live". Hace
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public.
--
-- El `ALTER DEFAULT PRIVILEGES` de `01-bootstrap-scope-app-role.sql` cubriria
-- esta tabla automaticamente SI ese script se ejecuto alguna vez. Ambos
-- archivos declaran `STATUS: reviewed, not run`, lo que puede estar obsoleto
-- desde el pasaje a AWS. Mientras no se confirme, correr el 02 es la opcion
-- segura: solo otorga y es idempotente.
--
-- S1 NO ejecuta nada de esto. Y no bloquea a S1: en S1 ningun codigo en
-- produccion consulta todavia esta tabla (el guard existe pero no protege
-- ninguna ruta hasta S3).

-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_userId_key" ON "PlatformAdmin"("userId");

-- AddForeignKey
ALTER TABLE "PlatformAdmin" ADD CONSTRAINT "PlatformAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

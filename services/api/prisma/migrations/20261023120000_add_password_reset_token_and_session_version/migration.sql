-- Recuperacion de contrasena, Etapa 1 -- infraestructura de persistencia.
--
-- PURAMENTE ADITIVA. Una columna nueva con DEFAULT constante y una tabla nueva.
-- Ningun DROP, ningun RENAME, ningun backfill, ningun UPDATE ni DELETE sobre
-- datos existentes, ningun enum. No toca passwordHash, User, Credential,
-- IssuerMembership ni ningun dato academico o institucional.
--
-- 1. AuthCredential.sessionVersion INTEGER NOT NULL DEFAULT 0
--    Todas las cuentas existentes quedan en 0, sin backfill manual. Con
--    PostgreSQL 11 o superior, un DEFAULT constante NO reescribe la tabla: es un
--    cambio de catalogo. 0 coincide con los tokens emitidos antes de que existiera
--    el claim `sv` (claim ausente = version 0), asi que aplicar esta migracion no
--    desloguea a nadie.
--
-- 2. PasswordResetToken
--    Una fila por solicitud de restablecimiento. Guarda el SHA-256 del token, nunca
--    el token. En ESTA etapa nada la escribe ni la lee: queda lista para la
--    siguiente. Indices:
--      * "PasswordResetToken_tokenHash_key"            UNIQUE; sirve a la busqueda
--        por token (findUnique) y garantiza que no haya colisiones.
--      * "PasswordResetToken_userId_createdAt_idx"     cuota por cuenta e
--        invalidacion de los tokens vigentes de un usuario.
--      * "PasswordResetToken_createdAt_idx"            tope global por ventana.
--    FK a "User" con ON DELETE CASCADE: borrar el User borra sus tokens, igual que
--    "AuthCredential" y "PlatformAdmin". ON UPDATE CASCADE es lo que Prisma emite
--    por convencion para una FK con onDelete: Cascade.
--
-- El SQL de abajo es la salida literal de
--   prisma migrate diff --from-schema-datamodel <schema anterior> \
--                       --to-schema-datamodel prisma/schema.prisma --script
-- no esta escrito a mano.
--
-- ---------------------------------------------------------------------------
-- COMPATIBILIDAD CON EL CODIGO -- LEER ANTES DE DESPLEGAR
-- ---------------------------------------------------------------------------
--
--   API ANTERIOR + schema NUEVO   COMPATIBLE. El codigo viejo ignora la columna y
--                                 la tabla.
--   API NUEVA    + schema NUEVO   COMPATIBLE.
--   API NUEVA    + schema ANTERIOR  NO COMPATIBLE. `resolveAuthenticatedUser`
--                                 selecciona AuthCredential.sessionVersion en CADA
--                                 request autenticado; sin la columna la consulta
--                                 falla y TODA ruta protegida responde 500 (no es
--                                 una degradacion: /auth/me deja de andar).
--
-- Por eso el orden es obligatorio: MIGRAR PRIMERO, DESPLEGAR LA API DESPUES. No hay
-- forma de que el codigo nuevo "tolere" el schema viejo, y no se intenta ocultar.
--
-- ---------------------------------------------------------------------------
-- REQUISITO DE DEPLOY -- PENDIENTE, NO EJECUTADO
-- ---------------------------------------------------------------------------
--
-- Despues de aplicar esta migration en RDS hay que VERIFICAR/OTORGAR los
-- privilegios de `scope_app` sobre la tabla nueva, ANTES de poner en produccion
-- codigo que consulte "PasswordResetToken". Si no, esa consulta falla en runtime
-- por permisos. (La columna nueva de "AuthCredential" no necesita grant: el GRANT
-- es por tabla y `scope_app` ya lee y escribe "AuthCredential".)
--
-- El mecanismo ya existe y es idempotente:
--
--     infra/terraform/sql/02-grant-scope-app-on-existing-objects.sql
--
-- cuyo propio header dice: "RUN THIS: as scope_admin ... again after every later
-- migration batch, before the new code goes live". Hace
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public.
--
-- Esta etapa NO ejecuta nada de esto, ni migra ninguna base real.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
--
-- No hace falta revertir el schema para volver al codigo anterior: es aditivo y
-- el codigo viejo lo ignora. ATENCION: una vez que una etapa posterior incremente
-- sessionVersion, volver a un codigo que IGNORE el claim `sv` revalidaria las
-- sesiones que habian sido invalidadas (hasta que venzan). Eso se resuelve en el
-- runbook de la etapa que activa el restablecimiento, no aca.

-- AlterTable
ALTER TABLE "AuthCredential" ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_createdAt_idx" ON "PasswordResetToken"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_createdAt_idx" ON "PasswordResetToken"("createdAt");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

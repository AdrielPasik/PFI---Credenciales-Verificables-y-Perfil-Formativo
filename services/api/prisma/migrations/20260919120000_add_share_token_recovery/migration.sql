-- Enlaces compartidos reutilizables: material de recuperacion del DUENO.
--
-- Aditiva y nullable: las filas historicas no se reescriben, no se rellenan y no
-- se les inventa un sobre. La autoridad publica sigue siendo "tokenHash".
ALTER TABLE "SharingGrant" ADD COLUMN "tokenRecovery" TEXT;

-- S8c6: el intent `pending` de registracion se vuelve DURABLE.
--
-- Los tres campos de abajo son HECHOS DE LA CADENA. Antes eran NOT NULL, asi
-- que una fila solo podia existir DESPUES de que la transaccion estuviera
-- minada -- y eso es exactamente lo que forzaba a mantener abierta la
-- transaccion de PostgreSQL durante el RPC y el mineo.
--
--   txHash         hash de la transaccion que registro el hash
--   issuerAddress  registrante OBSERVADO (`transaction.from` / `msg.sender`)
--   registeredAt   momento de la registracion EN LA CADENA (`block.timestamp`)
--
-- NULL significa "todavia no observado", nunca "vacio". No se introduce ningun
-- placeholder: ni `txHash = 'pending'`, ni `''`, ni `blockNumber = 0`, ni
-- ZeroAddress, ni `DEFAULT now()` -- un default de reloj le daria a una fila
-- pendiente un timestamp de cadena falso.
--
-- `blockNumber` ya era nullable desde S8c1. `BlockchainRecordStatus.pending`
-- tambien existe desde S8c1: era alcanzable a nivel enum mientras `txHash`
-- seguia NOT NULL, lo que hacia el estado inexpresable en la practica.
--
-- UNICIDAD: `txHash` NO tiene `@unique`, solo `@@index`. Verificado contra
-- 20260709135135_init (CREATE INDEX "BlockchainRecord_txHash_idx"), asi que
-- esta migration no toca ninguna restriccion de unicidad y no hay que razonar
-- sobre el tratamiento de NULL en un indice unico de PostgreSQL.
--
-- SIN BACKFILL. Ninguna fila existente se reescribe: aflojar NOT NULL no toca
-- datos. Las filas legacy y las de modo mock siguen con sus tres campos
-- poblados y siguen siendo validas.
--
-- Derivada con `prisma migrate diff --from-schema-datamodel ... --script`, sin
-- base de datos. No se aplico contra ningun RDS ni Neon.

-- AlterTable
ALTER TABLE "BlockchainRecord" ALTER COLUMN "txHash" DROP NOT NULL,
ALTER COLUMN "issuerAddress" DROP NOT NULL,
ALTER COLUMN "registeredAt" DROP NOT NULL;

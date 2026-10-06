-- S8c1 -- IDENTIDAD TECNICA DEL ISSUER + PROCEDENCIA DE EVIDENCIA.
--
-- Migration PURAMENTE ADITIVA. No borra, no renombra, no reescribe datos y no
-- endurece ninguna columna preexistente:
--   * seis enums nuevos;
--   * UN valor nuevo al final de un enum existente;
--   * dos tablas nuevas;
--   * columnas NUEVAS sobre Issuer, Credential y BlockchainRecord.
--
-- Deliberadamente SIN backfill. Las filas existentes de BlockchainRecord quedan
-- con procedencia NULL (legacy/desconocida): etiquetarlas como mock, como
-- credential_registry, como compartidas o como pertenecientes a algun
-- deployment seria inventar historia que la fila no prueba.
--
-- `Issuer.did` y `Issuer.walletAddress` NO se tocan: siguen siendo los campos
-- que lee el producto hasta el cutover de readers.
--
-- El orden y la forma de las sentencias son los que genera `prisma migrate
-- diff` para este par de datamodels, con UNA sola divergencia deliberada,
-- documentada mas abajo: el `NOT NULL` de `allowedCredentialTypes`.

-- CreateEnum
CREATE TYPE "BlockchainEvidenceMode" AS ENUM ('mock', 'credential_registry');

-- CreateEnum
CREATE TYPE "AnchorRegistrantScope" AS ENUM ('issuer_exclusive', 'shared_custodial');

-- CreateEnum
CREATE TYPE "SignerProfilePurpose" AS ENUM ('assertion', 'anchor');

-- CreateEnum
CREATE TYPE "SignerKeyCustody" AS ENUM ('scope_managed', 'institution_imported');

-- CreateEnum
CREATE TYPE "SignerProfileStatus" AS ENUM ('active', 'retired', 'compromised');

-- CreateEnum
CREATE TYPE "IssuerTechnicalIdentityStatus" AS ENUM ('unconfigured', 'active', 'rotation_required', 'disabled');

-- AlterEnum
-- Se agrega AL FINAL: el orden de declaracion define el orden de comparacion
-- del enum en PostgreSQL, y agregar al final permite un ADD VALUE plano, sin
-- BEFORE/AFTER. Valido dentro de una transaccion en PostgreSQL 12+ porque el
-- valor nuevo NO se usa en esta misma migration.
ALTER TYPE "BlockchainRecordStatus" ADD VALUE 'pending';

-- AlterTable
-- SEMANTICA DE DOMINIO, expresada por la base y no por el ORM:
--   NOT NULL   -> NULL no es un estado persistible. El dominio tiene tres
--                 estados para este campo, no cuatro, y PostgreSQL no puede
--                 distinguir NULL de ARRAY[].
--   DEFAULT [] -> las filas Issuer EXISTENTES reciben el array vacio al
--                 aplicarse esta migration, y las filas FUTURAS que no
--                 declaren un valor tambien. "[]" significa: ningun credential
--                 type habilitado.
-- Una sola sentencia, sin UPDATE de backfill: en PostgreSQL 11+ un ADD COLUMN
-- con default CONSTANTE es metadata-only, no reescribe la tabla y no bloquea
-- lecturas.
--
-- `prisma migrate diff` genera esta misma sentencia con `DEFAULT
-- ARRAY[]::"CredentialType"[]` pero SIN `NOT NULL`: el lenguaje de schema de
-- Prisma no puede expresar una lista escalar nullable (la aridad `List` no
-- tiene variante opcional), asi que el motor no emite ninguna marca de
-- nulabilidad para columnas de array. El `NOT NULL` se agrega a proposito para
-- que la restriccion viva en la base y no dependa de que el cliente se niegue a
-- escribir NULL.
ALTER TABLE "Issuer" ADD COLUMN     "allowedCredentialTypes" "CredentialType"[] NOT NULL DEFAULT ARRAY[]::"CredentialType"[];

-- AlterTable
ALTER TABLE "Credential" ADD COLUMN     "proof" JSONB;

-- AlterTable
ALTER TABLE "BlockchainRecord" ADD COLUMN     "anchorRegistrantScope" "AnchorRegistrantScope",
ADD COLUMN     "anchorSignerProfileId" TEXT,
ADD COLUMN     "blockNumber" INTEGER,
ADD COLUMN     "deploymentId" TEXT,
ADD COLUMN     "evidenceMode" "BlockchainEvidenceMode";

-- CreateTable
CREATE TABLE "SignerProfile" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "purpose" "SignerProfilePurpose" NOT NULL,
    "custody" "SignerKeyCustody" NOT NULL,
    "secretRef" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "publicKeyX" TEXT,
    "publicKeyY" TEXT,
    "publicKeyCompressed" TEXT,
    "keyVersion" INTEGER NOT NULL,
    "addressVerifiedAt" TIMESTAMP(3),
    "status" "SignerProfileStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "SignerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuerTechnicalIdentity" (
    "id" TEXT NOT NULL,
    "issuerId" TEXT NOT NULL,
    "did" TEXT NOT NULL,
    "assertionSignerProfileId" TEXT NOT NULL,
    "anchorSignerProfileId" TEXT NOT NULL,
    "status" "IssuerTechnicalIdentityStatus" NOT NULL DEFAULT 'unconfigured',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssuerTechnicalIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignerProfile_label_key" ON "SignerProfile"("label");

-- CreateIndex
CREATE UNIQUE INDEX "SignerProfile_secretRef_key" ON "SignerProfile"("secretRef");

-- CreateIndex
CREATE UNIQUE INDEX "SignerProfile_address_key" ON "SignerProfile"("address");

-- CreateIndex
CREATE INDEX "SignerProfile_purpose_idx" ON "SignerProfile"("purpose");

-- CreateIndex
CREATE INDEX "SignerProfile_status_idx" ON "SignerProfile"("status");

-- CreateIndex
CREATE UNIQUE INDEX "IssuerTechnicalIdentity_issuerId_key" ON "IssuerTechnicalIdentity"("issuerId");

-- CreateIndex
CREATE UNIQUE INDEX "IssuerTechnicalIdentity_did_key" ON "IssuerTechnicalIdentity"("did");

-- CreateIndex
CREATE UNIQUE INDEX "IssuerTechnicalIdentity_assertionSignerProfileId_key" ON "IssuerTechnicalIdentity"("assertionSignerProfileId");

-- CreateIndex
CREATE INDEX "IssuerTechnicalIdentity_anchorSignerProfileId_idx" ON "IssuerTechnicalIdentity"("anchorSignerProfileId");

-- CreateIndex
CREATE INDEX "IssuerTechnicalIdentity_status_idx" ON "IssuerTechnicalIdentity"("status");

-- CreateIndex
CREATE INDEX "BlockchainRecord_evidenceMode_idx" ON "BlockchainRecord"("evidenceMode");

-- CreateIndex
CREATE INDEX "BlockchainRecord_anchorSignerProfileId_idx" ON "BlockchainRecord"("anchorSignerProfileId");

-- AddForeignKey
-- RESTRICT, no SET NULL: esta referencia ES la procedencia historica del
-- signer que registro el hash. El default de Prisma para una relacion opcional
-- la pondria en NULL al borrar el perfil, destruyendo exactamente el dato que
-- la revocacion necesita despues de una rotacion.
ALTER TABLE "BlockchainRecord" ADD CONSTRAINT "BlockchainRecord_anchorSignerProfileId_fkey" FOREIGN KEY ("anchorSignerProfileId") REFERENCES "SignerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuerTechnicalIdentity" ADD CONSTRAINT "IssuerTechnicalIdentity_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "Issuer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuerTechnicalIdentity" ADD CONSTRAINT "IssuerTechnicalIdentity_assertionSignerProfileId_fkey" FOREIGN KEY ("assertionSignerProfileId") REFERENCES "SignerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuerTechnicalIdentity" ADD CONSTRAINT "IssuerTechnicalIdentity_anchorSignerProfileId_fkey" FOREIGN KEY ("anchorSignerProfileId") REFERENCES "SignerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

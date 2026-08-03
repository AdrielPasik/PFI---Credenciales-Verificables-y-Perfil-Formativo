-- CreateEnum
CREATE TYPE "DocumentEvidenceKind" AS ENUM ('pdf', 'image');

-- CreateEnum
CREATE TYPE "DocumentEvidenceStatus" AS ENUM ('current', 'replaced');

-- CreateTable
CREATE TABLE "DocumentEvidence" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "kind" "DocumentEvidenceKind" NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "DocumentEvidenceStatus" NOT NULL DEFAULT 'current',
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentEvidence_storageKey_key" ON "DocumentEvidence"("storageKey");

-- CreateIndex
CREATE INDEX "DocumentEvidence_credentialId_idx" ON "DocumentEvidence"("credentialId");

-- CreateIndex
CREATE INDEX "DocumentEvidence_uploadedByUserId_idx" ON "DocumentEvidence"("uploadedByUserId");

-- CreateIndex
CREATE INDEX "DocumentEvidence_sha256_idx" ON "DocumentEvidence"("sha256");

-- Prisma does not model partial unique indexes directly. This enforces the v0
-- invariant while retaining replaced evidence rows as immutable history.
CREATE UNIQUE INDEX "DocumentEvidence_one_current_per_credential"
ON "DocumentEvidence" ("credentialId")
WHERE "status" = 'current';

-- AddForeignKey
ALTER TABLE "DocumentEvidence" ADD CONSTRAINT "DocumentEvidence_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentEvidence" ADD CONSTRAINT "DocumentEvidence_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

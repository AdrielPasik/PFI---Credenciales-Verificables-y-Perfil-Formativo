-- CreateEnum
CREATE TYPE "TextEvidenceStatus" AS ENUM ('current', 'replaced');

-- CreateTable
CREATE TABLE "TextEvidence" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "label" TEXT,
    "content" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" "TextEvidenceStatus" NOT NULL DEFAULT 'current',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedAt" TIMESTAMP(3),

    CONSTRAINT "TextEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TextEvidence_credentialId_idx" ON "TextEvidence"("credentialId");

-- CreateIndex
CREATE INDEX "TextEvidence_submittedByUserId_idx" ON "TextEvidence"("submittedByUserId");

-- CreateIndex
CREATE INDEX "TextEvidence_sha256_idx" ON "TextEvidence"("sha256");

-- Prisma does not model partial unique indexes directly. This preserves
-- replaced rows while enforcing one current text source per credential.
CREATE UNIQUE INDEX "TextEvidence_one_current_per_credential"
ON "TextEvidence" ("credentialId")
WHERE "status" = 'current';

-- AddForeignKey
ALTER TABLE "TextEvidence" ADD CONSTRAINT "TextEvidence_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TextEvidence" ADD CONSTRAINT "TextEvidence_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

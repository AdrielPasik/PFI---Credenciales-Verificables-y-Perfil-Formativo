-- CreateEnum
CREATE TYPE "CredentialSemanticInterpretationStatus" AS ENUM ('active', 'superseded');

-- CreateEnum
CREATE TYPE "CredentialSemanticInterpretationSource" AS ENUM ('issuer_reviewed_template_snapshot');

-- CreateTable
CREATE TABLE "CredentialReusableSemanticInterpretation" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "sourceSemanticAnalysisId" TEXT NOT NULL,
    "sourceCredentialId" TEXT NOT NULL,
    "sourceApprovedByUserId" TEXT NOT NULL,
    "sourceApprovedAt" TIMESTAMP(3) NOT NULL,
    "sourcePipelineVersion" TEXT NOT NULL,
    "sourceTaxonomyVersion" TEXT NOT NULL,
    "approvedSnapshot" JSONB NOT NULL,
    "snapshotVersion" TEXT NOT NULL,
    "provenance" "CredentialSemanticInterpretationSource" NOT NULL DEFAULT 'issuer_reviewed_template_snapshot',
    "status" "CredentialSemanticInterpretationStatus" NOT NULL DEFAULT 'active',
    "appliedByUserId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),
    "supersededByUserId" TEXT,

    CONSTRAINT "CredentialReusableSemanticInterpretation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CredentialReusableSemanticInterpretation_credentialId_idx" ON "CredentialReusableSemanticInterpretation"("credentialId");

-- CreateIndex
CREATE INDEX "crsi_credentialId_status_idx" ON "CredentialReusableSemanticInterpretation"("credentialId", "status");

-- CreateIndex
CREATE INDEX "CredentialReusableSemanticInterpretation_templateId_idx" ON "CredentialReusableSemanticInterpretation"("templateId");

-- CreateIndex
CREATE INDEX "CredentialReusableSemanticInterpretation_appliedAt_idx" ON "CredentialReusableSemanticInterpretation"("appliedAt");

-- Prisma does not model partial unique indexes directly (same limitation
-- already worked around for DocumentEvidence/TextEvidence "one current per
-- credential"). This enforces the C4b core invariant at the database level:
-- a credential can have at most one `active` applied interpretation at a
-- time, while every `superseded` row is retained as immutable history.
-- Short explicit name: the natural
-- "CredentialReusableSemanticInterpretation_one_active_per_credential" name
-- exceeds PostgreSQL's 63-byte identifier limit and would be truncated
-- unpredictably.
CREATE UNIQUE INDEX "crsi_one_active_per_credential_uq"
ON "CredentialReusableSemanticInterpretation" ("credentialId")
WHERE "status" = 'active';

-- AddForeignKey
ALTER TABLE "CredentialReusableSemanticInterpretation" ADD CONSTRAINT "CredentialReusableSemanticInterpretation_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialReusableSemanticInterpretation" ADD CONSTRAINT "CredentialReusableSemanticInterpretation_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "IssuerCourseTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialReusableSemanticInterpretation" ADD CONSTRAINT "CredentialReusableSemanticInterpretation_appliedByUserId_fkey" FOREIGN KEY ("appliedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "IssuerCourseTemplate" ADD COLUMN     "approvedSemanticAnalysisId" TEXT,
ADD COLUMN     "approvedSemanticApprovedAt" TIMESTAMP(3),
ADD COLUMN     "approvedSemanticApprovedByUserId" TEXT,
ADD COLUMN     "approvedSemanticPipelineVersion" TEXT,
ADD COLUMN     "approvedSemanticSnapshot" JSONB,
ADD COLUMN     "approvedSemanticSourceCredentialId" TEXT,
ADD COLUMN     "approvedSemanticTaxonomyVersion" TEXT;

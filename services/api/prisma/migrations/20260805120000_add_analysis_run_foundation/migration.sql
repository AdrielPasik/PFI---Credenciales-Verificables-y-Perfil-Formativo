-- CreateEnum
CREATE TYPE "AnalysisRunStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "AnalysisRunInputMode" AS ENUM ('document', 'text', 'combined');

-- CreateEnum
CREATE TYPE "AnalysisRunTrigger" AS ENUM ('manual', 'system');

-- CreateEnum
CREATE TYPE "AnalysisRunSourceType" AS ENUM ('document_evidence', 'text_evidence');

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "status" "AnalysisRunStatus" NOT NULL DEFAULT 'pending',
    "inputMode" "AnalysisRunInputMode" NOT NULL,
    "trigger" "AnalysisRunTrigger" NOT NULL,
    "requestedPipelineVersion" TEXT NOT NULL,
    "requestedTaxonomyVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRunSource" (
    "id" TEXT NOT NULL,
    "analysisRunId" TEXT NOT NULL,
    "sourceType" "AnalysisRunSourceType" NOT NULL,
    "documentEvidenceId" TEXT,
    "textEvidenceId" TEXT,
    "sourceSha256" TEXT NOT NULL,
    "sourceLabel" TEXT,
    "sourceStatusAtRun" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AnalysisRunSource_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AnalysisRunSource_exactly_one_source" CHECK (
      ("sourceType" = 'document_evidence' AND "documentEvidenceId" IS NOT NULL AND "textEvidenceId" IS NULL)
      OR
      ("sourceType" = 'text_evidence' AND "textEvidenceId" IS NOT NULL AND "documentEvidenceId" IS NULL)
    )
);

CREATE INDEX "AnalysisRun_credentialId_idx" ON "AnalysisRun"("credentialId");
CREATE INDEX "AnalysisRun_requestedByUserId_idx" ON "AnalysisRun"("requestedByUserId");
CREATE INDEX "AnalysisRun_status_idx" ON "AnalysisRun"("status");
CREATE INDEX "AnalysisRun_createdAt_idx" ON "AnalysisRun"("createdAt");
CREATE UNIQUE INDEX "AnalysisRunSource_analysisRunId_documentEvidenceId_key" ON "AnalysisRunSource"("analysisRunId", "documentEvidenceId");
CREATE UNIQUE INDEX "AnalysisRunSource_analysisRunId_textEvidenceId_key" ON "AnalysisRunSource"("analysisRunId", "textEvidenceId");
CREATE INDEX "AnalysisRunSource_analysisRunId_idx" ON "AnalysisRunSource"("analysisRunId");
CREATE INDEX "AnalysisRunSource_documentEvidenceId_idx" ON "AnalysisRunSource"("documentEvidenceId");
CREATE INDEX "AnalysisRunSource_textEvidenceId_idx" ON "AnalysisRunSource"("textEvidenceId");
CREATE INDEX "AnalysisRunSource_sourceSha256_idx" ON "AnalysisRunSource"("sourceSha256");
ALTER TABLE "SemanticAnalysis" ADD COLUMN "analysisRunId" TEXT;
CREATE INDEX "SemanticAnalysis_analysisRunId_idx" ON "SemanticAnalysis"("analysisRunId");

ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnalysisRunSource" ADD CONSTRAINT "AnalysisRunSource_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalysisRunSource" ADD CONSTRAINT "AnalysisRunSource_documentEvidenceId_fkey" FOREIGN KEY ("documentEvidenceId") REFERENCES "DocumentEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AnalysisRunSource" ADD CONSTRAINT "AnalysisRunSource_textEvidenceId_fkey" FOREIGN KEY ("textEvidenceId") REFERENCES "TextEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SemanticAnalysis" ADD CONSTRAINT "SemanticAnalysis_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "AnalysisRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

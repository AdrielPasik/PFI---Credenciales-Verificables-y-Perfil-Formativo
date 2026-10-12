-- Profile Embedding V1-C: additive persistence only.
--
-- No existing data is rewritten and no vector-search extension is introduced.
-- V1-D writes only successful SourceEmbedding rows. The profile-level tables
-- are deliberately schema-only until composition is authorized separately.

CREATE TYPE "ProfileEmbeddingCoverageStatus" AS ENUM ('COMPLETE', 'PARTIAL', 'UNAVAILABLE');
CREATE TYPE "ProfileEmbeddingComponentStatus" AS ENUM ('INCLUDED', 'UNAVAILABLE', 'INVALID', 'DUPLICATE', 'INCOMPATIBLE');

CREATE TABLE "SourceEmbedding" (
    "id" TEXT NOT NULL,
    "analysisRunSourceId" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "sourceArtifactBlobSha256" TEXT,
    "dependencyFingerprintSha256" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelRevision" TEXT NOT NULL,
    "embeddingDimension" INTEGER NOT NULL,
    "sourcePolicyVersion" TEXT NOT NULL,
    "longTextPolicyVersion" TEXT NOT NULL,
    "longTextPolicySha256" TEXT NOT NULL,
    "vector" DOUBLE PRECISION[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FormativeProfileEmbedding" (
    "id" TEXT NOT NULL,
    "formativeProfileId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelRevision" TEXT NOT NULL,
    "embeddingDimension" INTEGER NOT NULL,
    "sourcePolicyVersion" TEXT NOT NULL,
    "longTextPolicyVersion" TEXT NOT NULL,
    "longTextPolicySha256" TEXT NOT NULL,
    "compositionPolicyVersion" TEXT NOT NULL,
    "vector" DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "coverageStatus" "ProfileEmbeddingCoverageStatus" NOT NULL,
    "totalExpectedSources" INTEGER NOT NULL,
    "includedSourceCount" INTEGER NOT NULL,
    "unavailableSourceCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormativeProfileEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FormativeProfileEmbeddingComponent" (
    "id" TEXT NOT NULL,
    "formativeProfileEmbeddingId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "credentialId" TEXT NOT NULL,
    "analysisRunSourceId" TEXT,
    "sourceEmbeddingId" TEXT,
    "status" "ProfileEmbeddingComponentStatus" NOT NULL,
    "reasonCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormativeProfileEmbeddingComponent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SourceEmbedding_dependencyFingerprintSha256_key" ON "SourceEmbedding"("dependencyFingerprintSha256");
CREATE INDEX "SourceEmbedding_analysisRunSourceId_idx" ON "SourceEmbedding"("analysisRunSourceId");
CREATE INDEX "SourceEmbedding_sourceSha256_idx" ON "SourceEmbedding"("sourceSha256");
CREATE UNIQUE INDEX "FormativeProfileEmbedding_formativeProfileId_key" ON "FormativeProfileEmbedding"("formativeProfileId");
CREATE UNIQUE INDEX "FormativeProfileEmbeddingComponent_formativeProfileEmbeddingId_ordinal_key" ON "FormativeProfileEmbeddingComponent"("formativeProfileEmbeddingId", "ordinal");
CREATE INDEX "FormativeProfileEmbeddingComponent_credentialId_idx" ON "FormativeProfileEmbeddingComponent"("credentialId");
CREATE INDEX "FormativeProfileEmbeddingComponent_analysisRunSourceId_idx" ON "FormativeProfileEmbeddingComponent"("analysisRunSourceId");
CREATE INDEX "FormativeProfileEmbeddingComponent_sourceEmbeddingId_idx" ON "FormativeProfileEmbeddingComponent"("sourceEmbeddingId");

ALTER TABLE "SourceEmbedding" ADD CONSTRAINT "SourceEmbedding_analysisRunSourceId_fkey"
  FOREIGN KEY ("analysisRunSourceId") REFERENCES "AnalysisRunSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FormativeProfileEmbedding" ADD CONSTRAINT "FormativeProfileEmbedding_formativeProfileId_fkey"
  FOREIGN KEY ("formativeProfileId") REFERENCES "FormativeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormativeProfileEmbeddingComponent" ADD CONSTRAINT "FormativeProfileEmbeddingComponent_formativeProfileEmbeddingId_fkey"
  FOREIGN KEY ("formativeProfileEmbeddingId") REFERENCES "FormativeProfileEmbedding"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormativeProfileEmbeddingComponent" ADD CONSTRAINT "FormativeProfileEmbeddingComponent_credentialId_fkey"
  FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FormativeProfileEmbeddingComponent" ADD CONSTRAINT "FormativeProfileEmbeddingComponent_analysisRunSourceId_fkey"
  FOREIGN KEY ("analysisRunSourceId") REFERENCES "AnalysisRunSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FormativeProfileEmbeddingComponent" ADD CONSTRAINT "FormativeProfileEmbeddingComponent_sourceEmbeddingId_fkey"
  FOREIGN KEY ("sourceEmbeddingId") REFERENCES "SourceEmbedding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Successful source artifacts are always real 384-D unit-vector candidates;
-- profile vectors encode their availability explicitly. An unavailable profile
-- uses [] and is never a zero vector.
ALTER TABLE "SourceEmbedding" ADD CONSTRAINT "SourceEmbedding_vector_dimension_check"
  CHECK ("embeddingDimension" = 384 AND cardinality("vector") = 384);
ALTER TABLE "FormativeProfileEmbedding" ADD CONSTRAINT "FormativeProfileEmbedding_vector_coverage_check"
  CHECK (
    ("coverageStatus" = 'UNAVAILABLE' AND cardinality("vector") = 0 AND "includedSourceCount" = 0)
    OR
    ("coverageStatus" IN ('COMPLETE', 'PARTIAL') AND cardinality("vector") = 384 AND "includedSourceCount" >= 1)
  );
ALTER TABLE "FormativeProfileEmbedding" ADD CONSTRAINT "FormativeProfileEmbedding_counts_nonnegative_check"
  CHECK (
    "totalExpectedSources" >= 0
    AND "includedSourceCount" >= 0
    AND "unavailableSourceCount" >= 0
  );

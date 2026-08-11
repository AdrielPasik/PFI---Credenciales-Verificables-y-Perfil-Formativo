-- CreateEnum
CREATE TYPE "CourseTemplateStatus" AS ENUM ('active', 'archived');

-- CreateTable
CREATE TABLE "IssuerCourseTemplate" (
    "id" TEXT NOT NULL,
    "issuerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "hours" DECIMAL(10,2),
    "modality" TEXT,
    "platformName" TEXT,
    "externalUrl" TEXT,
    "competencies" TEXT[],
    "learningOutcomes" TEXT[],
    "status" "CourseTemplateStatus" NOT NULL DEFAULT 'active',
    "createdFromCredentialId" TEXT,
    "lastSemanticAnalysisId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssuerCourseTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssuerCourseTemplate_issuerId_idx" ON "IssuerCourseTemplate"("issuerId");

-- CreateIndex
CREATE INDEX "IssuerCourseTemplate_issuerId_status_idx" ON "IssuerCourseTemplate"("issuerId", "status");

-- CreateIndex
CREATE INDEX "IssuerCourseTemplate_issuerId_title_idx" ON "IssuerCourseTemplate"("issuerId", "title");

-- AddForeignKey
ALTER TABLE "IssuerCourseTemplate" ADD CONSTRAINT "IssuerCourseTemplate_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "Issuer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuerCourseTemplate" ADD CONSTRAINT "IssuerCourseTemplate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "IssuerCourseTemplate" ADD COLUMN     "certificationCode" TEXT,
ADD COLUMN     "credentialType" "CredentialType" NOT NULL DEFAULT 'course',
ADD COLUMN     "expirationDate" TEXT,
ADD COLUMN     "level" TEXT,
ADD COLUMN     "providerName" TEXT,
ADD COLUMN     "skills" TEXT[];

-- CreateIndex
CREATE INDEX "IssuerCourseTemplate_issuerId_credentialType_idx" ON "IssuerCourseTemplate"("issuerId", "credentialType");

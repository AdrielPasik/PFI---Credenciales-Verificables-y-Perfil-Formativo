-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'pending', 'suspended', 'archived');

-- CreateEnum
CREATE TYPE "IssuerAuthorizationStatus" AS ENUM ('pending', 'authorized', 'revoked');

-- CreateEnum
CREATE TYPE "IssuerMembershipRole" AS ENUM ('admin', 'operator', 'viewer');

-- CreateEnum
CREATE TYPE "IssuerMembershipStatus" AS ENUM ('active', 'pending', 'revoked');

-- CreateEnum
CREATE TYPE "CredentialType" AS ENUM ('academic_subject', 'course', 'certification', 'degree');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('draft', 'issued', 'revoked');

-- CreateEnum
CREATE TYPE "CredentialSourceType" AS ENUM ('academic_pdf', 'course_dataset', 'manual_issuer', 'institutional_system', 'external_import');

-- CreateEnum
CREATE TYPE "SemanticAnalysisStatus" AS ENUM ('completed', 'partial');

-- CreateEnum
CREATE TYPE "BlockchainNetwork" AS ENUM ('anvil', 'base-sepolia', 'base-mainnet');

-- CreateEnum
CREATE TYPE "BlockchainRecordStatus" AS ENUM ('registered', 'revoked');

-- CreateEnum
CREATE TYPE "VerificationResult" AS ENUM ('valid', 'revoked', 'invalid', 'not_found', 'indeterminate');

-- CreateEnum
CREATE TYPE "RevocationStatus" AS ENUM ('active', 'revoked', 'unknown');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('holder', 'issuer_admin', 'verifier', 'system_admin', 'public_link', 'system');

-- CreateEnum
CREATE TYPE "VerificationChannel" AS ENUM ('api', 'qr_link', 'shared_link', 'internal_audit');

-- CreateEnum
CREATE TYPE "ProgramStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "CurriculumVersionStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('active', 'inactive', 'archived');

-- CreateEnum
CREATE TYPE "SharingGrantScope" AS ENUM ('credential', 'profile', 'credential_and_profile');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "did" TEXT,
    "email" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "displayName" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issuer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "did" TEXT,
    "walletAddress" TEXT,
    "authorizationStatus" "IssuerAuthorizationStatus" NOT NULL DEFAULT 'pending',
    "authorizedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "Issuer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuerMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "issuerId" TEXT NOT NULL,
    "role" "IssuerMembershipRole" NOT NULL DEFAULT 'operator',
    "status" "IssuerMembershipStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssuerMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credential" (
    "id" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT 'credential_v1',
    "type" "CredentialType" NOT NULL,
    "issuerId" TEXT NOT NULL,
    "subjectUserId" TEXT NOT NULL,
    "academicCourseId" TEXT,
    "externalCourseId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" "CredentialSourceType" NOT NULL,
    "status" "CredentialStatus" NOT NULL DEFAULT 'draft',
    "hours" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,
    "canonicalHash" TEXT,
    "canonicalizationVersion" TEXT,
    "credentialSubject" JSONB NOT NULL,
    "metadata" JSONB,
    "rawData" JSONB,

    CONSTRAINT "Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SemanticAnalysis" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT 'semantic_analysis_v1',
    "status" "SemanticAnalysisStatus" NOT NULL,
    "pipelineVersion" TEXT NOT NULL,
    "taxonomyVersion" TEXT NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL,
    "confidence" DECIMAL(5,4),
    "areas" JSONB NOT NULL,
    "skills" JSONB NOT NULL,
    "concepts" JSONB NOT NULL,
    "qualityFlags" JSONB NOT NULL,
    "evidenceMap" JSONB NOT NULL,
    "textForEmbedding" TEXT NOT NULL,
    "analysisJson" JSONB,

    CONSTRAINT "SemanticAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormativeProfile" (
    "id" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT 'formative_profile_v1',
    "userId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "credentialsCount" INTEGER NOT NULL,
    "totalHours" DECIMAL(10,2) NOT NULL,
    "profileVersion" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "generationMethod" TEXT,
    "areasSummary" JSONB NOT NULL,
    "skillsSummary" JSONB NOT NULL,
    "evidenceByArea" JSONB NOT NULL,
    "qualityFlags" JSONB NOT NULL,
    "profileJson" JSONB,

    CONSTRAINT "FormativeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockchainRecord" (
    "id" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT 'blockchain_record_v1',
    "credentialId" TEXT NOT NULL,
    "credentialHash" TEXT NOT NULL,
    "hashAlgorithm" TEXT NOT NULL,
    "canonicalizationVersion" TEXT NOT NULL,
    "network" "BlockchainNetwork" NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "issuerAddress" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL,
    "status" "BlockchainRecordStatus" NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revocationReason" TEXT,

    CONSTRAINT "BlockchainRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationEvent" (
    "id" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "verifierUserId" TEXT,
    "sharingGrantId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "verificationChannel" "VerificationChannel" NOT NULL,
    "result" "VerificationResult" NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hashMatch" BOOLEAN,
    "issuerValid" BOOLEAN,
    "revocationStatus" "RevocationStatus",
    "requestContext" JSONB,
    "responseSummary" JSONB,

    CONSTRAINT "VerificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcademicCourse" (
    "id" TEXT NOT NULL,
    "issuerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hours" DECIMAL(10,2),
    "status" "CourseStatus" NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcademicCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalCourse" (
    "id" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "externalReference" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "subCategory" TEXT,
    "level" TEXT,
    "durationRaw" TEXT,
    "durationHoursEstimate" DECIMAL(10,2),
    "status" "CourseStatus" NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "issuerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "programType" TEXT,
    "status" "ProgramStatus" NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurriculumVersion" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "status" "CurriculumVersionStatus" NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurriculumVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramCourse" (
    "id" TEXT NOT NULL,
    "curriculumVersionId" TEXT NOT NULL,
    "academicCourseId" TEXT NOT NULL,
    "semester" INTEGER,
    "year" INTEGER,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "ordering" INTEGER,
    "credits" DECIMAL(10,2),
    "hours" DECIMAL(10,2),

    CONSTRAINT "ProgramCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SharingGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT,
    "profileId" TEXT,
    "createdByUserId" TEXT,
    "scope" "SharingGrantScope" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "SharingGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_did_key" ON "User"("did");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Issuer_did_key" ON "Issuer"("did");

-- CreateIndex
CREATE UNIQUE INDEX "Issuer_walletAddress_key" ON "Issuer"("walletAddress");

-- CreateIndex
CREATE INDEX "Issuer_authorizationStatus_idx" ON "Issuer"("authorizationStatus");

-- CreateIndex
CREATE INDEX "IssuerMembership_userId_idx" ON "IssuerMembership"("userId");

-- CreateIndex
CREATE INDEX "IssuerMembership_issuerId_idx" ON "IssuerMembership"("issuerId");

-- CreateIndex
CREATE INDEX "IssuerMembership_status_idx" ON "IssuerMembership"("status");

-- CreateIndex
CREATE UNIQUE INDEX "IssuerMembership_userId_issuerId_key" ON "IssuerMembership"("userId", "issuerId");

-- CreateIndex
CREATE INDEX "Credential_issuerId_idx" ON "Credential"("issuerId");

-- CreateIndex
CREATE INDEX "Credential_subjectUserId_idx" ON "Credential"("subjectUserId");

-- CreateIndex
CREATE INDEX "Credential_status_idx" ON "Credential"("status");

-- CreateIndex
CREATE INDEX "Credential_canonicalHash_idx" ON "Credential"("canonicalHash");

-- CreateIndex
CREATE INDEX "Credential_type_idx" ON "Credential"("type");

-- CreateIndex
CREATE INDEX "Credential_academicCourseId_idx" ON "Credential"("academicCourseId");

-- CreateIndex
CREATE INDEX "Credential_externalCourseId_idx" ON "Credential"("externalCourseId");

-- CreateIndex
CREATE INDEX "SemanticAnalysis_credentialId_idx" ON "SemanticAnalysis"("credentialId");

-- CreateIndex
CREATE INDEX "SemanticAnalysis_pipelineVersion_idx" ON "SemanticAnalysis"("pipelineVersion");

-- CreateIndex
CREATE INDEX "SemanticAnalysis_credentialId_pipelineVersion_taxonomyVersi_idx" ON "SemanticAnalysis"("credentialId", "pipelineVersion", "taxonomyVersion");

-- CreateIndex
CREATE INDEX "FormativeProfile_userId_idx" ON "FormativeProfile"("userId");

-- CreateIndex
CREATE INDEX "FormativeProfile_generatedAt_idx" ON "FormativeProfile"("generatedAt");

-- CreateIndex
CREATE INDEX "FormativeProfile_isCurrent_idx" ON "FormativeProfile"("isCurrent");

-- CreateIndex
CREATE INDEX "BlockchainRecord_credentialId_idx" ON "BlockchainRecord"("credentialId");

-- CreateIndex
CREATE INDEX "BlockchainRecord_credentialHash_idx" ON "BlockchainRecord"("credentialHash");

-- CreateIndex
CREATE INDEX "BlockchainRecord_network_idx" ON "BlockchainRecord"("network");

-- CreateIndex
CREATE INDEX "BlockchainRecord_chainId_idx" ON "BlockchainRecord"("chainId");

-- CreateIndex
CREATE INDEX "BlockchainRecord_txHash_idx" ON "BlockchainRecord"("txHash");

-- CreateIndex
CREATE INDEX "BlockchainRecord_credentialId_network_chainId_idx" ON "BlockchainRecord"("credentialId", "network", "chainId");

-- CreateIndex
CREATE INDEX "VerificationEvent_credentialId_idx" ON "VerificationEvent"("credentialId");

-- CreateIndex
CREATE INDEX "VerificationEvent_verifierUserId_idx" ON "VerificationEvent"("verifierUserId");

-- CreateIndex
CREATE INDEX "VerificationEvent_sharingGrantId_idx" ON "VerificationEvent"("sharingGrantId");

-- CreateIndex
CREATE INDEX "VerificationEvent_verifiedAt_idx" ON "VerificationEvent"("verifiedAt");

-- CreateIndex
CREATE INDEX "AcademicCourse_issuerId_idx" ON "AcademicCourse"("issuerId");

-- CreateIndex
CREATE INDEX "AcademicCourse_status_idx" ON "AcademicCourse"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicCourse_issuerId_code_key" ON "AcademicCourse"("issuerId", "code");

-- CreateIndex
CREATE INDEX "ExternalCourse_providerName_idx" ON "ExternalCourse"("providerName");

-- CreateIndex
CREATE INDEX "ExternalCourse_externalReference_idx" ON "ExternalCourse"("externalReference");

-- CreateIndex
CREATE INDEX "ExternalCourse_status_idx" ON "ExternalCourse"("status");

-- CreateIndex
CREATE INDEX "Program_issuerId_idx" ON "Program"("issuerId");

-- CreateIndex
CREATE INDEX "Program_status_idx" ON "Program"("status");

-- CreateIndex
CREATE INDEX "CurriculumVersion_programId_idx" ON "CurriculumVersion"("programId");

-- CreateIndex
CREATE INDEX "CurriculumVersion_status_idx" ON "CurriculumVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumVersion_programId_versionLabel_key" ON "CurriculumVersion"("programId", "versionLabel");

-- CreateIndex
CREATE INDEX "ProgramCourse_curriculumVersionId_idx" ON "ProgramCourse"("curriculumVersionId");

-- CreateIndex
CREATE INDEX "ProgramCourse_academicCourseId_idx" ON "ProgramCourse"("academicCourseId");

-- CreateIndex
CREATE INDEX "ProgramCourse_curriculumVersionId_academicCourseId_idx" ON "ProgramCourse"("curriculumVersionId", "academicCourseId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "AuditLog_occurredAt_idx" ON "AuditLog"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "SharingGrant_tokenHash_key" ON "SharingGrant"("tokenHash");

-- CreateIndex
CREATE INDEX "SharingGrant_userId_idx" ON "SharingGrant"("userId");

-- CreateIndex
CREATE INDEX "SharingGrant_credentialId_idx" ON "SharingGrant"("credentialId");

-- CreateIndex
CREATE INDEX "SharingGrant_profileId_idx" ON "SharingGrant"("profileId");

-- AddForeignKey
ALTER TABLE "IssuerMembership" ADD CONSTRAINT "IssuerMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuerMembership" ADD CONSTRAINT "IssuerMembership_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "Issuer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "Issuer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_academicCourseId_fkey" FOREIGN KEY ("academicCourseId") REFERENCES "AcademicCourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_externalCourseId_fkey" FOREIGN KEY ("externalCourseId") REFERENCES "ExternalCourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SemanticAnalysis" ADD CONSTRAINT "SemanticAnalysis_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FormativeProfile" ADD CONSTRAINT "FormativeProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockchainRecord" ADD CONSTRAINT "BlockchainRecord_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEvent" ADD CONSTRAINT "VerificationEvent_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEvent" ADD CONSTRAINT "VerificationEvent_verifierUserId_fkey" FOREIGN KEY ("verifierUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEvent" ADD CONSTRAINT "VerificationEvent_sharingGrantId_fkey" FOREIGN KEY ("sharingGrantId") REFERENCES "SharingGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcademicCourse" ADD CONSTRAINT "AcademicCourse_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "Issuer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Program" ADD CONSTRAINT "Program_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "Issuer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumVersion" ADD CONSTRAINT "CurriculumVersion_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramCourse" ADD CONSTRAINT "ProgramCourse_curriculumVersionId_fkey" FOREIGN KEY ("curriculumVersionId") REFERENCES "CurriculumVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramCourse" ADD CONSTRAINT "ProgramCourse_academicCourseId_fkey" FOREIGN KEY ("academicCourseId") REFERENCES "AcademicCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharingGrant" ADD CONSTRAINT "SharingGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharingGrant" ADD CONSTRAINT "SharingGrant_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharingGrant" ADD CONSTRAINT "SharingGrant_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "FormativeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharingGrant" ADD CONSTRAINT "SharingGrant_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

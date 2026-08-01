-- DropIndex
DROP INDEX "ProgramCourse_curriculumVersionId_academicCourseId_idx";

-- AlterTable
ALTER TABLE "Credential" ADD COLUMN     "programCourseId" TEXT;

-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "code" TEXT;

-- Preserve pre-existing programs before enforcing the institutional code.
UPDATE "Program"
SET "code" = 'legacy-' || "id"
WHERE "code" IS NULL;

ALTER TABLE "Program" ALTER COLUMN "code" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Credential_programCourseId_idx" ON "Credential"("programCourseId");

-- CreateIndex
CREATE UNIQUE INDEX "Program_issuerId_code_key" ON "Program"("issuerId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramCourse_curriculumVersionId_academicCourseId_key" ON "ProgramCourse"("curriculumVersionId", "academicCourseId");

-- AddForeignKey
ALTER TABLE "Credential" ADD CONSTRAINT "Credential_programCourseId_fkey" FOREIGN KEY ("programCourseId") REFERENCES "ProgramCourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- F1.1: extraction slot sobre AnalysisRunSource.
--
-- Cero tablas nuevas. Tres columnas nullable sobre la tabla que ya representa
-- "la fuente exacta congelada para este run". Ver
-- evidence-reasoning-f0.6-persistence-design.md.
--
-- Sin backfill y sin DEFAULT: toda fila preexistente queda con el extraction
-- slot ABSENT, que es la informacion correcta -- esos runs no tuvieron
-- extraccion source-addressable.

-- CreateEnum
CREATE TYPE "ExtractionDerivationTrust" AS ENUM ('AUTHORITATIVE_CONTENT_MATCHED', 'PRODUCER_ASSUMED');

-- AlterTable
ALTER TABLE "AnalysisRunSource" ADD COLUMN     "extractionArtifactCanonicalJson" TEXT,
ADD COLUMN     "artifactBlobSha256" TEXT,
ADD COLUMN     "extractionDerivationTrust" "ExtractionDerivationTrust";

-- El bundle es todo-o-nada: ABSENT (los tres null) o PRESENT (los tres no-null).
-- Un bundle parcialmente poblado es un estado invalido, no un paso intermedio.
--
-- Se expresa como CHECK siguiendo el precedente que esta tabla ya tiene:
-- "AnalysisRunSource_exactly_one_source", en
-- 20260805120000_add_analysis_run_foundation, que hace cumplir el XOR
-- documento/texto sobre columnas nullable de la misma forma. Igual que aquel,
-- este constraint vive solo en la migracion: schema.prisma no modela CHECKs.
--
-- Este constraint NO implementa MONOTONIC_FILL_ONCE. Prohibe el bundle parcial,
-- no la sobreescritura: impedir PRESENT -> otro PRESENT es una invariante de
-- escritura de la aplicacion y pertenece a F1.2. No se usan triggers.
ALTER TABLE "AnalysisRunSource" ADD CONSTRAINT "AnalysisRunSource_extraction_slot_all_or_nothing" CHECK (
  ("extractionArtifactCanonicalJson" IS NULL AND "artifactBlobSha256" IS NULL AND "extractionDerivationTrust" IS NULL)
  OR
  ("extractionArtifactCanonicalJson" IS NOT NULL AND "artifactBlobSha256" IS NOT NULL AND "extractionDerivationTrust" IS NOT NULL)
);

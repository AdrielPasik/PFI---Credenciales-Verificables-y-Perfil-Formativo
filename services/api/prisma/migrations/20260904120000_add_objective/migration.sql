-- F2.1: tabla Objective.
--
-- Una sola tabla nueva, ocho columnas fisicas. Los Requirements viven ANIDADOS
-- dentro de `definition` como artifact `objective_definition_v1`; RequirementFacet
-- y Objective Analysis NO se persisten aca. Ver
-- evidence-reasoning-f2.0-objective-requirement-foundation-design.md.
--
-- Migracion puramente aditiva: no toca ninguna tabla existente y no hay backfill.

-- CreateEnum
--
-- Tokens en MAYUSCULA: son los MISMOS que el artifact guarda en
-- `definition.objectiveType`. El contrato exige igualdad entre columna y
-- artifact, no una traduccion de casing.
CREATE TYPE "ObjectiveType" AS ENUM ('EMPLOYMENT', 'SCHOLARSHIP', 'ADMISSION', 'EQUIVALENCE', 'OTHER');

-- CreateEnum
--
-- Minusculas, siguiendo a "CredentialSemanticInterpretationStatus", que modela
-- el mismo ciclo de vida activo/reemplazado.
CREATE TYPE "ObjectiveStatus" AS ENUM ('active', 'superseded');

-- CreateTable
CREATE TABLE "Objective" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "objectiveType" "ObjectiveType" NOT NULL,
    "title" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "supersedesObjectiveId" TEXT,
    "status" "ObjectiveStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Objective_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Objective_ownerUserId_status_idx" ON "Objective"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "Objective_ownerUserId_createdAt_idx" ON "Objective"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Objective_supersedesObjectiveId_idx" ON "Objective"("supersedesObjectiveId");

-- AddForeignKey
ALTER TABLE "Objective" ADD CONSTRAINT "Objective_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
--
-- Auto-referencia hacia la fila que esta revision reemplaza. RESTRICT y no
-- CASCADE: un Objective historico no debe poder desaparecer por debajo de su
-- sucesor, y F2.1 no implementa delete.
ALTER TABLE "Objective" ADD CONSTRAINT "Objective_supersedesObjectiveId_fkey" FOREIGN KEY ("supersedesObjectiveId") REFERENCES "Objective"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SIN indice UNIQUE sobre "supersedesObjectiveId", a proposito.
--
-- Estructuralmente la base admitiria dos filas revisando al mismo predecesor.
-- Quien impide ese branching es el camino de escritura del producto: la revision
-- transiciona `active -> superseded` sobre el predecesor de forma condicional y
-- dentro de la misma transaccion que crea la sucesora, asi que dos revisiones
-- concurrentes producen exactamente un ganador.
--
-- F2.0 deliberadamente NO congelo esta constraint, y agregarla aqui ampliaria el
-- contrato en silencio: prohibiria para siempre cualquier forma futura de
-- branching (por ejemplo, dos variantes de una misma oferta) sin que nadie lo
-- haya decidido. Ver REVISION_SINGLE_WINNER en el record de F2.1.

-- F3.1: ReasoningRun + ReasoningRunInventoryItem.
--
-- Dos tablas nuevas. Los tres artifacts de etapa viven como columnas JSONB
-- DENTRO de ReasoningRun, no como tablas: no hay RequirementResult, ni
-- EvidenceUnit, ni RequirementFacet, ni ObjectiveAnalysis. Ver
-- evidence-reasoning-f3.0-reasoning-run-product-contract.md.
--
-- Migracion puramente aditiva: no toca ninguna tabla existente y no hay backfill.
--
-- DEPENDENCIA DE DEPLOY: 20260904120000_add_objective (F2.1) debe estar aplicada
-- antes que esta, porque "ReasoningRun"."objectiveId" referencia "Objective".

-- CreateEnum
--
-- Minusculas, siguiendo a "AnalysisRunStatus", que modela el mismo ciclo
-- operacional. Sin 'canceled': F3.0 no congelo cancelacion.
--
-- Este enum es el LIFECYCLE del run. El estado epistemologico de un Requirement
-- (SUPPORTED | PARTIALLY_SUPPORTED | INSUFFICIENT_EVIDENCE | NOT_ASSESSABLE |
-- ABSTAIN) NO esta aca: vive dentro de "resultArtifact" y es por Requirement.
-- Un run que completa habiendo abstenido es 'completed'.
CREATE TYPE "ReasoningRunStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

-- CreateEnum
--
-- MAYUSCULA: son los mismos tokens del contrato F3.0 y de los artifacts, sin
-- traduccion de casing.
--
-- Dos familias, y el prefijo las separa a proposito:
--   EXCLUDED_*  la candidata queda fuera del grounding set -> el run PUEDE seguir
--   BLOCKED_*   la fuente fue SELECCIONADA y su extraccion requerida falta o no
--               es confiable -> el run DEBE fallar antes de razonar
--
-- Los dos BLOCKED_* son hechos distintos:
--   BLOCKED_EXTRACTION_UNAVAILABLE        no existe slot persistido
--   BLOCKED_EXTRACTION_INTEGRITY_FAILURE  habia representacion y fallo la
--                                         verificacion de integridad/binding
--
-- SIN 'EXCLUDED_DUPLICATE_SOURCE'. F3.0 lo auditó como inalcanzable en V1: con la
-- identidad (entidad de evidencia + sourceSha256) y un solo current por tipo y
-- credencial, dos credenciales que comparten el mismo PDF son candidatas
-- distintas. No se anticipan estados persistidos sin productor; si alguna vez es
-- alcanzable, entra por una migracion nueva.
CREATE TYPE "ReasoningRunInventoryDisposition" AS ENUM ('INCLUDED', 'EXCLUDED_CREDENTIAL_STATE_DRAFT', 'EXCLUDED_CREDENTIAL_STATE_REVOKED', 'EXCLUDED_NO_GROUNDING_SOURCE', 'EXCLUDED_SOURCE_SUPERSEDED', 'EXCLUDED_UNSUPPORTED_TYPE', 'EXCLUDED_ALTERNATE_REPRESENTATION', 'BLOCKED_EXTRACTION_UNAVAILABLE', 'BLOCKED_EXTRACTION_INTEGRITY_FAILURE');

-- CreateTable
--
-- Quince columnas fisicas. Tres de ellas son los slots de etapa MONOTONIC_FILL_ONCE
-- (ABSENT -> PRESENT, una sola vez), con la misma disciplina que el extraction
-- slot de F1.1. El llenado condicional es responsabilidad de la aplicacion:
-- aca no hay trigger.
--
-- Sin "updatedAt": nada se actualiza salvo los slots y las marcas de lifecycle, y
-- cada una tiene su columna. Sin hash/fingerprint del snapshot del Objective: la
-- inmutabilidad es de aplicacion, y una columna de hash prometeria una deteccion
-- de manipulacion en reposo que no existe. Sin score global ni porcentaje.
CREATE TABLE "ReasoningRun" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "objectiveDefinitionSnapshot" JSONB NOT NULL,
    "objectiveTitleSnapshot" TEXT NOT NULL,
    "status" "ReasoningRunStatus" NOT NULL DEFAULT 'pending',
    "objectiveAnalysisArtifact" JSONB,
    "evidenceUnitsArtifact" JSONB,
    "resultArtifact" JSONB,
    "executionMetadata" JSONB,
    "failureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),

    CONSTRAINT "ReasoningRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
--
-- Once columnas fisicas. UNA FILA POR ITEM DEL INVENTARIO, y el inventario esta
-- enraizado en la CREDENCIAL: por eso "credentialId" es NOT NULL y las columnas
-- de fuente son nullable. Una credencial emitida sin ninguna entidad de evidencia
-- produce una fila valida, que es justamente lo que el nombre "ReasoningRunSource"
-- del borrador ya no describia.
--
-- Sin "exclusionReason" de texto libre: la disposicion ES la razon.
CREATE TABLE "ReasoningRunInventoryItem" (
    "id" TEXT NOT NULL,
    "reasoningRunId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "documentEvidenceId" TEXT,
    "textEvidenceId" TEXT,
    "sourceSha256" TEXT,
    "disposition" "ReasoningRunInventoryDisposition" NOT NULL,
    "selectedAnalysisRunSourceId" TEXT,
    "artifactBlobSha256" TEXT,
    "runLocalSourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReasoningRunInventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReasoningRun_ownerUserId_createdAt_idx" ON "ReasoningRun"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ReasoningRun_ownerUserId_objectiveId_idx" ON "ReasoningRun"("ownerUserId", "objectiveId");

-- CreateIndex
--
-- Mismo patron que "AnalysisRunSource_analysisRunId_documentEvidenceId_key": un
-- UNIQUE sobre el par con la columna nullable. En Postgres los NULL no colisionan
-- entre si, asi que esto dice exactamente "a lo sumo una fila por documento
-- dentro de un run" y deja libres todas las filas credential-level, que llevan
-- "documentEvidenceId" NULL.
CREATE UNIQUE INDEX "ReasoningRunInventoryItem_reasoningRunId_documentEvidenceId_key" ON "ReasoningRunInventoryItem"("reasoningRunId", "documentEvidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ReasoningRunInventoryItem_reasoningRunId_textEvidenceId_key" ON "ReasoningRunInventoryItem"("reasoningRunId", "textEvidenceId");

-- CreateIndex
--
-- "src_01" es local al run y lo ve el reasoner. Dos filas del mismo run no pueden
-- compartirlo: seria ambiguo a que fuente apunta un EvidenceUnit.
CREATE UNIQUE INDEX "ReasoningRunInventoryItem_reasoningRunId_runLocalSourceId_key" ON "ReasoningRunInventoryItem"("reasoningRunId", "runLocalSourceId");

-- CreateIndex
CREATE INDEX "ReasoningRunInventoryItem_reasoningRunId_idx" ON "ReasoningRunInventoryItem"("reasoningRunId");

-- CreateIndex
CREATE INDEX "ReasoningRunInventoryItem_reasoningRunId_credentialId_idx" ON "ReasoningRunInventoryItem"("reasoningRunId", "credentialId");

-- CreateIndex
CREATE INDEX "ReasoningRunInventoryItem_selectedAnalysisRunSourceId_idx" ON "ReasoningRunInventoryItem"("selectedAnalysisRunSourceId");

-- AddForeignKey
ALTER TABLE "ReasoningRun" ADD CONSTRAINT "ReasoningRun_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
--
-- RESTRICT y no CASCADE: un Objective no puede desaparecer por debajo de un run
-- que lo evaluo. El snapshot congelado sobrevive igual, pero perder la fila
-- romperia la trazabilidad de contra que se evaluo.
ALTER TABLE "ReasoningRun" ADD CONSTRAINT "ReasoningRun_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "Objective"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReasoningRunInventoryItem" ADD CONSTRAINT "ReasoningRunInventoryItem_reasoningRunId_fkey" FOREIGN KEY ("reasoningRunId") REFERENCES "ReasoningRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
--
-- RESTRICT en las cuatro referencias a entidades del dominio, igual que
-- "AnalysisRunSource": un inventario congelado deja de ser un inventario si sus
-- filas pueden evaporarse.
ALTER TABLE "ReasoningRunInventoryItem" ADD CONSTRAINT "ReasoningRunInventoryItem_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReasoningRunInventoryItem" ADD CONSTRAINT "ReasoningRunInventoryItem_documentEvidenceId_fkey" FOREIGN KEY ("documentEvidenceId") REFERENCES "DocumentEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReasoningRunInventoryItem" ADD CONSTRAINT "ReasoningRunInventoryItem_textEvidenceId_fkey" FOREIGN KEY ("textEvidenceId") REFERENCES "TextEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReasoningRunInventoryItem" ADD CONSTRAINT "ReasoningRunInventoryItem_selectedAnalysisRunSourceId_fkey" FOREIGN KEY ("selectedAnalysisRunSourceId") REFERENCES "AnalysisRunSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FORMA DE FILA POR FAMILIA DE DISPOSICION.
--
-- Se expresa como CHECK siguiendo los dos precedentes que ya tiene el repo:
-- "AnalysisRunSource_exactly_one_source" (XOR documento/texto sobre columnas
-- nullable) y "AnalysisRunSource_extraction_slot_all_or_nothing" (bundle
-- todo-o-nada). Igual que aquellos, estos constraints viven solo en la migracion:
-- schema.prisma no modela CHECKs.
--
-- Familia CREDENTIAL_LEVEL: la credencial queda excluida ANTES de mirar sus
-- fuentes, asi que la fila no tiene ninguna. Familia SOURCE_LEVEL: exactamente una
-- entidad de evidencia y su SHA congelado.
--
-- "credentialId" no aparece en el CHECK porque ya es NOT NULL por definicion de
-- columna, en las dos familias.
--
-- El CHECK enumera SOLO la familia credential-level y manda todo lo demas a la
-- rama ELSE. Por eso agregar una disposicion source-level nueva
-- --BLOCKED_EXTRACTION_INTEGRITY_FAILURE-- no necesito tocar este constraint: cae
-- en el ELSE y queda sujeta a la regla source-level, sin excepcion especial.
ALTER TABLE "ReasoningRunInventoryItem" ADD CONSTRAINT "ReasoningRunInventoryItem_row_family_shape" CHECK (
  CASE
    WHEN "disposition" IN (
      'EXCLUDED_CREDENTIAL_STATE_DRAFT',
      'EXCLUDED_CREDENTIAL_STATE_REVOKED',
      'EXCLUDED_NO_GROUNDING_SOURCE'
    )
    THEN "documentEvidenceId" IS NULL AND "textEvidenceId" IS NULL AND "sourceSha256" IS NULL
    ELSE (("documentEvidenceId" IS NOT NULL) <> ("textEvidenceId" IS NOT NULL))
         AND "sourceSha256" IS NOT NULL
  END
);

-- BINDING DE LA EXTRACCION SELECCIONADA.
--
-- "selectedAnalysisRunSourceId" significa EL CANDIDATO DETERMINISTA QUE ESTE RUN
-- SELECCIONO, no "el que uso con exito". HD-3 selecciona primero por tiempo y
-- verifica despues, asi que hay un candidato concreto incluso cuando la
-- verificacion falla, y perder su id perderia CUAL representacion disparo el
-- fallo.
--
-- Que ese candidato haya ENTRADO al grounding es un hecho distinto, y lo dicen
-- otras dos columnas: disposition = INCLUDED con "runLocalSourceId" presente.
--
-- Tres ramas, no dos:
--
--   INCLUDED                              seleccionado + verificado + confiable
--                                         -> las tres columnas presentes
--   BLOCKED_EXTRACTION_INTEGRITY_FAILURE  seleccionado + verificacion FALLIDA
--                                         -> solo el id del candidato
--   resto                                 no se selecciono ninguna representacion
--                                         -> las tres en NULL
--
-- "artifactBlobSha256" NO se copia en el caso de fallo de integridad, a proposito:
-- sigue significando "testigo de consistencia del artifact ACEPTADO por este run",
-- y un artifact que no atraveso la frontera de trust nunca adquiere ese estado. La
-- investigacion historica sigue el "selectedAnalysisRunSourceId" hasta el candidato
-- que fallo.
--
-- Las filas EXCLUDED_* siguen con las tres en NULL AUNQUE esa fuente tenga
-- extracciones historicas -- el caso del TextEvidence alterno de una credencial
-- con PDF. Ahi no se selecciono nada, que es distinto de haber seleccionado y
-- fallado.
--
-- Este CHECK NO implementa la garantia CAUSAL de que la extraccion seleccionada
-- pertenece a la misma entidad de evidencia y comparte el sourceSha256: eso es una
-- invariante de aplicacion de F3.2, verificable al construir el inventario. La base
-- garantiza integridad referencial y forma de fila, nada mas.
ALTER TABLE "ReasoningRunInventoryItem" ADD CONSTRAINT "ReasoningRunInventoryItem_selected_extraction_binding" CHECK (
  CASE
    WHEN "disposition" = 'INCLUDED'
    THEN "selectedAnalysisRunSourceId" IS NOT NULL
         AND "artifactBlobSha256" IS NOT NULL
         AND "runLocalSourceId" IS NOT NULL
    WHEN "disposition" = 'BLOCKED_EXTRACTION_INTEGRITY_FAILURE'
    THEN "selectedAnalysisRunSourceId" IS NOT NULL
         AND "artifactBlobSha256" IS NULL
         AND "runLocalSourceId" IS NULL
    ELSE "selectedAnalysisRunSourceId" IS NULL
         AND "artifactBlobSha256" IS NULL
         AND "runLocalSourceId" IS NULL
  END
);

-- INVARIANTE DE APLICACION, DELIBERADAMENTE NO EN LA BASE.
--
--   una fila credential-level no puede coexistir con filas source-level
--   para el mismo (reasoningRunId, credentialId)
--
-- Es cross-row y no se expresa como CHECK simple. Introducir un trigger, una
-- exclusion constraint o una tercera tabla solo por esto seria desproporcionado:
-- el unico escritor sera el constructor de inventario de F3.2, y ahi se congela
-- con tests. Se registra aca para que quede dicho que la ausencia es una decision,
-- no un olvido.

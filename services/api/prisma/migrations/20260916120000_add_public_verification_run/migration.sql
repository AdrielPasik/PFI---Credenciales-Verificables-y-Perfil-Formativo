-- PUBLIC CONTEXTUAL VERIFICATION RUN FOUNDATION.
--
-- Tres tablas nuevas y un enum nuevo. Ninguna tabla existente cambia de forma y
-- no hay backfill: es puramente aditiva.
--
-- VerificationRequest            sesion anonima del verificador
-- VerificationRun                observacion contextual congelada
-- VerificationRunInventoryItem   espejo EXACTO de ReasoningRunInventoryItem
--
-- POR QUE NO SE REUSA "ReasoningRun". Tiene "ownerUserId" y "objectiveId" NOT
-- NULL, con "objectiveId" en RESTRICT: no existe sin un Objective del holder.
--
-- SE REUSAN DOS ENUMS EXISTENTES, a proposito: "ReasoningRunInventoryDisposition"
-- y "ReasoningRunStatus". Sus nombres son historicos, pero la semantica tiene que
-- ser identica en los dos productos, y la unica forma estructural de garantizarlo
-- es que sean el MISMO tipo. Un enum paralelo podria divergir en silencio.
--
-- DEPENDENCIA DE DEPLOY: 20260906120000_add_reasoning_run (los dos enums) y
-- 20260915120000_add_share_verification_policy deben estar aplicadas antes.

-- CreateEnum
--
-- Sin 'expired': ningun codigo lo escribiria sin un scheduler. El vencimiento se
-- deriva de "expiresAt" en cada lectura y accion.
CREATE TYPE "VerificationRequestStatus" AS ENUM ('draft', 'requirements_proposed', 'requirements_confirmed', 'consumed');

-- CreateTable
CREATE TABLE "VerificationRequest" (
    "id" TEXT NOT NULL,
    "sharingGrantId" TEXT NOT NULL,
    "requestTokenHash" TEXT NOT NULL,
    "status" "VerificationRequestStatus" NOT NULL DEFAULT 'draft',
    "rawObjectiveText" TEXT NOT NULL,
    "objectiveTitle" TEXT,
    "proposedRequirements" JSONB,
    "confirmedObjectiveDefinition" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "VerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
--
-- Sin "ownerUserId", sin "objectiveId", sin score, sin porcentaje, sin ranking,
-- sin respuesta cruda de proveedor, sin prompt. No hay columna donde ponerlos.
--
-- Sin token propio: la autoridad sobre el resultado es el token de la solicitud
-- que lo produjo. Un segundo secreto irrecuperable dejaria al verificador sin
-- acceso si perdiera la respuesta de la ejecucion.
CREATE TABLE "VerificationRun" (
    "id" TEXT NOT NULL,
    "verificationRequestId" TEXT NOT NULL,
    "sharingGrantId" TEXT NOT NULL,
    "policyVersionSnapshot" INTEGER NOT NULL,
    "objectiveDefinitionSnapshot" JSONB NOT NULL,
    "objectiveTitleSnapshot" TEXT,
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

    CONSTRAINT "VerificationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationRunInventoryItem" (
    "id" TEXT NOT NULL,
    "verificationRunId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "documentEvidenceId" TEXT,
    "textEvidenceId" TEXT,
    "sourceSha256" TEXT,
    "disposition" "ReasoningRunInventoryDisposition" NOT NULL,
    "selectedAnalysisRunSourceId" TEXT,
    "artifactBlobSha256" TEXT,
    "runLocalSourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationRunInventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VerificationRequest_requestTokenHash_key" ON "VerificationRequest"("requestTokenHash");

-- CreateIndex
CREATE INDEX "VerificationRequest_sharingGrantId_createdAt_idx" ON "VerificationRequest"("sharingGrantId", "createdAt");

-- CreateIndex
--
-- UNA SOLICITUD, A LO SUMO UN RUN. Estructural: dos congelamientos concurrentes
-- de la misma solicitud no pueden persistir dos runs aunque la aplicacion fallara.
CREATE UNIQUE INDEX "VerificationRun_verificationRequestId_key" ON "VerificationRun"("verificationRequestId");

-- CreateIndex
CREATE INDEX "VerificationRun_sharingGrantId_createdAt_idx" ON "VerificationRun"("sharingGrantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationRunInventoryItem_verificationRunId_documentEvid_key" ON "VerificationRunInventoryItem"("verificationRunId", "documentEvidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationRunInventoryItem_verificationRunId_textEvidence_key" ON "VerificationRunInventoryItem"("verificationRunId", "textEvidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationRunInventoryItem_verificationRunId_runLocalSour_key" ON "VerificationRunInventoryItem"("verificationRunId", "runLocalSourceId");

-- CreateIndex
CREATE INDEX "VerificationRunInventoryItem_verificationRunId_idx" ON "VerificationRunInventoryItem"("verificationRunId");

-- CreateIndex
CREATE INDEX "VerificationRunInventoryItem_verificationRunId_credentialId_idx" ON "VerificationRunInventoryItem"("verificationRunId", "credentialId");

-- CreateIndex
CREATE INDEX "VerificationRunInventoryItem_selectedAnalysisRunSourceId_idx" ON "VerificationRunInventoryItem"("selectedAnalysisRunSourceId");

-- AddForeignKey
--
-- CASCADE, a diferencia del run: una solicitud sin consumir es una sesion anonima
-- efimera. Una CONSUMIDA queda protegida igual, porque su run la referencia en
-- RESTRICT y el run referencia al enlace en RESTRICT.
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_sharingGrantId_fkey" FOREIGN KEY ("sharingGrantId") REFERENCES "SharingGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
--
-- RESTRICT: una solicitud no puede desaparecer por debajo del run que produjo.
ALTER TABLE "VerificationRun" ADD CONSTRAINT "VerificationRun_verificationRequestId_fkey" FOREIGN KEY ("verificationRequestId") REFERENCES "VerificationRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
--
-- RESTRICT, NO CASCADE. Un run congelado es registro de auditoria. "SharingGrant"
-- cae en cascada cuando se borra su "User", asi que con CASCADE un borrado de
-- usuario hecho fuera de la aplicacion se llevaria los runs en silencio. Hoy no
-- existe ningun camino ejecutable que borre un enlace ni un usuario: RESTRICT no
-- cuesta nada y convierte un borrado futuro en una decision de retencion
-- explicita. Revocar el enlace NO borra nada; solo corta el acceso publico.
ALTER TABLE "VerificationRun" ADD CONSTRAINT "VerificationRun_sharingGrantId_fkey" FOREIGN KEY ("sharingGrantId") REFERENCES "SharingGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRunInventoryItem" ADD CONSTRAINT "VerificationRunInventoryItem_verificationRunId_fkey" FOREIGN KEY ("verificationRunId") REFERENCES "VerificationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRunInventoryItem" ADD CONSTRAINT "VerificationRunInventoryItem_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRunInventoryItem" ADD CONSTRAINT "VerificationRunInventoryItem_documentEvidenceId_fkey" FOREIGN KEY ("documentEvidenceId") REFERENCES "DocumentEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRunInventoryItem" ADD CONSTRAINT "VerificationRunInventoryItem_textEvidenceId_fkey" FOREIGN KEY ("textEvidenceId") REFERENCES "TextEvidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationRunInventoryItem" ADD CONSTRAINT "VerificationRunInventoryItem_selectedAnalysisRunSourceId_fkey" FOREIGN KEY ("selectedAnalysisRunSourceId") REFERENCES "AnalysisRunSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FORMA DE FILA POR FAMILIA DE DISPOSICION.
--
-- COPIA LITERAL del CHECK "ReasoningRunInventoryItem_row_family_shape". No se
-- reescribe ni se simplifica: si los dos productos tuvieran reglas de forma
-- distintas para la misma disposicion, la disposicion dejaria de significar una
-- sola cosa.
ALTER TABLE "VerificationRunInventoryItem" ADD CONSTRAINT "VerificationRunInventoryItem_row_family_shape" CHECK (
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
-- COPIA LITERAL de "ReasoningRunInventoryItem_selected_extraction_binding".
--
--   INCLUDED                              seleccionado + verificado + confiable
--   BLOCKED_EXTRACTION_INTEGRITY_FAILURE  seleccionado + verificacion FALLIDA
--   resto                                 no se selecciono ninguna representacion
--
-- "selectedAnalysisRunSourceId" solo NO implica grounding aceptado: un fallo de
-- integridad conserva el candidato y NO tiene "artifactBlobSha256" ni
-- "runLocalSourceId". Solo INCLUDED con las tres columnas entra al grounding.
ALTER TABLE "VerificationRunInventoryItem" ADD CONSTRAINT "VerificationRunInventoryItem_selected_extraction_binding" CHECK (
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

-- ESTADO CONSUMIDO DE LA SOLICITUD.
--
-- "consumed" y "consumedAt" no pueden desacoplarse: una solicitud a medio
-- consumir -- con marca pero sin estado, o al reves -- no puede existir.
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_consumed_shape" CHECK (
  ("status" = 'consumed') = ("consumedAt" IS NOT NULL)
);

-- REQUISITOS CONFIRMADOS.
--
-- Una solicitud confirmada o consumida SIEMPRE lleva su definicion confirmada y su
-- marca de confirmacion. Sin eso, un run podria congelarse contra un objetivo que
-- nadie confirmo.
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_confirmed_shape" CHECK (
  CASE
    WHEN "status" IN ('requirements_confirmed', 'consumed')
    THEN "confirmedObjectiveDefinition" IS NOT NULL AND "confirmedAt" IS NOT NULL
    ELSE TRUE
  END
);

-- PROCEDENCIA DEL CONSENTIMIENTO.
--
-- "ShareVerificationPolicy"."policyVersion" arranca en 1 y solo crece, asi que un
-- snapshot menor que 1 no pudo haber autorizado nada.
ALTER TABLE "VerificationRun" ADD CONSTRAINT "VerificationRun_policy_version_positive" CHECK (
  "policyVersionSnapshot" >= 1
);

-- INVARIANTE DE APLICACION, DELIBERADAMENTE NO EN LA BASE (igual que en
-- ReasoningRun): una fila credential-level no coexiste con filas source-level para
-- el mismo (run, credencial). Es cross-row; el unico escritor es la primitiva
-- compartida de clasificacion, y ahi esta congelado con tests.

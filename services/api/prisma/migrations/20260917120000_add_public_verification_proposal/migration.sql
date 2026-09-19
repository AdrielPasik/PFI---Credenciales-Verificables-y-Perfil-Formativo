-- PUBLIC VERIFICATION OBJECTIVE INTAKE + REQUIREMENT REVIEW V1.
--
-- Aditiva. Agrega:
--
--   1. "VerificationRequest"."objectiveType": el contrato de propuesta de
--      requisitos y `objective_definition_v1` lo exigen. Sin el, la propuesta no
--      puede pedirse y la definicion confirmada no puede construirse.
--   2. "VerificationProposalAttempt": claim persistente y libro de cuota de los
--      arranques de proveedor.
--
-- DEPENDENCIA DE DEPLOY: 20260916120000_add_public_verification_run.
--
-- PRECONDICION DEL NOT NULL. "objectiveType" se agrega NOT NULL sin default. Es
-- seguro porque la fundacion no expuso ningun productor de "VerificationRequest":
-- no habia ruta publica, asi que la tabla solo puede estar vacia. Si alguien
-- hubiera insertado filas a mano, esta migracion falla en lugar de inventarles un
-- tipo de objetivo -- que es exactamente lo que tiene que pasar.

-- CreateEnum
--
-- Sin valor para "fallo de transporte", a proposito: ver el comentario del modelo.
CREATE TYPE "VerificationProposalAttemptOutcome" AS ENUM ('SUCCEEDED', 'FAILED', 'DISCARDED');

-- AlterTable
ALTER TABLE "VerificationRequest" ADD COLUMN "objectiveType" "ObjectiveType" NOT NULL;

-- CreateTable
--
-- Sin IP, sin respuesta del proveedor, sin prompt, sin detalle de error. La
-- propuesta autoritativa vive en "VerificationRequest"."proposedRequirements".
CREATE TABLE "VerificationProposalAttempt" (
    "id" TEXT NOT NULL,
    "verificationRequestId" TEXT NOT NULL,
    "sharingGrantId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "outcome" "VerificationProposalAttemptOutcome",
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "VerificationProposalAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
--
-- Cuota y cooldown por enlace se cuentan sobre este rango.
CREATE INDEX "VerificationProposalAttempt_sharingGrantId_startedAt_idx" ON "VerificationProposalAttempt"("sharingGrantId", "startedAt");

-- CreateIndex
CREATE INDEX "VerificationProposalAttempt_verificationRequestId_idx" ON "VerificationProposalAttempt"("verificationRequestId");

-- CreateIndex
--
-- A LO SUMO UN INTENTO ABIERTO POR SOLICITUD. Indice unico PARCIAL: Prisma no lo
-- modela, asi que vive solo aca, igual que el precedente de
-- "CredentialReusableSemanticInterpretation".
--
-- Es el respaldo estructural del claim: aunque la aplicacion fallara, dos intentos
-- abiertos simultaneos sobre la misma solicitud no pueden existir. Un intento
-- vencido se cierra como DISCARDED en la MISMA transaccion que inserta el nuevo.
CREATE UNIQUE INDEX "VerificationProposalAttempt_one_open_per_request" ON "VerificationProposalAttempt"("verificationRequestId") WHERE "outcome" IS NULL;

-- AddForeignKey
--
-- CASCADE: un intento es libro de costo, no registro de auditoria de un resultado.
ALTER TABLE "VerificationProposalAttempt" ADD CONSTRAINT "VerificationProposalAttempt_verificationRequestId_fkey" FOREIGN KEY ("verificationRequestId") REFERENCES "VerificationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationProposalAttempt" ADD CONSTRAINT "VerificationProposalAttempt_sharingGrantId_fkey" FOREIGN KEY ("sharingGrantId") REFERENCES "SharingGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- UN INTENTO CERRADO TIENE RESULTADO Y MARCA, UNO ABIERTO NINGUNO.
ALTER TABLE "VerificationProposalAttempt" ADD CONSTRAINT "VerificationProposalAttempt_outcome_shape" CHECK (
  ("outcome" IS NULL) = ("finishedAt" IS NULL)
);

-- EL LEASE SIEMPRE TERMINA DESPUES DE ARRANCAR.
ALTER TABLE "VerificationProposalAttempt" ADD CONSTRAINT "VerificationProposalAttempt_lease_after_start" CHECK (
  "leaseExpiresAt" > "startedAt"
);

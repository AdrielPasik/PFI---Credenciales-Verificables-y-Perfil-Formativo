-- Ejecucion publica F3: presupuesto de intentos por run + lease de ejecucion por enlace.

ALTER TABLE "VerificationRun" ADD COLUMN "executionAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "VerificationRun" ADD CONSTRAINT "VerificationRun_executionAttempts_check"
  CHECK ("executionAttempts" >= 0 AND "executionAttempts" <= 3);

CREATE TABLE "VerificationExecutionLease" (
    "sharingGrantId" TEXT NOT NULL,
    "ownerToken" TEXT,
    "verificationRunId" TEXT,
    "acquiredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "VerificationExecutionLease_pkey" PRIMARY KEY ("sharingGrantId")
);

-- Tomado: dueno, adquisicion y vencimiento juntos. Libre: todo null.
ALTER TABLE "VerificationExecutionLease" ADD CONSTRAINT "VerificationExecutionLease_owner_consistency_check"
  CHECK (
    ("ownerToken" IS NULL AND "acquiredAt" IS NULL AND "expiresAt" IS NULL AND "verificationRunId" IS NULL)
    OR ("ownerToken" IS NOT NULL AND "acquiredAt" IS NOT NULL AND "expiresAt" IS NOT NULL AND "expiresAt" > "acquiredAt")
  );

ALTER TABLE "VerificationExecutionLease" ADD CONSTRAINT "VerificationExecutionLease_sharingGrantId_fkey"
  FOREIGN KEY ("sharingGrantId") REFERENCES "SharingGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

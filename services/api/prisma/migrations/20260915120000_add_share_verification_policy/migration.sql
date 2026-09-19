-- PUBLIC SHARE LIFECYCLE + CONTEXTUAL VERIFICATION CONSENT V1.
--
-- Dos tablas nuevas. Ninguna columna existente cambia y no hay backfill: es
-- puramente aditiva.
--
-- LA INVARIANTE QUE ESTA MIGRACION PROTEGE. Ningun SharingGrant preexistente
-- gana autoridad de computo por aplicarse esto. No se inserta ninguna fila de
-- politica, y "enabled" nace en false, asi que la verificacion contextual queda
-- deshabilitada para todo el historico sin necesidad de un backfill defensivo.
--
-- POR QUE NO ES UNA COLUMNA EN "SharingGrant". El consentimiento de computo es
-- estado de seguridad: tiene que ser tipado y consultable, y "policyVersion"
-- tiene que poder congelarse dentro de un VerificationRun futuro. Guardarlo en
-- "SharingGrant"."metadata" (JSONB libre) no da ninguna de las dos cosas.
--
-- DEPENDENCIA DE DEPLOY: la tabla "SharingGrant" y la tabla "Credential" ya
-- existen desde la migracion inicial; esta migracion solo las referencia.

-- CreateTable
CREATE TABLE "ShareVerificationPolicy" (
    "id" TEXT NOT NULL,
    "sharingGrantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "policyVersion" INTEGER NOT NULL DEFAULT 1,
    "enabledAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShareVerificationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
--
-- El conjunto autorizado es RELACIONAL, no un array JSON: cada credencial
-- elegida es una fila con su propia FK, asi que la base impide autorizar una
-- credencial inexistente y el UNIQUE impide duplicarla dentro de una politica.
CREATE TABLE "ShareVerificationCredentialAuthorization" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "authorizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareVerificationCredentialAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
--
-- 1:1 con el grant: un SharingGrant tiene a lo sumo una politica.
CREATE UNIQUE INDEX "ShareVerificationPolicy_sharingGrantId_key" ON "ShareVerificationPolicy"("sharingGrantId");

-- CreateIndex
--
-- El nombre es EXACTAMENTE el que genera Prisma (63 bytes). Postgres trunca en
-- silencio los identificadores largos: escribir el nombre "completo" dejaria en
-- la base uno distinto del que Prisma espera, y `migrate` lo veria como drift.
CREATE UNIQUE INDEX "ShareVerificationCredentialAuthorization_policyId_credentia_key" ON "ShareVerificationCredentialAuthorization"("policyId", "credentialId");

-- CreateIndex
CREATE INDEX "ShareVerificationCredentialAuthorization_policyId_idx" ON "ShareVerificationCredentialAuthorization"("policyId");

-- CreateIndex
CREATE INDEX "ShareVerificationCredentialAuthorization_credentialId_idx" ON "ShareVerificationCredentialAuthorization"("credentialId");

-- AddForeignKey
--
-- CASCADE: la politica no tiene sentido sin su grant.
ALTER TABLE "ShareVerificationPolicy" ADD CONSTRAINT "ShareVerificationPolicy_sharingGrantId_fkey" FOREIGN KEY ("sharingGrantId") REFERENCES "SharingGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareVerificationCredentialAuthorization" ADD CONSTRAINT "ShareVerificationCredentialAuthorization_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ShareVerificationPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
--
-- RESTRICT, nunca CASCADE: una credencial no puede desaparecer por debajo de un
-- consentimiento otorgado, y borrar una autorizacion jamas puede propagarse
-- hacia la credencial.
ALTER TABLE "ShareVerificationCredentialAuthorization" ADD CONSTRAINT "ShareVerificationCredentialAuthorization_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

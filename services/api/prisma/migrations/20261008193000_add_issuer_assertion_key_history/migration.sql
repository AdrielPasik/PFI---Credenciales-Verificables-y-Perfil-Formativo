-- HISTORIA DE CLAVES DE ASERCION POR ISSUER -- S8c8
--
-- ADITIVA. Una tabla nueva y nada mas: no se agrega, cambia ni borra ninguna
-- columna de `SignerProfile`, `IssuerTechnicalIdentity`, `Credential` ni
-- `BlockchainRecord`, y ningun enum cambia. En particular los punteros
-- VIGENTES (`assertionSignerProfileId`, `anchorSignerProfileId`) siguen
-- existiendo tal cual: historia y vigencia son conceptos distintos.
--
-- El DDL de abajo es EXACTAMENTE la salida de
--
--   prisma migrate diff --from-schema-datamodel <schema en HEAD>
--                       --to-schema-datamodel  prisma/schema.prisma --script
--
-- sin editar una sola linea, para que el schema y la migracion no puedan
-- divergir. Lo que viene despues es el BACKFILL, que Prisma no deriva porque es
-- semantica de dominio y no de forma.

-- CreateTable
CREATE TABLE "IssuerAssertionKeyBinding" (
    "issuerId" TEXT NOT NULL,
    "signerProfileId" TEXT NOT NULL,

    CONSTRAINT "IssuerAssertionKeyBinding_pkey" PRIMARY KEY ("issuerId","signerProfileId")
);

-- CreateIndex
CREATE UNIQUE INDEX "IssuerAssertionKeyBinding_signerProfileId_key" ON "IssuerAssertionKeyBinding"("signerProfileId");

-- CreateIndex
CREATE INDEX "IssuerAssertionKeyBinding_issuerId_idx" ON "IssuerAssertionKeyBinding"("issuerId");

-- AddForeignKey
ALTER TABLE "IssuerAssertionKeyBinding" ADD CONSTRAINT "IssuerAssertionKeyBinding_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "Issuer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssuerAssertionKeyBinding" ADD CONSTRAINT "IssuerAssertionKeyBinding_signerProfileId_fkey" FOREIGN KEY ("signerProfileId") REFERENCES "SignerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- BACKFILL DEL PUNTERO VIGENTE
-- ---------------------------------------------------------------------------
--
-- Sin esto, desplegar el resolver nuevo haria DESAPARECER la clave de asercion
-- de todo issuer ya configurado: el resolver publica la historia, y la historia
-- estaria vacia.
--
-- La UNICA fuente autoritativa de la asociacion issuer <-> clave de asercion
-- antes de S8c8 es `IssuerTechnicalIdentity.assertionSignerProfileId`.
--
-- NO se escanean credentials para reconstruir historia. Antes de S8c8 no habia
-- ninguna primitiva de rotacion -- el audit de Phase 0 confirmo que no existe
-- ningun escritor de estas tablas en el codigo -- asi que no hay rotaciones
-- previas que reconstruir, y deducir autorizacion a partir del uso en
-- credentials viejas seria exactamente la inferencia que esta tabla existe para
-- reemplazar.
--
-- No se fabrica ningun timestamp: la tabla no tiene ninguno, a proposito. No se
-- reescribe `SignerProfile` y no se toca ningun dato transaccional.
--
-- `ON CONFLICT DO NOTHING` la hace idempotente: reaplicarla sobre una base que
-- ya tiene los bindings no falla.
INSERT INTO "IssuerAssertionKeyBinding" ("issuerId", "signerProfileId")
SELECT "issuerId", "assertionSignerProfileId"
FROM "IssuerTechnicalIdentity"
ON CONFLICT DO NOTHING;

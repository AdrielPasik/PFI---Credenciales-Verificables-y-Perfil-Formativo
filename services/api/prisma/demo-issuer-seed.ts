import { IssuerAuthorizationStatus, Prisma } from '@prisma/client';

export const DEMO_ISSUER_NAME =
  'Universidad Argentina de la Empresa (UADE)';
export const DEMO_ISSUER_DID = 'did:example:issuer-demo';
export const DEMO_ISSUER_WALLET_ADDRESS =
  '0x00000000000000000000000000000000000000aa';
export const DEMO_ISSUER_AUTHORIZED_AT = new Date(
  '2026-01-01T00:00:00.000Z'
);

export function buildDemoIssuerUpsertArgs(): Prisma.IssuerUpsertArgs {
  return {
    where: {
      did: DEMO_ISSUER_DID
    },
    update: {
      name: DEMO_ISSUER_NAME,
      legalName: DEMO_ISSUER_NAME,
      walletAddress: DEMO_ISSUER_WALLET_ADDRESS,
      authorizationStatus: IssuerAuthorizationStatus.authorized,
      authorizedAt: DEMO_ISSUER_AUTHORIZED_AT,
      revokedAt: null
    },
    create: {
      name: DEMO_ISSUER_NAME,
      legalName: DEMO_ISSUER_NAME,
      did: DEMO_ISSUER_DID,
      walletAddress: DEMO_ISSUER_WALLET_ADDRESS,
      authorizationStatus: IssuerAuthorizationStatus.authorized,
      authorizedAt: DEMO_ISSUER_AUTHORIZED_AT
    }
  };
}

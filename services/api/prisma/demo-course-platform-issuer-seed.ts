import { IssuerAuthorizationStatus, Prisma } from '@prisma/client';

/**
 * Issuer demo generico para credenciales course. platformName es un dato
 * declarado por el emisor en credentialSubject, no una integracion oficial
 * con ninguna plataforma real (Udemy, Coursera, etc.).
 */
export const DEMO_COURSE_PLATFORM_ISSUER_NAME =
  'Plataforma de Cursos Online Demo';
export const DEMO_COURSE_PLATFORM_ISSUER_DID =
  'did:example:course-platform-issuer-demo';
export const DEMO_COURSE_PLATFORM_ISSUER_WALLET_ADDRESS =
  '0x00000000000000000000000000000000000000bb';
export const DEMO_COURSE_PLATFORM_ISSUER_AUTHORIZED_AT = new Date(
  '2026-01-01T00:00:00.000Z'
);

export function buildDemoCoursePlatformIssuerUpsertArgs(): Prisma.IssuerUpsertArgs {
  return {
    where: {
      did: DEMO_COURSE_PLATFORM_ISSUER_DID
    },
    update: {
      name: DEMO_COURSE_PLATFORM_ISSUER_NAME,
      legalName: DEMO_COURSE_PLATFORM_ISSUER_NAME,
      walletAddress: DEMO_COURSE_PLATFORM_ISSUER_WALLET_ADDRESS,
      authorizationStatus: IssuerAuthorizationStatus.authorized,
      authorizedAt: DEMO_COURSE_PLATFORM_ISSUER_AUTHORIZED_AT,
      revokedAt: null
    },
    create: {
      name: DEMO_COURSE_PLATFORM_ISSUER_NAME,
      legalName: DEMO_COURSE_PLATFORM_ISSUER_NAME,
      did: DEMO_COURSE_PLATFORM_ISSUER_DID,
      walletAddress: DEMO_COURSE_PLATFORM_ISSUER_WALLET_ADDRESS,
      authorizationStatus: IssuerAuthorizationStatus.authorized,
      authorizedAt: DEMO_COURSE_PLATFORM_ISSUER_AUTHORIZED_AT
    }
  };
}

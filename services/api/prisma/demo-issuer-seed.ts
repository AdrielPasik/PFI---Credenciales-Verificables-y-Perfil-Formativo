import { IssuerAuthorizationStatus, Prisma } from '@prisma/client';

export const DEMO_ISSUER_NAME =
  'Universidad Argentina de la Empresa (UADE)';
export const DEMO_ISSUER_DID = 'did:example:issuer-demo';
export const DEMO_ISSUER_WALLET_ADDRESS =
  '0x00000000000000000000000000000000000000aa';
export const DEMO_ISSUER_AUTHORIZED_AT = new Date(
  '2026-01-01T00:00:00.000Z'
);

/**
 * Identidad del usuario administrador demo de UADE. El email se construye
 * por concatenacion (nunca como literal unico) para que jamas quede pegado
 * accidentalmente envuelto en markdown/mailto. El DID se mantiene igual al
 * usado historicamente (`did:example:issuer-admin-demo`): es la clave
 * estable que permite ubicar y renombrar en el lugar al usuario ya
 * existente en ambientes demo/cloud sin duplicarlo. Cambiar el DID
 * rompería esa ancla y podria crear un segundo usuario en vez de renombrar
 * el original, por eso se decidio NO cambiarlo aunque el email si cambia.
 */
export const DEMO_UADE_ISSUER_ADMIN_EMAIL =
  'emisor.uade' + '@uade.edu.ar';
export const DEMO_UADE_ISSUER_ADMIN_DISPLAY_NAME = 'Administrador UADE';
export const DEMO_UADE_ISSUER_ADMIN_DID = 'did:example:issuer-admin-demo';
export const DEMO_UADE_ISSUER_ADMIN_PASSWORD = 'UadeDemo123!';

/**
 * Identidad previa (pre hotfix de naming), conservada unicamente para que
 * el bootstrap pueda ubicar y renombrar en el lugar un usuario ya creado
 * en un ambiente demo/cloud con el email/nombre anterior. No usar para
 * escrituras nuevas.
 */
export const LEGACY_DEMO_UADE_ISSUER_ADMIN_EMAIL =
  'issuer.admin' + '@example.com';
export const LEGACY_DEMO_UADE_ISSUER_ADMIN_DISPLAY_NAME = 'Issuer Admin';

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

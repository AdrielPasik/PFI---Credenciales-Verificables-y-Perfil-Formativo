import { IssuerAuthorizationStatus, Prisma } from '@prisma/client';

/**
 * Issuer demo generico para credenciales course. platformName es un dato
 * declarado por el emisor en credentialSubject, no una integracion oficial
 * con ninguna plataforma real (Udemy, Coursera, etc.).
 *
 * El DID y la walletAddress del issuer NO cambian en el hotfix de naming:
 * son la clave estable (`where.did`) que ya puede tener datos creados en
 * ambientes demo/cloud. Renombrar solo `name`/`legalName` es seguro porque
 * el upsert sigue encontrando el mismo registro por `did`; cambiar el DID
 * en cambio podria crear un segundo issuer en vez de renombrar el
 * existente.
 */
export const DEMO_COURSE_PLATFORM_ISSUER_NAME =
  'Plataforma de Cursos Demo';
export const DEMO_COURSE_PLATFORM_ISSUER_DID =
  'did:example:course-platform-issuer-demo';
export const DEMO_COURSE_PLATFORM_ISSUER_WALLET_ADDRESS =
  '0x00000000000000000000000000000000000000bb';
export const DEMO_COURSE_PLATFORM_ISSUER_AUTHORIZED_AT = new Date(
  '2026-01-01T00:00:00.000Z'
);

/**
 * Identidad del usuario administrador demo de este issuer. El email se
 * construye por concatenacion (no como literal unico) para que nunca se
 * pegue accidentalmente envuelto en markdown/mailto (p. ej.
 * "[cursos.demo@example.com](mailto:...)"). Cualquier dato persistido debe
 * usar exactamente estas constantes, nunca un literal escrito a mano en
 * otro archivo.
 */
export const DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL =
  'cursos.demo' + '@example.com';
export const DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DISPLAY_NAME =
  'Administrador Cursos Demo';
export const DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID =
  'did:example:cursos-demo-admin';
export const DEMO_COURSE_PLATFORM_ISSUER_ADMIN_PASSWORD = 'CursosDemo123!';

/**
 * Identidad previa (pre hotfix de naming), conservada unicamente para que
 * el bootstrap pueda ubicar y renombrar en el lugar un usuario ya creado
 * en un ambiente demo/cloud con el email/DID/nombre anterior. No usar para
 * escrituras nuevas.
 */
export const LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_EMAIL =
  'platform.issuer.demo' + '@example.com';
export const LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DISPLAY_NAME =
  'Demo Course Platform Admin';
export const LEGACY_DEMO_COURSE_PLATFORM_ISSUER_ADMIN_DID =
  'did:example:course-platform-issuer-admin-demo';

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

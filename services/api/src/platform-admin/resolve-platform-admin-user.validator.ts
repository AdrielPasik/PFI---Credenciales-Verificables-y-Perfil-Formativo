/**
 * Validador estricto del request de `POST /admin/users/resolve` -- slice S4.
 *
 * POR QUE ESCRITO A MANO, y no un `ValidationPipe`. Este repo NO registra
 * ningun pipe global (`main.ts` no lo hace) y NO tiene `class-validator` ni
 * `class-transformer` instalados. Su convencion real es validar con funciones
 * propias que rechazan EXPLICITAMENTE lo que no pertenece al contrato; el
 * precedente directo es `objectives/objective-request.validator.ts`, de donde
 * salen `fail`, `isPlainObject` y la idea de categorizar las claves prohibidas
 * para poder dar el motivo real en vez de un "campo desconocido" generico.
 *
 * LA FRONTERA HTTP ES ESTRICTA. Una clave desconocida se RECHAZA, no se ignora
 * en silencio. Si el borde fuera permisivo, un cliente podria creer que mando
 * `userId` o `role` y que el servidor los tuvo en cuenta.
 *
 * NO HAY SPREAD DEL BODY en ningun punto: el unico campo que cruza es el email
 * normalizado que devuelve esta funcion.
 */

import { BadRequestException } from '@nestjs/common';

/**
 * Mismo patron de regex que ya usan `auth.service.ts`,
 * `issuer-holder-resolution.service.ts` y `prisma/bootstrap-platform-admin.ts`.
 * El repo deliberadamente NO centraliza esta constante -- ver el comentario en
 * `auth.service.ts` -- asi que replicarla es la convencion, no un descuido.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** El UNICO campo del contrato. */
const ROOT_KEYS = new Set(['email']);

/**
 * Autoridad: sale de `request.user.id` via `AuthGuard` + `PlatformAdminGuard`,
 * nunca del body. Se nombran para poder decir POR QUE se rechazan: quien manda
 * `platformAdminUserId` no escribio mal una clave, se equivoco de modelo de
 * confianza.
 */
const AUTHORITY_KEYS = new Set([
  'userId',
  'actorUserId',
  'platformAdminUserId',
  'creatorUserId',
  'adminUserId'
]);

/** Capacidades y estados que el SERVIDOR posee: el cliente no los propone. */
const PRIVILEGED_KEYS = new Set([
  'role',
  'status',
  'membershipRole',
  'membershipStatus',
  'authorizationStatus',
  'platformAdmin',
  'isPlatformAdmin'
]);

/** Identidad tecnica y configuracion de cadena: fuera de alcance hasta Base Sepolia. */
const TECHNICAL_IDENTITY_KEYS = new Set([
  'did',
  'walletAddress',
  'network',
  'blockchainNetwork',
  'chainId',
  'contractAddress',
  'issuerAddress'
]);

/** Secretos. Nunca entran por ningun endpoint administrativo. */
const SECRET_KEYS = new Set([
  'password',
  'passwordHash',
  'authCredential',
  'accessToken',
  'token'
]);

/**
 * Esto es una resolucion de PLATAFORMA: no selecciona contexto institucional.
 * Un `issuerId` aca seria la senal de que alguien confundio este endpoint con
 * S5a (`POST /admin/issuers/:issuerId/memberships`), donde el issuer viene del
 * path y nunca del body.
 */
const FORBIDDEN_DOMAIN_KEYS = new Set([
  'issuerId',
  'issuer',
  'credentialId',
  'memberships',
  'issuerMemberships'
]);

function fail(message: string): never {
  throw new BadRequestException(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rechaza toda clave ajena al contrato, dando el motivo real.
 *
 * El orden de los chequeos importa: `userId` tambien es "desconocida", pero
 * decirlo asi perderia la explicacion de por que no puede mandarse.
 */
function assertOnlyAllowedKeys(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (AUTHORITY_KEYS.has(key)) {
      fail(`body.${key} no puede enviarse: la identidad sale del token.`);
    }
    if (PRIVILEGED_KEYS.has(key)) {
      fail(`body.${key} lo establece el servidor y no puede enviarse.`);
    }
    if (TECHNICAL_IDENTITY_KEYS.has(key)) {
      fail(
        `body.${key} no forma parte del contrato: la identidad tecnica no se configura por esta via.`
      );
    }
    if (SECRET_KEYS.has(key)) {
      fail(`body.${key} nunca puede enviarse a un endpoint administrativo.`);
    }
    if (FORBIDDEN_DOMAIN_KEYS.has(key)) {
      fail(
        `body.${key} no forma parte del contrato: esta es una resolucion de plataforma, no institucional.`
      );
    }
    if (!ROOT_KEYS.has(key)) {
      fail(`body.${key} no forma parte del contrato publico.`);
    }
  }
}

/**
 * Valida el body y devuelve UNICAMENTE el email normalizado.
 *
 * Normalizacion identica a la del resto del repo: `trim()` + `toLowerCase()`
 * mas validacion de formato. Es la misma regla de `AuthService.register`,
 * `IssuerHolderResolutionService.resolveHolder` y el bootstrap de S2 -- nunca
 * una segunda regla propia de /admin.
 *
 * No hay busqueda parcial ni autocomplete: el valor se usa para una resolucion
 * EXACTA de un email ya conocido por el Platform Admin.
 */
export function mapResolvePlatformAdminUserRequest(payload: unknown): string {
  if (!isPlainObject(payload)) {
    fail('El cuerpo de la peticion debe ser un objeto.');
  }

  assertOnlyAllowedKeys(payload);

  const raw = payload.email;

  if (typeof raw !== 'string') {
    fail('body.email debe ser un string.');
  }

  const normalized = raw.trim().toLowerCase();

  if (!normalized) {
    fail('body.email es requerido.');
  }

  if (!EMAIL_PATTERN.test(normalized)) {
    fail('body.email debe tener un formato valido.');
  }

  return normalized;
}

/**
 * Validador estricto del request de `POST /admin/issuers/:issuerId/memberships`
 * -- slice S5a.
 *
 * MISMA FORMA QUE S4 (`resolve-platform-admin-user.validator.ts`): sin
 * `ValidationPipe` global ni `class-validator` en el repo, la convencion real
 * es una funcion propia que rechaza EXPLICITAMENTE lo que no pertenece al
 * contrato, con el motivo real en vez de un "campo desconocido" generico.
 *
 * ESTE ES EL PRIMER ENDPOINT DE PLATAFORMA QUE MUTA AUTORIDAD, asi que la
 * frontera es la mas estrecha del repo: UN campo. El issuer sale del path, el
 * rol y el status los fija el servidor, y el actor sale del token.
 *
 * NO HAY SPREAD DEL BODY en ningun punto: lo unico que cruza es el email
 * normalizado que devuelve esta funcion.
 */

import { BadRequestException } from '@nestjs/common';

/**
 * Mismo patron de regex que `auth.service.ts`,
 * `issuer-holder-resolution.service.ts`, el bootstrap de S2 y el validador de
 * S4. El repo deliberadamente NO centraliza esta constante; replicarla es la
 * convencion, y S5a no es el slice para refactorizar la validacion de emails
 * de todo el repositorio.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** El UNICO campo del contrato. */
const ROOT_KEYS = new Set(['userEmail']);

/**
 * Autoridad: el actor sale de `request.user.id` via
 * `AuthGuard` + `PlatformAdminGuard`, y el SUJETO del grant se resuelve
 * server-side por email. Un `userId` en el body convertiria al cliente en
 * portador de un identificador de confianza, que es justamente lo que S4
 * evita no devolviendolo.
 */
const AUTHORITY_KEYS = new Set([
  'userId',
  'actorId',
  'actorUserId',
  'adminUserId',
  'platformAdminUserId',
  'createdBy',
  'createdByUserId',
  'grantedBy',
  'grantedByUserId'
]);

/**
 * Lo que el SERVIDOR fija. `role` y `status` son el corazon de este slice: si
 * el cliente pudiera elegirlos, podria crear una membership `viewer`/`pending`
 * inutil o, peor, se establecria la convencion de que el cliente propone roles.
 */
const PRIVILEGED_KEYS = new Set([
  'role',
  'status',
  'membershipRole',
  'membershipStatus',
  'authorizationStatus',
  'platformAdmin',
  'isPlatformAdmin'
]);

/**
 * Intencion de onboarding: es UX, NO autorizacion, y no participa de este
 * grant. Un cliente que la manda aca confundio los dos planos, y el mensaje
 * se lo dice en vez de darle un "campo desconocido" generico.
 *
 * Nombrar la clave aca es el refuerzo mas fuerte de la invariante de O1, no
 * su violacion: el campo queda explicitamente fuera del alcance del cliente.
 * El guard estructural
 * (`src/auth/__guards__/onboarding-intent-is-not-authorization.test.ts`) es
 * AST-aware precisamente para distinguir este literal de una LECTURA del
 * tipo `user.onboardingIntent`, que es lo unico que prohibe.
 */
const ONBOARDING_KEYS = new Set(['onboardingIntent']);

/** Identidad tecnica y cadena: fuera de alcance hasta Base Sepolia. */
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
 * El issuer viene EXCLUSIVAMENTE del path. Un `issuerId` en el body abriria la
 * puerta a que path y body discrepen, y a que alguien crea que el body manda.
 */
const PATH_OWNED_KEYS = new Set(['issuerId', 'issuer']);

/** Campos que el servidor posee o que no pertenecen a este contrato. */
const SERVER_OWNED_KEYS = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'metadata'
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
 * El orden importa: `userId` tambien es "desconocida", pero decirlo asi
 * perderia la explicacion de por que no puede mandarse.
 */
function assertOnlyAllowedKeys(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (AUTHORITY_KEYS.has(key)) {
      fail(
        `body.${key} no puede enviarse: el actor sale del token y el sujeto se resuelve por email.`
      );
    }
    if (PRIVILEGED_KEYS.has(key)) {
      fail(`body.${key} lo establece el servidor y no puede enviarse.`);
    }
    if (ONBOARDING_KEYS.has(key)) {
      fail(
        `body.${key} no forma parte del contrato: es intencion de onboarding, no autorizacion.`
      );
    }
    if (PATH_OWNED_KEYS.has(key)) {
      fail(`body.${key} sale de la ruta, no del cuerpo de la peticion.`);
    }
    if (TECHNICAL_IDENTITY_KEYS.has(key)) {
      fail(
        `body.${key} no forma parte del contrato: la identidad tecnica no se configura por esta via.`
      );
    }
    if (SECRET_KEYS.has(key)) {
      fail(`body.${key} nunca puede enviarse a un endpoint administrativo.`);
    }
    if (SERVER_OWNED_KEYS.has(key)) {
      fail(`body.${key} lo establece el servidor y no puede enviarse.`);
    }
    if (!ROOT_KEYS.has(key)) {
      fail(`body.${key} no forma parte del contrato publico.`);
    }
  }
}

/**
 * Valida el body y devuelve UNICAMENTE el email normalizado del User que va a
 * recibir la membership.
 *
 * Normalizacion identica a la del resto del repo: `trim()` + `toLowerCase()`
 * mas validacion de formato.
 */
export function mapGrantIssuerMembershipRequest(payload: unknown): string {
  if (!isPlainObject(payload)) {
    fail('El cuerpo de la peticion debe ser un objeto.');
  }

  assertOnlyAllowedKeys(payload);

  const raw = payload.userEmail;

  if (typeof raw !== 'string') {
    fail('body.userEmail debe ser un string.');
  }

  const normalized = raw.trim().toLowerCase();

  if (!normalized) {
    fail('body.userEmail es requerido.');
  }

  if (!EMAIL_PATTERN.test(normalized)) {
    fail('body.userEmail debe tener un formato valido.');
  }

  return normalized;
}

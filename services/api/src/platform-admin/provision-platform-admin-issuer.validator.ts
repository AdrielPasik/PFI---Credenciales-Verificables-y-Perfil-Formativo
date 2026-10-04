/**
 * Validador estricto del request de `POST /admin/issuers` -- slice S5b.
 *
 * MISMA FORMA QUE S4 Y S5a: sin `ValidationPipe` global ni `class-validator` en
 * el repo, la convencion real es una funcion propia que rechaza
 * EXPLICITAMENTE lo que no pertenece al contrato, con el motivo real en vez de
 * un "campo desconocido" generico.
 *
 * TRES CAMPOS, Y NADA MAS: `name`, `legalName`, `initialAdminUserEmail`.
 *
 * Todo lo demas que define al Issuer recien creado lo fija el servidor:
 * `authorizationStatus`, `authorizedAt`, `did`, `walletAddress`, `metadata`,
 * `createdAt`. Y todo lo que define a la membership inicial tambien:
 * `role = admin`, `status = active`. Si el cliente pudiera proponer cualquiera
 * de esos, S5b dejaria de ser provisioning controlado.
 *
 * NO HAY SPREAD DEL BODY en ningun punto: lo unico que cruza al service es el
 * objeto de tres strings normalizados que devuelve esta funcion.
 */

import { BadRequestException } from '@nestjs/common';

/**
 * Mismo patron de regex que `auth.service.ts`,
 * `issuer-holder-resolution.service.ts`, el bootstrap de S2 y los validadores
 * de S4 y S5a. El repo deliberadamente NO centraliza esta constante;
 * replicarla es la convencion, y S5b no es el slice para refactorizar la
 * validacion de emails de todo el repositorio.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Los UNICOS tres campos del contrato. */
const ROOT_KEYS = new Set(['name', 'legalName', 'initialAdminUserEmail']);

/**
 * Limite superior de longitud. `Issuer.name` y `Issuer.legalName` son `String`
 * sin `@db.VarChar`, o sea `text` en PostgreSQL: la base NO los acota. Sin un
 * limite aca, un cliente autenticado como PlatformAdmin podria persistir un
 * nombre de megabytes. 512 es holgado para cualquier razon social real.
 */
const MAX_NAME_LENGTH = 512;

/**
 * Autoridad: el actor sale de `request.user.id` via
 * `AuthGuard` + `PlatformAdminGuard`, y el primer admin se resuelve
 * server-side por email. Un `userId` en el body convertiria al cliente en
 * portador de un identificador de confianza, que es justamente lo que S4 evita
 * no devolviendolo.
 */
const AUTHORITY_KEYS = new Set([
  'userId',
  'initialAdminUserId',
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
 * Lo que el SERVIDOR fija sobre el Issuer y sobre la membership inicial.
 *
 * `authorizationStatus` y `authorizedAt` son el corazon de este slice: el
 * sentido de "provisioning controlado" es precisamente que la habilitacion
 * operacional NO la elige quien manda el request. Y `role`/`status` repiten la
 * razon de S5a: si el cliente pudiera elegirlos, podria dar de alta un issuer
 * cuyo primer admin es un `viewer` inutil, o se establecria la convencion de
 * que el cliente propone roles.
 */
const PRIVILEGED_KEYS = new Set([
  'authorizationStatus',
  'authorizedAt',
  'revokedAt',
  'role',
  'status',
  'membershipRole',
  'membershipStatus',
  'initialAdminRole',
  'initialAdminStatus',
  'platformAdmin',
  'isPlatformAdmin'
]);

/**
 * Intencion de onboarding: es UX, NO autorizacion, y no participa del
 * provisioning. Un cliente que la manda aca confundio los dos planos, y el
 * mensaje se lo dice en vez de darle un "campo desconocido" generico.
 *
 * Nombrar la clave aca es el refuerzo mas fuerte de la invariante de O1, no su
 * violacion: el campo queda explicitamente fuera del alcance del cliente. El
 * guard estructural
 * (`src/auth/__guards__/onboarding-intent-is-not-authorization.test.ts`) es
 * AST-aware precisamente para distinguir este literal de una LECTURA del tipo
 * `user.onboardingIntent`, que es lo unico que prohibe.
 */
const ONBOARDING_KEYS = new Set(['onboardingIntent']);

/**
 * Identidad tecnica y cadena: fuera de alcance hasta Base Sepolia.
 *
 * El Issuer nace con `did = null` y `walletAddress = null` A PROPOSITO, y eso
 * no es un hueco que el cliente pueda rellenar en el mismo request: el
 * provisioning tecnico es otro problema, con firma y con registry.
 */
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
 * El Issuer lo crea el SERVIDOR: no hay issuer preexistente al que apuntar.
 *
 * Un `issuerId` en el body seria la senal de que quien llama confundio S5b
 * (crear) con S5a (asignar sobre uno existente).
 */
const SERVER_CREATED_KEYS = new Set(['issuerId', 'issuer', 'id']);

/** Campos que el servidor posee o que no pertenecen a este contrato. */
const SERVER_OWNED_KEYS = new Set([
  'createdAt',
  'updatedAt',
  'metadata',
  'memberships',
  'academicCourses',
  'programs',
  'courseTemplates',
  'credentials'
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
 * El orden importa: `authorizedAt` tambien es "desconocida", pero decirlo asi
 * perderia la explicacion de por que no puede mandarse.
 */
function assertOnlyAllowedKeys(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (AUTHORITY_KEYS.has(key)) {
      fail(
        `body.${key} no puede enviarse: el actor sale del token y el primer admin se resuelve por email.`
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
    if (SERVER_CREATED_KEYS.has(key)) {
      fail(
        `body.${key} no puede enviarse: este endpoint CREA el issuer, no opera sobre uno existente.`
      );
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
 * Normaliza un nombre institucional: `trim()` y colapso de espacios internos.
 *
 * El colapso de espacios es el mismo criterio que `buildHolderDisplayLabel`
 * aplica a los nombres de personas (`replace(/\s+/g, ' ')`): evita que
 * "Universidad  X" y "Universidad X" sean dos filas visualmente identicas.
 * NO se toca mayusculas ni acentos -- una razon social es un dato, no un
 * identificador normalizable.
 */
function normalizeInstitutionalName(
  value: unknown,
  field: 'name' | 'legalName'
): string {
  if (typeof value !== 'string') {
    fail(`body.${field} debe ser un string.`);
  }

  const normalized = value.trim().replace(/\s+/g, ' ');

  if (!normalized) {
    fail(`body.${field} es requerido.`);
  }

  if (normalized.length > MAX_NAME_LENGTH) {
    fail(`body.${field} no puede exceder ${MAX_NAME_LENGTH} caracteres.`);
  }

  return normalized;
}

/**
 * Lo UNICO que cruza del cliente al service, ya normalizado.
 *
 * `legalName` se exige no vacio en ESTE endpoint aunque la columna sea
 * nullable: el schema permite `null` porque hay filas historicas sin razon
 * social, no porque dar de alta una institucion sin ella sea deseable. Un alta
 * controlada es exactamente el momento en que el dato existe.
 */
export interface ProvisionIssuerRequest {
  name: string;
  legalName: string;
  initialAdminUserEmail: string;
}

/**
 * Valida el body y devuelve los tres campos normalizados.
 *
 * Normalizacion del email identica a la del resto del repo: `trim()` +
 * `toLowerCase()` mas validacion de formato.
 */
export function mapProvisionIssuerRequest(
  payload: unknown
): ProvisionIssuerRequest {
  if (!isPlainObject(payload)) {
    fail('El cuerpo de la peticion debe ser un objeto.');
  }

  assertOnlyAllowedKeys(payload);

  const name = normalizeInstitutionalName(payload.name, 'name');
  const legalName = normalizeInstitutionalName(payload.legalName, 'legalName');

  const rawEmail = payload.initialAdminUserEmail;

  if (typeof rawEmail !== 'string') {
    fail('body.initialAdminUserEmail debe ser un string.');
  }

  const initialAdminUserEmail = rawEmail.trim().toLowerCase();

  if (!initialAdminUserEmail) {
    fail('body.initialAdminUserEmail es requerido.');
  }

  if (!EMAIL_PATTERN.test(initialAdminUserEmail)) {
    fail('body.initialAdminUserEmail debe tener un formato valido.');
  }

  return { name, legalName, initialAdminUserEmail };
}

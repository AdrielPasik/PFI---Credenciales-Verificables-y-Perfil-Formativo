/**
 * Bootstrap del primer PlatformAdmin -- slice S2.
 *
 * Otorga la capacidad de administracion de plataforma a un User QUE YA EXISTE.
 * Es la UNICA forma de conceder esa capacidad en todo el sistema, y es
 * deliberadamente out-of-band: una accion operacional explicita, nunca un
 * endpoint.
 *
 * POR QUE VIVE EN `prisma/` Y NO EN `src/`. S1 dejo un guard estructural
 * (`src/platform-admin/__guards__/platform-admin-write-surface.test.ts`) que
 * exige CERO writers de `PlatformAdmin` dentro de `services/api/src`. Esa
 * invariante es lo que hace que "el cliente no puede autoasignarse privilegios
 * de plataforma" sea verdad por CONSTRUCCION y no por validacion: no existe
 * camino de codigo alcanzable desde la superficie HTTP que inserte la fila. Por
 * eso el unico writer del repo esta aca, fuera de `src/`, y el guard de S1 no
 * se relaja ni se borra. El mismo test de este slice comprueba ademas que
 * ningun archivo de `src/` (ni los seeds) importe este modulo, que seria la
 * otra forma de abrir el agujero.
 *
 * LO QUE ESTE SCRIPT NO HACE, NUNCA:
 *   - no crea Users (el User debe existir previamente);
 *   - no crea ni toca AuthCredential;
 *   - no modifica el User (ni status, ni email, ni DID, ni nombre);
 *   - no crea Issuers ni IssuerMemberships;
 *   - no aplica migrations ni toca el schema.
 *
 * El unico cambio de estado posible es: `PlatformAdmin` + su `AuditLog`, y solo
 * la primera vez.
 *
 * USO
 *   npm run bootstrap:platform-admin --workspace @credential-intelligence/api -- \
 *     --email persona@dominio.com
 *
 *   npm run bootstrap:platform-admin --workspace @credential-intelligence/api -- --help
 */

import { ActorType, Prisma, PrismaClient, UserStatus } from '@prisma/client';

import {
  PLATFORM_ADMIN_GRANTED_ACTION,
  PLATFORM_ADMIN_RESOURCE_TYPE
} from '../src/platform-admin/platform-admin-audit.constants';

// Mismo patron de regex que ya usan `auth.service.ts`,
// `issuer-holder-resolution.service.ts` y `analysis-run-backfill.service.ts`.
// El repo deliberadamente NO centraliza esta constante (ver el comentario en
// auth.service.ts), asi que replicarla aca es la convencion, no un descuido.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Codigo Prisma de violacion de unique constraint. En la transaccion de este
// script la unica constraint que puede dispararlo es `PlatformAdmin.userId`.
// Mismo codigo y mismo chequeo que `auth.service.ts`.
const UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

export const BOOTSTRAP_PLATFORM_ADMIN_HELP_TEXT = `
Uso: npm run bootstrap:platform-admin --workspace @credential-intelligence/api -- --email <email>

Otorga PlatformAdmin a un User que YA EXISTE. Accion operacional explicita:
no hay ningun endpoint que conceda esta capacidad.

Argumentos:
  --email <email>   Email del User existente, activo, que recibira la
                     capacidad. Se normaliza (trim + lowercase) y se resuelve
                     de forma case-insensitive.
  --help            Muestra esta ayuda y termina.

El User debe existir, tener email y estar active. Este script NUNCA crea un
User, NUNCA crea un AuthCredential y NUNCA modifica el User.

Es idempotente: N ejecuciones dejan exactamente 1 PlatformAdmin y exactamente
1 AuditLog del grant inicial. La segunda corrida reporta already_exists sin
escribir nada.
`.trim();

export interface BootstrapPlatformAdminArgs {
  help: boolean;
  email: string | null;
}

export type BootstrapPlatformAdminStatus = 'created' | 'already_exists';

export interface BootstrapPlatformAdminSummary {
  status: BootstrapPlatformAdminStatus;
  userId: string;
  email: string;
  platformAdminId: string;
}

/**
 * Cliente minimo que necesita el grant.
 *
 * `Pick` sobre el `PrismaClient` real (no una interfaz inventada) para que un
 * cambio de schema rompa la compilacion aca. Mismo patron que
 * `cleanup-legacy-profile-shares.ts`.
 *
 * `auditLog` NO esta en esta lista a proposito: la unica escritura de AuditLog
 * de este script ocurre DENTRO de la transaccion, sobre el
 * `Prisma.TransactionClient`, nunca sobre el cliente raiz.
 */
export type BootstrapPlatformAdminClient = Pick<
  PrismaClient,
  'user' | 'platformAdmin' | '$transaction'
>;

/**
 * Parseo de argumentos -- misma forma que
 * `src/analysis-run/scripts/reprocess-documents.utils.ts`: flags `--x <valor>`,
 * `--help` booleano, y un error claro si falta el valor.
 */
export function parseBootstrapPlatformAdminArgs(
  argv: readonly string[]
): BootstrapPlatformAdminArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (!current.startsWith('--')) {
      continue;
    }

    if (current === '--help') {
      flags.add(current);
      continue;
    }

    const next = argv[index + 1];

    if (!next || next.startsWith('--')) {
      throw new Error(`Falta valor para el argumento ${current}.`);
    }

    values.set(current, next);
    index += 1;
  }

  if (flags.has('--help')) {
    return { help: true, email: null };
  }

  return {
    help: false,
    email: values.get('--email')?.trim() || null
  };
}

/**
 * Normalizacion del email -- IDENTICA a la del repo: `trim().toLowerCase()`
 * mas validacion de formato. Es la misma regla de `AuthService.register` y de
 * `IssuerHolderResolutionService.resolveHolder`.
 */
export function normalizeBootstrapEmail(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('--email es requerido.');
  }

  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    throw new Error('--email es requerido.');
  }

  if (!EMAIL_PATTERN.test(normalized)) {
    throw new Error('--email debe tener un formato valido.');
  }

  return normalized;
}

/**
 * Otorga PlatformAdmin al User identificado por `email`.
 *
 * ORDEN DE OPERACIONES, y por que esta asi:
 *
 *   1. normalizar y validar el email            -- puro, sin tocar la base
 *   2. resolver el User existente y elegible    -- LECTURA; si falla, 0 escrituras
 *   3. pre-check del grant ya existente         -- LECTURA; si existe, 0 escrituras
 *   4. transaccion: PlatformAdmin -> AuditLog   -- las dos escrituras, juntas
 *
 * Los pasos 2 y 3 van FUERA de la transaccion a proposito, igual que
 * `AuthService.register`, que hace su `findUnique` de email antes de abrir su
 * `$transaction`: asi un User inexistente o ya-admin termina sin haber abierto
 * ninguna transaccion y sin haber escrito nada.
 *
 * IDEMPOTENCIA. El pre-check del paso 3 es lo que hace que la segunda corrida
 * reporte `already_exists` sin escribir: el unique por si solo evitaria la fila
 * duplicada, pero haria fallar el script en vez de terminar bien, y -- lo
 * importante -- no impediria un SEGUNDO AuditLog de grant si las dos
 * escrituras no estuvieran en la misma transaccion.
 *
 * CONCURRENCIA. El pre-check es una ventana, no una garantia: dos corridas
 * simultaneas pueden pasarlo las dos. La ultima barrera es el unique de
 * `PlatformAdmin.userId`, y lo que hace que una carrera termine limpia es que
 * las dos escrituras viven en la MISMA transaccion:
 *
 *   - en PostgreSQL el INSERT de la segunda transaccion se BLOQUEA sobre el
 *     indice unico hasta que la primera commitea, y recien entonces levanta la
 *     violacion -- es una serializacion limpia, no una escritura perdida;
 *   - esa violacion aborta la transaccion COMPLETA, asi que el AuditLog que la
 *     segunda corrida ya habia insertado desaparece con el rollback: nunca
 *     queda un AuditLog huerfano ni dos AuditLog de grant para una sola fila;
 *   - el script no trata eso como un fallo: relee el grant ganador y devuelve
 *     `already_exists`, que es el resultado honesto. Misma forma que
 *     `ensureDidForUser`, que al perder la carrera relee el valor realmente
 *     persistido en vez de asumir el propio.
 *
 * El orden PlatformAdmin -> AuditLog dentro de la transaccion esta forzado por
 * los datos: `AuditLog.resourceId` es el id de la fila recien creada.
 */
export async function grantPlatformAdminByEmail(
  client: BootstrapPlatformAdminClient,
  rawEmail: unknown
): Promise<BootstrapPlatformAdminSummary> {
  const email = normalizeBootstrapEmail(rawEmail);
  const user = await resolveEligibleUserOrThrow(client, email);

  const existing = await client.platformAdmin.findUnique({
    where: { userId: user.id },
    select: { id: true }
  });

  if (existing) {
    return {
      status: 'already_exists',
      userId: user.id,
      email,
      platformAdminId: existing.id
    };
  }

  try {
    const created = await client.$transaction(async (transaction) => {
      const platformAdmin = await transaction.platformAdmin.create({
        data: { userId: user.id },
        select: { id: true }
      });

      // Primer writer de AuditLog del repo. actorId = null y actorType =
      // `system` porque NO hay un PlatformAdmin previo actuando mediante una
      // request: el hecho lo produce este script. `system` es un valor que el
      // enum ActorType ya tiene, distinto de `system_admin`, que queda
      // reservado para un PlatformAdmin humano actuando por HTTP (S5a/S5b).
      //
      // metadata lleva userId y NO el email: el email es PII, es mutable y ya
      // esta en el User. Y userId hace falta de verdad -- `resourceId` es el id
      // del GRANT, y `PlatformAdmin` cae en CASCADE si se borra el User, asi
      // que sin esto la fila de auditoria no podria decir a quien se le otorgo.
      await transaction.auditLog.create({
        data: {
          actorId: null,
          actorType: ActorType.system,
          action: PLATFORM_ADMIN_GRANTED_ACTION,
          resourceType: PLATFORM_ADMIN_RESOURCE_TYPE,
          resourceId: platformAdmin.id,
          metadata: { userId: user.id }
        }
      });

      return platformAdmin;
    });

    return {
      status: 'created',
      userId: user.id,
      email,
      platformAdminId: created.id
    };
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) {
      throw error;
    }

    // Perdimos la carrera. La transaccion entera quedo revertida (grant y
    // AuditLog incluidos), asi que el estado es exactamente el que dejo la
    // corrida ganadora. Releemos en vez de asumir.
    const winner = await client.platformAdmin.findUnique({
      where: { userId: user.id },
      select: { id: true }
    });

    if (!winner) {
      throw error;
    }

    return {
      status: 'already_exists',
      userId: user.id,
      email,
      platformAdminId: winner.id
    };
  }
}

/**
 * Resolucion del User -- misma estrategia que
 * `IssuerHolderResolutionService.resolveHolder`, incluido el `take: 2`.
 *
 * POR QUE `findMany` CASE-INSENSITIVE Y NO `findUnique`. `User.email` es
 * `@unique`, pero en PostgreSQL ese indice es case-SENSITIVE: pueden convivir
 * dos filas que difieran solo en mayusculas. Un `findUnique` exacto podria no
 * encontrar la cuenta real del operador. `take: 2` existe para DETECTAR esa
 * ambiguedad y abortar, en vez de otorgar la capacidad al primero que aparezca.
 *
 * MENSAJES EXPLICITOS, a diferencia de la superficie HTTP. `resolveHolder`
 * devuelve un 404 uniforme para "no existe" y "no elegible" porque ahi importa
 * no permitir enumeracion de usuarios. Aca no hay enumeracion posible: el
 * operador corre el script contra su propia base y necesita saber QUE esta mal
 * para corregirlo. Por eso cada caso dice lo suyo.
 */
async function resolveEligibleUserOrThrow(
  client: BootstrapPlatformAdminClient,
  email: string
): Promise<{ id: string }> {
  const matches = await client.user.findMany({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: { id: true, email: true, status: true },
    take: 2
  });

  if (matches.length > 1) {
    throw new Error(
      `Hay mas de un User con el email ${email} (difieren en mayusculas). ` +
        'Resolver la inconsistencia a mano antes de otorgar la capacidad: no se escribio nada.'
    );
  }

  const user = matches[0];

  if (!user) {
    throw new Error(
      `No existe ningun User con el email ${email}. Este script nunca crea cuentas: ` +
        'la persona debe registrarse primero.'
    );
  }

  const storedEmail = user.email?.trim().toLowerCase();

  if (!storedEmail || !EMAIL_PATTERN.test(storedEmail)) {
    throw new Error(
      `El User ${user.id} no tiene un email valido y no es elegible: no se escribio nada.`
    );
  }

  if (user.status !== UserStatus.active) {
    throw new Error(
      `El User ${user.id} esta en estado ${user.status} y no es elegible. ` +
        'Solo un User active puede recibir la capacidad: no se escribio nada.'
    );
  }

  return { id: user.id };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_ERROR_CODE
  );
}

/**
 * Resumen seguro. Solo status, userId, email normalizado y el id del grant --
 * nunca hashes, tokens, DATABASE_URL, AuthCredential ni objetos Prisma
 * completos. Mismo formato JSON que usan `seed-demo-identities.ts` y
 * `seed-course-platform-user.ts` para su summary.
 */
export function formatBootstrapSummary(
  summary: BootstrapPlatformAdminSummary
): string {
  return JSON.stringify(summary, null, 2);
}

async function main(): Promise<void> {
  const args = parseBootstrapPlatformAdminArgs(process.argv.slice(2));

  if (args.help) {
    console.log(BOOTSTRAP_PLATFORM_ADMIN_HELP_TEXT);
    return;
  }

  // El PrismaClient se instancia DENTRO de main, nunca a nivel de modulo: asi
  // importar este archivo desde un test no abre ninguna conexion. Mismo
  // criterio que `cleanup-legacy-profile-shares.ts`.
  const prisma = new PrismaClient();

  try {
    const summary = await grantPlatformAdminByEmail(prisma, args.email);
    console.log(formatBootstrapSummary(summary));
  } finally {
    await prisma.$disconnect();
  }
}

// Solo corre como script; importarlo desde un test no ejecuta nada.
if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(
      '[bootstrap-platform-admin] abortado:',
      error instanceof Error ? error.message : 'error desconocido'
    );
    process.exitCode = 1;
  });
}

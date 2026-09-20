/**
 * Limpieza EXPLICITA de enlaces compartidos heredados — datos de desarrollo/demo.
 *
 * POR QUE EXISTE. Antes de los enlaces recuperables, un `SharingGrant` guardaba
 * solo `sha256(token)`: el token crudo existia una sola vez, en la respuesta de
 * creacion. Esas filas no tienen material de recuperacion y su URL es
 * irrecuperable por diseno. En vez de arrastrar una modalidad "enlace viejo" en
 * el producto, se borran del entorno de desarrollo y el contrato permanente
 * arranca limpio.
 *
 *     OBJETIVO: SharingGrant.tokenRecovery IS NULL
 *
 * GRAFO DE DEPENDENCIAS — AUDITADO CONTRA LA BASE, no supuesto.
 * (`information_schema.referential_constraints` sobre el esquema vigente.)
 *
 *   VerificationRun            -> SharingGrant          RESTRICT   <-- bloquea
 *   VerificationRun            -> VerificationRequest   RESTRICT   <-- bloquea
 *   VerificationRunInventoryItem -> VerificationRun     CASCADE
 *   ShareVerificationPolicy    -> SharingGrant          CASCADE
 *   ShareVerificationCredentialAuthorization -> ShareVerificationPolicy CASCADE
 *   VerificationRequest        -> SharingGrant          CASCADE
 *   VerificationProposalAttempt-> SharingGrant/Request  CASCADE
 *   VerificationExecutionLease -> SharingGrant          CASCADE
 *   VerificationEvent          -> SharingGrant          SET NULL   <-- se conserva
 *
 * De ahi sale el UNICO orden necesario:
 *
 *   1. borrar los VerificationRun de esos enlaces  (el inventario cae en cascada)
 *   2. borrar los SharingGrant                     (politica, autorizaciones,
 *                                                   solicitudes, intentos y lease
 *                                                   caen en cascada)
 *
 * `VerificationEvent` NO se borra: su FK es SET NULL y el evento sobrevive.
 *
 * LO QUE NUNCA TOCA: Credential, DocumentEvidence, TextEvidence, AnalysisRun,
 * AnalysisRunSource, Objective, ReasoningRun del holder, usuarios, emisores,
 * datos institucionales y cualquier enlace que SI tenga material de recuperacion.
 *
 * LAS FK DEL PRODUCTO NO CAMBIAN. Esta es una operacion explicita sobre datos de
 * desarrollo; el modelo de retencion de la aplicacion queda igual.
 *
 * USO
 *   node -r ts-node/register/transpile-only prisma/cleanup-legacy-profile-shares.ts
 *   node -r ts-node/register/transpile-only prisma/cleanup-legacy-profile-shares.ts --apply
 *   ... --apply --allow-remote --confirm-database=<nombre exacto>
 */

import { PrismaClient } from '@prisma/client';

export interface CleanupCounts {
  legacyShares: number;
  verificationRequests: number;
  verificationRuns: number;
  verificationRunInventoryRows: number;
  proposalAttempts: number;
  verificationPolicies: number;
  credentialAuthorizationRows: number;
  executionLeases: number;
  /** Eventos que se CONSERVAN: su FK es SET NULL. */
  verificationEventsPreserved: number;
}

export interface CleanupTarget {
  host: string;
  database: string;
  schema: string;
  local: boolean;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);

/** Lee el destino SIN exponer credenciales: nunca se imprime la URL completa. */
export function describeTarget(databaseUrl: string | undefined): CleanupTarget {
  if (!databaseUrl) throw new Error('DATABASE_URL no esta configurada.');
  const parsed = new URL(databaseUrl);
  return {
    host: `${parsed.hostname}:${parsed.port || '5432'}`,
    database: parsed.pathname.replace(/^\//, ''),
    schema: parsed.searchParams.get('schema') ?? 'public',
    local: LOCAL_HOSTS.has(parsed.hostname)
  };
}

export interface CleanupOptions {
  apply: boolean;
  allowRemote: boolean;
  confirmDatabase: string | null;
}

export function parseOptions(argv: readonly string[]): CleanupOptions {
  const confirm = argv.find((argument) => argument.startsWith('--confirm-database='));
  return {
    // La simulacion es el DEFAULT: hay que pedir --apply para escribir.
    apply: argv.includes('--apply'),
    allowRemote: argv.includes('--allow-remote'),
    confirmDatabase: confirm ? confirm.slice('--confirm-database='.length) : null
  };
}

/**
 * Autorizacion del destino. Una base remota exige TRES cosas: `--apply`,
 * `--allow-remote` y el nombre exacto de la base. Si la confirmacion no coincide
 * con lo que la URL dice de verdad, se aborta sin escribir nada.
 */
export function assertCleanupAuthorized(target: CleanupTarget, options: CleanupOptions): void {
  if (!options.apply) return;
  if (target.local) return;

  if (!options.allowRemote) {
    throw new Error(
      `La base ${target.host}/${target.database} no es local. Agrega --allow-remote si de verdad queres limpiarla.`
    );
  }
  if (options.confirmDatabase === null) {
    throw new Error(
      `Falta --confirm-database=${target.database} para confirmar el destino remoto.`
    );
  }
  if (options.confirmDatabase !== target.database) {
    throw new Error(
      'La confirmacion no coincide con la base apuntada por DATABASE_URL. No se escribio nada.'
    );
  }
}

type Client = Pick<
  PrismaClient,
  | 'sharingGrant'
  | 'verificationRequest'
  | 'verificationRun'
  | 'verificationRunInventoryItem'
  | 'verificationProposalAttempt'
  | 'shareVerificationPolicy'
  | 'shareVerificationCredentialAuthorization'
  | 'verificationExecutionLease'
  | 'verificationEvent'
>;

/** Cuenta TODO lo que caeria, sin escribir. Es lo que reporta la simulacion. */
export async function countCleanupTargets(prisma: Client): Promise<CleanupCounts & { shareIds: string[]; runIds: string[] }> {
  const legacy = await prisma.sharingGrant.findMany({
    where: { tokenRecovery: null },
    select: { id: true }
  });
  const shareIds = legacy.map((grant) => grant.id);
  const shareFilter = { sharingGrantId: { in: shareIds } };

  const runs = await prisma.verificationRun.findMany({
    where: shareFilter,
    select: { id: true }
  });
  const runIds = runs.map((run) => run.id);

  const policies = await prisma.shareVerificationPolicy.findMany({
    where: shareFilter,
    select: { id: true }
  });

  return {
    shareIds,
    runIds,
    legacyShares: shareIds.length,
    verificationRequests: await prisma.verificationRequest.count({ where: shareFilter }),
    verificationRuns: runIds.length,
    verificationRunInventoryRows: await prisma.verificationRunInventoryItem.count({
      where: { verificationRunId: { in: runIds } }
    }),
    proposalAttempts: await prisma.verificationProposalAttempt.count({ where: shareFilter }),
    verificationPolicies: policies.length,
    credentialAuthorizationRows: await prisma.shareVerificationCredentialAuthorization.count({
      where: { policyId: { in: policies.map((policy) => policy.id) } }
    }),
    executionLeases: await prisma.verificationExecutionLease.count({ where: shareFilter }),
    verificationEventsPreserved: await prisma.verificationEvent.count({ where: shareFilter })
  };
}

/**
 * Borra en el orden que exigen las FK, dentro de UNA transaccion: o cae todo el
 * conjunto, o no cae nada. No existe un estado intermedio a medio limpiar.
 */
export async function applyCleanup(
  prisma: PrismaClient,
  shareIds: readonly string[],
  runIds: readonly string[]
): Promise<{ runsDeleted: number; sharesDeleted: number }> {
  if (shareIds.length === 0) return { runsDeleted: 0, sharesDeleted: 0 };

  return prisma.$transaction(async (tx) => {
    // 1. Los runs bloquean por RESTRICT, tanto contra el enlace como contra la
    //    solicitud. El inventario cae en cascada con ellos.
    const runsDeleted = await tx.verificationRun.deleteMany({
      where: { id: { in: [...runIds] } }
    });

    // 2. El enlace arrastra politica, autorizaciones, solicitudes, intentos y
    //    lease por CASCADE. `VerificationEvent` sobrevive con SET NULL.
    const sharesDeleted = await tx.sharingGrant.deleteMany({
      where: { id: { in: [...shareIds] }, tokenRecovery: null }
    });

    return { runsDeleted: runsDeleted.count, sharesDeleted: sharesDeleted.count };
  });
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const target = describeTarget(process.env.DATABASE_URL);

  console.log('[limpieza] destino:');
  console.log(`[limpieza]   host:    ${target.host}`);
  console.log(`[limpieza]   base:    ${target.database}`);
  console.log(`[limpieza]   esquema: ${target.schema}`);
  console.log(`[limpieza]   modo:    ${options.apply ? 'APLICAR' : 'simulacion (default)'}`);

  assertCleanupAuthorized(target, options);

  const prisma = new PrismaClient();
  try {
    const counts = await countCleanupTargets(prisma);

    console.log(`[limpieza] LEGACY_SHARES_TARGETED:                 ${counts.legacyShares}`);
    console.log(`[limpieza] VERIFICATION_REQUESTS_TARGETED:         ${counts.verificationRequests}`);
    console.log(`[limpieza] VERIFICATION_RUNS_TARGETED:             ${counts.verificationRuns}`);
    console.log(`[limpieza] VERIFICATION_RUN_INVENTORY_ROWS:        ${counts.verificationRunInventoryRows}`);
    console.log(`[limpieza] PROPOSAL_ATTEMPTS_TARGETED:             ${counts.proposalAttempts}`);
    console.log(`[limpieza] VERIFICATION_POLICIES_TARGETED:         ${counts.verificationPolicies}`);
    console.log(`[limpieza] CREDENTIAL_AUTHORIZATION_ROWS_TARGETED: ${counts.credentialAuthorizationRows}`);
    console.log(`[limpieza] EXECUTION_LEASES_TARGETED:              ${counts.executionLeases}`);
    console.log(`[limpieza] VERIFICATION_EVENTS_PRESERVADOS:        ${counts.verificationEventsPreserved}`);

    if (!options.apply) {
      console.log('[limpieza] simulacion: no se escribio nada.');
      return;
    }

    const deleted = await applyCleanup(prisma, counts.shareIds, counts.runIds);
    console.log(`[limpieza] runs borrados:    ${deleted.runsDeleted}`);
    console.log(`[limpieza] enlaces borrados: ${deleted.sharesDeleted}`);
    console.log('[limpieza] credenciales, evidencia, analisis y usuarios: intactos.');
  } finally {
    await prisma.$disconnect();
  }
}

// Solo corre como script; importarlo desde un test no ejecuta nada.
if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error('[limpieza] abortada:', error instanceof Error ? error.message : 'error desconocido');
    process.exitCode = 1;
  });
}

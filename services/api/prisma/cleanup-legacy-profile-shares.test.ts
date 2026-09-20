/**
 * Guardas del script de limpieza de enlaces heredados.
 *
 * Lo que se defiende: la simulacion es el default, una base remota exige
 * confirmacion exacta, y el orden de borrado respeta las FK reales.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCleanupAuthorized,
  countCleanupTargets,
  describeTarget,
  parseOptions
} from './cleanup-legacy-profile-shares';

const LOCAL = 'postgresql://u:p@localhost:5432/credential_intelligence';
const REMOTE = 'postgresql://u:p@ep-algo.neon.tech/neondb?sslmode=require';

test('el destino se describe sin credenciales', () => {
  const target = describeTarget(REMOTE);
  assert.equal(target.host, 'ep-algo.neon.tech:5432');
  assert.equal(target.database, 'neondb');
  assert.equal(target.local, false);
  assert.equal(JSON.stringify(target).includes('p@'), false);
  assert.equal(describeTarget(LOCAL).local, true);
  assert.throws(() => describeTarget(undefined), /DATABASE_URL/);
});

test('la simulacion es el DEFAULT: sin --apply no se escribe', () => {
  assert.equal(parseOptions([]).apply, false);
  assert.equal(parseOptions(['--dry-run']).apply, false);
  assert.equal(parseOptions(['--apply']).apply, true);
});

test('una base local solo necesita --apply', () => {
  assert.doesNotThrow(() =>
    assertCleanupAuthorized(describeTarget(LOCAL), parseOptions(['--apply']))
  );
});

test('una base remota exige --allow-remote Y el nombre exacto', () => {
  const target = describeTarget(REMOTE);

  assert.throws(
    () => assertCleanupAuthorized(target, parseOptions(['--apply'])),
    /--allow-remote/
  );
  assert.throws(
    () => assertCleanupAuthorized(target, parseOptions(['--apply', '--allow-remote'])),
    /--confirm-database=neondb/
  );
  assert.throws(
    () =>
      assertCleanupAuthorized(
        target,
        parseOptions(['--apply', '--allow-remote', '--confirm-database=otra-base'])
      ),
    /no coincide/
  );
  assert.doesNotThrow(() =>
    assertCleanupAuthorized(
      target,
      parseOptions(['--apply', '--allow-remote', '--confirm-database=neondb'])
    )
  );
});

test('sin --apply ni siquiera se evalua la autorizacion remota', () => {
  // La simulacion puede correrse contra cualquier destino: no escribe.
  assert.doesNotThrow(() => assertCleanupAuthorized(describeTarget(REMOTE), parseOptions([])));
});

test('el conteo apunta SOLO a enlaces sin material de recuperacion', async () => {
  const queries: Array<[string, unknown]> = [];
  const counter = (name: string) => async ({ where }: { where?: unknown } = {}) => {
    queries.push([name, where]);
    return 0;
  };
  const prisma = {
    sharingGrant: {
      findMany: async ({ where }: { where: unknown }) => {
        queries.push(['sharingGrant.findMany', where]);
        return [{ id: 'grant-legacy' }];
      }
    },
    verificationRun: {
      findMany: async ({ where }: { where: unknown }) => {
        queries.push(['verificationRun.findMany', where]);
        return [{ id: 'run-1' }];
      }
    },
    shareVerificationPolicy: {
      findMany: async ({ where }: { where: unknown }) => {
        queries.push(['policy.findMany', where]);
        return [{ id: 'policy-1' }];
      }
    },
    verificationRequest: { count: counter('request') },
    verificationRunInventoryItem: { count: counter('inventory') },
    verificationProposalAttempt: { count: counter('attempt') },
    shareVerificationCredentialAuthorization: { count: counter('authorization') },
    verificationExecutionLease: { count: counter('lease') },
    verificationEvent: { count: counter('event') }
  };

  const counts = await countCleanupTargets(prisma as never);

  assert.deepEqual(queries[0], ['sharingGrant.findMany', { tokenRecovery: null }]);
  assert.equal(counts.legacyShares, 1);
  assert.equal(counts.verificationRuns, 1);
  // Todo lo demas se acota a los enlaces objetivo, nunca a la tabla entera.
  for (const [name, where] of queries.slice(1)) {
    assert.ok(where !== undefined && where !== null, name);
    assert.equal(JSON.stringify(where).includes('in'), true, name);
  }
});

test('el script nunca borra credenciales, evidencia ni analisis', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'cleanup-legacy-profile-shares.ts'),
    'utf8'
  ) as string;
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  for (const forbidden of [
    'credential.delete',
    'documentEvidence.delete',
    'textEvidence.delete',
    'analysisRun.delete',
    'analysisRunSource.delete',
    'objective.delete',
    'reasoningRun.delete',
    'user.delete',
    'issuer.delete',
    'verificationEvent.delete'
  ]) {
    assert.equal(code.includes(forbidden), false, forbidden);
  }

  // Solo dos borrados, y en el orden que exigen las FK RESTRICT.
  const deletions = [...code.matchAll(/tx\.(\w+)\.deleteMany/g)].map((match) => match[1]);
  assert.deepEqual(deletions, ['verificationRun', 'sharingGrant']);
  // Y ocurren dentro de una transaccion.
  assert.ok(code.includes('prisma.$transaction'));
});

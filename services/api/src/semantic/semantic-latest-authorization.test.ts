/**
 * `GET /credentials/:id/semantic-analysis/latest` — autorizacion y allowlist.
 * F1.5 §12 y §13.
 *
 * EL HUECO HISTORICO, comprobado sobre el codigo actual antes de tocarlo:
 *
 *   - `SemanticController` era el UNICO controller sin `@UseGuards(AuthGuard)`
 *     que no lo declaraba a proposito (`auth/register` y el DID document si lo
 *     documentan);
 *   - `getLatestForCredential` solo comprobaba que la credencial EXISTIERA;
 *   - la respuesta incluia `analysisJson` —el artifact crudo del pipeline—,
 *     `textForEmbedding` y `evidenceMap`.
 *
 *   => conocer un `credentialId` bastaba para leer el analisis completo.
 *
 * DECISION DE TEST: `IssuersService` es el SERVICIO REAL, con Prisma falso. Un
 * doble que devuelva "autorizado" convertiria estos tests en afirmaciones sobre
 * el mock. Aca se ejercita la semantica de membresia de verdad: rol, estado de la
 * membresia y estado de autorizacion del issuer.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { IssuersService } from '../issuers/issuers.service';
import { SemanticService } from './semantic.service';

const USER_ID = 'user-1';
const CREDENTIAL_ID = 'cred-1';
const ISSUER_ID = 'issuer-1';
const OTHER_ISSUER_ID = 'issuer-2';

/** Fila de analisis completa, tal como vive en la base. */
const STORED_ROW = {
  id: 'semantic-1',
  credentialId: CREDENTIAL_ID,
  schemaVersion: 'semantic_analysis_v1',
  status: 'completed',
  pipelineVersion: 'unversioned_current',
  taxonomyVersion: 'unversioned_current',
  confidence: { toString: () => '0.9100' },
  areas: [{ id: 'area-1', label: 'Contenedores', confidence: 0.9 }],
  skills: [],
  concepts: [],
  qualityFlags: ['semantic_quality_high'],
  // Las tres columnas sensibles. Si el select o el mapper las dejaran pasar,
  // estos valores apareceran en la respuesta y los tests lo veran.
  evidenceMap: { 'area-1': ['fragmento sensible del documento'] },
  textForEmbedding: 'TEXTO_DERIVADO_DE_LA_FUENTE_SENSIBLE',
  analysisJson: { sourceRefs: { documentId: 'doc-1' }, raw: 'ARTIFACT_CRUDO_IA' },
  analyzedAt: new Date('2026-08-30T10:00:00.000Z')
};

interface SetupOptions {
  credential?: { id: string; issuerId: string } | null;
  membership?: Record<string, unknown> | null;
  analysisRow?: Record<string, unknown> | null;
}

function setup(options: SetupOptions = {}) {
  const calls = {
    membershipLookups: [] as Array<Record<string, unknown>>,
    analysisSelects: [] as Array<Record<string, unknown>>
  };

  const credential =
    options.credential === undefined
      ? { id: CREDENTIAL_ID, issuerId: ISSUER_ID }
      : options.credential;

  const membership =
    options.membership === undefined
      ? {
          id: 'membership-1',
          userId: USER_ID,
          issuerId: ISSUER_ID,
          role: 'operator',
          status: 'active',
          issuer: { authorizationStatus: 'authorized' }
        }
      : options.membership;

  const prisma = {
    credential: {
      async findUnique() {
        return credential;
      }
    },
    issuerMembership: {
      async findUnique(args: Record<string, unknown>) {
        calls.membershipLookups.push(args);
        // Solo hay membresia para el par exacto (userId, issuerId) declarado.
        const where = (args.where as { userId_issuerId: { userId: string; issuerId: string } })
          .userId_issuerId;
        if (
          !membership ||
          where.userId !== membership.userId ||
          where.issuerId !== membership.issuerId
        ) {
          return null;
        }
        return membership;
      }
    },
    semanticAnalysis: {
      async findFirst(args: Record<string, unknown>) {
        calls.analysisSelects.push(args);
        if (options.analysisRow === null) return null;
        const requested = Object.keys((args.select as object) ?? {});
        // Prisma devuelve SOLO las columnas pedidas. El falso lo respeta: si no
        // lo hiciera, un select roto pasaria inadvertido.
        const row = options.analysisRow ?? STORED_ROW;
        return Object.fromEntries(
          requested.map((key) => [key, (row as Record<string, unknown>)[key]])
        );
      }
    }
  } as never;

  const service = new SemanticService(prisma, new IssuersService(prisma));
  return { calls, service };
}

// ---------------------------------------------------------------------------
// §12 — Autorizacion
// ---------------------------------------------------------------------------

test('authz: an authorized issuer member reads the latest analysis', async () => {
  const { service, calls } = setup();

  const response = await service.getLatestForCredential(CREDENTIAL_ID, USER_ID);

  assert.equal(response.credentialId, CREDENTIAL_ID);
  assert.equal(response.latestSemanticAnalysis?.id, 'semantic-1');
  // El issuer comprobado sale de la CREDENCIAL, no de un parametro del llamador.
  assert.deepEqual(
    (calls.membershipLookups[0].where as Record<string, unknown>).userId_issuerId,
    { userId: USER_ID, issuerId: ISSUER_ID }
  );
});

test('authz: an authenticated user with no membership is rejected', async () => {
  const { service, calls } = setup({ membership: null });

  await assert.rejects(
    () => service.getLatestForCredential(CREDENTIAL_ID, USER_ID),
    ForbiddenException
  );
  assert.equal(calls.analysisSelects.length, 0, 'no se consulta el analisis');
});

test('authz: cross-issuer access is rejected', async () => {
  // El usuario es miembro activo de OTRO issuer. Antes de F1.5 esto bastaba,
  // porque no se comprobaba nada.
  const { service, calls } = setup({
    membership: {
      id: 'membership-2',
      userId: USER_ID,
      issuerId: OTHER_ISSUER_ID,
      role: 'admin',
      status: 'active',
      issuer: { authorizationStatus: 'authorized' }
    }
  });

  await assert.rejects(
    () => service.getLatestForCredential(CREDENTIAL_ID, USER_ID),
    ForbiddenException
  );
  assert.equal(calls.analysisSelects.length, 0);
});

test('authz: a membership that is not active is rejected', async () => {
  const { service } = setup({
    membership: {
      id: 'membership-1',
      userId: USER_ID,
      issuerId: ISSUER_ID,
      role: 'admin',
      status: 'pending',
      issuer: { authorizationStatus: 'authorized' }
    }
  });

  await assert.rejects(
    () => service.getLatestForCredential(CREDENTIAL_ID, USER_ID),
    ForbiddenException
  );
});

test('authz: the viewer role is rejected, as on every other issuer read', async () => {
  const { service } = setup({
    membership: {
      id: 'membership-1',
      userId: USER_ID,
      issuerId: ISSUER_ID,
      role: 'viewer',
      status: 'active',
      issuer: { authorizationStatus: 'authorized' }
    }
  });

  await assert.rejects(
    () => service.getLatestForCredential(CREDENTIAL_ID, USER_ID),
    ForbiddenException
  );
});

test('authz: an issuer that is not authorized is rejected', async () => {
  const { service } = setup({
    membership: {
      id: 'membership-1',
      userId: USER_ID,
      issuerId: ISSUER_ID,
      role: 'admin',
      status: 'active',
      issuer: { authorizationStatus: 'revoked' }
    }
  });

  await assert.rejects(
    () => service.getLatestForCredential(CREDENTIAL_ID, USER_ID),
    ForbiddenException
  );
});

test('authz: a missing credential is not-found, and discloses nothing else', async () => {
  const { service, calls } = setup({ credential: null });

  const error = await service
    .getLatestForCredential('cred-inexistente', USER_ID)
    .then(
      () => {
        throw new assert.AssertionError({ message: 'se esperaba NotFound' });
      },
      (caught: unknown) => caught
    );

  assert.ok(error instanceof NotFoundException);
  assert.equal(calls.membershipLookups.length, 0);
  assert.equal(calls.analysisSelects.length, 0);
  // El mensaje solo repite el id que el llamador ya conocia.
  assert.ok(!JSON.stringify(error.getResponse()).includes(ISSUER_ID));
});

test('authz: a credential with no analysis still requires authority first', async () => {
  const { service, calls } = setup({ membership: null, analysisRow: null });

  await assert.rejects(
    () => service.getLatestForCredential(CREDENTIAL_ID, USER_ID),
    ForbiddenException
  );
  // No se distingue "sin analisis" de "sin permiso": el no autorizado no puede
  // usar la ruta para saber si una credencial fue analizada.
  assert.equal(calls.analysisSelects.length, 0);
});

test('authz: the userId is required and never defaulted', async () => {
  const { service } = setup();
  await assert.rejects(() =>
    service.getLatestForCredential(CREDENTIAL_ID, '   ')
  );
});

// ---------------------------------------------------------------------------
// §13 — Allowlist de respuesta
// ---------------------------------------------------------------------------

const FORBIDDEN_RESPONSE_FIELDS = [
  'analysisJson',
  'textForEmbedding',
  'evidenceMap',
  'credentialId',
  'extractionArtifactCanonicalJson',
  'artifactBlobSha256',
  'extractionDerivationTrust',
  'canonicalText',
  'exactExcerpt',
  'segments',
  'pages',
  'diagnostics',
  'storageKey'
] as const;

test('allowlist: the response item has exactly the eleven allowed keys', async () => {
  const { service } = setup();
  const response = await service.getLatestForCredential(CREDENTIAL_ID, USER_ID);
  const item = response.latestSemanticAnalysis as unknown as Record<string, unknown>;

  assert.deepEqual(Object.keys(item).sort(), [
    'analyzedAt',
    'areas',
    'concepts',
    'confidence',
    'id',
    'pipelineVersion',
    'qualityFlags',
    'schemaVersion',
    'skills',
    'status',
    'taxonomyVersion'
  ]);
  assert.deepEqual(Object.keys(response).sort(), [
    'credentialId',
    'latestSemanticAnalysis'
  ]);
});

test('allowlist: no forbidden key appears on the analysis item', async () => {
  const { service } = setup();
  const response = await service.getLatestForCredential(CREDENTIAL_ID, USER_ID);
  const item = response.latestSemanticAnalysis as unknown as Record<string, unknown>;

  for (const field of FORBIDDEN_RESPONSE_FIELDS) {
    assert.ok(!(field in item), `${field} no debe salir en la respuesta`);
  }
});

test('allowlist: the sensitive VALUES never appear anywhere in the payload', async () => {
  // Assertion sobre claves Y sobre contenido: una clave renombrada seguiria
  // filtrando el mismo material.
  const { service } = setup();
  const serialized = JSON.stringify(
    await service.getLatestForCredential(CREDENTIAL_ID, USER_ID)
  );

  for (const sensitive of [
    'TEXTO_DERIVADO_DE_LA_FUENTE_SENSIBLE',
    'ARTIFACT_CRUDO_IA',
    'fragmento sensible del documento'
  ]) {
    assert.ok(!serialized.includes(sensitive), `${sensitive} se filtro`);
  }
  // Control: lo que SI debe salir, sale.
  assert.ok(serialized.includes('Contenedores'));
});

test('allowlist: the query never even loads the sensitive columns', async () => {
  // Defensa en profundidad. La allowlist del DTO ya bastaria, pero un campo que
  // nunca sale de la base no puede filtrarlo un mapper futuro despistado.
  const { service, calls } = setup();
  await service.getLatestForCredential(CREDENTIAL_ID, USER_ID);

  const select = calls.analysisSelects[0].select as Record<string, unknown>;
  for (const column of ['analysisJson', 'textForEmbedding', 'evidenceMap']) {
    assert.ok(!(column in select), `${column} no debe pedirse en el select`);
  }
});

test('allowlist: control — the stored row really does carry the sensitive material', () => {
  // Sin este control, los tests de arriba pasarian igual con una fixture vacia.
  assert.ok(STORED_ROW.textForEmbedding.length > 0);
  assert.ok(JSON.stringify(STORED_ROW.analysisJson).includes('ARTIFACT_CRUDO_IA'));
  assert.ok(JSON.stringify(STORED_ROW.evidenceMap).includes('fragmento sensible'));
});

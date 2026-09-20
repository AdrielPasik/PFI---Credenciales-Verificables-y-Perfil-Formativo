import assert from 'node:assert/strict';
import test from 'node:test';

import { ProfileSharingService } from './profile-sharing.service';

const currentProfile = {
  id: 'profile-1',
  profileVersion: 'formative_profile_v1',
  isCurrent: true,
  credentialsCount: 1,
  totalHours: 12,
  areasSummary: [{ label: 'Gestión de proyectos', estimatedHours: 12 }],
  skillsSummary: [{ label: 'Scrum', confidence: 0.8 }],
  qualityFlags: [],
  generatedAt: '2026-08-14T00:00:00Z',
  profileJson: { concepts: ['Kanban'] }
};

test('profile sharing stores only a hash for a newly generated opaque token', async (t) => {
  // Crear exige clave de recuperacion desde el corte limpio.
  const previousKey = process.env.PROFILE_SHARE_TOKEN_KEY;
  process.env.PROFILE_SHARE_TOKEN_KEY = Buffer.alloc(32, 7).toString('base64');
  t.after(() => {
    if (previousKey === undefined) delete process.env.PROFILE_SHARE_TOKEN_KEY;
    else process.env.PROFILE_SHARE_TOKEN_KEY = previousKey;
  });

  let created: Record<string, unknown> = {};
  const service = new ProfileSharingService(
    { sharingGrant: { create: async ({ data }: { data: Record<string, unknown> }) => { created = data; } } } as never,
    { getCurrentForUser: async () => ({ userId: 'holder-1', currentProfile }) } as never
  );

  const response = await service.createForUser('holder-1');
  const token = response.sharePath.split('/').at(-1)!;

  assert.match(response.sharePath, /^\/share\/profile\/[A-Za-z0-9_-]{32,200}$/);
  assert.equal(created.profileId, 'profile-1');
  assert.equal(created.tokenHash === token, false);
  assert.match(created.tokenHash as string, /^[a-f0-9]{64}$/);
  assert.equal(created.scope, 'profile');
});

test('public profile sharing is allowlisted, bounded and excludes email and raw profile artifacts', async () => {
  const token = 'a'.repeat(43);
  const service = new ProfileSharingService(
    {
      sharingGrant: {
        findUnique: async () => ({
          scope: 'profile', expiresAt: null, revokedAt: null, userId: 'holder-1',
          user: { displayName: 'Holder Demo', firstName: null, lastName: null },
          profile: { ...currentProfile, userId: 'holder-1', totalHours: { toString: () => '12' }, generatedAt: new Date(currentProfile.generatedAt) }
        })
      },
      credential: {
        findMany: async () => [{ id: 'credential-1', title: 'Curso ágil', type: 'course', issuedAt: new Date(currentProfile.generatedAt), issuer: { name: 'Institución Demo' } }]
      }
    } as never,
    {} as never
  );

  const response = await service.getPublicProfile(token);
  const serialized = JSON.stringify(response);

  assert.equal(response.holder.displayLabel, 'Holder Demo');
  assert.equal(response.profile.areas.length, 1);
  assert.equal(response.credentials[0]?.credentialReference, 'credential-1');
  assert.equal(serialized.includes('email'), false);
  assert.equal(serialized.includes('profileJson'), false);
  assert.equal(serialized.includes('analysisJson'), false);
  assert.equal(serialized.includes('sourceRefs'), false);
});

// C5b.2: regresion critica (seccion 13/19 del diseno). El perfil interno
// puede traer provenanceSummary/sources por area/skill (C5b.1) -- el
// remapeo publico (allowlist explicita, ver profile-sharing.service.ts)
// nunca debe propagarlos, incluso si el holder mapper los agrega. Corre el
// pipeline REAL (mapHolderCurrentProfileResponse incluido), no un mock del
// mapper, para que este test detecte una regresion futura de verdad.
test('C5b.2: public profile never leaks provenanceSummary, sources or internal interpretation ids', async () => {
  const token = 'b'.repeat(43);
  const profileWithProvenance = {
    ...currentProfile,
    areasSummary: [
      {
        area: 'Gestión de proyectos',
        estimatedHours: 12,
        sources: [
          { credentialId: 'credential-must-not-leak', provenance: 'issuer_reviewed', reusableInterpretationId: 'rsi-must-not-leak' },
          { credentialId: 'credential-2-must-not-leak', provenance: 'ai_inferred', semanticAnalysisId: 'sa-must-not-leak' }
        ],
        provenanceSummary: { issuerReviewedCount: 1, aiInferredCount: 1 }
      }
    ],
    skillsSummary: [
      {
        skill: 'Scrum',
        confidence: 0.8,
        sources: [{ credentialId: 'credential-must-not-leak', provenance: 'issuer_reviewed', reusableInterpretationId: 'rsi-must-not-leak' }],
        provenanceSummary: { issuerReviewedCount: 1, aiInferredCount: 0 }
      }
    ]
  };
  const service = new ProfileSharingService(
    {
      sharingGrant: {
        findUnique: async () => ({
          scope: 'profile', expiresAt: null, revokedAt: null, userId: 'holder-1',
          user: { displayName: 'Holder Demo', firstName: null, lastName: null },
          profile: { ...profileWithProvenance, userId: 'holder-1', totalHours: { toString: () => '12' }, generatedAt: new Date(currentProfile.generatedAt) }
        })
      },
      credential: { findMany: async () => [] }
    } as never,
    {} as never
  );

  const response = await service.getPublicProfile(token);
  const serialized = JSON.stringify(response);

  assert.deepEqual(response.profile.areas, [{ label: 'Gestión de proyectos', estimatedHours: 12 }]);
  assert.deepEqual(response.profile.skills, [{ label: 'Scrum', confidence: 0.8 }]);
  for (const forbidden of [
    'provenanceSummary', 'issuerReviewedCount', 'aiInferredCount', 'sources',
    'reusableInterpretationId', 'semanticAnalysisId', 'credential-must-not-leak',
    'credential-2-must-not-leak', 'rsi-must-not-leak', 'sa-must-not-leak', 'issuer_reviewed', 'ai_inferred'
  ]) {
    assert.equal(serialized.includes(forbidden), false, `public response must not contain "${forbidden}"`);
  }
});

test('revoked, expired or malformed profile share tokens return the same safe not-found error', async () => {
  const service = new ProfileSharingService(
    { sharingGrant: { findUnique: async () => ({ scope: 'profile', expiresAt: null, revokedAt: new Date(), user: null, profile: null }) } } as never,
    {} as never
  );

  await assert.rejects(() => service.getPublicProfile('a'.repeat(43)), /No encontramos un perfil compartido disponible/);
  await assert.rejects(() => service.getPublicProfile('invalid'), /No encontramos un perfil compartido disponible/);
});

test('a grant cannot expose a profile belonging to another holder', async () => {
  const service = new ProfileSharingService(
    {
      sharingGrant: {
        findUnique: async () => ({
          scope: 'profile', expiresAt: null, revokedAt: null, userId: 'holder-1',
          user: { displayName: 'Holder', firstName: null, lastName: null },
          profile: { ...currentProfile, userId: 'holder-2', totalHours: { toString: () => '12' }, generatedAt: new Date(currentProfile.generatedAt) }
        })
      }
    } as never,
    {} as never
  );

  await assert.rejects(() => service.getPublicProfile('a'.repeat(43)), /No encontramos un perfil compartido disponible/);
});

// ---------------------------------------------------------------------------
// Ciclo de vida del enlace y consentimiento de computo
// ---------------------------------------------------------------------------

const CRED = {
  id: 'credential-1',
  title: 'Curso ágil',
  type: 'course',
  issuedAt: new Date(),
  issuer: { name: 'Institución Demo' }
};

/** Prisma falso para el lector publico, con politica configurable. */
function publicPrisma(grantOverrides: Record<string, unknown>, issuedAuthorizedCount = 0) {
  const counted: Record<string, unknown>[] = [];
  return {
    counted,
    prisma: {
      sharingGrant: {
        findUnique: async () => ({
          scope: 'profile',
          expiresAt: null,
          revokedAt: null,
          userId: 'holder-1',
          verificationPolicy: null,
          user: { displayName: 'Holder Demo', firstName: null, lastName: null },
          profile: {
            ...currentProfile,
            userId: 'holder-1',
            totalHours: { toString: () => '12' },
            generatedAt: new Date(currentProfile.generatedAt)
          },
          ...grantOverrides
        })
      },
      credential: {
        findMany: async () => [CRED],
        count: async ({ where }: { where: Record<string, unknown> }) => {
          counted.push(where);
          return issuedAuthorizedCount;
        }
      }
    } as never
  };
}

const TOKEN = 'c'.repeat(43);

test('sin politica, el perfil publico declara la verificacion contextual deshabilitada', async () => {
  // El default de TODO grant preexistente: compartir el perfil nunca significo
  // autorizar razonamiento de terceros.
  const { prisma } = publicPrisma({});
  const response = await new ProfileSharingService(prisma, {} as never).getPublicProfile(TOKEN);
  assert.equal(response.contextualVerificationEnabled, false);
});

test('una politica deshabilitada tampoco habilita', async () => {
  const { prisma } = publicPrisma(
    { verificationPolicy: { enabled: false, authorizedCredentials: [{ credentialId: 'credential-1' }] } },
    1
  );
  const response = await new ProfileSharingService(prisma, {} as never).getPublicProfile(TOKEN);
  assert.equal(response.contextualVerificationEnabled, false);
});

test('una politica habilitada sin credenciales autorizadas no habilita', async () => {
  const { prisma } = publicPrisma({
    verificationPolicy: { enabled: true, authorizedCredentials: [] }
  });
  const response = await new ProfileSharingService(prisma, {} as never).getPublicProfile(TOKEN);
  assert.equal(response.contextualVerificationEnabled, false);
});

test('enlace activo + politica habilitada + evidencia vigente habilita', async () => {
  const { prisma } = publicPrisma(
    { verificationPolicy: { enabled: true, authorizedCredentials: [{ credentialId: 'credential-1' }] } },
    1
  );
  const response = await new ProfileSharingService(prisma, {} as never).getPublicProfile(TOKEN);
  assert.equal(response.contextualVerificationEnabled, true);
});

test('si todas las credenciales autorizadas dejaron de estar emitidas, deja de habilitar', async () => {
  // El consentimiento sigue guardado; lo que falta es evidencia utilizable.
  const { prisma } = publicPrisma(
    { verificationPolicy: { enabled: true, authorizedCredentials: [{ credentialId: 'credential-1' }] } },
    0
  );
  const response = await new ProfileSharingService(prisma, {} as never).getPublicProfile(TOKEN);
  assert.equal(response.contextualVerificationEnabled, false);
});

test('la elegibilidad se cuenta contra la base, no contra las 10 tarjetas visibles', async () => {
  // El perfil publico muestra `take: 10` por PRESENTACION. El holder puede haber
  // autorizado una credencial que no esta entre esas tarjetas, y eso no puede
  // invalidar su consentimiento.
  const { prisma, counted } = publicPrisma(
    { verificationPolicy: { enabled: true, authorizedCredentials: [{ credentialId: 'fuera-de-las-10' }] } },
    1
  );
  await new ProfileSharingService(prisma, {} as never).getPublicProfile(TOKEN);
  const where = counted[0] as Record<string, { in: string[] }> & Record<string, unknown>;
  assert.deepEqual((where.id as { in: string[] }).in, ['fuera-de-las-10']);
  assert.equal(where.status, 'issued');
  assert.equal(where.subjectUserId, 'holder-1');
});

test('un enlace revocado no se lee aunque su politica este habilitada', async () => {
  const { prisma } = publicPrisma(
    {
      revokedAt: new Date('2026-01-01T00:00:00Z'),
      verificationPolicy: { enabled: true, authorizedCredentials: [{ credentialId: 'credential-1' }] }
    },
    1
  );
  await assert.rejects(() => new ProfileSharingService(prisma, {} as never).getPublicProfile(TOKEN));
});

test('un enlace vencido no se lee aunque su politica este habilitada', async () => {
  const { prisma } = publicPrisma(
    {
      expiresAt: new Date('2020-01-01T00:00:00Z'),
      verificationPolicy: { enabled: true, authorizedCredentials: [{ credentialId: 'credential-1' }] }
    },
    1
  );
  await assert.rejects(() => new ProfileSharingService(prisma, {} as never).getPublicProfile(TOKEN));
});

test('la respuesta publica nunca expone los ids autorizados ni la politica', async () => {
  const { prisma } = publicPrisma(
    { verificationPolicy: { enabled: true, authorizedCredentials: [{ credentialId: 'secreta-1' }] } },
    1
  );
  const response = await new ProfileSharingService(prisma, {} as never).getPublicProfile(TOKEN);
  const serialized = JSON.stringify(response);

  assert.equal(serialized.includes('secreta-1'), false);
  assert.equal(serialized.includes('policyVersion'), false);
  assert.equal(serialized.includes('authorizedCredential'), false);
  assert.equal(serialized.includes('tokenHash'), false);
  assert.equal(serialized.includes('verificationPolicy'), false);
});

// --- listado del holder ---

function listPrisma(grants: Array<Record<string, unknown>>, issuedIds: string[] = []) {
  const queries: Record<string, unknown>[] = [];
  return {
    queries,
    prisma: {
      sharingGrant: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          queries.push(where);
          return grants;
        }
      },
      credential: {
        findMany: async () => issuedIds.map((id) => ({ id }))
      }
    } as never
  };
}

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'share-1',
    scope: 'profile',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    verificationPolicy: null,
    ...overrides
  };
}

test('el listado esta acotado al holder y nunca devuelve el tokenHash', async () => {
  const { prisma, queries } = listPrisma([grantRow()]);
  const list = await new ProfileSharingService(prisma, {} as never).listForUser('holder-1');

  // El scope y el contrato nuevo van en el WHERE: no se filtra despues en memoria.
  assert.deepEqual(queries[0], { userId: 'holder-1', tokenRecovery: { not: null } });
  assert.equal(JSON.stringify(list).includes('tokenHash'), false);
  assert.deepEqual(Object.keys(list[0]).sort(), [
    'authorizedCredentialCount',
    'contextualVerificationEnabled',
    'createdAt',
    'effectiveAuthorizedCredentialCount',
    'expiresAt',
    'lastUsedAt',
    'revokedAt',
    'scope',
    'shareId',
    'status'
  ]);
});

test('el listado distingue activo, revocado y vencido', async () => {
  const { prisma } = listPrisma([
    grantRow({ id: 'a' }),
    grantRow({ id: 'b', revokedAt: new Date('2026-09-02T00:00:00Z') }),
    grantRow({ id: 'c', expiresAt: new Date('2020-01-01T00:00:00Z') })
  ]);
  const list = await new ProfileSharingService(prisma, {} as never).listForUser('holder-1');
  assert.deepEqual(
    list.map((item) => [item.shareId, item.status]),
    [
      ['a', 'ACTIVE'],
      ['b', 'REVOKED'],
      ['c', 'EXPIRED']
    ]
  );
});

test('el listado informa el permiso EFECTIVO, no solo el flag guardado', async () => {
  // Un enlace revocado con politica habilitada NO puede reportarse como
  // habilitado: el grant es la autoridad de orden superior.
  const policy = { enabled: true, authorizedCredentials: [{ credentialId: 'cred-a' }] };
  const { prisma } = listPrisma(
    [
      grantRow({ id: 'activo', verificationPolicy: policy }),
      grantRow({ id: 'revocado', revokedAt: new Date(), verificationPolicy: policy })
    ],
    ['cred-a']
  );
  const list = await new ProfileSharingService(prisma, {} as never).listForUser('holder-1');
  assert.deepEqual(
    list.map((item) => [item.shareId, item.contextualVerificationEnabled]),
    [
      ['activo', true],
      ['revocado', false]
    ]
  );
});

test('el listado separa lo consentido de lo todavia utilizable', async () => {
  // Que los dos numeros difieran es la señal de que a una credencial elegida le
  // cambio el ciclo de vida. No se borra el consentimiento por eso.
  const { prisma } = listPrisma(
    [
      grantRow({
        verificationPolicy: {
          enabled: true,
          authorizedCredentials: [{ credentialId: 'cred-a' }, { credentialId: 'cred-revocada' }]
        }
      })
    ],
    ['cred-a']
  );
  const list = await new ProfileSharingService(prisma, {} as never).listForUser('holder-1');
  assert.equal(list[0].authorizedCredentialCount, 2);
  assert.equal(list[0].effectiveAuthorizedCredentialCount, 1);
  assert.equal(list[0].contextualVerificationEnabled, true);
});

// --- revocacion ---

function revokePrisma(grant: Record<string, unknown> | null, afterUpdate?: Date | null) {
  const updates: Record<string, unknown>[] = [];
  let reads = 0;
  return {
    updates,
    prisma: {
      sharingGrant: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          reads += 1;
          if (!grant) return null;
          if (grant.userId !== undefined && grant.userId !== where.userId) return null;
          return reads === 1 ? grant : { revokedAt: afterUpdate ?? grant.revokedAt };
        },
        updateMany: async ({
          where,
          data
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          updates.push({ where, data });
          return { count: 1 };
        }
      }
    } as never
  };
}

test('revocar un enlace activo escribe revokedAt una sola vez', async () => {
  const { prisma, updates } = revokePrisma({ id: 'share-1', userId: 'holder-1', revokedAt: null });
  const result = await new ProfileSharingService(prisma, {} as never).revokeForUser(
    'holder-1',
    'share-1'
  );

  assert.equal(result.status, 'REVOKED');
  assert.equal(updates.length, 1);
  // Compare-and-set: solo escribe si seguia sin revocar.
  const where = updates[0].where as Record<string, unknown>;
  assert.equal(where.revokedAt, null);
  assert.equal(where.userId, 'holder-1');
});

test('revocar dos veces es idempotente y no reescribe la fecha', async () => {
  const already = new Date('2026-09-10T00:00:00Z');
  const { prisma, updates } = revokePrisma({
    id: 'share-1',
    userId: 'holder-1',
    revokedAt: already
  });
  const result = await new ProfileSharingService(prisma, {} as never).revokeForUser(
    'holder-1',
    'share-1'
  );

  assert.equal(result.status, 'REVOKED');
  assert.equal(result.revokedAt, already.toISOString());
  assert.equal(updates.length, 0, 'no vuelve a escribir');
});

test('un holder no puede revocar el enlace de otro', async () => {
  const { prisma, updates } = revokePrisma({ id: 'share-1', userId: 'holder-2', revokedAt: null });
  await assert.rejects(
    () => new ProfileSharingService(prisma, {} as never).revokeForUser('holder-1', 'share-1'),
    /No se encontro el enlace compartido/
  );
  assert.equal(updates.length, 0);
});

test('revocar un enlace inexistente no revela nada', async () => {
  const { prisma } = revokePrisma(null);
  await assert.rejects(
    () => new ProfileSharingService(prisma, {} as never).revokeForUser('holder-1', 'no-existe'),
    /No se encontro el enlace compartido/
  );
});

test('no existe reactivacion: el servicio no expone ninguna via', () => {
  // Regresion de API: si alguna vez apareciera un "reactivar", un token filtrado
  // volveria a valer.
  const methods = Object.getOwnPropertyNames(ProfileSharingService.prototype);
  for (const forbidden of ['reactivateForUser', 'unrevokeForUser', 'restoreForUser']) {
    assert.equal(methods.includes(forbidden), false, forbidden);
  }
});

// --- alcance soportado ---

test('un enlace "credential" ni siquiera produce perfil publico, asi que no puede anunciar computo', async () => {
  // El guard existente del lector ya lo rechaza antes de mirar la politica.
  const { prisma, counted } = publicPrisma(
    {
      scope: 'credential',
      verificationPolicy: { enabled: true, authorizedCredentials: [{ credentialId: 'credential-1' }] }
    },
    1
  );
  await assert.rejects(() => new ProfileSharingService(prisma, {} as never).getPublicProfile(TOKEN));
  assert.equal(counted.length, 0);
});

test('un enlace "credential_and_profile" se lee pero NO anuncia computo aunque haya politica habilitada', async () => {
  // Este SI es el caso real: el lector acepta el alcance para mostrar el perfil,
  // y ahi una politica habilitada con evidencia vigente -- estado heredado o
  // inconsistente -- podria anunciar un analisis que el VerificationRun rechaza.
  const { prisma, counted } = publicPrisma(
    {
      scope: 'credential_and_profile',
      verificationPolicy: { enabled: true, authorizedCredentials: [{ credentialId: 'credential-1' }] }
    },
    1
  );
  const response = await new ProfileSharingService(prisma, {} as never).getPublicProfile(TOKEN);
  assert.equal(response.contextualVerificationEnabled, false);
  assert.equal(counted.length, 0, 'ni siquiera consulta la evidencia');
});

for (const scope of ['credential', 'credential_and_profile'] as const) {
  test(`el listado del holder tampoco reporta computo para un alcance "${scope}"`, async () => {
    const { prisma } = listPrisma(
      [
        grantRow({
          scope,
          verificationPolicy: { enabled: true, authorizedCredentials: [{ credentialId: 'cred-a' }] }
        })
      ],
      ['cred-a']
    );
    const [item] = await new ProfileSharingService(prisma, {} as never).listForUser('holder-1');
    assert.equal(item.contextualVerificationEnabled, false);
  });
}

// ---------------------------------------------------------------------------
// Enlaces reutilizables: recuperacion por el DUENO — V1
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';

import {
  SHARE_TOKEN_KEY_ENV,
  openShareToken
} from './share-token-recovery';

const RECOVERY_KEY = randomBytes(32).toString('base64');

// `null` = sin clave configurada. No se usa `undefined`: seria indistinguible de
// "no pase el argumento" y el default reintroduciria la clave.
function withRecoveryKey(t: { after: (fn: () => void) => void }, key: string | null = RECOVERY_KEY) {
  const previous = process.env[SHARE_TOKEN_KEY_ENV];
  if (key === null) delete process.env[SHARE_TOKEN_KEY_ENV];
  else process.env[SHARE_TOKEN_KEY_ENV] = key;
  t.after(() => {
    if (previous === undefined) delete process.env[SHARE_TOKEN_KEY_ENV];
    else process.env[SHARE_TOKEN_KEY_ENV] = previous;
  });
}

function creatingService(sink: { data?: Record<string, unknown> }) {
  return new ProfileSharingService(
    {
      sharingGrant: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          sink.data = data;
        }
      }
    } as never,
    { getCurrentForUser: async () => ({ userId: 'holder-1', currentProfile }) } as never
  );
}

test('un enlace NUEVO guarda hash publico y material de recuperacion, nunca el token en claro', async (t) => {
  withRecoveryKey(t);
  const sink: { data?: Record<string, unknown> } = {};

  const response = await creatingService(sink).createForUser('holder-1');
  const token = response.sharePath.split('/').at(-1)!;
  const created = sink.data!;

  // La autoridad publica sigue siendo el hash.
  assert.match(created.tokenHash as string, /^[a-f0-9]{64}$/);
  // Y ahora ademas hay sobre recuperable, atado a esta fila y a este dueno.
  const envelope = created.tokenRecovery as string;
  assert.match(envelope, /^v1\./);
  assert.equal(
    openShareToken(envelope, { sharingGrantId: created.id as string, userId: 'holder-1' }),
    token
  );

  // El token en claro no aparece en NINGUNA columna persistida.
  assert.equal(JSON.stringify(created).includes(token), false);
});

test('INVARIANTE: sin clave valida NO se crea el enlace y no se persiste nada', async (t) => {
  // El corte limpio: no existe un camino que deje `tokenHash` sin
  // `tokenRecovery`. Un enlace irrecuperable es justo el defecto que se elimino.
  for (const key of [null, 'no-es-base64-valida!!', 'aa'.repeat(8), 'zz'.repeat(32)]) {
    withRecoveryKey(t, key);
    const sink: { data?: Record<string, unknown> } = {};

    await assert.rejects(
      () => creatingService(sink).createForUser('holder-1'),
      (error: unknown) => {
        const message = String((error as { message?: unknown }).message ?? '');
        assert.match(message, /No podemos crear enlaces compartidos/);
        // El error no nombra la variable de entorno ni nada de la clave.
        assert.equal(message.includes('PROFILE_SHARE_TOKEN_KEY'), false);
        return true;
      },
      String(key)
    );
    assert.equal(sink.data, undefined, `no se persistio nada con la clave ${String(key)}`);
  }
});

test('INVARIANTE: toda creacion exitosa deja material recuperable por su dueno', async (t) => {
  withRecoveryKey(t);
  const sink: { data?: Record<string, unknown> } = {};

  const response = await creatingService(sink).createForUser('holder-1');
  const created = sink.data!;

  assert.notEqual(created.tokenHash, undefined);
  assert.notEqual(created.tokenRecovery, null);
  assert.notEqual(created.tokenRecovery, undefined);
  // Y ese material abre, con el contexto de ESTA fila.
  assert.equal(
    openShareToken(created.tokenRecovery as string, {
      sharingGrantId: created.id as string,
      userId: 'holder-1'
    }),
    response.sharePath.split('/').at(-1)
  );
});

test('el listado del holder pide SOLO enlaces del contrato nuevo', async () => {
  const queries: Record<string, unknown>[] = [];
  const service = new ProfileSharingService(
    {
      sharingGrant: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          queries.push(where);
          return [];
        }
      },
      credential: { findMany: async () => [] }
    } as never,
    {} as never
  );

  await service.listForUser('holder-1');

  // El filtro es de la CONSULTA: una fila heredada no se trae para esconderla.
  assert.deepEqual(queries[0], { userId: 'holder-1', tokenRecovery: { not: null } });
});

function recoveringService(grant: Record<string, unknown> | null, seen: Record<string, unknown>[] = []) {
  return new ProfileSharingService(
    {
      sharingGrant: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          seen.push(where);
          return grant;
        }
      }
    } as never,
    {} as never
  );
}

async function recoveredLink(t: Parameters<typeof withRecoveryKey>[0], options: {
  userId?: string;
  origin?: string;
} = {}) {
  withRecoveryKey(t);
  const sink: { data?: Record<string, unknown> } = {};
  await creatingService(sink).createForUser('holder-1');
  const created = sink.data!;

  const previousOrigin = process.env.WEB_ORIGIN;
  if (options.origin === undefined) delete process.env.WEB_ORIGIN;
  else process.env.WEB_ORIGIN = options.origin;
  t.after(() => {
    if (previousOrigin === undefined) delete process.env.WEB_ORIGIN;
    else process.env.WEB_ORIGIN = previousOrigin;
  });

  const service = recoveringService({
    id: created.id,
    tokenRecovery: created.tokenRecovery,
    revokedAt: null
  });
  return { link: await service.recoverLinkForUser(options.userId ?? 'holder-1', created.id as string), created };
}

test('el DUENO recupera una URL utilizable, armada con el origen configurado', async (t) => {
  const { link, created } = await recoveredLink(t, { origin: 'https://scope.example.com' });

  assert.equal(link.shareUrl, `https://scope.example.com${link.sharePath}`);
  assert.match(link.sharePath, /^\/share\/profile\/[A-Za-z0-9_%-]+$/);
  // La respuesta no lleva el sobre ni el hash.
  const serialized = JSON.stringify(link);
  assert.equal(serialized.includes(created.tokenRecovery as string), false);
  assert.equal(serialized.includes(created.tokenHash as string), false);
  assert.deepEqual(Object.keys(link).sort(), ['sharePath', 'shareUrl']);
});

test('sin origen configurado devuelve la ruta relativa, no una URL inventada', async (t) => {
  const { link } = await recoveredLink(t, { origin: undefined });
  assert.equal(link.shareUrl, null);
  assert.match(link.sharePath, /^\/share\/profile\//);
});

test('la busqueda de recuperacion acota el dueno en el WHERE', async (t) => {
  withRecoveryKey(t);
  const seen: Record<string, unknown>[] = [];
  const service = recoveringService(null, seen);

  await assert.rejects(() => service.recoverLinkForUser('holder-1', 'grant-ajeno'));
  assert.deepEqual(seen[0], { id: 'grant-ajeno', userId: 'holder-1' });
});

test('un enlace ajeno o inexistente responde igual: no se confirma que exista', async (t) => {
  withRecoveryKey(t);
  await assert.rejects(
    () => recoveringService(null).recoverLinkForUser('holder-2', 'grant-1'),
    /No se encontro el enlace compartido solicitado\./
  );
});

test('un enlace revocado ya no se entrega', async (t) => {
  withRecoveryKey(t);
  const sink: { data?: Record<string, unknown> } = {};
  await creatingService(sink).createForUser('holder-1');
  const created = sink.data!;

  const service = recoveringService({
    id: created.id,
    tokenRecovery: created.tokenRecovery,
    revokedAt: new Date()
  });
  await assert.rejects(() => service.recoverLinkForUser('holder-1', created.id as string));
});

test('material corrupto falla CERRADO: sin hash, sin URL inventada y sin revocar nada', async (t) => {
  withRecoveryKey(t);
  const service = recoveringService({
    id: 'grant-1',
    tokenRecovery: 'v1.AAAA.BBBB',
    revokedAt: null
  });

  await assert.rejects(
    () => service.recoverLinkForUser('holder-1', 'grant-1'),
    (error: unknown) => {
      const message = String((error as { message?: unknown }).message ?? '');
      assert.match(message, /No pudimos recuperar este enlace/);
      assert.equal(message.includes('v1.'), false);
      return true;
    }
  );
});

test('una fila sin material de recuperacion no fabrica un enlace', async (t) => {
  withRecoveryKey(t);
  const service = recoveringService({ id: 'grant-1', tokenRecovery: null, revokedAt: null });
  await assert.rejects(() => service.recoverLinkForUser('holder-1', 'grant-1'));
});

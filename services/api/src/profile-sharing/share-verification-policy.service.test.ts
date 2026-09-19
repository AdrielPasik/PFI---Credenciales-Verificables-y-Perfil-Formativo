/**
 * Consentimiento de computo del holder.
 *
 * Lo que estos tests defienden: un SharingGrant activo autoriza LEER el perfil
 * publico y nada mas. Que un tercero pueda disparar razonamiento sobre la
 * evidencia exige una eleccion deliberada del holder, credencial por credencial,
 * y esa eleccion puede retirarse.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ShareVerificationPolicyService } from './share-verification-policy.service';
import { ShareVerificationPolicyError } from './share-verification-policy.error';

const HOLDER = 'holder-1';
const SHARE = 'share-1';

interface GrantRow {
  id: string;
  userId: string;
  scope: 'profile' | 'credential' | 'credential_and_profile';
  expiresAt: Date | null;
  revokedAt: Date | null;
  verificationPolicy: {
    id: string;
    enabled: boolean;
    policyVersion: number;
    updatedAt: Date;
    authorizedCredentials: Array<{ credentialId: string }>;
  } | null;
}

interface CredentialRow {
  id: string;
  subjectUserId: string;
  status: 'draft' | 'issued' | 'revoked';
}

interface Writes {
  created: Record<string, unknown>[];
  updated: Record<string, unknown>[];
  deleted: Record<string, unknown>[];
  authorized: string[];
  transactions: number;
}

function fakePrisma(grant: GrantRow | null, credentials: CredentialRow[]) {
  const writes: Writes = { created: [], updated: [], deleted: [], authorized: [], transactions: 0 };

  const authorizations = {
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      writes.deleted.push(where);
      return { count: 0 };
    },
    createMany: async ({ data }: { data: Array<{ credentialId: string }> }) => {
      writes.authorized.push(...data.map((row) => row.credentialId));
      return { count: data.length };
    }
  };

  const policy = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      writes.created.push(data);
      return { id: 'policy-new', enabled: data.enabled, policyVersion: 1, updatedAt: new Date(0) };
    },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      writes.updated.push(data);
      return {
        id: grant?.verificationPolicy?.id ?? 'policy-1',
        enabled: data.enabled as boolean,
        policyVersion: (grant?.verificationPolicy?.policyVersion ?? 0) + 1,
        updatedAt: new Date(0)
      };
    }
  };

  const client = {
    sharingGrant: {
      findFirst: async ({ where }: { where: { id: string; userId: string } }) =>
        grant && grant.id === where.id && grant.userId === where.userId ? grant : null
    },
    credential: {
      // Reproduce el filtro real: id IN + dueño + issued. Un id ajeno o no
      // emitido simplemente no vuelve, que es como el servicio lo detecta.
      findMany: async ({ where }: { where: Record<string, any> }) =>
        credentials
          .filter(
            (credential) =>
              where.id.in.includes(credential.id) &&
              credential.subjectUserId === where.subjectUserId &&
              credential.status === where.status
          )
          .map((credential) => ({ id: credential.id }))
    },
    shareVerificationPolicy: policy,
    shareVerificationCredentialAuthorization: authorizations,
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      writes.transactions += 1;
      return run(client);
    }
  };

  return { prisma: client as never, writes };
}

function grantWith(policy: GrantRow['verificationPolicy'], overrides: Partial<GrantRow> = {}): GrantRow {
  return {
    id: SHARE,
    userId: HOLDER,
    scope: 'profile',
    expiresAt: null,
    revokedAt: null,
    verificationPolicy: policy,
    ...overrides
  };
}

const ISSUED: CredentialRow[] = [
  { id: 'cred-a', subjectUserId: HOLDER, status: 'issued' },
  { id: 'cred-b', subjectUserId: HOLDER, status: 'issued' }
];

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    assert.ok(error instanceof ShareVerificationPolicyError);
    return (error.getResponse() as { code: string }).code;
  }
  throw new Error('se esperaba un rechazo');
}

// ---------------------------------------------------------------------------
// Default y habilitacion
// ---------------------------------------------------------------------------

test('sin politica previa, habilitar crea la fila en la version 1', async () => {
  const { prisma, writes } = fakePrisma(grantWith(null), ISSUED);
  const state = await new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
    enabled: true,
    credentialIds: ['cred-a']
  });

  assert.equal(state.enabled, true);
  assert.equal(state.policyVersion, 1);
  assert.deepEqual(state.authorizedCredentialIds, ['cred-a']);
  assert.deepEqual(writes.authorized, ['cred-a']);
  assert.equal(writes.created[0]?.enabled, true);
  // Consentimiento y evidencia se escriben en la MISMA transaccion: no puede
  // quedar una politica habilitada sin su conjunto autorizado.
  assert.equal(writes.transactions, 1);
});

test('habilitar con varias credenciales conserva el conjunto completo', async () => {
  const { prisma, writes } = fakePrisma(grantWith(null), ISSUED);
  const state = await new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
    enabled: true,
    credentialIds: ['cred-a', 'cred-b']
  });

  assert.deepEqual(state.authorizedCredentialIds, ['cred-a', 'cred-b']);
  assert.deepEqual(writes.authorized, ['cred-a', 'cred-b']);
});

test('habilitar sin ninguna credencial se rechaza', async () => {
  // Un CTA publico que no puede razonar nunca es peor que ningun CTA.
  const { prisma, writes } = fakePrisma(grantWith(null), ISSUED);
  const code = await codeOf(() =>
    new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
      enabled: true,
      credentialIds: []
    })
  );

  assert.equal(code, 'CREDENTIAL_SELECTION_REQUIRED');
  assert.equal(writes.transactions, 0);
});

// ---------------------------------------------------------------------------
// Que puede autorizarse
// ---------------------------------------------------------------------------

test('una credencial de otro holder se rechaza y no escribe nada', async () => {
  const { prisma, writes } = fakePrisma(grantWith(null), [
    ...ISSUED,
    { id: 'cred-ajena', subjectUserId: 'holder-2', status: 'issued' }
  ]);
  const code = await codeOf(() =>
    new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
      enabled: true,
      credentialIds: ['cred-a', 'cred-ajena']
    })
  );

  assert.equal(code, 'CREDENTIAL_NOT_AUTHORIZABLE');
  // Todo o nada: la valida tampoco se guarda.
  assert.equal(writes.transactions, 0);
  assert.deepEqual(writes.authorized, []);
});

test('una credencial borrador se rechaza', async () => {
  const { prisma } = fakePrisma(grantWith(null), [
    { id: 'cred-draft', subjectUserId: HOLDER, status: 'draft' }
  ]);
  assert.equal(
    await codeOf(() =>
      new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
        enabled: true,
        credentialIds: ['cred-draft']
      })
    ),
    'CREDENTIAL_NOT_AUTHORIZABLE'
  );
});

test('una credencial revocada se rechaza', async () => {
  const { prisma } = fakePrisma(grantWith(null), [
    { id: 'cred-rev', subjectUserId: HOLDER, status: 'revoked' }
  ]);
  assert.equal(
    await codeOf(() =>
      new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
        enabled: true,
        credentialIds: ['cred-rev']
      })
    ),
    'CREDENTIAL_NOT_AUTHORIZABLE'
  );
});

test('una credencial inexistente se rechaza con el MISMO codigo que una ajena', async () => {
  // A proposito indistinguibles: separarlos convertiria el endpoint en un
  // oraculo de existencia sobre ids que el holder no posee.
  const { prisma } = fakePrisma(grantWith(null), ISSUED);
  assert.equal(
    await codeOf(() =>
      new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
        enabled: true,
        credentialIds: ['no-existe']
      })
    ),
    'CREDENTIAL_NOT_AUTHORIZABLE'
  );
});

// ---------------------------------------------------------------------------
// Propiedad del enlace
// ---------------------------------------------------------------------------

test('el enlace de otro holder responde como inexistente', async () => {
  const { prisma } = fakePrisma(grantWith(null, { userId: 'holder-2' }), ISSUED);
  assert.equal(
    await codeOf(() =>
      new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
        enabled: true,
        credentialIds: ['cred-a']
      })
    ),
    'SHARE_NOT_FOUND'
  );
});

test('un enlace revocado no admite configuracion', async () => {
  const { prisma } = fakePrisma(
    grantWith(null, { revokedAt: new Date('2026-01-01T00:00:00Z') }),
    ISSUED
  );
  assert.equal(
    await codeOf(() =>
      new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
        enabled: true,
        credentialIds: ['cred-a']
      })
    ),
    'SHARE_NOT_ACTIVE'
  );
});

test('un enlace vencido no admite configuracion', async () => {
  const { prisma } = fakePrisma(
    grantWith(null, { expiresAt: new Date('2020-01-01T00:00:00Z') }),
    ISSUED
  );
  assert.equal(
    await codeOf(() =>
      new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
        enabled: true,
        credentialIds: ['cred-a']
      })
    ),
    'SHARE_NOT_ACTIVE'
  );
});

// ---------------------------------------------------------------------------
// policyVersion
// ---------------------------------------------------------------------------

function existingPolicy(enabled: boolean, ids: string[], version = 3) {
  return {
    id: 'policy-1',
    enabled,
    policyVersion: version,
    updatedAt: new Date(0),
    authorizedCredentials: ids.map((credentialId) => ({ credentialId }))
  };
}

test('reenviar el estado identico no escribe ni avanza la version', async () => {
  const { prisma, writes } = fakePrisma(grantWith(existingPolicy(true, ['cred-a'])), ISSUED);
  const state = await new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
    enabled: true,
    credentialIds: ['cred-a']
  });

  assert.equal(state.policyVersion, 3);
  assert.equal(writes.transactions, 0);
  assert.deepEqual(writes.updated, []);
});

test('el mismo conjunto en otro orden sigue siendo identico', async () => {
  // Es un CONJUNTO, no una lista ordenada: reordenar no es un cambio de intencion.
  const { prisma, writes } = fakePrisma(
    grantWith(existingPolicy(true, ['cred-a', 'cred-b'])),
    ISSUED
  );
  const state = await new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
    enabled: true,
    credentialIds: ['cred-b', 'cred-a']
  });

  assert.equal(state.policyVersion, 3);
  assert.equal(writes.transactions, 0);
});

test('cambiar el conjunto de evidencia avanza la version', async () => {
  const { prisma, writes } = fakePrisma(grantWith(existingPolicy(true, ['cred-a'])), ISSUED);
  const state = await new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
    enabled: true,
    credentialIds: ['cred-a', 'cred-b']
  });

  assert.equal(state.policyVersion, 4);
  assert.equal(writes.transactions, 1);
});

test('cambiar el estado habilitado avanza la version', async () => {
  const { prisma } = fakePrisma(grantWith(existingPolicy(true, ['cred-a'])), ISSUED);
  const state = await new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
    enabled: false,
    credentialIds: ['cred-a']
  });

  assert.equal(state.enabled, false);
  assert.equal(state.policyVersion, 4);
});

const PARTIALLY_REVOKED: CredentialRow[] = [
  { id: 'cred-a', subjectUserId: HOLDER, status: 'issued' },
  { id: 'cred-b', subjectUserId: HOLDER, status: 'revoked' }
];

test('una credencial revocada DESPUES no mueve la version ni borra el consentimiento', async () => {
  // La fila se conserva: describe lo que el holder quiso cuando la credencial
  // era elegible. Lo que cambia es la elegibilidad EFECTIVA, y eso es autoridad
  // de ciclo de vida, no intencion del holder.
  const { prisma, writes } = fakePrisma(
    grantWith(existingPolicy(true, ['cred-a', 'cred-b'])),
    PARTIALLY_REVOKED
  );
  const state = await new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
    enabled: true,
    // El holder reenvia su misma seleccion, sin tocarla.
    credentialIds: ['cred-a', 'cred-b']
  });

  assert.equal(state.policyVersion, 3, 'una revocacion ajena no avanza la version');
  assert.equal(writes.transactions, 0, 'reenviar lo mismo no escribe');
  assert.deepEqual(state.authorizedCredentialIds, ['cred-a', 'cred-b'], 'consentimiento intacto');
  assert.deepEqual(
    state.effectiveAuthorizedCredentialIds,
    ['cred-a'],
    'la revocada deja de contar como evidencia efectiva'
  );
});

test('una credencial ya autorizada y luego revocada no bloquea otros cambios', async () => {
  // Solo se valida lo que se AGREGA. Si se validara todo el conjunto, el holder
  // quedaria trabado: no podria guardar ningun cambio sin desmarcar antes la
  // credencial que le revoco su emisor.
  const { prisma, writes } = fakePrisma(grantWith(existingPolicy(true, ['cred-b'])), [
    ...PARTIALLY_REVOKED
  ]);
  const state = await new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
    enabled: true,
    credentialIds: ['cred-b', 'cred-a']
  });

  assert.equal(state.policyVersion, 4);
  assert.deepEqual(writes.authorized, ['cred-b', 'cred-a']);
  assert.deepEqual(state.effectiveAuthorizedCredentialIds, ['cred-a']);
});

test('una credencial revocada NUEVA sigue siendo inautorizable', async () => {
  // El permiso del caso anterior es para CONSERVAR, nunca para incorporar.
  const { prisma } = fakePrisma(grantWith(existingPolicy(true, ['cred-a'])), PARTIALLY_REVOKED);
  assert.equal(
    await codeOf(() =>
      new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
        enabled: true,
        credentialIds: ['cred-a', 'cred-b']
      })
    ),
    'CREDENTIAL_NOT_AUTHORIZABLE'
  );
});

// ---------------------------------------------------------------------------
// Deshabilitar
// ---------------------------------------------------------------------------

test('deshabilitar conserva la seleccion del holder', async () => {
  // Decision registrada: se retiene por comodidad de UX. La autoridad efectiva
  // de computo es CERO igual, porque `enabled` manda.
  const { prisma, writes } = fakePrisma(grantWith(existingPolicy(true, ['cred-a'])), ISSUED);
  const state = await new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
    enabled: false,
    credentialIds: ['cred-a']
  });

  assert.equal(state.enabled, false);
  assert.deepEqual(state.authorizedCredentialIds, ['cred-a']);
  assert.deepEqual(writes.authorized, ['cred-a']);
});

test('deshabilitar y vaciar la seleccion tambien es valido', async () => {
  const { prisma } = fakePrisma(grantWith(existingPolicy(true, ['cred-a'])), ISSUED);
  const state = await new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
    enabled: false,
    credentialIds: []
  });

  assert.equal(state.enabled, false);
  assert.deepEqual(state.authorizedCredentialIds, []);
});

// ---------------------------------------------------------------------------
// Forma del body
// ---------------------------------------------------------------------------

for (const [label, body] of [
  ['no es objeto', 'enabled'],
  ['es arreglo', []],
  ['null', null],
  ['enabled ausente', { credentialIds: [] }],
  ['enabled no booleano', { enabled: 'true', credentialIds: [] }],
  ['credentialIds ausente', { enabled: false }],
  ['credentialIds no arreglo', { enabled: false, credentialIds: 'cred-a' }],
  ['id no string', { enabled: false, credentialIds: [1] }],
  ['id vacio', { enabled: false, credentialIds: ['   '] }],
  ['clave extra', { enabled: false, credentialIds: [], sneaky: 1 }]
] as Array<[string, unknown]>) {
  test(`body invalido: ${label}`, async () => {
    const { prisma } = fakePrisma(grantWith(null), ISSUED);
    assert.equal(
      await codeOf(() =>
        new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, body)
      ),
      'INVALID_POLICY_REQUEST'
    );
  });
}

test('ids duplicados colapsan en una sola autorizacion', async () => {
  const { prisma, writes } = fakePrisma(grantWith(null), ISSUED);
  const state = await new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
    enabled: true,
    credentialIds: ['cred-a', 'cred-a', 'cred-a']
  });

  assert.deepEqual(state.authorizedCredentialIds, ['cred-a']);
  assert.deepEqual(writes.authorized, ['cred-a']);
});

test('la respuesta no filtra estado interno de la politica', async () => {
  const { prisma } = fakePrisma(grantWith(null), ISSUED);
  const state = await new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
    enabled: true,
    credentialIds: ['cred-a']
  });

  assert.deepEqual(Object.keys(state).sort(), [
    'authorizedCredentialIds',
    'effectiveAuthorizedCredentialIds',
    'enabled',
    'policyVersion',
    'updatedAt'
  ]);
  const serialized = JSON.stringify(state);
  assert.equal(serialized.includes('policy-'), false);
  assert.equal(serialized.includes('tokenHash'), false);
  assert.equal(serialized.includes('sharingGrantId'), false);
});

// ---------------------------------------------------------------------------
// Alcance soportado
// ---------------------------------------------------------------------------

for (const scope of ['credential', 'credential_and_profile'] as const) {
  test(`un enlace de alcance "${scope}" no admite politica y no escribe nada`, async () => {
    // La MISMA allowlist que aplica el VerificationRun. Habilitar computo sobre
    // un alcance que el congelamiento rechaza seria un permiso que nunca rige.
    const { prisma, writes } = fakePrisma(grantWith(null, { scope }), ISSUED);
    assert.equal(
      await codeOf(() =>
        new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
          enabled: true,
          credentialIds: ['cred-a']
        })
      ),
      'SHARE_SCOPE_NOT_SUPPORTED'
    );
    assert.equal(writes.transactions, 0);
    assert.deepEqual(writes.created, []);
  });
}

test('un alcance futuro desconocido tampoco entra por omision', async () => {
  const { prisma, writes } = fakePrisma(
    grantWith(null, { scope: 'organization_profile' as never }),
    ISSUED
  );
  assert.equal(
    await codeOf(() =>
      new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
        enabled: false,
        credentialIds: []
      })
    ),
    'SHARE_SCOPE_NOT_SUPPORTED'
  );
  assert.equal(writes.transactions, 0);
});

test('el alcance se evalua ANTES que el estado: ni deshabilitar sobre un alcance no soportado', async () => {
  // Rechaza antes de crear o actualizar politica, sea cual sea el pedido.
  const { prisma, writes } = fakePrisma(
    grantWith(existingPolicy(true, ['cred-a']), { scope: 'credential' }),
    ISSUED
  );
  assert.equal(
    await codeOf(() =>
      new ShareVerificationPolicyService(prisma).replaceForShare(HOLDER, SHARE, {
        enabled: false,
        credentialIds: ['cred-a']
      })
    ),
    'SHARE_SCOPE_NOT_SUPPORTED'
  );
  assert.deepEqual(writes.updated, []);
});

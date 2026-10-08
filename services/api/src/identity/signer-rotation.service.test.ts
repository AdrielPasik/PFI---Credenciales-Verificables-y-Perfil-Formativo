/**
 * ROTACION DE SIGNERS -- S8c8, matrices 1-43 y A1-B5.
 *
 * Prisma es un doble en memoria con semantica real: las mutaciones se aplican
 * al estado y las lecturas posteriores las ven, asi que los invariantes se
 * prueban sobre un estado que de verdad transiciono.
 *
 * NO hay AWS, ni SSM, ni red, ni clave privada, ni Anvil, ni Base Sepolia. La
 * rotacion es una transicion de metadata PUBLICA, y eso es exactamente lo que
 * permite rotar lejos de una clave comprometida sin usarla.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IssuerTechnicalIdentityStatus,
  SignerProfilePurpose,
  SignerProfileStatus
} from '@prisma/client';

import { PUBLIC_TEST_KEY_ONE, PUBLIC_TEST_KEY_TWO } from '../signing/__fixtures__/signer-test-keys';
import { SignerRotationError } from './signer-rotation.error';
import { SignerRotationService } from './signer-rotation.service';

const ISSUER_A = 'issuer-a';
const ISSUER_B = 'issuer-b';
const ROTATION_TIME = new Date('2026-05-01T12:00:00.000Z');

interface ProfileRow {
  id: string;
  purpose: SignerProfilePurpose;
  status: SignerProfileStatus;
  keyVersion: number;
  addressVerifiedAt: Date | null;
  publicKeyX: string | null;
  publicKeyY: string | null;
  publicKeyCompressed: string | null;
  retiredAt: Date | null;
}

interface IdentityRow {
  issuerId: string;
  status: IssuerTechnicalIdentityStatus;
  assertionSignerProfileId: string;
  anchorSignerProfileId: string;
}

function assertionProfile(
  id: string,
  keyVersion: number,
  overrides: Partial<ProfileRow> = {}
): ProfileRow {
  return {
    id,
    purpose: SignerProfilePurpose.assertion,
    status: SignerProfileStatus.active,
    keyVersion,
    addressVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    publicKeyX: PUBLIC_TEST_KEY_ONE.publicKeyX,
    publicKeyY: PUBLIC_TEST_KEY_ONE.publicKeyY,
    publicKeyCompressed: PUBLIC_TEST_KEY_ONE.publicKeyCompressed,
    retiredAt: null,
    ...overrides
  };
}

function anchorProfile(
  id: string,
  overrides: Partial<ProfileRow> = {}
): ProfileRow {
  return {
    id,
    purpose: SignerProfilePurpose.anchor,
    status: SignerProfileStatus.active,
    keyVersion: 1,
    addressVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    // Un anchor no necesita metadata de asercion: S8c1 la permite en null.
    publicKeyX: null,
    publicKeyY: null,
    publicKeyCompressed: null,
    retiredAt: null,
    ...overrides
  };
}

/**
 * Mundo en memoria con semantica de Prisma.
 *
 * `$transaction` ejecuta el callback con el MISMO cliente, de modo que las
 * lecturas de la transaccion ven sus propias escrituras -- igual que en
 * PostgreSQL. El `isolationLevel` recibido se registra para poder afirmarlo.
 */
function createWorld(input: {
  profiles: ProfileRow[];
  identities: IdentityRow[];
}) {
  const profiles = new Map(input.profiles.map((p) => [p.id, { ...p }]));
  const identities = new Map(input.identities.map((i) => [i.issuerId, { ...i }]));
  const bindings: Array<{ issuerId: string; signerProfileId: string }> = [];

  const calls = {
    isolationLevels: [] as unknown[],
    profileUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
    bindingCreates: [] as Array<{ issuerId: string; signerProfileId: string }>
  };

  // Backfill del puntero vigente, igual que hace la migration.
  for (const identity of identities.values()) {
    bindings.push({
      issuerId: identity.issuerId,
      signerProfileId: identity.assertionSignerProfileId
    });
  }

  const client = {
    signerProfile: {
      async findUnique(args: { where: { id: string } }) {
        return profiles.get(args.where.id) ?? null;
      },
      async update(args: {
        where: { id: string };
        data: Record<string, unknown>;
      }) {
        const existing = profiles.get(args.where.id);
        assert.ok(existing, `perfil inexistente ${args.where.id}`);
        calls.profileUpdates.push({ id: args.where.id, data: args.data });
        profiles.set(args.where.id, { ...existing, ...args.data } as ProfileRow);
        return profiles.get(args.where.id);
      }
    },
    issuerTechnicalIdentity: {
      async findUnique(args: { where: { issuerId: string } }) {
        return identities.get(args.where.issuerId) ?? null;
      },
      async updateMany(args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) {
        const where = args.where as {
          issuerId: string;
          assertionSignerProfileId?: string;
          anchorSignerProfileId?: string;
        };
        const identity = identities.get(where.issuerId);

        if (
          !identity ||
          (where.assertionSignerProfileId !== undefined &&
            identity.assertionSignerProfileId !== where.assertionSignerProfileId) ||
          (where.anchorSignerProfileId !== undefined &&
            identity.anchorSignerProfileId !== where.anchorSignerProfileId)
        ) {
          return { count: 0 };
        }

        identities.set(where.issuerId, { ...identity, ...args.data } as IdentityRow);
        return { count: 1 };
      },
      async update(args: {
        where: { issuerId: string };
        data: Record<string, unknown>;
      }) {
        const identity = identities.get(args.where.issuerId);
        assert.ok(identity);
        identities.set(args.where.issuerId, {
          ...identity,
          ...args.data
        } as IdentityRow);
        return identities.get(args.where.issuerId);
      },
      async count(args: { where: { anchorSignerProfileId: string } }) {
        return [...identities.values()].filter(
          (identity) =>
            identity.anchorSignerProfileId === args.where.anchorSignerProfileId
        ).length;
      }
    },
    issuerAssertionKeyBinding: {
      async findUnique(args: { where: { signerProfileId: string } }) {
        return (
          bindings.find(
            (binding) => binding.signerProfileId === args.where.signerProfileId
          ) ?? null
        );
      },
      async findMany(args: { where: { issuerId: string } }) {
        return bindings
          .filter((binding) => binding.issuerId === args.where.issuerId)
          .map((binding) => ({
            signerProfile: {
              keyVersion: profiles.get(binding.signerProfileId)?.keyVersion ?? 0
            }
          }));
      },
      async create(args: {
        data: { issuerId: string; signerProfileId: string };
      }) {
        assert.ok(
          !bindings.some(
            (binding) => binding.signerProfileId === args.data.signerProfileId
          ),
          'el @unique de signerProfileId no se puede violar'
        );
        calls.bindingCreates.push({ ...args.data });
        bindings.push({ ...args.data });
        return args.data;
      }
    }
  };

  const prisma = {
    ...client,
    async $transaction(
      callback: (transaction: typeof client) => Promise<unknown>,
      options?: unknown
    ) {
      calls.isolationLevels.push(options);
      return callback(client);
    }
  };

  return {
    service: new SignerRotationService(prisma as never, {
      now: () => ROTATION_TIME
    }),
    profiles,
    identities,
    bindings,
    calls
  };
}

function expectRotationCode(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof SignerRotationError, String(error));
    assert.equal((error as SignerRotationError).code, code);
    return true;
  };
}

/** Issuer sano de una sola clave: el estado previo a cualquier rotacion. */
function healthyWorld() {
  return createWorld({
    profiles: [
      assertionProfile('assert-1', 1),
      assertionProfile('assert-2', 2),
      anchorProfile('anchor-1'),
      anchorProfile('anchor-2')
    ],
    identities: [
      {
        issuerId: ISSUER_A,
        status: IssuerTechnicalIdentityStatus.active,
        assertionSignerProfileId: 'assert-1',
        anchorSignerProfileId: 'anchor-1'
      }
    ]
  });
}

// ---------------------------------------------------------------------------
// 1, 4: EL BACKFILL Y EL BINDING VIGENTE
// ---------------------------------------------------------------------------

test('1, 4: la clave de asercion vigente esta vinculada desde el arranque', () => {
  const world = healthyWorld();

  assert.deepEqual(world.bindings, [
    { issuerId: ISSUER_A, signerProfileId: 'assert-1' }
  ]);
});

// ---------------------------------------------------------------------------
// 6-7, 22-23: ROTACION PLANIFICADA
// ---------------------------------------------------------------------------

test('6-7: rotar P1 -> P2 retira P1, mueve el puntero y conserva la historia', async () => {
  const world = healthyWorld();

  const result = await world.service.rotateAssertionSigner({
    issuerId: ISSUER_A,
    newSignerProfileId: 'assert-2'
  });

  assert.equal(result.previousProfileId, 'assert-1');
  assert.equal(result.newProfileId, 'assert-2');
  assert.equal(result.previousProfileStatus, SignerProfileStatus.retired);

  // P1 retirado, con su fecha. P2 activo y vigente.
  assert.equal(world.profiles.get('assert-1')?.status, SignerProfileStatus.retired);
  assert.equal(world.profiles.get('assert-1')?.retiredAt, ROTATION_TIME);
  assert.equal(world.profiles.get('assert-2')?.status, SignerProfileStatus.active);
  assert.equal(
    world.identities.get(ISSUER_A)?.assertionSignerProfileId,
    'assert-2'
  );

  // 7: la historia CRECE. P1 no se borra.
  assert.deepEqual(world.bindings, [
    { issuerId: ISSUER_A, signerProfileId: 'assert-1' },
    { issuerId: ISSUER_A, signerProfileId: 'assert-2' }
  ]);
});

test('11, 22: la rotacion NO edita material de clave', async () => {
  const world = healthyWorld();
  const before = { ...world.profiles.get('assert-1')! };

  await world.service.rotateAssertionSigner({
    issuerId: ISSUER_A,
    newSignerProfileId: 'assert-2'
  });

  // Lo UNICO que cambia son campos de ciclo de vida.
  for (const update of world.calls.profileUpdates) {
    assert.deepEqual(Object.keys(update.data).sort(), ['retiredAt', 'status']);
  }

  const after = world.profiles.get('assert-1')!;
  assert.equal(after.keyVersion, before.keyVersion);
  assert.equal(after.purpose, before.purpose);
  assert.equal(after.publicKeyX, before.publicKeyX);
  assert.equal(after.publicKeyY, before.publicKeyY);
  assert.equal(after.publicKeyCompressed, before.publicKeyCompressed);
});

test('23: la rotacion corre en Serializable y no hace SSM ni RPC', async () => {
  const world = healthyWorld();

  await world.service.rotateAssertionSigner({
    issuerId: ISSUER_A,
    newSignerProfileId: 'assert-2'
  });

  assert.deepEqual(world.calls.isolationLevels, [
    { isolationLevel: 'Serializable' }
  ]);
});

test('17-18: una segunda rotacion P2 -> P3 deja P1 y P2 retirados', async () => {
  const world = createWorld({
    profiles: [
      assertionProfile('assert-1', 1),
      assertionProfile('assert-2', 2),
      assertionProfile('assert-3', 3),
      anchorProfile('anchor-1')
    ],
    identities: [
      {
        issuerId: ISSUER_A,
        status: IssuerTechnicalIdentityStatus.active,
        assertionSignerProfileId: 'assert-1',
        anchorSignerProfileId: 'anchor-1'
      }
    ]
  });

  await world.service.rotateAssertionSigner({
    issuerId: ISSUER_A,
    newSignerProfileId: 'assert-2'
  });
  await world.service.rotateAssertionSigner({
    issuerId: ISSUER_A,
    newSignerProfileId: 'assert-3'
  });

  assert.equal(world.profiles.get('assert-1')?.status, SignerProfileStatus.retired);
  assert.equal(world.profiles.get('assert-2')?.status, SignerProfileStatus.retired);
  assert.equal(world.profiles.get('assert-3')?.status, SignerProfileStatus.active);
  assert.equal(
    world.identities.get(ISSUER_A)?.assertionSignerProfileId,
    'assert-3'
  );
  assert.equal(world.bindings.length, 3);
});

// ---------------------------------------------------------------------------
// 19-21: INVARIANTES DE VERSION Y EXCLUSIVIDAD
// ---------------------------------------------------------------------------

test('20: la version nueva no puede reusar ni saltear un #assert-N historico', async () => {
  for (const keyVersion of [1, 2, 4, 9, 0]) {
    const world = createWorld({
      profiles: [
        assertionProfile('assert-1', 1),
        assertionProfile('assert-2', 2),
        assertionProfile('candidate', keyVersion),
        anchorProfile('anchor-1')
      ],
      identities: [
        {
          issuerId: ISSUER_A,
          status: IssuerTechnicalIdentityStatus.active,
          assertionSignerProfileId: 'assert-1',
          anchorSignerProfileId: 'anchor-1'
        }
      ]
    });

    // La historia tiene solo `assert-1` (version 1), asi que la siguiente es 2.
    const rotation = world.service.rotateAssertionSigner({
      issuerId: ISSUER_A,
      newSignerProfileId: 'candidate'
    });

    if (keyVersion === 2) {
      await rotation;
      assert.equal(
        world.identities.get(ISSUER_A)?.assertionSignerProfileId,
        'candidate'
      );
    } else {
      await assert.rejects(
        rotation,
        expectRotationCode('NEW_PROFILE_KEY_VERSION_NOT_NEXT'),
        String(keyVersion)
      );
      // Y no se escribio nada.
      assert.equal(world.bindings.length, 1);
      assert.equal(
        world.identities.get(ISSUER_A)?.assertionSignerProfileId,
        'assert-1'
      );
    }
  }
});

test('3, 21: una clave de asercion no se puede compartir entre issuers', async () => {
  const world = createWorld({
    profiles: [
      assertionProfile('assert-1', 1),
      assertionProfile('assert-b', 1),
      assertionProfile('shared', 2),
      anchorProfile('anchor-1')
    ],
    identities: [
      {
        issuerId: ISSUER_A,
        status: IssuerTechnicalIdentityStatus.active,
        assertionSignerProfileId: 'assert-1',
        anchorSignerProfileId: 'anchor-1'
      },
      {
        issuerId: ISSUER_B,
        status: IssuerTechnicalIdentityStatus.active,
        assertionSignerProfileId: 'assert-b',
        anchorSignerProfileId: 'anchor-1'
      }
    ]
  });

  // A toma `shared`.
  await world.service.rotateAssertionSigner({
    issuerId: ISSUER_A,
    newSignerProfileId: 'shared'
  });

  // B no puede tomarla: ya pertenece a A, para siempre.
  await assert.rejects(
    world.service.rotateAssertionSigner({
      issuerId: ISSUER_B,
      newSignerProfileId: 'shared'
    }),
    expectRotationCode('NEW_PROFILE_BOUND_TO_ANOTHER_ISSUER')
  );
});

// ---------------------------------------------------------------------------
// PRECONDICIONES DEL CANDIDATO
// ---------------------------------------------------------------------------

test('un candidato no utilizable falla cerrado y no muta nada', async () => {
  const cases: Array<[string, Partial<ProfileRow>, string]> = [
    [
      'retirado',
      { status: SignerProfileStatus.retired },
      'NEW_PROFILE_NOT_ACTIVE'
    ],
    [
      'comprometido',
      { status: SignerProfileStatus.compromised },
      'NEW_PROFILE_NOT_ACTIVE'
    ],
    [
      'direccion sin verificar',
      { addressVerifiedAt: null },
      'NEW_PROFILE_ADDRESS_NOT_VERIFIED'
    ],
    [
      'proposito anchor',
      { purpose: SignerProfilePurpose.anchor },
      'NEW_PROFILE_PURPOSE_MISMATCH'
    ],
    [
      'sin material publico',
      { publicKeyX: null },
      'NEW_PROFILE_PUBLIC_KEY_UNUSABLE'
    ]
  ];

  for (const [label, overrides, code] of cases) {
    const world = createWorld({
      profiles: [
        assertionProfile('assert-1', 1),
        assertionProfile('assert-2', 2, overrides),
        anchorProfile('anchor-1')
      ],
      identities: [
        {
          issuerId: ISSUER_A,
          status: IssuerTechnicalIdentityStatus.active,
          assertionSignerProfileId: 'assert-1',
          anchorSignerProfileId: 'anchor-1'
        }
      ]
    });

    await assert.rejects(
      world.service.rotateAssertionSigner({
        issuerId: ISSUER_A,
        newSignerProfileId: 'assert-2'
      }),
      expectRotationCode(code),
      label
    );

    assert.equal(world.bindings.length, 1, label);
    assert.deepEqual(world.calls.profileUpdates, [], label);
  }
});

test('rotar al perfil que ya es vigente falla cerrado', async () => {
  const world = healthyWorld();

  await assert.rejects(
    world.service.rotateAssertionSigner({
      issuerId: ISSUER_A,
      newSignerProfileId: 'assert-1'
    }),
    expectRotationCode('NEW_PROFILE_ALREADY_CURRENT')
  );
});

// ---------------------------------------------------------------------------
// A1-A5: RECUPERACION DESDE UNA CLAVE COMPROMETIDA
// ---------------------------------------------------------------------------

test('A1-A2: con identidad rotation_required y vigente COMPROMETIDA, rotar funciona', async () => {
  const world = createWorld({
    profiles: [
      assertionProfile('assert-1', 1, {
        status: SignerProfileStatus.compromised
      }),
      assertionProfile('assert-2', 2),
      anchorProfile('anchor-1')
    ],
    identities: [
      {
        issuerId: ISSUER_A,
        status: IssuerTechnicalIdentityStatus.rotation_required,
        assertionSignerProfileId: 'assert-1',
        anchorSignerProfileId: 'anchor-1'
      }
    ]
  });

  const result = await world.service.rotateAssertionSigner({
    issuerId: ISSUER_A,
    newSignerProfileId: 'assert-2'
  });

  // A2: el compromiso NO se convierte en jubilacion ordinaria. Son dos hechos
  // distintos, y reescribirlo borraria la razon de la exclusion del DID.
  assert.equal(
    world.profiles.get('assert-1')?.status,
    SignerProfileStatus.compromised
  );
  assert.equal(world.profiles.get('assert-1')?.retiredAt, null);
  assert.equal(result.previousProfileStatus, SignerProfileStatus.compromised);

  // El puntero si se mueve, y la historia conserva la clave comprometida.
  assert.equal(
    world.identities.get(ISSUER_A)?.assertionSignerProfileId,
    'assert-2'
  );
  assert.equal(world.bindings.length, 2);
});

test('A3: la identidad vuelve a active solo si AMBOS roles estan sanos', async () => {
  const world = createWorld({
    profiles: [
      assertionProfile('assert-1', 1, {
        status: SignerProfileStatus.compromised
      }),
      assertionProfile('assert-2', 2),
      anchorProfile('anchor-1')
    ],
    identities: [
      {
        issuerId: ISSUER_A,
        status: IssuerTechnicalIdentityStatus.rotation_required,
        assertionSignerProfileId: 'assert-1',
        anchorSignerProfileId: 'anchor-1'
      }
    ]
  });

  const result = await world.service.rotateAssertionSigner({
    issuerId: ISSUER_A,
    newSignerProfileId: 'assert-2'
  });

  assert.equal(
    result.technicalIdentityStatus,
    IssuerTechnicalIdentityStatus.active
  );
  assert.equal(
    world.identities.get(ISSUER_A)?.status,
    IssuerTechnicalIdentityStatus.active
  );
});

test('A4: si el OTRO rol sigue roto, la identidad queda rotation_required', async () => {
  const world = createWorld({
    profiles: [
      assertionProfile('assert-1', 1, {
        status: SignerProfileStatus.compromised
      }),
      assertionProfile('assert-2', 2),
      anchorProfile('anchor-1', { status: SignerProfileStatus.compromised })
    ],
    identities: [
      {
        issuerId: ISSUER_A,
        status: IssuerTechnicalIdentityStatus.rotation_required,
        assertionSignerProfileId: 'assert-1',
        anchorSignerProfileId: 'anchor-1'
      }
    ]
  });

  const result = await world.service.rotateAssertionSigner({
    issuerId: ISSUER_A,
    newSignerProfileId: 'assert-2'
  });

  // Declarar sana una identidad cuyo anchor sigue comprometido seria mentir.
  assert.equal(
    result.technicalIdentityStatus,
    IssuerTechnicalIdentityStatus.rotation_required
  );
});

test('A5: una clave VIGENTE retirada no es un punto de partida valido', async () => {
  const world = createWorld({
    profiles: [
      assertionProfile('assert-1', 1, { status: SignerProfileStatus.retired }),
      assertionProfile('assert-2', 2),
      anchorProfile('anchor-1')
    ],
    identities: [
      {
        issuerId: ISSUER_A,
        status: IssuerTechnicalIdentityStatus.active,
        assertionSignerProfileId: 'assert-1',
        anchorSignerProfileId: 'anchor-1'
      }
    ]
  });

  await assert.rejects(
    world.service.rotateAssertionSigner({
      issuerId: ISSUER_A,
      newSignerProfileId: 'assert-2'
    }),
    expectRotationCode('CURRENT_PROFILE_RETIRED')
  );
});

test('la identidad unconfigured o disabled NO admite rotacion', async () => {
  for (const status of [
    IssuerTechnicalIdentityStatus.unconfigured,
    IssuerTechnicalIdentityStatus.disabled
  ]) {
    const world = createWorld({
      profiles: [
        assertionProfile('assert-1', 1),
        assertionProfile('assert-2', 2),
        anchorProfile('anchor-1')
      ],
      identities: [
        {
          issuerId: ISSUER_A,
          status,
          assertionSignerProfileId: 'assert-1',
          anchorSignerProfileId: 'anchor-1'
        }
      ]
    });

    await assert.rejects(
      world.service.rotateAssertionSigner({
        issuerId: ISSUER_A,
        newSignerProfileId: 'assert-2'
      }),
      expectRotationCode('TECHNICAL_IDENTITY_NOT_ROTATABLE'),
      status
    );
  }
});

// ---------------------------------------------------------------------------
// 12: EL DID NO CAMBIA
// ---------------------------------------------------------------------------

test('12: la rotacion no toca el identificador DID del issuer', async () => {
  const world = healthyWorld();

  await world.service.rotateAssertionSigner({
    issuerId: ISSUER_A,
    newSignerProfileId: 'assert-2'
  });

  // El doble solo expone `did` si alguien lo escribe; ninguna mutacion lo
  // incluye.
  for (const update of world.calls.profileUpdates) {
    assert.ok(!('did' in update.data));
  }
});

// ---------------------------------------------------------------------------
// 25-27, 36-43: ANCHOR
// ---------------------------------------------------------------------------

test('25, 27: rotar el anchor mueve el puntero vigente', async () => {
  const world = healthyWorld();

  const result = await world.service.rotateAnchorSigner({
    issuerId: ISSUER_A,
    newSignerProfileId: 'anchor-2'
  });

  assert.equal(result.newProfileId, 'anchor-2');
  assert.equal(world.identities.get(ISSUER_A)?.anchorSignerProfileId, 'anchor-2');

  // Sin referencias vivas, el anterior se retira.
  assert.equal(world.profiles.get('anchor-1')?.status, SignerProfileStatus.retired);
  assert.equal(world.profiles.get('anchor-1')?.retiredAt, ROTATION_TIME);

  // Y NO se crea ninguna tabla de historia de anchor: no hay bindings nuevos.
  assert.deepEqual(world.calls.bindingCreates, []);
});

test('36-40: un anchor COMPARTIDO sigue activo si otro issuer lo usa', async () => {
  const world = createWorld({
    profiles: [
      assertionProfile('assert-a', 1),
      assertionProfile('assert-b', 1),
      anchorProfile('anchor-shared'),
      anchorProfile('anchor-new')
    ],
    identities: [
      {
        issuerId: ISSUER_A,
        status: IssuerTechnicalIdentityStatus.active,
        assertionSignerProfileId: 'assert-a',
        anchorSignerProfileId: 'anchor-shared'
      },
      {
        issuerId: ISSUER_B,
        status: IssuerTechnicalIdentityStatus.active,
        assertionSignerProfileId: 'assert-b',
        anchorSignerProfileId: 'anchor-shared'
      }
    ]
  });

  await world.service.rotateAnchorSigner({
    issuerId: ISSUER_A,
    newSignerProfileId: 'anchor-new'
  });

  // 38-39: B sigue apuntando al compartido, y el compartido sigue ACTIVO.
  assert.equal(
    world.identities.get(ISSUER_B)?.anchorSignerProfileId,
    'anchor-shared'
  );
  assert.equal(
    world.profiles.get('anchor-shared')?.status,
    SignerProfileStatus.active
  );
  assert.equal(world.profiles.get('anchor-shared')?.retiredAt, null);
});

test('41: cuando el ultimo issuer deja de usarlo, el anchor se retira', async () => {
  const world = createWorld({
    profiles: [
      assertionProfile('assert-a', 1),
      assertionProfile('assert-b', 1),
      anchorProfile('anchor-shared'),
      anchorProfile('anchor-new-a'),
      anchorProfile('anchor-new-b')
    ],
    identities: [
      {
        issuerId: ISSUER_A,
        status: IssuerTechnicalIdentityStatus.active,
        assertionSignerProfileId: 'assert-a',
        anchorSignerProfileId: 'anchor-shared'
      },
      {
        issuerId: ISSUER_B,
        status: IssuerTechnicalIdentityStatus.active,
        assertionSignerProfileId: 'assert-b',
        anchorSignerProfileId: 'anchor-shared'
      }
    ]
  });

  await world.service.rotateAnchorSigner({
    issuerId: ISSUER_A,
    newSignerProfileId: 'anchor-new-a'
  });
  assert.equal(
    world.profiles.get('anchor-shared')?.status,
    SignerProfileStatus.active
  );

  await world.service.rotateAnchorSigner({
    issuerId: ISSUER_B,
    newSignerProfileId: 'anchor-new-b'
  });
  assert.equal(
    world.profiles.get('anchor-shared')?.status,
    SignerProfileStatus.retired
  );
});

test('B4: el conteo incluye identidades disabled y rotation_required', async () => {
  // Retirar el puntero vigente de una identidad fuera de servicio, a sus
  // espaldas, dejaria estado incoherente si vuelve a operar.
  for (const status of [
    IssuerTechnicalIdentityStatus.disabled,
    IssuerTechnicalIdentityStatus.rotation_required,
    IssuerTechnicalIdentityStatus.unconfigured
  ]) {
    const world = createWorld({
      profiles: [
        assertionProfile('assert-a', 1),
        assertionProfile('assert-b', 1),
        anchorProfile('anchor-shared'),
        anchorProfile('anchor-new')
      ],
      identities: [
        {
          issuerId: ISSUER_A,
          status: IssuerTechnicalIdentityStatus.active,
          assertionSignerProfileId: 'assert-a',
          anchorSignerProfileId: 'anchor-shared'
        },
        {
          issuerId: ISSUER_B,
          status,
          assertionSignerProfileId: 'assert-b',
          anchorSignerProfileId: 'anchor-shared'
        }
      ]
    });

    await world.service.rotateAnchorSigner({
      issuerId: ISSUER_A,
      newSignerProfileId: 'anchor-new'
    });

    assert.equal(
      world.profiles.get('anchor-shared')?.status,
      SignerProfileStatus.active,
      status
    );
  }
});

test('B1-B3: un anchor vigente COMPROMETIDO se puede rotar y sigue comprometido', async () => {
  const world = createWorld({
    profiles: [
      assertionProfile('assert-a', 1),
      assertionProfile('assert-b', 1),
      anchorProfile('anchor-shared', {
        status: SignerProfileStatus.compromised
      }),
      anchorProfile('anchor-new')
    ],
    identities: [
      {
        issuerId: ISSUER_A,
        status: IssuerTechnicalIdentityStatus.rotation_required,
        assertionSignerProfileId: 'assert-a',
        anchorSignerProfileId: 'anchor-shared'
      },
      {
        issuerId: ISSUER_B,
        status: IssuerTechnicalIdentityStatus.rotation_required,
        assertionSignerProfileId: 'assert-b',
        anchorSignerProfileId: 'anchor-shared'
      }
    ]
  });

  const result = await world.service.rotateAnchorSigner({
    issuerId: ISSUER_A,
    newSignerProfileId: 'anchor-new'
  });

  // B2-B3: ni se reactiva, ni se retira. Sigue comprometido, y B -- que todavia
  // lo apunta -- no va a poder registrar hasta que rote por su cuenta.
  assert.equal(
    world.profiles.get('anchor-shared')?.status,
    SignerProfileStatus.compromised
  );
  assert.equal(world.profiles.get('anchor-shared')?.retiredAt, null);
  assert.equal(result.previousProfileStatus, SignerProfileStatus.compromised);
  assert.equal(
    world.identities.get(ISSUER_B)?.anchorSignerProfileId,
    'anchor-shared'
  );
});

test('43, B5: un anchor retirado no puede volver a ser vigente', async () => {
  const world = createWorld({
    profiles: [
      assertionProfile('assert-a', 1),
      anchorProfile('anchor-1'),
      anchorProfile('anchor-retired', { status: SignerProfileStatus.retired })
    ],
    identities: [
      {
        issuerId: ISSUER_A,
        status: IssuerTechnicalIdentityStatus.active,
        assertionSignerProfileId: 'assert-a',
        anchorSignerProfileId: 'anchor-1'
      }
    ]
  });

  // No hay reactivacion implicita: un retirado es de uso historico unicamente.
  await assert.rejects(
    world.service.rotateAnchorSigner({
      issuerId: ISSUER_A,
      newSignerProfileId: 'anchor-retired'
    }),
    expectRotationCode('NEW_PROFILE_NOT_ACTIVE')
  );

  // Y un anchor vigente retirado tampoco es punto de partida.
  world.profiles.set('anchor-1', {
    ...world.profiles.get('anchor-1')!,
    status: SignerProfileStatus.retired
  });
  world.profiles.set('anchor-retired', {
    ...world.profiles.get('anchor-retired')!,
    status: SignerProfileStatus.active
  });

  await assert.rejects(
    world.service.rotateAnchorSigner({
      issuerId: ISSUER_A,
      newSignerProfileId: 'anchor-retired'
    }),
    expectRotationCode('CURRENT_PROFILE_RETIRED')
  );
});

test('un anchor SI puede ser ya el vigente de otro issuer', async () => {
  // Las cuentas de anclaje son compartibles a proposito, y S8c6 serializa sus
  // escrituras por perfil justamente por eso.
  const world = createWorld({
    profiles: [
      assertionProfile('assert-a', 1),
      assertionProfile('assert-b', 1),
      anchorProfile('anchor-a'),
      anchorProfile('anchor-b')
    ],
    identities: [
      {
        issuerId: ISSUER_A,
        status: IssuerTechnicalIdentityStatus.active,
        assertionSignerProfileId: 'assert-a',
        anchorSignerProfileId: 'anchor-a'
      },
      {
        issuerId: ISSUER_B,
        status: IssuerTechnicalIdentityStatus.active,
        assertionSignerProfileId: 'assert-b',
        anchorSignerProfileId: 'anchor-b'
      }
    ]
  });

  await world.service.rotateAnchorSigner({
    issuerId: ISSUER_A,
    newSignerProfileId: 'anchor-b'
  });

  assert.equal(world.identities.get(ISSUER_A)?.anchorSignerProfileId, 'anchor-b');
  assert.equal(world.identities.get(ISSUER_B)?.anchorSignerProfileId, 'anchor-b');
  assert.equal(
    world.profiles.get('anchor-b')?.status,
    SignerProfileStatus.active
  );
});

// ---------------------------------------------------------------------------
// CONCURRENCIA
// ---------------------------------------------------------------------------

test('dos rotaciones concurrentes no pueden producir dos sucesores', async () => {
  const world = createWorld({
    profiles: [
      assertionProfile('assert-1', 1),
      assertionProfile('assert-2', 2),
      assertionProfile('assert-2b', 2),
      anchorProfile('anchor-1')
    ],
    identities: [
      {
        issuerId: ISSUER_A,
        status: IssuerTechnicalIdentityStatus.active,
        assertionSignerProfileId: 'assert-1',
        anchorSignerProfileId: 'anchor-1'
      }
    ]
  });

  // La primera gana. La segunda encuentra el puntero ya movido: su predicado
  // optimista no afecta ninguna fila y falla cerrado en vez de dejar dos
  // sucesores coherentes.
  await world.service.rotateAssertionSigner({
    issuerId: ISSUER_A,
    newSignerProfileId: 'assert-2'
  });

  await assert.rejects(
    world.service.rotateAssertionSigner({
      issuerId: ISSUER_A,
      newSignerProfileId: 'assert-2b'
    }),
    (error: unknown) => {
      assert.ok(error instanceof SignerRotationError);
      // El puntero ya es `assert-2`, asi que `assert-1` ya no es el vigente: el
      // candidato `assert-2b` repite la version 2 y eso ya es incoherente.
      assert.ok(
        ['ROTATION_CONFLICT', 'NEW_PROFILE_KEY_VERSION_NOT_NEXT'].includes(
          (error as SignerRotationError).code
        ),
        (error as SignerRotationError).code
      );
      return true;
    }
  );

  assert.equal(
    world.identities.get(ISSUER_A)?.assertionSignerProfileId,
    'assert-2'
  );
  assert.equal(world.bindings.length, 2);
});

test('la clave vigente NUNCA se deriva de la version maxima', async () => {
  // `assert-2` tiene la version mas alta y esta activo, pero el puntero sigue
  // en `assert-1`: lo vigente lo dice el puntero y nada mas.
  const world = healthyWorld();

  assert.equal(
    world.identities.get(ISSUER_A)?.assertionSignerProfileId,
    'assert-1'
  );
  assert.equal(world.profiles.get('assert-2')?.keyVersion, 2);
  assert.equal(PUBLIC_TEST_KEY_TWO.address.length, 42);
});

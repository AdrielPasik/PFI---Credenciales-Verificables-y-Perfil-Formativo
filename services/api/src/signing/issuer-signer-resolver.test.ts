/**
 * Resolucion de signer por Issuer -- S8c2.
 *
 * Todo con dobles: no hay AWS, no hay SSM real, no hay provider, no hay RPC y
 * no hay base de datos. Las claves son fixtures publicos (escalares 1 y 2).
 *
 * Lo que estos tests tienen que demostrar:
 *
 *   issuerId
 *     -> identidad tecnica correcta
 *     -> SignerProfile del proposito correcto
 *     -> secretRef exacto
 *     -> almacen de secretos
 *     -> clave privada valida
 *     -> Wallet DESCONECTADA
 *     -> direccion derivada == direccion persistida
 *     -> (asercion) material publico derivado == material publico persistido
 *
 * y, simetricamente, que cualquier desvio falla CERRADO.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IssuerTechnicalIdentityStatus,
  SignerProfilePurpose,
  SignerProfileStatus
} from '@prisma/client';

import { type PrismaService } from '../prisma/prisma.service';
import {
  PUBLIC_TEST_KEY_ONE,
  PUBLIC_TEST_KEY_TWO,
  SECP256K1_GROUP_ORDER,
  ZERO_PRIVATE_KEY
} from './__fixtures__/signer-test-keys';
import { IssuerSignerResolver } from './issuer-signer-resolver';
import {
  SignerResolutionError,
  type SignerResolutionErrorCode
} from './signer-resolution.error';
import { type SignerSecretStore } from './signer-secret-store.port';

const CACHE_TTL_MS = 15 * 60 * 1000;

const ASSERTION_SECRET_REF = '/scope/test/signers/assert-uade';
const ASSERTION_SECRET_REF_TWO = '/scope/test/signers/assert-course';
const ANCHOR_SECRET_REF = '/scope/test/signers/anchor-shared';

interface ProfileFixture {
  id: string;
  purpose: SignerProfilePurpose;
  secretRef: string;
  address: string;
  publicKeyX: string | null;
  publicKeyY: string | null;
  publicKeyCompressed: string | null;
  keyVersion: number;
  addressVerifiedAt: Date | null;
  status: SignerProfileStatus;
}

interface IdentityFixture {
  status: IssuerTechnicalIdentityStatus;
  assertionSignerProfile: ProfileFixture | null;
  anchorSignerProfile: ProfileFixture | null;
}

function assertionProfile(
  overrides: Partial<ProfileFixture> = {}
): ProfileFixture {
  return {
    id: 'profile-assert-1',
    purpose: SignerProfilePurpose.assertion,
    secretRef: ASSERTION_SECRET_REF,
    address: PUBLIC_TEST_KEY_ONE.addressLowercase,
    publicKeyX: PUBLIC_TEST_KEY_ONE.publicKeyX,
    publicKeyY: PUBLIC_TEST_KEY_ONE.publicKeyY,
    publicKeyCompressed: PUBLIC_TEST_KEY_ONE.publicKeyCompressed,
    keyVersion: 1,
    addressVerifiedAt: new Date('2026-10-01T00:00:00.000Z'),
    status: SignerProfileStatus.active,
    ...overrides
  };
}

function anchorProfile(overrides: Partial<ProfileFixture> = {}): ProfileFixture {
  return {
    id: 'profile-anchor-shared',
    purpose: SignerProfilePurpose.anchor,
    secretRef: ANCHOR_SECRET_REF,
    address: PUBLIC_TEST_KEY_TWO.addressLowercase,
    // Un anchor PUEDE omitir el material publico de asercion (S8c1).
    publicKeyX: null,
    publicKeyY: null,
    publicKeyCompressed: null,
    keyVersion: 1,
    addressVerifiedAt: new Date('2026-10-01T00:00:00.000Z'),
    status: SignerProfileStatus.active,
    ...overrides
  };
}

const FORBIDDEN_WRITE = (name: string) => () => {
  throw new Error(`la resolucion de signer no debe invocar ${name}`);
};

/**
 * Mundo de prueba mutable: los tests pueden cambiar el estado en la base ENTRE
 * llamadas, que es exactamente lo que hace falta para probar que la cache no
 * posterga una deshabilitacion o un compromiso.
 */
function createWorld() {
  const identities = new Map<string, IdentityFixture>();
  const secrets = new Map<string, string>();
  const secretReads: string[] = [];
  let findUniqueCalls = 0;
  let clock = 1_000_000;

  const prisma = {
    issuerTechnicalIdentity: {
      async findUnique(args: {
        where: { issuerId: string };
        select: Record<string, unknown>;
      }) {
        findUniqueCalls += 1;

        // El doble refleja la forma del `select`: devuelve SOLO la relacion
        // pedida, igual que Prisma.
        const identity = identities.get(args.where.issuerId);
        if (!identity) {
          return null;
        }

        const projected: Record<string, unknown> = { status: identity.status };
        if ('assertionSignerProfile' in args.select) {
          projected.assertionSignerProfile = identity.assertionSignerProfile;
        }
        if ('anchorSignerProfile' in args.select) {
          projected.anchorSignerProfile = identity.anchorSignerProfile;
        }
        return projected;
      },
      create: FORBIDDEN_WRITE('issuerTechnicalIdentity.create'),
      update: FORBIDDEN_WRITE('issuerTechnicalIdentity.update'),
      updateMany: FORBIDDEN_WRITE('issuerTechnicalIdentity.updateMany'),
      upsert: FORBIDDEN_WRITE('issuerTechnicalIdentity.upsert'),
      delete: FORBIDDEN_WRITE('issuerTechnicalIdentity.delete')
    },
    signerProfile: {
      create: FORBIDDEN_WRITE('signerProfile.create'),
      update: FORBIDDEN_WRITE('signerProfile.update'),
      updateMany: FORBIDDEN_WRITE('signerProfile.updateMany'),
      upsert: FORBIDDEN_WRITE('signerProfile.upsert'),
      delete: FORBIDDEN_WRITE('signerProfile.delete')
    },
    $transaction: FORBIDDEN_WRITE('$transaction')
  } as unknown as PrismaService;

  const secretStore: SignerSecretStore = {
    async getPrivateKey(secretRef: string) {
      secretReads.push(secretRef);
      const value = secrets.get(secretRef);
      if (value === undefined) {
        throw new SignerResolutionError('SIGNER_SECRET_UNAVAILABLE');
      }
      return value;
    }
  };

  const resolver = new IssuerSignerResolver(prisma, secretStore, {
    cacheTtlMs: CACHE_TTL_MS,
    now: () => clock
  });

  return {
    resolver,
    identities,
    secrets,
    secretReads,
    get findUniqueCalls() {
      return findUniqueCalls;
    },
    advance(ms: number) {
      clock += ms;
    }
  };
}

/** Mundo minimo: un issuer con asercion (escalar 1) y anchor (escalar 2). */
function createConfiguredWorld() {
  const world = createWorld();
  world.identities.set('issuer-uade', {
    status: IssuerTechnicalIdentityStatus.active,
    assertionSignerProfile: assertionProfile(),
    anchorSignerProfile: anchorProfile()
  });
  world.secrets.set(ASSERTION_SECRET_REF, PUBLIC_TEST_KEY_ONE.privateKey);
  world.secrets.set(ANCHOR_SECRET_REF, PUBLIC_TEST_KEY_TWO.privateKey);
  return world;
}

async function expectCode(
  operation: Promise<unknown>,
  code: SignerResolutionErrorCode
): Promise<SignerResolutionError> {
  try {
    await operation;
  } catch (error) {
    assert.ok(
      error instanceof SignerResolutionError,
      `se esperaba SignerResolutionError, llego ${String(error)}`
    );
    assert.equal(error.code, code);
    return error;
  }

  throw new Error(`se esperaba que fallara con ${code}, pero resolvio`);
}

// ---------------------------------------------------------------------------
// CAMINO FELIZ
// ---------------------------------------------------------------------------

test('1: resuelve el signer de ASERCION del issuer', async () => {
  const world = createConfiguredWorld();

  const signer = await world.resolver.resolveAssertionSignerForIssuer(
    'issuer-uade'
  );

  assert.equal(signer.profileId, 'profile-assert-1');
  assert.equal(signer.purpose, SignerProfilePurpose.assertion);
  assert.equal(signer.keyVersion, 1);
  assert.equal(signer.address, PUBLIC_TEST_KEY_ONE.address);
  assert.deepEqual(world.secretReads, [ASSERTION_SECRET_REF]);
});

test('2: resuelve el signer de ANCLAJE del issuer', async () => {
  const world = createConfiguredWorld();

  const signer = await world.resolver.resolveAnchorSignerForIssuer(
    'issuer-uade'
  );

  assert.equal(signer.profileId, 'profile-anchor-shared');
  assert.equal(signer.purpose, SignerProfilePurpose.anchor);
  assert.equal(signer.address, PUBLIC_TEST_KEY_TWO.address);
  assert.deepEqual(world.secretReads, [ANCHOR_SECRET_REF]);
});

test('3: la Wallet resuelta esta DESCONECTADA -- provider nulo', async () => {
  const world = createConfiguredWorld();

  const assertion = await world.resolver.resolveAssertionSignerForIssuer(
    'issuer-uade'
  );
  const anchor = await world.resolver.resolveAnchorSignerForIssuer(
    'issuer-uade'
  );

  assert.equal(assertion.wallet.provider, null);
  assert.equal(anchor.wallet.provider, null);
});

test('la direccion devuelta viene con checksum EIP-55 aunque se persista en minuscula', async () => {
  const world = createConfiguredWorld();

  const signer = await world.resolver.resolveAssertionSignerForIssuer(
    'issuer-uade'
  );

  assert.equal(signer.address, PUBLIC_TEST_KEY_ONE.address);
  assert.notEqual(signer.address, PUBLIC_TEST_KEY_ONE.addressLowercase);
  assert.equal(signer.wallet.address, signer.address);
});

test('la resolucion es de SOLO LECTURA: no escribe en la base', async () => {
  const world = createConfiguredWorld();

  // El doble de Prisma lanza en cualquier metodo de escritura.
  await world.resolver.resolveAssertionSignerForIssuer('issuer-uade');
  await world.resolver.resolveAnchorSignerForIssuer('issuer-uade');
});

// ---------------------------------------------------------------------------
// PROPOSITO
// ---------------------------------------------------------------------------

test('4a: un perfil de anchor vinculado como asercion falla cerrado', async () => {
  const world = createWorld();
  world.identities.set('issuer-x', {
    status: IssuerTechnicalIdentityStatus.active,
    // La relacion de asercion apunta a un perfil cuyo purpose es anchor.
    assertionSignerProfile: anchorProfile({ id: 'profile-wrong-purpose' }),
    anchorSignerProfile: anchorProfile()
  });
  world.secrets.set(ANCHOR_SECRET_REF, PUBLIC_TEST_KEY_TWO.privateKey);

  await expectCode(
    world.resolver.resolveAssertionSignerForIssuer('issuer-x'),
    'SIGNER_PURPOSE_MISMATCH'
  );
  assert.deepEqual(world.secretReads, [], 'no debe leer el secreto');
});

test('4b: un perfil de asercion vinculado como anchor falla cerrado', async () => {
  const world = createWorld();
  world.identities.set('issuer-x', {
    status: IssuerTechnicalIdentityStatus.active,
    assertionSignerProfile: assertionProfile(),
    anchorSignerProfile: assertionProfile({ id: 'profile-wrong-purpose' })
  });
  world.secrets.set(ASSERTION_SECRET_REF, PUBLIC_TEST_KEY_ONE.privateKey);

  await expectCode(
    world.resolver.resolveAnchorSignerForIssuer('issuer-x'),
    'SIGNER_PURPOSE_MISMATCH'
  );
  assert.deepEqual(world.secretReads, []);
});

// ---------------------------------------------------------------------------
// ESTADO DE LA IDENTIDAD TECNICA
// ---------------------------------------------------------------------------

test('identidad tecnica inexistente falla cerrado', async () => {
  const world = createWorld();

  await expectCode(
    world.resolver.resolveAssertionSignerForIssuer('issuer-sin-identidad'),
    'TECHNICAL_IDENTITY_NOT_CONFIGURED'
  );
  assert.deepEqual(world.secretReads, []);
});

for (const status of [
  IssuerTechnicalIdentityStatus.unconfigured,
  IssuerTechnicalIdentityStatus.rotation_required,
  IssuerTechnicalIdentityStatus.disabled
] as const) {
  test(`5-7: identidad tecnica ${status} NO resuelve para uso corriente`, async () => {
    const world = createConfiguredWorld();
    world.identities.get('issuer-uade')!.status = status;

    await expectCode(
      world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
      'TECHNICAL_IDENTITY_INACTIVE'
    );
    await expectCode(
      world.resolver.resolveAnchorSignerForIssuer('issuer-uade'),
      'TECHNICAL_IDENTITY_INACTIVE'
    );
    assert.deepEqual(world.secretReads, []);
  });
}

test('perfil ausente en la relacion falla cerrado', async () => {
  const world = createWorld();
  world.identities.set('issuer-x', {
    status: IssuerTechnicalIdentityStatus.active,
    assertionSignerProfile: null,
    anchorSignerProfile: null
  });

  await expectCode(
    world.resolver.resolveAssertionSignerForIssuer('issuer-x'),
    'SIGNER_PROFILE_NOT_CONFIGURED'
  );
});

// ---------------------------------------------------------------------------
// ESTADO DEL PERFIL
// ---------------------------------------------------------------------------

for (const status of [
  SignerProfileStatus.retired,
  SignerProfileStatus.compromised
] as const) {
  test(`8-9: perfil ${status} NO resuelve para uso corriente`, async () => {
    const world = createConfiguredWorld();
    world.identities.get('issuer-uade')!.assertionSignerProfile!.status =
      status;

    await expectCode(
      world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
      'SIGNER_PROFILE_INACTIVE'
    );
    assert.deepEqual(world.secretReads, [], 'no debe leer el secreto');
  });
}

test('un perfil inactivo NO cae silenciosamente a otro perfil', async () => {
  const world = createConfiguredWorld();
  world.identities.get('issuer-uade')!.assertionSignerProfile!.status =
    SignerProfileStatus.compromised;

  // El anchor sigue activo, pero la resolucion de asercion no debe usarlo.
  await expectCode(
    world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
    'SIGNER_PROFILE_INACTIVE'
  );

  const anchor = await world.resolver.resolveAnchorSignerForIssuer(
    'issuer-uade'
  );
  assert.equal(anchor.purpose, SignerProfilePurpose.anchor);
});

test('10: addressVerifiedAt nulo falla cerrado', async () => {
  const world = createConfiguredWorld();
  world.identities.get('issuer-uade')!.assertionSignerProfile!.addressVerifiedAt =
    null;

  await expectCode(
    world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
    'SIGNER_ADDRESS_NOT_VERIFIED'
  );
  assert.deepEqual(world.secretReads, []);
});

// ---------------------------------------------------------------------------
// MATERIAL SECRETO
// ---------------------------------------------------------------------------

test('11: secreto ausente en el almacen falla de forma segura', async () => {
  const world = createConfiguredWorld();
  world.secrets.delete(ASSERTION_SECRET_REF);

  const error = await expectCode(
    world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
    'SIGNER_SECRET_UNAVAILABLE'
  );
  assert.doesNotMatch(error.message, /0x/);
});

test('12: clave mal formada falla cerrado y sin normalizacion piadosa', async () => {
  const malformed = [
    // sin prefijo 0x
    PUBLIC_TEST_KEY_ONE.privateKey.slice(2),
    // con espacios alrededor
    ` ${PUBLIC_TEST_KEY_ONE.privateKey} `,
    // con salto de linea final, tipico de un secreto mal cargado
    `${PUBLIC_TEST_KEY_ONE.privateKey}\n`,
    // longitud incorrecta
    '0x1234',
    `${PUBLIC_TEST_KEY_ONE.privateKey}00`,
    // caracteres no hexadecimales
    `0x${'z'.repeat(64)}`,
    // vacio
    ''
  ];

  for (const value of malformed) {
    const world = createConfiguredWorld();
    world.secrets.set(ASSERTION_SECRET_REF, value);

    const error = await expectCode(
      world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
      'SIGNER_SECRET_INVALID'
    );
    assert.ok(!error.message.includes(value.trim() || 'IMPOSIBLE'));
  }
});

test('13: escalar cero y escalar fuera de rango fallan cerrado', async () => {
  for (const value of [
    ZERO_PRIVATE_KEY,
    SECP256K1_GROUP_ORDER,
    `0x${'f'.repeat(64)}`
  ]) {
    const world = createConfiguredWorld();
    world.secrets.set(ASSERTION_SECRET_REF, value);

    const error = await expectCode(
      world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
      'SIGNER_SECRET_INVALID'
    );
    // El mensaje de ethers ("Expected valid bigint...") no se propaga.
    assert.doesNotMatch(error.message, /bigint/i);
  }
});

test('la clave en MAYUSCULAS hexadecimales es aceptada: no es material mal formado', async () => {
  const world = createConfiguredWorld();
  world.secrets.set(
    ASSERTION_SECRET_REF,
    `0x${PUBLIC_TEST_KEY_ONE.privateKey.slice(2).toUpperCase()}`
  );

  const signer = await world.resolver.resolveAssertionSignerForIssuer(
    'issuer-uade'
  );
  assert.equal(signer.address, PUBLIC_TEST_KEY_ONE.address);
});

// ---------------------------------------------------------------------------
// CONSISTENCIA CRIPTOGRAFICA
// ---------------------------------------------------------------------------

test('14: direccion derivada distinta de la persistida falla cerrado', async () => {
  const world = createConfiguredWorld();
  // El perfil declara la direccion del escalar 1, pero el secreto es el 2.
  world.secrets.set(ASSERTION_SECRET_REF, PUBLIC_TEST_KEY_TWO.privateKey);

  await expectCode(
    world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
    'SIGNER_ADDRESS_MISMATCH'
  );
});

test('una direccion persistida invalida falla cerrado', async () => {
  const world = createConfiguredWorld();
  world.identities.get('issuer-uade')!.assertionSignerProfile!.address =
    '0xnot-an-address';

  await expectCode(
    world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
    'SIGNER_ADDRESS_MISMATCH'
  );
  assert.deepEqual(world.secretReads, [], 'falla antes de leer el secreto');
});

test('15-17: cualquier desajuste del material publico de asercion falla cerrado', async () => {
  const mutations: Array<[string, Partial<ProfileFixture>]> = [
    ['publicKeyX distinto', { publicKeyX: PUBLIC_TEST_KEY_TWO.publicKeyX }],
    ['publicKeyY distinto', { publicKeyY: PUBLIC_TEST_KEY_TWO.publicKeyY }],
    [
      'publicKeyCompressed distinto',
      { publicKeyCompressed: PUBLIC_TEST_KEY_TWO.publicKeyCompressed }
    ],
    ['publicKeyX ausente', { publicKeyX: null }],
    ['publicKeyY ausente', { publicKeyY: null }],
    ['publicKeyCompressed ausente', { publicKeyCompressed: null }],
    [
      'publicKeyX en mayusculas no es la representacion comprometida',
      { publicKeyX: PUBLIC_TEST_KEY_ONE.publicKeyX.toUpperCase() }
    ]
  ];

  for (const [label, overrides] of mutations) {
    const world = createWorld();
    world.identities.set('issuer-uade', {
      status: IssuerTechnicalIdentityStatus.active,
      assertionSignerProfile: assertionProfile(overrides),
      anchorSignerProfile: null
    });
    world.secrets.set(ASSERTION_SECRET_REF, PUBLIC_TEST_KEY_ONE.privateKey);

    await expectCode(
      world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
      'SIGNER_PUBLIC_KEY_MISMATCH'
    );
    void label;
  }
});

test('18: metadata de asercion completa y correcta resuelve', async () => {
  const world = createConfiguredWorld();

  const signer = await world.resolver.resolveAssertionSignerForIssuer(
    'issuer-uade'
  );

  // El material publico persistido es exactamente el del fixture congelado en
  // S8b.1, asi que el DID Document futuro publicara la clave que realmente
  // firma.
  const signingKey = signer.wallet.signingKey;
  assert.equal(
    `0x${signingKey.publicKey.slice(4, 68)}`,
    PUBLIC_TEST_KEY_ONE.publicKeyX
  );
  assert.equal(
    `0x${signingKey.publicKey.slice(68, 132)}`,
    PUBLIC_TEST_KEY_ONE.publicKeyY
  );
  assert.equal(
    signingKey.compressedPublicKey,
    PUBLIC_TEST_KEY_ONE.publicKeyCompressed
  );
});

test('19: un anchor puede omitir las coordenadas publicas', async () => {
  const world = createConfiguredWorld();
  const anchor = world.identities.get('issuer-uade')!.anchorSignerProfile!;
  assert.equal(anchor.publicKeyX, null);
  assert.equal(anchor.publicKeyY, null);
  assert.equal(anchor.publicKeyCompressed, null);

  const signer = await world.resolver.resolveAnchorSignerForIssuer(
    'issuer-uade'
  );
  assert.equal(signer.address, PUBLIC_TEST_KEY_TWO.address);
});

// ---------------------------------------------------------------------------
// ANCHOR COMPARTIDO (ARQUITECTURA DE LA DEMO)
// ---------------------------------------------------------------------------

/** Tres issuers, tres claves de asercion distintas, UN anchor compartido. */
function createSharedAnchorWorld() {
  const world = createWorld();
  const sharedAnchor = anchorProfile();

  world.identities.set('issuer-uade', {
    status: IssuerTechnicalIdentityStatus.active,
    assertionSignerProfile: assertionProfile({
      id: 'profile-assert-uade',
      secretRef: ASSERTION_SECRET_REF
    }),
    anchorSignerProfile: sharedAnchor
  });

  world.identities.set('issuer-course', {
    status: IssuerTechnicalIdentityStatus.active,
    assertionSignerProfile: assertionProfile({
      id: 'profile-assert-course',
      secretRef: ASSERTION_SECRET_REF_TWO,
      address: PUBLIC_TEST_KEY_TWO.addressLowercase,
      publicKeyX: PUBLIC_TEST_KEY_TWO.publicKeyX,
      publicKeyY: PUBLIC_TEST_KEY_TWO.publicKeyY,
      publicKeyCompressed: PUBLIC_TEST_KEY_TWO.publicKeyCompressed
    }),
    // MISMA instancia de perfil: un anchor compartido.
    anchorSignerProfile: sharedAnchor
  });

  world.secrets.set(ASSERTION_SECRET_REF, PUBLIC_TEST_KEY_ONE.privateKey);
  world.secrets.set(ASSERTION_SECRET_REF_TWO, PUBLIC_TEST_KEY_TWO.privateKey);
  world.secrets.set(ANCHOR_SECRET_REF, PUBLIC_TEST_KEY_TWO.privateKey);

  return world;
}

test('20: dos issuers con el mismo anchorSignerProfile resuelven el mismo perfil', async () => {
  const world = createSharedAnchorWorld();

  const uade = await world.resolver.resolveAnchorSignerForIssuer('issuer-uade');
  const course = await world.resolver.resolveAnchorSignerForIssuer(
    'issuer-course'
  );

  assert.equal(uade.profileId, course.profileId);
  assert.equal(uade.address, course.address);
  assert.equal(uade.wallet, course.wallet, 'misma Wallet cacheada');
});

test('21: el anchor compartido lee el secreto UNA sola vez dentro del TTL', async () => {
  const world = createSharedAnchorWorld();

  await world.resolver.resolveAnchorSignerForIssuer('issuer-uade');
  await world.resolver.resolveAnchorSignerForIssuer('issuer-course');
  await world.resolver.resolveAnchorSignerForIssuer('issuer-uade');

  assert.deepEqual(
    world.secretReads,
    [ANCHOR_SECRET_REF],
    'la cache se indexa por SignerProfile.id, no por issuerId'
  );

  // Pero la configuracion se releyo en CADA llamada.
  assert.equal(world.findUniqueCalls, 3);
});

test('22: dos issuers con claves de asercion distintas resuelven direcciones distintas', async () => {
  const world = createSharedAnchorWorld();

  const uade = await world.resolver.resolveAssertionSignerForIssuer(
    'issuer-uade'
  );
  const course = await world.resolver.resolveAssertionSignerForIssuer(
    'issuer-course'
  );

  assert.notEqual(uade.profileId, course.profileId);
  assert.notEqual(uade.address, course.address);
  assert.equal(uade.address, PUBLIC_TEST_KEY_ONE.address);
  assert.equal(course.address, PUBLIC_TEST_KEY_TWO.address);

  // La autenticidad por issuer sigue siendo distinta aunque el anchor se
  // comparta.
  const uadeAnchor = await world.resolver.resolveAnchorSignerForIssuer(
    'issuer-uade'
  );
  const courseAnchor = await world.resolver.resolveAnchorSignerForIssuer(
    'issuer-course'
  );
  assert.equal(uadeAnchor.address, courseAnchor.address);
});

// ---------------------------------------------------------------------------
// CACHE
// ---------------------------------------------------------------------------

test('dentro del TTL, dos resoluciones del mismo perfil leen el secreto una vez', async () => {
  const world = createConfiguredWorld();

  await world.resolver.resolveAssertionSignerForIssuer('issuer-uade');
  world.advance(CACHE_TTL_MS - 1);
  await world.resolver.resolveAssertionSignerForIssuer('issuer-uade');

  assert.deepEqual(world.secretReads, [ASSERTION_SECRET_REF]);
});

test('23: al expirar el TTL se vuelve a leer el secreto y se revalida', async () => {
  const world = createConfiguredWorld();

  await world.resolver.resolveAssertionSignerForIssuer('issuer-uade');
  world.advance(CACHE_TTL_MS);

  // Si al reconstruir el material ya no coincidiera, debe fallar: la
  // verificacion de direccion y clave publica se rehace en cada miss.
  world.secrets.set(ASSERTION_SECRET_REF, PUBLIC_TEST_KEY_TWO.privateKey);
  await expectCode(
    world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
    'SIGNER_ADDRESS_MISMATCH'
  );

  assert.deepEqual(world.secretReads, [
    ASSERTION_SECRET_REF,
    ASSERTION_SECRET_REF
  ]);
});

test('24: un perfil que pasa a compromised falla en la llamada siguiente, aunque haya cache', async () => {
  const world = createConfiguredWorld();

  const first = await world.resolver.resolveAssertionSignerForIssuer(
    'issuer-uade'
  );
  assert.equal(first.address, PUBLIC_TEST_KEY_ONE.address);

  // Cambia SOLO la base. El TTL no vencio.
  world.identities.get('issuer-uade')!.assertionSignerProfile!.status =
    SignerProfileStatus.compromised;

  await expectCode(
    world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
    'SIGNER_PROFILE_INACTIVE'
  );

  // Y la Wallet cacheada fue DESALOJADA, no quedo retenida hasta que venza el
  // TTL: si el perfil volviera a estar activo, hay que reconstruirla.
  world.identities.get('issuer-uade')!.assertionSignerProfile!.status =
    SignerProfileStatus.active;
  await world.resolver.resolveAssertionSignerForIssuer('issuer-uade');

  assert.deepEqual(world.secretReads, [
    ASSERTION_SECRET_REF,
    ASSERTION_SECRET_REF
  ]);
});

test('25: una identidad tecnica que pasa a disabled falla en la llamada siguiente', async () => {
  const world = createConfiguredWorld();

  await world.resolver.resolveAssertionSignerForIssuer('issuer-uade');

  world.identities.get('issuer-uade')!.status =
    IssuerTechnicalIdentityStatus.disabled;

  await expectCode(
    world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
    'TECHNICAL_IDENTITY_INACTIVE'
  );
});

test('deshabilitar UN issuer no destruye la cache de un anchor compartido', async () => {
  const world = createSharedAnchorWorld();

  await world.resolver.resolveAnchorSignerForIssuer('issuer-uade');
  assert.deepEqual(world.secretReads, [ANCHOR_SECRET_REF]);

  // UADE queda deshabilitada, pero el mismo anchor sigue vinculado a Course.
  world.identities.get('issuer-uade')!.status =
    IssuerTechnicalIdentityStatus.disabled;

  await expectCode(
    world.resolver.resolveAnchorSignerForIssuer('issuer-uade'),
    'TECHNICAL_IDENTITY_INACTIVE'
  );

  // Course sigue resolviendo desde la cache: no hubo una segunda lectura.
  const course = await world.resolver.resolveAnchorSignerForIssuer(
    'issuer-course'
  );
  assert.equal(course.address, PUBLIC_TEST_KEY_TWO.address);
  assert.deepEqual(world.secretReads, [ANCHOR_SECRET_REF]);
});

// ---------------------------------------------------------------------------
// COHERENCIA DE LA CACHE CONTRA LA METADATA ACTUAL (S8c2.1)
//
// Un cache hit puede evitar la lectura de SSM y la reconstruccion de la Wallet,
// pero NO puede evitar las comprobaciones criptograficas contra la metadata
// VIGENTE del SignerProfile. S8c3 va a servir el DID Document desde
// `publicKeyX`/`publicKeyY`/`publicKeyCompressed` de PostgreSQL sin leer el
// secreto, asi que un cambio de esos campos durante el TTL no puede dejar que
// una Wallet cacheada siga usandose.
// ---------------------------------------------------------------------------

test('S8c2.1: mutar publicKeyX durante el TTL invalida el cache hit', async () => {
  const world = createConfiguredWorld();

  await world.resolver.resolveAssertionSignerForIssuer('issuer-uade');
  assert.deepEqual(world.secretReads, [ASSERTION_SECRET_REF]);

  world.identities.get('issuer-uade')!.assertionSignerProfile!.publicKeyX =
    PUBLIC_TEST_KEY_TWO.publicKeyX;

  await expectCode(
    world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
    'SIGNER_PUBLIC_KEY_MISMATCH'
  );

  // No se vuelve a leer SSM: la Wallet cacheada ya prueba la discrepancia, y
  // con el mismo secretRef una relectura derivaria el mismo material.
  assert.deepEqual(world.secretReads, [ASSERTION_SECRET_REF]);
});

test('S8c2.1: cualquier mutacion del material publico durante el TTL invalida el hit', async () => {
  const mutations: Array<[string, Partial<ProfileFixture>]> = [
    ['publicKeyX distinto', { publicKeyX: PUBLIC_TEST_KEY_TWO.publicKeyX }],
    ['publicKeyY distinto', { publicKeyY: PUBLIC_TEST_KEY_TWO.publicKeyY }],
    [
      'publicKeyCompressed distinto',
      { publicKeyCompressed: PUBLIC_TEST_KEY_TWO.publicKeyCompressed }
    ],
    ['publicKeyX a null', { publicKeyX: null }],
    ['publicKeyY a null', { publicKeyY: null }],
    ['publicKeyCompressed a null', { publicKeyCompressed: null }]
  ];

  for (const [label, overrides] of mutations) {
    const world = createConfiguredWorld();

    const first = await world.resolver.resolveAssertionSignerForIssuer(
      'issuer-uade'
    );
    assert.equal(first.address, PUBLIC_TEST_KEY_ONE.address, label);

    Object.assign(
      world.identities.get('issuer-uade')!.assertionSignerProfile!,
      overrides
    );

    await expectCode(
      world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
      'SIGNER_PUBLIC_KEY_MISMATCH'
    );
    assert.deepEqual(world.secretReads, [ASSERTION_SECRET_REF], label);
  }
});

test('S8c2.1: mutar la direccion persistida durante el TTL invalida el hit', async () => {
  const world = createConfiguredWorld();

  await world.resolver.resolveAssertionSignerForIssuer('issuer-uade');

  world.identities.get('issuer-uade')!.assertionSignerProfile!.address =
    PUBLIC_TEST_KEY_TWO.addressLowercase;

  await expectCode(
    world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
    'SIGNER_ADDRESS_MISMATCH'
  );
  assert.deepEqual(world.secretReads, [ASSERTION_SECRET_REF]);
});

test('S8c2.1: una entrada que contradice la metadata actual queda DESALOJADA', async () => {
  const world = createConfiguredWorld();

  await world.resolver.resolveAssertionSignerForIssuer('issuer-uade');

  const profile = world.identities.get('issuer-uade')!.assertionSignerProfile!;
  profile.publicKeyY = PUBLIC_TEST_KEY_TWO.publicKeyY;

  await expectCode(
    world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
    'SIGNER_PUBLIC_KEY_MISMATCH'
  );

  // Volver a dejar la metadata consistente: si la entrada hubiese quedado
  // retenida, no habria una segunda lectura. La hay, asi que fue desalojada.
  profile.publicKeyY = PUBLIC_TEST_KEY_ONE.publicKeyY;
  const recovered = await world.resolver.resolveAssertionSignerForIssuer(
    'issuer-uade'
  );

  assert.equal(recovered.address, PUBLIC_TEST_KEY_ONE.address);
  assert.deepEqual(world.secretReads, [
    ASSERTION_SECRET_REF,
    ASSERTION_SECRET_REF
  ]);
});

test('S8c2.1: un anchor NO exige material publico en el cache hit', async () => {
  const world = createConfiguredWorld();

  const first = await world.resolver.resolveAnchorSignerForIssuer(
    'issuer-uade'
  );
  const second = await world.resolver.resolveAnchorSignerForIssuer(
    'issuer-uade'
  );

  // Las tres coordenadas siguen en null y la igualdad de direccion alcanza.
  assert.equal(first.wallet, second.wallet);
  assert.deepEqual(world.secretReads, [ANCHOR_SECRET_REF]);
});

test('S8c2.1: mutar secretRef durante el TTL NO reutiliza la entrada cacheada', async () => {
  const world = createConfiguredWorld();

  const first = await world.resolver.resolveAssertionSignerForIssuer(
    'issuer-uade'
  );
  assert.equal(first.address, PUBLIC_TEST_KEY_ONE.address);
  assert.deepEqual(world.secretReads, [ASSERTION_SECRET_REF]);

  // MISMO profile id, OTRO secretRef, con la MISMA clave detras.
  const rotatedRef = '/scope/test/signers/assert-uade-b';
  world.secrets.set(rotatedRef, PUBLIC_TEST_KEY_ONE.privateKey);
  world.identities.get('issuer-uade')!.assertionSignerProfile!.secretRef =
    rotatedRef;

  const second = await world.resolver.resolveAssertionSignerForIssuer(
    'issuer-uade'
  );

  // Se leyo la referencia NUEVA, no se reutilizo la entrada vieja.
  assert.deepEqual(world.secretReads, [ASSERTION_SECRET_REF, rotatedRef]);
  // Mismo material detras, asi que revalida y resuelve.
  assert.equal(second.address, PUBLIC_TEST_KEY_ONE.address);
  assert.notEqual(first.wallet, second.wallet, 'Wallet reconstruida');
});

test('S8c2.1: si el secretRef nuevo tiene OTRA clave, falla cerrado', async () => {
  const world = createConfiguredWorld();

  await world.resolver.resolveAssertionSignerForIssuer('issuer-uade');

  const rotatedRef = '/scope/test/signers/assert-uade-c';
  world.secrets.set(rotatedRef, PUBLIC_TEST_KEY_TWO.privateKey);
  world.identities.get('issuer-uade')!.assertionSignerProfile!.secretRef =
    rotatedRef;

  await expectCode(
    world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
    'SIGNER_ADDRESS_MISMATCH'
  );
  assert.deepEqual(world.secretReads, [ASSERTION_SECRET_REF, rotatedRef]);
});

test('S8c2.1: si el secretRef nuevo no existe, falla cerrado sin devolver la cacheada', async () => {
  const world = createConfiguredWorld();

  const first = await world.resolver.resolveAssertionSignerForIssuer(
    'issuer-uade'
  );
  assert.ok(first.wallet);

  world.identities.get('issuer-uade')!.assertionSignerProfile!.secretRef =
    '/scope/test/signers/no-existe';

  await expectCode(
    world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
    'SIGNER_SECRET_UNAVAILABLE'
  );
});

test('la cache no se indexa por issuerId: un keyVersion distinto la invalida', async () => {
  const world = createConfiguredWorld();

  await world.resolver.resolveAssertionSignerForIssuer('issuer-uade');

  // Inconsistencia imposible en la practica (el perfil es inmutable), pero si
  // ocurriera la entrada se descarta en vez de devolver algo inconsistente.
  world.identities.get('issuer-uade')!.assertionSignerProfile!.keyVersion = 2;
  await world.resolver.resolveAssertionSignerForIssuer('issuer-uade');

  assert.deepEqual(world.secretReads, [
    ASSERTION_SECRET_REF,
    ASSERTION_SECRET_REF
  ]);
});

// ---------------------------------------------------------------------------
// NO FILTRACION
// ---------------------------------------------------------------------------

test('26: la clave nunca aparece en el error lanzado', async () => {
  const world = createConfiguredWorld();
  const leaked = PUBLIC_TEST_KEY_TWO.privateKey;
  world.secrets.set(ASSERTION_SECRET_REF, leaked);

  const error = await expectCode(
    world.resolver.resolveAssertionSignerForIssuer('issuer-uade'),
    'SIGNER_ADDRESS_MISMATCH'
  );

  const serialized = `${error.message} ${error.stack ?? ''} ${JSON.stringify(
    error,
    Object.getOwnPropertyNames(error)
  )}`;
  assert.ok(!serialized.includes(leaked), 'la clave no debe aparecer');
  assert.ok(!serialized.includes(leaked.slice(2)));
});

test('27: un error ajeno del almacen no se reenvia: se convierte en un error seguro', async () => {
  const prisma = {
    issuerTechnicalIdentity: {
      async findUnique() {
        return {
          status: IssuerTechnicalIdentityStatus.active,
          assertionSignerProfile: assertionProfile()
        };
      }
    }
  } as unknown as PrismaService;

  const resolver = new IssuerSignerResolver(
    prisma,
    {
      async getPrivateKey() {
        // Excepcion cruda tipo SDK, con metadata de infraestructura dentro.
        const raw = new Error(
          'ParameterNotFound: arn:aws:ssm:us-east-1:111122223333:parameter/scope/prod/signers/x requestId=abc'
        );
        raw.name = 'ParameterNotFound';
        throw raw;
      }
    }
  );

  const error = await expectCode(
    resolver.resolveAssertionSignerForIssuer('issuer-uade'),
    'SIGNER_SECRET_UNAVAILABLE'
  );

  assert.doesNotMatch(error.message, /arn:aws/);
  assert.doesNotMatch(error.message, /requestId/);
  assert.doesNotMatch(error.message, /us-east-1/);
  assert.doesNotMatch(error.message, /111122223333/);

  // Solo sobrevive el nombre de la clase, como identificador seguro.
  assert.equal(error.awsErrorName, undefined);
});

test('28: el signer resuelto no expone secretRef, privateKey ni custody', async () => {
  const world = createConfiguredWorld();

  const signer = await world.resolver.resolveAssertionSignerForIssuer(
    'issuer-uade'
  );

  assert.deepEqual(Object.keys(signer).sort(), [
    'address',
    'keyVersion',
    'profileId',
    'purpose',
    'wallet'
  ]);

  const record = signer as unknown as Record<string, unknown>;
  assert.equal(record.secretRef, undefined);
  assert.equal(record.privateKey, undefined);
  assert.equal(record.custody, undefined);
  assert.equal(record.publicKeyX, undefined);
});

test('el objeto resuelto, serializado superficialmente, no arrastra la clave', async () => {
  const world = createConfiguredWorld();

  const signer = await world.resolver.resolveAssertionSignerForIssuer(
    'issuer-uade'
  );

  // `wallet` es un objeto de ethers; lo que se comprueba es que el envoltorio
  // propio no agregue material sensible.
  const shallow = {
    profileId: signer.profileId,
    purpose: signer.purpose,
    keyVersion: signer.keyVersion,
    address: signer.address
  };
  const serialized = JSON.stringify(shallow);

  assert.ok(!serialized.includes(PUBLIC_TEST_KEY_ONE.privateKey));
  assert.ok(!serialized.includes(ASSERTION_SECRET_REF));
});

// ---------------------------------------------------------------------------
// PEREZA
// ---------------------------------------------------------------------------

test('construir el resolver no lee ningun secreto', async () => {
  const world = createConfiguredWorld();

  assert.deepEqual(world.secretReads, []);
  assert.equal(world.findUniqueCalls, 0);

  await world.resolver.resolveAssertionSignerForIssuer('issuer-uade');
  assert.equal(world.secretReads.length, 1);
});

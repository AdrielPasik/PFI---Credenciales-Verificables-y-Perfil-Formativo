/**
 * Resolver publico del DID del issuer -- S8c3.
 *
 * Mismo patron de doble que `did.controller.test.ts`: el fake de Prisma expone
 * UNICAMENTE `findUnique`, asi que si el controller intentara escribir el test
 * explota en vez de pasar por casualidad.
 *
 * Sin AWS, sin SSM, sin secretos, sin Wallet, sin red.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InternalServerErrorException,
  NotFoundException
} from '@nestjs/common';
import { SignerProfilePurpose, SignerProfileStatus } from '@prisma/client';

import {
  PUBLIC_TEST_KEY_ONE,
  PUBLIC_TEST_KEY_TWO
} from '../signing/__fixtures__/signer-test-keys';
import { IssuerDidController } from './issuer-did.controller';
import { IssuerDidDocumentResolver } from './issuer-did-document.resolver';

const ISSUER_A = '3f2a7c18-5b94-4e61-9d0c-8a6f21b4e5d7';
const ISSUER_B = '44444444-4444-4444-8444-444444444444';
const DID_A = `did:web:api.scopeedu.technology:did:issuers:${ISSUER_A}`;
const DID_B = `did:web:api.scopeedu.technology:did:issuers:${ISSUER_B}`;

interface ProfileFixture {
  /** Id del perfil. Por defecto el del perfil vigente de la fixture. */
  id?: string;
  purpose: SignerProfilePurpose;
  status: SignerProfileStatus;
  keyVersion: number;
  publicKeyX: string | null;
  publicKeyY: string | null;
  publicKeyCompressed: string | null;
}

const CURRENT_PROFILE_ID = 'assertion-profile-current';

function profile(overrides: Partial<ProfileFixture> = {}): ProfileFixture {
  return {
    id: CURRENT_PROFILE_ID,
    purpose: SignerProfilePurpose.assertion,
    status: SignerProfileStatus.active,
    keyVersion: 1,
    publicKeyX: PUBLIC_TEST_KEY_ONE.publicKeyX,
    publicKeyY: PUBLIC_TEST_KEY_ONE.publicKeyY,
    publicKeyCompressed: PUBLIC_TEST_KEY_ONE.publicKeyCompressed,
    ...overrides
  };
}

const FORBIDDEN_WRITE = (name: string) => () => {
  throw new Error(`resolver un DID Document no debe invocar ${name}`);
};

/**
 * S8c8: el resolver consulta el PUNTERO VIGENTE mas la HISTORIA de bindings.
 *
 * Las fixtures existentes describen un issuer de una sola clave -- el estado
 * previo a cualquier rotacion -- asi que la historia se sintetiza con ese unico
 * perfil y el puntero apunta a el. Una fixture puede pasar `history` explicita
 * para describir un issuer ya rotado.
 */
function createController(
  identities: Array<{
    issuerId: string;
    did: string;
    assertionSignerProfile: ProfileFixture | null;
    /** Historia completa. Si se omite, es `[assertionSignerProfile]`. */
    history?: ProfileFixture[];
    /** Puntero vigente. Si se omite, es el id de `assertionSignerProfile`. */
    currentProfileId?: string;
  }>
) {
  const findUniqueCalls: unknown[] = [];

  const prisma = {
    issuerTechnicalIdentity: {
      async findUnique(args: {
        where: { issuerId: string };
        select: Record<string, unknown>;
      }) {
        findUniqueCalls.push(args);
        const identity = identities.find(
          (candidate) => candidate.issuerId === args.where.issuerId
        );
        if (!identity) {
          return null;
        }
        const current = identity.assertionSignerProfile;
        const history =
          identity.history ?? (current ? [current] : []);

        return {
          did: identity.did,
          assertionSignerProfileId:
            identity.currentProfileId ?? current?.id ?? CURRENT_PROFILE_ID,
          issuer: {
            assertionKeyBindings: history.map((signerProfile) => ({
              signerProfile
            }))
          }
        };
      },
      create: FORBIDDEN_WRITE('issuerTechnicalIdentity.create'),
      update: FORBIDDEN_WRITE('issuerTechnicalIdentity.update'),
      upsert: FORBIDDEN_WRITE('issuerTechnicalIdentity.upsert'),
      delete: FORBIDDEN_WRITE('issuerTechnicalIdentity.delete')
    },
    issuer: {
      findUnique: FORBIDDEN_WRITE('issuer.findUnique -- no hay fallback legacy'),
      findFirst: FORBIDDEN_WRITE('issuer.findFirst')
    },
    signerProfile: {
      findUnique: FORBIDDEN_WRITE('signerProfile.findUnique')
    },
    user: { findUnique: FORBIDDEN_WRITE('user.findUnique') },
    issuerMembership: { findUnique: FORBIDDEN_WRITE('issuerMembership') },
    platformAdmin: { findUnique: FORBIDDEN_WRITE('platformAdmin') }
  };

  return {
    controller: new IssuerDidController(
      new IssuerDidDocumentResolver(prisma as never)
    ),
    findUniqueCalls
  };
}

const configured = () => [
  { issuerId: ISSUER_A, did: DID_A, assertionSignerProfile: profile() }
];

// ---------------------------------------------------------------------------
// 1-2: PUBLICACION
// ---------------------------------------------------------------------------

test('1: un perfil de asercion activo publica el DID Document exacto', async () => {
  const { controller } = createController(configured());

  const document = await controller.getIssuerDidDocument(ISSUER_A);

  assert.deepEqual(document, {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://www.w3.org/ns/cid/v1'
    ],
    id: DID_A,
    verificationMethod: [
      {
        id: `${DID_A}#assert-1`,
        type: 'JsonWebKey',
        controller: DID_A,
        publicKeyJwk: {
          kty: 'EC',
          crv: 'secp256k1',
          kid: 'assert-1',
          x: 'eb5mfvncu6xVoGKVzocLBwKb_NstzijZWfKBWxb4F5g',
          y: 'SDradyajxGVdpPv8DhEIqP0XtEimhVQZnEfQj_sQ1Lg'
        }
      }
    ],
    assertionMethod: [`${DID_A}#assert-1`]
  });
});

test('2: un perfil RETIRADO y no comprometido se sigue publicando', async () => {
  // S8c8: una clave retirada es, por definicion, una clave HISTORICA -- hay
  // otra vigente. Antes de que existiera la rotacion este test describia un
  // issuer de una sola clave retirada; ahora describe lo que realmente deja
  // una rotacion, que es el estado en el que la propiedad importa.
  const { controller } = createController([
    {
      issuerId: ISSUER_A,
      did: DID_A,
      assertionSignerProfile: profile({
        id: 'assertion-profile-2',
        keyVersion: 2,
        publicKeyX: PUBLIC_TEST_KEY_TWO.publicKeyX,
        publicKeyY: PUBLIC_TEST_KEY_TWO.publicKeyY,
        publicKeyCompressed: PUBLIC_TEST_KEY_TWO.publicKeyCompressed
      }),
      history: [
        profile({ id: 'assertion-profile-1', status: SignerProfileStatus.retired }),
        profile({
          id: 'assertion-profile-2',
          keyVersion: 2,
          publicKeyX: PUBLIC_TEST_KEY_TWO.publicKeyX,
          publicKeyY: PUBLIC_TEST_KEY_TWO.publicKeyY,
          publicKeyCompressed: PUBLIC_TEST_KEY_TWO.publicKeyCompressed
        })
      ],
      currentProfileId: 'assertion-profile-2'
    }
  ]);

  const document = await controller.getIssuerDidDocument(ISSUER_A);

  // Las credentials historicas firmadas con la clave retirada tienen que poder
  // seguir verificandose, asi que #assert-1 sigue publicado junto a #assert-2.
  assert.equal(document.verificationMethod?.length, 2);
  assert.deepEqual(document.assertionMethod, [
    `${DID_A}#assert-1`,
    `${DID_A}#assert-2`
  ]);
});

test('S8c8: una clave VIGENTE retirada es configuracion incoherente', async () => {
  // `retired` significa "no se elige para operaciones nuevas"; el puntero
  // vigente significa exactamente lo contrario. No se reactiva, no se rota en
  // silencio y no se elige otra clave de la historia.
  const { controller } = createController([
    {
      issuerId: ISSUER_A,
      did: DID_A,
      assertionSignerProfile: profile({ status: SignerProfileStatus.retired })
    }
  ]);

  await assert.rejects(
    () => controller.getIssuerDidDocument(ISSUER_A),
    InternalServerErrorException
  );
});

test('3: un perfil COMPROMETIDO -> el DID resuelve, pero sin esa clave', async () => {
  const { controller } = createController([
    {
      issuerId: ISSUER_A,
      did: DID_A,
      assertionSignerProfile: profile({
        status: SignerProfileStatus.compromised
      })
    }
  ]);

  const document = await controller.getIssuerDidDocument(ISSUER_A);

  // El DID sigue existiendo: un verificador concluira
  // VERIFICATION_METHOD_NOT_FOUND -> INVALID, en vez de
  // DID_DOCUMENT_UNAVAILABLE -> INDETERMINATE.
  assert.equal(document.id, DID_A);
  assert.ok(!('verificationMethod' in document));
  assert.ok(!('assertionMethod' in document));
});

test('3b: una clave comprometida con material corrupto tampoco rompe la resolucion', async () => {
  // No se valida lo que no se va a publicar.
  const { controller } = createController([
    {
      issuerId: ISSUER_A,
      did: DID_A,
      assertionSignerProfile: profile({
        status: SignerProfileStatus.compromised,
        publicKeyX: 'basura',
        publicKeyY: null,
        publicKeyCompressed: null,
        keyVersion: 0
      })
    }
  ]);

  const document = await controller.getIssuerDidDocument(ISSUER_A);
  assert.equal(document.id, DID_A);
  assert.ok(!('verificationMethod' in document));
});

// ---------------------------------------------------------------------------
// 4: PROPOSITO
// ---------------------------------------------------------------------------

test('4: un perfil con purpose=anchor NUNCA se publica como assertionMethod', async () => {
  const { controller } = createController([
    {
      issuerId: ISSUER_A,
      did: DID_A,
      assertionSignerProfile: profile({
        purpose: SignerProfilePurpose.anchor
      })
    }
  ]);

  await assert.rejects(
    controller.getIssuerDidDocument(ISSUER_A),
    InternalServerErrorException
  );
});

// ---------------------------------------------------------------------------
// 5-8: AUSENCIA E INCONSISTENCIA
// ---------------------------------------------------------------------------

test('5: sin identidad tecnica -> 404', async () => {
  const { controller } = createController([]);

  await assert.rejects(
    controller.getIssuerDidDocument(ISSUER_A),
    NotFoundException
  );
});

test('6: con Issuer.did legacy pero sin identidad tecnica -> 404, sin fallback', async () => {
  // El doble lanza si alguien consulta `issuer`, asi que un fallback a
  // `Issuer.did` haria fallar el test en vez de pasar silenciosamente.
  const { controller } = createController([]);

  await assert.rejects(
    controller.getIssuerDidDocument(ISSUER_A),
    NotFoundException
  );
});

test('7: un did:example almacenado en la identidad tecnica no se sirve', async () => {
  const { controller } = createController([
    {
      issuerId: ISSUER_A,
      did: 'did:example:issuer-demo',
      assertionSignerProfile: profile()
    }
  ]);

  await assert.rejects(
    controller.getIssuerDidDocument(ISSUER_A),
    NotFoundException
  );
});

test('8: un DID almacenado que no corresponde a la ruta falla cerrado', async () => {
  const cases = [
    DID_B,
    `did:web:api.scopeedu.technology:did:users:${ISSUER_A}`,
    `did:web::did:issuers:${ISSUER_A}`,
    `did:key:z6Mk${ISSUER_A}`,
    ''
  ];

  for (const did of cases) {
    const { controller } = createController([
      { issuerId: ISSUER_A, did, assertionSignerProfile: profile() }
    ]);

    await assert.rejects(
      controller.getIssuerDidDocument(ISSUER_A),
      NotFoundException,
      `deberia rechazar ${JSON.stringify(did)}`
    );
  }
});

test('8b: nunca devuelve un DID corregido o inventado', async () => {
  const { controller } = createController([
    { issuerId: ISSUER_A, did: DID_B, assertionSignerProfile: profile() }
  ]);

  await assert.rejects(async () => {
    const document = await controller.getIssuerDidDocument(ISSUER_A);
    // Si llegara a responder, al menos no debe haber fabricado DID_A.
    assert.notEqual(document.id, DID_A);
    throw new Error('no deberia haber resuelto');
  }, NotFoundException);
});

test('un issuerId vacio se rechaza sin consultar la base', async () => {
  const { controller, findUniqueCalls } = createController(configured());

  await assert.rejects(
    controller.getIssuerDidDocument('   '),
    NotFoundException
  );
  assert.equal(findUniqueCalls.length, 0);
});

// ---------------------------------------------------------------------------
// 9-15: MATERIAL PUBLICO CORRUPTO -> ERROR INTERNO, NO 404
// ---------------------------------------------------------------------------

test('9-15: material publico inconsistente falla cerrado como error interno', async () => {
  const corrupt: Array<[string, Partial<ProfileFixture>]> = [
    ['publicKeyX nula', { publicKeyX: null }],
    ['publicKeyY nula', { publicKeyY: null }],
    ['comprimida nula', { publicKeyCompressed: null }],
    ['publicKeyX mal formada', { publicKeyX: '0xdeadbeef' }],
    ['publicKeyX en mayusculas', { publicKeyX: PUBLIC_TEST_KEY_ONE.publicKeyX.toUpperCase() }],
    ['comprimida mal formada', { publicKeyCompressed: '0x04abc' }],
    [
      'punto fuera de la curva',
      { publicKeyY: `${PUBLIC_TEST_KEY_ONE.publicKeyY.slice(0, -2)}ff` }
    ],
    [
      'comprimida de otra clave',
      { publicKeyCompressed: PUBLIC_TEST_KEY_TWO.publicKeyCompressed }
    ],
    ['keyVersion 0', { keyVersion: 0 }],
    ['keyVersion negativa', { keyVersion: -1 }],
    ['keyVersion no entera', { keyVersion: 1.5 }]
  ];

  for (const [label, overrides] of corrupt) {
    const { controller } = createController([
      {
        issuerId: ISSUER_A,
        did: DID_A,
        assertionSignerProfile: profile(overrides)
      }
    ]);

    await assert.rejects(
      controller.getIssuerDidDocument(ISSUER_A),
      InternalServerErrorException,
      label
    );
  }
});

test('la relacion de asercion ausente es corrupcion interna, no un 404', async () => {
  const { controller } = createController([
    { issuerId: ISSUER_A, did: DID_A, assertionSignerProfile: null }
  ]);

  await assert.rejects(
    controller.getIssuerDidDocument(ISSUER_A),
    InternalServerErrorException
  );
});

test('21: ningun error publico filtra configuracion interna', async () => {
  const { controller } = createController([
    {
      issuerId: ISSUER_A,
      did: DID_A,
      assertionSignerProfile: profile({ publicKeyX: '0xdeadbeef' })
    }
  ]);

  try {
    await controller.getIssuerDidDocument(ISSUER_A);
    throw new Error('deberia haber fallado');
  } catch (error) {
    assert.ok(error instanceof InternalServerErrorException);
    const message = JSON.stringify(error.getResponse());
    assert.doesNotMatch(message, /deadbeef/);
    assert.doesNotMatch(message, /publicKey/i);
    assert.doesNotMatch(message, /SignerProfile/);
    assert.doesNotMatch(message, /prisma/i);
    assert.doesNotMatch(message, /secretRef/i);
  }
});

test('el 404 es uniforme: no distingue "no existe" de "mal configurado"', async () => {
  const { controller: missing } = createController([]);
  const { controller: inconsistent } = createController([
    { issuerId: ISSUER_A, did: DID_B, assertionSignerProfile: profile() }
  ]);

  const messages: string[] = [];
  for (const controller of [missing, inconsistent]) {
    try {
      await controller.getIssuerDidDocument(ISSUER_A);
    } catch (error) {
      messages.push(JSON.stringify((error as NotFoundException).getResponse()));
    }
  }

  assert.equal(messages.length, 2);
  assert.equal(messages[0], messages[1]);
});

// ---------------------------------------------------------------------------
// 16 + 25: FORMA DE LA CONSULTA
// ---------------------------------------------------------------------------

test('16/25: el select es angosto y NUNCA pide secretRef', async () => {
  const { controller, findUniqueCalls } = createController(configured());

  await controller.getIssuerDidDocument(ISSUER_A);

  assert.equal(findUniqueCalls.length, 1);
  assert.deepEqual(findUniqueCalls[0], {
    where: { issuerId: ISSUER_A },
    select: {
      did: true,
      // El PUNTERO VIGENTE, como id: la autoridad de firma nueva no se deriva
      // de la historia.
      assertionSignerProfileId: true,
      // Y la HISTORIA, con metadata PUBLICA unicamente.
      issuer: {
        select: {
          assertionKeyBindings: {
            select: {
              signerProfile: {
                select: {
                  id: true,
                  purpose: true,
                  status: true,
                  keyVersion: true,
                  publicKeyX: true,
                  publicKeyY: true,
                  publicKeyCompressed: true
                }
              }
            }
          }
        }
      }
    }
  });

  // Guard explicito: si un refactor futuro agrega cualquiera de estos campos
  // al select, este test falla.
  const serialized = JSON.stringify(findUniqueCalls[0]);
  for (const forbidden of [
    'secretRef',
    'custody',
    'anchorSignerProfile',
    'addressVerifiedAt',
    'address',
    'walletAddress',
    'user',
    'memberships',
    'issuerMembership',
    'platformAdmin',
    'credentials',
    'email',
    'authorizationStatus'
  ]) {
    assert.ok(
      !serialized.includes(forbidden),
      `el select no debe pedir ${forbidden}`
    );
  }
});

test('la resolucion no ejecuta ninguna escritura ni consulta ajena', async () => {
  // El doble lanza en cualquier metodo de escritura y en issuer/user/
  // membership/platformAdmin/signerProfile.
  const { controller } = createController(configured());
  await controller.getIssuerDidDocument(ISSUER_A);
});

// ---------------------------------------------------------------------------
// 17 + 19: SIN METADATA DE ANCLAJE NI MATERIAL PRIVADO
// ---------------------------------------------------------------------------

test('17/19: la respuesta no contiene metadata de anclaje ni de cuentas', async () => {
  const { controller } = createController(configured());

  const document = await controller.getIssuerDidDocument(ISSUER_A);
  const serialized = JSON.stringify(document);

  for (const forbidden of [
    'anchor',
    'walletAddress',
    'contractAddress',
    'txHash',
    'transactionHash',
    'base_sepolia',
    'base-sepolia',
    'chainId',
    'registrant',
    'blockchainAccountId',
    'eip155',
    'secretRef',
    'privateKey',
    'mnemonic',
    'email',
    'userId',
    'membership',
    'custody'
  ]) {
    assert.ok(
      !serialized.includes(forbidden),
      `la respuesta no debe contener ${forbidden}`
    );
  }
});

// ---------------------------------------------------------------------------
// 8: INDEPENDENCIA DEL ESTADO OPERATIVO
// ---------------------------------------------------------------------------

test('el estado de la identidad tecnica NO condiciona la resolucion del DID', async () => {
  // El select no pide `status` de la identidad tecnica, asi que ni siquiera
  // puede consultarlo: publicar identidad != permiso de emitir. Una credential
  // historica puede seguir necesitando su clave despues de `disabled` o
  // `rotation_required`.
  const { controller, findUniqueCalls } = createController(configured());

  const document = await controller.getIssuerDidDocument(ISSUER_A);
  assert.equal(document.id, DID_A);

  const serialized = JSON.stringify(findUniqueCalls[0]);
  assert.ok(!/"status":true[^}]*assertionSignerProfile/.test(serialized));
  // El unico `status` pedido es el del perfil de firma, que si define
  // publicacion.
  assert.equal((serialized.match(/"status":true/g) ?? []).length, 1);
});

// ---------------------------------------------------------------------------
// S8c8: HISTORIA DE CLAVES DE ASERCION -- items 5-20, A6-A8
// ---------------------------------------------------------------------------

const P1 = 'assertion-profile-1';
const P2 = 'assertion-profile-2';
const P3 = 'assertion-profile-3';

/** Perfil de la historia, con la clave publica del escalar que corresponda. */
function historical(
  id: string,
  keyVersion: number,
  overrides: Partial<ProfileFixture> = {}
): ProfileFixture {
  const key = keyVersion % 2 === 1 ? PUBLIC_TEST_KEY_ONE : PUBLIC_TEST_KEY_TWO;

  return {
    id,
    purpose: SignerProfilePurpose.assertion,
    status: SignerProfileStatus.active,
    keyVersion,
    publicKeyX: key.publicKeyX,
    publicKeyY: key.publicKeyY,
    publicKeyCompressed: key.publicKeyCompressed,
    ...overrides
  };
}

function rotatedIssuer(history: ProfileFixture[], currentProfileId: string) {
  const current = history.find((profile) => profile.id === currentProfileId);

  return createController([
    {
      issuerId: ISSUER_A,
      did: DID_A,
      assertionSignerProfile: current ?? null,
      history,
      currentProfileId
    }
  ]);
}

test('8: tras rotar, el DID publica AMBAS claves en orden de version', async () => {
  const { controller } = rotatedIssuer(
    [
      historical(P2, 2),
      historical(P1, 1, { status: SignerProfileStatus.retired })
    ],
    P2
  );

  const document = await controller.getIssuerDidDocument(ISSUER_A);

  // Orden DETERMINISTA por keyVersion ascendente, aunque la historia venga
  // desordenada. Es presentacion: el orden NO define cual es la vigente.
  assert.deepEqual(document.assertionMethod, [
    `${DID_A}#assert-1`,
    `${DID_A}#assert-2`
  ]);
  assert.deepEqual(
    document.verificationMethod?.map((method) => method.id),
    [`${DID_A}#assert-1`, `${DID_A}#assert-2`]
  );

  // 12: el identificador DID no cambia por rotar, y el documento NO agrega
  // ningun campo "current": publicar una clave significa "autoriza verificar lo
  // que firmo", no "firma lo proximo".
  assert.equal(document.id, DID_A);
  assert.deepEqual(Object.keys(document).sort(), [
    '@context',
    'assertionMethod',
    'id',
    'verificationMethod'
  ]);
});

test('17: tras dos rotaciones el DID publica las TRES claves', async () => {
  const { controller } = rotatedIssuer(
    [
      historical(P1, 1, { status: SignerProfileStatus.retired }),
      historical(P2, 2, { status: SignerProfileStatus.retired }),
      historical(P3, 3)
    ],
    P3
  );

  const document = await controller.getIssuerDidDocument(ISSUER_A);

  assert.deepEqual(document.assertionMethod, [
    `${DID_A}#assert-1`,
    `${DID_A}#assert-2`,
    `${DID_A}#assert-3`
  ]);
});

test('13-15: una clave historica COMPROMETIDA desaparece del DID', async () => {
  const { controller } = rotatedIssuer(
    [
      historical(P1, 1, { status: SignerProfileStatus.compromised }),
      historical(P2, 2)
    ],
    P2
  );

  const document = await controller.getIssuerDidDocument(ISSUER_A);

  // La credencial vieja que referencia #assert-1 pasa a INVALID en S8c7:
  // el DID resuelve BIEN y NO publica esa clave, que es evidencia NEGATIVA.
  assert.deepEqual(document.assertionMethod, [`${DID_A}#assert-2`]);
  assert.equal(document.verificationMethod?.length, 1);
});

test('16: retirada != comprometida -- la retirada se publica, la otra no', async () => {
  const { controller } = rotatedIssuer(
    [
      historical(P1, 1, { status: SignerProfileStatus.retired }),
      historical(P2, 2, { status: SignerProfileStatus.compromised }),
      historical(P3, 3)
    ],
    P3
  );

  const document = await controller.getIssuerDidDocument(ISSUER_A);

  assert.deepEqual(document.assertionMethod, [
    `${DID_A}#assert-1`,
    `${DID_A}#assert-3`
  ]);
});

test('A7: una clave VIGENTE comprometida deja el DID resolviendo con la historica', async () => {
  // Estado de RECUPERACION: cero claves activas, la vigente comprometida, y las
  // retiradas historicas se siguen publicando. Convertir esto en una caida
  // total del DID castigaria al verificador de credentials viejas por un
  // incidente que no las afecta.
  const { controller } = rotatedIssuer(
    [
      historical(P1, 1, { status: SignerProfileStatus.retired }),
      historical(P2, 2, { status: SignerProfileStatus.compromised })
    ],
    P2
  );

  const document = await controller.getIssuerDidDocument(ISSUER_A);

  assert.equal(document.id, DID_A);
  assert.deepEqual(document.assertionMethod, [`${DID_A}#assert-1`]);
});

test('A8: una clave omitida con material corrupto no rompe el DID', async () => {
  const { controller } = rotatedIssuer(
    [
      historical(P1, 1, {
        status: SignerProfileStatus.compromised,
        publicKeyX: 'basura',
        publicKeyY: null,
        publicKeyCompressed: null,
        keyVersion: 0
      }),
      historical(P2, 2)
    ],
    P2
  );

  const document = await controller.getIssuerDidDocument(ISSUER_A);

  // De lo que no se publica no se valida nada.
  assert.deepEqual(document.assertionMethod, [`${DID_A}#assert-2`]);
});

test('A6: una clave vinculada ACTIVA que no es la vigente es incoherente', async () => {
  // `assertionMethod` es autorizacion publica: una clave activa no vigente
  // quedaria plenamente autorizada sin que nadie reclame autoridad de firma
  // sobre ella, y eso difumina la distincion que la slice protege.
  const { controller } = rotatedIssuer(
    [historical(P1, 1), historical(P2, 2)],
    P2
  );

  await assert.rejects(
    () => controller.getIssuerDidDocument(ISSUER_A),
    InternalServerErrorException
  );
});

test('el puntero vigente TIENE que estar en la historia', async () => {
  const { controller } = rotatedIssuer(
    [historical(P1, 1, { status: SignerProfileStatus.retired })],
    'perfil-que-no-esta-en-la-historia'
  );

  await assert.rejects(
    () => controller.getIssuerDidDocument(ISSUER_A),
    InternalServerErrorException
  );
});

test('19: dos claves publicadas con la MISMA version fallan cerrado', async () => {
  // Resolverian al mismo `#assert-N` y un verificador elegiria una por
  // accidente de orden.
  const { controller } = rotatedIssuer(
    [
      historical(P1, 2, { status: SignerProfileStatus.retired }),
      historical(P2, 2)
    ],
    P2
  );

  await assert.rejects(
    () => controller.getIssuerDidDocument(ISSUER_A),
    InternalServerErrorException
  );
});

test('una version no positiva en una clave PUBLICADA falla cerrado', async () => {
  const { controller } = rotatedIssuer(
    [
      historical(P1, 0, { status: SignerProfileStatus.retired }),
      historical(P2, 2)
    ],
    P2
  );

  await assert.rejects(
    () => controller.getIssuerDidDocument(ISSUER_A),
    InternalServerErrorException
  );
});

test('un anchor en la historia de asercion es corrupcion interna', async () => {
  const { controller } = rotatedIssuer(
    [
      historical(P1, 1, {
        status: SignerProfileStatus.retired,
        purpose: SignerProfilePurpose.anchor
      }),
      historical(P2, 2)
    ],
    P2
  );

  await assert.rejects(
    () => controller.getIssuerDidDocument(ISSUER_A),
    InternalServerErrorException
  );
});

test('una historia vacia no publica un documento vacio como si fuera valido', async () => {
  const { controller } = createController([
    {
      issuerId: ISSUER_A,
      did: DID_A,
      assertionSignerProfile: null,
      history: [],
      currentProfileId: P1
    }
  ]);

  await assert.rejects(
    () => controller.getIssuerDidDocument(ISSUER_A),
    InternalServerErrorException
  );
});

test('todas las claves comprometidas -> el DID resuelve SIN propiedades de clave', async () => {
  const { controller } = rotatedIssuer(
    [
      historical(P1, 1, { status: SignerProfileStatus.compromised }),
      historical(P2, 2, { status: SignerProfileStatus.compromised })
    ],
    P2
  );

  const document = await controller.getIssuerDidDocument(ISSUER_A);

  assert.equal(document.id, DID_A);
  assert.ok(!('verificationMethod' in document));
  assert.ok(!('assertionMethod' in document));
});

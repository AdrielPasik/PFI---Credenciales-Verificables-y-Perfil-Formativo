/**
 * Construccion del proof de autoria -- S8c4, matrices 21-29 y 52-57.
 *
 * Reproduce el vector dorado de S8b.1 CAPA POR CAPA: JSON canonico exacto,
 * canonicalHash, texto del envelope, longitud en bytes UTF-8, digest EIP-191,
 * firma y direccion recuperada. Si una sola capa se moviera, el test dice
 * CUAL -- un test que solo mirara la firma final no lo distinguiria.
 *
 * Clave: escalar secp256k1 1, el fixture publico ya compartido con S8b.1 y
 * S8c2 -- PUBLIC TEST KEY / DO NOT FUND / DO NOT USE ON ANY NETWORK.
 *
 * Sin AWS, sin SSM, sin RPC, sin base de datos y sin ningun secreto real: el
 * resolver es un doble que devuelve una Wallet DESCONECTADA.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { SignerProfilePurpose } from '@prisma/client';
import {
  Signature,
  Wallet,
  hashMessage,
  toUtf8Bytes,
  verifyMessage
} from 'ethers';

import { PUBLIC_TEST_KEY_ONE, PUBLIC_TEST_KEY_TWO } from '../signing/__fixtures__/signer-test-keys';
import { SignerResolutionError } from '../signing/signer-resolution.error';
import { CredentialHashingService } from './credential-hashing.service';
import { CredentialProofError } from './credential-proof.error';
import { CredentialProofService } from './credential-proof.service';
import { buildScopeProofV1Envelope } from './scope-proof-v1';

// ---------------------------------------------------------------------------
// VECTOR S8b.1 -- las mismas constantes que congela
// credential-canonicalization-v2.test.ts, reproducidas aqui para que este
// archivo no dependa de otro suite de tests.
// ---------------------------------------------------------------------------

const ISSUER_ID = '3f2a7c18-5b94-4e61-9d0c-8a6f21b4e5d7';
const ISSUER_DID = `did:web:api.scopeedu.technology:did:issuers:${ISSUER_ID}`;
const SUBJECT_DID =
  'did:web:api.scopeedu.technology:did:users:c41d8e92-7a35-4f08-b6e2-19d7c530a84b';

const VECTOR_CANONICAL_HASH =
  '0x9fa83bee0aac884aed8ea28e593d08a858418ac5c4cbca608b2bd37014b1cbca';
const VECTOR_ENVELOPE_UTF8_BYTES = 288;
const VECTOR_EIP191_DIGEST =
  '0xa3955bf42e66bca246b2fdab52202c2a6e92e400332c4cc8b292d5d595e4b019';
const VECTOR_PROOF_VALUE =
  '0x59c5d2831ba95beeb568d98a99d4b4c4c4a0a714e63b3ce06aca16511a1f0532' +
  '21321abd6400ceb3875c05248cb3c32c41d29847aa65d2d71b17336fe662b4c31c';
const VECTOR_RECOVERED_ADDRESS = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

const VECTOR_ENVELOPE =
  'scope-proof-v1\n' +
  'proofPurpose=assertionMethod\n' +
  `verificationMethod=${ISSUER_DID}#assert-1\n` +
  'canonicalizationVersion=canon_v2\n' +
  'hashAlgorithm=sha-256\n' +
  `canonicalHash=${VECTOR_CANONICAL_HASH}`;

function vectorHashingInput() {
  return {
    credentialId: '8d4b1f60-2c73-4a95-8e01-5f7a9b3d6c28',
    schemaVersion: 'credential_v2',
    type: 'course',
    issuerDid: ISSUER_DID,
    subjectDid: SUBJECT_DID,
    title: '  Programación   Avanzada  ',
    description: 'Curso de programación orientada a objetos.',
    issuedAt: new Date('2026-03-15T10:42:17.853Z'),
    hours: 60,
    credentialSubject: {
      achievementName: 'Programación Avanzada',
      institution_name: 'Universidad Argentina de la Empresa (UADE)',
      skills: ['TypeScript', 'álgebra', 'Programación'],
      competencies: ['disẽno de software'],
      grade: '9',
      completionDate: '2026-03-10',
      academicPeriod: '2026-1C'
    }
  };
}

// ---------------------------------------------------------------------------
// DOBLES
// ---------------------------------------------------------------------------

interface ResolverOptions {
  purpose?: SignerProfilePurpose;
  keyVersion?: number;
  privateKey?: string;
  error?: Error;
}

function createProofService(options: ResolverOptions = {}) {
  const resolverCalls: string[] = [];
  const anchorCalls: string[] = [];
  const signMessageInputs: unknown[] = [];

  const wallet = new Wallet(options.privateKey ?? PUBLIC_TEST_KEY_ONE.privateKey);

  const resolver = {
    async resolveAssertionSignerForIssuer(issuerId: string) {
      resolverCalls.push(issuerId);

      if (options.error) {
        throw options.error;
      }

      return {
        profileId: 'signer-profile-1',
        purpose: options.purpose ?? SignerProfilePurpose.assertion,
        keyVersion: options.keyVersion ?? 1,
        address: wallet.address,
        wallet: {
          address: wallet.address,
          signMessage: async (message: unknown) => {
            signMessageInputs.push(message);
            return wallet.signMessage(message as Uint8Array);
          }
        }
      };
    },
    async resolveAnchorSignerForIssuer(issuerId: string) {
      anchorCalls.push(issuerId);
      throw new Error('la autoria nunca resuelve el signer de anclaje');
    }
  };

  return {
    service: new CredentialProofService(resolver as never),
    resolverCalls,
    anchorCalls,
    signMessageInputs,
    walletAddress: wallet.address
  };
}

function expectProofCode(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof CredentialProofError, String(error));
    assert.equal((error as CredentialProofError).code, code);
    return true;
  };
}

// ---------------------------------------------------------------------------
// 21-22: CANON_V2 EXACTO
// ---------------------------------------------------------------------------

test('21-22: el vector dorado reproduce el JSON canonico y el hash congelados', () => {
  const hashing = new CredentialHashingService();
  const result = hashing.createCanonicalHashForVersion(
    vectorHashingInput(),
    CredentialHashingService.CANONICALIZATION_VERSION_V2
  );

  assert.equal(result.canonicalizationVersion, 'canon_v2');
  assert.equal(result.hashAlgorithm, 'sha-256');
  assert.equal(result.canonicalHash, VECTOR_CANONICAL_HASH);
  assert.match(result.canonicalHash, /^0x[0-9a-f]{64}$/);

  // El hash entra en el envelope como TEXTO: su representacion es parte del
  // contrato, no un detalle.
  assert.equal(result.canonicalJson.includes('"credential_id"'), true);
  assert.equal(Buffer.byteLength(result.canonicalJson, 'utf8'), 733);
});

// ---------------------------------------------------------------------------
// 23: ENVELOPE DE 288 BYTES
// ---------------------------------------------------------------------------

test('23: el envelope del vector mide EXACTAMENTE 288 bytes UTF-8', () => {
  const envelope = buildScopeProofV1Envelope({
    verificationMethod: `${ISSUER_DID}#assert-1`,
    canonicalHash: VECTOR_CANONICAL_HASH
  });

  assert.equal(envelope, VECTOR_ENVELOPE);
  assert.equal(Buffer.byteLength(envelope, 'utf8'), VECTOR_ENVELOPE_UTF8_BYTES);
  assert.equal(toUtf8Bytes(envelope).length, VECTOR_ENVELOPE_UTF8_BYTES);
  assert.ok(!envelope.includes('\r'));
  assert.ok(!envelope.endsWith('\n'));
});

// ---------------------------------------------------------------------------
// 24-28: DIGEST, FIRMA, DIRECCION
// ---------------------------------------------------------------------------

test('24: el digest EIP-191 del vector es exacto', () => {
  const digest = hashMessage(toUtf8Bytes(VECTOR_ENVELOPE));

  assert.equal(digest, VECTOR_EIP191_DIGEST);
});

test('25-26: el servicio produce la firma y la direccion congeladas', async () => {
  const { service, walletAddress } = createProofService();

  const signer = await service.prepareAssertionSigner({
    issuerId: ISSUER_ID,
    issuerDid: ISSUER_DID,
    credentialId: 'cred-vector'
  });
  const proof = await service.createProof(
    signer,
    VECTOR_CANONICAL_HASH,
    'cred-vector'
  );

  assert.equal(proof.proofValue, VECTOR_PROOF_VALUE);
  assert.equal(walletAddress, VECTOR_RECOVERED_ADDRESS);
  assert.equal(
    verifyMessage(toUtf8Bytes(VECTOR_ENVELOPE), proof.proofValue),
    VECTOR_RECOVERED_ADDRESS
  );
  assert.equal(proof.verificationMethod, `${ISSUER_DID}#assert-1`);
});

test('27-28: la firma producida es compacta, con v admitido y s canonica', async () => {
  const { service } = createProofService();

  const signer = await service.prepareAssertionSigner({
    issuerId: ISSUER_ID,
    issuerDid: ISSUER_DID,
    credentialId: 'cred-vector'
  });
  const proof = await service.createProof(
    signer,
    VECTOR_CANONICAL_HASH,
    'cred-vector'
  );

  assert.match(proof.proofValue, /^0x[0-9a-f]{130}$/);
  assert.equal(proof.proofValue.length - 2, 130);

  const parsed = Signature.from(proof.proofValue);
  assert.ok(parsed.v === 27 || parsed.v === 28);
  assert.equal(parsed.v, 28);

  const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  assert.ok(BigInt(parsed.s) <= n / 2n, 's debe ser canonica (s <= n/2)');
});

// ---------------------------------------------------------------------------
// 29: SE FIRMAN BYTES, NO TEXTO
// ---------------------------------------------------------------------------

test('29: signMessage recibe BYTES, no el string del envelope', async () => {
  const { service, signMessageInputs } = createProofService();

  const signer = await service.prepareAssertionSigner({
    issuerId: ISSUER_ID,
    issuerDid: ISSUER_DID,
    credentialId: 'cred-vector'
  });
  await service.createProof(signer, VECTOR_CANONICAL_HASH, 'cred-vector');

  assert.equal(signMessageInputs.length, 1);

  const signed = signMessageInputs[0];
  assert.ok(signed instanceof Uint8Array, 'debe ser Uint8Array');
  assert.equal(typeof signed, 'object');
  assert.notEqual(typeof signed, 'string');
  assert.equal((signed as Uint8Array).length, VECTOR_ENVELOPE_UTF8_BYTES);
  assert.equal(
    Buffer.from(signed as Uint8Array).toString('utf8'),
    VECTOR_ENVELOPE
  );
});

test('29b: lo firmado NO es el canonicalHash ni sus bytes crudos', async () => {
  const { service } = createProofService();

  const signer = await service.prepareAssertionSigner({
    issuerId: ISSUER_ID,
    issuerDid: ISSUER_DID,
    credentialId: 'cred-vector'
  });
  const proof = await service.createProof(
    signer,
    VECTOR_CANONICAL_HASH,
    'cred-vector'
  );

  // Firmar el digest desnudo daria una firma SIN separacion de dominio: la
  // misma firma valdria para cualquier otro contexto que reusara ese hash.
  // Las dos formas prohibidas producen digests distintos del real.
  assert.notEqual(hashMessage(VECTOR_CANONICAL_HASH), VECTOR_EIP191_DIGEST);
  assert.notEqual(
    hashMessage(Buffer.from(VECTOR_CANONICAL_HASH.slice(2), 'hex')),
    VECTOR_EIP191_DIGEST
  );

  const wallet = new Wallet(PUBLIC_TEST_KEY_ONE.privateKey);
  assert.notEqual(await wallet.signMessage(VECTOR_CANONICAL_HASH), proof.proofValue);
});

// ---------------------------------------------------------------------------
// 52-57: CONSISTENCIA DE DID
// ---------------------------------------------------------------------------

test('52: sin DID de identidad tecnica no hay proof ni resolucion de signer', async () => {
  for (const missing of [null, undefined, '']) {
    const { service, resolverCalls } = createProofService();

    await assert.rejects(
      service.prepareAssertionSigner({
        issuerId: ISSUER_ID,
        issuerDid: missing,
        credentialId: 'cred-1'
      }),
      expectProofCode('ISSUER_DID_NOT_CONFIGURED'),
      String(missing)
    );

    // La clave del orden: el almacen de secretos NO se toco.
    assert.deepEqual(resolverCalls, [], String(missing));
  }
});

test('53: un DID inconsistente con la ruta del issuer no puede producir proof', async () => {
  const inconsistent = [
    // Otro issuer.
    'did:web:api.scopeedu.technology:did:issuers:11111111-1111-4111-8111-111111111111',
    // Host vacio.
    `did:web::did:issuers:${ISSUER_ID}`,
    // Host con dos puntos adentro.
    `did:web:api.scopeedu.technology:extra:did:issuers:${ISSUER_ID}`,
    // Sin el segmento `did`.
    `did:web:api.scopeedu.technology:issuers:${ISSUER_ID}`,
    // Singular.
    `did:web:api.scopeedu.technology:did:issuer:${ISSUER_ID}`,
    // Ya trae fragmento.
    `${ISSUER_DID}#assert-1`
  ];

  for (const did of inconsistent) {
    const { service, resolverCalls } = createProofService();

    await assert.rejects(
      service.prepareAssertionSigner({
        issuerId: ISSUER_ID,
        issuerDid: did,
        credentialId: 'cred-1'
      }),
      expectProofCode('ISSUER_DID_NOT_RESOLVABLE'),
      did
    );
    assert.deepEqual(resolverCalls, [], did);
  }
});

test('54: una identidad tecnica did:example no puede producir proof', async () => {
  const { service, resolverCalls } = createProofService();

  await assert.rejects(
    service.prepareAssertionSigner({
      issuerId: ISSUER_ID,
      issuerDid: 'did:example:issuer-demo',
      credentialId: 'cred-1'
    }),
    expectProofCode('ISSUER_DID_NOT_RESOLVABLE')
  );
  assert.deepEqual(resolverCalls, []);
});

test('55: un did:web del plano de holders no puede producir proof', async () => {
  const { service, resolverCalls } = createProofService();

  await assert.rejects(
    service.prepareAssertionSigner({
      issuerId: ISSUER_ID,
      issuerDid: `did:web:api.scopeedu.technology:did:users:${ISSUER_ID}`,
      credentialId: 'cred-1'
    }),
    expectProofCode('ISSUER_DID_NOT_RESOLVABLE')
  );
  assert.deepEqual(resolverCalls, []);
});

test('56: el verificationMethod referencia el DID ALMACENADO, no uno recalculado', async () => {
  // Un DID aprovisionado contra OTRO host sigue siendo el almacenado y es la
  // unica autoridad: `PUBLIC_DID_BASE_URL` pudo cambiar desde entonces.
  const storedDid = `did:web:api.otro-host.example:did:issuers:${ISSUER_ID}`;
  const { service } = createProofService({ keyVersion: 3 });

  const signer = await service.prepareAssertionSigner({
    issuerId: ISSUER_ID,
    issuerDid: storedDid,
    credentialId: 'cred-1'
  });

  assert.equal(signer.issuerDid, storedDid);
  assert.equal(signer.verificationMethod, `${storedDid}#assert-3`);
  assert.ok(!signer.verificationMethod.includes('api.scopeedu.technology'));
});

test('57: no se hace ninguna llamada HTTP a /did/issuers durante la emision', async () => {
  // La API no resuelve su propio DID por red: la cadena de consistencia es
  // local. Se intercepta `fetch` global para probarlo de verdad.
  const originalFetch = globalThis.fetch;
  const fetchCalls: unknown[] = [];
  globalThis.fetch = (async (...args: unknown[]) => {
    fetchCalls.push(args);
    throw new Error('la emision no debe hacer requests HTTP');
  }) as typeof fetch;

  try {
    const { service } = createProofService();
    const signer = await service.prepareAssertionSigner({
      issuerId: ISSUER_ID,
      issuerDid: ISSUER_DID,
      credentialId: 'cred-1'
    });
    await service.createProof(signer, VECTOR_CANONICAL_HASH, 'cred-1');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(fetchCalls, []);
});

// ---------------------------------------------------------------------------
// SIGNER: PROPOSITO, VERSION Y ERRORES
// ---------------------------------------------------------------------------

test('solo se usa la clave de ASERCION: la de anclaje nunca se resuelve', async () => {
  const { service, resolverCalls, anchorCalls } = createProofService();

  await service.prepareAssertionSigner({
    issuerId: ISSUER_ID,
    issuerDid: ISSUER_DID,
    credentialId: 'cred-1'
  });

  assert.deepEqual(resolverCalls, [ISSUER_ID]);
  assert.deepEqual(anchorCalls, [], 'la autoria nunca es asunto del anclaje');
});

test('un perfil de ANCLAJE devuelto por el resolver se rechaza defensivamente', async () => {
  const { service } = createProofService({
    purpose: SignerProfilePurpose.anchor
  });

  await assert.rejects(
    service.prepareAssertionSigner({
      issuerId: ISSUER_ID,
      issuerDid: ISSUER_DID,
      credentialId: 'cred-1'
    }),
    expectProofCode('SIGNER_PURPOSE_NOT_ASSERTION')
  );
});

test('una keyVersion imposible no produce un fragmento invalido', async () => {
  for (const keyVersion of [0, -1, 1.5]) {
    const { service } = createProofService({ keyVersion });

    await assert.rejects(
      service.prepareAssertionSigner({
        issuerId: ISSUER_ID,
        issuerDid: ISSUER_DID,
        credentialId: 'cred-1'
      }),
      expectProofCode('INVALID_KEY_VERSION'),
      String(keyVersion)
    );
  }
});

test('un error tipado del resolver se propaga tal cual, sin envolverse', async () => {
  const resolutionError = new SignerResolutionError('SIGNER_SECRET_UNAVAILABLE', {
    issuerId: ISSUER_ID,
    profileId: 'signer-profile-1'
  });
  const { service } = createProofService({ error: resolutionError });

  await assert.rejects(
    service.prepareAssertionSigner({
      issuerId: ISSUER_ID,
      issuerDid: ISSUER_DID,
      credentialId: 'cred-1'
    }),
    (error: unknown) => {
      // La capa de emision necesita el `code` para decidir 409 vs 503.
      assert.equal(error, resolutionError);
      return true;
    }
  );
});

test('un canonicalHash mal formado falla ANTES de firmar', async () => {
  const { service, signMessageInputs } = createProofService();

  const signer = await service.prepareAssertionSigner({
    issuerId: ISSUER_ID,
    issuerDid: ISSUER_DID,
    credentialId: 'cred-1'
  });

  for (const malformed of [
    VECTOR_CANONICAL_HASH.toUpperCase().replace('0X', '0x'),
    VECTOR_CANONICAL_HASH.slice(2),
    '0xabc'
  ]) {
    await assert.rejects(
      service.createProof(signer, malformed, 'cred-1'),
      expectProofCode('MALFORMED_CANONICAL_HASH'),
      malformed
    );
  }

  assert.deepEqual(signMessageInputs, [], 'no se firmo nada');
});

test('otra clave produce otra firma: el proof esta atado a la assertion key', async () => {
  const one = createProofService({ privateKey: PUBLIC_TEST_KEY_ONE.privateKey });
  const two = createProofService({ privateKey: PUBLIC_TEST_KEY_TWO.privateKey });

  const proofOne = await one.service.createProof(
    await one.service.prepareAssertionSigner({
      issuerId: ISSUER_ID,
      issuerDid: ISSUER_DID,
      credentialId: 'cred-1'
    }),
    VECTOR_CANONICAL_HASH,
    'cred-1'
  );
  const proofTwo = await two.service.createProof(
    await two.service.prepareAssertionSigner({
      issuerId: ISSUER_ID,
      issuerDid: ISSUER_DID,
      credentialId: 'cred-1'
    }),
    VECTOR_CANONICAL_HASH,
    'cred-1'
  );

  assert.notEqual(proofOne.proofValue, proofTwo.proofValue);
  assert.equal(
    verifyMessage(toUtf8Bytes(VECTOR_ENVELOPE), proofTwo.proofValue),
    PUBLIC_TEST_KEY_TWO.address
  );
});

test('la firma es DETERMINISTA pero proofValue no es un identificador', async () => {
  const { service } = createProofService();
  const signer = await service.prepareAssertionSigner({
    issuerId: ISSUER_ID,
    issuerDid: ISSUER_DID,
    credentialId: 'cred-1'
  });

  const first = await service.createProof(signer, VECTOR_CANONICAL_HASH, 'cred-a');
  const second = await service.createProof(signer, VECTOR_CANONICAL_HASH, 'cred-b');

  // RFC 6979: misma clave + mismo mensaje -> misma firma. Por eso proofValue
  // NO puede usarse como clave de deduplicacion ni de idempotencia: dos
  // credentials distintas podrian compartirla si compartieran canonicalHash.
  // La identidad sigue siendo Credential.id, que ademas entra en canon_v2.
  assert.equal(first.proofValue, second.proofValue);
});

// ---------------------------------------------------------------------------
// EL SERVICIO NO TOCA CUSTODIA
// ---------------------------------------------------------------------------

test('el servicio nunca lee la clave privada de la Wallet que recibe', async () => {
  const wallet = new Wallet(PUBLIC_TEST_KEY_ONE.privateKey);
  const touched: string[] = [];

  // NO se puede envolver una Wallet de ethers en un Proxy: `signMessage` lee
  // su campo privado `#signingKey`, y a traves del Proxy el `this` es el
  // proxy, que no declara ese campo. Asi que el doble expone SOLO lo que el
  // servicio tiene derecho a usar, y pone trampas que lanzan en el resto.
  const trapWallet = {
    get address() {
      touched.push('address');
      return wallet.address;
    },
    get privateKey(): string {
      touched.push('privateKey');
      throw new Error('el servicio de proof no debe leer la clave privada');
    },
    get signingKey(): never {
      touched.push('signingKey');
      throw new Error('el servicio de proof no debe acceder a la signingKey');
    },
    signMessage: async (message: unknown) => {
      touched.push('signMessage');
      return wallet.signMessage(message as Uint8Array);
    }
  };

  const resolver = {
    async resolveAssertionSignerForIssuer() {
      return {
        profileId: 'signer-profile-1',
        purpose: SignerProfilePurpose.assertion,
        keyVersion: 1,
        address: wallet.address,
        wallet: trapWallet
      };
    }
  };

  const service = new CredentialProofService(resolver as never);
  const signer = await service.prepareAssertionSigner({
    issuerId: ISSUER_ID,
    issuerDid: ISSUER_DID,
    credentialId: 'cred-1'
  });
  const proof = await service.createProof(signer, VECTOR_CANONICAL_HASH, 'cred-1');

  assert.equal(proof.proofValue, VECTOR_PROOF_VALUE);
  assert.deepEqual(touched, ['signMessage']);
  assert.ok(!touched.includes('privateKey'));
  assert.ok(!touched.includes('signingKey'));
});

test('el proof producido no contiene la direccion del signer', async () => {
  const { service, walletAddress } = createProofService();

  const signer = await service.prepareAssertionSigner({
    issuerId: ISSUER_ID,
    issuerDid: ISSUER_DID,
    credentialId: 'cred-1'
  });
  const proof = await service.createProof(signer, VECTOR_CANONICAL_HASH, 'cred-1');

  const serialized = JSON.stringify(proof);
  assert.ok(!serialized.includes(walletAddress));
  assert.ok(!serialized.toLowerCase().includes(walletAddress.toLowerCase()));
  assert.ok(!serialized.includes('signer-profile-1'));
  assert.ok(!serialized.includes(PUBLIC_TEST_KEY_ONE.privateKey));
});

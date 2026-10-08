/**
 * AUTENTICIDAD de credenciales -- S8c7, matriz 1-27.
 *
 * Ninguna red: el DID se resuelve con un doble del resolver LOCAL, no hay HTTP,
 * no hay provider, no hay AWS y no hay blockchain. Las claves son los escalares
 * publicos 1 y 2 (PUBLIC TEST KEY / DO NOT FUND).
 *
 * La distincion que estos tests congelan es INVALID vs INDETERMINATE:
 *
 *   evidencia positiva en contra  -> INVALID
 *   evidencia ausente o inutil    -> INDETERMINATE
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { Wallet, toUtf8Bytes } from 'ethers';

import { CredentialHashingService } from '../credentials/credential-hashing.service';
import { buildScopeProofV1Envelope } from '../credentials/scope-proof-v1';
import { PUBLIC_TEST_KEY_ONE, PUBLIC_TEST_KEY_TWO } from '../signing/__fixtures__/signer-test-keys';
import {
  VECTOR_CANONICAL_HASH,
  VECTOR_ISSUER_DID,
  VECTOR_JWK_X,
  VECTOR_JWK_Y,
  VECTOR_PROOF_VALUE,
  VECTOR_SIGNER_ADDRESS,
  VECTOR_VERIFICATION_METHOD,
  vectorCredentialState,
  vectorDidDocument,
  vectorProof,
  vectorVerificationMethod
} from './__fixtures__/verified-credential.fixture';
import {
  type CredentialAuthenticityInput,
  CredentialAuthenticityVerifier
} from './credential-authenticity.verifier';

type DidResolution =
  | { kind: 'resolved'; document: unknown }
  | { kind: 'not_resolvable' }
  | { kind: 'inconsistent_configuration'; code: string };

function createVerifier(
  resolution: DidResolution | (() => never) = {
    kind: 'resolved',
    document: vectorDidDocument()
  }
) {
  const resolverCalls: string[] = [];

  const resolver = {
    async resolveForIssuer(issuerId: string) {
      resolverCalls.push(issuerId);

      if (typeof resolution === 'function') {
        resolution();
      }

      return resolution;
    }
  };

  return {
    verifier: new CredentialAuthenticityVerifier(
      new CredentialHashingService(),
      resolver as never
    ),
    resolverCalls
  };
}

function state(overrides: Record<string, unknown> = {}) {
  return vectorCredentialState(overrides) as unknown as CredentialAuthenticityInput;
}

/** Firma el envelope del vector con otra clave, produciendo una firma canonica. */
async function signEnvelopeWith(privateKey: string): Promise<string> {
  const envelope = buildScopeProofV1Envelope({
    verificationMethod: VECTOR_VERIFICATION_METHOD,
    canonicalHash: VECTOR_CANONICAL_HASH
  });

  return new Wallet(privateKey).signMessage(toUtf8Bytes(envelope));
}

// ---------------------------------------------------------------------------
// 1: VECTOR GOLDEN
// ---------------------------------------------------------------------------

test('1: el vector golden de S8b.1 verifica como VERIFIED', async () => {
  const { verifier, resolverCalls } = createVerifier();

  const result = await verifier.verify(state());

  assert.equal(result.authenticity, 'VERIFIED');
  assert.equal(result.reason, 'PROOF_VERIFIED');
  // El hash RECALCULADO es el congelado: no se leyo el persistido como verdad.
  assert.equal(result.recomputedCanonicalHash, VECTOR_CANONICAL_HASH);
  assert.equal(result.verificationMethod, VECTOR_VERIFICATION_METHOD);
  // El DID se resolvio LOCALMENTE, una sola vez, por el issuerId.
  assert.deepEqual(resolverCalls, [state().issuerId]);
  // Y la direccion autorizada es la del escalar 1.
  assert.equal(VECTOR_SIGNER_ADDRESS, PUBLIC_TEST_KEY_ONE.address);
});

test('el proofValue del vector es exactamente el congelado en S8c4', () => {
  assert.equal(
    VECTOR_PROOF_VALUE,
    '0x59c5d2831ba95beeb568d98a99d4b4c4c4a0a714e63b3ce06aca16511a1f0532' +
      '21321abd6400ceb3875c05248cb3c32c41d29847aa65d2d71b17336fe662b4c31c'
  );
  assert.equal(
    VECTOR_CANONICAL_HASH,
    '0x9fa83bee0aac884aed8ea28e593d08a858418ac5c4cbca608b2bd37014b1cbca'
  );
  // La JWK del brief, derivada del fixture publico y no copiada aparte.
  assert.equal(VECTOR_JWK_X, 'eb5mfvncu6xVoGKVzocLBwKb_NstzijZWfKBWxb4F5g');
  assert.equal(VECTOR_JWK_Y, 'SDradyajxGVdpPv8DhEIqP0XtEimhVQZnEfQj_sQ1Lg');
});

// ---------------------------------------------------------------------------
// 2: DERIVA ENTRE CONTENIDO Y HASH
// ---------------------------------------------------------------------------

test('2: mutar UN campo canonico sin tocar el hash da INVALID', async () => {
  // Cada mutacion cambia el payload canonico, asi que el hash recalculado deja
  // de reproducir el persistido. El proof queda intacto a proposito.
  const mutations: Array<[string, Record<string, unknown>]> = [
    ['title', { title: 'Programación Básica' }],
    ['hours', { hours: 61 }],
    ['description', { description: 'Otro texto' }],
    ['credentialSubject', {
      credentialSubject: {
        ...(vectorCredentialState().credentialSubject as Record<string, unknown>),
        grade: '10'
      }
    }],
    ['type', { type: 'certification' }],
    ['issuedAt', { issuedAt: new Date('2026-03-15T10:42:18.000Z') }],
    ['credentialId', { credentialId: 'otro-id' }],
    ['subjectDid', { subjectDid: `${VECTOR_ISSUER_DID}-otro` }]
  ];

  for (const [label, override] of mutations) {
    const { verifier, resolverCalls } = createVerifier();
    const result = await verifier.verify(state(override));

    assert.equal(result.authenticity, 'INVALID', label);
    assert.equal(result.reason, 'CANONICAL_HASH_MISMATCH', label);
    // CORTOCIRCUITO: con el hash en contradiccion no hace falta resolver el DID.
    assert.deepEqual(resolverCalls, [], label);
  }
});

test('un canonicalHash persistido ausente o distinto tambien es INVALID', async () => {
  for (const canonicalHash of [null, `0x${'0'.repeat(64)}`, 'no-es-un-hash']) {
    const { verifier } = createVerifier();
    const result = await verifier.verify(state({ canonicalHash }));

    assert.equal(result.authenticity, 'INVALID');
    assert.equal(result.reason, 'CANONICAL_HASH_MISMATCH');
  }
});

test('el hash persistido en MAYUSCULAS sigue reproduciendo', async () => {
  const { verifier } = createVerifier();

  const result = await verifier.verify(
    state({ canonicalHash: VECTOR_CANONICAL_HASH.toUpperCase().replace('0X', '0x') })
  );

  assert.equal(result.authenticity, 'VERIFIED');
});

// ---------------------------------------------------------------------------
// 3-10: CONTRATO DEL proof
// ---------------------------------------------------------------------------

test('3: una credential_v2 sin proof es INVALID', async () => {
  for (const proof of [null, undefined]) {
    const { verifier } = createVerifier();
    const result = await verifier.verify(state({ proof }));

    assert.equal(result.authenticity, 'INVALID');
    assert.equal(result.reason, 'PROOF_MISSING');
  }
});

test('4-10: cualquier desvio del contrato del proof es INVALID', async () => {
  const violations: Array<[string, unknown]> = [
    // 4: campo extra.
    ['campo extra `created`', { ...vectorProof(), created: '2026-03-15T10:42:17Z' }],
    ['campo extra `canonicalHash`', { ...vectorProof(), canonicalHash: VECTOR_CANONICAL_HASH }],
    ['campo extra `jws`', { ...vectorProof(), jws: 'x' }],
    ['campo extra `issuerAddress`', { ...vectorProof(), issuerAddress: VECTOR_SIGNER_ADDRESS }],
    ['campo extra `txHash`', { ...vectorProof(), txHash: `0x${'1'.repeat(64)}` }],
    // 5-10: constante incorrecta.
    ['type', vectorProof({ type: 'DataIntegrityProof' })],
    ['profile', vectorProof({ profile: 'scope-proof-v2' })],
    ['cryptosuite', vectorProof({ cryptosuite: 'ecdsa-secp256k1-recovery2020' })],
    ['proofPurpose', vectorProof({ proofPurpose: 'authentication' })],
    ['canonicalizationVersion', vectorProof({ canonicalizationVersion: 'canon_v1' })],
    ['hashAlgorithm', vectorProof({ hashAlgorithm: 'sha-512' })],
    // Clave faltante.
    ['sin cryptosuite', omit(vectorProof(), 'cryptosuite')],
    ['sin proofValue', omit(vectorProof(), 'proofValue')],
    // Forma equivocada.
    ['un array', [vectorProof()]],
    ['un string', 'proof'],
    ['proofValue no string', vectorProof({ proofValue: 1 })]
  ];

  for (const [label, proof] of violations) {
    const { verifier } = createVerifier();
    const result = await verifier.verify(state({ proof }));

    assert.equal(result.authenticity, 'INVALID', label);
    assert.equal(result.reason, 'PROOF_CONTRACT_VIOLATION', label);
  }
});

// ---------------------------------------------------------------------------
// 11-13: CANONICALIDAD DE LA FIRMA
// ---------------------------------------------------------------------------

test('11-13: un proofValue no canonico es INVALID y nunca lanza', async () => {
  const highS = `0x${'1'.repeat(64)}${'f'.repeat(64)}1b`;
  const zeroS = `0x${'1'.repeat(64)}${'0'.repeat(64)}1b`;

  const malformed: Array<[string, string]> = [
    ['vacio', '0x'],
    ['corto', '0xabcd'],
    ['sin 0x', VECTOR_PROOF_VALUE.slice(2)],
    ['mayusculas', VECTOR_PROOF_VALUE.toUpperCase().replace('0X', '0x')],
    ['65 bytes + 1', `${VECTOR_PROOF_VALUE}ff`],
    ['v = 0', `${VECTOR_PROOF_VALUE.slice(0, -2)}00`],
    ['v = 1b+1 fuera de rango', `${VECTOR_PROOF_VALUE.slice(0, -2)}1d`],
    ['s alta', highS],
    ['s cero', zeroS]
  ];

  for (const [label, proofValue] of malformed) {
    const { verifier } = createVerifier();
    const result = await verifier.verify(
      state({ proof: vectorProof({ proofValue }) })
    );

    assert.equal(result.authenticity, 'INVALID', label);
    assert.equal(result.reason, 'PROOF_VALUE_NOT_CANONICAL', label);
  }
});

// ---------------------------------------------------------------------------
// 14-15: verificationMethod
// ---------------------------------------------------------------------------

test('15: un verificationMethod mal formado es INVALID', async () => {
  const malformed = [
    VECTOR_ISSUER_DID,
    `${VECTOR_ISSUER_DID}#assert-0`,
    `${VECTOR_ISSUER_DID}#assert-01`,
    `${VECTOR_ISSUER_DID}#assert-`,
    `${VECTOR_ISSUER_DID}#anchor-1`,
    `${VECTOR_ISSUER_DID}#c41d8e92-7a35-4f08-b6e2-19d7c530a84b`,
    `${VECTOR_ISSUER_DID}#${VECTOR_SIGNER_ADDRESS}`,
    `did:key:z6Mk#assert-1`,
    '#assert-1',
    ''
  ];

  for (const verificationMethod of malformed) {
    const { verifier, resolverCalls } = createVerifier();
    const result = await verifier.verify(
      state({ proof: vectorProof({ verificationMethod }) })
    );

    assert.equal(result.authenticity, 'INVALID', verificationMethod);
    assert.equal(result.reason, 'VERIFICATION_METHOD_MALFORMED', verificationMethod);
    assert.deepEqual(resolverCalls, [], 'no se resuelve el DID');
  }
});

test('14: un verificationMethod de OTRO issuer es INVALID -- sustitucion', async () => {
  // Firma y hash validos para el issuer A; el DID del metodo apunta a B.
  const otherDid =
    'did:web:api.scopeedu.technology:did:issuers:00000000-0000-4000-8000-000000000000';

  const { verifier, resolverCalls } = createVerifier();
  const result = await verifier.verify(
    state({ proof: vectorProof({ verificationMethod: `${otherDid}#assert-1` }) })
  );

  assert.equal(result.authenticity, 'INVALID');
  assert.equal(result.reason, 'VERIFICATION_METHOD_FOREIGN_DID');
  // No hay aceptacion de claves entre issuers y no se consulta el DID ajeno.
  assert.deepEqual(resolverCalls, []);
});

test('el DID del metodo se compara EXACTO, sin normalizar', async () => {
  const { verifier } = createVerifier();

  const result = await verifier.verify(
    state({
      proof: vectorProof({
        verificationMethod: `${VECTOR_ISSUER_DID.toUpperCase()}#assert-1`
      })
    })
  );

  // En mayusculas ya no es un did:web valido para el patron, asi que falla
  // antes incluso de la comparacion. Lo que importa es que NO se acepta.
  assert.equal(result.authenticity, 'INVALID');
  assert.ok(
    result.reason === 'VERIFICATION_METHOD_MALFORMED' ||
      result.reason === 'VERIFICATION_METHOD_FOREIGN_DID'
  );
});

// ---------------------------------------------------------------------------
// 16-17: INFRAESTRUCTURA DEL DID -> INDETERMINATE
// ---------------------------------------------------------------------------

test('16: un DID que no resuelve da INDETERMINATE, nunca INVALID', async () => {
  const { verifier } = createVerifier({ kind: 'not_resolvable' });

  const result = await verifier.verify(state());

  assert.equal(result.authenticity, 'INDETERMINATE');
  assert.equal(result.reason, 'ISSUER_DID_NOT_RESOLVABLE');
  // El hash SI reprodujo: eso no se pierde por no poder resolver el DID.
  assert.equal(result.recomputedCanonicalHash, VECTOR_CANONICAL_HASH);
});

test('16b: un resolver que LANZA tampoco hace invalida la credencial', async () => {
  const { verifier } = createVerifier(() => {
    throw new Error('ECONNREFUSED 10.0.0.5:5432');
  });

  const result = await verifier.verify(state());

  assert.equal(result.authenticity, 'INDETERMINATE');
  assert.equal(result.reason, 'ISSUER_DID_NOT_RESOLVABLE');
  // El error crudo no viaja en ningun campo del resultado.
  assert.ok(!JSON.stringify(result).includes('ECONNREFUSED'));
  assert.ok(!JSON.stringify(result).includes('10.0.0.5'));
});

test('17: un documento inutilizable da INDETERMINATE', async () => {
  const { verifier } = createVerifier({
    kind: 'inconsistent_configuration',
    code: 'MALFORMED_PUBLIC_KEY_MATERIAL'
  });

  const result = await verifier.verify(state());

  assert.equal(result.authenticity, 'INDETERMINATE');
  assert.equal(result.reason, 'ISSUER_DID_DOCUMENT_UNUSABLE');
});

// ---------------------------------------------------------------------------
// 18-19, 25: AUTORIZACION PUBLICA -> INVALID
// ---------------------------------------------------------------------------

test('18, 25: un DID que resuelve y NO publica la clave referida es INVALID', async () => {
  // Es exactamente la forma de una clave COMPROMETIDA: S8c3 deja el DID
  // resolviendo y OMITE el verificationMethod. Eso es evidencia NEGATIVA.
  const documents: Array<[string, unknown]> = [
    ['sin propiedades de clave', { id: VECTOR_ISSUER_DID }],
    ['lista vacia', vectorDidDocument({ verificationMethod: [], assertionMethod: [] })],
    [
      'otra keyVersion publicada',
      vectorDidDocument({
        verificationMethod: [
          vectorVerificationMethod({ id: `${VECTOR_ISSUER_DID}#assert-2` })
        ],
        assertionMethod: [`${VECTOR_ISSUER_DID}#assert-2`]
      })
    ]
  ];

  for (const [label, document] of documents) {
    const { verifier } = createVerifier({ kind: 'resolved', document });
    const result = await verifier.verify(state());

    assert.equal(result.authenticity, 'INVALID', label);
    assert.equal(result.reason, 'ASSERTION_KEY_NOT_PUBLISHED', label);
  }
});

test('19: presencia NO es autorizacion -- fuera de assertionMethod es INVALID', async () => {
  const { verifier } = createVerifier({
    kind: 'resolved',
    document: vectorDidDocument({ assertionMethod: [] })
  });

  const result = await verifier.verify(state());

  assert.equal(result.authenticity, 'INVALID');
  assert.equal(result.reason, 'ASSERTION_KEY_NOT_AUTHORIZED');
});

test('se selecciona el verificationMethod REFERIDO, no el primero ni el ultimo', async () => {
  // Documento multi-clave, como el que S8c8 va a publicar. La clave correcta
  // esta en el medio y rodeada de otras validas.
  const other = (keyVersion: number, address: string) => ({
    id: `${VECTOR_ISSUER_DID}#assert-${keyVersion}`,
    type: 'JsonWebKey',
    controller: VECTOR_ISSUER_DID,
    publicKeyJwk: {
      kty: 'EC',
      crv: 'secp256k1',
      kid: `assert-${keyVersion}`,
      x: Buffer.from(PUBLIC_TEST_KEY_TWO.publicKeyX.slice(2), 'hex').toString('base64url'),
      y: Buffer.from(PUBLIC_TEST_KEY_TWO.publicKeyY.slice(2), 'hex').toString('base64url')
    },
    address
  });

  const { verifier } = createVerifier({
    kind: 'resolved',
    document: vectorDidDocument({
      verificationMethod: [
        other(9, PUBLIC_TEST_KEY_TWO.address),
        vectorVerificationMethod(),
        other(7, PUBLIC_TEST_KEY_TWO.address)
      ],
      assertionMethod: [
        `${VECTOR_ISSUER_DID}#assert-9`,
        VECTOR_VERIFICATION_METHOD,
        `${VECTOR_ISSUER_DID}#assert-7`
      ]
    })
  });

  const result = await verifier.verify(state());

  // Si eligiera la primera o la de keyVersion mas alta, la firma no cerraria.
  assert.equal(result.authenticity, 'VERIFIED');
});

// ---------------------------------------------------------------------------
// 20-22: MATERIAL PUBLICO INUTILIZABLE -> INDETERMINATE
// ---------------------------------------------------------------------------

test('20-22: una JWK inutilizable da INDETERMINATE, no INVALID', async () => {
  const unusable: Array<[string, Record<string, unknown>]> = [
    // 20: el verificationMethod en si.
    ['type incorrecto', vectorVerificationMethod({ type: 'Multikey' })],
    ['controller ajeno', vectorVerificationMethod({ controller: 'did:web:otro' })],
    ['sin publicKeyJwk', omit(vectorVerificationMethod(), 'publicKeyJwk')],
    ['publicKeyJwk no objeto', vectorVerificationMethod({ publicKeyJwk: 'x' })],
    // 21: la JWK.
    ['kty incorrecto', jwk({ kty: 'OKP' })],
    ['crv incorrecto', jwk({ crv: 'P-256' })],
    ['kid incorrecto', jwk({ kid: 'assert-2' })],
    ['kid con #', jwk({ kid: '#assert-1' })],
    ['con material privado `d`', jwk({ d: 'x'.repeat(43) })],
    ['x ausente', jwk({ x: undefined })],
    ['x con padding', jwk({ x: `${VECTOR_JWK_X.slice(0, 42)}=` })],
    ['x en base64 estandar', jwk({ x: VECTOR_JWK_X.replace(/-/g, '+').replace(/_/g, '/') })],
    ['x de otro largo', jwk({ x: VECTOR_JWK_X.slice(0, 40) })],
    ['x no canonica (bits de relleno)', jwk({ x: `${VECTOR_JWK_X.slice(0, 42)}h` })],
    // 22: fuera de la curva.
    ['x/y fuera de la curva', jwk({ x: VECTOR_JWK_Y, y: VECTOR_JWK_X })],
    ['x/y en cero', jwk({ x: 'A'.repeat(43), y: 'A'.repeat(43) })]
  ];

  for (const [label, method] of unusable) {
    const { verifier } = createVerifier({
      kind: 'resolved',
      document: vectorDidDocument({
        verificationMethod: [method],
        assertionMethod: [VECTOR_VERIFICATION_METHOD]
      })
    });

    const result = await verifier.verify(state());

    assert.equal(result.authenticity, 'INDETERMINATE', label);
    assert.equal(result.reason, 'ASSERTION_KEY_MATERIAL_UNUSABLE', label);
  }
});

// ---------------------------------------------------------------------------
// 23: LA DIRECCION SALE DE LA JWK, NO DE SignerProfile
// ---------------------------------------------------------------------------

test('23: una firma de OTRA clave autorizada es INVALID', async () => {
  // El documento publica la clave 1; el proof lo firmo la clave 2, con una
  // firma perfectamente canonica. La direccion esperada se DERIVA de la JWK.
  const { verifier } = createVerifier();
  const foreignSignature = await signEnvelopeWith(PUBLIC_TEST_KEY_TWO.privateKey);

  const result = await verifier.verify(
    state({ proof: vectorProof({ proofValue: foreignSignature }) })
  );

  assert.equal(result.authenticity, 'INVALID');
  assert.equal(result.reason, 'SIGNATURE_MISMATCH');
});

test('el documento publica la clave 2 y el proof del vector deja de cerrar', async () => {
  const { verifier } = createVerifier({
    kind: 'resolved',
    document: vectorDidDocument({
      verificationMethod: [
        vectorVerificationMethod({
          publicKeyJwk: {
            kty: 'EC',
            crv: 'secp256k1',
            kid: 'assert-1',
            x: Buffer.from(PUBLIC_TEST_KEY_TWO.publicKeyX.slice(2), 'hex').toString('base64url'),
            y: Buffer.from(PUBLIC_TEST_KEY_TWO.publicKeyY.slice(2), 'hex').toString('base64url')
          }
        })
      ],
      assertionMethod: [VECTOR_VERIFICATION_METHOD]
    })
  });

  const result = await verifier.verify(state());

  assert.equal(result.authenticity, 'INVALID');
  assert.equal(result.reason, 'SIGNATURE_MISMATCH');
});

// ---------------------------------------------------------------------------
// 24: CLAVE RETIRADA PERO PUBLICADA
// ---------------------------------------------------------------------------

test('24: una clave RETIRADA que el DID sigue publicando verifica', async () => {
  // El resolver es el de S8c3: `retired` se publica igual. El verificador no
  // pregunta por el estado interno del SignerProfile -- solo por lo que el DID
  // autoriza publicamente -- asi que las credenciales historicas siguen
  // verificando despues de una rotacion administrativa.
  const { verifier } = createVerifier();

  const result = await verifier.verify(state());

  assert.equal(result.authenticity, 'VERIFIED');
});

// ---------------------------------------------------------------------------
// 26-27 + ADDENDUM A: DESPACHO POR VERSION DECLARADA
// ---------------------------------------------------------------------------

test('26: credential_v1 con proof null es INDETERMINATE, no INVALID', async () => {
  const { verifier, resolverCalls } = createVerifier();

  const result = await verifier.verify(
    state({
      schemaVersion: 'credential_v1',
      canonicalizationVersion: 'canon_v1',
      canonicalHash: `0x${'a'.repeat(64)}`,
      proof: null
    })
  );

  assert.equal(result.authenticity, 'INDETERMINATE');
  assert.equal(result.reason, 'LEGACY_UNSIGNED_CREDENTIAL');
  // Ni recalculo, ni DID, ni firma: la version declarada ya decidio.
  assert.equal(result.recomputedCanonicalHash, null);
  assert.deepEqual(resolverCalls, []);
});

test('27 / addendum A.1: credential_v1 CON proof JSON no se asciende a v2', async () => {
  // Un proof perfectamente valido en una fila declarada v1 NO la convierte en
  // v2: deducir el protocolo de la presencia del dato es como se construyen
  // las confusiones de version.
  const { verifier } = createVerifier();

  const result = await verifier.verify(
    state({ schemaVersion: 'credential_v1', canonicalizationVersion: 'canon_v1' })
  );

  assert.equal(result.authenticity, 'INDETERMINATE');
  assert.equal(result.reason, 'LEGACY_UNSIGNED_CREDENTIAL');
  assert.notEqual(result.authenticity, 'VERIFIED');
});

test('addendum A.2: credential_v2 con canon_v1 es INVALID, no fallback legacy', async () => {
  const { verifier } = createVerifier();

  const result = await verifier.verify(
    state({ canonicalizationVersion: 'canon_v1' })
  );

  assert.equal(result.authenticity, 'INVALID');
  assert.equal(result.reason, 'CANONICALIZATION_VERSION_INCONSISTENT');
});

test('addendum A.2b: credential_v2 sin canonicalizationVersion es INVALID', async () => {
  const { verifier } = createVerifier();

  const result = await verifier.verify(state({ canonicalizationVersion: null }));

  assert.equal(result.authenticity, 'INVALID');
  assert.equal(result.reason, 'CANONICALIZATION_VERSION_INCONSISTENT');
});

test('addendum A.3: una version desconocida es INDETERMINATE, no INVALID', async () => {
  for (const schemaVersion of ['credential_v3', 'credential_v10', '', 'otro']) {
    const { verifier, resolverCalls } = createVerifier();
    const result = await verifier.verify(state({ schemaVersion }));

    assert.equal(result.authenticity, 'INDETERMINATE', schemaVersion);
    assert.equal(result.reason, 'UNSUPPORTED_CREDENTIAL_VERSION', schemaVersion);
    // No se intenta verificar como v2.
    assert.deepEqual(resolverCalls, [], schemaVersion);
  }
});

// ---------------------------------------------------------------------------
// PAYLOAD CANONICO IRREPRODUCIBLE
// ---------------------------------------------------------------------------

test('una v2 cuyo payload canonico no se puede reconstruir es INVALID', async () => {
  const unreproducible: Array<[string, Record<string, unknown>]> = [
    ['sin DID tecnico del issuer', { issuerTechnicalDid: null }],
    ['sin DID del holder', { subjectDid: null }],
    ['sin issuedAt', { issuedAt: null }],
    ['credentialSubject no objeto', { credentialSubject: null }],
    ['credentialSubject array', { credentialSubject: [] }],
    ['title vacio', { title: '   ' }]
  ];

  for (const [label, override] of unreproducible) {
    const { verifier } = createVerifier();
    const result = await verifier.verify(state(override));

    assert.equal(result.authenticity, 'INVALID', label);
    assert.ok(
      result.reason === 'CANONICAL_PAYLOAD_UNREPRODUCIBLE' ||
        result.reason === 'CANONICAL_HASH_MISMATCH',
      `${label}: ${result.reason}`
    );
  }
});

test('un artefacto mal formado nunca propaga una excepcion al llamador', async () => {
  // La ruta publica no puede devolver 400 ni 500 porque el dato almacenado sea
  // malo: el servicio de hashing lanza BadRequestException y se captura.
  const { verifier } = createVerifier();

  const result = await verifier.verify(state({ title: '' }));

  assert.ok(['INVALID', 'INDETERMINATE'].includes(result.authenticity));
});

// ---------------------------------------------------------------------------
// SIN CLAVES PRIVADAS
// ---------------------------------------------------------------------------

test('el resultado nunca contiene material privado ni direcciones de perfil', async () => {
  const { verifier } = createVerifier();

  const serialized = JSON.stringify(await verifier.verify(state()));

  for (const forbidden of [
    PUBLIC_TEST_KEY_ONE.privateKey,
    PUBLIC_TEST_KEY_TWO.privateKey,
    'secretRef',
    'privateKey'
  ]) {
    assert.ok(!serialized.includes(forbidden), forbidden);
  }
});

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function omit(value: Record<string, unknown>, key: string) {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

function jwk(overrides: Record<string, unknown>) {
  const base = {
    kty: 'EC',
    crv: 'secp256k1',
    kid: 'assert-1',
    x: VECTOR_JWK_X,
    y: VECTOR_JWK_Y
  };
  const merged: Record<string, unknown> = { ...base, ...overrides };

  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) {
      delete merged[key];
    }
  }

  return vectorVerificationMethod({ publicKeyJwk: merged });
}

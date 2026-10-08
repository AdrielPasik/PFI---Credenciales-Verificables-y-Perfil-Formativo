/**
 * Orquestacion de la verificacion publica -- S8c7, matriz 59-72 y 60-64.
 *
 * Se arma con los componentes REALES -- verificador de autenticidad, lector de
 * evidencia, resolver de deployment y las dos funciones puras -- y solo se
 * doblan los bordes: Prisma, el resolver de DID y el cliente de lectura de la
 * cadena. Asi lo que se prueba es el comportamiento del sistema y no un mock
 * complaciente.
 *
 * El doble de Prisma LANZA en `create`, `update`, `updateMany`, `delete` y
 * `upsert`, de modo que "la verificacion publica no escribe" es una propiedad
 * verificada y no una promesa.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BlockchainNetwork, BlockchainRecordStatus } from '@prisma/client';

import { CredentialRegistryDeploymentResolver } from '../blockchain/credential-registry-deployment';
import { CredentialHashingService } from '../credentials/credential-hashing.service';
import { PUBLIC_TEST_KEY_ONE, PUBLIC_TEST_KEY_TWO } from '../signing/__fixtures__/signer-test-keys';
import {
  VECTOR_CANONICAL_HASH,
  VECTOR_ISSUER_DID,
  VECTOR_SUBJECT_DID,
  vectorCredentialState,
  vectorDidDocument,
  vectorProof
} from './__fixtures__/verified-credential.fixture';
import { CredentialAuthenticityVerifier } from './credential-authenticity.verifier';
import { CredentialBlockchainEvidenceReader } from './credential-blockchain-evidence.reader';
import { VerificationService } from './verification.service';

const CONTRACT_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const MOCK_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000001';
const ANCHOR_ADDRESS = PUBLIC_TEST_KEY_ONE.address;
const DEPLOYMENT_ID = 'test-base-sepolia-pending-deploy';
const RPC_URL = 'https://provider.example/v2/SECRET_API_KEY';

const BASE_SEPOLIA_ENV = {
  BLOCKCHAIN_EVIDENCE_MODE: 'credential_registry',
  CREDENTIAL_REGISTRY_NETWORK: 'base_sepolia',
  CREDENTIAL_REGISTRY_CHAIN_ID: '84532',
  CREDENTIAL_REGISTRY_RPC_URL: RPC_URL,
  CREDENTIAL_REGISTRY_CONTRACT_ADDRESS: CONTRACT_ADDRESS,
  CREDENTIAL_REGISTRY_DEPLOYMENT_ID: DEPLOYMENT_ID
};

// ---------------------------------------------------------------------------
// FILAS
// ---------------------------------------------------------------------------

function registeredRecord(overrides: Record<string, unknown> = {}) {
  return {
    network: BlockchainNetwork.base_sepolia,
    chainId: 84532,
    contractAddress: CONTRACT_ADDRESS,
    credentialHash: VECTOR_CANONICAL_HASH,
    txHash: `0x${'b'.repeat(64)}`,
    status: BlockchainRecordStatus.registered,
    registeredAt: new Date('2026-03-31T23:33:20.000Z'),
    issuerAddress: ANCHOR_ADDRESS,
    anchorSignerProfileId: 'anchor-profile-1',
    anchorSignerProfile: { address: ANCHOR_ADDRESS },
    ...overrides
  };
}

function pendingRecord(overrides: Record<string, unknown> = {}) {
  return registeredRecord({
    status: BlockchainRecordStatus.pending,
    // S8c6: los tres hechos de cadena son NULL mientras el intent esta
    // pendiente. La respuesta publica tiene que serializarlos sin romperse.
    txHash: null,
    registeredAt: null,
    issuerAddress: null,
    ...overrides
  });
}

function mockEvidenceRecord(overrides: Record<string, unknown> = {}) {
  return registeredRecord({
    network: BlockchainNetwork.anvil,
    chainId: 31337,
    contractAddress: MOCK_CONTRACT_ADDRESS,
    anchorSignerProfileId: null,
    anchorSignerProfile: null,
    ...overrides
  });
}

/** Credencial v2 que verifica, con el vector golden. */
function v2Credential(overrides: Record<string, unknown> = {}) {
  const canonical = vectorCredentialState();

  return {
    id: canonical.credentialId,
    status: 'issued',
    schemaVersion: 'credential_v2',
    type: canonical.type,
    title: canonical.title,
    description: canonical.description,
    hours: canonical.hours,
    credentialSubject: canonical.credentialSubject,
    issuedAt: canonical.issuedAt,
    revokedAt: null,
    revocationReason: null,
    canonicalHash: VECTOR_CANONICAL_HASH,
    canonicalizationVersion: 'canon_v2',
    proof: vectorProof(),
    issuerId: canonical.issuerId,
    issuer: {
      name: 'Institución Demo',
      did: 'did:example:issuer',
      technicalIdentity: { did: VECTOR_ISSUER_DID }
    },
    subjectUser: {
      displayName: 'Titular Demo',
      firstName: 'Titular',
      lastName: 'Demo',
      did: VECTOR_SUBJECT_DID
    },
    _count: { blockchainRecords: 1 },
    blockchainRecords: [registeredRecord()],
    ...overrides
  };
}

/** credential_v1 legitima: canon_v1, sin proof. Nunca se firmo. */
function legacyV1Credential(overrides: Record<string, unknown> = {}) {
  return v2Credential({
    schemaVersion: 'credential_v1',
    canonicalizationVersion: 'canon_v1',
    canonicalHash: `0x${'a'.repeat(64)}`,
    proof: null,
    blockchainRecords: [mockEvidenceRecord({ credentialHash: `0x${'a'.repeat(64)}` })],
    ...overrides
  });
}

// ---------------------------------------------------------------------------
// HARNESS
// ---------------------------------------------------------------------------

type DidResolution =
  | { kind: 'resolved'; document: unknown }
  | { kind: 'not_resolvable' }
  | { kind: 'inconsistent_configuration'; code: string };

function createContext(options: {
  credential?: Record<string, unknown> | null;
  did?: DidResolution;
  chainResult?: { kind: string; status?: Record<string, unknown> };
  environment?: Record<string, string>;
} = {}) {
  const credential =
    options.credential === undefined ? v2Credential() : options.credential;

  const calls = {
    findUnique: [] as Array<Record<string, unknown>>,
    mutations: [] as string[],
    chainReads: [] as Array<Record<string, unknown>>
  };

  /** Cualquier mutacion es un fallo del test, no un efecto tolerado. */
  const forbidMutation = (name: string) => async () => {
    calls.mutations.push(name);
    throw new Error(`la verificacion publica no debe llamar a ${name}`);
  };

  const mutationMethods = {
    create: forbidMutation('create'),
    createMany: forbidMutation('createMany'),
    update: forbidMutation('update'),
    updateMany: forbidMutation('updateMany'),
    delete: forbidMutation('delete'),
    deleteMany: forbidMutation('deleteMany'),
    upsert: forbidMutation('upsert')
  };

  const prisma = {
    credential: {
      async findUnique(args: Record<string, unknown>) {
        calls.findUnique.push(args);
        return credential;
      },
      ...mutationMethods
    },
    blockchainRecord: { ...mutationMethods },
    signerProfile: { ...mutationMethods },
    issuerTechnicalIdentity: { ...mutationMethods },
    async $transaction() {
      calls.mutations.push('$transaction');
      throw new Error('la verificacion publica no abre transacciones');
    },
    async $executeRaw() {
      calls.mutations.push('$executeRaw');
      throw new Error('la verificacion publica no ejecuta SQL crudo');
    }
  };

  const didResolver = {
    async resolveForIssuer() {
      return options.did ?? { kind: 'resolved', document: vectorDidDocument() };
    }
  };

  const readClient = {
    async readTargetBoundCredentialState(input: Record<string, unknown>) {
      calls.chainReads.push(input);
      return (
        options.chainResult ?? {
          kind: 'credential_state',
          status: { exists: true, revoked: false, issuer: ANCHOR_ADDRESS }
        }
      );
    }
  };

  const deploymentResolver = new (class extends CredentialRegistryDeploymentResolver {
    override resolve(record: never) {
      return super.resolve(record, options.environment ?? BASE_SEPOLIA_ENV);
    }
  })();

  const service = new VerificationService(
    prisma as never,
    new CredentialAuthenticityVerifier(
      new CredentialHashingService(),
      didResolver as never
    ),
    new CredentialBlockchainEvidenceReader(
      deploymentResolver,
      readClient as never
    )
  );

  return { service, calls };
}

// ---------------------------------------------------------------------------
// 65: CAMINO COMPLETO
// ---------------------------------------------------------------------------

test('65: una v2 valida y registrada devuelve las CUATRO dimensiones', async () => {
  const { service, calls } = createContext();

  const response = await service.getCredentialVerification(v2Credential().id as string);

  assert.equal(response.verification.headline, 'VERIFIED');
  assert.equal(response.verification.authenticity.result, 'VERIFIED');
  assert.equal(response.verification.authenticity.reason, 'PROOF_VERIFIED');
  assert.equal(response.verification.credentialStatus, 'ACTIVE');
  assert.equal(response.verification.blockchainEvidence.result, 'REGISTERED');
  assert.equal(
    response.verification.blockchainEvidence.reason,
    'CHAIN_STATE_OBSERVED'
  );
  // Y la proyeccion de compatibilidad.
  assert.equal(response.verification.result, 'valid_issued');
  // El DID tecnico se expone aparte del legacy, sin redefinirlo.
  assert.equal(response.issuer.technicalDid, VECTOR_ISSUER_DID);
  assert.equal(response.issuer.did, 'did:example:issuer');
  // Y nada se escribio.
  assert.deepEqual(calls.mutations, []);
});

// ---------------------------------------------------------------------------
// 59-64: INDEPENDENCIA DE LAS DIMENSIONES
// ---------------------------------------------------------------------------

test('59-60: una firma valida sigue VERIFIED con la cadena caida o ausente', async () => {
  const cases: Array<[string, string, string]> = [
    ['rpc caido', 'rpc_unavailable', 'UNAVAILABLE'],
    ['no registrado', 'credential_missing', 'NOT_FOUND'],
    ['registrante inesperado', 'credential_issuer_mismatch', 'REGISTRANT_UNEXPECTED']
  ];

  for (const [label, kind, expectedEvidence] of cases) {
    const { service } = createContext({ chainResult: { kind } });
    const response = await service.getCredentialVerification('x');

    // La autenticidad NO depende del RPC.
    assert.equal(response.verification.authenticity.result, 'VERIFIED', label);
    assert.equal(
      response.verification.blockchainEvidence.result,
      expectedEvidence,
      label
    );
    // Y el estado tampoco se degrada.
    assert.equal(response.verification.credentialStatus, 'ACTIVE', label);
  }
});

test('61-62: una firma mala sigue INVALID aunque la cadena la registre o revoque', async () => {
  const chainResults = [
    { kind: 'credential_state', status: { exists: true, revoked: false, issuer: ANCHOR_ADDRESS } },
    { kind: 'credential_state', status: { exists: true, revoked: true, issuer: ANCHOR_ADDRESS } }
  ];

  for (const chainResult of chainResults) {
    const { service } = createContext({
      // Hash persistido que el contenido no reproduce.
      credential: v2Credential({ title: 'Otro titulo' }),
      chainResult
    });

    const response = await service.getCredentialVerification('x');

    assert.equal(response.verification.authenticity.result, 'INVALID');
    assert.equal(response.verification.authenticity.reason, 'CANONICAL_HASH_MISMATCH');
    // 57-58: INVALID gana sobre cualquier titular.
    assert.equal(response.verification.headline, 'INVALID');
    assert.equal(response.verification.result, 'not_verifiable');
  }
});

test('63: un DID indisponible deja la evidencia de cadena intacta', async () => {
  const { service } = createContext({ did: { kind: 'not_resolvable' } });

  const response = await service.getCredentialVerification('x');

  assert.equal(response.verification.authenticity.result, 'INDETERMINATE');
  assert.equal(
    response.verification.authenticity.reason,
    'ISSUER_DID_NOT_RESOLVABLE'
  );
  // La otra dimension se evaluo igual: siguen siendo preguntas distintas.
  assert.equal(response.verification.blockchainEvidence.result, 'REGISTERED');
  assert.equal(response.verification.headline, 'INDETERMINATE');
});

test('64: una v1 legacy con evidencia en cadena sigue INDETERMINATE', async () => {
  const { service } = createContext({
    credential: legacyV1Credential({
      blockchainRecords: [registeredRecord({ credentialHash: `0x${'a'.repeat(64)}` })]
    })
  });

  const response = await service.getCredentialVerification('x');

  assert.equal(response.verification.authenticity.result, 'INDETERMINATE');
  assert.equal(
    response.verification.authenticity.reason,
    'LEGACY_UNSIGNED_CREDENTIAL'
  );
  // Una credencial sin firmar NO se asciende a VERIFIED porque la cadena tenga
  // su hash.
  assert.equal(response.verification.headline, 'INDETERMINATE');
  assert.notEqual(response.verification.headline, 'VERIFIED');
});

// ---------------------------------------------------------------------------
// 61: COPY DE LA v1 LEGACY
// ---------------------------------------------------------------------------

test('61: la v1 legacy se describe como formato anterior, NO como invalida', async () => {
  const { service } = createContext({ credential: legacyV1Credential() });

  const response = await service.getCredentialVerification('x');

  assert.equal(response.verification.authenticity.result, 'INDETERMINATE');
  assert.equal(response.verification.headline, 'INDETERMINATE');
  assert.equal(response.verification.result, 'not_verifiable');

  const summary = response.verification.summary;
  // Dice lo que pasa: formato anterior, sin prueba criptografica de autoria.
  assert.match(summary, /versión anterior de Scope/);
  assert.match(summary, /prueba criptográfica de autoría/);
  // Y NO la trata como dañada, ni como un error.
  for (const forbidden of ['inválida', 'invalida', 'error', 'firma inválida', 'dañada']) {
    assert.ok(
      !summary.toLowerCase().includes(forbidden.toLowerCase()),
      `el texto legacy no debe decir "${forbidden}": ${summary}`
    );
  }
});

test('una v2 positivamente invalida usa OTRO texto que la legacy', async () => {
  const legacy = await createContext({
    credential: legacyV1Credential()
  }).service.getCredentialVerification('x');

  const broken = await createContext({
    credential: v2Credential({ title: 'Otro titulo' })
  }).service.getCredentialVerification('x');

  assert.notEqual(legacy.verification.summary, broken.verification.summary);
  assert.match(broken.verification.summary, /no se corresponde con su contenido/);
});

test('un DID indisponible usa OTRO texto, que invita a reintentar', async () => {
  const { service } = createContext({ did: { kind: 'not_resolvable' } });

  const response = await service.getCredentialVerification('x');

  assert.match(response.verification.summary, /identidad pública del emisor no está disponible/);
  assert.ok(!response.verification.summary.includes('versión anterior'));
});

test('cada evidencia limitada tiene su propio texto, y ninguno finge exito', async () => {
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    [
      'pendiente',
      { credential: v2Credential({ blockchainRecords: [pendingRecord()] }), chainResult: { kind: 'credential_missing' } },
      /pendiente de confirmación/
    ],
    [
      'no encontrado',
      { chainResult: { kind: 'credential_missing' } },
      /no se encontró su registro en la red/
    ],
    [
      'indisponible',
      { chainResult: { kind: 'rpc_unavailable' } },
      /no se pudo consultar en este momento/
    ],
    [
      'mock',
      { credential: v2Credential({ blockchainRecords: [mockEvidenceRecord()] }) },
      /no tiene registro en una red pública/
    ]
  ];

  for (const [label, options, pattern] of cases) {
    const { service } = createContext(options);
    const response = await service.getCredentialVerification('x');

    assert.equal(
      response.verification.headline,
      'VERIFIED_WITH_LIMITED_EVIDENCE',
      label
    );
    assert.match(response.verification.summary, pattern, label);
    // La proyeccion legacy sigue siendo favorable: la firma vale.
    assert.equal(response.verification.result, 'valid_issued', label);
  }
});

// ---------------------------------------------------------------------------
// 63: FILAS MULTIPLES
// ---------------------------------------------------------------------------

test('63: dos filas de evidencia -> UNAVAILABLE, sin romper la autenticidad', async () => {
  const { service, calls } = createContext({
    credential: v2Credential({
      _count: { blockchainRecords: 2 },
      blockchainRecords: [registeredRecord(), registeredRecord()]
    })
  });

  const response = await service.getCredentialVerification('x');

  // La ambiguedad de almacenamiento afecta la evidencia, NO la autoria.
  assert.equal(response.verification.authenticity.result, 'VERIFIED');
  assert.equal(response.verification.blockchainEvidence.result, 'UNAVAILABLE');
  assert.equal(
    response.verification.blockchainEvidence.reason,
    'AMBIGUOUS_BLOCKCHAIN_RECORDS'
  );
  assert.equal(response.verification.credentialStatus, 'ACTIVE');
  assert.equal(response.verification.headline, 'VERIFIED_WITH_LIMITED_EVIDENCE');

  // El contador real se conserva, pero NINGUNA fila se presenta como la ultima.
  assert.equal(response.integrity.blockchainRecordsCount, 2);
  assert.equal(response.integrity.latestBlockchainRecord, null);

  // Y cero lecturas de cadena.
  assert.deepEqual(calls.chainReads, []);
});

test('con UNA fila si se expone, y con CERO el campo es null', async () => {
  const single = await createContext().service.getCredentialVerification('x');
  assert.equal(single.integrity.blockchainRecordsCount, 1);
  assert.ok(single.integrity.latestBlockchainRecord);
  assert.equal(single.integrity.latestBlockchainRecord?.chainId, 84532);

  const none = await createContext({
    credential: v2Credential({
      _count: { blockchainRecords: 0 },
      blockchainRecords: []
    })
  }).service.getCredentialVerification('x');

  assert.equal(none.integrity.blockchainRecordsCount, 0);
  assert.equal(none.integrity.latestBlockchainRecord, null);
  assert.equal(none.verification.blockchainEvidence.result, 'NOT_FOUND');
});

test('la consulta pide TODAS las filas: sin orderBy y sin take', async () => {
  // No se inventa cronologia. La tabla no tiene `createdAt`, una fila pendiente
  // tiene `registeredAt` NULL y el orden de UUID no es tiempo.
  const { service, calls } = createContext();

  await service.getCredentialVerification('x');

  const select = calls.findUnique[0]?.select as Record<string, unknown>;
  const records = select.blockchainRecords as Record<string, unknown>;

  assert.ok(records, 'se piden las filas de evidencia');
  assert.equal('orderBy' in records, false, 'sin orderBy');
  assert.equal('take' in records, false, 'sin take');
});

// ---------------------------------------------------------------------------
// 71: CAMPOS NULOS DE CADENA
// ---------------------------------------------------------------------------

test('71: una fila PENDIENTE serializa sus campos nulos sin romperse', async () => {
  const { service } = createContext({
    credential: v2Credential({ blockchainRecords: [pendingRecord()] }),
    chainResult: { kind: 'credential_missing' }
  });

  const response = await service.getCredentialVerification('x');
  const record = response.integrity.latestBlockchainRecord;

  assert.ok(record);
  assert.equal(record?.txHash, null);
  assert.equal(record?.txHashShort, null);
  assert.equal(record?.registeredAt, null);
  assert.equal(record?.status, 'pending');
  assert.equal(record?.statusLabel, 'Registro pendiente de confirmación');
  assert.equal(response.verification.blockchainEvidence.result, 'PENDING');

  // Y el JSON completo se serializa sin excepcion.
  assert.ok(JSON.stringify(response).length > 0);
});

// ---------------------------------------------------------------------------
// ESTADO: CONFLICTO Y MONOTONIA
// ---------------------------------------------------------------------------

test('la base dice ACTIVE y la cadena dice revocada -> REVOKED, sin escribir', async () => {
  const { service, calls } = createContext({
    chainResult: {
      kind: 'credential_state',
      status: { exists: true, revoked: true, issuer: ANCHOR_ADDRESS }
    }
  });

  const response = await service.getCredentialVerification('x');

  assert.equal(response.verification.credentialStatus, 'REVOKED');
  assert.equal(
    response.verification.blockchainEvidence.result,
    'REVOKED_ON_CHAIN'
  );
  assert.equal(response.verification.headline, 'REVOKED');
  assert.equal(response.verification.result, 'revoked');
  // La fila local NO se pone al dia desde un GET.
  assert.equal(response.status, 'issued');
  assert.deepEqual(calls.mutations, []);
});

test('la base dice REVOKED y el RPC esta caido -> sigue REVOKED', async () => {
  const { service } = createContext({
    credential: v2Credential({
      status: 'revoked',
      revokedAt: new Date('2026-08-15T12:00:00.000Z'),
      revocationReason: 'Información corregida'
    }),
    chainResult: { kind: 'rpc_unavailable' }
  });

  const response = await service.getCredentialVerification('x');

  assert.equal(response.status, 'revoked');
  assert.equal(response.statusLabel, 'Revocada');
  assert.equal(response.verification.credentialStatus, 'REVOKED');
  assert.equal(response.verification.blockchainEvidence.result, 'UNAVAILABLE');
  assert.equal(response.verification.headline, 'REVOKED');
  assert.equal(response.verification.result, 'revoked');
  assert.equal(response.revocationReason, 'Información corregida');
});

// ---------------------------------------------------------------------------
// 60: UNA SOLA FUENTE DE VERDAD
// ---------------------------------------------------------------------------

test('60: `verification.result` concuerda SIEMPRE con el titular', async () => {
  const scenarios: Array<[string, Parameters<typeof createContext>[0]]> = [
    ['v2 registrada', {}],
    ['v2 pendiente', { credential: v2Credential({ blockchainRecords: [pendingRecord()] }), chainResult: { kind: 'credential_missing' } }],
    ['v2 sin evidencia', { credential: v2Credential({ _count: { blockchainRecords: 0 }, blockchainRecords: [] }) }],
    ['v2 rpc caido', { chainResult: { kind: 'rpc_unavailable' } }],
    ['v2 mock', { credential: v2Credential({ blockchainRecords: [mockEvidenceRecord()] }) }],
    ['v2 registrante inesperado', { chainResult: { kind: 'credential_issuer_mismatch' } }],
    ['v2 revocada en cadena', { chainResult: { kind: 'credential_state', status: { exists: true, revoked: true, issuer: ANCHOR_ADDRESS } } }],
    ['v2 hash en conflicto', { credential: v2Credential({ title: 'Otro' }) }],
    ['v2 DID indisponible', { did: { kind: 'not_resolvable' as const } }],
    ['v2 clave no publicada', { did: { kind: 'resolved' as const, document: { id: VECTOR_ISSUER_DID } } }],
    ['v1 legacy', { credential: legacyV1Credential() }],
    ['v2 revocada local', { credential: v2Credential({ status: 'revoked' }) }],
    ['filas ambiguas', { credential: v2Credential({ _count: { blockchainRecords: 2 }, blockchainRecords: [registeredRecord(), registeredRecord()] }) }]
  ];

  const expected: Record<string, string> = {
    REVOKED: 'revoked',
    VERIFIED: 'valid_issued',
    VERIFIED_WITH_LIMITED_EVIDENCE: 'valid_issued',
    INVALID: 'not_verifiable',
    INDETERMINATE: 'not_verifiable'
  };

  for (const [label, options] of scenarios) {
    const { service } = createContext(options);
    const response = await service.getCredentialVerification('x');

    assert.equal(
      response.verification.result,
      expected[response.verification.headline],
      `${label}: titular ${response.verification.headline}`
    );
  }
});

// ---------------------------------------------------------------------------
// 27, 41, 68-70: COMPORTAMIENTO PREEXISTENTE PRESERVADO
// ---------------------------------------------------------------------------

test('la verificacion publica es de SOLO LECTURA y no consulta analisis semantico', async () => {
  const { service, calls } = createContext();

  const response = await service.getCredentialVerification(
    v2Credential().id as string
  );
  const serialized = JSON.stringify(response);

  assert.equal(response.holder.displayLabel, 'Titular Demo');
  assert.deepEqual(calls.mutations, []);
  assert.equal(calls.findUnique.length, 1);
  assert.deepEqual(calls.findUnique[0]?.where, { id: v2Credential().id });
  assert.equal(
    'semanticAnalyses' in ((calls.findUnique[0]?.select as Record<string, unknown>) ?? {}),
    false
  );

  for (const forbidden of [
    'email',
    'rawData',
    'metadata',
    'credentialSubject',
    'analysisJson',
    'sourceRefs',
    'evidenceMap',
    'textForEmbedding',
    'storageKey',
    'passwordHash',
    'walletAddress',
    'issuerAddress',
    'contractAddress',
    'secretRef',
    'privateKey',
    'anchorSignerProfileId'
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not leak`);
  }
});

test('70: la respuesta nunca filtra el endpoint RPC ni su credencial', async () => {
  for (const chainResult of [
    { kind: 'rpc_unavailable' },
    { kind: 'registry_read_failed' },
    { kind: 'contract_code_missing' }
  ]) {
    const { service } = createContext({ chainResult });
    const serialized = JSON.stringify(
      await service.getCredentialVerification('x')
    );

    for (const forbidden of [
      RPC_URL,
      'SECRET_API_KEY',
      'provider.example',
      'rpcUrl',
      PUBLIC_TEST_KEY_ONE.privateKey,
      PUBLIC_TEST_KEY_TWO.privateKey
    ]) {
      assert.ok(!serialized.includes(forbidden), `${forbidden} en ${chainResult.kind}`);
    }
  }
});

test('68: los borradores son indistinguibles de una referencia desconocida', async () => {
  const { service } = createContext({
    credential: v2Credential({ status: 'draft', title: 'Borrador confidencial' })
  });

  await assert.rejects(
    () => service.getCredentialVerification('credential-draft'),
    (error: unknown) =>
      error instanceof NotFoundException &&
      error.message ===
        'No se encontro una credencial verificable con esa referencia.'
  );
});

test('68b: una referencia desconocida devuelve el mismo 404 seguro', async () => {
  const { service } = createContext({ credential: null });

  await assert.rejects(
    () => service.getCredentialVerification('credential-missing'),
    (error: unknown) =>
      error instanceof NotFoundException &&
      error.message ===
        'No se encontro una credencial verificable con esa referencia.'
  );
});

test('una referencia vacia o gigante se rechaza antes de consultar', async () => {
  const { service, calls } = createContext();

  await assert.rejects(
    () => service.getCredentialVerification('  '),
    BadRequestException
  );
  await assert.rejects(
    () => service.getCredentialVerification('a'.repeat(201)),
    BadRequestException
  );
  assert.equal(calls.findUnique.length, 0);
});

test('la etiqueta publica del titular nunca cae al email ni a un id interno', async () => {
  const { service } = createContext({
    credential: v2Credential({
      subjectUser: {
        displayName: ' ',
        firstName: null,
        lastName: null,
        did: VECTOR_SUBJECT_DID,
        email: 'must-not-leak@example.com',
        id: 'must-not-leak'
      }
    })
  });

  const response = await service.getCredentialVerification('x');

  assert.equal(response.holder.displayLabel, null);
  assert.equal(JSON.stringify(response).includes('must-not-leak'), false);
});

test('el texto publico nombra el producto actual y nunca la marca legacy', async () => {
  // Antes este test exigia "huella de integridad registrada por Scope", que era
  // la frase de la verificacion de solo base de datos. Esa afirmacion ya no se
  // hace; lo que se conserva es la propiedad real: se nombra Scope y nunca la
  // marca anterior.
  for (const options of [{}, { credential: legacyV1Credential() }]) {
    const { service } = createContext(options);
    const response = await service.getCredentialVerification('x');

    assert.equal(JSON.stringify(response).includes('Traza'), false);
  }

  const legacy = await createContext({
    credential: legacyV1Credential()
  }).service.getCredentialVerification('x');
  assert.match(legacy.verification.summary, /Scope/);
});

test('las etiquetas de red preexistentes no cambiaron', async () => {
  const anvil = await createContext({
    credential: v2Credential({ blockchainRecords: [mockEvidenceRecord()] })
  }).service.getCredentialVerification('x');
  assert.equal(
    anvil.integrity.latestBlockchainRecord?.networkLabel,
    'Entorno técnico/demo'
  );

  const sepolia = await createContext().service.getCredentialVerification('x');
  assert.equal(sepolia.integrity.latestBlockchainRecord?.networkLabel, 'Testnet');
});

test('una credencial sin hash canonico sigue siendo publica y no verificable', async () => {
  const { service } = createContext({
    credential: v2Credential({
      canonicalHash: null,
      canonicalizationVersion: null,
      _count: { blockchainRecords: 0 },
      blockchainRecords: []
    })
  });

  const response = await service.getCredentialVerification('x');

  assert.equal(response.verification.result, 'not_verifiable');
  assert.equal(response.integrity.canonicalHashPresent, false);
  assert.equal(response.integrity.latestBlockchainRecord, null);
});

/**
 * El artifact de una emision REAL valida contra credential_v2 -- S8c4, item 44.
 *
 * No se afloja el schema para que la implementacion pase: se emite una
 * credencial a traves del CredentialsService de verdad (criptografia real,
 * dobles de Prisma) y se valida la proyeccion del artifact contra el contrato
 * ya congelado en `packages/schemas/credential_v2.schema.json`.
 *
 * SOBRE EL VALIDADOR: el repo no tiene -- y S8c4 no agrega -- una dependencia
 * de JSON Schema. La unica `ajv` presente es transitiva y soporta draft-07,
 * mientras que estos schemas son draft 2020-12. Asi que abajo hay un
 * validador propio que implementa EXACTAMENTE el subconjunto de keywords que
 * estos schemas usan, y que falla ruidoso si aparece una keyword que no
 * entiende -- de modo que no pueda dar un "valido" silencioso sobre una regla
 * que en realidad no comprobo. No es una implementacion completa de JSON
 * Schema y no pretende serlo.
 *
 * Sin AWS, sin SSM, sin RPC, sin base de datos y sin ningun secreto real.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  CredentialStatus,
  SignerProfilePurpose,
  SignerProfileStatus
} from '@prisma/client';
import { Wallet, toUtf8Bytes, verifyMessage } from 'ethers';

import { PUBLIC_TEST_KEY_ONE } from '../signing/__fixtures__/signer-test-keys';
import { CredentialHashingService } from './credential-hashing.service';
import { CredentialProofService } from './credential-proof.service';
import { CredentialsService } from './credentials.service';
import { CredentialSummaryResponseDto } from './dto/credential-summary-response.dto';
import { buildScopeProofV1Envelope } from './scope-proof-v1';

const SCHEMAS_DIR = join(__dirname, '..', '..', '..', '..', 'packages', 'schemas');

// ---------------------------------------------------------------------------
// VALIDADOR -- subconjunto declarado de draft 2020-12
// ---------------------------------------------------------------------------

type Schema = Record<string, any>;

const SUPPORTED_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'title',
  'description',
  'type',
  'const',
  'enum',
  'required',
  'properties',
  'additionalProperties',
  'propertyNames',
  'pattern',
  'minLength',
  'minimum',
  'items',
  'oneOf',
  'format'
]);

function validate(
  schema: Schema,
  value: unknown,
  root: Schema,
  path = '$'
): string[] {
  const errors: string[] = [];

  for (const keyword of Object.keys(schema)) {
    assert.ok(
      SUPPORTED_KEYWORDS.has(keyword),
      `el validador de este test no implementa la keyword "${keyword}" (en ${path}): implementarla antes de confiar en el resultado`
    );
  }

  if (typeof schema.$ref === 'string') {
    const target = schema.$ref.replace(/^#\//, '').split('/');
    let resolved: any = root;
    for (const segment of target) {
      resolved = resolved?.[segment];
    }
    assert.ok(resolved, `no se pudo resolver ${schema.$ref}`);
    return validate(resolved, value, root, path);
  }

  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return [`${path}: se esperaba object`];
    }

    const record = value as Record<string, unknown>;
    // Semantica JSON: una clave con valor `undefined` no existe en el
    // documento serializado (`JSON.stringify` la omite). Tratarla como
    // presente haria pasar un artifact que declara `proof` sin tenerlo.
    const presentKeys = Object.keys(record).filter(
      (key) => record[key] !== undefined
    );

    for (const key of schema.required ?? []) {
      if (!presentKeys.includes(key)) {
        errors.push(`${path}.${key}: requerido y ausente`);
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of presentKeys) {
        if (!(key in (schema.properties ?? {}))) {
          errors.push(`${path}.${key}: propiedad no permitida`);
        }
      }
    }

    for (const [key, subSchema] of Object.entries(schema.properties ?? {})) {
      if (key in record && record[key] !== undefined) {
        errors.push(
          ...validate(subSchema as Schema, record[key], root, `${path}.${key}`)
        );
      }
    }

    return errors;
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      return [`${path}: se esperaba array`];
    }
    if (schema.items) {
      value.forEach((entry, index) => {
        errors.push(
          ...validate(schema.items as Schema, entry, root, `${path}[${index}]`)
        );
      });
    }
    return errors;
  }

  if (Array.isArray(schema.oneOf)) {
    const matched = schema.oneOf.filter(
      (option: Schema) => validate(option, value, root, path).length === 0
    );
    if (matched.length !== 1) {
      errors.push(`${path}: debe cumplir exactamente una alternativa de oneOf`);
    }
    return errors;
  }

  if ('const' in schema && value !== schema.const) {
    errors.push(`${path}: se esperaba el literal ${JSON.stringify(schema.const)}`);
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
    errors.push(`${path}: ${JSON.stringify(value)} no esta en el enum`);
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      return [`${path}: se esperaba string`];
    }
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${path}: mas corto que minLength`);
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: no cumple el pattern ${schema.pattern}`);
    }
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
      errors.push(`${path}: no es un date-time`);
    }
    if (schema.format === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      errors.push(`${path}: no es un date`);
    }
    return errors;
  }

  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return [`${path}: se esperaba number`];
    }
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`${path}: menor que minimum`);
    }
    return errors;
  }

  return errors;
}

const credentialV2 = JSON.parse(
  readFileSync(join(SCHEMAS_DIR, 'credential_v2.schema.json'), 'utf8')
) as Schema;

// Prueba del propio validador: si no distinguiera invalido de valido, todas
// las aserciones de abajo serian vacias.
test('el validador del test rechaza lo que el contrato prohibe', () => {
  const minimal = {
    schema_version: 'credential_v2',
    credential_id: 'c1',
    type: 'course',
    issuer_id: 'i1',
    issuer_did: 'did:web:host:did:issuers:i1',
    subject_id: 's1',
    subject_did: 'did:web:host:did:users:s1',
    title: 't',
    source_type: 'manual_issuer',
    created_at: '2026-07-22T17:00:00Z',
    issued_at: '2026-07-22T18:00:00Z',
    status: 'issued',
    canonical_hash: `0x${'a'.repeat(64)}`,
    canonicalization_version: 'canon_v2',
    credential_subject: { achievement_name: 'a', institution_name: 'b' },
    proof: {
      type: 'ScopeCredentialProof2026',
      profile: 'scope-proof-v1',
      cryptosuite: 'ecdsa-secp256k1-eip191',
      proofPurpose: 'assertionMethod',
      verificationMethod: 'did:web:host:did:issuers:i1#assert-1',
      canonicalizationVersion: 'canon_v2',
      hashAlgorithm: 'sha-256',
      proofValue: `0x${'b'.repeat(130)}`
    }
  };

  assert.deepEqual(validate(credentialV2, minimal, credentialV2), []);

  const rejects: Array<[string, unknown]> = [
    ['sin proof', { ...minimal, proof: undefined }],
    ['status draft', { ...minimal, status: 'draft' }],
    ['canon_v1', { ...minimal, canonicalization_version: 'canon_v1' }],
    ['schema v1', { ...minimal, schema_version: 'credential_v1' }],
    [
      'hash en mayuscula',
      { ...minimal, canonical_hash: `0x${'A'.repeat(64)}` }
    ],
    [
      'proof con created',
      { ...minimal, proof: { ...minimal.proof, created: '2026-07-22T18:00:00Z' } }
    ],
    [
      'proof con canonicalHash',
      {
        ...minimal,
        proof: { ...minimal.proof, canonicalHash: minimal.canonical_hash }
      }
    ],
    [
      'proofValue corto',
      { ...minimal, proof: { ...minimal.proof, proofValue: '0xdead' } }
    ],
    [
      'verificationMethod sin fragmento',
      {
        ...minimal,
        proof: { ...minimal.proof, verificationMethod: 'did:web:host:did:issuers:i1' }
      }
    ],
    ['propiedad extra', { ...minimal, inventado: true }]
  ];

  for (const [label, candidate] of rejects) {
    const errors = validate(credentialV2, candidate, credentialV2);
    assert.ok(errors.length > 0, `deberia rechazar: ${label}`);
  }
});

// ---------------------------------------------------------------------------
// EMISION REAL
// ---------------------------------------------------------------------------

const ISSUER_ID = 'issuer-1';
const SUBJECT_ID = 'holder-1';
const SUBJECT_DID = 'did:web:api.scopeedu.technology:did:users:holder-1';
const TECHNICAL_IDENTITY_DID = `did:web:api.scopeedu.technology:did:issuers:${ISSUER_ID}`;

const currentUser = {
  id: 'issuer-user-1',
  email: 'issuer.admin@example.com',
  did: 'did:example:issuer-admin-demo',
  status: 'active'
} as never;

function issuedCredentialRow() {
  return {
    id: '8d4b1f60-2c73-4a95-8e01-5f7a9b3d6c28',
    schemaVersion: 'credential_v1',
    type: 'course',
    issuerId: ISSUER_ID,
    subjectUserId: SUBJECT_ID,
    title: 'Programacion Avanzada',
    description: 'Curso de programacion orientada a objetos.',
    sourceType: 'manual_issuer',
    status: CredentialStatus.draft,
    hours: { toFixed: () => '60.00' },
    issuedAt: null,
    revokedAt: null,
    canonicalHash: null,
    canonicalizationVersion: null,
    proof: null,
    credentialSubject: {
      achievement_name: 'Programacion Avanzada',
      institution_name: 'Universidad Argentina de la Empresa (UADE)',
      skills: ['TypeScript', 'algebra'],
      grade: '9',
      completion_date: '2026-03-10',
      academic_period: '2026-1C'
    },
    academicCourseId: null,
    externalCourseId: null,
    metadata: null,
    rawData: null,
    createdAt: new Date('2026-07-22T17:00:00Z'),
    updatedAt: new Date('2026-07-22T17:30:00Z'),
    issuer: {
      id: ISSUER_ID,
      did: 'did:example:issuer-demo',
      walletAddress: '0x00000000000000000000000000000000000000aa',
      authorizationStatus: 'authorized'
    },
    subjectUser: { id: SUBJECT_ID, did: SUBJECT_DID }
  };
}

async function issueThroughService(): Promise<CredentialSummaryResponseDto> {
  const row = issuedCredentialRow();
  const wallet = new Wallet(PUBLIC_TEST_KEY_ONE.privateKey);

  const transaction = {
    // S8c9: TX #1 re-lee autorizacion y capacidades del issuer.
    issuer: {
      async findUnique() {
        return {
          authorizationStatus: 'authorized',
          allowedCredentialTypes: ['academic_subject', 'course', 'certification', 'degree']
        };
      }
    },
    credential: {
      async findUnique() {
        return {
          id: row.id,
          status: row.status,
          updatedAt: row.updatedAt,
          type: row.type,
          title: row.title,
          description: row.description,
          hours: row.hours,
          credentialSubject: row.credentialSubject
        };
      },
      async update(args: Record<string, unknown>) {
        const data = args.data as Record<string, unknown>;
        return { ...row, ...data };
      }
    },
    blockchainRecord: {
      async create() {
        throw new Error('este test no ejercita la evidencia de blockchain');
      }
    },
    // S8c8: revalidacion del binding de ASERCION dentro de TX #1, con metadata
    // publica unicamente.
    issuerTechnicalIdentity: {
      async findUnique() {
        return {
          did: TECHNICAL_IDENTITY_DID,
          assertionSignerProfileId: 'signer-profile-assertion-1',
          assertionSignerProfile: {
            id: 'signer-profile-assertion-1',
            purpose: SignerProfilePurpose.assertion,
            status: SignerProfileStatus.active,
            address: wallet.address.toLowerCase(),
            keyVersion: 1,
            addressVerifiedAt: new Date('2026-01-01T00:00:00.000Z')
          }
        };
      }
    }
  };

  const prisma = {
    credential: {
      async findUnique() {
        return row;
      }
    },
    blockchainRecord: {
      async findUnique() {
        return blockchainRecord;
      }
    },
    issuerTechnicalIdentity: {
      async findUnique() {
        return { did: TECHNICAL_IDENTITY_DID };
      }
    },
    user: {
      async findUnique() {
        return { id: SUBJECT_ID, did: SUBJECT_DID };
      }
    },
    async $transaction(
      callback: (client: typeof transaction) => Promise<unknown>
    ) {
      return callback(transaction);
    }
  };

  const issuersService = {
    async assertUserCanIssueForIssuer() {
      return { id: 'membership-1' };
    },
    assertIssuerCanIssue() {}
  };

  let blockchainRecord: Record<string, unknown> | null = null;

  const blockchainEvidenceService = {
    resolveTarget() {
      return { evidenceMode: 'mock' as const };
    },
    async createRecord(_transaction: unknown, payload: Record<string, unknown>) {
      blockchainRecord = {
        id: 'blockchain-record-1',
        network: 'anvil',
        chainId: 31337,
        status: 'registered',
        credentialHash: payload.credentialHash,
        hashAlgorithm: 'sha-256',
        canonicalizationVersion: payload.canonicalizationVersion,
        contractAddress: '0x0000000000000000000000000000000000000001',
        txHash: `0x${'1'.repeat(64)}`,
        issuerAddress: payload.issuerAddress,
        registeredAt: new Date('2026-07-22T18:00:00Z')
      };

      return blockchainRecord;
    }
  };

  const signerResolver = {
    async resolveAssertionSignerForIssuer() {
      return {
        profileId: 'signer-profile-assertion-1',
        purpose: SignerProfilePurpose.assertion,
        keyVersion: 1,
        address: wallet.address,
        wallet
      };
    }
  };

  const service = new CredentialsService(
    prisma as never,
    issuersService as never,
    blockchainEvidenceService as never,
    new CredentialHashingService(),
    new CredentialProofService(signerResolver as never),
    {
      async prepareAnchorSigner() {
        throw new Error('una emision mock no resuelve el signer de anclaje');
      }
    } as never
  );

  return service.issueCredential(
    row.id,
    { issuerId: ISSUER_ID, issuedAt: '2026-07-22T18:00:00Z' },
    currentUser
  );
}

/**
 * Proyeccion snake_case del artifact a partir de la respuesta de produccion.
 *
 * TODOS los valores salen del DTO que devolvio la emision: no se rellena a
 * mano ninguno de los campos que participan de canon_v2. Es justamente eso lo
 * que hace util el test -- si el DTO no expusiera el `issuer_did` tecnico, el
 * `canonical_hash` o el proof, el artifact no se podria armar.
 */
function toCredentialV2Artifact(dto: CredentialSummaryResponseDto) {
  return {
    schema_version: dto.schemaVersion,
    credential_id: dto.id,
    type: dto.type,
    issuer_id: dto.issuerId,
    issuer_did: dto.issuerDid,
    subject_id: dto.subjectUserId,
    subject_did: dto.subjectDid,
    title: dto.title,
    description: dto.description,
    source_type: dto.sourceType,
    created_at: dto.createdAt,
    issued_at: dto.issuedAt,
    status: dto.status,
    canonical_hash: dto.canonicalHash,
    canonicalization_version: dto.canonicalizationVersion,
    hours: dto.hours === undefined ? undefined : Number(dto.hours),
    credential_subject: dto.credentialSubject,
    metadata: dto.metadata ?? undefined,
    proof: dto.proof
  };
}

test('44: el artifact de una emision REAL valida contra credential_v2', async () => {
  const dto = await issueThroughService();
  const artifact = toCredentialV2Artifact(dto);

  const errors = validate(credentialV2, artifact, credentialV2);
  assert.deepEqual(errors, [], errors.join('\n'));
});

test('44b: el artifact es internamente consistente con el hash firmado', async () => {
  const dto = await issueThroughService();
  const artifact = toCredentialV2Artifact(dto);

  assert.equal(artifact.schema_version, 'credential_v2');
  assert.equal(artifact.canonicalization_version, 'canon_v2');
  assert.equal(artifact.canonical_hash, dto.canonicalHash);
  assert.equal(artifact.issuer_did, TECHNICAL_IDENTITY_DID);
  assert.notEqual(artifact.issuer_did, 'did:example:issuer-demo');
  assert.equal(artifact.subject_did, SUBJECT_DID);
  assert.equal(
    artifact.proof?.verificationMethod,
    `${TECHNICAL_IDENTITY_DID}#assert-1`
  );

  // Y el hash del artifact es el que esta dentro del envelope firmado.
  const envelope = buildScopeProofV1Envelope({
    verificationMethod: artifact.proof!.verificationMethod,
    canonicalHash: artifact.canonical_hash!
  });
  assert.equal(
    verifyMessage(toUtf8Bytes(envelope), artifact.proof!.proofValue),
    PUBLIC_TEST_KEY_ONE.address
  );
});

test('44c: el hash del artifact se reproduce recanonicalizando el artifact', async () => {
  const dto = await issueThroughService();
  const artifact = toCredentialV2Artifact(dto);

  // Recanonicalizar DESDE el artifact serializado tiene que dar el mismo
  // hash: eso es lo que hace que el proof cubra lo que el artifact dice.
  const recomputed = new CredentialHashingService().createCanonicalHashForVersion(
    {
      credentialId: artifact.credential_id,
      schemaVersion: artifact.schema_version,
      type: artifact.type,
      issuerDid: artifact.issuer_did!,
      subjectDid: artifact.subject_did!,
      title: artifact.title,
      description: artifact.description,
      issuedAt: new Date(artifact.issued_at!),
      hours: artifact.hours ?? null,
      credentialSubject: artifact.credential_subject
    },
    CredentialHashingService.CANONICALIZATION_VERSION_V2
  );

  assert.equal(recomputed.canonicalHash, artifact.canonical_hash);
});

test('proof.created esta AUSENTE en el artifact emitido', async () => {
  const dto = await issueThroughService();

  assert.ok(dto.proof);
  assert.ok(!('created' in dto.proof));
  assert.ok(!JSON.stringify(dto.proof).includes('created'));
  assert.equal(Object.keys(dto.proof).length, 8);
});

test('el artifact no filtra nada del signer ni del almacen de secretos', async () => {
  const dto = await issueThroughService();
  const serialized = JSON.stringify(toCredentialV2Artifact(dto));

  for (const forbidden of [
    PUBLIC_TEST_KEY_ONE.privateKey,
    PUBLIC_TEST_KEY_ONE.address,
    PUBLIC_TEST_KEY_ONE.addressLowercase,
    PUBLIC_TEST_KEY_ONE.publicKeyX,
    PUBLIC_TEST_KEY_ONE.publicKeyCompressed,
    'signer-profile-assertion-1',
    'secretRef',
    'privateKey',
    'mnemonic',
    'custody'
  ]) {
    assert.ok(
      !serialized.includes(forbidden),
      `el artifact no debe contener ${forbidden}`
    );
  }
});

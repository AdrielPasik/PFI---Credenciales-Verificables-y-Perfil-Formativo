import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException
} from '@nestjs/common';
import {
  CredentialSourceType,
  CredentialStatus,
  CredentialType,
  SignerProfilePurpose,
  UserStatus
} from '@prisma/client';
import { Wallet, hashMessage, toUtf8Bytes, verifyMessage } from 'ethers';

import { PUBLIC_TEST_KEY_ONE } from '../signing/__fixtures__/signer-test-keys';
import { SignerResolutionError } from '../signing/signer-resolution.error';
import { CreateCredentialDraftDto } from './dto/create-credential-draft.dto';
import { CredentialHashingService } from './credential-hashing.service';
import { CredentialProofService } from './credential-proof.service';
import { CredentialsService } from './credentials.service';
import { buildScopeProofV1Envelope } from './scope-proof-v1';

const currentUser = {
  id: 'issuer-user-1',
  email: 'issuer.admin@example.com',
  did: 'did:example:issuer-admin-demo',
  status: UserStatus.active
} as const;

function createCredentialFixture(overrides?: Partial<CredentialFixture>) {
  return {
    id: 'cred-123',
    schemaVersion: 'credential_v1',
    type: 'academic_subject',
    issuerId: 'issuer-1',
    subjectUserId: 'holder-1',
    title: 'Algoritmos y Estructuras de Datos',
    description: 'Asignatura aprobada',
    sourceType: 'manual_issuer',
    status: CredentialStatus.draft,
    hours: {
      toFixed() {
        return '96.00';
      }
    },
    issuedAt: null,
    revokedAt: null,
    canonicalHash: null,
    canonicalizationVersion: null,
    credentialSubject: {
      achievement_name: 'Algoritmos y Estructuras de Datos',
      institution_name: 'Demo University',
      skills: ['algoritmos', 'programacion']
    },
    academicCourseId: null,
    externalCourseId: null,
    metadata: null,
    rawData: null,
    createdAt: new Date('2026-07-22T17:00:00Z'),
    updatedAt: new Date('2026-07-22T17:00:00Z'),
    issuer: {
      id: 'issuer-1',
      did: 'did:example:issuer-demo',
      walletAddress: '0x00000000000000000000000000000000000000aa',
      authorizationStatus: 'authorized'
    },
    subjectUser: {
      id: 'holder-1',
      did: 'did:example:holder-demo'
    },
    ...overrides
  } satisfies CredentialFixture;
}

type CredentialFixture = {
  id: string;
  schemaVersion: string;
  type: string;
  issuerId: string;
  subjectUserId: string;
  title: string;
  description: string | null;
  sourceType: string;
  status: CredentialStatus;
  hours: { toFixed: () => string } | null;
  issuedAt: Date | null;
  revokedAt: Date | null;
  canonicalHash: string | null;
  canonicalizationVersion: string | null;
  credentialSubject: Record<string, unknown>;
  academicCourseId: string | null;
  externalCourseId: string | null;
  metadata: Record<string, unknown> | null;
  rawData: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
  issuer: {
    id: string;
    did: string | null;
    walletAddress: string | null;
    authorizationStatus: string;
  };
  subjectUser: {
    id: string;
    did: string | null;
  };
};

const validDraftDto = {
  issuerId: 'issuer-1',
  subjectUserId: 'holder-1',
  type: CredentialType.academic_subject,
  title: 'Algoritmos y Estructuras de Datos',
  description: 'Asignatura aprobada',
  sourceType: CredentialSourceType.manual_issuer,
  hours: '96',
  credentialSubject: {
    achievement_name: 'Algoritmos y Estructuras de Datos',
    institution_name: 'Demo University'
  }
} satisfies CreateCredentialDraftDto;

/**
 * S8c4: la creacion y edicion de borradores no tiene autoria criptografica que
 * expresar, asi que no puede tocar la pila de firma. El doble falla ruidoso en
 * vez de devolver algo plausible.
 */
const FORBIDDEN_DURING_DRAFT = (name: string) => () => {
  throw new Error(`un borrador no debe invocar ${name}`);
};

function createDraftService(options?: {
  assertUserCanCreateDraftForIssuer?: (
    userId: string,
    issuerId: string
  ) => Promise<unknown>;
  subjectUser?: { id: string } | null;
  programCourse?: ProgramCourseFixture | null;
  issuerDid?: string | null;
}) {
  const authorizationCalls: Array<Record<string, unknown>> = [];
  const subjectLookupCalls: Array<Record<string, unknown>> = [];
  const createCalls: Array<Record<string, unknown>> = [];
  const programCourseLookupCalls: Array<Record<string, unknown>> = [];
  const transactionOptions: Array<Record<string, unknown>> = [];
  const operationOrder: string[] = [];

  const transaction = {
    programCourse: {
      async findFirst(args: Record<string, unknown>) {
        operationOrder.push('program_course_lookup');
        programCourseLookupCalls.push(args);
        return options?.programCourse === undefined
          ? createProgramCourseFixture()
          : options.programCourse;
      }
    },
    user: {
      async findFirst(args: Record<string, unknown>) {
        operationOrder.push('subject_lookup');
        subjectLookupCalls.push(args);
        return options?.subjectUser === undefined
          ? {
              id: 'holder-1'
            }
          : options.subjectUser;
      }
    },
    credential: {
      async create(args: Record<string, unknown>) {
        operationOrder.push('credential_create');
        createCalls.push(args);
        return {
          ...createCredentialFixture(),
          blockchainRecords: []
        };
      }
    }
  };
  const prisma = {
    issuer: {
      async findUnique() {
        operationOrder.push('issuer_lookup');
        return { did: options?.issuerDid ?? 'did:example:issuer-demo' };
      }
    },
    async $transaction(
      callback: (client: typeof transaction) => Promise<unknown>,
      transactionOption: Record<string, unknown>
    ) {
      operationOrder.push('transaction_start');
      transactionOptions.push(transactionOption);
      return callback(transaction);
    }
  };

  const issuersService = {
    async assertUserCanCreateDraftForIssuer(userId: string, issuerId: string) {
      operationOrder.push('issuer_authorization');
      authorizationCalls.push({ userId, issuerId });

      if (options?.assertUserCanCreateDraftForIssuer) {
        return options.assertUserCanCreateDraftForIssuer(userId, issuerId);
      }

      return {
        id: 'membership-1'
      };
    }
  };

  return {
    service: new CredentialsService(
      prisma as never,
      issuersService as never,
      {} as never,
      {} as never,
      // Un borrador NUNCA construye un proof: el doble lanza si la creacion de
      // borradores intentara resolver un signer o firmar algo.
      {
        prepareAssertionSigner: FORBIDDEN_DURING_DRAFT('prepareAssertionSigner'),
        createProof: FORBIDDEN_DURING_DRAFT('createProof')
      } as never
    ),
    authorizationCalls,
    subjectLookupCalls,
    createCalls,
    programCourseLookupCalls,
    transactionOptions,
    operationOrder
  };
}

type ProgramCourseFixture = {
  id: string;
  academicCourse: {
    id: string;
    name: string;
    description: string | null;
    hours: { toFixed: () => string; toString: () => string } | null;
    issuer: { name: string };
  };
  curriculumVersion: {
    program: { name: string };
  };
};

function createProgramCourseFixture(): ProgramCourseFixture {
  return {
    id: 'program-course-1',
    academicCourse: {
      id: 'academic-course-1',
      name: 'Ingenieria de Datos I',
      description: 'Descripcion oficial de la asignatura',
      hours: {
        toFixed: () => '64.00',
        toString: () => '64'
      },
      issuer: {
        name: 'Universidad Argentina de la Empresa (UADE)'
      }
    },
    curriculumVersion: {
      program: {
        name: 'Ingenieria en Informatica'
      }
    }
  };
}

const validCurricularDraftDto = {
  issuerId: 'issuer-1',
  subjectUserId: 'holder-1',
  type: CredentialType.academic_subject,
  sourceType: CredentialSourceType.manual_issuer,
  academicCourseReference: ' academic-course-1 ',
  curriculumReference: ' curriculum-1 '
} satisfies CreateCredentialDraftDto;

test('createDraft applies the same controlled-array invariant before persisting credentialSubject', async () => {
  const { service, createCalls, operationOrder } = createDraftService();
  const atBoundary = 'x'.repeat(500);

  await service.createDraft(
    {
      ...validDraftDto,
      type: CredentialType.course,
      credentialSubject: {
        ...validDraftDto.credentialSubject,
        competencies: [`  ${atBoundary}  `],
        learning_outcomes: ['  Contenido   declarado  ']
      }
    },
    currentUser
  );

  const createdSubject = (createCalls[0]?.data as {
    credentialSubject: Record<string, unknown>;
  }).credentialSubject;
  assert.deepEqual(createdSubject.competencies, [atBoundary]);
  assert.deepEqual(createdSubject.learning_outcomes, ['Contenido declarado']);
  assert.ok(operationOrder.includes('credential_create'));
});

test('createDraft rejects the legacy learningOutcomes alias before a transaction can start', async () => {
  const { service, createCalls, operationOrder } = createDraftService();

  await assert.rejects(
    () =>
      service.createDraft(
        {
          ...validDraftDto,
          type: CredentialType.course,
          credentialSubject: {
            ...validDraftDto.credentialSubject,
            learningOutcomes: ['x'.repeat(501)]
          }
        },
        currentUser
      ),
    (error: unknown) =>
      error instanceof BadRequestException &&
      error.message ===
        'credentialSubject.learningOutcomes no es una key de escritura soportada; usar learning_outcomes.'
  );

  assert.deepEqual(createCalls, []);
  assert.equal(operationOrder.includes('transaction_start'), false);
});

test('createDraft rejects ambiguous learning outcome aliases before a transaction can start', async () => {
  const { service, createCalls, operationOrder } = createDraftService();

  await assert.rejects(
    () =>
      service.createDraft(
        {
          ...validDraftDto,
          type: CredentialType.course,
          credentialSubject: {
            ...validDraftDto.credentialSubject,
            learning_outcomes: ['Contenido canónico'],
            learningOutcomes: ['Contenido ambiguo']
          }
        },
        currentUser
      ),
    (error: unknown) =>
      error instanceof BadRequestException &&
      error.message ===
        'credentialSubject no puede incluir learningOutcomes y learning_outcomes a la vez.'
  );

  assert.deepEqual(createCalls, []);
  assert.equal(operationOrder.includes('transaction_start'), false);
});

test('createDraft rejects malformed canonical learning_outcomes before a transaction can start', async () => {
  for (const learningOutcomes of [['x'.repeat(501)], [{}]]) {
    const { service, createCalls, operationOrder } = createDraftService();

    await assert.rejects(
      () =>
        service.createDraft(
          {
            ...validDraftDto,
            type: CredentialType.course,
            credentialSubject: {
              ...validDraftDto.credentialSubject,
              learning_outcomes: learningOutcomes
            }
          },
          currentUser
        ),
      BadRequestException
    );

    assert.deepEqual(createCalls, []);
    assert.equal(operationOrder.includes('transaction_start'), false);
  }
});

test('createDraft rejects an invalid declared competency before it can create a credential', async () => {
  const { service, createCalls, operationOrder } = createDraftService();

  await assert.rejects(
    () =>
      service.createDraft(
        {
          ...validDraftDto,
          type: CredentialType.course,
          credentialSubject: {
            ...validDraftDto.credentialSubject,
            competencies: ['x'.repeat(501)]
          }
        },
        currentUser
      ),
    BadRequestException
  );

  assert.deepEqual(createCalls, []);
  assert.equal(operationOrder.includes('transaction_start'), false);
});

test('createDraft creates a curricular academic subject and derives its official snapshot', async () => {
  const {
    service,
    programCourseLookupCalls,
    createCalls,
    operationOrder,
    transactionOptions
  } = createDraftService();

  const response = await service.createDraft(
    validCurricularDraftDto,
    currentUser
  );

  assert.deepEqual(programCourseLookupCalls, [
    {
      where: {
        academicCourseId: 'academic-course-1',
        curriculumVersionId: 'curriculum-1',
        academicCourse: {
          issuerId: 'issuer-1',
          status: 'active'
        },
        curriculumVersion: {
          status: 'active',
          program: {
            issuerId: 'issuer-1',
            status: 'active'
          }
        }
      },
      select: {
        id: true,
        academicCourse: {
          select: {
            id: true,
            name: true,
            description: true,
            hours: true,
            issuer: { select: { name: true } }
          }
        },
        curriculumVersion: {
          select: {
            program: { select: { name: true } }
          }
        }
      }
    }
  ]);
  assert.deepEqual(operationOrder, [
    'issuer_authorization',
    'issuer_lookup',
    'transaction_start',
    'subject_lookup',
    'program_course_lookup',
    'credential_create'
  ]);
  assert.deepEqual(transactionOptions, [{ isolationLevel: 'Serializable' }]);
  const createdData = createCalls[0].data as Record<string, unknown>;
  assert.equal(createdData.issuerId, 'issuer-1');
  assert.equal(createdData.subjectUserId, 'holder-1');
  assert.equal(createdData.type, CredentialType.academic_subject);
  assert.equal(createdData.title, 'Ingenieria de Datos I');
  assert.equal(createdData.description, 'Descripcion oficial de la asignatura');
  assert.equal(createdData.sourceType, CredentialSourceType.manual_issuer);
  assert.equal(
    (createdData.hours as { toFixed: () => string }).toFixed(),
    '64.00'
  );
  assert.equal(createdData.academicCourseId, 'academic-course-1');
  assert.equal(createdData.programCourseId, 'program-course-1');
  assert.equal(createdData.externalCourseId, undefined);
  assert.deepEqual(createdData.credentialSubject, {
    achievement_name: 'Ingenieria de Datos I',
    institution_name: 'Universidad Argentina de la Empresa (UADE)',
    program_name: 'Ingenieria en Informatica'
  });
  assert.equal(createdData.metadata, undefined);
  assert.equal(createdData.rawData, undefined);
  assert.equal(createdData.status, CredentialStatus.draft);
  assert.equal(response.status, CredentialStatus.draft);
  assert.equal(response.canonicalHash, undefined);
  assert.equal(response.latestBlockchainRecord, undefined);
});

test('createDraft rejects missing, cross-issuer, inactive or unrelated curriculum selections safely', async () => {
  for (const scenario of [
    'missing course',
    'cross issuer course',
    'inactive course',
    'inactive curriculum',
    'inactive program',
    'course outside curriculum'
  ]) {
    const unavailable = createDraftService({ programCourse: null });

    await assert.rejects(
      unavailable.service.createDraft(validCurricularDraftDto, currentUser),
      (error: unknown) => {
        assert.equal(error instanceof NotFoundException, true, scenario);
        assert.equal(
          (error as Error).message,
          'No se encontro una asignatura activa dentro de la curricula solicitada.'
        );
        return true;
      }
    );
    assert.deepEqual(unavailable.createCalls, [], scenario);
  }
});

test('createDraft rejects curriculum selection for a non-academic type before database access', async () => {
  const wrongType = createDraftService();

  await assert.rejects(
    wrongType.service.createDraft(
      {
        ...validCurricularDraftDto,
        type: CredentialType.course,
      },
      currentUser
    ),
    BadRequestException
  );
  assert.deepEqual(wrongType.programCourseLookupCalls, []);
  assert.deepEqual(wrongType.createCalls, []);
});

test('createDraft rejects a closed-contract violation before transaction or lookup', async () => {
  const { service, operationOrder, subjectLookupCalls, programCourseLookupCalls } =
    createDraftService();

  await assert.rejects(
    service.createDraft(
      {
        ...validCurricularDraftDto,
        credentialSubject: {}
      },
      currentUser
    ),
    BadRequestException
  );

  assert.deepEqual(operationOrder, ['issuer_authorization']);
  assert.equal(subjectLookupCalls.length, 0);
  assert.equal(programCourseLookupCalls.length, 0);
});

// ---------------------------------------------------------------------------
// ARNES DE EMISION -- S8c4
//
// Deja de doblar la canonicalizacion y la construccion del proof: usa el
// CredentialHashingService REAL (envuelto en un espia que sigue registrando la
// entrada, para que las aserciones previas de A2.1 sigan valiendo) y el
// CredentialProofService REAL sobre un IssuerSignerResolver FALSO que devuelve
// una Wallet desconectada construida con una clave publica de test.
//
// Consecuencia deliberada: `canonicalHash` y `proofValue` de estos tests son
// criptografia de verdad, no constantes. Asi "el hash persistido es el que fue
// firmado" se puede comprobar de verdad en vez de asumirse.
//
// NO hay AWS, NO hay SSM, NO hay RPC y NO hay ningun secreto real.
// ---------------------------------------------------------------------------

/** DID de identidad tecnica coherente con `issuerId: 'issuer-1'`. */
const TECHNICAL_IDENTITY_DID =
  'did:web:api.scopeedu.technology:did:issuers:issuer-1';

function createService(options?: {
  credential?: CredentialFixture | null;
  assertUserCanIssueForIssuer?: (
    userId: string,
    issuerId: string
  ) => Promise<unknown>;
  assertIssuerCanIssue?: (issuer: CredentialFixture['issuer']) => void;
  /** `undefined` = DID valido; `null` = sin identidad tecnica. */
  technicalIdentityDid?: string | null;
  /** Fila de `IssuerTechnicalIdentity` ausente por completo. */
  technicalIdentityMissing?: boolean;
  signerPurpose?: SignerProfilePurpose;
  signerKeyVersion?: number;
  signerPrivateKey?: string;
  resolverError?: Error;
  blockchainError?: Error;
  /** Simula que otra operacion mutó la fila entre snapshot y escritura. */
  concurrentlyMutated?: boolean;
  /** La fila desaparece entre la lectura inicial y la transaccion. */
  finalRowMissing?: boolean;
  /** La fila deja de estar en draft dentro de la transaccion. */
  finalRowStatus?: CredentialStatus;
}) {
  const credential = options?.credential ?? createCredentialFixture();
  const issueMembershipCalls: Array<Record<string, unknown>> = [];
  const issuerEligibilityCalls: Array<Record<string, unknown>> = [];
  const hashCalls: Array<Record<string, unknown>> = [];
  const blockchainCalls: Array<Record<string, unknown>> = [];
  const userFindUniqueCalls: Array<Record<string, unknown>> = [];
  const userUpdateManyCalls: Array<Record<string, unknown>> = [];
  const technicalIdentityCalls: Array<Record<string, unknown>> = [];
  const resolverCalls: string[] = [];
  const anchorResolverCalls: string[] = [];
  const signMessageInputs: unknown[] = [];
  const updateCalls: Array<Record<string, unknown>> = [];
  const operationOrder: string[] = [];
  let subjectUserState = { ...credential.subjectUser };

  const signerWallet = new Wallet(
    options?.signerPrivateKey ?? PUBLIC_TEST_KEY_ONE.privateKey
  );
  // Espia sobre `signMessage` para poder afirmar que recibe BYTES y no texto.
  const instrumentedWallet = {
    address: signerWallet.address,
    signMessage: async (message: unknown) => {
      signMessageInputs.push(message);
      return signerWallet.signMessage(message as Uint8Array);
    }
  };

  const signerResolver = {
    async resolveAssertionSignerForIssuer(issuerId: string) {
      operationOrder.push('signer_resolution');
      resolverCalls.push(issuerId);

      if (options?.resolverError) {
        throw options.resolverError;
      }

      return {
        profileId: 'signer-profile-assertion-1',
        purpose: options?.signerPurpose ?? SignerProfilePurpose.assertion,
        keyVersion: options?.signerKeyVersion ?? 1,
        address: signerWallet.address,
        wallet: instrumentedWallet
      };
    },
    async resolveAnchorSignerForIssuer(issuerId: string) {
      anchorResolverCalls.push(issuerId);
      throw new Error(
        'la autoria de la credencial nunca debe resolver el signer de anclaje'
      );
    }
  };

  const realHashingService = new CredentialHashingService();
  const credentialHashingService = {
    createCanonicalHash(input: Record<string, unknown>) {
      hashCalls.push({ ...input, requestedVersion: 'canon_v1' });
      return realHashingService.createCanonicalHash(input as never);
    },
    createCanonicalHashForVersion(
      input: Record<string, unknown>,
      version: string
    ) {
      hashCalls.push({ ...input, requestedVersion: version });
      return realHashingService.createCanonicalHashForVersion(
        input as never,
        version as never
      );
    }
  };

  const transaction = {
    credential: {
      async findUnique(args: Record<string, unknown>) {
        operationOrder.push('final_row_read');

        if (options?.finalRowMissing) {
          return null;
        }

        return {
          id: credential.id,
          status: options?.finalRowStatus ?? credential.status,
          updatedAt: credential.updatedAt,
          type: credential.type,
          title: credential.title,
          description: credential.description,
          hours: credential.hours,
          credentialSubject: credential.credentialSubject
        };
      },
      async update(args: Record<string, unknown>) {
        operationOrder.push('credential_update');
        updateCalls.push(args);

        const where = args.where as Record<string, unknown>;

        // El `where` extendido es el token de version optimista: si la fila
        // cambio, Prisma no encuentra nada que actualizar.
        if (
          options?.concurrentlyMutated ||
          where.status !== CredentialStatus.draft ||
          (where.updatedAt as Date)?.getTime() !==
            credential.updatedAt.getTime()
        ) {
          throw new Error(
            'P2025: no se encontro una fila que coincida con el snapshot'
          );
        }

        const data = args.data as Record<string, unknown>;

        return {
          ...(credential as CredentialFixture),
          status: data.status,
          issuedAt: data.issuedAt as Date,
          schemaVersion: data.schemaVersion,
          canonicalHash: data.canonicalHash,
          canonicalizationVersion: data.canonicalizationVersion,
          proof: data.proof
        };
      }
    }
  };

  const prisma = {
    credential: {
      async findUnique() {
        return credential;
      }
    },
    issuerTechnicalIdentity: {
      async findUnique(args: Record<string, unknown>) {
        operationOrder.push('technical_identity_lookup');
        technicalIdentityCalls.push(args);

        if (options?.technicalIdentityMissing) {
          return null;
        }

        return {
          did:
            options?.technicalIdentityDid === undefined
              ? TECHNICAL_IDENTITY_DID
              : options.technicalIdentityDid
        };
      }
    },
    user: {
      async findUnique(args: { where: { id: string }; select?: unknown }) {
        userFindUniqueCalls.push(args);
        return args.where.id === subjectUserState.id
          ? { ...subjectUserState }
          : null;
      },
      async updateMany(args: {
        where: { id: string; did: null };
        data: { did: string };
      }) {
        userUpdateManyCalls.push(args);
        if (
          args.where.id === subjectUserState.id &&
          subjectUserState.did === null
        ) {
          subjectUserState = { ...subjectUserState, did: args.data.did };
          return { count: 1 };
        }
        return { count: 0 };
      }
    },
    $transaction: async (
      callback: (client: typeof transaction) => Promise<unknown>
    ) => {
      operationOrder.push('transaction_start');
      try {
        return await callback(transaction);
      } finally {
        operationOrder.push('transaction_end');
      }
    }
  };

  const issuersService = {
    async assertUserCanIssueForIssuer(userId: string, issuerId: string) {
      operationOrder.push('issuer_authorization');
      issueMembershipCalls.push({ userId, issuerId });
      if (options?.assertUserCanIssueForIssuer) {
        return options.assertUserCanIssueForIssuer(userId, issuerId);
      }

      return {
        id: 'membership-1'
      };
    },
    assertIssuerCanIssue(issuer: CredentialFixture['issuer']) {
      operationOrder.push('issuer_eligibility');
      issuerEligibilityCalls.push({ issuer });
      options?.assertIssuerCanIssue?.(issuer);
    }
  };

  const blockchainEvidenceService = {
    async createRecord(
      _transaction: unknown,
      payload: Record<string, unknown>
    ) {
      operationOrder.push('blockchain_create');
      blockchainCalls.push(payload);

      if (options?.blockchainError) {
        throw options.blockchainError;
      }

      return {
        id: 'blockchain-record-1',
        network: 'anvil',
        chainId: 31337,
        status: 'registered',
        credentialHash: payload.credentialHash,
        hashAlgorithm: 'sha-256',
        canonicalizationVersion: payload.canonicalizationVersion,
        contractAddress: '0x0000000000000000000000000000000000000001',
        txHash: '0x' + '1'.repeat(64),
        issuerAddress: payload.issuerAddress,
        registeredAt: new Date('2026-07-22T18:00:00Z')
      };
    }
  };

  return {
    service: new CredentialsService(
      prisma as never,
      issuersService as never,
      blockchainEvidenceService as never,
      credentialHashingService as never,
      new CredentialProofService(signerResolver as never)
    ),
    issueMembershipCalls,
    issuerEligibilityCalls,
    hashCalls,
    blockchainCalls,
    userFindUniqueCalls,
    userUpdateManyCalls,
    technicalIdentityCalls,
    resolverCalls,
    anchorResolverCalls,
    signMessageInputs,
    updateCalls,
    operationOrder,
    signerAddress: signerWallet.address,
    getSubjectUserState: () => subjectUserState
  };
}

test('CredentialsService creates a draft only after issuer authorization and holder lookup', async () => {
  const {
    service,
    authorizationCalls,
    subjectLookupCalls,
    createCalls,
    operationOrder
  } = createDraftService();

  const response = await service.createDraft(validDraftDto, currentUser);

  assert.deepEqual(authorizationCalls, [
    {
      userId: currentUser.id,
      issuerId: validDraftDto.issuerId
    }
  ]);
  assert.deepEqual(subjectLookupCalls, [
    {
      where: {
        id: validDraftDto.subjectUserId,
        status: UserStatus.active
      },
      select: {
        id: true
      }
    }
  ]);
  assert.deepEqual(operationOrder, [
    'issuer_authorization',
    'issuer_lookup',
    'transaction_start',
    'subject_lookup',
    'credential_create'
  ]);
  assert.equal(createCalls.length, 1);
  assert.equal(
    (createCalls[0].data as Record<string, unknown>).issuerId,
    validDraftDto.issuerId
  );
  assert.equal(response.id, 'cred-123');
  assert.equal(response.status, CredentialStatus.draft);
  assert.equal(response.canonicalHash, undefined);
  assert.equal(response.latestBlockchainRecord, undefined);
});

test('CredentialsService preserves manual draft creation for every credential type', async () => {
  for (const type of [
    CredentialType.academic_subject,
    CredentialType.course,
    CredentialType.certification,
    CredentialType.degree
  ]) {
    const { service, createCalls, programCourseLookupCalls } =
      createDraftService();

    await service.createDraft(
      {
        ...validDraftDto,
        type,
        title: `Draft manual ${type}`,
        credentialSubject: {
          achievement_name: `Draft manual ${type}`,
          institution_name: 'Demo University'
        }
      },
      currentUser
    );

    assert.equal(createCalls.length, 1, type);
    assert.equal(
      (createCalls[0].data as Record<string, unknown>).title,
      `Draft manual ${type}`,
      type
    );
    assert.equal(programCourseLookupCalls.length, 0, type);
  }
});

// C4x fix: platformName ya no es un dato libre para course, ni al
// crear un borrador manual con credentialSubject crudo -- el emisor
// activo es la fuente institucional. Se ignora la clave si llega en el
// payload, sin rechazar la creacion completa (createDraft no valida
// ningun otro campo del subject punto por punto).
test('CredentialsService discards an arbitrary platform_name sent in a course credentialSubject at draft creation', async () => {
  const { service, createCalls } = createDraftService();

  await service.createDraft(
    {
      ...validDraftDto,
      type: CredentialType.course,
      title: 'Curso demo',
      credentialSubject: {
        achievement_name: 'Curso demo',
        institution_name: 'Demo University',
        platform_name: 'Plataforma arbitraria enviada por el cliente'
      }
    },
    currentUser
  );

  const persistedSubject = (createCalls[0].data as Record<string, unknown>)
    .credentialSubject as Record<string, unknown>;
  assert.equal('platform_name' in persistedSubject, false);
});

test('CredentialsService keeps platform_name untouched for non-course credentialSubject', async () => {
  const { service, createCalls } = createDraftService();

  await service.createDraft(
    {
      ...validDraftDto,
      type: CredentialType.certification,
      title: 'Certificacion demo',
      credentialSubject: {
        achievement_name: 'Certificacion demo',
        institution_name: 'Demo University',
        platform_name: 'Dato legacy sin relacion con certification'
      }
    },
    currentUser
  );

  const persistedSubject = (createCalls[0].data as Record<string, unknown>)
    .credentialSubject as Record<string, unknown>;
  assert.equal(
    persistedSubject.platform_name,
    'Dato legacy sin relacion con certification'
  );
});

test('CredentialsService rejects academic credential types for non-UADE issuers', async () => {
  for (const type of [CredentialType.academic_subject, CredentialType.degree]) {
    const { service, createCalls } = createDraftService({
      issuerDid: 'did:example:course-platform-issuer-demo'
    });

    await assert.rejects(
      service.createDraft(
        {
          ...validDraftDto,
          type,
          title: `Draft ${type}`,
          credentialSubject: {
            achievement_name: `Draft ${type}`,
            institution_name: 'Plataforma de Cursos Demo'
          }
        },
        currentUser
      ),
      (error: unknown) => {
        assert.equal(error instanceof BadRequestException, true);
        assert.equal(
          (error as Error).message,
      'Este emisor no puede crear credenciales académicas.'
        );
        return true;
      }
    );
    assert.equal(createCalls.length, 0);
  }
});

test('CredentialsService rejects arbitrary issuerIds before holder lookup or credential creation', async () => {
  const { service, subjectLookupCalls, createCalls, operationOrder } =
    createDraftService({
      async assertUserCanCreateDraftForIssuer() {
        throw new ForbiddenException(
          'El usuario no tiene permisos para crear borradores para el issuer solicitado.'
        );
      }
    });

  await assert.rejects(
    service.createDraft(
      {
        ...validDraftDto,
        issuerId: 'issuer-arbitrary'
      },
      currentUser
    ),
    ForbiddenException
  );

  assert.deepEqual(operationOrder, ['issuer_authorization']);
  assert.equal(subjectLookupCalls.length, 0);
  assert.equal(createCalls.length, 0);
});

test('CredentialsService preserves not found behavior for a missing holder after authorization', async () => {
  const { service, createCalls, operationOrder } = createDraftService({
    subjectUser: null
  });

  await assert.rejects(
    service.createDraft(validDraftDto, currentUser),
    NotFoundException
  );

  assert.deepEqual(operationOrder, [
    'issuer_authorization',
    'issuer_lookup',
    'transaction_start',
    'subject_lookup'
  ]);
  assert.equal(createCalls.length, 0);
});

test('CredentialsService treats an inactive holder as not eligible before catalog lookup', async () => {
  const { service, createCalls, programCourseLookupCalls, operationOrder } =
    createDraftService({ subjectUser: null });

  await assert.rejects(
    service.createDraft(validCurricularDraftDto, currentUser),
    NotFoundException
  );

  assert.deepEqual(operationOrder, [
    'issuer_authorization',
    'issuer_lookup',
    'transaction_start',
    'subject_lookup'
  ]);
  assert.equal(programCourseLookupCalls.length, 0);
  assert.equal(createCalls.length, 0);
});

test('CredentialsService does not create a draft when current domain validation fails', async () => {
  const { service, createCalls, operationOrder } = createDraftService();

  await assert.rejects(
    service.createDraft(
      {
        ...validDraftDto,
        hours: 0
      },
      currentUser
    ),
    BadRequestException
  );

  assert.deepEqual(operationOrder, [
    'issuer_authorization',
    'issuer_lookup',
    'transaction_start',
    'subject_lookup'
  ]);
  assert.equal(createCalls.length, 0);
});

test('CredentialsService rejects issuerId mismatches from the request body', async () => {
  const { service } = createService();

  await assert.rejects(
    service.issueCredential(
      'cred-123',
      {
        issuerId: 'issuer-other',
        issuedAt: '2026-07-22T18:00:00Z'
      },
      currentUser
    ),
    BadRequestException
  );
});

test('CredentialsService rejects users without issuer membership', async () => {
  const { service, hashCalls, blockchainCalls } = createService({
    async assertUserCanIssueForIssuer() {
      throw new ForbiddenException(
        'El usuario issuer-user-1 no tiene membresia para emitir sobre el issuer issuer-1.'
      );
    }
  });

  await assert.rejects(
    service.issueCredential(
      'cred-123',
      {
        issuerId: 'issuer-1',
        issuedAt: '2026-07-22T18:00:00Z'
      },
      currentUser
    ),
    ForbiddenException
  );

  assert.equal(hashCalls.length, 0);
  assert.equal(blockchainCalls.length, 0);
});

test('CredentialsService rejects inactive issuer memberships', async () => {
  const { service, hashCalls, blockchainCalls } = createService({
    async assertUserCanIssueForIssuer() {
      throw new ForbiddenException(
        'La membresia del usuario issuer-user-1 para el issuer issuer-1 no esta activa.'
      );
    }
  });

  await assert.rejects(
    service.issueCredential(
      'cred-123',
      {
        issuerId: 'issuer-1',
        issuedAt: '2026-07-22T18:00:00Z'
      },
      currentUser
    ),
    ForbiddenException
  );

  assert.equal(hashCalls.length, 0);
  assert.equal(blockchainCalls.length, 0);
});

test('CredentialsService rejects issuer memberships with non-emitting roles', async () => {
  const { service, hashCalls, blockchainCalls } = createService({
    async assertUserCanIssueForIssuer() {
      throw new ForbiddenException(
        'El rol viewer no tiene permisos para emitir sobre el issuer issuer-1.'
      );
    }
  });

  await assert.rejects(
    service.issueCredential(
      'cred-123',
      {
        issuerId: 'issuer-1',
        issuedAt: '2026-07-22T18:00:00Z'
      },
      currentUser
    ),
    ForbiddenException
  );

  assert.equal(hashCalls.length, 0);
  assert.equal(blockchainCalls.length, 0);
});

test('CredentialsService allows an active issuer admin and preserves hashing/blockchain flow', async () => {
  const { service, issueMembershipCalls, issuerEligibilityCalls, hashCalls, blockchainCalls } =
    createService();

  const response = await service.issueCredential(
    'cred-123',
    {
      issuerId: 'issuer-1',
      issuedAt: '2026-07-22T18:00:00.456Z'
    },
    currentUser
  );

  assert.deepEqual(issueMembershipCalls, [
    {
      userId: 'issuer-user-1',
      issuerId: 'issuer-1'
    }
  ]);
  assert.equal(issuerEligibilityCalls.length, 1);
  assert.equal(hashCalls.length, 1);
  assert.equal(blockchainCalls.length, 1);
  // S8c4: el issuer_did canonicalizado ya NO es el Issuer.did legacy, sino el
  // DID de la identidad tecnica, que es el sujeto del DID Document publico.
  assert.equal(hashCalls[0].issuerDid, TECHNICAL_IDENTITY_DID);
  assert.notEqual(hashCalls[0].issuerDid, 'did:example:issuer-demo');
  assert.equal(hashCalls[0].subjectDid, 'did:example:holder-demo');
  assert.equal(hashCalls[0].title, 'Algoritmos y Estructuras de Datos');
  assert.equal(hashCalls[0].credentialId, 'cred-123');
  assert.equal(hashCalls[0].schemaVersion, 'credential_v2');
  assert.equal(hashCalls[0].requestedVersion, 'canon_v2');
  assert.equal(
    (hashCalls[0].issuedAt as Date).toISOString(),
    '2026-07-22T18:00:00.000Z'
  );

  // 48: el anclaje existente recibe EXACTAMENTE el mismo hash canon_v2 que se
  // persistio y se firmo, etiquetado con su version real.
  assert.deepEqual(blockchainCalls[0], {
    credentialId: 'cred-123',
    credentialHash: response.canonicalHash,
    canonicalizationVersion: 'canon_v2',
    issuerAddress: '0x00000000000000000000000000000000000000aa'
  });
  assert.equal(response.status, 'issued');
  assert.equal(response.schemaVersion, 'credential_v2');
  assert.equal(response.canonicalizationVersion, 'canon_v2');
  assert.match(response.canonicalHash ?? '', /^0x[0-9a-f]{64}$/);
  assert.equal(response.latestBlockchainRecord?.status, 'registered');
});

// A1/A2.1: readiness real de un holder auto-registrado (User.did === null,
// exactamente lo que AuthService.register produce cuando PUBLIC_DID_BASE_URL
// no esta configurada -- ver auth.service.ts y auth-and-permissions-v0.md).
// getSubjectUserOrThrow (createDraft) nunca lee/exige did -- un holder
// auto-registrado puede ser destinatario de un draft de inmediato.
// issueCredential SI exige un DID resuelto via ensureDidForUser: sin
// PUBLIC_DID_BASE_URL configurada (caso de este test), el provisioning
// perezoso no tiene forma de generar uno y falla con el mismo
// BadRequestException que ya existia antes de A2.1 (ver seccion "SEMANTICA
// EXACTA DE PUBLIC_DID_BASE_URL" del diseno: config ausente = feature
// deshabilitada, nunca un DID inventado).
test('A1/A2.1: a self-registered holder (User.did === null) can be the subject of a draft, but issuance stays blocked without PUBLIC_DID_BASE_URL configured', async () => {
  const registeredHolderId = 'holder-registered-1';
  const draft = createDraftService({
    subjectUser: { id: registeredHolderId }
  });

  const draftResponse = await draft.service.createDraft(
    { ...validDraftDto, subjectUserId: registeredHolderId },
    currentUser
  );

  assert.equal(draftResponse.status, 'draft');
  assert.deepEqual(draft.subjectLookupCalls[0]?.select, { id: true });

  const issuance = createService({
    credential: createCredentialFixture({
      subjectUserId: registeredHolderId,
      subjectUser: { id: registeredHolderId, did: null }
    })
  });

  await assert.rejects(
    issuance.service.issueCredential(
      'cred-123',
      { issuerId: 'issuer-1' },
      currentUser
    ),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      const response = (error as BadRequestException).getResponse() as { message: string };
      assert.match(response.message, new RegExp(`${registeredHolderId} no tiene DID configurado`));
      return true;
    }
  );
  assert.equal(issuance.hashCalls.length, 0);
  assert.equal(issuance.blockchainCalls.length, 0);
});

// ---------------------------------------------------------------------------
// A2.1: provisioning perezoso de did:web dentro de issueCredential (ver
// ensure-did-for-user.ts). createService() ya modela un delegate `user` en
// memoria inicializado desde el fixture credential.subjectUser.
// ---------------------------------------------------------------------------

function withDidBaseUrl<T>(value: string | undefined, run: () => Promise<T>) {
  const original = process.env.PUBLIC_DID_BASE_URL;

  if (value === undefined) {
    delete process.env.PUBLIC_DID_BASE_URL;
  } else {
    process.env.PUBLIC_DID_BASE_URL = value;
  }

  return run().finally(() => {
    if (original === undefined) {
      delete process.env.PUBLIC_DID_BASE_URL;
    } else {
      process.env.PUBLIC_DID_BASE_URL = original;
    }
  });
}

// A: holder con did existente -> no provisioning/update, se usa tal cual.
test('A2.1/A: issuing for a holder that already has a DID never writes and uses that exact DID for canonicalization', async () => {
  const { service, hashCalls, userUpdateManyCalls } = createService();

  await withDidBaseUrl('https://api.traza.example', async () => {
    await service.issueCredential(
      'cred-123',
      { issuerId: 'issuer-1', issuedAt: '2026-07-22T18:00:00Z' },
      currentUser
    );

    assert.equal(userUpdateManyCalls.length, 0);
    assert.equal(hashCalls[0].subjectDid, 'did:example:holder-demo');
  });
});

// B: holder legacy did=null + config valida -> provisiona, canonicalization
// usa el DID persistido, la emision continua.
test('A2.1/B: issuing for a legacy did=null holder provisions a did:web and uses it for canonicalization', async () => {
  const holderId = '33333333-3333-4333-8333-333333333333';
  const { service, hashCalls, blockchainCalls, userUpdateManyCalls, getSubjectUserState } =
    createService({
      credential: createCredentialFixture({
        subjectUserId: holderId,
        subjectUser: { id: holderId, did: null }
      })
    });

  await withDidBaseUrl('https://api.traza.example', async () => {
    const response = await service.issueCredential(
      'cred-123',
      { issuerId: 'issuer-1', issuedAt: '2026-07-22T18:00:00Z' },
      currentUser
    );

    const expectedDid = `did:web:api.traza.example:did:users:${holderId}`;
    assert.equal(userUpdateManyCalls.length, 1);
    assert.equal(getSubjectUserState().did, expectedDid);
    assert.equal(hashCalls[0].subjectDid, expectedDid);
    assert.equal(response.status, 'issued');
    assert.equal(blockchainCalls.length, 1);
  });
});

// D/I: dos issueCredential concurrentes para el mismo holder legacy nunca
// producen dos DIDs distintos ni corrompen el fake -- ambos terminan usando
// el mismo valor reconciliado (ver ensure-did-for-user.ts, "I" en su propio
// test suite para la prueba dedicada de la condicion de carrera). Este test
// documenta que issueCredential nunca sigue usando un valor propio
// calculado antes de la reconciliacion.
test('A2.1/stale-read: issueCredential never falls back to a value read before provisioning', async () => {
  const holderId = '44444444-4444-4444-8444-444444444444';
  const { service, hashCalls } = createService({
    credential: createCredentialFixture({
      subjectUserId: holderId,
      subjectUser: { id: holderId, did: null }
    })
  });

  await withDidBaseUrl('https://api.traza.example', async () => {
    await service.issueCredential(
      'cred-123',
      { issuerId: 'issuer-1', issuedAt: '2026-07-22T18:00:00Z' },
      currentUser
    );

    // Si issueCredential todavia usara credential.subjectUser.did (que ya
    // no existe: el include se elimino), esto seria undefined/null en vez
    // del DID recien provisionado.
    assert.equal(hashCalls[0].subjectDid, `did:web:api.traza.example:did:users:${holderId}`);
  });
});

// Orden de side effects: un intento de emision que de todos modos va a ser
// rechazado por autorizacion NUNCA debe intentar provisionar un DID.
test('A2.1/order: an unauthorized issuance attempt never calls ensureDidForUser', async () => {
  const { service, userFindUniqueCalls, userUpdateManyCalls } = createService({
    async assertUserCanIssueForIssuer() {
      throw new ForbiddenException(
        'El usuario issuer-user-1 no tiene membresia para emitir sobre el issuer issuer-1.'
      );
    }
  });

  await withDidBaseUrl('https://api.traza.example', async () => {
    await assert.rejects(
      service.issueCredential(
        'cred-123',
        { issuerId: 'issuer-1', issuedAt: '2026-07-22T18:00:00Z' },
        currentUser
      ),
      ForbiddenException
    );

    assert.equal(userFindUniqueCalls.length, 0);
    assert.equal(userUpdateManyCalls.length, 0);
  });
});

test('A2.1/order: an unauthorized issuer state never calls ensureDidForUser', async () => {
  const { service, userFindUniqueCalls, userUpdateManyCalls } = createService({
    assertIssuerCanIssue() {
      throw new BadRequestException('El issuer no esta autorizado para emitir.');
    }
  });

  await withDidBaseUrl('https://api.traza.example', async () => {
    await assert.rejects(
      service.issueCredential('cred-123', { issuerId: 'issuer-1' }, currentUser),
      BadRequestException
    );

    assert.equal(userFindUniqueCalls.length, 0);
    assert.equal(userUpdateManyCalls.length, 0);
  });
});

test('CredentialsService preserves issuer authorization and configuration requirements', async () => {
  const { service, hashCalls, blockchainCalls } = createService({
    assertIssuerCanIssue() {
      throw new BadRequestException('El issuer no esta autorizado para emitir.');
    }
  });

  await assert.rejects(
    service.issueCredential(
      'cred-123',
      { issuerId: 'issuer-1' },
      currentUser
    ),
    BadRequestException
  );
  assert.equal(hashCalls.length, 0);
  assert.equal(blockchainCalls.length, 0);
});

test('CredentialsService still rejects credentials that are not in draft', async () => {
  const { service } = createService({
    credential: createCredentialFixture({
      status: CredentialStatus.issued
    })
  });

  await assert.rejects(
    service.issueCredential(
      'cred-123',
      {
        issuerId: 'issuer-1',
        issuedAt: '2026-07-22T18:00:00Z'
      },
      currentUser
    ),
    ConflictException
  );
});

test('CredentialsService preserves the existing generic credential read response', async () => {
  const { service } = createService();

  const response = await service.getCredential('cred-123');

  assert.equal(response.id, 'cred-123');
  assert.equal(response.issuerId, 'issuer-1');
  assert.equal(response.subjectUserId, 'holder-1');
  assert.equal(response.status, CredentialStatus.draft);
  assert.deepEqual(response.credentialSubject, {
    achievement_name: 'Algoritmos y Estructuras de Datos',
    institution_name: 'Demo University',
    skills: ['algoritmos', 'programacion']
  });
});

// ===========================================================================
// S8c4 -- EMISION AUTENTICADA. Matrices 30-51.
//
// El arnes usa criptografia REAL (ver `createService`), asi que estas
// aserciones comprueban la cadena completa y no constantes acordadas:
//
//   payload final -> canon_v2 -> UN canonicalHash -> envelope exacto
//   -> bytes UTF-8 -> assertion Wallet -> firma EIP-191 -> Credential.proof
// ===========================================================================

const ISSUE_DTO = {
  issuerId: 'issuer-1',
  issuedAt: '2026-07-22T18:00:00Z'
} as const;

test('30: una emision autorizada produce credential_v2, canon_v2 y proof persistido', async () => {
  const { service, updateCalls } = createService();

  const response = await service.issueCredential('cred-123', ISSUE_DTO, currentUser);

  assert.equal(response.status, 'issued');
  assert.equal(response.schemaVersion, 'credential_v2');
  assert.equal(response.canonicalizationVersion, 'canon_v2');
  assert.match(response.canonicalHash ?? '', /^0x[0-9a-f]{64}$/);

  const proof = response.proof;
  assert.ok(proof, 'la respuesta de emision trae el proof');
  assert.deepEqual(Object.keys(proof).sort(), [
    'canonicalizationVersion',
    'cryptosuite',
    'hashAlgorithm',
    'profile',
    'proofPurpose',
    'proofValue',
    'type',
    'verificationMethod'
  ]);
  assert.equal(proof.type, 'ScopeCredentialProof2026');
  assert.equal(proof.profile, 'scope-proof-v1');
  assert.equal(proof.cryptosuite, 'ecdsa-secp256k1-eip191');
  assert.equal(proof.proofPurpose, 'assertionMethod');
  assert.equal(proof.canonicalizationVersion, 'canon_v2');
  assert.equal(proof.hashAlgorithm, 'sha-256');

  // 43: los campos de autenticidad viajan en UNA sola mutacion.
  assert.equal(updateCalls.length, 1);
  const data = updateCalls[0].data as Record<string, unknown>;
  assert.deepEqual(Object.keys(data).sort(), [
    'canonicalHash',
    'canonicalizationVersion',
    'issuedAt',
    'proof',
    'schemaVersion',
    'status'
  ]);
  assert.equal(data.status, CredentialStatus.issued);
  assert.equal(data.schemaVersion, 'credential_v2');
  assert.equal(data.canonicalizationVersion, 'canon_v2');
  assert.equal(data.canonicalHash, response.canonicalHash);
  assert.deepEqual(data.proof, proof);
});

test('31: el canonicalHash persistido es EXACTAMENTE el que fue firmado', async () => {
  const { service, signMessageInputs, signerAddress } = createService();

  const response = await service.issueCredential('cred-123', ISSUE_DTO, currentUser);
  const proof = response.proof!;

  // Se reconstruye el envelope desde los valores PERSISTIDOS y se comprueba
  // que es, byte a byte, el que recibio la Wallet.
  const expectedEnvelope = buildScopeProofV1Envelope({
    verificationMethod: proof.verificationMethod,
    canonicalHash: response.canonicalHash!
  });

  assert.equal(signMessageInputs.length, 1);
  const signedBytes = signMessageInputs[0] as Uint8Array;
  assert.ok(signedBytes instanceof Uint8Array);
  assert.equal(Buffer.from(signedBytes).toString('utf8'), expectedEnvelope);

  // Y la firma se recupera a la direccion de la assertion key.
  assert.equal(
    verifyMessage(toUtf8Bytes(expectedEnvelope), proof.proofValue),
    signerAddress
  );
  assert.equal(
    hashMessage(signedBytes),
    hashMessage(toUtf8Bytes(expectedEnvelope))
  );

  // El hash dentro del envelope firmado es el de la columna, no otro.
  assert.ok(expectedEnvelope.includes(`canonicalHash=${response.canonicalHash}`));
});

test('32: issuer_did sale de IssuerTechnicalIdentity, nunca del Issuer.did legacy', async () => {
  const { service, hashCalls, technicalIdentityCalls } = createService();

  const response = await service.issueCredential('cred-123', ISSUE_DTO, currentUser);

  assert.deepEqual(technicalIdentityCalls, [
    { where: { issuerId: 'issuer-1' }, select: { did: true } }
  ]);
  assert.equal(hashCalls[0].issuerDid, TECHNICAL_IDENTITY_DID);
  assert.equal(response.issuerDid, TECHNICAL_IDENTITY_DID);
  assert.notEqual(hashCalls[0].issuerDid, 'did:example:issuer-demo');
  assert.notEqual(
    hashCalls[0].issuerDid,
    '0x00000000000000000000000000000000000000aa'
  );
});

test('33: el verificationMethod coincide con el fragmento que publica S8c3', async () => {
  for (const keyVersion of [1, 2, 9]) {
    const { service } = createService({ signerKeyVersion: keyVersion });

    const response = await service.issueCredential(
      'cred-123',
      ISSUE_DTO,
      currentUser
    );

    assert.equal(
      response.proof?.verificationMethod,
      `${TECHNICAL_IDENTITY_DID}#assert-${keyVersion}`,
      String(keyVersion)
    );
  }
});

test('34: un did:web almacenado inconsistente falla ANTES de firmar y de anclar', async () => {
  for (const storedDid of [
    'did:example:issuer-demo',
    'did:web:api.scopeedu.technology:did:issuers:otro-issuer',
    'did:web:api.scopeedu.technology:did:users:issuer-1',
    'did:key:z6Mk',
    ''
  ]) {
    const {
      service,
      resolverCalls,
      signMessageInputs,
      blockchainCalls,
      updateCalls
    } = createService({ technicalIdentityDid: storedDid });

    await assert.rejects(
      service.issueCredential('cred-123', ISSUE_DTO, currentUser),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException, storedDid);
        return true;
      },
      storedDid
    );

    // Falla cerrado ANTES del almacen de secretos, antes de la firma, antes
    // de la escritura y antes de cualquier intento de anclaje.
    assert.deepEqual(resolverCalls, [], storedDid);
    assert.deepEqual(signMessageInputs, [], storedDid);
    assert.deepEqual(blockchainCalls, [], storedDid);
    assert.deepEqual(updateCalls, [], storedDid);
  }
});

test('34b: sin fila de identidad tecnica no hay emision ni lectura de secreto', async () => {
  const { service, resolverCalls, blockchainCalls, updateCalls } = createService({
    technicalIdentityMissing: true
  });

  await assert.rejects(
    service.issueCredential('cred-123', ISSUE_DTO, currentUser),
    ConflictException
  );
  assert.deepEqual(resolverCalls, []);
  assert.deepEqual(blockchainCalls, []);
  assert.deepEqual(updateCalls, []);
});

test('35-36: una identidad o un perfil no utilizables no emiten ni anclan', async () => {
  // Los codes los decide S8c2; S8c4 solo tiene que fallar cerrado con todos.
  const codes = [
    'TECHNICAL_IDENTITY_NOT_CONFIGURED',
    'TECHNICAL_IDENTITY_INACTIVE',
    'SIGNER_PROFILE_NOT_CONFIGURED',
    'SIGNER_PROFILE_INACTIVE',
    'SIGNER_PURPOSE_MISMATCH',
    'SIGNER_ADDRESS_NOT_VERIFIED',
    'SIGNER_ADDRESS_MISMATCH',
    'SIGNER_PUBLIC_KEY_MISMATCH',
    'SIGNER_SECRET_INVALID',
    'SIGNER_SECRET_REFERENCE_REJECTED'
  ] as const;

  for (const code of codes) {
    const { service, signMessageInputs, blockchainCalls, updateCalls } =
      createService({
        resolverError: new SignerResolutionError(code, {
          issuerId: 'issuer-1',
          profileId: 'signer-profile-assertion-1'
        })
      });

    await assert.rejects(
      service.issueCredential('cred-123', ISSUE_DTO, currentUser),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException, code);

        // 28: nada del detalle interno cruza el limite.
        const body = (error as ConflictException).getResponse() as {
          message: string;
        };
        assert.equal(
          body.message,
          'La identidad de firma del emisor no esta lista para emitir.'
        );
        for (const leak of [
          code,
          'secretRef',
          'signer-profile-assertion-1',
          'SignerProfile',
          'SSM',
          'ssm',
          'publicKey',
          'address'
        ]) {
          assert.ok(!body.message.includes(leak), `${code} filtra ${leak}`);
        }
        return true;
      },
      code
    );

    assert.deepEqual(signMessageInputs, [], code);
    assert.deepEqual(blockchainCalls, [], code);
    assert.deepEqual(updateCalls, [], code);
  }
});

test('37: si el secreto no esta disponible no hay actualizacion parcial', async () => {
  const { service, signMessageInputs, blockchainCalls, updateCalls } =
    createService({
      resolverError: new SignerResolutionError('SIGNER_SECRET_UNAVAILABLE', {
        issuerId: 'issuer-1'
      })
    });

  await assert.rejects(
    service.issueCredential('cred-123', ISSUE_DTO, currentUser),
    (error: unknown) => {
      // Se distingue de "no configurado": reintentar puede ayudar.
      assert.ok(error instanceof ServiceUnavailableException, String(error));
      const body = (error as ServiceUnavailableException).getResponse() as {
        message: string;
      };
      assert.equal(
        body.message,
        'El servicio de firma del emisor no esta disponible temporalmente. Intentelo nuevamente.'
      );
      return true;
    }
  );

  assert.deepEqual(signMessageInputs, []);
  assert.deepEqual(blockchainCalls, []);
  assert.deepEqual(updateCalls, [], 'la credencial no se toco');
});

test('38: un User sin autorizacion produce CERO resoluciones de signer', async () => {
  const unauthorized = createService({
    async assertUserCanIssueForIssuer() {
      throw new ForbiddenException('sin membresia');
    }
  });

  await assert.rejects(
    unauthorized.service.issueCredential('cred-123', ISSUE_DTO, currentUser),
    ForbiddenException
  );

  assert.deepEqual(unauthorized.resolverCalls, []);
  assert.deepEqual(unauthorized.technicalIdentityCalls, []);
  assert.deepEqual(unauthorized.signMessageInputs, []);
  assert.deepEqual(unauthorized.blockchainCalls, []);

  // Tampoco un issuer no elegible.
  const ineligible = createService({
    assertIssuerCanIssue() {
      throw new BadRequestException('issuer no habilitado');
    }
  });

  await assert.rejects(
    ineligible.service.issueCredential('cred-123', ISSUE_DTO, currentUser),
    BadRequestException
  );
  assert.deepEqual(ineligible.resolverCalls, []);
  assert.deepEqual(ineligible.technicalIdentityCalls, []);
});

test('38b: la autorizacion ocurre ANTES de resolver el signer y de abrir la transaccion', async () => {
  const { service, operationOrder } = createService();

  await service.issueCredential('cred-123', ISSUE_DTO, currentUser);

  assert.deepEqual(operationOrder, [
    'issuer_authorization',
    'issuer_eligibility',
    'technical_identity_lookup',
    'signer_resolution',
    'transaction_start',
    'final_row_read',
    'credential_update',
    'blockchain_create',
    'transaction_end'
  ]);

  // LIMITE CRITICO: la resolucion del signer -- que puede ir a SSM -- ocurre
  // ESTRICTAMENTE antes de que la transaccion interactiva se abra.
  assert.ok(
    operationOrder.indexOf('signer_resolution') <
      operationOrder.indexOf('transaction_start'),
    'la lectura de secreto no puede entrar en la transaccion'
  );
  assert.equal(
    operationOrder.filter((step) => step === 'signer_resolution').length,
    1,
    'se resuelve UNA sola vez'
  );
});

test('39-40: crear y editar borradores produce CERO resoluciones de signer', async () => {
  // El doble de proof de `createDraftService` lanza si lo invocan, asi que un
  // borrador que intentara firmar fallaria ruidosamente.
  const draft = createDraftService();

  const created = await draft.service.createDraft(validDraftDto, currentUser);

  assert.equal(created.status, 'draft');
  assert.equal(created.schemaVersion, 'credential_v1');
  assert.equal(created.canonicalHash, undefined);
  assert.equal(created.canonicalizationVersion, undefined);
  assert.equal(created.proof, undefined, 'un borrador no tiene proof');
  assert.equal(created.issuerDid, undefined);

  // Un borrador curricular tampoco.
  const curricular = createDraftService();
  const curricularDraft = await curricular.service.createDraft(
    validCurricularDraftDto,
    currentUser
  );
  assert.equal(curricularDraft.proof, undefined);
  assert.equal(curricularDraft.schemaVersion, 'credential_v1');
});

test('41: una credencial ya emitida no se vuelve a firmar', async () => {
  const alreadyIssued = createService({
    credential: createCredentialFixture({
      status: CredentialStatus.issued,
      schemaVersion: 'credential_v2',
      canonicalHash: '0x' + 'b'.repeat(64),
      canonicalizationVersion: 'canon_v2',
      issuedAt: new Date('2026-07-01T10:00:00Z')
    })
  });

  await assert.rejects(
    alreadyIssued.service.issueCredential('cred-123', ISSUE_DTO, currentUser),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      return true;
    }
  );

  assert.deepEqual(alreadyIssued.resolverCalls, []);
  assert.deepEqual(alreadyIssued.signMessageInputs, []);
  assert.deepEqual(alreadyIssued.updateCalls, []);
  assert.deepEqual(alreadyIssued.blockchainCalls, []);
});

test('41b: si deja de estar en draft DENTRO de la transaccion, no se persiste nada', async () => {
  const { service, signMessageInputs, updateCalls, blockchainCalls } =
    createService({ finalRowStatus: CredentialStatus.issued });

  await assert.rejects(
    service.issueCredential('cred-123', ISSUE_DTO, currentUser),
    ConflictException
  );

  // El snapshot dentro de la transaccion es el que decide: se revalida el
  // estado antes de canonicalizar y de firmar.
  assert.deepEqual(signMessageInputs, []);
  assert.deepEqual(updateCalls, []);
  assert.deepEqual(blockchainCalls, []);
});

test('41c: si la fila desaparece entre la lectura y la transaccion, falla cerrado', async () => {
  const { service, signMessageInputs, updateCalls } = createService({
    finalRowMissing: true
  });

  await assert.rejects(
    service.issueCredential('cred-123', ISSUE_DTO, currentUser),
    NotFoundException
  );
  assert.deepEqual(signMessageInputs, []);
  assert.deepEqual(updateCalls, []);
});

test('42: con blockchain en modo mock la autenticidad sigue siendo REAL', async () => {
  // El modo de evidencia de blockchain es un eje independiente: aqui el doble
  // de evidencia es el camino mock, y el proof sigue siendo una firma real de
  // la assertion key sobre canon_v2.
  const original = process.env.BLOCKCHAIN_EVIDENCE_MODE;
  process.env.BLOCKCHAIN_EVIDENCE_MODE = 'mock';

  try {
    const { service, signerAddress } = createService();

    const response = await service.issueCredential(
      'cred-123',
      ISSUE_DTO,
      currentUser
    );
    const proof = response.proof!;

    assert.equal(response.canonicalizationVersion, 'canon_v2');
    assert.equal(response.schemaVersion, 'credential_v2');
    assert.match(proof.proofValue, /^0x[0-9a-f]{130}$/);

    // No es un placeholder: la firma verifica contra la clave de asercion.
    const envelope = buildScopeProofV1Envelope({
      verificationMethod: proof.verificationMethod,
      canonicalHash: response.canonicalHash!
    });
    assert.equal(
      verifyMessage(toUtf8Bytes(envelope), proof.proofValue),
      signerAddress
    );
    assert.ok(!proof.proofValue.includes('0'.repeat(64)));
  } finally {
    if (original === undefined) {
      delete process.env.BLOCKCHAIN_EVIDENCE_MODE;
    } else {
      process.env.BLOCKCHAIN_EVIDENCE_MODE = original;
    }
  }
});

test('43: no existe estado v2 sin proof, ni proof con canon_v1, ni hash sin version', async () => {
  const { service, updateCalls } = createService();

  await service.issueCredential('cred-123', ISSUE_DTO, currentUser);

  const data = updateCalls[0].data as Record<string, unknown>;

  // Las cinco combinaciones prohibidas, comprobadas sobre la MISMA mutacion.
  assert.ok(data.schemaVersion === 'credential_v2' && data.proof !== undefined);
  assert.ok(data.proof !== null);
  assert.equal(data.canonicalizationVersion, 'canon_v2');
  assert.notEqual(data.canonicalizationVersion, 'canon_v1');
  assert.match(data.canonicalHash as string, /^0x[0-9a-f]{64}$/);
  assert.equal(
    (data.proof as Record<string, unknown>).canonicalizationVersion,
    data.canonicalizationVersion
  );
});

test('45: una credencial credential_v1 historica no se toca ni se resigna', async () => {
  // Una fila legacy ya emitida: canon_v1, sin proof. No hay backfill, no hay
  // resignado y no hay cambio retroactivo de hash -- la emision la rechaza
  // por estado, igual que antes de S8c4.
  const legacy = createService({
    credential: createCredentialFixture({
      status: CredentialStatus.issued,
      schemaVersion: 'credential_v1',
      canonicalizationVersion: 'canon_v1',
      canonicalHash: '0x' + 'c'.repeat(64)
    })
  });

  await assert.rejects(
    legacy.service.issueCredential('cred-123', ISSUE_DTO, currentUser),
    ConflictException
  );

  assert.deepEqual(legacy.updateCalls, []);
  assert.deepEqual(legacy.resolverCalls, []);
  assert.deepEqual(legacy.hashCalls, []);
});

// ---------------------------------------------------------------------------
// 46-51: SEPARACION ASERCION / ANCLAJE
// ---------------------------------------------------------------------------

test('46: la Wallet de asercion NUNCA llega al cliente de blockchain', async () => {
  const { service, blockchainCalls, signerAddress } = createService();

  await service.issueCredential('cred-123', ISSUE_DTO, currentUser);

  assert.equal(blockchainCalls.length, 1);
  const payload = blockchainCalls[0];

  assert.deepEqual(Object.keys(payload).sort(), [
    'canonicalizationVersion',
    'credentialHash',
    'credentialId',
    'issuerAddress'
  ]);

  // Ni la Wallet, ni su direccion, ni el perfil de asercion.
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes(signerAddress));
  assert.ok(!serialized.toLowerCase().includes(signerAddress.toLowerCase()));
  assert.ok(!serialized.includes('signer-profile'));
  assert.ok(!serialized.includes('wallet'));
  assert.ok(!serialized.includes('proofValue'));

  // La direccion que recibe el anclaje sigue siendo la del plano LEGACY.
  assert.equal(payload.issuerAddress, '0x00000000000000000000000000000000000000aa');
  assert.notEqual(payload.issuerAddress, signerAddress);
});

test('47: si el proof falla, CERO intentos de escritura on-chain', async () => {
  const failures = [
    createService({
      resolverError: new SignerResolutionError('SIGNER_SECRET_UNAVAILABLE', {})
    }),
    createService({ technicalIdentityDid: 'did:example:issuer-demo' }),
    createService({ signerPurpose: SignerProfilePurpose.anchor }),
    createService({ signerKeyVersion: 0 })
  ];

  for (const [index, world] of failures.entries()) {
    await assert.rejects(
      world.service.issueCredential('cred-123', ISSUE_DTO, currentUser),
      String(index)
    );

    assert.deepEqual(world.blockchainCalls, [], String(index));
    assert.deepEqual(world.updateCalls, [], String(index));
  }
});

test('47b: el proof se construye ANTES de cualquier etapa de blockchain', async () => {
  const { service, operationOrder } = createService();

  await service.issueCredential('cred-123', ISSUE_DTO, currentUser);

  // Nunca se ancla una credencial que no obtuvo su autoria: la escritura de
  // la credencial (que ya lleva el proof) precede al anclaje.
  assert.ok(
    operationOrder.indexOf('credential_update') <
      operationOrder.indexOf('blockchain_create')
  );
  assert.ok(
    operationOrder.indexOf('signer_resolution') <
      operationOrder.indexOf('blockchain_create')
  );
});

test('48: el anclaje recibe el MISMO canonicalHash, etiquetado canon_v2', async () => {
  const { service, blockchainCalls, hashCalls } = createService();

  const response = await service.issueCredential('cred-123', ISSUE_DTO, currentUser);

  // 20: el hash se calcula UNA sola vez para esta emision.
  assert.equal(hashCalls.length, 1);
  assert.equal(blockchainCalls[0].credentialHash, response.canonicalHash);
  assert.equal(blockchainCalls[0].canonicalizationVersion, 'canon_v2');
  assert.equal(
    response.latestBlockchainRecord?.credentialHash,
    response.canonicalHash
  );
  assert.equal(
    response.latestBlockchainRecord?.canonicalizationVersion,
    'canon_v2'
  );
});

test('49-50: un fallo de anclaje no deja la credencial a medio emitir', async () => {
  const { service, signMessageInputs, updateCalls } = createService({
    blockchainError: new Error('fallo el registro on-chain')
  });

  await assert.rejects(
    service.issueCredential('cred-123', ISSUE_DTO, currentUser),
    /fallo el registro on-chain/
  );

  // El proof SI se construyo (va antes), pero la transaccion entera revierte:
  // la emision no queda consumada. El rediseno del ciclo de vida es S8c6.
  assert.equal(signMessageInputs.length, 1);
  assert.equal(updateCalls.length, 1);
});

test('51: el proof no introduce ningun provider, RPC ni dependencia de red', async () => {
  const { service, anchorResolverCalls } = createService();

  await service.issueCredential('cred-123', ISSUE_DTO, currentUser);

  // La cuenta de anclaje nunca se resuelve para la autoria.
  assert.deepEqual(anchorResolverCalls, []);
});

// ---------------------------------------------------------------------------
// issued_at: UNA sola eleccion
// ---------------------------------------------------------------------------

test('issued_at se elige UNA vez y es el mismo valor en hash, proof y fila', async () => {
  const { service, hashCalls, updateCalls } = createService();

  const response = await service.issueCredential(
    'cred-123',
    { issuerId: 'issuer-1', issuedAt: '2026-07-22T18:00:00.456Z' },
    currentUser
  );

  const hashedIssuedAt = hashCalls[0].issuedAt as Date;
  const persistedIssuedAt = (updateCalls[0].data as Record<string, unknown>)
    .issuedAt as Date;

  assert.equal(hashedIssuedAt.getTime(), persistedIssuedAt.getTime());
  assert.equal(hashedIssuedAt.toISOString(), '2026-07-22T18:00:00.000Z');
  assert.equal(response.issuedAt, '2026-07-22T18:00:00Z');
});

test('issued_at no llama al reloj dos veces para la misma emision', async () => {
  const originalNow = Date.now;
  const nowCalls: number[] = [];
  let tick = Date.parse('2026-07-22T18:00:00.000Z');

  // Cada consulta al reloj avanza un segundo: si la emision lo consultara dos
  // veces para el mismo instante, el hash y la fila divergirian.
  Date.now = () => {
    tick += 1000;
    nowCalls.push(tick);
    return tick;
  };

  try {
    const { service, hashCalls, updateCalls } = createService();

    await service.issueCredential('cred-123', { issuerId: 'issuer-1' }, currentUser);

    const hashedIssuedAt = hashCalls[0].issuedAt as Date;
    const persistedIssuedAt = (updateCalls[0].data as Record<string, unknown>)
      .issuedAt as Date;

    assert.equal(hashedIssuedAt.getTime(), persistedIssuedAt.getTime());
  } finally {
    Date.now = originalNow;
  }
});

// ---------------------------------------------------------------------------
// SNAPSHOT: lo firmado es lo persistido
// ---------------------------------------------------------------------------

test('el snapshot firmado se lee DENTRO de la transaccion', async () => {
  const { service, operationOrder, hashCalls } = createService();

  await service.issueCredential('cred-123', ISSUE_DTO, currentUser);

  // La canonicalizacion usa la fila releida dentro de la transaccion, no la
  // lectura inicial: entre ambas se resolvio el signer, que pudo ir a la red.
  assert.ok(
    operationOrder.indexOf('final_row_read') <
      operationOrder.indexOf('credential_update')
  );
  assert.ok(
    operationOrder.indexOf('transaction_start') <
      operationOrder.indexOf('final_row_read')
  );
  assert.equal(hashCalls.length, 1);
});

test('la escritura lleva un token de version: estado draft y updatedAt del snapshot', async () => {
  const { service, updateCalls } = createService();

  await service.issueCredential('cred-123', ISSUE_DTO, currentUser);

  const where = updateCalls[0].where as Record<string, unknown>;
  assert.deepEqual(Object.keys(where).sort(), ['id', 'status', 'updatedAt']);
  assert.equal(where.id, 'cred-123');
  assert.equal(where.status, CredentialStatus.draft);
  assert.ok(where.updatedAt instanceof Date);
});

test('si la fila cambia despues del snapshot, la emision no se consuma', async () => {
  const { service, blockchainCalls } = createService({
    concurrentlyMutated: true
  });

  await assert.rejects(
    service.issueCredential('cred-123', ISSUE_DTO, currentUser),
    /P2025/
  );

  // La transaccion revierte: nunca se persiste una firma sobre un payload
  // distinto del guardado.
  assert.deepEqual(blockchainCalls, []);
});

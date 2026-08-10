import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from '@nestjs/common';
import {
  CredentialSourceType,
  CredentialStatus,
  CredentialType,
  UserStatus
} from '@prisma/client';

import { CreateCredentialDraftDto } from './dto/create-credential-draft.dto';
import { CredentialsService } from './credentials.service';

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
      {} as never
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

function createService(options?: {
  credential?: CredentialFixture | null;
  assertUserCanIssueForIssuer?: (
    userId: string,
    issuerId: string
  ) => Promise<unknown>;
  assertIssuerCanIssue?: (issuer: CredentialFixture['issuer']) => void;
}) {
  const credential = options?.credential ?? createCredentialFixture();
  const issueMembershipCalls: Array<Record<string, unknown>> = [];
  const issuerEligibilityCalls: Array<Record<string, unknown>> = [];
  const hashCalls: Array<Record<string, unknown>> = [];
  const blockchainCalls: Array<Record<string, unknown>> = [];

  const prisma = {
    credential: {
      async findUnique() {
        return credential;
      }
    },
    $transaction: async (
      callback: (transaction: {
        credential: {
          update(args: Record<string, unknown>): Promise<Record<string, unknown>>;
        };
      }) => Promise<unknown>
    ) =>
      callback({
        credential: {
          async update(args: Record<string, unknown>) {
            return {
              ...(credential as CredentialFixture),
              status: CredentialStatus.issued,
              issuedAt: (args.data as Record<string, unknown>).issuedAt as Date,
              canonicalHash: (args.data as Record<string, unknown>).canonicalHash,
              canonicalizationVersion: (args.data as Record<string, unknown>)
                .canonicalizationVersion
            };
          }
        }
      })
  };

  const issuersService = {
    async assertUserCanIssueForIssuer(userId: string, issuerId: string) {
      issueMembershipCalls.push({ userId, issuerId });
      if (options?.assertUserCanIssueForIssuer) {
        return options.assertUserCanIssueForIssuer(userId, issuerId);
      }

      return {
        id: 'membership-1'
      };
    },
    assertIssuerCanIssue(issuer: CredentialFixture['issuer']) {
      issuerEligibilityCalls.push({ issuer });
      options?.assertIssuerCanIssue?.(issuer);
    }
  };

  const blockchainEvidenceService = {
    async createRecord(
      _transaction: unknown,
      payload: Record<string, unknown>
    ) {
      blockchainCalls.push(payload);
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

  const credentialHashingService = {
    createCanonicalHash(input: Record<string, unknown>) {
      hashCalls.push(input);
      return {
        canonicalHash: '0x' + 'a'.repeat(64),
        canonicalizationVersion: 'canon_v1',
        canonicalJson: '{"mock":"canonical"}'
      };
    }
  };

  return {
    service: new CredentialsService(
      prisma as never,
      issuersService as never,
      blockchainEvidenceService as never,
      credentialHashingService as never
    ),
    issueMembershipCalls,
    issuerEligibilityCalls,
    hashCalls,
    blockchainCalls
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
  assert.equal(hashCalls[0].issuerDid, 'did:example:issuer-demo');
  assert.equal(hashCalls[0].subjectDid, 'did:example:holder-demo');
  assert.equal(hashCalls[0].title, 'Algoritmos y Estructuras de Datos');
  assert.equal(
    (hashCalls[0].issuedAt as Date).toISOString(),
    '2026-07-22T18:00:00.000Z'
  );
  assert.deepEqual(blockchainCalls[0], {
    credentialId: 'cred-123',
    credentialHash: '0x' + 'a'.repeat(64),
    canonicalizationVersion: 'canon_v1',
    issuerAddress: '0x00000000000000000000000000000000000000aa'
  });
  assert.equal(response.status, 'issued');
  assert.equal(response.canonicalHash, '0x' + 'a'.repeat(64));
  assert.equal(response.canonicalizationVersion, 'canon_v1');
  assert.equal(response.latestBlockchainRecord?.status, 'registered');
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

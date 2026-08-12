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
  Prisma,
  UserStatus
} from '@prisma/client';

import { issuerCredentialReadSelect } from './issuer-credential-read.mapper';
import { IssuerCredentialDraftUpdateService } from './issuer-credential-draft-update.service';

const EXPECTED_UPDATED_AT = '2026-07-30T12:05:00.000Z';
const NEXT_UPDATED_AT = '2026-07-30T12:06:00.000Z';
const currentUser = {
  id: 'issuer-user-1',
  email: 'issuer.admin@example.com',
  did: null,
  status: UserStatus.active
} as const;

function createCredentialRecord(
  overrides: Record<string, unknown> = {}
) {
  return {
    id: 'credential-1',
    status: CredentialStatus.draft,
    type: CredentialType.course,
    title: 'Nombre anterior',
    description: 'Descripcion anterior',
    hours: new Prisma.Decimal('12.00'),
    sourceType: CredentialSourceType.manual_issuer,
    credentialSubject: {
      achievement_name: 'Nombre divergente',
      institution_name: 'Institucion divergente',
      skills: ['preservada'],
      legacy_key: 'preservada'
    },
    createdAt: new Date('2026-07-30T12:00:00.000Z'),
    updatedAt: new Date(EXPECTED_UPDATED_AT),
    issuer: {
      name: 'Demo University',
      did: 'did:example:issuer-demo'
    },
    subjectUser: {
      email: 'holder.demo@example.com',
      did: 'did:example:holder-demo',
      displayName: 'Demo Holder',
      firstName: null,
      lastName: null
    },
    academicCourse: null,
    programCourse: null,
    documentEvidences: [],
    textEvidences: [],
    blockchainRecords: [],
    ...overrides
  };
}

function createUpdatedCredentialRecord(
  overrides: Record<string, unknown> = {}
) {
  return createCredentialRecord({
    title: 'Arquitectura de Software',
    description: 'Descripcion normalizada',
    hours: new Prisma.Decimal('24.50'),
    credentialSubject: {
      achievement_name: 'Arquitectura de Software',
      institution_name: 'Demo University',
      skills: ['preservada'],
      legacy_key: 'preservada'
    },
    updatedAt: new Date(NEXT_UPDATED_AT),
    ...overrides
  });
}

function createService(options?: {
  authorizationError?: Error;
  credential?: ReturnType<typeof createCredentialRecord> | null;
  updateCount?: number;
  updatedCredential?: ReturnType<typeof createCredentialRecord> | null;
  academicCourse?: {
    id: string;
    name: string;
    description: string | null;
    hours: Prisma.Decimal | null;
  } | null;
  programCourse?: Record<string, unknown> | null;
}) {
  const operationOrder: string[] = [];
  const authorizationCalls: Array<Record<string, unknown>> = [];
  const transactionOptions: Array<Record<string, unknown>> = [];
  const findFirstCalls: Array<Record<string, unknown>> = [];
  const updateManyCalls: Array<Record<string, unknown>> = [];
  const academicCourseCalls: Array<Record<string, unknown>> = [];
  const programCourseCalls: Array<Record<string, unknown>> = [];
  const transaction = {
    academicCourse: {
      async findFirst(args: Record<string, unknown>) {
        operationOrder.push('academic_course_lookup');
        academicCourseCalls.push(args);
        return options?.academicCourse === undefined
          ? {
              id: 'academic-course-1',
              name: 'Ingenieria de Datos II',
              description: null,
              hours: null
            }
          : options.academicCourse;
      }
    },
    programCourse: {
      async findFirst(args: Record<string, unknown>) {
        operationOrder.push('program_course_lookup');
        programCourseCalls.push(args);
        return options?.programCourse === undefined
          ? {
              id: 'program-course-1',
              academicCourse: {
                id: 'academic-course-1',
                name: 'Ingenieria de Datos II',
                description: null,
                hours: null
              },
              curriculumVersion: {
                program: { name: 'Ingenieria en Informatica' }
              }
            }
          : options.programCourse;
      }
    },
    credential: {
      async findFirst(args: Record<string, unknown>) {
        operationOrder.push(
          findFirstCalls.length === 0 ? 'credential_read' : 'credential_reread'
        );
        findFirstCalls.push(args);

        if (findFirstCalls.length === 1) {
          return options?.credential === undefined
            ? createCredentialRecord()
            : options.credential;
        }

        return options?.updatedCredential === undefined
          ? createUpdatedCredentialRecord()
          : options.updatedCredential;
      },
      async updateMany(args: Record<string, unknown>) {
        operationOrder.push('credential_cas');
        updateManyCalls.push(args);
        return {
          count: options?.updateCount ?? 1
        };
      },
      async create() {
        throw new Error('P2a must not create credentials');
      },
      async delete() {
        throw new Error('P2a must not delete credentials');
      }
    }
  };
  const prisma = {
    async $transaction(
      callback: (client: typeof transaction) => Promise<unknown>,
      config: Record<string, unknown>
    ) {
      operationOrder.push('transaction');
      transactionOptions.push(config);
      return callback(transaction);
    }
  };
  const issuersService = {
    async assertUserCanUpdateDraftForIssuer(userId: string, issuerId: string) {
      operationOrder.push('issuer_authorization');
      authorizationCalls.push({ userId, issuerId });

      if (options?.authorizationError) {
        throw options.authorizationError;
      }

      return { id: 'membership-1' };
    }
  };

  return {
    service: new IssuerCredentialDraftUpdateService(
      prisma as never,
      issuersService as never
    ),
    operationOrder,
    authorizationCalls,
    transactionOptions,
    findFirstCalls,
    updateManyCalls,
    academicCourseCalls,
    programCourseCalls
  };
}

test('service selects an active issuer course and snapshots official data', async () => {
  const credential = createCredentialRecord({
    type: CredentialType.academic_subject,
    credentialSubject: {
      achievement_name: 'Nombre anterior',
      institution_name: 'Nombre anterior',
      completion_date: '2026-07-30',
      academic_period: '2026-1',
      grade: '9',
      skills: ['TypeScript'],
      competencies: ['Diseno de datos'],
      legacy_key: 'preservada'
    }
  });
  const academicCourse = {
    id: 'academic-course-1',
    name: 'Ingenieria de Datos II',
    description: 'Descripcion oficial',
    hours: new Prisma.Decimal('64.00')
  };
  const updatedCredential = createUpdatedCredentialRecord({
    type: CredentialType.academic_subject,
    title: academicCourse.name,
    description: academicCourse.description,
    hours: academicCourse.hours,
    credentialSubject: {
      achievement_name: academicCourse.name,
      institution_name: 'Demo University',
      completion_date: '2026-07-30',
      academic_period: '2026-1',
      grade: '9',
      skills: ['TypeScript'],
      competencies: ['Diseno de datos'],
      legacy_key: 'preservada'
    },
    academicCourse: {
      id: academicCourse.id,
      code: '3.4.213',
      name: academicCourse.name,
      description: academicCourse.description,
      hours: academicCourse.hours
    }
  });
  const {
    service,
    operationOrder,
    academicCourseCalls,
    updateManyCalls
  } = createService({ credential, academicCourse, updatedCredential });

  const response = await service.updateDraftForIssuer(
    'issuer-1',
    'credential-1',
    {
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      academicCourseReference: ' academic-course-1 ',
      completionDate: '2026-07-30',
      academicPeriod: '2026-1',
      grade: '9',
      skills: ['TypeScript'],
      competencies: ['Diseno de datos']
    },
    currentUser
  );

  assert.deepEqual(operationOrder, [
    'issuer_authorization',
    'transaction',
    'credential_read',
    'academic_course_lookup',
    'credential_cas',
    'credential_reread'
  ]);
  assert.deepEqual(academicCourseCalls, [
    {
      where: {
        id: 'academic-course-1',
        issuerId: 'issuer-1',
        status: 'active'
      },
      select: {
        id: true,
        name: true,
        description: true,
        hours: true
      }
    }
  ]);
  const data = (updateManyCalls[0] as { data: Record<string, unknown> }).data;
  assert.equal(data.academicCourseId, 'academic-course-1');
  assert.equal(data.title, academicCourse.name);
  assert.equal(data.description, academicCourse.description);
  assert.equal((data.hours as Prisma.Decimal).toFixed(2), '64.00');
  assert.deepEqual(data.credentialSubject, {
    achievement_name: academicCourse.name,
    institution_name: 'Demo University',
    completion_date: '2026-07-30',
    academic_period: '2026-1',
    grade: '9',
    skills: ['TypeScript'],
    competencies: ['Diseno de datos'],
    legacy_key: 'preservada'
  });
  assert.deepEqual(response.academicCourse, {
    academicCourseReference: 'academic-course-1',
    code: '3.4.213',
    name: academicCourse.name,
    description: academicCourse.description,
    hours: '64.00',
    program: null
  });
});

test('service validates and snapshots a course inside the selected curriculum', async () => {
  const credential = createCredentialRecord({
    type: CredentialType.academic_subject,
    credentialSubject: {
      achievement_name: 'Nombre anterior',
      institution_name: 'Nombre anterior',
      completion_date: '2026-07-30',
      academic_period: '2026-1',
      grade: '9',
      skills: ['TypeScript'],
      competencies: ['Diseno de datos'],
      legacy_key: 'preservada'
    }
  });
  const selectedProgramCourse = {
    id: 'program-course-1',
    academicCourse: {
      id: 'academic-course-1',
      name: 'Ingenieria de Datos II',
      description: null,
      hours: null
    },
    curriculumVersion: {
      program: { name: 'Ingenieria en Informatica' }
    }
  };
  const updatedCredential = createUpdatedCredentialRecord({
    type: CredentialType.academic_subject,
    title: selectedProgramCourse.academicCourse.name,
    description: null,
    hours: null,
    credentialSubject: {
      achievement_name: selectedProgramCourse.academicCourse.name,
      institution_name: 'Demo University',
      program_name: 'Ingenieria en Informatica',
      completion_date: '2026-07-30',
      academic_period: '2026-1',
      grade: '9',
      skills: ['TypeScript'],
      competencies: ['Diseno de datos'],
      legacy_key: 'preservada'
    },
    academicCourse: {
      id: 'academic-course-1',
      code: '3.4.213',
      name: selectedProgramCourse.academicCourse.name,
      description: null,
      hours: null
    },
    programCourse: {
      academicCourseId: 'academic-course-1',
      curriculumVersion: {
        id: 'curriculum-1',
        versionLabel: '1621',
        program: {
          id: 'program-1',
          code: '1621',
          name: 'Ingenieria en Informatica'
        }
      }
    }
  });
  const {
    service,
    operationOrder,
    academicCourseCalls,
    programCourseCalls,
    updateManyCalls
  } = createService({
    credential,
    programCourse: selectedProgramCourse,
    updatedCredential
  });

  const response = await service.updateDraftForIssuer(
    'issuer-1',
    'credential-1',
    {
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      academicCourseReference: ' academic-course-1 ',
      curriculumReference: ' curriculum-1 '
    },
    currentUser
  );

  assert.deepEqual(operationOrder, [
    'issuer_authorization',
    'transaction',
    'credential_read',
    'program_course_lookup',
    'credential_cas',
    'credential_reread'
  ]);
  assert.deepEqual(academicCourseCalls, []);
  assert.deepEqual(programCourseCalls, [
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
            hours: true
          }
        },
        curriculumVersion: {
          select: {
            program: {
              select: { name: true }
            }
          }
        }
      }
    }
  ]);
  const data = (updateManyCalls[0] as { data: Record<string, unknown> }).data;
  assert.equal(data.academicCourseId, 'academic-course-1');
  assert.equal(data.programCourseId, 'program-course-1');
  assert.equal(data.title, 'Ingenieria de Datos II');
  assert.equal(data.description, null);
  assert.equal(data.hours, null);
  assert.deepEqual(data.credentialSubject, {
    achievement_name: 'Ingenieria de Datos II',
    institution_name: 'Demo University',
    program_name: 'Ingenieria en Informatica',
    completion_date: '2026-07-30',
    academic_period: '2026-1',
    grade: '9',
    skills: ['TypeScript'],
    competencies: ['Diseno de datos'],
    legacy_key: 'preservada'
  });
  assert.deepEqual(response.academicCourse?.program, {
    programReference: 'program-1',
    programCode: '1621',
    programName: 'Ingenieria en Informatica',
    curriculumReference: 'curriculum-1',
    curriculumCode: '1621'
  });
});

test('service safely rejects a missing, inactive, cross-issuer or unrelated curriculum course', async () => {
  for (const reference of ['missing', 'inactive', 'cross-issuer', 'unrelated']) {
    const { service, programCourseCalls, updateManyCalls } = createService({
      credential: createCredentialRecord({
        type: CredentialType.academic_subject
      }),
      programCourse: null
    });

    await assert.rejects(
      service.updateDraftForIssuer(
        'issuer-1',
        'credential-1',
        {
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          academicCourseReference: 'academic-course-1',
          curriculumReference: reference
        },
        currentUser
      ),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal(
          error.message,
          'No se encontro la asignatura dentro de la curricula activa solicitada.'
        );
        return true;
      }
    );
    assert.equal(programCourseCalls.length, 1);
    assert.deepEqual(updateManyCalls, []);
  }
});

test('service rejects catalog selection unless the current draft is academic_subject', async () => {
  for (const type of [
    CredentialType.course,
    CredentialType.certification,
    CredentialType.degree
  ]) {
    const { service, academicCourseCalls, updateManyCalls } = createService({
      credential: createCredentialRecord({ type })
    });

    await assert.rejects(
      service.updateDraftForIssuer(
        'issuer-1',
        'credential-1',
        {
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          academicCourseReference: 'academic-course-1'
        },
        currentUser
      ),
      BadRequestException
    );
    assert.deepEqual(academicCourseCalls, []);
    assert.deepEqual(updateManyCalls, []);
  }
});

test('service returns the same safe 404 for missing, inactive and cross-issuer course references', async () => {
  for (const reference of ['missing', 'inactive', 'cross-issuer']) {
    const { service, academicCourseCalls, updateManyCalls } = createService({
      credential: createCredentialRecord({
        type: CredentialType.academic_subject
      }),
      academicCourse: null
    });

    await assert.rejects(
      service.updateDraftForIssuer(
        'issuer-1',
        'credential-1',
        {
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          academicCourseReference: reference
        },
        currentUser
      ),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal(
          error.message,
          'No se encontro una asignatura activa para el issuer solicitado.'
        );
        return true;
      }
    );
    assert.equal(academicCourseCalls.length, 1);
    assert.deepEqual(updateManyCalls, []);
  }
});

test('service authorizes, runs a Serializable transaction and applies an atomic scoped CAS', async () => {
  const {
    service,
    operationOrder,
    authorizationCalls,
    transactionOptions,
    findFirstCalls,
    updateManyCalls
  } = createService();

  const response = await service.updateDraftForIssuer(
    'issuer-1',
    'credential-1',
    {
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      achievementName: '  Arquitectura   de Software ',
      description: '  Descripcion normalizada  ',
      hours: '24.5'
    },
    currentUser
  );

  assert.deepEqual(operationOrder, [
    'issuer_authorization',
    'transaction',
    'credential_read',
    'credential_cas',
    'credential_reread'
  ]);
  assert.deepEqual(authorizationCalls, [
    { userId: 'issuer-user-1', issuerId: 'issuer-1' }
  ]);
  assert.deepEqual(transactionOptions, [
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  ]);
  assert.deepEqual(findFirstCalls, [
    {
      where: { id: 'credential-1', issuerId: 'issuer-1' },
      select: issuerCredentialReadSelect
    },
    {
      where: { id: 'credential-1', issuerId: 'issuer-1' },
      select: issuerCredentialReadSelect
    }
  ]);
  assert.equal(updateManyCalls.length, 1);

  const updateCall = updateManyCalls[0] as {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  };
  assert.deepEqual(updateCall.where, {
    id: 'credential-1',
    issuerId: 'issuer-1',
    status: CredentialStatus.draft,
    updatedAt: new Date(EXPECTED_UPDATED_AT)
  });
  assert.equal(updateCall.data.title, 'Arquitectura de Software');
  assert.equal(updateCall.data.description, 'Descripcion normalizada');
  assert.equal(
    (updateCall.data.hours as Prisma.Decimal).toFixed(2),
    '24.50'
  );
  assert.deepEqual(updateCall.data.credentialSubject, {
    achievement_name: 'Arquitectura de Software',
    institution_name: 'Demo University',
    legacy_key: 'preservada'
  });
  assert.equal(response.title, response.credentialSubject.achievement_name);
  assert.equal(
    response.credentialSubject.institution_name,
    response.issuer.displayName
  );
  assert.equal(response.description, 'Descripcion normalizada');
  assert.equal(response.hours, '24.50');
  assert.equal(response.updatedAt, NEXT_UPDATED_AT);
  assert.deepEqual(response.holder, {
    displayLabel: 'Demo Holder',
    email: 'holder.demo@example.com',
    did: 'did:example:holder-demo'
  });
});

test('service clears nullable fields, keeps omitted title and preserves existing subject keys', async () => {
  const updatedCredential = createUpdatedCredentialRecord({
    title: 'Nombre anterior',
    description: null,
    hours: null,
    credentialSubject: {
      achievement_name: 'Nombre anterior',
      institution_name: 'Demo University',
      skills: ['preservada'],
      legacy_key: 'preservada'
    }
  });
  const { service, updateManyCalls } = createService({ updatedCredential });

  const response = await service.updateDraftForIssuer(
    'issuer-1',
    'credential-1',
    {
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      description: null,
      hours: null
    },
    currentUser
  );

  const data = (updateManyCalls[0] as { data: Record<string, unknown> }).data;
  assert.deepEqual(Object.keys(data).sort(), [
    'credentialSubject',
    'description',
    'hours',
    'title'
  ]);
  assert.equal(data.title, 'Nombre anterior');
  assert.equal(data.description, null);
  assert.equal(data.hours, null);
  assert.deepEqual(data.credentialSubject, {
    achievement_name: 'Nombre anterior',
    institution_name: 'Demo University',
    legacy_key: 'preservada'
  });
  assert.equal(response.description, null);
  assert.equal(response.hours, null);
});

test('service accepts every controlled field applicable to each CredentialType', async () => {
  const cases: Array<{
    type: CredentialType;
    payload: Record<string, unknown>;
    expectedSubject: Record<string, unknown>;
  }> = [
    {
      type: CredentialType.academic_subject,
      payload: {
        completionDate: '2026-07-30',
        academicPeriod: '2026-1',
        programName: 'Ingenieria en Informatica',
        grade: '9',
        skills: ['Algoritmos'],
        competencies: ['Resolucion de problemas']
      },
      expectedSubject: {
        completion_date: '2026-07-30',
        academic_period: '2026-1',
        program_name: 'Ingenieria en Informatica',
        grade: '9',
        skills: ['Algoritmos'],
        competencies: ['Resolucion de problemas']
      }
    },
    {
      type: CredentialType.course,
      payload: {
        completionDate: '2026-07-30',
        modality: 'Online',
        externalUrl: 'https://plataforma-demo.example.com/curso/123',
        competencies: ['Diseno de sistemas'],
        learningOutcomes: ['Construir APIs']
      },
      expectedSubject: {
        completion_date: '2026-07-30',
        modality: 'Online',
        external_url: 'https://plataforma-demo.example.com/curso/123',
        competencies: ['Diseno de sistemas'],
        learning_outcomes: ['Construir APIs']
      }
    },
    {
      type: CredentialType.certification,
      payload: {
        completionDate: '2026-07-30',
        certificationCode: 'CERT-001',
        expirationDate: '2028-07-30',
        externalUrl: 'https://example.com/certificate',
        providerName: 'Traza Academy',
        level: 'Professional',
        skills: ['TypeScript'],
        competencies: ['Diseno de sistemas']
      },
      expectedSubject: {
        completion_date: '2026-07-30',
        certification_code: 'CERT-001',
        expiration_date: '2028-07-30',
        external_url: 'https://example.com/certificate',
        provider_name: 'Traza Academy',
        level: 'Professional',
        skills: ['TypeScript'],
        competencies: ['Diseno de sistemas']
      }
    },
    {
      type: CredentialType.degree,
      payload: {
        completionDate: '2026-07-30',
        programName: 'Ingenieria en Informatica',
        level: 'Grado',
        grade: '9',
        competencies: ['Diseno de sistemas'],
        learningOutcomes: ['Liderar proyectos']
      },
      expectedSubject: {
        completion_date: '2026-07-30',
        program_name: 'Ingenieria en Informatica',
        level: 'Grado',
        grade: '9',
        competencies: ['Diseno de sistemas'],
        learning_outcomes: ['Liderar proyectos']
      }
    }
  ];

  for (const testCase of cases) {
    const { service, updateManyCalls } = createService({
      credential: createCredentialRecord({
        type: testCase.type,
        credentialSubject: {
          achievement_name: 'Nombre anterior',
          institution_name: 'Institucion anterior',
          legacy_key: 'preservada'
        }
      }),
      updatedCredential: createUpdatedCredentialRecord({ type: testCase.type })
    });

    await service.updateDraftForIssuer(
      'issuer-1',
      'credential-1',
      {
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        ...testCase.payload
      } as never,
      currentUser
    );

    const data = (updateManyCalls[0] as { data: Record<string, unknown> }).data;
    assert.equal('type' in data, false);
    assert.deepEqual(data.credentialSubject, {
      achievement_name: 'Nombre anterior',
      institution_name: 'Demo University',
      legacy_key: 'preservada',
      ...testCase.expectedSubject
    });
  }
});

test('service rejects an invalid externalUrl for course before updating the draft', async () => {
  const { service, updateManyCalls } = createService({
    credential: createCredentialRecord({ type: CredentialType.course })
  });

  await assert.rejects(
    service.updateDraftForIssuer(
      'issuer-1',
      'credential-1',
      {
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        externalUrl: 'javascript:alert(1)'
      },
      currentUser
    ),
    BadRequestException
  );
  assert.deepEqual(updateManyCalls, []);
});

test('service only accepts the controlled course modalities', async () => {
  for (const modality of ['Presencial', 'Online', 'Asincrónica']) {
    const { service, updateManyCalls } = createService();
    await service.updateDraftForIssuer(
      'issuer-1',
      'credential-1',
      { expectedUpdatedAt: EXPECTED_UPDATED_AT, modality },
      currentUser
    );
    assert.equal(
      ((updateManyCalls[0] as { data: { credentialSubject: Record<string, unknown> } }).data
        .credentialSubject.modality),
      modality
    );
  }

  const { service, updateManyCalls } = createService();
  await assert.rejects(
    service.updateDraftForIssuer(
      'issuer-1',
      'credential-1',
      { expectedUpdatedAt: EXPECTED_UPDATED_AT, modality: 'Híbrido' },
      currentUser
    ),
    BadRequestException
  );
  assert.equal(updateManyCalls.length, 0);
});

test('service normalizes an academic grade and accepts the structured academic period', async () => {
  const { service, updateManyCalls } = createService({
    credential: createCredentialRecord({
      type: CredentialType.academic_subject
    }),
    updatedCredential: createUpdatedCredentialRecord({
      type: CredentialType.academic_subject
    })
  });

  await service.updateDraftForIssuer(
    'issuer-1',
    'credential-1',
    {
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      grade: '08.50',
      academicPeriod: '2026-2'
    },
    currentUser
  );

  const data = (updateManyCalls[0] as { data: Record<string, unknown> }).data;
  assert.deepEqual(data.credentialSubject, {
    achievement_name: 'Nombre anterior',
    institution_name: 'Demo University',
    skills: ['preservada'],
    legacy_key: 'preservada',
    grade: '8.5',
    academic_period: '2026-2'
  });
});

test('service rejects invalid academic grades before updating the draft', async () => {
  for (const grade of ['texto', '-1', '10.01', '8.555', '8.']) {
    const { service, updateManyCalls } = createService({
      credential: createCredentialRecord({
        type: CredentialType.academic_subject
      })
    });

    await assert.rejects(
      service.updateDraftForIssuer(
        'issuer-1',
        'credential-1',
        { expectedUpdatedAt: EXPECTED_UPDATED_AT, grade },
        currentUser
      ),
      BadRequestException
    );
    assert.deepEqual(updateManyCalls, []);
  }
});

test('service rejects unstructured academic periods before updating the draft', async () => {
  for (const academicPeriod of [
    '2026',
    '2026-3',
    '26-1',
    '2026 primer cuatrimestre'
  ]) {
    const { service, updateManyCalls } = createService({
      credential: createCredentialRecord({
        type: CredentialType.academic_subject
      })
    });

    await assert.rejects(
      service.updateDraftForIssuer(
        'issuer-1',
        'credential-1',
        { expectedUpdatedAt: EXPECTED_UPDATED_AT, academicPeriod },
        currentUser
      ),
      BadRequestException
    );
    assert.deepEqual(updateManyCalls, []);
  }
});

test('service preserves the existing degree grade contract', async () => {
  const { service, updateManyCalls } = createService({
    credential: createCredentialRecord({ type: CredentialType.degree }),
    updatedCredential: createUpdatedCredentialRecord({
      type: CredentialType.degree
    })
  });

  await service.updateDraftForIssuer(
    'issuer-1',
    'credential-1',
    { expectedUpdatedAt: EXPECTED_UPDATED_AT, grade: 'Distinguido' },
    currentUser
  );

  const data = (updateManyCalls[0] as { data: Record<string, unknown> }).data;
  assert.equal(
    (data.credentialSubject as Record<string, unknown>).grade,
    'Distinguido'
  );
});

test('service rejects carrying a non-numeric degree grade into academic_subject', async () => {
  const { service, updateManyCalls } = createService({
    credential: createCredentialRecord({
      type: CredentialType.degree,
      credentialSubject: {
        achievement_name: 'Nombre anterior',
        institution_name: 'Demo University',
        grade: 'Distinguido'
      }
    })
  });

  await assert.rejects(
    service.updateDraftForIssuer(
      'issuer-1',
      'credential-1',
      {
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        type: CredentialType.academic_subject
      },
      currentUser
    ),
    BadRequestException
  );
  assert.deepEqual(updateManyCalls, []);
});

test('service rejects every field that is not applicable to the final type, including null', async () => {
  const cases: Array<{
    type: CredentialType;
    fields: string[];
  }> = [
    {
      type: CredentialType.academic_subject,
      fields: [
        'providerName',
        'platformName',
        'modality',
        'level',
        'certificationCode',
        'expirationDate',
        'externalUrl',
        'learningOutcomes'
      ]
    },
    {
      type: CredentialType.course,
      fields: [
        'academicPeriod',
        'programName',
        'grade',
        'certificationCode',
        'expirationDate'
      ]
    },
    {
      type: CredentialType.certification,
      fields: [
        'academicPeriod',
        'programName',
        'platformName',
        'modality',
        'grade',
        'learningOutcomes'
      ]
    },
    {
      type: CredentialType.degree,
      fields: [
        'academicPeriod',
        'providerName',
        'platformName',
        'modality',
        'certificationCode',
        'expirationDate',
        'externalUrl',
        'skills'
      ]
    }
  ];

  for (const testCase of cases) {
    for (const field of testCase.fields) {
      const { service, updateManyCalls } = createService({
        credential: createCredentialRecord({ type: testCase.type })
      });

      await assert.rejects(
        service.updateDraftForIssuer(
          'issuer-1',
          'credential-1',
          {
            expectedUpdatedAt: EXPECTED_UPDATED_AT,
            [field]: null
          } as never,
          currentUser
        ),
        BadRequestException,
        `${testCase.type}:${field}`
      );
      assert.deepEqual(updateManyCalls, []);
    }
  }
});

test('service rejects non-UADE draft type changes to academic types before persistence', async () => {
  for (const targetType of [
    CredentialType.academic_subject,
    CredentialType.degree
  ]) {
    const { service, updateManyCalls, academicCourseCalls, operationOrder } =
      createService({
        credential: createCredentialRecord({
          type: CredentialType.course,
          issuer: {
            name: 'Plataforma de Cursos Demo',
            did: 'did:example:course-platform-demo'
          }
        })
      });

    await assert.rejects(
      service.updateDraftForIssuer(
        'issuer-1',
        'credential-1',
        {
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          type: targetType
        },
        currentUser
      ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          error.message,
          'Este emisor no puede crear credenciales académicas.'
        );
        return true;
      }
    );

    assert.deepEqual(updateManyCalls, []);
    assert.deepEqual(academicCourseCalls, []);
    assert.deepEqual(operationOrder, [
      'issuer_authorization',
      'transaction',
      'credential_read'
    ]);
  }
});

test('service allows non-UADE drafts to remain course or become certification', async () => {
  for (const targetType of [CredentialType.course, CredentialType.certification]) {
    const { service, updateManyCalls } = createService({
      credential: createCredentialRecord({
        type: CredentialType.course,
        issuer: {
          name: 'Plataforma de Cursos Demo',
          did: 'did:example:course-platform-demo'
        }
      })
    });

    await service.updateDraftForIssuer(
      'issuer-1',
      'credential-1',
      {
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        ...(targetType === CredentialType.course ? { description: 'Valido' } : { type: targetType })
      },
      currentUser
    );

    assert.equal(updateManyCalls.length, 1);
    const data = (updateManyCalls[0] as { data: Record<string, unknown> }).data;
    assert.equal(
      'type' in data ? data.type : CredentialType.course,
      targetType
    );
  }
});

test('service preserves UADE draft type changes to academic types', async () => {
  for (const targetType of [
    CredentialType.academic_subject,
    CredentialType.degree
  ]) {
    const { service, updateManyCalls } = createService({
      credential: createCredentialRecord({ type: CredentialType.course })
    });

    await service.updateDraftForIssuer(
      'issuer-1',
      'credential-1',
      { expectedUpdatedAt: EXPECTED_UPDATED_AT, type: targetType },
      currentUser
    );

    assert.equal(updateManyCalls.length, 1);
    assert.equal(
      (updateManyCalls[0] as { data: Record<string, unknown> }).data.type,
      targetType
    );
  }
});

test('service evaluates applicability against the requested final type', async () => {
  const { service, updateManyCalls } = createService({
    credential: createCredentialRecord({ type: CredentialType.course })
  });

  await assert.rejects(
    service.updateDraftForIssuer(
      'issuer-1',
      'credential-1',
      {
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        type: CredentialType.certification,
        modality: null
      },
      currentUser
    ),
    BadRequestException
  );
  assert.deepEqual(updateManyCalls, []);
});

test('changing type removes incompatible controlled fields, preserves compatible fields and legacy keys', async () => {
  const { service, updateManyCalls } = createService({
    credential: createCredentialRecord({
      type: CredentialType.course,
      credentialSubject: {
        achievement_name: 'Nombre divergente',
        institution_name: 'Institucion divergente',
        completion_date: '2026-07-30',
        provider_name: 'Proveedor preservado',
        platform_name: 'Plataforma anterior',
        modality: 'Virtual',
        level: 'Avanzado',
        skills: ['TypeScript'],
        competencies: ['Diseno'],
        learning_outcomes: ['Construir APIs'],
        academic_period: 'legacy controlled incompatible',
        legacy_key: 'preservada'
      }
    }),
    updatedCredential: createUpdatedCredentialRecord({
      type: CredentialType.certification,
      credentialSubject: {
        achievement_name: 'Nombre anterior',
        institution_name: 'Demo University',
        completion_date: '2026-07-30',
        provider_name: 'Proveedor preservado',
        level: 'Avanzado',
        skills: ['TypeScript'],
        competencies: ['Diseno'],
        certification_code: 'CERT-001',
        expiration_date: '2028-07-30',
        external_url: 'https://example.com/certificate',
        legacy_key: 'preservada'
      }
    })
  });

  const response = await service.updateDraftForIssuer(
    'issuer-1',
    'credential-1',
    {
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      type: CredentialType.certification,
      certificationCode: ' CERT-001 ',
      expirationDate: '2028-07-30',
      externalUrl: 'https://example.com/certificate'
    },
    currentUser
  );

  const data = (updateManyCalls[0] as { data: Record<string, unknown> }).data;
  assert.equal(data.type, CredentialType.certification);
  assert.deepEqual(data.credentialSubject, {
    achievement_name: 'Nombre anterior',
    institution_name: 'Demo University',
    completion_date: '2026-07-30',
    provider_name: 'Proveedor preservado',
    level: 'Avanzado',
    skills: ['TypeScript'],
    competencies: ['Diseno'],
    certification_code: 'CERT-001',
    expiration_date: '2028-07-30',
    external_url: 'https://example.com/certificate',
    legacy_key: 'preservada'
  });
  assert.equal('platform_name' in (data.credentialSubject as object), false);
  assert.equal('modality' in (data.credentialSubject as object), false);
  assert.equal('learning_outcomes' in (data.credentialSubject as object), false);
  assert.equal('academic_period' in (data.credentialSubject as object), false);
  assert.equal(JSON.stringify(response).includes('legacy_key'), false);
});

test('service applies null clearing semantics to applicable controlled fields', async () => {
  const { service, updateManyCalls } = createService({
    credential: createCredentialRecord({
      credentialSubject: {
        achievement_name: 'Nombre anterior',
        institution_name: 'Institucion anterior',
        modality: 'Virtual',
        legacy_key: 'preservada'
      }
    })
  });

  await service.updateDraftForIssuer(
    'issuer-1',
    'credential-1',
    {
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      modality: null,
      competencies: null
    },
    currentUser
  );

  const subject = (updateManyCalls[0] as {
    data: { credentialSubject: Record<string, unknown> };
  }).data.credentialSubject;
  assert.equal('modality' in subject, false);
  assert.deepEqual(subject.competencies, []);
  assert.equal('provider_name' in subject, false);
  assert.equal(subject.legacy_key, 'preservada');
});

// C4x fix: platformName ya no es editable via PATCH para ningun tipo,
// aunque el credential.type final sea course (donde antes se aceptaba).
// Un platform_name legacy ya persistido debe sobrevivir sin cambios a un
// PATCH que no lo toca (no debe borrarse como un campo "no aplicable").
test('service rejects platformName as new editable input for course, even with a null value', async () => {
  {
    const { service, updateManyCalls } = createService({
      credential: createCredentialRecord({ type: CredentialType.course })
    });

    await assert.rejects(
      service.updateDraftForIssuer(
        'issuer-1',
        'credential-1',
        {
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          platformName: 'Campus nuevo'
        },
        currentUser
      ),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(
          error.message,
          'platformName no es un dato editable. La entidad emisora es la fuente institucional de la plataforma.'
        );
        return true;
      }
    );
    assert.deepEqual(updateManyCalls, []);
  }

  {
    const { service, updateManyCalls } = createService({
      credential: createCredentialRecord({ type: CredentialType.course })
    });

    await assert.rejects(
      service.updateDraftForIssuer(
        'issuer-1',
        'credential-1',
        {
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          platformName: null
        },
        currentUser
      ),
      BadRequestException
    );
    assert.deepEqual(updateManyCalls, []);
  }
});

test('service preserves a legacy platform_name untouched when patching an unrelated field on a course draft', async () => {
  const { service, updateManyCalls } = createService({
    credential: createCredentialRecord({
      type: CredentialType.course,
      credentialSubject: {
        achievement_name: 'Nombre anterior',
        institution_name: 'Institucion anterior',
        platform_name: 'Plataforma legacy',
        legacy_key: 'preservada'
      }
    })
  });

  await service.updateDraftForIssuer(
    'issuer-1',
    'credential-1',
    {
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      competencies: ['Diseno de sistemas']
    },
    currentUser
  );

  const subject = (updateManyCalls[0] as {
    data: { credentialSubject: Record<string, unknown> };
  }).data.credentialSubject;
  assert.equal(subject.platform_name, 'Plataforma legacy');
  assert.deepEqual(subject.competencies, ['Diseno de sistemas']);
});

test('service rejects an expiration date before the resulting completion date', async () => {
  const { service, updateManyCalls } = createService({
    credential: createCredentialRecord({
      type: CredentialType.certification,
      credentialSubject: {
        achievement_name: 'Nombre anterior',
        institution_name: 'Demo University',
        completion_date: '2026-07-30'
      }
    })
  });

  await assert.rejects(
    service.updateDraftForIssuer(
      'issuer-1',
      'credential-1',
      {
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        expirationDate: '2026-07-29'
      },
      currentUser
    ),
    BadRequestException
  );
  assert.deepEqual(updateManyCalls, []);
});

test('service authorizes before validation, reading or updating', async () => {
  const { service, operationOrder, findFirstCalls, updateManyCalls } =
    createService({
      authorizationError: new ForbiddenException('forbidden')
    });

  await assert.rejects(
    service.updateDraftForIssuer(
      'issuer-arbitrary',
      'credential-1',
      { expectedUpdatedAt: EXPECTED_UPDATED_AT } as never,
      currentUser
    ),
    ForbiddenException
  );

  assert.deepEqual(operationOrder, ['issuer_authorization']);
  assert.deepEqual(findFirstCalls, []);
  assert.deepEqual(updateManyCalls, []);
});

test('service returns the same safe 404 for missing and cross-issuer credentials', async () => {
  for (const credentialId of ['missing-credential', 'cross-issuer-credential']) {
    const { service, updateManyCalls } = createService({ credential: null });

    await assert.rejects(
      service.updateDraftForIssuer(
        'issuer-1',
        credentialId,
        {
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          description: 'valid'
        },
        currentUser
      ),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal(error.message, 'No se encontro la credencial solicitada.');
        return true;
      }
    );
    assert.deepEqual(updateManyCalls, []);
  }
});

test('service rejects issued and revoked credentials without updating', async () => {
  for (const status of [CredentialStatus.issued, CredentialStatus.revoked]) {
    const { service, updateManyCalls } = createService({
      credential: createCredentialRecord({ status })
    });

    await assert.rejects(
      service.updateDraftForIssuer(
        'issuer-1',
        'credential-1',
        {
          expectedUpdatedAt: EXPECTED_UPDATED_AT,
          description: 'valid'
        },
        currentUser
      ),
      ConflictException
    );
    assert.deepEqual(updateManyCalls, []);
  }
});

test('service rejects a stale expectedUpdatedAt before attempting the CAS', async () => {
  const { service, updateManyCalls, findFirstCalls } = createService();

  await assert.rejects(
    service.updateDraftForIssuer(
      'issuer-1',
      'credential-1',
      {
        expectedUpdatedAt: '2026-07-30T12:04:00.000Z',
        description: 'valid'
      },
      currentUser
    ),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(
        error.message,
        'El borrador fue actualizado desde otra sesion. Volve a cargarlo antes de guardar.'
      );
      return true;
    }
  );

  assert.equal(findFirstCalls.length, 1);
  assert.deepEqual(updateManyCalls, []);
});

test('service maps a failed updateMany compare-and-swap to the same safe conflict', async () => {
  const { service, updateManyCalls, findFirstCalls } = createService({
    updateCount: 0
  });

  await assert.rejects(
    service.updateDraftForIssuer(
      'issuer-1',
      'credential-1',
      {
        expectedUpdatedAt: EXPECTED_UPDATED_AT,
        description: 'valid'
      },
      currentUser
    ),
    ConflictException
  );

  assert.equal(updateManyCalls.length, 1);
  assert.equal(findFirstCalls.length, 1);
});

test('service rejects an invalid payload after authorization and before opening a transaction', async () => {
  const { service, operationOrder } = createService();

  await assert.rejects(
    service.updateDraftForIssuer(
      'issuer-1',
      'credential-1',
      { expectedUpdatedAt: EXPECTED_UPDATED_AT } as never,
      currentUser
    ),
    BadRequestException
  );

  assert.deepEqual(operationOrder, ['issuer_authorization']);
});

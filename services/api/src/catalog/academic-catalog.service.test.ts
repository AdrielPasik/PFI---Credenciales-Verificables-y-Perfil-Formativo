import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException
} from '@nestjs/common';
import {
  CourseStatus,
  CurriculumVersionStatus,
  Prisma,
  ProgramStatus,
  UserStatus
} from '@prisma/client';

import {
  AcademicCatalogService,
  DEFAULT_ACADEMIC_CATALOG_LIMIT
} from './academic-catalog.service';

const currentUser = {
  id: 'issuer-user-1',
  email: 'issuer.admin@example.com',
  did: null,
  status: UserStatus.active
} as const;

function createService(options?: {
  authorizationError?: Error;
  courses?: Array<Record<string, unknown>>;
}) {
  const operationOrder: string[] = [];
  const authorizationCalls: Array<Record<string, unknown>> = [];
  const findManyCalls: Array<Record<string, unknown>> = [];
  const prisma = {
    academicCourse: {
      async findMany(args: Record<string, unknown>) {
        operationOrder.push('catalog_lookup');
        findManyCalls.push(args);
        return (
          options?.courses ?? [
            {
              id: 'course-1',
              code: '3.4.213',
              name: 'Ingenieria de Datos II',
              description: null,
              hours: null,
              issuerId: 'must-not-leak',
              metadata: { mustNotLeak: true }
            }
          ]
        );
      },
      async create() {
        throw new Error('catalog search must not write');
      },
      async update() {
        throw new Error('catalog search must not write');
      },
      async delete() {
        throw new Error('catalog search must not write');
      }
    }
  };
  const issuersService = {
    async assertUserCanSearchAcademicCatalogForIssuer(
      userId: string,
      issuerId: string
    ) {
      operationOrder.push('issuer_authorization');
      authorizationCalls.push({ userId, issuerId });

      if (options?.authorizationError) {
        throw options.authorizationError;
      }

      return { id: 'membership-1' };
    }
  };

  return {
    service: new AcademicCatalogService(
      prisma as never,
      issuersService as never
    ),
    operationOrder,
    authorizationCalls,
    findManyCalls
  };
}

test('search authorizes first and queries active courses by code or name', async () => {
  const { service, operationOrder, authorizationCalls, findManyCalls } =
    createService({
      courses: [
        {
          id: 'course-1',
          code: '3.4.213',
          name: 'Ingenieria de Datos II',
          description: ' Materia oficial ',
          hours: new Prisma.Decimal('64.00')
        }
      ]
    });

  const response = await service.searchAcademicSubjectsForIssuer(
    'issuer-1',
    '  DATOS  ',
    '10',
    currentUser
  );

  assert.deepEqual(operationOrder, ['issuer_authorization', 'catalog_lookup']);
  assert.deepEqual(authorizationCalls, [
    { userId: 'issuer-user-1', issuerId: 'issuer-1' }
  ]);
  assert.deepEqual(findManyCalls, [
    {
      where: {
        issuerId: 'issuer-1',
        status: CourseStatus.active,
        OR: [
          { code: { contains: 'DATOS', mode: 'insensitive' } },
          { name: { contains: 'DATOS', mode: 'insensitive' } }
        ]
      },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        hours: true
      },
      orderBy: [{ code: 'asc' }, { name: 'asc' }],
      take: 10
    }
  ]);
  assert.deepEqual(response, {
    items: [
      {
        academicCourseReference: 'course-1',
        code: '3.4.213',
        name: 'Ingenieria de Datos II',
        description: 'Materia oficial',
        hours: '64.00'
      }
    ]
  });
});

test('omitted or blank query returns a deterministic default-limited catalog page', async () => {
  for (const query of [undefined, '', '   ']) {
    const { service, findManyCalls } = createService();

    await service.searchAcademicSubjectsForIssuer(
      'issuer-1',
      query,
      undefined,
      currentUser
    );

    const call = findManyCalls[0] as {
      where: Record<string, unknown>;
      take: number;
    };
    assert.deepEqual(call.where, {
      issuerId: 'issuer-1',
      status: CourseStatus.active
    });
    assert.equal(call.take, DEFAULT_ACADEMIC_CATALOG_LIMIT);
  }
});

test('search rejects invalid limits and never exceeds 50', async () => {
  for (const limit of ['0', '51', '-1', '1.5', 'invalid', 20, null]) {
    const { service, findManyCalls } = createService();

    await assert.rejects(
      service.searchAcademicSubjectsForIssuer(
        'issuer-1',
        'datos',
        limit,
        currentUser
      ),
      BadRequestException
    );
    assert.deepEqual(findManyCalls, []);
  }
});

test('search response is allowlisted and excludes issuerId and metadata', async () => {
  const { service } = createService();
  const response = await service.searchAcademicSubjectsForIssuer(
    'issuer-1',
    '3.4.213',
    '20',
    currentUser
  );

  assert.deepEqual(Object.keys(response.items[0]).sort(), [
    'academicCourseReference',
    'code',
    'description',
    'hours',
    'name'
  ]);
  assert.equal(JSON.stringify(response).includes('issuerId'), false);
  assert.equal(JSON.stringify(response).includes('metadata'), false);
});

test('search does not query the catalog before institutional authorization', async () => {
  const { service, operationOrder, findManyCalls } = createService({
    authorizationError: new ForbiddenException('forbidden')
  });

  await assert.rejects(
    service.searchAcademicSubjectsForIssuer(
      'issuer-arbitrary',
      'datos',
      '20',
      currentUser
    ),
    ForbiddenException
  );
  assert.deepEqual(operationOrder, ['issuer_authorization']);
  assert.deepEqual(findManyCalls, []);
});

function createCurriculumService(options?: {
  authorizationError?: Error;
  programs?: Array<Record<string, unknown>>;
  curriculum?: Record<string, unknown> | null;
  programCourses?: Array<Record<string, unknown>>;
}) {
  const operationOrder: string[] = [];
  const programCalls: Array<Record<string, unknown>> = [];
  const curriculumCalls: Array<Record<string, unknown>> = [];
  const programCourseCalls: Array<Record<string, unknown>> = [];
  const prisma = {
    program: {
      async findMany(args: Record<string, unknown>) {
        operationOrder.push('program_lookup');
        programCalls.push(args);
        return (
          options?.programs ?? [
            {
              id: 'program-1',
              code: '1621',
              name: 'Ingenieria en Informatica',
              curriculumVersions: [
                { id: 'curriculum-1', versionLabel: '1621' }
              ]
            }
          ]
        );
      }
    },
    curriculumVersion: {
      async findFirst(args: Record<string, unknown>) {
        operationOrder.push('curriculum_lookup');
        curriculumCalls.push(args);
        return options?.curriculum === undefined
          ? {
              id: 'curriculum-1',
              versionLabel: '1621',
              program: {
                id: 'program-1',
                code: '1621',
                name: 'Ingenieria en Informatica'
              }
            }
          : options.curriculum;
      }
    },
    programCourse: {
      async findMany(args: Record<string, unknown>) {
        operationOrder.push('program_course_lookup');
        programCourseCalls.push(args);
        return (
          options?.programCourses ?? [
            {
              academicCourse: {
                id: 'course-1',
                code: '3.4.213',
                name: 'Ingenieria de Datos II',
                description: null,
                hours: null,
                issuerId: 'must-not-leak',
                metadata: { mustNotLeak: true }
              }
            }
          ]
        );
      }
    }
  };
  const issuersService = {
    async assertUserCanSearchAcademicCatalogForIssuer() {
      operationOrder.push('issuer_authorization');

      if (options?.authorizationError) {
        throw options.authorizationError;
      }
    }
  };

  return {
    service: new AcademicCatalogService(prisma as never, issuersService as never),
    operationOrder,
    programCalls,
    curriculumCalls,
    programCourseCalls
  };
}

test('program search is issuer-scoped, active, deterministic and allowlisted', async () => {
  const { service, operationOrder, programCalls } = createCurriculumService();

  const response = await service.searchAcademicProgramsForIssuer(
    'issuer-1',
    '  INFORMATICA ',
    undefined,
    currentUser
  );

  assert.deepEqual(operationOrder, ['issuer_authorization', 'program_lookup']);
  assert.deepEqual(programCalls, [
    {
      where: {
        issuerId: 'issuer-1',
        status: ProgramStatus.active,
        curriculumVersions: {
          some: { status: CurriculumVersionStatus.active }
        },
        OR: [
          { code: { contains: 'INFORMATICA', mode: 'insensitive' } },
          { name: { contains: 'INFORMATICA', mode: 'insensitive' } }
        ]
      },
      select: {
        id: true,
        code: true,
        name: true,
        curriculumVersions: {
          where: { status: CurriculumVersionStatus.active },
          select: { id: true, versionLabel: true },
          orderBy: [{ versionLabel: 'asc' }, { id: 'asc' }],
          take: 1
        }
      },
      orderBy: [{ code: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      take: DEFAULT_ACADEMIC_CATALOG_LIMIT
    }
  ]);
  assert.deepEqual(response, {
    items: [
      {
        programReference: 'program-1',
        programCode: '1621',
        programName: 'Ingenieria en Informatica',
        curriculumReference: 'curriculum-1',
        curriculumCode: '1621'
      }
    ]
  });
  assert.equal(JSON.stringify(response).includes('issuerId'), false);
  assert.equal(JSON.stringify(response).includes('metadata'), false);
});

test('curriculum subject search returns only active courses scoped to its issuer', async () => {
  const { service, operationOrder, curriculumCalls, programCourseCalls } =
    createCurriculumService();

  const response = await service.searchAcademicSubjectsForCurriculum(
    'issuer-1',
    ' curriculum-1 ',
    ' datos ',
    '10',
    currentUser
  );

  assert.deepEqual(operationOrder, [
    'issuer_authorization',
    'curriculum_lookup',
    'program_course_lookup'
  ]);
  assert.deepEqual(curriculumCalls[0], {
    where: {
      id: 'curriculum-1',
      status: CurriculumVersionStatus.active,
      program: { issuerId: 'issuer-1', status: ProgramStatus.active }
    },
    select: {
      id: true,
      versionLabel: true,
      program: { select: { id: true, code: true, name: true } }
    }
  });
  assert.deepEqual(programCourseCalls[0], {
    where: {
      curriculumVersionId: 'curriculum-1',
      academicCourse: {
        issuerId: 'issuer-1',
        status: CourseStatus.active,
        OR: [
          { code: { contains: 'datos', mode: 'insensitive' } },
          { name: { contains: 'datos', mode: 'insensitive' } }
        ]
      }
    },
    select: {
      academicCourse: {
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          hours: true
        }
      }
    },
    orderBy: [
      { academicCourse: { code: 'asc' } },
      { academicCourse: { name: 'asc' } },
      { id: 'asc' }
    ],
    take: 10
  });
  assert.deepEqual(response, {
    items: [
      {
        academicCourseReference: 'course-1',
        code: '3.4.213',
        name: 'Ingenieria de Datos II',
        description: null,
        hours: null,
        programReference: 'program-1',
        programCode: '1621',
        programName: 'Ingenieria en Informatica',
        curriculumReference: 'curriculum-1',
        curriculumCode: '1621'
      }
    ]
  });
  assert.equal(JSON.stringify(response).includes('issuerId'), false);
  assert.equal(JSON.stringify(response).includes('metadata'), false);
});

test('curriculum search uses a safe not-found result and never queries relations', async () => {
  const { service, operationOrder, programCourseCalls } = createCurriculumService({
    curriculum: null
  });

  await assert.rejects(
    service.searchAcademicSubjectsForCurriculum(
      'issuer-1',
      'other-issuer-curriculum',
      undefined,
      undefined,
      currentUser
    ),
    NotFoundException
  );
  assert.deepEqual(operationOrder, ['issuer_authorization', 'curriculum_lookup']);
  assert.deepEqual(programCourseCalls, []);
});

test('new catalog searches authorize before querying institutional data', async () => {
  for (const method of ['programs', 'curriculum'] as const) {
    const { service, operationOrder, programCalls, curriculumCalls } =
      createCurriculumService({
        authorizationError: new ForbiddenException('forbidden')
      });

    await assert.rejects(
      method === 'programs'
        ? service.searchAcademicProgramsForIssuer(
            'issuer-arbitrary',
            undefined,
            undefined,
            currentUser
          )
        : service.searchAcademicSubjectsForCurriculum(
            'issuer-arbitrary',
            'curriculum-1',
            undefined,
            undefined,
            currentUser
          ),
      ForbiddenException
    );
    assert.deepEqual(operationOrder, ['issuer_authorization']);
    assert.deepEqual(programCalls, []);
    assert.deepEqual(curriculumCalls, []);
  }
});

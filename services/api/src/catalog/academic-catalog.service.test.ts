import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CourseStatus, Prisma, UserStatus } from '@prisma/client';

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

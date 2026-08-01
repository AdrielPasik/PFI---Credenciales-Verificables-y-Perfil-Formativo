import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { UserStatus } from '@prisma/client';

import { AuthGuard } from '../auth/auth.guard';
import { AcademicCatalogController } from './academic-catalog.controller';

test('academic catalog route is protected and issuer-scoped', () => {
  const controllerPath = Reflect.getMetadata(
    PATH_METADATA,
    AcademicCatalogController
  );
  const methodPath = Reflect.getMetadata(
    PATH_METADATA,
    AcademicCatalogController.prototype.searchAcademicSubjects
  );
  const requestMethod = Reflect.getMetadata(
    METHOD_METADATA,
    AcademicCatalogController.prototype.searchAcademicSubjects
  );
  const guards = Reflect.getMetadata(
    GUARDS_METADATA,
    AcademicCatalogController.prototype.searchAcademicSubjects
  ) as unknown[];

  assert.equal(controllerPath, 'issuers/:issuerId/catalog');
  assert.equal(methodPath, 'academic-subjects');
  assert.equal(requestMethod, RequestMethod.GET);
  assert.deepEqual(guards, [AuthGuard]);

  for (const [handler, path] of [
    ['searchAcademicPrograms', 'academic-programs'],
    [
      'searchAcademicSubjectsForCurriculum',
      'curriculum-versions/:curriculumReference/academic-subjects'
    ]
  ] as const) {
    const routeHandler = AcademicCatalogController.prototype[handler];

    assert.equal(Reflect.getMetadata(PATH_METADATA, routeHandler), path);
    assert.equal(
      Reflect.getMetadata(METHOD_METADATA, routeHandler),
      RequestMethod.GET
    );
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, routeHandler), [
      AuthGuard
    ]);
  }
});

test('controller delegates program and curriculum searches with current user', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const currentUser = {
    id: 'issuer-user-1',
    email: 'issuer.admin@example.com',
    did: null,
    status: UserStatus.active
  };
  const controller = new AcademicCatalogController({
    async searchAcademicProgramsForIssuer(
      issuerId: string,
      query: unknown,
      limit: unknown,
      authenticatedUser: Record<string, unknown>
    ) {
      calls.push({ kind: 'programs', issuerId, query, limit, authenticatedUser });
      return { items: [] };
    },
    async searchAcademicSubjectsForCurriculum(
      issuerId: string,
      curriculumReference: string,
      query: unknown,
      limit: unknown,
      authenticatedUser: Record<string, unknown>
    ) {
      calls.push({
        kind: 'curriculum',
        issuerId,
        curriculumReference,
        query,
        limit,
        authenticatedUser
      });
      return { items: [] };
    }
  } as never);

  await controller.searchAcademicPrograms(
    'issuer-1',
    'informatica',
    '5',
    currentUser
  );
  await controller.searchAcademicSubjectsForCurriculum(
    'issuer-1',
    'curriculum-1',
    'datos',
    '10',
    currentUser
  );

  assert.deepEqual(calls, [
    {
      kind: 'programs',
      issuerId: 'issuer-1',
      query: 'informatica',
      limit: '5',
      authenticatedUser: currentUser
    },
    {
      kind: 'curriculum',
      issuerId: 'issuer-1',
      curriculumReference: 'curriculum-1',
      query: 'datos',
      limit: '10',
      authenticatedUser: currentUser
    }
  ]);
});

test('controller delegates issuer, query, limit and current user', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const currentUser = {
    id: 'issuer-user-1',
    email: 'issuer.admin@example.com',
    did: null,
    status: UserStatus.active
  };
  const expected = {
    items: [
      {
        academicCourseReference: 'course-1',
        code: '3.4.213',
        name: 'Ingenieria de Datos II',
        description: null,
        hours: null
      }
    ]
  };
  const controller = new AcademicCatalogController({
    async searchAcademicSubjectsForIssuer(
      issuerId: string,
      query: unknown,
      limit: unknown,
      authenticatedUser: Record<string, unknown>
    ) {
      calls.push({ issuerId, query, limit, currentUser: authenticatedUser });
      return expected;
    }
  } as never);

  const response = await controller.searchAcademicSubjects(
    'issuer-1',
    ' datos ',
    '10',
    currentUser
  );

  assert.deepEqual(calls, [
    {
      issuerId: 'issuer-1',
      query: ' datos ',
      limit: '10',
      currentUser
    }
  ]);
  assert.deepEqual(response, expected);
});

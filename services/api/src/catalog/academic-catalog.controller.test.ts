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

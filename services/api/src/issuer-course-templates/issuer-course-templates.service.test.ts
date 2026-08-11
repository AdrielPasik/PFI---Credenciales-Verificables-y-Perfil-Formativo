import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from '@nestjs/common';
import { CourseTemplateStatus, CredentialType, UserStatus } from '@prisma/client';

import { IssuerCourseTemplatesService } from './issuer-course-templates.service';

const currentUser = {
  id: 'issuer-user-1',
  email: 'issuer.admin@example.com',
  did: null,
  status: UserStatus.active
} as const;

function decimalLike(value: string) {
  return {
    toFixed: (fractionDigits?: number) => Number(value).toFixed(fractionDigits),
    toString: () => value
  };
}

function baseTemplateRow(overrides?: Record<string, unknown>) {
  return {
    id: 'template-1',
    credentialType: CredentialType.course,
    title: 'Curso de Python',
    description: null,
    hours: null,
    modality: null,
    platformName: null,
    externalUrl: null,
    certificationCode: null,
    expirationDate: null,
    providerName: null,
    level: null,
    skills: [],
    competencies: [],
    learningOutcomes: [],
    status: CourseTemplateStatus.active,
    createdFromCredentialId: null,
    lastSemanticAnalysisId: null,
    createdAt: new Date('2026-08-11T10:00:00.000Z'),
    updatedAt: new Date('2026-08-11T10:00:00.000Z'),
    ...overrides
  };
}

function createService(options?: {
  authorizationError?: Error;
  templates?: Array<Record<string, unknown>>;
  credential?: Record<string, unknown> | null;
  createReturn?: Record<string, unknown>;
  updateReturn?: Record<string, unknown>;
}) {
  const calls: Array<Record<string, unknown>> = [];
  const authorizationCalls: Array<Record<string, unknown>> = [];

  const prisma = {
    issuerCourseTemplate: {
      async findMany(args: Record<string, unknown>) {
        calls.push({ op: 'findMany', args });
        const where = (args.where ?? {}) as Record<string, unknown>;
        return (options?.templates ?? []).filter((template) => {
          if ('status' in where && template.status !== where.status) {
            return false;
          }
          if (
            'createdFromCredentialId' in where &&
            template.createdFromCredentialId !== where.createdFromCredentialId
          ) {
            return false;
          }
          return true;
        });
      },
      async findFirst(args: Record<string, unknown>) {
        calls.push({ op: 'findFirst', args });
        return (options?.templates ?? []).find(
          (template) =>
            template.id ===
            (args.where as Record<string, unknown>).id
        ) ?? null;
      },
      async create(args: Record<string, unknown>) {
        calls.push({ op: 'create', args });
        return options?.createReturn ?? baseTemplateRow(args.data as Record<string, unknown>);
      },
      async update(args: Record<string, unknown>) {
        calls.push({ op: 'update', args });
        return options?.updateReturn ?? baseTemplateRow();
      }
    },
    credential: {
      async findFirst(args: Record<string, unknown>) {
        calls.push({ op: 'credential.findFirst', args });
        return options?.credential ?? null;
      }
    }
  };

  const issuersService = {
    async assertUserCanManageCourseTemplatesForIssuer(userId: string, issuerId: string) {
      authorizationCalls.push({ userId, issuerId });

      if (options?.authorizationError) {
        throw options.authorizationError;
      }

      return { id: 'membership-1' };
    }
  };

  return {
    service: new IssuerCourseTemplatesService(prisma as never, issuersService as never),
    calls,
    authorizationCalls
  };
}

test('list requires issuer authorization before querying', async () => {
  const { service, authorizationCalls } = createService({
    authorizationError: new ForbiddenException('no autorizado')
  });

  await assert.rejects(
    service.listTemplatesForIssuer('issuer-1', {}, currentUser),
    ForbiddenException
  );
  assert.deepEqual(authorizationCalls, [
    { userId: 'issuer-user-1', issuerId: 'issuer-1' }
  ]);
});

test('list returns only templates for the scoped issuer and defaults to active', async () => {
  const { service, calls } = createService({
    templates: [baseTemplateRow()]
  });

  const result = await service.listTemplatesForIssuer('issuer-1', {}, currentUser);

  assert.equal(result.length, 1);
  const findManyCall = calls.find((call) => call.op === 'findMany');
  const where = (findManyCall?.args as Record<string, unknown>).where as Record<string, unknown>;
  assert.equal(where.issuerId, 'issuer-1');
  assert.equal(where.status, CourseTemplateStatus.active);
});

test('list does not include archived templates by default', async () => {
  const { service } = createService({
    templates: [
      baseTemplateRow({ id: 't-active', status: CourseTemplateStatus.active }),
      baseTemplateRow({ id: 't-archived', status: CourseTemplateStatus.archived })
    ]
  });

  const result = await service.listTemplatesForIssuer('issuer-1', {}, currentUser);
  assert.deepEqual(result.map((item) => item.id), ['t-active']);

  const archivedResult = await service.listTemplatesForIssuer(
    'issuer-1',
    { status: 'archived' },
    currentUser
  );
  assert.deepEqual(archivedResult.map((item) => item.id), ['t-archived']);

  const allResult = await service.listTemplatesForIssuer(
    'issuer-1',
    { status: 'all' },
    currentUser
  );
  assert.deepEqual(
    allResult.map((item) => item.id).sort(),
    ['t-active', 't-archived']
  );
});

test('list accepts status=archived and status=all', async () => {
  const { service, calls } = createService({ templates: [] });

  await service.listTemplatesForIssuer('issuer-1', { status: 'archived' }, currentUser);
  await service.listTemplatesForIssuer('issuer-1', { status: 'all' }, currentUser);

  const wheres = calls
    .filter((call) => call.op === 'findMany')
    .map((call) => (call.args as Record<string, unknown>).where as Record<string, unknown>);

  assert.equal(wheres[0].status, CourseTemplateStatus.archived);
  assert.equal('status' in wheres[1], false);
});

test('list rejects an invalid status filter', async () => {
  const { service } = createService({ templates: [] });

  await assert.rejects(
    service.listTemplatesForIssuer('issuer-1', { status: 'deleted' }, currentUser),
    BadRequestException
  );
});

test('list search filters by title, platformName and description', async () => {
  const { service } = createService({
    templates: [
      baseTemplateRow({ id: 't-1', title: 'Curso de Python', platformName: null, description: null }),
      baseTemplateRow({ id: 't-2', title: 'Curso de Excel', platformName: 'Campus Python Academy', description: null }),
      baseTemplateRow({ id: 't-3', title: 'Curso de SQL', platformName: null, description: 'Bases de datos y python basico' }),
      baseTemplateRow({ id: 't-4', title: 'Curso de Diseño', platformName: null, description: null })
    ]
  });

  const result = await service.listTemplatesForIssuer(
    'issuer-1',
    { search: 'python' },
    currentUser
  );

  assert.deepEqual(
    result.map((item) => item.id).sort(),
    ['t-1', 't-2', 't-3']
  );
});

test('list search also matches providerName (certification parity with platformName)', async () => {
  const { service } = createService({
    templates: [
      baseTemplateRow({
        id: 't-cert-1',
        credentialType: CredentialType.certification,
        title: 'Certificacion AWS',
        providerName: 'Instituto Python Academy'
      })
    ]
  });

  const result = await service.listTemplatesForIssuer(
    'issuer-1',
    { search: 'python' },
    currentUser
  );

  assert.deepEqual(result.map((item) => item.id), ['t-cert-1']);
});

test('list includes course and certification templates together in the same catalog', async () => {
  const { service } = createService({
    templates: [
      baseTemplateRow({ id: 't-course', credentialType: CredentialType.course }),
      baseTemplateRow({ id: 't-cert', credentialType: CredentialType.certification })
    ]
  });

  const result = await service.listTemplatesForIssuer('issuer-1', {}, currentUser);

  assert.deepEqual(
    result.map((item) => item.credentialType).sort(),
    [CredentialType.certification, CredentialType.course]
  );
});

test('create manual builds a template scoped to the issuer and current user', async () => {
  const { service, calls } = createService();

  await service.createTemplateForIssuer(
    'issuer-1',
    { title: 'Curso de Python', hours: 22, modality: 'Online' },
    currentUser
  );

  const createCall = calls.find((call) => call.op === 'create');
  const data = (createCall?.args as Record<string, unknown>).data as Record<string, unknown>;
  assert.equal(data.issuerId, 'issuer-1');
  assert.equal(data.createdByUserId, 'issuer-user-1');
  assert.equal(data.status, CourseTemplateStatus.active);
  assert.equal(data.credentialType, CredentialType.course);
  assert.equal(data.title, 'Curso de Python');
});

test('create manual accepts credentialType=certification with certification-only fields', async () => {
  const { service, calls } = createService();

  await service.createTemplateForIssuer(
    'issuer-1',
    {
      credentialType: CredentialType.certification,
      title: 'Certificacion AWS Cloud Practitioner',
      certificationCode: 'AWS-CCP',
      providerName: 'Instituto Demo',
      level: 'Fundamentos',
      skills: ['Cloud']
    },
    currentUser
  );

  const createCall = calls.find((call) => call.op === 'create');
  const data = (createCall?.args as Record<string, unknown>).data as Record<string, unknown>;
  assert.equal(data.credentialType, CredentialType.certification);
  assert.equal(data.certificationCode, 'AWS-CCP');
  assert.equal(data.providerName, 'Instituto Demo');
  assert.equal(data.level, 'Fundamentos');
  assert.deepEqual(data.skills, ['Cloud']);
});

test('create manual rejects an empty title', async () => {
  const { service } = createService();

  await assert.rejects(
    service.createTemplateForIssuer('issuer-1', { title: '' }, currentUser),
    BadRequestException
  );
});

test('create manual rejects an invalid modality', async () => {
  const { service } = createService();

  await assert.rejects(
    service.createTemplateForIssuer(
      'issuer-1',
      { title: 'Curso', modality: 'Remoto' },
      currentUser
    ),
    BadRequestException
  );
});

test('create manual rejects an invalid externalUrl', async () => {
  const { service } = createService();

  await assert.rejects(
    service.createTemplateForIssuer(
      'issuer-1',
      { title: 'Curso', externalUrl: 'javascript:alert(1)' },
      currentUser
    ),
    BadRequestException
  );
});

test('create manual rejects skills, providerName and level on a course template', async () => {
  const { service } = createService();

  for (const field of ['skills', 'providerName', 'level']) {
    await assert.rejects(
      service.createTemplateForIssuer(
        'issuer-1',
        { title: 'Curso', [field]: field === 'skills' ? ['x'] : 'x' },
        currentUser
      ),
      BadRequestException
    );
  }
});

test('create manual rejects modality and platformName on a certification template', async () => {
  const { service } = createService();

  for (const field of ['modality', 'platformName']) {
    await assert.rejects(
      service.createTemplateForIssuer(
        'issuer-1',
        {
          credentialType: CredentialType.certification,
          title: 'Certificacion',
          [field]: field === 'modality' ? 'Online' : 'x'
        },
        currentUser
      ),
      BadRequestException
    );
  }
});

function courseCredentialFixture(overrides?: Record<string, unknown>) {
  return {
    id: 'credential-1',
    type: CredentialType.course,
    title: 'Curso de Python (legacy)',
    description: 'Introduccion a Python',
    hours: decimalLike('22'),
    credentialSubject: {
      achievement_name: 'Curso de Python',
      platform_name: 'Plataforma de Cursos Demo',
      modality: 'Online',
      external_url: 'https://plataforma-demo.example.com/curso/python',
      competencies: ['Programacion'],
      learning_outcomes: ['Escribir scripts basicos'],
      provider_name: 'must-not-copy',
      level: 'must-not-copy',
      skills: ['must-not-copy'],
      academic_period: 'must-not-copy',
      program_name: 'must-not-copy'
    },
    semanticAnalyses: [{ id: 'analysis-1' }],
    ...overrides
  };
}

function certificationCredentialFixture(overrides?: Record<string, unknown>) {
  return {
    id: 'credential-2',
    type: CredentialType.certification,
    title: 'Certificacion AWS (legacy)',
    description: 'Certificacion de fundamentos de cloud',
    hours: decimalLike('10'),
    credentialSubject: {
      achievement_name: 'Certificacion AWS Cloud Practitioner',
      certification_code: 'AWS-CCP',
      expiration_date: '2027-01-01',
      external_url: 'https://certificaciones-demo.example.com/aws-ccp',
      provider_name: 'Instituto Demo',
      level: 'Fundamentos',
      skills: ['Cloud'],
      competencies: ['Fundamentos de nube'],
      modality: 'must-not-copy',
      platform_name: 'must-not-copy',
      academic_period: 'must-not-copy',
      program_name: 'must-not-copy'
    },
    semanticAnalyses: [{ id: 'analysis-2' }],
    ...overrides
  };
}

test('create from credential copies title, description, hours, platform, modality, externalUrl, competencies and learningOutcomes for a course', async () => {
  const { service, calls } = createService({
    credential: courseCredentialFixture()
  });

  await service.createTemplateFromCredentialForIssuer(
    'issuer-1',
    'credential-1',
    currentUser
  );

  const createCall = calls.find((call) => call.op === 'create');
  const data = (createCall?.args as Record<string, unknown>).data as Record<string, unknown>;

  assert.equal(data.credentialType, CredentialType.course);
  assert.equal(data.title, 'Curso de Python');
  assert.equal(data.description, 'Introduccion a Python');
  assert.equal((data.hours as { toString: () => string }).toString(), '22');
  assert.equal(data.platformName, 'Plataforma de Cursos Demo');
  assert.equal(data.modality, 'Online');
  assert.equal(data.externalUrl, 'https://plataforma-demo.example.com/curso/python');
  assert.deepEqual(data.competencies, ['Programacion']);
  assert.deepEqual(data.learningOutcomes, ['Escribir scripts basicos']);
  assert.equal(data.createdFromCredentialId, 'credential-1');
  assert.equal(data.lastSemanticAnalysisId, 'analysis-1');
  assert.equal(data.createdByUserId, 'issuer-user-1');
});

test('create from credential never copies skills, providerName or level for a course', async () => {
  const { service, calls } = createService({
    credential: courseCredentialFixture()
  });

  await service.createTemplateFromCredentialForIssuer(
    'issuer-1',
    'credential-1',
    currentUser
  );

  const createCall = calls.find((call) => call.op === 'create');
  const data = (createCall?.args as Record<string, unknown>).data as Record<string, unknown>;

  assert.equal('skills' in data, false);
  assert.equal('providerName' in data, false);
  assert.equal('level' in data, false);
  assert.equal('certificationCode' in data, false);
  assert.equal('expirationDate' in data, false);
  assert.equal(JSON.stringify(data).includes('must-not-copy'), false);
});

test('create from credential accepts certification and copies its permitted fields', async () => {
  const { service, calls } = createService({
    credential: certificationCredentialFixture()
  });

  await service.createTemplateFromCredentialForIssuer(
    'issuer-1',
    'credential-2',
    currentUser
  );

  const createCall = calls.find((call) => call.op === 'create');
  const data = (createCall?.args as Record<string, unknown>).data as Record<string, unknown>;

  assert.equal(data.credentialType, CredentialType.certification);
  assert.equal(data.title, 'Certificacion AWS Cloud Practitioner');
  assert.equal(data.description, 'Certificacion de fundamentos de cloud');
  assert.equal((data.hours as { toString: () => string }).toString(), '10');
  assert.equal(data.certificationCode, 'AWS-CCP');
  assert.equal(data.expirationDate, '2027-01-01');
  assert.equal(data.externalUrl, 'https://certificaciones-demo.example.com/aws-ccp');
  assert.equal(data.providerName, 'Instituto Demo');
  assert.equal(data.level, 'Fundamentos');
  assert.deepEqual(data.skills, ['Cloud']);
  assert.deepEqual(data.competencies, ['Fundamentos de nube']);
});

test('create from credential never copies modality, platformName or academic fields for a certification', async () => {
  const { service, calls } = createService({
    credential: certificationCredentialFixture()
  });

  await service.createTemplateFromCredentialForIssuer(
    'issuer-1',
    'credential-2',
    currentUser
  );

  const createCall = calls.find((call) => call.op === 'create');
  const data = (createCall?.args as Record<string, unknown>).data as Record<string, unknown>;

  assert.equal('modality' in data, false);
  assert.equal('platformName' in data, false);
  assert.equal(JSON.stringify(data).includes('must-not-copy'), false);
  assert.equal(JSON.stringify(data).includes('rawData'), false);
  assert.equal(JSON.stringify(data).includes('academicCourseReference'), false);
});

test('create from credential prioritizes achievement_name over Credential.title', async () => {
  const { service, calls } = createService({
    credential: courseCredentialFixture({
      title: 'Titulo legacy que no deberia usarse',
      credentialSubject: {
        achievement_name: 'Python para Data Science',
        competencies: [],
        learning_outcomes: []
      }
    })
  });

  await service.createTemplateFromCredentialForIssuer(
    'issuer-1',
    'credential-1',
    currentUser
  );

  const createCall = calls.find((call) => call.op === 'create');
  const data = (createCall?.args as Record<string, unknown>).data as Record<string, unknown>;
  assert.equal(data.title, 'Python para Data Science');
});

test('create from credential falls back to lastSemanticAnalysisId null when no analysis exists', async () => {
  const { service, calls } = createService({
    credential: courseCredentialFixture({ semanticAnalyses: [] })
  });

  await service.createTemplateFromCredentialForIssuer(
    'issuer-1',
    'credential-1',
    currentUser
  );

  const createCall = calls.find((call) => call.op === 'create');
  const data = (createCall?.args as Record<string, unknown>).data as Record<string, unknown>;
  assert.equal(data.lastSemanticAnalysisId, null);
});

test('create from credential rejects an academic_subject credential', async () => {
  const { service } = createService({
    credential: courseCredentialFixture({ type: CredentialType.academic_subject })
  });

  await assert.rejects(
    service.createTemplateFromCredentialForIssuer('issuer-1', 'credential-1', currentUser),
    BadRequestException
  );
});

test('create from credential rejects a degree credential', async () => {
  const { service } = createService({
    credential: courseCredentialFixture({ type: CredentialType.degree })
  });

  await assert.rejects(
    service.createTemplateFromCredentialForIssuer('issuer-1', 'credential-1', currentUser),
    BadRequestException
  );
});

test('create from credential rejects a credential belonging to another issuer (not found within scope)', async () => {
  const { service } = createService({ credential: null });

  await assert.rejects(
    service.createTemplateFromCredentialForIssuer('issuer-1', 'credential-1', currentUser),
    NotFoundException
  );
});

test('create from credential allows draft and issued credentials (no status filter applied)', async () => {
  const { service, calls } = createService({
    credential: courseCredentialFixture()
  });

  await service.createTemplateFromCredentialForIssuer('issuer-1', 'credential-1', currentUser);

  const findCall = calls.find((call) => call.op === 'credential.findFirst');
  const where = (findCall?.args as Record<string, unknown>).where as Record<string, unknown>;
  assert.equal('status' in where, false);
});

test('create from credential rejects when neither achievement_name nor Credential.title is usable', async () => {
  const { service } = createService({
    credential: courseCredentialFixture({ title: '   ', credentialSubject: {} })
  });

  await assert.rejects(
    service.createTemplateFromCredentialForIssuer('issuer-1', 'credential-1', currentUser),
    BadRequestException
  );
});

test('create from credential deduplication returns 409 with a course-specific message', async () => {
  const { service } = createService({
    credential: courseCredentialFixture(),
    templates: [
      baseTemplateRow({
        title: '  curso   de   python ',
        createdFromCredentialId: 'credential-1',
        status: CourseTemplateStatus.active
      })
    ]
  });

  await assert.rejects(
    service.createTemplateFromCredentialForIssuer('issuer-1', 'credential-1', currentUser),
    (error: unknown) =>
      error instanceof ConflictException &&
      (error.getResponse() as { message: string }).message ===
        'Este curso ya fue guardado como reutilizable.'
  );
});

test('create from credential deduplication returns 409 with a certification-specific message', async () => {
  const { service } = createService({
    credential: certificationCredentialFixture(),
    templates: [
      baseTemplateRow({
        credentialType: CredentialType.certification,
        title: 'Certificacion AWS Cloud Practitioner',
        createdFromCredentialId: 'credential-2',
        status: CourseTemplateStatus.active
      })
    ]
  });

  await assert.rejects(
    service.createTemplateFromCredentialForIssuer('issuer-1', 'credential-2', currentUser),
    (error: unknown) =>
      error instanceof ConflictException &&
      (error.getResponse() as { message: string }).message ===
        'Esta certificacion ya fue guardada como reutilizable.'
  );
});

test('create from credential deduplication ignores archived templates', async () => {
  const { service, calls } = createService({
    credential: courseCredentialFixture(),
    templates: [
      baseTemplateRow({
        title: 'Curso de Python',
        createdFromCredentialId: 'credential-1',
        status: CourseTemplateStatus.archived
      })
    ]
  });

  await service.createTemplateFromCredentialForIssuer('issuer-1', 'credential-1', currentUser);

  assert.ok(calls.some((call) => call.op === 'create'));
});

test('create from credential deduplication is separated by credential/type: a course and a certification with the same title never collide', async () => {
  const { service, calls } = createService({
    credential: certificationCredentialFixture({
      credentialSubject: {
        achievement_name: 'Curso de Python',
        certification_code: 'X',
        skills: [],
        competencies: []
      }
    }),
    templates: [
      baseTemplateRow({
        credentialType: CredentialType.course,
        title: 'Curso de Python',
        createdFromCredentialId: 'credential-1',
        status: CourseTemplateStatus.active
      })
    ]
  });

  await service.createTemplateFromCredentialForIssuer('issuer-1', 'credential-2', currentUser);

  assert.ok(calls.some((call) => call.op === 'create'));
});

test('patch updates only the fields provided and preserves the rest', async () => {
  const { service, calls } = createService({
    templates: [baseTemplateRow()]
  });

  await service.patchTemplateForIssuer(
    'issuer-1',
    'template-1',
    { title: 'Nuevo titulo', hours: 30 },
    currentUser
  );

  const updateCall = calls.find((call) => call.op === 'update');
  const data = (updateCall?.args as Record<string, unknown>).data as Record<string, unknown>;
  assert.equal(data.title, 'Nuevo titulo');
  assert.ok('hours' in data);
  assert.equal('modality' in data, false);
  assert.equal('status' in data, false);
});

test('patch archive changes status to archived', async () => {
  const { service, calls } = createService({
    templates: [baseTemplateRow()]
  });

  await service.patchTemplateForIssuer(
    'issuer-1',
    'template-1',
    { status: CourseTemplateStatus.archived },
    currentUser
  );

  const updateCall = calls.find((call) => call.op === 'update');
  const data = (updateCall?.args as Record<string, unknown>).data as Record<string, unknown>;
  assert.equal(data.status, CourseTemplateStatus.archived);
});

test('patch does not allow changing issuerId, createdByUserId or credentialType', async () => {
  const { service } = createService({
    templates: [baseTemplateRow()]
  });

  await assert.rejects(
    service.patchTemplateForIssuer(
      'issuer-1',
      'template-1',
      { issuerId: 'issuer-2' },
      currentUser
    ),
    BadRequestException
  );
  await assert.rejects(
    service.patchTemplateForIssuer(
      'issuer-1',
      'template-1',
      { createdByUserId: 'someone-else' },
      currentUser
    ),
    BadRequestException
  );
  await assert.rejects(
    service.patchTemplateForIssuer(
      'issuer-1',
      'template-1',
      { credentialType: CredentialType.certification },
      currentUser
    ),
    BadRequestException
  );
});

test('patch rejects certification-only fields on a course template and vice versa', async () => {
  const { service } = createService({
    templates: [
      baseTemplateRow({ id: 'course-template', credentialType: CredentialType.course }),
      baseTemplateRow({ id: 'cert-template', credentialType: CredentialType.certification })
    ]
  });

  await assert.rejects(
    service.patchTemplateForIssuer(
      'issuer-1',
      'course-template',
      { certificationCode: 'X' },
      currentUser
    ),
    BadRequestException
  );
  await assert.rejects(
    service.patchTemplateForIssuer(
      'issuer-1',
      'cert-template',
      { modality: 'Online' },
      currentUser
    ),
    BadRequestException
  );
});

test('patch returns 404 for a template that does not belong to the issuer', async () => {
  const { service } = createService({ templates: [] });

  await assert.rejects(
    service.patchTemplateForIssuer('issuer-1', 'missing-template', { title: 'x' }, currentUser),
    NotFoundException
  );
});

test('auth is required for every operation before touching prisma', async () => {
  const { service, calls } = createService({
    authorizationError: new ForbiddenException('no autorizado')
  });

  await assert.rejects(
    service.createTemplateForIssuer('issuer-1', { title: 'Curso' }, currentUser),
    ForbiddenException
  );
  await assert.rejects(
    service.createTemplateFromCredentialForIssuer('issuer-1', 'credential-1', currentUser),
    ForbiddenException
  );
  await assert.rejects(
    service.patchTemplateForIssuer('issuer-1', 'template-1', { title: 'x' }, currentUser),
    ForbiddenException
  );

  assert.equal(calls.length, 0);
});

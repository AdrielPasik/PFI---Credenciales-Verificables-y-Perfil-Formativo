import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException
} from '@nestjs/common';
import {
  CourseTemplateStatus,
  CredentialType,
  SemanticAnalysisStatus,
  UserStatus
} from '@prisma/client';

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
    approvedSemanticAnalysisId: null,
    approvedSemanticSnapshot: null,
    approvedSemanticApprovedAt: null,
    approvedSemanticPipelineVersion: null,
    approvedSemanticTaxonomyVersion: null,
    approvedSemanticSourceCredentialId: null,
    createdAt: new Date('2026-08-11T10:00:00.000Z'),
    updatedAt: new Date('2026-08-11T10:00:00.000Z'),
    ...overrides
  };
}

function baseSemanticAnalysisRow(overrides?: Record<string, unknown>) {
  return {
    id: 'analysis-1',
    credentialId: 'credential-1',
    status: SemanticAnalysisStatus.completed,
    schemaVersion: 'semantic_analysis_v1',
    pipelineVersion: 'pipeline-v1',
    taxonomyVersion: 'taxonomy-v1',
    areas: [{ id: 'area-1', label: 'Programacion', confidence: 0.9 }],
    skills: [{ id: 'skill-1', label: 'Python', confidence: 0.8 }],
    concepts: [],
    qualityFlags: [],
    confidence: 0.85,
    analysisJson: {
      hoursDistribution: [{ areaId: 'area-1', hours: 12 }],
      warnings: []
    },
    credential: {
      id: 'credential-1',
      type: CredentialType.course,
      issuerId: 'issuer-1'
    },
    ...overrides
  };
}

function createService(options?: {
  authorizationError?: Error;
  templates?: Array<Record<string, unknown>>;
  credential?: Record<string, unknown> | null;
  createReturn?: Record<string, unknown>;
  updateReturn?: Record<string, unknown>;
  semanticAnalyses?: Array<Record<string, unknown>>;
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
            'credentialType' in where &&
            template.credentialType !== where.credentialType
          ) {
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
        return (
          options?.updateReturn ??
          baseTemplateRow(args.data as Record<string, unknown>)
        );
      }
    },
    credential: {
      async findFirst(args: Record<string, unknown>) {
        calls.push({ op: 'credential.findFirst', args });
        return options?.credential ?? null;
      }
    },
    semanticAnalysis: {
      async findFirst(args: Record<string, unknown>) {
        calls.push({ op: 'semanticAnalysis.findFirst', args });
        const where = (args.where ?? {}) as Record<string, unknown>;
        return (
          (options?.semanticAnalyses ?? []).find(
            (analysis) => analysis.id === where.id
          ) ?? null
        );
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

test('list without credentialType keeps the existing behavior (both types mixed)', async () => {
  const { service, calls } = createService({
    templates: [
      baseTemplateRow({ id: 't-course', credentialType: CredentialType.course }),
      baseTemplateRow({ id: 't-cert', credentialType: CredentialType.certification })
    ]
  });

  const result = await service.listTemplatesForIssuer('issuer-1', {}, currentUser);

  assert.deepEqual(result.map((item) => item.id).sort(), ['t-cert', 't-course']);
  const where = (calls.find((call) => call.op === 'findMany')?.args as Record<string, unknown>)
    .where as Record<string, unknown>;
  assert.equal('credentialType' in where, false);
});

test('list credentialType=course returns only course templates', async () => {
  const { service } = createService({
    templates: [
      baseTemplateRow({ id: 't-course', credentialType: CredentialType.course }),
      baseTemplateRow({ id: 't-cert', credentialType: CredentialType.certification })
    ]
  });

  const result = await service.listTemplatesForIssuer(
    'issuer-1',
    { credentialType: 'course' },
    currentUser
  );

  assert.deepEqual(result.map((item) => item.id), ['t-course']);
});

test('list credentialType=certification returns only certification templates', async () => {
  const { service } = createService({
    templates: [
      baseTemplateRow({ id: 't-course', credentialType: CredentialType.course }),
      baseTemplateRow({ id: 't-cert', credentialType: CredentialType.certification })
    ]
  });

  const result = await service.listTemplatesForIssuer(
    'issuer-1',
    { credentialType: 'certification' },
    currentUser
  );

  assert.deepEqual(result.map((item) => item.id), ['t-cert']);
});

test('list rejects an invalid credentialType filter', async () => {
  const { service } = createService({ templates: [] });

  await assert.rejects(
    service.listTemplatesForIssuer('issuer-1', { credentialType: 'academic_subject' }, currentUser),
    BadRequestException
  );
});

test('list combines search and credentialType correctly', async () => {
  const { service } = createService({
    templates: [
      baseTemplateRow({ id: 't-course-python', credentialType: CredentialType.course, title: 'Curso de Python' }),
      baseTemplateRow({ id: 't-cert-python', credentialType: CredentialType.certification, title: 'Certificacion Python' }),
      baseTemplateRow({ id: 't-course-excel', credentialType: CredentialType.course, title: 'Curso de Excel' })
    ]
  });

  const result = await service.listTemplatesForIssuer(
    'issuer-1',
    { search: 'python', credentialType: 'course' },
    currentUser
  );

  assert.deepEqual(result.map((item) => item.id), ['t-course-python']);
});

test('list credentialType filter stays scoped to the requested issuer', async () => {
  const { service, calls } = createService({
    templates: [baseTemplateRow({ id: 't-course', credentialType: CredentialType.course })]
  });

  await service.listTemplatesForIssuer('issuer-1', { credentialType: 'course' }, currentUser);

  const where = (calls.find((call) => call.op === 'findMany')?.args as Record<string, unknown>)
    .where as Record<string, unknown>;
  assert.equal(where.issuerId, 'issuer-1');
  assert.equal(where.credentialType, CredentialType.course);
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

test('create from credential copies title, description, hours, modality, externalUrl, competencies and learningOutcomes for a course', async () => {
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
  assert.equal(data.modality, 'Online');
  assert.equal(data.externalUrl, 'https://plataforma-demo.example.com/curso/python');
  assert.deepEqual(data.competencies, ['Programacion']);
  assert.deepEqual(data.learningOutcomes, ['Escribir scripts basicos']);
  assert.equal(data.createdFromCredentialId, 'credential-1');
  assert.equal(data.lastSemanticAnalysisId, 'analysis-1');
  assert.equal(data.createdByUserId, 'issuer-user-1');
});

// C4x fix: platformName ya no se copia a un template nuevo creado desde
// una credencial, aunque exista como dato legacy en credentialSubject --
// el emisor activo es la fuente institucional, no un texto libre heredado.
test('create from credential never copies platformName for a course, even when the source credential has legacy platform_name', async () => {
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

  assert.equal('platformName' in data, false);
  assert.equal(
    JSON.stringify(data).includes('Plataforma de Cursos Demo'),
    false
  );
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
  await assert.rejects(
    service.approveTemplateSemanticAnalysisForIssuer(
      'issuer-1',
      'template-1',
      'analysis-1',
      currentUser
    ),
    ForbiddenException
  );

  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// C4a.1: approveTemplateSemanticAnalysisForIssuer
// ---------------------------------------------------------------------------

test('approve returns 404 when the template does not belong to the issuer', async () => {
  const { service } = createService({
    templates: [],
    semanticAnalyses: [baseSemanticAnalysisRow()]
  });

  await assert.rejects(
    service.approveTemplateSemanticAnalysisForIssuer(
      'issuer-1',
      'missing-template',
      'analysis-1',
      currentUser
    ),
    NotFoundException
  );
});

test('approve returns 404 when the semantic analysis does not exist', async () => {
  const { service } = createService({
    templates: [baseTemplateRow()],
    semanticAnalyses: []
  });

  await assert.rejects(
    service.approveTemplateSemanticAnalysisForIssuer(
      'issuer-1',
      'template-1',
      'missing-analysis',
      currentUser
    ),
    NotFoundException
  );
});

test('approve returns 404 (not 403) when the semantic analysis belongs to a credential of another issuer', async () => {
  const { service } = createService({
    templates: [baseTemplateRow()],
    semanticAnalyses: [
      baseSemanticAnalysisRow({
        credential: { id: 'credential-1', type: CredentialType.course, issuerId: 'issuer-2' }
      })
    ]
  });

  await assert.rejects(
    service.approveTemplateSemanticAnalysisForIssuer(
      'issuer-1',
      'template-1',
      'analysis-1',
      currentUser
    ),
    NotFoundException
  );
});

test('approve rejects when the analyzed credential type does not match the template credentialType', async () => {
  const { service } = createService({
    templates: [baseTemplateRow({ credentialType: CredentialType.certification })],
    semanticAnalyses: [baseSemanticAnalysisRow()]
  });

  await assert.rejects(
    service.approveTemplateSemanticAnalysisForIssuer(
      'issuer-1',
      'template-1',
      'analysis-1',
      currentUser
    ),
    BadRequestException
  );
});

test('approve rejects an analysis whose credential is academic_subject (template can never be that type, so this is a structural 400)', async () => {
  const { service } = createService({
    templates: [baseTemplateRow({ credentialType: CredentialType.course })],
    semanticAnalyses: [
      baseSemanticAnalysisRow({
        credential: {
          id: 'credential-1',
          type: CredentialType.academic_subject,
          issuerId: 'issuer-1'
        }
      })
    ]
  });

  await assert.rejects(
    service.approveTemplateSemanticAnalysisForIssuer(
      'issuer-1',
      'template-1',
      'analysis-1',
      currentUser
    ),
    BadRequestException
  );
});

test('approve rejects an analysis whose credential is degree', async () => {
  const { service } = createService({
    templates: [baseTemplateRow({ credentialType: CredentialType.course })],
    semanticAnalyses: [
      baseSemanticAnalysisRow({
        credential: { id: 'credential-1', type: CredentialType.degree, issuerId: 'issuer-1' }
      })
    ]
  });

  await assert.rejects(
    service.approveTemplateSemanticAnalysisForIssuer(
      'issuer-1',
      'template-1',
      'analysis-1',
      currentUser
    ),
    BadRequestException
  );
});

test('approve rejects a semantic analysis with an unusable status', async () => {
  const { service } = createService({
    templates: [baseTemplateRow()],
    semanticAnalyses: [
      baseSemanticAnalysisRow({ status: 'failed' as unknown as SemanticAnalysisStatus })
    ]
  });

  await assert.rejects(
    service.approveTemplateSemanticAnalysisForIssuer(
      'issuer-1',
      'template-1',
      'analysis-1',
      currentUser
    ),
    BadRequestException
  );
});

test('approve accepts a completed semantic analysis and persists the 7 approval fields', async () => {
  const template = baseTemplateRow();
  const { service, calls } = createService({
    templates: [template],
    semanticAnalyses: [baseSemanticAnalysisRow()]
  });

  await service.approveTemplateSemanticAnalysisForIssuer(
    'issuer-1',
    'template-1',
    'analysis-1',
    currentUser
  );

  const updateCall = calls.find((call) => call.op === 'update');
  const data = (updateCall?.args as Record<string, unknown>).data as Record<string, unknown>;

  assert.equal(data.approvedSemanticAnalysisId, 'analysis-1');
  assert.equal(data.approvedSemanticApprovedByUserId, 'issuer-user-1');
  assert.ok(data.approvedSemanticApprovedAt instanceof Date);
  assert.equal(data.approvedSemanticPipelineVersion, 'pipeline-v1');
  assert.equal(data.approvedSemanticTaxonomyVersion, 'taxonomy-v1');
  assert.equal(data.approvedSemanticSourceCredentialId, 'credential-1');
  assert.equal(
    (data.approvedSemanticSnapshot as { schema: string }).schema,
    'approved_template_semantic_snapshot_v1'
  );
  assert.equal((data.approvedSemanticSnapshot as { status: string }).status, 'completed');
});

test('approve accepts a partial semantic analysis (issuer judgment call, no auto-completeness claim)', async () => {
  const { service, calls } = createService({
    templates: [baseTemplateRow()],
    semanticAnalyses: [
      baseSemanticAnalysisRow({ status: SemanticAnalysisStatus.partial })
    ]
  });

  await service.approveTemplateSemanticAnalysisForIssuer(
    'issuer-1',
    'template-1',
    'analysis-1',
    currentUser
  );

  const updateCall = calls.find((call) => call.op === 'update');
  const data = (updateCall?.args as Record<string, unknown>).data as Record<string, unknown>;
  assert.equal(
    (data.approvedSemanticSnapshot as { status: string }).status,
    'partial'
  );
});

test('approve enforces createdFromCredentialId when the template has one: rejects an analysis from a different credential', async () => {
  const { service } = createService({
    templates: [baseTemplateRow({ createdFromCredentialId: 'credential-other' })],
    semanticAnalyses: [baseSemanticAnalysisRow({ credentialId: 'credential-1' })]
  });

  await assert.rejects(
    service.approveTemplateSemanticAnalysisForIssuer(
      'issuer-1',
      'template-1',
      'analysis-1',
      currentUser
    ),
    BadRequestException
  );
});

test('approve allows the exact matching credential when createdFromCredentialId is set', async () => {
  const { service, calls } = createService({
    templates: [baseTemplateRow({ createdFromCredentialId: 'credential-1' })],
    semanticAnalyses: [baseSemanticAnalysisRow({ credentialId: 'credential-1' })]
  });

  await service.approveTemplateSemanticAnalysisForIssuer(
    'issuer-1',
    'template-1',
    'analysis-1',
    currentUser
  );

  assert.ok(calls.some((call) => call.op === 'update'));
});

test('approve allows an analysis from any same-issuer/same-type credential when the template has no createdFromCredentialId', async () => {
  const { service, calls } = createService({
    templates: [baseTemplateRow({ createdFromCredentialId: null })],
    semanticAnalyses: [
      baseSemanticAnalysisRow({
        credentialId: 'unrelated-credential',
        credential: { id: 'unrelated-credential', type: CredentialType.course, issuerId: 'issuer-1' }
      })
    ]
  });

  await service.approveTemplateSemanticAnalysisForIssuer(
    'issuer-1',
    'template-1',
    'analysis-1',
    currentUser
  );

  const updateCall = calls.find((call) => call.op === 'update');
  const data = (updateCall?.args as Record<string, unknown>).data as Record<string, unknown>;
  assert.equal(data.approvedSemanticSourceCredentialId, 'unrelated-credential');
});

test('approve never touches Credential and never creates a new SemanticAnalysis', async () => {
  const { service, calls } = createService({
    templates: [baseTemplateRow()],
    semanticAnalyses: [baseSemanticAnalysisRow()]
  });

  await service.approveTemplateSemanticAnalysisForIssuer(
    'issuer-1',
    'template-1',
    'analysis-1',
    currentUser
  );

  assert.equal(calls.some((call) => call.op === 'credential.findFirst'), false);
  assert.equal(
    calls.some((call) => String(call.op).startsWith('credential.update')),
    false
  );
  assert.equal(
    calls.some((call) => String(call.op).includes('semanticAnalysis.create')),
    false
  );
});

test('approve response never exposes the raw snapshot or any forbidden evidence keys', async () => {
  const { service } = createService({
    templates: [baseTemplateRow()],
    semanticAnalyses: [
      baseSemanticAnalysisRow({
        analysisJson: {
          hoursDistribution: [{ areaId: 'area-1', hours: 12 }],
          warnings: [],
          sourceRefs: { documentEvidenceId: 'doc-1' },
          evidenceMap: { 'area-1': ['doc-1'] },
          textForEmbedding: 'contenido crudo'
        }
      })
    ]
  });

  const response = await service.approveTemplateSemanticAnalysisForIssuer(
    'issuer-1',
    'template-1',
    'analysis-1',
    currentUser
  );

  const serialized = JSON.stringify(response);
  assert.equal(serialized.includes('sourceRefs'), false);
  assert.equal(serialized.includes('evidenceMap'), false);
  assert.equal(serialized.includes('textForEmbedding'), false);
  assert.equal(serialized.includes('documentEvidenceId'), false);
  assert.ok(response.approvedSemanticSnapshotSummary);
});

// ---------------------------------------------------------------------------
// C4a.2: getTemplateSemanticApprovalCandidateForIssuer (solo lectura)
// ---------------------------------------------------------------------------

test('candidate requires issuer authorization before touching prisma', async () => {
  const { service, authorizationCalls, calls } = createService({
    authorizationError: new ForbiddenException('no autorizado'),
    templates: [baseTemplateRow()],
    semanticAnalyses: [baseSemanticAnalysisRow()]
  });

  await assert.rejects(
    service.getTemplateSemanticApprovalCandidateForIssuer(
      'issuer-1',
      'template-1',
      'analysis-1',
      currentUser
    ),
    ForbiddenException
  );
  assert.deepEqual(authorizationCalls, [
    { userId: 'issuer-user-1', issuerId: 'issuer-1' }
  ]);
  assert.equal(calls.length, 0);
});

test('candidate rejects a template that does not belong to the issuer', async () => {
  const { service } = createService({
    templates: [],
    semanticAnalyses: [baseSemanticAnalysisRow()]
  });

  await assert.rejects(
    service.getTemplateSemanticApprovalCandidateForIssuer(
      'issuer-1',
      'missing-template',
      'analysis-1',
      currentUser
    ),
    NotFoundException
  );
});

test('candidate rejects a semantic analysis belonging to a credential of another issuer', async () => {
  const { service } = createService({
    templates: [baseTemplateRow()],
    semanticAnalyses: [
      baseSemanticAnalysisRow({
        credential: { id: 'credential-1', type: CredentialType.course, issuerId: 'issuer-2' }
      })
    ]
  });

  await assert.rejects(
    service.getTemplateSemanticApprovalCandidateForIssuer(
      'issuer-1',
      'template-1',
      'analysis-1',
      currentUser
    ),
    NotFoundException
  );
});

test('candidate rejects a mismatched credential type', async () => {
  const { service } = createService({
    templates: [baseTemplateRow({ credentialType: CredentialType.certification })],
    semanticAnalyses: [baseSemanticAnalysisRow()]
  });

  await assert.rejects(
    service.getTemplateSemanticApprovalCandidateForIssuer(
      'issuer-1',
      'template-1',
      'analysis-1',
      currentUser
    ),
    BadRequestException
  );
});

test('candidate rejects an unusable semantic analysis status', async () => {
  const { service } = createService({
    templates: [baseTemplateRow()],
    semanticAnalyses: [
      baseSemanticAnalysisRow({ status: 'failed' as unknown as SemanticAnalysisStatus })
    ]
  });

  await assert.rejects(
    service.getTemplateSemanticApprovalCandidateForIssuer(
      'issuer-1',
      'template-1',
      'analysis-1',
      currentUser
    ),
    BadRequestException
  );
});

test('candidate permits a completed semantic analysis and returns its safe summary', async () => {
  const { service } = createService({
    templates: [baseTemplateRow()],
    semanticAnalyses: [baseSemanticAnalysisRow()]
  });

  const candidate = await service.getTemplateSemanticApprovalCandidateForIssuer(
    'issuer-1',
    'template-1',
    'analysis-1',
    currentUser
  );

  assert.equal(candidate.semanticAnalysisId, 'analysis-1');
  assert.equal(candidate.status, 'completed');
  assert.equal(candidate.pipelineVersion, 'pipeline-v1');
  assert.equal(candidate.taxonomyVersion, 'taxonomy-v1');
  assert.equal(candidate.sourceCredentialId, 'credential-1');
  assert.deepEqual(candidate.summary, {
    schema: 'approved_template_semantic_snapshot_v1',
    status: 'completed',
    areaCount: 1,
    skillCount: 1,
    conceptCount: 0,
    hasHoursDistribution: true,
    warningCount: 0,
    qualityFlagCount: 0
  });
});

test('candidate permits a partial semantic analysis', async () => {
  const { service } = createService({
    templates: [baseTemplateRow()],
    semanticAnalyses: [
      baseSemanticAnalysisRow({ status: SemanticAnalysisStatus.partial })
    ]
  });

  const candidate = await service.getTemplateSemanticApprovalCandidateForIssuer(
    'issuer-1',
    'template-1',
    'analysis-1',
    currentUser
  );

  assert.equal(candidate.status, 'partial');
  assert.equal(candidate.summary.status, 'partial');
});

test('candidate never updates IssuerCourseTemplate', async () => {
  const { service, calls } = createService({
    templates: [baseTemplateRow()],
    semanticAnalyses: [baseSemanticAnalysisRow()]
  });

  await service.getTemplateSemanticApprovalCandidateForIssuer(
    'issuer-1',
    'template-1',
    'analysis-1',
    currentUser
  );

  assert.equal(calls.some((call) => call.op === 'update'), false);
  assert.equal(calls.some((call) => call.op === 'create'), false);
});

test('candidate never creates a SemanticAnalysis and never touches Credential', async () => {
  const { service, calls } = createService({
    templates: [baseTemplateRow()],
    semanticAnalyses: [baseSemanticAnalysisRow()]
  });

  await service.getTemplateSemanticApprovalCandidateForIssuer(
    'issuer-1',
    'template-1',
    'analysis-1',
    currentUser
  );

  assert.equal(calls.some((call) => call.op === 'credential.findFirst'), false);
  assert.equal(
    calls.some((call) => String(call.op).includes('semanticAnalysis.create')),
    false
  );
});

test('candidate response never exposes the full snapshot or any forbidden evidence keys', async () => {
  const { service } = createService({
    templates: [baseTemplateRow()],
    semanticAnalyses: [
      baseSemanticAnalysisRow({
        analysisJson: {
          hoursDistribution: [{ areaId: 'area-1', hours: 12 }],
          warnings: [],
          sourceRefs: { documentEvidenceId: 'doc-1' },
          evidenceMap: { 'area-1': ['doc-1'] },
          textForEmbedding: 'contenido crudo',
          storageKey: 's3://bucket/key'
        }
      })
    ]
  });

  const candidate = await service.getTemplateSemanticApprovalCandidateForIssuer(
    'issuer-1',
    'template-1',
    'analysis-1',
    currentUser
  );

  const serialized = JSON.stringify(candidate);
  for (const forbidden of [
    'sourceRefs',
    'evidenceMap',
    'textForEmbedding',
    'documentEvidenceId',
    'storageKey',
    'analysisJson'
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('candidate enforces createdFromCredentialId the same way as approve', async () => {
  const { service } = createService({
    templates: [baseTemplateRow({ createdFromCredentialId: 'credential-other' })],
    semanticAnalyses: [baseSemanticAnalysisRow({ credentialId: 'credential-1' })]
  });

  await assert.rejects(
    service.getTemplateSemanticApprovalCandidateForIssuer(
      'issuer-1',
      'template-1',
      'analysis-1',
      currentUser
    ),
    BadRequestException
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CredentialSourceType,
  CredentialStatus,
  CredentialType,
  Prisma,
  UserStatus
} from '@prisma/client';

import {
  type IssuerCredentialReadRecord,
  mapIssuerCredentialReadModel
} from './issuer-credential-read.mapper';

function createRecord(
  overrides?: Partial<IssuerCredentialReadRecord>
): IssuerCredentialReadRecord {
  return {
    id: 'credential-1',
    status: CredentialStatus.draft,
    type: CredentialType.course,
    title: 'Arquitectura de Software',
    description: ' Descripcion del curso ',
    hours: new Prisma.Decimal('24.50'),
    sourceType: CredentialSourceType.manual_issuer,
    credentialSubject: {
      achievement_name: 'Arquitectura de Software',
      institution_name: 'Nombre guardado en el draft',
      completion_date: '2026-07-30',
      academic_period: '2026-1',
      program_name: 'Ingenieria en Informatica',
      grade: '9',
      provider_name: 'Traza Academy',
      platform_name: 'Campus',
      modality: 'Hibrida',
      level: 'Avanzado',
      certification_code: 'CERT-001',
      expiration_date: '2028-07-30',
      external_url: 'https://example.com/certificate',
      skills: [' TypeScript ', 'typescript', 42],
      competencies: ['Diseno de sistemas'],
      learning_outcomes: ['Construir APIs'],
      private_note: 'no debe exponerse'
    },
    createdAt: new Date('2026-07-30T12:00:00.000Z'),
    updatedAt: new Date('2026-07-30T12:05:00.000Z'),
    issuer: {
      name: 'Demo University',
      did: 'did:example:issuer-demo'
    },
    subjectUser: {
      email: ' Holder.Demo@Example.com ',
      did: 'did:example:holder-demo',
      displayName: ' Demo   Holder ',
      firstName: 'Ignored',
      lastName: 'Name'
    },
    academicCourse: null,
    ...overrides
  };
}

test('mapper returns the explicit credential, issuer and holder allowlist', () => {
  const record = createRecord() as IssuerCredentialReadRecord & {
    issuerId?: string;
    subjectUserId?: string;
    rawData?: unknown;
    metadata?: unknown;
    canonicalHash?: string;
    blockchainRecords?: unknown[];
    semanticAnalyses?: unknown[];
    verificationEvents?: unknown[];
    sharingGrants?: unknown[];
    authCredential?: unknown;
    walletAddress?: string;
    privateKey?: string;
    statusFromUser?: UserStatus;
  };
  record.issuerId = 'issuer-1';
  record.subjectUserId = 'holder-1';
  record.rawData = { secret: true };
  record.metadata = { internal: true };
  record.canonicalHash = '0xsecret';
  record.blockchainRecords = [{ txHash: '0xsecret' }];
  record.semanticAnalyses = [{ analysisJson: 'secret' }];
  record.verificationEvents = [{ internal: true }];
  record.sharingGrants = [{ token: 'secret' }];
  record.authCredential = { passwordHash: 'secret' };
  record.walletAddress = '0xwallet';
  record.privateKey = 'secret';
  record.statusFromUser = UserStatus.suspended;

  const response = mapIssuerCredentialReadModel(record);

  assert.deepEqual(response, {
    id: 'credential-1',
    status: CredentialStatus.draft,
    type: CredentialType.course,
    title: 'Arquitectura de Software',
    description: 'Descripcion del curso',
    hours: '24.50',
    sourceType: CredentialSourceType.manual_issuer,
    credentialSubject: {
      achievement_name: 'Arquitectura de Software',
      institution_name: 'Nombre guardado en el draft',
      completion_date: '2026-07-30',
      academic_period: '2026-1',
      program_name: 'Ingenieria en Informatica',
      grade: '9',
      provider_name: 'Traza Academy',
      platform_name: 'Campus',
      modality: 'Hibrida',
      level: 'Avanzado',
      certification_code: 'CERT-001',
      expiration_date: '2028-07-30',
      external_url: 'https://example.com/certificate',
      skills: ['TypeScript'],
      competencies: ['Diseno de sistemas'],
      learning_outcomes: ['Construir APIs']
    },
    createdAt: '2026-07-30T12:00:00.000Z',
    updatedAt: '2026-07-30T12:05:00.000Z',
    issuer: {
      displayName: 'Demo University',
      did: 'did:example:issuer-demo'
    },
    holder: {
      displayLabel: 'Demo Holder',
      email: 'holder.demo@example.com',
      did: 'did:example:holder-demo'
    },
    academicCourse: null
  });

  for (const forbiddenField of [
    'issuerId',
    'subjectUserId',
    'passwordHash',
    'walletAddress',
    'privateKey',
    'memberships',
    'rawData',
    'metadata',
    'canonicalHash',
    'blockchainRecords',
    'semanticAnalyses',
    'verificationEvents',
    'sharingGrants',
    'authCredential'
  ]) {
    assert.equal(forbiddenField in response, false);
  }
});

test('mapper returns an allowlisted academic course summary', () => {
  const response = mapIssuerCredentialReadModel(
    createRecord({
      academicCourse: {
        id: 'academic-course-1',
        code: '3.4.213',
        name: 'Ingenieria de Datos II',
        description: ' Descripcion oficial ',
        hours: new Prisma.Decimal('64.00')
      }
    })
  );

  assert.deepEqual(response.academicCourse, {
    academicCourseReference: 'academic-course-1',
    code: '3.4.213',
    name: 'Ingenieria de Datos II',
    description: 'Descripcion oficial',
    hours: '64.00'
  });
  assert.equal('id' in response.academicCourse!, false);
  assert.equal('issuerId' in response.academicCourse!, false);
  assert.equal('metadata' in response.academicCourse!, false);
});

test('mapper keeps issuer identity separate from the institution name stored in the draft', () => {
  const response = mapIssuerCredentialReadModel(createRecord());

  assert.equal(response.issuer.displayName, 'Demo University');
  assert.equal(
    response.credentialSubject.institution_name,
    'Nombre guardado en el draft'
  );
});

test('mapper supports nullable holder DID and derives displayLabel from email', () => {
  const response = mapIssuerCredentialReadModel(
    createRecord({
      subjectUser: {
        email: 'holder@example.com',
        did: null,
        displayName: null,
        firstName: null,
        lastName: null
      }
    })
  );

  assert.deepEqual(response.holder, {
    displayLabel: 'holder@example.com',
    email: 'holder@example.com',
    did: null
  });
});

test('mapper uses names and then a generic label without exposing an internal user id', () => {
  const withNames = mapIssuerCredentialReadModel(
    createRecord({
      subjectUser: {
        email: null,
        did: null,
        displayName: null,
        firstName: ' Ada ',
        lastName: ' Lovelace '
      }
    })
  );
  const withoutPresentationData = mapIssuerCredentialReadModel(
    createRecord({
      subjectUser: {
        email: null,
        did: null,
        displayName: null,
        firstName: null,
        lastName: null
      }
    })
  );

  assert.equal(withNames.holder.displayLabel, 'Ada Lovelace');
  assert.deepEqual(withoutPresentationData.holder, {
    displayLabel: 'Titular sin datos de presentacion',
    email: null,
    did: null
  });
  assert.equal(JSON.stringify(withoutPresentationData).includes('holder-1'), false);
});

test('mapper returns null for missing or non-string allowlisted subject fields', () => {
  const response = mapIssuerCredentialReadModel(
    createRecord({
      credentialSubject: {
        achievement_name: 42,
        other: 'not allowed'
      }
    })
  );

  assert.deepEqual(response.credentialSubject, {
    achievement_name: null,
    institution_name: null,
    completion_date: null,
    academic_period: null,
    program_name: null,
    grade: null,
    provider_name: null,
    platform_name: null,
    modality: null,
    level: null,
    certification_code: null,
    expiration_date: null,
    external_url: null,
    skills: [],
    competencies: [],
    learning_outcomes: []
  });
});

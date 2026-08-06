import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BlockchainNetwork,
  BlockchainRecordStatus,
  CredentialSourceType,
  CredentialStatus,
  CredentialType,
  DocumentEvidenceKind,
  DocumentEvidenceStatus,
  Prisma,
  TextEvidenceStatus,
  UserStatus
} from '@prisma/client';

import {
  issuerCredentialReadSelect,
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
    issuedAt: null,
    canonicalHash: null,
    canonicalizationVersion: null,
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
    programCourse: null,
    documentEvidences: [],
    textEvidences: [],
    blockchainRecords: [],
    ...overrides
  };
}

test('mapper returns the explicit credential, issuer and holder allowlist', () => {
  const record = createRecord() as IssuerCredentialReadRecord & {
    issuerId?: string;
    subjectUserId?: string;
    rawData?: unknown;
    metadata?: unknown;
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
    issuedAt: null,
    canonicalHash: null,
    canonicalizationVersion: null,
    blockchainEvidence: null,
    issuer: {
      displayName: 'Demo University',
      did: 'did:example:issuer-demo'
    },
    holder: {
      displayLabel: 'Demo Holder',
      email: 'holder.demo@example.com',
      did: 'did:example:holder-demo'
    },
    academicCourse: null,
    documentEvidence: {
      currentDocument: null
    },
    textEvidence: {
      currentText: null
    }
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
    'semanticAnalyses',
    'verificationEvents',
    'sharingGrants',
    'authCredential'
  ]) {
    assert.equal(forbiddenField in response, false);
  }
});

test('mapper exposes only allowlisted issuance and latest blockchain evidence fields', () => {
  const response = mapIssuerCredentialReadModel(
    createRecord({
      status: CredentialStatus.issued,
      issuedAt: new Date('2026-08-06T12:00:00.000Z'),
      canonicalHash: `0x${'a'.repeat(64)}`,
      canonicalizationVersion: 'canon_v1',
      blockchainRecords: [
        {
          network: BlockchainNetwork.anvil,
          chainId: 31337,
          txHash: `0x${'b'.repeat(64)}`,
          status: BlockchainRecordStatus.registered,
          registeredAt: new Date('2026-08-06T12:00:01.000Z')
        }
      ]
    })
  );

  assert.deepEqual(response.blockchainEvidence, {
    network: BlockchainNetwork.anvil,
    chainId: 31337,
    txHash: `0x${'b'.repeat(64)}`,
    status: BlockchainRecordStatus.registered,
    registeredAt: '2026-08-06T12:00:01.000Z'
  });
  assert.equal(response.issuedAt, '2026-08-06T12:00:00.000Z');
  assert.equal(response.canonicalHash, `0x${'a'.repeat(64)}`);
  assert.equal(response.canonicalizationVersion, 'canon_v1');
  const serialized = JSON.stringify(response);
  for (const forbidden of [
    'contractAddress',
    'issuerAddress',
    'credentialHash',
    'hashAlgorithm',
    'privateKey',
    'rpcUrl',
    'rawData',
    'analysisJson',
    'textForEmbedding',
    'evidenceMap',
    'storageKey'
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('issuer credential select orders and allowlists the latest blockchain record', () => {
  assert.deepEqual(issuerCredentialReadSelect.blockchainRecords, {
    orderBy: [{ registeredAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: {
      network: true,
      chainId: true,
      txHash: true,
      status: true,
      registeredAt: true
    }
  });
});

test('mapper keeps historical evidence for revoked credentials and does not invent missing evidence', () => {
  const revoked = mapIssuerCredentialReadModel(
    createRecord({
      status: CredentialStatus.revoked,
      issuedAt: new Date('2026-08-06T12:00:00.000Z'),
      canonicalHash: `0x${'a'.repeat(64)}`,
      canonicalizationVersion: 'canon_v1',
      blockchainRecords: [
        {
          network: BlockchainNetwork.anvil,
          chainId: 31337,
          txHash: `0x${'b'.repeat(64)}`,
          status: BlockchainRecordStatus.revoked,
          registeredAt: new Date('2026-08-06T12:00:01.000Z')
        }
      ]
    })
  );
  const issuedWithoutRecord = mapIssuerCredentialReadModel(
    createRecord({
      status: CredentialStatus.issued,
      issuedAt: new Date('2026-08-06T12:00:00.000Z'),
      canonicalHash: `0x${'a'.repeat(64)}`,
      canonicalizationVersion: 'canon_v1'
    })
  );

  assert.equal(revoked.blockchainEvidence?.status, BlockchainRecordStatus.revoked);
  assert.equal(issuedWithoutRecord.blockchainEvidence, null);
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
    hours: '64.00',
    program: null
  });
  assert.equal('id' in response.academicCourse!, false);
  assert.equal('issuerId' in response.academicCourse!, false);
  assert.equal('metadata' in response.academicCourse!, false);
});

test('mapper nests an allowlisted curriculum summary for the selected course', () => {
  const response = mapIssuerCredentialReadModel(
    createRecord({
      academicCourse: {
        id: 'academic-course-1',
        code: '3.4.213',
        name: 'Ingenieria de Datos II',
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
    })
  );

  assert.deepEqual(response.academicCourse?.program, {
    programReference: 'program-1',
    programCode: '1621',
    programName: 'Ingenieria en Informatica',
    curriculumReference: 'curriculum-1',
    curriculumCode: '1621'
  });
  assert.equal(JSON.stringify(response).includes('programCourseId'), false);
  assert.equal(JSON.stringify(response).includes('academicCourseId'), false);
  assert.equal(JSON.stringify(response).includes('metadata'), false);
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

test('mapper exposes only the selected current document and never storage internals', () => {
  const response = mapIssuerCredentialReadModel(
    createRecord({
      documentEvidences: [
        {
          id: 'evidence-current',
          kind: DocumentEvidenceKind.image,
          status: DocumentEvidenceStatus.current,
          originalFileName: 'constancia.png',
          mimeType: 'image/png',
          sizeBytes: 123,
          sha256: 'a'.repeat(64),
          uploadedAt: new Date('2026-08-03T12:00:00.000Z')
        }
      ]
    })
  );

  assert.deepEqual(response.documentEvidence, {
    currentDocument: {
      evidenceReference: 'evidence-current',
      kind: DocumentEvidenceKind.image,
      status: DocumentEvidenceStatus.current,
      originalFileName: 'constancia.png',
      mimeType: 'image/png',
      sizeBytes: 123,
      sha256: 'a'.repeat(64),
      uploadedAt: '2026-08-03T12:00:00.000Z'
    }
  });
  const serialized = JSON.stringify(response.documentEvidence);
  assert.equal(serialized.includes('storageKey'), false);
  assert.equal(serialized.includes('storageProvider'), false);
  assert.equal(serialized.includes('uploadedByUserId'), false);
  assert.equal(serialized.includes('replacedAt'), false);
});

test('issuer credential select requests only current document evidence with an allowlist', () => {
  assert.deepEqual(issuerCredentialReadSelect.documentEvidences, {
    where: { status: 'current' },
    orderBy: { uploadedAt: 'desc' },
    take: 1,
    select: {
      id: true,
      kind: true,
      status: true,
      originalFileName: true,
      mimeType: true,
      sizeBytes: true,
      sha256: true,
      uploadedAt: true
    }
  });
});

test('mapper exposes only current text evidence and keeps document evidence separate', () => {
  const response = mapIssuerCredentialReadModel(
    createRecord({
      textEvidences: [
        {
          id: 'text-evidence-current',
          status: TextEvidenceStatus.current,
          label: 'Temario institucional',
          content: 'Contenido\nformativo',
          sha256: 'b'.repeat(64),
          submittedAt: new Date('2026-08-03T13:00:00.000Z')
        }
      ]
    })
  );

  assert.deepEqual(response.textEvidence, {
    currentText: {
      textEvidenceReference: 'text-evidence-current',
      status: TextEvidenceStatus.current,
      label: 'Temario institucional',
      content: 'Contenido\nformativo',
      characterCount: 19,
      sha256: 'b'.repeat(64),
      submittedAt: '2026-08-03T13:00:00.000Z'
    }
  });
  assert.deepEqual(response.documentEvidence, { currentDocument: null });
  const serialized = JSON.stringify(response.textEvidence);
  assert.equal(serialized.includes('submittedByUserId'), false);
  assert.equal(serialized.includes('credentialId'), false);
  assert.equal(serialized.includes('replacedAt'), false);
});

test('issuer credential select requests only current text evidence with an allowlist', () => {
  assert.deepEqual(issuerCredentialReadSelect.textEvidences, {
    where: { status: 'current' },
    orderBy: { submittedAt: 'desc' },
    take: 1,
    select: {
      id: true,
      status: true,
      label: true,
      content: true,
      sha256: true,
      submittedAt: true
    }
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

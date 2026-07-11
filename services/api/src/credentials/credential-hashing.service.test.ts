import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import { CredentialHashingService } from './credential-hashing.service';

const service = new CredentialHashingService();

function createBaseInput() {
  return {
    schemaVersion: 'credential_v1',
    type: 'academic_subject',
    issuerDid: 'did:example:issuer-demo',
    subjectDid: 'did:example:holder-demo',
    title: 'Algoritmos y Estructuras de Datos',
    description: 'Asignatura aprobada del plan de estudios.',
    issuedAt: new Date('2026-07-10T16:45:59.987Z'),
    hours: Number('96'),
    credentialSubject: {
      institution_name: 'Demo University',
      achievement_name: 'Algoritmos y Estructuras de Datos',
      grade: '8',
      completion_date: '2025-07-10',
      academic_period: '2025-1',
      competencies: ['estructuras de datos', 'analisis de complejidad'],
      skills: ['programacion', 'algoritmos']
    }
  };
}

test('golden test canon_v1: canonicalJson and canonicalHash stay stable', () => {
  const result = service.createCanonicalHash(createBaseInput());

  assert.equal(
    result.canonicalJson,
    '{"credential_subject":{"academic_period":"2025-1","achievement_name":"Algoritmos y Estructuras de Datos","competencies":["analisis de complejidad","estructuras de datos"],"completion_date":"2025-07-10","grade":"8","institution_name":"Demo University","skills":["algoritmos","programacion"]},"description":"Asignatura aprobada del plan de estudios.","hours":"96.00","issued_at":"2026-07-10T16:45:59Z","issuer_did":"did:example:issuer-demo","schema_version":"credential_v1","subject_did":"did:example:holder-demo","title":"Algoritmos y Estructuras de Datos","type":"academic_subject"}'
  );
  assert.equal(
    result.canonicalHash,
    '0x4dd075cf6624f94c019fb9eb54a0d0877e5686b49f9e91132e05a9024da0b2f0'
  );
});

test('same input produces same hash', () => {
  const input = createBaseInput();

  const first = service.createCanonicalHash(input);
  const second = service.createCanonicalHash(createBaseInput());

  assert.equal(first.canonicalHash, second.canonicalHash);
  assert.equal(first.canonicalJson, second.canonicalJson);
});

test('changing title changes hash', () => {
  const first = service.createCanonicalHash(createBaseInput());
  const second = service.createCanonicalHash({
    ...createBaseInput(),
    title: 'Bases de Datos I'
  });

  assert.notEqual(first.canonicalHash, second.canonicalHash);
});

test('changing issuerDid changes hash', () => {
  const first = service.createCanonicalHash(createBaseInput());
  const second = service.createCanonicalHash({
    ...createBaseInput(),
    issuerDid: 'did:example:issuer-other'
  });

  assert.notEqual(first.canonicalHash, second.canonicalHash);
});

test('changing subjectDid changes hash', () => {
  const first = service.createCanonicalHash(createBaseInput());
  const second = service.createCanonicalHash({
    ...createBaseInput(),
    subjectDid: 'did:example:holder-other'
  });

  assert.notEqual(first.canonicalHash, second.canonicalHash);
});

test('different credentialSubject property order produces same hash', () => {
  const first = service.createCanonicalHash(createBaseInput());
  const second = service.createCanonicalHash({
    ...createBaseInput(),
    credentialSubject: {
      skills: ['programacion', 'algoritmos'],
      institution_name: 'Demo University',
      completion_date: '2025-07-10',
      competencies: ['estructuras de datos', 'analisis de complejidad'],
      achievement_name: 'Algoritmos y Estructuras de Datos',
      academic_period: '2025-1',
      grade: '8'
    }
  });

  assert.equal(first.canonicalHash, second.canonicalHash);
  assert.equal(first.canonicalJson, second.canonicalJson);
});

test('different skills order produces same hash', () => {
  const first = service.createCanonicalHash(createBaseInput());
  const second = service.createCanonicalHash({
    ...createBaseInput(),
    credentialSubject: {
      ...createBaseInput().credentialSubject,
      skills: ['algoritmos', 'programacion']
    }
  });

  assert.equal(first.canonicalHash, second.canonicalHash);
});

test('different competencies order produces same hash', () => {
  const first = service.createCanonicalHash(createBaseInput());
  const second = service.createCanonicalHash({
    ...createBaseInput(),
    credentialSubject: {
      ...createBaseInput().credentialSubject,
      competencies: ['analisis de complejidad', 'estructuras de datos']
    }
  });

  assert.equal(first.canonicalHash, second.canonicalHash);
});

test('strings with extra spaces normalize to same hash', () => {
  const first = service.createCanonicalHash(createBaseInput());
  const second = service.createCanonicalHash({
    ...createBaseInput(),
    title: '  Algoritmos   y   Estructuras de Datos  ',
    description: '  Asignatura   aprobada  del plan de estudios. ',
    credentialSubject: {
      ...createBaseInput().credentialSubject,
      institution_name: '  Demo   University  ',
      achievement_name: '  Algoritmos   y   Estructuras de Datos ',
      skills: [' programacion ', 'algoritmos  '],
      competencies: [' estructuras de datos', 'analisis de complejidad  ']
    }
  });

  assert.equal(first.canonicalHash, second.canonicalHash);
});

test('issuedAt with milliseconds canonicalizes to seconds', () => {
  const result = service.createCanonicalHash({
    ...createBaseInput(),
    issuedAt: new Date('2026-07-10T16:45:59.987Z')
  });

  assert.equal(
    result.canonicalProjection.issued_at,
    '2026-07-10T16:45:59Z'
  );
});

test('equivalent hours produce same canonical representation', () => {
  const first = service.createCanonicalHash({
    ...createBaseInput(),
    hours: Number('96')
  });
  const second = service.createCanonicalHash({
    ...createBaseInput(),
    hours: {
      toFixed: () => '96.00',
      toString: () => '96.00'
    }
  });

  assert.equal(first.canonicalProjection.hours, '96.00');
  assert.equal(second.canonicalProjection.hours, '96.00');
  assert.equal(first.canonicalHash, second.canonicalHash);
});

test('extra non-canonical fields on input object do not affect hash', () => {
  const first = service.createCanonicalHash(createBaseInput());
  const second = service.createCanonicalHash({
    ...createBaseInput(),
    metadata: { cohort: '2026' },
    rawData: { source: 'manual-demo' },
    status: 'draft',
    sourceType: 'manual_issuer'
  } as never);

  assert.equal(first.canonicalHash, second.canonicalHash);
});

test('missing issuerDid throws BadRequestException', () => {
  assert.throws(
    () =>
      service.createCanonicalHash({
        ...createBaseInput(),
        issuerDid: ''
      }),
    BadRequestException
  );
});

test('missing subjectDid throws BadRequestException', () => {
  assert.throws(
    () =>
      service.createCanonicalHash({
        ...createBaseInput(),
        subjectDid: ''
      }),
    BadRequestException
  );
});

test('missing title throws BadRequestException', () => {
  assert.throws(
    () =>
      service.createCanonicalHash({
        ...createBaseInput(),
        title: ''
      }),
    BadRequestException
  );
});

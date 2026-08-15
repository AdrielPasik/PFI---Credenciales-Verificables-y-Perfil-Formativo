import assert from 'node:assert/strict';
import test from 'node:test';

import { NotFoundException } from '@nestjs/common';

import { MeService } from './me.service';

function decimalLike(value: string) {
  return { toString: () => value };
}

test('MeService lists only holder issued/revoked credentials through a minimized select', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const service = new MeService({
    credential: {
      async findMany(args: Record<string, unknown>) {
        calls.push(args);
        return [{
          id: 'cred-issued', title: 'Credencial emitida', type: 'course', status: 'issued',
          issuedAt: new Date('2026-08-01T10:00:00Z'),
          issuer: { name: 'Institución demo' },
          blockchainRecords: [{ id: 'record-1' }],
          semanticAnalyses: [{ id: 'analysis-1' }]
        }];
      }
    }
  } as never);

  const response = await service.listCredentialsForUser('holder-1');
  const query = calls[0];
  assert.deepEqual(query.where, { subjectUserId: 'holder-1', status: { in: ['issued', 'revoked'] } });
  assert.equal('select' in query, true);
  assert.equal(JSON.stringify(query).includes('rawData'), false);
  assert.equal(JSON.stringify(query).includes('canonicalHash'), false);
  assert.equal(JSON.stringify(query).includes('txHash'), false);
  assert.equal(JSON.stringify(query).includes('issuer":{"select":{"id"'), false);
  assert.deepEqual(response, [{
    id: 'cred-issued', title: 'Credencial emitida', type: 'course', status: 'issued',
    issuerName: 'Institución demo', issuedAt: '2026-08-01T10:00:00Z',
    hasIntegrityEvidence: true, hasAnalysis: true
  }]);
});

// A1: un holder recien registrado (sin ninguna Credential emitida todavia)
// nunca debe recibir un error -- la wallet vacia es el contrato real, no
// un caso especial. findMany sin filas coincidentes ya devuelve [] por
// diseno de Prisma; este test lo deja explicito para el flujo de A1.
test('A1: MeService returns an empty list (never an error) for a freshly registered holder with no credentials', async () => {
  const service = new MeService({
    credential: {
      async findMany() {
        return [];
      }
    }
  } as never);

  const response = await service.listCredentialsForUser('holder-registered-1');

  assert.deepEqual(response, []);
});

test('MeService returns a holder-safe detail without raw data, storage keys, metadata or blockchain addresses', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const service = new MeService({
    credential: {
      async findFirst(args: Record<string, unknown>) {
        calls.push(args);
        return {
          id: 'cred-1', type: 'academic_subject', title: 'Arquitectura de software', description: 'Descripción emitida', hours: decimalLike('64'), status: 'issued',
          issuedAt: new Date('2026-08-01T10:00:00Z'), revokedAt: null, revocationReason: null,
          canonicalHash: '0x' + '3'.repeat(64), canonicalizationVersion: 'canon_v1', rawData: { hidden: true }, metadata: { hidden: true },
          credentialSubject: { achievement_name: 'Arquitectura de software', institution_name: 'Institución demo', academic_period: '2026', skills: ['Diseño'], competencies: ['Análisis'], learning_outcomes: ['Modelar'] },
          issuer: { id: 'issuer-1', name: 'Institución demo', did: 'did:example:issuer' },
          subjectUser: { did: 'did:example:holder', email: 'holder@example.com', displayName: 'Titular demo' },
          blockchainRecords: [{ network: 'anvil', chainId: 31337, txHash: '0x' + '4'.repeat(64), status: 'registered', registeredAt: new Date('2026-08-01T10:10:00Z'), revokedAt: null, contractAddress: 'hidden', issuerAddress: 'hidden' }],
          semanticAnalyses: [{ status: 'completed', confidence: decimalLike('0.9'), areas: [{ id: 'software', label: 'Software' }], skills: [{ id: 'design', skill: 'Diseño' }], concepts: ['arquitectura'], qualityFlags: ['partial_source'], analyzedAt: new Date('2026-08-01T10:20:00Z'), analysisJson: { hidden: true }, textForEmbedding: 'hidden' }],
          documentEvidences: [{ originalFileName: 'respaldo.pdf', mimeType: 'application/pdf', sizeBytes: 200, sha256: 'a'.repeat(64), uploadedAt: new Date('2026-08-01T10:30:00Z'), storageKey: 'hidden' }],
          textEvidences: [{ label: 'Programa', content: 'Texto institucional de respaldo con contenido visible solo como anticipo.', sha256: 'b'.repeat(64), submittedAt: new Date('2026-08-01T10:35:00Z') }]
        };
      }
    }
  } as never);

  const response = await service.getCredentialForUser('holder-1', 'cred-1');
  assert.deepEqual(calls[0].where, { id: 'cred-1', subjectUserId: 'holder-1', status: { in: ['issued', 'revoked'] } });
  assert.equal(JSON.stringify(calls[0]).includes('storageKey'), false);
  assert.equal(JSON.stringify(response).includes('rawData'), false);
  assert.equal(JSON.stringify(response).includes('metadata'), false);
  assert.equal(JSON.stringify(response).includes('contractAddress'), false);
  assert.equal(JSON.stringify(response).includes('issuerAddress'), false);
  assert.equal(JSON.stringify(response).includes('analysisJson'), false);
  assert.equal(JSON.stringify(response).includes('textForEmbedding'), false);
  assert.equal(JSON.stringify(response).includes('"id":"software"'), false);
  assert.equal(JSON.stringify(response).includes('"id":"design"'), false);
  assert.deepEqual(response.credentialSubject, {
    achievementName: 'Arquitectura de software', institutionName: 'Institución demo', completionDate: null, academicPeriod: '2026', programName: null, grade: null,
    providerName: null, platformName: null, modality: null, level: null, externalUrl: null,
    skills: ['Diseño'], competencies: ['Análisis'], learningOutcomes: ['Modelar']
  });
  assert.equal(response.documentEvidence?.originalFileName, 'respaldo.pdf');
  assert.equal(response.textEvidence?.preview.startsWith('Texto institucional'), true);
  assert.deepEqual(response.latestSemanticAnalysis?.areas, ['Software']);
});

test('MeService returns 404 when a credential is not owned by the holder', async () => {
  const service = new MeService({ credential: { async findFirst() { return null; } } } as never);
  await assert.rejects(() => service.getCredentialForUser('holder-1', 'other'), NotFoundException);
});

test('MeService exposes declared course fields (providerName/platformName/modality/level/externalUrl) without leaking internals', async () => {
  const service = new MeService({
    credential: {
      async findFirst() {
        return {
          id: 'cred-course', type: 'course', title: 'Curso de Cloud', description: null, hours: decimalLike('12'), status: 'issued',
          issuedAt: new Date('2026-08-01T10:00:00Z'), revokedAt: null, revocationReason: null,
          canonicalHash: null, canonicalizationVersion: null, rawData: { hidden: true },
          credentialSubject: {
            achievement_name: 'Curso de Cloud', institution_name: 'Plataforma de Cursos Online Demo',
            provider_name: 'Instituto Demo', platform_name: 'Campus Virtual Demo', modality: 'Online asincrónica',
            level: 'Intermedio', external_url: 'https://plataforma-demo.example.com/curso/123',
            skills: ['Cloud'], competencies: [], learning_outcomes: []
          },
          issuer: { id: 'issuer-2', name: 'Plataforma de Cursos Online Demo', did: null },
          subjectUser: { did: null, email: 'holder@example.com', displayName: 'Titular demo' },
          blockchainRecords: [],
          semanticAnalyses: [],
          documentEvidences: [],
          textEvidences: []
        };
      }
    }
  } as never);

  const response = await service.getCredentialForUser('holder-1', 'cred-course');
  assert.deepEqual(response.credentialSubject, {
    achievementName: 'Curso de Cloud', institutionName: 'Plataforma de Cursos Online Demo',
    completionDate: null, academicPeriod: null, programName: null, grade: null,
    providerName: 'Instituto Demo', platformName: 'Campus Virtual Demo', modality: 'Online asincrónica',
    level: 'Intermedio', externalUrl: 'https://plataforma-demo.example.com/curso/123',
    skills: ['Cloud'], competencies: [], learningOutcomes: []
  });
  assert.equal(JSON.stringify(response).includes('rawData'), false);
  assert.equal(JSON.stringify(response).includes('hidden'), false);
});

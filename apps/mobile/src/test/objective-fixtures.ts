/**
 * Fixtures de Objetivos y Análisis de trayectoria.
 *
 * Reproducen la forma REAL de los DTO del backend, incluidos los campos
 * internos que el contrato NO debe transportar: varias fixtures los incluyen a
 * propósito para verificar que el adapter no los lea ni los deje pasar.
 */

export interface JsonObject {
  [key: string]: unknown;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const OBJECTIVE_SOURCE_TEXT =
  'Requisitos del puesto:\n- Python avanzado\n- SQL intermedio\n- Tres años de experiencia profesional\n';

/** Texto con un carácter astral al principio, para probar los offsets. */
export const ASTRAL_SOURCE_TEXT = '\u{1F680} Python avanzado y algo más';

export function proposalPayload(overrides: JsonObject = {}): JsonObject {
  return clone({
    schemaVersion: 'objective_requirement_proposal_v1',
    authority: 'PROPOSAL_ONLY',
    humanConfirmationRequired: true,
    candidates: [
      {
        candidateId: 'cand_01',
        order: 1,
        proposedRequirementText: 'Python avanzado',
        primarySourceReference: {
          exactExcerpt: 'Python avanzado',
          charStart: 24,
          charEnd: 39,
          offsetUnit: 'UNICODE_CODE_POINT'
        },
        primarySourceGrounding: 'UNIQUE',
        auxiliarySourceReferences: [],
        ambiguousReferences: [],
        unmatchedReferences: [],
        sourceSectionLabel: '## Requisitos',
        exactDuplicateOfEarlier: false,
        confirmableAsSourceDerived: true
      },
      {
        candidateId: 'cand_02',
        order: 2,
        proposedRequirementText: 'Tres años de experiencia profesional',
        primarySourceReference: null,
        primarySourceGrounding: 'NOT_FOUND',
        auxiliarySourceReferences: [],
        ambiguousReferences: [],
        unmatchedReferences: [],
        sourceSectionLabel: '## Requisitos',
        exactDuplicateOfEarlier: false,
        confirmableAsSourceDerived: false
      }
    ],
    unresolvedPassages: [
      {
        exactExcerpt: 'Disponibilidad inmediata',
        reason: 'NO_EVALUABLE',
        grounding: 'UNIQUE',
        charStart: 80,
        charEnd: 104
      }
    ],
    ...overrides
  });
}

export function objectiveDetailPayload(
  overrides: JsonObject = {}
): JsonObject {
  return clone({
    objectiveReference: 'obj_01',
    objectiveType: 'EMPLOYMENT',
    title: 'Analista de datos',
    status: 'FINALIZED',
    supersedesObjectiveReference: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    definition: {
      schemaVersion: 'objective_definition_v1',
      objectiveType: 'EMPLOYMENT',
      objectiveContext: '',
      sourceInputType: 'PASTED_TEXT',
      sourceOriginalText: OBJECTIVE_SOURCE_TEXT,
      requirements: [
        {
          requirementId: 'req_01',
          order: 1,
          requirementText: 'Python avanzado',
          provenanceKind: 'DERIVED_FROM_SOURCE_TEXT',
          sourceQuote: 'Python avanzado',
          qualifiers: []
        },
        {
          requirementId: 'req_02',
          order: 2,
          requirementText: 'Tres años de experiencia profesional',
          provenanceKind: 'DIRECT_STRUCTURED_INPUT',
          sourceQuote: null,
          qualifiers: []
        }
      ]
    },
    ...overrides
  });
}

export function objectiveSummariesPayload(): JsonObject[] {
  return clone([
    {
      objectiveReference: 'obj_01',
      objectiveType: 'EMPLOYMENT',
      title: 'Analista de datos',
      status: 'FINALIZED',
      supersedesObjectiveReference: null,
      createdAt: '2026-09-20T10:00:00.000Z'
    },
    {
      objectiveReference: 'obj_02',
      objectiveType: 'SCHOLARSHIP',
      title: 'Beca de posgrado',
      status: 'FINALIZED',
      supersedesObjectiveReference: null,
      createdAt: '2026-08-02T10:00:00.000Z'
    }
  ]);
}

export function evidencePayload(overrides: JsonObject = {}): JsonObject {
  return {
    excerpt: 'Programación en Python aplicada a análisis de datos.',
    contextBefore: 'Contenidos de la asignatura: ',
    contextAfter: ' Se evaluó con un trabajo final.',
    sectionLabel: 'Contenidos',
    pageNumber: 3,
    coverage: 'FULL',
    sourceKind: 'DOCUMENT',
    credential: {
      credentialReference: 'cred-001',
      title: 'Análisis de Datos',
      credentialType: 'academic_subject',
      issuerName: 'Universidad Nacional Ejemplo',
      currentStatus: 'issued'
    },
    ...overrides
  };
}

export function reasoningRunDetailPayload(
  overrides: JsonObject = {}
): JsonObject {
  return clone({
    reasoningRunReference: 'run_01',
    status: 'completed',
    objective: {
      objectiveReference: 'obj_01',
      title: 'Analista de datos',
      objectiveType: 'EMPLOYMENT',
      objectiveContext: '',
      requirements: [
        { requirementId: 'req_01', order: 1, requirementText: 'Python avanzado' },
        {
          requirementId: 'req_02',
          order: 2,
          requirementText: 'Tres años de experiencia profesional'
        }
      ]
    },
    failureCategory: null,
    createdAt: '2026-09-21T10:00:00.000Z',
    startedAt: '2026-09-21T10:00:05.000Z',
    completedAt: '2026-09-21T10:02:00.000Z',
    failedAt: null,
    result: {
      requirementResults: [
        {
          requirementId: 'req_01',
          requirementText: 'Python avanzado',
          finalState: 'SUPPORTED',
          supportedWeakerClaim: null,
          evidence: [evidencePayload()]
        },
        {
          requirementId: 'req_02',
          requirementText: 'Tres años de experiencia profesional',
          finalState: 'NOT_ASSESSABLE',
          supportedWeakerClaim: null,
          evidence: []
        }
      ]
    },
    synthesis: {
      schemaVersion: 'objective_synthesis_v1',
      reasoningRunReference: 'run_01',
      objectiveReference: 'obj_01',
      stateSummary: {
        supportedCount: 1,
        partiallySupportedCount: 0,
        insufficientEvidenceCount: 0,
        abstainCount: 0,
        notAssessableCount: 1
      },
      requirements: [
        {
          requirementId: 'req_01',
          order: 1,
          requirementText: 'Python avanzado',
          finalState: 'SUPPORTED'
        },
        {
          requirementId: 'req_02',
          order: 2,
          requirementText: 'Tres años de experiencia profesional',
          finalState: 'NOT_ASSESSABLE'
        }
      ],
      positiveConclusions: [
        {
          requirementId: 'req_01',
          requirementText: 'Python avanzado',
          finalState: 'SUPPORTED',
          supportedWeakerClaim: null,
          supportingCredentialReferences: ['cred-001']
        }
      ],
      credentialsSupportingPositiveConclusions: [
        {
          credentialReference: 'cred-001',
          credentialDisplay: {
            title: 'Análisis de Datos',
            credentialType: 'academic_subject',
            issuerName: 'Universidad Nacional Ejemplo',
            currentStatus: 'issued'
          },
          supportedRequirementIds: ['req_01'],
          partiallySupportedRequirementIds: []
        }
      ]
    },
    ...overrides
  });
}

export function reasoningRunSummariesPayload(): JsonObject[] {
  return clone([
    {
      reasoningRunReference: 'run_02',
      objectiveReference: 'obj_01',
      objectiveTitle: 'Analista de datos',
      objectiveType: 'EMPLOYMENT',
      status: 'pending',
      requirementCount: 2,
      failureCategory: null,
      createdAt: '2026-09-22T10:00:00.000Z',
      startedAt: null,
      completedAt: null,
      failedAt: null
    },
    {
      reasoningRunReference: 'run_01',
      objectiveReference: 'obj_01',
      objectiveTitle: 'Analista de datos',
      objectiveType: 'EMPLOYMENT',
      status: 'completed',
      requirementCount: 2,
      failureCategory: null,
      createdAt: '2026-09-21T10:00:00.000Z',
      startedAt: '2026-09-21T10:00:05.000Z',
      completedAt: '2026-09-21T10:02:00.000Z',
      failedAt: null
    }
  ]);
}

/**
 * Tokens que NUNCA pueden aparecer en un modelo ni en la UI.
 *
 * Se usa como guard: un adapter que copiara el payload crudo, o un componente
 * que renderizara un objeto entero, fallaría acá.
 */
export const FORBIDDEN_INTERNAL_TOKENS = [
  'src_',
  'eu_',
  'sourceId',
  'evidenceUnitId',
  'charStart',
  'charEnd',
  'sourceSha256',
  'segmentId',
  'artifactBlobSha256',
  'storageKey',
  'selectedAnalysisRunSourceId',
  'policyTrace',
  'executionMetadata',
  'reasoningEffort',
  'FORMATIVE_EVIDENCE',
  'explanation',
  'failureCode',
  'epistemicTarget',
  'schemaVersion',
  'offsetUnit'
] as const;

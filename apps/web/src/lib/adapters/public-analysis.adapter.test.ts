import { describe, expect, it } from 'vitest';

import {
  TEMPORAL_NOTICE_COPY,
  adaptCreatedPublicVerificationSession,
  adaptPublicAnalysisResult,
  adaptPublicVerificationSession
} from './public-analysis.adapter';
import { IncompatiblePayloadError } from '@/lib/errors/api-error';

function sessionPayload(overrides: Record<string, unknown> = {}) {
  return {
    status: 'requirements_proposed',
    objectiveType: 'EMPLOYMENT',
    rawObjectiveText: '  Buscamos  perfil backend\n\n',
    objectiveTitle: 'Backend junior',
    proposal: {
      authority: 'PROPOSAL_ONLY',
      humanConfirmationRequired: true,
      candidates: [
        {
          candidateId: 'cand_01',
          proposedRequirementText: 'Diseño de APIs REST',
          primarySourceReference: { exactExcerpt: 'perfil backend', charStart: 10, charEnd: 24 },
          primarySourceGrounding: 'UNIQUE',
          confirmableAsSourceDerived: true,
          sourceSectionLabel: '## Requisitos',
          exactDuplicateOfEarlier: false
        }
      ],
      unresolvedPassages: []
    },
    proposalInProgress: false,
    confirmedObjectiveDefinition: null,
    createdAt: '2026-09-16T12:00:00.000Z',
    expiresAt: '2026-09-17T12:00:00.000Z',
    confirmedAt: null,
    ...overrides
  };
}

function resultPayload(overrides: Record<string, unknown> = {}) {
  return {
    state: 'COMPLETED',
    objective: {
      objectiveType: 'EMPLOYMENT',
      title: 'Backend junior',
      objectiveContext: 'Equipo de plataforma',
      requirements: [{ order: 1, requirementText: 'Diseño de APIs REST' }]
    },
    completedAt: '2026-09-16T12:05:00.000Z',
    failure: null,
    result: {
      requirements: [
        {
          order: 1,
          requirementText: 'Diseño de APIs REST',
          finalState: 'PARTIALLY_SUPPORTED',
          supportedWeakerClaim: 'Exposición formativa a diseño de APIs REST.',
          evidence: {
            supporting: [
              {
                credentialReference: 'cred-1',
                title: 'Curso de APIs',
                credentialType: 'course',
                issuerName: 'Universidad Demo',
                currentStatus: 'issued',
                sourceKinds: ['DOCUMENT'],
                supportingUnitCount: 1
              }
            ]
          }
        }
      ],
      synthesis: {
        stateSummary: {
          supportedCount: 0,
          partiallySupportedCount: 1,
          insufficientEvidenceCount: 0,
          abstainCount: 0,
          notAssessableCount: 0
        },
        positiveConclusions: [
          {
            order: 1,
            requirementText: 'Diseño de APIs REST',
            finalState: 'PARTIALLY_SUPPORTED',
            supportedWeakerClaim: 'Exposición formativa a diseño de APIs REST.',
            supportingCredentialReferences: ['cred-1']
          }
        ],
        credentialsSupportingPositiveConclusions: [
          {
            credentialReference: 'cred-1',
            title: 'Curso de APIs',
            credentialType: 'course',
            issuerName: 'Universidad Demo',
            currentStatus: 'issued',
            supportedRequirementOrders: [],
            partiallySupportedRequirementOrders: [1]
          }
        ]
      },
      temporalNotice: 'FINAL_STATE_IS_HISTORICAL_CREDENTIAL_STATUS_IS_CURRENT'
    },
    ...overrides
  };
}

describe('sesión pública', () => {
  it('copia el texto del verificador VERBATIM y adapta la propuesta', () => {
    const session = adaptPublicVerificationSession(sessionPayload());
    expect(session.rawObjectiveText).toBe('  Buscamos  perfil backend\n\n');
    expect(session.objectiveTypeLabel).toBe('Busqueda laboral');
    expect(session.proposal?.candidates).toHaveLength(1);
    expect(session.confirmedRequirements).toEqual([]);
  });

  it('lee los requisitos confirmados por orden y sin ids internos', () => {
    const session = adaptPublicVerificationSession(
      sessionPayload({
        status: 'requirements_confirmed',
        confirmedObjectiveDefinition: {
          schemaVersion: 'objective_definition_v1',
          requirements: [
            { requirementId: 'req_02', order: 2, requirementText: 'Segundo' },
            { requirementId: 'req_01', order: 1, requirementText: 'Primero' }
          ]
        }
      })
    );
    expect(session.confirmedRequirements).toEqual(['Primero', 'Segundo']);
    expect(JSON.stringify(session)).not.toContain('req_01');
  });

  it('rechaza un tipo de objetivo desconocido', () => {
    expect(() => adaptPublicVerificationSession(sessionPayload({ objectiveType: 'MARRIAGE' }))).toThrow(
      IncompatiblePayloadError
    );
  });

  it('exige el token crudo al crear la sesión', () => {
    const created = adaptCreatedPublicVerificationSession({
      requestToken: 'r'.repeat(43),
      session: sessionPayload({ status: 'draft', proposal: null })
    });
    expect(created.requestToken).toHaveLength(43);
    expect(() =>
      adaptCreatedPublicVerificationSession({ session: sessionPayload() })
    ).toThrow(IncompatiblePayloadError);
  });
});

describe('resultado público', () => {
  it('mapea estado, etiquetas y credencial de respaldo sin derivar nada', () => {
    const result = adaptPublicAnalysisResult(resultPayload());
    expect(result.state).toBe('COMPLETED');
    expect(result.result?.requirements[0].finalStateLabel).toBe('Respaldado parcialmente');
    expect(result.result?.requirements[0].supportingCredentials[0]).toMatchObject({
      credentialReference: 'cred-1',
      credentialTypeLabel: 'Curso',
      currentStatusLabel: 'Vigente',
      sourceKindLabels: ['Documento'],
      supportingUnitCount: 1
    });
    expect(result.result?.synthesis.totalRequirements).toBe(1);
  });

  it('traduce el aviso temporal y nunca expone el token del contrato', () => {
    const result = adaptPublicAnalysisResult(resultPayload());
    expect(result.result?.temporalNotice).toBe(TEMPORAL_NOTICE_COPY);
    expect(JSON.stringify(result)).not.toContain('FINAL_STATE_IS_HISTORICAL');
  });

  it('falla cerrado si cambia la semántica temporal del contrato', () => {
    const payload = resultPayload();
    (payload.result as Record<string, unknown>).temporalNotice = 'OTRA_COSA';
    expect(() => adaptPublicAnalysisResult(payload)).toThrow(IncompatiblePayloadError);
  });

  it('rechaza respaldo bajo un estado no positivo', () => {
    const payload = resultPayload();
    const requirement = (payload.result as { requirements: Record<string, unknown>[] }).requirements[0];
    requirement.finalState = 'INSUFFICIENT_EVIDENCE';
    expect(() => adaptPublicAnalysisResult(payload)).toThrow(IncompatiblePayloadError);
  });

  it.each(['INSUFFICIENT_EVIDENCE', 'ABSTAIN', 'NOT_ASSESSABLE'])(
    'acepta %s con respaldo vacío y sin claim más débil',
    (finalState) => {
      const payload = resultPayload();
      const requirement = (payload.result as { requirements: Record<string, unknown>[] }).requirements[0];
      requirement.finalState = finalState;
      requirement.supportedWeakerClaim = null;
      requirement.evidence = { supporting: [] };
      const result = adaptPublicAnalysisResult(payload);
      expect(result.result?.requirements[0].supportingCredentials).toEqual([]);
      expect(result.result?.requirements[0].supportedWeakerClaim).toBeNull();
    }
  );

  it('acepta una credencial hoy revocada sin borrar la conclusión histórica', () => {
    const payload = resultPayload();
    const requirement = (payload.result as { requirements: Record<string, unknown>[] }).requirements[0];
    (requirement.evidence as { supporting: Record<string, unknown>[] }).supporting[0].currentStatus = 'revoked';
    const result = adaptPublicAnalysisResult(payload);
    expect(result.result?.requirements[0].finalState).toBe('PARTIALLY_SUPPORTED');
    expect(result.result?.requirements[0].supportingCredentials[0].currentStatusLabel).toBe('Revocada');
  });

  it('adapta los estados no completados y su categoría de fallo', () => {
    const processing = adaptPublicAnalysisResult(
      resultPayload({ state: 'PROCESSING', result: null, completedAt: null })
    );
    expect(processing.state).toBe('PROCESSING');
    expect(processing.result).toBeNull();

    const failed = adaptPublicAnalysisResult(
      resultPayload({
        state: 'FAILED',
        result: null,
        completedAt: null,
        failure: { category: 'EXECUTION_INTERRUPTED', retryable: false }
      })
    );
    expect(failed.failure).toEqual({ category: 'EXECUTION_INTERRUPTED', retryable: false });
  });

  it('falla cerrado si COMPLETED viene sin resultado', () => {
    expect(() => adaptPublicAnalysisResult(resultPayload({ result: null }))).toThrow(
      IncompatiblePayloadError
    );
  });

  it('falla cerrado ante una categoría de fallo desconocida', () => {
    expect(() =>
      adaptPublicAnalysisResult(
        resultPayload({ state: 'FAILED', result: null, failure: { category: 'NOPE', retryable: false } })
      )
    ).toThrow(IncompatiblePayloadError);
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildObjectiveSynthesisV1,
  ObjectiveSynthesisInvariantError,
  type VerifiedObjectiveSynthesisView
} from './objective-synthesis';
import {
  type ReasoningRunObjectiveSnapshotResponseDto,
  type ReasoningRunRequirementResultResponseDto
} from './dto/reasoning-run.dto';

type Requirement = ReasoningRunObjectiveSnapshotResponseDto['requirements'][number];
type RequirementResult = ReasoningRunRequirementResultResponseDto;
type Evidence = RequirementResult['evidence'][number];
type Credential = NonNullable<Evidence['credential']>;

function requirement(requirementId: string, order: number): Requirement {
  return { requirementId, order, requirementText: `Requirement ${order}` };
}

function credential(credentialReference: string): Credential {
  return {
    credentialReference,
    title: `Credential ${credentialReference}`,
    credentialType: 'course',
    issuerName: 'Issuer demo',
    currentStatus: 'issued'
  };
}

function evidence(value: Credential | null): Evidence {
  return {
    excerpt: 'Safe excerpt',
    contextBefore: null,
    contextAfter: null,
    sectionLabel: null,
    pageNumber: null,
    coverage: 'FULL',
    sourceKind: 'TEXT',
    credential: value
  };
}

function result(
  requirementId: string,
  finalState: string,
  options: {
    supportedWeakerClaim?: string | null;
    evidence?: Evidence[];
  } = {}
): RequirementResult {
  return {
    requirementId,
    requirementText: `Result ${requirementId}`,
    finalState,
    supportedWeakerClaim: options.supportedWeakerClaim ?? null,
    evidence: options.evidence ?? []
  };
}

function view(
  requirements: Requirement[],
  requirementResults: RequirementResult[]
): VerifiedObjectiveSynthesisView {
  return {
    reasoningRunReference: 'run-1',
    objective: {
      objectiveReference: 'objective-1',
      title: 'Objective',
      objectiveType: 'EMPLOYMENT',
      objectiveContext: 'Context',
      requirements
    },
    result: { requirementResults }
  };
}

function invariant(code: string) {
  return (error: unknown) =>
    error instanceof ObjectiveSynthesisInvariantError && error.code === code;
}

test('representa la distribución real de 14 Requirements sin promover evidencia no positiva', () => {
  const requirements = Array.from({ length: 14 }, (_, index) =>
    requirement(`req_${String(index + 1).padStart(2, '0')}`, index + 1)
  );
  const results = [
    result('req_01', 'PARTIALLY_SUPPORTED', {
      supportedWeakerClaim: 'Existe una versión acotada respaldada.',
      evidence: [evidence(credential('positive-partial'))]
    }),
    ...['req_02', 'req_03', 'req_04', 'req_05', 'req_06'].map((id) =>
      result(id, 'INSUFFICIENT_EVIDENCE', {
        evidence: [evidence(credential('only-insufficient'))]
      })
    ),
    ...['req_07', 'req_08'].map((id) =>
      result(id, 'ABSTAIN', { evidence: [evidence(credential('only-abstain'))] })
    ),
    ...['req_09', 'req_10', 'req_11', 'req_12', 'req_13', 'req_14'].map((id) =>
      result(id, 'NOT_ASSESSABLE', {
        evidence: [evidence(credential('only-not-assessable'))]
      })
    )
  ];

  const synthesis = buildObjectiveSynthesisV1(view(requirements, results));

  assert.deepEqual(synthesis.stateSummary, {
    supportedCount: 0,
    partiallySupportedCount: 1,
    insufficientEvidenceCount: 5,
    abstainCount: 2,
    notAssessableCount: 6
  });
  assert.equal(synthesis.requirements.length, 14);
  assert.deepEqual(
    synthesis.requirements.map((item) => item.requirementId),
    requirements.map((item) => item.requirementId)
  );
  assert.deepEqual(synthesis.positiveConclusions, [
    {
      requirementId: 'req_01',
      requirementText: 'Requirement 1',
      finalState: 'PARTIALLY_SUPPORTED',
      supportedWeakerClaim: 'Existe una versión acotada respaldada.',
      supportingCredentialReferences: ['positive-partial']
    }
  ]);
  assert.deepEqual(
    synthesis.credentialsSupportingPositiveConclusions.map(
      (item) => item.credentialReference
    ),
    ['positive-partial']
  );
});

test('SUPPORTED y PARTIALLY_SUPPORTED agregan una credencial una sola vez por Requirement único', () => {
  const shared = credential('credential-shared');
  const synthesis = buildObjectiveSynthesisV1(
    view(
      [requirement('req_01', 1), requirement('req_02', 2)],
      [
        result('req_01', 'SUPPORTED', {
          evidence: [evidence(shared), evidence(shared)]
        }),
        result('req_02', 'PARTIALLY_SUPPORTED', {
          supportedWeakerClaim: 'Alcance parcial respaldado.',
          evidence: [evidence(shared)]
        })
      ]
    )
  );

  assert.deepEqual(
    synthesis.positiveConclusions.map((item) => ({
      finalState: item.finalState,
      supportedWeakerClaim: item.supportedWeakerClaim,
      references: item.supportingCredentialReferences
    })),
    [
      {
        finalState: 'SUPPORTED',
        supportedWeakerClaim: null,
        references: ['credential-shared']
      },
      {
        finalState: 'PARTIALLY_SUPPORTED',
        supportedWeakerClaim: 'Alcance parcial respaldado.',
        references: ['credential-shared']
      }
    ]
  );
  assert.deepEqual(synthesis.credentialsSupportingPositiveConclusions, [
    {
      credentialReference: 'credential-shared',
      credentialDisplay: {
        title: 'Credential credential-shared',
        credentialType: 'course',
        issuerName: 'Issuer demo',
        currentStatus: 'issued'
      },
      supportedRequirementIds: ['req_01'],
      partiallySupportedRequirementIds: ['req_02']
    }
  ]);
});

test('preserva el primer vínculo positivo por orden de Requirement y luego de evidencia', () => {
  const synthesis = buildObjectiveSynthesisV1(
    view(
      [requirement('req_01', 1), requirement('req_02', 2)],
      [
        result('req_01', 'SUPPORTED', {
          evidence: [evidence(credential('credential-b')), evidence(credential('credential-a'))]
        }),
        result('req_02', 'PARTIALLY_SUPPORTED', {
          supportedWeakerClaim: 'Claim acotado.',
          evidence: [evidence(credential('credential-c'))]
        })
      ]
    )
  );

  assert.deepEqual(
    synthesis.credentialsSupportingPositiveConclusions.map(
      (item) => item.credentialReference
    ),
    ['credential-b', 'credential-a', 'credential-c']
  );
});

test('falla cerrado ante IDs duplicados, resultados faltantes o estados desconocidos', () => {
  assert.throws(
    () =>
      buildObjectiveSynthesisV1(
        view(
          [requirement('req_01', 1), requirement('req_01', 2)],
          [result('req_01', 'SUPPORTED')]
        )
    ),
    invariant('DUPLICATE_FROZEN_REQUIREMENT_ID')
  );
  assert.throws(
    () =>
      buildObjectiveSynthesisV1(
        view(
          [requirement('req_01', 1)],
          [result('req_01', 'SUPPORTED'), result('req_01', 'SUPPORTED')]
        )
      ),
    invariant('DUPLICATE_RESULT_REQUIREMENT_ID')
  );
  assert.throws(
    () =>
      buildObjectiveSynthesisV1(
        view(
          [requirement('req_01', 1), requirement('req_02', 2)],
          [result('req_01', 'SUPPORTED')]
        )
      ),
    invariant('COMPLETED_RESULT_REQUIREMENT_SET_INCOMPLETE')
  );
  assert.throws(
    () =>
      buildObjectiveSynthesisV1(
        view([requirement('req_01', 1)], [result('req_01', 'UNSUPPORTED')])
      ),
    invariant('FINAL_STATE_UNSUPPORTED')
  );
});

test('la metadata actual revocada no elimina un vínculo histórico positivo', () => {
  const revoked = { ...credential('credential-revoked'), currentStatus: 'revoked' };
  const synthesis = buildObjectiveSynthesisV1(
    view(
      [requirement('req_01', 1)],
      [result('req_01', 'SUPPORTED', { evidence: [evidence(revoked)] })]
    )
  );

  assert.deepEqual(synthesis.positiveConclusions[0].supportingCredentialReferences, [
    'credential-revoked'
  ]);
  assert.equal(
    synthesis.credentialsSupportingPositiveConclusions[0].credentialDisplay.currentStatus,
    'revoked'
  );
});

test('falla cerrado cuando un parcial no tiene claim usable o un supported trae uno', () => {
  assert.throws(
    () =>
      buildObjectiveSynthesisV1(
        view(
          [requirement('req_01', 1)],
          [result('req_01', 'PARTIALLY_SUPPORTED', { supportedWeakerClaim: '  ' })]
        )
      ),
    invariant('PARTIAL_WEAKER_CLAIM_REQUIRED')
  );
  assert.throws(
    () =>
      buildObjectiveSynthesisV1(
        view(
          [requirement('req_01', 1)],
          [result('req_01', 'SUPPORTED', { supportedWeakerClaim: 'No permitido.' })]
        )
      ),
    invariant('SUPPORTED_MUST_NOT_HAVE_WEAKER_CLAIM')
  );
});

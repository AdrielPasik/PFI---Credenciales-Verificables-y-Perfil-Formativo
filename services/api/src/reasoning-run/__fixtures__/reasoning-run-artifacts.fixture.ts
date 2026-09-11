/**
 * Fixtures validas de los tres artifacts — F3.1.
 *
 * Cada test negativo MUTA una copia de estas, para que aisle exactamente un
 * invariante. Misma tecnica que las fixtures de F2.1.
 *
 * Los valores textuales son deliberadamente inocuos: si un error filtrara
 * contenido, el sentinel de los tests de privacidad lo hace evidente.
 */

/** Objeto plano y mutable: los tests le sacan y le ponen claves. */
export type Mutable = Record<string, any>;

export function validObjectiveAnalysis(): Mutable {
  return {
    schemaVersion: 'objective_analysis_v1',
    requirements: [
      {
        requirementId: 'req_01',
        epistemicTarget: 'FORMATIVE_EVIDENCE',
        epistemicTargetRationale: 'El requisito pide formacion acreditable.',
        atomicity: 'ATOMIC',
        evaluability: {
          requiredEvidenceType: 'FORMATIVE_EVIDENCE',
          formativeEvidenceCapable: true,
          rationale: 'Se puede evaluar con evidencia formativa.'
        },
        qualifiers: [
          {
            qualifierId: 'q_01',
            kind: 'nivel',
            value: 'intermedio',
            sourcePhrase: 'nivel intermedio',
            role: 'MATERIAL_QUALIFIER',
            rationale: 'Acota el alcance del requisito.'
          },
          {
            qualifierId: null,
            kind: 'contexto',
            value: 'backend',
            sourcePhrase: 'en backend',
            role: 'CONTEXTUAL',
            rationale: 'Contexto, no exigencia material.'
          }
        ],
        normalizedRequirement: 'Conocimiento intermedio de APIs REST.',
        validations: [
          {
            taxonomy: 'HARD_FACTUAL_INVARIANT',
            code: 'REQUIREMENT_REFERENCE_VALID',
            status: 'PASS',
            artifactRef: 'req_01',
            detail: 'req_01',
            affectsEpistemicState: false
          }
        ]
      }
    ]
  };
}

export function validEvidenceUnits(): Mutable {
  return {
    schemaVersion: 'evidence_units_v1',
    sources: [{ sourceId: 'src_01', sourceProvenance: 'ISSUER_DECLARED' }],
    evidenceUnits: [
      {
        evidenceUnitId: 'eu_01',
        normalizedProposition: 'El curso cubrio diseno de APIs REST.',
        claimType: 'DECLARED_CONTENT',
        semanticQualifiers: [{ kind: 'tema', value: 'APIs REST' }],
        exactQuote: 'diseno de APIs REST',
        contextBefore: 'Contenidos: ',
        contextAfter: ' y persistencia.',
        sectionLabel: 'Contenidos',
        sourceTrace: {
          sourceId: 'src_01',
          sourceSha256: 'a'.repeat(64),
          segmentId: 'seg_003',
          pageNumber: 1,
          charStart: 12,
          charEnd: 31,
          exactExcerpt: 'diseno de APIs REST'
        },
        interpretationProvenance: 'AI_INFERRED',
        extractionQuality: 'FULL'
      }
    ],
    preparation: {
      mode: 'FULL_SCAN',
      evidenceUnitIds: ['eu_01'],
      exactRedundancyGroups: [],
      sourceObservabilityFacts: [
        {
          sourceId: 'src_01',
          coverageStatus: 'FULL',
          observedEvidenceUnitIds: ['eu_01'],
          extractionDiagnostics: []
        }
      ],
      discardedEvidenceProposalCount: 0
    },
    validations: [
      {
        taxonomy: 'DETERMINISTIC_REPAIRABLE',
        code: 'TRACE_ALIGNMENT_EXACT',
        status: 'PASS',
        artifactRef: 'eu_01',
        detail: 'src_01',
        affectsEpistemicState: false
      }
    ]
  };
}

export function validResult(): Mutable {
  return {
    schemaVersion: 'reasoning_run_result_v1',
    requirementResults: [
      {
        requirementId: 'req_01',
        finalState: 'PARTIALLY_SUPPORTED',
        evaluatedEvidence: [
          {
            evidenceUnitId: 'eu_01',
            relation: 'CONTRIBUTORY_SUPPORT',
            supportedQualifierIds: [],
            missingQualifierIds: ['q_01'],
            evidenceContribution: 'Aporta contenido declarado.',
            rationale: 'Cubre el tema sin acreditar el nivel.'
          }
        ],
        facets: [
          {
            localFacetKey: 'facet_api_design',
            facetText: 'Diseno de APIs',
            requirementBasisPhrases: ['APIs REST'],
            whyNecessary: 'Es el nucleo del requisito.',
            essential: true,
            coverage: 'PARTIAL',
            evidenceUnitIds: ['eu_01'],
            rationale: 'Contenido declarado sin evaluacion.'
          }
        ],
        compositionAssessment: {
          mode: 'NONE',
          nonRedundantEvidenceUnitIds: ['eu_01'],
          jointlySupportsFullRequirement: false,
          integrationRequired: false,
          integrationDemonstrated: false,
          integrationEvidenceIds: [],
          missingFacetLocalKeys: [],
          unresolved: false,
          rationale: 'Una sola unidad de evidencia.'
        },
        fullClaimAssessment: {
          status: 'NOT_REACHED',
          supportedQualifierIds: [],
          missingQualifierIds: ['q_01'],
          coveredFacetLocalKeys: [],
          missingFacetLocalKeys: ['facet_api_design'],
          rationale: 'Falta acreditar el nivel exigido.'
        },
        jointClaimCeiling: {
          text: 'Contenido declarado sobre APIs REST.',
          supportingEvidenceUnitIds: ['eu_01']
        },
        observabilityAssessment: {
          incompleteSourceAssessments: [],
          independentObservableSupport: 'WEAKER_CLAIM',
          observabilityStatus: 'SUFFICIENT',
          rationale: 'La fuente se observo completa.'
        },
        weakerClaimSearch: {
          status: 'FOUND',
          rationale: 'Existe una version defendible del requisito.',
          candidate: {
            text: 'Exposicion formativa a diseno de APIs REST.',
            supportingEvidenceUnitIds: ['eu_01'],
            derivedFromJointClaimCeiling: 'YES',
            droppedQualifierIds: ['q_01'],
            droppedFacetLocalKeys: [],
            continuityAssessment: {
              status: 'YES',
              transformation: 'CONSTITUTIVE_REDUCTION',
              requirementBasisPhrases: ['APIs REST'],
              constitutiveProjection: 'Se conserva el objeto del requisito.',
              explicitlyRelaxed: ['nivel intermedio'],
              externalTargetIntroduced: 'NO',
              shiftReason: null,
              rationale: 'Reduccion constitutiva del mismo requisito.'
            },
            materialUsefulness: 'YES',
            usefulnessRationale: 'Sigue siendo informativo para el objetivo.'
          }
        },
        semanticUnresolved: false,
        unresolvedReason: '',
        policyTrace: {
          preGuardState: 'PARTIALLY_SUPPORTED',
          hardFactualFailure: false,
          formativeEvidenceCapable: true,
          epistemicTarget: 'FORMATIVE_EVIDENCE',
          unresolved: false,
          reachesFullRequirement: false,
          weakerSearchStatus: 'FOUND',
          continuityStatus: 'YES',
          materialUsefulness: 'YES',
          hasMateriallyUsefulWeakerClaim: true,
          weakerClaimStillBelongsToRequirement: true,
          observabilityStatus: 'SUFFICIENT'
        },
        explanation:
          'Requirement: APIs REST. Estado: PARTIALLY_SUPPORTED. Evidencia: src_01.'
      }
    ],
    validations: []
  };
}

/**
 * Plan de ejecucion COMPLETO: las tres etapas con proveedor, congelado antes de
 * la primera llamada. Es la forma que F3.3B tendra que escribir.
 */
export function validExecutionMetadata(): Mutable {
  const openai = (model: string) => ({
    provider: 'openai',
    model,
    reasoningEffort: 'medium'
  });
  return {
    schemaVersion: 'reasoning_execution_metadata_v1',
    reasonerContractVersion: 'product_reasoner_v1',
    deterministicPolicyVersion: 'product_epistemic_policy_v1',
    objectiveAnalysis: {
      artifactSchemaVersion: 'objective_analysis_v1',
      promptVersion: 'product_objective_analysis_v1',
      adapterVersion: 'product_objective_analysis_adapter_v1',
      provider: openai('test-model')
    },
    evidenceUnits: {
      artifactSchemaVersion: 'evidence_units_v1',
      promptVersion: 'product_evidence_units_v1',
      adapterVersion: 'product_evidence_units_adapter_v1',
      provider: openai('test-model')
    },
    contextualReasoning: {
      artifactSchemaVersion: 'reasoning_run_result_v1',
      promptVersion: 'product_contextual_reasoning_v1',
      adapterVersion: 'product_contextual_reasoning_adapter_v1',
      provider: openai('test-model')
    }
  };
}

/** Copia profunda, para que mutar una fixture no contamine el siguiente test. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Texto del Requirement confirmado, EN CORRESPONDENCIA con las citas de
 * `validObjectiveAnalysis()`.
 *
 * Contiene literalmente `nivel intermedio` y `en backend`, que son los dos
 * `sourcePhrase` de la fixture. Si se cambia uno hay que cambiar el otro: ésa es
 * exactamente la relacion que el anclaje de qualifiers verifica.
 */
export const CONFIRMED_REQUIREMENT_TEXT =
  'Diseno de APIs REST nivel intermedio en backend';

/** Contexto del Objective. Ninguna de sus frases aparece en el Requirement. */
export const CONFIRMED_OBJECTIVE_CONTEXT =
  'Backend Developer Junior en equipo de plataforma';

/** La vista del Objective congelado que consume el verificador de la etapa 1. */
export function confirmedObjectiveSnapshot(
  requirementIds: readonly string[] = ['req_01']
) {
  return {
    objectiveContext: CONFIRMED_OBJECTIVE_CONTEXT,
    requirements: requirementIds.map((requirementId) => ({
      requirementId,
      requirementText: CONFIRMED_REQUIREMENT_TEXT
    }))
  };
}

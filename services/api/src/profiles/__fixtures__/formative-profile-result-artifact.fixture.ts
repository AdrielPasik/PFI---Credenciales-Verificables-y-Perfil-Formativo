import {
  type FormativeProfileResultArtifact
} from '../formative-profile-result-artifact.types';

export function createFormativeProfileResultArtifact(): FormativeProfileResultArtifact {
  const sourceRef = {
    documentId: '3.4.080',
    fileName: '3.4.080_BASE_DE_DATOS_I.pdf',
    sourceType: 'academic_pdf' as const
  };

  return {
    profileVersion: 'formative_profile_result_v0',
    generatedFrom: {
      artifactSchema: 'semantic_analysis_v1',
      artifactCount: 2,
      sourceTypes: {
        academic_pdf: 2
      },
      pipelineVersions: ['unversioned_current'],
      taxonomyVersions: ['unversioned_current']
    },
    summary: {
      text: 'El perfil muestra evidencia formativa en datos y software.',
      language: 'es',
      style: 'cautious_explanatory'
    },
    confidence: {
      band: 'medium',
      score: null,
      scoreMethod: 'qualitative_only',
      explanation: 'La confianza se interpreta de forma cualitativa.',
      drivers: ['multiple_academic_sources'],
      limitations: []
    },
    areas: [
      {
        id: 'area_data',
        label: 'Datos',
        evidenceCount: 2,
        hours: 40,
        confidence: 0.9,
        sourceTypes: ['academic_pdf'],
        sourceRefs: [sourceRef]
      }
    ],
    skills: [
      {
        id: 'skill_sql',
        label: 'SQL',
        evidenceCount: 2,
        confidence: 0.85,
        source: 'explicit',
        sourceTypes: ['academic_pdf'],
        sourceRefs: [sourceRef]
      }
    ],
    concepts: [
      {
        id: 'concept_normalization',
        label: 'Normalizacion',
        evidenceCount: 1,
        confidence: 0.8,
        sourceTypes: ['academic_pdf'],
        sourceRefs: [sourceRef]
      }
    ],
    strengths: ['Evidencia consistente en fundamentos de datos.'],
    possibleDirections: ['Profundizar en arquitectura de datos.'],
    limitations: [],
    warnings: [],
    evidence: {
      sourceCoverage: {
        sourceArtifactsCount: 2,
        bySourceType: {
          academic_pdf: 2
        },
        sourceRefs: [sourceRef],
        note: 'Las referencias identifican fuentes, no identidad del holder.'
      },
      evidenceOverview: {
        artifacts_with_area_evidence: 2,
        artifacts_with_skill_evidence: 2,
        artifacts_with_concept_evidence: 1,
        total_area_evidence_entries: 2,
        total_skill_evidence_entries: 2,
        total_concept_evidence_entries: 1
      },
      sourceRefs: [sourceRef]
    },
    audit: {
      qualityFlags: {
        area_assignment_confident: 2
      },
      partialReasons: {},
      rawWarningCodes: [],
      rawPartialReasonCodes: []
    }
  };
}

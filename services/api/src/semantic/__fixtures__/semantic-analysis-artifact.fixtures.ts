import type { SemanticAnalysisArtifact } from '../semantic-analysis-artifact.types';

export function createAcademicPdfCompletedArtifact(): SemanticAnalysisArtifact {
  return {
    schemaVersion: 'semantic_analysis_v1',
    pipelineVersion: 'unversioned_current',
    taxonomyVersion: 'unversioned_current',
    status: 'completed',
    sourceType: 'academic_pdf',
    sourceRefs: {
      documentId: '3.4.080',
      fileName: '3.4.080_BASE_DE_DATOS_I.pdf'
    },
    areas: [
      {
        id: 'area_bases_de_datos',
        label: 'Bases de Datos',
        confidence: 0.98,
        confidenceMethod: 'measured',
        source: 'explicit'
      }
    ],
    skills: [
      {
        id: 'skill_sql',
        label: 'SQL',
        confidence: 0.98,
        confidenceMethod: 'measured',
        source: 'explicit'
      }
    ],
    concepts: [
      {
        id: 'sql',
        label: 'SQL',
        confidence: null,
        confidenceMethod: 'unavailable'
      }
    ],
    hoursDistribution: [
      {
        areaId: 'area_bases_de_datos',
        hours: 68
      }
    ],
    evidenceMap: {
      areas: {
        area_bases_de_datos: ['matched_signal:base de datos']
      },
      skills: {
        skill_sql: ['matched_signal:sql']
      },
      concepts: {}
    },
    confidence: {
      global: 0.98,
      globalMethod: 'derived',
      coverage: null,
      coverageMethod: 'unavailable'
    },
    qualityFlags: [
      'area_assignment_confident',
      'semantic_quality_high'
    ],
    textForEmbedding: 'BASE DE DATOS I. SQL y modelo relacional.',
    warnings: [],
    partialReasons: []
  };
}

export function createAcademicPdfPartialArtifact(): SemanticAnalysisArtifact {
  return {
    schemaVersion: 'semantic_analysis_v1',
    pipelineVersion: 'unversioned_current',
    taxonomyVersion: 'unversioned_current',
    status: 'partial',
    sourceType: 'academic_pdf',
    sourceRefs: {
      documentId: '3.3.152',
      fileName: '3.3.152_NEGOCIACION_Y_LIDERAZGO.pdf'
    },
    areas: [],
    skills: [],
    concepts: [
      {
        id: 'liderazgo_situacional',
        label: 'liderazgo situacional',
        confidence: null,
        confidenceMethod: 'unavailable'
      }
    ],
    hoursDistribution: [],
    evidenceMap: {
      areas: {},
      skills: {},
      concepts: {}
    },
    confidence: {
      global: null,
      globalMethod: 'unavailable',
      coverage: null,
      coverageMethod: 'unavailable'
    },
    qualityFlags: ['area_assignment_unresolved'],
    textForEmbedding: 'NEGOCIACION Y LIDERAZGO.',
    warnings: ['area_could_not_be_confidently_resolved'],
    partialReasons: ['kbs_area_assignment_status_unresolved_domain_candidate']
  };
}

export function createOnlineCourseArtifact(): SemanticAnalysisArtifact {
  return {
    schemaVersion: 'semantic_analysis_v1',
    pipelineVersion: 'unversioned_current',
    taxonomyVersion: 'unversioned_current',
    status: 'completed',
    sourceType: 'online_course_catalog',
    sourceRefs: {
      documentId:
        'online_courses_cleaned_parsed_00003_data_science_fundamentals',
      fileName:
        'online_courses_cleaned_parsed_00003_data_science_fundamentals.json'
    },
    areas: [
      {
        id: 'data_science_ai',
        label: 'Data Science / AI',
        confidence: null,
        confidenceMethod: 'unavailable',
        source: 'inferred'
      }
    ],
    skills: [
      {
        id: 'python',
        label: 'Python',
        confidence: null,
        confidenceMethod: 'unavailable',
        source: 'inferred'
      }
    ],
    concepts: [
      {
        id: 'data_science',
        label: 'Data Science',
        confidence: null,
        confidenceMethod: 'unavailable'
      }
    ],
    hoursDistribution: [
      {
        areaId: 'data_science_ai',
        hours: 37.33
      }
    ],
    evidenceMap: {
      areas: {
        data_science_ai: ['category_keyword:data science']
      },
      skills: {
        python: ['description', 'title']
      },
      concepts: {}
    },
    confidence: {
      global: null,
      globalMethod: 'unavailable',
      coverage: null,
      coverageMethod: 'unavailable'
    },
    qualityFlags: [],
    textForEmbedding:
      'Data Science Fundamentals with Python and SQL Specialization',
    warnings: ['confidence_not_available_in_source_pipeline'],
    partialReasons: []
  };
}

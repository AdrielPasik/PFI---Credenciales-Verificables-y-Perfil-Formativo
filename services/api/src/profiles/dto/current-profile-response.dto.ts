export interface FormativeProfileSnapshotDto {
  id: string;
  profileVersion: string;
  isCurrent: boolean;
  credentialsCount: number;
  totalHours: number | null;
  areasSummary: unknown;
  skillsSummary: unknown;
  qualityFlags: unknown;
  generatedAt: string;
  profileJson: unknown;
}

export interface CurrentProfileResponseDto {
  userId: string;
  currentProfile: FormativeProfileSnapshotDto | null;
}

// C5b.2: proyeccion agregada y allowlisted de ProfileEvidenceProvenanceSummary
// (formative-profile.service.ts) -- nunca sources[], nunca credentialId,
// nunca reusableInterpretationId/semanticAnalysisId. null cuando el
// aggregate no tiene provenance persistida (perfil legacy pre-C5b.1) o el
// shape persistido es invalido -- nunca se fabrica un valor.
export interface HolderProfileProvenanceSummaryDto {
  issuerReviewedCount: number;
  aiInferredCount: number;
}

export interface HolderCurrentProfileResponseDto {
  currentProfile: {
    profileVersion: string;
    credentialsCount: number;
    // C2c: totalHours se conserva por compatibilidad; totalOfficialHours es
    // el mismo valor (suma de Credential.hours declarado, nunca IA) con un
    // nombre inequivoco para que el frontend nunca lo confunda con una
    // distribucion por area. credentialsWithoutHours/
    // credentialsWithoutSemanticCoverage/credentialsWithReviewedInterpretation
    // son contadores de cobertura -- null cuando el perfil persistido es
    // anterior a C2c/C5b.1 y no los tiene.
    totalHours: number | null;
    totalOfficialHours: number | null;
    credentialsWithoutHours: number | null;
    credentialsWithoutSemanticCoverage: number | null;
    // C5b.2: cuantas Credentials analizadas usaron una interpretacion
    // revisada por el emisor (profileJson.summary.credentialsWithReviewedInterpretation).
    credentialsWithReviewedInterpretation: number | null;
    narrative: string | null;
    areas: Array<{
      label: string;
      estimatedHours: number | null;
      provenanceSummary: HolderProfileProvenanceSummaryDto | null;
    }>;
    // Inferido por IA a partir de SemanticAnalysis. Ver emittedSkills para
    // habilidades cargadas por el emisor (dato distinto, nunca certificado
    // por IA).
    skills: Array<{
      label: string;
      confidence: number | null;
      provenanceSummary: HolderProfileProvenanceSummaryDto | null;
    }>;
    concepts: string[];
    // Dato emitido por el issuer (credentialSubject), no una deteccion de
    // IA. Nunca lleva confidence porque no es una inferencia.
    emittedSkills: string[];
    emittedCompetencies: string[];
    emittedLearningOutcomes: string[];
    confidence: number | null;
    qualityFlags: string[];
    generatedAt: string;
  } | null;
}

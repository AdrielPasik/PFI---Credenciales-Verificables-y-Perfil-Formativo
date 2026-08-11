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

export interface HolderCurrentProfileResponseDto {
  currentProfile: {
    profileVersion: string;
    credentialsCount: number;
    // C2c: totalHours se conserva por compatibilidad; totalOfficialHours es
    // el mismo valor (suma de Credential.hours declarado, nunca IA) con un
    // nombre inequivoco para que el frontend nunca lo confunda con una
    // distribucion por area. credentialsWithoutHours/
    // credentialsWithoutSemanticCoverage son contadores de cobertura --
    // null cuando el perfil persistido es anterior a C2c y no los tiene.
    totalHours: number | null;
    totalOfficialHours: number | null;
    credentialsWithoutHours: number | null;
    credentialsWithoutSemanticCoverage: number | null;
    areas: Array<{ label: string; estimatedHours: number | null }>;
    // Inferido por IA a partir de SemanticAnalysis. Ver emittedSkills para
    // habilidades cargadas por el emisor (dato distinto, nunca certificado
    // por IA).
    skills: Array<{ label: string; confidence: number | null }>;
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

export interface HolderSummaryVM {
  holderReference: string;
  email: string;
  did: string | null;
  displayLabel: string;
}

export interface HolderResolutionCommand {
  issuerReference: string;
  email: string;
}

export interface AcademicProgramSearchItemVM {
  programReference: string;
  programCode: string;
  programName: string;
  curriculumReference: string;
  curriculumCode: string;
}

export interface CurriculumAcademicSubjectSearchItemVM {
  academicCourseReference: string;
  code: string;
  name: string;
  description: string | null;
  hours: string | null;
  programReference: string;
  programCode: string;
  programName: string;
  curriculumReference: string;
  curriculumCode: string;
}

export interface AcademicProgramSearchCommand {
  issuerReference: string;
  query: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface CurriculumAcademicSubjectSearchCommand {
  issuerReference: string;
  curriculumReference: string;
  query: string;
  limit?: number;
  signal?: AbortSignal;
}

export type CredentialType =
  | 'academic_subject'
  | 'course'
  | 'certification'
  | 'degree';

export const credentialTypeLabels: Record<CredentialType, string> = {
  academic_subject: 'Asignatura académica',
  course: 'Curso',
  certification: 'Certificación',
  degree: 'Título académico'
};

export const credentialTypeOptions: readonly CredentialType[] = [
  'course',
  'certification',
  'academic_subject',
  'degree'
];

export const UADE_ISSUER_DID = 'did:example:issuer-demo';
const UADE_ISSUER_NAME_FALLBACKS = new Set([
  'Universidad Argentina de la Empresa (UADE)',
  'Demo University'
]);

export function credentialTypesForIssuer(
  issuerDid: string | null,
  issuerName?: string
): readonly CredentialType[] {
  return issuerDid === UADE_ISSUER_DID ||
    (issuerDid === null &&
      UADE_ISSUER_NAME_FALLBACKS.has(issuerName?.trim() ?? ''))
    ? credentialTypeOptions
    : ['course', 'certification'];
}

export type ManualCredentialType = Exclude<
  CredentialType,
  'academic_subject'
>;

export interface CreateManualCredentialDraftCommand {
  issuerReference: string;
  holderReference: string;
  achievementName: string;
  institutionName: string;
  credentialType: ManualCredentialType;
}

export interface CreateAcademicSubjectCurricularDraftCommand {
  issuerReference: string;
  holderReference: string;
  credentialType: 'academic_subject';
  academicCourseReference: string;
  curriculumReference: string;
}

export type CreateCredentialDraftCommand =
  | CreateManualCredentialDraftCommand
  | CreateAcademicSubjectCurricularDraftCommand;

export type CredentialDraftFormSubmission =
  | {
      credentialType: ManualCredentialType;
      achievementName: string;
      holder: HolderSummaryVM;
      // C3c: presente solo si el usuario aplico un template reutilizable
      // (course/certification). Nunca se manda al backend como campo propio
      // -- el controller lo usa para disparar un PATCH best-effort
      // inmediatamente despues de crear el draft, con los mismos campos que
      // ya acepta el editor de borrador existente.
      appliedTemplate?: CourseTemplateSummaryVM;
    }
  | {
      credentialType: 'academic_subject';
      holder: HolderSummaryVM;
      program: AcademicProgramSearchItemVM;
      subject: CurriculumAcademicSubjectSearchItemVM;
    };

export type CredentialStatus = 'draft' | 'issued' | 'revoked';

export type DocumentEvidenceKind = 'pdf' | 'image';
export type DocumentEvidenceStatus = 'current';
export type DocumentEvidenceMimeType =
  | 'application/pdf'
  | 'image/png'
  | 'image/jpeg';

export interface DocumentEvidenceVM {
  evidenceReference: string;
  kind: DocumentEvidenceKind;
  status: DocumentEvidenceStatus;
  originalFileName: string;
  mimeType: DocumentEvidenceMimeType;
  sizeBytes: number;
  sizeLabel: string;
  sha256: string;
  sha256Short: string;
  uploadedAt: string;
  uploadedAtLabel: string;
}

export interface UploadCredentialDocumentEvidenceCommand {
  issuerReference: string;
  credentialReference: string;
  file: File;
}

export interface TextEvidenceVM {
  textEvidenceReference: string;
  status: 'current';
  label: string | null;
  content: string;
  characterCount: number;
  characterCountLabel: string;
  sha256: string;
  sha256Short: string;
  submittedAt: string;
  submittedAtLabel: string;
}

export interface SubmitCredentialTextEvidenceCommand {
  issuerReference: string;
  credentialReference: string;
  label: string | null;
  content: string;
}

export interface CreatedCredentialDraftVM {
  credentialReference: string;
  issuerReference: string;
  status: CredentialStatus;
  // C3c: necesario para el PATCH best-effort que aplica los campos de un
  // template reutilizable inmediatamente despues de crear el draft
  // (compare-and-swap, mismo contrato que el resto de PATCH .../draft).
  updatedAt: string;
}

export interface IssuerCredentialSubjectVM {
  achievementName: string | null;
  institutionName: string | null;
  completionDate: string | null;
  academicPeriod: string | null;
  programName: string | null;
  grade: string | null;
  providerName: string | null;
  platformName: string | null;
  modality: string | null;
  level: string | null;
  certificationCode: string | null;
  expirationDate: string | null;
  externalUrl: string | null;
  skills: string[];
  competencies: string[];
  learningOutcomes: string[];
}

export interface CredentialBlockchainEvidenceVM {
  network: string;
  networkLabel: string;
  chainId: number;
  txHash: string;
  txHashShort: string;
  status: string;
  statusLabel: string;
  registeredAt: string;
  registeredAtLabel: string;
}

export interface IssuerCredentialDetailVM {
  credentialReference: string;
  title: string;
  description: string | null;
  hours: string | null;
  type: CredentialType;
  typeLabel: string;
  status: CredentialStatus;
  statusLabel: string;
  issuer: {
    displayName: string;
    did: string | null;
  };
  credentialSubject: IssuerCredentialSubjectVM;
  holder: {
    displayLabel: string;
    email: string | null;
    did: string | null;
  };
  academicCourse: {
    academicCourseReference: string;
    code: string;
    name: string;
    description: string | null;
    hours: string | null;
    program: AcademicProgramSearchItemVM | null;
  } | null;
  documentEvidence: {
    currentDocument: DocumentEvidenceVM | null;
  };
  textEvidence: {
    currentText: TextEvidenceVM | null;
  };
  issuedAt: string | null;
  issuedAtLabel: string | null;
  canonicalHash: string | null;
  canonicalHashShort: string | null;
  canonicalizationVersion: string | null;
  blockchainEvidence: CredentialBlockchainEvidenceVM | null;
  createdAt: string;
  updatedAt: string;
}

export interface IssueIssuerCredentialCommand {
  issuerReference: string;
  credentialReference: string;
}

export interface CredentialDraftPatchFields {
  achievementName: string;
  description: string | null;
  hours: string | null;
  type: CredentialType;
  completionDate: string | null;
  academicPeriod: string | null;
  programName: string | null;
  grade: string | null;
  providerName: string | null;
  platformName: string | null;
  modality: string | null;
  level: string | null;
  certificationCode: string | null;
  expirationDate: string | null;
  externalUrl: string | null;
  skills: string[];
  competencies: string[];
  learningOutcomes: string[];
}

export type UpdateIssuerCredentialDraftCommand = {
  issuerReference: string;
  credentialReference: string;
  expectedUpdatedAt: string;
  academicCourseReference?: string;
  curriculumReference?: string;
} & Partial<CredentialDraftPatchFields>;

export type CredentialFeedbackCode =
  | 'invalid_input'
  | 'conflict'
  | 'not_found'
  | 'forbidden'
  | 'session_expired'
  | 'service_unavailable'
  | 'network'
  | 'incompatible_response'
  | 'unexpected';

export interface CredentialFeedback {
  code: CredentialFeedbackCode;
  message: string;
}

// C3b: solo course y certification pueden guardarse como reutilizables --
// academic_subject y degree pertenecen al catalogo academico formal, no a
// un catalogo libre por issuer (ver domain-rules-v0.md, seccion C3a.2).
export type ReusableCredentialType = 'course' | 'certification';

export interface SaveCourseTemplateFromCredentialCommand {
  issuerReference: string;
  credentialReference: string;
}

// C3c: busqueda del catalogo reutilizable para precargar el formulario de
// creacion. credentialType es opcional -- el selector de /issuer/credentials/new
// siempre lo manda (course o certification, nunca 'all') para no arriesgarse
// a que el limite fijo de 20 resultados del backend oculte templates del
// tipo que el usuario esta buscando.
export interface ListCourseTemplatesCommand {
  issuerReference: string;
  search?: string;
  status?: 'active' | 'archived' | 'all';
  credentialType?: ReusableCredentialType | 'all';
  signal?: AbortSignal;
}

// C4a.1/C4a.2: resumen seguro de la interpretacion semantica aprobada (o
// candidata a aprobarse) para reutilizacion -- nunca el snapshot completo
// ni evidencia cruda. Mismos campos que devuelve el backend
// (approvedSemanticSnapshotSummary / candidate.summary).
export interface SemanticApprovalSnapshotSummaryVM {
  schema: string;
  status: 'completed' | 'partial';
  areaCount: number;
  skillCount: number;
  conceptCount: number;
  hasHoursDistribution: boolean;
  warningCount: number;
  qualityFlagCount: number;
}

// Minimo necesario para C3b (confirmar guardado exitoso); se adapta la
// respuesta completa para no romper C3c cuando agregue el selector. C4a.1
// agrega los campos approvedSemantic* (aditivos, siempre presentes aunque
// nunca se haya aprobado nada -- en ese caso son null).
export interface CourseTemplateSummaryVM {
  reference: string;
  credentialType: ReusableCredentialType;
  title: string;
  description: string | null;
  hours: string | null;
  modality: string | null;
  platformName: string | null;
  externalUrl: string | null;
  certificationCode: string | null;
  expirationDate: string | null;
  providerName: string | null;
  level: string | null;
  skills: string[];
  competencies: string[];
  learningOutcomes: string[];
  status: 'active' | 'archived';
  createdFromCredentialId: string | null;
  lastSemanticAnalysisId: string | null;
  approvedSemanticAnalysisId: string | null;
  approvedSemanticApprovedAt: string | null;
  approvedSemanticPipelineVersion: string | null;
  approvedSemanticTaxonomyVersion: string | null;
  approvedSemanticSourceCredentialId: string | null;
  approvedSemanticSnapshotSummary: SemanticApprovalSnapshotSummaryVM | null;
  createdAt: string;
  updatedAt: string;
}

// C4a.2: comandos para revisar y aprobar una interpretacion semantica
// candidata. Nunca incluyen el snapshot -- solo referencias (id) para que
// el backend haga el lookup y la validacion de scoping.
export interface GetTemplateSemanticApprovalCandidateCommand {
  issuerReference: string;
  templateReference: string;
  semanticAnalysisReference: string;
  signal?: AbortSignal;
}

export interface ApproveTemplateSemanticAnalysisCommand {
  issuerReference: string;
  templateReference: string;
  semanticAnalysisReference: string;
}

// C4a.2: resumen seguro de una SemanticAnalysis candidata, ANTES de
// aprobarla. Nunca expone analysisJson, sourceRefs, evidenceMap,
// textForEmbedding ni ningun identificador de evidencia/almacenamiento.
export interface TemplateSemanticApprovalCandidateVM {
  semanticAnalysisReference: string;
  status: 'completed' | 'partial';
  pipelineVersion: string | null;
  taxonomyVersion: string | null;
  sourceCredentialReference: string | null;
  summary: SemanticApprovalSnapshotSummaryVM;
}

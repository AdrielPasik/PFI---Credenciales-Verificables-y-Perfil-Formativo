import {
  AnalysisRunStatus,
  SemanticAnalysisStatus
} from '@prisma/client';

export class IssuerDocumentAnalysisResponseDto {
  analysisRunId!: string;
  credentialId!: string;
  status!: AnalysisRunStatus;
  semanticAnalysisId!: string;
  artifactStatus!: SemanticAnalysisStatus;
  sourceCount!: number;
  completedAt!: string;
}

import {
  AnalysisRunStatus,
  SemanticAnalysisStatus
} from '@prisma/client';

export class IssuerTextAnalysisResponseDto {
  analysisRunId!: string;
  credentialId!: string;
  status!: AnalysisRunStatus;
  semanticAnalysisId!: string;
  artifactStatus!: SemanticAnalysisStatus;
  sourceCount!: number;
  completedAt!: string;
}

import { type SemanticAnalysis } from '@prisma/client';

import { type CurrentProfileResponseDto } from '../../profiles/dto/current-profile-response.dto';
import { type FormativeProfileResultArtifact } from '../../profiles/formative-profile-result-artifact.types';
import { type SemanticAnalysisArtifact } from '../../semantic/semantic-analysis-artifact.types';

export interface AnalyzePdfScriptArgs {
  credentialId?: string;
  filePath: string;
  documentId?: string;
  fileName?: string;
  pipelineVersion?: string;
  taxonomyVersion?: string;
}

export interface BuildProfileScriptArgs {
  userId: string;
  credentialIds: string[];
}

export function parseAnalyzePdfScriptArgs(
  argv: string[]
): AnalyzePdfScriptArgs {
  const args = parseNamedArgs(argv);
  const filePath = optionalValue(args, '--file');
  if (!filePath) {
    throw new Error('Debe enviarse --file <path-to-pdf>.');
  }

  return {
    filePath,
    credentialId: optionalValue(args, '--credentialId'),
    documentId: optionalValue(args, '--documentId'),
    fileName: optionalValue(args, '--fileName'),
    pipelineVersion: optionalValue(args, '--pipelineVersion'),
    taxonomyVersion: optionalValue(args, '--taxonomyVersion')
  };
}

export function parseBuildProfileScriptArgs(
  argv: string[]
): BuildProfileScriptArgs {
  const args = parseNamedArgs(argv);
  const userId = optionalValue(args, '--userId');
  const credentialList = optionalValue(args, '--fromCredentialIds');

  if (!userId) {
    throw new Error('Debe enviarse --userId <holder-user-id>.');
  }
  if (!credentialList) {
    throw new Error(
      'Debe enviarse --fromCredentialIds <id1,id2,...>.'
    );
  }

  const credentialIds = [
    ...new Set(
      credentialList
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  ];
  if (credentialIds.length === 0) {
    throw new Error('--fromCredentialIds no contiene IDs validos.');
  }

  return {
    userId,
    credentialIds
  };
}

export function formatAnalyzePdfSummary(
  artifact: SemanticAnalysisArtifact,
  persisted: SemanticAnalysis | null
): string {
  return JSON.stringify(
    {
      schemaVersion: artifact.schemaVersion,
      status: artifact.status,
      sourceType: artifact.sourceType,
      documentId:
        typeof artifact.sourceRefs.documentId === 'string'
          ? artifact.sourceRefs.documentId
          : null,
      areasCount: artifact.areas.length,
      skillsCount: artifact.skills.length,
      conceptsCount: artifact.concepts.length,
      persisted: persisted
        ? {
            semanticAnalysisId: persisted.id,
            credentialId: persisted.credentialId,
            analyzedAt: persisted.analyzedAt.toISOString()
          }
        : null
    },
    null,
    2
  );
}

export function formatBuildProfileSummary(
  artifact: FormativeProfileResultArtifact,
  persisted: CurrentProfileResponseDto,
  credentialIds: string[]
): string {
  const profile = persisted.currentProfile;
  if (!profile) {
    throw new Error('La persistencia no devolvio un perfil current.');
  }

  return JSON.stringify(
    {
      profileId: profile.id,
      userId: persisted.userId,
      profileVersion: profile.profileVersion,
      generationMethod: 'ai_artifact_ingest_v0',
      sourceCredentialIds: credentialIds,
      artifactCount: artifact.generatedFrom.artifactCount,
      areasCount: artifact.areas.length,
      skillsCount: artifact.skills.length,
      conceptsCount: artifact.concepts.length,
      warningsCount: artifact.warnings.length,
      isCurrent: profile.isCurrent
    },
    null,
    2
  );
}

export function getScriptErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseNamedArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) {
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      throw new Error(`Falta valor para el argumento ${current}.`);
    }

    args.set(current, next);
    index += 1;
  }

  return args;
}

function optionalValue(
  args: Map<string, string>,
  name: string
): string | undefined {
  const value = args.get(name)?.trim();
  return value ? value : undefined;
}

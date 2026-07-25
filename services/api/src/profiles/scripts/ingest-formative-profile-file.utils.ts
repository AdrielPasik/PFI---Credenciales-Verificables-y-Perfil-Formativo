import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

import { type CurrentProfileResponseDto } from '../dto/current-profile-response.dto';
import {
  FORMATIVE_PROFILE_AI_GENERATION_METHOD,
  type FormativeProfileResultArtifact
} from '../formative-profile-result-artifact.types';

export interface ProfileIngestFileArgs {
  userId: string;
  filePath: string;
}

export function parseProfileIngestFileArgs(argv: string[]): ProfileIngestFileArgs {
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

  const userId = args.get('--userId')?.trim();
  const filePath = args.get('--file')?.trim();

  if (!userId) {
    throw new Error('Debe enviarse --userId <holder-user-id>.');
  }
  if (!filePath) {
    throw new Error(
      'Debe enviarse --file <path-to-formative-profile-result-v0-json>.'
    );
  }

  return {
    userId,
    filePath
  };
}

export async function readProfileArtifactJson(filePath: string): Promise<unknown> {
  try {
    await access(filePath, fsConstants.F_OK | fsConstants.R_OK);
  } catch {
    throw new Error(`No existe o no puede leerse el archivo: ${filePath}`);
  }

  const fileContent = await readFile(filePath, 'utf8');
  try {
    return JSON.parse(fileContent.replace(/^\uFEFF/, '')) as unknown;
  } catch {
    throw new Error(`El archivo no contiene un JSON valido: ${filePath}`);
  }
}

export function formatPersistedFormativeProfileSummary(
  response: CurrentProfileResponseDto,
  artifact: FormativeProfileResultArtifact
): string {
  const profile = response.currentProfile;
  if (!profile) {
    throw new Error('La persistencia no devolvio un perfil current.');
  }

  return JSON.stringify(
    {
      id: profile.id,
      userId: response.userId,
      profileVersion: profile.profileVersion,
      generationMethod: FORMATIVE_PROFILE_AI_GENERATION_METHOD,
      artifactCount: artifact.generatedFrom.artifactCount,
      areasCount: artifact.areas.length,
      skillsCount: artifact.skills.length,
      conceptsCount: artifact.concepts.length,
      warningsCount: artifact.warnings.length,
      isCurrent: profile.isCurrent,
      artifactCountMeaning:
        'source semantic_analysis_v1 artifacts; not completed credentials',
      sourceOwnershipValidation:
        'not_available_in_formative_profile_result_v0'
    },
    null,
    2
  );
}

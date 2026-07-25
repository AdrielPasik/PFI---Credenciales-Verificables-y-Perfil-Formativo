import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';
import { FormativeProfileService } from '../formative-profile.service';
import { validateFormativeProfileResultArtifact } from '../formative-profile-result-artifact.validator';
import {
  formatPersistedFormativeProfileSummary,
  parseProfileIngestFileArgs,
  readProfileArtifactJson
} from './ingest-formative-profile-file.utils';

async function main() {
  const { userId, filePath } = parseProfileIngestFileArgs(
    process.argv.slice(2)
  );
  const parsedArtifact = await readProfileArtifactJson(filePath);
  const artifact = validateFormativeProfileResultArtifact(parsedArtifact);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn']
  });

  try {
    const profileService = app.get(FormativeProfileService);
    const persisted = await profileService.persistAiArtifactForUser(
      userId,
      artifact
    );

    console.log('Formative profile artifact persisted successfully.');
    console.log(
      formatPersistedFormativeProfileSummary(persisted, artifact)
    );
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error('Formative profile ingestion failed.');
  console.error(getErrorMessage(error));
  process.exitCode = 1;
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

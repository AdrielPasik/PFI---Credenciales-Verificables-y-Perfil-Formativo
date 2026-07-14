import { readFile } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';
import { SemanticService } from '../semantic.service';
import {
  formatPersistedSemanticAnalysisSummary,
  parseSemanticIngestFileArgs
} from './ingest-semantic-analysis-file.utils';

async function main() {
  const { credentialId, filePath } = parseSemanticIngestFileArgs(
    process.argv.slice(2)
  );

  await assertReadableFile(filePath);
  const artifact = await readArtifactJson(filePath);

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn']
  });

  try {
    const semanticService = app.get(SemanticService);
    const persisted = await semanticService.persistForCredential(
      credentialId,
      artifact
    );

    console.log('Semantic analysis persisted successfully.');
    console.log(formatPersistedSemanticAnalysisSummary(persisted));
  } finally {
    await app.close();
  }
}

async function assertReadableFile(filePath: string) {
  try {
    await access(filePath, fsConstants.F_OK | fsConstants.R_OK);
  } catch {
    throw new Error(`No existe o no puede leerse el archivo: ${filePath}`);
  }
}

async function readArtifactJson(filePath: string) {
  const fileContent = await readFile(filePath, 'utf8');

  try {
    return JSON.parse(fileContent) as unknown;
  } catch {
    throw new Error(`El archivo no contiene un JSON valido: ${filePath}`);
  }
}

void main().catch((error: unknown) => {
  console.error('Semantic ingestion failed.');
  console.error(getErrorMessage(error));
  process.exitCode = 1;
});

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

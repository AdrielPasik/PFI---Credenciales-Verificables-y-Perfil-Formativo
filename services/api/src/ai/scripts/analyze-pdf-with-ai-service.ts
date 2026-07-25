import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';
import { AiIntegrationService } from '../ai-integration.service';
import {
  formatAnalyzePdfSummary,
  getScriptErrorMessage,
  parseAnalyzePdfScriptArgs
} from './ai-script.utils';

async function main() {
  const args = parseAnalyzePdfScriptArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn']
  });

  try {
    const integration = app.get(AiIntegrationService);
    const result = await integration.analyzePdf(args);
    console.log(
      formatAnalyzePdfSummary(result.artifact, result.persisted)
    );
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error('AI PDF analysis failed.');
  console.error(getScriptErrorMessage(error));
  process.exitCode = 1;
});

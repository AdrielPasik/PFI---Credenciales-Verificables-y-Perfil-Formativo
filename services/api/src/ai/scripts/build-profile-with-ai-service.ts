import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';
import { AiIntegrationService } from '../ai-integration.service';
import {
  formatBuildProfileSummary,
  getScriptErrorMessage,
  parseBuildProfileScriptArgs
} from './ai-script.utils';

async function main() {
  const args = parseBuildProfileScriptArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn']
  });

  try {
    const integration = app.get(AiIntegrationService);
    const result = await integration.buildProfileForUser(
      args.userId,
      args.credentialIds
    );
    console.log(
      formatBuildProfileSummary(
        result.artifact,
        result.persisted,
        result.credentialIds
      )
    );
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error('AI formative profile build failed.');
  console.error(getScriptErrorMessage(error));
  process.exitCode = 1;
});

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../../app.module';
import { AiServiceClient } from '../ai-service.client';
import { getScriptErrorMessage } from './ai-script.utils';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn']
  });

  try {
    const client = app.get(AiServiceClient);
    const health = await client.getHealth();
    console.log(JSON.stringify(health, null, 2));
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error('AI Service health check failed.');
  console.error(getScriptErrorMessage(error));
  process.exitCode = 1;
});

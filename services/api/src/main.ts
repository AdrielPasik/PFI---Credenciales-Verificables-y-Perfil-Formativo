import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { resolveWebCorsOptions } from './config/web-cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  const webCorsOptions = resolveWebCorsOptions(process.env.WEB_ORIGIN);

  if (webCorsOptions) {
    app.enableCors(webCorsOptions);
  }

  await app.listen(port);
}

void bootstrap();

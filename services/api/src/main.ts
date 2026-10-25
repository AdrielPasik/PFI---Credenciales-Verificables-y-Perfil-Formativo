import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import {
  applyTrustProxy,
  resolveTrustProxyHops
} from './auth/trust-proxy.config';
import { resolveWebCorsOptions } from './config/web-cors';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = Number(process.env.PORT ?? 3000);
  const webCorsOptions = resolveWebCorsOptions(process.env.WEB_ORIGIN);

  // Politica de proxy confiable (ver `auth/trust-proxy.config.ts`). Por defecto 0:
  // no se confia en ningun encabezado. En AWS se fija en 1 (el ALB).
  applyTrustProxy(app, resolveTrustProxyHops(process.env));

  // Cierre ordenado: ante SIGTERM/SIGINT Nest ejecuta los hooks de destruccion.
  // Hoy hay dos: `BackgroundTaskRunner` (deja de aceptar trabajo y espera a los
  // envios de correo en vuelo) y `PrismaService` ($disconnect). Se llama UNA vez: el
  // API no registra ningun otro handler de senales. NO vuelve duradera la entrega:
  // ante SIGKILL u OOM el trabajo en vuelo se pierde igual.
  app.enableShutdownHooks();

  if (webCorsOptions) {
    app.enableCors(webCorsOptions);
  }

  await app.listen(port);
}

void bootstrap();

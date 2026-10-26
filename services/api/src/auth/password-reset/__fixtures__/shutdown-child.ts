/**
 * Proceso hijo para probar el cierre ordenado ante una senal REAL (o su emision).
 *
 * Replica el cableado de `main.ts` que importa: `enableShutdownHooks()` una sola vez,
 * un `BackgroundTaskRunner` real y, en un modulo global aparte (como `PrismaModule`),
 * un proveedor con `onModuleDestroy` que imprime cuando "se desconecta la base".
 *
 * Imprime una linea `EVENT <nombre>` por hito para que el padre compruebe el ORDEN.
 *
 * Variables:
 *   TASK_MS      duracion del trabajo en vuelo (default 400)
 *   TASK_STUCK   "1" => el trabajo nunca termina (para probar el tope de drenaje)
 *   DRAIN_MS     tope de drenaje del runner
 *   SELF_SIGNAL  "1" => el propio proceso emite SIGTERM a los 80 ms (portable a Windows)
 */

import 'reflect-metadata';

import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import {
  BACKGROUND_DRAIN_TIMEOUT,
  BackgroundTaskRunner
} from '../background-task-runner';

const say = (event: string) => process.stdout.write(`EVENT ${event}\n`);

@Injectable()
class FakeDatabase implements OnModuleDestroy {
  onModuleDestroy() {
    say('prisma-disconnect');
  }
}

@Global()
@Module({
  providers: [FakeDatabase],
  exports: [FakeDatabase]
})
class FakeDatabaseModule {}

@Module({
  imports: [FakeDatabaseModule],
  providers: [
    BackgroundTaskRunner,
    ...(process.env.DRAIN_MS
      ? [{ provide: BACKGROUND_DRAIN_TIMEOUT, useValue: Number(process.env.DRAIN_MS) }]
      : [])
  ]
})
class ChildModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(ChildModule, { logger: false });

  // Igual que main.ts: una sola vez.
  app.enableShutdownHooks();

  const runner = app.get(BackgroundTaskRunner);
  say(`ready sigterm-listeners=${process.listenerCount('SIGTERM')}`);

  runner.run('slow-send', async () => {
    say('task-started');
    if (process.env.TASK_STUCK === '1') {
      await new Promise<never>(() => undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.TASK_MS ?? 400)));
    say('task-finished');
  });

  if (process.env.SELF_SIGNAL === '1') {
    setTimeout(() => {
      say('signal-sent');
      process.emit('SIGTERM');
    }, 80);
  }

  // Mantiene vivo el proceso hasta recibir la senal.
  setInterval(() => undefined, 1_000);
}

void main();

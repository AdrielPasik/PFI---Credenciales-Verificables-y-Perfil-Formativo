/**
 * Cierre ordenado de NestJS (16.6): drenaje, rechazo de trabajo nuevo, tope de espera,
 * ausencia de promesas colgadas y orden respecto de la desconexion de la base.
 *
 *   A. Dentro del proceso, con un servidor Nest REAL: lo que `app.close()` hace.
 *   B. En procesos hijos aislados: lo que hace una SENAL, y lo que NO hace `SIGKILL`.
 *
 * LO QUE ESTOS TESTS NO PRUEBAN, A PROPOSITO. Habilitar los hooks no vuelve duradera la
 * entrega. El test `SIGKILL` documenta la limitacion con un hecho observable: el
 * trabajo en vuelo se pierde sin dejar rastro.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { BackgroundTaskRunner } from './background-task-runner';
import { startApp } from './__fixtures__/nest-app';
import {
  configureRecoveryEnv,
  installLogCapture
} from './__fixtures__/recovery-harness';

configureRecoveryEnv();
const logs = installLogCapture();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const unhandled: unknown[] = [];
process.on('unhandledRejection', (reason) => unhandled.push(reason));

// ---------------------------------------------------------------------------
// A. Dentro del proceso
// ---------------------------------------------------------------------------

test('57-58. app.close() waits for an in-flight task and the task finishes BEFORE the database disconnects', async () => {
  const server = await startApp({ drainTimeoutMs: 2_000 });
  server.tasks.run('send', async () => {
    server.lifecycle.push('task-start');
    await sleep(150);
    server.lifecycle.push('task-done');
  });
  await sleep(20); // deja que arranque

  await server.app.close();

  // El orden REAL que impone Nest: el runner drena antes de que Prisma se desconecte.
  // Si fuera al reves, el envio en vuelo fallaria contra una base cerrada.
  assert.deepEqual(server.lifecycle, [
    'task-start',
    'runner-drain-start',
    'task-done',
    'runner-drain-end',
    'prisma-disconnect'
  ]);
});

test('58b. the drain is visible in the logs: started, then completed', async () => {
  const start = logs.length;
  const server = await startApp({ drainTimeoutMs: 2_000 });
  server.tasks.run('send', async () => sleep(60));
  await sleep(10);

  await server.app.close();

  const written = logs.slice(start).join('\n');
  assert.match(written, /drain\.started \(1 in flight, up to 2000ms\)/);
  assert.match(written, /drain\.completed/);
  assert.doesNotMatch(written, /drain\.timeout/);
});

test('an idle runner closes immediately and logs nothing about draining', async () => {
  const start = logs.length;
  const server = await startApp({ drainTimeoutMs: 2_000 });
  const began = Date.now();

  await server.app.close();

  assert.ok(Date.now() - began < 1_000);
  assert.doesNotMatch(logs.slice(start).join('\n'), /drain\./);
  assert.equal(server.tasks.isClosing, true);
});

test('60. once closing starts, NEW work is refused (and logged), never executed', async () => {
  const start = logs.length;
  const server = await startApp({ drainTimeoutMs: 2_000 });
  let lateRan = false;
  server.tasks.run('first', async () => sleep(150));
  await sleep(10);

  const closing = server.app.close();
  await sleep(20); // el cierre ya empezo y espera al primer trabajo
  assert.equal(server.tasks.isClosing, true);
  server.tasks.run('late', async () => {
    lateRan = true;
  });
  await closing;

  assert.equal(lateRan, false, 'un trabajo aceptado tarde quedaria a medio hacer');
  assert.match(logs.slice(start).join('\n'), /late dropped \(shutting down\)/);
});

test('60b. a recovery request that lands DURING the drain gets a 503, not a 202 that would be discarded', async () => {
  const server = await startApp({ mailTransport: 'log', drainTimeoutMs: 2_000 });
  await server.world.seedUser({ email: 'ada@example.com' });
  const start = logs.length;
  server.tasks.run('first', async () => sleep(250));
  await sleep(10);

  const closing = server.app.close();
  await sleep(30);
  // Nest cierra el servidor HTTP DESPUES de los hooks de destruccion: sigue escuchando.
  const response = await server.post('/auth/password-reset/request', { email: 'ada@example.com' });
  await closing;

  assert.equal(response.status, 503);
  assert.equal(response.json!.code, 'PASSWORD_RECOVERY_UNAVAILABLE');
  assert.equal(server.world.state.tokens.length, 0, 'no se emitio un token que nadie va a poder usar');
  assert.match(logs.slice(start).join('\n'), /recovery\.unavailable \(shutting_down\)/);
});

test('59. the drain timeout works: a stuck task cannot block shutdown forever', async () => {
  const start = logs.length;
  const server = await startApp({ drainTimeoutMs: 80 });
  server.tasks.run('stuck', () => new Promise<void>(() => undefined));
  await sleep(10);
  const began = Date.now();

  await server.app.close();

  assert.ok(Date.now() - began < 2_000, 'el cierre no espero indefinidamente');
  assert.equal(server.tasks.pending, 1, 'el trabajo atascado sigue en vuelo: se perdera con el proceso');
  assert.match(logs.slice(start).join('\n'), /drain\.timeout \(1 still running after 80ms; they may be lost\)/);
  // Aun asi la base se desconecta: el cierre sigue su curso.
  assert.deepEqual(server.lifecycle.slice(-2), ['runner-drain-end', 'prisma-disconnect']);
});

test('61. a failing task neither blocks the drain nor leaves an unhandled rejection', async () => {
  const rejectionsBefore = unhandled.length;
  const server = await startApp({ drainTimeoutMs: 2_000 });
  server.tasks.run('boom-async', async () => {
    throw new Error('async failure');
  });
  server.tasks.run('boom-sync', () => {
    throw new Error('sync failure');
  });
  server.tasks.run('fine', async () => sleep(40));
  await sleep(5);

  await server.app.close();
  await sleep(20);

  assert.equal(unhandled.length, rejectionsBefore);
  assert.equal(server.tasks.pending, 0);
});

test('onModuleDestroy is safe to call twice (a repeated close does not break the runner)', async () => {
  const runner = new BackgroundTaskRunner(100);

  await runner.onModuleDestroy();
  await runner.onModuleDestroy();

  assert.equal(runner.isClosing, true);
  assert.equal(runner.pending, 0);
});

test('the default drain timeout stays well under the ECS stopTimeout of 120 seconds', () => {
  const limits = readFileSync(join(__dirname, 'password-reset.limits.ts'), 'utf8');
  const drain = /BACKGROUND_DRAIN_TIMEOUT_MS = (\d+) \* 1000/.exec(limits);
  const ecs = readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', 'infra', 'terraform', 'prod', 'ecs.tf'),
    'utf8'
  );
  const stopTimeout = /stopTimeout = (\d+)/.exec(ecs);

  assert.ok(drain && stopTimeout, 'ambos valores existen');
  assert.ok(Number(drain[1]) < Number(stopTimeout[1]), `${drain[1]} s < ${stopTimeout[1]} s`);
});

// ---------------------------------------------------------------------------
// B. Procesos hijos aislados
// ---------------------------------------------------------------------------

const API_ROOT = join(__dirname, '..', '..', '..');
const CHILD = join(__dirname, '__fixtures__', 'shutdown-child.ts');

interface ChildRun {
  events: string[];
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

/** Lanza el hijo; `act` decide como se le termina (senal propia, SIGTERM, SIGKILL). */
function runChild(
  env: Record<string, string>,
  act?: (child: ReturnType<typeof spawn>, wait: (event: RegExp) => Promise<void>) => Promise<void>
): Promise<ChildRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--require', 'ts-node/register/transpile-only', '--require', 'reflect-metadata', CHILD],
      { cwd: API_ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const events: string[] = [];
    const waiters: Array<{ pattern: RegExp; resolve: () => void }> = [];
    let buffer = '';
    let stderr = '';

    child.stdout!.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.startsWith('EVENT ')) {
          events.push(line.slice(6));
          for (const waiter of waiters.splice(0)) {
            if (waiter.pattern.test(line)) waiter.resolve();
            else waiters.push(waiter);
          }
        }
      }
    });
    child.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`el hijo no termino a tiempo; eventos: ${events.join(' | ')}; stderr: ${stderr.slice(0, 300)}`));
    }, 40_000);

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ events, code, signal, stderr });
    });
    child.on('error', reject);

    const wait = (pattern: RegExp) =>
      new Promise<void>((done) => {
        if (events.some((event) => pattern.test(`EVENT ${event}`))) done();
        else waiters.push({ pattern, resolve: done });
      });

    void (act ? act(child, wait) : Promise.resolve());
  });
}

test('57c. a termination signal drains the in-flight task BEFORE the database disconnects (real child process)', async () => {
  // El hijo emite SIGTERM sobre si mismo: el listener que registro
  // `enableShutdownHooks()` ejecuta el mismo camino que una senal del sistema, y es
  // portable a Windows (donde `kill('SIGTERM')` mata sin ejecutar handlers).
  const run = await runChild({ SELF_SIGNAL: '1', TASK_MS: '500' });

  const names = run.events.map((event) => event.split(' ')[0]);
  assert.deepEqual(names, ['ready', 'task-started', 'signal-sent', 'task-finished', 'prisma-disconnect']);
  assert.match(run.events[0], /sigterm-listeners=1$/, 'un solo handler de SIGTERM: sin duplicados');
});

test('57d. a REAL SIGTERM from outside is handled the same way (POSIX only)', { skip: process.platform === 'win32' ? 'Windows no entrega SIGTERM a los handlers de Node: kill() termina el proceso sin cierre ordenado' : false }, async () => {
  const run = await runChild({ TASK_MS: '500' }, async (child, wait) => {
    await wait(/task-started/);
    child.kill('SIGTERM');
  });

  const names = run.events.map((event) => event.split(' ')[0]);
  assert.deepEqual(names, ['ready', 'task-started', 'task-finished', 'prisma-disconnect']);
});

test('59b. under a signal, a stuck task is abandoned after the drain timeout and the process still shuts down', async () => {
  const began = Date.now();
  const run = await runChild({ SELF_SIGNAL: '1', TASK_STUCK: '1', DRAIN_MS: '300' });

  const names = run.events.map((event) => event.split(' ')[0]);
  assert.deepEqual(names, ['ready', 'task-started', 'signal-sent', 'prisma-disconnect']);
  assert.ok(!names.includes('task-finished'));
  assert.ok(Date.now() - began < 30_000);
});

test('LIMITATION: SIGKILL loses the in-flight task silently -- shutdown hooks do NOT make delivery durable', async () => {
  const run = await runChild({ TASK_MS: '3000' }, async (child, wait) => {
    await wait(/task-started/);
    child.kill('SIGKILL');
  });

  const names = run.events.map((event) => event.split(' ')[0]);
  // El trabajo empezo y NUNCA termino; la base ni siquiera "se desconecto": no hubo
  // ningun cierre. Es la perdida que la entrega best-effort acepta, y que solo una
  // cola duradera cerraria.
  assert.deepEqual(names, ['ready', 'task-started']);
  assert.ok(run.signal === 'SIGKILL' || run.code !== 0, 'el proceso murio abruptamente');
});

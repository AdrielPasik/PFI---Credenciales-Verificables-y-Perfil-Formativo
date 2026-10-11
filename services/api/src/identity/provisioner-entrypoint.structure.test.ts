/**
 * Guards del execution gate de provisioning inicial -- S8c11.4a.
 *
 * El entrypoint es una SUPERFICIE DE COMANDO RESTRINGIDA, no una autorizacion ni
 * un sandbox. Estos tests congelan lo que SI garantiza -- una unica operacion,
 * argumentos fijos, prefijo de signers forzado, delegacion por argv a la CLI
 * existente -- y prueban que una entrada rechazada JAMAS llega a iniciar la CLI.
 *
 * Todo lo estructural se afirma sobre el CODIGO EJECUTABLE del script, sin
 * comentarios: los comentarios nombran a proposito lo que esta prohibido.
 *
 * Los tests de comportamiento reemplazan `node` por un doble en el PATH que, si
 * se invocara, lo delata en la salida. Solo se ejecutan entradas que el script
 * rechaza ANTES de delegar: no hay ningun caso valido que pueda llegar al
 * provisioning real, ni a AWS, SSM o PostgreSQL.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';

const API_ROOT = join(__dirname, '..', '..');
const SCRIPT_PATH = join(API_ROOT, 'docker', 'provisioner-entrypoint.sh');
const COMPILED_CLI = 'dist/identity/scripts/technical-identity-cli.js';
const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';
const SHIM_MARKER = 'NODE_SHIM_WAS_INVOKED';

function rawScript(): string {
  return readFileSync(SCRIPT_PATH, 'utf8');
}

/** Codigo ejecutable: sin la linea de shebang ni comentarios. */
function executable(): string {
  return rawScript()
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
}

// ---------------------------------------------------------------------------
// ESTRUCTURA
// ---------------------------------------------------------------------------

test('1: el entrypoint existe, es POSIX sh y usa LF', () => {
  const text = rawScript();
  assert.ok(text.startsWith('#!/bin/sh\n'));
  assert.ok(!text.includes('\r'), 'sin CRLF');
  assert.match(executable(), /^set -eu$/m);
});

test('2-5: admite una unica operacion literal y ninguna de las otras', () => {
  const code = executable();
  assert.match(code, /\[ "\$1" = "provision" \]/);
  assert.match(code, /\[ "\$#" -eq 5 \]/);

  // Ninguna otra operacion aparece en codigo ejecutable.
  for (const forbidden of [
    'rotate-assertion',
    'rotate-anchor',
    'rotate',
    'bootstrap-platform-admin',
    'bootstrap'
  ]) {
    assert.ok(!code.includes(forbidden), forbidden);
  }
});

test('6: el prefijo de signers esta FIJADO a /scope/prod/signers/ y exportado', () => {
  const code = executable();
  const assignments = code.match(/^SIGNER_SECRET_REF_PREFIX=.*$/gm) ?? [];
  assert.deepEqual(assignments, ['SIGNER_SECRET_REF_PREFIX="/scope/prod/signers/"']);
  assert.match(code, /^export SIGNER_SECRET_REF_PREFIX$/m);
  // No hay forma de recibirlo: ni como argumento ni leido de un valor externo.
  assert.ok(!/SIGNER_SECRET_REF_PREFIX=.*\$/.test(code));
});

test('7-10: sin eval, sin sh -c, sin npm, sin --env-file, sin PRIVATE_KEY', () => {
  const code = executable();
  assert.ok(!/\beval\b/.test(code));
  assert.ok(!/\bsh\s+-c\b/.test(code));
  assert.ok(!/\bbash\b/.test(code));
  assert.ok(!/\bsource\b|^\s*\.\s/m.test(code));
  assert.ok(!/\bnpm\b|\bnpx\b/.test(code));
  assert.ok(!code.includes('--env-file'));
  assert.ok(!code.includes('PRIVATE_KEY'));
});

test('11, 15: no acepta database-url, rpc-url, claves ni shared-anchor', () => {
  const code = executable();
  for (const forbidden of [
    '--database-url',
    '--rpc-url',
    '--private-key',
    '--key',
    '--passphrase',
    '--secret-prefix',
    '--secret-ref',
    '--shared-anchor'
  ]) {
    assert.ok(!code.includes(forbidden), forbidden);
  }

  // Los unicos flags que reconoce son los dos de la forma fija.
  const flags = [...new Set(code.match(/"--[a-z-]+"/g) ?? [])].sort();
  assert.deepEqual(flags, ['"--issuer"', '"--types"']);
});

test('12: delega en la CLI COMPILADA existente, por argv, una sola vez y al final', () => {
  const code = executable();
  const execs = code.match(/^exec .*$/gm) ?? [];
  assert.deepEqual(execs, [
    `exec node -r reflect-metadata ${COMPILED_CLI} provision --issuer "$3" --types "$5"`
  ]);

  // Todo rechazo ocurre antes de la delegacion.
  const execIndex = code.indexOf('exec node');
  const lastReject = code.lastIndexOf('reject ');
  assert.ok(lastReject !== -1 && lastReject < execIndex);
  assert.equal(code.trimEnd().split('\n').at(-1)?.startsWith('exec node'), true);

  // El ejecutable referenciado es la salida real de `tsc -p tsconfig.build.json`
  // (rootDir ./src -> dist/identity/scripts/...): su fuente existe.
  readFileSync(
    join(API_ROOT, 'src', 'identity', 'scripts', 'technical-identity-cli.ts'),
    'utf8'
  );
  assert.ok(!code.includes('ts-node'));
});

test('13-14: exige issuer UUID y types no vacio con alfabeto restringido', () => {
  const code = executable();
  assert.match(code, /HEX='\[0-9a-fA-F\]'/);
  assert.match(code, /\$HEX\$HEX\$HEX\$HEX\$HEX\$HEX\$HEX\$HEX-/);
  assert.match(code, /"" \| \*\[!A-Za-z0-9_,\]\* \| ,\* \| \*, \| \*,,\*\)/);
});

test('16-17: nunca imprime DATABASE_URL ni vuelca el entorno ni los argumentos', () => {
  const code = executable();
  assert.ok(!/set\s+-[a-z]*x/.test(code), 'sin set -x');
  assert.ok(!/\benv\b|\bprintenv\b|\bexport\s*$/m.test(code));
  assert.ok(!/printf/.test(code));
  assert.ok(!code.includes('echo "$DATABASE_URL"'));

  // La unica salida es `reject`, que imprime SU primer argumento: un literal
  // fijo (se comprueba abajo en cada llamada), nunca un argumento del script.
  const echoes = code.match(/echo .*/g) ?? [];
  assert.deepEqual(echoes, ['echo "$1" >&2']);
  assert.match(code, /reject\(\) \{\n  echo "\$1" >&2\n  exit "\$2"\n\}/);
  for (const call of code.match(/reject "[^"]*"/g) ?? []) {
    assert.ok(!/\$/.test(call), `mensaje con expansion: ${call}`);
  }
});

test('el entorno exigido es exactamente el de la CLI y solo se nombran variables', () => {
  const code = executable();
  const required = [...code.matchAll(/\[ -n "\$\{(\w+):-\}" \]/g)].map((m) => m[1]);
  assert.deepEqual(required, ['DATABASE_URL', 'PUBLIC_DID_BASE_URL', 'AWS_REGION']);
});

test('se invoca con /bin/sh: el Dockerfile no necesita cambios para ejecutarlo', () => {
  const dockerfile = readFileSync(join(API_ROOT, 'Dockerfile'), 'utf8');
  assert.ok(!dockerfile.includes('provisioner-entrypoint'));
  assert.ok(rawScript().includes('"/bin/sh", "/app/services/api/docker/provisioner-entrypoint.sh"'));
});

test('la sintaxis es valida para sh (sin ejecutarlo)', (t) => {
  const result = spawnSync('sh', ['-n', SCRIPT_PATH], { encoding: 'utf8' });
  if (result.error) {
    t.skip('sh no esta disponible en este entorno');
    return;
  }
  assert.equal(result.status, 0, result.stderr);
});

// ---------------------------------------------------------------------------
// COMPORTAMIENTO: lo rechazado NO llega a la CLI
// ---------------------------------------------------------------------------

function runGate(
  args: readonly string[],
  extraEnvironment: Record<string, string> = {}
): { skipped: boolean; status: number | null; output: string } {
  const shimDirectory = mkdtempSync(join(tmpdir(), 'provisioner-gate-'));

  try {
    // Doble de `node`: si el script lo ejecutara, la salida lo delata.
    const shim = join(shimDirectory, 'node');
    writeFileSync(shim, `#!/bin/sh\necho ${SHIM_MARKER}\nexit 97\n`);
    chmodSync(shim, 0o755);

    const result = spawnSync('sh', [SCRIPT_PATH, ...args], {
      encoding: 'utf8',
      env: {
        PATH: `${shimDirectory.replace(/\\/g, '/')}${delimiter}${process.env.PATH ?? ''}`,
        ...extraEnvironment
      }
    });

    if (result.error) {
      return { skipped: true, status: null, output: '' };
    }

    return {
      skipped: false,
      status: result.status,
      output: `${result.stdout}${result.stderr}`
    };
  } finally {
    rmSync(shimDirectory, { recursive: true, force: true });
  }
}

const SENTINEL = 'SENTINEL-DO-NOT-ECHO';

const REJECTED_INPUTS: ReadonlyArray<{ name: string; args: string[] }> = [
  { name: 'sin argumentos', args: [] },
  { name: 'rotate-assertion', args: ['rotate-assertion', '--issuer', VALID_UUID, '--types', 'course'] },
  { name: 'rotate-anchor', args: ['rotate-anchor', '--issuer', VALID_UUID] },
  { name: 'bootstrap-platform-admin', args: ['bootstrap-platform-admin', '--email', 'a@b.co'] },
  { name: 'un shell', args: ['sh'] },
  { name: 'node arbitrario', args: ['node', '-e', `console.log("${SENTINEL}")`] },
  { name: 'npm arbitrario', args: ['npm', 'run', 'x'] },
  { name: 'un comando libre', args: [`provision; echo ${SENTINEL}`] },
  { name: 'shared-anchor', args: ['provision', '--issuer', VALID_UUID, '--types', 'course', '--shared-anchor', SENTINEL] },
  { name: 'faltan los types', args: ['provision', '--issuer', VALID_UUID] },
  { name: 'argumento de mas', args: ['provision', '--issuer', VALID_UUID, '--types', 'course', SENTINEL] },
  { name: 'orden de flags invertido', args: ['provision', '--types', 'course', '--issuer', VALID_UUID] },
  { name: 'flag desconocido', args: ['provision', '--issuer', VALID_UUID, '--database-url', SENTINEL] },
  { name: 'flag de clave privada', args: ['provision', '--private-key', SENTINEL, '--types', 'course'] },
  { name: 'issuer que no es UUID', args: ['provision', '--issuer', SENTINEL, '--types', 'course'] },
  { name: 'issuer con inyeccion', args: ['provision', '--issuer', `${VALID_UUID};id`, '--types', 'course'] },
  { name: 'issuer UUID truncado', args: ['provision', '--issuer', VALID_UUID.slice(0, -1), '--types', 'course'] },
  { name: 'types vacio', args: ['provision', '--issuer', VALID_UUID, '--types', ''] },
  { name: 'types con espacios', args: ['provision', '--issuer', VALID_UUID, '--types', 'course degree'] },
  { name: 'types con sustitucion', args: ['provision', '--issuer', VALID_UUID, '--types', '$(id)'] },
  { name: 'types con coma al inicio', args: ['provision', '--issuer', VALID_UUID, '--types', ',course'] },
  { name: 'types con coma doble', args: ['provision', '--issuer', VALID_UUID, '--types', 'a,,b'] }
];

for (const { name, args } of REJECTED_INPUTS) {
  test(`negativo: ${name} se rechaza y NO inicia la CLI`, (t) => {
    const result = runGate(args, {
      // Aun con la configuracion completa presente, un comando invalido no avanza.
      DATABASE_URL: `postgresql://user:${SENTINEL}@invalid.example/db`,
      PUBLIC_DID_BASE_URL: 'https://example.invalid',
      AWS_REGION: 'us-east-1'
    });

    if (result.skipped) {
      t.skip('sh no esta disponible en este entorno');
      return;
    }

    assert.equal(result.status, 64);
    assert.ok(!result.output.includes(SHIM_MARKER), 'la CLI no debe iniciarse');
    assert.ok(!result.output.includes(SENTINEL), 'no se repite la entrada ni el secreto');
  });
}

for (const missing of ['DATABASE_URL', 'PUBLIC_DID_BASE_URL', 'AWS_REGION']) {
  test(`negativo: sin ${missing} falla cerrado, nombra solo la variable y NO inicia la CLI`, (t) => {
    const environment: Record<string, string> = {
      DATABASE_URL: `postgresql://user:${SENTINEL}@invalid.example/db`,
      PUBLIC_DID_BASE_URL: 'https://example.invalid',
      AWS_REGION: 'us-east-1'
    };
    delete environment[missing];

    const result = runGate(
      ['provision', '--issuer', VALID_UUID, '--types', 'course'],
      environment
    );

    if (result.skipped) {
      t.skip('sh no esta disponible en este entorno');
      return;
    }

    assert.equal(result.status, 78);
    assert.ok(result.output.includes(missing));
    assert.ok(!result.output.includes(SHIM_MARKER), 'la CLI no debe iniciarse');
    assert.ok(!result.output.includes(SENTINEL), 'DATABASE_URL nunca se imprime');
    assert.ok(!result.output.includes(VALID_UUID), 'los argumentos no se repiten');
  });
}

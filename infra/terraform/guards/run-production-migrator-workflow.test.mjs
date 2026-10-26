// Pruebas del workflow "Run production migrator": ejecutan los scripts reales de cada paso (extraidos del YAML)
// con un `aws` falso y el `jq` real. No usan AWS, red ni produccion.
// Requisitos: bash y jq en el PATH. Ejecutar: node --test infra/terraform/guards/run-production-migrator-workflow.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const WORKFLOW = path.join(ROOT, '.github', 'workflows', 'run-production-migrator.yml');
const source = fs.readFileSync(WORKFLOW, 'utf8').replace(/\r\n/g, '\n');
const posix = (p) => p.replace(/\\/g, '/');

const EXPECTED = '20261023120000_add_password_reset_token_and_session_version';
const TAG = '70b58be17e8b111c2631efe26da8954e2fa115fe';
const COMMON_ENV = {
  MIGRATOR_TASK_DEFINITION: 'scope-prod-migrator:9',
  MIGRATOR_IMAGE_TAG: TAG,
  EXPECTED_PENDING_MIGRATION: EXPECTED,
  GITHUB_REF: 'refs/heads/main',
  LOG_WAIT_SECONDS: '0',
};

// --- helpers -----------------------------------------------------------------------------------------

function stepScript(name) {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  assert.ok(start >= 0, `paso no encontrado: ${name}`);
  const runLine = lines.findIndex((l, i) => i > start && /^\s+run: \|\s*$/.test(l));
  assert.ok(runLine > start, `el paso ${name} no tiene run`);
  const indent = lines[runLine].match(/^\s*/)[0].length;
  const body = [];
  for (let i = runLine + 1; i < lines.length; i += 1) {
    if (lines[i].trim() !== '' && lines[i].match(/^\s*/)[0].length <= indent) break;
    body.push(lines[i].slice(indent + 2));
  }
  return body.join('\n');
}

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrator-wf-'));
  const bin = path.join(dir, 'bin');
  const fake = path.join(dir, 'fake');
  fs.mkdirSync(bin);
  fs.mkdirSync(fake);
  fs.writeFileSync(
    path.join(bin, 'aws'),
    `#!/bin/bash
echo "$*" >> "$FAKE_DIR/calls.log"
case "$1 $2" in
  "ecs describe-task-definition") cat "$FAKE_DIR/taskdef.json" ;;
  "ecs run-task") cat "$FAKE_DIR/run-task.json" ;;
  "ecs describe-tasks")
    if [[ "$*" == *"overrides"* ]]; then cat "$FAKE_DIR/overrides.json"; else cat "$FAKE_DIR/exit_code.txt"; fi ;;
  "ecs stop-task") echo '{}' ;;
  "ecs wait") ;;
  "logs get-log-events") cat "$FAKE_DIR/logs.json" ;;
  *) echo "unexpected aws call: $*" >&2; exit 99 ;;
esac
`,
    { mode: 0o755 },
  );
  return { dir, bin, fake, out: path.join(dir, 'github_output'), calls: path.join(fake, 'calls.log') };
}

function run(script, sandbox, env = {}) {
  const file = path.join(sandbox.dir, 'script.sh');
  fs.writeFileSync(file, script);
  fs.writeFileSync(sandbox.out, '');
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', posix(file)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ...COMMON_ENV,
      PATH: `${posix(sandbox.bin)}${path.delimiter}${process.env.PATH}`,
      FAKE_DIR: posix(sandbox.fake),
      GITHUB_OUTPUT: posix(sandbox.out),
      RUNNER_TEMP: posix(sandbox.dir),
      ...env,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    output: fs.readFileSync(sandbox.out, 'utf8'),
    calls: fs.existsSync(sandbox.calls) ? fs.readFileSync(sandbox.calls, 'utf8') : '',
  };
}

const sandboxes = [];
function sandbox() {
  const s = makeSandbox();
  sandboxes.push(s);
  return s;
}
test.after(() => {
  for (const s of sandboxes) fs.rmSync(s.dir, { recursive: true, force: true });
});

function resolveCommand(step, mutate = (s) => s) {
  const s = sandbox();
  const r = run(mutate(stepScript('Resolve migrator command')), s, { STEP: step });
  const match = r.output.match(/^command=(.*)$/m);
  return { ...r, command: match ? JSON.parse(match[1]) : null };
}

test('jq real disponible', () => {
  const r = spawnSync('bash', ['-c', 'jq --version'], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'jq debe estar instalado (no se acepta un simulador)');
  assert.match(r.stdout, /^jq-\d+\.\d+/);
});

// --- estructura y comandos existentes ------------------------------------------------------------------

test('los comandos de 01, migrate, 02, seed y verify no cambian', () => {
  const expected = {
    '01': ['psql', '-v', 'ON_ERROR_STOP=1', '-f', '/app/infra/terraform/sql/01-bootstrap-scope-app-role.sql'],
    migrate: ['npx', 'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
    '02': ['psql', '-v', 'ON_ERROR_STOP=1', '-f', '/app/infra/terraform/sql/02-grant-scope-app-on-existing-objects.sql'],
    seed: ['npm', 'run', 'db:seed'],
    verify: ['npm', 'run', 'db:verify-demo'],
  };
  for (const [step, command] of Object.entries(expected)) {
    assert.deepEqual(resolveCommand(step).command, command, `paso ${step}`);
  }
});

test('la task definition esta fija en :9 y se comprueba antes de lanzar', () => {
  assert.match(source, /MIGRATOR_TASK_DEFINITION: scope-prod-migrator:9\n/);
  assert.match(source, /MIGRATOR_IMAGE_TAG: 70b58be17e8b111c2631efe26da8954e2fa115fe\n/);
  assert.doesNotMatch(source, /--task-definition scope-prod-migrator\s/);
  assert.match(source, /--task-definition "\$MIGRATOR_TASK_DEFINITION"/);
  const order = ['Require dispatch from main', 'Configure AWS credentials', 'Verify pinned task definition', 'Resolve migrator command', 'Run migrator task'];
  const positions = order.map((n) => source.indexOf(`- name: ${n}`));
  assert.ok(positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1])), 'orden de los pasos');
  assert.doesNotMatch(source, /PROPUESTA|PROPOSAL/i);
});

test('exige el despacho desde main', () => {
  const script = stepScript('Require dispatch from main');
  assert.equal(run(script, sandbox(), { GITHUB_REF: 'refs/heads/main' }).status, 0);
  assert.notEqual(run(script, sandbox(), { GITHUB_REF: 'refs/heads/feature/x' }).status, 0);
  assert.notEqual(run(script, sandbox(), { GITHUB_REF: 'refs/tags/v1' }).status, 0);
});

// --- argumentos permitidos y rechazados ------------------------------------------------------------------

test('status resuelve exactamente prisma migrate status', () => {
  assert.deepEqual(resolveCommand('status').command, ['npx', 'prisma', 'migrate', 'status', '--schema', 'prisma/schema.prisma']);
});

test('un paso desconocido o vacio falla y no escribe comando', () => {
  for (const step of ['bogus', '', 'deploy', 'migrate;ls']) {
    const r = resolveCommand(step);
    assert.notEqual(r.status, 0, `paso "${step}"`);
    assert.equal(r.command, null);
  }
});

test('precheck: solo SELECT/SHOW tras -c, con la sesion en solo lectura primero', () => {
  const r = resolveCommand('precheck');
  assert.equal(r.status, 0, r.stderr);
  const cmd = r.command;
  assert.deepEqual(cmd.slice(0, 8), ['psql', '-X', '-q', '-A', '-t', '-x', '-v', 'ON_ERROR_STOP=1']);
  const rest = cmd.slice(8);
  assert.equal(rest.length % 2, 0);
  rest.forEach((arg, i) => {
    if (i % 2 === 0) assert.equal(arg, '-c');
  });
  const sql = rest.filter((_, i) => i % 2 === 1);
  assert.equal(sql[0], 'SET default_transaction_read_only = on');
  assert.equal(sql[1], 'SHOW default_transaction_read_only');
  for (const statement of sql.slice(1)) assert.match(statement, /^(SELECT|SHOW) /);
  for (const statement of sql) {
    assert.doesNotMatch(statement, /\b(INSERT\s+INTO|DELETE\s+FROM|ALTER\s+(TABLE|ROLE)|DROP\s+|CREATE\s+|GRANT\s+|REVOKE\s+|TRUNCATE\s+TABLE|COPY\s+|VACUUM)/i);
  }
  const joined = sql.join(' ');
  assert.match(joined, /FROM pg_stat_activity/);
  assert.doesNotMatch(joined, /left\(query|, query\b|\bquery AS\b|SELECT query\b/i, 'no publica pg_stat_activity.query');
  assert.doesNotMatch(joined, /AS pid\b|SELECT pid\b/i, 'no publica pids');
});

test('precheck: rechaza escrituras, construcciones peligrosas y estructura distinta', () => {
  const tamper = (from, to) => (script) => {
    assert.ok(script.includes(from), `no se encontro el fragmento a alterar: ${from}`);
    return script.replace(from, to);
  };
  const lastQuery = '"-c","SELECT count(*) AS prepared_xacts FROM pg_prepared_xacts"';
  const attacks = {
    update: tamper(lastQuery, '"-c","UPDATE public.\\"AuthCredential\\" SET \\"sessionVersion\\" = 1"'),
    insert: tamper(lastQuery, '"-c","INSERT INTO public._prisma_migrations DEFAULT VALUES"'),
    terminate: tamper(lastQuery, '"-c","SELECT pg_terminate_backend(1)"'),
    set_config: tamper(lastQuery, '"-c","SELECT set_config($$default_transaction_read_only$$, $$off$$, false)"'),
    into: tamper(lastQuery, '"-c","SELECT 1 INTO TEMP t"'),
    semicolon: tamper(lastQuery, '"-c","SELECT 1; DROP TABLE x"'),
    read_only_off: tamper('SET default_transaction_read_only = on', 'SET default_transaction_read_only = off'),
    file_flag: tamper('"-c","SHOW default_transaction_read_only"', '"-f","/etc/passwd"'),
    extra_flag: tamper('"-X","-q"', '"-X","-W","-q"'),
    odd_args: tamper(lastQuery, '"-c"'),
  };
  for (const [name, mutate] of Object.entries(attacks)) {
    const r = resolveCommand('precheck', mutate);
    assert.notEqual(r.status, 0, `debe rechazar: ${name}`);
    assert.equal(r.command, null, `no debe publicar el comando: ${name}`);
  }
});

test('solo el paso migrate puede resolver a prisma migrate deploy', () => {
  const mutate = (script) =>
    script.replace(
      `COMMAND='["npx","prisma","migrate","status","--schema","prisma/schema.prisma"]'`,
      `COMMAND='["npx","prisma","migrate","deploy","--schema","prisma/schema.prisma"]'`,
    );
  const r = resolveCommand('status', mutate);
  assert.notEqual(r.status, 0);
  assert.equal(r.command, null);
});

// --- task definition fija ---------------------------------------------------------------------------------

function taskdef(overrides = {}) {
  return {
    status: 'ACTIVE',
    family: 'scope-prod-migrator',
    revision: 9,
    image: `309490997821.dkr.ecr.us-east-1.amazonaws.com/scope/api:${TAG}`,
    entryPoint: ['/app/services/api/docker/migrator-entrypoint.sh'],
    ...overrides,
  };
}

test('verifica que :9 este ACTIVE y use la imagen esperada', () => {
  const script = stepScript('Verify pinned task definition');
  const check = (def) => {
    const s = sandbox();
    fs.writeFileSync(path.join(s.fake, 'taskdef.json'), JSON.stringify(def));
    return run(script, s);
  };
  assert.equal(check(taskdef()).status, 0);
  for (const bad of [
    taskdef({ status: 'INACTIVE' }),
    taskdef({ revision: 8 }),
    taskdef({ family: 'scope-prod-api' }),
    taskdef({ image: '309490997821.dkr.ecr.us-east-1.amazonaws.com/scope/api:d7335cb112fcf421b20660f520448fcb36ae651c' }),
    taskdef({ image: `309490997821.dkr.ecr.us-east-1.amazonaws.com/scope/other:${TAG}` }),
    taskdef({ entryPoint: ['/bin/sh'] }),
    taskdef({ entryPoint: null }),
  ]) {
    assert.notEqual(check(bad).status, 0, JSON.stringify(bad));
  }
});

// --- run-task ---------------------------------------------------------------------------------------------

const STATUS_COMMAND = ['npx', 'prisma', 'migrate', 'status', '--schema', 'prisma/schema.prisma'];
const TASK_ARN = 'arn:aws:ecs:us-east-1:309490997821:task/scope-prod-cluster/0123456789abcdef0123456789abcdef';

function runTask({ response, received }) {
  const s = sandbox();
  fs.writeFileSync(path.join(s.fake, 'run-task.json'), JSON.stringify(response));
  fs.writeFileSync(path.join(s.fake, 'overrides.json'), JSON.stringify(received));
  const r = run(stepScript('Run migrator task'), s, { COMMAND: JSON.stringify(STATUS_COMMAND) });
  return r;
}
const goodResponse = () => ({
  failures: [],
  tasks: [{ taskArn: TASK_ARN, taskDefinitionArn: 'arn:aws:ecs:us-east-1:309490997821:task-definition/scope-prod-migrator:9' }],
});

test('run-task: usa la task definition fija, exige una tarea real sin failures y verifica el override', () => {
  const r = runTask({ response: goodResponse(), received: STATUS_COMMAND });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.calls, /ecs run-task .*--task-definition scope-prod-migrator:9 /);
  assert.match(r.calls, /--count 1/);
  assert.match(r.output, new RegExp(`task_arn=${TASK_ARN}`));
  assert.doesNotMatch(r.calls, /stop-task/);
});

test('run-task: failures, ninguna tarea, varias tareas o revision distinta fallan', () => {
  const cases = {
    failures: { ...goodResponse(), failures: [{ arn: 'x', reason: 'MISSING' }] },
    sin_tareas: { failures: [], tasks: [] },
    dos_tareas: { failures: [], tasks: [goodResponse().tasks[0], goodResponse().tasks[0]] },
    revision_8: { failures: [], tasks: [{ taskArn: TASK_ARN, taskDefinitionArn: 'arn:aws:ecs:us-east-1:309490997821:task-definition/scope-prod-migrator:8' }] },
    familia_otra: { failures: [], tasks: [{ taskArn: TASK_ARN, taskDefinitionArn: 'arn:aws:ecs:us-east-1:309490997821:task-definition/scope-prod-api:9' }] },
  };
  for (const [name, response] of Object.entries(cases)) {
    const r = runTask({ response, received: STATUS_COMMAND });
    assert.notEqual(r.status, 0, name);
    assert.doesNotMatch(r.output, /task_arn=/, name);
  }
});

test('run-task: si ECS registra otro comando, detiene la tarea (deteccion)', () => {
  const r = runTask({ response: goodResponse(), received: ['npx', 'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'] });
  assert.notEqual(r.status, 0);
  assert.match(r.calls, /ecs stop-task .*--task .*0123456789abcdef/);
  const noOverride = runTask({ response: goodResponse(), received: null });
  assert.notEqual(noOverride.status, 0);
  assert.match(noOverride.calls, /stop-task/);
});

test('run-task: failures con tarea presente detiene esa tarea', () => {
  const response = { ...goodResponse(), failures: [{ arn: 'x', reason: 'RESOURCE:CPU' }] };
  const r = runTask({ response, received: STATUS_COMMAND });
  assert.notEqual(r.status, 0);
  assert.match(r.calls, /stop-task/);
});

test('run-task: rechaza overrides invalidos antes de llamar a ECS', () => {
  const s = sandbox();
  for (const command of ['[]', '[1]', 'null', '"x"', '']) {
    const r = run(stepScript('Run migrator task'), s, { COMMAND: command });
    assert.notEqual(r.status, 0, `COMMAND=${command}`);
    assert.doesNotMatch(r.calls, /run-task/);
  }
});

// --- espera y codigo de salida ----------------------------------------------------------------------------

function wait(step, exitCode) {
  const s = sandbox();
  fs.writeFileSync(path.join(s.fake, 'exit_code.txt'), `${exitCode}\n`);
  return run(stepScript('Wait for migrator'), s, { STEP: step, TASK_ARN });
}

test('espera: status tolera exit 0 y 1 (se clasifica despues); el resto de los pasos y codigos fallan', () => {
  assert.equal(wait('status', 0).status, 0);
  assert.equal(wait('status', 1).status, 0);
  assert.match(wait('status', 1).output, /exit_code=1/);
  for (const code of [2, 64, 137, 'None', '']) {
    assert.notEqual(wait('status', code).status, 0, `status con ${code}`);
  }
  for (const step of ['precheck', 'migrate', '01', '02', 'seed', 'verify']) {
    assert.equal(wait(step, 0).status, 0, `${step} 0`);
    assert.notEqual(wait(step, 1).status, 0, `${step} 1`);
  }
});

// --- clasificacion de status y sanitizacion de logs ------------------------------------------------------

const DATASOURCE = 'Datasource "db": PostgreSQL database "scope_app", schema "public" at "scope-prod-db.abc123xyz.us-east-1.rds.amazonaws.com:5432"';
const SECRETS = ['scope-prod-db', 'rds.amazonaws.com', 'Datasource', 'postgresql://', 'PGPASSWORD', 'hunter2', 'abc123xyz'];

function statusLogs(lines) {
  return JSON.stringify(lines);
}

function summarize(step, lines, exitCode) {
  const s = sandbox();
  fs.writeFileSync(path.join(s.fake, 'logs.json'), statusLogs(lines));
  const r = run(stepScript('Summarize read-only step'), s, { STEP: step, TASK_ARN, EXIT_CODE: String(exitCode) });
  return r;
}

function assertNoLeak(r) {
  const published = `${r.stdout}\n${r.stderr}\n${r.output}`;
  for (const secret of SECRETS) assert.ok(!published.includes(secret), `se publico: ${secret}`);
}

const header = ['Prisma schema loaded from prisma/schema.prisma', DATASOURCE, '', '25 migrations found in prisma/migrations', ''];

test('status: una unica migracion pendiente esperada con exit 1 es aceptada', () => {
  const lines = [...header, 'Following migration have not yet been applied:', EXPECTED, '', 'To apply migrations in development use prisma migrate dev; in production prisma migrate deploy', 'postgresql://scope_admin:hunter2@scope-prod-db.abc123xyz.us-east-1.rds.amazonaws.com:5432/scope_app'];
  const r = summarize('status', lines, 1);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /prisma_status=PENDING_EXPECTED/);
  assert.match(r.stdout, /migrations_found=25/);
  assert.match(r.stdout, /migrations_applied=24/);
  assert.match(r.stdout, /migrations_pending=1/);
  assert.match(r.stdout, new RegExp(`pending_migration=${EXPECTED}`));
  assertNoLeak(r);
});

test('status: al día con exit 0 es aceptado', () => {
  const r = summarize('status', [...header, 'Database schema is up to date!'], 0);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /prisma_status=UP_TO_DATE/);
  assert.match(r.stdout, /migrations_applied=25/);
  assertNoLeak(r);
});

test('status: falla cerrado ante cualquier otro resultado, sin publicar el log crudo', () => {
  const pending = (...names) => [...header, `Following migration${names.length > 1 ? 's' : ''} have not yet been applied:`, ...names, '', 'To apply migrations in development use prisma migrate dev'];
  const cases = {
    pendiente_otra: [pending('20261101000000_something_else'), 1, 'UNEXPECTED_PENDING'],
    pendiente_dos: [pending(EXPECTED, '20261101000000_something_else'), 1, 'UNEXPECTED_PENDING'],
    pendiente_nombre_invalido: [pending('not a migration name'), 1, 'UNCLASSIFIED'],
    pendiente_esperada_exit_0: [pending(EXPECTED), 0, 'UNCLASSIFIED'],
    pendiente_esperada_exit_2: [pending(EXPECTED), 2, 'UNCLASSIFIED'],
    conexion: [['Prisma schema loaded from prisma/schema.prisma', DATASOURCE, '', "Error: P1001: Can't reach database server at `scope-prod-db.abc123xyz.us-east-1.rds.amazonaws.com:5432`"], 1, 'CONNECTION_ERROR'],
    autenticacion: [['Error: P1000: Authentication failed against database server at scope-prod-db.abc123xyz.us-east-1.rds.amazonaws.com, the provided database credentials for `scope_admin` are not valid. password hunter2'], 1, 'CONNECTION_ERROR'],
    timeout: [['Error: P1002: The database server was reached but timed out'], 1, 'CONNECTION_ERROR'],
    migracion_fallida: [[...header, 'Following migration have failed:', EXPECTED, '', 'During development you can run prisma migrate dev to reset the database'], 1, 'FAILED_MIGRATION'],
    historial_divergente: [[...header, 'Your local migration history and the migrations table from your database are different:', '', 'The last common migration is: 20261012110000_x', 'The migration have not yet been applied:', EXPECTED], 1, 'DIVERGED_HISTORY'],
    migraciones_no_locales: [[...header, 'The migrations from the database are not found locally in prisma/migrations:', '20261001000000_unknown'], 1, 'DIVERGED_HISTORY'],
    otro_error: [['Error: Schema engine error: something else, PGPASSWORD=hunter2'], 1, 'OTHER_ERROR'],
    codigo_p3009: [['Error: P3009 migrate found failed migrations in the target database'], 1, 'FAILED_MIGRATION'],
    vacio: [[], 1, 'UNCLASSIFIED'],
    basura_exit_1: [['npm warn something', 'exit'], 1, 'UNCLASSIFIED'],
    al_dia_con_exit_1: [[...header, 'Database schema is up to date!'], 1, 'UNCLASSIFIED'],
    exit_0_sin_texto: [[...header], 0, 'UNCLASSIFIED'],
  };
  for (const [name, [lines, code, classification]] of Object.entries(cases)) {
    const r = summarize('status', lines, code);
    assert.notEqual(r.status, 0, `${name}: debe fallar cerrado`);
    assert.match(r.stdout, new RegExp(`prisma_status=${classification}`), `${name}: ${r.stdout}`);
    assert.match(r.stdout, /result=FAILED_CLOSED/, name);
    assertNoLeak(r);
  }
});

test('status: un exit 1 generico nunca se trata como exito', () => {
  for (const lines of [[], ['Error: boom'], [...header], ['Following migration have not yet been applied:', 'x']]) {
    assert.notEqual(summarize('status', lines, 1).status, 0, JSON.stringify(lines));
  }
});

test('status: solo publica codigos P#### con formato estricto', () => {
  const r = summarize('status', ['Error: P1001: unreachable at scope-prod-db.abc123xyz.us-east-1.rds.amazonaws.com'], 1);
  assert.match(r.stdout, /prisma_error_codes=P1001/);
  assertNoLeak(r);
});

// --- precheck: salida permitida --------------------------------------------------------------------------

const goodPrecheck = () => [
  'default_transaction_read_only|on',
  'server_version|16.13',
  'lock_timeout|0',
  'statement_timeout|0',
  'authcredential_table_exists|t',
  'user_table_exists|t',
  'prisma_migrations_table_exists|t',
  'tables_owned_by_current_user|3',
  'session_version_column|f',
  'password_reset_token_table|f',
  'migrations_total|24',
  'in_progress_or_failed|0',
  'last_migration|20261012110000_add_profile_embedding_v1_persistence',
  'scope_app_exists|t',
  'scope_app_can_login|t',
  'scope_app_superuser|f',
  'cred_select|t',
  'cred_update|t',
  'migrations_readable|f',
  'prt_select|',
  'prt_insert|',
  'prt_update|',
  'prt_delete|',
  'prt_truncate|',
  'open_transactions|0',
  'oldest_xact_seconds|0',
  'idle_in_transaction|0',
  'waiting_on_lock|0',
  'prepared_xacts|0',
];

test('precheck: publica solo claves permitidas con valores estrictos', () => {
  const noise = ['current_user|scope_admin', `host|scope-prod-db.abc123xyz.us-east-1.rds.amazonaws.com`, 'q|SELECT * FROM "User" WHERE password = $$hunter2$$', '', 'PGPASSWORD=hunter2'];
  const r = summarize('precheck', [...noise, ...goodPrecheck()], 0);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /default_transaction_read_only=on/);
  assert.match(r.stdout, /session_version_column=f/);
  assert.match(r.stdout, /password_reset_token_table=f/);
  assert.match(r.stdout, /migrations_total=24/);
  assert.match(r.stdout, /prt_select=null/);
  assert.match(r.stdout, /waiting_on_lock=0/);
  assert.doesNotMatch(r.stdout, /scope_admin|SELECT|^host|=\s*scope-prod/m);
  assertNoLeak(r);
});

test('precheck: faltan claves, valores inesperados, claves repetidas o sesion no read-only => falla cerrado', () => {
  const without = (key) => goodPrecheck().filter((l) => !l.startsWith(`${key}|`));
  const replace = (key, value) => goodPrecheck().map((l) => (l.startsWith(`${key}|`) ? `${key}|${value}` : l));
  const cases = {
    falta_clave: without('prepared_xacts'),
    valor_host: replace('last_migration', 'scope-prod-db.abc123xyz.us-east-1.rds.amazonaws.com'),
    valor_credencial: replace('server_version', 'postgresql://scope_admin:hunter2@host/db'),
    booleano_invalido: replace('session_version_column', 'maybe'),
    numero_invalido: replace('open_transactions', 'many'),
    repetida: [...goodPrecheck(), 'prepared_xacts|1'],
    no_read_only: replace('default_transaction_read_only', 'off'),
    vacio: [],
  };
  for (const [name, lines] of Object.entries(cases)) {
    const r = summarize('precheck', lines, 0);
    assert.notEqual(r.status, 0, name);
    assert.match(r.stdout, /result=FAILED_CLOSED/, name);
    assert.doesNotMatch(r.stdout, /prepared_xacts=|migrations_total=/, `${name}: no debe publicar parciales`);
    assertNoLeak(r);
  }
});

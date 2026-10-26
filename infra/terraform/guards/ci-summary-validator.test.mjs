// Prueba el validador del resumen de `node --test` que usa el workflow de CI con PostgreSQL.
// Node 22 (CI) imprime TAP ("# tests 16"); Node 24 imprime el resumen spec ("ℹ tests 16"). El validador
// acepta ambos y NADA mas: falla ante salida distinta de 0, resumen ausente/malformado/ambiguo, cero tests,
// fallos, omisiones o cancelaciones. Se ejecuta el codigo REAL extraido del workflow, con bash.
// Ejecutar: node --test infra/terraform/guards/ci-summary-validator.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = fs.readFileSync(path.join(HERE, '..', '..', '..', '.github', 'workflows', 'api-postgres-tests.yml'), 'utf8');

const BLOCKS = [...WORKFLOW.matchAll(/# --- summary validator \(begin\) ---\n([\s\S]*?)\n\s*# --- summary validator \(end\) ---/g)].map((m) =>
  m[1].split('\n').map((l) => l.replace(/^ {10}/, '')).join('\n')
);
const VALIDATOR = BLOCKS[0];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-summary-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const unix = (p) => p.replace(/\\/g, '/');
let n = 0;
function run(logText, status = '0') {
  const log = path.join(tmp, `log-${n++}.txt`);
  if (logText !== null) fs.writeFileSync(log, logText, 'utf8');
  const r = spawnSync('bash', ['-c', `set -e\n${VALIDATOR}\ncheck_node_test_summary "$LOG" "$STATUS"`], {
    env: { ...process.env, LOG: unix(log), STATUS: status },
    encoding: 'utf8'
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const tap = (o = {}) => {
  const c = { tests: 16, suites: 0, pass: 16, fail: 0, cancelled: 0, skipped: 0, todo: 0, ...o };
  return `TAP version 13\n# Subtest: a\nok 1 - a\n  ---\n  duration_ms: 1\n  ...\n1..${c.tests}\n# tests ${c.tests}\n# suites ${c.suites}\n# pass ${c.pass}\n# fail ${c.fail}\n# cancelled ${c.cancelled}\n# skipped ${c.skipped}\n# todo ${c.todo}\n# duration_ms 3366.5\n`;
};
const spec = (o = {}) => {
  const c = { tests: 16, suites: 0, pass: 16, fail: 0, cancelled: 0, skipped: 0, todo: 0, ...o };
  return `✔ a (1ms)\nℹ tests ${c.tests}\nℹ suites ${c.suites}\nℹ pass ${c.pass}\nℹ fail ${c.fail}\nℹ cancelled ${c.cancelled}\nℹ skipped ${c.skipped}\nℹ todo ${c.todo}\nℹ duration_ms 3366.5\n`;
};

test('el validador existe, es identico en los dos pasos y el workflow lo invoca con el estado real del proceso', () => {
  assert.equal(BLOCKS.length, 2);
  assert.equal(BLOCKS[0], BLOCKS[1]);
  assert.match(WORKFLOW, /check_node_test_summary pg-recovery\.log "\$status"/);
  assert.match(WORKFLOW, /check_node_test_summary pg-t2\.log "\$status"/);
  assert.equal((WORKFLOW.match(/status="\$\{PIPESTATUS\[0\]\}"/g) ?? []).length, 2);
  assert.doesNotMatch(WORKFLOW.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'), /continue-on-error|\|\|\s*true\s*$|--test-reporter/m);
});

test('acepta el resumen TAP de Node 22 (el que produjo el CI real)', () => {
  const r = run(tap());
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /test summary OK: tests=16 pass=16 fail=0 skipped=0 cancelled=0/);
});

test('acepta el resumen spec de Node 24', () => {
  assert.equal(run(spec()).code, 0);
});

test('ignora lineas anidadas con sangria (solo cuenta el resumen de nivel superior)', () => {
  assert.equal(run(`    # tests 99\n    # fail 7\n${tap()}`).code, 0);
});

const REJECTED = [
  ['tests fallidos (TAP)', () => run(tap({ pass: 15, fail: 1 })), /tests=16 pass=15 fail=1/],
  ['tests fallidos (spec)', () => run(spec({ pass: 15, fail: 1 })), /fail=1/],
  ['tests omitidos (TAP)', () => run(tap({ pass: 15, skipped: 1 })), /skipped=1/],
  ['tests omitidos (spec)', () => run(spec({ pass: 15, skipped: 1 })), /skipped=1/],
  ['cero tests (TAP)', () => run(tap({ tests: 0, pass: 0 })), /tests=0/],
  ['cero tests (spec)', () => run(spec({ tests: 0, pass: 0 })), /tests=0/],
  ['tests cancelados', () => run(tap({ pass: 15, cancelled: 1 })), /cancelled=1/],
  ['pass distinto de tests', () => run(tap({ pass: 14 })), /pass=14/],
  ['proceso con exit distinto de 0 aunque el resumen sea perfecto', () => run(tap(), '1'), /exited with status 1/],
  ['estado de salida no numerico o vacio', () => run(tap(), ''), /exited with status/],
  ['sin resumen', () => run('npm ERR! algo fallo\n'), /missing, malformed or ambiguous/],
  ['log vacio', () => run(''), /missing, malformed or ambiguous/],
  ['archivo de log inexistente', () => run(null), /missing, malformed or ambiguous/],
  ['falta un contador (skipped)', () => run(tap().replace(/# skipped 0\n/, '')), /missing, malformed or ambiguous/],
  ['contador malformado', () => run(tap().replace('# tests 16', '# tests abc')), /missing, malformed or ambiguous/],
  ['contador con basura al final', () => run(tap().replace('# fail 0', '# fail 0x')), /missing, malformed or ambiguous/],
  ['contador sin numero', () => run(tap().replace('# pass 16', '# pass ')), /missing, malformed or ambiguous/],
  ['resumen duplicado', () => run(tap() + tap()), /missing, malformed or ambiguous/],
  ['TAP y spec mezclados (ambiguo)', () => run(tap() + spec()), /missing, malformed or ambiguous/],
  ['solo lineas con sangria (sin resumen de nivel superior)', () => run('    # tests 16\n    # pass 16\n    # fail 0\n    # cancelled 0\n    # skipped 0\n'), /missing, malformed or ambiguous/]
];

for (const [name, execute, pattern] of REJECTED) {
  test(`rechaza: ${name}`, () => {
    const r = execute();
    assert.notEqual(r.code, 0, `debia fallar:\n${r.out}`);
    assert.match(r.out, pattern);
    assert.doesNotMatch(r.out, /test summary OK/);
  });
}

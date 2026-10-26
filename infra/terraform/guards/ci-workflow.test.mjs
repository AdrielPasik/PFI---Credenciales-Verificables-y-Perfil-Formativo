// Invariantes del workflow de CI con PostgreSQL: solo credenciales de prueba, sin AWS ni secretos,
// PostgreSQL 16, y ninguna omision silenciosa. Tambien: los workflows productivos no se tocan.
// Ejecutar: node --test infra/terraform/guards/ci-workflow.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const WORKFLOWS = path.join(ROOT, '.github', 'workflows');
const ci = fs.readFileSync(path.join(WORKFLOWS, 'api-postgres-tests.yml'), 'utf8');
const code = ci.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');

test('usa PostgreSQL 16 como servicio del job y una base de prueba descartable', () => {
  assert.match(code, /image:\s*postgres:16\s*$/m);
  assert.match(code, /POSTGRES_DB:\s*scope_recovery_test/);
  assert.match(code, /postgresql:\/\/postgres:test@127\.0\.0\.1:5432\/scope_recovery_test/);
});

test('no usa AWS, OIDC, entornos protegidos ni secretos', () => {
  assert.doesNotMatch(code, /aws-actions|configure-aws-credentials|id-token|environment:|secrets\.|AWS_/i);
  assert.doesNotMatch(code, /rds\.amazonaws|\.internal|scopeedu/i);
  assert.match(code, /permissions:\s*\n\s*contents:\s*read/);
});

test('migra la base descartable y ejecuta los tests PostgreSQL de recuperacion y T2', () => {
  assert.match(code, /prisma migrate deploy/);
  assert.match(code, /npm run test:password-recovery-pg --workspace services\/api/);
  assert.match(code, /npm run test:legacy-token-compat-pg --workspace services\/api/);
});

test('rechaza omisiones silenciosas: cada paso valida el resumen real (exit, tests>0, fail 0, skipped 0)', () => {
  // La logica del validador se prueba en ci-summary-validator.test.mjs; aqui, que los dos pasos la usen.
  assert.equal((code.match(/check_node_test_summary pg-(recovery|t2)\.log "\$status"/g) ?? []).length, 2);
  assert.equal((code.match(/status="\$\{PIPESTATUS\[0\]\}"/g) ?? []).length, 2);
  assert.doesNotMatch(code, /continue-on-error|\|\|\s*true\s*$/m);
  assert.doesNotMatch(code, /--test-reporter/);
});

test('los scripts npm exigen TEST_DATABASE_URL (la ausencia es un fallo, no una omision)', () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'services', 'api', 'package.json'), 'utf8')).scripts;
  assert.ok(scripts['test:password-recovery-pg'] && scripts['test:legacy-token-compat-pg']);
  for (const file of ['src/auth/password-reset/password-reset.pg.test.ts', 'src/auth/legacy-token-compat.pg.test.ts']) {
    const source = fs.readFileSync(path.join(ROOT, 'services', 'api', file), 'utf8');
    assert.match(source, /npm_lifecycle_event === 'test:(password-recovery|legacy-token-compat)-pg'/);
    assert.match(source, /throw new Error\(\s*'test:[a-z-]+-pg requiere TEST_DATABASE_URL/);
  }
});

test('los workflows productivos no cambian respecto de la base (origin/main)', { skip: !process.env.CI_BASE_REF && !gitHas('origin/main') }, () => {
  const base = process.env.CI_BASE_REF || 'origin/main';
  const out = execFileSync('git', ['diff', '--name-only', base, '--', '.github/workflows'], { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
  // run-production-migrator.yml se cubre con run-production-migrator-workflow.test.mjs (pasos de solo lectura status/precheck).
  assert.deepEqual(out.filter((f) => !f.endsWith('api-postgres-tests.yml') && !f.endsWith('run-production-migrator.yml')), []);
});

function gitHas(ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

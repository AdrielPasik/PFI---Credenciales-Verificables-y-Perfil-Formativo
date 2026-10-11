/**
 * Guards ESTRUCTURALES de la sonda de inventario ECR -- S8c11.4c2a3.
 *
 * Inspeccionan el YAML versionado (no hay parser YAML declarado). NO ejecutan el
 * workflow, no hablan con GitHub ni con AWS. Prueban que la superficie de comandos
 * es de solo lectura y que el calculo de evidencia esta en el repositorio. NO
 * prueban que IAM sea de solo lectura: el rol es el de deploy compartido.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const WORKFLOW_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'inspect-production-ecr.yml'
);

const RAW = readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r\n/g, '\n');

/** Texto sin lineas de comentario. */
const CODE = RAW.split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');

const LIVE_TAG = '4ef16bc44e8e2b932268d3ac20da648517723d55';
const CANDIDATE_TAG = '0d8ffbfec8a465f8043df0c1c2b2b4c179f0fd30';

function steps(): string[] {
  const start = CODE.indexOf('\n    steps:\n');
  assert.notEqual(start, -1, 'sin steps');
  return CODE.slice(start + '\n    steps:\n'.length)
    .split(/^(?= {6}- )/m)
    .filter((piece) => piece.trim().length > 0);
}

function stepNamed(pattern: RegExp): string {
  const found = steps().filter((step) => pattern.test(step));
  assert.equal(found.length, 1, `paso ${pattern} (${found.length})`);
  return found[0];
}

// ---------------------------------------------------------------------------
// TRIGGER
// ---------------------------------------------------------------------------

test('S8c11.4c2a3-1: solo workflow_dispatch, sin inputs', () => {
  const onBlock = CODE.slice(CODE.indexOf('\non:\n'), CODE.indexOf('\njobs:\n'));
  assert.match(onBlock, /workflow_dispatch:/);
  assert.ok(!onBlock.includes('inputs:'), 'no debe tener inputs');
  for (const forbidden of ['push:', 'pull_request', 'schedule:', 'workflow_run', 'release:']) {
    assert.ok(!onBlock.includes(forbidden), forbidden);
  }
});

// ---------------------------------------------------------------------------
// REF PRINCIPAL ANTES DE AWS
// ---------------------------------------------------------------------------

test('S8c11.4c2a3-2: gate de refs/heads/main ANTES de las credenciales AWS', () => {
  const gate = stepNamed(/Require workflow execution from main/);
  assert.match(gate, /github\.ref/);
  assert.match(gate, /refs\/heads\/main/);
  assert.match(gate, /exit 1/);

  const gateAt = CODE.indexOf('Require workflow execution from main');
  const credentialsAt = CODE.indexOf('aws-actions/configure-aws-credentials');
  assert.ok(gateAt !== -1 && credentialsAt !== -1);
  assert.ok(gateAt < credentialsAt, 'el gate debe preceder a las credenciales');
  assert.equal(CODE.split('aws-actions/configure-aws-credentials').length - 1, 1);
});

test('S8c11.4c2a3-3: registra los metadatos del run', () => {
  const compute = stepNamed(/Compute inventory and retention evidence/);
  for (const expression of [
    'github.ref',
    'github.workflow_ref',
    'github.workflow_sha',
    'github.run_id',
    'github.run_attempt',
  ]) {
    assert.ok(compute.includes(expression), expression);
  }
});

// ---------------------------------------------------------------------------
// AUTORIDAD
// ---------------------------------------------------------------------------

test('S8c11.4c2a3-4: environment production, permisos minimos y rol de deploy exacto', () => {
  assert.match(CODE, /environment:\s*production\b/);
  const permissions = /permissions:\n((?: {6}[a-z-]+: \S+\n)+)/.exec(CODE)?.[1] ?? '';
  assert.match(permissions, /contents:\s*read/);
  assert.match(permissions, /id-token:\s*write/);
  assert.equal(permissions.trim().split('\n').length, 2, 'solo dos permisos');

  const credentials = stepNamed(/configure-aws-credentials/);
  assert.match(
    credentials,
    /role-to-assume:\s*arn:aws:iam::309490997821:role\/scope-prod-github-actions-deploy\s*\n/
  );
  assert.match(credentials, /aws-region:\s*us-east-1/);
  assert.match(credentials, /role-session-name:\s*ecr-inventory-\$\{\{ github\.run_id \}\}\n/);
});

test('S8c11.4c2a3-4b: la session policy permite solo ecr:DescribeImages sobre scope/api', () => {
  const credentials = stepNamed(/configure-aws-credentials/);
  const block = /inline-session-policy:\s*\|\n((?: {12}.*\n?)+)/.exec(credentials)?.[1] ?? '';
  assert.notEqual(block, '', 'falta inline-session-policy');
  const policy = JSON.parse(block);
  assert.equal(policy.Statement.length, 1);
  const [statement] = policy.Statement;
  assert.equal(statement.Effect, 'Allow');
  assert.equal(statement.Action, 'ecr:DescribeImages'); // cadena unica, sin otras acciones
  assert.equal(statement.Resource, 'arn:aws:ecr:us-east-1:309490997821:repository/scope/api');
  assert.ok(!block.includes('*'), 'sin wildcards');
  assert.equal(Object.keys(statement).sort().join(','), 'Action,Effect,Resource');
  for (const other of ['ListImages', 'BatchGetImage', 'GetLifecyclePolicy', 'PutImage', 'ecs:', 'ssm:', 'iam:']) {
    assert.ok(!block.includes(other), other);
  }
});

test('S8c11.4c2a3-5: documenta rol base compartido, sesion acotada y verificacion de politica', () => {
  for (const marker of [
    'WORKFLOW_COMMAND_SURFACE = READ_ONLY_ECR',
    'ROLE_BASE_AUTHORITY = SHARED_DEPLOY_ROLE',
    'IAM_ROLE_AUTHORITY = SHARED_DEPLOY_ROLE',
    'SESSION_POLICY_SCOPE = ECR_DESCRIBE_IMAGES_ONLY',
    'IAM_SESSION_ENFORCED_READ_ONLY = YES',
    'INVENTORY_PROBE_ROLE_SEPARATION = SHARED_DEPLOY_ROLE',
    'LIVE_ECR_INVENTORY = OBSERVED_AT_RUN_TIME',
    'RETENTION_SAFETY_METHOD = CONSERVATIVE_TOTAL_COUNT_BOUND',
    'LIFECYCLE_POLICY_RECHECK_REQUIRED_BEFORE_PUBLISH = YES',
  ]) {
    assert.ok(RAW.includes(marker), marker);
  }
  assert.ok(!/IAM_ROLE_ENFORCED_READ_ONLY\s*=\s*YES/.test(RAW), 'el rol base no es de solo lectura');
  assert.match(RAW, /UNKNOWN until verified live/);
  assert.match(RAW, /explicitly\s+(# )?approve assuming the shared deploy role/);
});

// ---------------------------------------------------------------------------
// SOLO LECTURA
// ---------------------------------------------------------------------------

test('S8c11.4c2a3-6: una unica consulta describe-images sobre scope/api en us-east-1, paginada completa', () => {
  const calls = CODE.match(/aws ecr [a-z-]+/g) ?? [];
  assert.deepEqual(calls, ['aws ecr describe-images']);

  const capture = stepNamed(/Capture ECR image inventory/);
  assert.match(capture, /--repository-name scope\/api/);
  assert.match(capture, /--region us-east-1/);
  assert.match(capture, /> ecr-images\.json/);
  // La paginacion automatica de la CLI no debe cortarse.
  assert.ok(!/--no-paginate|--max-items|--page-size|--starting-token/.test(CODE));
});

test('S8c11.4c2a3-7: ninguna mutacion ni otro servicio en el codigo ejecutable', () => {
  const forbidden = [
    /put-image/i,
    /batch-delete-image/i,
    /initiate-layer-upload/i,
    /upload-layer-part/i,
    /complete-layer-upload/i,
    /\baws ecs\b/,
    /\baws ssm\b/,
    /\baws (states|sfn|stepfunctions)\b/,
    /\baws iam\b/,
    /\baws rds\b/,
    /\baws (?!ecr describe-images)\S+/,
    /\bterraform\b/i,
    /\bdocker (build|buildx|push|login|run)\b/i,
    /docker\/(build-push|setup-buildx|login)-action/,
    /aws-actions\/amazon-ecr-login/,
    /\bgh (workflow|run)\b/,
    /actions\/checkout/,
  ];
  for (const pattern of forbidden) {
    assert.ok(!pattern.test(CODE), String(pattern));
  }
});

// ---------------------------------------------------------------------------
// EVIDENCIA
// ---------------------------------------------------------------------------

test('S8c11.4c2a3-8: tags exactos, formula de umbral y veredicto conservador', () => {
  const compute = stepNamed(/Compute inventory and retention evidence/);
  assert.match(compute, new RegExp(`LIVE_TAG: ${LIVE_TAG}\\n`));
  assert.match(compute, new RegExp(`CANDIDATE_TAG: ${CANDIDATE_TAG}\\n`));
  assert.match(compute, /ASSUMED_RETAIN_COUNT: "10"/);
  // Unica cota de cantidad que produce YES: total <= RETAIN - 1 (9 con RETAIN 10).
  assert.match(compute, /max_total_before_push = RETAIN - 1/);
  assert.match(compute, /elif total <= max_total_before_push:\n\s+safe = "YES"/);
  assert.equal((compute.match(/safe = "YES"/g) ?? []).length, 1, 'un solo camino a YES');
  // El rango de la imagen viva es informativo: no participa de la decision.
  const decision = compute.slice(compute.indexOf('if not live_exists:'), compute.indexOf('lines = ['));
  assert.ok(!/newer_count|threshold/.test(decision), 'newer_count no decide');
  assert.ok(!/RETAIN - 2/.test(compute));
  for (const field of [
    'LIVE_TAG_NEWER_COUNT',
    'CANDIDATE_TAG_EXISTS',
    'LIVE_TAG_EXISTS',
    'LIVE_TAG_DIGEST',
    'SAFE_TO_ADD_ONE',
    'TOTAL_IMAGE_DETAILS',
    'TAGGED_IMAGE_DETAILS',
    'UNTAGGED_IMAGE_DETAILS',
  ]) {
    assert.ok(compute.includes(field), field);
  }
  // Sin tag vivo o con candidato existente el veredicto es NO.
  assert.match(compute, /if not live_exists:\n\s+safe = "NO"/);
  assert.match(compute, /elif candidate_exists:\n\s+safe = "NO"/);
});

test('S8c11.4c2a3-9: falla en vez de devolver SAFE ante inventario dudoso', () => {
  const compute = stepNamed(/Compute inventory and retention evidence/);
  for (const marker of [
    'nextToken', // inventario incompleto
    'not valid JSON',
    'no imageDetails list',
    'no valid imageDigest',
    'duplicate imageDigest',
    'resolves to more than one image', // tag no unico
    'sys.exit(1)',
  ]) {
    assert.ok(compute.includes(marker), marker);
  }
  // La imagen viva no necesita ser un manifiesto de imagen unica.
  assert.ok(!/SINGLE_IMAGE_MEDIA_TYPES|single-image/.test(compute));
  assert.ok(!/live\["manifest"\]/.test(compute));
});

test('S8c11.4c2a3-10: resumen con politica asumida, marca temporal y advertencias', () => {
  const compute = stepNamed(/Compute inventory and retention evidence/);
  assert.match(compute, /GITHUB_STEP_SUMMARY/);
  assert.match(compute, /OBSERVED_AT/);
  assert.match(compute, /RETENTION_POLICY_ASSUMPTION: tagStatus any, imageCountMoreThan/);
  assert.match(compute, /point-in-time, advisory result/);
  assert.match(compute, /does not authorize publication/);
  assert.match(compute, /LIVE_ECR_INVENTORY: OBSERVED_AT_RUN_TIME/);
  assert.match(compute, /ROLE_BASE_AUTHORITY: SHARED_DEPLOY_ROLE/);
  assert.match(compute, /IAM_SESSION_ENFORCED_READ_ONLY: YES/);
  assert.match(compute, /RETENTION_SAFETY_METHOD: CONSERVATIVE_TOTAL_COUNT_BOUND/);
  assert.match(compute, /LIFECYCLE_POLICY_RECHECK_REQUIRED_BEFORE_PUBLISH: YES/);
  assert.match(compute, /does not emulate the multi-rule lifecycle policy/);
  assert.ok(!/upload-artifact/.test(CODE), 'sin artifact: el resumen contiene la evidencia');
});

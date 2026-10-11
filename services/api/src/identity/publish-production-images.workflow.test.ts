/**
 * Guards ESTRUCTURALES del workflow de publicacion -- S8c11.4c2a1.
 *
 * Inspeccionan el YAML versionado (no hay parser YAML declarado, asi que se
 * segmenta por indentacion). NO ejecutan el workflow, no hablan con GitHub ni con
 * AWS, y no prueban el comportamiento real de la ejecucion: prueban que el
 * MECANISMO de vinculo commit -> imagen y de captura de digest esta en el
 * repositorio. Una ejecucion real sigue pendiente.
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
  'publish-production-images.yml'
);

const RAW = readFileSync(WORKFLOW_PATH, 'utf8').replace(/\r\n/g, '\n');

/** Texto sin lineas de comentario. */
const CODE = RAW.split('\n')
  .filter((line) => !line.trimStart().startsWith('#'))
  .join('\n');

/** Jobs de nivel superior (indentacion de 2 espacios bajo `jobs:`). */
function jobs(): Record<string, string> {
  const start = CODE.indexOf('\njobs:\n');
  assert.notEqual(start, -1, 'no se encontro jobs:');
  const body = CODE.slice(start + '\njobs:\n'.length);
  const result: Record<string, string> = {};
  const headers = [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)];
  headers.forEach((match, index) => {
    const end = index + 1 < headers.length ? headers[index + 1].index : body.length;
    result[match[1]] = body.slice(match.index, end);
  });
  return result;
}

/** Steps de un job: cada `      - ` abre uno. */
function steps(job: string): string[] {
  const start = job.indexOf('\n    steps:\n');
  assert.notEqual(start, -1, 'job sin steps');
  const body = job.slice(start + '\n    steps:\n'.length);
  return body.split(/^(?= {6}- )/m).filter((piece) => piece.trim().length > 0);
}

function stepNamed(job: string, pattern: RegExp): string {
  const found = steps(job).filter((step) => pattern.test(step));
  assert.equal(found.length, 1, `paso ${pattern} (${found.length})`);
  return found[0];
}

const all = jobs();
const validate = all.validate;
const publishApi = all['publish-api'];
const publishAi = all['publish-ai'];

// ---------------------------------------------------------------------------
// TRIGGER
// ---------------------------------------------------------------------------

test('S8c11.4c2a1-1: solo workflow_dispatch; source_sha requerido y publish_ai default true', () => {
  const onBlock = CODE.slice(CODE.indexOf('\non:\n'), CODE.indexOf('\njobs:\n'));
  assert.match(onBlock, /workflow_dispatch:/);
  for (const forbidden of ['push:', 'pull_request', 'schedule:', 'workflow_run', 'release:']) {
    assert.ok(!onBlock.includes(forbidden), forbidden);
  }

  const sourceSha = /source_sha:\n([\s\S]*?)(?=\n {6}publish_ai:)/.exec(onBlock)?.[1] ?? '';
  assert.match(sourceSha, /required:\s*true/);
  assert.match(sourceSha, /type:\s*string/);

  const publishAiInput = /publish_ai:\n([\s\S]*)$/.exec(onBlock)?.[1] ?? '';
  assert.match(publishAiInput, /type:\s*boolean/);
  assert.match(publishAiInput, /default:\s*true/);
  assert.match(publishAiInput, /required:\s*false/);
});

// ---------------------------------------------------------------------------
// REF DE EJECUCION
// ---------------------------------------------------------------------------

test('S8c11.4c2a1-2: la ejecucion exige refs/heads/main antes de cualquier checkout o build', () => {
  const gate = stepNamed(validate, /Require workflow execution from main/);
  assert.match(gate, /WORKFLOW_EXECUTION_REF:\s*\$\{\{ github\.ref \}\}/);
  assert.match(gate, /"\$WORKFLOW_EXECUTION_REF" != "refs\/heads\/main"/);
  assert.match(gate, /exit 1/);

  // Es el primer paso de validate, antes de cualquier `uses:`.
  const validateSteps = steps(validate);
  assert.ok(validateSteps[0].includes('Require workflow execution from main'));
  const firstUses = validateSteps.findIndex((step) => /\buses:/.test(step));
  assert.ok(firstUses > 0);

  // Los jobs de publicacion dependen de validate: sin main no se publica nada.
  assert.match(publishApi, /needs:\s*validate/);
  assert.match(publishAi, /needs:\s*validate/);

  // No se exige source_sha == github.sha: se puede publicar un commit anterior de main.
  assert.ok(!/source_sha\s*==\s*github\.sha|SOURCE_SHA"\s*(!=|=)\s*"\$GITHUB_SHA/.test(CODE));
});

// ---------------------------------------------------------------------------
// SOURCE SHA
// ---------------------------------------------------------------------------

test('S8c11.4c2a1-3: el SHA se valida (40 hex, ancestro de origin/main) y los jobs consumen UNA interpretacion', () => {
  const format = stepNamed(validate, /Validate SHA format/);
  assert.match(format, /\^\[0-9a-f\]\{40\}\$/);

  const checkout = stepNamed(validate, /Checkout exact source SHA/);
  assert.match(checkout, /ref:\s*\$\{\{ inputs\.source_sha \}\}/);

  const verify = stepNamed(validate, /Verify source commit/);
  assert.match(verify, /id:\s*verify/);
  assert.match(verify, /git rev-parse HEAD/);
  assert.match(verify, /git merge-base --is-ancestor "\$ACTUAL_SHA" origin\/main/);
  assert.match(verify, /echo "sha=\$ACTUAL_SHA" >> "\$GITHUB_OUTPUT"/);
  assert.match(validate, /source_sha:\s*\$\{\{ steps\.verify\.outputs\.sha \}\}/);

  // `inputs.source_sha` se interpreta solo en validate; la publicacion usa el output.
  assert.ok(!publishApi.includes('inputs.source_sha'));
  assert.ok(!publishAi.includes('inputs.source_sha'));
  assert.match(publishApi, /ref:\s*\$\{\{ needs\.validate\.outputs\.source_sha \}\}/);
});

test('S8c11.4c2a1-4: el job API verifica HEAD exacto despues del checkout y antes de AWS y del build', () => {
  const apiSteps = steps(publishApi);
  const index = (pattern: RegExp) => apiSteps.findIndex((step) => pattern.test(step));

  const checkoutAt = index(/Checkout validated source SHA/);
  const verifyAt = index(/Verify the checked-out commit is the validated source SHA/);
  const awsAt = index(/Configure AWS credentials/);
  const buildAt = index(/Build and push API image/);

  assert.ok(checkoutAt >= 0 && verifyAt > checkoutAt, 'verificacion despues del checkout');
  assert.ok(awsAt > verifyAt, 'verificacion antes de configurar AWS');
  assert.ok(buildAt > awsAt, 'build despues');

  const verify = apiSteps[verifyAt];
  assert.match(verify, /EXPECTED_SHA:\s*\$\{\{ needs\.validate\.outputs\.source_sha \}\}/);
  assert.match(verify, /git rev-parse HEAD/);
  assert.match(verify, /"\$ACTUAL_SHA" != "\$EXPECTED_SHA"/);
  assert.match(verify, /exit 1/);
});

// ---------------------------------------------------------------------------
// BUILD DE LA API
// ---------------------------------------------------------------------------

const buildApi = stepNamed(publishApi, /Build and push API image/);

test('S8c11.4c2a1-5: build de la API con id estable, contexto local, Dockerfile y plataforma fijos', () => {
  assert.match(buildApi, /id:\s*build_api/);
  assert.match(buildApi, /uses:\s*docker\/build-push-action@v6/);
  assert.match(buildApi, /context:\s*\./);
  assert.match(buildApi, /file:\s*\.\/services\/api\/Dockerfile/);
  assert.match(buildApi, /platforms:\s*linux\/amd64/);
  assert.match(buildApi, /push:\s*true/);
  assert.match(
    buildApi,
    /tags:\s*309490997821\.dkr\.ecr\.us-east-1\.amazonaws\.com\/scope\/api:\$\{\{ needs\.validate\.outputs\.source_sha \}\}\s*$/m
  );

  // Un solo tag, y nunca latest.
  assert.ok(!/:latest\b|tags:.*latest/i.test(CODE));
  assert.ok(!/build-args:|secrets:|cache-from|cache-to|target:/.test(buildApi));
});

// ---------------------------------------------------------------------------
// EVIDENCIA
// ---------------------------------------------------------------------------

test('S8c11.4c2a1-6: attestations explicitas, etiqueta OCI de revision y digest de la accion', () => {
  assert.match(buildApi, /provenance:\s*false/);
  assert.match(buildApi, /sbom:\s*false/);
  assert.match(
    buildApi,
    /labels:\s*\|\n\s+org\.opencontainers\.image\.revision=\$\{\{ needs\.validate\.outputs\.source_sha \}\}/
  );

  // Digest: output de la accion, expuesto como output del job.
  assert.match(
    publishApi,
    /api_image_digest:\s*\$\{\{ steps\.build_api\.outputs\.digest \}\}/
  );
  assert.match(publishApi, /source_sha:\s*\$\{\{ needs\.validate\.outputs\.source_sha \}\}/);
  assert.match(publishApi, /api_image_tag:\s*309490997821\.dkr\.ecr\.us-east-1\.amazonaws\.com\/scope\/api:/);

  // No se calcula ni se parsea ni se consulta a ECR para obtenerlo.
  for (const forbidden of ['docker inspect', 'describe-images', 'imagetools', 'jq ', 'grep ']) {
    assert.ok(!publishApi.includes(forbidden), forbidden);
  }
});

test('S8c11.4c2a1-7: el resumen registra el vinculo fuente/workflow/run/tag/digest/plataforma', () => {
  const record = stepNamed(publishApi, /Record API image evidence/);

  // Despues del build.
  const apiSteps = steps(publishApi);
  assert.ok(
    apiSteps.findIndex((step) => /Record API image evidence/.test(step)) >
      apiSteps.findIndex((step) => /Build and push API image/.test(step))
  );

  assert.match(record, /IMAGE_DIGEST:\s*\$\{\{ steps\.build_api\.outputs\.digest \}\}/);
  assert.match(record, /\^sha256:\[0-9a-f\]\{64\}\$/);
  assert.match(record, /GITHUB_STEP_SUMMARY/);

  for (const field of [
    'SOURCE_SHA',
    'WORKFLOW_REF',
    'WORKFLOW_SHA',
    'GITHUB_REF',
    'RUN_ID',
    'RUN_ATTEMPT',
    'ECR_REPOSITORY',
    'IMAGE_TAG',
    'IMAGE_DIGEST',
    'PLATFORM: linux/amd64',
    'PROVENANCE: disabled-for-first-provisioner-release',
    'SBOM: disabled-for-first-provisioner-release'
  ]) {
    assert.ok(record.includes(field), field);
  }

  for (const source of ['github.workflow_ref', 'github.workflow_sha', 'github.run_id', 'github.run_attempt']) {
    assert.ok(record.includes(source), source);
  }

  // Nada sensible en el resumen.
  assert.ok(!/secrets\.|DATABASE_URL|PRIVATE|TOKEN|PASSWORD|AWS_ACCESS|AWS_SECRET/i.test(record));
});

test('S8c11.4c2a1-8: los estados de seguridad quedan registrados en el workflow', () => {
  for (const line of [
    'PROVENANCE_FOR_FIRST_PROVISIONER_RELEASE = DISABLED_BY_DESIGN',
    'SBOM_FOR_FIRST_PROVISIONER_RELEASE = DISABLED_BY_DESIGN',
    'WORKFLOW_DEPENDENCY_PINNING = NOT_HARDENED',
    'REBUILD_REPRODUCIBILITY = NOT_PROVEN',
    'ACTUAL_RELEASE_BINDING = NOT_YET_PROVEN',
    'SPECIFIC_RUN_SOURCE_BINDING'
  ]) {
    assert.ok(RAW.includes(line), line);
  }
});

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

test('S8c11.4c2a1-9: el job AI es opcional (default true) y su build no cambia', () => {
  assert.match(publishAi, /if:\s*\$\{\{ inputs\.publish_ai \}\}/);
  assert.ok(!/if:/.test(publishApi.split('\n    steps:')[0]), 'la API no depende de publish_ai');

  const buildAi = stepNamed(publishAi, /Build and push AI image/);
  assert.match(buildAi, /uses:\s*docker\/build-push-action@v6/);
  assert.match(buildAi, /context:\s*\.\/services\/ai-service/);
  assert.match(buildAi, /file:\s*\.\/services\/ai-service\/Dockerfile/);
  assert.match(buildAi, /platforms:\s*linux\/amd64/);
  assert.match(buildAi, /push:\s*true/);
  assert.match(
    buildAi,
    /tags:\s*309490997821\.dkr\.ecr\.us-east-1\.amazonaws\.com\/scope\/ai:\$\{\{ needs\.validate\.outputs\.source_sha \}\}/
  );
});

// ---------------------------------------------------------------------------
// SIN EFECTOS DE DEPLOY
// ---------------------------------------------------------------------------

test('S8c11.4c2a1-10: el workflow sigue siendo solo publicacion: sin deploy, migraciones, SSM ni provisioning', () => {
  for (const forbidden of [
    'register-task-definition',
    'update-service',
    'run-task',
    'terraform',
    'put-parameter',
    'start-execution',
    'prisma',
    'migrate',
    'technical-identity-cli',
    'provisioner-entrypoint'
  ]) {
    assert.ok(!CODE.includes(forbidden), forbidden);
  }

  // Ningun paso invoca la CLI de AWS para servicios distintos de publicar imagenes.
  assert.ok(!/\baws\s+(ecs|ssm|sfn|stepfunctions|rds|iam|lambda|secretsmanager|events)\b/.test(CODE));

  // La unica credencial AWS es el rol de deploy existente, via OIDC.
  assert.equal((CODE.match(/role-to-assume:/g) ?? []).length, 2);
  assert.ok(!/aws-access-key-id|aws-secret-access-key/i.test(CODE));
});

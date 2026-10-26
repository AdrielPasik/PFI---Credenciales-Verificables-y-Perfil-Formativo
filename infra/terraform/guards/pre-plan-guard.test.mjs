// Pruebas de la guarda previa al plan, con respuestas de AWS SIMULADAS.
// No llaman a AWS ni leen tfvars reales. Ejecutar: node --test infra/terraform/guards/pre-plan-guard.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALLOWED_AWS_OPERATIONS,
  BLOCKCHAIN_MODE_PARAMETER,
  ReadOnlyViolation,
  assertReadOnlyAwsCall,
  createAwsRunner,
  imageDigest,
  imageTag,
  main,
  parseTfvars,
  REQUIRED_TFVARS
} from './pre-plan-guard.mjs';

// Valores de FIXTURE (no son los reales; el patron de las respuestas si lo es).
const ACCT = '111111111111';
const API_TAG = 'a'.repeat(40);
const AI_TAG = 'b'.repeat(40);
const MIG_TAG = 'c'.repeat(40);
const PROV_DIGEST = `sha256:${'d'.repeat(64)}`;
const ECR = `${ACCT}.dkr.ecr.us-east-1.amazonaws.com`;
const API_TD = `arn:aws:ecs:us-east-1:${ACCT}:task-definition/scope-prod-api:11`;
const AI_TD = `arn:aws:ecs:us-east-1:${ACCT}:task-definition/scope-prod-ai:7`;

/** Estado "AWS sano": lo mismo que se observo en produccion, con valores de fixture. */
function healthyAws(overrides = {}) {
  const state = {
    identityArn: `arn:aws:iam::${ACCT}:user/operador`,
    cluster: { clusterName: 'scope-prod-cluster', clusterArn: `arn:aws:ecs:us-east-1:${ACCT}:cluster/scope-prod-cluster`, status: 'ACTIVE' },
    api: { desired: 1, running: 1, pending: 0, min: 0, max: 100, rollout: 'COMPLETED', deployments: 1, cb: { enable: true, rollback: true } },
    ai: { desired: 1, running: 1, pending: 0, min: 100, max: 200, rollout: 'COMPLETED', deployments: 1, cb: { enable: true, rollback: true } },
    apiImage: `${ECR}/scope/api:${API_TAG}`,
    aiImage: `${ECR}/scope/ai:${AI_TAG}`,
    migImage: `${ECR}/scope/api:${MIG_TAG}`,
    provImage: `${ECR}/scope/api@${PROV_DIGEST}`,
    apiEnv: { WEB_ORIGIN: 'https://web.example-fixture.com', PROFILE_EMBEDDINGS_ENABLED: 'true' },
    aiEnv: { PROFILE_EMBEDDINGS_ENABLED: 'true', AI_AREA_EMBEDDINGS_ENABLED: 'true' },
    apiSecrets: ['DATABASE_URL', 'JWT_SECRET', 'CREDENTIAL_REGISTRY_RPC_URL'],
    blockchainMode: 'credential_registry',
    blockchainParamType: 'String',
    failures: [],
    ...overrides
  };
  return state;
}

const service = (name, td, s) => ({
  serviceName: name,
  status: 'ACTIVE',
  desiredCount: s.desired,
  runningCount: s.running,
  pendingCount: s.pending,
  taskDefinition: td,
  deploymentConfiguration: { minimumHealthyPercent: s.min, maximumPercent: s.max, deploymentCircuitBreaker: s.cb },
  deployments: Array.from({ length: s.deployments }, (_, i) => ({ status: i === 0 ? 'PRIMARY' : 'ACTIVE', rolloutState: s.rollout }))
});

const taskDef = (family, revision, image, env, secrets) => ({
  taskDefinition: {
    family,
    revision,
    containerDefinitions: [{ image, environment: Object.entries(env).map(([name, value]) => ({ name, value })), secrets: secrets.map((name) => ({ name, valueFrom: `arn:aws:ssm:us-east-1:${ACCT}:parameter/x/${name}` })) }]
  }
});

/** Ejecutor falso. Registra TODA llamada para poder auditarla despues. */
function fakeAws(state, calls = []) {
  const run = (args) => {
    assertReadOnlyAwsCall(args); // el falso exige lo mismo que el real
    calls.push(args.join(' '));
    const [svc, op] = args;
    if (state.deny?.includes(`${svc} ${op}`)) throw new Error(`AccessDeniedException: User is not authorized to perform: ${op} on arn:aws:ecs:us-east-1:${ACCT}:*`);
    if (svc === 'sts') return { Arn: state.identityArn };
    if (op === 'describe-clusters') return { clusters: [state.cluster] };
    if (op === 'describe-services') {
      return { failures: state.failures, services: [service('scope-prod-api', API_TD, state.api), service('scope-prod-ai', AI_TD, state.ai)] };
    }
    if (op === 'describe-task-definition') {
      const target = args[args.indexOf('--task-definition') + 1];
      if (target === API_TD) return taskDef('scope-prod-api', 11, state.apiImage, state.apiEnv, state.apiSecrets);
      if (target === AI_TD) return taskDef('scope-prod-ai', 7, state.aiImage, state.aiEnv, []);
      if (target === 'scope-prod-migrator') return taskDef('scope-prod-migrator', 8, state.migImage, {}, []);
      if (target === 'scope-prod-provisioner') return taskDef('scope-prod-provisioner', 1, state.provImage, {}, []);
      throw new Error(`task definition inesperada: ${target}`);
    }
    if (op === 'get-parameter') return { Parameter: { Name: BLOCKCHAIN_MODE_PARAMETER, Type: state.blockchainParamType, Value: state.blockchainMode } };
    throw new Error(`operacion no simulada: ${svc} ${op}`);
  };
  return run;
}

const GOOD_TFVARS = {
  enable_services: true,
  api_desired_count: 1,
  ai_desired_count: 1,
  api_image_tag: API_TAG,
  ai_image_tag: AI_TAG,
  migrator_image_tag: MIG_TAG,
  provisioner_image_digest: PROV_DIGEST,
  web_origin: 'https://web.example-fixture.com',
  blockchain_evidence_mode: 'credential_registry',
  profile_embeddings_enabled: true,
  ai_area_embeddings_enabled: true
};

function tfvarsText(values) {
  return Object.entries(values)
    .map(([k, v]) => `${k} = ${typeof v === 'string' ? `"${v}"` : v}`)
    .join('\n');
}

/** Corre la guarda completa y devuelve { code, out, err, calls }. */
function runCase({ tfvars = GOOD_TFVARS, aws = healthyAws(), runAws } = {}) {
  const out = [];
  const err = [];
  const calls = [];
  const code = main({
    tfvarsFiles: ['fixture.tfvars'],
    readFile: () => tfvarsText(tfvars),
    runAws: runAws ?? fakeAws(aws, calls),
    out: (l) => out.push(l),
    err: (l) => err.push(l)
  });
  return { code, out: out.join('\n'), err: err.join('\n'), calls };
}

// ---------------------------------------------------------------------------
// Camino feliz y su mensaje
// ---------------------------------------------------------------------------

test('todo coincide: sale 0, y NO afirma que el plan sera de cero cambios', () => {
  const r = runCase();
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /RESULTADO: las propiedades criticas comparadas coinciden/);
  assert.match(r.out, /NO prueba que `terraform plan` vaya a mostrar cero cambios/);
  assert.doesNotMatch(r.out, /cero cambios garantizad|plan limpio|seguro aplicar/i);
});

// ---------------------------------------------------------------------------
// Capacidad
// ---------------------------------------------------------------------------

test('tfvars viejo (enable_services=false) contra AWS 1/1: DIFF y salida 1 (un apply apagaria API e IA)', () => {
  const r = runCase({ tfvars: { ...GOOD_TFVARS, enable_services: false, api_desired_count: 0, ai_desired_count: 0 } });
  assert.equal(r.code, 1);
  assert.match(r.out, /DIFF\s+API desired_count.*esperado 0 · observado 1/);
  assert.match(r.out, /DIFF\s+IA desired_count.*esperado 0 · observado 1/);
  assert.match(r.out, /NO ejecutes `terraform apply`/);
});

test('enable_services=false pero api_desired_count=1 en tfvars: Terraform impondria 0 (el gate gana) -> DIFF', () => {
  const r = runCase({ tfvars: { ...GOOD_TFVARS, enable_services: false } });
  assert.equal(r.code, 1);
  assert.match(r.out, /DIFF\s+API desired_count.*esperado 0/);
});

test('la capacidad coincide pero la imagen de la API difiere: DIFF (no basta con comparar desired)', () => {
  const r = runCase({ tfvars: { ...GOOD_TFVARS, api_image_tag: 'f'.repeat(40) } });
  assert.equal(r.code, 1);
  assert.match(r.out, /OK\s+API desired_count/);
  assert.match(r.out, /DIFF\s+API: imagen efectiva/);
});

test('la capacidad coincide pero la imagen de la IA difiere: DIFF', () => {
  const r = runCase({ tfvars: { ...GOOD_TFVARS, ai_image_tag: 'e'.repeat(40) } });
  assert.equal(r.code, 1);
  assert.match(r.out, /DIFF\s+IA: imagen efectiva/);
});

test('tareas pendientes o running != desired: DIFF', () => {
  const aws = healthyAws({ api: { ...healthyAws().api, running: 0, pending: 1 } });
  const r = runCase({ aws });
  assert.equal(r.code, 1);
  assert.match(r.out, /DIFF\s+API running == desired/);
  assert.match(r.out, /DIFF\s+API pending/);
});

test('un rollout en curso o mas de un despliegue: DIFF', () => {
  const aws = healthyAws({ api: { ...healthyAws().api, rollout: 'IN_PROGRESS' } });
  assert.equal(runCase({ aws }).code, 1);
  const two = healthyAws({ ai: { ...healthyAws().ai, deployments: 2 } });
  const r = runCase({ aws: two });
  assert.equal(r.code, 1);
  assert.match(r.out, /DIFF\s+IA: un unico despliegue PRIMARY/);
});

// ---------------------------------------------------------------------------
// Politica de despliegue 0/100 de la API
// ---------------------------------------------------------------------------

test('API desplegada 100/200 (perderia el escritor unico): DIFF', () => {
  const aws = healthyAws({ api: { ...healthyAws().api, min: 100, max: 200 } });
  const r = runCase({ aws });
  assert.equal(r.code, 1);
  assert.match(r.out, /DIFF\s+API deployment minimumHealthyPercent.*esperado 0 · observado 100/);
  assert.match(r.out, /DIFF\s+API deployment maximumPercent.*esperado 100 · observado 200/);
});

// ---------------------------------------------------------------------------
// Origen web, flags, blockchain, migrador, provisioner
// ---------------------------------------------------------------------------

test('web_origin vacio en tfvars con CORS configurado en AWS: DIFF (un apply deshabilitaria CORS)', () => {
  const r = runCase({ tfvars: { ...GOOD_TFVARS, web_origin: '' } });
  assert.equal(r.code, 1);
  assert.match(r.out, /DIFF\s+API WEB_ORIGIN/);
});

test('flags de embeddings distintos: DIFF', () => {
  const r = runCase({ tfvars: { ...GOOD_TFVARS, profile_embeddings_enabled: false, ai_area_embeddings_enabled: false } });
  assert.equal(r.code, 1);
  assert.match(r.out, /DIFF\s+API PROFILE_EMBEDDINGS_ENABLED/);
  assert.match(r.out, /DIFF\s+IA AI_AREA_EMBEDDINGS_ENABLED/);
});

test('blockchain: modo mock en tfvars contra credential_registry en AWS: DIFF en modo y en secreto RPC', () => {
  const r = runCase({ tfvars: { ...GOOD_TFVARS, blockchain_evidence_mode: 'mock' } });
  assert.equal(r.code, 1);
  assert.match(r.out, /DIFF\s+blockchain: BLOCKCHAIN_EVIDENCE_MODE/);
  assert.match(r.out, /DIFF\s+blockchain: la API referencia el secreto RPC/);
});

test('blockchain: el parametro SSM no es String: aborta sin usar su valor (exit 2)', () => {
  const r = runCase({ aws: healthyAws({ blockchainParamType: 'SecureString' }) });
  assert.equal(r.code, 2);
  assert.match(r.err, /no es de tipo String/);
});

test('migrador: ultima revision ACTIVA con otro tag: DIFF (evita migrar con imagen vieja)', () => {
  const r = runCase({ tfvars: { ...GOOD_TFVARS, migrator_image_tag: 'f'.repeat(40) } });
  assert.equal(r.code, 1);
  assert.match(r.out, /DIFF\s+migrador: ultima revision ACTIVA/);
});

test('provisioner: digest distinto: DIFF', () => {
  const r = runCase({ tfvars: { ...GOOD_TFVARS, provisioner_image_digest: `sha256:${'0'.repeat(64)}` } });
  assert.equal(r.code, 1);
  assert.match(r.out, /DIFF\s+provisioner: digest/);
});

test('imagen viva por digest en vez de tag: no se puede comparar -> exit 2', () => {
  const r = runCase({ aws: healthyAws({ apiImage: `${ECR}/scope/api@sha256:${'1'.repeat(64)}` }) });
  assert.equal(r.code, 2);
  assert.match(r.err, /no esta referenciada por tag/);
});

// ---------------------------------------------------------------------------
// Fail-closed: datos, permisos, identidad, region
// ---------------------------------------------------------------------------

test('falta una variable obligatoria en el tfvars: exit 2 y se nombra, sin llamar a AWS', () => {
  const { migrator_image_tag, ...incomplete } = GOOD_TFVARS;
  void migrator_image_tag;
  const r = runCase({ tfvars: incomplete });
  assert.equal(r.code, 2);
  assert.match(r.err, /faltan variables.*migrator_image_tag/);
  assert.equal(r.calls.length, 0, 'no debe tocar AWS si faltan datos');
});

test('cada variable obligatoria es realmente obligatoria', () => {
  for (const key of REQUIRED_TFVARS) {
    const copy = { ...GOOD_TFVARS };
    delete copy[key];
    assert.equal(runCase({ tfvars: copy }).code, 2, `sin ${key} debe abortar`);
  }
});

test('tipos invalidos en tfvars: exit 2', () => {
  const r = runCase({ tfvars: { ...GOOD_TFVARS, api_desired_count: 'uno' } });
  assert.equal(r.code, 2);
});

test('AccessDenied en cualquier consulta: exit 2 con el motivo (y sin numero de cuenta)', () => {
  for (const denied of ['ecs describe-services', 'ecs describe-task-definition', 'ssm get-parameter', 'sts get-caller-identity', 'ecs describe-clusters']) {
    const r = runCase({ aws: healthyAws({ deny: [denied] }) });
    assert.equal(r.code, 2, denied);
    assert.match(r.err, /AccessDenied/);
    assert.doesNotMatch(r.err, /\d{12}/, 'no debe imprimir el id de cuenta');
  }
});

test('identidad root: aborta', () => {
  const r = runCase({ aws: healthyAws({ identityArn: `arn:aws:iam::${ACCT}:root` }) });
  assert.equal(r.code, 2);
  assert.match(r.err, /root/);
});

test('cluster inexistente, en otra region o inactivo: exit 2', () => {
  assert.equal(runCase({ aws: healthyAws({ cluster: { clusterName: 'otro', clusterArn: `arn:aws:ecs:us-east-1:${ACCT}:cluster/otro`, status: 'ACTIVE' } }) }).code, 2);
  const otherRegion = healthyAws({ cluster: { clusterName: 'scope-prod-cluster', clusterArn: `arn:aws:ecs:eu-west-1:${ACCT}:cluster/scope-prod-cluster`, status: 'ACTIVE' } });
  const r = runCase({ aws: otherRegion });
  assert.equal(r.code, 2);
  assert.match(r.err, /region esperada/);
  assert.equal(runCase({ aws: healthyAws({ cluster: { clusterName: 'scope-prod-cluster', clusterArn: `arn:aws:ecs:us-east-1:${ACCT}:cluster/scope-prod-cluster`, status: 'INACTIVE' } }) }).code, 2);
});

test('ECS informa failures al describir servicios: exit 2', () => {
  const r = runCase({ aws: healthyAws({ failures: [{ arn: 'x', reason: 'MISSING' }] }) });
  assert.equal(r.code, 2);
});

test('salida de AWS ilegible o faltante: exit 2, nunca "todo bien"', () => {
  const r = runCase({
    runAws: (args) => {
      assertReadOnlyAwsCall(args);
      return {};
    }
  });
  assert.equal(r.code, 2);
});

// ---------------------------------------------------------------------------
// Solo lectura y sin secretos
// ---------------------------------------------------------------------------

test('lista cerrada: solo se emiten operaciones de lectura permitidas, nunca descifrado', () => {
  const r = runCase();
  assert.ok(r.calls.length > 0);
  for (const call of r.calls) {
    const [svc, op] = call.split(' ');
    assert.ok(ALLOWED_AWS_OPERATIONS[svc]?.includes(op), `operacion no permitida: ${call}`);
    assert.doesNotMatch(call, /--with-decryption/);
    assert.doesNotMatch(call, /\b(update|put|delete|run|register|start|stop|create|modify)-/);
  }
  const ssm = r.calls.filter((c) => c.startsWith('ssm '));
  assert.deepEqual(ssm, [`ssm get-parameter --name ${BLOCKCHAIN_MODE_PARAMETER} --no-with-decryption`]);
});

test('el ejecutor rechaza operaciones de escritura y parametros no permitidos ANTES de llamar a AWS', () => {
  const writes = [
    ['ecs', 'update-service', '--service', 'x'],
    ['ecs', 'run-task'],
    ['ecs', 'register-task-definition'],
    ['ssm', 'put-parameter', '--name', 'x'],
    ['rds', 'stop-db-instance'],
    ['rds', 'start-db-instance'],
    ['ecs', 'list-task-definitions'],
    ['s3api', 'get-object'],
    ['secretsmanager', 'get-secret-value']
  ];
  for (const args of writes) assert.throws(() => assertReadOnlyAwsCall(args), ReadOnlyViolation, args.join(' '));

  assert.throws(() => assertReadOnlyAwsCall(['ssm', 'get-parameter', '--name', '/scope/prod/api/JWT_SECRET', '--no-with-decryption']), ReadOnlyViolation);
  assert.throws(() => assertReadOnlyAwsCall(['ssm', 'get-parameter', '--name', BLOCKCHAIN_MODE_PARAMETER]), ReadOnlyViolation);
  assert.throws(() => assertReadOnlyAwsCall(['ssm', 'get-parameter', '--name', BLOCKCHAIN_MODE_PARAMETER, '--with-decryption', '--no-with-decryption']), ReadOnlyViolation);

  let executed = false;
  const runner = createAwsRunner({ execFile: () => { executed = true; return '{}'; } });
  assert.throws(() => runner(['ecs', 'update-service']), ReadOnlyViolation);
  assert.equal(executed, false, 'una operacion prohibida nunca debe llegar a ejecutarse');
});

test('el ejecutor real fija region, formato y, si se pide, perfil; nunca otra region', () => {
  let captured;
  const runner = createAwsRunner({ profile: 'mi-perfil', execFile: (cmd, args) => { captured = { cmd, args }; return '{"Arn":"x"}'; } });
  runner(['sts', 'get-caller-identity']);
  assert.equal(captured.cmd, 'aws');
  assert.deepEqual(captured.args.slice(0, 2), ['sts', 'get-caller-identity']);
  assert.ok(captured.args.includes('us-east-1'));
  assert.ok(captured.args.includes('mi-perfil'));
});

test('el informe no imprime ids de cuenta ni nombres de secretos con valor', () => {
  const r = runCase({ tfvars: { ...GOOD_TFVARS, web_origin: 'https://otro.example-fixture.com' } });
  assert.doesNotMatch(r.out + r.err, /\d{12}/);
  assert.match(r.out, /<ACCT>/);
});

// ---------------------------------------------------------------------------
// Recuperacion de contrasena
// ---------------------------------------------------------------------------

test('antes del primer despliegue de recuperacion es solo INFORMATIVO', () => {
  const r = runCase();
  assert.match(r.out, /INFO\s+recuperacion de contrasena/);
  assert.equal(r.code, 0);
});

test('despues del despliegue se compara: MAIL_TRANSPORT, TRUST_PROXY_HOPS, RESEND_API_KEY', () => {
  const live = healthyAws({
    apiEnv: { WEB_ORIGIN: 'https://web.example-fixture.com', PROFILE_EMBEDDINGS_ENABLED: 'true', MAIL_TRANSPORT: 'disabled', TRUST_PROXY_HOPS: '1', WEB_PUBLIC_BASE_URL: '' }
  });
  assert.equal(runCase({ aws: live }).code, 0);

  const resendLive = healthyAws({ ...live, apiEnv: { ...live.apiEnv, MAIL_TRANSPORT: 'resend' }, apiSecrets: [...live.apiSecrets, 'RESEND_API_KEY'] });
  const r = runCase({ aws: resendLive });
  assert.equal(r.code, 1, 'tfvars dice disabled y AWS ya esta en resend');
  assert.match(r.out, /DIFF\s+recuperacion: MAIL_TRANSPORT/);

  const wrongHops = healthyAws({ ...live, apiEnv: { ...live.apiEnv, TRUST_PROXY_HOPS: '0' } });
  assert.match(runCase({ aws: wrongHops }).out, /DIFF\s+recuperacion: TRUST_PROXY_HOPS/);
});

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

test('parseTfvars: cadenas, numeros, booleanos, comentarios y espacios', () => {
  const v = parseTfvars(`# comentario\n a = "x y" # inline\nb = 3\n c = true\nd = false // otro\nbad line\ne = "q"\n`);
  assert.deepEqual(v, { a: 'x y', b: 3, c: true, d: false, e: 'q' });
});

test('el ultimo tfvars gana, como en Terraform', () => {
  const out = [];
  const files = { 'a.tfvars': tfvarsText(GOOD_TFVARS), 'b.tfvars': 'api_desired_count = 0\nenable_services = false' };
  const code = main({ tfvarsFiles: ['a.tfvars', 'b.tfvars'], readFile: (f) => files[f], runAws: fakeAws(healthyAws()), out: (l) => out.push(l), err: () => {} });
  assert.equal(code, 1);
});

test('imageTag / imageDigest', () => {
  assert.equal(imageTag(`${ECR}/scope/api:${API_TAG}`, 'scope/api'), API_TAG);
  assert.equal(imageTag(`${ECR}/scope/api@${PROV_DIGEST}`, 'scope/api'), null);
  assert.equal(imageTag(`${ECR}/scope/ai:${AI_TAG}`, 'scope/api'), null);
  assert.equal(imageDigest(`${ECR}/scope/api@${PROV_DIGEST}`, 'scope/api'), PROV_DIGEST);
});

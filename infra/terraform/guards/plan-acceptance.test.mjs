// Pruebas del verificador de aceptacion con planes SINTETICOS (no son planes reales).
// Ejecutar: node --test infra/terraform/guards/plan-acceptance.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { API_SERVICE, API_TASK_DEF, evaluate, main } from './plan-acceptance.mjs';

const BASE_ENV = { WEB_ORIGIN: 'https://web.example-fixture.com', PORT: '3000', PROFILE_EMBEDDINGS_ENABLED: 'true' };
const SECRETS = ['DATABASE_URL', 'JWT_SECRET', 'CREDENTIAL_REGISTRY_RPC_URL'];
const RECOVERY = { WEB_PUBLIC_BASE_URL: '', MAIL_TRANSPORT: 'disabled', MAIL_FROM: 'Scope <no-responder@mail.scopeedu.technology>', TRUST_PROXY_HOPS: '1' };

const container = (env, secrets, image = 'acct.dkr.ecr.us-east-1.amazonaws.com/scope/api:IMG-OLD') =>
  JSON.stringify([{ name: 'api', image, environment: Object.entries(env).map(([name, value]) => ({ name, value })), secrets: secrets.map((name) => ({ name, valueFrom: `arn:x:${name}` })) }]);

const taskDefChange = ({ beforeEnv = BASE_ENV, afterEnv = { ...BASE_ENV, ...RECOVERY }, beforeSecrets = SECRETS, afterSecrets = SECRETS, beforeImage, afterImage } = {}) => ({
  address: API_TASK_DEF,
  type: 'aws_ecs_task_definition',
  change: {
    actions: ['delete', 'create'],
    before: { cpu: '512', memory: '1024', container_definitions: container(beforeEnv, beforeSecrets, beforeImage) },
    after: { cpu: '512', memory: '1024', container_definitions: container(afterEnv, afterSecrets, afterImage) },
    after_unknown: { arn: true, revision: true }
  }
});

const serviceChange = (over = {}) => ({
  address: API_SERVICE,
  type: 'aws_ecs_service',
  change: {
    actions: ['update'],
    before: { desired_count: 1, deployment_minimum_healthy_percent: 0, deployment_maximum_percent: 100, task_definition: 'td:11' },
    after: { desired_count: 1, deployment_minimum_healthy_percent: 0, deployment_maximum_percent: 100, task_definition: 'td:12', ...over },
    after_unknown: {}
  }
});

const noop = (address) => ({ address, change: { actions: ['no-op'], before: {}, after: {} } });
const planOf = (...rcs) => ({ format_version: '1.2', resource_changes: [noop('aws_db_instance.main[0]'), noop('aws_ecs_service.ai[0]'), ...rcs] });
const good = () => planOf(taskDefChange(), serviceChange());

const integrated = (plan, opts) => evaluate({ plan, mode: 'integrated', ...opts });
const reasons = (plan, opts) => integrated(plan, opts).reasons.join(' | ');

// ---- baseline ---------------------------------------------------------------
test('baseline: "No changes" es aceptable', () => {
  assert.deepEqual(evaluate({ plan: planOf(), mode: 'baseline' }).reasons, []);
});

test('baseline: cualquier cambio se rechaza, incluso uno que parece inocuo', () => {
  assert.ok(evaluate({ plan: planOf(serviceChange()), mode: 'baseline' }).reasons.length > 0);
  const r = evaluate({ plan: planOf({ address: 'aws_db_instance.main[0]', change: { actions: ['delete', 'create'] } }), mode: 'baseline' });
  assert.match(r.reasons.join(), /DESTRUCTIVO/);
});

test('baseline: los data sources (read) y no-op no cuentan como cambios', () => {
  assert.deepEqual(evaluate({ plan: planOf({ address: 'data.aws_caller_identity.current', change: { actions: ['read'] } }), mode: 'baseline' }).reasons, []);
});

// ---- integrated: lo esperado --------------------------------------------------
test('integrated: solo task definition de la API (+4 variables) y su servicio -> aceptable', () => {
  assert.deepEqual(integrated(good()).reasons, []);
});

test('integrated: el cambio de imagen solo se acepta con la autorizacion explicita', () => {
  const plan = planOf(taskDefChange({ afterImage: 'acct.dkr.ecr.us-east-1.amazonaws.com/scope/api:IMG-NEW' }), serviceChange());
  assert.match(reasons(plan), /cambia la imagen/);
  assert.deepEqual(integrated(plan, { allowApiImageChange: true }).reasons, []);
});

// ---- integrated: rechazos criticos ---------------------------------------------
test('rechaza desired_count distinto de 1 (API)', () => {
  assert.match(reasons(planOf(taskDefChange(), serviceChange({ desired_count: 0 }))), /desired_count/);
});

test('rechaza que la API deje de ser 0/100', () => {
  assert.match(reasons(planOf(taskDefChange(), serviceChange({ deployment_minimum_healthy_percent: 100, deployment_maximum_percent: 200 }))), /0\/100/);
});

test('rechaza cualquier cambio en la IA (servicio, task definition)', () => {
  const ai = { address: 'aws_ecs_service.ai[0]', change: { actions: ['update'], before: { desired_count: 1 }, after: { desired_count: 0 } } };
  assert.match(reasons(planOf(taskDefChange(), serviceChange(), ai)), /aws_ecs_service\.ai\[0\]/);
  const aiTd = { address: 'aws_ecs_task_definition.ai', change: { actions: ['delete', 'create'] } };
  assert.match(reasons(planOf(taskDefChange(), serviceChange(), aiTd)), /aws_ecs_task_definition\.ai/);
});

test('rechaza la desaparicion del secreto de blockchain', () => {
  const plan = planOf(taskDefChange({ afterSecrets: ['DATABASE_URL', 'JWT_SECRET'] }), serviceChange());
  assert.match(reasons(plan), /DESAPARECE el secreto CREDENTIAL_REGISTRY_RPC_URL/);
});

test('rechaza que desaparezca o cambie una variable existente (p. ej. WEB_ORIGIN)', () => {
  const { WEB_ORIGIN, ...rest } = BASE_ENV;
  void WEB_ORIGIN;
  assert.match(reasons(planOf(taskDefChange({ afterEnv: { ...rest, ...RECOVERY } }), serviceChange())), /desaparece la variable de entorno WEB_ORIGIN/);
  assert.match(reasons(planOf(taskDefChange({ afterEnv: { ...BASE_ENV, WEB_ORIGIN: '', ...RECOVERY } }), serviceChange())), /cambia el valor de la variable existente WEB_ORIGIN/);
});

test('rechaza variables nuevas no esperadas o que falte alguna de las 4', () => {
  assert.match(reasons(planOf(taskDefChange({ afterEnv: { ...BASE_ENV, ...RECOVERY, SURPRISE: '1' } }), serviceChange())), /NO esperada: SURPRISE/);
  const { MAIL_FROM, ...partial } = RECOVERY;
  void MAIL_FROM;
  assert.match(reasons(planOf(taskDefChange({ afterEnv: { ...BASE_ENV, ...partial } }), serviceChange())), /falta agregar MAIL_FROM/);
});

test('rechaza Resend activo o referenciado en el plan "deshabilitado"', () => {
  assert.match(reasons(planOf(taskDefChange({ afterEnv: { ...BASE_ENV, ...RECOVERY, MAIL_TRANSPORT: 'resend' } }), serviceChange())), /MAIL_TRANSPORT no es "disabled"/);
  assert.match(reasons(planOf(taskDefChange({ afterSecrets: [...SECRETS, 'RESEND_API_KEY'] }), serviceChange())), /secreto nuevo RESEND_API_KEY/);
});

test('rechaza TRUST_PROXY_HOPS distinto de 1', () => {
  assert.match(reasons(planOf(taskDefChange({ afterEnv: { ...BASE_ENV, ...RECOVERY, TRUST_PROXY_HOPS: '0' } }), serviceChange())), /TRUST_PROXY_HOPS no es "1"/);
});

test('rechaza destruccion o cambio de recursos ajenos (RDS, ACM, DNS, IAM, provisioner, sonda)', () => {
  for (const address of ['aws_db_instance.main[0]', 'aws_acm_certificate.api[0]', 'aws_route53_record.api[0]', 'aws_iam_role.execution["api"]', 'aws_ecs_task_definition.provisioner', 'aws_sfn_state_machine.ecs_sync_probe[0]', 'aws_lb.api']) {
    const r = reasons(planOf(taskDefChange(), serviceChange(), { address, change: { actions: ['update'] } }));
    assert.match(r, /NO permitido/, address);
    const d = reasons(planOf(taskDefChange(), serviceChange(), { address, change: { actions: ['delete'] } }));
    assert.match(d, /DESTRUCCION/, address);
  }
});

test('rechaza que se creen las alarmas mientras estan apagadas', () => {
  const plan = planOf(taskDefChange(), serviceChange(), { address: 'aws_cloudwatch_metric_alarm.recovery["global_cap"]', change: { actions: ['create'] } });
  const r = reasons(plan);
  assert.match(r, /alarmas deben seguir apagadas/);
});

test('rechaza que falten el cambio de la task definition o del servicio', () => {
  assert.match(reasons(planOf(serviceChange())), /no aparece aws_ecs_task_definition\.api/);
  assert.match(reasons(planOf(taskDefChange())), /no aparece aws_ecs_service\.api\[0\]/);
});

test('rechaza que el servicio cambie algo ademas de task_definition', () => {
  assert.match(reasons(planOf(taskDefChange(), serviceChange({ health_check_grace_period_seconds: 0 }))), /cambia health_check_grace_period_seconds/);
});

// ---- entrada invalida -----------------------------------------------------------
test('entrada que no es un plan: no se evalua (exit 2), nunca "aceptable"', () => {
  const out = [];
  const err = [];
  const code = main({ argv: ['--mode', 'integrated', '--plan', 'x.json'], readFile: () => '{"hola":1}', out: (l) => out.push(l), err: (l) => err.push(l) });
  assert.equal(code, 2);
  assert.match(err.join(), /resource_changes/);
  assert.equal(main({ argv: ['--mode', 'integrated', '--plan', 'x.json'], readFile: () => 'no es json', out() {}, err() {} }), 2);
  assert.equal(main({ argv: ['--mode', 'otro', '--plan', 'x.json'], readFile: () => JSON.stringify(good()), out() {}, err() {} }), 2);
});

test('exit codes del CLI y el aviso de que no autoriza un apply; no imprime valores', () => {
  const lines = [];
  const code = main({ argv: ['--mode', 'integrated', '--plan', 'p.json'], readFile: () => JSON.stringify(good()), out: (l) => lines.push(l), err() {} });
  assert.equal(code, 0);
  const text = lines.join('\n');
  assert.match(text, /no sustituye la lectura humana/);
  assert.doesNotMatch(text, /https:\/\/web\.example-fixture\.com|arn:x:/, 'no debe imprimir valores de entorno ni ARN de secretos');
  const bad = main({ argv: ['--mode', 'baseline', '--plan', 'p.json'], readFile: () => JSON.stringify(good()), out() {}, err() {} });
  assert.equal(bad, 1);
});

// ---- chequeos de valor absoluto (no solo "cambio respecto de antes") ----------------
test('rechaza una API que YA estaba en desired_count 0 aunque el plan no lo cambie', () => {
  const plan = planOf(taskDefChange(), {
    ...serviceChange(),
    change: { ...serviceChange().change, before: { desired_count: 0, deployment_minimum_healthy_percent: 0, deployment_maximum_percent: 100, task_definition: 'td:11' }, after: { desired_count: 0, deployment_minimum_healthy_percent: 0, deployment_maximum_percent: 100, task_definition: 'td:12' } }
  });
  assert.match(reasons(plan), /desired_count debe quedar en 1/);
});

test('rechaza desired_count 0 de la IA aun si el plan la marca sin cambios', () => {
  const plan = { format_version: '1.2', resource_changes: [{ address: 'aws_ecs_service.ai[0]', change: { actions: ['no-op'], before: { desired_count: 0 }, after: { desired_count: 0 } } }, taskDefChange(), serviceChange()] };
  assert.match(reasons(plan), /aws_ecs_service\.ai\[0\]: desired_count debe quedar en 1/);
});

// =============================================================================================
// migrator-only
// =============================================================================================
import { MIGRATOR_TASK_DEF, Unevaluable } from './plan-acceptance.mjs';

const REPO = 'acct.dkr.ecr.us-east-1.amazonaws.com/scope/api';
const TAG_OLD = '0123456789abcdef0123456789abcdef01234567';
const TAG_NEW = '3f9c1d2e4a5b60718293a4b5c6d7e8f901234567';

const migratorContainer = (tag, noise) => ({
  name: 'migrator',
  image: `${REPO}:${tag}`,
  essential: true,
  entryPoint: ['/app/services/api/docker/migrator-entrypoint.sh'],
  command: ['npx', 'prisma', 'migrate', 'deploy'],
  environment: [{ name: 'AWS_REGION', value: 'us-east-1' }, { name: 'DB_HOST', value: 'db.example-fixture.internal' }],
  secrets: [{ name: 'DB_SECRET', valueFrom: 'arn:aws:secretsmanager:us-east-1:111111111111:secret:fixture' }],
  logConfiguration: { logDriver: 'awslogs', options: { 'awslogs-group': '/scope/prod/migrator', 'awslogs-region': 'us-east-1', 'awslogs-stream-prefix': 'ecs' } },
  // Lo que la API de ECS agrega al leer y la configuracion no declara: ruido de normalizacion.
  ...(noise ? { mountPoints: [], systemControls: [], volumesFrom: [] } : {})
});

const migratorAttrs = (extra = {}) => ({
  family: 'scope-prod-migrator', cpu: '512', memory: '1024', network_mode: 'awsvpc',
  requires_compatibilities: ['FARGATE'], execution_role_arn: 'arn:aws:iam::111111111111:role/scope-prod-migrator-execution',
  task_role_arn: 'arn:aws:iam::111111111111:role/scope-prod-migrator-task',
  runtime_platform: [{ cpu_architecture: 'X86_64', operating_system_family: 'LINUX' }],
  tags: {}, tags_all: { Project: 'scope' }, ...extra
});

/** Plan sintetico del reemplazo esperado; `mutate(spec)` lo altera para los casos negativos. */
function migratorPlan(mutate = () => {}) {
  const spec = {
    actions: ['delete', 'create'],
    replace_paths: [['container_definitions']],
    beforeAttrs: migratorAttrs({ ipc_mode: '', pid_mode: '' }),
    afterAttrs: migratorAttrs({ ipc_mode: null, pid_mode: null }),
    beforeContainers: [migratorContainer(TAG_OLD, true)],
    afterContainers: [migratorContainer(TAG_NEW, false)],
    after_unknown: { id: true, arn: true, arn_without_revision: true, revision: true, enable_fault_injection: true },
    extraChanges: [],
    plan: {},
    omitMigrator: false
  };
  mutate(spec);
  const rc = {
    address: MIGRATOR_TASK_DEF,
    type: 'aws_ecs_task_definition',
    change: {
      actions: spec.actions,
      replace_paths: spec.replace_paths,
      before: { ...spec.beforeAttrs, container_definitions: JSON.stringify(spec.beforeContainers) },
      after: { ...spec.afterAttrs, container_definitions: JSON.stringify(spec.afterContainers) },
      after_unknown: spec.after_unknown
    }
  };
  return { format_version: '1.2', resource_changes: [noop('aws_db_instance.main[0]'), noop('aws_ecs_service.api[0]'), ...(spec.omitMigrator ? [] : [rc]), ...spec.extraChanges], ...spec.plan };
}

const mo = (plan, tag = TAG_NEW) => evaluate({ plan, mode: 'migrator-only', expectedImageTag: tag });
const moReasons = (plan, tag) => mo(plan, tag).reasons.join(' | ');
const changeOf = (address, actions) => ({ address, change: { actions, before: {}, after: {} } });

test('migrator-only: el reemplazo esperado (solo la imagen) es aceptable', () => {
  const r = mo(migratorPlan());
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(r.changes, [`${MIGRATOR_TASK_DEF} [delete+create]`]);
  assert.match(r.notes.join(' '), /autorizada/);
});

test('migrator-only: acepta create+delete, el ruido de normalizacion y los atributos calculados desconocidos', () => {
  assert.deepEqual(mo(migratorPlan((s) => { s.actions = ['create', 'delete']; })).reasons, []);
  assert.deepEqual(mo(migratorPlan((s) => { s.after_unknown = { ...s.after_unknown, requires_compatibilities: true, runtime_platform: [{}] }; })).reasons, []);
});

const NEGATIVES = [
  ['otro recurso: task definition de la API', (s) => s.extraChanges.push(changeOf('aws_ecs_task_definition.api', ['delete', 'create'])), /aws_ecs_task_definition\.api/],
  ['otro recurso: servicio de la API', (s) => s.extraChanges.push(changeOf('aws_ecs_service.api[0]', ['update'])), /aws_ecs_service\.api\[0\]/],
  ['otro recurso: servicio de IA', (s) => s.extraChanges.push(changeOf('aws_ecs_service.ai[0]', ['update'])), /aws_ecs_service\.ai\[0\]/],
  ['otro recurso: RDS destruido', (s) => s.extraChanges.push(changeOf('aws_db_instance.main[0]', ['delete'])), /DESTRUCTIVO/],
  ['otro recurso: IAM', (s) => s.extraChanges.push(changeOf('aws_iam_role.migrator_task', ['update'])), /aws_iam_role/],
  ['otro recurso: security group', (s) => s.extraChanges.push(changeOf('aws_security_group.api', ['update'])), /aws_security_group/],
  ['otro recurso: alarma nueva', (s) => s.extraChanges.push(changeOf('aws_cloudwatch_metric_alarm.recovery["x"]', ['create'])), /aws_cloudwatch_metric_alarm/],
  ['migrador actualizado en el sitio', (s) => { s.actions = ['update']; s.replace_paths = []; }, /debe ser un reemplazo/],
  ['migrador solo destruido', (s) => { s.actions = ['delete']; }, /debe ser un reemplazo/],
  ['migrador solo creado', (s) => { s.actions = ['create']; }, /debe ser un reemplazo/],
  ['otro repositorio de imagen', (s) => { s.afterContainers[0].image = `other.dkr.ecr.us-east-1.amazonaws.com/scope/ai:${TAG_NEW}`; }, /repositorio/],
  ['tag distinto del autorizado', (s) => { s.afterContainers[0].image = `${REPO}:${'0'.repeat(40)}`; }, /no es el autorizado/],
  ['tag que no cambia', (s) => { s.afterContainers[0].image = `${REPO}:${TAG_OLD}`; }, /no es el autorizado|no cambia de tag/],
  ['imagen por digest', (s) => { s.afterContainers[0].image = `${REPO}@sha256:${'a'.repeat(64)}`; }, /sin digest/],
  ['variable de entorno agregada', (s) => s.afterContainers[0].environment.push({ name: 'EXTRA', value: '1' }), /environment/],
  ['variable de entorno quitada', (s) => s.afterContainers[0].environment.pop(), /environment/],
  ['valor de variable cambiado', (s) => { s.afterContainers[0].environment[0].value = 'eu-west-1'; }, /environment/],
  ['secreto cambiado (valueFrom)', (s) => { s.afterContainers[0].secrets[0].valueFrom = 'arn:aws:secretsmanager:us-east-1:111111111111:secret:otro'; }, /secrets/],
  ['secreto agregado', (s) => s.afterContainers[0].secrets.push({ name: 'JWT_SECRET', valueFrom: 'arn:x' }), /secrets/],
  ['command cambiado', (s) => { s.afterContainers[0].command = ['npx', 'prisma', 'migrate', 'reset', '--force']; }, /command/],
  ['entryPoint cambiado', (s) => { s.afterContainers[0].entryPoint = ['/bin/sh']; }, /entryPoint/],
  ['logConfiguration cambiada', (s) => { s.afterContainers[0].logConfiguration.options['awslogs-group'] = '/otro'; }, /logConfiguration/],
  ['clave nueva en el contenedor', (s) => { s.afterContainers[0].privileged = true; }, /privileged/],
  ['mountPoints no vacio (no es ruido)', (s) => { s.afterContainers[0].mountPoints = [{ sourceVolume: 'v', containerPath: '/x' }]; }, /mountPoints/],
  ['segundo contenedor', (s) => s.afterContainers.push({ name: 'sidecar', image: 'x:1' }), /exactamente un contenedor/],
  ['contenedor renombrado', (s) => { s.afterContainers[0].name = 'api'; }, /llamarse "migrator"/],
  ['cpu cambiada', (s) => { s.afterAttrs.cpu = '1024'; }, /cambia cpu/],
  ['memory cambiada', (s) => { s.afterAttrs.memory = '2048'; }, /cambia memory/],
  ['family cambiada', (s) => { s.afterAttrs.family = 'otra'; }, /cambia family/],
  ['rol de ejecucion cambiado', (s) => { s.afterAttrs.execution_role_arn = 'arn:aws:iam::111111111111:role/otro'; }, /execution_role_arn/],
  ['rol de tarea cambiado', (s) => { s.afterAttrs.task_role_arn = 'arn:aws:iam::111111111111:role/otro'; }, /task_role_arn/],
  ['arquitectura cambiada', (s) => { s.afterAttrs.runtime_platform = [{ cpu_architecture: 'ARM64', operating_system_family: 'LINUX' }]; }, /runtime_platform/],
  ['volumen agregado', (s) => { s.afterAttrs.volume = [{ name: 'v' }]; }, /volume/],
  ['etiquetas cambiadas', (s) => { s.afterAttrs.tags_all = { Project: 'otro' }; }, /tags_all/],
  ['cpu desconocida hasta el apply', (s) => { s.after_unknown.cpu = true; }, /cpu queda desconocido/],
  ['replace_paths con otra ruta', (s) => { s.replace_paths = [['cpu']]; }, /replace_paths/],
  ['replace_paths ausente', (s) => { s.replace_paths = undefined; }, /replace_paths/],
  ['output que cambia', (s) => { s.plan.output_changes = { password_recovery_configuration: { actions: ['create'] } }; }, /output password_recovery_configuration/],
  ['sin el migrador en el plan', (s) => { s.omitMigrator = true; }, /no aparece/],
  ['migrator_image_tag del plan distinto del autorizado', (s) => { s.plan.variables = { migrator_image_tag: { value: TAG_OLD } }; }, /migrator_image_tag/]
];

for (const [name, mutate, pattern] of NEGATIVES) {
  test(`migrator-only rechaza: ${name}`, () => {
    const reasonsText = moReasons(migratorPlan(mutate));
    assert.notEqual(reasonsText, '', 'debia rechazarse');
    assert.match(reasonsText, pattern);
  });
}

test('migrator-only: la variable migrator_image_tag coincidente es aceptable', () => {
  assert.deepEqual(mo(migratorPlan((s) => { s.plan.variables = { migrator_image_tag: { value: TAG_NEW } }; })).reasons, []);
});

test('migrator-only: sin --expected-image-tag valido el plan NO SE EVALUA (excepcion)', () => {
  for (const tag of [undefined, '', 'latest', TAG_NEW.slice(0, 12), TAG_NEW.toUpperCase(), `${TAG_NEW}0`, ` ${TAG_NEW}`]) {
    assert.throws(() => evaluate({ plan: migratorPlan(), mode: 'migrator-only', expectedImageTag: tag }), Unevaluable, `tag=${JSON.stringify(tag)}`);
  }
});

test('migrator-only: --allow-api-image-change no es valido en este modo y --expected-image-tag no es valido fuera', () => {
  assert.throws(() => evaluate({ plan: migratorPlan(), mode: 'migrator-only', expectedImageTag: TAG_NEW, allowApiImageChange: true }), Unevaluable);
  assert.throws(() => evaluate({ plan: planOf(), mode: 'baseline', expectedImageTag: TAG_NEW }), Unevaluable);
  assert.throws(() => evaluate({ plan: good(), mode: 'integrated', expectedImageTag: TAG_NEW }), Unevaluable);
});

test('migrator-only: modo desconocido y plan ilegible no se evaluan', () => {
  assert.throws(() => evaluate({ plan: migratorPlan(), mode: 'migrator_only', expectedImageTag: TAG_NEW }), Unevaluable);
  assert.throws(() => mo({ resource_changes: 'no' }), Unevaluable);
  const broken = migratorPlan();
  broken.resource_changes.find((r) => r.address === MIGRATOR_TASK_DEF).change.after.container_definitions = '{no es json';
  assert.throws(() => mo(broken), Unevaluable);
});

test('migrator-only: no imprime valores (ni de variables ni de secretos) en los motivos', () => {
  const text = moReasons(migratorPlan((s) => {
    s.afterContainers[0].environment[1].value = 'VALOR-SENSIBLE-123';
    s.afterContainers[0].secrets[0].valueFrom = 'arn:aws:secretsmanager:us-east-1:111111111111:secret:SECRETO-XYZ';
  }));
  assert.doesNotMatch(text, /VALOR-SENSIBLE-123|SECRETO-XYZ|db\.example-fixture/);
});

// ---- CLI -------------------------------------------------------------------------------------
const runCli = (argv, plan) => {
  const lines = [];
  const errors = [];
  const code = main({ argv, readFile: () => (typeof plan === 'string' ? plan : JSON.stringify(plan)), out: (l) => lines.push(l), err: (l) => errors.push(l) });
  return { code, text: lines.join('\n'), errors: errors.join('\n') };
};

test('CLI migrator-only: exit 0 con el plan esperado, 1 con un cambio extra, 2 sin tag o con argumentos invalidos', () => {
  const ok = runCli(['--mode', 'migrator-only', '--expected-image-tag', TAG_NEW, '--plan', 'p.json'], migratorPlan());
  assert.equal(ok.code, 0);
  assert.match(ok.text, /ACEPTABLE: solo la nueva revision del migrador/);

  const extra = runCli(['--mode', 'migrator-only', '--expected-image-tag', TAG_NEW, '--plan', 'p.json'], migratorPlan((s) => s.extraChanges.push(changeOf('aws_ecs_service.api[0]', ['update']))));
  assert.equal(extra.code, 1);
  assert.match(extra.text, /RECHAZADO/);

  assert.equal(runCli(['--mode', 'migrator-only', '--plan', 'p.json'], migratorPlan()).code, 2);
  assert.equal(runCli(['--mode', 'migrator-only', '--expected-image-tag', 'latest', '--plan', 'p.json'], migratorPlan()).code, 2);
  assert.equal(runCli(['--mode', 'migrator-only', '--expected-image-tag', TAG_NEW, '--allow-api-image-change', '--plan', 'p.json'], migratorPlan()).code, 2);
  assert.equal(runCli(['--mode', 'baseline', '--expected-image-tag', TAG_NEW, '--plan', 'p.json'], planOf()).code, 2);
  assert.equal(runCli(['--mode', 'migrator-only', '--expected-image-tag', TAG_NEW, '--plan', 'p.json'], '{malformado').code, 2);
});

// ---- no regresion: baseline e integrated siguen rechazando un cambio del migrador -----------------
test('no regresion: baseline rechaza el reemplazo del migrador', () => {
  const r = evaluate({ plan: migratorPlan(), mode: 'baseline' });
  assert.match(r.reasons.join(' | '), /aws_ecs_task_definition\.migrator/);
});

test('no regresion: integrated rechaza un cambio del migrador junto al cambio esperado de la API', () => {
  const withMigrator = planOf(taskDefChange(), serviceChange(), migratorPlan().resource_changes.find((r) => r.address === MIGRATOR_TASK_DEF));
  assert.match(reasons(withMigrator, { allowApiImageChange: true }), /cambio NO permitido en aws_ecs_task_definition\.migrator/);
});

test('no regresion: integrated sigue aceptando su plan esperado y baseline "No changes"', () => {
  assert.deepEqual(integrated(good()).reasons, []);
  assert.deepEqual(evaluate({ plan: planOf(), mode: 'baseline' }).reasons, []);
});

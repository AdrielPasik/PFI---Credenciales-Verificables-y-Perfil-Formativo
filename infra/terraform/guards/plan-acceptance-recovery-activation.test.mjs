// Pruebas del modo `recovery-activation` de plan-acceptance con planes SINTETICOS (no son planes reales).
// Ejecutar: node --test infra/terraform/guards/plan-acceptance-recovery-activation.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  API_EXECUTION_POLICY,
  API_SERVICE,
  API_TASK_DEF,
  OUTPUT_PARAMETERS_OUT_OF_BAND,
  OUTPUT_RECOVERY_CONFIGURATION,
  RECOVERY_ACTIVATION,
  evaluate,
  main
} from './plan-acceptance.mjs';

const ACCT = '111122223333';
const OTHER_ACCT = '999988887777';
const IMAGE = `${ACCT}.dkr.ecr.us-east-1.amazonaws.com/scope/api:IMG`;
const PREFIX = `arn:aws:ssm:us-east-1:${ACCT}:parameter`;
const RESEND_ARN = `${PREFIX}/scope/prod/api/RESEND_API_KEY`;
const SECRETS = { DATABASE_URL: `${PREFIX}/scope/prod/api/DATABASE_URL`, JWT_SECRET: `${PREFIX}/scope/prod/api/JWT_SECRET`, CREDENTIAL_REGISTRY_RPC_URL: `${PREFIX}/scope/prod/api/CREDENTIAL_REGISTRY_RPC_URL` };
const BASE_ENV = { WEB_ORIGIN: 'https://scopeedu.technology', PORT: '3000', TRUST_PROXY_HOPS: '1', MAIL_FROM: RECOVERY_ACTIVATION.mailFrom };
const BEFORE_ENV = { ...BASE_ENV, WEB_PUBLIC_BASE_URL: '', MAIL_TRANSPORT: 'disabled' };
const AFTER_ENV = { ...BASE_ENV, WEB_PUBLIC_BASE_URL: RECOVERY_ACTIVATION.webPublicBaseUrl, MAIL_TRANSPORT: 'resend' };

const container = ({ env, secrets, image = IMAGE, extra = {} }) =>
  JSON.stringify([{
    name: 'api',
    image,
    essential: true,
    environment: Object.entries(env).map(([name, value]) => ({ name, value })),
    secrets: Object.entries(secrets).map(([name, valueFrom]) => ({ name, valueFrom })),
    mountPoints: [],
    ...extra
  }]);

const taskDef = (over = {}) => {
  const o = {
    actions: ['create', 'delete'],
    replace_paths: [['container_definitions']],
    beforeEnv: BEFORE_ENV,
    afterEnv: AFTER_ENV,
    beforeSecrets: SECRETS,
    afterSecrets: { ...SECRETS, RESEND_API_KEY: RESEND_ARN },
    beforeImage: IMAGE,
    afterImage: IMAGE,
    afterExtra: {},
    attrs: {},
    ...over
  };
  return {
    address: API_TASK_DEF,
    type: 'aws_ecs_task_definition',
    change: {
      actions: o.actions,
      replace_paths: o.replace_paths,
      before: { cpu: '512', memory: '1024', execution_role_arn: 'arn:role/exec', task_role_arn: 'arn:role/task', container_definitions: container({ env: o.beforeEnv, secrets: o.beforeSecrets, image: o.beforeImage }) },
      after: { cpu: '512', memory: '1024', execution_role_arn: 'arn:role/exec', task_role_arn: 'arn:role/task', ...o.attrs, container_definitions: container({ env: o.afterEnv, secrets: o.afterSecrets, image: o.afterImage, extra: o.afterExtra }) },
      after_unknown: { arn: true, revision: true, id: true }
    }
  };
};

const service = (over = {}, change = {}) => ({
  address: API_SERVICE,
  type: 'aws_ecs_service',
  change: {
    actions: ['update'],
    before: { desired_count: 1, deployment_minimum_healthy_percent: 0, deployment_maximum_percent: 100, task_definition: 'td:12' },
    after: { desired_count: 1, deployment_minimum_healthy_percent: 0, deployment_maximum_percent: 100, task_definition: 'td:13', ...over },
    after_unknown: { task_definition: true },
    ...change
  }
});

const PARAMS = [`${PREFIX}/scope/prod/api/DATABASE_URL`, `${PREFIX}/scope/prod/api/JWT_SECRET`];
const stmt = (resources, over = {}) => ({ Sid: 'ReadOwnParametersOnly', Effect: 'Allow', Action: 'ssm:GetParameters', Resource: resources, ...over });
const policyDoc = (statements) => JSON.stringify({ Version: '2012-10-17', Statement: statements });
const STATIC = [
  { Sid: 'EcrAuthorizationToken', Effect: 'Allow', Action: 'ecr:GetAuthorizationToken', Resource: '*' },
  { Sid: 'PullOwnImageOnly', Effect: 'Allow', Action: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer'], Resource: 'arn:aws:ecr:us-east-1:111122223333:repository/scope/api' }
];

const policy = ({ beforeStatements = [...STATIC, stmt(PARAMS)], afterStatements = [...STATIC, stmt([...PARAMS, RESEND_ARN])], actions = ['update'], attrs = {}, unknown = {} } = {}) => ({
  address: API_EXECUTION_POLICY,
  type: 'aws_iam_role_policy',
  change: {
    actions,
    before: { name: 'exec', role: 'scope-prod-api-execution', policy: policyDoc(beforeStatements) },
    after: { name: 'exec', role: 'scope-prod-api-execution', policy: policyDoc(afterStatements), ...attrs },
    after_unknown: unknown
  }
});

const noop = (address) => ({ address, change: { actions: ['no-op'], before: {}, after: {} } });
const OUT_PARAMS_BEFORE = ['/scope/prod/api/DATABASE_URL', '/scope/prod/api/JWT_SECRET'];
const outputs = (over = {}) => ({
  [OUTPUT_RECOVERY_CONFIGURATION]: {
    actions: ['update'],
    before: { api_image_tag: 'IMG', mail_from: RECOVERY_ACTIVATION.mailFrom, mail_transport: 'disabled', migrator_image_tag: 'IMG', recovery_alarms_active: false, resend_secret_name: null, trust_proxy_hops: '1', web_origin_cors: 'https://scopeedu.technology', web_public_base_url: null },
    after: { api_image_tag: 'IMG', mail_from: RECOVERY_ACTIVATION.mailFrom, mail_transport: 'resend', migrator_image_tag: 'IMG', recovery_alarms_active: false, resend_secret_name: RECOVERY_ACTIVATION.resendParameterName, trust_proxy_hops: '1', web_origin_cors: 'https://scopeedu.technology', web_public_base_url: RECOVERY_ACTIVATION.webPublicBaseUrl },
    ...over[OUTPUT_RECOVERY_CONFIGURATION]
  },
  [OUTPUT_PARAMETERS_OUT_OF_BAND]: {
    actions: ['update'],
    before: OUT_PARAMS_BEFORE,
    after: [...OUT_PARAMS_BEFORE, RECOVERY_ACTIVATION.resendParameterName],
    ...over[OUTPUT_PARAMETERS_OUT_OF_BAND]
  },
  alb_dns_name: { actions: ['no-op'], before: 'x', after: 'x' }
});

const VARS = { mail_transport: { value: 'resend' }, web_public_base_url: { value: RECOVERY_ACTIVATION.webPublicBaseUrl }, mail_from: { value: RECOVERY_ACTIVATION.mailFrom }, enable_recovery_alarms: { value: false }, api_image_tag: { value: 'IMG' } };

const planOf = ({ changes = [taskDef(), service(), policy()], out = outputs(), variables = VARS } = {}) => ({
  format_version: '1.2',
  variables,
  resource_changes: [noop('aws_db_instance.main[0]'), noop('aws_ecs_service.ai[0]'), ...changes],
  output_changes: out
});

const run = (plan) => evaluate({ plan, mode: 'recovery-activation' });
const why = (plan) => run(plan).reasons.join(' | ');

// ---- aceptado ------------------------------------------------------------------------------
test('recovery-activation: el cambio esperado (y nada mas) es aceptable', () => {
  const r = run(planOf());
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(r.changes.sort(), [`${API_EXECUTION_POLICY} [update]`, `${API_SERVICE} [update]`, `${API_TASK_DEF} [create+delete]`].sort());
});

test('recovery-activation: el orden de los recursos del ARN en la politica no importa', () => {
  const plan = planOf({ changes: [taskDef(), service(), policy({ afterStatements: [...STATIC, stmt([RESEND_ARN, ...PARAMS].reverse())] })] });
  assert.deepEqual(run(plan).reasons, []);
});

test('recovery-activation: valores vacios vs ausentes (mountPoints, etc.) no son diferencias', () => {
  assert.deepEqual(run(planOf({ changes: [taskDef({ afterExtra: { systemControls: [], volumesFrom: [] } }), service(), policy()] })).reasons, []);
});

// ---- el modo integrated NO se debilita ----------------------------------------------------------
test('integrated sigue rechazando el plan de activacion (mail habilitado, secreto nuevo)', () => {
  const r = evaluate({ plan: planOf(), mode: 'integrated', allowApiImageChange: true }).reasons.join(' | ');
  assert.match(r, /MAIL_TRANSPORT no es "disabled"|secreto nuevo RESEND_API_KEY|NO permitido/);
});

test('las banderas de otros modos no se aceptan en recovery-activation y viceversa', () => {
  assert.throws(() => evaluate({ plan: planOf(), mode: 'recovery-activation', allowApiImageChange: true }), /no es valido en el modo recovery-activation/);
  assert.throws(() => evaluate({ plan: planOf(), mode: 'recovery-activation', expectedImageTag: 'a'.repeat(40) }), /solo es valido en el modo migrator-only/);
  assert.throws(() => evaluate({ plan: planOf(), mode: 'otro' }), /modo desconocido/);
});

// ---- rechazos: task definition --------------------------------------------------------------------
test('rechaza que la task definition no use create antes que delete (sin create_before_destroy)', () => {
  assert.match(why(planOf({ changes: [taskDef({ actions: ['delete', 'create'] }), service(), policy()] })), /create ANTES que delete/);
});

test('rechaza que el reemplazo se deba a otra cosa que container_definitions', () => {
  assert.match(why(planOf({ changes: [taskDef({ replace_paths: [['container_definitions'], ['cpu']] }), service(), policy()] })), /replace_paths/);
});

test('rechaza un cambio de imagen en la activacion', () => {
  assert.match(why(planOf({ changes: [taskDef({ afterImage: `${ACCT}.dkr.ecr.us-east-1.amazonaws.com/scope/api:OTHER` }), service(), policy()] })), /cambia la imagen/);
});

test('rechaza MAIL_TRANSPORT distinto de resend o WEB_PUBLIC_BASE_URL/MAIL_FROM distintos de los aprobados', () => {
  assert.match(why(planOf({ changes: [taskDef({ afterEnv: { ...AFTER_ENV, MAIL_TRANSPORT: 'disabled' } }), service(), policy()] })), /MAIL_TRANSPORT debe quedar en "resend"/);
  assert.match(why(planOf({ changes: [taskDef({ afterEnv: { ...AFTER_ENV, MAIL_TRANSPORT: 'log' } }), service(), policy()] })), /MAIL_TRANSPORT debe quedar en "resend"/);
  assert.match(why(planOf({ changes: [taskDef({ afterEnv: { ...AFTER_ENV, WEB_PUBLIC_BASE_URL: 'https://evil.example.com' } }), service(), policy()] })), /WEB_PUBLIC_BASE_URL debe ser/);
  assert.match(why(planOf({ changes: [taskDef({ afterEnv: { ...AFTER_ENV, WEB_PUBLIC_BASE_URL: '' } }), service(), policy()] })), /WEB_PUBLIC_BASE_URL debe ser/);
  assert.match(why(planOf({ changes: [taskDef({ afterEnv: { ...AFTER_ENV, MAIL_FROM: 'Otro <otro@example.com>' } }), service(), policy()] })), /MAIL_FROM debe ser el remitente aprobado/);
  assert.match(why(planOf({ changes: [taskDef({ afterEnv: { ...AFTER_ENV, TRUST_PROXY_HOPS: '2' } }), service(), policy()] })), /TRUST_PROXY_HOPS/);
});

test('rechaza que cambie, aparezca o desaparezca cualquier otra variable de entorno', () => {
  assert.match(why(planOf({ changes: [taskDef({ afterEnv: { ...AFTER_ENV, WEB_ORIGIN: 'https://otro.example.com' } }), service(), policy()] })), /cambia el valor de la variable WEB_ORIGIN/);
  assert.match(why(planOf({ changes: [taskDef({ afterEnv: { ...AFTER_ENV, SURPRISE: '1' } }), service(), policy()] })), /NO esperada: SURPRISE/);
  const { PORT, ...withoutPort } = AFTER_ENV;
  void PORT;
  assert.match(why(planOf({ changes: [taskDef({ afterEnv: withoutPort }), service(), policy()] })), /desaparece la variable de entorno PORT/);
});

test('rechaza RESEND_API_KEY como variable de entorno en texto plano o una clave "re_..." en cualquier valor', () => {
  assert.match(why(planOf({ changes: [taskDef({ afterEnv: { ...AFTER_ENV, RESEND_API_KEY: 're_abcdefghij1234567890' } }), service(), policy()] })), /texto plano/);
  assert.match(why(planOf({ changes: [taskDef({ afterEnv: { ...AFTER_ENV, MAIL_FROM: 're_abcdefghij1234567890' } }), service(), policy()] })), /parece una API key de Resend/);
});

test('rechaza que RESEND_API_KEY falte, se repita con otro ARN, apunte a otra cuenta, region o parametro', () => {
  assert.match(why(planOf({ changes: [taskDef({ afterSecrets: SECRETS }), service(), policy()] })), /exactamente el secreto RESEND_API_KEY/);
  for (const bad of [
    `arn:aws:ssm:us-east-1:${ACCT}:parameter/scope/prod/api/OTRA_CLAVE`,
    `arn:aws:ssm:us-east-1:${ACCT}:parameter/scope/prod/*`,
    `arn:aws:ssm:eu-west-1:${ACCT}:parameter/scope/prod/api/RESEND_API_KEY`,
    `arn:aws:ssm:us-east-1:${ACCT}:parameter/scope/prod/ai/RESEND_API_KEY`,
    'literal-key-value'
  ]) {
    assert.match(why(planOf({ changes: [taskDef({ afterSecrets: { ...SECRETS, RESEND_API_KEY: bad } }), service(), policy()] })), /ARN exacto/, bad);
  }
  assert.match(why(planOf({ changes: [taskDef({ afterSecrets: { ...SECRETS, RESEND_API_KEY: `arn:aws:ssm:us-east-1:${OTHER_ACCT}:parameter/scope/prod/api/RESEND_API_KEY` } }), service(), policy()] })), /otra cuenta/);
});

test('rechaza que desaparezca, cambie o se sume otro secreto (blockchain, base de datos, etc.)', () => {
  const { CREDENTIAL_REGISTRY_RPC_URL, ...fewer } = SECRETS;
  void CREDENTIAL_REGISTRY_RPC_URL;
  assert.match(why(planOf({ changes: [taskDef({ afterSecrets: { ...fewer, RESEND_API_KEY: RESEND_ARN } }), service(), policy()] })), /DESAPARECE el secreto CREDENTIAL_REGISTRY_RPC_URL/);
  assert.match(why(planOf({ changes: [taskDef({ afterSecrets: { ...SECRETS, DATABASE_URL: `${PREFIX}/scope/prod/api/OTRA`, RESEND_API_KEY: RESEND_ARN } }), service(), policy()] })), /cambia la referencia del secreto DATABASE_URL/);
  assert.match(why(planOf({ changes: [taskDef({ afterSecrets: { ...SECRETS, RESEND_API_KEY: RESEND_ARN, EXTRA_SECRET: `${PREFIX}/scope/prod/api/EXTRA_SECRET` } }), service(), policy()] })), /exactamente el secreto RESEND_API_KEY \(se agregan: RESEND_API_KEY, EXTRA_SECRET\)/);
});

test('rechaza cambios en el contenedor o la task definition (cpu, memoria, roles, puertos)', () => {
  assert.match(why(planOf({ changes: [taskDef({ attrs: { cpu: '1024' } }), service(), policy()] })), /cambia cpu/);
  assert.match(why(planOf({ changes: [taskDef({ attrs: { task_role_arn: 'arn:role/otro' } }), service(), policy()] })), /cambia task_role_arn/);
  assert.match(why(planOf({ changes: [taskDef({ afterExtra: { portMappings: [{ containerPort: 9999 }] } }), service(), policy()] })), /el contenedor cambia portMappings/);
});

// ---- rechazos: servicio ------------------------------------------------------------------------------
test('rechaza cambios en el servicio de la API distintos de task_definition, desired_count o 0/100', () => {
  assert.match(why(planOf({ changes: [taskDef(), service({ desired_count: 2 }), policy()] })), /desired_count debe quedar en 1/);
  assert.match(why(planOf({ changes: [taskDef(), service({ desired_count: 0 }), policy()] })), /desired_count debe quedar en 1/);
  assert.match(why(planOf({ changes: [taskDef(), service({ deployment_minimum_healthy_percent: 100, deployment_maximum_percent: 200 }), policy()] })), /0\/100/);
  assert.match(why(planOf({ changes: [taskDef(), service({ health_check_grace_period_seconds: 0 }), policy()] })), /cambia health_check_grace_period_seconds/);
  assert.match(why(planOf({ changes: [taskDef(), service({}, { actions: ['delete', 'create'] }), policy()] })), /debe ser update/);
});

test('rechaza que falte alguno de los tres cambios esperados', () => {
  assert.match(why(planOf({ changes: [service(), policy()] })), /no aparece aws_ecs_task_definition\.api/);
  assert.match(why(planOf({ changes: [taskDef(), policy()] })), /no aparece aws_ecs_service\.api\[0\]/);
  assert.match(why(planOf({ changes: [taskDef(), service()] })), /no aparece aws_iam_role_policy\.execution\["api"\]/);
});

// ---- rechazos: politica IAM --------------------------------------------------------------------------
test('rechaza permisos SSM amplios: comodines, otra accion, otro efecto, mas de un recurso nuevo', () => {
  const wide = [
    [`${PREFIX}/scope/prod/*`, /ARN exacto|comodines/],
    [`${PREFIX}/*`, /ARN exacto|comodines/],
    ['*', /ARN exacto|comodines/]
  ];
  for (const [resource, pattern] of wide) {
    const plan = planOf({ changes: [taskDef(), service(), policy({ afterStatements: [...STATIC, stmt([...PARAMS, resource])] })] });
    assert.match(why(plan), pattern, resource);
  }
  assert.match(why(planOf({ changes: [taskDef(), service(), policy({ afterStatements: [...STATIC, stmt([...PARAMS, RESEND_ARN, `${PREFIX}/scope/prod/api/OTRO`])] })] })), /exactamente UN recurso/);
  assert.match(why(planOf({ changes: [taskDef(), service(), policy({ afterStatements: [...STATIC, stmt([...PARAMS, RESEND_ARN], { Action: ['ssm:GetParameters', 'ssm:PutParameter'] })] })] })), /cambian las acciones|lectura de parametros SSM/);
  assert.match(why(planOf({ changes: [taskDef(), service(), policy({ afterStatements: [...STATIC, stmt([...PARAMS, RESEND_ARN], { Effect: 'Deny' })] })] })), /efecto debe seguir siendo Allow/);
  assert.match(why(planOf({ changes: [taskDef(), service(), policy({ afterStatements: [...STATIC, stmt([...PARAMS, RESEND_ARN], { Condition: { StringEquals: { 'aws:RequestedRegion': 'us-east-1' } } })] })] })), /cambia la condicion/);
});

test('rechaza que la politica cambie algo mas: otra sentencia, una sentencia nueva, un recurso quitado, kms:Decrypt', () => {
  const extra = { Sid: 'Extra', Effect: 'Allow', Action: 'kms:Decrypt', Resource: '*' };
  assert.match(why(planOf({ changes: [taskDef(), service(), policy({ afterStatements: [...STATIC, stmt([...PARAMS, RESEND_ARN]), extra] })] })), /exactamente UNA sentencia/);
  assert.match(why(planOf({ changes: [taskDef(), service(), policy({ afterStatements: [{ ...STATIC[0], Resource: 'arn:x' }, STATIC[1], stmt([...PARAMS, RESEND_ARN])] })] })), /exactamente UNA sentencia/);
  assert.match(why(planOf({ changes: [taskDef(), service(), policy({ afterStatements: [...STATIC, stmt([PARAMS[0], RESEND_ARN])] })] })), /se quitan 1 recurso/);
  assert.match(why(planOf({ changes: [taskDef(), service(), policy({ afterStatements: [...STATIC, stmt([...PARAMS, RESEND_ARN], { NotResource: 'x' })] })] })), /NotAction\/NotResource|exactamente/);
});

test('rechaza que la politica no se actualice in-place o cambie su rol/nombre', () => {
  assert.match(why(planOf({ changes: [taskDef(), service(), policy({ actions: ['delete', 'create'] })] })), /debe ser update/);
  assert.match(why(planOf({ changes: [taskDef(), service(), policy({ attrs: { role: 'otro-rol' } })] })), /cambia role/);
  assert.match(why(planOf({ changes: [taskDef(), service(), policy({ attrs: { name: 'otro' } })] })), /cambia name/);
});

// ---- rechazos: recursos ajenos, outputs, variables --------------------------------------------------------
test('rechaza cualquier otro recurso: IA, migrador, RDS, IAM, ALB, red, ECR, alarmas', () => {
  for (const address of ['aws_ecs_service.ai[0]', 'aws_ecs_task_definition.ai', 'aws_ecs_task_definition.migrator', 'aws_db_instance.main[0]', 'aws_iam_role.execution["api"]', 'aws_iam_role_policy.execution["ai"]', 'aws_lb.api', 'aws_lb_target_group.api', 'aws_security_group.api', 'aws_ecr_repository.api', 'aws_ssm_parameter.x', 'aws_cloudwatch_metric_alarm.recovery["global_cap"]', 'aws_cloudwatch_log_metric_filter.recovery["transport_failure"]']) {
    for (const actions of [['update'], ['create'], ['delete'], ['delete', 'create']]) {
      const plan = planOf({ changes: [taskDef(), service(), policy(), { address, change: { actions } }] });
      assert.match(why(plan), /NO permitido/, `${address} ${actions}`);
    }
  }
  assert.match(why(planOf({ changes: [taskDef(), service(), policy(), { address: 'aws_db_instance.main[0]', change: { actions: ['delete'] } }] })), /DESTRUCTIVO/);
});

test('rechaza outputs inesperados o con valores no aprobados', () => {
  const outs = outputs();
  assert.match(why(planOf({ out: { ...outs, alb_dns_name: { actions: ['update'], before: 'x', after: 'y' } } })), /cambia el output alb_dns_name/);
  assert.match(why(planOf({ out: { ...outs, secreto: { actions: ['create'], after: 'x' } } })), /cambia el output secreto/);
  const bad = (patch) => outputs({ [OUTPUT_RECOVERY_CONFIGURATION]: { after: { ...outs[OUTPUT_RECOVERY_CONFIGURATION].after, ...patch } } });
  assert.match(why(planOf({ out: bad({ mail_transport: 'disabled' }) })), /mail_transport debe ser "resend"/);
  assert.match(why(planOf({ out: bad({ web_public_base_url: 'https://x.example.com' }) })), /web_public_base_url no es el aprobado/);
  assert.match(why(planOf({ out: bad({ mail_from: 'x@example.com' }) })), /mail_from no es el aprobado/);
  assert.match(why(planOf({ out: bad({ resend_secret_name: '/otro/parametro' }) })), /resend_secret_name no es el aprobado/);
  assert.match(why(planOf({ out: bad({ recovery_alarms_active: true }) })), /alarmas de recuperacion/);
  assert.match(why(planOf({ out: bad({ api_image_tag: 'OTRA' }) })), /cambia api_image_tag/);
  assert.match(why(planOf({ out: { ...outs, [OUTPUT_PARAMETERS_OUT_OF_BAND]: { ...outs[OUTPUT_PARAMETERS_OUT_OF_BAND], after: [...OUT_PARAMS_BEFORE, '/scope/prod/api/OTRA'] } } })), /solo puede sumar/);
  assert.match(why(planOf({ out: { ...outs, [OUTPUT_PARAMETERS_OUT_OF_BAND]: { ...outs[OUTPUT_PARAMETERS_OUT_OF_BAND], after: [OUT_PARAMS_BEFORE[0], RECOVERY_ACTIVATION.resendParameterName] } } })), /desaparecen parametros/);
  const { [OUTPUT_PARAMETERS_OUT_OF_BAND]: _omit, ...withoutParams } = outs;
  void _omit;
  assert.match(why(planOf({ out: withoutParams })), /falta la actualizacion del output ssm_parameters_required_out_of_band/);
});

test('rechaza variables del plan que no son las aprobadas o que sugieren un secreto', () => {
  assert.match(why(planOf({ variables: { ...VARS, mail_transport: { value: 'disabled' } } })), /mail_transport del plan debe ser "resend"/);
  assert.match(why(planOf({ variables: { ...VARS, web_public_base_url: { value: '' } } })), /web_public_base_url del plan no es la aprobada/);
  assert.match(why(planOf({ variables: { ...VARS, mail_from: { value: 'a@b.com' } } })), /mail_from del plan no es la aprobada/);
  assert.match(why(planOf({ variables: { ...VARS, enable_recovery_alarms: { value: true } } })), /enable_recovery_alarms/);
  assert.match(why(planOf({ variables: { ...VARS, resend_api_key: { value: 'x' } } })), /sospechosa de contener un secreto/);
  assert.match(why(planOf({ variables: {} })), /mail_transport del plan debe ser "resend"/);
});

test('rechaza una politica ilegible y un plan que no es un plan', () => {
  const broken = policy();
  broken.change.after.policy = 'no-es-json';
  assert.match(why(planOf({ changes: [taskDef(), service(), broken] })), /no es un JSON de IAM legible/);
  assert.throws(() => evaluate({ plan: {}, mode: 'recovery-activation' }), /resource_changes/);
});

// ---- CLI ----------------------------------------------------------------------------------------------
function cli(args, plan) {
  const out = [];
  const err = [];
  const code = main({ argv: args, readFile: () => JSON.stringify(plan), out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

test('CLI: exit 0 con el plan esperado, 1 si se rechaza, 2 si no se puede evaluar', () => {
  const ok = cli(['--mode', 'recovery-activation', '--plan', 'p.json'], planOf());
  assert.equal(ok.code, 0);
  assert.match(ok.out, /ACEPTABLE: solo la activacion de Resend/);

  const rejected = cli(['--mode', 'recovery-activation', '--plan', 'p.json'], planOf({ changes: [taskDef({ afterEnv: { ...AFTER_ENV, MAIL_TRANSPORT: 'disabled' } }), service(), policy()] }));
  assert.equal(rejected.code, 1);
  assert.match(rejected.out, /RECHAZADO/);

  assert.equal(cli(['--mode', 'recovery-activation', '--allow-api-image-change', '--plan', 'p.json'], planOf()).code, 2);
  assert.equal(cli(['--mode', 'recovery-activation'], planOf()).code, 2);
});

test('la salida no imprime valores de variables ni secretos', () => {
  const r = cli(['--mode', 'recovery-activation', '--plan', 'p.json'], planOf({ changes: [taskDef({ afterEnv: { ...AFTER_ENV, RESEND_API_KEY: 're_SUPERSECRETVALUE1234567890' } }), service(), policy()] }));
  assert.equal(r.code, 1);
  assert.doesNotMatch(`${r.out}\n${r.err}`, /re_SUPERSECRET/);
});

/**
 * Guards ESTRUCTURALES del broker del provisioner -- S8c11.4c1.
 *
 * Solo leen Terraform y el template ASL VERSIONADOS: no leen terraform.tfvars, ni
 * el state, ni AWS, ni ejecutan nada. Prueban el estado DESEADO. No dicen nada de
 * lo aplicado en AWS, no prueban la semantica live de `ecs:runTask.sync` y no
 * autorizan a ningun llamador (no hay ninguno en esta fase).
 *
 * El ASL se prueba PARSEADO: se sustituyen los cuatro placeholders del template
 * por valores ficticios y se analiza el JSON resultante, en vez de buscar texto.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const TERRAFORM_PROD_DIR = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'infra',
  'terraform',
  'prod'
);

function readTf(fileName: string): string {
  // Fin de linea normalizado: con core.autocrlf un checkout de Windows trae CRLF.
  return readFileSync(join(TERRAFORM_PROD_DIR, fileName), 'utf8').replace(/\r\n/g, '\n');
}

/** HCL sin comentarios: las aserciones negativas miran configuracion real. */
function executableHcl(contents: string): string {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith('#') && !trimmed.startsWith('//');
    })
    .join('\n');
}

function block(contents: string, header: string): string {
  const index = contents.indexOf(header);
  assert.notEqual(index, -1, `no se encontro el bloque ${header}`);

  const rest = contents.slice(index);
  let depth = 0;
  for (let cursor = 0; cursor < rest.length; cursor += 1) {
    if (rest[cursor] === '{') {
      depth += 1;
    } else if (rest[cursor] === '}') {
      depth -= 1;
      if (depth === 0) {
        return rest.slice(0, cursor + 1);
      }
    }
  }

  throw new Error(`bloque ${header} sin cerrar`);
}

// ---------------------------------------------------------------------------
// ASL PARSEADO
// ---------------------------------------------------------------------------

// La definicion ASL vive como heredoc dentro del .tf. Se extrae el texto crudo
// (con sus interpolaciones de Terraform) y se sustituyen las cuatro referencias
// estaticas por valores ficticios para poder PARSEARLA como JSON.
const RAW_TF = readTf('provisioner_invocation.tf');
const DEFINITION_MATCH = /definition\s*=\s*<<-EOT\n([\s\S]*?)\n\s*EOT\n/.exec(RAW_TF);
assert.ok(DEFINITION_MATCH, 'no se encontro la definicion ASL (heredoc)');
const TEMPLATE_TEXT = DEFINITION_MATCH[1];

const FAKE = {
  '${aws_ecs_cluster.main.arn}': 'arn:aws:ecs:us-east-1:111122223333:cluster/fake',
  '${aws_ecs_task_definition.provisioner.arn}':
    'arn:aws:ecs:us-east-1:111122223333:task-definition/fake-provisioner:7',
  '${jsonencode(aws_subnet.public[*].id)}': '["subnet-aaa","subnet-bbb"]',
  '${aws_security_group.provisioner.id}': 'sg-fake'
} as const;

const CLUSTER_ARN = FAKE['${aws_ecs_cluster.main.arn}'];
const TASK_DEFINITION_ARN = FAKE['${aws_ecs_task_definition.provisioner.arn}'];
const SECURITY_GROUP_ID = FAKE['${aws_security_group.provisioner.id}'];

type StateMap = Record<string, Record<string, any>>;

function parseAsl(): { StartAt: string; States: StateMap; Comment: string } {
  let text = TEMPLATE_TEXT;
  for (const [expression, value] of Object.entries(FAKE)) {
    text = text.split(expression).join(value);
  }
  assert.ok(!text.includes('${'), 'quedan interpolaciones sin sustituir');
  return JSON.parse(text);
}

const asl = parseAsl();
const states = asl.States;
const runProvisioner = states.RunProvisioner;

/** Nombres de los estados a los que puede saltar `state`. */
function successors(state: Record<string, any>): string[] {
  const next: string[] = [];
  if (typeof state.Next === 'string') next.push(state.Next);
  if (typeof state.Default === 'string') next.push(state.Default);
  for (const choice of state.Choices ?? []) next.push(choice.Next);
  for (const catcher of state.Catch ?? []) next.push(catcher.Next);
  return next;
}

/** Estados alcanzables desde StartAt, sin pasar por `blocked`. */
function reachable(blocked: readonly string[] = []): Set<string> {
  const seen = new Set<string>();
  const queue = [asl.StartAt];
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (seen.has(name) || blocked.includes(name)) continue;
    seen.add(name);
    queue.push(...successors(states[name]));
  }
  return seen;
}

function allKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, keys);
  } else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      keys.push(key);
      allKeys(inner, keys);
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// STATE MACHINE (Terraform)
// ---------------------------------------------------------------------------

const tf = executableHcl(readTf('provisioner_invocation.tf'));
const stateMachine = block(tf, 'resource "aws_sfn_state_machine" "provisioner"');

test('S8c11.4c1-1: state machine STANDARD, sin logging, con definicion y referencias exactas', () => {
  assert.match(stateMachine, /type\s*=\s*"STANDARD"/);
  assert.ok(!/EXPRESS/.test(stateMachine));
  assert.ok(!stateMachine.includes('logging_configuration'));
  assert.ok(!stateMachine.includes('tracing_configuration'));

  assert.match(stateMachine, /name\s*=\s*local\.provisioner_state_machine_name/);
  assert.match(
    tf,
    /provisioner_state_machine_name\s*=\s*"\$\{local\.name_prefix\}-issuer-provisioner"/
  );
  assert.match(
    stateMachine,
    /role_arn\s*=\s*aws_iam_role\.provisioner_sfn_execution\.arn/
  );

  // La definicion es un heredoc inline cuyas UNICAS interpolaciones son las
  // cuatro referencias estaticas: ninguna es input del llamador.
  assert.match(stateMachine, /definition\s*=\s*<<-EOT/);
  assert.ok(!stateMachine.includes('templatefile('));
  const interpolations = [...TEMPLATE_TEXT.matchAll(/\$\{[^}]*\}|\$\{jsonencode\([^)]*\)\}/g)]
    .map((m) => m[0])
    .sort();
  assert.deepEqual(interpolations, Object.keys(FAKE).sort());
});

// ---------------------------------------------------------------------------
// RunTask: lo fijo y lo unico dinamico
// ---------------------------------------------------------------------------

test('S8c11.4c1-2: RunProvisioner usa ecs:runTask.sync con peticion ECS fija', () => {
  assert.equal(runProvisioner.Type, 'Task');
  assert.equal(runProvisioner.Resource, 'arn:aws:states:::ecs:runTask.sync');

  const parameters = runProvisioner.Parameters;
  assert.deepEqual(Object.keys(parameters).sort(), [
    'Cluster',
    'EnableExecuteCommand',
    'LaunchType',
    'NetworkConfiguration',
    'Overrides',
    'TaskDefinition'
  ]);

  assert.equal(parameters.Cluster, CLUSTER_ARN);
  assert.equal(parameters.TaskDefinition, TASK_DEFINITION_ARN);
  assert.equal(parameters.LaunchType, 'FARGATE');
  assert.equal(parameters.EnableExecuteCommand, false);

  assert.deepEqual(parameters.NetworkConfiguration, {
    AwsvpcConfiguration: {
      Subnets: ['subnet-aaa', 'subnet-bbb'],
      SecurityGroups: [SECURITY_GROUP_ID],
      AssignPublicIp: 'ENABLED'
    }
  });

  // Sin capacity provider, sin tags dinamicos, sin plataforma ni placement.
  for (const forbidden of [
    'CapacityProviderStrategy',
    'Tags',
    'PropagateTags',
    'PlatformVersion',
    'PlacementConstraints',
    'Group',
    'StartedBy'
  ]) {
    assert.ok(!(forbidden in parameters), forbidden);
  }
});

test('S8c11.4c1-3: el unico override es el Command del contenedor "provisioner"', () => {
  const overrides = runProvisioner.Parameters.Overrides;
  assert.deepEqual(Object.keys(overrides), ['ContainerOverrides']);
  assert.equal(overrides.ContainerOverrides.length, 1);

  const container = overrides.ContainerOverrides[0];
  assert.deepEqual(Object.keys(container).sort(), ['Command.$', 'Name']);

  // El nombre coincide con el del contenedor de la task definition.
  const ecs = executableHcl(readTf('ecs.tf'));
  const taskDefinition = block(ecs, 'resource "aws_ecs_task_definition" "provisioner"');
  assert.match(taskDefinition, /name\s*=\s*"provisioner"/);
  assert.equal(container.Name, 'provisioner');
  assert.equal((taskDefinition.match(/\bname\s*=\s*"provisioner"/g) ?? []).length, 1);

  // Lista de argv individuales, nunca un string de comando.
  assert.equal(
    container['Command.$'],
    "States.Array('provision', '--issuer', $.issuer_id, '--types', $.credential_types)"
  );

  // Nada de lo que ECS permite sobrescribir aparece en ningun lugar de la definicion.
  const keys = allKeys(asl);
  for (const forbidden of [
    'Environment',
    'EnvironmentFiles',
    'TaskRoleArn',
    'ExecutionRoleArn',
    'Cpu',
    'Memory',
    'MemoryReservation',
    'EphemeralStorage',
    'ResourceRequirements',
    'InferenceAcceleratorOverrides',
    'EntryPoint'
  ]) {
    assert.ok(!keys.includes(forbidden), forbidden);
  }
});

test('S8c11.4c1-4: solo issuer_id y credential_types son entrada dinamica del request ECS', () => {
  const dynamicKeys = allKeys(runProvisioner.Parameters).filter((key) =>
    key.endsWith('.$')
  );
  assert.deepEqual(dynamicKeys, ['Command.$']);

  const referenced = JSON.stringify(runProvisioner.Parameters).match(/\$\.[A-Za-z_]+/g);
  assert.deepEqual(referenced, ['$.issuer_id', '$.credential_types']);

  // Ninguna ruta del ASL lee campos de configuracion de la entrada.
  const everyPath = [...TEMPLATE_TEXT.matchAll(/\$\.[A-Za-z_]+/g)].map((m) => m[0]);
  for (const forbidden of [
    '$.task_definition',
    '$.task_role',
    '$.execution_role',
    '$.cluster',
    '$.subnets',
    '$.security_groups',
    '$.environment',
    '$.database_url',
    '$.region',
    '$.command',
    '$.image',
    '$.image_digest',
    '$.digest',
    '$.tag'
  ]) {
    assert.ok(!everyPath.includes(forbidden), forbidden);
  }
});

test('S8c11.4c1-5: validacion barata de forma antes de ECS, sin duplicar el gate', () => {
  for (const name of [
    'CheckIssuerPresent',
    'CheckIssuerIsString',
    'CheckTypesPresent',
    'CheckTypesIsString'
  ]) {
    assert.equal(states[name].Type, 'Choice', name);
    assert.equal(states[name].Default, 'InvalidInput', name);
  }
  assert.equal(asl.StartAt, 'CheckIssuerPresent');
  assert.equal(states.InvalidInput.Type, 'Fail');

  // Ningun camino llega a RunProvisioner sin pasar por las cuatro comprobaciones.
  for (const name of [
    'CheckIssuerPresent',
    'CheckIssuerIsString',
    'CheckTypesPresent',
    'CheckTypesIsString'
  ]) {
    assert.ok(!reachable([name]).has('RunProvisioner'), name);
  }

  // Solo IsPresent / IsString: sin regex de UUID ni validacion de tipos.
  const operators = Object.values(states)
    .filter((state) => state.Type === 'Choice')
    .flatMap((state) => state.Choices)
    .flatMap((choice) => Object.keys(choice))
    .filter((key) => !['Variable', 'Next'].includes(key));
  assert.ok(
    operators.every((key) =>
      ['IsPresent', 'IsString', 'NumericEquals'].includes(key)
    ),
    operators.join(',')
  );
});

// ---------------------------------------------------------------------------
// FALLOS: SIN REINTENTOS
// ---------------------------------------------------------------------------

test('S8c11.4c1-6: sin Retry; todo error termina en INSPECT_FIRST y nunca vuelve a RunTask', () => {
  const keys = allKeys(asl);
  assert.ok(!keys.includes('Retry'), 'ningun Retry en ningun estado');
  assert.ok(!TEMPLATE_TEXT.includes('BackoffRate'));
  assert.ok(!TEMPLATE_TEXT.includes('MaxAttempts'));

  assert.deepEqual(runProvisioner.Catch, [
    { ErrorEquals: ['States.ALL'], Next: 'ProvisioningRequiresInspection' }
  ]);
  assert.equal(states.ProvisioningRequiresInspection.Type, 'Fail');
  assert.equal(states.ProvisioningRequiresInspection.Error, 'INSPECT_FIRST');

  // Ningun estado salta de vuelta a RunProvisioner salvo el chequeo de entrada.
  const pointingAtRun = Object.entries(states)
    .filter(([, state]) => successors(state).includes('RunProvisioner'))
    .map(([name]) => name);
  assert.deepEqual(pointingAtRun, ['CheckTypesIsString']);

  // Y desde RunProvisioner no se puede volver a el ni a las comprobaciones.
  const fromRun = new Set<string>();
  const queue = successors(runProvisioner);
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (fromRun.has(name)) continue;
    fromRun.add(name);
    queue.push(...successors(states[name]));
  }
  assert.ok(!fromRun.has('RunProvisioner'), 'sin ciclo hacia RunProvisioner');

  // Causas fijas: ninguna interpola datos de la ejecucion.
  for (const name of ['InvalidInput', 'ProvisioningRequiresInspection']) {
    assert.ok(!('Cause.$' in states[name]) && !('Error.$' in states[name]), name);
  }
});

test('S8c11.4c1-7: el exito exige ExitCode presente Y igual a 0, en dos Choice separados', () => {
  assert.equal(runProvisioner.Next, 'CheckExitCodePresent');
  for (const forbidden of ['ResultSelector', 'ResultPath', 'OutputPath', 'InputPath']) {
    assert.ok(!(forbidden in runProvisioner), forbidden);
  }

  assert.deepEqual(states.CheckExitCodePresent.Choices, [
    {
      Variable: '$.Containers[0].ExitCode',
      IsPresent: true,
      Next: 'CheckExitCodeZero'
    }
  ]);
  assert.equal(states.CheckExitCodePresent.Default, 'ProvisioningRequiresInspection');

  assert.deepEqual(states.CheckExitCodeZero.Choices, [
    {
      Variable: '$.Containers[0].ExitCode',
      NumericEquals: 0,
      Next: 'ProvisioningSucceeded'
    }
  ]);
  assert.equal(states.CheckExitCodeZero.Default, 'ProvisioningRequiresInspection');
  assert.equal(states.ProvisioningSucceeded.Type, 'Succeed');

  // Sin And/Or/Not: NumericEquals nunca se evalua con el path ausente.
  const choiceKeys = allKeys(
    Object.values(states)
      .filter((state) => state.Type === 'Choice')
      .map((state) => state.Choices)
  );
  for (const forbidden of ['And', 'Or', 'Not']) {
    assert.ok(!choiceKeys.includes(forbidden), forbidden);
  }

  // El unico camino a Succeed pasa por las dos comprobaciones.
  assert.ok(reachable().has('ProvisioningSucceeded'));
  assert.ok(!reachable(['CheckExitCodePresent']).has('ProvisioningSucceeded'));
  assert.ok(!reachable(['CheckExitCodeZero']).has('ProvisioningSucceeded'));
  const pointingAtSuccess = Object.entries(states)
    .filter(([, state]) => successors(state).includes('ProvisioningSucceeded'))
    .map(([name]) => name);
  assert.deepEqual(pointingAtSuccess, ['CheckExitCodeZero']);
});

test('S8c11.4c1-8: la evidencia aislada de Fargate confirma el contrato de ExitCode sin debilitar el fallback', () => {
  const rawTf = readTf('provisioner_invocation.tf');

  for (const text of [rawTf, TEMPLATE_TEXT]) {
    assert.match(text, /ECS_SYNC_EXIT_CODE_PATH = LIVE_VERIFIED_ISOLATED_FARGATE_2026-10-16/);
    assert.match(text, /ECS_SYNC_NONZERO_EXIT_SEMANTICS = LIVE_VERIFIED_ISOLATED_FARGATE_2026-10-16/);
  }
  assert.match(
    rawTf,
    /ECS_SYNC_OUTPUT_LIVE_VERIFICATION = PASS_ISOLATED_FARGATE_2026-10-16/
  );
  assert.match(rawTf, /PROVISIONER_ARTIFACT_INTEGRITY = NOT_YET_PROVEN/);
  assert.match(rawTf, /PROVISIONER_EXTERNAL_CALLER = NOT_IMPLEMENTED/);
  assert.match(rawTf, /PROVISIONER_NETWORK_EGRESS_CONFINEMENT = PARTIAL/);
  assert.match(states.CheckExitCodePresent.Comment, /Live-isolated Fargate evidence/);
  assert.match(states.CheckExitCodePresent.Comment, /still fails closed to INSPECT_FIRST/);
});

// ---------------------------------------------------------------------------
// ROL DE EJECUCION: CONFIANZA
// ---------------------------------------------------------------------------

test('S8c11.4c1-9: la confianza es states.amazonaws.com acotada a esta cuenta y esta state machine', () => {
  const trust = block(
    tf,
    'data "aws_iam_policy_document" "provisioner_sfn_assume_role"'
  );

  assert.equal((trust.match(/\bstatement\s*\{/g) ?? []).length, 1);
  assert.match(trust, /effect\s*=\s*"Allow"/);
  assert.match(trust, /actions\s*=\s*\["sts:AssumeRole"\]/);
  assert.match(
    trust,
    /principals\s*\{\s*type\s*=\s*"Service"\s*identifiers\s*=\s*\["states\.amazonaws\.com"\]\s*\}/
  );

  const conditions = [...trust.matchAll(/condition\s*\{([^}]*)\}/g)].map((m) =>
    m[1].replace(/\s+/g, ' ').trim()
  );
  assert.deepEqual(conditions.sort(), [
    'test = "ArnLike" variable = "aws:SourceArn" values = [local.provisioner_state_machine_arn]',
    'test = "StringEquals" variable = "aws:SourceAccount" values = [local.account_id]'
  ]);

  // Ningun otro principal ni fallback amplio.
  assert.ok(!/type\s*=\s*"(AWS|\*|Federated)"/.test(trust));
  assert.ok(!trust.includes('"*"'));
  assert.ok(!/aws:SourceArn[\s\S]*\*/.test(trust.replace(/\[\*\]/g, '')));
  assert.ok(!trust.includes('ecs-tasks.amazonaws.com'));

  // El ARN exacto se construye de region, cuenta y nombre; NO es un comodin.
  assert.match(
    tf,
    /provisioner_state_machine_arn\s*=\s*"arn:aws:states:\$\{var\.aws_region\}:\$\{local\.account_id\}:stateMachine:\$\{local\.provisioner_state_machine_name\}"/
  );
  const arnLine = /provisioner_state_machine_arn\s*=\s*"([^"]*)"/.exec(tf)?.[1] ?? '';
  assert.ok(!arnLine.includes('*'), 'sin comodin en el ARN de confianza');

  // Sin dependencia circular: la confianza no referencia el recurso state machine.
  assert.ok(!trust.includes('aws_sfn_state_machine'));
  assert.match(
    block(tf, 'resource "aws_iam_role" "provisioner_sfn_execution"'),
    /assume_role_policy\s*=\s*data\.aws_iam_policy_document\.provisioner_sfn_assume_role\.json/
  );
});

// ---------------------------------------------------------------------------
// ROL DE EJECUCION: PERMISOS
// ---------------------------------------------------------------------------

const policy = block(tf, 'data "aws_iam_policy_document" "provisioner_sfn_execution"');

function statementBySid(sid: string): string {
  const match = new RegExp(`sid\\s*=\\s*"${sid}"`).exec(policy);
  assert.ok(match, `sid ${sid}`);
  return block(
    policy.slice(policy.lastIndexOf('statement {', match.index)),
    'statement {'
  );
}

test('S8c11.4c1-10: RunTask sobre la revision EXACTA, con cluster y sin ExecuteCommand', () => {
  const allow = statementBySid('RunExactProvisionerRevision');
  assert.match(allow, /effect\s*=\s*"Allow"/);
  assert.match(allow, /actions\s*=\s*\["ecs:RunTask"\]/);
  assert.match(allow, /resources\s*=\s*\[aws_ecs_task_definition\.provisioner\.arn\]/);
  assert.match(
    allow,
    /condition\s*\{\s*test\s*=\s*"ArnEquals"\s*variable\s*=\s*"ecs:cluster"\s*values\s*=\s*\[aws_ecs_cluster\.main\.arn\]\s*\}/
  );
  assert.ok(!allow.includes(':*'));
  assert.ok(!allow.includes('arn_without_revision'));

  const deny = statementBySid('NeverRunProvisionerWithExecuteCommand');
  assert.match(deny, /effect\s*=\s*"Deny"/);
  assert.match(deny, /actions\s*=\s*\["ecs:RunTask"\]/);
  assert.match(
    deny,
    /condition\s*\{\s*test\s*=\s*"StringEquals"\s*variable\s*=\s*"ecs:enable-execute-command"\s*values\s*=\s*\["true"\]\s*\}/
  );
});

test('S8c11.4c1-11: PassRole solo sobre los dos roles exactos y solo hacia ecs-tasks', () => {
  const pass = statementBySid('PassOnlyTheProvisionerRoles');
  assert.match(pass, /actions\s*=\s*\["iam:PassRole"\]/);
  assert.deepEqual(
    [...pass.matchAll(/aws_iam_role\.(\w+)\.arn/g)].map((m) => m[1]),
    ['provisioner_task', 'provisioner_execution']
  );
  assert.match(
    pass,
    /condition\s*\{\s*test\s*=\s*"StringEquals"\s*variable\s*=\s*"iam:PassedToService"\s*values\s*=\s*\["ecs-tasks\.amazonaws\.com"\]\s*\}/
  );
  assert.ok(!/resources\s*=\s*\["\*"\]/.test(pass));
});

test('S8c11.4c1-12: soporte .sync acotado a lo documentado, con la regla gestionada exacta', () => {
  const observe = statementBySid('ObserveAndStopOwnTasks');
  assert.match(observe, /actions\s*=\s*\["ecs:DescribeTasks", "ecs:StopTask"\]/);
  assert.match(observe, /resources\s*=\s*\["\*"\]/);

  const events = statementBySid('ManagedRuleForEcsTaskEvents');
  assert.match(
    events,
    /actions\s*=\s*\[\s*"events:DescribeRule",\s*"events:PutRule",\s*"events:PutTargets",\s*\]/
  );
  assert.match(
    events,
    /resources\s*=\s*\["arn:aws:events:\$\{var\.aws_region\}:\$\{local\.account_id\}:rule\/StepFunctionsGetEventsForECSTaskRule"\]/
  );

  // Todas las acciones del documento, y solo esas.
  const actions = [...policy.matchAll(/actions\s*=\s*\[([^\]]*)\]/g)].flatMap((m) =>
    [...m[1].matchAll(/"([^"]+)"/g)].map((action) => action[1])
  );
  assert.deepEqual(
    [...new Set(actions)].sort(),
    [
      'ecs:DescribeTasks',
      'ecs:RunTask',
      'ecs:StopTask',
      'events:DescribeRule',
      'events:PutRule',
      'events:PutTargets',
      'iam:PassRole'
    ]
  );

  // El unico "*" de recursos es el de DescribeTasks/StopTask, documentado por AWS.
  assert.equal((policy.match(/resources\s*=\s*\["\*"\]/g) ?? []).length, 1);
});

test('S8c11.4c1-13: el rol no toca secretos, DB, signers ni administra ECS/IAM', () => {
  for (const forbidden of [
    'ssm:',
    'kms:',
    'secretsmanager:',
    'rds:',
    'rds-db:',
    's3:',
    'lambda:',
    'logs:',
    'states:',
    'ecr:',
    'ecs:RegisterTaskDefinition',
    'ecs:UpdateService',
    'ecs:ExecuteCommand',
    'iam:Create',
    'iam:Put',
    'iam:Attach',
    'signers'
  ]) {
    assert.ok(!policy.includes(forbidden), forbidden);
  }

  const attachment = block(tf, 'resource "aws_iam_role_policy" "provisioner_sfn_execution"');
  assert.match(attachment, /role\s*=\s*aws_iam_role\.provisioner_sfn_execution\.id/);
  assert.match(
    attachment,
    /policy\s*=\s*data\.aws_iam_policy_document\.provisioner_sfn_execution\.json/
  );
});

// ---------------------------------------------------------------------------
// SEPARACION: NO HAY LLAMADOR Y EL ROL DE DEPLOY NO CAMBIA
// ---------------------------------------------------------------------------

test('S8c11.4c1-14: el rol de deploy actual no gana nada y esta fase no crea ningun llamador', () => {
  const oidc = executableHcl(readTf('github_oidc.tf'));

  for (const forbidden of [
    'states:',
    'StartExecution',
    'UpdateStateMachine',
    'provisioner',
    'sfn',
    'ecs:ExecuteCommand'
  ]) {
    assert.ok(!oidc.includes(forbidden), forbidden);
  }

  // Los roles del provisioner siguen sin ser pasables por el rol de deploy.
  const passRole = oidc.slice(oidc.indexOf('PassEcsTaskRolesOnly'));
  assert.ok(!passRole.slice(0, passRole.indexOf('ReadScopeDeploymentLogs')).includes('provisioner'));

  // Este archivo no define ninguna identidad que pueda iniciar la ejecucion.
  assert.ok(!tf.includes('StartExecution'));
  assert.ok(!/"states:[A-Za-z*]+"/.test(tf), 'ninguna accion states:* en este archivo');
  assert.ok(!/aws_iam_openid_connect|github|workflow|sts:AssumeRoleWithWebIdentity/i.test(tf));
});

test('S8c11.4c1-15: ningun secreto ni valor sensible en el broker', () => {
  for (const text of [executableHcl(readTf('provisioner_invocation.tf')), TEMPLATE_TEXT]) {
    for (const forbidden of [
      'PRIVATE_KEY',
      'private_key',
      'privateKey',
      'passphrase',
      'mnemonic',
      'DATABASE_URL',
      'postgresql://',
      'CREDENTIAL_REGISTRY_RPC_URL',
      'SIGNER_SECRET'
    ]) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
  }
});

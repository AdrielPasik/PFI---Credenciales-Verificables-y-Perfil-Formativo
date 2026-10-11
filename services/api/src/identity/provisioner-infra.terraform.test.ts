/**
 * Guards ESTRUCTURALES de la infraestructura del provisioner -- S8c11.4b.
 *
 * Solo leen Terraform VERSIONADO: no leen terraform.tfvars, ni el state, ni AWS,
 * ni la red, ni secretos. Prueban el estado DESEADO del repositorio; no dicen
 * nada sobre lo que esta aplicado en AWS, ni autorizan a nadie a invocar la tarea
 * (eso es la subfase de invocacion).
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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

const SIGNERS_ARN =
  '"${local.ssm_parameter_arn_prefix}${local.ssm_prefix}/signers/*"';

function readTf(fileName: string): string {
  return readFileSync(join(TERRAFORM_PROD_DIR, fileName), 'utf8');
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

/** Bloque `statement { ... }` que contiene el `sid` dado. */
function statementBlock(hcl: string, sid: string): string {
  const sidIndex = hcl.indexOf(`"${sid}"`);
  assert.notEqual(sidIndex, -1, `no se encontro el sid ${sid}`);
  const start = hcl.lastIndexOf('statement {', sidIndex);
  assert.notEqual(start, -1, `statement de ${sid}`);
  return block(hcl.slice(start), 'statement {');
}

function tfFileNames(): string[] {
  return readdirSync(TERRAFORM_PROD_DIR).filter((name) => name.endsWith('.tf'));
}

function varReferences(hcl: string, name: string): number {
  return (hcl.match(new RegExp(`\\bvar\\.${name}\\b`, 'g')) ?? []).length;
}

const variables = executableHcl(readTf('variables.tf'));
const ecs = executableHcl(readTf('ecs.tf'));
const iam = executableHcl(readTf('iam.tf'));
const securityGroups = executableHcl(readTf('security_groups.tf'));
const oidc = executableHcl(readTf('github_oidc.tf'));

const provisionerTaskDefinition = block(
  ecs,
  'resource "aws_ecs_task_definition" "provisioner"'
);

// ---------------------------------------------------------------------------
// PROVISIONER_IMAGE_TAG_INDEPENDENT
// ---------------------------------------------------------------------------

test('S8c11.4b-1: provisioner_image_tag es requerida, sin default y sin fallback', () => {
  assert.equal((variables.match(/variable "provisioner_image_tag"/g) ?? []).length, 1);
  const declaration = block(variables, 'variable "provisioner_image_tag"');

  assert.match(declaration, /type\s*=\s*string/);
  assert.ok(!/^\s*default\s*=/m.test(declaration), 'sin default');
  assert.match(declaration, /length\(trimspace\(var\.provisioner_image_tag\)\)\s*>\s*0/);

  // Solo se autorreferencia: no depende de ninguna otra variable de tag.
  assert.equal(varReferences(declaration, 'provisioner_image_tag'), 1);
  assert.equal(varReferences(declaration, 'api_image_tag'), 0);
  assert.equal(varReferences(declaration, 'migrator_image_tag'), 0);
});

test('S8c11.4b-2: la imagen del provisioner usa SOLO provisioner_image_tag', () => {
  assert.match(
    provisionerTaskDefinition,
    /\bimage\s*=\s*"\$\{aws_ecr_repository\.api\.repository_url\}:\$\{var\.provisioner_image_tag\}"/
  );
  assert.equal(varReferences(provisionerTaskDefinition, 'provisioner_image_tag'), 1);
  assert.equal(varReferences(provisionerTaskDefinition, 'api_image_tag'), 0);
  assert.equal(varReferences(provisionerTaskDefinition, 'migrator_image_tag'), 0);
  assert.ok(!provisionerTaskDefinition.includes('latest'));

  // Y las otras task definitions no lo usan.
  for (const name of ['api', 'ai', 'migrator']) {
    const other = block(ecs, `resource "aws_ecs_task_definition" "${name}"`);
    assert.equal(varReferences(other, 'provisioner_image_tag'), 0, name);
  }

  // Ninguna linea ejecutable mezcla el tag del provisioner con otro tag.
  for (const file of tfFileNames()) {
    for (const line of executableHcl(readTf(file)).split('\n')) {
      assert.ok(
        !(
          /\bvar\.provisioner_image_tag\b/.test(line) &&
          /\bvar\.(api|migrator|ai)_image_tag\b/.test(line)
        ),
        `linea que mezcla tags en ${file}`
      );
    }
  }
});

test('S8c11.4b-3: el ejemplo de tfvars deja provisioner_image_tag comentada', () => {
  const example = readFileSync(
    join(TERRAFORM_PROD_DIR, 'terraform.tfvars.example'),
    'utf8'
  );
  const uncommented = example
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

  assert.ok(!uncommented.includes('provisioner_image_tag'));
  assert.match(example, /# provisioner_image_tag\s*=/);
});

// ---------------------------------------------------------------------------
// DEDICATED_TASK
// ---------------------------------------------------------------------------

test('S8c11.4b-4: task definition propia, Fargate, entryPoint fijo y command que falla cerrado', () => {
  assert.equal(
    (ecs.match(/resource "aws_ecs_task_definition" "provisioner"/g) ?? []).length,
    1
  );
  assert.match(provisionerTaskDefinition, /requires_compatibilities\s*=\s*\["FARGATE"\]/);
  assert.match(provisionerTaskDefinition, /network_mode\s*=\s*"awsvpc"/);
  assert.match(
    provisionerTaskDefinition,
    /family\s*=\s*"\$\{local\.name_prefix\}-provisioner"/
  );

  assert.match(
    provisionerTaskDefinition,
    /entryPoint\s*=\s*\["\/bin\/sh", "\/app\/services\/api\/docker\/provisioner-entrypoint\.sh"\]/
  );
  assert.match(provisionerTaskDefinition, /command\s*=\s*\["disabled"\]/);

  // Sin npm, sin --env-file, sin ts-node, sin shell libre.
  for (const forbidden of ['npm', '--env-file', 'ts-node', 'bash', '-c']) {
    assert.ok(!provisionerTaskDefinition.includes(`"${forbidden}"`), forbidden);
  }
  assert.ok(!provisionerTaskDefinition.includes('--env-file'));
});

test('S8c11.4b-5: el provisioner no tiene servicio y nada existente referencia su task definition', () => {
  // Sin servicio propio.
  assert.ok(!/resource "aws_ecs_service" "provisioner"/.test(ecs));

  // Solo el broker (provisioner_invocation.tf, S8c11.4c1) puede referenciar la
  // task definition del provisioner. Ningun otro recurso (servicio, trigger,
  // scheduler, politica, etc.) lo hace.
  for (const file of tfFileNames()) {
    if (file === 'provisioner_invocation.tf') continue;
    assert.ok(
      !/aws_ecs_task_definition\.provisioner/.test(executableHcl(readTf(file))),
      `${file} referencia la task definition del provisioner`
    );
  }

  // Las workloads existentes no usan la task definition ni los roles del provisioner.
  for (const service of ['api', 'ai']) {
    const body = block(ecs, `resource "aws_ecs_service" "${service}"`);
    assert.ok(!body.includes('provisioner'), `aws_ecs_service.${service}`);
  }
  for (const definition of ['api', 'ai', 'migrator']) {
    const body = block(ecs, `resource "aws_ecs_task_definition" "${definition}"`);
    assert.ok(!body.includes('provisioner'), `task definition ${definition}`);
  }
});

// ---------------------------------------------------------------------------
// DATABASE
// ---------------------------------------------------------------------------

test('S8c11.4b-6: DATABASE_URL (scope_app) entra por ECS secrets, nunca en claro ni maestra', () => {
  assert.match(
    provisionerTaskDefinition,
    /secrets\s*=\s*\[\s*\{\s*name\s*=\s*"DATABASE_URL"\s*valueFrom\s*=\s*"\$\{local\.ssm_parameter_arn_prefix\}\$\{local\.api_secret_parameters\.DATABASE_URL\}"\s*\}/
  );

  // Es el MISMO parametro que usa la API.
  assert.match(
    executableHcl(readTf('locals.tf')),
    /DATABASE_URL\s*=\s*"\$\{local\.ssm_prefix\}\/api\/DATABASE_URL"/
  );

  const environment = provisionerTaskDefinition.slice(
    provisionerTaskDefinition.indexOf('environment = ['),
    provisionerTaskDefinition.indexOf('secrets = [')
  );
  assert.ok(!environment.includes('DATABASE_URL'));
  assert.deepEqual(
    [...environment.matchAll(/name\s*=\s*"(\w+)"/g)].map((m) => m[1]),
    ['AWS_REGION', 'PUBLIC_DID_BASE_URL']
  );

  // Nada de la identidad maestra de RDS.
  for (const forbidden of [
    'RDS_MASTER',
    'rds_master',
    'secretsmanager',
    'SCOPE_APP_DATABASE_URL',
    'migrator-entrypoint'
  ]) {
    assert.ok(!provisionerTaskDefinition.includes(forbidden), forbidden);
  }
});

// ---------------------------------------------------------------------------
// TASK_ROLE
// ---------------------------------------------------------------------------

const signerCreatePolicy = block(
  iam,
  'data "aws_iam_policy_document" "provisioner_signer_create"'
);

test('S8c11.4b-7: el task role solo CREA secretos de signer, acotado al prefijo', () => {
  const allows = block(signerCreatePolicy, 'statement {');
  assert.match(allows, /effect\s*=\s*"Allow"/);
  assert.match(allows, /actions\s*=\s*\["ssm:PutParameter"\]/);

  // Todas las acciones del documento son PutParameter y todos los recursos son
  // el prefijo de signers: nada de comodines.
  assert.deepEqual(
    [...signerCreatePolicy.matchAll(/actions\s*=\s*\[([^\]]*)\]/g)].map((m) => m[1].trim()),
    ['"ssm:PutParameter"', '"ssm:PutParameter"']
  );
  assert.deepEqual(
    [...signerCreatePolicy.matchAll(/resources\s*=\s*\[([^\]]*)\]/g)].map((m) =>
      m[1].trim()
    ),
    [SIGNERS_ARN, SIGNERS_ARN]
  );
  assert.ok(!/resources\s*=\s*\["\*"\]/.test(signerCreatePolicy));

  for (const forbidden of [
    'ssm:GetParameter',
    'ssm:GetParameters',
    'ssm:GetParametersByPath',
    'ssm:DeleteParameter',
    'ssm:DeleteParameters',
    'ssm:DescribeParameters',
    'ssm:*',
    'kms:',
    'ssmmessages',
    'ecs:',
    'iam:',
    'ecr:',
    'logs:',
    'rds:',
    's3:',
    'secretsmanager:'
  ]) {
    assert.ok(!signerCreatePolicy.includes(forbidden), forbidden);
  }
});

test('S8c11.4b-8: IAM prohibe sobrescribir un signer (create-only), sin depender de la CLI', () => {
  const deny = signerCreatePolicy.slice(signerCreatePolicy.indexOf('effect    = "Deny"') - 80);

  assert.match(signerCreatePolicy, /effect\s*=\s*"Deny"/);
  assert.match(deny, /actions\s*=\s*\["ssm:PutParameter"\]/);
  assert.match(deny, new RegExp(`resources\\s*=\\s*\\[${SIGNERS_ARN.replace(/[$*{}]/g, '\\$&')}\\]`));
  assert.match(
    deny,
    /condition\s*\{\s*test\s*=\s*"StringEquals"\s*variable\s*=\s*"ssm:Overwrite"\s*values\s*=\s*\["true"\]\s*\}/
  );

  // Exactamente un Allow y un Deny.
  assert.equal((signerCreatePolicy.match(/effect\s*=\s*"Allow"/g) ?? []).length, 1);
  assert.equal((signerCreatePolicy.match(/effect\s*=\s*"Deny"/g) ?? []).length, 1);
});

test('S8c11.4b-9: el task role tiene UNA politica, sin ECS Exec ni ssmmessages', () => {
  const attachments = [...iam.matchAll(/resource "aws_iam_role_policy" "(\w+)" \{/g)].map(
    (match) => {
      const body = block(iam, `resource "aws_iam_role_policy" "${match[1]}" {`);
      return {
        name: match[1],
        role: /role\s*=\s*([^\n]+)/.exec(body)?.[1].trim(),
        policy: /policy\s*=\s*([^\n]+)/.exec(body)?.[1].trim()
      };
    }
  );

  const forTaskRole = attachments.filter(
    (attachment) => attachment.role === 'aws_iam_role.provisioner_task.id'
  );
  assert.deepEqual(
    forTaskRole.map((attachment) => attachment.policy),
    ['data.aws_iam_policy_document.provisioner_signer_create.json']
  );

  // Ninguna otra politica adjunta esta politica de escritura.
  assert.equal(
    attachments.filter((a) => a.policy?.includes('provisioner_signer_create')).length,
    1
  );

  // No hay count/ECS Exec en el rol: el documento de ssmmessages no se le adjunta.
  assert.ok(
    !attachments.some(
      (attachment) =>
        attachment.role?.includes('provisioner') &&
        attachment.policy?.includes('ecs_exec')
    )
  );
});

// ---------------------------------------------------------------------------
// EXECUTION_ROLE
// ---------------------------------------------------------------------------

test('S8c11.4b-10: el execution role es propio, no esta en execution_roles y solo lee DATABASE_URL', () => {
  const policy = block(iam, 'data "aws_iam_policy_document" "provisioner_execution"');

  // Recurso standalone: no usa el for_each de la matriz de execution roles.
  const role = block(iam, 'resource "aws_iam_role" "provisioner_execution"');
  assert.ok(!role.includes('for_each'));

  const locals = executableHcl(readTf('locals.tf'));
  const matrix = block(locals, 'execution_roles = {');
  assert.ok(!matrix.includes('provisioner'));

  assert.deepEqual(
    [...policy.matchAll(/"((?:ecr|logs|ssm|secretsmanager|kms):[A-Za-z*]+)"/g)].map(
      (m) => m[1]
    ),
    [
      'ecr:GetAuthorizationToken',
      'ecr:BatchCheckLayerAvailability',
      'ecr:BatchGetImage',
      'ecr:GetDownloadUrlForLayer',
      'logs:CreateLogStream',
      'logs:PutLogEvents',
      'ssm:GetParameters'
    ]
  );

  assert.match(
    policy,
    /resources\s*=\s*\["\$\{local\.ssm_parameter_arn_prefix\}\$\{local\.api_secret_parameters\.DATABASE_URL\}"\]/
  );
  assert.match(policy, /resources\s*=\s*\[aws_ecr_repository\.api\.arn\]/);
  assert.match(policy, /resources\s*=\s*\["\$\{aws_cloudwatch_log_group\.provisioner\.arn\}:\*"\]/);

  for (const forbidden of [
    'signers',
    'PutParameter',
    'GetParameter"',
    'secretsmanager',
    'rds_master',
    'RPC',
    'kms:'
  ]) {
    assert.ok(!policy.includes(forbidden), forbidden);
  }
});

test('S8c11.4b-11: log group propio con la retencion comun', () => {
  const logs = executableHcl(readTf('logs.tf'));
  const group = block(logs, 'resource "aws_cloudwatch_log_group" "provisioner"');

  assert.match(group, /name\s*=\s*"\/scope\/\$\{var\.environment\}\/provisioner"/);
  assert.match(group, /retention_in_days\s*=\s*var\.log_retention_days/);
});

// ---------------------------------------------------------------------------
// NETWORK
// ---------------------------------------------------------------------------

test('S8c11.4b-12: SG dedicado, sin ingreso, y RDS 5432 solo desde ese SG ademas de los existentes', () => {
  assert.match(securityGroups, /resource "aws_security_group" "provisioner"/);

  // El SG del provisioner no tiene ninguna regla de ingreso.
  for (const match of securityGroups.matchAll(
    /resource "aws_vpc_security_group_ingress_rule" "(\w+)"/g
  )) {
    const rule = block(
      securityGroups,
      `resource "aws_vpc_security_group_ingress_rule" "${match[1]}"`
    );
    assert.ok(
      !/^\s*security_group_id\s*=\s*aws_security_group\.provisioner\.id/m.test(rule),
      `${match[1]} abre ingreso en el SG del provisioner`
    );
  }

  const rdsIngress = block(
    securityGroups,
    'resource "aws_vpc_security_group_ingress_rule" "rds_from_provisioner"'
  );
  assert.match(rdsIngress, /security_group_id\s*=\s*aws_security_group\.rds\.id/);
  assert.match(rdsIngress, /from_port\s*=\s*5432/);
  assert.match(rdsIngress, /to_port\s*=\s*5432/);
  assert.match(
    rdsIngress,
    /referenced_security_group_id\s*=\s*aws_security_group\.provisioner\.id/
  );
  assert.ok(!rdsIngress.includes('cidr_'), 'nunca por CIDR');

  // Las reglas existentes no cambian.
  for (const [rule, source] of [
    ['rds_from_api', 'aws_security_group.api.id'],
    ['rds_from_migrator', 'aws_security_group.migrator.id']
  ]) {
    const existing = block(
      securityGroups,
      `resource "aws_vpc_security_group_ingress_rule" "${rule}"`
    );
    assert.match(existing, new RegExp(`referenced_security_group_id\\s*=\\s*${source.replace('.', '\\.')}`));
  }

  // Egress: 443, DNS dentro de la VPC y PostgreSQL al SG de RDS.
  const egressRules = [
    ...securityGroups.matchAll(
      /resource "aws_vpc_security_group_egress_rule" "(provisioner_\w+)"/g
    )
  ].map((m) => m[1]);
  assert.deepEqual(egressRules.sort(), [
    'provisioner_dns_tcp',
    'provisioner_dns_udp',
    'provisioner_https',
    'provisioner_to_rds'
  ]);
  assert.match(
    block(securityGroups, 'resource "aws_vpc_security_group_egress_rule" "provisioner_to_rds"'),
    /referenced_security_group_id\s*=\s*aws_security_group\.rds\.id/
  );
});

// ---------------------------------------------------------------------------
// DEPLOY_ROLE: NO ADQUIERE AUTORIDAD SOBRE EL PROVISIONER
// ---------------------------------------------------------------------------

test('S8c11.4b-13: el rol de deploy de CI/CD no puede pasar, lanzar ni entrar al provisioner', () => {
  assert.ok(!oidc.includes('provisioner'), 'github_oidc.tf no nombra al provisioner');

  // PassRole sigue siendo EXACTAMENTE: los execution roles de la matriz mas las
  // tres task roles historicas.
  const passRole = statementBlock(oidc, 'PassEcsTaskRolesOnly');
  assert.match(passRole, /\[for role in aws_iam_role\.execution : role\.arn\]/);
  assert.deepEqual(
    [...passRole.matchAll(/aws_iam_role\.(\w+)\.arn/g)].map((m) => m[1]).sort(),
    ['ai_task', 'api_task', 'migrator_task']
  );

  // La matriz que ese statement enumera NO contiene al provisioner.
  const locals = executableHcl(readTf('locals.tf'));
  const matrix = block(locals, 'execution_roles = {');
  assert.deepEqual(
    [...matrix.matchAll(/^\s{4}(\w+) = \{/gm)].map((m) => m[1]),
    ['api', 'ai', 'migrator']
  );

  // RunTask sigue limitado a la familia del migrator.
  const runTask = statementBlock(oidc, 'EcsRunMigrator');
  assert.match(runTask, /task-definition\/\$\{local\.name_prefix\}-migrator:\*/);
  assert.ok(!runTask.includes('provisioner'));

  // El rol de deploy actual no tiene ecs:ExecuteCommand (sobre nada: menos aun
  // sobre el provisioner), y los roles del provisioner no reciben ssmmessages ni
  // ExecuteCommand. Esto no dice nada de principals que Terraform no representa.
  assert.ok(!oidc.includes('ecs:ExecuteCommand'));
  for (const document of [
    block(iam, 'data "aws_iam_policy_document" "provisioner_signer_create"'),
    block(iam, 'data "aws_iam_policy_document" "provisioner_execution"')
  ]) {
    assert.ok(!document.includes('ssmmessages'));
    assert.ok(!document.includes('ecs:ExecuteCommand'));
  }
});

// ---------------------------------------------------------------------------
// SIN MATERIAL SECRETO
// ---------------------------------------------------------------------------

test('S8c11.4b-14: ningun recurso del provisioner contiene material secreto', () => {
  const pieces = [
    provisionerTaskDefinition,
    signerCreatePolicy,
    block(iam, 'data "aws_iam_policy_document" "provisioner_execution"'),
    block(iam, 'resource "aws_iam_role" "provisioner_task"'),
    block(iam, 'resource "aws_iam_role" "provisioner_execution"')
  ];

  for (const piece of pieces) {
    for (const forbidden of [
      'PRIVATE_KEY',
      'private_key',
      'privateKey',
      'mnemonic',
      'passphrase',
      'CREDENTIAL_REGISTRY_RPC_URL',
      'SIGNER_SECRET_REF_PREFIX',
      'SIGNER_SECRET_KMS_KEY_ID',
      'postgresql://'
    ]) {
      assert.ok(!piece.includes(forbidden), forbidden);
    }
  }
});

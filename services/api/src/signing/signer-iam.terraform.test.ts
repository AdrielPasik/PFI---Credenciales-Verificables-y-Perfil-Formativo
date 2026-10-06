/**
 * Guard estatico del permiso IAM de signers -- S8c2.
 *
 * El repo no tenia hasta ahora tests estructurales de Terraform, asi que este
 * es el guard minimo apropiado, con el mismo patron que `credential-v2-contract
 * .test.ts`: un test del API lee un artifact de otra parte del monorepo y
 * congela su contrato.
 *
 * ESTO NO ES VALIDACION CONTRA AWS. Es analisis estatico del HCL: no se ejecuta
 * `terraform plan`, no se ejecuta `terraform apply`, no se consulta ninguna
 * cuenta y no se despliega nada. El permiso queda listo en el codigo; que la
 * tarea lo tenga efectivamente en ECS es un paso de deployment posterior.
 *
 * Lo que congela:
 *   * el permiso vive en el TASK role de la API, no en el execution role;
 *   * es de solo lectura y acotado al prefijo de signers;
 *   * ninguna otra tarea lo tiene;
 *   * Terraform no conoce ningun VALOR de clave privada.
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

const iam = readTf('iam.tf');
const iamCode = executableHcl(iam);

// ---------------------------------------------------------------------------
// 32: EL PERMISO ES DE SOLO LECTURA Y ESTA ACOTADO AL PREFIJO
// ---------------------------------------------------------------------------

test('32: el task role de la API puede leer secretos de signer, y solo leer', () => {
  const policy = block(
    iamCode,
    'data "aws_iam_policy_document" "api_task_signers"'
  );

  const actions = [...policy.matchAll(/"(ssm:[A-Za-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(actions, ['ssm:GetParameter']);

  assert.match(policy, /effect\s*=\s*"Allow"/);
});

test('32: el permiso NO incluye escritura, borrado ni enumeracion', () => {
  const policy = block(
    iamCode,
    'data "aws_iam_policy_document" "api_task_signers"'
  );

  for (const forbidden of [
    'ssm:PutParameter',
    'ssm:DeleteParameter',
    'ssm:DeleteParameters',
    'ssm:GetParametersByPath',
    'ssm:DescribeParameters',
    'ssm:GetParameters',
    'ssm:LabelParameterVersion',
    'ssm:AddTagsToResource',
    'ssm:*'
  ]) {
    assert.ok(
      !policy.includes(forbidden),
      `el task role no debe tener ${forbidden}`
    );
  }
});

test('32: el recurso esta acotado al prefijo de signers y nunca es "*"', () => {
  const policy = block(
    iamCode,
    'data "aws_iam_policy_document" "api_task_signers"'
  );

  assert.match(
    policy,
    /resources\s*=\s*\["\$\{local\.ssm_parameter_arn_prefix\}\$\{local\.ssm_prefix\}\/signers\/\*"\]/
  );

  // Nada de comodines abiertos.
  assert.ok(!/resources\s*=\s*\["\*"\]/.test(policy));
  assert.ok(!policy.includes('arn:aws:ssm:*'));
});

test('el permiso se adjunta al TASK role de la API, no a otro', () => {
  const attachment = block(
    iamCode,
    'resource "aws_iam_role_policy" "api_task_signers"'
  );

  assert.match(attachment, /role\s*=\s*aws_iam_role\.api_task\.id/);
  assert.match(
    attachment,
    /policy\s*=\s*data\.aws_iam_policy_document\.api_task_signers\.json/
  );
});

// ---------------------------------------------------------------------------
// TASK ROLE vs EXECUTION ROLE
// ---------------------------------------------------------------------------

test('el EXECUTION role no recibe ningun permiso nuevo de signers', () => {
  const executionPolicy = block(
    iamCode,
    'data "aws_iam_policy_document" "execution"'
  );

  // El execution role sigue resolviendo exactamente la lista fija de
  // parametros del task definition, via GetParameters (plural) sobre ARNs
  // exactos. Es otra ruta de confianza y no debe mezclarse.
  assert.ok(!executionPolicy.includes('signers'));
  assert.match(executionPolicy, /actions\s*=\s*\["ssm:GetParameters"\]/);
  assert.match(executionPolicy, /resources\s*=\s*each\.value\.parameter_arns/);
});

test('ningun parametro de signer se declara en los secrets del task definition', () => {
  // Los secretos de signer son dinamicos (uno por SignerProfile): no pueden
  // enumerarse en un task definition, y por eso el camino es el task role.
  const locals = executableHcl(readTf('locals.tf'));

  assert.ok(!locals.includes('/signers/'));
  assert.ok(!locals.includes('SIGNER'));
  assert.ok(!locals.includes('PRIVATE_KEY'));
});

/** Cada `aws_iam_role_policy`, con el rol y el documento que adjunta. */
function roleePolicyAttachments(): Array<{
  name: string;
  role: string;
  policy: string;
}> {
  return [
    ...iamCode.matchAll(/resource "aws_iam_role_policy" "(\w+)" \{/g)
  ].map((match) => {
    const attachment = block(
      iamCode,
      `resource "aws_iam_role_policy" "${match[1]}" {`
    );
    const role = /role\s*=\s*([^\n]+)/.exec(attachment);
    const policy = /policy\s*=\s*([^\n]+)/.exec(attachment);
    assert.ok(role && policy, `${match[1]} incompleto`);

    return {
      name: match[1],
      role: role[1].trim(),
      policy: policy[1].trim()
    };
  });
}

test('la politica de signers se adjunta UNA sola vez, y solo al task role de la API', () => {
  const attachments = roleePolicyAttachments();

  const signerAttachments = attachments.filter((attachment) =>
    attachment.policy.includes('api_task_signers')
  );

  assert.deepEqual(
    signerAttachments.map((attachment) => attachment.name),
    ['api_task_signers']
  );
  assert.equal(signerAttachments[0].role, 'aws_iam_role.api_task.id');
});

test('ni la tarea de AI ni la del migrator reciben ninguna politica de signers', () => {
  const attachments = roleePolicyAttachments();

  for (const role of ['ai_task', 'migrator_task']) {
    const forRole = attachments.filter(
      (attachment) => attachment.role === `aws_iam_role.${role}.id`
    );

    // Como maximo la politica opcional de ECS Exec, nunca la de signers.
    for (const attachment of forRole) {
      assert.ok(
        !attachment.policy.includes('signers'),
        `${role} no debe recibir ${attachment.name}`
      );
      assert.equal(
        attachment.policy,
        'data.aws_iam_policy_document.ecs_exec.json',
        `${role} solo puede tener ECS Exec`
      );
    }
  }
});

test('el deploy role de CI/CD no puede leer secretos de signer', () => {
  const oidc = executableHcl(readTf('github_oidc.tf'));

  assert.ok(!oidc.includes('signers'));
  assert.ok(!oidc.includes('ssm:GetParameter"'));
});

// ---------------------------------------------------------------------------
// KMS
// ---------------------------------------------------------------------------

test('no se agrega ningun permiso de KMS ni ninguna CMK', () => {
  // Decision explicita, consistente con la regla que ya documenta la cabecera
  // de iam.tf: los SecureString usan la clave administrada por AWS
  // alias/aws/ssm, cuya key policy ya admite a los principals de la cuenta
  // cuando la llamada llega por el servicio dueño. Un grant explicito solo hace
  // falta con una customer managed key, y no se usa ninguna.
  assert.ok(!iamCode.includes('kms:Decrypt'));
  assert.ok(!iamCode.includes('kms:'));
  assert.ok(!iamCode.includes('aws_kms_key'));
  assert.ok(!iamCode.includes('aws_kms_alias'));

  // Y la regla sigue documentada en la cabecera, no solo en un test.
  assert.match(iam, /kms:Decrypt is deliberately NOT granted/);
});

// ---------------------------------------------------------------------------
// TERRAFORM NUNCA CONOCE UN VALOR
// ---------------------------------------------------------------------------

test('ningun archivo de Terraform declara material de clave de signer', () => {
  const files = readdirSync(TERRAFORM_PROD_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tf'))
    .map((entry) => entry.name);

  assert.ok(files.length > 0);

  for (const name of files) {
    const code = executableHcl(readTf(name));

    for (const forbidden of [
      'private_key',
      'privateKey',
      'PRIVATE_KEY',
      'mnemonic',
      'seed_phrase',
      'signer_key',
      'SIGNER_PRIVATE_KEY'
    ]) {
      assert.ok(
        !code.includes(forbidden),
        `${name} no debe declarar ${forbidden}`
      );
    }
  }
});

test('Terraform no crea ningun aws_ssm_parameter de tipo SecureString', () => {
  // Invariante preexistente del repo, que S8c2 no debe romper: un
  // `aws_ssm_parameter` guarda su `value` en el state. Los secretos de signer
  // se crean fuera de banda.
  const files = readdirSync(TERRAFORM_PROD_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.tf'))
    .map((entry) => entry.name);

  for (const name of files) {
    const code = executableHcl(readTf(name));
    assert.ok(!code.includes('"SecureString"'), `${name}`);
  }

  const ssm = executableHcl(readTf('ssm.tf'));
  assert.match(ssm, /type\s*=\s*"String"/);
  assert.ok(!ssm.includes('signers'));
});

test('ninguna salida de Terraform expone algo de signers', () => {
  const outputs = executableHcl(readTf('outputs.tf'));

  // Ojo: `outputs.tf` SI menciona "Private subnets" y "Private DNS namespace",
  // que son red y no tienen nada que ver con material de firma. Lo que se
  // comprueba es el dominio de signers y las claves, no la palabra "private".
  for (const forbidden of [
    'signer',
    'Signer',
    'private_key',
    'privateKey',
    'PRIVATE_KEY',
    'secretRef',
    'mnemonic'
  ]) {
    assert.ok(
      !outputs.includes(forbidden),
      `outputs.tf no debe exponer ${forbidden}`
    );
  }
});

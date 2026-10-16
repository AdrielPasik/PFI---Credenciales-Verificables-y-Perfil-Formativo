/**
 * Guards ESTATICOS de la preparacion de Base Sepolia -- S8 cierre.
 *
 * Analisis del HCL y de los archivos versionados. NO es validacion contra AWS:
 * no se ejecuta plan ni apply, no se consulta ninguna cuenta y no se activa nada.
 * Congela que el repositorio queda LISTO para una activacion posterior en DOS
 * fases explicitas, y que ninguna de las dos ocurre por un despliegue comun.
 *
 *   FASE 1  codigo + IAM + task definition con capacidad, produccion en MOCK.
 *   FASE 2  activacion explicita: secreto del RPC fuera de banda, valores del
 *           target en SSM, y recien entonces el modo.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import test from 'node:test';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const PROD = join(REPO_ROOT, 'infra', 'terraform', 'prod');

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const tf = (name: string) => read(join(PROD, name));

function executable(contents: string): string {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#') && !line.trimStart().startsWith('//'))
    .join('\n');
}

function block(contents: string, header: string): string {
  const start = contents.indexOf(header);
  assert.notEqual(start, -1, `no se encontro ${header}`);

  let depth = 0;
  for (let cursor = contents.indexOf('{', start); cursor < contents.length; cursor += 1) {
    if (contents[cursor] === '{') depth += 1;
    if (contents[cursor] === '}') {
      depth -= 1;
      if (depth === 0) return contents.slice(start, cursor + 1);
    }
  }

  return assert.fail(`bloque ${header} sin cerrar`);
}

const SIGNER_PREFIX_EXPRESSION = '"${local.ssm_prefix}/signers/"';

// ---------------------------------------------------------------------------
// F. ACCESO DEL API A LOS SIGNERS
// ---------------------------------------------------------------------------

test('S8-F1: el TASK role de la API lee SOLO /signers/* con ssm:GetParameter y nada mas', () => {
  const iam = executable(tf('iam.tf'));
  const document = block(iam, 'data "aws_iam_policy_document" "api_task_signers"');
  const attachment = block(iam, 'resource "aws_iam_role_policy" "api_task_signers"');

  assert.equal((document.match(/statement\s*\{/g) ?? []).length, 1, 'una sola sentencia');
  assert.match(document, /effect\s*=\s*"Allow"/);
  assert.match(document, /actions\s*=\s*\["ssm:GetParameter"\]/);
  assert.match(
    document,
    /resources\s*=\s*\["\$\{local\.ssm_parameter_arn_prefix\}\$\{local\.ssm_prefix\}\/signers\/\*"\]/
  );

  for (const forbidden of [
    'ssm:PutParameter',
    'ssm:DeleteParameter',
    'ssm:GetParametersByPath',
    'ssm:GetParameters"',
    'ssm:*',
    'kms:',
    'iam:',
    '"*"'
  ]) {
    assert.equal(document.includes(forbidden), false, `no debe contener ${forbidden}`);
  }

  // Se adjunta al TASK role de la API, nunca al execution role ni a otra tarea.
  assert.match(attachment, /role\s*=\s*aws_iam_role\.api_task\.id/);
  assert.equal(/api_task_signers/.test(block(iam, 'data "aws_iam_policy_document" "execution"')), false);
});

test('S8-F2: los signers usan la clave administrada aws/ssm, asi que NO se concede kms:Decrypt', () => {
  // Evidencia LIVE (S8, solo lectura): `describe-parameters` informa KeyId =
  // alias/aws/ssm para los dos SecureStrings de /scope/prod/signers/. Con esa
  // clave la politica de la clave ya admite a las entidades de la cuenta a
  // traves de SSM. Una concesion KMS inventada ampliaria la superficie sin razon.
  const hcl = executable(tf('iam.tf'));

  assert.equal(/kms:Decrypt/.test(hcl), false);
  assert.equal(/aws_kms_/.test(executable(readdirSync(PROD).filter((f) => f.endsWith('.tf')).map(tf).join('\n'))), false);
});

test('S8-F3: SIGNER_SECRET_REF_PREFIX esta en el entorno de la API, es publico y coincide con el prefijo de IAM', () => {
  const locals = executable(tf('locals.tf'));
  const apiEnvironment = block(locals, 'api_environment = {');

  assert.ok(
    apiEnvironment.includes(`SIGNER_SECRET_REF_PREFIX = ${SIGNER_PREFIX_EXPRESSION}`),
    'api_environment fija el prefijo'
  );
  // El MISMO namespace que concede la politica de IAM.
  assert.ok(tf('iam.tf').includes('${local.ssm_prefix}/signers/*'));

  // Es entorno plano (valor publico), nunca secreto ni de otras tareas.
  assert.equal(block(locals, 'ai_environment = {').includes('SIGNER_SECRET_REF_PREFIX'), false);
  assert.equal(/SIGNER_SECRET_REF_PREFIX/.test(executable(tf('ecs.tf')).replace(/local\.api_environment/g, '')), false);
});

test('S8-F4: el store de signers aplica el prefijo cuando esta definido (el guard existe en el codigo)', () => {
  const factory = read(join(__dirname, '..', 'signing', 'signer-secret-store.factory.ts'));
  const store = read(join(__dirname, '..', 'signing', 'aws-ssm-signer-secret-store.ts'));

  assert.match(factory, /env\.SIGNER_SECRET_REF_PREFIX/);
  assert.match(store, /startsWith\(this\.secretRefPrefix\)/);
});

test('S8-F5: el UNICO lector de /signers/* es el TASK role de la API; ningun otro rol gana lectura', () => {
  const iam = executable(tf('iam.tf'));

  // Toda sentencia que mencione el namespace de signers debe ser de api_task_signers
  // (lectura) o, si existiera un provisioner, de su politica de creacion (escritura).
  const readers = [...iam.matchAll(/data "aws_iam_policy_document" "(\w+)"/g)]
    .map((match) => match[1])
    .filter((name) => {
      const policy = block(iam, `data "aws_iam_policy_document" "${name}"`);
      return /\/signers\//.test(policy) && /ssm:GetParameter/.test(policy);
    });
  assert.deepEqual(readers, ['api_task_signers']);

  // Si hay un provisioner, solo CREA: sin lectura de signers.
  if (iam.includes('data "aws_iam_policy_document" "provisioner_signer_create"')) {
    const provisioner = block(iam, 'data "aws_iam_policy_document" "provisioner_signer_create"');
    assert.match(provisioner, /ssm:PutParameter/);
    assert.equal(/ssm:GetParameter/.test(provisioner), false);
  }
});

// ---------------------------------------------------------------------------
// G. ACTIVACION EN DOS FASES
// ---------------------------------------------------------------------------

test('S8-G1: el modo por defecto es mock y NINGUN archivo versionado lo activa', () => {
  const variable = block(executable(tf('variables.tf')), 'variable "blockchain_evidence_mode"');

  assert.match(variable, /default\s*=\s*"mock"/);
  assert.match(variable, /contains\(\["mock",\s*"credential_registry"\]/);

  const example = tf('terraform.tfvars.example')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  assert.equal(/blockchain_evidence_mode\s*=/.test(example), false, 'el ejemplo no activa el modo real');
  assert.equal(/credential_registry/.test(example), false);
});

test('S8-G2: el modo real solo puede salir de una variable explicita de Terraform MAS un valor de SSM (dos compuertas)', () => {
  const locals = executable(tf('locals.tf'));
  const ssm = executable(tf('ssm.tf'));

  // Compuerta A: cablea el secreto del RPC en la task definition.
  assert.match(locals, /blockchain_registry_mode_enabled\s*=\s*var\.blockchain_evidence_mode\s*==\s*"credential_registry"/);
  // Compuerta B: el VALOR del modo vive en SSM y Terraform lo ignora tras crearlo.
  assert.match(block(ssm, 'resource "aws_ssm_parameter" "managed_strings"'), /ignore_changes\s*=\s*\[value\]/);
});

test('S8-G3: el target de Base Sepolia arranca en "unset" (fail-closed) y Terraform no declara valores del deployment', () => {
  const managed = block(executable(tf('locals.tf')), 'managed_string_parameters = {');

  for (const name of [
    'CREDENTIAL_REGISTRY_NETWORK',
    'CREDENTIAL_REGISTRY_CHAIN_ID',
    'CREDENTIAL_REGISTRY_CONTRACT_ADDRESS',
    'CREDENTIAL_REGISTRY_DEPLOYMENT_ID'
  ]) {
    assert.match(managed, new RegExp(`/api/${name}"\\s*=\\s*"unset"`), name);
  }

  const all = readdirSync(PROD)
    .filter((file) => file.endsWith('.tf'))
    .map((file) => executable(tf(file)))
    .join('\n');
  assert.equal(/0xCb7401e268f61b1242B17fE141453471CFbdc6e1/i.test(all), false);
  assert.equal(/\b84532\b/.test(all), false);
});

test('S8-G4: el RPC es una SecureString por NOMBRE, inyectada como secret de ECS, nunca como environment', () => {
  const locals = executable(tf('locals.tf'));
  const ecs = executable(tf('ecs.tf'));
  const apiTask = block(ecs, 'resource "aws_ecs_task_definition" "api"');

  assert.match(locals, /CREDENTIAL_REGISTRY_RPC_URL\s*=\s*"\$\{local\.ssm_prefix\}\/api\/CREDENTIAL_REGISTRY_RPC_URL"/);
  assert.equal(block(locals, 'api_environment = {').includes('CREDENTIAL_REGISTRY_RPC_URL'), false);
  assert.match(apiTask, /secrets\s*=\s*\[/);
  assert.equal(/aws_ssm_parameter"\s+"[^"]*rpc/i.test(all(tf)), false, 'Terraform no crea el parametro del RPC');
});

function all(reader: (name: string) => string): string {
  return readdirSync(PROD)
    .filter((file) => file.endsWith('.tf'))
    .map((file) => executable(reader(file)))
    .join('\n');
}

test('S8-G5: el acceso al secreto del RPC es del EXECUTION role (ssm:GetParameters), no del task role', () => {
  const iam = executable(tf('iam.tf'));
  const execution = block(iam, 'data "aws_iam_policy_document" "execution"');
  const taskSigners = block(iam, 'data "aws_iam_policy_document" "api_task_signers"');

  assert.match(execution, /actions\s*=\s*\["ssm:GetParameters"\]/);
  assert.equal(/RPC/i.test(taskSigners), false);
  assert.equal(/CREDENTIAL_REGISTRY/.test(taskSigners), false);
});

test('S8-G6: el navegador no recibe nada de la cadena ni de los signers', () => {
  const webSource = join(REPO_ROOT, 'apps', 'web');
  const offenders: string[] = [];

  function scan(directory: string) {
    for (const entry of readdirSync(directory)) {
      if (['node_modules', '.next', 'tests'].includes(entry)) continue;
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        scan(path);
        continue;
      }
      if (!/\.(ts|tsx|mjs|js|json|env|example)$/.test(entry) || /\.test\./.test(entry)) continue;
      const text = read(path);
      if (/CREDENTIAL_REGISTRY|RPC_URL|PRIVATE_KEY|SIGNER_SECRET|secretRef|NEXT_PUBLIC_[A-Z_]*(RPC|SIGNER|PRIVATE|SECRET)/.test(text)) {
        offenders.push(path.replace(REPO_ROOT, ''));
      }
    }
  }

  scan(join(webSource, 'src'));
  for (const file of ['.env.example', 'next.config.ts']) {
    const path = join(webSource, file);
    if (existsSync(path)) {
      assert.equal(
        /CREDENTIAL_REGISTRY|RPC_URL|PRIVATE_KEY|SIGNER_SECRET|NEXT_PUBLIC_[A-Z_]*(RPC|SIGNER|PRIVATE|SECRET)/.test(read(path)),
        false,
        file
      );
    }
  }

  assert.deepEqual(offenders, []);
});

test('S8-G7: el manifest canonico existe y coincide con el target que se cargara en SSM', () => {
  const file = join(
    REPO_ROOT,
    'contracts',
    'deployments',
    'base-sepolia-84532-0xcb7401e268f61b1242b17fe141453471cfbdc6e1.json'
  );
  const manifest = JSON.parse(read(file));

  assert.equal(manifest.network, 'base_sepolia');
  assert.equal(manifest.chainId, 84532);
  assert.equal(manifest.contractAddress, '0xCb7401e268f61b1242B17fE141453471CFbdc6e1');
  assert.equal(
    manifest.deploymentId,
    'base-sepolia-84532-0xcb7401e268f61b1242b17fe141453471cfbdc6e1'
  );
  assert.equal(manifest.deploymentBlockNumber, 47934147);
});

test('S8-G8: la imagen de la API incluye los manifests (la reconciliacion lee el bloque de deploy)', () => {
  const dockerfile = read(join(REPO_ROOT, 'services', 'api', 'Dockerfile'));

  // Solo los manifests publicados (glob), no el directorio entero ni contracts/.
  assert.match(
    dockerfile,
    /^COPY contracts\/deployments\/base-sepolia-\*\.json \.\/contracts\/deployments\/$/m
  );
  assert.equal(/^COPY contracts(\s|\/?$)/m.test(dockerfile), false);
  assert.equal(/^COPY contracts\/deployments \.\//m.test(dockerfile), false);

  // La ruta de la imagen es exactamente la que lee el codigo: WORKDIR /app, la
  // salida compilada en services/api/dist/blockchain y cuatro niveles hasta /app.
  assert.match(dockerfile, /^WORKDIR \/app$/m);
  assert.match(dockerfile, /^CMD \["node", "dist\/main\.js"\]$/m);
  const runtimeDirectory = '/app/services/api/dist/blockchain';
  assert.equal(
    posix.resolve(runtimeDirectory, '..', '..', '..', '..', 'contracts', 'deployments'),
    '/app/contracts/deployments'
  );

  // Y nada de lo que se copia puede traer secretos: el patron solo alcanza
  // manifests, y el contenido canonico ya esta cubierto por el guard de manifest.
  const dockerignore = read(join(REPO_ROOT, '.dockerignore'));
  assert.equal(/contracts/.test(dockerignore), false, '.dockerignore no excluye contracts/deployments');
});

test('S8-G9: el servicio de la API espera a los parametros SSM y al permiso del execution role', () => {
  const ecs = executable(tf('ecs.tf'));
  const service = block(ecs, 'resource "aws_ecs_service" "api"');
  const dependsOn = /depends_on\s*=\s*\[([\s\S]*?)\]/.exec(service);

  assert.ok(dependsOn, 'el servicio de la API declara depends_on');
  for (const dependency of [
    'aws_lb_listener.https',
    'aws_ssm_parameter.managed_strings',
    'aws_iam_role_policy.execution'
  ]) {
    assert.ok(dependsOn[1].includes(dependency), dependency);
  }

  // El modo SSM sigue siendo la unica fuente del modo operativo: Terraform solo lo
  // siembra (ignore_changes) y nunca lo pone como variable de entorno plana.
  assert.equal(/BLOCKCHAIN_EVIDENCE_MODE\s*=\s*(var|"mock"|"credential_registry")/.test(
    block(executable(tf('locals.tf')), 'api_environment = {')
  ), false);
});

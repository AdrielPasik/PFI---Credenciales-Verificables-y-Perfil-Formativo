/**
 * Guard estatico del cableado del target de blockchain en Terraform -- S8c5.
 *
 * Mismo patron y mismo alcance que `signer-iam.terraform.test.ts`: analisis
 * ESTATICO del HCL. No se ejecuta `terraform init`, ni `plan`, ni `apply`, no
 * se consulta ninguna cuenta de AWS y no se despliega nada.
 *
 * Lo que congela:
 *
 *   * `BLOCKCHAIN_EVIDENCE_MODE` es un parametro no secreto y sigue en `mock`;
 *   * la identidad del target (red, chainId, direccion, deploymentId) es NO
 *     SECRETA y arranca en "unset", asi que pasar el modo a real sin poblarla
 *     falla cerrado en vez de escribir contra la cadena equivocada;
 *   * `CREDENTIAL_REGISTRY_RPC_URL` viaja como SecureString creada FUERA DE
 *     BANDA: Terraform conoce su NOMBRE, nunca su valor, y no hay ningun
 *     `aws_ssm_parameter` que lo contenga;
 *   * el RPC lo inyecta el AGENTE de ECS, asi que el permiso es del EXECUTION
 *     role y con ARN exacto -- no se mezcla con el TASK role que S8c2 uso para
 *     que la aplicacion lea los secretos de signers;
 *   * no se inventa ningun valor de produccion.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

  assert.fail(`el bloque ${header} no cierra`);
}

function tfFileNames(): string[] {
  return readdirSync(TERRAFORM_PROD_DIR).filter((name) => name.endsWith('.tf'));
}

const TARGET_STRING_VARIABLES = [
  'CREDENTIAL_REGISTRY_NETWORK',
  'CREDENTIAL_REGISTRY_CHAIN_ID',
  'CREDENTIAL_REGISTRY_CONTRACT_ADDRESS',
  'CREDENTIAL_REGISTRY_DEPLOYMENT_ID'
] as const;

// ---------------------------------------------------------------------------
// 43-46: MODO Y TARGET, NO SECRETOS
// ---------------------------------------------------------------------------

test('43: el modo es un parametro no secreto y hoy vale mock', () => {
  const locals = executableHcl(readTf('locals.tf'));
  const managed = block(locals, 'managed_string_parameters = {');

  // S8c5.1: el valor inicial se SIEMBRA desde la variable, para que no haya un
  // segundo "mock" escrito a mano capaz de divergir del condicional del RPC.
  assert.match(
    managed,
    /\/api\/BLOCKCHAIN_EVIDENCE_MODE"\s*=\s*var\.blockchain_evidence_mode/
  );

  const variables = executableHcl(readTf('variables.tf'));
  const modeVariable = block(variables, 'variable "blockchain_evidence_mode"');
  assert.match(modeVariable, /default\s*=\s*"mock"/);

  const apiStrings = block(locals, 'api_string_parameters = {');
  assert.match(apiStrings, /BLOCKCHAIN_EVIDENCE_MODE\s*=/);
});

test('44-45: la red y el chainId son expresables, y 84532 es alcanzable', () => {
  const locals = executableHcl(readTf('locals.tf'));
  const apiStrings = block(locals, 'api_string_parameters = {');

  for (const variable of TARGET_STRING_VARIABLES) {
    assert.match(
      apiStrings,
      new RegExp(`${variable}\\s*=`),
      `${variable} debe llegar al contenedor`
    );
  }

  // El mapeo red -> chainId vive en TypeScript, no duplicado en HCL: Terraform
  // solo transporta los valores. Lo que se congela aca es que los dos campos
  // existan como entradas independientes, que es lo que permite 84532.
  const managed = block(locals, 'managed_string_parameters = {');
  for (const variable of TARGET_STRING_VARIABLES) {
    assert.match(
      managed,
      new RegExp(`\\/api\\/${variable}"\\s*=\\s*"unset"`),
      `${variable} debe arrancar en "unset"`
    );
  }
});

test('46: la direccion del contrato y el deploymentId son entradas NO secretas', () => {
  const locals = executableHcl(readTf('locals.tf'));

  // Ni en los secretos base ni en la rama condicional del RPC: una direccion de
  // contrato y un identificador de deployment son publicos por naturaleza.
  const base = block(locals, 'api_base_secret_parameters = {');
  const conditional = /api_rpc_secret_parameters = \([\s\S]*?\n  \)/.exec(locals);
  assert.ok(conditional, 'no se encontro el condicional del RPC');

  for (const [label, hcl] of [
    ['api_base_secret_parameters', base],
    ['api_rpc_secret_parameters', conditional[0]]
  ] as const) {
    for (const token of [
      'CREDENTIAL_REGISTRY_CONTRACT_ADDRESS',
      'CREDENTIAL_REGISTRY_DEPLOYMENT_ID',
      'CREDENTIAL_REGISTRY_NETWORK',
      'CREDENTIAL_REGISTRY_CHAIN_ID'
    ]) {
      assert.ok(!hcl.includes(token), `${label} no debe tratar ${token} como secreto`);
    }
  }
});

test('49-50: mock no necesita el secreto del RPC; el modo real exige el target', () => {
  const locals = executableHcl(readTf('locals.tf'));
  const managed = block(locals, 'managed_string_parameters = {');

  // 49: con el modo en "mock" -- el default de la variable -- los cuatro campos
  // del target valen "unset" y nada los necesita. La configuracion es valida
  // tal cual esta hoy, y ademas no exige la SecureString del RPC (ver item 2).
  assert.match(
    managed,
    /BLOCKCHAIN_EVIDENCE_MODE"\s*=\s*var\.blockchain_evidence_mode/
  );
  assert.match(
    block(executableHcl(readTf('variables.tf')), 'variable "blockchain_evidence_mode"'),
    /default\s*=\s*"mock"/
  );

  // 50: y "unset" NO es un valor valido para ninguno de ellos, asi que pasar
  // el modo a credential_registry sin poblarlos hace fallar la resolucion del
  // target en el arranque de la emision -- nunca escribe a ciegas.
  for (const variable of TARGET_STRING_VARIABLES) {
    assert.match(managed, new RegExp(`${variable}"\\s*=\\s*"unset"`), variable);
  }
});

// ---------------------------------------------------------------------------
// 47-48: EL VALOR DEL RPC NUNCA ENTRA A TERRAFORM
// ---------------------------------------------------------------------------

test('47: ningun .tf contiene el VALOR de una rpcUrl', () => {
  for (const name of tfFileNames()) {
    const code = executableHcl(readTf(name));

    // Nombres de proveedores de RPC, endpoints publicos conocidos, el puerto
    // de Anvil y las formas tipicas de una credencial embebida en la URL.
    //
    // NOTA: NO se prohibe `http://` en general. Hay dos usos legitimos y
    // PREEXISTENTES -- el healthcheck del contenedor de IA contra 127.0.0.1 y
    // la URL interna del servicio de IA por DNS privado -- y ninguno es un
    // endpoint de blockchain. Prohibir el esquema entero convertiria esos dos
    // en violaciones sin agregar nada: lo que importa es que no haya un
    // endpoint de RPC.
    for (const token of [
      'alchemy',
      'infura',
      'quiknode',
      'quicknode',
      'ankr.com',
      'blastapi',
      'drpc.org',
      'apiKey',
      'api_key=',
      'base-sepolia.g.',
      'sepolia.base.org',
      ':8545'
    ]) {
      assert.ok(
        !code.toLowerCase().includes(token.toLowerCase()),
        `${name} no debe contener ${token}`
      );
    }

    // Y en particular: a la variable del RPC nunca se le asigna un valor
    // literal; lo unico admitido es la referencia al NOMBRE del parametro.
    const assignments =
      code.match(/CREDENTIAL_REGISTRY_RPC_URL\s*=\s*"[^"]*"/g) ?? [];
    for (const assignment of assignments) {
      assert.ok(
        assignment.includes('${local.ssm_prefix}'),
        `${name} no debe asignarle un valor literal al RPC: ${assignment}`
      );
    }
  }
});

test('47b: no existe ningun aws_ssm_parameter que lleve el RPC', () => {
  const ssm = executableHcl(readTf('ssm.tf'));

  // El unico `aws_ssm_parameter` del repo es el de los Strings no secretos, y
  // su `for_each` son los managed_string_parameters. El RPC no esta ahi.
  const resources = ssm.match(/resource "aws_ssm_parameter" "(\w+)"/g) ?? [];
  assert.deepEqual(resources, ['resource "aws_ssm_parameter" "managed_strings"']);

  const managedStrings = block(ssm, 'resource "aws_ssm_parameter" "managed_strings"');
  assert.match(managedStrings, /for_each = local\.managed_string_parameters/);
  assert.ok(!managedStrings.includes('CREDENTIAL_REGISTRY_RPC_URL'));

  const locals = executableHcl(readTf('locals.tf'));
  const managed = block(locals, 'managed_string_parameters = {');
  assert.ok(
    !managed.includes('CREDENTIAL_REGISTRY_RPC_URL'),
    'el RPC no puede ser un String gestionado por Terraform'
  );
});

test('48: el RPC se espera como SecureString referenciada por NOMBRE', () => {
  const locals = executableHcl(readTf('locals.tf'));

  // S8c5.1: vive en la rama CONDICIONAL, no en los secretos base. Terraform
  // conoce el NOMBRE del parametro; su valor se crea fuera de banda con
  // `aws ssm put-parameter`, igual que DATABASE_URL o JWT_SECRET.
  const conditional = /api_rpc_secret_parameters = \([\s\S]*?\n  \)/.exec(locals);
  assert.ok(conditional, 'no se encontro el condicional del RPC');
  assert.match(
    conditional[0],
    /CREDENTIAL_REGISTRY_RPC_URL = "\$\{local\.ssm_prefix\}\/api\/CREDENTIAL_REGISTRY_RPC_URL"/
  );

  // Y NO esta entre los secretos que se inyectan siempre.
  assert.ok(
    !block(locals, 'api_base_secret_parameters = {').includes(
      'CREDENTIAL_REGISTRY_RPC_URL'
    )
  );
});

/**
 * Archivos de Terraform VERSIONADOS en `infra/terraform/prod`, segun Git.
 *
 * S8c10.2: este test NO enumera el directorio. Un `readdirSync` o un
 * `readFileSync('terraform.tfvars')` dependeria de archivos locales e ignorados
 * del operador (que no existen en un clon limpio, en un worktree de deployment ni
 * en CI) y, peor, leeria valores reales de infraestructura. `git ls-files` lista
 * por construccion SOLO lo versionado.
 */
function trackedTerraformFiles(): string[] {
  const repositoryRoot = join(TERRAFORM_PROD_DIR, '..', '..', '..');
  const listed = execFileSync(
    'git',
    ['ls-files', '--', 'infra/terraform/prod'],
    { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  );

  return listed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) => line.endsWith('.tf') || line.endsWith('terraform.tfvars.example')
    );
}

/**
 * Violaciones del invariante "el RPC no es un valor ordinario de Terraform". PURA:
 * recibe archivos ya leidos, de modo que el invariante tambien se prueba con
 * entradas SINTETICAS inseguras (y se demuestra que sigue fallando).
 */
function rpcModelingViolations(files: ReadonlyArray<{ name: string; hcl: string }>): string[] {
  const violations: string[] = [];
  let referenceOccurrences = 0;

  for (const { name, hcl } of files) {
    const contents = executableHcl(hcl);

    // (a) Ninguna `variable` modela el RPC.
    if (/variable\s+"[^"]*rpc[^"]*"/i.test(contents)) {
      violations.push(`${name}: variable de RPC`);
    }
    if (contents.includes('credential_registry_rpc')) {
      violations.push(`${name}: credential_registry_rpc`);
    }

    // (b) El nombre del secreto es SOLO una referencia al parametro SSM en la rama
    // condicional de locals.tf; nunca un valor en claro, nunca otro archivo.
    const occurrences = (contents.match(/CREDENTIAL_REGISTRY_RPC_URL/g) ?? []).length;
    if (occurrences === 0) {
      continue;
    }
    if (!name.endsWith('/locals.tf')) {
      violations.push(`${name}: menciona CREDENTIAL_REGISTRY_RPC_URL`);
      continue;
    }
    if (
      !contents.includes(
        'CREDENTIAL_REGISTRY_RPC_URL = "${local.ssm_prefix}/api/CREDENTIAL_REGISTRY_RPC_URL"'
      )
    ) {
      violations.push(`${name}: el RPC no es una referencia al parametro SSM`);
    }
    referenceOccurrences += occurrences;
  }

  // Exactamente la referencia (clave y ruta), en el condicional.
  if (referenceOccurrences !== 2) {
    violations.push(`referencias al secreto: ${referenceOccurrences} (se esperaban 2)`);
  }
  return violations;
}

test('38: no hay variable de Terraform cuyo valor seria el RPC (solo archivos versionados)', () => {
  // INVARIANTE ORIGINAL (S8c5): el RPC lleva su credencial en la URL; si fuera una
  // `variable` de Terraform quedaria persistido en tfstate y en los tfvars. Entra
  // SOLO por el mecanismo de secretos (SecureString creada fuera de banda).
  //
  // La version previa verificaba ademas el `terraform.tfvars` REAL del operador,
  // que esta en .gitignore: fallaba en cualquier checkout limpio. Ese archivo ya
  // no se lee. La garantia sobre lo que SI se versiona es la misma o mas fuerte:
  // se revisan TODOS los .tf versionados de prod, no solo `variables.tf`.
  const tracked = trackedTerraformFiles();
  assert.ok(tracked.length >= 10, 'Git deberia listar los .tf versionados de prod');
  assert.ok(tracked.some((name) => name.endsWith('/variables.tf')));
  assert.ok(tracked.some((name) => name.endsWith('/terraform.tfvars.example')));

  const repositoryRoot = join(TERRAFORM_PROD_DIR, '..', '..', '..');
  const files = tracked.map((name) => ({
    name,
    hcl: readFileSync(join(repositoryRoot, name), 'utf8')
  }));

  assert.deepEqual(rpcModelingViolations(files), []);
});

test('38d: el invariante SIGUE FALLANDO si Terraform versionado modelara el RPC de forma insegura', () => {
  const safeLocals = [
    'locals {',
    '  api_rpc_secret_parameters = {',
    '    CREDENTIAL_REGISTRY_RPC_URL = "${local.ssm_prefix}/api/CREDENTIAL_REGISTRY_RPC_URL"',
    '  }',
    '}'
  ].join('\n');
  const base = [{ name: 'infra/terraform/prod/locals.tf', hcl: safeLocals }];

  // La entrada segura pasa: el chequeo no esta simplemente siempre roto.
  assert.deepEqual(rpcModelingViolations(base), []);

  const unsafe: Array<[string, Array<{ name: string; hcl: string }>]> = [
    [
      'variable de Terraform con el RPC',
      [...base, { name: 'infra/terraform/prod/variables.tf', hcl: 'variable "credential_registry_rpc_url" { type = string }' }]
    ],
    [
      'variable con "rpc" en el nombre',
      [...base, { name: 'infra/terraform/prod/variables.tf', hcl: 'variable "base_sepolia_rpc" { type = string }' }]
    ],
    [
      'RPC como valor en claro en la task definition',
      [...base, { name: 'infra/terraform/prod/ecs.tf', hcl: 'environment = [{ name = "CREDENTIAL_REGISTRY_RPC_URL", value = "https://x" }]' }]
    ],
    [
      'RPC como parametro String en claro',
      [{ name: 'infra/terraform/prod/locals.tf', hcl: safeLocals + '\nCREDENTIAL_REGISTRY_RPC_URL = "https://provider.example/KEY"' }]
    ],
    [
      'RPC en un tfvars versionado',
      [...base, { name: 'infra/terraform/prod/terraform.tfvars.example', hcl: 'CREDENTIAL_REGISTRY_RPC_URL = "https://x"' }]
    ],
    [
      'la referencia al secreto desaparece',
      [{ name: 'infra/terraform/prod/locals.tf', hcl: 'locals {}' }]
    ]
  ];

  for (const [label, files] of unsafe) {
    assert.notDeepEqual(rpcModelingViolations(files), [], label);
  }
});

test('38b: el RPC nunca es un valor en claro: ni en environment ni en parametros String', () => {
  const locals = executableHcl(readTf('locals.tf'));
  const ecs = executableHcl(readTf('ecs.tf'));

  assert.ok(
    !block(locals, 'managed_string_parameters = {').includes('RPC'),
    'managed_string_parameters crea Strings en claro: no puede tocar el RPC'
  );
  assert.ok(!block(locals, 'api_string_parameters = {').includes('RPC'));
  assert.ok(!ecs.includes('CREDENTIAL_REGISTRY_RPC_URL'), 'ecs.tf lo consume via locals.api_container_secrets');
  assert.ok(!/api_environment[\s\S]{0,400}CREDENTIAL_REGISTRY_RPC_URL/.test(locals));
});

test('38c: los tfvars reales del operador NUNCA se versionan y este test no los lee', () => {
  const gitignore = readFileSync(
    join(TERRAFORM_PROD_DIR, '..', '.gitignore'),
    'utf8'
  );
  // `*.tfvars` ignorado, y solo las plantillas `*.example` quedan versionadas.
  assert.match(gitignore, /^\*\.tfvars$/m);
  assert.match(gitignore, /^!\*\.example$/m);

  // El archivo versionado de ejemplo es el unico tfvars que se lee aca.
  const self = stripLineComments(readFileSync(__filename, 'utf8'));
  const reads = self.match(/['"`][^'"`\n]*terraform\.tfvars(?!\.example)['"`]/g) ?? [];
  assert.deepEqual(
    reads.filter((literal) => !literal.includes('git') && !literal.includes('*')),
    [],
    'el test no debe abrir terraform.tfvars (archivo local e ignorado)'
  );
});

function stripLineComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

test('el RPC no sale por ningun output', () => {
  const outputs = executableHcl(readTf('outputs.tf'));

  for (const token of [
    'CREDENTIAL_REGISTRY_RPC_URL',
    'rpc_url',
    'rpcUrl',
    'credential_registry_rpc'
  ]) {
    assert.ok(!outputs.includes(token), `outputs.tf no debe exponer ${token}`);
  }
});

// ---------------------------------------------------------------------------
// 37, 51-53: EXECUTION ROLE VS TASK ROLE
// ---------------------------------------------------------------------------

test('51: el acceso al secreto del RPC es del EXECUTION role y con ARN exacto', () => {
  const locals = executableHcl(readTf('locals.tf'));
  const iam = executableHcl(readTf('iam.tf'));

  // El RPC entra por el bloque `secrets` de la task definition, asi que lo
  // resuelve el AGENTE de ECS con el EXECUTION role. Llega ahi por derivacion:
  // api_container_secrets -> execution_roles.api.parameter_arns.
  const apiRole = block(locals, '    api = {');
  assert.match(
    apiRole,
    /for parameter in distinct\(values\(local\.api_container_secrets\)\)/
  );
  assert.match(apiRole, /"\$\{local\.ssm_parameter_arn_prefix\}\$\{parameter\}"/);

  // ARN exacto por parametro. Nada de comodines.
  const executionPolicy = block(
    iam,
    'data "aws_iam_policy_document" "execution"'
  );
  assert.match(executionPolicy, /resources = each\.value\.parameter_arns/);
  assert.match(executionPolicy, /actions = \["ssm:GetParameters"\]/);
});

test('51b: no hay Resource="*" para el secreto del RPC', () => {
  const iam = executableHcl(readTf('iam.tf'));
  const executionPolicy = block(
    iam,
    'data "aws_iam_policy_document" "execution"'
  );

  // El unico `resources = ["*"]` del execution role es el de
  // ecr:GetAuthorizationToken, que no admite recurso. El de parametros NO.
  //
  // El statement vive dentro de un `dynamic "statement"`, asi que se acota por
  // el bloque `content { ... }` que lo contiene, no con una expresion regular
  // sobre llaves (que no sabe anidar).
  const sidIndex = executionPolicy.indexOf('sid    = "ReadOwnParametersOnly"');
  assert.notEqual(sidIndex, -1, 'no se encontro el statement de parametros');

  const contentIndex = executionPolicy
    .slice(0, sidIndex)
    .lastIndexOf('content {');
  assert.notEqual(contentIndex, -1, 'no se encontro el content del statement');

  const parameterStatement = block(
    executionPolicy.slice(contentIndex),
    'content {'
  );

  assert.match(parameterStatement, /actions\s+=\s+\["ssm:GetParameters"\]/);
  assert.match(parameterStatement, /resources\s+=\s+each\.value\.parameter_arns/);
  assert.ok(
    !parameterStatement.includes('"*"'),
    'el acceso a parametros nunca puede ser Resource="*"'
  );
});

test('52: la politica de signers de S8c2 en el TASK role queda intacta', () => {
  const iam = executableHcl(readTf('iam.tf'));

  const signerPolicy = block(
    iam,
    'data "aws_iam_policy_document" "api_task_signers"'
  );

  assert.match(signerPolicy, /sid\s+=\s+"ReadIssuerSignerSecretsOnly"/);
  assert.match(signerPolicy, /actions\s+=\s+\["ssm:GetParameter"\]/);
  assert.match(
    signerPolicy,
    /\$\{local\.ssm_prefix\}\/signers\/\*/
  );

  const attachment = block(iam, 'resource "aws_iam_role_policy" "api_task_signers"');
  assert.match(attachment, /role\s+=\s+aws_iam_role\.api_task\.id/);

  // No gano el RPC.
  assert.ok(!signerPolicy.includes('CREDENTIAL_REGISTRY_RPC_URL'));
  assert.ok(!signerPolicy.includes('credential_registry'));
});

test('53: los dos caminos de confianza NO se mezclan', () => {
  const iam = executableHcl(readTf('iam.tf'));

  // Signer: la APLICACION llama a SSM en runtime -> TASK role, GetParameter.
  const signerPolicy = block(
    iam,
    'data "aws_iam_policy_document" "api_task_signers"'
  );
  assert.ok(signerPolicy.includes('ssm:GetParameter"'));
  assert.ok(!signerPolicy.includes('ssm:GetParameters'));

  // RPC: el AGENTE de ECS inyecta el secreto -> EXECUTION role, GetParameters.
  const executionPolicy = block(
    iam,
    'data "aws_iam_policy_document" "execution"'
  );
  assert.ok(executionPolicy.includes('ssm:GetParameters'));

  // El task role NO recibe acceso al prefijo /api/: no lee el RPC por su
  // cuenta, se lo entregan ya resuelto como variable de entorno.
  assert.ok(
    !signerPolicy.includes(`\${local.ssm_prefix}/api/`),
    'el task role no debe alcanzar los parametros de /api/'
  );
});

// ---------------------------------------------------------------------------
// NO SE INVENTA PRODUCCION
// ---------------------------------------------------------------------------

test('Terraform no declara ningun valor de deployment de Base Sepolia', () => {
  for (const name of tfFileNames()) {
    const code = executableHcl(readTf(name));

    for (const token of [
      'base_sepolia',
      'base-sepolia',
      '84532',
      '31337',
      'deploymentId',
      '0x'
    ]) {
      assert.ok(
        !code.includes(token),
        `${name} no debe fijar ${token}: la identidad del deployment la produce S8c10`
      );
    }
  }
});

test('la clave privada del anchor sigue sin estar en Terraform', () => {
  for (const name of tfFileNames()) {
    const code = executableHcl(readTf(name));

    assert.ok(
      !code.includes('CREDENTIAL_REGISTRY_PRIVATE_KEY'),
      `${name} no debe conocer la clave del signer`
    );
  }
});

// ---------------------------------------------------------------------------
// S8c5.1: EL SECRETO DEL RPC ES CONDICIONAL
//
// El problema que arreglan estos guards: `api_secret_parameters` alimenta
// `api_container_secrets`, que alimenta a la vez el bloque `secrets` de la task
// definition Y los `parameter_arns` del execution role. Con el RPC ahi de forma
// incondicional, una task en MOCK le pedia al agente de ECS resolver una
// SecureString que legitimamente no existe, y el contenedor no arrancaba.
//
// No se ejecuta Terraform: se analiza el HCL. Para razonar sobre el
// condicional, los tests reproducen la MISMA expresion en TypeScript a partir
// de la estructura que leen del archivo, en vez de suponer su resultado.
// ---------------------------------------------------------------------------

/** Claves que se inyectan SIEMPRE, en cualquier modo. */
const ALWAYS_INJECTED_API_SECRETS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'PROFILE_SHARE_TOKEN_KEY',
  'AI_SERVICE_JWT_SECRET'
] as const;

const RPC_PARAMETER_NAME = '/api/CREDENTIAL_REGISTRY_RPC_URL';

/**
 * Resuelve, desde el HCL, que claves tendria `api_secret_parameters` para un
 * modo dado. Lee la estructura real (base + condicional + merge) en vez de
 * repetir una lista escrita a mano.
 */
function resolveApiSecretKeys(mode: 'mock' | 'credential_registry'): string[] {
  const locals = executableHcl(readTf('locals.tf'));

  const base = block(locals, 'api_base_secret_parameters = {');
  const baseKeys = [...base.matchAll(/^\s{4}(\w+)\s*=/gm)].map((match) => match[1]);

  // El condicional: `local.blockchain_registry_mode_enabled ? { ... } : {}`
  const conditional = /api_rpc_secret_parameters = \([\s\S]*?\n  \)/.exec(locals);
  assert.ok(conditional, 'no se encontro el condicional del RPC');

  assert.match(conditional[0], /local\.blockchain_registry_mode_enabled/);
  assert.match(conditional[0], /\?\s*\{\s*CREDENTIAL_REGISTRY_RPC_URL\s*=/);
  assert.match(conditional[0], /:\s*\{\}/);

  // Y la condicion sale del UNICO input de modo del lado de Terraform.
  assert.match(
    locals,
    /blockchain_registry_mode_enabled = var\.blockchain_evidence_mode == "credential_registry"/
  );

  const rpcKeys = mode === 'credential_registry' ? ['CREDENTIAL_REGISTRY_RPC_URL'] : [];

  // `merge(base, rpc)`, en ese orden.
  assert.match(
    locals,
    /api_secret_parameters = merge\(\s*local\.api_base_secret_parameters,\s*local\.api_rpc_secret_parameters\s*\)/
  );

  return [...baseKeys, ...rpcKeys].sort();
}

test('1: en modo mock la task definition NO referencia la SecureString del RPC', () => {
  const keys = resolveApiSecretKeys('mock');

  assert.ok(
    !keys.includes('CREDENTIAL_REGISTRY_RPC_URL'),
    'mock no debe referenciar el secreto del RPC'
  );
  assert.deepEqual(keys, [...ALWAYS_INJECTED_API_SECRETS].sort());

  // El bloque `secrets` de la task definition se deriva de api_container_secrets.
  const locals = executableHcl(readTf('locals.tf'));
  assert.match(
    locals,
    /api_container_secrets = merge\(local\.api_secret_parameters, local\.api_string_parameters\)/
  );

  const ecs = executableHcl(readTf('ecs.tf'));
  assert.match(ecs, /for name, parameter in local\.api_container_secrets/);
});

test('2: en modo mock la SecureString del RPC no hace falta que exista', () => {
  // `ssm_parameters_required_out_of_band` es la lista que un operador tiene que
  // crear ANTES de habilitar los servicios. Se deriva de los mismos locals, asi
  // que en mock el RPC desaparece de ese requisito.
  const outputs = executableHcl(readTf('outputs.tf'));
  const required = block(outputs, 'output "ssm_parameters_required_out_of_band"');

  assert.match(required, /values\(local\.api_secret_parameters\)/);

  const keys = resolveApiSecretKeys('mock');
  assert.ok(!keys.includes('CREDENTIAL_REGISTRY_RPC_URL'));

  // Y el modo que esta configurado HOY es mock, por el default de la variable.
  const variables = executableHcl(readTf('variables.tf'));
  const modeVariable = block(variables, 'variable "blockchain_evidence_mode"');
  assert.match(modeVariable, /default\s*=\s*"mock"/);

  // El tfvars real no esta commiteado, y el ejemplo deja la linea comentada:
  // nada en el repo pisa el default.
  const example = readFileSync(
    join(TERRAFORM_PROD_DIR, 'terraform.tfvars.example'),
    'utf8'
  );
  const uncommented = example
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  assert.ok(!uncommented.includes('blockchain_evidence_mode'));
});

test('3-4: en modo credential_registry se inyecta con el nombre EXACTO', () => {
  const keys = resolveApiSecretKeys('credential_registry');

  assert.ok(keys.includes('CREDENTIAL_REGISTRY_RPC_URL'));
  assert.deepEqual(
    keys,
    [...ALWAYS_INJECTED_API_SECRETS, 'CREDENTIAL_REGISTRY_RPC_URL'].sort()
  );

  // Nombre exacto del parametro, bajo el prefijo del entorno.
  const locals = executableHcl(readTf('locals.tf'));
  const conditional = /api_rpc_secret_parameters = \([\s\S]*?\n  \)/.exec(locals);
  assert.ok(conditional);
  assert.match(
    conditional[0],
    /CREDENTIAL_REGISTRY_RPC_URL = "\$\{local\.ssm_prefix\}\/api\/CREDENTIAL_REGISTRY_RPC_URL"/
  );

  // Y sigue siendo creada FUERA DE BANDA: Terraform solo conoce el nombre.
  const ssm = executableHcl(readTf('ssm.tf'));
  assert.ok(!ssm.includes('CREDENTIAL_REGISTRY_RPC_URL'));
});

test('5: el cableado de DATABASE_URL / JWT / etc queda EXACTAMENTE igual', () => {
  const locals = executableHcl(readTf('locals.tf'));
  const base = block(locals, 'api_base_secret_parameters = {');

  // Ninguno de los secretos preexistentes se volvio condicional.
  assert.ok(!base.includes('?'));
  assert.ok(!base.includes('blockchain'));

  assert.match(base, /DATABASE_URL\s+= "\$\{local\.ssm_prefix\}\/api\/DATABASE_URL"/);
  assert.match(base, /JWT_SECRET\s+= "\$\{local\.ssm_prefix\}\/api\/JWT_SECRET"/);
  assert.match(
    base,
    /PROFILE_SHARE_TOKEN_KEY = "\$\{local\.ssm_prefix\}\/api\/PROFILE_SHARE_TOKEN_KEY"/
  );
  assert.match(
    base,
    /AI_SERVICE_JWT_SECRET\s+= "\$\{local\.ssm_prefix\}\/shared\/AI_INTERNAL_JWT_SECRET"/
  );

  // Los dos consumidores que piden DATABASE_URL por nombre siguen funcionando
  // contra el resultado del merge.
  assert.match(locals, /local\.api_secret_parameters\.DATABASE_URL/);
  const ecs = executableHcl(readTf('ecs.tf'));
  assert.match(ecs, /local\.api_secret_parameters\.DATABASE_URL/);

  // El mapa del servicio de IA no se toco.
  const aiSecrets = block(locals, 'ai_secret_parameters = {');
  assert.ok(!aiSecrets.includes('?'));
  assert.ok(!aiSecrets.includes('CREDENTIAL_REGISTRY'));
});

test('6: el execution role recibe SOLO los ARN que efectivamente se inyectan', () => {
  const locals = executableHcl(readTf('locals.tf'));
  const apiRole = block(locals, '    api = {');

  // Derivado, no escrito a mano: los ARN salen del mismo mapa que el bloque
  // `secrets`, asi que mock no puede quedar con un ARN de mas ni real con uno
  // de menos.
  assert.match(
    apiRole,
    /for parameter in distinct\(values\(local\.api_container_secrets\)\)/
  );
  assert.match(apiRole, /"\$\{local\.ssm_parameter_arn_prefix\}\$\{parameter\}"/);

  // Sin ARN del RPC escrito a mano en ningun lado.
  assert.ok(!apiRole.includes('CREDENTIAL_REGISTRY_RPC_URL'));

  // En mock el ARN del RPC no existe; en real si. Se deriva de las mismas
  // claves que ya se resolvieron desde el HCL.
  assert.ok(!resolveApiSecretKeys('mock').includes('CREDENTIAL_REGISTRY_RPC_URL'));
  assert.ok(
    resolveApiSecretKeys('credential_registry').includes(
      'CREDENTIAL_REGISTRY_RPC_URL'
    )
  );
});

test('7: el TASK role de la API no tiene acceso al RPC en ningun modo', () => {
  const iam = executableHcl(readTf('iam.tf'));

  // Las tres politicas del task role de la API, todas preexistentes: la base,
  // la de signers de S8c2 y la de ECS Exec (condicionada por enable_ecs_exec).
  // S8c5.1 no agrega ninguna.
  const taskPolicies = iam.match(
    /resource "aws_iam_role_policy" "(api_task\w*)"/g
  ) ?? [];
  assert.deepEqual(taskPolicies.sort(), [
    'resource "aws_iam_role_policy" "api_task"',
    'resource "aws_iam_role_policy" "api_task_exec"',
    'resource "aws_iam_role_policy" "api_task_signers"'
  ]);

  // `api_task_exec` usa el documento `ecs_exec`.
  for (const name of ['api_task', 'api_task_signers', 'ecs_exec']) {
    const policy = block(iam, `data "aws_iam_policy_document" "${name}"`);
    assert.ok(
      !policy.includes('CREDENTIAL_REGISTRY_RPC_URL'),
      `${name} no debe alcanzar el RPC`
    );
    assert.ok(
      !policy.includes(RPC_PARAMETER_NAME),
      `${name} no debe alcanzar ${RPC_PARAMETER_NAME}`
    );
    assert.ok(
      !policy.includes('${local.ssm_prefix}/api/'),
      `${name} no debe alcanzar el prefijo /api/`
    );
  }
});

test('8: la politica de signers /signers/* del task role queda intacta', () => {
  const iam = executableHcl(readTf('iam.tf'));
  const signerPolicy = block(
    iam,
    'data "aws_iam_policy_document" "api_task_signers"'
  );

  assert.match(signerPolicy, /sid\s+=\s+"ReadIssuerSignerSecretsOnly"/);
  assert.match(signerPolicy, /effect\s+=\s+"Allow"/);
  assert.match(signerPolicy, /actions\s+=\s+\["ssm:GetParameter"\]/);
  assert.match(
    signerPolicy,
    /resources = \["\$\{local\.ssm_parameter_arn_prefix\}\$\{local\.ssm_prefix\}\/signers\/\*"\]/
  );

  // Un unico statement: no gano nada.
  assert.equal((signerPolicy.match(/statement \{/g) ?? []).length, 1);

  const attachment = block(
    iam,
    'resource "aws_iam_role_policy" "api_task_signers"'
  );
  assert.match(attachment, /role\s+=\s+aws_iam_role\.api_task\.id/);
});

test('9-10: Terraform sigue sin conocer el VALOR del RPC en ningun modo', () => {
  // 9: ni como literal en ningun .tf...
  for (const name of tfFileNames()) {
    const code = executableHcl(readTf(name));
    const assignments =
      code.match(/CREDENTIAL_REGISTRY_RPC_URL\s*=\s*"[^"]*"/g) ?? [];

    for (const assignment of assignments) {
      assert.ok(
        assignment.includes('${local.ssm_prefix}'),
        `${name} no debe asignarle un valor literal al RPC: ${assignment}`
      );
    }
  }

  // 10: ...ni como `aws_ssm_parameter`, en ninguna rama del condicional.
  const ssm = executableHcl(readTf('ssm.tf'));
  const resources = ssm.match(/resource "aws_ssm_parameter" "(\w+)"/g) ?? [];
  assert.deepEqual(resources, ['resource "aws_ssm_parameter" "managed_strings"']);
  assert.match(
    block(ssm, 'resource "aws_ssm_parameter" "managed_strings"'),
    /type\s+=\s+"String"/
  );
  assert.ok(!ssm.includes('SecureString'));

  const locals = executableHcl(readTf('locals.tf'));
  assert.ok(
    !block(locals, 'managed_string_parameters = {').includes(
      'CREDENTIAL_REGISTRY_RPC_URL'
    )
  );
});

test('el modo de evidencia tiene UNA sola fuente del lado de Terraform', () => {
  const locals = executableHcl(readTf('locals.tf'));
  const variables = executableHcl(readTf('variables.tf'));

  // El parametro SSM que la API lee en runtime se siembra desde la variable: no
  // hay un segundo "mock" escrito a mano que pueda divergir del condicional.
  assert.match(
    locals,
    /\/api\/BLOCKCHAIN_EVIDENCE_MODE"\s*=\s*var\.blockchain_evidence_mode/
  );

  // Y la variable es un enum validado: el modo nunca implica una red.
  const modeVariable = block(variables, 'variable "blockchain_evidence_mode"');
  assert.match(
    modeVariable,
    /contains\(\["mock", "credential_registry"\], var\.blockchain_evidence_mode\)/
  );
  assert.ok(!modeVariable.includes('credential_registry_anvil'));

  // Una sola declaracion de la variable y una sola de la condicion derivada.
  assert.equal(
    (variables.match(/variable "blockchain_evidence_mode"/g) ?? []).length,
    1
  );
  assert.equal(
    (locals.match(/blockchain_registry_mode_enabled =/g) ?? []).length,
    1
  );
});

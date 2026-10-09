import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';

import { FROZEN_COMPILER_SETTINGS } from './deployment-artifact';
import { DEPLOYMENT_MANIFEST_FIELDS } from './deployment-manifest';

/**
 * Guards ESTRUCTURALES de S8c10.1. Se evalua codigo EJECUTABLE: los comentarios
 * se quitan antes de buscar, para que documentar una prohibicion no la viole.
 */

const SRC = join(__dirname, '..', '..');
const DEPLOYMENT_DIR = __dirname;
const REPOSITORY_ROOT = join(SRC, '..', '..', '..');

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

function typescriptFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') {
        out.push(...typescriptFiles(full));
      }
    } else if (entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const rel = (file: string) => relative(SRC, file).split(sep).join('/');
const isTest = (file: string) => file.endsWith('.test.ts');
const isFixture = (file: string) => file.includes(`${sep}__fixtures__${sep}`);

const deploymentFiles = typescriptFiles(DEPLOYMENT_DIR).filter(
  (file) => !isTest(file) && !isFixture(file)
);
const deploymentModules = deploymentFiles.filter((file) => !file.includes(`${sep}scripts${sep}`));
const scriptFiles = deploymentFiles.filter((file) => file.includes(`${sep}scripts${sep}`));
const code = (file: string) => stripComments(readFileSync(file, 'utf8'));
const read = (path: string) => readFileSync(join(REPOSITORY_ROOT, path), 'utf8');

// ---------------------------------------------------------------------------
// 36/37/38: el runtime Nest no ve el deployment
// ---------------------------------------------------------------------------

test('36/38 ningun archivo fuera de blockchain/deployment/ importa el deployment', () => {
  const outside = typescriptFiles(SRC).filter(
    (file) => !file.startsWith(DEPLOYMENT_DIR) && !isTest(file)
  );

  for (const file of outside) {
    assert.equal(
      /from\s+'[^']*\/deployment\//.test(code(file)) ||
        /from\s+'\.\/deployment'/.test(code(file)) ||
        /from\s+'[^']*blockchain\/deployment/.test(code(file)),
      false,
      `${rel(file)} importa el deployment`
    );
  }
});

test('37 el deployment no tiene controller, endpoint, decorador ni modulo de Nest', () => {
  assert.ok(deploymentFiles.length > 0);
  for (const file of deploymentFiles) {
    const source = code(file);
    assert.equal(
      /@(Injectable|Controller|Module|Get|Post|Put|Patch|Delete|UseGuards|Optional)\b/.test(source),
      false,
      rel(file)
    );
    assert.equal(/from\s+'@nestjs\//.test(source), false, rel(file));
    assert.equal(file.endsWith('.controller.ts') || file.endsWith('.module.ts'), false, rel(file));
  }
});

test('BlockchainModule y AppModule no registran nada del deployment', () => {
  for (const path of ['blockchain/blockchain.module.ts', 'app.module.ts']) {
    const source = code(join(SRC, path));
    // `credential-registry-deployment` (el resolver record-bound de S8c5) es
    // runtime legitimo y distinto: lo que no puede aparecer es este directorio.
    for (const forbidden of [
      '/deployment/',
      'deployment-operator',
      'KeystoreSignerSource',
      'runCredentialRegistryDeployment',
      'hidden-prompt'
    ]) {
      assert.equal(source.includes(forbidden), false, `${path}: ${forbidden}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 39/31/32/33/34: ni clave en claro, ni la clave global legacy, ni secretos
// ---------------------------------------------------------------------------

test('39 el deployment no lee CREDENTIAL_REGISTRY_PRIVATE_KEY ni ninguna clave de entorno', () => {
  for (const file of deploymentFiles) {
    const source = code(file);
    assert.equal(source.includes('CREDENTIAL_REGISTRY_PRIVATE_KEY'), false, rel(file));
    assert.equal(/process\.env\.\w*(PRIVATE|SECRET|MNEMONIC|SEED|PASS|KEY)\w*/i.test(source), false, rel(file));
    assert.equal(/credential-registry-write-client/.test(source), false, rel(file));
  }
});

test('30-33 no hay ruta de clave en claro: el unico signer sale de un keystore cifrado', () => {
  for (const file of deploymentFiles) {
    const source = code(file);
    for (const forbidden of [
      '--private-key',
      '--mnemonic',
      '--seed',
      'privateKey',
      'Mnemonic',
      'HDNodeWallet',
      'createRandom',
      'fromPhrase',
      'new Wallet(',
      'SigningKey'
    ]) {
      assert.equal(source.includes(forbidden), false, `${rel(file)}: ${forbidden}`);
    }
  }

  const signer = code(join(DEPLOYMENT_DIR, 'keystore-signer-source.ts'));
  assert.match(signer, /Wallet\.fromEncryptedJson\(/);
  assert.equal(/writeFile|appendFile|createWriteStream|child_process|spawn|exec/.test(signer), false);
});

test('34/35 la frase de paso no viaja por argumentos ni por entorno, y nada se loguea salvo la salida final de las CLI', () => {
  for (const file of deploymentModules) {
    assert.equal(/console\.|process\.argv|process\.env/.test(code(file)), false, rel(file));
  }

  for (const file of scriptFiles) {
    const source = code(file);
    // `console.*` solo para JSON seguro / una linea; nunca con variables de secreto.
    for (const call of source.match(/console\.\w+\([^;]*\)/g) ?? []) {
      assert.equal(/passphrase|password|rpcUrl|keystore/i.test(call), false, call);
    }
    assert.equal(/--env-file/.test(source), false);
  }

  const deploy = code(join(DEPLOYMENT_DIR, 'scripts', 'deploy-credential-registry.ts'));
  assert.equal(/process\.env\.(?!CREDENTIAL_REGISTRY_RPC_URL\b)/.test(deploy), false);
  assert.match(deploy, /promptHidden\(/);
});

test('el prompt no usa readline (haria eco) y nada escribe el valor tipeado', () => {
  const prompt = code(join(DEPLOYMENT_DIR, 'hidden-prompt.ts'));
  assert.equal(/readline/.test(prompt), false);
  assert.equal(/output\.write\(\s*(typed|value|character)/.test(prompt), false);
});

// ---------------------------------------------------------------------------
// 48: un segundo envio automatico es estructuralmente imposible
// ---------------------------------------------------------------------------

test('48 el operador tiene UN solo sendDeployment, sin bucles, sin reintentos', () => {
  const operator = code(join(DEPLOYMENT_DIR, 'deployment-operator.ts'));

  assert.equal((operator.match(/\.sendDeployment\(/g) ?? []).length, 1);
  assert.equal(/\b(for|while|do)\s*[({]/.test(operator.replace(/\bfor\s*\(\s*const\b/g, '')), false);
  assert.equal(/retry|retries|attempts|backoff|setTimeout|setInterval/i.test(operator), false);
  assert.equal(/\.sendTransaction\(/.test(operator), false);

  // Y el unico `sendTransaction` de todo el deployment esta en el adaptador.
  const total = deploymentModules
    .map((file) => (code(file).match(/\.sendTransaction\(/g) ?? []).length)
    .reduce((a, b) => a + b, 0);
  assert.equal(total, 1);
});

test('el nonce del envio es explicito y la direccion CREATE se calcula antes de enviar', () => {
  const operator = code(join(DEPLOYMENT_DIR, 'deployment-operator.ts'));

  assert.ok(operator.indexOf('computeExpectedCreateAddress(') < operator.indexOf('.sendDeployment('));
  assert.ok(operator.indexOf('CHAIN_MISMATCH') < operator.indexOf('signerSource.load('));
  assert.ok(operator.indexOf('signerSource.load(') < operator.indexOf('.sendDeployment('));
  assert.ok(operator.indexOf('estimateGas(') < operator.indexOf('.sendDeployment('));
  assert.ok(operator.indexOf('.sendDeployment(') < operator.indexOf('buildDeploymentManifest('));
  assert.ok(operator.indexOf('buildDeploymentManifest(') < operator.indexOf('writeNew('));
  assert.equal(/create2|CREATE2|Proxy|factory/i.test(operator), false);
});

test('el manifest es append-only y se publica ATOMICAMENTE: temporal exclusivo + fsync + enlace duro exclusivo', () => {
  const writers = deploymentFiles.filter((file) =>
    /\b(writeFile|writeFileSync|appendFile|createWriteStream|open)\(/.test(code(file))
  );
  // El unico lugar que escribe en disco dentro del deployment.
  assert.deepEqual(writers.map(rel), ['blockchain/deployment/manifest-store.ts']);

  const store = code(writers[0]);
  // Temporal creado-exclusivo, fsync y cierre ANTES de publicar.
  assert.match(store, /open\(path,\s*'wx'\)/);
  assert.match(store, /\.sync\(\)/);
  assert.ok(store.indexOf('.sync()') < store.indexOf('link('), 'fsync antes de publicar');
  // Publicacion con enlace duro: atomica y EXCLUSIVA (falla con EEXIST).
  assert.match(store, /await link\(temporaryPath,\s*finalPath\)/);
  // Primitivas que romperian un invariante: reemplazan o escriben parcial en la ruta final.
  for (const forbidden of ['rename(', 'renameSync', 'copyFile', 'cp(', 'truncate', 'rmSync', 'rm(', "'w'", "'a'", "'w+'"]) {
    assert.equal(store.includes(forbidden), false, forbidden);
  }
  // `writeFile` solo sobre el HANDLE del temporal; nunca a una ruta final.
  assert.equal(/(?<!handle\.)writeFile\(/.test(store), false);
  // El unico `unlink` es el del metodo `remove`, que solo recibe rutas temporales.
  assert.equal((store.match(/unlink\(/g) ?? []).length, 1);
  assert.equal(/remove\(finalPath|discard\(finalPath/.test(store), false);
});

test('ningun archivo del deployment toca AWS, SSM ni Terraform', () => {
  for (const file of deploymentFiles) {
    assert.equal(/@aws-sdk|client-ssm|GetParameter|PutParameter|terraform/i.test(code(file)), false, rel(file));
  }
});

// ---------------------------------------------------------------------------
// Configuracion de build congelada
// ---------------------------------------------------------------------------

test('foundry.toml fija TODOS los settings que determinan el bytecode', () => {
  const toml = stripComments(read('contracts/foundry.toml').replace(/^\s*#.*$/gm, ''));

  const required: Array<[RegExp, string]> = [
    [/^solc_version\s*=\s*"0\.8\.26"\s*$/m, 'solc_version'],
    [/^auto_detect_solc\s*=\s*false\s*$/m, 'auto_detect_solc'],
    [/^optimizer\s*=\s*false\s*$/m, 'optimizer'],
    [/^optimizer_runs\s*=\s*200\s*$/m, 'optimizer_runs'],
    [/^via_ir\s*=\s*false\s*$/m, 'via_ir'],
    [/^evm_version\s*=\s*"cancun"\s*$/m, 'evm_version'],
    [/^bytecode_hash\s*=\s*"ipfs"\s*$/m, 'bytecode_hash'],
    [/^cbor_metadata\s*=\s*true\s*$/m, 'cbor_metadata']
  ];

  for (const [pattern, name] of required) {
    assert.match(toml, pattern, name);
  }
  // Nada que cambie el bytecode ni que llegue a la red.
  assert.equal(/^(ffi|rpc_endpoints|etherscan|libraries|remappings)\b/m.test(toml), false);
});

test('foundry.toml, toolchain y constantes del codigo describen LO MISMO', () => {
  const toolchain = JSON.parse(read('contracts/deployments/deployment-toolchain.json'));
  const toml = read('contracts/foundry.toml');

  assert.deepEqual(toolchain.compilerSettings, FROZEN_COMPILER_SETTINGS);
  assert.equal(toolchain.solcVersion, '0.8.26');
  assert.equal(toolchain.network, 'base_sepolia');
  assert.equal(toolchain.chainId, 84532);
  assert.match(toml, new RegExp(`solc_version\\s*=\\s*"${toolchain.solcVersion}"`));
  assert.match(toml, new RegExp(`evm_version\\s*=\\s*"${toolchain.compilerSettings.evmVersion}"`));
  assert.match(toml, new RegExp(`optimizer_runs\\s*=\\s*${toolchain.compilerSettings.optimizer.runs}`));
});

test('el schema JSON documenta exactamente los campos del validador', () => {
  const schema = JSON.parse(read('contracts/deployments/credential-registry-deployment.schema.json'));

  assert.equal(schema.additionalProperties, false);
  assert.deepEqual([...schema.required].sort(), [...DEPLOYMENT_MANIFEST_FIELDS].sort());
  assert.deepEqual(Object.keys(schema.properties).sort(), [...DEPLOYMENT_MANIFEST_FIELDS].sort());
  assert.equal(schema.properties.schemaVersion.const, 'credential_registry_deployment_v1');
  assert.equal(schema.properties.chainId.const, 84532);
});

test('.gitattributes fija LF para las fuentes Solidity: el bytecode no depende del checkout', () => {
  const attributes = read('.gitattributes');
  assert.match(attributes, /^contracts\/\*\*\/\*\.sol\s+text\s+eol=lf\s*$/m);
  assert.match(attributes, /^contracts\/foundry\.toml\s+text\s+eol=lf\s*$/m);

  const source = read('contracts/src/CredentialRegistry.sol');
  assert.equal(source.includes('\r'), false, 'la fuente revisada debe ser LF');
});

test('el contrato Solidity y su test NO fueron modificados semanticamente (solo hashes revisados)', () => {
  const source = read('contracts/src/CredentialRegistry.sol');
  for (const frozen of [
    'function registerCredential(bytes32 credentialHash) external',
    'function revokeCredential(bytes32 credentialHash) external',
    'if (record.issuer != msg.sender)',
    'revert UnauthorizedRevoker(msg.sender)'
  ]) {
    assert.ok(source.includes(frozen), frozen);
  }
  assert.equal(/\bimmutable\b|constructor\s*\(|\bowner\b|Ownable|Pausable|delegatecall/.test(source), false);
});

// ---------------------------------------------------------------------------
// Runbook y documentacion
// ---------------------------------------------------------------------------

test('el runbook de Base Sepolia no instruye a usar forge create ni una clave por linea de comandos', () => {
  const runbook = read('contracts/DEPLOYMENT_BASE_SEPOLIA.md');

  assert.equal(/--private-key/.test(runbook), false);
  assert.equal(/forge create/.test(runbook), false);
  assert.equal(/forge script[^\n]*--broadcast/.test(runbook), false);
  assert.equal(/terraform\s+(apply|plan)[^\n]*-target/.test(runbook), false);

  for (const required of [
    'ONE canonical',
    'deploymentSourceCommit',
    'blockchain:deploy-registry',
    '--keystore',
    'DEPLOYMENT_PENDING_RECONCILIATION',
    'AMBIGUOUS_DEPLOYMENT_SEND',
    'DEPLOYMENT_MANIFEST_PERSISTENCE_FAILED',
    'DEPLOYMENT_IDENTITY_MISMATCH',
    '5 confirmations',
    'clean',
    'migrator_image_tag'
  ]) {
    assert.ok(runbook.includes(required), required);
  }
});

test('81 la congelacion de la deployment canonica esta documentada', () => {
  for (const path of ['contracts/DEPLOYMENT_BASE_SEPOLIA.md', 'contracts/deployments/README.md']) {
    const text = read(path);
    assert.match(text, /first real/i, path);
    assert.match(text, /BlockchainRecord/, path);
    assert.match(text, /multi-deployment|Multi-deployment/, path);
  }
});

test('.env.example documenta el target actual, sin clave de deployer', () => {
  const env = read('services/api/.env.example');

  for (const key of [
    'BLOCKCHAIN_EVIDENCE_MODE',
    'CREDENTIAL_REGISTRY_NETWORK',
    'CREDENTIAL_REGISTRY_CHAIN_ID',
    'CREDENTIAL_REGISTRY_CONTRACT_ADDRESS',
    'CREDENTIAL_REGISTRY_DEPLOYMENT_ID',
    'CREDENTIAL_REGISTRY_RPC_URL'
  ]) {
    assert.match(env, new RegExp(`^${key}=`, 'm'), key);
  }

  assert.match(env, /^BLOCKCHAIN_EVIDENCE_MODE=mock$/m);
  assert.equal(/DEPLOYER|KEYSTORE|PASSPHRASE/i.test(env.replace(/^\s*#.*$/gm, '')), false);
  // Ningun valor real: las variables del target arrancan vacias.
  for (const key of ['CREDENTIAL_REGISTRY_CONTRACT_ADDRESS', 'CREDENTIAL_REGISTRY_DEPLOYMENT_ID', 'CREDENTIAL_REGISTRY_RPC_URL']) {
    assert.match(env, new RegExp(`^${key}=$`, 'm'), key);
  }
});

test('los scripts npm del deployment no usan --env-file ni aceptan claves', () => {
  const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  for (const name of ['blockchain:deploy-registry', 'blockchain:check-target']) {
    assert.ok(pkg.scripts[name], name);
    assert.equal(/--env-file|private|mnemonic|seed|passphrase/i.test(pkg.scripts[name]), false, name);
  }
  assert.ok(existsSync(join(DEPLOYMENT_DIR, 'scripts', 'deploy-credential-registry.ts')));
});

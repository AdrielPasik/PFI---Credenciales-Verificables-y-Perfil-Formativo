import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';

/**
 * Guards ESTRUCTURALES de S8c9. Se evalua codigo EJECUTABLE: los comentarios se
 * quitan antes de buscar, para que documentar una prohibicion no la viole.
 */

const SRC = join(__dirname, '..');

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function productionFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...productionFiles(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const rel = (file: string) => relative(SRC, file).split(sep).join('/');
const code = (file: string) => stripComments(readFileSync(file, 'utf8'));
const codeOf = (path: string) => code(join(SRC, path));

const FILES = productionFiles();

test('S1 ningun literal de DID decide autorizacion en produccion', () => {
  const offenders = FILES.filter((file) =>
    /did:example:issuer-demo|UADE_ISSUER_DID/.test(code(file))
  ).map(rel);
  // `seed`/scripts de datos demo no viven en src/.
  assert.deepEqual(offenders, []);
});

test('S2 la readiness no toca signers, secretos, SSM, providers ni red', () => {
  for (const path of ['issuers/issuer-readiness.ts', 'issuers/issuer-readiness.service.ts']) {
    const source = codeOf(path);
    for (const forbidden of [
      'IssuerSignerResolver',
      'SignerSecretStore',
      'client-ssm',
      'GetParameter',
      'JsonRpcProvider',
      'createCredentialRegistryProvider',
      'CredentialRegistryPreflight',
      'getBalance',
      'getBlockNumber',
      'fetch('
    ]) {
      assert.equal(source.includes(forbidden), false, `${path}: ${forbidden}`);
    }
  }
});

test('S3 PutParameter SOLO en el escritor de operacion; DeleteParameter en ningun lado', () => {
  const put = FILES.filter((file) => /PutParameter/.test(code(file))).map(rel);
  assert.deepEqual(put, ['identity/operator/ssm-signer-secret-writer.ts']);

  const del = FILES.filter((file) => /DeleteParameter/.test(code(file))).map(rel);
  assert.deepEqual(del, []);

  assert.match(codeOf('identity/operator/ssm-signer-secret-writer.ts'), /Overwrite:\s*false/);
  assert.match(codeOf('identity/operator/ssm-signer-secret-writer.ts'), /Type:\s*'SecureString'/);
});

test('S4 el runtime Nest no importa tooling de operacion', () => {
  const operatorModules = [
    'operator/ssm-signer-secret-writer',
    'operator/signer-material-generator',
    'technical-identity-provisioning.service',
    'technical-identity-cli',
    'issuer-capability-policy'
  ];
  const runtime = FILES.filter((file) => {
    const path = rel(file);
    return (
      !path.includes('/scripts/') &&
      !path.startsWith('identity/operator/') &&
      path !== 'identity/technical-identity-provisioning.service.ts'
    );
  });
  for (const file of runtime) {
    const source = code(file);
    for (const module of operatorModules) {
      assert.equal(
        new RegExp(`from '[^']*${module.replace(/[/.]/g, '\\$&')}'`).test(source),
        false,
        `${rel(file)} importa ${module}`
      );
    }
  }
});

test('S5 ningun controller expone provisioning, rotacion, capacidades ni claves', () => {
  const controllers = FILES.filter((file) => file.endsWith('.controller.ts'));
  for (const file of controllers) {
    const source = code(file);
    assert.equal(
      /@(Post|Put|Patch|Delete)\(\s*'[^']*(provision|rotat|capabilit|signer|private-?key|secret)/i.test(source),
      false,
      rel(file)
    );
    for (const forbidden of [
      'TechnicalIdentityProvisioningService',
      'SignerRotationService',
      'setAllowedCredentialTypes',
      'privateKey'
    ]) {
      assert.equal(source.includes(forbidden), false, `${rel(file)}: ${forbidden}`);
    }
  }
});

test('S6 el controller tecnico tiene exactamente GET y POST network-health, no-store', () => {
  const source = codeOf('issuers/issuer-technical-identity.controller.ts');
  assert.deepEqual(source.match(/@(Get|Post|Put|Patch|Delete)\([^)]*\)/g), [
    '@Get()',
    "@Post('network-health')"
  ]);
  assert.equal((source.match(/no-store/g) ?? []).length, 2);
  assert.equal(source.includes('@Body('), false);
});

test('S7 el helper de lectura tecnica: membresia admin activa, sin bypass de PlatformAdmin', () => {
  const source = codeOf('issuers/issuers.service.ts');
  const start = source.indexOf('async assertUserCanReadTechnicalIdentityForIssuer');
  assert.ok(start > 0);
  const body = source.slice(start, source.indexOf('\n  }\n', start));
  assert.match(body, /IssuerMembershipRole\.admin/);
  assert.match(body, /IssuerMembershipStatus\.active/);
  assert.equal(/platformAdmin|PlatformAdmin/.test(body), false);
  assert.equal(/authorizationStatus/.test(body), false);
});

test('S8 lectura y health autorizan ANTES de cualquier consulta o provider', () => {
  const source = codeOf('issuers/issuer-technical-identity.service.ts');
  for (const method of ['async read(', 'async networkHealth(']) {
    const start = source.indexOf(method);
    const auth = source.indexOf('assertUserCanReadTechnicalIdentityForIssuer', start);
    for (const later of ['this.prisma.', 'this.createProvider(', 'resolveReadinessTarget(']) {
      const at = source.indexOf(later, start);
      assert.ok(auth > start && auth < at, `${method} ${later}`);
    }
  }
});

test('S9 health y lectura tecnica no escriben la base', () => {
  const source = codeOf('issuers/issuer-technical-identity.service.ts');
  assert.equal(/\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(/.test(source), false);
  assert.equal(source.includes('$transaction'), false);
  assert.equal(source.includes('rpcUrl:'), false);
});

test('S10 emision: precondicion por readiness y re-lectura de politica dentro de TX #1', () => {
  const source = codeOf('credentials/credentials.service.ts');
  assert.match(source, /assertIssuerCanIssue\(\s*credential\.issuerId,\s*credential\.type\s*\)/);
  const tx = source.indexOf('transaction.issuer.findUnique');
  const update = source.indexOf('transaction.credential.update(', tx);
  assert.ok(tx > 0 && update > tx, 're-lectura antes de la escritura');
  assert.ok(source.indexOf('assertCredentialTypeAllowed(', tx) < update);
});

test('S11 IssuersService ya no autoriza con Issuer.did ni Issuer.walletAddress', () => {
  const source = codeOf('issuers/issuers.service.ts');
  assert.equal(/walletAddress/.test(source), false);
  assert.equal(/issuer\.did\b/.test(source), false);
});

test('S12 la CLI no acepta material de clave y no imprime claves', () => {
  const utils = codeOf('identity/scripts/technical-identity-cli.utils.ts');
  const cli = codeOf('identity/scripts/technical-identity-cli.ts');
  assert.equal(/--private-key|--key-file|--mnemonic|--secret-ref/.test(utils), false);
  assert.equal(/privateKey/.test(cli), false);
  assert.equal(/readFileSync|process\.stdin/.test(cli + utils), false);
});

test('S13 el provisioning no loguea y nunca devuelve la clave', () => {
  const source = codeOf('identity/technical-identity-provisioning.service.ts');
  assert.equal(/console\.|Logger/.test(source), false);
  const results = source.match(/return \{[\s\S]*?\n {10}\};/g) ?? [];
  for (const block of results) {
    assert.equal(block.includes('privateKey'), false);
  }
  // El generador: CSPRNG, sin mnemonic ni HD.
  const generator = codeOf('identity/operator/signer-material-generator.ts');
  assert.match(generator, /randomBytes/);
  assert.equal(/Mnemonic|HDNodeWallet|fromPhrase|Wallet\.createRandom/.test(generator), false);
});

test('S14 el panel de admin no lee did/walletAddress legacy para la readiness', () => {
  for (const path of [
    'platform-admin/platform-admin-read.service.ts',
    'platform-admin/platform-admin-issuer-provision.service.ts'
  ]) {
    const source = codeOf(path);
    assert.equal(/walletAddress:\s*true|\bdid:\s*true/.test(source), false, path);
  }
  assert.match(codeOf('platform-admin/platform-admin-read.service.ts'), /evaluateMany\(/);
});

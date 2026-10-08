/**
 * Guards ESTRUCTURALES de la verificacion publica -- S8c7.
 *
 * Las propiedades de abajo no se pueden probar solo con el comportamiento de
 * hoy: hay que impedir que una slice futura las rompa sin darse cuenta. Un
 * guard de este tipo falla en el momento en que alguien agrega el import
 * prohibido, no seis meses despues en produccion.
 *
 * Todo se afirma sobre el CODIGO EJECUTABLE, con los comentarios quitados: los
 * comentarios de estos archivos nombran legitimamente lo que esta prohibido
 * para explicar por que lo esta.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const VERIFICATION_DIR = __dirname;
const API_SRC_DIR = join(__dirname, '..');

const VERIFICATION_SOURCES = [
  'verification.service.ts',
  'verification.controller.ts',
  'verification.module.ts',
  'verification-outcome.ts',
  'credential-authenticity.verifier.ts',
  'credential-blockchain-evidence.reader.ts',
  'dto/verify-credential-response.dto.ts'
] as const;

function read(relativePath: string): string {
  return readFileSync(join(VERIFICATION_DIR, relativePath), 'utf8');
}

/** Codigo ejecutable: sin comentarios de bloque ni de linea. */
function executableCode(contents: string): string {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

function verificationSources(): Array<{ name: string; code: string }> {
  return VERIFICATION_SOURCES.map((name) => ({
    name,
    code: executableCode(read(name))
  }));
}

/**
 * Cuerpo de un metodo, acotado por INDENTACION.
 *
 * Un `[\s\S]*?\n  \}` ingenuo se corta en el cierre del OBJETO DE PARAMETROS y
 * entonces el guard mira un cuerpo vacio y pasa por casualidad.
 */
function methodBody(code: string, name: string): string {
  const lines = code.split('\n');
  const start = lines.findIndex((line) =>
    new RegExp(`^  (?:private |protected |public )?(?:async )?${name}\\(`).test(line)
  );
  assert.notEqual(start, -1, `no se encontro ${name}`);

  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  (?:private |protected |public |async )/.test(lines[index])) {
      return lines.slice(start, index).join('\n');
    }
  }

  return lines.slice(start).join('\n');
}

// ---------------------------------------------------------------------------
// NI CLAVES PRIVADAS NI ALMACEN DE SECRETOS
// ---------------------------------------------------------------------------

test('la verificacion publica NO toca nada del stack de secretos', () => {
  // Verificar es una operacion de clave PUBLICA. Si este guard empezara a
  // fallar, alguien estaria a punto de darle capacidad de firma a una ruta
  // anonima.
  const forbidden = [
    'IssuerSignerResolver',
    'resolveAssertionSignerForIssuer',
    'resolveAnchorSignerForIssuer',
    'SignerSecretStore',
    'AwsSsmSignerSecretStore',
    'SIGNER_SECRET_STORE',
    'SSMClient',
    'GetParameter',
    'WithDecryption',
    'secretRef',
    'privateKey',
    'CREDENTIAL_REGISTRY_PRIVATE_KEY',
    'new Wallet',
    'Wallet(',
    'SigningModule'
  ];

  for (const file of verificationSources()) {
    for (const token of forbidden) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe contener ${token}`
      );
    }
  }
});

test('tampoco entra el plano de ESCRITURA de blockchain', () => {
  const forbidden = [
    'AnchorWriteCoordinator',
    'NonceManager',
    'registerCredential',
    'revokeCredential',
    'CredentialRegistryWriteClient',
    'createCredentialRegistryWriteClientForTarget',
    'createRecordBoundCredentialRegistryWriteClient',
    'sendTransaction',
    'BlockchainRegistrationService',
    'BlockchainRegistrationReconciliationService',
    'finalizeRegistration',
    'reconcilePendingRegistration',
    'BlockchainModule'
  ];

  for (const file of verificationSources()) {
    for (const token of forbidden) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe contener ${token}`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// CERO ESCRITURAS A LA BASE
// ---------------------------------------------------------------------------

test('la verificacion publica no ejecuta ninguna escritura de Prisma', () => {
  // Un GET es una observacion. Ni finaliza un intent, ni adopta un huerfano,
  // ni pone al dia un estado.
  const forbidden = [
    '.create(',
    '.createMany(',
    '.update(',
    '.updateMany(',
    '.delete(',
    '.deleteMany(',
    '.upsert(',
    '$transaction',
    '$executeRaw',
    '$queryRaw',
    'ensureDidForUser'
  ];

  for (const file of verificationSources()) {
    for (const token of forbidden) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe contener ${token}`
      );
    }
  }
});

test('el unico acceso a Prisma del servicio es un findUnique', () => {
  const service = executableCode(read('verification.service.ts'));
  const prismaCalls = [...service.matchAll(/this\.prisma\.(\w+)\.(\w+)\(/g)].map(
    (match) => `${match[1]}.${match[2]}`
  );

  assert.deepEqual(prismaCalls, ['credential.findUnique']);
});

test('ni el verificador de autenticidad ni el lector de evidencia tienen Prisma', () => {
  // La UNICA consulta la hace el resolver de DID inyectado, que es el mismo del
  // endpoint publico. El lector de evidencia recibe las filas ya cargadas.
  for (const name of [
    'credential-authenticity.verifier.ts',
    'credential-blockchain-evidence.reader.ts'
  ]) {
    const code = executableCode(read(name));

    assert.ok(!code.includes('PrismaService'), name);
    assert.ok(!code.includes('this.prisma'), name);
  }
});

// ---------------------------------------------------------------------------
// SIN HTTP CONTRA SU PROPIO DID
// ---------------------------------------------------------------------------

test('la API no resuelve su propio DID por HTTP', () => {
  const forbidden = [
    'fetch(',
    'axios',
    'http.get',
    'https.get',
    'undici',
    'node-fetch',
    'PUBLIC_DID_BASE_URL',
    'api.scopeedu.technology',
    'did.json'
  ];

  for (const file of verificationSources()) {
    for (const token of forbidden) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe contener ${token}`
      );
    }
  }

  // Y la resolucion llega por inyeccion del resolver LOCAL.
  const verifier = executableCode(read('credential-authenticity.verifier.ts'));
  assert.match(verifier, /IssuerDidDocumentResolver/);
  assert.match(verifier, /this\.didResolver\.resolveForIssuer\(/);
});

// ---------------------------------------------------------------------------
// NI SEGUNDO CANONICALIZADOR NI SEGUNDO ENVELOPE
// ---------------------------------------------------------------------------

test('canon_v2 tiene UNA implementacion y la verificacion la reutiliza', () => {
  const verifier = executableCode(read('credential-authenticity.verifier.ts'));

  // Se usa el servicio de hashing existente...
  assert.match(verifier, /this\.hashingService\.createCanonicalHashForVersion\(/);

  // ...y no se reimplementa la canonicalizacion.
  for (const token of [
    'createHash',
    'sha256',
    'JSON.stringify',
    'stableStringify',
    'sortRecursively',
    'normalize(',
    'NFKC'
  ]) {
    assert.ok(!verifier.includes(token), `no debe reimplementar canon_v2: ${token}`);
  }
});

test('el envelope de scope-proof-v1 tiene UNA implementacion', () => {
  const verifier = executableCode(read('credential-authenticity.verifier.ts'));

  assert.match(verifier, /buildScopeProofV1Envelope\(/);
  assert.match(verifier, /assertCanonicalScopeProofValue\(/);

  // Ninguna de las seis lineas se vuelve a escribir a mano.
  for (const token of [
    "'scope-proof-v1\\n'",
    'proofPurpose=',
    'verificationMethod=',
    'canonicalizationVersion=',
    'hashAlgorithm=',
    'canonicalHash='
  ]) {
    assert.ok(
      !verifier.includes(token),
      `no debe reconstruir el envelope: ${token}`
    );
  }
});

test('el recalculo del hash canonico ocurre UNA sola vez por evaluacion', () => {
  const verifier = executableCode(read('credential-authenticity.verifier.ts'));

  assert.equal(
    (verifier.match(/createCanonicalHashForVersion\(/g) ?? []).length,
    1
  );
  assert.equal((verifier.match(/this\.recomputeCanonicalHash\(/g) ?? []).length, 1);

  // Y el lector de evidencia NO recalcula nada por su cuenta.
  const reader = executableCode(read('credential-blockchain-evidence.reader.ts'));
  assert.ok(!reader.includes('CredentialHashingService'));
  assert.ok(!reader.includes('createCanonicalHash'));
});

// ---------------------------------------------------------------------------
// LA DIRECCION SALE DE LA JWK, NO DE SignerProfile
// ---------------------------------------------------------------------------

test('la firma NUNCA se verifica contra SignerProfile.address', () => {
  // S8c2 prueba secreto <-> metadata. S8c3 PUBLICA la autorizacion. S8c7 tiene
  // que verificar contra lo que el DID autoriza: leer `SignerProfile.address`
  // esquivaria el mecanismo de revocacion de clave comprometida.
  const verifier = executableCode(read('credential-authenticity.verifier.ts'));

  for (const token of [
    'SignerProfile',
    'signerProfile',
    'assertionSignerProfile',
    'walletAddress',
    'anchorSignerProfile'
  ]) {
    assert.ok(!verifier.includes(token), `autenticidad no debe usar ${token}`);
  }

  // La direccion esperada se DERIVA de la clave publica publicada.
  assert.match(verifier, /computeAddress\(`0x04\$\{x\}\$\{y\}`\)/);
  assert.match(verifier, /publicKeyJwk/);
  assert.match(verifier, /assertionMethod/);
});

test('la autorizacion se exige por assertionMethod, no por presencia', () => {
  const verifier = executableCode(read('credential-authenticity.verifier.ts'));
  // Acotado al cuerpo de `verify` por indentacion: un slice hasta el final del
  // archivo arrastraria los helpers de abajo, que si ordenan claves de objeto.
  const body = methodBody(verifier, 'verify');

  // Se busca el verificationMethod por id EXACTO -- no el primero, ni el de
  // keyVersion mas alta -- y despues se exige que este en assertionMethod.
  assert.match(body, /\.find\(\s*\(candidate\) => candidate\.id === verificationMethod\s*\)/);
  assert.match(body, /assertionMethod \?\? \[\]\)\.includes\(verificationMethod\)/);

  for (const token of ['[0]', 'at(0)', 'keyVersion >', 'sort(', 'Math.max']) {
    assert.ok(
      !body.includes(token),
      `no debe elegir una clave por posicion u orden: ${token}`
    );
  }
});

// ---------------------------------------------------------------------------
// LA EVIDENCIA DE CADENA NO PUEDE REESCRIBIR LA AUTENTICIDAD
// ---------------------------------------------------------------------------

test('el verificador de autenticidad no conoce la cadena', () => {
  const verifier = executableCode(read('credential-authenticity.verifier.ts'));

  for (const token of [
    'BlockchainEvidence',
    'blockchainEvidence',
    'getCredentialStatus',
    'JsonRpcProvider',
    'CredentialRegistryReadClient',
    'BlockchainRecord',
    'getLogs',
    'getNetwork',
    'getCode',
    'revoked'
  ]) {
    assert.ok(!verifier.includes(token), `autenticidad no debe conocer ${token}`);
  }
});

test('el lector de evidencia no mira el proof', () => {
  const reader = executableCode(read('credential-blockchain-evidence.reader.ts'));

  for (const token of [
    'proof',
    'proofValue',
    'verifyMessage',
    'scope-proof-v1',
    'CredentialAuthenticity',
    'verificationMethod',
    'publicKeyJwk'
  ]) {
    assert.ok(!reader.includes(token), `la evidencia no debe mirar ${token}`);
  }
});

test('el servicio no sobreescribe una dimension con otra', () => {
  const service = executableCode(read('verification.service.ts'));
  const body = methodBody(service, 'getCredentialVerification');

  // La autenticidad entra en la respuesta tal como la devolvio su verificador.
  assert.match(body, /authenticity\.authenticity/);
  // Y el titular sale de la funcion pura, con las tres dimensiones.
  assert.match(
    body,
    /deriveVerificationHeadline\(\{\s*authenticity: authenticity\.authenticity,\s*status: credentialStatus,\s*blockchainEvidence: evidence\.blockchainEvidence\s*\}\)/
  );

  // No hay reasignacion de la autenticidad en funcion de la cadena.
  for (const token of [
    "authenticity = '",
    "authenticity.authenticity = ",
    "= 'VERIFIED'",
    "= 'INVALID'"
  ]) {
    assert.ok(!body.includes(token), `no debe reescribir una dimension: ${token}`);
  }
});

// ---------------------------------------------------------------------------
// UNA SOLA FUENTE DE VERDAD PARA EL CAMPO LEGACY
// ---------------------------------------------------------------------------

test('`verification.result` se deriva SOLO del titular', () => {
  const service = executableCode(read('verification.service.ts'));

  // Un unico origen...
  assert.match(service, /result: deriveLegacyVerificationResult\(headline\)/);
  assert.equal(
    (service.match(/deriveLegacyVerificationResult\(/g) ?? []).length,
    1
  );

  // ...y ni rastro de la vieja regla de solo-base-de-datos.
  for (const token of [
    "'valid_issued'",
    "'not_verifiable'",
    "'revoked'",
    'buildVerificationResult',
    'hasRegisteredBlockchainRecord'
  ]) {
    assert.ok(
      !service.includes(token),
      `el servicio no debe decidir el enum legacy por su cuenta: ${token}`
    );
  }
});

test('el titular se deriva en UNA sola funcion pura y en ningun otro lugar', () => {
  const outcome = executableCode(read('verification-outcome.ts'));

  // La funcion pura no tiene dependencias de infraestructura.
  for (const token of [
    'Injectable',
    'PrismaService',
    'this.',
    'await',
    'fetch(',
    'new Date',
    'Date.now'
  ]) {
    assert.ok(!outcome.includes(token), `la derivacion debe ser pura: ${token}`);
  }

  // Y nadie mas la reimplementa.
  for (const name of [
    'verification.service.ts',
    'verification.controller.ts',
    'credential-authenticity.verifier.ts',
    'credential-blockchain-evidence.reader.ts'
  ]) {
    const code = executableCode(read(name));
    assert.ok(
      !code.includes('VERIFIED_WITH_LIMITED_EVIDENCE') ||
        name === 'verification.service.ts',
      `${name} no debe decidir el titular`
    );
  }

  const service = executableCode(read('verification.service.ts'));
  assert.equal((service.match(/deriveVerificationHeadline\(/g) ?? []).length, 1);
  assert.equal((service.match(/deriveCredentialStatus\(/g) ?? []).length, 1);
});

test('el resumen de texto no esconde una segunda decision de validez', () => {
  const service = executableCode(read('verification.service.ts'));
  const body = methodBody(service, 'buildSummary');

  // El texto se decide con las dimensiones YA resueltas...
  assert.match(body, /input\.headline/);

  // ...y no vuelve a mirar el estado persistido ni la fila de evidencia.
  for (const token of [
    'CredentialStatus',
    'canonicalHash',
    'BlockchainRecordStatus',
    'blockchainRecords',
    'credential.'
  ]) {
    assert.ok(!body.includes(token), `el resumen no debe re-decidir: ${token}`);
  }
});

// ---------------------------------------------------------------------------
// NI CRONOLOGIA INVENTADA NI FILA ARBITRARIA
// ---------------------------------------------------------------------------

test('67: no se inventa ninguna cronologia de BlockchainRecord', () => {
  const service = executableCode(read('verification.service.ts'));
  const reader = executableCode(read('credential-blockchain-evidence.reader.ts'));

  for (const token of ['orderBy', 'take:', 'createdAt', 'sort(', 'reverse(']) {
    assert.ok(!service.includes(token), `el servicio no debe ordenar filas: ${token}`);
    assert.ok(!reader.includes(token), `el lector no debe ordenar filas: ${token}`);
  }

  // La multiplicidad falla cerrado y no elige.
  assert.match(reader, /records\.length > 1/);
  assert.match(reader, /AMBIGUOUS_BLOCKCHAIN_RECORDS/);

  // Con mas de una fila ninguna se presenta como la ultima.
  assert.match(
    service,
    /credential\.blockchainRecords\.length === 1\s*\?\s*credential\.blockchainRecords\[0\]\s*:\s*null/
  );
});

// ---------------------------------------------------------------------------
// UN SOLO PROVIDER POR EVALUACION -- ADDENDUM B
// ---------------------------------------------------------------------------

test('addendum B: preflight y lectura comparten UN provider, sin duplicar logica', () => {
  const client = executableCode(
    readFileSync(
      join(API_SRC_DIR, 'blockchain', 'credential-registry-read-client.ts'),
      'utf8'
    )
  );

  // Una sola resolucion de provider por evaluacion, y el preflight de S8c5
  // recibe ESE objeto.
  assert.match(client, /const provider = this\.resolveProvider\(input\.target\);/);
  assert.match(client, /this\.preflight\.assertWritable\(input\.target, provider\)/);
  assert.match(client, /this\.resolveContractReader\(input\.target, provider\)/);

  // Ningun `new JsonRpcProvider` propio: la construccion es la de S8c5.
  assert.ok(!client.includes('new JsonRpcProvider'));
  assert.match(client, /createCredentialRegistryProvider\(target\)/);

  // Y la validacion de cadena/codigo NO se reimplementa aca.
  for (const token of [
    'getNetwork()',
    'BigInt(input.deployment.chainId)',
    "=== '0x'",
    'DEPLOYED_CODE_PATTERN'
  ]) {
    assert.ok(
      !client.includes(token),
      `la validacion de cadena/codigo es la de S8c5, no una copia: ${token}`
    );
  }
});

test('el lector de evidencia no construye providers ni valida cadenas', () => {
  const reader = executableCode(read('credential-blockchain-evidence.reader.ts'));

  for (const token of [
    'JsonRpcProvider',
    'createCredentialRegistryProvider',
    'getNetwork',
    'getCode',
    'assertWritable',
    'FetchRequest',
    'rpcUrl'
  ]) {
    assert.ok(!reader.includes(token), `el lector no debe contener ${token}`);
  }
});

// ---------------------------------------------------------------------------
// EL TARGET SALE DEL RECORD
// ---------------------------------------------------------------------------

test('el target de la lectura se reconstruye del record, no de la config de hoy', () => {
  const reader = executableCode(read('credential-blockchain-evidence.reader.ts'));

  assert.match(reader, /this\.deploymentResolver\.resolve\(\{/);
  assert.match(reader, /network: record\.network/);
  assert.match(reader, /chainId: record\.chainId/);
  assert.match(reader, /contractAddress: record\.contractAddress/);

  // Nunca se cae a Base Sepolia ni a un deployment inventado.
  for (const token of ['base_sepolia', '84532', 'anvil', '31337']) {
    assert.ok(!reader.includes(token), `no debe fabricar un target: ${token}`);
  }
});

test('el registrante esperado nunca sale del binding vigente del issuer', () => {
  const reader = executableCode(read('credential-blockchain-evidence.reader.ts'));

  assert.match(reader, /record\.anchorSignerAddress/);
  assert.match(reader, /record\.issuerAddress/);

  for (const token of [
    'issuerTechnicalIdentity',
    'resolveAnchorSignerForIssuer',
    'walletAddress',
    'CREDENTIAL_REGISTRY_SIGNER'
  ]) {
    assert.ok(!reader.includes(token), `no debe usar ${token} como expectativa`);
  }

  // REGISTRANT_UNEXPECTED exige una expectativa confiable.
  assert.match(reader, /EXPECTED_REGISTRANT_UNRESOLVED/);
});

// ---------------------------------------------------------------------------
// SANITIZACION DE ERRORES Y AUSENCIA DE LOGS
// ---------------------------------------------------------------------------

test('ningun error crudo se puede filtrar en el resultado', () => {
  for (const file of verificationSources()) {
    for (const token of [
      '.message',
      'String(error)',
      'JSON.stringify(error)',
      'error.stack',
      'cause:',
      '${error'
    ]) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe filtrar ${token}`
      );
    }
  }
});

test('la verificacion publica no agrega logs', () => {
  for (const file of verificationSources()) {
    for (const token of ['console.', 'new Logger(', 'Logger.', 'process.stdout']) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe contener ${token}`
      );
    }
  }
});

test('los motivos son codigos CERRADOS, nunca texto interpolado', () => {
  const outcome = executableCode(read('verification-outcome.ts'));

  // Las dos listas de motivos existen y son `as const`.
  assert.match(outcome, /CREDENTIAL_AUTHENTICITY_REASON_VALUES = \[/);
  assert.match(outcome, /BLOCKCHAIN_EVIDENCE_REASON_VALUES = \[/);
  assert.equal((outcome.match(/\] as const;/g) ?? []).length, 6);

  // Y ningun motivo se arma con plantillas.
  assert.ok(!outcome.includes('`${'));
});

// ---------------------------------------------------------------------------
// NO SE IMPLEMENTA TRABAJO DE OTRAS SLICES
// ---------------------------------------------------------------------------

test('no se implementa historia de claves (S8c8)', () => {
  for (const file of verificationSources()) {
    for (const token of [
      'AssertionKeyHistory',
      'signerProfileHistory',
      'rotateAssertion',
      'historicalSigner',
      'keyHistory'
    ]) {
      assert.ok(!file.code.includes(token), `${file.name}: ${token} es S8c8`);
    }
  }
});

test('no se toca readyToIssue (S8c9) ni se inventa un manifest (S8c10)', () => {
  for (const file of verificationSources()) {
    for (const token of [
      'readyToIssue',
      'allowedCredentialType',
      'deploymentManifest',
      'deployments/',
      'deployBlock'
    ]) {
      assert.ok(!file.code.includes(token), `${file.name}: ${token} no es S8c7`);
    }
  }
});

test('no se agrega ninguna variable de entorno nueva', () => {
  for (const file of verificationSources()) {
    assert.ok(
      !file.code.includes('process.env'),
      `${file.name} no debe leer el entorno: la config llega por el resolver de target`
    );
  }
});

// ---------------------------------------------------------------------------
// EL MODULO NO TIENE CAPACIDAD DE FIRMA NI DE ESCRITURA
// ---------------------------------------------------------------------------

test('el modulo de verificacion no importa signing, blockchain ni credentials', () => {
  const module = executableCode(read('verification.module.ts'));

  assert.match(module, /imports: \[IdentityModule\]/);

  for (const token of [
    'SigningModule',
    'BlockchainModule',
    'CredentialsModule',
    'AuthModule',
    'JwtModule'
  ]) {
    assert.ok(!module.includes(token), `el modulo no debe importar ${token}`);
  }
});

// ---------------------------------------------------------------------------
// COLISION DE NOMBRES -- ADDENDUM E
// ---------------------------------------------------------------------------

test('addendum E: el estado de verificacion no colisiona con el de Prisma', () => {
  const outcome = executableCode(read('verification-outcome.ts'));

  // El tipo del dominio de verificacion tiene nombre propio...
  assert.match(outcome, /export type VerificationCredentialStatus/);
  // ...y el de Prisma se importa solo como entrada del mapeo base.
  assert.match(outcome, /import \{ CredentialStatus \} from '@prisma\/client'/);
  assert.ok(!outcome.includes('export type CredentialStatus'));
  assert.ok(!outcome.includes('export enum CredentialStatus'));

  // Los valores serializados publicos no cambian por el renombre.
  assert.match(outcome, /'ACTIVE',\s*'REVOKED',\s*'UNKNOWN'/);
});

// ---------------------------------------------------------------------------
// LA COMPATIBILIDAD DEL DTO
// ---------------------------------------------------------------------------

test('el DTO conserva los campos que el web desplegado ya consume', () => {
  const dto = read('dto/verify-credential-response.dto.ts');

  for (const field of [
    'credentialReference',
    'statusLabel',
    'typeLabel',
    'canonicalHashShort',
    'canonicalizationVersion',
    'canonicalHashPresent',
    'blockchainRecordsCount',
    'latestBlockchainRecord',
    'networkLabel',
    'txHashShort',
    'summary',
    'checkedAt'
  ]) {
    assert.ok(dto.includes(field), `el DTO debe conservar ${field}`);
  }

  // Los tres campos de cadena siguen siendo nullable despues de S8c6.
  assert.match(dto, /txHash: string \| null/);
  assert.match(dto, /registeredAt: string \| null/);

  // Y el campo legacy esta documentado como proyeccion.
  assert.match(dto, /CAMPO DE COMPATIBILIDAD/);
});

test('la nueva ruta no usa aserciones de no-nulo sobre los campos de cadena', () => {
  // S8c6 los hizo nullable a proposito: `pending` es un estado de primera
  // clase, y un `!` aqui lo trataria como un error.
  for (const file of verificationSources()) {
    for (const token of [
      'txHash!',
      'registeredAt!',
      'issuerAddress!',
      'blockNumber!'
    ]) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe afirmar no-nulo: ${token}`
      );
    }
  }
});

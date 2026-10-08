/**
 * Guards estructurales de la autoria de credentials -- S8c4.
 *
 * Congelan justamente lo que podria aflojarse sin que ningun test funcional
 * se rompiera:
 *
 *   * que la superficie de `signMessage` siga siendo UNA sola llamada, sobre
 *     los BYTES del envelope -- firmar el `canonicalHash` desnudo produciria
 *     una firma igual de "valida" pero sin separacion de dominio;
 *   * que la construccion del proof no vuelva a tocar el stack de secretos;
 *   * que no aparezca un provider de red ni una resolucion HTTP del propio DID;
 *   * que la asercion y el anclaje no se cruzen.
 *
 * Todo se evalua sobre CODIGO EJECUTABLE: la documentacion que explica la
 * separacion nombra estos identificadores a proposito, y un comentario correcto
 * no es una violacion. Esa es la leccion que ya costo un falso positivo en
 * S8c2/S8c3.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const CREDENTIALS_DIR = __dirname;
const API_SRC_DIR = join(__dirname, '..');

/** Archivos NUEVOS de la autoria criptografica. */
const PROOF_SOURCES = [
  'scope-proof-v1.ts',
  'credential-proof.error.ts',
  'credential-proof.service.ts'
] as const;

/** La integracion en la emision, que si conoce blockchain y DTOs. */
const ISSUANCE_SOURCE = 'credentials.service.ts';

function read(relativePath: string): string {
  return readFileSync(join(CREDENTIALS_DIR, relativePath), 'utf8');
}

/** Codigo ejecutable: sin comentarios de linea ni de bloque. */
function executableCode(contents: string): string {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

function proofSources(): Array<{ name: string; code: string }> {
  return PROOF_SOURCES.map((name) => ({
    name,
    code: executableCode(read(name))
  }));
}

/**
 * Todas las fuentes de PRODUCCION de la API.
 *
 * Se excluyen los directorios `__fixtures__`: por convencion del repo son
 * material de TEST que vive junto al modulo y solo lo importan archivos
 * `.test.ts` -- ahi es legitimo que haya claves publicas de prueba.
 */
function productionSources(): Array<{ name: string; path: string; code: string }> {
  const found: Array<{ name: string; path: string; code: string }> = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== '__fixtures__') {
          walk(full);
        }
        continue;
      }

      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
        continue;
      }

      found.push({
        name: entry.name,
        path: full,
        code: executableCode(readFileSync(full, 'utf8'))
      });
    }
  };

  walk(API_SRC_DIR);
  return found;
}

// ---------------------------------------------------------------------------
// SUPERFICIE DE FIRMA
// ---------------------------------------------------------------------------

test('en TODA la produccion hay UNA sola llamada a signMessage', () => {
  const callers = productionSources().filter((file) =>
    file.code.includes('signMessage(')
  );

  assert.deepEqual(
    callers.map((file) => file.name),
    ['credential-proof.service.ts'],
    'la firma de credentials vive en un unico lugar'
  );

  const occurrences =
    callers[0].code.match(/signMessage\(/g) ?? [];
  assert.equal(occurrences.length, 1, 'y es una sola llamada');
});

test('se firman los BYTES del envelope, no el texto ni el hash', () => {
  const service = executableCode(read('credential-proof.service.ts'));

  // La llamada recibe la variable de bytes, producida por toUtf8Bytes sobre
  // el builder puro del envelope.
  assert.match(service, /const envelopeBytes = toUtf8Bytes\(envelopeText\);/);
  assert.match(
    service,
    /const envelopeText = buildScopeProofV1Envelope\(/
  );
  assert.match(service, /signMessage\(envelopeBytes\)/);
});

test('las formas PROHIBIDAS de firmar no aparecen en produccion', () => {
  for (const file of productionSources()) {
    for (const forbidden of [
      'signMessage(canonicalHash',
      'signMessage(envelopeText',
      'signMessage(hashResult',
      'signMessage("scope-proof',
      "signMessage('scope-proof",
      'signMessage(`scope-proof',
      'signMessage(getBytes(',
      'signMessage(toUtf8Bytes(',
      'signingKey.sign(',
      'signTransaction(',
      'signTypedData(',
      '_signTypedData('
    ]) {
      assert.ok(
        !file.code.includes(forbidden),
        `${file.name} no debe contener ${forbidden}`
      );
    }
  }
});

test('la construccion del proof no construye Wallets: recibe un signer resuelto', () => {
  for (const file of proofSources()) {
    for (const forbidden of [
      'new Wallet',
      'Wallet.fromPhrase',
      'HDNodeWallet',
      'Mnemonic',
      'randomBytes',
      'new SigningKey('
    ]) {
      assert.ok(
        !file.code.includes(forbidden),
        `${file.name} no debe contener ${forbidden}`
      );
    }
  }

  // De ethers se usan SOLO primitivas locales: el codificador UTF-8 y la
  // comparacion de direcciones con checksum que S8c8 necesita para revalidar el
  // binding. Ninguna construye una Wallet, ninguna toca la red.
  const service = executableCode(read('credential-proof.service.ts'));
  const match = /import \{([^}]*)\} from 'ethers';/.exec(service);
  assert.ok(match, 'no se encontro el import de ethers');
  assert.deepEqual(
    match[1]
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0),
    ['type Wallet', 'getAddress', 'isAddress', 'toUtf8Bytes']
  );

  // El contrato PURO no importa ethers en absoluto.
  assert.ok(!read('scope-proof-v1.ts').includes("from 'ethers'"));
  assert.ok(!read('credential-proof.error.ts').includes("from 'ethers'"));
});

// ---------------------------------------------------------------------------
// SECRETOS
// ---------------------------------------------------------------------------

test('la autoria no referencia nada del stack de secretos', () => {
  const forbidden = [
    'secretRef',
    'SignerSecretStore',
    'SIGNER_SECRET_STORE',
    'AwsSsmSignerSecretStore',
    'createSignerSecretStoreFromEnv',
    'SSMClient',
    'GetParameter',
    'WithDecryption',
    'privateKey',
    'CREDENTIAL_REGISTRY_PRIVATE_KEY',
    'SIGNER_SECRET_REF_PREFIX',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY'
  ];

  for (const file of [
    ...proofSources(),
    { name: ISSUANCE_SOURCE, code: executableCode(read(ISSUANCE_SOURCE)) }
  ]) {
    for (const token of forbidden) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe referenciar ${token}`
      );
    }
  }
});

test('la unica fuente del signer de autoria es IssuerSignerResolver', () => {
  const service = executableCode(read('credential-proof.service.ts'));

  assert.match(service, /resolveAssertionSignerForIssuer\(/);
  // El anclaje NO: la autoria de la credencial no es asunto de la cuenta que
  // paga gas, y el llamador no puede elegir entre una y otra.
  assert.ok(!service.includes('resolveAnchorSignerForIssuer'));

  // La emision llega al signer SOLO a traves de este servicio: no inyecta el
  // resolver por su cuenta.
  const issuance = executableCode(read(ISSUANCE_SOURCE));
  assert.ok(!issuance.includes('IssuerSignerResolver'));
  assert.ok(!issuance.includes('resolveAssertionSignerForIssuer'));
  assert.ok(!issuance.includes('resolveAnchorSignerForIssuer'));
});

test('ni el proof ni los errores se loguean', () => {
  for (const file of proofSources()) {
    for (const token of ['console.', 'new Logger(', 'Logger.', 'process.stdout']) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe contener ${token}`
      );
    }
  }
});

test('los mensajes de error son literales fijos, sin interpolacion', () => {
  const errorFile = executableCode(read('credential-proof.error.ts'));

  assert.ok(
    !errorFile.includes('${'),
    'ningun mensaje de error puede interpolar nada'
  );
  assert.match(errorFile, /const SAFE_MESSAGES: Record</);
  assert.match(errorFile, /super\(SAFE_MESSAGES\[code\]\)/);
});

// ---------------------------------------------------------------------------
// RED
// ---------------------------------------------------------------------------

test('la autoria no introduce provider, RPC, contrato ni Base Sepolia', () => {
  for (const file of proofSources()) {
    for (const token of [
      'fetch(',
      'axios',
      'http.get',
      'https.get',
      'JsonRpcProvider',
      'WebSocketProvider',
      'FallbackProvider',
      'getDefaultProvider',
      'new Contract',
      'ContractFactory',
      'sendTransaction',
      'base-sepolia',
      'base_sepolia',
      '84532',
      'chainId',
      'CREDENTIAL_REGISTRY_RPC_URL',
      'CREDENTIAL_REGISTRY_CONTRACT_ADDRESS',
      'BLOCKCHAIN_EVIDENCE_MODE'
    ]) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe contener ${token}`
      );
    }
  }
});

test('la API no resuelve su propio DID por HTTP durante la emision', () => {
  for (const file of [
    ...proofSources(),
    { name: ISSUANCE_SOURCE, code: executableCode(read(ISSUANCE_SOURCE)) }
  ]) {
    for (const token of [
      'fetch(',
      'PUBLIC_DID_BASE_URL',
      '/did/issuers',
      'did.json',
      'buildDidForIssuer'
    ]) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe contener ${token}: el DID almacenado es la autoridad`
      );
    }
  }

  // Y si usa el contrato LOCAL y puro de S8c3.
  const service = executableCode(read('credential-proof.service.ts'));
  assert.match(service, /isDidForIssuerPath\(/);
  assert.match(
    service,
    /import \{ isDidForIssuerPath \} from '\.\.\/identity\/did-web-issuer';/
  );
});

// ---------------------------------------------------------------------------
// ORDEN: AUTORIZACION, SSM, TRANSACCION, BLOCKCHAIN
// ---------------------------------------------------------------------------

test('la resolucion del signer esta FUERA de la transaccion interactiva', () => {
  // Acotado al cuerpo de `issueCredential`: `createDraft` tiene su propia
  // transaccion y aparece ANTES en el archivo, asi que un `indexOf` sobre todo
  // el modulo encontraria esa.
  const issuance = executableCode(read(ISSUANCE_SOURCE)).slice(
    executableCode(read(ISSUANCE_SOURCE)).indexOf('async issueCredential(')
  );

  const prepare = issuance.indexOf('prepareAssertionSigner({');
  // S8c6: la transaccion de emision pasa a tener opciones (isolation), asi que
  // la callback ya no esta en la misma linea que la llamada.
  const transaction = issuance.indexOf('this.prisma.$transaction(');
  const createProof = issuance.indexOf('this.credentialProofService.createProof(');
  const blockchain = issuance.indexOf('this.blockchainEvidenceService.createRecord(');

  assert.ok(prepare > 0, 'no se encontro prepareAssertionSigner');
  assert.ok(transaction > 0, 'no se encontro la transaccion de emision');
  assert.ok(createProof > 0, 'no se encontro createProof');
  assert.ok(blockchain > 0, 'no se encontro la evidencia de blockchain');

  // La resolucion -- que puede leer SSM -- precede a la apertura de la
  // transaccion. La firma, que es computo local, si ocurre adentro.
  assert.ok(
    prepare < transaction,
    'la lectura de secreto no puede entrar en la transaccion'
  );
  assert.ok(createProof > transaction, 'la firma local va dentro');
  assert.ok(createProof < blockchain, 'el proof precede al anclaje');

  // Y se resuelve UNA sola vez.
  assert.equal(
    (issuance.match(/prepareAssertionSigner\(/g) ?? []).length,
    1
  );
});

test('la autorizacion precede a la identidad tecnica y al signer', () => {
  const issuance = executableCode(read(ISSUANCE_SOURCE));
  const issueBody = issuance.slice(
    issuance.indexOf('async issueCredential(')
  );

  const membership = issueBody.indexOf('assertUserCanIssueForIssuer(');
  const eligibility = issueBody.indexOf('assertIssuerCanIssue(');
  const technicalIdentity = issueBody.indexOf('issuerTechnicalIdentity.findUnique');
  const prepare = issueBody.indexOf('prepareAssertionSigner({');

  assert.ok(membership > 0 && eligibility > 0);
  assert.ok(membership < technicalIdentity);
  assert.ok(eligibility < technicalIdentity);
  assert.ok(technicalIdentity < prepare);
});

test('el hash canonico se calcula UNA sola vez en la emision', () => {
  const issuance = executableCode(read(ISSUANCE_SOURCE));

  assert.equal(
    (issuance.match(/createCanonicalHashForVersion\(/g) ?? []).length,
    1
  );
  // La emision ya NO usa la version por defecto (canon_v1).
  assert.ok(!issuance.includes('createCanonicalHash({'));
  assert.match(issuance, /CredentialHashingService\.CANONICALIZATION_VERSION_V2/);
});

test('el anclaje recibe el hash ya calculado y no lo recalcula', () => {
  const evidence = executableCode(
    readFileSync(
      join(API_SRC_DIR, 'blockchain', 'blockchain-evidence.service.ts'),
      'utf8'
    )
  );

  // El servicio de evidencia consume `input.credentialHash`; no conoce la
  // canonicalizacion y no puede derivar un hash propio que divergiera.
  assert.match(evidence, /credentialHash: input\.credentialHash/);
  assert.ok(!evidence.includes('createCanonicalHash'));
  assert.ok(!evidence.includes('CredentialHashingService'));
});

// ---------------------------------------------------------------------------
// ASERCION != ANCLAJE
// ---------------------------------------------------------------------------

test('la Wallet de asercion no se pasa a blockchain ni a revocacion', () => {
  const issuance = executableCode(read(ISSUANCE_SOURCE));

  // La llamada de evidencia recibe exactamente cuatro campos, y ninguno es la
  // Wallet, su direccion ni el perfil de asercion.
  // S8c6: la llamada mock ahora recibe un tercer argumento (el target ya
  // resuelto), asi que el cierre del objeto va seguido de `,` y no de `)`.
  const call = /createRecord\(\s*transaction,\s*\{([\s\S]*?)\n\s*\},/.exec(
    issuance
  );
  assert.ok(call, 'no se encontro la llamada a createRecord');

  const fields = [...call[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(fields.sort(), [
    'canonicalizationVersion',
    'credentialHash',
    'credentialId',
    'issuerAddress'
  ]);
  // Ni el signer preparado, ni su Wallet, ni el proof. (`walletAddress` SI
  // aparece, y es justamente la direccion del plano de anclaje legacy: por eso
  // el token prohibido es el signer, no la palabra "wallet".)
  assert.ok(!call[1].includes('preparedSigner'));
  assert.ok(!call[1].includes('.wallet)'));
  assert.ok(!call[1].includes('signer'));
  assert.ok(!call[1].includes('proof'));

  // `issuerAddress` sigue siendo la direccion LEGACY del issuer.
  assert.match(call[1], /issuerAddress: credential\.issuer\.walletAddress!/);
});

test('el camino legacy de anclaje queda intacto y sigue siendo el activo', () => {
  const writeClient = readFileSync(
    join(API_SRC_DIR, 'blockchain', 'credential-registry-write-client.ts'),
    'utf8'
  );

  // 50: la clave global legacy sigue siendo SOLO de blockchain y no se usa
  // para scope-proof-v1.
  assert.ok(writeClient.includes('CREDENTIAL_REGISTRY_PRIVATE_KEY'));
  assert.ok(!writeClient.includes('scope-proof-v1'));
  assert.ok(!writeClient.includes('ScopeCredentialProof2026'));
  assert.ok(!writeClient.includes('resolveAssertionSignerForIssuer'));

  const revocation = readFileSync(
    join(API_SRC_DIR, 'credentials', 'issuer-credential-revocation.service.ts'),
    'utf8'
  );
  assert.ok(!revocation.includes('CredentialProofService'));
  assert.ok(!revocation.includes('scope-proof-v1'));
  // S8c8: la revocacion SI resuelve identidad -- el ANCHOR HISTORICO que el
  // record congelo -- asi que ya no puede prohibirse el resolver entero. Lo que
  // este guard protege sigue siendo el limite real: la revocacion no toca el
  // plano de ASERCION.
  assert.ok(!revocation.includes('resolveAssertionSignerForIssuer'));
  assert.ok(!revocation.includes('prepareAssertionSigner'));
  assert.match(revocation, /resolveHistoricalAnchorSigner/);
});

// ---------------------------------------------------------------------------
// LA VERIFICACION VIVE EN SU PROPIO PLANO
// ---------------------------------------------------------------------------

test('la verificacion de proofs ocurre SOLO en el verificador de S8c7', () => {
  // Hasta S8c6 este guard decia "no se implementa verificacion de proofs
  // todavia: eso es S8c7". S8c7 la implemento, asi que la afirmacion se
  // actualiza en vez de quedar probando algo que ya no es cierto.
  //
  // Lo que se conserva -- y es lo que realmente importaba -- es la separacion
  // de planos: el plano de EMISION construye proofs y no los verifica, y el
  // unico lugar del codigo de produccion que recupera una direccion de una
  // firma es el verificador publico.
  const ALLOWED = ['credential-authenticity.verifier.ts'];
  const offenders: string[] = [];

  for (const file of productionSources()) {
    for (const token of ['verifyMessage', 'recoverAddress', 'Signature.from']) {
      if (file.code.includes(token) && !ALLOWED.includes(file.name)) {
        offenders.push(`${file.name}:${token}`);
      }
    }
  }

  assert.deepEqual(offenders, []);

  // Y el plano de emision sigue sin verificar nada.
  for (const file of [
    ...proofSources(),
    { name: ISSUANCE_SOURCE, code: executableCode(read(ISSUANCE_SOURCE)) }
  ]) {
    for (const token of ['verifyMessage', 'recoverAddress', 'Signature.from']) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} construye proofs, no los verifica`
      );
    }
  }
});

test('no se implementa historial de claves de asercion', () => {
  for (const file of proofSources()) {
    for (const token of [
      'AssertionKeyHistory',
      'previousKeyVersion',
      'rotateAssertion',
      'keyHistory'
    ]) {
      assert.ok(!file.code.includes(token), `${file.name}: la rotacion es S8c8`);
    }
  }
});

test('no se toca readyToIssue ni la semantica de autorizacion', () => {
  // La lista de tipos habilitados por issuer que agrego S8c1 NO figura aca, y
  // su nombre no se escribe en este archivo a proposito: S8c1 ya tiene un
  // guard propio (prisma/technical-identity-schema.test.ts) que afirma que ese
  // identificador no aparece en NINGUN .ts de src/, lo cual es estrictamente
  // mas fuerte que mirar estos tres archivos. Repetirlo aca -- incluso como
  // token PROHIBIDO, incluso en un comentario -- hacia que aquel guard, que
  // busca texto crudo, lo tomara por un lector real. Un guard ajeno no se
  // debilita para acomodar una asercion redundante.
  for (const file of proofSources()) {
    for (const token of [
      'readyToIssue',
      'IssuerMembership',
      'PlatformAdmin',
      'authorizationStatus'
    ]) {
      assert.ok(!file.code.includes(token), `${file.name}: eso es S8c9`);
    }
  }
});

// ---------------------------------------------------------------------------
// NINGUNA CLAVE DE PRUEBA EN PRODUCCION
// ---------------------------------------------------------------------------

test('no hay clave sintetica, de demo ni fallback en produccion', () => {
  for (const file of productionSources()) {
    for (const token of [
      'TEST_PRIVATE_KEY',
      'ANVIL_PRIVATE_KEY',
      'DEMO_PRIVATE_KEY',
      'FALLBACK_SIGNER',
      'signing/__fixtures__',
      'signer-test-keys',
      'PUBLIC_TEST_KEY',
      // El escalar 1 escrito a mano.
      '0x0000000000000000000000000000000000000000000000000000000000000001'
    ]) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe contener ${token}`
      );
    }
  }
});

test('no se agrego ninguna dependencia criptografica nueva', () => {
  const manifest = JSON.parse(
    readFileSync(join(API_SRC_DIR, '..', 'package.json'), 'utf8')
  ) as { dependencies: Record<string, string> };

  assert.equal(manifest.dependencies.ethers, '6.17.0');

  for (const unexpected of [
    'elliptic',
    'secp256k1',
    '@noble/secp256k1',
    '@noble/curves',
    'jose',
    'jsonwebtoken',
    'jsonld',
    'rdf-canonize',
    'ajv',
    'canonicalize'
  ]) {
    assert.equal(
      manifest.dependencies[unexpected],
      undefined,
      `no se esperaba ${unexpected}`
    );
  }
});

/**
 * Guards estructurales del plano de identidad publica del issuer -- S8c3.
 *
 * Lo que congelan es justamente lo que podria filtrarse sin que ningun test
 * funcional se rompiera: que el resolver publico NO vuelva a depender del
 * secret store, que no aparezca un provider de red, y que el plano de holders
 * no gane claves.
 *
 * Alcance acotado a los archivos nuevos de S8c3 mas el controller de User DID,
 * no un grep del repo entero.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const IDENTITY_DIR = __dirname;

const ISSUER_SOURCES = [
  'issuer-did.controller.ts',
  // S8c7: la resolucion salio del controller y entra en TODOS los guards de
  // este plano (secretos, logs, self-fetch, escrituras) por este mismo listado.
  'issuer-did-document.resolver.ts',
  'issuer-did-document.builder.ts',
  'did-web-issuer.ts',
  'dto/issuer-did-document-response.dto.ts'
] as const;

function read(relativePath: string): string {
  return readFileSync(join(IDENTITY_DIR, relativePath), 'utf8');
}

/** Codigo ejecutable: sin comentarios de linea ni de bloque. */
function executableCode(contents: string): string {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

function issuerSources(): Array<{ name: string; code: string }> {
  return ISSUER_SOURCES.map((name) => ({
    name,
    code: executableCode(read(name))
  }));
}

// ---------------------------------------------------------------------------
// SIN ACCESO A SECRETOS
// ---------------------------------------------------------------------------

test('el plano publico del issuer NO toca nada del stack de secretos', () => {
  const forbidden = [
    'IssuerSignerResolver',
    'resolveAssertionSignerForIssuer',
    'resolveAnchorSignerForIssuer',
    'SIGNER_SECRET_STORE',
    'SignerSecretStore',
    'AwsSsmSignerSecretStore',
    'SSMClient',
    'GetParameter',
    'WithDecryption',
    'secretRef',
    'privateKey',
    'CREDENTIAL_REGISTRY_PRIVATE_KEY',
    'createSignerSecretStoreFromEnv'
  ];

  for (const file of issuerSources()) {
    for (const token of forbidden) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe referenciar ${token}`
      );
    }
  }
});

test('no se construye ninguna Wallet ni se firma nada', () => {
  for (const file of issuerSources()) {
    for (const token of [
      'new Wallet',
      'Wallet(',
      'signMessage',
      'verifyMessage',
      'signTransaction',
      'signTypedData',
      'wallet.signingKey',
      '.sign('
    ]) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe contener ${token}`
      );
    }
  }
});

test('no hay provider, ni RPC, ni contrato, ni logica de Base Sepolia', () => {
  for (const file of issuerSources()) {
    for (const token of [
      'JsonRpcProvider',
      'WebSocketProvider',
      'FallbackProvider',
      'new Contract',
      'ContractFactory',
      'sendTransaction',
      'base_sepolia',
      'base-sepolia',
      'chainId',
      'CREDENTIAL_REGISTRY_RPC_URL',
      'BLOCKCHAIN_EVIDENCE_MODE'
    ]) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe contener ${token}`
      );
    }
  }
});

test('de ethers solo se usa una utilidad de clave PUBLICA', () => {
  const builder = read('issuer-did-document.builder.ts');
  const match = /import \{([^}]*)\} from 'ethers';/.exec(builder);
  assert.ok(match, 'no se encontro el import de ethers');

  const imported = match[1]
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  assert.deepEqual(imported, ['SigningKey']);

  // Y solo su metodo ESTATICO de clave publica: nunca `new SigningKey(...)`,
  // que exigiria una clave privada.
  const code = executableCode(builder);
  assert.match(code, /SigningKey\.computePublicKey\(/);
  assert.ok(!code.includes('new SigningKey('));

  // Los otros archivos del plano publico no importan ethers en absoluto.
  for (const name of [
    'issuer-did.controller.ts',
    'did-web-issuer.ts',
    'dto/issuer-did-document-response.dto.ts'
  ] as const) {
    assert.ok(!read(name).includes("from 'ethers'"), name);
  }
});

test('el controller no importa nada de src/signing/', () => {
  const controller = read('issuer-did.controller.ts');
  assert.ok(!controller.includes("from '../signing"));
  assert.ok(!controller.includes('signing/'));
});

// ---------------------------------------------------------------------------
// SIN AUTORIZACION NI ESTADO OPERATIVO
// ---------------------------------------------------------------------------

test('el endpoint no declara ningun guard', () => {
  const controller = executableCode(read('issuer-did.controller.ts'));

  for (const token of [
    'UseGuards',
    'AuthGuard',
    'PlatformAdminGuard',
    'CurrentUser',
    '@Req',
    'Request'
  ]) {
    assert.ok(
      !controller.includes(token),
      `el resolver publico no debe usar ${token}`
    );
  }
});

test('la resolucion del DID no consulta autorizacion ni readyToIssue', () => {
  const controller = executableCode(read('issuer-did.controller.ts'));

  for (const token of [
    'authorizationStatus',
    'readyToIssue',
    'assertIssuerCanIssue',
    'IssuerMembership',
    'issuerMembership',
    'platformAdmin',
    'PlatformAdmin'
  ]) {
    assert.ok(
      !controller.includes(token),
      `la publicacion de identidad no debe depender de ${token}`
    );
  }
});

test('no se exige IssuerTechnicalIdentity.status: identidad != permiso', () => {
  // S8c7 movio la consulta al resolver; el contrato no cambio.
  const resolver = executableCode(read('issuer-did-document.resolver.ts'));

  // El select pide `status` UNA sola vez, y es el del perfil de firma, que si
  // define publicacion. El de la identidad tecnica ni se consulta.
  assert.equal((resolver.match(/status: true/g) ?? []).length, 1);
  assert.ok(!resolver.includes('IssuerTechnicalIdentityStatus'));

  // Y el controller ya no consulta nada: solo proyecta a HTTP.
  const controller = executableCode(read('issuer-did.controller.ts'));
  assert.ok(!controller.includes('prisma'));
  assert.ok(!controller.includes('select:'));
});

test('no hay fallback al Issuer legacy', () => {
  for (const file of issuerSources()) {
    assert.ok(!file.code.includes('prisma.issuer.'), file.name);
    assert.ok(!file.code.includes('walletAddress'), file.name);
    assert.ok(!file.code.includes('did:example'), file.name);
  }
});

// ---------------------------------------------------------------------------
// FORMA DEL SELECT
// ---------------------------------------------------------------------------

test('el select del resolver pide EXACTAMENTE los campos publicos necesarios', () => {
  const resolver = executableCode(read('issuer-did-document.resolver.ts'));

  // S8c8: el select abarca el PUNTERO VIGENTE mas la HISTORIA de bindings, asi
  // que se afirma sobre TODOS los campos escalares pedidos en el archivo. Si un
  // refactor agregara `secretRef`, `custody`, `address`, el anchor o cualquier
  // otra cosa, este guard falla.
  const fields = [...resolver.matchAll(/(\w+): true/g)].map((m) => m[1]);

  assert.deepEqual([...new Set(fields)].sort(), [
    // El puntero vigente, como id: la autoridad de firma nueva no se deriva de
    // la historia.
    'assertionSignerProfileId',
    'did',
    // El id de cada perfil de la historia, para poder comparar contra el
    // puntero vigente sin volver a consultar.
    'id',
    'keyVersion',
    'publicKeyCompressed',
    'publicKeyX',
    'publicKeyY',
    'purpose',
    'status'
  ]);
});

// ---------------------------------------------------------------------------
// SIN LOGS
// ---------------------------------------------------------------------------

test('el plano publico del issuer no loguea', () => {
  for (const file of issuerSources()) {
    for (const token of ['console.', 'new Logger(', 'Logger.']) {
      assert.ok(!file.code.includes(token), `${file.name} no debe contener ${token}`);
    }
  }
});

test('los errores del builder no interpolan nada', () => {
  const builder = executableCode(read('issuer-did-document.builder.ts'));

  // El mensaje del error es un literal fijo.
  assert.match(
    builder,
    /super\('La identidad tecnica del issuer tiene configuracion inconsistente\.'\)/
  );

  const errorClass = /class IssuerDidDocumentError[\s\S]*?\n\}/.exec(builder);
  assert.ok(errorClass);
  assert.ok(!errorClass[0].includes('${'), 'sin interpolacion en el error');
});

// ---------------------------------------------------------------------------
// EL PLANO DE HOLDERS NO CAMBIA
// ---------------------------------------------------------------------------

test('18: el DID Document de User sigue siendo id-only', () => {
  // Sobre CODIGO EJECUTABLE: el DTO de User DID ya explicaba en un comentario,
  // desde antes de S8c3, que `verificationMethod` es OPTIONAL y que se omite a
  // proposito. Esa prosa es correcta y no debe confundirse con un campo.
  const dto = executableCode(read('dto/did-document-response.dto.ts'));

  for (const token of [
    'verificationMethod',
    'assertionMethod',
    'publicKeyJwk',
    'JsonWebKey'
  ]) {
    assert.ok(
      !dto.includes(token),
      `el DTO de User DID no debe ganar ${token} por S8c3`
    );
  }

  // Y sigue teniendo exactamente dos propiedades.
  const fields = [...dto.matchAll(/^\s+'?([@\w]+)'?[?]?:/gm)].map((m) => m[1]);
  assert.deepEqual(fields, ['@context', 'id']);

  const userController = executableCode(read('did.controller.ts'));
  assert.ok(!userController.includes('publicKeyJwk'));
  assert.ok(!userController.includes('assertionMethod'));
  assert.ok(!userController.includes('cid/v1'));
  // Y sigue sin cabeceras nuevas.
  assert.ok(!userController.includes('@Header'));
});

test('los dos controllers estan registrados y son independientes', () => {
  const module = read('identity.module.ts');

  assert.match(module, /controllers: \[DidController, IssuerDidController\]/);

  // S8c7 agrego el resolver del DID Document -- para que el verificador publico
  // lo inyecte en vez de hacerle un HTTP a esta misma API -- y S8c8 las
  // primitivas de rotacion. Los DOS se exportan, y nada mas se provee aca.
  assert.match(
    module,
    /providers: \[IssuerDidDocumentResolver, SignerRotationService\]/
  );
  assert.match(
    module,
    /exports: \[IssuerDidDocumentResolver, SignerRotationService\]/
  );

  // Y en particular NO entra nada del plano de secretos ni de blockchain: rotar
  // es una transicion de metadata publica.
  //
  // Sobre el codigo EJECUTABLE: el comentario del modulo nombra a proposito lo
  // que NO importa, justamente para explicar por que.
  const executable = executableCode(module);
  for (const forbidden of [
    'SigningModule',
    'BlockchainModule',
    'CredentialsModule',
    'IssuerSignerResolver',
    'SignerSecretStore',
    'AnchorWriteCoordinator'
  ]) {
    assert.ok(!executable.includes(forbidden), forbidden);
  }
});

test('los namespaces de ruta estan separados', () => {
  assert.match(read('did.controller.ts'), /@Controller\('did\/users'\)/);
  assert.match(read('issuer-did.controller.ts'), /@Controller\('did\/issuers'\)/);
});

// ---------------------------------------------------------------------------
// SIN FETCH DE SU PROPIO DID
// ---------------------------------------------------------------------------

test('la API no resuelve su propio DID por HTTP', () => {
  for (const file of issuerSources()) {
    for (const token of [
      'fetch(',
      'axios',
      'http.get',
      'https.get',
      'PUBLIC_DID_BASE_URL',
      'api.scopeedu.technology'
    ]) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe contener ${token}: el documento se arma con metadata local`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// SIN CACHE DE APLICACION
// ---------------------------------------------------------------------------

test('S8c3 no introduce ninguna cache de DID Documents', () => {
  // La UNICA mencion legitima de cache es la cabecera HTTP `Cache-Control`,
  // que es lo contrario de cachear. Se la quita antes de buscar cualquier
  // indicio de una cache de aplicacion.
  for (const file of issuerSources()) {
    const withoutCacheHeader = file.code.replace(
      /@Header\('Cache-Control', 'no-store'\)/g,
      ''
    );

    for (const token of ['new Map(', 'cache', 'Cache', 'ttl', 'TTL', 'memo']) {
      assert.ok(
        !withoutCacheHeader.includes(token),
        `${file.name} no debe introducir una cache: eso es asunto de S8c7`
      );
    }
  }

  assert.match(
    read('issuer-did.controller.ts'),
    /@Header\('Cache-Control', 'no-store'\)/
  );
});

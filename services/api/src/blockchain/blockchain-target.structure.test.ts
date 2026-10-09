/**
 * Guards estructurales del target de blockchain -- S8c5.
 *
 * Congelan lo que podria aflojarse sin que ningun test funcional se rompiera:
 * que la URL del RPC no se loguee ni viaje en un error, que el modo fusionado
 * `credential_registry_anvil` no vuelva, que los chainId no se desparramen
 * fuera del mapeo, y que el signer de ASERCION de S8c4 siga completamente
 * ausente del plano de blockchain.
 *
 * Todo sobre CODIGO EJECUTABLE: la documentacion que explica estas separaciones
 * nombra los identificadores a proposito, y un comentario correcto no es una
 * violacion.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const BLOCKCHAIN_DIR = __dirname;
const API_SRC_DIR = join(__dirname, '..');

/** Archivos nuevos o refactorizados por S8c5. */
const TARGET_SOURCES = [
  'blockchain-target.ts',
  'credential-registry-preflight.ts',
  'credential-registry-write-client.ts',
  'credential-registry-read-client.ts',
  'credential-registry-deployment.ts',
  'blockchain-evidence.service.ts',
  'blockchain-record-reconciliation.service.ts'
] as const;

function executableCode(contents: string): string {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

function read(relativePath: string): string {
  return readFileSync(join(BLOCKCHAIN_DIR, relativePath), 'utf8');
}

function targetSources(): Array<{ name: string; code: string }> {
  return TARGET_SOURCES.map((name) => ({
    name,
    code: executableCode(read(name))
  }));
}

/** Fuentes de PRODUCCION de toda la API, sin fixtures de test. */
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
// LA URL DEL RPC NO SALE NUNCA
// ---------------------------------------------------------------------------

test('el plano de blockchain no loguea nada', () => {
  for (const file of targetSources()) {
    for (const token of [
      'console.',
      'new Logger(',
      'Logger.',
      'process.stdout',
      'process.stderr'
    ]) {
      assert.ok(!file.code.includes(token), `${file.name} no debe contener ${token}`);
    }
  }
});

test('los mensajes de error del target son literales fijos', () => {
  const targetFile = executableCode(read('blockchain-target.ts'));

  // Toda la tabla de mensajes es un `Record` de literales: si alguien
  // interpolara la rpcUrl en un mensaje, este guard se rompe.
  assert.match(targetFile, /const SAFE_MESSAGES: Record</);
  assert.match(targetFile, /super\(SAFE_MESSAGES\[code\]\)/);

  const errorClass = /class BlockchainTargetError[\s\S]*?\n\}/.exec(targetFile);
  assert.ok(errorClass, 'no se encontro la clase de error');
  assert.ok(!errorClass[0].includes('${'), 'sin interpolacion en el error');
});

test('ningun error crudo del provider se propaga', () => {
  const preflight = executableCode(read('credential-registry-preflight.ts'));

  // Mas fuerte que listar formas concretas: en el codigo ejecutable del
  // preflight NO puede haber NINGUN acceso a `.message` ni NINGUNA plantilla
  // de string. Asi tampoco pasan las variantes que una lista de tokens no
  // anticipa, como `(error as Error).message` o `${(error as Error)}`.
  assert.ok(
    !preflight.includes('.message'),
    'el preflight no debe leer .message de nada'
  );
  assert.ok(
    !preflight.includes('${'),
    'el preflight no debe interpolar nada en un string'
  );

  for (const token of [
    'String(error)',
    'JSON.stringify(error)',
    'cause:',
    'cause ='
  ]) {
    assert.ok(!preflight.includes(token), `el preflight no debe usar ${token}`);
  }

  // De un error ajeno se conserva SOLO el nombre de la clase.
  assert.match(preflight, /function errorName\(error: unknown\)/);
  assert.match(preflight, /providerErrorName: errorName\(error\)/);
});

test('la rpcUrl no se interpola en ningun lado del plano de blockchain', () => {
  for (const file of targetSources()) {
    for (const token of [
      '${rpcUrl',
      '${target.rpcUrl',
      '${config.rpcUrl',
      '${this.rpcUrl',
      '${deployment.rpcUrl',
      'rpcUrl}',
      'CREDENTIAL_REGISTRY_RPC_URL}'
    ]) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe interpolar la rpcUrl (${token})`
      );
    }
  }
});

test('la rpcUrl no se expone por DTO ni por HTTP', () => {
  // Ningun DTO ni controller de la API menciona la variable ni el campo.
  const exposed = productionSources().filter(
    (file) =>
      (file.path.includes('dto') || file.name.includes('.controller.')) &&
      (file.code.includes('rpcUrl') ||
        file.code.includes('CREDENTIAL_REGISTRY_RPC_URL'))
  );

  assert.deepEqual(exposed.map((file) => file.name), []);

  // Y S8c5 no crea ningun endpoint nuevo de configuracion del target.
  for (const file of targetSources()) {
    for (const token of ['@Controller', '@Get(', '@Post(', '@Injectable()\nexport class Blockchain' ]) {
      if (token === '@Controller' || token.startsWith('@Get') || token.startsWith('@Post')) {
        assert.ok(
          !file.code.includes(token),
          `${file.name} no debe declarar superficie HTTP`
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// MODO != RED
// ---------------------------------------------------------------------------

test('el modo fusionado credential_registry_anvil no existe en produccion', () => {
  for (const file of productionSources()) {
    assert.ok(
      !file.code.includes('credential_registry_anvil'),
      `${file.name} todavia menciona el modo fusionado`
    );
  }
});

test('los chainId viven SOLO en el mapeo de red', () => {
  const mappingFile = 'blockchain-target.ts';

  for (const file of productionSources()) {
    if (file.name === mappingFile) {
      continue;
    }

    for (const chainId of ['31337', '84532']) {
      assert.ok(
        !file.code.includes(chainId),
        `${file.name} no debe repetir el chainId ${chainId}: se deriva del mapeo`
      );
    }
  }

  // Y en el mapeo aparecen una sola vez cada uno.
  const mapping = executableCode(read(mappingFile));
  assert.equal((mapping.match(/31337/g) ?? []).length, 1);
  assert.equal((mapping.match(/84532/g) ?? []).length, 1);
});

test('la logica de escritura no decide red ni chainId por su cuenta', () => {
  for (const file of [
    'credential-registry-write-client.ts',
    'blockchain-evidence.service.ts',
    'blockchain-registration.service.ts',
    'anchor-write-coordinator.ts'
  ] as const) {
    const code = executableCode(read(file));

    // Nada de `if (mode === ...) { chainId = ... }`: la red sale del target.
    assert.ok(!code.includes('chainId: 31337'), file);
    assert.ok(!code.includes('chainId: 84532'), file);
    assert.ok(!code.includes('BlockchainNetwork.base_sepolia'), file);
  }

  // S8c6: la procedencia del target la escribe el ciclo de vida, que es quien
  // creo el intent. El servicio de evidencia quedo reducido al modo mock.
  const registration = executableCode(read('blockchain-registration.service.ts'));
  assert.match(registration, /network: input\.target\.network/);
  assert.match(registration, /chainId: input\.target\.chainId/);
  assert.match(registration, /contractAddress: input\.target\.contractAddress/);
  assert.match(registration, /deploymentId: input\.target\.deploymentId/);
});

// ---------------------------------------------------------------------------
// UNA SOLA FRONTERA DE CONFIGURACION
// ---------------------------------------------------------------------------

test('las variables del target se leen SOLO en el resolver', () => {
  const owner = 'blockchain-target.ts';
  const targetVariables = [
    'CREDENTIAL_REGISTRY_NETWORK',
    'CREDENTIAL_REGISTRY_CHAIN_ID',
    'CREDENTIAL_REGISTRY_DEPLOYMENT_ID'
  ];

  for (const file of productionSources()) {
    if (file.name === owner) {
      continue;
    }

    for (const variable of targetVariables) {
      // Se busca la LECTURA, no la mencion: `credential-registry-deployment.ts`
      // nombra estos campos como etiquetas de un `switch` sobre el tipo
      // `BlockchainTargetField` para traducir el fallo a su propia razon. Eso
      // no es leer el entorno, y prohibirlo convertiria un mapeo tipado en una
      // violacion.
      for (const accessor of [
        `process.env.${variable}`,
        `environment.${variable}`,
        `env.${variable}`,
        `process.env['${variable}']`,
        `process.env["${variable}"]`
      ]) {
        assert.ok(
          !file.code.includes(accessor),
          `${file.name} no debe leer ${variable}: eso es del resolver de target`
        );
      }
    }
  }
});

test('la clave privada legacy sigue SOLO en la custodia del write client', () => {
  const custodian = 'credential-registry-write-client.ts';

  for (const file of productionSources()) {
    if (file.name === custodian) {
      continue;
    }

    assert.ok(
      !file.code.includes('CREDENTIAL_REGISTRY_PRIVATE_KEY'),
      `${file.name} no debe leer la clave privada legacy`
    );
  }

  // Y sigue siendo el signer activo: S8c5 NO la reemplaza.
  const code = executableCode(read(custodian));
  assert.match(code, /CREDENTIAL_REGISTRY_PRIVATE_KEY/);
  assert.match(code, /new Wallet\(config\.privateKey, provider\)/);
});

// ---------------------------------------------------------------------------
// SEPARACION DEL SIGNER DE ASERCION (S8c4)
// ---------------------------------------------------------------------------

test('el plano de blockchain no toca el signer de asercion ni el proof', () => {
  for (const file of targetSources()) {
    for (const token of [
      'CredentialProofService',
      'scope-proof-v1',
      'ScopeCredentialProof2026',
      'buildScopeProofV1',
      'resolveAssertionSignerForIssuer',
      'IssuerSignerResolver',
      'SIGNER_SECRET_STORE',
      'secretRef',
      'signMessage',
      'proofValue'
    ]) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe referenciar ${token}: la autoria es otro plano`
      );
    }
  }
});

test('no se introduce ningun segundo origen de la direccion del signer', () => {
  // S8c6 resolvera el anchor desde IssuerTechnicalIdentity -> anchorSignerProfile.
  // Una variable de entorno con la direccion esperada seria una segunda fuente
  // de verdad que habria que mantener sincronizada a mano.
  for (const file of productionSources()) {
    for (const token of [
      'CREDENTIAL_REGISTRY_SIGNER_ADDRESS',
      'EXPECTED_ANCHOR_ADDRESS',
      'ANCHOR_WALLET_ADDRESS',
      'EXPECTED_SIGNER_ADDRESS'
    ]) {
      assert.ok(!file.code.includes(token), `${file.name} no debe declarar ${token}`);
    }
  }
});

// ---------------------------------------------------------------------------
// PROVIDER: FORMA Y NEUTRALIDAD
// ---------------------------------------------------------------------------

test('hay UNA sola construccion de provider para escrituras', () => {
  const preflight = executableCode(read('credential-registry-preflight.ts'));

  assert.match(preflight, /export function createCredentialRegistryProvider\(/);
  assert.equal((preflight.match(/new JsonRpcProvider\(/g) ?? []).length, 1);

  // Vendor-neutral: nada de proveedores con nombre propio ni WebSocket.
  for (const token of [
    'WebSocketProvider',
    'FallbackProvider',
    'AlchemyProvider',
    'InfuraProvider',
    'QuickNodeProvider',
    'AnkrProvider',
    'getDefaultProvider',
    'staticNetwork'
  ]) {
    assert.ok(!preflight.includes(token), `el preflight no debe usar ${token}`);
  }
});

test('el timeout del RPC es un valor nombrado y real', () => {
  const preflight = executableCode(read('credential-registry-preflight.ts'));

  assert.match(
    preflight,
    /export const CREDENTIAL_REGISTRY_RPC_TIMEOUT_MS = 10_000;/
  );
  // Se aplica de verdad sobre la FetchRequest, no es solo una constante.
  assert.match(preflight, /request\.timeout = CREDENTIAL_REGISTRY_RPC_TIMEOUT_MS;/);
});

test('el preflight no se construye en modo mock', () => {
  const evidence = executableCode(read('blockchain-evidence.service.ts'));

  // S8c6: el servicio de evidencia es MOCK-ONLY. Un target real no entra: se
  // rechaza y se deriva al ciclo de vida de registracion.
  assert.match(evidence, /if \(target\.evidenceMode !== 'mock'\) \{/);
  assert.match(evidence, /ciclo de vida de registracion/);

  // Y en todo el archivo no hay NADA del plano real: ni provider, ni preflight,
  // ni write client, ni rpcUrl, ni nonce.
  for (const token of [
    'createWriteClient',
    'preflight',
    'Preflight',
    'JsonRpcProvider',
    'rpcUrl',
    'NonceManager',
    'registerCredential',
    'deploymentId'
  ]) {
    assert.ok(
      !evidence.includes(token),
      `el servicio de evidencia mock no debe tocar ${token}`
    );
  }
});

// ---------------------------------------------------------------------------
// S8c6 / S8c7 / S8c10 NO EMPIEZAN ACA
// ---------------------------------------------------------------------------

test('no se inicio el rediseno de ciclo de vida de S8c6', () => {
  for (const file of targetSources()) {
    for (const token of [
      'NonceManager',
      'advisoryLock',
      'pg_advisory',
      'pendingIntent',
      'finalizeAnchor',
      'orphanRecovery',
      'BlockchainRecordStatus.pending'
    ]) {
      assert.ok(!file.code.includes(token), `${file.name}: eso es S8c6`);
    }
  }
});

test('no se implemento verificacion publica de cadena (S8c7)', () => {
  for (const file of targetSources()) {
    for (const token of [
      'blockchainEvidenceResult',
      'authenticityResult',
      'headlineResult',
      'verifyMessage'
    ]) {
      assert.ok(!file.code.includes(token), `${file.name}: eso es S8c7`);
    }
  }
});

// ---------------------------------------------------------------------------
// S8c10.1 -- los conceptos de EVIDENCIA de deployment viven SOLO en la
// herramienta de operacion, nunca como autoridad del target de runtime.
//
// SEMANTICA ANTERIOR (S8c5): ningun archivo de produccion de TODA la API podia
// contener `deploymentManifest`, `deploymentBlock` ni `bytecodeHash`
// (el guard existia para que nadie fingiera un deployment antes de S8c10).
//
// SEMANTICA ACTUAL: esas palabras siguen prohibidas en todo archivo de
// produccion SALVO un allowlist EXACTO de archivos de la herramienta de
// deployment, token por token. No es una excepcion por directorio: un archivo
// nuevo dentro de `blockchain/deployment/` que empiece a usarlas FALLA hasta que
// se lo revise y se lo agregue aca. Los nombres de deployment inventados y los
// hashes de tx escritos a mano siguen prohibidos en TODO el codigo, herramienta
// incluida.
// ---------------------------------------------------------------------------

/** token -> archivos (relativos a `src/`) donde es legitimo. */
const DEPLOYMENT_EVIDENCE_TOKEN_EXCEPTIONS: Readonly<Record<string, readonly string[]>> = {
  // El manifest y el operador nombran el bloque donde se desplego el contrato.
  deploymentBlock: [
    'blockchain/deployment/deployment-manifest.ts',
    'blockchain/deployment/deployment-operator.ts'
  ],
  // El artefacto lee el `bytecodeHash` de los settings del compilador.
  bytecodeHash: ['blockchain/deployment/deployment-artifact.ts'],
  // Nadie lo necesita: sigue prohibido en todas partes.
  deploymentManifest: []
};

const ALWAYS_FORBIDDEN_DEPLOYMENT_TOKENS = [
  'base-sepolia-prod',
  'base_sepolia_prod',
  'deployTxHash'
] as const;

function relativeToApiSrc(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  return normalized.slice(normalized.indexOf('/src/') + '/src/'.length);
}

test('no se inventa ningun deployment de Base Sepolia (S8c10)', () => {
  for (const file of productionSources()) {
    for (const token of ALWAYS_FORBIDDEN_DEPLOYMENT_TOKENS) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe fingir un deployment: eso es S8c10`
      );
    }

    for (const [token, allowedFiles] of Object.entries(DEPLOYMENT_EVIDENCE_TOKEN_EXCEPTIONS)) {
      if (allowedFiles.includes(relativeToApiSrc(file.path))) {
        continue;
      }

      assert.ok(
        !file.code.includes(token),
        `${file.name} no debe usar ${token}: la evidencia de deployment es de la herramienta de operacion (S8c10)`
      );
    }
  }
});

test('la excepcion de deployment es EXACTA: solo archivos de la herramienta, y todos existen', () => {
  const allowed = Object.values(DEPLOYMENT_EVIDENCE_TOKEN_EXCEPTIONS).flat();

  for (const path of allowed) {
    assert.ok(path.startsWith('blockchain/deployment/'), path);
    assert.ok(!path.endsWith('.test.ts'), path);
    // Si el archivo desaparece o deja de usar el token, la excepcion sobra y hay
    // que quitarla: no se acumulan permisos huerfanos.
    const code = executableCode(readFileSync(join(API_SRC_DIR, path), 'utf8'));
    const tokens = Object.entries(DEPLOYMENT_EVIDENCE_TOKEN_EXCEPTIONS)
      .filter(([, files]) => files.includes(path))
      .map(([token]) => token);
    for (const token of tokens) {
      assert.ok(code.includes(token), `${path} ya no usa ${token}: quitar la excepcion`);
    }
  }
});

test('el runtime NO usa evidencia de deployment como autoridad del target (S8c10 / S8c5)', () => {
  // Cobertura por nombre completo: `bytecodeHash` en minuscula NO alcanza a
  // `runtimeBytecodeHash` / `creationBytecodeHash` (la B es mayuscula).
  const deploymentAuthorityTokens = [
    'deploymentBlock',
    'runtimeBytecodeHash',
    'creationBytecodeHash',
    'deploymentSourceCommit',
    'deploymentTransactionHash',
    'deploymentTimestamp',
    'deployment-manifest',
    'deployment-toolchain',
    'deployment-operator',
    'target-manifest-consistency'
  ];

  const runtime = productionSources().filter(
    (file) => !relativeToApiSrc(file.path).startsWith('blockchain/deployment/')
  );
  assert.ok(runtime.length > 0);

  for (const file of runtime) {
    for (const token of deploymentAuthorityTokens) {
      assert.ok(
        !file.code.includes(token),
        `${file.name} (runtime) no debe usar ${token}: no es parte del contrato BlockchainTarget`
      );
    }
    assert.ok(
      !/from\s+'[^']*\/deployment\//.test(file.code),
      `${file.name} (runtime) no debe importar la herramienta de deployment`
    );
  }

  // Y el contrato del target sigue siendo EXACTAMENTE el de S8c5: seis variables.
  const targetSource = executableCode(read('blockchain-target.ts'));
  const fieldUnion = /export type BlockchainTargetField =([\s\S]*?);/.exec(targetSource)?.[1] ?? '';
  assert.deepEqual(
    [...fieldUnion.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]).sort(),
    [
      'BLOCKCHAIN_EVIDENCE_MODE',
      'CREDENTIAL_REGISTRY_CHAIN_ID',
      'CREDENTIAL_REGISTRY_CONTRACT_ADDRESS',
      'CREDENTIAL_REGISTRY_DEPLOYMENT_ID',
      'CREDENTIAL_REGISTRY_NETWORK',
      'CREDENTIAL_REGISTRY_RPC_URL'
    ]
  );

  // La variante real del target tiene EXACTAMENTE estos campos y ninguno de deployment.
  const realVariant = /evidenceMode: 'credential_registry';([\s\S]*?)\n {4}\};/.exec(targetSource)?.[1] ?? '';
  assert.deepEqual(
    [...realVariant.matchAll(/readonly (\w+):/g)].map((match) => match[1]),
    ['network', 'chainId', 'rpcUrl', 'contractAddress', 'deploymentId']
  );
});

test('no hay ningun manifest real de Base Sepolia commiteado todavia (S8c10)', () => {
  // Este guard se reemplaza deliberadamente en S8c10.2, cuando exista el manifest real.
  const { existsSync } = require('node:fs') as typeof import('node:fs');
  const manifestDir = join(API_SRC_DIR, '..', '..', '..', 'contracts', 'deployments');
  if (existsSync(manifestDir)) {
    const entries = readdirSync(manifestDir);
    for (const entry of entries) {
      assert.ok(
        !entry.includes('base-sepolia') && !entry.includes('base_sepolia'),
        `no deberia haber manifest de Base Sepolia todavia: ${entry}`
      );
    }
  }
});

test('el contrato Solidity no cambio', () => {
  const { existsSync } = require('node:fs') as typeof import('node:fs');
  const contractPath = join(
    API_SRC_DIR,
    '..',
    '..',
    '..',
    'contracts',
    'src',
    'CredentialRegistry.sol'
  );

  if (!existsSync(contractPath)) {
    return;
  }

  const source = readFileSync(contractPath, 'utf8');

  // S8b congelo el contrato actual: sin owner, sin allowlist, sin
  // issuerIdentifier, sin eventos nuevos.
  for (const token of [
    'issuerIdentifier',
    'onlyOwner',
    'allowlist',
    'AccessControl',
    'Ownable'
  ]) {
    assert.ok(!source.includes(token), `el contrato no debe tener ${token}`);
  }
});

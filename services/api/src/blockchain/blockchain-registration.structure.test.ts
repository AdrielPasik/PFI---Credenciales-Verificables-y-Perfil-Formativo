/**
 * Guards estructurales del ciclo de vida de registracion -- S8c6.
 *
 * Congelan lo que podria aflojarse sin que ningun test funcional se rompiera:
 * que no vuelva a entrar red ni SSM en una transaccion de Prisma, que la
 * registracion nueva no lea la clave privada legacy, que la reconciliacion no
 * escriba en la cadena, y que no aparezca un reintento a ciegas.
 *
 * Todo sobre CODIGO EJECUTABLE: la documentacion explica estas separaciones y
 * nombra los identificadores a proposito.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const BLOCKCHAIN_DIR = __dirname;
const API_SRC_DIR = join(__dirname, '..');

/** Archivos nuevos de S8c6. */
const LIFECYCLE_SOURCES = [
  'blockchain-registration.service.ts',
  'anchor-write-coordinator.ts',
  'blockchain-registration-reconciliation.service.ts',
  'credential-registry-events.ts'
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

/**
 * Cuerpo de un metodo, acotado por INDENTACION.
 *
 * Un `[\s\S]*?\n  \}` ingenuo se corta en el cierre del OBJETO DE PARAMETROS,
 * no en el del metodo, y entonces el guard mira un cuerpo vacio y pasa por
 * casualidad.
 */
function methodBody(code: string, name: string): string {
  const lines = code.split('\n');
  const start = lines.findIndex((line) =>
    new RegExp(`^  (?:private |protected |public )?(?:async )?${name}\\(`).test(
      line
    )
  );
  assert.notEqual(start, -1, `no se encontro ${name}`);

  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  (?:private |protected |public |async )/.test(lines[index])) {
      return lines.slice(start, index).join('\n');
    }
  }

  return lines.slice(start).join('\n');
}

function lifecycleSources(): Array<{ name: string; code: string }> {
  return LIFECYCLE_SOURCES.map((name) => ({
    name,
    code: executableCode(read(name))
  }));
}

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
// NI RED NI SSM DENTRO DE UNA TRANSACCION
// ---------------------------------------------------------------------------

test('las funciones que corren DENTRO de TX #1 no hacen nada de red', () => {
  const registration = executableCode(read('blockchain-registration.service.ts'));

  // Estas tres reciben un `Prisma.TransactionClient`, asi que corren adentro.
  for (const method of [
    'revalidateAnchorBinding',
    'deriveAnchorRegistrantScope',
    'createPendingIntent'
  ]) {
    const body = [methodBody(registration, method)];

    for (const forbidden of [
      'resolveAnchorSignerForIssuer',
      'signerResolver',
      'coordinator',
      'getNetwork',
      'getCode',
      'getBlock',
      'getLogs',
      'registerCredential',
      'wait(',
      'JsonRpcProvider',
      'preflight',
      'this.prisma'
    ]) {
      assert.ok(
        !body[0].includes(forbidden),
        `${method} no debe contener ${forbidden}`
      );
    }
  }
});

test('la finalizacion (TX #2) no tiene ninguna operacion de red', () => {
  const registration = executableCode(read('blockchain-registration.service.ts'));

  const finalize = [methodBody(registration, 'finalizeRegistration')];

  for (const forbidden of [
    'getNetwork',
    'getCode',
    'getBlock',
    'getLogs',
    'registerCredential',
    'coordinator',
    'signerResolver',
    'preflight',
    'wait('
  ]) {
    assert.ok(
      !finalize[0].includes(forbidden),
      `la finalizacion no debe contener ${forbidden}`
    );
  }

  // Y usa un predicado optimista estrecho, no una escritura ciega.
  assert.match(finalize[0], /updateMany\(/);
  assert.match(finalize[0], /status: BlockchainRecordStatus\.pending/);
});

test('la emision resuelve el ancla ANTES de abrir la transaccion', () => {
  const issuance = executableCode(
    readFileSync(join(API_SRC_DIR, 'credentials', 'credentials.service.ts'), 'utf8')
  );
  const body = issuance.slice(issuance.indexOf('async issueCredential('));

  const anchor = body.indexOf('prepareAnchorSigner(');
  const transaction = body.indexOf('this.prisma.$transaction(');
  const execute = body.indexOf('executeRegistration(');

  assert.ok(anchor > 0, 'no se encontro prepareAnchorSigner');
  assert.ok(transaction > 0, 'no se encontro la transaccion');
  assert.ok(execute > 0, 'no se encontro executeRegistration');

  // La resolucion -- que puede leer SSM -- precede a la transaccion, y la
  // ejecucion en la cadena viene DESPUES de que cierre.
  assert.ok(anchor < transaction, 'SSM no puede entrar en la transaccion');
  assert.ok(execute > transaction, 'la cadena se escribe despues del commit');

  // Y se resuelve UNA sola vez.
  assert.equal((body.match(/prepareAnchorSigner\(/g) ?? []).length, 1);
  assert.equal((body.match(/executeRegistration\(/g) ?? []).length, 1);
});

test('la ejecucion en cadena NO recibe el cliente de transaccion', () => {
  const registration = executableCode(read('blockchain-registration.service.ts'));

  const execute = [methodBody(registration, 'executeRegistration')];

  // Si recibiera un `TransactionClient`, la escritura on-chain volveria a
  // correr dentro de una transaccion abierta.
  assert.ok(!execute[0].includes('Prisma.TransactionClient'));
  assert.ok(!execute[0].includes('transaction:'));
});

// ---------------------------------------------------------------------------
// LA CLAVE PRIVADA LEGACY
// ---------------------------------------------------------------------------

test('la registracion NUEVA no lee CREDENTIAL_REGISTRY_PRIVATE_KEY', () => {
  for (const file of lifecycleSources()) {
    for (const forbidden of [
      'CREDENTIAL_REGISTRY_PRIVATE_KEY',
      'validateCredentialRegistryPrivateKey',
      'createRecordBoundCredentialRegistryWriteClient',
      'createCredentialRegistryWriteClientForTarget',
      'resolveCredentialRegistrySignerAddress',
      'secretRef',
      'privateKey',
      'SignerSecretStore',
      'SIGNER_SECRET_STORE',
      'SSMClient',
      'GetParameter'
    ]) {
      assert.ok(
        !file.code.includes(forbidden),
        `${file.name} no debe contener ${forbidden}`
      );
    }
  }
});

test('la clave legacy quedo SIN consumidores de runtime', () => {
  // Hasta S8c6 este guard afirmaba que la revocacion TODAVIA usaba la clave
  // global, y congelaba ese limite temporal a proposito. S8c8 hizo el cutover,
  // asi que la afirmacion se actualiza en vez de quedar probando algo que ya no
  // es cierto.
  //
  // Lo que se conserva -- y es lo que de verdad importaba -- es que un solo
  // archivo la posea.
  const owners = productionSources().filter((file) =>
    file.code.includes('CREDENTIAL_REGISTRY_PRIVATE_KEY')
  );

  assert.deepEqual(
    owners.map((file) => file.name).sort(),
    ['credential-registry-write-client.ts']
  );

  const revocation = executableCode(
    readFileSync(
      join(API_SRC_DIR, 'credentials', 'issuer-credential-revocation.service.ts'),
      'utf8'
    )
  );

  // La revocacion ya NO firma con la clave global ni con su cliente.
  assert.ok(!revocation.includes('resolveCredentialRegistrySignerAddress'));
  assert.ok(!revocation.includes('createRecordBoundCredentialRegistryWriteClient'));
  assert.ok(!revocation.includes('CREDENTIAL_REGISTRY_PRIVATE_KEY'));

  // Ahora resuelve el ANCHOR HISTORICO que el record congelo, y nunca el
  // binding vigente del issuer.
  assert.match(revocation, /record\.anchorSignerProfileId/);
  assert.match(revocation, /resolveHistoricalAnchorSigner/);
  assert.ok(!revocation.includes('resolveAnchorSignerForIssuer'));
});

// ---------------------------------------------------------------------------
// ASERCION VS ANCLAJE
// ---------------------------------------------------------------------------

test('el plano de anclaje no toca el proof ni el signer de asercion', () => {
  for (const file of lifecycleSources()) {
    for (const forbidden of [
      'CredentialProofService',
      'scope-proof-v1',
      'ScopeCredentialProof2026',
      'buildScopeProofV1',
      'resolveAssertionSignerForIssuer',
      'prepareAssertionSigner',
      'proofValue'
    ]) {
      assert.ok(
        !file.code.includes(forbidden),
        `${file.name} no debe contener ${forbidden}`
      );
    }
  }
});

test('la construccion del proof no toca el plano de anclaje', () => {
  const proof = executableCode(
    readFileSync(
      join(API_SRC_DIR, 'credentials', 'credential-proof.service.ts'),
      'utf8'
    )
  );

  for (const forbidden of [
    'resolveAnchorSignerForIssuer',
    'AnchorWriteCoordinator',
    'registerCredential',
    'NonceManager',
    'anchorSignerProfileId'
  ]) {
    assert.ok(!proof.includes(forbidden), forbidden);
  }
});

// ---------------------------------------------------------------------------
// RECONCILIACION: NI ESCRITURA NI CLAVES
// ---------------------------------------------------------------------------

test('la reconciliacion no contiene ninguna escritura a la cadena', () => {
  const reconciliation = executableCode(
    read('blockchain-registration-reconciliation.service.ts')
  );

  for (const forbidden of [
    'registerCredential',
    'revokeCredential',
    'sendTransaction',
    'AnchorWriteCoordinator',
    'NonceManager',
    'new Wallet',
    'IssuerSignerResolver'
  ]) {
    assert.ok(!reconciliation.includes(forbidden), forbidden);
  }

  // Lo que SI hace: leer logs y bloque, y finalizar en la base.
  assert.match(reconciliation, /getLogs\(/);
  assert.match(reconciliation, /getBlock\(/);
  assert.match(reconciliation, /finalizeRegistration\(/);
});

test('la busqueda de logs esta ACOTADA y el rango se inyecta', () => {
  const reconciliation = executableCode(
    read('blockchain-registration-reconciliation.service.ts')
  );
  const events = executableCode(read('credential-registry-events.ts'));

  // El rango es un parametro obligatorio: nada de fromBlock 0 ni 'earliest'.
  assert.match(reconciliation, /searchRange: CredentialRegistryLogSearchRange/);
  assert.match(events, /interface CredentialRegistryLogSearchRange/);

  for (const forbidden of [
    "fromBlock: 0",
    "'earliest'",
    '"earliest"',
    'fromBlock: undefined'
  ]) {
    assert.ok(!reconciliation.includes(forbidden), forbidden);
    assert.ok(!events.includes(forbidden), forbidden);
  }
});

// ---------------------------------------------------------------------------
// SIN REINTENTO A CIEGAS
// ---------------------------------------------------------------------------

test('no hay bucle de reintento en ninguna parte del ciclo de vida', () => {
  for (const file of lifecycleSources()) {
    for (const forbidden of [
      'retry',
      'Retry',
      'maxAttempts',
      'backoff',
      'setTimeout',
      'setInterval',
      'while (',
      'for (;;)'
    ]) {
      assert.ok(
        !file.code.includes(forbidden),
        `${file.name} no debe contener ${forbidden}`
      );
    }
  }
});

test('hay EXACTAMENTE una llamada a registerCredential en produccion', () => {
  const callers = productionSources().filter((file) =>
    /\.registerCredential\(/.test(file.code)
  );

  assert.deepEqual(
    callers.map((file) => file.name).sort(),
    [
      // El coordinador: UN intento por llamada.
      'anchor-write-coordinator.ts',
      // El cliente legacy, que la revocacion todavia usa para
      // `revokeCredential` y que conserva su metodo de registracion hasta el
      // cutover de S8c8.
      'credential-registry-write-client.ts',
      // Script de operacion PREEXISTENTE (`npm run blockchain:register`), no
      // parte del camino de emision. S8c6 no lo toca.
      'register-credential-on-registry.ts'
    ]
  );

  const coordinator = executableCode(read('anchor-write-coordinator.ts'));
  assert.equal(
    (coordinator.match(/writer\.registerCredential\(/g) ?? []).length,
    1
  );
});

// ---------------------------------------------------------------------------
// NONCE
// ---------------------------------------------------------------------------

test('NonceManager vive SOLO en la coordinacion de escrituras del ancla', () => {
  const users = productionSources().filter((file) =>
    file.code.includes('NonceManager')
  );

  assert.deepEqual(
    users.map((file) => file.name),
    ['anchor-write-coordinator.ts']
  );
});

test('la cola se indexa por SignerProfile.id, no por issuerId', () => {
  const coordinator = executableCode(read('anchor-write-coordinator.ts'));

  // Dos Issuers pueden compartir un ancla: sus escrituras TIENEN que
  // serializar juntas, asi que la clave no puede ser el issuer.
  assert.match(coordinator, /this\.enqueue\(input\.signer\.profileId/);
  assert.ok(!coordinator.includes('issuerId'));

  // La identidad del nonce -- y la del cerrojo de S8c6.1 -- incluye la cadena,
  // y se deriva en UN solo lugar.
  assert.match(
    coordinator,
    /function laneKey\(profileId: string, chainId: number\): string \{\s*return `\$\{profileId\}:\$\{chainId\}`;/
  );
  assert.match(coordinator, /laneKey\(signer\.profileId, target\.chainId\)/);
});

// ---------------------------------------------------------------------------
// S8c6.1: COMPUERTA EN EL CARRIL Y CERROJO DE AMBIGUEDAD
// ---------------------------------------------------------------------------

test('S8c6.1: la compuerta de uso de clave corre DENTRO del carril', () => {
  const coordinator = executableCode(read('anchor-write-coordinator.ts'));
  const attempt = methodBody(coordinator, 'executeSingleAttempt');

  // La compuerta se invoca en el cuerpo del intento, que es lo que `enqueue`
  // ejecuta: por lo tanto DESPUES de adquirir el carril.
  assert.match(attempt, /await input\.assertSignerUsable\(\)/);

  // Y ANTES del preflight y del envio.
  const gate = attempt.indexOf('assertSignerUsable()');
  const preflight = attempt.indexOf('assertWritable');
  const send = attempt.indexOf('registerCredential(credentialHash)');
  assert.ok(gate > -1 && preflight > gate, 'la compuerta precede al preflight');
  assert.ok(send > preflight, 'el envio va despues del preflight');

  // La orquestacion la pasa, y la lee por el perfil HISTORICO del intent sin
  // volver a resolver el binding vigente ni tocar SSM.
  const registration = executableCode(read('blockchain-registration.service.ts'));
  assert.match(
    registration,
    /assertSignerUsable: \(\) => this\.assertAnchorIntentStillUsable\(input\.signer\)/
  );
  const gateBody = methodBody(registration, 'assertAnchorIntentStillUsable');
  assert.match(gateBody, /where: \{ id: signer\.profileId \}/);
  for (const forbidden of [
    'resolveAnchorSignerForIssuer',
    'issuerTechnicalIdentity',
    'update',
    'secretRef',
    'SSMClient'
  ]) {
    assert.ok(!gateBody.includes(forbidden), forbidden);
  }

  // `retired` se permite; solo `compromised` prohibe el uso.
  assert.match(gateBody, /status === SignerProfileStatus\.compromised/);
  assert.ok(!gateBody.includes('SignerProfileStatus.retired'));
});

test('S8c6.1: un envio ambiguo no limpia el nonce y cierra el carril', () => {
  const coordinator = executableCode(read('anchor-write-coordinator.ts'));
  const attempt = methodBody(coordinator, 'executeSingleAttempt');

  // NINGUNA limpieza automatica del nonce local, en ninguna parte del archivo:
  // `reset()` haria que el siguiente envio recargue el nonce pendiente del
  // provider y continue como si el estado fuera conocido.
  assert.ok(!/\.reset\(/.test(coordinator), 'no hay .reset( en el coordinador');

  // El carril se marca INCIERTO en el catch del envio...
  // S8c8: el envio es una de las DOS operaciones, elegidas por `operation`.
  // Lo que se congela es que el cerrojo esta en el catch de ESE envio, cualquiera
  // de las dos que sea.
  assert.match(
    attempt,
    /await writer\.registerCredential\(credentialHash\)\s*:\s*await writer\.revokeCredential\(credentialHash\);\s*\} catch \(error\) \{\s*this\.uncertainLanes\.add\(lane\);/
  );

  // ...y se consulta ANTES del preflight y del envio.
  const fence = attempt.indexOf('this.uncertainLanes.has(lane)');
  assert.ok(fence > -1, 'el cerrojo se consulta');
  assert.ok(fence < attempt.indexOf('assertWritable'), 'antes del preflight');

  // Un timeout de MINADO no es ambiguedad de envio: no marca el carril.
  const unavailable = attempt.indexOf("'ANCHOR_RECEIPT_UNAVAILABLE'");
  assert.ok(unavailable > -1);
  assert.ok(
    !attempt.slice(unavailable).includes('uncertainLanes.add'),
    'el camino del receipt no cierra el carril'
  );

  // Un solo envio y ningun bucle.
  assert.equal(
    (attempt.match(/registerCredential\(credentialHash\)/g) ?? []).length,
    1
  );
  for (const forbidden of ['retry', 'backoff', 'setTimeout', 'while (', 'for (']) {
    assert.ok(!attempt.includes(forbidden), forbidden);
  }
});

test('S8c6.1: el cerrojo es de PROCESO y no tiene API de recuperacion', () => {
  const coordinator = read('anchor-write-coordinator.ts');
  const executable = executableCode(coordinator);

  // Memoria del proceso: ni tabla de nonces, ni persistencia, ni temporizador.
  assert.match(executable, /private readonly uncertainLanes = new Set<string>\(\);/);
  for (const forbidden of [
    'prisma',
    'nonceTable',
    'setInterval',
    'setTimeout',
    'Controller',
    '@Post',
    '@Get',
    'clearUncertain',
    'resetLane'
  ]) {
    assert.ok(!executable.includes(forbidden), forbidden);
  }

  // Lo unico expuesto es una LECTURA.
  assert.match(
    executable,
    /isAnchorLaneUncertain\(profileId: string, chainId: number\): boolean/
  );

  // Y la limitacion se declara explicitamente, no se deja implicita.
  assert.match(coordinator, /DE PROCESO/);
  assert.match(coordinator, /coordina replicas/);
});

// ---------------------------------------------------------------------------
// NI RELOJ DEL SERVIDOR NI PLACEHOLDERS
// ---------------------------------------------------------------------------

test('la fecha de registracion real nunca sale del reloj del servidor', () => {
  for (const file of lifecycleSources()) {
    for (const forbidden of ['new Date()', 'Date.now()']) {
      assert.ok(
        !file.code.includes(forbidden),
        `${file.name} no debe usar ${forbidden}: la fecha sale del bloque`
      );
    }
  }

  // Y sale de `block.timestamp`, convertida una sola vez.
  const coordinator = executableCode(read('anchor-write-coordinator.ts'));
  assert.match(coordinator, /toSafeUnixSeconds\(block\.timestamp\)/);
  assert.match(coordinator, /unixSecondsToDate\(seconds\)/);
});

test('no se persiste ningun placeholder de hecho de cadena', () => {
  for (const file of lifecycleSources()) {
    for (const forbidden of [
      "txHash: 'pending'",
      "txHash: ''",
      'blockNumber: 0',
      'ZeroAddress',
      "issuerAddress: ''"
    ]) {
      assert.ok(!file.code.includes(forbidden), `${file.name}: ${forbidden}`);
    }
  }
});

// ---------------------------------------------------------------------------
// SIN LOGS NUEVOS
// ---------------------------------------------------------------------------

test('el ciclo de vida no agrega logs', () => {
  for (const file of lifecycleSources()) {
    for (const token of ['console.', 'new Logger(', 'Logger.']) {
      assert.ok(!file.code.includes(token), `${file.name}: ${token}`);
    }
  }
});

test('los errores del ciclo de vida tienen mensajes fijos', () => {
  for (const name of [
    'blockchain-registration.service.ts',
    'anchor-write-coordinator.ts'
  ] as const) {
    const code = executableCode(read(name));

    assert.match(code, /const SAFE_MESSAGES: Record</, name);
    assert.match(code, /super\(SAFE_MESSAGES\[code\]\)/, name);
  }

  // El coordinador conserva SOLO la clase del error del provider.
  const coordinator = executableCode(read('anchor-write-coordinator.ts'));
  assert.match(coordinator, /providerErrorName: errorName\(error\)/);
  assert.ok(!coordinator.includes('.message'));
  assert.ok(!coordinator.includes('String(error)'));
  assert.ok(!coordinator.includes('JSON.stringify(error)'));
});

// ---------------------------------------------------------------------------
// S8c7 / S8c8 / S8c9 / S8c10 NO EMPIEZAN ACA
// ---------------------------------------------------------------------------

test('no se implementa semantica publica de verificacion (S8c7)', () => {
  for (const file of lifecycleSources()) {
    for (const forbidden of [
      'blockchainEvidenceResult',
      'authenticityResult',
      'headlineResult',
      'verifyMessage'
    ]) {
      assert.ok(!file.code.includes(forbidden), `${file.name}: es S8c7`);
    }
  }
});

test('no se implementa resolucion de signer historico (S8c8)', () => {
  for (const file of lifecycleSources()) {
    for (const forbidden of [
      'resolveHistoricalSigner',
      'AssertionKeyHistory',
      'anchorKeyHistory'
    ]) {
      assert.ok(!file.code.includes(forbidden), `${file.name}: es S8c8`);
    }
  }
});

test('no se toca readyToIssue (S8c9) ni se inventa un deployment (S8c10)', () => {
  for (const file of lifecycleSources()) {
    // La lista de tipos habilitados por issuer que agrego S8c1 NO figura aca, y
    // su nombre no se escribe en este archivo a proposito: S8c1 ya tiene un
    // guard propio que afirma que ese identificador no aparece en NINGUN .ts
    // de src/, lo cual es estrictamente mas fuerte. Repetirlo -- incluso como
    // token PROHIBIDO -- hacia que aquel guard, que busca texto crudo, lo
    // tomara por un lector real.
    for (const forbidden of [
      'readyToIssue',
      'deploymentManifest',
      'deployTxHash',
      'deploymentBlock',
      'bytecodeHash'
    ]) {
      assert.ok(!file.code.includes(forbidden), `${file.name}: ${forbidden}`);
    }
  }
});

test('no se introduce ninguna variable de entorno con direccion de signer', () => {
  for (const file of productionSources()) {
    for (const forbidden of [
      'CREDENTIAL_REGISTRY_SIGNER_ADDRESS',
      'EXPECTED_ANCHOR_ADDRESS',
      'ANCHOR_WALLET_ADDRESS',
      'EXPECTED_SIGNER_ADDRESS'
    ]) {
      assert.ok(!file.code.includes(forbidden), `${file.name}: ${forbidden}`);
    }
  }
});

test('el evento adoptado es el REAL del contrato, sin campos inventados', () => {
  const events = executableCode(read('credential-registry-events.ts'));

  // Firma copiada del contrato: bytes32 indexed credentialHash, address
  // indexed issuer, uint256 registeredAt.
  assert.match(
    events,
    /event CredentialRegistered\(bytes32 indexed credentialHash, address indexed issuer, uint256 registeredAt\)/
  );

  const contract = readFileSync(
    join(API_SRC_DIR, '..', '..', '..', 'contracts', 'src', 'CredentialRegistry.sol'),
    'utf8'
  );
  assert.match(contract, /event CredentialRegistered\(/);
  assert.match(contract, /bytes32 indexed credentialHash/);
  assert.match(contract, /address indexed issuer/);
  assert.match(contract, /uint256 registeredAt/);

  // Y el contrato NO cambio.
  for (const forbidden of ['onlyOwner', 'allowlist', 'issuerIdentifier']) {
    assert.ok(!contract.includes(forbidden), forbidden);
  }
});

// ---------------------------------------------------------------------------
// LIMITE MULTI-REPLICA -- DOCUMENTADO, NO RESUELTO
// ---------------------------------------------------------------------------

test('la realidad operativa actual: un escritor activo, pero deploy rolling', () => {
  // La cola y el NonceManager viven EN ESTE PROCESO. Protegen un solo proceso
  // Node.js. Este test congela la configuracion que hace que esa proteccion
  // alcance HOY -- y tambien la que puede violarla.
  const terraform = readFileSync(
    join(API_SRC_DIR, '..', '..', '..', 'infra', 'terraform', 'prod', 'variables.tf'),
    'utf8'
  );
  const ecs = readFileSync(
    join(API_SRC_DIR, '..', '..', '..', 'infra', 'terraform', 'prod', 'ecs.tf'),
    'utf8'
  );

  // UNA task de API en regimen, sin autoscaling: un solo escritor activo.
  const desired = /variable "api_desired_count" \{[\s\S]*?\n\}/.exec(terraform);
  assert.ok(desired, 'no se encontro api_desired_count');
  assert.match(desired[0], /default\s+=\s+1/);
  assert.ok(!ecs.includes('aws_appautoscaling'));

  // PERO el despliegue permite 200%: durante un rolling deploy conviven DOS
  // tasks, y en esa ventana la serializacion en proceso NO coordina entre
  // ellas. No es seguridad de nonce distribuida y no se la presenta como tal.
  assert.match(ecs, /deployment_maximum_percent\s+=\s+200/);
});

test('no se agrego un lock de base de datos alrededor del I/O de cadena', () => {
  // Un advisory lock de PostgreSQL abarcando el mineo recrearia exactamente el
  // acoplamiento largo que esta slice elimina. El endurecimiento distribuido
  // queda pendiente, no resuelto a escondidas.
  for (const file of lifecycleSources()) {
    for (const forbidden of [
      'pg_advisory',
      'advisoryLock',
      'FOR UPDATE',
      '$queryRaw',
      '$executeRaw'
    ]) {
      assert.ok(!file.code.includes(forbidden), `${file.name}: ${forbidden}`);
    }
  }
});

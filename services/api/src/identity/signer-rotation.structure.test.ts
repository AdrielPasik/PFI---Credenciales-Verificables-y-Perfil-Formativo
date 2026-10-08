/**
 * Guards ESTRUCTURALES de rotacion e historia de claves -- S8c8.
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
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const API_SRC_DIR = join(__dirname, '..');

function read(...segments: string[]): string {
  return readFileSync(join(API_SRC_DIR, ...segments), 'utf8');
}

/** Codigo ejecutable: sin comentarios de bloque ni de linea. */
function executableCode(contents: string): string {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

/** Todas las fuentes de produccion de la API. */
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

const ROTATION_SOURCES = [
  join('identity', 'signer-rotation.service.ts'),
  join('identity', 'signer-rotation.error.ts')
] as const;

// ---------------------------------------------------------------------------
// LA ROTACION NO TOCA SECRETOS NI RED
// ---------------------------------------------------------------------------

test('la rotacion NO lee secretos, ni construye Wallets, ni toca la red', () => {
  // Es lo que hace posible la RECUPERACION: se puede rotar lejos de una clave
  // comprometida sin tener que usarla.
  const forbidden = [
    'IssuerSignerResolver',
    'resolveAssertionSignerForIssuer',
    'resolveAnchorSignerForIssuer',
    'resolveHistoricalAnchorSigner',
    'SignerSecretStore',
    'SSMClient',
    'GetParameter',
    'PutParameter',
    'DeleteParameter',
    'WithDecryption',
    'secretRef',
    'privateKey',
    'new Wallet',
    'JsonRpcProvider',
    'getNetwork',
    'getCode',
    'fetch(',
    'CREDENTIAL_REGISTRY_PRIVATE_KEY'
  ];

  for (const source of ROTATION_SOURCES) {
    const code = executableCode(read(source));

    for (const token of forbidden) {
      assert.ok(!code.includes(token), `${source} no debe contener ${token}`);
    }
  }
});

test('la rotacion NO genera claves ni muta el almacen de secretos', () => {
  const code = executableCode(read(join('identity', 'signer-rotation.service.ts')));

  for (const token of [
    'randomBytes',
    'createRandom',
    'generateKey',
    'Mnemonic',
    'HDNodeWallet',
    'SigningKey'
  ]) {
    assert.ok(!code.includes(token), `no debe generar claves: ${token}`);
  }
});

// ---------------------------------------------------------------------------
// IDENTIDAD DE CLAVE INMUTABLE
// ---------------------------------------------------------------------------

test('la rotacion solo escribe campos de CICLO DE VIDA', () => {
  // `SignerProfile` ES la identidad de la clave. Cambiar `secretRef`, la
  // direccion, el material publico, `keyVersion`, el proposito o la custodia
  // dejaria las credentials firmadas con ese perfil apuntando a un fragmento
  // cuya clave publica ya no corresponde.
  const code = executableCode(read(join('identity', 'signer-rotation.service.ts')));

  const updates = [
    ...code.matchAll(/signerProfile\.update\(\{[\s\S]*?data: \{([\s\S]*?)\}/g)
  ].map((match) => match[1]);

  assert.ok(updates.length > 0, 'hay al menos una transicion de estado');

  for (const update of updates) {
    const fields = [...update.matchAll(/(\w+):/g)].map((match) => match[1]);
    assert.deepEqual(
      fields.sort(),
      ['retiredAt', 'status'],
      `solo status y retiredAt: ${update.trim()}`
    );
  }
});

test('la rotacion no borra historia ni perfiles', () => {
  const code = executableCode(read(join('identity', 'signer-rotation.service.ts')));

  for (const token of [
    'signerProfile.delete',
    'issuerAssertionKeyBinding.delete',
    'issuerAssertionKeyBinding.deleteMany',
    'issuerAssertionKeyBinding.update',
    'issuerTechnicalIdentity.delete',
    'credential.update',
    'blockchainRecord.update'
  ]) {
    assert.ok(!code.includes(token), `append-only: no debe contener ${token}`);
  }

  // La historia solo CRECE.
  assert.match(code, /issuerAssertionKeyBinding\.create\(/);
  assert.equal(
    (code.match(/issuerAssertionKeyBinding\.create\(/g) ?? []).length,
    1
  );
});

test('un compromiso NUNCA se reescribe como jubilacion', () => {
  const code = executableCode(read(join('identity', 'signer-rotation.service.ts')));

  // La transicion a `retired` esta guardada por "estaba activo".
  assert.match(
    code,
    /if \(current\.status !== SignerProfileStatus\.active\) \{\s*return current\.status;\s*\}/
  );
  // Y no existe ninguna asignacion que pise `compromised`.
  assert.ok(!code.includes('status: SignerProfileStatus.compromised'));
  assert.ok(!code.includes('status: SignerProfileStatus.active'));
});

// ---------------------------------------------------------------------------
// LAS DOS TRANSACCIONES SON SERIALIZABLE Y NO CRUZAN RED
// ---------------------------------------------------------------------------

test('las dos rotaciones corren en Serializable', () => {
  const code = executableCode(read(join('identity', 'signer-rotation.service.ts')));

  assert.equal(
    (
      code.match(
        /isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/g
      ) ?? []
    ).length,
    2
  );
});

test('el puntero se mueve con predicado optimista', () => {
  const code = executableCode(read(join('identity', 'signer-rotation.service.ts')));

  // Dos rotaciones concurrentes no pueden producir dos sucesores.
  assert.match(code, /assertionSignerProfileId: current\.id/);
  assert.match(code, /anchorSignerProfileId: current\.id/);
  assert.equal((code.match(/moved\.count !== 1/g) ?? []).length, 2);
  assert.match(code, /ROTATION_CONFLICT/);
});

// ---------------------------------------------------------------------------
// HISTORIA SIN SECRETOS, Y SIN TABLA DE ANCHOR
// ---------------------------------------------------------------------------

test('el modelo de historia no declara ningun campo secreto', () => {
  const schema = readFileSync(
    join(API_SRC_DIR, '..', 'prisma', 'schema.prisma'),
    'utf8'
  );
  const model = /model IssuerAssertionKeyBinding \{([\s\S]*?)\n\}/.exec(schema);
  assert.ok(model, 'no se encontro el modelo');

  for (const token of [
    'secretRef',
    'privateKey',
    'publicKey',
    'address',
    'status',
    'keyVersion',
    'custody'
  ]) {
    assert.ok(
      !model[1].includes(token),
      `SignerProfile es la autoridad: la historia no debe duplicar ${token}`
    );
  }
});

test('NO existe una tabla de historia de ANCHOR', () => {
  const schema = readFileSync(
    join(API_SRC_DIR, '..', 'prisma', 'schema.prisma'),
    'utf8'
  );

  for (const token of [
    'model IssuerAnchorKeyBinding',
    'model IssuerAnchorKeyHistory',
    'anchorKeyBindings'
  ]) {
    assert.ok(!schema.includes(token), `no debe existir ${token}`);
  }

  // La historia del anchor es la fila de S8c6, y sigue ahi.
  assert.match(schema, /anchorSignerProfileId\s+String\?/);
});

test('los dos punteros VIGENTES siguen existiendo', () => {
  const schema = readFileSync(
    join(API_SRC_DIR, '..', 'prisma', 'schema.prisma'),
    'utf8'
  );
  const identity = /model IssuerTechnicalIdentity \{([\s\S]*?)\n\}/.exec(schema);
  assert.ok(identity);

  assert.match(identity[1], /assertionSignerProfileId String\s+@unique/);
  assert.match(identity[1], /anchorSignerProfileId\s+String/);
});

// ---------------------------------------------------------------------------
// EL DID PUBLICA LA HISTORIA
// ---------------------------------------------------------------------------

test('el resolver del DID lee la historia y filtra por estado', () => {
  const code = executableCode(
    read(join('identity', 'issuer-did-document.resolver.ts'))
  );

  assert.match(code, /assertionKeyBindings/);
  // Publica todo lo que NO este comprometido...
  assert.match(code, /status !== SignerProfileStatus\.compromised/);
  // ...y ordena de forma determinista por version.
  assert.match(code, /sort\(\(left, right\) => left\.keyVersion - right\.keyVersion\)/);

  // La clave VIGENTE sigue siendo la del puntero, no la de version maxima.
  assert.match(code, /assertionSignerProfileId: true/);
  for (const token of ['Math.max', 'keyVersion >', 'at(-1)', 'pop()']) {
    assert.ok(
      !code.includes(token),
      `la vigente no se deriva de la version: ${token}`
    );
  }
});

test('el resolver del DID no toca secretos ni la red', () => {
  const code = executableCode(
    read(join('identity', 'issuer-did-document.resolver.ts'))
  );

  for (const token of [
    'secretRef',
    'privateKey',
    'SSMClient',
    'IssuerSignerResolver',
    'new Wallet',
    'fetch(',
    'JsonRpcProvider'
  ]) {
    assert.ok(!code.includes(token), token);
  }
});

// ---------------------------------------------------------------------------
// EL VERIFICADOR NO CONSULTA EL PERFIL VIGENTE
// ---------------------------------------------------------------------------

test('el verificador de S8c7 sigue decidiendo por el DID, no por el perfil', () => {
  const code = executableCode(
    read(join('verification', 'credential-authenticity.verifier.ts'))
  );

  for (const token of [
    'SignerProfile',
    'signerProfile',
    'assertionSignerProfileId',
    'IssuerAssertionKeyBinding',
    'assertionKeyBindings'
  ]) {
    assert.ok(
      !code.includes(token),
      `la autenticidad se verifica contra el DID publicado, no contra ${token}`
    );
  }
});

// ---------------------------------------------------------------------------
// LA REVOCACION USA EL ANCHOR HISTORICO
// ---------------------------------------------------------------------------

test('la revocacion resuelve el anchor del RECORD, no el vigente del issuer', () => {
  const code = executableCode(
    read(join('credentials', 'issuer-credential-revocation.service.ts'))
  );

  // La procedencia es el record.
  assert.match(code, /record\.anchorSignerProfileId/);
  assert.match(code, /resolveHistoricalAnchorSigner\(/);

  // Y nunca el binding vigente ni ninguna otra identidad.
  for (const token of [
    'issuerTechnicalIdentity',
    'resolveAnchorSignerForIssuer',
    'resolveAssertionSignerForIssuer',
    'walletAddress',
    'CREDENTIAL_REGISTRY_PRIVATE_KEY',
    'resolveCredentialRegistrySignerAddress',
    'createRecordBoundCredentialRegistryWriteClient'
  ]) {
    assert.ok(!code.includes(token), `la revocacion no debe usar ${token}`);
  }
});

test('la revocacion usa el MISMO coordinador que la registracion', () => {
  const code = executableCode(
    read(join('credentials', 'issuer-credential-revocation.service.ts'))
  );

  assert.match(code, /AnchorWriteCoordinator/);
  assert.match(code, /this\.anchorWriteCoordinator\.revokeCredentialHash\(/);

  // Y no se crea una segunda cola, ni un segundo NonceManager, ni un mutex.
  for (const token of [
    'NonceManager',
    'new Map',
    'Mutex',
    'queue',
    'uncertainLanes',
    'enqueue'
  ]) {
    assert.ok(!code.includes(token), `no debe duplicar coordinacion: ${token}`);
  }
});

test('la revocacion falla cerrado con mas de una fila y sin anchor historico', () => {
  const code = executableCode(
    read(join('credentials', 'issuer-credential-revocation.service.ts'))
  );

  assert.match(code, /blockchainRecords\.length > 1/);
  assert.match(code, /BLOCKCHAIN_RECORD_AMBIGUOUS/);
  assert.match(code, /HISTORICAL_ANCHOR_UNRESOLVED/);
  assert.match(code, /HISTORICAL_ANCHOR_COMPROMISED/);

  // Sin cronologia inventada.
  for (const token of ['orderBy', 'take:', 'createdAt', 'sort(']) {
    assert.ok(!code.includes(token), `no debe elegir una fila: ${token}`);
  }
});

test('la revocacion no fabrica el timestamp de revocacion', () => {
  const code = executableCode(
    read(join('credentials', 'issuer-credential-revocation.service.ts'))
  );

  for (const token of ['new Date()', 'Date.now()']) {
    assert.ok(
      !code.includes(token),
      `la fecha sale del contrato, no del reloj: ${token}`
    );
  }

  assert.match(code, /chainTimestampToDate\(reconciliation\.chainRevokedAt\)/);
});

test('ninguna transaccion de base de datos abarca SSM, RPC ni minado', () => {
  const code = executableCode(
    read(join('credentials', 'issuer-credential-revocation.service.ts'))
  );

  const transaction = /\$transaction\(async \(transaction\) => \{([\s\S]*?)\n      \}\);/.exec(
    code
  );
  assert.ok(transaction, 'no se encontro la transaccion de persistencia');

  for (const token of [
    'revokeCredentialHash',
    'resolveHistoricalAnchorSigner',
    'readCredentialStateOnProvider',
    'classify',
    'getCredentialStatus',
    'await this.signerResolver',
    'await this.anchorWriteCoordinator'
  ]) {
    assert.ok(
      !transaction[1].includes(token),
      `la transaccion no debe contener ${token}`
    );
  }
});

// ---------------------------------------------------------------------------
// C1-C4: LA CLAVE GLOBAL LEGACY NO TIENE CONSUMIDORES DE RUNTIME
// ---------------------------------------------------------------------------

test('C1-C4: CREDENTIAL_REGISTRY_PRIVATE_KEY solo vive en el cliente legacy', () => {
  // La afirmacion honesta NO es "ya no existe en el repositorio": existe, y la
  // herramienta de operacion la sigue usando. Lo que S8c8 consigue es que
  // NINGUN camino de runtime de la aplicacion Nest la lea.
  const RUNTIME_ALLOWLIST = ['credential-registry-write-client.ts'];
  const offenders: string[] = [];

  for (const file of productionSources()) {
    if (!file.code.includes('CREDENTIAL_REGISTRY_PRIVATE_KEY')) {
      continue;
    }

    if (!RUNTIME_ALLOWLIST.includes(file.name)) {
      offenders.push(file.name);
    }
  }

  assert.deepEqual(offenders, []);
});

test('C2: ni la registracion ni la revocacion leen la clave global', () => {
  const lifecycle = [
    join('blockchain', 'blockchain-registration.service.ts'),
    join('blockchain', 'anchor-write-coordinator.ts'),
    join('blockchain', 'blockchain-registration-reconciliation.service.ts'),
    join('credentials', 'credentials.service.ts'),
    join('credentials', 'issuer-credential-revocation.service.ts'),
    join('credentials', 'credential-proof.service.ts'),
    join('identity', 'signer-rotation.service.ts'),
    join('identity', 'issuer-did-document.resolver.ts'),
    join('verification', 'verification.service.ts')
  ];

  for (const source of lifecycle) {
    const code = executableCode(read(source));

    for (const token of [
      'CREDENTIAL_REGISTRY_PRIVATE_KEY',
      'resolveCredentialRegistrySignerAddress',
      'createRecordBoundCredentialRegistryWriteClient',
      'createCredentialRegistryWriteClientForTarget',
      'validateCredentialRegistryPrivateKey'
    ]) {
      assert.ok(!code.includes(token), `${source} no debe contener ${token}`);
    }
  }
});

test('C4: ningun controller, modulo o servicio instancia el signer global', () => {
  const offenders: string[] = [];

  for (const file of productionSources()) {
    const isRuntimeWiring =
      file.name.endsWith('.controller.ts') ||
      file.name.endsWith('.module.ts') ||
      file.name.endsWith('.service.ts');

    if (!isRuntimeWiring) {
      continue;
    }

    for (const token of [
      'CredentialRegistryWriteClient',
      'createCredentialRegistryWriteClientForTarget',
      'createRecordBoundCredentialRegistryWriteClient',
      'resolveCredentialRegistrySignerAddress'
    ]) {
      if (file.code.includes(token)) {
        offenders.push(`${file.name}:${token}`);
      }
    }
  }

  // `blockchain.module.ts` todavia PROVEE la clase para el script de
  // operacion, pero ningun servicio ni controller la usa para firmar.
  assert.deepEqual(
    offenders.filter((entry) => !entry.startsWith('blockchain.module.ts')),
    []
  );
});

test('la herramienta de operacion sigue siendo el unico usuario legitimo', () => {
  const script = read(
    join('blockchain', 'scripts', 'register-credential-on-registry.ts')
  );

  // Existe y sigue usando el camino legacy a proposito: S8c10 decide su
  // limpieza final de tooling/deployment.
  assert.match(script, /createCredentialRegistryWriteClientForTarget|CredentialRegistryWriteClient/);
});

// ---------------------------------------------------------------------------
// NO SE IMPLEMENTA TRABAJO DE OTRAS SLICES
// ---------------------------------------------------------------------------

test('S8c8 no expone ninguna superficie publica de rotacion', () => {
  const offenders: string[] = [];

  for (const file of productionSources()) {
    if (!/rotat/i.test(file.code)) {
      continue;
    }

    for (const token of ['@Post(', '@Put(', '@Patch(', '@Delete(', '@Get(']) {
      if (file.code.includes(token) && file.code.includes('rotate')) {
        offenders.push(`${file.name}:${token}`);
      }
    }
  }

  assert.deepEqual(offenders, []);

  // Y el modulo de identidad no registra ningun controller nuevo.
  const module = executableCode(read(join('identity', 'identity.module.ts')));
  assert.match(module, /controllers: \[DidController, IssuerDidController\]/);
  assert.match(module, /SignerRotationService/);
});

test('no se toca readyToIssue ni el provisioning operativo (S8c9)', () => {
  for (const source of ROTATION_SOURCES) {
    const code = executableCode(read(source));

    for (const token of [
      'readyToIssue',
      'authorizationStatus',
      'IssuerMembership',
      'PlatformAdmin',
      'onboarding'
    ]) {
      assert.ok(!code.includes(token), `${source}: ${token} no es S8c8`);
    }
  }
});

test('no se agrega ninguna variable de entorno nueva', () => {
  for (const source of ROTATION_SOURCES) {
    const code = executableCode(read(source));
    assert.ok(!code.includes('process.env'), `${source} no debe leer el entorno`);
  }
});

test('la rotacion no loguea', () => {
  for (const source of ROTATION_SOURCES) {
    const code = executableCode(read(source));

    for (const token of ['console.', 'new Logger(', 'Logger.']) {
      assert.ok(!code.includes(token), `${source}: ${token}`);
    }
  }
});

test('los errores de rotacion son literales fijos sin interpolacion', () => {
  const raw = read(join('identity', 'signer-rotation.error.ts'));
  // Sobre el codigo EJECUTABLE: el comentario de cabecera nombra a proposito lo
  // que el mensaje no puede contener.
  const code = executableCode(raw);

  assert.ok(!code.includes('`${'));
  assert.match(code, /const SAFE_MESSAGES: Record<SignerRotationErrorCode, string>/);

  for (const token of ['secretRef', 'privateKey', 'address']) {
    assert.ok(!code.includes(token), token);
  }
});

// ---------------------------------------------------------------------------
// LA EMISION NUEVA NO ACEPTA UNA CLAVE HISTORICA
// ---------------------------------------------------------------------------

test('la emision revalida el PUNTERO VIGENTE dentro de su transaccion', () => {
  const proof = executableCode(
    read(join('credentials', 'credential-proof.service.ts'))
  );

  assert.match(proof, /revalidateAssertionBinding/);
  assert.match(proof, /assertionSignerProfileId !== input\.signer\.profileId/);
  assert.match(proof, /status !== SignerProfileStatus\.active/);

  // Sin SSM, sin resolver y sin clave privada DENTRO de la revalidacion. El
  // archivo si resuelve el signer -- en `prepareAssertionSigner`, antes de la
  // transaccion -- y eso es exactamente lo correcto; lo que no puede pasar es
  // que la revalidacion vuelva a hacerlo.
  const revalidation = proof.slice(proof.indexOf('revalidateAssertionBinding'));
  for (const token of [
    'resolveAssertionSignerForIssuer',
    'SignerSecretStore',
    'SSMClient',
    'secretRef',
    'getPrivateKey'
  ]) {
    assert.ok(!revalidation.includes(token), token);
  }

  // Y la emision la invoca.
  const credentials = executableCode(
    read(join('credentials', 'credentials.service.ts'))
  );
  assert.match(
    credentials,
    /this\.credentialProofService\.revalidateAssertionBinding\(/
  );
});

test('una clave historica retirada NO es aceptable para emitir', () => {
  const proof = executableCode(
    read(join('credentials', 'credential-proof.service.ts'))
  );

  // La revalidacion exige `active`: publicar una clave para verificar lo que
  // firmo no es lo mismo que autorizarla a firmar algo nuevo.
  assert.ok(!proof.includes('SignerProfileStatus.retired'));
  assert.match(proof, /SignerProfileStatus\.active/);
});

/**
 * Guards estructurales del modulo de firma -- S8c2.
 *
 * S8c2 construye el camino de CUSTODIA y RESOLUCION. No firma, no habla con
 * ninguna red y no reemplaza todavia al signer global legacy. Estos guards
 * congelan esas tres cosas, porque son exactamente las que se podrian filtrar
 * sin que ningun test funcional se rompiera.
 *
 * Alcance acotado a `src/signing/`: no es un grep del repo entero, que fallaria
 * con documentacion y tests historicos legitimos.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';

import { createSignerSecretStoreFromEnv } from './signer-secret-store.factory';

const SIGNING_DIR = __dirname;
const API_SRC_DIR = join(__dirname, '..');

/** Solo fuentes de PRODUCCION del modulo: sin tests, sin fixtures. */
function productionSources(): Array<{ name: string; contents: string }> {
  return readdirSync(SIGNING_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts')
    )
    .map((entry) => ({
      name: entry.name,
      contents: readFileSync(join(SIGNING_DIR, entry.name), 'utf8')
    }));
}

/** Codigo ejecutable: sin comentarios de linea ni de bloque. */
function executableCode(contents: string): string {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

test('el modulo tiene exactamente los archivos de produccion esperados', () => {
  assert.deepEqual(
    productionSources()
      .map((file) => file.name)
      .sort(),
    [
      'aws-ssm-signer-secret-store.ts',
      'issuer-signer-resolver.ts',
      'signer-resolution.error.ts',
      'signer-secret-store.factory.ts',
      'signer-secret-store.port.ts',
      'signing.module.ts'
    ]
  );
});

// ---------------------------------------------------------------------------
// NI PROVIDER, NI RPC, NI FIRMA
// ---------------------------------------------------------------------------

test('29: ninguna fuente de produccion construye un provider ni envia nada a una red', () => {
  const forbidden = [
    'JsonRpcProvider',
    'WebSocketProvider',
    'FallbackProvider',
    'BrowserProvider',
    'AlchemyProvider',
    'InfuraProvider',
    'getDefaultProvider',
    'new Contract',
    'ContractFactory',
    '.connect(',
    'sendTransaction',
    'broadcastTransaction',
    'signTransaction',
    'signMessage',
    'signTypedData',
    'populateTransaction',
    'estimateGas',
    'getFeeData'
  ];

  for (const file of productionSources()) {
    const code = executableCode(file.contents);
    for (const token of forbidden) {
      assert.ok(
        !code.includes(token),
        `${file.name} no debe contener ${token}`
      );
    }
  }
});

test('la unica dependencia de ethers son primitivas locales de clave y direccion', () => {
  const imports: string[] = [];

  for (const file of productionSources()) {
    const match = /import \{([^}]*)\} from 'ethers';/.exec(file.contents);
    if (match) {
      imports.push(
        ...match[1]
          .split(',')
          .map((name) => name.trim())
          .filter((name) => name.length > 0)
      );
    }
  }

  // `Wallet` desconectada, mas normalizacion de direcciones. Nada de red.
  assert.deepEqual([...new Set(imports)].sort(), [
    'Wallet',
    'getAddress',
    'isAddress'
  ]);
});

test('la Wallet se construye SIEMPRE con un solo argumento, sin provider', () => {
  const resolver = executableCode(
    readFileSync(join(SIGNING_DIR, 'issuer-signer-resolver.ts'), 'utf8')
  );

  const constructions = [...resolver.matchAll(/new Wallet\(([^)]*)\)/g)].map(
    (match) => match[1].trim()
  );

  assert.deepEqual(constructions, ['privateKey']);
  assert.ok(!resolver.includes('new Wallet(privateKey,'));
});

// ---------------------------------------------------------------------------
// CUSTODIA READ-ONLY
// ---------------------------------------------------------------------------

test('el adaptador SSM no importa ninguna capacidad de escritura ni de enumeracion', () => {
  const store = readFileSync(
    join(SIGNING_DIR, 'aws-ssm-signer-secret-store.ts'),
    'utf8'
  );
  const code = executableCode(store);

  for (const token of [
    'PutParameterCommand',
    'DeleteParameterCommand',
    'DeleteParametersCommand',
    'GetParametersByPathCommand',
    'DescribeParametersCommand',
    'LabelParameterVersionCommand',
    'GetParametersCommand'
  ]) {
    assert.ok(!code.includes(token), `no debe usar ${token}`);
  }

  // Un solo comando importado, y es el de lectura exacta.
  const match = /import \{([^}]*)\} from '@aws-sdk\/client-ssm';/.exec(store);
  assert.ok(match, 'no se encontro el import del SDK');
  const imported = match[1]
    .split(',')
    .map((name) => name.trim().replace(/^type /, ''))
    .filter((name) => name.length > 0)
    .sort();
  assert.deepEqual(imported, ['GetParameterCommand', 'SSMClient']);
});

test('el adaptador siempre descifra: WithDecryption en true, literal', () => {
  const code = executableCode(
    readFileSync(join(SIGNING_DIR, 'aws-ssm-signer-secret-store.ts'), 'utf8')
  );

  assert.match(code, /WithDecryption:\s*true/);
  assert.ok(!code.includes('WithDecryption: false'));
});

test('ninguna fuente lee credenciales estaticas de AWS', () => {
  for (const file of productionSources()) {
    const code = executableCode(file.contents);
    assert.ok(
      !code.includes('AWS_ACCESS_KEY_ID'),
      `${file.name} no debe leer AWS_ACCESS_KEY_ID`
    );
    assert.ok(
      !code.includes('AWS_SECRET_ACCESS_KEY'),
      `${file.name} no debe leer AWS_SECRET_ACCESS_KEY`
    );
    assert.ok(!code.includes('AWS_SESSION_TOKEN'), file.name);
    assert.ok(!code.includes('credentials:'), file.name);
  }
});

// ---------------------------------------------------------------------------
// NO FILTRACION
// ---------------------------------------------------------------------------

test('ninguna fuente de produccion loguea', () => {
  for (const file of productionSources()) {
    const code = executableCode(file.contents);

    for (const token of ['console.', 'new Logger(', 'Logger.', 'process.stdout']) {
      assert.ok(
        !code.includes(token),
        `${file.name} no debe contener ${token}: no hay necesidad operativa de un log aca`
      );
    }
  }
});

test('la clave en crudo no se retiene en ningun campo ni se serializa', () => {
  for (const file of productionSources()) {
    const code = executableCode(file.contents);

    // Nunca se guarda en el objeto.
    assert.doesNotMatch(code, /this\.privateKey/, file.name);
    assert.doesNotMatch(code, /this\.rawKey/, file.name);
    assert.doesNotMatch(code, /this\.secret\b/, file.name);
    // Nunca se serializa.
    assert.doesNotMatch(code, /JSON\.stringify\s*\(\s*privateKey/, file.name);
    // Nunca se interpola en un mensaje.
    assert.doesNotMatch(code, /\$\{privateKey\}/, file.name);
    assert.doesNotMatch(code, /\$\{secretRef\}/, file.name);
  }
});

test('la cache guarda la Wallet, nunca la cadena de la clave', () => {
  const resolver = readFileSync(
    join(SIGNING_DIR, 'issuer-signer-resolver.ts'),
    'utf8'
  );

  const entry = /interface SignerCacheEntry \{([\s\S]*?)\n\}/.exec(resolver);
  assert.ok(entry, 'no se encontro SignerCacheEntry');

  const fields = [...entry[1].matchAll(/readonly (\w+):/g)].map((m) => m[1]);

  // `secretRef` SI vive en la entrada privada: es parte de su identidad de
  // configuracion, y es metadata de infraestructura, no material secreto.
  assert.deepEqual(fields.sort(), [
    'address',
    'expiresAt',
    'keyVersion',
    'profileId',
    'purpose',
    'secretRef',
    'wallet'
  ]);

  // Lo que NUNCA puede estar es la clave en crudo o la respuesta de SSM.
  for (const forbidden of [
    'privateKey',
    'rawKey',
    'privateJwk',
    'Parameter',
    'ssmResponse'
  ]) {
    assert.ok(
      !entry[1].includes(forbidden),
      `SignerCacheEntry no debe llevar ${forbidden}`
    );
  }
});

test('secretRef vive SOLO en la entrada privada de cache, nunca en el signer resuelto', () => {
  const resolver = readFileSync(
    join(SIGNING_DIR, 'issuer-signer-resolver.ts'),
    'utf8'
  );

  const resolved = /export interface ResolvedIssuerSigner \{([\s\S]*?)\n\}/.exec(
    resolver
  );
  assert.ok(resolved, 'no se encontro ResolvedIssuerSigner');
  assert.ok(!resolved[1].includes('secretRef'));

  // Y el mapeo a la estructura devuelta no lo copia.
  const mapper = /function toResolvedSigner\(([\s\S]*?)\n\}/.exec(resolver);
  assert.ok(mapper, 'no se encontro toResolvedSigner');
  assert.ok(!mapper[1].includes('secretRef'));
  assert.ok(!mapper[1].includes('privateKey'));
});

test('hay UNA sola implementacion de consistencia criptografica', () => {
  const resolver = executableCode(
    readFileSync(join(SIGNING_DIR, 'issuer-signer-resolver.ts'), 'utf8')
  );

  // Una sola definicion...
  const definitions = [
    ...resolver.matchAll(/private validateWalletAgainstProfile\(/g)
  ];
  assert.equal(definitions.length, 1, 'una sola definicion');

  // ...y exactamente dos usos: el cache hit y el cache miss.
  const calls = [
    ...resolver.matchAll(/this\.validateWalletAgainstProfile\(/g)
  ];
  assert.equal(
    calls.length,
    2,
    'debe invocarse en el cache hit Y en el cache miss'
  );

  // No sobrevive una segunda implementacion del chequeo de clave publica.
  assert.ok(!resolver.includes('assertAssertionPublicMaterial'));
  const comparisons = [...resolver.matchAll(/profile\.publicKeyX !==/g)];
  assert.equal(comparisons.length, 1, 'un solo lugar compara el material publico');
});

test('el signer resuelto no declara secretRef ni privateKey ni custody', () => {
  const resolver = readFileSync(
    join(SIGNING_DIR, 'issuer-signer-resolver.ts'),
    'utf8'
  );

  const shape = /export interface ResolvedIssuerSigner \{([\s\S]*?)\n\}/.exec(
    resolver
  );
  assert.ok(shape, 'no se encontro ResolvedIssuerSigner');

  const fields = [...shape[1].matchAll(/readonly (\w+):/g)].map((m) => m[1]);
  assert.deepEqual(fields.sort(), [
    'address',
    'keyVersion',
    'profileId',
    'purpose',
    'wallet'
  ]);
});

test('los mensajes de error son literales fijos: nada interpolado', () => {
  const errors = readFileSync(
    join(SIGNING_DIR, 'signer-resolution.error.ts'),
    'utf8'
  );
  const code = executableCode(errors);

  // El mensaje sale siempre del mapa, nunca de una plantilla.
  assert.match(code, /super\(SAFE_MESSAGES\[code\]\)/);
  assert.ok(!code.includes('super(`'));
  assert.ok(!code.includes('${'), 'ninguna interpolacion en este archivo');
});

test('no se adjunta `cause` a ningun error del modulo', () => {
  for (const file of productionSources()) {
    const code = executableCode(file.contents);
    assert.ok(!code.includes('cause:'), `${file.name} no debe propagar cause`);
  }
});

// ---------------------------------------------------------------------------
// SEPARACION RESPECTO DEL CAMINO LEGACY
// ---------------------------------------------------------------------------

test('35: el camino nuevo NO lee CREDENTIAL_REGISTRY_PRIVATE_KEY', () => {
  // Sobre CODIGO EJECUTABLE, no sobre prosa: `signing.module.ts` documenta a
  // proposito que el camino legacy sigue siendo el activo, y mencionar ahi la
  // variable es informacion util, no un acoplamiento. Mismo criterio que los
  // tests de migration del repo.
  for (const file of productionSources()) {
    assert.ok(
      !executableCode(file.contents).includes('CREDENTIAL_REGISTRY_PRIVATE_KEY'),
      `${file.name} no debe leer el signer global legacy`
    );
  }
});

test('35: el camino nuevo no introduce ninguna variable de entorno con una clave', () => {
  for (const file of productionSources()) {
    const code = executableCode(file.contents);

    for (const token of [
      'SIGNER_PRIVATE_KEY',
      'ISSUER_PRIVATE_KEY',
      'ASSERTION_PRIVATE_KEY',
      'ANCHOR_PRIVATE_KEY'
    ]) {
      assert.ok(!code.includes(token), `${file.name} no debe declarar ${token}`);
    }
  }
});

test('35: el signer global legacy ya no tiene consumidores de runtime', () => {
  // S8c2 congelo que el camino legacy seguia siendo el activo, y eso era cierto
  // entonces. S8c8 hizo el cutover, asi que la afirmacion se actualiza en vez
  // de quedar probando algo que ya no pasa.
  //
  // El cliente legacy sigue EXISTIENDO -- su unico usuario es la herramienta de
  // operacion por linea de comandos -- y eso es lo que se conserva.
  const writeClient = readFileSync(
    join(API_SRC_DIR, 'blockchain', 'credential-registry-write-client.ts'),
    'utf8'
  );
  assert.ok(writeClient.includes('CREDENTIAL_REGISTRY_PRIVATE_KEY'));

  const revocation = readFileSync(
    join(API_SRC_DIR, 'credentials', 'issuer-credential-revocation.service.ts'),
    'utf8'
  );
  assert.ok(!revocation.includes('resolveCredentialRegistrySignerAddress'));
  assert.ok(!revocation.includes('CREDENTIAL_REGISTRY_PRIVATE_KEY'));
  // Y ahora resuelve el ANCHOR HISTORICO que el record congelo.
  assert.ok(revocation.includes('resolveHistoricalAnchorSigner'));
});

/**
 * 36 (ACTUALIZADO EN S8c4): el resolver tiene consumidores de produccion
 * EXPLICITAMENTE ALLOWLISTEADOS, y nada mas.
 *
 * El guard original de S8c2 afirmaba "ningun flujo existente usa todavia el
 * resolver". Eso era cierto cuando se escribio y dejo de serlo en S8c4: la
 * construccion del proof de autoria es, a proposito, el primer consumidor de
 * produccion. El guard NO se borra -- lo que se protege sigue siendo valioso --
 * sino que se reemplaza por el invariante mas fuerte que si sigue siendo
 * cierto: el resolver se consume SOLO desde la autoria de credentials.
 *
 * Sigue prohibido, y es lo que importa: blockchain, revocacion, el controller
 * publico de DID, identity, web y cualquier modulo no relacionado.
 */
const RESOLVER_CONSUMER_ALLOWLIST = [
  // ASERCION -- orquestador de la autoria de la credential (S8c4).
  join('credentials', 'credential-proof.service.ts'),
  // ANCLAJE -- orquestador del ciclo de vida de registracion (S8c6). Resuelve
  // el signer de anclaje VIGENTE fuera de toda transaccion y se lo pasa al
  // coordinador de escrituras.
  join('blockchain', 'blockchain-registration.service.ts'),
  // ANCLAJE HISTORICO -- revocacion (S8c8). Es el tercer y ultimo consumidor:
  // resuelve el perfil EXACTO que `BlockchainRecord.anchorSignerProfileId`
  // congelo, nunca el binding vigente del issuer.
  join('credentials', 'issuer-credential-revocation.service.ts')
];

test('36: el resolver solo lo consumen los componentes allowlisteados', () => {
  const offenders: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'signing') {
          walk(full);
        }
        continue;
      }
      // Solo fuentes de PRODUCCION, y solo su codigo EJECUTABLE. Un test que
      // asserta la AUSENCIA del resolver, o un comentario que explica la
      // separacion, nombran el identificador sin usarlo. Mirar el texto crudo
      // de todos los .ts convertia a la propia documentacion en una violacion.
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
        continue;
      }
      const code = executableCode(readFileSync(full, 'utf8'));
      if (
        code.includes('IssuerSignerResolver') ||
        code.includes('resolveAssertionSignerForIssuer') ||
        code.includes('resolveAnchorSignerForIssuer')
      ) {
        offenders.push(relative(API_SRC_DIR, full));
      }
    }
  };

  walk(API_SRC_DIR);

  assert.deepEqual(
    offenders.sort(),
    RESOLVER_CONSUMER_ALLOWLIST.sort(),
    `consumidor no autorizado del resolver: ${offenders.join(', ')}`
  );
});

test('36a: el CredentialsModule importa el modulo pero no nombra el resolver', () => {
  // Sobre CODIGO EJECUTABLE: el doc comment del modulo explica a proposito
  // POR QUE importar SigningModule es seguro, y para eso nombra el resolver.
  // Esa prosa es correcta y no es una inyeccion.
  const credentialsModule = executableCode(
    readFileSync(
      join(API_SRC_DIR, 'credentials', 'credentials.module.ts'),
      'utf8'
    )
  );

  assert.ok(credentialsModule.includes('SigningModule'));
  assert.ok(!credentialsModule.includes('IssuerSignerResolver'));
  assert.ok(!credentialsModule.includes('SIGNER_SECRET_STORE'));
});

test('36d: cada orquestador usa SOLO su proposito', () => {
  // La autoria usa asercion y nunca anclaje; el ciclo de vida de registracion
  // usa anclaje y nunca asercion. Cruzarlos seria firmar la credencial con la
  // cuenta que paga gas, o anclar con la clave que acredita autoria.
  const proof = executableCode(
    readFileSync(
      join(API_SRC_DIR, 'credentials', 'credential-proof.service.ts'),
      'utf8'
    )
  );
  assert.ok(proof.includes('resolveAssertionSignerForIssuer'));
  assert.ok(!proof.includes('resolveAnchorSignerForIssuer'));

  const registration = executableCode(
    readFileSync(
      join(API_SRC_DIR, 'blockchain', 'blockchain-registration.service.ts'),
      'utf8'
    )
  );
  assert.ok(registration.includes('resolveAnchorSignerForIssuer'));
  assert.ok(!registration.includes('resolveAssertionSignerForIssuer'));
});

test('36b: la emision llega al signer SOLO a traves de los orquestadores', () => {
  // `credentials.service.ts` orquesta la emision pero no inyecta el resolver:
  // si lo hiciera, podria elegir el proposito (asercion vs anclaje) y saltarse
  // la validacion del DID.
  const issuance = executableCode(
    readFileSync(
      join(API_SRC_DIR, 'credentials', 'credentials.service.ts'),
      'utf8'
    )
  );
  assert.ok(!issuance.includes('IssuerSignerResolver'));
  assert.ok(!issuance.includes('resolveAssertionSignerForIssuer'));

  // Y la autoria usa SOLO la clave de asercion.
  const proofService = executableCode(
    readFileSync(
      join(API_SRC_DIR, 'credentials', 'credential-proof.service.ts'),
      'utf8'
    )
  );
  assert.ok(proofService.includes('resolveAssertionSignerForIssuer'));
  assert.ok(!proofService.includes('resolveAnchorSignerForIssuer'));
});

test('36c: el resto del plano de blockchain sigue SIN tocar el resolver', () => {
  // Estos son los limites que el guard original protegia y que ni S8c4 ni
  // S8c6 aflojan. En particular: el cliente de bajo nivel, el preflight, el
  // coordinador de escrituras y la reconciliacion NO resuelven identidad --
  // reciben un signer ya autorizado, o no necesitan ninguno.
  for (const relativePath of [
    join('blockchain', 'blockchain-evidence.service.ts'),
    join('blockchain', 'credential-registry-write-client.ts'),
    join('blockchain', 'credential-registry-read-client.ts'),
    join('blockchain', 'credential-registry-preflight.ts'),
    join('blockchain', 'anchor-write-coordinator.ts'),
    join('blockchain', 'blockchain-registration-reconciliation.service.ts'),
    join('blockchain', 'blockchain-record-reconciliation.service.ts'),
    // S8c8: la revocacion SI resuelve identidad -- el anchor historico -- y por
    // eso salio de esta lista y entro en el allowlist de consumidores. El
    // limite que este guard protege sigue intacto: los componentes de bajo
    // nivel reciben un signer ya autorizado, o no necesitan ninguno.
    join('credentials', 'issuer-credential-draft-update.service.ts'),
    join('identity', 'issuer-did.controller.ts'),
    join('identity', 'did.controller.ts')
  ]) {
    const code = executableCode(
      readFileSync(join(API_SRC_DIR, relativePath), 'utf8')
    );

    for (const token of [
      'IssuerSignerResolver',
      'resolveAssertionSignerForIssuer',
      'resolveAnchorSignerForIssuer',
      'SIGNER_SECRET_STORE'
    ]) {
      assert.ok(
        !code.includes(token),
        `${relativePath} no debe usar ${token}`
      );
    }
  }
});

test('el AppModule registra el modulo pero no inyecta el resolver', () => {
  const appModule = readFileSync(join(API_SRC_DIR, 'app.module.ts'), 'utf8');

  assert.ok(appModule.includes('SigningModule'));
  assert.ok(!appModule.includes('IssuerSignerResolver'));
});

// ---------------------------------------------------------------------------
// PEREZA DEL CLIENTE AWS
// ---------------------------------------------------------------------------

test('construir el almacen no envia ningun comando a AWS', () => {
  let sends = 0;
  let constructed = 0;

  const store = createSignerSecretStoreFromEnv(
    {} as NodeJS.ProcessEnv,
    {
      createSsmClient: () => {
        constructed += 1;
        return {
          send: async () => {
            sends += 1;
            return {};
          }
        } as never;
      }
    }
  );

  assert.ok(store);
  assert.equal(constructed, 1, 'el cliente se construye');
  assert.equal(sends, 0, 'pero NO se envia nada');
});

test('el factory no exige AWS_REGION ni credenciales para construirse', () => {
  const configs: unknown[] = [];

  createSignerSecretStoreFromEnv({} as NodeJS.ProcessEnv, {
    createSsmClient: (config) => {
      configs.push(config);
      return { send: async () => ({}) } as never;
    }
  });

  // Sin AWS_REGION la config va vacia y el SDK resuelve la region por su
  // cadena por defecto al enviar, no al construir.
  assert.deepEqual(configs, [{}]);
});

test('el factory propaga region y prefijo de namespace cuando estan definidos', () => {
  const configs: Array<{ region?: string }> = [];

  const store = createSignerSecretStoreFromEnv(
    {
      AWS_REGION: 'us-east-1',
      SIGNER_SECRET_REF_PREFIX: '/scope/prod/signers/'
    } as NodeJS.ProcessEnv,
    {
      createSsmClient: (config) => {
        configs.push(config as { region?: string });
        return { send: async () => ({}) } as never;
      }
    }
  );

  assert.deepEqual(configs, [{ region: 'us-east-1' }]);

  // El prefijo quedo aplicado: una referencia ajena se rechaza sin enviar.
  assert.rejects(
    () => store.getPrivateKey('/scope/prod/api/JWT_SECRET'),
    /no es admisible/
  );
});

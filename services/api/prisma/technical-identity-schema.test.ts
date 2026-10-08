/**
 * Invariantes estructurales de la identidad tecnica, a nivel de schema.prisma
 * -- S8c1.
 *
 * El test de migration congela el DDL. Este congela el MODELO: hay propiedades
 * que solo se ven en Prisma, sobre todo las acciones referenciales explicitas.
 * Si alguien borra un `onDelete: Restrict`, Prisma vuelve al default -- que para
 * una relacion OPCIONAL es `SetNull` -- y la proxima migration generada
 * destruiria en silencio la procedencia historica del signer. El DDL de hoy
 * seguiria pasando su propio test; esto es lo que atrapa la regresion.
 *
 * Alcance deliberadamente acotado a las superficies nuevas de S8 (SignerProfile,
 * IssuerTechnicalIdentity, y las columnas que S8c1 agrega a Issuer / Credential
 * / BlockchainRecord). No es un grep global del repo.
 */

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const SCHEMA_PATH = join(__dirname, 'schema.prisma');

async function schema(): Promise<string> {
  return readFile(SCHEMA_PATH, 'utf8');
}

/** Cuerpo de un bloque `model X { ... }`, sin lineas de comentario. */
async function modelBody(name: string): Promise<string> {
  const raw = await schema();
  const match = new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, 'm').exec(raw);
  assert.ok(match, `no se encontro el model ${name}`);

  return match[1]
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

/** Cuerpo de un bloque `enum X { ... }`, sin comentarios. */
async function enumValues(name: string): Promise<string[]> {
  const raw = await schema();
  const match = new RegExp(`^enum ${name} \\{([\\s\\S]*?)^\\}`, 'm').exec(raw);
  assert.ok(match, `no se encontro el enum ${name}`);

  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//'));
}

/** Nombres de campo escalares/relacionales declarados en un model. */
function fieldNames(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('@@'))
    .map((line) => line.split(/\s+/)[0]);
}

// ---------------------------------------------------------------------------
// NINGUN CAMPO PUEDE CONTENER KEY MATERIAL
// ---------------------------------------------------------------------------

const FORBIDDEN_KEY_MATERIAL = [
  'privateKey',
  'private_key',
  'privKey',
  'mnemonic',
  'seedPhrase',
  'seed_phrase',
  'secretValue',
  'secret_value',
  'keyMaterial',
  'passphrase',
  'privateJwk'
];

test('SignerProfile no declara ningun campo capaz de contener key material', async () => {
  const body = await modelBody('SignerProfile');

  for (const forbidden of FORBIDDEN_KEY_MATERIAL) {
    assert.doesNotMatch(
      body,
      new RegExp(forbidden, 'i'),
      `SignerProfile no debe declarar ${forbidden}`
    );
  }
});

test('IssuerTechnicalIdentity tampoco declara key material', async () => {
  const body = await modelBody('IssuerTechnicalIdentity');

  for (const forbidden of FORBIDDEN_KEY_MATERIAL) {
    assert.doesNotMatch(
      body,
      new RegExp(forbidden, 'i'),
      `IssuerTechnicalIdentity no debe declarar ${forbidden}`
    );
  }
});

test('secretRef SI existe: es una referencia, no material', async () => {
  const body = await modelBody('SignerProfile');

  // Es el NOMBRE de un parametro en el secret store. Unico, porque dos
  // perfiles apuntando al mismo secreto serian dos versiones de la misma clave.
  assert.match(body, /^\s*secretRef\s+String\s+@unique\s*$/m);
});

test('SignerProfile declara exactamente los campos congelados', async () => {
  const body = await modelBody('SignerProfile');

  assert.deepEqual(fieldNames(body), [
    'id',
    'label',
    'purpose',
    'custody',
    'secretRef',
    'address',
    'publicKeyX',
    'publicKeyY',
    'publicKeyCompressed',
    'keyVersion',
    'addressVerifiedAt',
    'status',
    'createdAt',
    'retiredAt',
    'assertionForIdentity',
    'anchorForIdentities',
    'anchoredRecords'
  ]);
});

test('el material publico alcanza para construir el publicKeyJwk sin leer el secret store', async () => {
  const body = await modelBody('SignerProfile');

  // kty y crv son constantes del profile (EC / secp256k1) y no se persisten;
  // `alg` se omite a proposito porque el proof es EIP-191, no ES256K JWS. Lo
  // unico que hace falta guardar son las coordenadas.
  assert.match(body, /^\s*publicKeyX\s+String\?\s*$/m);
  assert.match(body, /^\s*publicKeyY\s+String\?\s*$/m);
  assert.match(body, /^\s*publicKeyCompressed\s+String\?\s*$/m);

  // Y NO se guardan como columnas redundantes.
  assert.doesNotMatch(body, /\bkty\b/);
  assert.doesNotMatch(body, /\bcrv\b/);
  assert.doesNotMatch(body, /\balg\b/);
  assert.doesNotMatch(body, /publicKeyJwk/);
});

test('addressVerifiedAt existe: la prueba derivada-vs-almacenada se registra', async () => {
  const body = await modelBody('SignerProfile');
  assert.match(body, /^\s*addressVerifiedAt\s+DateTime\?\s*$/m);
});

// ---------------------------------------------------------------------------
// CARDINALIDADES
// ---------------------------------------------------------------------------

test('una identidad tecnica por issuer, y un DID por identidad', async () => {
  const body = await modelBody('IssuerTechnicalIdentity');

  assert.match(body, /^\s*issuerId\s+String\s+@unique\s*$/m);
  assert.match(body, /^\s*did\s+String\s+@unique\s*$/m);
});

test('la assertion key es EXCLUSIVA de un issuer (unique)', async () => {
  const body = await modelBody('IssuerTechnicalIdentity');

  // Propiedad del producto: una assertion key no puede identificar
  // simultaneamente a dos issuers. Constraint relacional, no validacion de
  // servicio.
  assert.match(body, /^\s*assertionSignerProfileId\s+String\s+@unique\s*$/m);
});

test('el anchor signer es COMPARTIBLE (no unique)', async () => {
  const body = await modelBody('IssuerTechnicalIdentity');

  const line = /^\s*anchorSignerProfileId\s+String.*$/m.exec(body);
  assert.ok(line, 'no se encontro anchorSignerProfileId');
  assert.doesNotMatch(
    line[0],
    /@unique/,
    'si fuese unique, la demo con un anchor compartido entre tres issuers dejaria de ser representable'
  );
});

test('la relacion inversa refleja la cardinalidad: assertion 1:1, anchor 1:N', async () => {
  const body = await modelBody('SignerProfile');

  // Un perfil de assertion respalda a lo sumo UNA identidad tecnica.
  assert.match(
    body,
    /^\s*assertionForIdentity\s+IssuerTechnicalIdentity\?\s+@relation\("IssuerTechnicalIdentityAssertionSigner"\)\s*$/m
  );
  // Un perfil de anchor puede respaldar a VARIAS.
  assert.match(
    body,
    /^\s*anchorForIdentities\s+IssuerTechnicalIdentity\[\]\s+@relation\("IssuerTechnicalIdentityAnchorSigner"\)\s*$/m
  );
});

test('SignerProfile.address es la unica fuente de verdad de una direccion', async () => {
  const body = await modelBody('SignerProfile');

  assert.match(body, /^\s*address\s+String\s+@unique\s*$/m);
});

// ---------------------------------------------------------------------------
// LA HISTORIA DEL SIGNER NO SE BORRA
// ---------------------------------------------------------------------------

test('las tres referencias a SignerProfile son onDelete: Restrict explicito', async () => {
  // BlockchainRecord: el caso critico. Relacion OPCIONAL, cuyo default en
  // Prisma seria SetNull -- justo lo que borraria la procedencia historica.
  const recordBody = await modelBody('BlockchainRecord');
  assert.match(
    recordBody,
    /anchorSignerProfile\s+SignerProfile\?\s+@relation\("BlockchainRecordAnchorSigner", fields: \[anchorSignerProfileId\], references: \[id\], onDelete: Restrict\)/
  );

  const identityBody = await modelBody('IssuerTechnicalIdentity');
  assert.match(
    identityBody,
    /assertionSignerProfile\s+SignerProfile\s+@relation\("IssuerTechnicalIdentityAssertionSigner", fields: \[assertionSignerProfileId\], references: \[id\], onDelete: Restrict\)/
  );
  assert.match(
    identityBody,
    /anchorSignerProfile\s+SignerProfile\s+@relation\("IssuerTechnicalIdentityAnchorSigner", fields: \[anchorSignerProfileId\], references: \[id\], onDelete: Restrict\)/
  );
});

test('ninguna relacion hacia SignerProfile usa Cascade ni SetNull', async () => {
  const raw = await schema();

  const toSignerProfile = raw
    .split('\n')
    .filter((line) => /SignerProfile\s+@relation|SignerProfile\?\s+@relation/.test(line));

  assert.equal(toSignerProfile.length, 3, 'tres relaciones entrantes');
  for (const line of toSignerProfile) {
    assert.match(line, /onDelete: Restrict/, line.trim());
    assert.doesNotMatch(line, /onDelete: Cascade/);
    assert.doesNotMatch(line, /onDelete: SetNull/);
  }
});

// ---------------------------------------------------------------------------
// ENUMS
// ---------------------------------------------------------------------------

test('los enums de identidad tecnica tienen los valores congelados', async () => {
  assert.deepEqual(await enumValues('SignerProfilePurpose'), [
    'assertion',
    'anchor'
  ]);
  assert.deepEqual(await enumValues('SignerKeyCustody'), [
    'scope_managed',
    'institution_imported'
  ]);
  assert.deepEqual(await enumValues('SignerProfileStatus'), [
    'active',
    'retired',
    'compromised'
  ]);
  assert.deepEqual(await enumValues('IssuerTechnicalIdentityStatus'), [
    'unconfigured',
    'active',
    'rotation_required',
    'disabled'
  ]);
  assert.deepEqual(await enumValues('BlockchainEvidenceMode'), [
    'mock',
    'credential_registry'
  ]);
  assert.deepEqual(await enumValues('AnchorRegistrantScope'), [
    'issuer_exclusive',
    'shared_custodial'
  ]);
});

test('pending esta AL FINAL de BlockchainRecordStatus', async () => {
  // El orden de declaracion define el orden de comparacion del enum en
  // PostgreSQL, y agregar al final es lo que permite un ADD VALUE plano.
  assert.deepEqual(await enumValues('BlockchainRecordStatus'), [
    'registered',
    'revoked',
    'pending'
  ]);
});

test('CredentialStatus NO fue tocado: pending es ciclo de vida de evidencia', async () => {
  assert.deepEqual(await enumValues('CredentialStatus'), [
    'draft',
    'issued',
    'revoked'
  ]);
});

// ---------------------------------------------------------------------------
// PROCEDENCIA DEL BLOCKCHAIN RECORD
// ---------------------------------------------------------------------------

test('las cinco columnas de procedencia existen y son nullable', async () => {
  const body = await modelBody('BlockchainRecord');

  assert.match(body, /^\s*evidenceMode\s+BlockchainEvidenceMode\?\s*$/m);
  assert.match(body, /^\s*deploymentId\s+String\?\s*$/m);
  assert.match(body, /^\s*blockNumber\s+Int\?\s*$/m);
  assert.match(body, /^\s*anchorSignerProfileId\s+String\?\s*$/m);
  assert.match(body, /^\s*anchorRegistrantScope\s+AnchorRegistrantScope\?\s*$/m);
});

test('anchorRegistrantScope vive en el RECORD, no se deriva de los bindings vivos', async () => {
  // Los bindings pueden cambiar despues de la emision. Si el scope historico se
  // derivase de cuantos issuers referencian hoy al anchor profile, una
  // reconfiguracion posterior reescribiria el significado de evidencia ya
  // emitida. Por eso es un snapshot en la fila.
  const recordBody = await modelBody('BlockchainRecord');
  assert.match(recordBody, /anchorRegistrantScope\s+AnchorRegistrantScope\?/);

  const identityBody = await modelBody('IssuerTechnicalIdentity');
  assert.doesNotMatch(identityBody, /anchorRegistrantScope/);

  const profileBody = await modelBody('SignerProfile');
  assert.doesNotMatch(profileBody, /anchorRegistrantScope/);
});

test('S8c6 volvio nullable txHash, que S8c1 habia dejado NOT NULL a proposito', async () => {
  const body = await modelBody('BlockchainRecord');

  // S8c1 lo dejo NOT NULL a proposito: la nulabilidad que necesita `pending`
  // pertenecia al rediseño de issuance. S8c6 hizo ese rediseño, asi que la
  // asercion se ACTUALIZA en vez de quedar afirmando algo que ya es falso.
  //
  // La forma completa la congela
  // `prisma/blockchain-record-pending-migration.test.ts`; aca solo se registra
  // que la transicion ocurrio y en que slice.
  assert.match(body, /^\s*txHash\s+String\?\s*$/m);
  assert.match(body, /^\s*issuerAddress\s+String\?\s*$/m);
  assert.match(body, /^\s*registeredAt\s+DateTime\?\s*$/m);
});

// ---------------------------------------------------------------------------
// ADITIVIDAD SOBRE MODELOS EXISTENTES
// ---------------------------------------------------------------------------

test('Issuer conserva did y walletAddress como legacy', async () => {
  const body = await modelBody('Issuer');

  assert.match(body, /^\s*did\s+String\?\s+@unique\s*$/m);
  assert.match(body, /^\s*walletAddress\s+String\?\s+@unique\s*$/m);
  assert.match(body, /^\s*technicalIdentity\s+IssuerTechnicalIdentity\?\s*$/m);
});

test('allowedCredentialTypes declara @default([]) en el modelo', async () => {
  const body = await modelBody('Issuer');

  // Que el default este en schema.prisma es lo que mantiene alineadas las tres
  // semanticas: base (NOT NULL DEFAULT array vacio), Prisma (@default([])) y
  // dominio ([] = ningun tipo habilitado). Sin el, una regla de autorizacion
  // futura dependeria de que el ORM coaccione NULL a [] en una lectura.
  assert.match(
    body,
    /^\s*allowedCredentialTypes\s+CredentialType\[\]\s+@default\(\[\]\)\s*$/m
  );
});

test('allowedCredentialTypes no es una lista nullable', async () => {
  const body = await modelBody('Issuer');

  // Prisma no puede expresar `CredentialType[]?`, y tampoco debe intentarse.
  assert.doesNotMatch(body, /allowedCredentialTypes\s+CredentialType\[\]\?/);
});

test('allowedCredentialTypes NO activa ningun reader ni regla de autorizacion en S8c1', async () => {
  // El campo existe en el schema y en la migration, pero todavia no lo lee
  // nadie: el discriminante vigente sigue siendo el literal
  // `did:example:issuer-demo`. Cambiar eso es S8c9, y ANTES hay que
  // aprovisionar capacidades, porque con @default([]) todos los issuers
  // arrancan sin ningun tipo habilitado.
  const srcDir = join(__dirname, '..', 'src');
  const offenders: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts')) {
        continue;
      }
      const contents = await readFile(full, 'utf8');
      if (contents.includes('allowedCredentialTypes')) {
        offenders.push(full);
      }
    }
  };

  await walk(srcDir);

  assert.deepEqual(
    offenders,
    [],
    `allowedCredentialTypes no debe leerse en src/ todavia: ${offenders.join(', ')}`
  );
});

test('Credential.proof es Json nullable y no hay columnas de proof desplegadas', async () => {
  const body = await modelBody('Credential');

  assert.match(body, /^\s*proof\s+Json\?\s*$/m);

  // Un solo artifact versionado, no ocho columnas. En particular no existe
  // `created`, que S8b.1 elimino del proof.
  for (const forbidden of [
    'proofValue',
    'proofPurpose',
    'cryptosuite',
    'verificationMethod',
    'proofCreated'
  ]) {
    assert.doesNotMatch(
      body,
      new RegExp(`^\\s*${forbidden}\\s`, 'm'),
      `${forbidden} no debe ser una columna propia`
    );
  }
});

test('Credential.canonicalHash y canonicalizationVersion no cambiaron', async () => {
  const body = await modelBody('Credential');

  assert.match(body, /^\s*canonicalHash\s+String\?\s*$/m);
  assert.match(body, /^\s*canonicalizationVersion\s+String\?\s*$/m);
});

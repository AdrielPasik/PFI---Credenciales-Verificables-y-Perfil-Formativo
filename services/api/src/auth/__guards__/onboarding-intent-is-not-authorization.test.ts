/**
 * Guard estructural -- O1, hecho SEMANTICO en el micro-slice posterior a S5a.
 *
 * Afirma UNA propiedad arquitectonica:
 *
 *     ningun codigo de autorizacion LEE `onboardingIntent`
 *
 * POR QUE IMPORTA. `User.onboardingIntent` es la primera columna de `User` que
 * no es identidad pura, y su justificacion entera descansa en que ningun guard
 * ni helper de autorizacion la lea. Esa es la linea que separa "preferencia de
 * onboarding" de "autorizacion encubierta". Si manana alguien escribiera:
 *
 *     if (user.onboardingIntent === 'institutional') {
 *       allowIssuerOperation();
 *     }
 *
 * el campo se convertiria en un permiso auto-asignable por el cliente -- que es
 * exactamente lo que el diseno prohibe. Este test lo rompe en voz alta.
 *
 * POR QUE AST Y NO REGEX -- la correccion de este micro-slice.
 *
 * La primera version buscaba el identificador con `/onboardingIntent/i` sobre
 * el codigo sin comentarios. Eso confunde dos cosas opuestas:
 *
 *     LECTURA AUTORITATIVA   user.onboardingIntent        <- lo que se prohibe
 *     RECHAZO DECLARATIVO    FORBIDDEN.has('onboardingIntent')  <- lo correcto
 *
 * Un validador administrativo que RECHAZA la clave es el refuerzo mas fuerte de
 * la invariante, no su violacion. La regex obligaba a sacar esa entrada del
 * validador de S5a para que el guard pasara -- deformar codigo productivo para
 * satisfacer un test. Ahora se recorre el AST y solo cuentan los ACCESOS: un
 * string literal, un comentario y un JSDoc no son accesos.
 *
 * Mismo criterio y mismo helper que
 * `source-extraction/__guards__/source-extraction-production-callers.test.ts` y
 * los `__guards__` de S1/S5a, que ya documentan por que el AST es la unica
 * forma de no castigar la prosa que explica la invariante.
 *
 * ALCANCE DELIBERADAMENTE ACOTADO. Se vigilan los archivos que DECIDEN
 * permisos, no el repositorio entero: `onboardingIntent` tiene usos legitimos
 * en `AuthService` (persistirlo en register, proyectarlo en `/auth/me`), en los
 * DTOs, en el frontend y en los tests. Un guard mas amplio prohibiria esos usos
 * y seria abandonado en la primera friccion.
 *
 * `typescript` ya es devDependency: no se agrego ninguna dependencia.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const SRC = join(__dirname, '..', '..');

/** El campo de la preferencia. */
const FIELD = 'onboardingIntent';

/**
 * El enum del campo. Usarlo en un archivo de autorizacion sería el otro camino
 * para decidir con esta preferencia (`=== UserOnboardingIntent.institutional`),
 * asi que tambien se vigila -- pero igual que el campo, solo como REFERENCIA,
 * nunca como string.
 */
const ENUM_TYPE = 'UserOnboardingIntent';

/**
 * Archivos y directorios que DECIDEN permisos.
 *
 * - los dos guards del repo;
 * - `IssuersService`, unica autoridad institucional;
 * - todo `src/issuers/` y todo `src/platform-admin/`, que son los dos planos
 *   de autorizacion.
 */
const AUTHORIZATION_FILES = [
  join('auth', 'auth.guard.ts'),
  join('auth', 'auth.types.ts'),
  join('platform-admin', 'platform-admin.guard.ts')
];

const AUTHORIZATION_DIRS = ['issuers', 'platform-admin'];

function productionFilesIn(relativeDir: string): string[] {
  return readdirSync(join(SRC, relativeDir), {
    recursive: true,
    encoding: 'utf8'
  })
    .filter((entry) => entry.endsWith('.ts'))
    .filter((entry) => !entry.endsWith('.test.ts'))
    .map((entry) => join(relativeDir, entry.split('/').join(sep)));
}

/**
 * Lecturas de la preferencia encontradas en el AST.
 *
 * CUENTA (son formas de leer el dato):
 *   - `x.onboardingIntent`          acceso por propiedad, incluido `x?.`
 *   - `x['onboardingIntent']`       acceso por indice con literal
 *   - `const { onboardingIntent }`  desestructuracion
 *   - `UserOnboardingIntent`        referencia al identificador del enum
 *
 * NO CUENTA (no leen nada):
 *   - `'onboardingIntent'`          string literal, p. ej. en un Set de claves
 *                                   prohibidas, un array, un mensaje de error
 *   - comentarios y JSDoc           el AST no los visita como expresiones
 *
 * LIMITES ASUMIDOS, declarados en vez de escondidos:
 *   - un despacho totalmente dinamico (`const k = 'onboarding' + 'Intent';
 *     user[k]`) no se detecta. Es una limitacion real de cualquier analisis
 *     sintactico: el objetivo es detectar una lectura escrita de la forma
 *     normal, no resistir a alguien que ofusque a proposito;
 *   - una clave de objeto literal (`select: { onboardingIntent: true }`) NO se
 *     marca. Es deliberado: pedir la columna no decide nada por si solo, y
 *     USARLA despues exige un acceso por propiedad sobre el resultado, que si
 *     se detecta. Marcarla seria prohibir una proyeccion inocua.
 */
function authorizationReads(code: string, fileName: string): string[] {
  const source = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true
  );
  const found = new Set<string>();

  const visit = (node: ts.Node): void => {
    // x.onboardingIntent  /  x?.onboardingIntent
    if (ts.isPropertyAccessExpression(node) && node.name.text === FIELD) {
      found.add(`property access: .${FIELD}`);
    }

    // x['onboardingIntent']
    if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression !== undefined &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === FIELD
    ) {
      found.add(`element access: ['${FIELD}']`);
    }

    // const { onboardingIntent } = user  /  const { onboardingIntent: x } = user
    if (ts.isBindingElement(node)) {
      const name = node.propertyName ?? node.name;
      if (ts.isIdentifier(name) && name.text === FIELD) {
        found.add(`destructuring: { ${FIELD} }`);
      }
    }

    // Cualquier referencia al identificador del enum. Un string con el mismo
    // texto no es un Identifier, asi que no entra por aca.
    if (ts.isIdentifier(node) && node.text === ENUM_TYPE) {
      found.add(`identifier: ${ENUM_TYPE}`);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return [...found].sort();
}

function readsIn(relativePath: string): string[] {
  return authorizationReads(
    readFileSync(join(SRC, relativePath), 'utf8'),
    relativePath
  );
}

// ---------------------------------------------------------------------------
// Controles del detector: lo que SI detecta y lo que NO
// ---------------------------------------------------------------------------

test('detector/1: encuentra una lectura por acceso de propiedad', () => {
  const detected = authorizationReads(
    'if (user.onboardingIntent === "institutional") { allowIssuerAccess(); }',
    'probe.ts'
  );

  assert.deepEqual(detected, ['property access: .onboardingIntent']);
});

test('detector/1b: encuentra la lectura aunque este encadenada o sea opcional', () => {
  for (const code of [
    'const x = request.user.onboardingIntent;',
    'const x = request.user?.onboardingIntent;',
    'return ctx.getRequest().user.onboardingIntent === "institutional";'
  ]) {
    assert.ok(
      authorizationReads(code, 'probe.ts').includes(
        'property access: .onboardingIntent'
      ),
      `deberia detectar: ${code}`
    );
  }
});

test('detector/2: encuentra una lectura por acceso de indice', () => {
  const detected = authorizationReads(
    'if (user["onboardingIntent"] === "institutional") { allow(); }',
    'probe.ts'
  );

  assert.deepEqual(detected, ["element access: ['onboardingIntent']"]);
});

test('detector/2b: encuentra la desestructuracion y el uso del enum', () => {
  assert.ok(
    authorizationReads(
      'const { onboardingIntent } = user; if (onboardingIntent) allow();',
      'probe.ts'
    ).includes('destructuring: { onboardingIntent }')
  );
  assert.ok(
    authorizationReads(
      'if (x === UserOnboardingIntent.institutional) allow();',
      'probe.ts'
    ).includes('identifier: UserOnboardingIntent')
  );
});

test('detector/3: un string literal NO es una lectura de autorizacion', () => {
  // Es el caso que motivo este micro-slice: rechazar la clave es el refuerzo
  // mas fuerte de la invariante, no su violacion.
  for (const code of [
    "const FORBIDDEN = new Set(['onboardingIntent']);",
    "const KEYS = ['userEmail', 'onboardingIntent'];",
    "if (FORBIDDEN.has('onboardingIntent')) fail('no se puede enviar');",
    "fail(`body.onboardingIntent no forma parte del contrato`);",
    'const message = "onboardingIntent es intencion, no autorizacion";',
    "const label: 'onboardingIntent' = 'onboardingIntent';"
  ]) {
    assert.deepEqual(
      authorizationReads(code, 'probe.ts'),
      [],
      `no deberia marcar: ${code}`
    );
  }
});

test('detector/4: comentarios y JSDoc no cuentan', () => {
  const detected = authorizationReads(
    [
      '// user.onboardingIntent nunca se lee aca',
      '/** UserOnboardingIntent queda fuera de la autorizacion */',
      '/* if (u.onboardingIntent === "institutional") allow(); */',
      'const x = 1;'
    ].join('\n'),
    'probe.ts'
  );

  assert.deepEqual(detected, []);
});

test('detector/4b: distingue el caso REAL que rompio el guard anterior', () => {
  // Exactamente la forma del validador de S5a: la clave prohibida nombrada en
  // un Set, mas el mensaje de error. La regex anterior marcaba esto; el AST no.
  const validador = [
    "const ONBOARDING_KEYS = new Set(['onboardingIntent']);",
    'for (const key of Object.keys(value)) {',
    '  if (ONBOARDING_KEYS.has(key)) {',
    '    fail(`body.${key} es intencion de onboarding, no autorizacion.`);',
    '  }',
    '}'
  ].join('\n');

  assert.deepEqual(authorizationReads(validador, 'probe.ts'), []);
});

test('detector: el barrido alcanza los archivos de autorizacion reales', () => {
  for (const file of AUTHORIZATION_FILES) {
    assert.ok(
      readFileSync(join(SRC, file), 'utf8').length > 0,
      `${file} deberia existir y ser legible`
    );
  }

  const issuers = productionFilesIn('issuers');
  assert.ok(
    issuers.includes(join('issuers', 'issuers.service.ts')),
    'IssuersService esta en el barrido'
  );
  assert.ok(issuers.length >= 3, `barrido corto: ${issuers.length}`);

  const platformAdmin = productionFilesIn('platform-admin');
  assert.ok(
    platformAdmin.includes(join('platform-admin', 'platform-admin.guard.ts')),
    'PlatformAdminGuard esta en el barrido'
  );
  // El validador de S5a, que NOMBRA la clave para rechazarla, tiene que estar
  // barrido y tiene que pasar.
  assert.ok(
    platformAdmin.includes(
      join('platform-admin', 'grant-platform-admin-membership.validator.ts')
    ),
    'el validador de S5a esta en el barrido'
  );
});

// ---------------------------------------------------------------------------
// O1 -- el intent no autoriza nada
// ---------------------------------------------------------------------------

test('5: ningun guard LEE onboardingIntent', () => {
  const offenders = AUTHORIZATION_FILES.map((file) => ({
    file,
    reads: readsIn(file)
  })).filter((entry) => entry.reads.length > 0);

  assert.deepEqual(
    offenders,
    [],
    'Un guard que lea onboardingIntent lo convierte en un permiso ' +
      'auto-asignable por el cliente: ' +
      offenders.map((o) => `${o.file} (${o.reads.join(', ')})`).join('; ')
  );
});

for (const dir of AUTHORIZATION_DIRS) {
  test(`5: ningun archivo productivo de src/${dir} LEE onboardingIntent`, () => {
    const offenders = productionFilesIn(dir)
      .map((file) => ({ file, reads: readsIn(file) }))
      .filter((entry) => entry.reads.length > 0);

    assert.deepEqual(
      offenders,
      [],
      offenders.map((o) => `${o.file} (${o.reads.join(', ')})`).join('; ')
    );
  });
}

test('5b: el validador de S5a RECHAZA la clave, y eso no cuenta como lectura', () => {
  // Positivo, no solo negativo: el guard tiene que seguir pasando Y el
  // validador tiene que seguir nombrando la clave para rechazarla. Si alguien
  // sacara la entrada, este test lo detecta.
  const relativePath = join(
    'platform-admin',
    'grant-platform-admin-membership.validator.ts'
  );
  const raw = readFileSync(join(SRC, relativePath), 'utf8');

  assert.deepEqual(readsIn(relativePath), [], 'no hay ninguna lectura');
  assert.match(
    raw,
    /'onboardingIntent'/,
    'el validador debe seguir nombrando la clave para rechazarla'
  );
});

test('IssuersService sigue autorizando SOLO por membership y estado del issuer', () => {
  // Positivo, no solo negativo: que el campo no este no alcanza si el helper
  // dejara de mirar la membership. Esto ancla lo que SI debe seguir leyendo.
  const relativePath = join('issuers', 'issuers.service.ts');
  const code = readFileSync(join(SRC, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  assert.match(code, /issuerMembership\.findUnique/);
  assert.match(code, /IssuerMembershipStatus\.active/);
  assert.match(code, /IssuerMembershipRole\.admin/);
  assert.match(code, /IssuerAuthorizationStatus\.authorized/);
  // Y nada de los dos planos nuevos.
  assert.deepEqual(readsIn(relativePath), []);
  assert.doesNotMatch(code, /platformAdmin/i);
});

test('el intent no viaja en el token: JwtPayload sigue siendo solo `sub`', () => {
  const relativePath = join('auth', 'auth.types.ts');
  const code = readFileSync(join(SRC, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  assert.match(code, /interface JwtPayload \{\s*sub: string;\s*\}/);
  assert.deepEqual(readsIn(relativePath), []);
});

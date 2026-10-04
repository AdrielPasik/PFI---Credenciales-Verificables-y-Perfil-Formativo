/**
 * Guard estructural -- O1.
 *
 * Afirma UNA propiedad arquitectonica:
 *
 *     `onboardingIntent` NO es leido por ningun codigo de autorizacion
 *
 * POR QUE IMPORTA. `User.onboardingIntent` es la primera columna de `User` que
 * no es identidad pura, y su justificacion entera descansa en que **ningun
 * guard ni helper de autorizacion la lee**. Esa es la linea que separa
 * "preferencia de onboarding" de "autorizacion encubierta". Si manana alguien
 * escribiera:
 *
 *     if (user.onboardingIntent === 'institutional') {
 *       allowIssuerOperation();
 *     }
 *
 * el campo se convertiria en un permiso auto-asignable por el cliente -- que es
 * exactamente lo que el diseno prohibe. Este test lo rompe en voz alta.
 *
 * ALCANCE DELIBERADAMENTE ACOTADO. Se vigilan los archivos que DECIDEN
 * permisos, no el repositorio entero: `onboardingIntent` tiene usos
 * perfectamente legitimos en `AuthService` (persistirlo en register, leerlo
 * para `/auth/me`), en los DTOs, en el frontend y en los tests. Un guard
 * demasiado amplio prohibiria esos usos y seria abandonado en la primera
 * fricción.
 *
 * Se lee el codigo SIN comentarios: estos archivos documentan explicitamente
 * que NO usan el campo, y esa prosa es justamente lo que queremos conservar.
 * Lo que importa es si el simbolo se USA, no si se lo nombra para decir que no.
 * Mismo criterio que `reasoning-run/__guards__/private-api-boundary.test.ts`.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import test from 'node:test';

const SRC = join(__dirname, '..', '..');

/** El campo y su enum: ninguno debe aparecer en codigo de autorizacion. */
const FORBIDDEN_SYMBOLS = [/onboardingIntent/i, /UserOnboardingIntent/];

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

function executableCode(absolutePath: string): string {
  return readFileSync(absolutePath, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

function productionFilesIn(relativeDir: string): string[] {
  return readdirSync(join(SRC, relativeDir), {
    recursive: true,
    encoding: 'utf8'
  })
    .filter((entry) => entry.endsWith('.ts'))
    .filter((entry) => !entry.endsWith('.test.ts'))
    .map((entry) => join(relativeDir, entry.split('/').join(sep)));
}

// ---------------------------------------------------------------------------
// Control positivo
// ---------------------------------------------------------------------------

test('guard: el barrido alcanza los archivos de autorizacion reales', () => {
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
});

test('guard: el detector ignora prosa pero encuentra uso real', () => {
  // Sin esto, un helper roto que devolviera siempre vacio haria pasar el guard
  // de forma hueca.
  const prosa = '// onboardingIntent nunca se lee aca\n/** UserOnboardingIntent */\nconst x = 1;';
  const uso = 'if (user.onboardingIntent === "institutional") { allow(); }';

  const stripped = (code: string) =>
    code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  assert.equal(FORBIDDEN_SYMBOLS.some((rx) => rx.test(stripped(prosa))), false);
  assert.equal(FORBIDDEN_SYMBOLS.some((rx) => rx.test(stripped(uso))), true);
});

// ---------------------------------------------------------------------------
// O1 -- el intent no autoriza nada
// ---------------------------------------------------------------------------

test('onboardingIntent no aparece en ningun guard', () => {
  const offenders = AUTHORIZATION_FILES.filter((file) => {
    const code = executableCode(join(SRC, file));
    return FORBIDDEN_SYMBOLS.some((symbol) => symbol.test(code));
  });

  assert.deepEqual(
    offenders,
    [],
    'Un guard que lea onboardingIntent lo convierte en un permiso ' +
      'auto-asignable por el cliente.'
  );
});

for (const dir of AUTHORIZATION_DIRS) {
  test(`onboardingIntent no aparece en ningun archivo productivo de src/${dir}`, () => {
    const offenders = productionFilesIn(dir).filter((file) => {
      const code = executableCode(join(SRC, file));
      return FORBIDDEN_SYMBOLS.some((symbol) => symbol.test(code));
    });

    assert.deepEqual(offenders, []);
  });
}

test('IssuersService sigue autorizando SOLO por membership y estado del issuer', () => {
  // Positivo, no sólo negativo: que el campo no este no alcanza si el helper
  // dejara de mirar la membership. Esto ancla lo que SI debe seguir leyendo.
  const code = executableCode(join(SRC, 'issuers', 'issuers.service.ts'));

  assert.match(code, /issuerMembership\.findUnique/);
  assert.match(code, /IssuerMembershipStatus\.active/);
  assert.match(code, /IssuerMembershipRole\.admin/);
  assert.match(code, /IssuerAuthorizationStatus\.authorized/);
  // Y nada de los dos planos nuevos.
  assert.doesNotMatch(code, /onboardingIntent/i);
  assert.doesNotMatch(code, /platformAdmin/i);
});

test('el intent no viaja en el token: JwtPayload sigue siendo solo `sub`', () => {
  const code = executableCode(join(SRC, 'auth', 'auth.types.ts'));

  assert.match(code, /interface JwtPayload \{\s*sub: string;\s*\}/);
  assert.doesNotMatch(code, /onboardingIntent/i);
});

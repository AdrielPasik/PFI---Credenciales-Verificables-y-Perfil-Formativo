/**
 * Guard estructural de la SUPERFICIE DE ESCRITURA de PlatformAdmin -- slice S1.
 *
 * Afirma UNA propiedad arquitectonica:
 *
 *     ningun archivo productivo de services/api/src escribe la tabla
 *     PlatformAdmin
 *
 * POR QUE IMPORTA. La invariante "el cliente no puede autoasignarse privilegios
 * de plataforma" NO se sostiene aca con una validacion de DTO: se sostiene
 * porque no existe ningun camino de codigo que inserte una fila. La concesion es
 * out-of-band (S2, un script idempotente bajo `prisma/`), igual que hoy la
 * existencia de un Issuer es exclusivamente un hecho de seed. Un endpoint que
 * manana escribiera esta tabla convertiria una garantia estructural en una
 * garantia por revision de codigo -- y este test lo rompe en voz alta.
 *
 * ALCANCE DEL CLAIM. Lo que se afirma es "0 writers PRODUCTIVOS en
 * services/api/src". No se afirma que nadie pueda escribir la tabla: el rol
 * `scope_admin` puede, y es precisamente por ahi que S2 va a otorgar el primer
 * grant. `prisma/` queda deliberadamente FUERA del barrido -- es donde S2 va a
 * vivir, y es codigo operativo, no la superficie HTTP.
 *
 * POR QUE AST Y NO SUBSTRING. Un test que buscara `platformAdmin.create` como
 * texto se autodetectaria: este mismo archivo nombra los metodos prohibidos en
 * su lista y en su control positivo. Aca se recorre el AST y solo cuentan los
 * nodos `CallExpression`: un comentario, un JSDoc, un string literal y la
 * declaracion de un metodo no son llamadas. Mismo criterio y mismo helper que
 * `source-extraction/__guards__/source-extraction-production-callers.test.ts`,
 * que documenta esta decision en detalle.
 *
 * `typescript` ya es devDependency del paquete: no se agrego ninguna
 * dependencia.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const SRC = join(__dirname, '..', '..');

/** El delegate de Prisma que esta tabla expone. */
const DELEGATE = 'platformAdmin';

/**
 * Metodos de ESCRITURA del delegate.
 *
 * Los seis congelados por el contrato de S1 mas `createMany`, que es un metodo
 * de escritura real del cliente Prisma: dejarlo afuera seria un agujero en el
 * guard. Ampliar la lista solo lo vuelve mas estricto.
 *
 * Deliberadamente AUSENTES los de lectura (`findUnique`, `findFirst`,
 * `findMany`, `count`, `aggregate`): el guard de S1 es `PlatformAdminGuard`,
 * que LEE esta tabla en cada request y debe seguir pudiendo hacerlo.
 */
const FORBIDDEN_WRITE_METHODS = [
  'create',
  'createMany',
  'upsert',
  'update',
  'updateMany',
  'delete',
  'deleteMany'
] as const;

function productionSourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.ts'))
    .filter((entry) => !entry.endsWith('.test.ts'))
    .map((entry) => entry.split('/').join(sep));
}

/**
 * Nombre del ultimo segmento de una cadena de acceso, tomado del AST.
 *
 * Cubre `a.b`, `a?.b` y `a['b']`. Devuelve `null` para cualquier otra forma
 * (una llamada, un literal, un spread).
 */
function accessedName(node: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(node)) {
    return node.name.text;
  }

  if (
    ts.isElementAccessExpression(node) &&
    node.argumentExpression !== undefined &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return node.argumentExpression.text;
  }

  return null;
}

/**
 * Metodos de escritura invocados SOBRE el delegate `platformAdmin` en este
 * codigo.
 *
 * Detecta `<lo que sea>.platformAdmin.<metodo>(...)`, que es la forma que toman
 * todos los accesos a Prisma del repo: `this.prisma.x.y()`, `prisma.x.y()`,
 * `transaction.x.y()`, `tx.x.y()`.
 *
 * Lo que NO cubre -- y no puede cubrir un analisis sintactico -- es un despacho
 * totalmente dinamico por variable (`const d = prisma[name]; d[op](...)`). Es
 * una limitacion real y asumida: el objetivo es detectar un writer escrito de
 * la forma normal, no resistir a alguien que ofusque la llamada a proposito.
 */
function platformAdminWriteCalls(code: string, fileName: string): Set<string> {
  const source = ts.createSourceFile(
    fileName,
    code,
    ts.ScriptTarget.Latest,
    true
  );
  const found = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const method = accessedName(node.expression);

      if (method !== null) {
        const receiver = (
          node.expression as ts.PropertyAccessExpression | ts.ElementAccessExpression
        ).expression;

        if (
          accessedName(receiver) === DELEGATE &&
          (FORBIDDEN_WRITE_METHODS as readonly string[]).includes(method)
        ) {
          found.add(method);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

// ---------------------------------------------------------------------------
// Controles positivos: el detector detecta, y el barrido barre
// ---------------------------------------------------------------------------

test('guard: the AST detector finds real writes and ignores prose', () => {
  // Sin esto, un walker roto que no encontrara nada haria pasar el guard de
  // forma vacia. Este control lo impide, y ademas demuestra por que el guard
  // no se autodetecta: lo de abajo incluye el nombre prohibido en un
  // comentario, en un JSDoc y en un string, y ninguno cuenta.
  const detected = platformAdminWriteCalls(
    [
      '// prisma.platformAdmin.create en un comentario',
      '/** this.prisma.platformAdmin.upsert en JSDoc */',
      'const s = "prisma.platformAdmin.deleteMany en un string";',
      'declare const prisma: any;',
      'declare const tx: any;',
      'prisma.platformAdmin.findUnique({});',
      'prisma.platformAdmin.create({});',
      'tx.platformAdmin.upsert({});',
      "tx['platformAdmin']['delete']({});",
      'prisma.issuer.create({});'
    ].join('\n'),
    'probe.ts'
  );

  assert.ok(detected.has('create'), 'detecta acceso por propiedad');
  assert.ok(detected.has('upsert'), 'detecta el delegate sobre una transaccion');
  assert.ok(detected.has('delete'), 'detecta acceso por indice');
  assert.ok(
    !detected.has('findUnique'),
    'las lecturas no estan prohibidas: el guard de S1 lee esta tabla'
  );
  assert.ok(
    !detected.has('deleteMany'),
    'ni el comentario, ni el JSDoc, ni el string cuentan como llamada'
  );
  assert.ok(
    !detected.has('updateMany'),
    'un write sobre OTRO delegate (issuer) no cuenta'
  );
});

test('guard: the file sweep actually reaches production code', () => {
  const files = productionSourceFiles();

  assert.ok(files.length > 100, `barrido sospechosamente corto: ${files.length}`);
  assert.ok(
    files.includes(join('platform-admin', 'platform-admin.guard.ts')),
    'el guard esta en el barrido'
  );
  assert.ok(
    files.includes(join('issuers', 'issuers.service.ts')),
    'la autorizacion institucional esta en el barrido'
  );
  assert.ok(
    !files.some((file) => file.endsWith('.test.ts')),
    'los tests quedan fuera del barrido'
  );
});

// ---------------------------------------------------------------------------
// S1 -- 0 writers productivos
// ---------------------------------------------------------------------------

test('write-surface: no production file in services/api/src writes PlatformAdmin', () => {
  const writers = productionSourceFiles()
    .map((file) => ({
      file,
      methods: [
        ...platformAdminWriteCalls(readFileSync(join(SRC, file), 'utf8'), file)
      ].sort()
    }))
    .filter((entry) => entry.methods.length > 0);

  assert.deepEqual(
    writers,
    [],
    'La concesion de PlatformAdmin es out-of-band (S2). Un writer productivo ' +
      'convierte una garantia estructural en una garantia por revision: ' +
      writers.map((w) => `${w.file} (${w.methods.join(', ')})`).join('; ')
  );
});

test('write-surface: PlatformAdminGuard only READS the table', () => {
  const guardFile = join('platform-admin', 'platform-admin.guard.ts');
  const code = readFileSync(join(SRC, guardFile), 'utf8');

  assert.deepEqual([...platformAdminWriteCalls(code, guardFile)], []);
  // Y la lectura existe: un guard que no consultara nada autorizaria de forma
  // vacia.
  assert.match(code, /platformAdmin\.findUnique/);
});

// ---------------------------------------------------------------------------
// Separacion de planos: IssuersService no gana ningun bypass
// ---------------------------------------------------------------------------

test('plane separation: issuers.service.ts never mentions platformAdmin in executable code', () => {
  // La autorizacion institucional debe seguir dependiendo EXCLUSIVAMENTE de
  // User + IssuerMembership + status/role + estado del Issuer. Se mira el
  // codigo sin comentarios: el dia que ese archivo documente esta frontera en
  // prosa, la prosa no debe hacer fallar el guard.
  const code = readFileSync(join(SRC, 'issuers', 'issuers.service.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  assert.doesNotMatch(code, /platformAdmin/i);
  assert.doesNotMatch(code, /PlatformAdminGuard/);
});

test('plane separation: no institutional module imports PlatformAdminGuard', () => {
  // PlatformAdminGuard pertenece al plano de plataforma y solo debe aplicarse a
  // rutas /admin. Si apareciera en un controller issuers/:issuerId/*, un
  // PlatformAdmin pasaria a poder operar un issuer sin membership.
  const INSTITUTIONAL_DIRS = [
    'issuers',
    'credentials',
    'catalog',
    'document-evidence',
    'text-evidence',
    'analysis-run',
    'issuer-course-templates',
    'reusable-semantic-interpretation',
    'semantic',
    'me',
    'profiles',
    'profile-sharing',
    'verification',
    'public-verification',
    'objectives',
    'reasoning-run',
    'auth'
  ];

  const offenders = productionSourceFiles()
    .filter((file) => INSTITUTIONAL_DIRS.includes(file.split(sep)[0]))
    .filter((file) => {
      const code = readFileSync(join(SRC, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ');
      return /PlatformAdminGuard|platform-admin/.test(code);
    });

  assert.deepEqual(offenders, []);
});

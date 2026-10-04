/**
 * Guard estructural READ-ONLY de /admin -- slice S3.
 *
 * Afirma UNA propiedad arquitectonica:
 *
 *     ningun archivo productivo de src/platform-admin escribe
 *     Issuer, IssuerMembership, User, PlatformAdmin ni AuditLog
 *
 * POR QUE IMPORTA. S3 es deliberadamente una superficie de observacion: el
 * provisioning llega despues (S5a/S5b) y va a traer sus propias garantias
 * transaccionales y su propio AuditLog. Si una lectura administrativa ganara un
 * `.update` por conveniencia -- "aprovecho y marco el issuer como visto" --
 * habria una mutacion de dominio sin transaccion, sin auditoria y sin test. Este
 * guard lo rompe en voz alta.
 *
 * COMPLEMENTA, NO REEMPLAZA, al guard de S1
 * (`platform-admin-write-surface.test.ts`), que afirma algo distinto y mas
 * fuerte: que NINGUN archivo de todo `src/` escribe `PlatformAdmin`. Ese sigue
 * vigente y no se relaja. Este acota el alcance a `src/platform-admin` pero
 * cubre cinco delegates en vez de uno.
 *
 * POR QUE AST Y NO SUBSTRING. Mismo motivo que en S1: este archivo nombra los
 * metodos prohibidos en su propia lista, asi que un grep se autodetectaria. Se
 * recorre el AST y solo cuentan los nodos `CallExpression`. Mismo helper y mismo
 * criterio que `source-extraction/__guards__/`.
 *
 * `typescript` ya es devDependency: no se agrego ninguna dependencia.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const PLATFORM_ADMIN_DIR = __dirname.replace(`${sep}__guards__`, '');

/** Delegates cuyo estado NO debe mutar ninguna lectura administrativa. */
const GUARDED_DELEGATES = [
  'issuer',
  'issuerMembership',
  'user',
  'platformAdmin',
  'auditLog'
] as const;

const FORBIDDEN_WRITE_METHODS = [
  'create',
  'createMany',
  'upsert',
  'update',
  'updateMany',
  'delete',
  'deleteMany'
] as const;

function productionSourceFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.ts'))
    .filter((entry) => !entry.endsWith('.test.ts'))
    .map((entry) => entry.split('/').join(sep));
}

/** Ultimo segmento de una cadena de acceso: cubre `a.b`, `a?.b` y `a['b']`. */
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
 * Escrituras `<...>.<delegate>.<metodo>(...)` encontradas en el AST.
 *
 * No cubre despacho totalmente dinamico por variable; es una limitacion real y
 * asumida, igual que en el guard de S1.
 */
function forbiddenWrites(code: string, fileName: string): string[] {
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

      if (
        method !== null &&
        (FORBIDDEN_WRITE_METHODS as readonly string[]).includes(method)
      ) {
        const receiver = (
          node.expression as
            | ts.PropertyAccessExpression
            | ts.ElementAccessExpression
        ).expression;
        const delegate = accessedName(receiver);

        if (
          delegate !== null &&
          (GUARDED_DELEGATES as readonly string[]).includes(delegate)
        ) {
          found.add(`${delegate}.${method}`);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
  return [...found].sort();
}

// ---------------------------------------------------------------------------
// Controles positivos
// ---------------------------------------------------------------------------

test('guard: el detector encuentra escrituras reales e ignora prosa', () => {
  const detected = forbiddenWrites(
    [
      '// prisma.issuer.update en un comentario',
      '/** tx.issuerMembership.create en JSDoc */',
      'const s = "prisma.auditLog.create en un string";',
      'declare const prisma: any;',
      'declare const tx: any;',
      'prisma.issuer.findMany({});',
      'prisma.issuer.findUnique({});',
      'prisma.issuerMembership.groupBy({});',
      'prisma.issuer.update({});',
      'tx.auditLog.create({});',
      "tx['user']['delete']({});",
      'prisma.credential.update({});'
    ].join('\n'),
    'probe.ts'
  );

  assert.deepEqual(detected, [
    'auditLog.create',
    'issuer.update',
    'user.delete'
  ]);
  // Las lecturas no se marcan: /admin tiene que poder leer.
  assert.equal(detected.includes('issuer.findMany'), false);
  // Un delegate fuera de la lista no se marca: este guard acota su claim.
  assert.equal(detected.some((entry) => entry.startsWith('credential.')), false);
});

test('guard: el barrido alcanza los archivos productivos de S3', () => {
  const files = productionSourceFiles(PLATFORM_ADMIN_DIR);

  assert.ok(
    files.includes('platform-admin-read.service.ts'),
    'el service de lectura esta en el barrido'
  );
  assert.ok(
    files.includes('platform-admin-issuers.controller.ts'),
    'el controller esta en el barrido'
  );
  assert.ok(
    files.includes('platform-admin.guard.ts'),
    'el guard esta en el barrido'
  );
  assert.ok(
    !files.some((file) => file.endsWith('.test.ts')),
    'los tests quedan fuera del barrido'
  );
});

// ---------------------------------------------------------------------------
// S3 -- la superficie administrativa es read-only
// ---------------------------------------------------------------------------

test('read-only: ningun archivo de src/platform-admin muta Issuer, IssuerMembership, User, PlatformAdmin ni AuditLog', () => {
  const writers = productionSourceFiles(PLATFORM_ADMIN_DIR)
    .map((file) => ({
      file,
      writes: forbiddenWrites(
        readFileSync(join(PLATFORM_ADMIN_DIR, file), 'utf8'),
        file
      )
    }))
    .filter((entry) => entry.writes.length > 0);

  assert.deepEqual(
    writers,
    [],
    'S3 es READ-ONLY. Las mutaciones administrativas llegan en S5a/S5b, con ' +
      'transaccion y AuditLog propios: ' +
      writers.map((w) => `${w.file} (${w.writes.join(', ')})`).join('; ')
  );
});

test('read-only: el service de lectura no abre ninguna transaccion', () => {
  // Una lectura no necesita `$transaction`. Si apareciera, seria la senal de
  // que algo dejo de ser una lectura.
  const code = readFileSync(
    join(PLATFORM_ADMIN_DIR, 'platform-admin-read.service.ts'),
    'utf8'
  )
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  assert.doesNotMatch(code, /\$transaction/);
  assert.doesNotMatch(code, /\$executeRaw/);
  assert.doesNotMatch(code, /\$queryRaw/);
});

test('read-only: el service de lectura NO pasa por IssuersService', () => {
  // Deliberado y verificable: estas lecturas son de plataforma. Si importaran
  // IssuersService, un Platform Admin no podria observar un issuer del que no
  // es miembro, que es justamente para lo que existen estos endpoints.
  const code = readFileSync(
    join(PLATFORM_ADMIN_DIR, 'platform-admin-read.service.ts'),
    'utf8'
  )
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');

  assert.doesNotMatch(code, /IssuersService/);
  assert.doesNotMatch(code, /assertUserCan/);
});

test('read-only: S3 no escribe AuditLog en ningun GET', () => {
  // El unico writer de AuditLog del repo sigue siendo el bootstrap de S2, que
  // vive fuera de src/.
  const offenders = productionSourceFiles(PLATFORM_ADMIN_DIR).filter((file) =>
    forbiddenWrites(
      readFileSync(join(PLATFORM_ADMIN_DIR, file), 'utf8'),
      file
    ).some((entry) => entry.startsWith('auditLog.'))
  );

  assert.deepEqual(offenders, []);
});

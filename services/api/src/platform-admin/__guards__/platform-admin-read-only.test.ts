/**
 * Guard estructural de la WRITE SURFACE de /admin -- S3, ampliado en S5a y S5b.
 *
 * Afirma UNA propiedad arquitectonica:
 *
 *     src/platform-admin es READ-ONLY, EXCEPTO una write surface
 *     explicitamente allowlisted POR ARCHIVO Y POR OPERACION
 *
 * La allowlist vive en `WRITE_SURFACE_ALLOWLIST` / `TRANSACTION_ALLOWLIST` y es
 * deliberadamente MINIMA -- DOS archivos en total:
 *
 *   - S5a (`platform-admin-membership-grant.service.ts`): `$transaction` +
 *     `issuerMembership.create` + `auditLog.create`;
 *   - S5b (`platform-admin-issuer-provision.service.ts`): lo mismo mas
 *     `issuer.create`.
 *
 * Nada mas, en ningun archivo.
 *
 * POR QUE NO SE DEBILITO LA REGLA. S3 y S4 son superficies de observacion y
 * tienen que seguir siendolo: si una lectura administrativa ganara un `.update`
 * por conveniencia -- "aprovecho y marco el issuer como visto" -- habria una
 * mutacion de dominio sin transaccion, sin auditoria y sin test. S5a necesita
 * escribir, pero eso no convierte al modulo en escribible: convierte a UN
 * archivo en escribible para TRES operaciones. Lo que este guard impide, en
 * particular, es que el propio writer de S5a crezca hacia
 * `issuerMembership.update/delete/upsert`, hacia Users, hacia Issuers, hacia
 * `PlatformAdmin` o hacia un `auditLog.update/delete` -- que serian,
 * respectivamente, reactivacion silenciosa de memberships, mutacion de
 * identidades, auto-otorgamiento de capacidad de plataforma y reescritura de la
 * auditoria.
 *
 * Y lo que impide en S5b, en particular, es que el writer del alta gane
 * `issuer.update`: con esa sola operacion mas, el plano de plataforma podria
 * reautorizar un issuer revocado, renombrar una institucion existente o
 * escribirle `did`/`walletAddress` -- es decir, configurar identidad tecnica
 * sin pasar por ningun provisioning criptografico. S5b puede CREAR issuers;
 * no puede TOCAR los que ya existen.
 *
 * COMPLEMENTA, NO REEMPLAZA, al guard de S1
 * (`platform-admin-write-surface.test.ts`), que afirma algo distinto y mas
 * fuerte: que NINGUN archivo de todo `src/` escribe `PlatformAdmin`. Ese sigue
 * vigente y no se relaja -- y notar que la allowlist de S5a NO lo toca: el
 * writer de S5a no puede escribir `PlatformAdmin` ni aqui ni alla. Este acota
 * el alcance a `src/platform-admin` pero cubre cinco delegates en vez de uno.
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

/**
 * LA WRITE SURFACE ALLOWLISTED -- S5a.
 *
 * Mapa de archivo -> conjunto EXACTO de `delegate.metodo` permitidos. Un
 * archivo ausente del mapa no puede escribir nada; un archivo presente no puede
 * hacer una escritura que no este en su conjunto.
 *
 * Agregar una entrada o ampliar un conjunto tiene que ser un acto consciente,
 * con su propio slice y sus propios tests de atomicidad y auditoria.
 */
const WRITE_SURFACE_ALLOWLIST = new Map<string, ReadonlySet<string>>([
  [
    'platform-admin-membership-grant.service.ts',
    new Set(['issuerMembership.create', 'auditLog.create'])
  ],
  // S5b: alta de un Issuer con su primer admin. UNA operacion mas que S5a
  // -- `issuer.create` -- y ninguna otra. En particular NO `issuer.update`:
  // este archivo puede CREAR un issuer, nunca modificar uno existente, asi que
  // no puede reautorizar, renombrar ni configurarle identidad tecnica a un
  // issuer que ya esta en la base.
  [
    'platform-admin-issuer-provision.service.ts',
    new Set(['issuer.create', 'issuerMembership.create', 'auditLog.create'])
  ]
]);

/**
 * Los unicos archivos que pueden abrir una transaccion.
 *
 * Una lectura no necesita `$transaction`; si apareciera en un archivo de
 * lectura, seria la senal de que dejo de ser una lectura. El writer de S5a SI
 * la necesita: membership y AuditLog tienen que ser atomicos.
 */
const TRANSACTION_ALLOWLIST: ReadonlySet<string> = new Set([
  'platform-admin-membership-grant.service.ts',
  'platform-admin-issuer-provision.service.ts'
]);

/** SQL crudo: prohibido en TODO el modulo, sin excepciones. */
const RAW_SQL_PATTERN = /\$executeRaw|\$queryRaw|\$executeRawUnsafe|\$queryRawUnsafe/;

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
  // S4
  assert.ok(
    files.includes('platform-admin-user-resolution.service.ts'),
    'el service de resolucion de S4 esta en el barrido'
  );
  assert.ok(
    files.includes('platform-admin-user-resolution.controller.ts'),
    'el controller de resolucion de S4 esta en el barrido'
  );
  assert.ok(
    files.includes('resolve-platform-admin-user.validator.ts'),
    'el validador de S4 esta en el barrido'
  );
  // S5a
  assert.ok(
    files.includes('platform-admin-membership-grant.service.ts'),
    'el writer de S5a esta en el barrido'
  );
  assert.ok(
    files.includes('platform-admin-membership-grant.controller.ts'),
    'el controller de S5a esta en el barrido'
  );
  assert.ok(
    files.includes('grant-platform-admin-membership.validator.ts'),
    'el validador de S5a esta en el barrido'
  );
  // S5b
  assert.ok(
    files.includes('platform-admin-issuer-provision.service.ts'),
    'el writer de S5b esta en el barrido'
  );
  assert.ok(
    files.includes('platform-admin-issuer-provision.controller.ts'),
    'el controller de S5b esta en el barrido'
  );
  assert.ok(
    files.includes('provision-platform-admin-issuer.validator.ts'),
    'el validador de S5b esta en el barrido'
  );
  assert.ok(
    !files.some((file) => file.endsWith('.test.ts')),
    'los tests quedan fuera del barrido'
  );
});

// ---------------------------------------------------------------------------
// S3 -- la superficie administrativa es read-only
// ---------------------------------------------------------------------------

test('write-surface: cada escritura de src/platform-admin esta en la allowlist de su archivo', () => {
  const offenders = productionSourceFiles(PLATFORM_ADMIN_DIR)
    .map((file) => {
      const allowed =
        WRITE_SURFACE_ALLOWLIST.get(file) ?? new Set<string>();
      const writes = forbiddenWrites(
        readFileSync(join(PLATFORM_ADMIN_DIR, file), 'utf8'),
        file
      );
      return { file, unexpected: writes.filter((write) => !allowed.has(write)) };
    })
    .filter((entry) => entry.unexpected.length > 0);

  assert.deepEqual(
    offenders,
    [],
    'Toda escritura en src/platform-admin tiene que estar allowlisted por ' +
      'archivo y por operacion: ' +
      offenders.map((o) => `${o.file} (${o.unexpected.join(', ')})`).join('; ')
  );
});

test('write-surface: el writer de S5a solo puede hacer SUS DOS escrituras, nada mas', () => {
  // Control explicito y positivo sobre el unico archivo escribible: no basta
  // con que "no haya sorpresas", hay que afirmar QUE hace y que NO hace.
  const file = 'platform-admin-membership-grant.service.ts';
  const writes = forbiddenWrites(
    readFileSync(join(PLATFORM_ADMIN_DIR, file), 'utf8'),
    file
  );

  assert.deepEqual(writes, ['auditLog.create', 'issuerMembership.create']);

  // Lo que el writer NUNCA puede hacer, enumerado para que el fallo sea legible.
  for (const forbidden of [
    'issuerMembership.update',
    'issuerMembership.updateMany',
    'issuerMembership.upsert',
    'issuerMembership.delete',
    'issuerMembership.deleteMany',
    'auditLog.update',
    'auditLog.delete',
    'auditLog.deleteMany',
    'user.create',
    'user.update',
    'user.updateMany',
    'user.delete',
    'issuer.create',
    'issuer.update',
    'issuer.updateMany',
    'issuer.delete',
    'platformAdmin.create',
    'platformAdmin.update',
    'platformAdmin.delete'
  ]) {
    assert.equal(
      writes.includes(forbidden),
      false,
      `el writer de S5a no debe hacer ${forbidden}`
    );
  }
});

test('write-surface: el writer de S5b solo puede hacer SUS TRES escrituras, nada mas', () => {
  // Control explicito y positivo sobre el segundo archivo escribible. La
  // diferencia con S5a es UNA operacion: `issuer.create`.
  const file = 'platform-admin-issuer-provision.service.ts';
  const writes = forbiddenWrites(
    readFileSync(join(PLATFORM_ADMIN_DIR, file), 'utf8'),
    file
  );

  assert.deepEqual(writes, [
    'auditLog.create',
    'issuer.create',
    'issuerMembership.create'
  ]);

  // Lo que el writer de S5b NUNCA puede hacer, enumerado para que el fallo sea
  // legible. `issuer.update` encabeza la lista a proposito: es la unica
  // operacion que convertiria el alta de issuers en mutacion de issuers
  // existentes (reautorizar, renombrar, configurar DID o wallet).
  for (const forbidden of [
    'issuer.update',
    'issuer.updateMany',
    'issuer.upsert',
    'issuer.delete',
    'issuer.deleteMany',
    'issuerMembership.update',
    'issuerMembership.updateMany',
    'issuerMembership.upsert',
    'issuerMembership.delete',
    'issuerMembership.deleteMany',
    'auditLog.update',
    'auditLog.delete',
    'auditLog.deleteMany',
    'user.create',
    'user.update',
    'user.updateMany',
    'user.delete',
    'user.deleteMany',
    'platformAdmin.create',
    'platformAdmin.update',
    'platformAdmin.delete'
  ]) {
    assert.equal(
      writes.includes(forbidden),
      false,
      `el writer de S5b no debe hacer ${forbidden}`
    );
  }
});

test('write-surface: SOLO el writer de S5b puede crear Issuers', () => {
  // El claim central de S5b como provisioning CONTROLADO: `issuer.create` no
  // es una operacion que pueda aparecer en cualquier lado del modulo. Un
  // segundo archivo que la gane seria una segunda puerta de alta de
  // instituciones, posiblemente sin auditoria y sin transaccion.
  const creators = productionSourceFiles(PLATFORM_ADMIN_DIR).filter((file) =>
    forbiddenWrites(
      readFileSync(join(PLATFORM_ADMIN_DIR, file), 'utf8'),
      file
    ).includes('issuer.create')
  );

  assert.deepEqual(creators, ['platform-admin-issuer-provision.service.ts']);
});

test('write-surface: la allowlist es minima -- dos archivos, cinco operaciones', () => {
  // Si manana alguien agrega una entrada o amplia un conjunto, este test lo
  // obliga a hacerlo de forma consciente y visible en el diff.
  assert.deepEqual(
    [...WRITE_SURFACE_ALLOWLIST.keys()].sort(),
    [
      'platform-admin-issuer-provision.service.ts',
      'platform-admin-membership-grant.service.ts'
    ]
  );
  assert.deepEqual(
    [...(WRITE_SURFACE_ALLOWLIST.get('platform-admin-membership-grant.service.ts') ?? [])].sort(),
    ['auditLog.create', 'issuerMembership.create']
  );
  assert.deepEqual(
    [...(WRITE_SURFACE_ALLOWLIST.get('platform-admin-issuer-provision.service.ts') ?? [])].sort(),
    ['auditLog.create', 'issuer.create', 'issuerMembership.create']
  );
  // Ninguna operacion de MUTACION (update/upsert/delete) en ninguna entrada.
  for (const [file, operations] of WRITE_SURFACE_ALLOWLIST) {
    for (const operation of operations) {
      assert.match(
        operation,
        /\.create$/,
        `${file}: la write surface de /admin es CREATE-ONLY, y ${operation} no lo es`
      );
    }
  }
  assert.deepEqual([...TRANSACTION_ALLOWLIST].sort(), [
    'platform-admin-issuer-provision.service.ts',
    'platform-admin-membership-grant.service.ts'
  ]);
});

test('write-surface: todos los demas archivos del modulo siguen siendo read-only', () => {
  const readOnlyFiles = productionSourceFiles(PLATFORM_ADMIN_DIR).filter(
    (file) => !WRITE_SURFACE_ALLOWLIST.has(file)
  );

  // El barrido tiene que seguir alcanzando los archivos de S3/S4, no sólo al
  // writer.
  assert.ok(
    readOnlyFiles.includes('platform-admin-read.service.ts'),
    'el service de lectura de S3 sigue en el barrido'
  );
  assert.ok(
    readOnlyFiles.includes('platform-admin-user-resolution.service.ts'),
    'el service de resolucion de S4 sigue en el barrido'
  );

  const writers = readOnlyFiles
    .map((file) => ({
      file,
      writes: forbiddenWrites(
        readFileSync(join(PLATFORM_ADMIN_DIR, file), 'utf8'),
        file
      )
    }))
    .filter((entry) => entry.writes.length > 0);

  assert.deepEqual(writers, []);
});

/** El codigo de un archivo del directorio, SIN comentarios. */
function executableCode(file: string): string {
  return readFileSync(join(PLATFORM_ADMIN_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

test('write-surface: solo el writer de S5a abre transacciones', () => {
  // S4 habia generalizado esta asercion al directorio entero. S5a la convierte
  // en allowlist en vez de borrarla: el writer la necesita (membership y
  // AuditLog tienen que ser atomicos), todo lo demas no.
  const offenders = productionSourceFiles(PLATFORM_ADMIN_DIR).filter(
    (file) =>
      !TRANSACTION_ALLOWLIST.has(file) &&
      /\$transaction/.test(executableCode(file))
  );

  assert.deepEqual(offenders, []);
});

test('write-surface: el writer de S5a SI abre una transaccion -- la atomicidad no es opcional', () => {
  // Positivo, no sólo negativo: si el writer dejara de usar `$transaction`, la
  // membership y el AuditLog pasarian a ser best-effort y este guard no lo
  // notaria con una asercion puramente negativa.
  const code = executableCode('platform-admin-membership-grant.service.ts');

  assert.match(code, /\$transaction/);
  assert.match(code, /transaction\.issuerMembership\.create/);
  assert.match(code, /transaction\.auditLog\.create/);
});

test('write-surface: el writer de S5b SI abre una transaccion -- las cuatro filas son atomicas', () => {
  // Issuer + membership + dos AuditLog. Sin `$transaction` el provisioning
  // parcial pasaria a ser posible: un Issuer `authorized` sin ningun admin, o
  // con admin pero sin auditoria del alta.
  const code = executableCode('platform-admin-issuer-provision.service.ts');

  assert.match(code, /\$transaction/);
  assert.match(code, /transaction\.issuer\.create/);
  assert.match(code, /transaction\.issuerMembership\.create/);
  assert.match(code, /transaction\.auditLog\.create/);
});

test('read-only: SQL crudo sigue prohibido en TODO el modulo, sin excepciones', () => {
  const offenders = productionSourceFiles(PLATFORM_ADMIN_DIR).filter((file) =>
    RAW_SQL_PATTERN.test(executableCode(file))
  );

  assert.deepEqual(offenders, []);
});

test('read-only: ningun archivo de src/platform-admin pasa por IssuersService', () => {
  // Deliberado y verificable: todo lo que vive aca es PLANO DE PLATAFORMA. Si
  // importara IssuersService, un Platform Admin no podria observar ni resolver
  // nada sin ser miembro del issuer -- justamente lo contrario de para lo que
  // existen estos endpoints. Y en la direccion inversa, el guard de S3 ya
  // comprueba que ningun modulo institucional importe PlatformAdminGuard.
  //
  // Esta invariante NO caduca en S5a: el provisioning tampoco debe pasar por
  // la autorizacion institucional.
  const offenders = productionSourceFiles(PLATFORM_ADMIN_DIR).filter((file) =>
    /IssuersService|assertUserCan|assertIssuerCanIssue/.test(executableCode(file))
  );

  assert.deepEqual(offenders, []);
});

test('read-only: ninguna LECTURA administrativa escribe AuditLog', () => {
  // Auditar un GET no registraria ninguna decision y solo haria crecer la
  // tabla. El unico writer de AuditLog dentro de `src/` es el de S5a, que
  // audita una MUTACION; el otro writer del repo es el bootstrap de S2, que
  // vive fuera de `src/`.
  const offenders = productionSourceFiles(PLATFORM_ADMIN_DIR)
    .filter((file) => !WRITE_SURFACE_ALLOWLIST.has(file))
    .filter((file) =>
      forbiddenWrites(
        readFileSync(join(PLATFORM_ADMIN_DIR, file), 'utf8'),
        file
      ).some((entry) => entry.startsWith('auditLog.'))
    );

  assert.deepEqual(offenders, []);
});

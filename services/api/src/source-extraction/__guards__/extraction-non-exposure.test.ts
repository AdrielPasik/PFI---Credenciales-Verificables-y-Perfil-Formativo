/**
 * No exposicion de la extraccion source-addressable — F1.5 §5, §6, §13, §14.
 *
 * Regla de F1: los internals de source extraction son INTERNAL_ONLY_IN_F1. No
 * salen por verificacion publica, sharing, ni superficies de holder o issuer, y
 * eso NO depende de que holder e issuer tengan permiso sobre la credencial:
 * depende de que F1 todavia no definio el contrato de UX/API para presentar
 * excerpts. Cuando F2+ lo diseñe, se diseña; hasta entonces no se filtra por
 * accidente.
 *
 * ALCANCE DELIBERADAMENTE ACOTADO (§14). El barrido cubre SOLO la frontera de
 * salida, en cualquier profundidad bajo `src/`:
 *
 *     ficheros terminados en `.controller.ts`
 *     ficheros terminados en `.mapper.ts`
 *     cualquier fichero dentro de una carpeta `dto`
 *
 * Prohibir estos identificadores en todo `src/` seria falso: los servicios
 * internos —el trust gate, el repositorio del slot, el orquestador— los usan
 * legitimamente, que es justamente su trabajo. La frontera de carpetas del repo
 * es lo bastante clara como para que este guard sea util y no fragil.
 *
 * SOLO IDENTIFICADORES ESPECIFICOS. `pages`, `segments` o `diagnostics` son
 * demasiado genericos para prohibirlos por nombre —un DTO paginado tiene
 * `pages`— y su cobertura vive en los tests de endpoint concretos.
 *
 * AST Y NO SUBSTRING: un chequeo por texto se auto-detectaria con esta misma
 * lista escrita arriba.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const SRC = join(__dirname, '..', '..');

/**
 * Identificadores que no pueden aparecer en la frontera de salida.
 *
 * Los tres primeros son las columnas del slot de F1.1. Los siguientes son el
 * material de fuente del artifact de F0. `storageKey` es la ubicacion fisica del
 * documento: nunca fue parte de ninguna respuesta y no debe empezar a serlo.
 */
const FORBIDDEN_AT_THE_BOUNDARY = [
  'extractionArtifactCanonicalJson',
  'artifactBlobSha256',
  'extractionDerivationTrust',
  'canonicalText',
  'documentCanonicalText',
  'exactExcerpt',
  'storageKey'
] as const;

/**
 * Slices cuyos excerpts NO son material de extraccion, y por que.
 *
 * El sujeto de este guard es el artifact de source extraction: el texto canonico
 * de un DOCUMENTO DE CREDENCIAL. `exactExcerpt`, `charStart`, `charEnd` y
 * `offsetUnit` estan prohibidos en la frontera porque nombrar esos campos ahi
 * significa, en todo el resto del repo, haber traido material de extraccion.
 *
 * P2.2 rompe esa equivalencia por primera vez: la propuesta de Requirements
 * ancla citas del TEXTO QUE EL PROPIO HOLDER acaba de pegar en el pedido. Ese
 * texto nunca fue un documento, nunca paso por extraccion y no esta cubierto por
 * INTERNAL_ONLY_IN_F1 — es el caso que la cabecera de este fichero anticipaba
 * cuando decia que F2+ diseñaria su contrato de presentacion de excerpts.
 *
 * LA EXCLUSION NO ES UNA PROMESA. El control de mas abajo comprueba que cada
 * slice excluido sea INCAPAZ de alcanzar extraccion o evidencia: si alguien le
 * agregara ese import, el guard vuelve a morder.
 */
const SLICES_WITH_NON_EXTRACTION_EXCERPTS = ['objective-requirement-proposal'] as const;

/** Dominios cuyo material SI esta cubierto por INTERNAL_ONLY_IN_F1. */
const EXTRACTION_REACHABLE_DOMAINS = [
  'source-extraction',
  'document-evidence',
  'text-evidence',
  'credentials',
  'analysis-run',
  'semantic'
];

function allProductionFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((entry) => entry.split('/').join(sep))
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'));
}

function isExcludedSlice(entry: string): boolean {
  return SLICES_WITH_NON_EXTRACTION_EXCERPTS.some((slice) =>
    entry.startsWith(`${slice}${sep}`)
  );
}

function boundaryFiles(): string[] {
  return allProductionFiles()
    .filter(
      (entry) =>
        entry.endsWith('.controller.ts') ||
        entry.endsWith('.mapper.ts') ||
        entry.includes(`${sep}dto${sep}`)
    )
    .filter((entry) => !isExcludedSlice(entry));
}

/**
 * Nombres significativos del codigo, tomados del AST.
 *
 * Se recogen identificadores, nombres de propiedad y literales de cadena —un
 * `select` de Prisma y una clave de DTO son ambas cosas—, pero NO el texto de los
 * comentarios: un comentario que nombre un campo no lo expone.
 */
function meaningfulNames(code: string, fileName: string): Set<string> {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      names.add(node.text);
    } else if (ts.isStringLiteralLike(node)) {
      names.add(node.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return names;
}

// ---------------------------------------------------------------------------
// Controles: el guard no puede pasar de forma vacia
// ---------------------------------------------------------------------------

test('control: the AST detector finds boundary names and ignores comments', () => {
  const detected = meaningfulNames(
    [
      '// storageKey mencionado en un comentario',
      '/** canonicalText en JSDoc */',
      'export interface Dto { exactExcerpt: string; }',
      "export const select = { extractionDerivationTrust: true };"
    ].join('\n'),
    'probe.ts'
  );

  assert.ok(detected.has('exactExcerpt'), 'detecta un campo de interfaz');
  assert.ok(detected.has('extractionDerivationTrust'), 'detecta una clave de select');
  assert.ok(!detected.has('storageKey'), 'un comentario no expone nada');
  assert.ok(!detected.has('canonicalText'), 'el JSDoc tampoco');
});

test('control: the sweep really reaches controllers, mappers and DTOs', () => {
  const files = boundaryFiles();

  assert.ok(files.length > 20, `barrido sospechosamente corto: ${files.length}`);
  for (const expected of [
    join('semantic', 'semantic.controller.ts'),
    join('semantic', 'dto', 'latest-semantic-analysis-response.dto.ts'),
    join('verification', 'verification.controller.ts'),
    join('profile-sharing', 'profile-sharing.controller.ts'),
    join('me', 'me.controller.ts'),
    join('document-evidence', 'document-evidence.mapper.ts'),
    join('analysis-run', 'issuer-analysis-run-read.mapper.ts')
  ]) {
    assert.ok(files.includes(expected), `falta ${expected} en el barrido`);
  }
});

test('control: every excluded slice is really unable to reach extraction', () => {
  // El unico modo de que la exclusion sea honesta es que el slice excluido NO
  // TENGA de donde sacar material de extraccion. Si manaña alguien le agrega el
  // import, este control falla y la exclusion deja de estar justificada.
  assert.ok(SLICES_WITH_NON_EXTRACTION_EXCERPTS.length > 0, 'lista vacia: quitar el mecanismo');

  for (const slice of SLICES_WITH_NON_EXTRACTION_EXCERPTS) {
    const files = allProductionFiles().filter((entry) => entry.startsWith(`${slice}${sep}`));
    assert.ok(files.length > 0, `el slice excluido ${slice} no existe`);

    for (const file of files) {
      const code = readFileSync(join(SRC, file), 'utf8');
      const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);

      const visit = (node: ts.Node): void => {
        if (
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier !== undefined &&
          ts.isStringLiteral(node.moduleSpecifier)
        ) {
          const specifier = node.moduleSpecifier.text;
          for (const domain of EXTRACTION_REACHABLE_DOMAINS) {
            assert.ok(
              !specifier.includes(`/${domain}/`) && !specifier.startsWith(`../${domain}`),
              `${file} importa ${specifier}: el slice ya alcanza extraccion y no puede seguir excluido`
            );
          }
        }
        ts.forEachChild(node, visit);
      };

      visit(source);
    }
  }
});

test('control: the exclusion does not hide the identifiers it was written for', () => {
  // Se excluyen excerpts de OTRO sujeto, no los campos del slot ni el fichero
  // fisico: esos siguen prohibidos incluso dentro del slice excluido.
  const siguenProhibidos = [
    'extractionArtifactCanonicalJson',
    'artifactBlobSha256',
    'extractionDerivationTrust',
    'canonicalText',
    'documentCanonicalText',
    'storageKey'
  ];

  for (const slice of SLICES_WITH_NON_EXTRACTION_EXCERPTS) {
    const files = allProductionFiles().filter((entry) => entry.startsWith(`${slice}${sep}`));
    for (const file of files) {
      const names = meaningfulNames(readFileSync(join(SRC, file), 'utf8'), file);
      for (const forbidden of siguenProhibidos) {
        assert.ok(!names.has(forbidden), `${file} nombra ${forbidden}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// §5, §6, §7, §13 — La frontera de salida no nombra internals de extraccion
// ---------------------------------------------------------------------------

for (const forbidden of FORBIDDEN_AT_THE_BOUNDARY) {
  test(`boundary: no controller, mapper or DTO mentions ${forbidden}`, () => {
    const offenders = boundaryFiles().filter((file) =>
      meaningfulNames(readFileSync(join(SRC, file), 'utf8'), file).has(forbidden)
    );

    assert.deepEqual(
      offenders,
      [],
      `${forbidden} aparece en la frontera de salida: ${offenders.join(', ')}`
    );
  });
}

test('boundary: no DTO declares a field of the source extraction artifact', () => {
  // Complementa lo anterior mirando el artifact de F0 desde el otro lado: se
  // toman los nombres de campo reales de sus tipos y se comprueba que los mas
  // especificos no hayan cruzado a un DTO.
  const artifactFields = [
    'sourceNormalizationApplied',
    'offsetUnit',
    'coverageStatus',
    'artifactContentFingerprint',
    'extractionIdentity',
    'segmentId',
    'charStart',
    'charEnd'
  ];

  for (const field of artifactFields) {
    const offenders = boundaryFiles().filter((file) =>
      meaningfulNames(readFileSync(join(SRC, file), 'utf8'), file).has(field)
    );
    assert.deepEqual(offenders, [], `${field} llego a la frontera de salida`);
  }
});

// ---------------------------------------------------------------------------
// §5 — Ninguna serializacion de AnalysisRunSource arrastra el slot
// ---------------------------------------------------------------------------

test('slot: every production select over sources is explicit and narrow', () => {
  // El slot vive en columnas de `AnalysisRunSource`. La forma de que aparezca sin
  // querer es un `include` que traiga la fila entera; se comprueba que no exista
  // ninguno sobre esa relacion en codigo productivo.
  const productionFiles = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((entry) => entry.split('/').join(sep))
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'));

  const offenders: string[] = [];

  for (const file of productionFiles) {
    const code = readFileSync(join(SRC, file), 'utf8');
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);

    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'sources'
      ) {
        const value = node.initializer;
        // `sources: { select: ... }` esta bien; `sources: true` traeria la fila
        // completa, slot incluido.
        if (value.kind === ts.SyntaxKind.TrueKeyword) {
          offenders.push(`${file}: sources: true`);
        }
        if (ts.isObjectLiteralExpression(value)) {
          const keys = value.properties
            .map((property) =>
              property.name && ts.isIdentifier(property.name) ? property.name.text : ''
            )
            .filter(Boolean);
          if (keys.includes('include')) {
            offenders.push(`${file}: sources con include`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  assert.deepEqual(offenders, [], `serializaciones peligrosas de sources: ${offenders.join(', ')}`);
});

// ---------------------------------------------------------------------------
// §11 — Las rutas de extraccion siguen siendo internas
// ---------------------------------------------------------------------------

test('internal routes: no NestJS controller proxies the source-extraction routes', () => {
  // La frontera PERMITIDA es exactamente una: NestJS <-> FastAPI interno
  // autenticado. Las rutas de F1.3 devuelven el artifact completo a proposito
  // bajo auth interna; lo que no puede existir es un camino de producto que
  // permita alcanzar ese payload desde un browser, un holder, un issuer, un
  // share o un verifier.
  const productionFiles = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .map((entry) => entry.split('/').join(sep))
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'));

  const referencing = productionFiles.filter((file) =>
    readFileSync(join(SRC, file), 'utf8').includes('/v1/source-extraction/')
  );

  // Solo el cliente interno puede nombrarlas, y no es un controller.
  assert.deepEqual(referencing, [join('ai', 'ai-service.client.ts')]);
  assert.ok(
    !referencing.some((file) => file.endsWith('.controller.ts')),
    'ningun controller expone las rutas de extraccion'
  );
});

test('internal routes: no browser client references them', () => {
  // El front no puede llamarlas ni indirectamente: no existe endpoint publico
  // que las envuelva.
  const webSrc = join(SRC, '..', '..', '..', 'apps', 'web', 'src');
  let entries: string[];
  try {
    entries = readdirSync(webSrc, { recursive: true, encoding: 'utf8' });
  } catch {
    // Si el front no esta presente en este checkout, el test no puede afirmar
    // nada y lo dice en vez de pasar en falso.
    throw new Error(`no se pudo barrer ${webSrc}`);
  }

  const offenders = entries
    .map((entry) => entry.split('/').join(sep))
    .filter((entry) => /\.(ts|tsx|js|jsx)$/.test(entry))
    .filter((entry) => {
      try {
        return readFileSync(join(webSrc, entry), 'utf8').includes('source-extraction');
      } catch {
        return false;
      }
    });

  assert.deepEqual(offenders, [], `el front referencia source-extraction: ${offenders.join(', ')}`);
});

test('slot: the issuer analysis-run read select exposes only the source type', () => {
  // Es la unica lectura de `AnalysisRunSource` que llega a una respuesta HTTP.
  const { issuerAnalysisRunReadSelect } = require('../../analysis-run/issuer-analysis-run-read.mapper') as {
    issuerAnalysisRunReadSelect: { sources: { select: Record<string, unknown> } };
  };

  assert.deepEqual(Object.keys(issuerAnalysisRunReadSelect.sources.select), [
    'sourceType'
  ]);
});

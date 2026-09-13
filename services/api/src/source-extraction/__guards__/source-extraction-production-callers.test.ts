/**
 * Guard estructural del camino de escritura — F1.4 §17.
 *
 * Afirma UNA propiedad arquitectonica:
 *
 *     el unico llamador PRODUCTIVO de
 *       SourceExtractionSlotService.fillExtractionSlot
 *       AiServiceClient.extractPdfSource
 *       AiServiceClient.extractTextSource
 *     es SourceExtractionOrchestrationService
 *
 * Eso es lo que hace que
 *
 *     F1_4_ORCHESTRATION_PROVENANCE_PATH: CAUSALLY_ENFORCED
 *
 * sea comprobable y no una intencion escrita en un comentario. Si mañana alguien
 * llama al productor desde otro servicio y persiste el resultado por su cuenta,
 * la cadena causal se abre en silencio; este test lo rompe en voz alta.
 *
 * ALCANCE DEL CLAIM. Desde F1.6 el lifecycle productivo SI recorre este camino:
 *
 *     F1_4_ORCHESTRATION_PROVENANCE_PATH:       CAUSALLY_ENFORCED
 *     PRODUCTIVE_ANALYSIS_RUN_PROVENANCE_PATH:  CAUSALLY_ENFORCED
 *
 * Lo que sostiene la segunda linea son los guards de lifecycle de mas abajo:
 * `AnalysisRunExecutionService` es el UNICO llamador productivo de
 * `ensureExtractionForAnalysisRunSource`, y `AnalysisRunModule` el unico modulo
 * que registra los tres servicios. Sin eso, el claim seria una intencion.
 *
 * Lo que sigue sin afirmarse: que TODA extraccion persistida en la base venga de
 * un run. Un slot puede quedar ABSENT porque la extraccion es best-effort, y
 * `AnalysisRun.status` no dice nada sobre el estado del slot.
 *
 * Nada de esto toca `PDF_EXTRACTION_DERIVATION_TRUST`, que sigue siendo
 * `PRODUCER_ASSUMED`: procedencia causal no es prueba de derivacion.
 *
 * POR QUE AST Y NO SUBSTRING. Un test que busque el nombre del metodo como texto
 * se auto-detecta con su propio comentario —exactamente el defecto que ya
 * aparecio en F0.1 y en el test de independencia de F0.4—, y ademas contaria
 * menciones en prosa, en JSDoc y en strings. Aca se recorre el AST y solo cuentan
 * los nodos `CallExpression`: un comentario no es una llamada.
 *
 * NO se agrego ninguna dependencia: `typescript` ya es devDependency del paquete.
 *
 * POR QUE VIVE EN `__guards__/` Y NO JUNTO A LOS DEMAS TESTS DEL SLICE.
 *
 * El test de independencia de F0.4 recorre `src/source-extraction/` en plano y
 * exige que TODO archivo de ahi importe solo rutas relativas, un puñado de
 * builtins y `@nestjs/common`. Ese allowlist es deliberadamente estrecho: los
 * modulos del verificador tienen que poder correr sin Python, sin spawn, sin red
 * y sin nada generado.
 *
 * Este guard necesita dos cosas que ese allowlist prohibe —`typescript` para
 * parsear el AST y `@prisma/client` para anclar los literales de dominio contra
 * el enum real—, y ninguna de las dos deberia volverse importable por el
 * verificador. Aflojar el allowlist para acomodar este archivo cambiaria una
 * propiedad fuerte por comodidad. Vive un nivel mas abajo, donde el barrido plano
 * no llega, y esta decision queda escrita aca en vez de quedar implicita.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import { AnalysisRunSourceType, DocumentEvidenceKind } from '@prisma/client';
import ts from 'typescript';

const SRC = join(__dirname, '..', '..');

const GUARDED_METHODS = [
  'fillExtractionSlot',
  'extractPdfSource',
  'extractTextSource'
] as const;

/** Unico llamador productivo permitido, en ruta relativa a `src/`. */
const AUTHORIZED_CALLER = join(
  'source-extraction',
  'source-extraction-orchestration.service.ts'
);

function productionSourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((entry) => entry.endsWith('.ts'))
    .filter((entry) => !entry.endsWith('.test.ts'))
    .map((entry) => entry.split('/').join(sep));
}

/**
 * Nombres de metodo invocados en este codigo, tomados del AST.
 *
 * Cubre `obj.metodo(...)`, `obj?.metodo(...)` y `obj['metodo'](...)`. Lo que NO
 * cubre —y no puede cubrir un analisis sintactico— es un despacho totalmente
 * dinamico por variable. Es una limitacion real y esta asumida: el objetivo es
 * detectar un segundo call site escrito de la forma normal, no resistir a alguien
 * que ofusque la llamada a proposito.
 */
function calledMethodNames(code: string, fileName: string): Set<string> {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  const found = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const target = node.expression;
      if (ts.isPropertyAccessExpression(target)) {
        found.add(target.name.text);
      } else if (
        ts.isElementAccessExpression(target) &&
        ts.isStringLiteralLike(target.argumentExpression)
      ) {
        found.add(target.argumentExpression.text);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

// ---------------------------------------------------------------------------
// Control positivo: el detector detecta
// ---------------------------------------------------------------------------

test('guard: the AST detector finds real calls and ignores prose', () => {
  // Sin esto, un walker roto que no encuentre nada haria pasar el guard de forma
  // vacia. Este control lo impide.
  const detected = calledMethodNames(
    [
      '// fillExtractionSlot mencionado en un comentario',
      '/** extractPdfSource en JSDoc */',
      'const s = "extractTextSource en un string";',
      'class C { fillExtractionSlot() {} }',
      'declare const a: any;',
      'a.extractPdfSource({});',
      "a['extractTextSource']({});"
    ].join('\n'),
    'probe.ts'
  );

  assert.ok(detected.has('extractPdfSource'), 'detecta acceso por propiedad');
  assert.ok(detected.has('extractTextSource'), 'detecta acceso por indice');
  assert.ok(
    !detected.has('fillExtractionSlot'),
    'ni el comentario, ni el JSDoc, ni la declaracion del metodo cuentan como llamada'
  );
});

test('guard: the file sweep actually reaches production code', () => {
  const files = productionSourceFiles();
  assert.ok(files.length > 100, `barrido sospechosamente corto: ${files.length}`);
  assert.ok(files.includes(AUTHORIZED_CALLER), 'el orquestador esta en el barrido');
  assert.ok(
    !files.some((file) => file.endsWith('.test.ts')),
    'los tests quedan fuera: son llamadores legitimos'
  );
});

// ---------------------------------------------------------------------------
// §17 — Un solo camino de escritura productivo
// ---------------------------------------------------------------------------

for (const method of GUARDED_METHODS) {
  test(`callers: ${method} is only called by the orchestration service`, () => {
    const callers = productionSourceFiles().filter((file) =>
      calledMethodNames(readFileSync(join(SRC, file), 'utf8'), file).has(method)
    );

    assert.deepEqual(
      callers,
      [AUTHORIZED_CALLER],
      `${method} tiene call sites productivos fuera del orquestador: ${callers.join(', ')}`
    );
  });
}

// ---------------------------------------------------------------------------
// §14 (F1.6) — El wiring productivo, congelado
// ---------------------------------------------------------------------------
//
// Estos dos tests afirmaban hasta F1.5 que el orquestador NO estaba conectado.
// F1.6 lo conecta, asi que esas afirmaciones quedaron obsoletas POR DISEÑO.
//
// No se borraron: se reescribieron para congelar la arquitectura nueva. Borrar
// un guard cuando su premisa cambia deja el claim siguiente sin respaldo; lo que
// hay que hacer es moverlo a la afirmacion que ahora sostiene la propiedad.

const LIFECYCLE_CALLER = join('analysis-run', 'analysis-run-execution.service.ts');
const LIFECYCLE_MODULE = join('analysis-run', 'analysis-run.module.ts');

/**
 * Backfill de operador — P2.4.
 *
 * SEGUNDO llamador autorizado, y se nombra UNO POR UNO igual que el primero.
 *
 * F1.6 dejo la extraccion como best-effort no bloqueante y escribio que no
 * ofrecia mecanismo de reintento: "una capa futura podra volver a invocarlo
 * antes de necesitar esa evidencia". F3.2 volvio esa deuda visible —una fuente
 * sin slot hace nacer `failed` a un ReasoningRun— y esta es esa capa.
 *
 * NO se relajo el guard: no hay comodin, no hay excepcion por directorio y
 * `scripts/` NO quedo exento. Un tercer llamador sigue rompiendo el test, y hay
 * un control negativo mas abajo que lo demuestra en vez de suponerlo.
 */
const MAINTENANCE_CALLER = join('analysis-run', 'source-extraction-backfill.service.ts');

const AUTHORIZED_LIFECYCLE_CALLERS = [LIFECYCLE_CALLER, MAINTENANCE_CALLER].sort();

function lifecycleCallersIn(files: readonly string[]): string[] {
  return files
    .filter((file) =>
      calledMethodNames(readFileSync(join(SRC, file), 'utf8'), file).has(
        'ensureExtractionForAnalysisRunSource'
      )
    )
    .sort();
}

test('lifecycle: only the two authorized callers of ensureExtractionForAnalysisRunSource', () => {
  // La propiedad que sostiene
  //
  //     PRODUCTIVE_ANALYSIS_RUN_PROVENANCE_PATH: CAUSALLY_ENFORCED
  //
  // es que se entra al pipeline por sitios CONTADOS Y NOMBRADOS. Sumar el
  // backfill no la debilita: sigue siendo una lista cerrada de dos, y ninguno de
  // los dos reproduce la extraccion —ambos delegan en el orquestador—.
  assert.deepEqual(
    lifecycleCallersIn(productionSourceFiles()),
    AUTHORIZED_LIFECYCLE_CALLERS,
    'llamadores productivos inesperados'
  );
});

test('lifecycle: an unauthorized third caller is still rejected', () => {
  // CONTROL NEGATIVO. Sin esto, ampliar el allowlist a dos podria haberlo
  // convertido en "cualquiera": este test prueba que el guard sigue mordiendo.
  const intruder = join('semantic', 'pretend-rogue-caller.service.ts');
  const detected = calledMethodNames(
    'declare const o: any;\no.ensureExtractionForAnalysisRunSource("x");',
    intruder
  );

  assert.ok(
    detected.has('ensureExtractionForAnalysisRunSource'),
    'el detector ve la llamada del intruso'
  );
  assert.ok(
    !AUTHORIZED_LIFECYCLE_CALLERS.includes(intruder),
    'un archivo cualquiera NO esta autorizado'
  );
  // Y con el intruso en el barrido, la asercion real fallaria.
  assert.notDeepEqual(
    [...AUTHORIZED_LIFECYCLE_CALLERS, intruder].sort(),
    AUTHORIZED_LIFECYCLE_CALLERS
  );
});

test('lifecycle: the maintenance caller exists and delegates instead of extracting', () => {
  // Un allowlist que nombre un archivo inexistente se degrada en silencio.
  const code = readFileSync(join(SRC, MAINTENANCE_CALLER), 'utf8');
  const called = calledMethodNames(code, MAINTENANCE_CALLER);

  assert.ok(called.has('ensureExtractionForAnalysisRunSource'), 'delega en el orquestador');
  for (const forbidden of GUARDED_METHODS) {
    assert.ok(
      !called.has(forbidden),
      `el backfill no puede llamar a ${forbidden}: eso es reproducir el camino de escritura`
    );
  }
});

test('lifecycle: the orchestrator is registered only where the lifecycle needs it', () => {
  // MINIMUM_MODULE_DELTA: un solo modulo lo registra, y es el que posee
  // `AnalysisRunExecutionService`. No se creo `SourceExtractionModule`, y los
  // tres servicios no se exportan: nada fuera de ese modulo debe inyectarlos.
  const modules = productionSourceFiles().filter((file) => file.endsWith('.module.ts'));
  assert.ok(modules.length > 0);

  const registering = modules.filter((file) =>
    readFileSync(join(SRC, file), 'utf8').includes('SourceExtractionOrchestrationService')
  );

  assert.deepEqual(registering, [LIFECYCLE_MODULE]);
});

test('lifecycle: the three extraction services are providers, never exports', () => {
  const code = readFileSync(join(SRC, LIFECYCLE_MODULE), 'utf8');
  const source = ts.createSourceFile(LIFECYCLE_MODULE, code, ts.ScriptTarget.Latest, true);

  const arrayOf = (property: string): string[] => {
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === property &&
        ts.isArrayLiteralExpression(node.initializer)
      ) {
        for (const element of node.initializer.elements) {
          if (ts.isIdentifier(element)) found.push(element.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  };

  const providers = arrayOf('providers');
  const exported = arrayOf('exports');

  for (const service of [
    'SourceExtractionOrchestrationService',
    'SourceExtractionTrustGateService',
    'SourceExtractionSlotService'
  ]) {
    assert.ok(providers.includes(service), `${service} debe ser provider`);
    assert.ok(!exported.includes(service), `${service} no debe exportarse`);
  }
});

test('lifecycle: only the declared files import the orchestrator', () => {
  // Complementa el guard de llamadas: tampoco basta con no invocarlo si alguien
  // lo importa para envolverlo o re-exportarlo desde otro sitio.
  //
  // P2.4 suma el backfill de operador. La lista sigue siendo CERRADA y escrita a
  // mano: el modulo que lo registra y los dos servicios que lo usan. Nada mas.
  const importers = productionSourceFiles().filter((file) => {
    const code = readFileSync(join(SRC, file), 'utf8');
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
    let imports = false;
    ts.forEachChild(source, (node) => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteralLike(node.moduleSpecifier) &&
        node.moduleSpecifier.text.includes('source-extraction-orchestration.service')
      ) {
        imports = true;
      }
    });
    return imports;
  });

  assert.deepEqual(
    importers.sort(),
    [LIFECYCLE_MODULE, LIFECYCLE_CALLER, MAINTENANCE_CALLER].sort()
  );
});

// ---------------------------------------------------------------------------
// Anclaje de los literales de dominio contra el enum real
// ---------------------------------------------------------------------------

test('domain: the orchestrator literals match the Prisma enums exactly', () => {
  // El orquestador NO importa `@prisma/client` —el allowlist de independencia de
  // F0.4 lo prohibe para todo el directorio— y compara contra literales. Sin este
  // anclaje, renombrar el enum en el schema no romperia nada: la comparacion
  // simplemente empezaria a dar false y la orquestacion rechazaria fuentes
  // validas. Se prefiere que rompa un test a que falle en silencio.
  const code = readFileSync(join(SRC, AUTHORIZED_CALLER), 'utf8');

  const literal = (name: string): string => {
    const match = new RegExp(`const ${name} = '([^']+)'`).exec(code);
    assert.ok(match, `no se encontro la constante ${name}`);
    return match[1];
  };

  assert.equal(
    literal('DOCUMENT_EVIDENCE_SOURCE_TYPE'),
    AnalysisRunSourceType.document_evidence
  );
  assert.equal(literal('PDF_DOCUMENT_KIND'), DocumentEvidenceKind.pdf);

  // Y el subtipo excluido sigue existiendo como valor real del dominio: si
  // `image` desapareciera, la regla de elegibilidad de §5B perderia su razon de
  // ser y habria que revisarla, no dejarla correr por inercia.
  assert.equal(DocumentEvidenceKind.image, 'image');
});

// ---------------------------------------------------------------------------
// Privacidad del borde
// ---------------------------------------------------------------------------

test('privacy: the orchestrator logs nothing at all', () => {
  const code = readFileSync(join(SRC, AUTHORIZED_CALLER), 'utf8');
  const called = calledMethodNames(code, AUTHORIZED_CALLER);

  for (const forbidden of ['log', 'warn', 'error', 'debug', 'verbose']) {
    assert.ok(!called.has(forbidden), `no debe llamar a logger.${forbidden}`);
  }
  assert.ok(!code.includes('new Logger('), 'no instancia un Logger');
  // El material de la fuente pasa por este servicio: la unica forma segura de no
  // filtrar `canonicalText`, `exactExcerpt` ni contenido en un log es no loggear.
  // El logging seguro de fallos vive en el borde del run (F1.6).
});

test('privacy: relative import paths only — no traversal outside src', () => {
  const code = readFileSync(join(SRC, AUTHORIZED_CALLER), 'utf8');
  const source = ts.createSourceFile(AUTHORIZED_CALLER, code, ts.ScriptTarget.Latest, true);

  const specifiers: string[] = [];
  ts.forEachChild(source, (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
  });

  assert.ok(specifiers.length > 0);
  for (const specifier of specifiers) {
    if (!specifier.startsWith('.')) continue;
    const resolved = relative(SRC, join(SRC, 'source-extraction', specifier));
    assert.ok(!resolved.startsWith('..'), `import fuera de src: ${specifier}`);
  }
});

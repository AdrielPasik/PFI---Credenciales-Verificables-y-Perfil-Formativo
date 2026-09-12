/**
 * Guards estructurales del slice de Objetivos — P2.3.
 *
 * No ejercitan comportamiento: fijan lo que este slice NO puede hacer. Son los
 * invariantes que una refactorizacion distraida romperia en silencio.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const WEB_SRC = path.resolve(__dirname, '..', '..', '..');
const SLICE_DIR = __dirname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) return [];
    return [full];
  });
}

const sliceSources = sourceFiles(SLICE_DIR).map((file) => ({
  name: path.relative(SLICE_DIR, file),
  source: readFileSync(file, 'utf8')
}));

const objectivesSupport = [
  path.join(WEB_SRC, 'lib', 'api', 'objectives-api.ts'),
  path.join(WEB_SRC, 'lib', 'adapters', 'objectives.adapter.ts'),
  path.join(WEB_SRC, 'lib', 'errors', 'objective-error-mapper.ts'),
  path.join(WEB_SRC, 'models', 'objectives.ts')
].map((file) => ({
  name: path.relative(WEB_SRC, file),
  source: readFileSync(file, 'utf8')
}));

const allSources = [...sliceSources, ...objectivesSupport];

/**
 * Modulos que P2.4B incorporo al slice: el analisis de trayectoria.
 *
 * Se nombran UNO POR UNO, no por patron. Un guard que dijera "todo lo que se
 * llame *reasoning* puede hablar con P2.4" se desactivaria solo con renombrar un
 * archivo; asi, sumar un modulo al analisis obliga a declararlo aca.
 */
const REASONING_MODULES = [
  'objective-reasoning-panel.tsx',
  'requirement-result-card.tsx',
  'reasoning-evidence-list.tsx',
  'reasoning-run-selection.ts',
  'evidence-presentation.ts'
];

/** Intake, revision, lista y soporte: el nucleo de P2.3. */
const p23Sources = allSources.filter(
  (file) => !REASONING_MODULES.includes(file.name)
);

/** Comentarios fuera: explican los invariantes y los nombran a proposito. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('guards del slice de objetivos', () => {
  it('el slice existe y tiene los modulos esperados', () => {
    const names = sliceSources.map((file) => file.name);
    expect(names).toContain('review-draft.ts');
    expect(names).toContain('objective-intake-route.tsx');
    expect(names).toContain('objectives-list-route.tsx');
    expect(names).toContain('objective-detail-route.tsx');
  });

  /*
   * P2.4B agrega el analisis al DETALLE, y solo ahi. El intake y la revision
   * siguen sin poder tocarlo: si el flujo de confirmacion pudiera disparar un
   * run, confirmar un objetivo compraria llamadas al proveedor sin pedirlo.
   */
  it('el intake y la revision siguen sin tocar ninguna ruta de razonamiento', () => {
    const intakeAndReview = p23Sources.filter(
      (file) => file.name !== 'objective-detail-route.tsx'
    );
    for (const { name, source } of intakeAndReview) {
      for (const forbidden of ['reasoning-run', 'reasoningRun', '/execute', 'evidence-unit']) {
        expect(source.includes(forbidden), `${name} menciona ${forbidden}`).toBe(false);
      }
    }
  });

  it('los modulos de analisis declarados existen', () => {
    const names = sliceSources.map((file) => file.name);
    for (const declared of REASONING_MODULES) {
      expect(names, `falta ${declared}`).toContain(declared);
    }
  });

  /*
   * La evidencia que se muestra viene RESUELTA del servidor. El navegador no
   * puede volver a tocar los identificadores internos del razonador, ni resolver
   * `src_NN`, ni leer el diagnostico.
   */
  it('el analisis no manipula identificadores internos del razonador', () => {
    const reasoning = sliceSources.filter((file) =>
      REASONING_MODULES.includes(file.name)
    );
    expect(reasoning.length).toBe(REASONING_MODULES.length);
    for (const { name, source } of reasoning) {
      const code = withoutComments(source);
      for (const forbidden of [
        'evidenceUnitId',
        'sourceId',
        'sourceSha256',
        'charStart',
        'charEnd',
        'segmentId',
        'artifactBlobSha256',
        'explanation',
        'policyTrace',
        'jointClaimCeiling'
      ]) {
        expect(code.includes(forbidden), `${name} usa ${forbidden}`).toBe(false);
      }
    }
  });

  it('no llama endpoints fuera de los contratos previstos', () => {
    // P2.4B suma `/me/reasoning-runs`. Sigue siendo una lista cerrada: el
    // navegador nunca habla con el servicio de IA ni pide artifacts crudos.
    const allowed = [
      '/me/objective-requirement-proposals',
      '/me/objectives',
      '/me/reasoning-runs'
    ];
    for (const { name, source } of allSources) {
      const paths = [...source.matchAll(/['"`](\/me\/[^'"`$]*)/g)].map((m) => m[1]);
      for (const found of paths) {
        expect(
          allowed.some((prefix) => found.startsWith(prefix)),
          `${name} llama ${found}`
        ).toBe(true);
      }
    }
  });

  it('no existe cliente de revision: la semantica con P2.4 esta diferida', () => {
    for (const { name, source } of allSources) {
      const code = withoutComments(source);
      expect(code.includes('/revisions'), `${name} llama revisiones`).toBe(false);
      expect(code.includes('createObjectiveRevision'), name).toBe(false);
    }
  });

  it('la procedencia se decide en UN solo lugar', () => {
    // Si un componente construyera su propio `provenanceKind`, existirian dos
    // verdades y se desincronizarian.
    const deciders = allSources.filter(({ source }) =>
      /provenanceKind:\s*'/.test(withoutComments(source))
    );
    expect(deciders.map((file) => file.name)).toEqual(['review-draft.ts']);
  });

  it('nadie persiste el objetivo ni la revision en el navegador', () => {
    for (const { name, source } of allSources) {
      for (const forbidden of ['localStorage', 'sessionStorage', 'indexedDB']) {
        expect(source.includes(forbidden), `${name} usa ${forbidden}`).toBe(false);
      }
    }
  });

  it('no se normaliza el texto anclado', () => {
    // `trim()`, NFC o colapso de espacios sobre el texto fuente o las citas
    // romperia la verificacion literal del backend.
    const code = sliceSources
      .concat(objectivesSupport.filter((f) => f.name.includes('adapter')))
      .map((file) => withoutComments(file.source))
      .join('\n');
    expect(code).not.toContain('.normalize(');

    // Lo prohibido es ASIGNAR un valor transformado. `texto.trim().length === 0`
    // es una comprobacion de contenido: no altera lo que se envia, y prohibirla
    // obligaria a validar peor.
    for (const field of ['rawObjectiveText', 'exactExcerpt', 'originalText', 'sourceQuote']) {
      expect(code, `${field} se asigna recortado`).not.toMatch(
        new RegExp(`${field}\\s*[:=]\\s*[^;\\n]*\\.trim\\(\\)`)
      );
      expect(code, `${field} se asigna con replace`).not.toMatch(
        new RegExp(`${field}\\s*[:=]\\s*[^;\\n]*\\.replace\\(`)
      );
    }
  });

  it('no se introdujo ninguna dependencia nueva', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(WEB_SRC, '..', 'package.json'), 'utf8')
    ) as { dependencies: Record<string, string> };

    expect(Object.keys(packageJson.dependencies).sort()).toEqual([
      '@radix-ui/react-label',
      '@radix-ui/react-separator',
      '@radix-ui/react-slot',
      'class-variance-authority',
      'clsx',
      'lucide-react',
      'next',
      'react',
      'react-dom',
      'tailwind-merge'
    ]);
  });

  it('no se menciona proveedor ni modelo en ningun lado', () => {
    for (const { name, source } of allSources) {
      const lower = source.toLowerCase();
      for (const forbidden of ['openai', 'gpt-', 'anthropic', 'prompt']) {
        expect(lower.includes(forbidden), `${name} menciona ${forbidden}`).toBe(false);
      }
    }
  });
});

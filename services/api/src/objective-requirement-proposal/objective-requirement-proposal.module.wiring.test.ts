/**
 * Cableado y guards estructurales — slice P2.2.
 *
 * Estos tests no ejercitan comportamiento: fijan lo que este slice NO puede
 * alcanzar. Los invariantes de P2.2 —
 *
 *     DB_WRITES = 0        no se crea el Objective       F3 intacto
 *
 * — se sostienen porque el grafo de dependencias no ofrece el camino. Un import
 * agregado sin pensar lo rompería en silencio, y acá deja de ser silencioso.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { ObjectiveRequirementProposalController } from './objective-requirement-proposal.controller';
import { ObjectiveRequirementProposalModule } from './objective-requirement-proposal.module';

const SLICE_DIR = __dirname;

/** Fuentes del slice, sin los tests. */
function sliceSources(): Array<{ name: string; source: string }> {
  const collect = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return collect(full);
      if (!entry.name.endsWith('.ts')) return [];
      if (entry.name.endsWith('.test.ts')) return [];
      return [full];
    });

  return collect(SLICE_DIR).map((full) => ({
    name: path.relative(SLICE_DIR, full),
    source: withoutComments(readFileSync(full, 'utf8'))
  }));
}

/**
 * Quita comentarios. Los invariantes de este slice están EXPLICADOS en prosa
 * dentro del código —"no importa `ObjectivesService`"— y buscar el identificador
 * sobre el fichero entero encontraría justamente esas explicaciones.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function importedModules(source: string): string[] {
  const especificadores: string[] = [];
  const patron = /(?:from\s+|require\()\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = patron.exec(source)) !== null) {
    especificadores.push(match[1]);
  }
  return especificadores;
}

test('AppModule cablea el módulo y resuelve el controller', async () => {
  const applicationContext = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    logger: false
  });
  try {
    const controller = applicationContext
      .select(ObjectiveRequirementProposalModule)
      .get(ObjectiveRequirementProposalController);
    assert.ok(controller);
  } finally {
    await applicationContext.close();
  }
});

test('el módulo importa exactamente AuthModule y AiModule', () => {
  const source = readFileSync(
    path.join(SLICE_DIR, 'objective-requirement-proposal.module.ts'),
    'utf8'
  );
  const imports = importedModules(source).filter((spec) => spec.includes('.module'));
  assert.deepEqual(imports.sort(), ['../ai/ai.module', '../auth/auth.module']);
});

test('el slice no puede alcanzar Prisma: DB_WRITES = 0 es estructural', () => {
  for (const { name, source } of sliceSources()) {
    for (const spec of importedModules(source)) {
      const esPrismaService = spec.includes('prisma');
      // `@prisma/client` se usa SÓLO por el enum `ObjectiveType`, que es un tipo
      // generado, no un cliente de base. El servicio de Prisma sí está vedado.
      const esSoloElEnum = spec === '@prisma/client';
      assert.ok(!esPrismaService || esSoloElEnum, `${name} importa ${spec}`);
    }
    assert.ok(!/PrismaService/.test(source), `${name} menciona PrismaService`);
  }
});

test('el slice no puede crear un Objective ni finalizar Requirements', () => {
  for (const { name, source } of sliceSources()) {
    for (const spec of importedModules(source)) {
      assert.ok(
        !spec.includes('objectives.service') && !spec.includes('objectives.module'),
        `${name} importa ${spec}`
      );
    }
    for (const prohibido of ['ObjectivesService', 'ObjectivesModule', 'createObjective']) {
      assert.ok(!source.includes(prohibido), `${name} menciona ${prohibido}`);
    }
  }
});

test('el slice es evidence-blind también en su grafo de imports', () => {
  // Sin acceso a credenciales, EvidenceUnits ni al perfil formativo, no hay forma
  // de que una refactorización "enriquezca" la propuesta con datos del holder.
  const prohibidos = [
    'evidence',
    'credentials/',
    'profiles/',
    'reasoning',
    'semantic/',
    'analysis-run'
  ];
  for (const { name, source } of sliceSources()) {
    for (const spec of importedModules(source)) {
      for (const prohibido of prohibidos) {
        assert.ok(!spec.includes(prohibido), `${name} importa ${spec}`);
      }
    }
  }
});

test('el slice no escribe a disco ni ejecuta el proveedor por su cuenta', () => {
  for (const { name, source } of sliceSources()) {
    for (const spec of importedModules(source)) {
      for (const prohibido of ['node:fs', 'node:https', 'node:http', 'openai']) {
        assert.ok(spec !== prohibido, `${name} importa ${spec}`);
      }
    }
  }
});

test('el slice no lleva credenciales ni nombres de modelo en el código', () => {
  const patron = /(?<![A-Za-z])sk-[A-Za-z0-9]{20}|Bearer [A-Za-z0-9._-]{20}/;
  for (const { name, source } of sliceSources()) {
    assert.ok(!patron.test(source), `${name} lleva algo con forma de credencial`);
    assert.ok(!/gpt-[0-9]/.test(source), `${name} fija un id de modelo`);
  }
});

test('el módulo no exporta el servicio: nadie más lo inyecta', () => {
  const source = readFileSync(
    path.join(SLICE_DIR, 'objective-requirement-proposal.module.ts'),
    'utf8'
  );
  assert.ok(!/exports\s*:/.test(source));
});

test('los ficheros de F3 no fueron tocados por este slice', () => {
  // P2.2 es aditivo. Si algún fichero de Evidence Reasoning apareciera importando
  // este slice, la frontera se habría movido sin que nadie lo decidiera.
  const apiSrc = path.resolve(SLICE_DIR, '..');
  const recorrer = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === 'node_modules' ? [] : recorrer(full);
      }
      return entry.name.endsWith('.ts') ? [full] : [];
    });

  const ofensores = recorrer(apiSrc)
    .filter((full) => !full.startsWith(SLICE_DIR))
    // Lo que se busca es acoplamiento PRODUCTIVO. Un guard de otro slice puede
    // nombrarlo —el de no-exposición de extracción lo hace para justificar por
    // qué sus excerpts no son material de extracción— y eso es lo contrario de
    // un acoplamiento: es una frontera escrita.
    .filter((full) => !full.endsWith('.test.ts'))
    // `app.module.ts` lo registra y `ai/` es el transporte: son los dos únicos
    // puntos de acoplamiento previstos.
    .filter((full) => !full.endsWith('app.module.ts'))
    .filter((full) => !full.startsWith(path.join(apiSrc, 'ai')))
    .filter((full) =>
      readFileSync(full, 'utf8').includes('objective-requirement-proposal')
    )
    .map((full) => path.relative(apiSrc, full));

  assert.deepEqual(ofensores, [], `módulos externos acoplados al slice: ${ofensores}`);
});

/**
 * Guardas estructurales de la fundacion publica.
 *
 * Lo que se congela aca no es comportamiento sino FORMA:
 *
 *   - el modulo no abre superficie publica;
 *   - la seleccion de evidencia existe en UN solo lugar;
 *   - nada de la fundacion llama a un proveedor ni al ai-service;
 *   - el producto publico no depende del wrapper del holder.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { PublicVerificationController } from './public-verification.controller';
import { PublicVerificationModule } from './public-verification.module';
import { VerificationRequestService } from './verification-request.service';
import { VerificationRunFreezeService } from './verification-run-freeze.service';

const SRC = join(__dirname, '..');

function productionFiles(dir: string): string[] {
  return readdirSync(join(SRC, dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
    .map((entry) => join(dir, entry.name));
}

function source(relative: string): string {
  return readFileSync(join(SRC, relative), 'utf8');
}

/** Sin comentarios: una guarda no puede pasar porque la palabra aparezca en prosa. */
function code(relative: string): string {
  return source(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('el modulo publico registra UN controller: intake, revision, ejecucion y resultado', () => {
  const controllers = (Reflect.getMetadata('controllers', PublicVerificationModule) as unknown[]) ?? [];
  assert.deepEqual(controllers, [PublicVerificationController]);
});

test('el modulo provee los dos servicios de la fundacion', () => {
  const providers = (Reflect.getMetadata('providers', PublicVerificationModule) as unknown[]) ?? [];
  assert.ok(providers.includes(VerificationRequestService));
  assert.ok(providers.includes(VerificationRunFreezeService));
});

test('la seleccion de candidatos de extraccion vive en UN solo archivo de todo src', () => {
  // Si una segunda copia apareciera, las dos divergirian en silencio y una misma
  // disposicion pasaria a significar dos cosas.
  //
  // El marcador es la CONSULTA de seleccion, no `verifyReadExtractionSlot`: el
  // loader de grounding tambien verifica slots, pero para releer en ejecucion uno
  // ya congelado, no para elegir un candidato. Ese es otro trabajo, legitimo.
  const owners = readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts') &&
        !(entry.parentPath).includes('__fixtures__')
    )
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) =>
      readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .includes('analysisRunSource.findFirst')
    )
    .map((file) => file.slice(SRC.length + 1));

  assert.deepEqual(owners, [join('reasoning-run', 'credential-inventory.classifier.ts')]);
});

test('el wrapper del holder delega la clasificacion y no la reimplementa', () => {
  const holder = code(join('reasoning-run', 'reasoning-run-input-freeze.service.ts'));
  assert.ok(holder.includes('classifyCredentialInventory'));
  for (const forbidden of ['analysisRunSource', 'EXCLUDED_UNSUPPORTED_TYPE', 'assignRunLocalSourceIds']) {
    assert.equal(holder.includes(forbidden), false, forbidden);
  }
});

test('el proveedor se alcanza SOLO via el nucleo de propuesta y la factory del motor F3', () => {
  // La propuesta usa `ObjectiveRequirementProposalService`, el nucleo del holder.
  // La ejecucion usa las MISMAS clases de etapa del holder, armadas UNICAMENTE en
  // `verification-run-engine.ts` (el modulo solo inyecta el cliente en la factory).
  const engineFactory = join('public-verification', 'verification-run-engine.ts');
  const moduleFile = join('public-verification', 'public-verification.module.ts');
  for (const file of productionFiles('public-verification')) {
    const body = code(file);
    assert.equal(body.includes('fetch('), false, `${file}: fetch(`);
    // La sintesis del holder se reusa a traves de su mapper, nunca armandola aparte.
    assert.equal(body.includes('buildObjectiveSynthesisV1'), false, `${file}: buildObjectiveSynthesisV1`);
    if (file === engineFactory) continue;
    for (const forbidden of ['ReasoningRunObjectiveAnalysisService', 'ReasoningRunEvidenceUnitsService', 'ReasoningRunContextualReasoningService', 'ReasoningRunExecutionClaimService']) {
      assert.equal(body.includes(forbidden), false, `${file}: ${forbidden}`);
    }
    if (file !== moduleFile) {
      assert.equal(body.includes('AiServiceClient'), false, `${file}: AiServiceClient`);
    }
  }
  const providerUsers = productionFiles('public-verification').filter((file) =>
    code(file).includes('ObjectiveRequirementProposalService')
  );
  assert.deepEqual(providerUsers.sort(), [
    join('public-verification', 'public-verification.module.ts'),
    join('public-verification', 'verification-proposal.service.ts')
  ]);
});

test('NINGUN controller congela un VerificationRun directamente: solo via el servicio de ejecucion', () => {
  const controllers = readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.controller.ts'))
    .map((entry) => join(entry.parentPath, entry.name));
  for (const file of controllers) {
    const body = readFileSync(file, 'utf8');
    assert.equal(body.includes('VerificationRunFreezeService'), false, file);
    assert.equal(body.includes('createFrozenRun'), false, file);
  }
});

test('ningun archivo de estos modulos contiene bytes de control crudos', () => {
  // Un escape unicode reescrito como caracter literal dejo un NUL en dos archivos
  // de este modulo; git los veia como binarios. Esta guarda lo impide.
  const dirs = ['public-verification', join('public-verification', '__fixtures__'), 'profile-sharing'];
  for (const dir of dirs) {
    for (const entry of readdirSync(join(SRC, dir), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const bytes = readFileSync(join(SRC, dir, entry.name));
      const raw = [...bytes].filter((b) => b < 9 || b === 11 || b === 12 || (b > 13 && b < 32) || b === 127);
      assert.equal(raw.length, 0, join(dir, entry.name));
    }
  }
});

test('el producto publico no depende del wrapper privado del holder', () => {
  // Reusa la primitiva compartida; nunca el servicio que exige ownerUserId.
  for (const file of productionFiles('public-verification')) {
    const body = code(file);
    for (const forbidden of ['ReasoningRunInputFreezeService', 'ReasoningRunPrivateService', 'ownerUserId', "reasoningRun."]) {
      assert.equal(body.includes(forbidden), false, `${file}: ${forbidden}`);
    }
  }
});

test('solo el controller publico de intake usa los servicios de sesion', () => {
  const controllers = readdirSync(SRC, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.controller.ts'))
    .map((entry) => join(entry.parentPath, entry.name).slice(SRC.length + 1));

  const users = controllers.filter((file) =>
    readFileSync(join(SRC, file), 'utf8').includes('VerificationRequestService')
  );
  assert.deepEqual(users, [join('public-verification', 'public-verification.controller.ts')]);
});

// ---------------------------------------------------------------------------
// Motor F3 sobre VerificationRun
// ---------------------------------------------------------------------------

const ENGINE_FILES = [
  'reasoning-run-execution.service.ts',
  'reasoning-run-execution-claim.service.ts',
  'reasoning-run-artifact-slot.service.ts',
  'reasoning-run-objective-analysis.service.ts',
  'reasoning-run-evidence-units.service.ts',
  'reasoning-run-contextual-reasoning.service.ts',
  'reasoning-run-grounding.loader.ts'
].map((name) => join('reasoning-run', name));

test('el motor F3 accede al run y al inventario SOLO a traves del puerto de tabla', () => {
  for (const file of ENGINE_FILES) {
    const body = code(file);
    assert.equal(body.includes('prisma.reasoningRun.'), false, `${file}: prisma.reasoningRun.`);
    assert.equal(body.includes('prisma.reasoningRunInventoryItem.'), false, `${file}: prisma.reasoningRunInventoryItem.`);
    assert.ok(body.includes('this.table.'), `${file}: no usa el puerto`);
  }
});

test('el motor no lee columnas que solo existen en ReasoningRun', () => {
  // `verificationRunTable` pasa los argumentos del run sin traducir: una columna
  // exclusiva del holder romperia solo en la ejecucion publica.
  for (const file of ENGINE_FILES) {
    const body = code(file);
    for (const holderOnly of ['ownerUserId', 'objectiveId']) {
      assert.equal(body.includes(holderOnly), false, `${file}: ${holderOnly}`);
    }
  }
});

test('la tabla publica se arma en UN solo lugar y nunca se registra como token global', () => {
  const users = productionFiles('public-verification').filter((file) =>
    code(file).includes('verificationRunTable')
  );
  assert.deepEqual(users, [join('public-verification', 'verification-run-engine.ts')]);
  for (const file of productionFiles('public-verification')) {
    assert.equal(code(file).includes('REASONING_RUN_TABLE'), false, file);
  }
});

test('la proyeccion publica no tiene campos para citas, contexto, ids internos ni explicacion', () => {
  const body = code(join('public-verification', 'verification-result.projection.ts'));
  for (const forbidden of [
    'excerpt:',
    'contextBefore:',
    'contextAfter:',
    'pageNumber:',
    'sectionLabel:',
    'coverage:',
    'explanation',
    'runLocalSourceId:',
    'reasoningRunReference:',
    'objectiveReference:',
    'requirementId:',
    'score',
    'ranking'
  ]) {
    assert.equal(body.includes(forbidden), false, forbidden);
  }
});

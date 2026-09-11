/**
 * Wiring de F3.2.
 *
 * Se verifica la FORMA del módulo por metadata de Nest, sin levantar la app: lo
 * que importa acá es que F3.2 no haya abierto superficie pública ni arrastrado
 * dependencias que no necesita.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AiModule } from '../ai/ai.module';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../auth/auth.guard';
import { ReasoningRunArtifactSlotService } from './reasoning-run-artifact-slot.service';
import { ReasoningRunInputFreezeService } from './reasoning-run-input-freeze.service';
import { ReasoningRunModule } from './reasoning-run.module';
import { ReasoningRunContextualReasoningService } from './reasoning-run-contextual-reasoning.service';
import { ReasoningRunEvidenceUnitsService } from './reasoning-run-evidence-units.service';
import { ReasoningRunGroundingLoader } from './reasoning-run-grounding.loader';
import { ReasoningRunExecutionClaimService } from './reasoning-run-execution-claim.service';
import { ReasoningRunExecutionService } from './reasoning-run-execution.service';
import { ReasoningRunObjectiveAnalysisService } from './reasoning-run-objective-analysis.service';
import { ReasoningRunPrivateService } from './reasoning-run-private.service';
import { ReasoningRunsController } from './reasoning-runs.controller';
import { SourceExtractionSlotService } from '../source-extraction/source-extraction-slot.service';

function metadata(key: string): unknown[] {
  return (Reflect.getMetadata(key, ReasoningRunModule) as unknown[]) ?? [];
}

test('el módulo provee el freeze service y sus dependencias', () => {
  const providers = metadata('providers');
  assert.ok(providers.includes(ReasoningRunInputFreezeService));
  assert.ok(providers.includes(ReasoningRunArtifactSlotService));
  assert.ok(providers.includes(SourceExtractionSlotService));
});

test('el módulo provee la etapa de Objective Analysis', () => {
  assert.ok(metadata('providers').includes(ReasoningRunObjectiveAnalysisService));
});

test('el módulo provee la etapa de EvidenceUnits', () => {
  const providers = metadata('providers');
  assert.ok(providers.includes(ReasoningRunEvidenceUnitsService));
  // Reusa el mismo servicio de slots de extracción que F3.2: la etapa 2 lee el
  // binding congelado, no crea uno nuevo.
  assert.ok(providers.includes(SourceExtractionSlotService));
});

test('el módulo provee la etapa contextual y el cargador compartido', () => {
  const providers = metadata('providers');
  assert.ok(providers.includes(ReasoningRunContextualReasoningService));
  // Una sola autoridad para "el grounding congelado sigue siendo utilizable":
  // F3.4 y F3.5 usan el mismo cargador.
  assert.ok(providers.includes(ReasoningRunGroundingLoader));
});

test('el módulo provee el orquestador y su claim exclusiva', () => {
  const providers = metadata('providers');
  assert.ok(providers.includes(ReasoningRunExecutionService));
  // La claim es un provider propio: obtenerla EXIGE ganar el CAS, y ése es el
  // único camino por el que una etapa puede correr bajo `running`.
  assert.ok(providers.includes(ReasoningRunExecutionClaimService));
});

test('el módulo provee la capa de aplicación privada', () => {
  assert.ok(metadata('providers').includes(ReasoningRunPrivateService));
});

/**
 * Hasta F3.6 este módulo no tenía controller, y cinco tests lo afirmaban uno por
 * slice. F3.7 abre la ÚNICA superficie HTTP del dominio, así que esas
 * afirmaciones se reemplazan por la que ahora corresponde: hay exactamente un
 * controller, y es el privado.
 *
 * Lo que aquellos tests protegían —que ninguna etapa semántica quedara expuesta—
 * lo protege ahora `no se expone ninguna etapa semántica como endpoint`.
 */
test('F3.7 expone EXACTAMENTE un controller, y es el privado', () => {
  assert.deepEqual(metadata('controllers'), [ReasoningRunsController]);
});

test('la superficie está bajo /me y exige autenticación', () => {
  const path = Reflect.getMetadata('path', ReasoningRunsController) as string;
  assert.equal(path, 'me/reasoning-runs');

  // El guard va a nivel de clase: no hay ruta de este controller sin él.
  const guards = (Reflect.getMetadata('__guards__', ReasoningRunsController) ??
    []) as unknown[];
  assert.ok(guards.includes(AuthGuard));
});

test('no se expone ninguna etapa semántica como endpoint', () => {
  // La ejecución entra SIEMPRE por el orquestador de más alto nivel. Ninguna
  // etapa —Objective Analysis, EvidenceUnits, razonamiento contextual— tiene
  // superficie propia, ni la policy determinista tampoco.
  const controllers = metadata('controllers');
  for (const stage of [
    ReasoningRunObjectiveAnalysisService,
    ReasoningRunEvidenceUnitsService,
    ReasoningRunContextualReasoningService,
    ReasoningRunExecutionService
  ]) {
    assert.ok(!controllers.includes(stage));
  }
});

test('los imports son el transporte al AI service y el módulo de auth', () => {
  // `PrismaModule` es @Global(), así que no se importa. `AiModule` sí: es el
  // dueño de `AiServiceClient` y de su credencial interna, y duplicar ese
  // provider acá dejaría dos dueños del mismo transporte. `AuthModule` entra en
  // F3.7 por el `AuthGuard`, igual que en `ObjectivesModule`.
  assert.deepEqual(metadata('imports'), [AiModule, AuthModule]);
});

test('no se exporta nada todavía', () => {
  assert.deepEqual(metadata('exports'), []);
});

/**
 * Proyección holder-safe de la evidencia de un ReasoningRun — slice P2.4A.
 *
 * Traduce las referencias INTERNAS del razonador a algo que una persona puede
 * leer, sin inventar nada y sin salirse del estado congelado del run:
 *
 *     supportingEvidenceUnitIds        del resultado persistido
 *          ↓  eu_NN
 *     EvidenceUnitV1                   del catálogo persistido
 *          ↓  sourceTrace.sourceId = src_NN
 *     ReasoningRunInventoryItem        del inventario CONGELADO del run
 *          ↓  credentialId (columna requerida, no nullable)
 *     Credential / Issuer              sólo como ETIQUETA
 *
 * MÓDULO PURO. No conoce Prisma, ni HTTP, ni Nest. Recibe los tres artefactos ya
 * verificados y una vista mínima del inventario, y devuelve la proyección. Así el
 * comportamiento se puede probar entero sin base de datos, que es lo que hace que
 * los invariantes de esta cadena sean baratos de defender.
 *
 * LA ETIQUETA ES LO ÚNICO QUE SE LEE DEL PRESENTE. `title`, `credentialType`,
 * `issuerName` y `currentStatus` salen de la fila `Credential` de hoy porque son
 * nombres para mostrar, no evidencia. La CITA, la página, la cobertura y la fuente
 * salen exclusivamente del artefacto congelado. Nunca se re-selecciona una fuente,
 * nunca se relee una extracción, nunca se elige el `AnalysisRun` más nuevo.
 */

import {
  type EvidenceUnitV1,
  type EvidenceUnitsV1,
  type RequirementResult
} from './reasoning-run-artifact.types';
import { failEvidenceProjection } from './reasoning-run-evidence.errors';

// ---------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------

/**
 * Lo mínimo que la proyección necesita de una fila de inventario.
 *
 * Sólo filas `INCLUDED`: son las únicas que tienen `runLocalSourceId` y las
 * únicas que entraron al grounding set. Que el tipo no admita disposición es
 * deliberado — filtrar es responsabilidad de quien consulta, y aceptar la
 * columna acá invitaría a proyectar una fila excluida por descuido.
 */
export interface FrozenInventorySourceView {
  /** `src_01`, `src_02`, … Local al run. NUNCA sale de acá. */
  readonly runLocalSourceId: string;
  readonly documentEvidenceId: string | null;
  readonly textEvidenceId: string | null;
  readonly credential: {
    readonly id: string;
    readonly title: string;
    readonly credentialType: string;
    readonly issuerName: string;
    readonly currentStatus: string;
  } | null;
}

// ---------------------------------------------------------------------------
// Salida — DTO interno del dominio, el de HTTP lo espeja
// ---------------------------------------------------------------------------

export type ProjectedSourceKind = 'DOCUMENT' | 'TEXT';

export interface ProjectedEvidenceCredential {
  /** El id de la credencial. Es la MISMA referencia que ya usa `/me/credentials`. */
  readonly credentialReference: string;
  readonly title: string;
  readonly credentialType: string;
  readonly issuerName: string;
  /**
   * Estado ACTUAL de la credencial. No dice nada sobre su estado al momento del
   * run: ver la nota de `STATUS_AT_RUN` más abajo.
   */
  readonly currentStatus: string;
}

export interface ProjectedEvidence {
  /** `sourceTrace.exactExcerpt`, VERBATIM. Sin recortar, sin normalizar. */
  readonly excerpt: string;
  readonly contextBefore: string | null;
  readonly contextAfter: string | null;
  readonly sectionLabel: string | null;
  /** `null` legítimo: siempre para TEXT, y para DOCUMENT cuando no se identificó. */
  readonly pageNumber: number | null;
  readonly coverage: EvidenceUnitV1['extractionQuality'];
  readonly sourceKind: ProjectedSourceKind;
  readonly credential: ProjectedEvidenceCredential | null;
}

export interface ProjectedRequirementEvidence {
  readonly requirementId: string;
  readonly evidence: readonly ProjectedEvidence[];
  /**
   * El claim más débil que ESTE run consideró defendible, cuando la búsqueda
   * terminó en `FOUND`. Texto persistido, copiado exacto.
   *
   * Se proyecta para CUALQUIER `finalState`, no sólo `PARTIALLY_SUPPORTED`: el
   * campo existe en el artefacto con independencia del estado, y decidir cuándo
   * mostrarlo es una decisión de presentación, no de contrato.
   */
  readonly supportedWeakerClaim: string | null;
}

// ---------------------------------------------------------------------------
// STATUS_AT_RUN — decisión auditada, no omisión por descuido
// ---------------------------------------------------------------------------

/**
 * NO se proyecta `statusChangedSinceRun`, y conviene dejar escrito por qué.
 *
 * NO EXISTE una instantánea autoritativa del estado de la credencial al momento
 * del run. `ReasoningRunInventoryItem` no tiene columna de estado; la única
 * columna adyacente es `disposition`.
 *
 * Es tentador derivarlo igual: F3.2 clasifica como
 * `EXCLUDED_CREDENTIAL_STATE_DRAFT` / `EXCLUDED_CREDENTIAL_STATE_REVOKED` antes de
 * mirar las fuentes, así que HOY una fila `INCLUDED` implica que la credencial no
 * estaba ni en borrador ni revocada al congelar, y con tres valores en
 * `CredentialStatus` eso implica `issued`. La inferencia es correcta hoy.
 *
 * Y aun así no se hace. `disposition` registra la DECISIÓN de inclusión, no el
 * estado observado: el día que se agregue un estado de credencial, o una razón de
 * exclusión nueva que no dependa del estado, la inferencia se vuelve falsa en
 * silencio y ya estaría publicada como un booleano que afirma historia. Un hecho
 * histórico necesita una columna que lo diga, no un corolario de otra decisión.
 *
 *     CREDENTIAL_STATUS_AT_RUN_SNAPSHOT: NONE
 *
 * Se expone `currentStatus`, nombrado como lo que es. Comparar con el pasado es
 * un contrato distinto y necesitaría persistencia propia.
 */
export const CREDENTIAL_STATUS_AT_RUN_SNAPSHOT = 'NONE';

// ---------------------------------------------------------------------------
// Conjunto de evidencia que RESPALDA
// ---------------------------------------------------------------------------

/**
 * Los ids de EvidenceUnit que respaldan el resultado de un Requirement.
 *
 * `evaluatedEvidence[]` NO ES ESTE CONJUNTO, y confundirlos sería el error más
 * caro de todo el slice: esa colección incluye `RELATED_NON_ENTAILING`,
 * `LIMITED_SCOPE` y `CONFLICTING` — cosas que el razonador MIRÓ, no cosas que
 * respalden nada. Mostrarlas como respaldo le diría al holder que una credencial
 * apoya un requisito cuando el run concluyó lo contrario.
 *
 * La autoridad de citación es la misma que usa `renderExplanation` en la policy
 * determinista: el techo de claim conjunto, más el candidato más débil sólo si la
 * búsqueda terminó en `FOUND`. Misma fuente, mismo orden.
 *
 * `Set` preserva el orden de inserción, así que la deduplicación conserva la
 * primera aparición.
 */
export function supportingEvidenceUnitIds(
  requirementResult: RequirementResult
): readonly string[] {
  const search = requirementResult.weakerClaimSearch;
  const fromWeaker =
    search.status === 'FOUND' && search.candidate !== null
      ? search.candidate.supportingEvidenceUnitIds
      : [];

  return Object.freeze([
    ...new Set([
      ...requirementResult.jointClaimCeiling.supportingEvidenceUnitIds,
      ...fromWeaker
    ])
  ]);
}

/** El claim más débil defendible, o `null`. Copiado exacto, nunca parseado. */
export function supportedWeakerClaim(
  requirementResult: RequirementResult
): string | null {
  const search = requirementResult.weakerClaimSearch;
  if (search.status !== 'FOUND' || search.candidate === null) return null;
  return search.candidate.text;
}

// ---------------------------------------------------------------------------
// Proyección
// ---------------------------------------------------------------------------

function sourceKindOf(item: FrozenInventorySourceView): ProjectedSourceKind {
  if (item.documentEvidenceId !== null && item.textEvidenceId === null) {
    return 'DOCUMENT';
  }
  if (item.textEvidenceId !== null && item.documentEvidenceId === null) {
    return 'TEXT';
  }
  // Una fila INCLUDED apunta a EXACTAMENTE una entidad de evidencia. Ni cero ni
  // dos: las dos formas describen un inventario que no se puede citar.
  return failEvidenceProjection('INVENTORY_SOURCE_BINDING_INCONSISTENT');
}

/**
 * `contextBefore` / `contextAfter` son strings vacíos cuando la cita está en el
 * borde de la fuente. Se proyectan como `null` en ese caso: para el consumidor,
 * "no hay contexto" y "el contexto es la cadena vacía" son lo mismo, y `null`
 * evita que alguien renderice comillas alrededor de nada.
 */
const emptyToNull = (value: string): string | null =>
  value.length === 0 ? null : value;

function projectEvidenceUnit(
  unit: EvidenceUnitV1,
  inventoryBySourceId: ReadonlyMap<string, FrozenInventorySourceView>
): ProjectedEvidence {
  const item = inventoryBySourceId.get(unit.sourceTrace.sourceId);
  if (item === undefined) {
    // El `src_NN` del catálogo no está en el inventario congelado de ESTE run.
    // Nunca se busca en otro run ni se cae a la fuente actual de la credencial:
    // eso mostraría una cita respaldada por algo que el run no usó.
    return failEvidenceProjection('SOURCE_NOT_IN_FROZEN_INVENTORY');
  }

  return {
    // VERBATIM. Recortar acá desplazaría en silencio lo que el run citó.
    excerpt: unit.sourceTrace.exactExcerpt,
    contextBefore: emptyToNull(unit.contextBefore),
    contextAfter: emptyToNull(unit.contextAfter),
    sectionLabel: unit.sectionLabel,
    pageNumber: unit.sourceTrace.pageNumber,
    coverage: unit.extractionQuality,
    sourceKind: sourceKindOf(item),
    credential:
      item.credential === null
        ? null
        : {
            credentialReference: item.credential.id,
            title: item.credential.title,
            credentialType: item.credential.credentialType,
            issuerName: item.credential.issuerName,
            currentStatus: item.credential.currentStatus
          }
  };
}

/**
 * Proyecta la evidencia de TODOS los Requirements de un run completado.
 *
 * FALLA CERRADO ante cualquier inconsistencia. La policy determinista, al
 * renderizar su explicación, SALTEA una unidad que no encuentra en el catálogo
 * —es un string de diagnóstico y degradar ahí es aceptable—. Acá no: omitir en
 * silencio una evidencia produciría una pantalla que afirma menos respaldo del
 * que el run encontró, sin que nadie se entere. Es la misma disciplina que
 * `toVerifiedView` aplica a la historia del run.
 */
export function projectReasoningRunEvidence(
  requirementResults: readonly RequirementResult[],
  evidenceUnits: EvidenceUnitsV1,
  inventory: readonly FrozenInventorySourceView[]
): ReadonlyMap<string, ProjectedRequirementEvidence> {
  const unitById = new Map(
    evidenceUnits.evidenceUnits.map((unit) => [unit.evidenceUnitId, unit])
  );

  const inventoryBySourceId = new Map<string, FrozenInventorySourceView>();
  for (const item of inventory) {
    if (inventoryBySourceId.has(item.runLocalSourceId)) {
      // Hay un UNIQUE sobre (reasoningRunId, runLocalSourceId): un duplicado acá
      // significa que se mezclaron filas de más de un run.
      return failEvidenceProjection('INVENTORY_SOURCE_BINDING_INCONSISTENT');
    }
    inventoryBySourceId.set(item.runLocalSourceId, item);
  }

  const projected = new Map<string, ProjectedRequirementEvidence>();
  for (const requirementResult of requirementResults) {
    const evidence = supportingEvidenceUnitIds(requirementResult).map((id) => {
      const unit = unitById.get(id);
      if (unit === undefined) {
        // El resultado cita una unidad que su propio catálogo no tiene.
        return failEvidenceProjection('EVIDENCE_UNIT_NOT_IN_CATALOG');
      }
      return projectEvidenceUnit(unit, inventoryBySourceId);
    });

    projected.set(requirementResult.requirementId, {
      requirementId: requirementResult.requirementId,
      evidence: Object.freeze(evidence),
      supportedWeakerClaim: supportedWeakerClaim(requirementResult)
    });
  }

  return projected;
}

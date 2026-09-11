/**
 * Servicio interno de Objectives — slice F2.1.
 *
 * Sin controller y sin superficie HTTP: F2.1 sólo construye la capa de dominio.
 * Los Objectives son PRIVADOS y user-owned; toda lectura va acotada por
 * `ownerUserId` desde la propia consulta, no por un chequeo posterior.
 *
 * UNA FILA FINALIZADA NO SE EDITA. No existe `updateDefinition`, ni
 * `updateTitle`, ni `delete`, ni `publish`, ni `share`. La unica transicion
 * posible es `status: active -> superseded`, exactamente una vez, como parte de
 * crear una revision.
 *
 * ALCANCE REAL DE LA INMUTABILIDAD, sin exagerar:
 *
 *     OBJECTIVE_IMMUTABILITY_ENFORCEMENT: APPLICATION_WRITE_PATH
 *     OBJECTIVE_TAMPER_EVIDENT_AT_REST:   NO
 *
 * Se hace cumplir por la API de este servicio, por la ausencia de operaciones de
 * update genericas y por los tests. NO es inmutabilidad a nivel de base: alguien
 * con acceso SQL directo puede modificar `definition`. No se agrego trigger,
 * hash ni fingerprint sólo para poder afirmar lo contrario.
 *
 * QUE DETECTA Y QUE NO DETECTA LA RE-VERIFICACION EN LECTURA. Conviene ser
 * exacto, porque es facil sobrevender esta garantia:
 *
 *   DETECTA    un artifact malformado
 *              una violacion del contrato `objective_definition_v1`
 *              `row.objectiveType != definition.objectiveType`
 *
 *   NO DETECTA un `objective_definition_v1` VALIDO reemplazado fuera de banda
 *              por OTRO artifact valido con el mismo `objectiveType` de fila.
 *              Ese cambio pasa la verificacion entera y es indistinguible.
 *
 * Es decir: la lectura protege contra corrupcion, no contra manipulacion
 * deliberada. Es una limitacion ACEPTADA de F2.1, no un defecto a corregir aqui.
 * Si F3 necesitara binding historico a prueba de manipulacion, tendra que
 * decidir su fuerza —`objectiveId` solo, snapshot del artifact dentro del run, o
 * fingerprint + id—; F2.1 deliberadamente no toma esa decision.
 */

import { Injectable } from '@nestjs/common';
import { ObjectiveStatus, ObjectiveType, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  buildObjectiveDefinitionV1,
  type ObjectiveDefinitionInput
} from './objective-definition.builder';
import { failObjective } from './objective-definition.errors';
import { type VerifiedObjectiveDefinition } from './objective-definition.types';
import { verifyObjectiveDefinitionArtifact } from './objective-definition.validator';

/** Columnas de la lista: NO carga `definition`. */
const OBJECTIVE_SUMMARY_SELECT = {
  id: true,
  objectiveType: true,
  title: true,
  status: true,
  supersedesObjectiveId: true,
  createdAt: true
} as const;

const OBJECTIVE_FULL_SELECT = {
  ...OBJECTIVE_SUMMARY_SELECT,
  ownerUserId: true,
  definition: true
} as const;

export interface ObjectiveSummary {
  readonly id: string;
  readonly objectiveType: ObjectiveType;
  readonly title: string;
  readonly status: ObjectiveStatus;
  readonly supersedesObjectiveId: string | null;
  readonly createdAt: Date;
}

export interface VerifiedObjective extends ObjectiveSummary {
  readonly ownerUserId: string;
  readonly definition: VerifiedObjectiveDefinition;
}

export interface CreateObjectiveInput {
  readonly title: string;
  readonly definition: ObjectiveDefinitionInput;
}

interface RawObjectiveRow {
  id: string;
  ownerUserId: string;
  objectiveType: ObjectiveType;
  title: string;
  status: ObjectiveStatus;
  supersedesObjectiveId: string | null;
  createdAt: Date;
  definition: Prisma.JsonValue;
}

@Injectable()
export class ObjectivesService {
  public constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Creacion
  // -------------------------------------------------------------------------

  /**
   * Crea un Objective finalizado en una sola operacion.
   *
   * `DRAFT_POLICY: NONE_IN_V1`: no hay estado intermedio persistido y no hay una
   * segunda escritura. `createdAt` es simultaneamente creacion y finalizacion.
   */
  public async createForUser(
    ownerUserId: string,
    input: CreateObjectiveInput
  ): Promise<VerifiedObjective> {
    const title = this.normalizeTitle(input.title);

    // build -> verify -> persist, siempre en ese orden. Nada llega a la base sin
    // haber pasado por el mismo verificador que se usa al releer.
    const definition = verifyObjectiveDefinitionArtifact(
      buildObjectiveDefinitionV1(input.definition)
    );

    const row = await this.prisma.objective.create({
      data: {
        ownerUserId,
        // El tipo se toma UNA sola vez, del artifact ya verificado, y alimenta
        // columna y JSON. Asi el mismatch no es representable en la escritura;
        // la lectura lo comprueba igual, por si la fila cambio por debajo.
        objectiveType: definition.objectiveType,
        title,
        definition: definition as unknown as Prisma.InputJsonValue,
        status: ObjectiveStatus.active,
        supersedesObjectiveId: null
      },
      select: OBJECTIVE_FULL_SELECT
    });

    return this.toVerifiedObjective(row as RawObjectiveRow);
  }

  // -------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------

  /**
   * Lee un Objective del usuario y vuelve a verificar su artifact.
   *
   * La consulta va acotada por `id + ownerUserId`: un Objective de otro usuario
   * no se distingue de uno inexistente, y ninguno de los dos casos revela nada.
   */
  public async getForUser(
    ownerUserId: string,
    objectiveId: string
  ): Promise<VerifiedObjective> {
    const row = await this.prisma.objective.findFirst({
      where: { id: objectiveId, ownerUserId },
      select: OBJECTIVE_FULL_SELECT
    });

    if (!row) {
      failObjective('OBJECTIVE_NOT_FOUND', {
        invariant: 'objective_does_not_exist_for_this_owner',
        objectiveId
      });
    }

    return this.toVerifiedObjective(row as RawObjectiveRow);
  }

  /**
   * Lista los Objectives del usuario SIN cargar `definition`.
   *
   * Esto es lo que materializa la unica duplicacion deliberada del diseño: la
   * lista filtra y muestra por `objectiveType` leyendo la COLUMNA. Si el tipo
   * viviera sólo dentro del artifact, listar exigiria traer todos los JSON.
   */
  public async listForUser(
    ownerUserId: string,
    filters: { status?: ObjectiveStatus; objectiveType?: ObjectiveType } = {}
  ): Promise<readonly ObjectiveSummary[]> {
    const rows = await this.prisma.objective.findMany({
      where: {
        ownerUserId,
        status: filters.status ?? ObjectiveStatus.active,
        ...(filters.objectiveType ? { objectiveType: filters.objectiveType } : {})
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: OBJECTIVE_SUMMARY_SELECT
    });

    return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
  }

  // -------------------------------------------------------------------------
  // Revision
  // -------------------------------------------------------------------------

  /**
   * Crea la revision de un Objective activo.
   *
   * Atomico: dentro de una transaccion se marca el predecesor como `superseded`
   * de forma CONDICIONAL y se crea la fila sucesora. Si la transicion condicional
   * no aplica —porque otra revision gano la carrera, o porque el predecesor ya no
   * esta activo—, no se crea ninguna sucesora.
   *
   *     REVISION_SINGLE_WINNER: ENFORCED_BY_PRODUCT_WRITE_PATH
   *     DATABASE_BRANCHING_CONSTRAINT: NONE_IN_V1
   *
   * No hay `UNIQUE(supersedesObjectiveId)`: F2.0 no congelo esa constraint y
   * agregarla aqui prohibiria para siempre cualquier branching futuro sin que
   * nadie lo haya decidido. Lo que garantiza un unico ganador es el
   * compare-and-set sobre `status`, no una restriccion estructural.
   *
   * UNA REVISION PUEDE CAMBIARLO TODO, incluido `objectiveType`:
   *
   *     REVISION_TYPE_CONTINUITY: NOT_REQUIRED
   *
   * F2.0 no congelo igualdad de tipo entre versiones. `objectiveType` es un
   * discriminante de contexto y presentacion, y la estructura de Requirements es
   * comun a todos los tipos, asi que corregir una clasificacion —`OTHER` ->
   * `EMPLOYMENT`, por ejemplo— es una revision legitima. Obligar a crear un
   * Objective base nuevo perderia el linaje de esa correccion sin ganar nada.
   *
   * Lo que hace que esto sea una revision es `supersedesObjectiveId`, no que
   * coincida ningun discriminante. Y la fila anterior nunca cambia de contenido:
   * conserva su propio tipo y su propio artifact.
   */
  public async createRevisionForUser(
    ownerUserId: string,
    previousObjectiveId: string,
    input: CreateObjectiveInput
  ): Promise<VerifiedObjective> {
    const title = this.normalizeTitle(input.title);

    // Se construye y verifica ANTES de tocar el lifecycle: un artifact invalido
    // no debe llegar a marcar nada como superseded.
    const definition = verifyObjectiveDefinitionArtifact(
      buildObjectiveDefinitionV1(input.definition)
    );

    const created = await this.prisma.$transaction(
      async (transaction) => {
        const previous = await transaction.objective.findFirst({
          where: { id: previousObjectiveId, ownerUserId },
          select: { id: true, status: true }
        });

        if (!previous) {
          failObjective('OBJECTIVE_NOT_FOUND', {
            invariant: 'previous_objective_does_not_exist_for_this_owner',
            objectiveId: previousObjectiveId
          });
        }
        if (previous.status !== ObjectiveStatus.active) {
          failObjective('OBJECTIVE_NOT_ACTIVE', {
            invariant: 'only_an_active_objective_can_be_revised',
            objectiveId: previousObjectiveId
          });
        }

        // Compare-and-set: mismo patron que el claim de AnalysisRun y que el
        // fill del extraction slot. `active -> superseded` exactamente una vez.
        const superseded = await transaction.objective.updateMany({
          where: {
            id: previousObjectiveId,
            ownerUserId,
            status: ObjectiveStatus.active
          },
          data: { status: ObjectiveStatus.superseded }
        });

        if (superseded.count !== 1) {
          // Otra revision gano entre el findFirst y el update. Se aborta sin
          // crear sucesora: nunca dos sucesoras del mismo predecesor por este
          // camino.
          failObjective('OBJECTIVE_REVISION_CONFLICT', {
            invariant: 'previous_objective_was_superseded_concurrently',
            objectiveId: previousObjectiveId
          });
        }

        return transaction.objective.create({
          data: {
            ownerUserId,
            objectiveType: definition.objectiveType,
            title,
            definition: definition as unknown as Prisma.InputJsonValue,
            status: ObjectiveStatus.active,
            supersedesObjectiveId: previous.id
          },
          select: OBJECTIVE_FULL_SELECT
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return this.toVerifiedObjective(created as RawObjectiveRow);
  }

  // -------------------------------------------------------------------------
  // Verificacion de lo persistido
  // -------------------------------------------------------------------------

  /**
   * La persistencia es un borde NO CONFIABLE en la lectura.
   *
   * `Prisma.JsonValue` no es prueba contractual de nada: dice que es JSON, no que
   * sea un `objective_definition_v1`. Se trata como `unknown` y se vuelve a
   * verificar entero, igual que hace F1.2 con el extraction slot.
   *
   * Si la fila viola el contrato es CORRUPCION: se falla de forma determinista y
   * NO se repara ni se modifica la fila.
   */
  private toVerifiedObjective(row: RawObjectiveRow): VerifiedObjective {
    let definition: VerifiedObjectiveDefinition;
    try {
      definition = verifyObjectiveDefinitionArtifact(row.definition);
    } catch (error) {
      failObjective('OBJECTIVE_DEFINITION_CORRUPT', {
        invariant: `persisted_definition_violates_the_artifact_contract:${
          (error as { code?: string }).code ?? 'UNKNOWN'
        }`,
        objectiveId: row.id
      });
    }

    // La igualdad columna/artifact se comprueba TAMBIEN al leer. En escritura el
    // mismatch no es representable, pero la fila pudo cambiar por debajo y elegir
    // en silencio uno de los dos valores seria peor que fallar.
    if (row.objectiveType !== definition.objectiveType) {
      failObjective('OBJECTIVE_TYPE_MISMATCH', {
        invariant: 'row_objective_type_must_equal_definition_objective_type',
        objectiveId: row.id
      });
    }

    return Object.freeze({
      id: row.id,
      ownerUserId: row.ownerUserId,
      objectiveType: row.objectiveType,
      title: row.title,
      status: row.status,
      supersedesObjectiveId: row.supersedesObjectiveId,
      createdAt: row.createdAt,
      definition
    });
  }

  /**
   * Titulo: se rechaza vacio o sólo whitespace, y se preserva el valor exacto.
   *
   * El repo no tiene una convencion unica de normalizacion de titulos —hay
   * `trim()` en unos sitios y preservacion literal en otros—, asi que se toma la
   * regla conservadora: no inventar una normalizacion epistemica sobre algo que
   * el usuario escribio.
   */
  private normalizeTitle(title: unknown): string {
    if (typeof title !== 'string' || title.trim().length === 0) {
      failObjective('OBJECTIVE_TITLE_INVALID', {
        invariant: 'title_must_be_a_non_blank_string'
      });
    }
    return title;
  }
}

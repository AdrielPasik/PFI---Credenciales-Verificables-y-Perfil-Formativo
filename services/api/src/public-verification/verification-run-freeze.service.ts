/**
 * Congelamiento del VerificationRun publico.
 *
 * Responde, sin ninguna llamada a modelo:
 *
 *     "Con el consentimiento que el holder tenia vigente, para el objetivo que el
 *      verificador confirmo, que evidencia exacta quedo preparada?"
 *
 * NO propone requisitos, NO ejecuta Objective Analysis, NO construye Evidence
 * Units, NO razona y NO crea extracciones. Deja los cuatro slots de etapa en null.
 *
 * LA AUTORIDAD LLEGA SOLO POR TOKENS. La entrada publica acepta el token del
 * enlace y el token de la solicitud, y nada mas: no hay forma de pasar ids de
 * credenciales, de evidencia, de `AnalysisRunSource` ni SHAs. El universo de
 * credenciales sale del consentimiento del holder, leido del lado del servidor.
 *
 * UN SOLO SECRETO DE SESION. El token de la solicitud congela el run Y despues lo
 * resuelve. No existe un token de resultado aparte: si el verificador pierde la
 * respuesta de la ejecucion, repetirla con el mismo token devuelve el MISMO run y
 * no crea otro. Un segundo secreto irrecuperable lo habria dejado sin acceso.
 *
 * DOS VENCIMIENTOS DISTINTOS, a proposito.
 *   - `VerificationRequest.expiresAt` limita la etapa PREVIA al run: confirmar y
 *     congelar. Vencida y sin consumir, no hay run nuevo.
 *   - Un run YA congelado no hereda ese vencimiento. Se sigue resolviendo con el
 *     mismo token, subordinado al ENLACE: activo, no revocado, no vencido.
 *   No se reescribe ni se extiende `expiresAt` para simular lo segundo.
 *
 * ESTRATEGIA CONTRA CARRERAS DE CONSENTIMIENTO — dos fases.
 *
 *   prepare()  lectura, sin escritura: resuelve enlace, politica, version y
 *              conjunto autorizado, y los captura como UN snapshot.
 *
 *   commit()   UNA transaccion SERIALIZABLE y corta:
 *                1. relee el enlace       -> sigue activo y de alcance soportado
 *                2. relee la politica     -> sigue habilitada
 *                                            Y `policyVersion` es la del snapshot
 *                                            Y el conjunto es el del snapshot
 *                3. relee la solicitud    -> confirmada, vigente, sin consumir
 *                4. clasifica evidencia   -> dentro de la misma transaccion
 *                5. consume + crea run + inventario, o nada
 *
 * Por que la version basta para el conjunto: el unico escritor de la politica
 * incrementa `policyVersion` en la MISMA transaccion en que cambia el conjunto.
 * Version igual => conjunto igual. Igual se compara el conjunto (paso 2): si
 * alguna vez apareciera un escritor que no respete esa regla, esto falla cerrado
 * en lugar de mezclar una version con otro conjunto.
 *
 * Si la version cambio, NO se reconstruye con la politica nueva dentro del mismo
 * intento: se devuelve `AUTHORIZATION_CHANGED`, reintentable. Rehacer en silencio
 * congelaria un consentimiento que nadie verifico en este intento.
 *
 * La transaccion no espera red ni storage: la clasificacion es solo base de datos
 * (`verifyReadExtractionSlot` valida el artifact contra su blob en memoria). Eso
 * es lo que permite hacer la clasificacion ADENTRO, sobre el mismo estado que se
 * persiste, igual que el freeze del holder.
 */

import { Injectable } from '@nestjs/common';
import {
  Prisma,
  ReasoningRunInventoryDisposition,
  ReasoningRunStatus,
  VerificationRequestStatus
} from '@prisma/client';

import { verifyObjectiveDefinitionArtifact } from '../objectives/objective-definition.validator';
import { PrismaService } from '../prisma/prisma.service';
import {
  classifyCredentialInventory,
  isBlockedDisposition,
  loadCredentialsForInventory
} from '../reasoning-run/credential-inventory.classifier';
import { SourceExtractionSlotService } from '../source-extraction/source-extraction-slot.service';
import {
  SHARE_AUTHORITY_SELECT,
  assertContextualShareAuthority,
  assertShareValid,
  loadShareAuthorityByToken,
  sameAuthorizedSet
} from './contextual-share-authority';
import { hashOpaqueToken, normalizeOpaqueToken } from './opaque-token';
import { PublicVerificationError } from './public-verification.errors';

const D = ReasoningRunInventoryDisposition;

/**
 * El consentimiento capturado en `prepare()`. INTERNO: lleva ids de base y nunca
 * sale del servidor.
 */
export interface ConsentSnapshot {
  readonly sharingGrantId: string;
  readonly holderUserId: string;
  readonly verificationRequestId: string;
  readonly policyVersion: number;
  readonly authorizedCredentialIds: readonly string[];
}

export type PrepareResult =
  | { readonly kind: 'READY'; readonly snapshot: ConsentSnapshot }
  | { readonly kind: 'ALREADY_FROZEN'; readonly status: ReasoningRunStatus };

/**
 * Resultado sin ids, SHAs ni tokens. `CREATED` y `ALREADY_FROZEN` describen el
 * MISMO run logico: el segundo es la respuesta a un reintento, no un run distinto.
 */
export type FrozenVerificationRunResult =
  | {
      readonly outcome: 'CREATED';
      readonly status: ReasoningRunStatus;
      readonly inventorySize: number;
      readonly includedSourceCount: number;
      readonly blockedSourceCount: number;
    }
  | { readonly outcome: 'ALREADY_FROZEN'; readonly status: ReasoningRunStatus };

/** Lo que resuelve el token de la solicitud, sin ids. */
export type VerificationSessionRun =
  | { readonly kind: 'FROZEN'; readonly status: ReasoningRunStatus }
  | { readonly kind: 'NOT_FROZEN' };

const REQUEST_SELECT = {
  id: true,
  sharingGrantId: true,
  status: true,
  expiresAt: true,
  consumedAt: true,
  objectiveTitle: true,
  confirmedObjectiveDefinition: true,
  run: { select: { status: true } }
} satisfies Prisma.VerificationRequestSelect;

@Injectable()
export class VerificationRunFreezeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slots: SourceExtractionSlotService
  ) {}

  /** Entrada de producto: las dos fases, en orden. */
  async createFrozenRun(
    rawShareToken: unknown,
    rawRequestToken: unknown,
    now: Date = new Date()
  ): Promise<FrozenVerificationRunResult> {
    const prepared = await this.prepare(rawShareToken, rawRequestToken, now);
    if (prepared.kind === 'ALREADY_FROZEN') {
      return { outcome: 'ALREADY_FROZEN', status: prepared.status };
    }
    return this.commit(prepared.snapshot, now);
  }

  // -------------------------------------------------------------------------
  // Fase 1 — captura del consentimiento
  // -------------------------------------------------------------------------

  async prepare(
    rawShareToken: unknown,
    rawRequestToken: unknown,
    now: Date = new Date()
  ): Promise<PrepareResult> {
    const { grant, request } = await this.loadSession(rawShareToken, rawRequestToken, now);

    // Idempotencia: un segundo intento sobre una solicitud ya consumida no crea
    // otro run. Va ANTES que la politica Y antes que el vencimiento de la
    // solicitud: deshabilitar la politica corta runs NUEVOS, y el TTL de la
    // solicitud limita la etapa previa al run -- ninguno de los dos vuelve
    // inexistente uno que ya se congelo.
    if (request.status === VerificationRequestStatus.consumed) {
      return { kind: 'ALREADY_FROZEN', status: existingRunStatus(request) };
    }

    const authority = assertContextualShareAuthority(grant, now);
    assertRequestFreezable(request, now);

    return {
      kind: 'READY',
      snapshot: {
        sharingGrantId: authority.sharingGrantId,
        holderUserId: authority.holderUserId,
        verificationRequestId: request.id,
        policyVersion: authority.policyVersion,
        authorizedCredentialIds: authority.authorizedCredentialIds
      }
    };
  }

  // -------------------------------------------------------------------------
  // Resolucion de la sesion por el token de la solicitud
  // -------------------------------------------------------------------------

  /**
   * Que run produjo esta sesion, si produjo alguno. Solo lectura.
   *
   * Es la regla de autoridad que despues usara la lectura publica del resultado:
   *
   *   enlace revocado / vencido / alcance no soportado  -> SHARE_NOT_AVAILABLE
   *   solicitud inexistente o de otro enlace            -> REQUEST_NOT_AVAILABLE
   *   run congelado                                     -> FROZEN, aunque la
   *                                                        solicitud haya vencido
   *   sin run y vencida                                 -> REQUEST_NOT_AVAILABLE
   *   sin run y vigente                                 -> NOT_FROZEN
   *
   * La politica de computo NO se mira: deshabilitarla impide runs nuevos, no
   * oculta uno que ya existe. El enlace si manda: revocarlo corta el acceso.
   */
  async resolveSessionRun(
    rawShareToken: unknown,
    rawRequestToken: unknown,
    now: Date = new Date()
  ): Promise<VerificationSessionRun> {
    const { request } = await this.loadSession(rawShareToken, rawRequestToken, now);

    if (request.status === VerificationRequestStatus.consumed) {
      return { kind: 'FROZEN', status: existingRunStatus(request) };
    }
    if (request.expiresAt <= now) {
      throw new PublicVerificationError('REQUEST_NOT_AVAILABLE');
    }
    return { kind: 'NOT_FROZEN' };
  }

  /**
   * Enlace primero, solicitud despues, y la solicitud tiene que ser de ESE enlace.
   * No evalua politica ni vencimiento de la solicitud: cada llamante decide eso.
   */
  private async loadSession(rawShareToken: unknown, rawRequestToken: unknown, now: Date) {
    // Revocado, vencido o de alcance no soportado: nada de lo que sigue se
    // evalua. Ni siquiera "esta solicitud ya tiene run".
    const grant = await loadShareAuthorityByToken(this.prisma, rawShareToken);
    assertShareValid(grant, now);

    const requestToken = normalizeOpaqueToken(rawRequestToken);
    if (requestToken === null) throw new PublicVerificationError('REQUEST_NOT_AVAILABLE');

    const request = await this.prisma.verificationRequest.findUnique({
      where: { requestTokenHash: hashOpaqueToken(requestToken) },
      select: REQUEST_SELECT
    });

    // Una solicitud de OTRO enlace responde igual que una inexistente.
    if (!request || request.sharingGrantId !== grant.id) {
      throw new PublicVerificationError('REQUEST_NOT_AVAILABLE');
    }
    return { grant, request };
  }

  // -------------------------------------------------------------------------
  // Fase 2 — re-verificacion atomica y persistencia
  // -------------------------------------------------------------------------

  async commit(
    snapshot: ConsentSnapshot,
    now: Date = new Date()
  ): Promise<FrozenVerificationRunResult> {
    try {
      return await this.prisma.$transaction(
        async (tx) => this.commitInTransaction(tx, snapshot, now),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error: unknown) {
      if (error instanceof PublicVerificationError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // P2034: conflicto de serializacion. Otra escritura concurrente tocaba el
        // mismo estado; nada se persistio. P2002: la UNIQUE de
        // `verificationRequestId` gano la carrera. En los dos casos el reintento
        // resuelve: o congela, o devuelve el run existente.
        if (error.code === 'P2034' || error.code === 'P2002') {
          throw new PublicVerificationError('FREEZE_CONFLICT');
        }
      }
      throw error;
    }
  }

  private async commitInTransaction(
    tx: Prisma.TransactionClient,
    snapshot: ConsentSnapshot,
    now: Date
  ): Promise<FrozenVerificationRunResult> {
    // 1 + 2. El enlace y la politica se RELEEN. Una lectura anterior del token no
    // es autoridad permanente.
    const grant = await tx.sharingGrant.findUnique({
      where: { id: snapshot.sharingGrantId },
      select: SHARE_AUTHORITY_SELECT
    });
    const authority = assertContextualShareAuthority(grant, now);

    if (authority.policyVersion !== snapshot.policyVersion) {
      throw new PublicVerificationError('AUTHORIZATION_CHANGED');
    }
    if (!sameAuthorizedSet(authority.authorizedCredentialIds, snapshot.authorizedCredentialIds)) {
      // Version igual con conjunto distinto no deberia existir. Si aparece, se
      // falla cerrado: congelar esa mezcla es exactamente lo que se evita.
      throw new PublicVerificationError('AUTHORIZATION_CHANGED');
    }

    // 3. La solicitud, otra vez.
    const request = await tx.verificationRequest.findUnique({
      where: { id: snapshot.verificationRequestId },
      select: REQUEST_SELECT
    });
    if (!request || request.sharingGrantId !== authority.sharingGrantId) {
      throw new PublicVerificationError('REQUEST_NOT_AVAILABLE');
    }
    if (request.status === VerificationRequestStatus.consumed) {
      return { outcome: 'ALREADY_FROZEN', status: existingRunStatus(request) };
    }
    const definition = assertRequestFreezable(request, now);

    // 4. El universo es el conjunto AUTORIZADO, no el Wallet ni las 10 tarjetas
    // del perfil publico. `subjectUserId` se exige igual, como defensa en
    // profundidad sobre una propiedad que ya se valido al autorizar.
    const credentials = await loadCredentialsForInventory(tx, {
      id: { in: [...snapshot.authorizedCredentialIds] },
      subjectUserId: authority.holderUserId
    });
    if (credentials.length !== snapshot.authorizedCredentialIds.length) {
      // Una autorizacion que ya no apunta a una credencial del holder no puede
      // registrarse (no hay fila a la cual apuntar) ni ignorarse en silencio.
      throw new PublicVerificationError('AUTHORIZED_EVIDENCE_INCONSISTENT');
    }

    const rows = await classifyCredentialInventory(tx, this.slots, credentials);
    const included = rows.filter((row) => row.disposition === D.INCLUDED);
    const blocked = rows.filter((row) => isBlockedDisposition(row.disposition));

    // POLITICA PUBLICA DE BLOQUEO -- distinta del holder, a proposito.
    //
    // Una disposicion BLOCKED_* (extraccion ausente o que no verifica) es un
    // estado TECNICO del lado del holder, no una propiedad del objetivo del
    // verificador. Congelar un run fallido consumiria la sesion del tercero y una
    // unidad de su cuota por algo que no puede arreglar. Entonces: NO se crea
    // run, NO se consume la solicitud, y el error es reintentable. Va ANTES que
    // el chequeo de INCLUDED: un universo enteramente bloqueado es "todavia no",
    // no "nunca".
    //
    // Tampoco se congela un run PARCIAL que ignore lo bloqueado: la evidencia que
    // el holder autorizo no se descarta en silencio.
    if (blocked.length > 0) {
      throw new PublicVerificationError('AUTHORIZED_EVIDENCE_TEMPORARILY_UNAVAILABLE');
    }

    // Sin ningun INCLUDED no hay nada sobre que razonar: no se crea run y la
    // solicitud NO se consume.
    if (included.length === 0) {
      throw new PublicVerificationError('NO_USABLE_AUTHORIZED_EVIDENCE');
    }

    // 5. Consumo con compare-and-set. Si otro intento concurrente ya la consumio,
    // `count` es 0 y esta transaccion no persiste nada.
    const consumed = await tx.verificationRequest.updateMany({
      where: {
        id: request.id,
        status: VerificationRequestStatus.requirements_confirmed,
        consumedAt: null
      },
      data: { status: VerificationRequestStatus.consumed, consumedAt: now }
    });
    if (consumed.count !== 1) {
      throw new PublicVerificationError('FREEZE_CONFLICT');
    }

    const run = await tx.verificationRun.create({
      data: {
        verificationRequestId: request.id,
        sharingGrantId: authority.sharingGrantId,
        policyVersionSnapshot: snapshot.policyVersion,
        objectiveDefinitionSnapshot: definition as Prisma.InputJsonValue,
        objectiveTitleSnapshot: request.objectiveTitle,
        status: ReasoningRunStatus.pending,
        inventory: { create: rows.map((row) => ({ ...row })) }
      },
      select: { status: true }
    });

    return {
      outcome: 'CREATED',
      status: run.status,
      inventorySize: rows.length,
      includedSourceCount: included.length,
      // Siempre 0: con cualquier bloqueo no hay run. Se conserva como testigo
      // explicito de esa regla.
      blockedSourceCount: 0
    };
  }
}

/**
 * Consumo y creacion del run ocurren en la MISMA transaccion, asi que una
 * solicitud consumida sin run no puede existir. Si aparece, se falla fuerte: no
 * se la disfraza de run fallido.
 */
function existingRunStatus(
  request: Prisma.VerificationRequestGetPayload<{ select: typeof REQUEST_SELECT }>
): ReasoningRunStatus {
  if (!request.run) {
    throw new Error('verification_request_consumed_without_run');
  }
  return request.run.status;
}

function assertRequestFreezable(
  request: Prisma.VerificationRequestGetPayload<{ select: typeof REQUEST_SELECT }>,
  now: Date
): unknown {
  // El vencimiento se deriva, no se persiste.
  if (request.expiresAt <= now) {
    throw new PublicVerificationError('REQUEST_NOT_AVAILABLE');
  }
  if (
    request.status !== VerificationRequestStatus.requirements_confirmed ||
    request.confirmedObjectiveDefinition === null
  ) {
    throw new PublicVerificationError('REQUEST_NOT_CONFIRMED');
  }

  // El MISMO verificador productivo que el Objective del holder. Un run
  // congelado contra una definicion ilegible no podria validarse despues.
  try {
    verifyObjectiveDefinitionArtifact(request.confirmedObjectiveDefinition);
  } catch {
    throw new PublicVerificationError('OBJECTIVE_DEFINITION_INVALID');
  }
  return request.confirmedObjectiveDefinition;
}

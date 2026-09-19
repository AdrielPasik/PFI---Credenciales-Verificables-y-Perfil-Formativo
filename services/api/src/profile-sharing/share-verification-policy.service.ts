import { Injectable } from '@nestjs/common';
import { CredentialStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ShareVerificationPolicyError } from './share-verification-policy.error';
import { isShareActive, supportsContextualVerification } from './share-lifecycle';

export interface ShareVerificationPolicyStateDto {
  enabled: boolean;
  policyVersion: number;
  /** Lo que el holder eligio, tal cual. Puede incluir credenciales que hoy ya no son elegibles. */
  authorizedCredentialIds: string[];
  /** Subconjunto que HOY sigue siendo `issued`. Es lo que un run podria usar. */
  effectiveAuthorizedCredentialIds: string[];
  updatedAt: string | null;
}

interface ReplaceRequest {
  enabled: boolean;
  credentialIds: string[];
}

/**
 * CONSENTIMIENTO DE COMPUTO DEL HOLDER.
 *
 * Este servicio no razona, no lee fuentes y no llama a ningun proveedor:
 * administra UN permiso. Que exista no habilita todavia ningun endpoint publico
 * de analisis -- prepara la autoridad para que exista.
 *
 * CONSENTIMIENTO != ELEGIBILIDAD DE EJECUCION. Aca solo se valida lo que es
 * estable en el dominio (la credencial existe, es del holder y esta emitida).
 * Deliberadamente NO se mira si tiene extraccion, analisis semantico o evidence
 * units: eso es estado transitorio del pipeline y cambia solo. Atar el
 * consentimiento a eso haria que una politica se "rompiera" sin que el holder
 * hiciera nada. La interseccion con la evidencia realmente ejecutable se
 * resuelve --y se congela-- recien al crear un VerificationRun.
 */
@Injectable()
export class ShareVerificationPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async replaceForShare(
    userId: string,
    shareId: string,
    body: unknown
  ): Promise<ShareVerificationPolicyStateDto> {
    const request = parseReplaceRequest(body);

    const grant = await this.prisma.sharingGrant.findFirst({
      // `userId` va en el WHERE, no en una comprobacion posterior: un share de
      // otro holder tiene que ser indistinguible de uno inexistente.
      where: { id: shareId, userId },
      select: {
        id: true,
        scope: true,
        expiresAt: true,
        revokedAt: true,
        verificationPolicy: {
          select: {
            id: true,
            enabled: true,
            policyVersion: true,
            updatedAt: true,
            authorizedCredentials: { select: { credentialId: true } }
          }
        }
      }
    });
    if (!grant) throw new ShareVerificationPolicyError('SHARE_NOT_FOUND');

    // Antes de crear o tocar nada. La MISMA allowlist que despues aplica el
    // VerificationRun: habilitar computo sobre un alcance que el congelamiento
    // rechaza seria prometerle al holder un permiso que nunca rige. Un enlace
    // propio no es un oraculo para su dueño, asi que el codigo es especifico.
    if (!supportsContextualVerification(grant.scope)) {
      throw new ShareVerificationPolicyError('SHARE_SCOPE_NOT_SUPPORTED');
    }

    // Un enlace revocado o vencido no autoriza nada, asi que configurarle una
    // politica seria darle al holder la sensacion de un permiso que no rige.
    if (!isShareActive(grant)) {
      throw new ShareVerificationPolicyError('SHARE_NOT_ACTIVE');
    }

    const requestedIds = dedupePreservingOrder(request.credentialIds);

    // Habilitado sin evidencia mostraria un CTA publico que no puede razonar
    // nunca. Se rechaza antes de tocar la base.
    if (request.enabled && requestedIds.length === 0) {
      throw new ShareVerificationPolicyError('CREDENTIAL_SELECTION_REQUIRED');
    }

    const current = grant.verificationPolicy;
    const currentIds = (current?.authorizedCredentials ?? []).map((row) => row.credentialId);

    // Solo se valida lo que el holder AGREGA. Una credencial que ya estaba
    // autorizada y que despues fue revocada por su emisor sigue pudiendo
    // reenviarse: su fila describe una decision que el holder tomo cuando la
    // credencial era elegible, y obligarlo a desmarcarla para poder guardar
    // cualquier otro cambio seria reescribirle la intencion a fuerza de
    // friccion. Deja de contar como evidencia efectiva igual -- ver
    // `stillIssued`. Lo que NUNCA se puede es incorporar una nueva credencial
    // ajena, borrador o revocada.
    const alreadyAuthorized = new Set(currentIds);
    await this.assertAllAuthorizable(
      userId,
      requestedIds.filter((id) => !alreadyAuthorized.has(id))
    );
    const unchanged =
      current !== null &&
      current !== undefined &&
      current.enabled === request.enabled &&
      sameSet(currentIds, requestedIds);

    if (unchanged) {
      // Reenviar exactamente el mismo estado es idempotente: no se escribe nada
      // y `policyVersion` NO avanza. Ese numero se congelara dentro de un
      // VerificationRun, asi que inflarlo sin un cambio real de intencion
      // ensuciaria la trazabilidad del consentimiento.
      return this.stateOf(
        current.enabled,
        current.policyVersion,
        currentIds,
        current.updatedAt,
        userId
      );
    }

    const now = new Date();
    const policy = await this.prisma.$transaction(async (transaction) => {
      const saved = current
        ? await transaction.shareVerificationPolicy.update({
            where: { id: current.id },
            data: {
              enabled: request.enabled,
              policyVersion: { increment: 1 },
              // Se conserva la marca anterior cuando el estado no cambia: son
              // "la ultima vez que paso a habilitado/deshabilitado", no la
              // fecha del ultimo guardado.
              enabledAt: request.enabled && !current.enabled ? now : undefined,
              disabledAt: !request.enabled && current.enabled ? now : undefined
            },
            select: { id: true, enabled: true, policyVersion: true, updatedAt: true }
          })
        : await transaction.shareVerificationPolicy.create({
            data: {
              sharingGrantId: grant.id,
              enabled: request.enabled,
              enabledAt: request.enabled ? now : null,
              disabledAt: request.enabled ? null : now
            },
            select: { id: true, enabled: true, policyVersion: true, updatedAt: true }
          });

      // REEMPLAZO, no alta/baja incremental: el body describe el conjunto
      // COMPLETO. Se borra todo lo que ya no esta y se crea lo que falta,
      // dentro de la misma transaccion, asi que no existe un estado intermedio
      // donde el consentimiento este a medias.
      await transaction.shareVerificationCredentialAuthorization.deleteMany({
        where: { policyId: saved.id, credentialId: { notIn: requestedIds } }
      });
      if (requestedIds.length > 0) {
        await transaction.shareVerificationCredentialAuthorization.createMany({
          data: requestedIds.map((credentialId) => ({ policyId: saved.id, credentialId })),
          skipDuplicates: true
        });
      }

      return saved;
    });

    return this.stateOf(
      policy.enabled,
      policy.policyVersion,
      requestedIds,
      policy.updatedAt,
      userId
    );
  }

  /**
   * Todas o ninguna, sobre las credenciales RECIEN agregadas. Una sola consulta
   * acotada al holder: si el conteo no coincide con lo pedido, algo de lo
   * enviado no existe, no es suyo o no esta emitido -- y no importa cual, porque
   * los cuatro casos comparten codigo de error a proposito.
   */
  private async assertAllAuthorizable(userId: string, credentialIds: string[]): Promise<void> {
    if (credentialIds.length === 0) return;

    const eligible = await this.prisma.credential.findMany({
      where: {
        id: { in: credentialIds },
        subjectUserId: userId,
        status: CredentialStatus.issued
      },
      select: { id: true }
    });
    if (eligible.length !== credentialIds.length) {
      throw new ShareVerificationPolicyError('CREDENTIAL_NOT_AUTHORIZABLE');
    }
  }

  private async stateOf(
    enabled: boolean,
    policyVersion: number,
    authorizedCredentialIds: string[],
    updatedAt: Date | null,
    userId: string
  ): Promise<ShareVerificationPolicyStateDto> {
    return {
      enabled,
      policyVersion,
      authorizedCredentialIds,
      effectiveAuthorizedCredentialIds: await this.stillIssued(userId, authorizedCredentialIds),
      updatedAt: updatedAt ? updatedAt.toISOString() : null
    };
  }

  /**
   * Una credencial revocada DESPUES de autorizarse deja de contar como
   * evidencia efectiva, pero su fila de consentimiento se conserva: describe lo
   * que el holder quiso, y borrarla en silencio reescribiria su intencion. Por
   * la misma razon, ese cambio de ciclo de vida NO mueve `policyVersion`.
   */
  private async stillIssued(userId: string, credentialIds: string[]): Promise<string[]> {
    if (credentialIds.length === 0) return [];
    const issued = await this.prisma.credential.findMany({
      where: {
        id: { in: credentialIds },
        subjectUserId: userId,
        status: CredentialStatus.issued
      },
      select: { id: true }
    });
    const issuedIds = new Set(issued.map((row) => row.id));
    return credentialIds.filter((id) => issuedIds.has(id));
  }
}

function parseReplaceRequest(body: unknown): ReplaceRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ShareVerificationPolicyError('INVALID_POLICY_REQUEST');
  }
  const record = body as Record<string, unknown>;
  // Allowlist estricta de claves: el body no es un lugar donde colar campos.
  for (const key of Object.keys(record)) {
    if (key !== 'enabled' && key !== 'credentialIds') {
      throw new ShareVerificationPolicyError('INVALID_POLICY_REQUEST');
    }
  }
  if (typeof record.enabled !== 'boolean' || !Array.isArray(record.credentialIds)) {
    throw new ShareVerificationPolicyError('INVALID_POLICY_REQUEST');
  }
  // Cota dura: el conjunto autorizado no es un canal para mandar 10.000 ids.
  if (record.credentialIds.length > 200) {
    throw new ShareVerificationPolicyError('INVALID_POLICY_REQUEST');
  }
  const credentialIds = record.credentialIds.map((entry) => {
    if (typeof entry !== 'string' || entry.trim().length === 0 || entry.length > 100) {
      throw new ShareVerificationPolicyError('INVALID_POLICY_REQUEST');
    }
    return entry.trim();
  });
  return { enabled: record.enabled, credentialIds };
}

function dedupePreservingOrder(values: string[]): string[] {
  return [...new Set(values)];
}

function sameSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const reference = new Set(left);
  return right.every((value) => reference.has(value));
}

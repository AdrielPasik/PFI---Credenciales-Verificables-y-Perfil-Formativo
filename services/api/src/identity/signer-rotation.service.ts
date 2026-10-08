import { Injectable, Optional } from '@nestjs/common';
import {
  IssuerTechnicalIdentityStatus,
  Prisma,
  SignerProfilePurpose,
  SignerProfileStatus
} from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { SignerRotationError } from './signer-rotation.error';

/**
 * Rotacion de signers -- S8c8.
 *
 * ---------------------------------------------------------------------------
 * QUE ES UNA ROTACION
 * ---------------------------------------------------------------------------
 *
 * Una rotacion es: UN PERFIL NUEVO mas UNA TRANSICION DE PUNTERO.
 *
 * NUNCA es editar la clave de un perfil existente. `SignerProfile` ES la
 * identidad de la clave: su `secretRef`, su direccion, su material publico, su
 * `keyVersion`, su proposito y su custodia son metadata de identidad inmutable
 * una vez que el perfil se uso. Cambiar `P1.secretRef` para "rotar" dejaria
 * todas las credentials firmadas con P1 apuntando a un fragmento cuya clave
 * publica ya no corresponde, y la cache de S8c2 enmascararia el cambio durante
 * su TTL.
 *
 * Asi que estas primitivas tocan EXCLUSIVAMENTE campos de ciclo de vida
 * (`status`, `retiredAt`) y punteros. Un guard estructural lo congela.
 *
 * ---------------------------------------------------------------------------
 * SIN SECRETOS Y SIN RED
 * ---------------------------------------------------------------------------
 *
 * La rotacion es una transicion de metadata PUBLICA. No lee SSM, no construye
 * ninguna `Wallet`, no llama al `IssuerSignerResolver` y no toca la red: para
 * mover un puntero no hace falta demostrar posesion de ninguna clave privada
 * -- eso ya lo probo el provisioning cuando sello `addressVerifiedAt`.
 *
 * Esto es lo que hace posible la RECUPERACION: se puede rotar lejos de una
 * clave comprometida sin tener que usarla.
 *
 * ---------------------------------------------------------------------------
 * PRIMITIVAS DE DOMINIO, SIN SUPERFICIE PUBLICA
 * ---------------------------------------------------------------------------
 *
 * S8c8 no expone ninguna ruta HTTP, ningun boton de admin, ninguna carga de
 * clave privada y ningun DTO con `secretRef`. El perfil nuevo tiene que existir
 * YA, provisionado fuera de banda. El workflow operativo es S8c9.
 */

/** Metadata PUBLICA de un perfil. Nada de `secretRef` ni de custodia. */
const rotationProfileSelect = {
  id: true,
  purpose: true,
  status: true,
  keyVersion: true,
  addressVerifiedAt: true,
  publicKeyX: true,
  publicKeyY: true,
  publicKeyCompressed: true
} as const;

interface RotationProfile {
  readonly id: string;
  readonly purpose: SignerProfilePurpose;
  readonly status: SignerProfileStatus;
  readonly keyVersion: number;
  readonly addressVerifiedAt: Date | null;
  readonly publicKeyX: string | null;
  readonly publicKeyY: string | null;
  readonly publicKeyCompressed: string | null;
}

export interface SignerRotationResult {
  readonly issuerId: string;
  readonly previousProfileId: string;
  readonly newProfileId: string;
  /** Estado en el que quedo el perfil anterior. */
  readonly previousProfileStatus: SignerProfileStatus;
  /** Estado de la identidad tecnica despues de evaluar AMBOS roles. */
  readonly technicalIdentityStatus: IssuerTechnicalIdentityStatus;
}

export interface SignerRotationServiceOptions {
  /**
   * Reloj para `retiredAt`. Es un timestamp ADMINISTRATIVO de ciclo de vida,
   * no evidencia de cadena: nada lo compara contra un bloque. Se inyecta para
   * poder congelarlo en tests.
   */
  now?: () => Date;
}

@Injectable()
export class SignerRotationService {
  private readonly now: () => Date;

  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    options: SignerRotationServiceOptions = {}
  ) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Rota la clave de ASERCION del issuer a un perfil YA PROVISIONADO.
   *
   * Resultado:
   *
   *   antes:  vigente = P1 (active)              DID: #assert-1
   *   despues: vigente = P2 (active)             DID: #assert-1, #assert-2
   *            P1 retired, historicamente ligado
   *
   * Una credential vieja firmada con `#assert-1` sigue verificando, porque el
   * DID sigue publicando esa clave. Y NO se reescribe ningun proof, ningun
   * `verificationMethod` y ningun `canonicalHash`: la rotacion no vuelve a
   * firmar nada.
   */
  async rotateAssertionSigner(input: {
    issuerId: string;
    newSignerProfileId: string;
  }): Promise<SignerRotationResult> {
    const { issuerId, newSignerProfileId } = input;

    return this.prisma.$transaction(
      async (transaction) => {
        const identity = await this.loadRotatableIdentity(
          transaction,
          issuerId
        );

        const current = await this.loadCurrentProfile(
          transaction,
          identity.assertionSignerProfileId,
          SignerProfilePurpose.assertion,
          issuerId
        );

        // El puntero vigente TIENE que estar en la historia. Si no esta, o la
        // rotacion anterior se hizo por fuera de esta primitiva, o el binding
        // se borro: en los dos casos la historia no es confiable y no se le
        // agrega otra fila encima.
        const currentBinding =
          await transaction.issuerAssertionKeyBinding.findUnique({
            where: { signerProfileId: current.id },
            select: { issuerId: true }
          });

        if (!currentBinding || currentBinding.issuerId !== issuerId) {
          throw new SignerRotationError('CURRENT_ASSERTION_NOT_BOUND', {
            issuerId,
            profileId: current.id
          });
        }

        const candidate = await this.loadRotationCandidate(
          transaction,
          newSignerProfileId,
          SignerProfilePurpose.assertion,
          current.id
        );

        // Material publico de asercion utilizable: sin las tres coordenadas el
        // DID no podria publicar la clave nueva, y la rotacion dejaria al
        // issuer sin clave publicable.
        if (
          candidate.publicKeyX === null ||
          candidate.publicKeyY === null ||
          candidate.publicKeyCompressed === null
        ) {
          throw new SignerRotationError('NEW_PROFILE_PUBLIC_KEY_UNUSABLE', {
            issuerId,
            profileId: candidate.id
          });
        }

        // EXCLUSIVIDAD DURABLE: una clave de asercion pertenece como maximo a
        // un issuer, para siempre. El `@unique` del binding ya lo impide a
        // nivel de base; aca se falla con un error de dominio en vez de con una
        // violacion de constraint.
        const candidateBinding =
          await transaction.issuerAssertionKeyBinding.findUnique({
            where: { signerProfileId: candidate.id },
            select: { issuerId: true }
          });

        if (candidateBinding) {
          throw new SignerRotationError(
            'NEW_PROFILE_BOUND_TO_ANOTHER_ISSUER',
            { issuerId, profileId: candidate.id }
          );
        }

        // VERSION SIGUIENTE, calculada sobre TODA la historia del issuer -- no
        // sobre la vigente. Reusar un `#assert-N` historico haria que dos
        // claves distintas resolvieran al mismo fragmento, y un verificador
        // elegiria una por accidente de orden.
        await this.assertNextAssertionKeyVersion(
          transaction,
          issuerId,
          candidate
        );

        // ------------------------------------------------------------------
        // MUTACION
        // ------------------------------------------------------------------

        // 1. La historia crece. Append-only: nada se borra.
        await transaction.issuerAssertionKeyBinding.create({
          data: { issuerId, signerProfileId: candidate.id }
        });

        // 2. El perfil anterior pasa a historico.
        const previousStatus = await this.retirePreviousProfile(
          transaction,
          current
        );

        // 3. El puntero vigente se mueve, con predicado optimista: si otra
        //    rotacion concurrente ya lo movio, esta no afecta ninguna fila y
        //    falla cerrado en vez de dejar dos sucesores.
        const moved = await transaction.issuerTechnicalIdentity.updateMany({
          where: {
            issuerId,
            assertionSignerProfileId: current.id
          },
          data: { assertionSignerProfileId: candidate.id }
        });

        if (moved.count !== 1) {
          throw new SignerRotationError('ROTATION_CONFLICT', { issuerId });
        }

        // 4. Coherencia del ciclo de vida de la identidad, mirando AMBOS roles.
        const technicalIdentityStatus = await this.reconcileIdentityStatus(
          transaction,
          issuerId,
          {
            assertionProfileId: candidate.id,
            anchorProfileId: identity.anchorSignerProfileId
          }
        );

        return {
          issuerId,
          previousProfileId: current.id,
          newProfileId: candidate.id,
          previousProfileStatus: previousStatus,
          technicalIdentityStatus
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  /**
   * Rota la cuenta de ANCLAJE del issuer a un perfil YA PROVISIONADO.
   *
   * NO hay tabla de historia de anchors, y no se crea una por simetria: S8c6 ya
   * congela en CADA registracion real su
   * `BlockchainRecord.anchorSignerProfileId`. Esa fila ES la historia, y es
   * mejor historia que una tabla -- dice exactamente que cuenta firmo que hash.
   */
  async rotateAnchorSigner(input: {
    issuerId: string;
    newSignerProfileId: string;
  }): Promise<SignerRotationResult> {
    const { issuerId, newSignerProfileId } = input;

    return this.prisma.$transaction(
      async (transaction) => {
        const identity = await this.loadRotatableIdentity(
          transaction,
          issuerId
        );

        const current = await this.loadCurrentProfile(
          transaction,
          identity.anchorSignerProfileId,
          SignerProfilePurpose.anchor,
          issuerId
        );

        const candidate = await this.loadRotationCandidate(
          transaction,
          newSignerProfileId,
          SignerProfilePurpose.anchor,
          current.id
        );

        // Un anchor SI puede ser ya el vigente de otro issuer: las cuentas de
        // anclaje son compartibles a proposito, y S8c6 serializa sus escrituras
        // por perfil justamente por eso. No se exige exclusividad.

        // ------------------------------------------------------------------
        // MUTACION
        // ------------------------------------------------------------------

        const moved = await transaction.issuerTechnicalIdentity.updateMany({
          where: {
            issuerId,
            anchorSignerProfileId: current.id
          },
          data: { anchorSignerProfileId: candidate.id }
        });

        if (moved.count !== 1) {
          throw new SignerRotationError('ROTATION_CONFLICT', { issuerId });
        }

        const previousStatus = await this.retireUnreferencedAnchor(
          transaction,
          current
        );

        const technicalIdentityStatus = await this.reconcileIdentityStatus(
          transaction,
          issuerId,
          {
            assertionProfileId: identity.assertionSignerProfileId,
            anchorProfileId: candidate.id
          }
        );

        return {
          issuerId,
          previousProfileId: current.id,
          newProfileId: candidate.id,
          previousProfileStatus: previousStatus,
          technicalIdentityStatus
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  // -------------------------------------------------------------------------
  // PRECONDICIONES
  // -------------------------------------------------------------------------

  /**
   * Estados de identidad tecnica que ADMITEN rotacion.
   *
   *   active            -> rotacion planificada normal;
   *   rotation_required -> rotacion de RECUPERACION. Este estado existe
   *                        precisamente para que la firma normal se detenga
   *                        mientras un operador reemplaza una clave, asi que
   *                        bloquear la rotacion aca haria el estado inutil;
   *   unconfigured      -> todavia no hay de donde rotar;
   *   disabled          -> la identidad esta fuera de servicio por decision
   *                        administrativa; rotarla seria devolverla al servicio
   *                        por la puerta de atras.
   *
   * El resolver de uso vigente (`IssuerSignerResolver`) sigue exigiendo
   * `active` y NO se debilita: con `rotation_required` se puede rotar, pero no
   * se puede emitir.
   */
  private async loadRotatableIdentity(
    transaction: Prisma.TransactionClient,
    issuerId: string
  ): Promise<{
    assertionSignerProfileId: string;
    anchorSignerProfileId: string;
  }> {
    const identity = await transaction.issuerTechnicalIdentity.findUnique({
      where: { issuerId },
      select: {
        status: true,
        assertionSignerProfileId: true,
        anchorSignerProfileId: true
      }
    });

    if (!identity) {
      throw new SignerRotationError('TECHNICAL_IDENTITY_NOT_CONFIGURED', {
        issuerId
      });
    }

    if (
      identity.status !== IssuerTechnicalIdentityStatus.active &&
      identity.status !== IssuerTechnicalIdentityStatus.rotation_required
    ) {
      throw new SignerRotationError('TECHNICAL_IDENTITY_NOT_ROTATABLE', {
        issuerId
      });
    }

    return {
      assertionSignerProfileId: identity.assertionSignerProfileId,
      anchorSignerProfileId: identity.anchorSignerProfileId
    };
  }

  /**
   * Perfil vigente del que se rota.
   *
   * ESTADOS ACEPTADOS, y por que:
   *
   *   active      -> rotacion planificada;
   *   compromised -> rotacion de RECUPERACION. Exigir `active` aqui haria
   *                  imposible salir de un compromiso, que es justamente
   *                  cuando rotar es urgente;
   *   retired     -> FALLA CERRADO. Un perfil retirado siendo el puntero
   *                  vigente es contradictorio: `retired` significa "no se
   *                  elige para nuevo" y el puntero significa lo contrario. No
   *                  se reactiva, no se rota en silencio desde ahi y no se
   *                  elige otra clave de la historia.
   */
  private async loadCurrentProfile(
    transaction: Prisma.TransactionClient,
    profileId: string,
    purpose: SignerProfilePurpose,
    issuerId: string
  ): Promise<RotationProfile> {
    const profile = await transaction.signerProfile.findUnique({
      where: { id: profileId },
      select: rotationProfileSelect
    });

    if (!profile) {
      throw new SignerRotationError('CURRENT_PROFILE_NOT_FOUND', {
        issuerId,
        profileId
      });
    }

    if (profile.purpose !== purpose) {
      throw new SignerRotationError('CURRENT_PROFILE_PURPOSE_MISMATCH', {
        issuerId,
        profileId
      });
    }

    if (profile.status === SignerProfileStatus.retired) {
      throw new SignerRotationError('CURRENT_PROFILE_RETIRED', {
        issuerId,
        profileId
      });
    }

    return profile;
  }

  /** El perfil nuevo. Tiene que estar ACTIVO: no se reactiva un retirado. */
  private async loadRotationCandidate(
    transaction: Prisma.TransactionClient,
    profileId: string,
    purpose: SignerProfilePurpose,
    currentProfileId: string
  ): Promise<RotationProfile> {
    if (profileId === currentProfileId) {
      throw new SignerRotationError('NEW_PROFILE_ALREADY_CURRENT', {
        profileId
      });
    }

    const profile = await transaction.signerProfile.findUnique({
      where: { id: profileId },
      select: rotationProfileSelect
    });

    if (!profile) {
      throw new SignerRotationError('NEW_PROFILE_NOT_FOUND', { profileId });
    }

    if (profile.purpose !== purpose) {
      throw new SignerRotationError('NEW_PROFILE_PURPOSE_MISMATCH', {
        profileId
      });
    }

    // Un perfil `retired` es de uso HISTORICO unicamente, y uno `compromised`
    // no debe firmar nada. No existe reactivacion implicita en S8c8.
    if (profile.status !== SignerProfileStatus.active) {
      throw new SignerRotationError('NEW_PROFILE_NOT_ACTIVE', { profileId });
    }

    if (profile.addressVerifiedAt === null) {
      throw new SignerRotationError('NEW_PROFILE_ADDRESS_NOT_VERIFIED', {
        profileId
      });
    }

    return profile;
  }

  /**
   * `keyVersion` del candidato tiene que ser EXACTAMENTE la siguiente de la
   * historia completa del issuer.
   *
   * Monotonica y sin reutilizar: cualquier otra cosa produciria un `#assert-N`
   * ambiguo o un salto que no se puede explicar. Y notar la direccion de la
   * dependencia -- la version se DERIVA de la historia, pero la clave VIGENTE
   * nunca se deriva de la version maxima.
   */
  private async assertNextAssertionKeyVersion(
    transaction: Prisma.TransactionClient,
    issuerId: string,
    candidate: RotationProfile
  ): Promise<void> {
    const bindings = await transaction.issuerAssertionKeyBinding.findMany({
      where: { issuerId },
      select: { signerProfile: { select: { keyVersion: true } } }
    });

    const highest = bindings.reduce(
      (maximum, binding) =>
        Math.max(maximum, binding.signerProfile.keyVersion),
      0
    );

    if (candidate.keyVersion !== highest + 1) {
      throw new SignerRotationError('NEW_PROFILE_KEY_VERSION_NOT_NEXT', {
        issuerId,
        profileId: candidate.id
      });
    }
  }

  // -------------------------------------------------------------------------
  // TRANSICIONES DE CICLO DE VIDA
  // -------------------------------------------------------------------------

  /**
   * Retira el perfil de ASERCION anterior.
   *
   * `active` -> `retired` + `retiredAt`.
   *
   * `compromised` -> NO SE TOCA. Un compromiso no se convierte en una
   * jubilacion ordinaria: son dos hechos distintos, y reescribirlo borraria la
   * razon por la que esa clave esta excluida del DID. Queda comprometido para
   * siempre.
   *
   * Un perfil de asercion no se comparte entre issuers -- el `@unique` del
   * binding lo garantiza -- asi que no hay que contar referencias.
   */
  private async retirePreviousProfile(
    transaction: Prisma.TransactionClient,
    current: RotationProfile
  ): Promise<SignerProfileStatus> {
    if (current.status !== SignerProfileStatus.active) {
      return current.status;
    }

    await transaction.signerProfile.update({
      where: { id: current.id },
      data: {
        status: SignerProfileStatus.retired,
        retiredAt: this.now()
      }
    });

    return SignerProfileStatus.retired;
  }

  /**
   * Retira el ANCHOR anterior SOLO si ningun issuer lo sigue usando.
   *
   * `SignerProfile.status` es GLOBAL del perfil, y un anchor puede estar
   * compartido. Si el issuer A rota de P1 a P2 mientras B sigue apuntando a P1,
   * marcar P1 como `retired` le quitaria a B su cuenta de anclaje vigente sin
   * que B hiciera nada.
   *
   * El conteo incluye identidades tecnicas de CUALQUIER estado -- tambien
   * `disabled` y `rotation_required` -- porque esas identidades siguen teniendo
   * un puntero vigente, y retirarlo a sus espaldas dejaria estado incoherente
   * si vuelven a servicio.
   *
   * Y si P1 estaba `compromised`, no se cambia nada bajo ningun conteo: sigue
   * comprometido. Los otros issuers que todavia lo apunten no van a poder
   * registrar hasta que roten, lo que es exactamente lo correcto.
   */
  private async retireUnreferencedAnchor(
    transaction: Prisma.TransactionClient,
    current: RotationProfile
  ): Promise<SignerProfileStatus> {
    if (current.status !== SignerProfileStatus.active) {
      return current.status;
    }

    const stillCurrentFor = await transaction.issuerTechnicalIdentity.count({
      where: { anchorSignerProfileId: current.id }
    });

    if (stillCurrentFor > 0) {
      return current.status;
    }

    await transaction.signerProfile.update({
      where: { id: current.id },
      data: {
        status: SignerProfileStatus.retired,
        retiredAt: this.now()
      }
    });

    return SignerProfileStatus.retired;
  }

  /**
   * Coherencia del ciclo de vida de la identidad tecnica.
   *
   * Despues de mover un puntero se evalua la salud ESTRUCTURAL PUBLICA de LOS
   * DOS roles vigentes, no solo del que se roto. Poner `active` porque una
   * rotacion salio bien, cuando el otro rol sigue comprometido, seria declarar
   * sana una identidad que no puede operar.
   *
   * Esto es coherencia de IDENTIDAD, no `readyToIssue`: deliberadamente no se
   * mira `Issuer.authorizationStatus`, ni la lista de tipos habilitados del
   * issuer, ni el target de blockchain, ni la red, ni SSM, ni nada de negocio.
   * Eso es S8c9.
   */
  private async reconcileIdentityStatus(
    transaction: Prisma.TransactionClient,
    issuerId: string,
    current: { assertionProfileId: string; anchorProfileId: string }
  ): Promise<IssuerTechnicalIdentityStatus> {
    const [assertion, anchor, binding] = await Promise.all([
      transaction.signerProfile.findUnique({
        where: { id: current.assertionProfileId },
        select: rotationProfileSelect
      }),
      transaction.signerProfile.findUnique({
        where: { id: current.anchorProfileId },
        select: rotationProfileSelect
      }),
      transaction.issuerAssertionKeyBinding.findUnique({
        where: { signerProfileId: current.assertionProfileId },
        select: { issuerId: true }
      })
    ]);

    const assertionHealthy =
      isStructurallyHealthy(assertion, SignerProfilePurpose.assertion) &&
      binding?.issuerId === issuerId;
    const anchorHealthy = isStructurallyHealthy(
      anchor,
      SignerProfilePurpose.anchor
    );

    const status =
      assertionHealthy && anchorHealthy
        ? IssuerTechnicalIdentityStatus.active
        : IssuerTechnicalIdentityStatus.rotation_required;

    await transaction.issuerTechnicalIdentity.update({
      where: { issuerId },
      data: { status }
    });

    return status;
  }
}

/** Salud ESTRUCTURAL de un rol vigente. Solo metadata publica. */
function isStructurallyHealthy(
  profile: RotationProfile | null,
  purpose: SignerProfilePurpose
): boolean {
  return (
    profile !== null &&
    profile.purpose === purpose &&
    profile.status === SignerProfileStatus.active &&
    profile.addressVerifiedAt !== null
  );
}

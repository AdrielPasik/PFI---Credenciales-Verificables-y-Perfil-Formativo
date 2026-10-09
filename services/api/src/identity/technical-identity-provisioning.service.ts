import { randomUUID } from 'node:crypto';

import {
  type CredentialType,
  IssuerTechnicalIdentityStatus,
  Prisma,
  SignerKeyCustody,
  SignerProfilePurpose,
  SignerProfileStatus
} from '@prisma/client';

import { type DidConfig } from '../config/did-config';
import {
  CapabilityPolicyError,
  normalizeCredentialTypePolicy
} from '../issuers/issuer-capability-policy';
import { isValidEthereumAddress } from '../issuers/issuer-readiness';
import { type PrismaService } from '../prisma/prisma.service';
import { buildDidForIssuer } from './did-web-issuer';
import { type SignerRotationService } from './signer-rotation.service';

/**
 * Provisioning TECNICO del issuer -- S8c9. SOLO herramienta de operacion.
 *
 * ---------------------------------------------------------------------------
 * QUIEN LO EJECUTA
 * ---------------------------------------------------------------------------
 *
 * Un operador, desde linea de comandos. No hay endpoint publico, ni de issuer,
 * ni de PlatformAdmin, ni formulario web, ni carga de claves. Ningun request de
 * usuario transporta nunca una clave privada, y ninguna respuesta la devuelve.
 *
 * ---------------------------------------------------------------------------
 * DONDE VIVE LA CLAVE
 * ---------------------------------------------------------------------------
 *
 * La clave se genera EN MEMORIA y va a UN solo lugar: un SecureString de SSM,
 * escrito con `Overwrite = false`. A Postgres van UNICAMENTE la metadata publica
 * y el `secretRef`. Nunca a un archivo, nunca a la salida estandar, nunca a un
 * log, nunca a un error.
 *
 * ---------------------------------------------------------------------------
 * ORDEN Y FALLOS
 * ---------------------------------------------------------------------------
 *
 *   validar -> generar ids -> generar claves -> escribir SecureStrings
 *           -> TX SERIALIZABLE corta (re-valida y persiste)
 *
 * Nada de SSM dentro de la transaccion. Si los secretos se escribieron y la
 * base falla, eso NO se esconde: se informa `ORPHAN_SIGNER_SECRET_REQUIRES_CLEANUP`
 * con los `secretRef` huerfanos. No se reintenta la base en silencio, no se
 * reutiliza otra clave, y no se borra el secreto automaticamente: despues de un
 * resultado ambiguo de la base, limpiar es una decision del operador.
 */

/** Material generado. VIVE EN MEMORIA y no sale del provisioning. */
export interface GeneratedSignerMaterial {
  readonly privateKey: string;
  /** Checksum EIP-55. */
  readonly address: string;
  /** `0x` + 64 hex minuscula. */
  readonly publicKeyX: string;
  readonly publicKeyY: string;
  /** `0x02`/`0x03` + 64 hex minuscula. */
  readonly publicKeyCompressed: string;
}

/** Fuente de material de firma. Produccion: CSPRNG. Tests: dobles. */
export interface SignerMaterialGenerator {
  generate(): GeneratedSignerMaterial;
}

/**
 * Escritor de secretos NUEVOS. Produccion: SSM PutParameter SecureString con
 * Overwrite=false. No hay metodo para sobrescribir ni para borrar.
 */
export interface SignerSecretWriter {
  createSecureString(secretRef: string, value: string): Promise<void>;
}

export type TechnicalProvisioningErrorCode =
  | 'ISSUER_NOT_FOUND'
  | 'TECHNICAL_IDENTITY_ALREADY_EXISTS'
  | 'TECHNICAL_IDENTITY_MISSING'
  | 'INVALID_CREDENTIAL_TYPE'
  | 'SHARED_ANCHOR_INVALID'
  | 'DID_CONFIGURATION_MISSING'
  | 'SECRET_REF_PREFIX_INVALID'
  | 'SIGNER_MATERIAL_INVALID'
  | 'SECRET_WRITE_FAILED'
  | 'ORPHAN_SIGNER_SECRET_REQUIRES_CLEANUP'
  | 'ROTATION_FAILED_PROFILE_UNATTACHED';

const SAFE_MESSAGES: Record<TechnicalProvisioningErrorCode, string> = {
  ISSUER_NOT_FOUND: 'No se encontro el emisor solicitado.',
  TECHNICAL_IDENTITY_ALREADY_EXISTS:
    'El emisor ya tiene identidad tecnica. Usar la rotacion, no el provisioning inicial.',
  TECHNICAL_IDENTITY_MISSING: 'El emisor no tiene identidad tecnica.',
  INVALID_CREDENTIAL_TYPE: 'La lista contiene un tipo de credencial desconocido.',
  SHARED_ANCHOR_INVALID:
    'La cuenta de anclaje compartida indicada no es utilizable.',
  DID_CONFIGURATION_MISSING:
    'Falta la configuracion publica de DID para derivar el DID del emisor.',
  SECRET_REF_PREFIX_INVALID:
    'El prefijo de referencias de secretos de firma no es valido.',
  SIGNER_MATERIAL_INVALID: 'El material de firma generado no es coherente.',
  SECRET_WRITE_FAILED: 'No se pudo crear el secreto de firma.',
  ORPHAN_SIGNER_SECRET_REQUIRES_CLEANUP:
    'Se crearon secretos de firma pero la base no se actualizo. Requieren limpieza del operador.',
  ROTATION_FAILED_PROFILE_UNATTACHED:
    'El perfil nuevo se creo pero la rotacion fallo. Quedo sin vincular.'
};

/**
 * Error de operador. Su mensaje es un literal fijo. Las referencias de
 * secretos huerfanos viajan como METADATA SEGURA aparte -- un `secretRef` no es
 * un secreto -- y nunca hay material de clave en ningun campo.
 */
export class TechnicalProvisioningError extends Error {
  readonly code: TechnicalProvisioningErrorCode;
  readonly orphanSecretRefs: readonly string[];
  readonly unattachedProfileIds: readonly string[];
  /** Codigo de la causa, si era de dominio. Nunca su mensaje. */
  readonly causeCode?: string;

  constructor(
    code: TechnicalProvisioningErrorCode,
    context: {
      orphanSecretRefs?: readonly string[];
      unattachedProfileIds?: readonly string[];
      causeCode?: string;
    } = {}
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = 'TechnicalProvisioningError';
    this.code = code;
    this.orphanSecretRefs = context.orphanSecretRefs ?? [];
    this.unattachedProfileIds = context.unattachedProfileIds ?? [];
    if (context.causeCode !== undefined) {
      this.causeCode = context.causeCode;
    }
  }
}

export type AnchorChoice =
  | { readonly kind: 'new' }
  | { readonly kind: 'shared'; readonly signerProfileId: string };

/** Resultado SEGURO. Sin clave, sin material privado. */
export interface InitialProvisioningResult {
  readonly issuerId: string;
  readonly did: string;
  readonly technicalIdentityStatus: IssuerTechnicalIdentityStatus;
  readonly allowedCredentialTypes: CredentialType[];
  readonly assertion: { address: string; keyVersion: number; secretRef: string };
  readonly anchor: {
    address: string;
    keyVersion: number;
    secretRef: string | null;
    shared: boolean;
  };
}

export interface TechnicalIdentityProvisioningDependencies {
  readonly prisma: PrismaService;
  readonly generator: SignerMaterialGenerator;
  readonly secretWriter: SignerSecretWriter;
  readonly rotationService: SignerRotationService;
  readonly didConfig: DidConfig | null;
  /** Prefijo OBLIGATORIO, p. ej. `/scope/prod/signers/`. */
  readonly secretRefPrefix: string | undefined;
  readonly newId?: () => string;
  readonly now?: () => Date;
}

const HEX_COORDINATE = /^0x[0-9a-f]{64}$/;
const HEX_COMPRESSED = /^0x0[23][0-9a-f]{64}$/;
const SECRET_REF_PREFIX = /^\/[A-Za-z0-9_./-]+\/$/;

export class TechnicalIdentityProvisioningService {
  private readonly newId: () => string;
  private readonly now: () => Date;

  constructor(private readonly deps: TechnicalIdentityProvisioningDependencies) {
    this.newId = deps.newId ?? (() => randomUUID());
    this.now = deps.now ?? (() => new Date());
  }

  // -------------------------------------------------------------------------
  // PROVISIONING INICIAL
  // -------------------------------------------------------------------------

  async provisionInitial(input: {
    issuerId: string;
    credentialTypes: readonly unknown[];
    anchor: AnchorChoice;
  }): Promise<InitialProvisioningResult> {
    const prefix = this.requirePrefix();
    // Misma validacion de politica que la primitiva de capacidades.
    const credentialTypes = this.normalizePolicy(input.credentialTypes);
    const { prisma } = this.deps;

    // 1-2. Validacion previa (no autoritativa: se repite dentro de la TX).
    const issuer = await prisma.issuer.findUnique({
      where: { id: input.issuerId },
      select: { id: true, technicalIdentity: { select: { id: true } } }
    });
    if (!issuer) {
      throw new TechnicalProvisioningError('ISSUER_NOT_FOUND');
    }
    if (issuer.technicalIdentity) {
      // Sin upsert y sin "exito idempotente": la rotacion es otro camino.
      throw new TechnicalProvisioningError('TECHNICAL_IDENTITY_ALREADY_EXISTS');
    }

    if (input.anchor.kind === 'shared') {
      // Solo metadata publica: NO se lee el secreto para vincular.
      const shared = await prisma.signerProfile.findUnique({
        where: { id: input.anchor.signerProfileId },
        select: sharedAnchorSelect
      });
      if (!isUsableSharedAnchor(shared)) {
        throw new TechnicalProvisioningError('SHARED_ANCHOR_INVALID');
      }
    }

    // 6. DID DERIVADO, nunca tipeado por el operador.
    if (!this.deps.didConfig) {
      throw new TechnicalProvisioningError('DID_CONFIGURATION_MISSING');
    }
    const did = buildDidForIssuer(this.deps.didConfig, input.issuerId);

    // 3-5. Ids ANTES de escribir secretos; claves en memoria; metadata derivada.
    const assertionProfileId = this.newId();
    const assertionMaterial = this.generateValidated();
    const assertionSecretRef = `${prefix}${assertionProfileId}`;

    const newAnchor =
      input.anchor.kind === 'new'
        ? {
            profileId: this.newId(),
            material: this.generateValidated()
          }
        : null;
    const anchorSecretRef = newAnchor ? `${prefix}${newAnchor.profileId}` : null;

    // 7. Secretos, FUERA de cualquier transaccion.
    const written: string[] = [];
    await this.writeSecret(assertionSecretRef, assertionMaterial.privateKey, written);
    if (newAnchor && anchorSecretRef) {
      await this.writeSecret(anchorSecretRef, newAnchor.material.privateKey, written);
    }

    // 8. TX SERIALIZABLE corta que RE-VALIDA el estado publico.
    const verifiedAt = this.now();
    try {
      const result = await prisma.$transaction(
        async (transaction) => {
          const current = await transaction.issuer.findUnique({
            where: { id: input.issuerId },
            select: { id: true, technicalIdentity: { select: { id: true } } }
          });
          if (!current) {
            throw new TechnicalProvisioningError('ISSUER_NOT_FOUND');
          }
          if (current.technicalIdentity) {
            throw new TechnicalProvisioningError('TECHNICAL_IDENTITY_ALREADY_EXISTS');
          }

          let anchorProfileId: string;
          let anchorAddress: string;
          let anchorKeyVersion: number;

          if (input.anchor.kind === 'shared') {
            // El anchor compartido pudo retirarse o comprometerse mientras se
            // escribian los secretos. Se re-lee y se aborta si dejo de ser
            // utilizable: no se commitea una identidad que apunte a un anchor
            // obsoleto.
            const shared = await transaction.signerProfile.findUnique({
              where: { id: input.anchor.signerProfileId },
              select: sharedAnchorSelect
            });
            if (!isUsableSharedAnchor(shared)) {
              throw new TechnicalProvisioningError('SHARED_ANCHOR_INVALID');
            }
            anchorProfileId = shared!.id;
            anchorAddress = shared!.address;
            anchorKeyVersion = shared!.keyVersion;
          } else {
            const anchor = newAnchor!;
            anchorProfileId = anchor.profileId;
            anchorAddress = anchor.material.address.toLowerCase();
            anchorKeyVersion = 1;
            await transaction.signerProfile.create({
              data: {
                id: anchor.profileId,
                label: `scope-anchor-${anchor.profileId}`,
                purpose: SignerProfilePurpose.anchor,
                custody: SignerKeyCustody.scope_managed,
                secretRef: anchorSecretRef!,
                address: anchorAddress,
                // Un anchor no necesita metadata de asercion (S8c1).
                publicKeyX: null,
                publicKeyY: null,
                publicKeyCompressed: null,
                keyVersion: 1,
                addressVerifiedAt: verifiedAt,
                status: SignerProfileStatus.active
              }
            });
          }

          await transaction.signerProfile.create({
            data: {
              id: assertionProfileId,
              label: `scope-assert-${assertionProfileId}`,
              purpose: SignerProfilePurpose.assertion,
              custody: SignerKeyCustody.scope_managed,
              secretRef: assertionSecretRef,
              address: assertionMaterial.address.toLowerCase(),
              publicKeyX: assertionMaterial.publicKeyX,
              publicKeyY: assertionMaterial.publicKeyY,
              publicKeyCompressed: assertionMaterial.publicKeyCompressed,
              keyVersion: 1,
              // Sellado SOLO despues de derivar la metadata del secreto generado.
              addressVerifiedAt: verifiedAt,
              status: SignerProfileStatus.active
            }
          });

          const identity = await transaction.issuerTechnicalIdentity.create({
            data: {
              issuerId: input.issuerId,
              did,
              assertionSignerProfileId: assertionProfileId,
              anchorSignerProfileId: anchorProfileId,
              // Coherente por construccion y por la re-validacion de arriba.
              status: IssuerTechnicalIdentityStatus.active
            },
            select: { status: true }
          });

          await transaction.issuerAssertionKeyBinding.create({
            data: {
              issuerId: input.issuerId,
              signerProfileId: assertionProfileId
            }
          });

          await transaction.issuer.update({
            where: { id: input.issuerId },
            data: { allowedCredentialTypes: credentialTypes }
          });

          const anchorReferences = await transaction.issuerTechnicalIdentity.count({
            where: { anchorSignerProfileId: anchorProfileId }
          });

          return {
            issuerId: input.issuerId,
            did,
            technicalIdentityStatus: identity.status,
            allowedCredentialTypes: credentialTypes,
            assertion: {
              address: assertionMaterial.address,
              keyVersion: 1,
              secretRef: assertionSecretRef
            },
            anchor: {
              address: anchorAddress,
              keyVersion: anchorKeyVersion,
              secretRef: anchorSecretRef,
              shared: anchorReferences > 1
            }
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );

      return result;
    } catch (error) {
      // Los secretos YA existen. No se esconde, no se reintenta, no se borra.
      throw new TechnicalProvisioningError('ORPHAN_SIGNER_SECRET_REQUIRES_CLEANUP', {
        orphanSecretRefs: written,
        causeCode: domainCode(error)
      });
    }
  }

  // -------------------------------------------------------------------------
  // ROTACION -- envoltorios finos sobre SignerRotationService
  // -------------------------------------------------------------------------

  /**
   * Provisiona una clave de ASERCION nueva y delega la rotacion. Las reglas de
   * rotacion -- version siguiente, exclusividad, recuperacion desde
   * comprometida -- las decide `SignerRotationService`, no este envoltorio.
   */
  async rotateAssertion(input: { issuerId: string }) {
    const prefix = this.requirePrefix();
    const { prisma } = this.deps;

    const bindings = await prisma.issuerAssertionKeyBinding.findMany({
      where: { issuerId: input.issuerId },
      select: { signerProfile: { select: { keyVersion: true } } }
    });
    if (bindings.length === 0) {
      throw new TechnicalProvisioningError('TECHNICAL_IDENTITY_MISSING');
    }
    const keyVersion =
      bindings.reduce((max, b) => Math.max(max, b.signerProfile.keyVersion), 0) + 1;

    const profileId = this.newId();
    const material = this.generateValidated();
    const secretRef = `${prefix}${profileId}`;

    const written: string[] = [];
    await this.writeSecret(secretRef, material.privateKey, written);

    try {
      await prisma.signerProfile.create({
        data: {
          id: profileId,
          label: `scope-assert-${profileId}`,
          purpose: SignerProfilePurpose.assertion,
          custody: SignerKeyCustody.scope_managed,
          secretRef,
          address: material.address.toLowerCase(),
          publicKeyX: material.publicKeyX,
          publicKeyY: material.publicKeyY,
          publicKeyCompressed: material.publicKeyCompressed,
          keyVersion,
          addressVerifiedAt: this.now(),
          status: SignerProfileStatus.active
        }
      });
    } catch (error) {
      throw new TechnicalProvisioningError('ORPHAN_SIGNER_SECRET_REQUIRES_CLEANUP', {
        orphanSecretRefs: written,
        causeCode: domainCode(error)
      });
    }

    return this.delegateRotation(
      () =>
        this.deps.rotationService.rotateAssertionSigner({
          issuerId: input.issuerId,
          newSignerProfileId: profileId
        }),
      { profileId, secretRef, address: material.address }
    );
  }

  /** Rota el ANCHOR: genera uno nuevo o elige uno compartido existente. */
  async rotateAnchor(input: { issuerId: string; anchor: AnchorChoice }) {
    if (input.anchor.kind === 'shared') {
      // Sin secreto nuevo: el perfil ya existe. La rotacion valida todo.
      const result = await this.deps.rotationService.rotateAnchorSigner({
        issuerId: input.issuerId,
        newSignerProfileId: input.anchor.signerProfileId
      });
      return { rotation: result, secretRef: null as string | null };
    }

    const prefix = this.requirePrefix();
    const profileId = this.newId();
    const material = this.generateValidated();
    const secretRef = `${prefix}${profileId}`;

    const written: string[] = [];
    await this.writeSecret(secretRef, material.privateKey, written);

    try {
      await this.deps.prisma.signerProfile.create({
        data: {
          id: profileId,
          label: `scope-anchor-${profileId}`,
          purpose: SignerProfilePurpose.anchor,
          custody: SignerKeyCustody.scope_managed,
          secretRef,
          address: material.address.toLowerCase(),
          publicKeyX: null,
          publicKeyY: null,
          publicKeyCompressed: null,
          keyVersion: 1,
          addressVerifiedAt: this.now(),
          status: SignerProfileStatus.active
        }
      });
    } catch (error) {
      throw new TechnicalProvisioningError('ORPHAN_SIGNER_SECRET_REQUIRES_CLEANUP', {
        orphanSecretRefs: written,
        causeCode: domainCode(error)
      });
    }

    return this.delegateRotation(
      () =>
        this.deps.rotationService.rotateAnchorSigner({
          issuerId: input.issuerId,
          newSignerProfileId: profileId
        }),
      { profileId, secretRef, address: material.address }
    );
  }

  // -------------------------------------------------------------------------
  // INTERNOS
  // -------------------------------------------------------------------------

  private async delegateRotation<T>(
    rotate: () => Promise<T>,
    created: { profileId: string; secretRef: string; address: string }
  ) {
    try {
      const rotation = await rotate();
      return { rotation, secretRef: created.secretRef, address: created.address };
    } catch (error) {
      // El perfil nuevo queda SIN vincular. No se cambia la clave vieja para
      // compensar y no se elige otra clave automaticamente.
      throw new TechnicalProvisioningError('ROTATION_FAILED_PROFILE_UNATTACHED', {
        orphanSecretRefs: [created.secretRef],
        unattachedProfileIds: [created.profileId],
        causeCode: domainCode(error)
      });
    }
  }

  private async writeSecret(
    secretRef: string,
    value: string,
    written: string[]
  ): Promise<void> {
    try {
      await this.deps.secretWriter.createSecureString(secretRef, value);
    } catch {
      // Lo que se creo antes queda informado como huerfano. El error del SDK
      // no se propaga: puede arrastrar metadata de infraestructura.
      throw new TechnicalProvisioningError(
        written.length > 0
          ? 'ORPHAN_SIGNER_SECRET_REQUIRES_CLEANUP'
          : 'SECRET_WRITE_FAILED',
        { orphanSecretRefs: [...written] }
      );
    }
    written.push(secretRef);
  }

  private generateValidated(): GeneratedSignerMaterial {
    const material = this.deps.generator.generate();

    if (
      !isValidEthereumAddress(material.address) ||
      !HEX_COORDINATE.test(material.publicKeyX) ||
      !HEX_COORDINATE.test(material.publicKeyY) ||
      !HEX_COMPRESSED.test(material.publicKeyCompressed) ||
      material.publicKeyCompressed.slice(4) !== material.publicKeyX.slice(2)
    ) {
      throw new TechnicalProvisioningError('SIGNER_MATERIAL_INVALID');
    }

    return material;
  }

  private requirePrefix(): string {
    const prefix = this.deps.secretRefPrefix?.trim();

    // Obligatorio en el camino de operacion: el operador NUNCA elige una ruta
    // arbitraria. Sin traversal ni namespaces alternativos.
    if (
      !prefix ||
      !SECRET_REF_PREFIX.test(prefix) ||
      prefix.includes('..') ||
      prefix.includes('//')
    ) {
      throw new TechnicalProvisioningError('SECRET_REF_PREFIX_INVALID');
    }

    return prefix;
  }

  private normalizePolicy(values: readonly unknown[]): CredentialType[] {
    try {
      return normalizeCredentialTypePolicy(values);
    } catch (error) {
      if (error instanceof CapabilityPolicyError) {
        throw new TechnicalProvisioningError('INVALID_CREDENTIAL_TYPE');
      }
      throw error;
    }
  }
}

const sharedAnchorSelect = {
  id: true,
  purpose: true,
  status: true,
  address: true,
  keyVersion: true,
  addressVerifiedAt: true
} as const;

function isUsableSharedAnchor(
  profile: {
    purpose: SignerProfilePurpose;
    status: SignerProfileStatus;
    address: string;
    addressVerifiedAt: Date | null;
  } | null
): boolean {
  return (
    profile !== null &&
    profile.purpose === SignerProfilePurpose.anchor &&
    profile.status === SignerProfileStatus.active &&
    profile.addressVerifiedAt !== null &&
    isValidEthereumAddress(profile.address)
  );
}

/** Solo el CODIGO de un error de dominio. Nunca su mensaje. */
function domainCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

import { Injectable } from '@nestjs/common';
import {
  IssuerTechnicalIdentityStatus,
  SignerProfilePurpose,
  SignerProfileStatus
} from '@prisma/client';
import { Wallet, getAddress, isAddress } from 'ethers';

import { PrismaService } from '../prisma/prisma.service';
import { SignerResolutionError } from './signer-resolution.error';
import { type SignerSecretStore } from './signer-secret-store.port';

/**
 * Resolucion de signer por Issuer -- S8c2.
 *
 * Responde UNA sola pregunta:
 *
 *   "que clave esta configurada para este Issuer, para este proposito?"
 *
 * NO responde "puede esta persona emitir?". La autoridad de dominio es
 * `IssuerMembership` y se evalua ANTES, en capas superiores. Poseer o tener
 * configurado un signer nunca implica membership: son planos distintos y S7
 * los dejo separados a proposito.
 *
 * ALCANCE DE S8c2: resuelve y verifica. No firma, no construye provider, no
 * habla con ninguna red y no escribe en la base.
 */

/** Formato aceptado para el material recuperado del almacen de secretos. */
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;

const signerProfileSelect = {
  id: true,
  purpose: true,
  secretRef: true,
  address: true,
  publicKeyX: true,
  publicKeyY: true,
  publicKeyCompressed: true,
  keyVersion: true,
  addressVerifiedAt: true,
  status: true
} as const;

interface SignerProfileRow {
  id: string;
  purpose: SignerProfilePurpose;
  secretRef: string;
  address: string;
  publicKeyX: string | null;
  publicKeyY: string | null;
  publicKeyCompressed: string | null;
  keyVersion: number;
  addressVerifiedAt: Date | null;
  status: SignerProfileStatus;
}

/**
 * Signer resuelto. Estructura INTERNA: no es un DTO y no puede cruzar un
 * limite HTTP.
 *
 * No lleva `privateKey`, no lleva `secretRef`, no lleva `custody` y no lleva
 * nada de la respuesta de AWS.
 */
export interface ResolvedIssuerSigner {
  readonly profileId: string;
  readonly purpose: SignerProfilePurpose;
  readonly keyVersion: number;
  /** Direccion con checksum EIP-55. */
  readonly address: string;
  /** Wallet DESCONECTADA: `wallet.provider === null`. */
  readonly wallet: Wallet;
}

/**
 * Entrada PRIVADA de cache. Nunca sale del resolver.
 *
 * Lleva `secretRef` porque es parte de la IDENTIDAD DE CONFIGURACION de la
 * entrada: si la fila pasa a apuntar a otro secreto, la Wallet cacheada ya no
 * corresponde y hay que recargar. Es metadata de infraestructura, no material
 * secreto, asi que guardarla aca es admisible -- pero sigue sin poder aparecer
 * en `ResolvedIssuerSigner`, en un DTO, en HTTP, en logs, en errores ni en
 * AuditLog.
 *
 * NUNCA lleva la clave privada en crudo ni la respuesta de SSM.
 */
interface SignerCacheEntry {
  readonly profileId: string;
  readonly purpose: SignerProfilePurpose;
  readonly keyVersion: number;
  readonly secretRef: string;
  readonly address: string;
  readonly wallet: Wallet;
  readonly expiresAt: number;
}

export interface IssuerSignerResolverOptions {
  /**
   * Cuanto vive una Wallet construida, en milisegundos.
   *
   * La cache ahorra la llamada a SSM y la reconstruccion de la Wallet. NO
   * ahorra, bajo ninguna circunstancia, las comprobaciones de estado y
   * configuracion: esas se releen de la base en CADA resolucion.
   */
  cacheTtlMs?: number;
  /** Reloj inyectable para tests deterministas. Sin sleeps reales. */
  now?: () => number;
}

@Injectable()
export class IssuerSignerResolver {
  private readonly cache = new Map<string, SignerCacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secretStore: SignerSecretStore,
    options: IssuerSignerResolverOptions = {}
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Clave de ASERCION del issuer: la que firma el proof de la credential.
   * Exclusiva por issuer (la base lo garantiza con un `@unique`).
   */
  async resolveAssertionSignerForIssuer(
    issuerId: string
  ): Promise<ResolvedIssuerSigner> {
    return this.resolveForPurpose(issuerId, SignerProfilePurpose.assertion);
  }

  /**
   * Cuenta de ANCLAJE del issuer: la que firma la transaccion y paga gas.
   * Puede estar compartida entre varios issuers (configuracion de demo).
   */
  async resolveAnchorSignerForIssuer(
    issuerId: string
  ): Promise<ResolvedIssuerSigner> {
    return this.resolveForPurpose(issuerId, SignerProfilePurpose.anchor);
  }

  private async resolveForPurpose(
    issuerId: string,
    purpose: SignerProfilePurpose
  ): Promise<ResolvedIssuerSigner> {
    // 1. ESTADO Y CONFIGURACION: siempre desde la base, nunca desde la cache.
    //    Deshabilitar una identidad o marcar un perfil como comprometido tiene
    //    efecto en la resolucion siguiente, sin esperar a que venza el TTL.
    const profile = await this.loadActiveProfile(issuerId, purpose);

    // 2. Recien ahora se consulta la cache, y SOLO para evitar la lectura del
    //    secreto y la reconstruccion de la Wallet. Nunca para evitar las
    //    comprobaciones criptograficas contra la metadata ACTUAL.
    const cached = this.cache.get(profile.id);
    if (cached) {
      if (
        cached.expiresAt <= this.now() ||
        !cacheEntryMatchesConfiguration(cached, profile)
      ) {
        // Vencida, o la fila ahora apunta a otro secreto / otra version: la
        // entrada ya no describe la configuracion vigente. Se descarta y se
        // sigue como un miss normal, que leera el secretRef NUEVO.
        this.cache.delete(profile.id);
      } else {
        // La metadata de la base es la autoridad: la Wallet cacheada tiene que
        // seguir correspondiendo a ella. Misma validacion que en un miss.
        try {
          this.validateWalletAgainstProfile(cached.wallet, profile, issuerId);
        } catch (error) {
          // La entrada contradice la metadata autoritativa actual. No se
          // retiene hasta que venza el TTL, y NO se vuelve a leer SSM: la
          // propia Wallet cacheada ya prueba la discrepancia, y con el mismo
          // secretRef una relectura derivaria exactamente el mismo material.
          this.cache.delete(profile.id);
          throw error;
        }

        return toResolvedSigner(cached);
      }
    }

    // 3. Miss: traer el secreto, construir y VALIDAR con la misma funcion.
    const wallet = await this.buildVerifiedWallet(profile, issuerId);

    const entry: SignerCacheEntry = {
      profileId: profile.id,
      purpose: profile.purpose,
      keyVersion: profile.keyVersion,
      secretRef: profile.secretRef,
      address: wallet.address,
      wallet,
      expiresAt: this.now() + this.cacheTtlMs
    };
    this.cache.set(profile.id, entry);

    return toResolvedSigner(entry);
  }

  private async loadActiveProfile(
    issuerId: string,
    purpose: SignerProfilePurpose
  ): Promise<SignerProfileRow> {
    const identity = await this.prisma.issuerTechnicalIdentity.findUnique({
      where: { issuerId },
      select:
        purpose === SignerProfilePurpose.assertion
          ? { status: true, assertionSignerProfile: { select: signerProfileSelect } }
          : { status: true, anchorSignerProfile: { select: signerProfileSelect } }
    });

    if (!identity) {
      throw new SignerResolutionError('TECHNICAL_IDENTITY_NOT_CONFIGURED', {
        issuerId
      });
    }

    // `rotation_required` es un estado de intervencion del operador, no un
    // "segui firmando igual". `unconfigured` y `disabled` tampoco resuelven.
    if (identity.status !== IssuerTechnicalIdentityStatus.active) {
      throw new SignerResolutionError('TECHNICAL_IDENTITY_INACTIVE', {
        issuerId
      });
    }

    const profile = (
      purpose === SignerProfilePurpose.assertion
        ? (identity as { assertionSignerProfile?: SignerProfileRow | null })
            .assertionSignerProfile
        : (identity as { anchorSignerProfile?: SignerProfileRow | null })
            .anchorSignerProfile
    ) as SignerProfileRow | null | undefined;

    if (!profile) {
      throw new SignerResolutionError('SIGNER_PROFILE_NOT_CONFIGURED', {
        issuerId
      });
    }

    // Confusion de propositos = error de seguridad. La relacion elegida por la
    // identidad tecnica tiene que coincidir con el proposito pedido.
    if (profile.purpose !== purpose) {
      throw new SignerResolutionError('SIGNER_PURPOSE_MISMATCH', {
        issuerId,
        profileId: profile.id
      });
    }

    if (profile.status !== SignerProfileStatus.active) {
      // Un perfil comprometido o retirado no debe dejar su Wallet retenida en
      // memoria hasta que venza el TTL. Se desaloja ANTES de fallar cerrado.
      //
      // Ojo con el alcance: se desaloja por PERFIL, que es global. Una
      // identidad tecnica deshabilitada NO desaloja el perfil, porque ese
      // mismo anchor puede seguir legitimamente vinculado a otro issuer activo.
      this.cache.delete(profile.id);
      throw new SignerResolutionError('SIGNER_PROFILE_INACTIVE', {
        issuerId,
        profileId: profile.id
      });
    }

    if (profile.addressVerifiedAt === null) {
      throw new SignerResolutionError('SIGNER_ADDRESS_NOT_VERIFIED', {
        issuerId,
        profileId: profile.id
      });
    }

    // Guard de FORMA, barato y temprano: si la direccion persistida no es ni
    // siquiera una direccion, no tiene sentido ir a buscar un secreto contra el
    // que nunca se la va a poder comparar. La comparacion autoritativa sigue
    // viviendo en `validateWalletAgainstProfile`, que es la unica que decide
    // igualdad.
    if (!isAddress(profile.address)) {
      throw new SignerResolutionError('SIGNER_ADDRESS_MISMATCH', {
        issuerId,
        profileId: profile.id
      });
    }

    return profile;
  }

  private normalizePersistedAddress(
    profile: SignerProfileRow,
    issuerId: string
  ): string {
    if (!isAddress(profile.address)) {
      throw new SignerResolutionError('SIGNER_ADDRESS_MISMATCH', {
        issuerId,
        profileId: profile.id
      });
    }

    return getAddress(profile.address);
  }

  /**
   * CONSISTENCIA CRIPTOGRAFICA -- unica implementacion, usada en el miss
   * (despues de construir la Wallet) y en el hit (antes de devolver la
   * cacheada). Dos implementaciones sutilmente distintas serian exactamente la
   * forma de que la version del hit se quede atras.
   *
   * Para un perfil de ASERCION comprueba las cuatro cosas, porque S8c3 va a
   * servir el DID Document desde `publicKeyX`/`publicKeyY`/
   * `publicKeyCompressed` de PostgreSQL SIN leer el secreto: si esos campos
   * cambiaran, el documento publicaria una clave distinta de la que firma.
   *
   * Para un perfil de ANCLAJE la igualdad de direccion alcanza: no se le exige
   * metadata de asercion (S8c1 permite las tres coordenadas en null).
   */
  private validateWalletAgainstProfile(
    wallet: Wallet,
    profile: SignerProfileRow,
    issuerId: string
  ): void {
    const expectedAddress = this.normalizePersistedAddress(profile, issuerId);

    if (wallet.address !== expectedAddress) {
      throw new SignerResolutionError('SIGNER_ADDRESS_MISMATCH', {
        issuerId,
        profileId: profile.id
      });
    }

    if (profile.purpose !== SignerProfilePurpose.assertion) {
      return;
    }

    const signingKey = wallet.signingKey;
    const uncompressed = signingKey.publicKey; // 0x04 || X(32) || Y(32)

    const derivedX = `0x${uncompressed.slice(4, 68)}`;
    const derivedY = `0x${uncompressed.slice(68, 132)}`;
    const derivedCompressed = signingKey.compressedPublicKey;

    // Formato esperado, segun el contrato de S8c1: hex `0x`-prefijado en
    // MINUSCULA. Comparacion exacta: un valor ausente o en mayusculas no es la
    // representacion comprometida y falla cerrado.
    if (
      profile.publicKeyX !== derivedX ||
      profile.publicKeyY !== derivedY ||
      profile.publicKeyCompressed !== derivedCompressed
    ) {
      throw new SignerResolutionError('SIGNER_PUBLIC_KEY_MISMATCH', {
        issuerId,
        profileId: profile.id
      });
    }
  }

  private async buildVerifiedWallet(
    profile: SignerProfileRow,
    issuerId: string
  ): Promise<Wallet> {
    let privateKey: string;
    try {
      privateKey = await this.secretStore.getPrivateKey(profile.secretRef);
    } catch (error) {
      // Ningun error ajeno escapa del resolver: podria arrastrar material
      // sensible en su mensaje.
      if (error instanceof SignerResolutionError) {
        throw error;
      }
      throw new SignerResolutionError('SIGNER_SECRET_UNAVAILABLE', {
        issuerId,
        profileId: profile.id
      });
    }

    // Sin normalizacion piadosa: no se hace trim, no se quitan saltos de
    // linea, no se agrega `0x`. Material mal formado falla cerrado.
    if (!PRIVATE_KEY_PATTERN.test(privateKey)) {
      throw new SignerResolutionError('SIGNER_SECRET_INVALID', {
        issuerId,
        profileId: profile.id
      });
    }

    let wallet: Wallet;
    try {
      // Wallet DESCONECTADA: un solo argumento, sin provider. ethers rechaza
      // aca el escalar 0 y cualquier valor fuera de [1, n-1].
      wallet = new Wallet(privateKey);
    } catch {
      // El error de ethers se descarta por completo, nunca se propaga.
      throw new SignerResolutionError('SIGNER_SECRET_INVALID', {
        issuerId,
        profileId: profile.id
      });
    }

    // A partir de aca no se vuelve a usar `privateKey`: el material publico se
    // deriva de la Wallet, no de la cadena en crudo. MISMA validacion que en
    // un cache hit.
    this.validateWalletAgainstProfile(wallet, profile, issuerId);

    return wallet;
  }
}

/**
 * IDENTIDAD DE CONFIGURACION de una entrada de cache.
 *
 * Es lo que decide si la entrada sigue describiendo la fila vigente. Si algo de
 * esto cambio, la entrada se descarta y se recarga -- y en particular, un
 * `secretRef` distinto hace que se lea el secreto NUEVO.
 *
 * Deliberadamente NO incluye la direccion ni el material publico: esos no son
 * identidad de configuracion sino consistencia criptografica, y su desajuste no
 * se arregla recargando (con el mismo `secretRef` se derivaria exactamente el
 * mismo material). Esos los comprueba `validateWalletAgainstProfile`, que falla
 * cerrado.
 *
 * `SignerProfile` esta pensado como inmutable y la rotacion deberia crear un
 * perfil nuevo, pero eso no esta hoy forzado como primitiva de la base. Esto no
 * convierte cambiar `secretRef` en un flujo de rotacion soportado: solo evita
 * que la cache enmascare un cambio de configuracion.
 */
function cacheEntryMatchesConfiguration(
  entry: SignerCacheEntry,
  profile: SignerProfileRow
): boolean {
  return (
    entry.secretRef === profile.secretRef &&
    entry.purpose === profile.purpose &&
    entry.keyVersion === profile.keyVersion
  );
}

function toResolvedSigner(entry: SignerCacheEntry): ResolvedIssuerSigner {
  return {
    profileId: entry.profileId,
    purpose: entry.purpose,
    keyVersion: entry.keyVersion,
    address: entry.address,
    wallet: entry.wallet
  };
}

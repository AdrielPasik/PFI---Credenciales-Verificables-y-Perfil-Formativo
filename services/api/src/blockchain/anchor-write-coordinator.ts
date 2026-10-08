import { Injectable, Optional } from '@nestjs/common';
import { Contract, NonceManager, type Signer, type Wallet, getAddress } from 'ethers';

import {
  BlockchainTargetError,
  type CredentialRegistryTarget
} from './blockchain-target';
import {
  CredentialRegistryPreflight,
  type CredentialRegistryPreflightProvider,
  createCredentialRegistryProvider
} from './credential-registry-preflight';
import {
  type CredentialRegisteredEvidence,
  type CredentialRegistryLog,
  isCanonicalTransactionHash,
  isValidBlockNumber,
  selectCredentialRegisteredEvidence,
  toSafeUnixSeconds,
  unixSecondsToDate
} from './credential-registry-events';

/**
 * Coordinacion de escrituras del ANCLA -- S8c6.
 *
 * ---------------------------------------------------------------------------
 * QUE RESUELVE
 * ---------------------------------------------------------------------------
 *
 * Un `SignerProfile` de anclaje puede estar compartido entre varios Issuers
 * (es la configuracion de demo). Dos emisiones concurrentes de DOS Issuers
 * distintos que comparten el MISMO perfil usan la MISMA cuenta, y por lo tanto
 * compiten por el mismo nonce. Sin serializacion, una de las dos transacciones
 * se reemplaza o se queda colgada.
 *
 * Por eso la serializacion se ancla al `SignerProfile.id` y NO al `issuerId`:
 * el issuer no es la identidad de custodia, el perfil si.
 *
 * ---------------------------------------------------------------------------
 * UN SOLO PROVIDER POR INTENTO
 * ---------------------------------------------------------------------------
 *
 * El preflight autoriza el ENDPOINT que esa escritura va a usar. Si se
 * validara un provider y se escribiera por otro, el preflight no probaria nada
 * sobre la escritura. Asi que provider, preflight, signer, NonceManager y
 * Contract comparten UNA instancia.
 *
 * Esto no afirma que el servicio de RPC remoto no pueda cambiar de estado entre
 * dos requests: solo impide que Scope valide un camino y escriba por otro.
 *
 * ---------------------------------------------------------------------------
 * LIMITE DE CONCURRENCIA -- HONESTO
 * ---------------------------------------------------------------------------
 *
 * La cola y el `NonceManager` viven EN ESTE PROCESO. Protegen un solo proceso
 * Node.js. NO coordinan dos tasks de ECS, dos pods, dos maquinas, ni un
 * despliegue rolling con instancias superpuestas. No es seguridad de nonce
 * distribuida y no se la presenta como tal.
 *
 * ---------------------------------------------------------------------------
 * UN SOLO INTENTO
 * ---------------------------------------------------------------------------
 *
 * Un intento de envio por llamada. Sin bucles, sin reintento automatico, sin
 * "probar una vez mas": una escritura que expiro puede haber llegado igual a la
 * red, y reenviar a ciegas duplicaria la transaccion o romperia el nonce.
 *
 * ---------------------------------------------------------------------------
 * CERROJO DE INCERTIDUMBRE -- S8c6.1
 * ---------------------------------------------------------------------------
 *
 * `NonceManager` RESERVA e incrementa su nonce local ANTES de delegar el
 * envio. Si el envio lanza sin devolver una `TransactionResponse` confiable,
 * no se sabe si la transaccion nunca llego al nodo o si llego y se perdio la
 * respuesta.
 *
 * Por eso NO se limpia automaticamente el nonce local: limpiarlo haria que el
 * siguiente envio recargue el nonce pendiente del provider y continue como si
 * el estado fuera conocido, y esa es exactamente la inferencia que no se puede
 * hacer. En cambio el carril perfil+cadena queda marcado INCIERTO y los
 * envios posteriores de ese mismo carril fallan cerrado.
 *
 * El cerrojo es DE PROCESO, igual que la cola: no sobrevive a un reinicio y no
 * coordina replicas. Una politica explicita de recuperacion -- fuera de S8c6
 * -- podra limpiarlo; aca no hay endpoint, ni temporizador, ni tabla de nonces.
 */

/** Confirmaciones exigidas al esperar el minado. Sin claims de finalidad. */
export const CREDENTIAL_REGISTRY_CONFIRMATIONS = 1;

/**
 * Espera de MINADO. Es otra cosa que el timeout de request del RPC de S8c5
 * (10 s): ese acota una llamada HTTP, este acota cuanto se espera a que la
 * transaccion entre en un bloque.
 */
export const CREDENTIAL_REGISTRY_MINING_TIMEOUT_MS = 90_000;

/** Signer de anclaje ya resuelto y autorizado por S8c2. */
export interface AnchorSignerSnapshot {
  readonly profileId: string;
  readonly keyVersion: number;
  /** Checksum EIP-55. Es el registrante ESPERADO. */
  readonly address: string;
  readonly wallet: Wallet;
}

/** Lo que el coordinador necesita de un provider. */
export interface AnchorChainProvider extends CredentialRegistryPreflightProvider {
  getBlock(blockNumber: number): Promise<{ timestamp?: unknown } | null>;
}

export interface AnchorTransactionReceipt {
  readonly status?: number | null;
  readonly hash?: string | null;
  readonly blockNumber?: number | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly logs?: readonly CredentialRegistryLog[];
}

export interface AnchorTransactionResponse {
  readonly hash: string;
  wait(
    confirmations?: number,
    timeoutMs?: number
  ): Promise<AnchorTransactionReceipt | null>;
}

/** Cliente de contrato de bajo nivel: conoce target, signer y hash. Nada mas. */
export interface AnchorRegistryWriter {
  registerCredential(credentialHash: string): Promise<AnchorTransactionResponse>;
}

/** Evidencia de cadena confiable. Nada aca sale del reloj del servidor. */
export interface AnchorRegistrationEvidence {
  readonly txHash: string;
  readonly blockNumber: number;
  /** Registrante OBSERVADO. */
  readonly registrant: string;
  /** Derivado de `block.timestamp`. */
  readonly registeredAt: Date;
}

export class AnchorWriteError extends Error {
  readonly code: AnchorWriteErrorCode;
  readonly providerErrorName?: string;

  constructor(
    code: AnchorWriteErrorCode,
    context: { providerErrorName?: string } = {}
  ) {
    super(SAFE_MESSAGES[code]);
    this.name = 'AnchorWriteError';
    this.code = code;

    if (context.providerErrorName !== undefined) {
      this.providerErrorName = context.providerErrorName;
    }
  }
}

export type AnchorWriteErrorCode =
  | 'ANCHOR_SEND_FAILED'
  | 'ANCHOR_RECEIPT_UNAVAILABLE'
  | 'ANCHOR_RECEIPT_REJECTED'
  | 'ANCHOR_EVIDENCE_INCONSISTENT'
  | 'ANCHOR_BLOCK_UNAVAILABLE'
  | 'ANCHOR_LANE_UNCERTAIN';

/** Mensajes FIJOS. Nunca se interpola el endpoint, el nonce ni la wallet. */
const SAFE_MESSAGES: Record<AnchorWriteErrorCode, string> = {
  ANCHOR_SEND_FAILED: 'No se pudo enviar la registracion a la red.',
  ANCHOR_RECEIPT_UNAVAILABLE:
    'La registracion no fue confirmada dentro del tiempo de espera.',
  ANCHOR_RECEIPT_REJECTED: 'La transaccion de registracion no fue exitosa.',
  ANCHOR_EVIDENCE_INCONSISTENT:
    'La evidencia de la registracion no es consistente con la intencion registrada.',
  ANCHOR_BLOCK_UNAVAILABLE:
    'No se pudo obtener el bloque de la registracion para fecharla.',
  ANCHOR_LANE_UNCERTAIN:
    'El estado de envio de este firmante de anclaje quedo indeterminado y no se envian registraciones nuevas.'
};

export function safeAnchorWriteMessage(code: AnchorWriteErrorCode): string {
  return SAFE_MESSAGES[code];
}

/** ABI de escritura. Solo el metodo que se usa. */
const CREDENTIAL_REGISTRY_REGISTER_ABI = [
  'function registerCredential(bytes32 credentialHash)'
] as const;

export interface AnchorWriteDependencies {
  createProvider?: (target: CredentialRegistryTarget) => AnchorChainProvider;
  createWriter?: (input: {
    target: CredentialRegistryTarget;
    signer: Signer;
  }) => AnchorRegistryWriter;
}

/**
 * Entrada de cache por (perfil, cadena).
 *
 * El `NonceManager` tiene que SOBREVIVIR entre intentos del mismo ancla en la
 * misma cadena -- si se recreara por intento, su estado de nonce se perderia y
 * no serviria de nada. Y como el preflight debe correr sobre el MISMO provider
 * que la escritura, el provider se cachea junto con el.
 *
 * La identidad del nonce incluye el `chainId`: reutilizar el estado de una
 * cadena en otra produciria nonces incorrectos.
 */
interface AnchorSignerCacheEntry {
  readonly rpcUrl: string;
  readonly address: string;
  readonly provider: AnchorChainProvider;
  readonly nonceManager: NonceManager;
}

@Injectable()
export class AnchorWriteCoordinator {
  /** Cola por `SignerProfile.id`. Dos Issuers con el mismo ancla comparten cola. */
  private readonly queues = new Map<string, Promise<unknown>>();
  /** Provider + NonceManager por `${profileId}:${chainId}`. */
  private readonly signers = new Map<string, AnchorSignerCacheEntry>();
  /**
   * Carriles perfil+cadena cuyo estado de nonce quedo INDETERMINADO por un
   * envio ambiguo. En proceso, sin persistencia y sin forma de limpiarlo.
   */
  private readonly uncertainLanes = new Set<string>();

  constructor(
    @Optional()
    private readonly preflight: CredentialRegistryPreflight = new CredentialRegistryPreflight(),
    // Dobles de provider/contrato para tests. En produccion nunca se pasan:
    // ningun test de S8c6 construye un JsonRpcProvider real.
    @Optional()
    private readonly dependencies: AnchorWriteDependencies = {}
  ) {}

  /**
   * Serializa por perfil de ancla y hace UN intento de registracion.
   *
   * La cola se libera siempre -- exito o fallo -- para que un rechazo no deje
   * el ancla bloqueada.
   */
  async registerCredentialHash(input: {
    target: CredentialRegistryTarget;
    signer: AnchorSignerSnapshot;
    credentialHash: string;
    /**
     * Compuerta AUTORITATIVA de uso de la clave. Corre DENTRO de la cola,
     * inmediatamente antes del preflight: una verificacion hecha antes de
     * esperar el carril puede quedar obsoleta mientras se espera.
     */
    assertSignerUsable?: () => Promise<void>;
  }): Promise<AnchorRegistrationEvidence> {
    return this.enqueue(input.signer.profileId, () =>
      this.executeSingleAttempt(input)
    );
  }

  /** Solo lectura: no hay forma de limpiar el cerrojo desde la aplicacion. */
  isAnchorLaneUncertain(profileId: string, chainId: number): boolean {
    return this.uncertainLanes.has(laneKey(profileId, chainId));
  }

  /**
   * Secuencia una operacion detras de las anteriores de la misma clave.
   *
   * `previous.catch(() => {})` es deliberado: un fallo anterior no debe
   * propagarse a la siguiente operacion ni romper la cadena de la cola.
   */
  private enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);

    this.queues.set(
      key,
      next.catch(() => undefined)
    );

    return next;
  }

  private async executeSingleAttempt(input: {
    target: CredentialRegistryTarget;
    signer: AnchorSignerSnapshot;
    credentialHash: string;
    assertSignerUsable?: () => Promise<void>;
  }): Promise<AnchorRegistrationEvidence> {
    const { target, signer, credentialHash } = input;
    const lane = laneKey(signer.profileId, target.chainId);

    // CERROJO: si un envio anterior de este carril quedo ambiguo, no se manda
    // otra transaccion con un nonce cuyo estado real se desconoce.
    if (this.uncertainLanes.has(lane)) {
      throw new AnchorWriteError('ANCHOR_LANE_UNCERTAIN');
    }

    // COMPUERTA DENTRO DE LA COLA. El perfil historico del intent pudo
    // marcarse comprometido mientras este intento esperaba el carril de otro
    // Issuer que comparte el mismo ancla. Se valida aca, no antes de esperar.
    if (input.assertSignerUsable) {
      await input.assertSignerUsable();
    }

    const entry = this.resolveSignerEntry(target, signer);

    // PREFLIGHT sobre el MISMO provider por el que se va a escribir. Lanza
    // `BlockchainTargetError` si la cadena no es la esperada o si no hay codigo
    // en la direccion; se deja propagar tal cual, ya tiene mensaje seguro.
    await this.preflight.assertWritable(target, entry.provider);

    const writer = this.createWriter({
      target,
      signer: entry.nonceManager
    });

    // UN solo envio. Si lanza antes de devolver una `TransactionResponse`
    // confiable el resultado es AMBIGUO: pudo no haber llegado al nodo, o
    // haber llegado y haberse perdido la respuesta. No se reenvia, no se
    // limpia el nonce local y el carril queda cerrado para envios posteriores.
    let transaction: AnchorTransactionResponse;
    try {
      transaction = await writer.registerCredential(credentialHash);
    } catch (error) {
      this.uncertainLanes.add(lane);
      throw new AnchorWriteError('ANCHOR_SEND_FAILED', {
        providerErrorName: errorName(error)
      });
    }

    let receipt: AnchorTransactionReceipt | null;
    try {
      receipt = await transaction.wait(
        CREDENTIAL_REGISTRY_CONFIRMATIONS,
        CREDENTIAL_REGISTRY_MINING_TIMEOUT_MS
      );
    } catch (error) {
      // Timeout de minado o error de transporte. NO se reenvia.
      //
      // Esto NO es ambiguedad de ENVIO: ya existe una `TransactionResponse`,
      // asi que la transaccion se transmitio y el nonce se consumio. El carril
      // sigue utilizable y no se afirma nada sobre el resultado en la cadena:
      // el registro queda PENDING y la reconciliacion decide.
      throw new AnchorWriteError('ANCHOR_RECEIPT_UNAVAILABLE', {
        providerErrorName: errorName(error)
      });
    }

    if (!receipt) {
      throw new AnchorWriteError('ANCHOR_RECEIPT_UNAVAILABLE');
    }

    if (receipt.status !== 1) {
      throw new AnchorWriteError('ANCHOR_RECEIPT_REJECTED');
    }

    const evidence = this.validateReceiptEvidence({
      receipt,
      target,
      signer,
      credentialHash,
      broadcastHash: transaction.hash
    });

    // FECHA DE LA CADENA. Sale de `block.timestamp`, nunca del reloj local.
    const registeredAt = await this.readBlockTimestamp(
      entry.provider,
      evidence.blockNumber
    );

    return {
      txHash: evidence.txHash,
      blockNumber: evidence.blockNumber,
      registrant: evidence.registrant,
      registeredAt
    };
  }

  /**
   * Comprueba que el receipt describa LA registracion que se pidio.
   *
   * No alcanza con que el metodo haya devuelto un objeto: se exige hash
   * canonico, bloque valido, contrato de destino correcto, registrante igual al
   * ancla esperada, y un log `CredentialRegistered` cuyo hash y registrante
   * coincidan con el intent.
   */
  private validateReceiptEvidence(input: {
    receipt: AnchorTransactionReceipt;
    target: CredentialRegistryTarget;
    signer: AnchorSignerSnapshot;
    credentialHash: string;
    broadcastHash: string;
  }): CredentialRegisteredEvidence {
    const { receipt, target, signer, credentialHash, broadcastHash } = input;

    const txHash = receipt.hash ?? broadcastHash;
    if (!isCanonicalTransactionHash(txHash)) {
      throw new AnchorWriteError('ANCHOR_EVIDENCE_INCONSISTENT');
    }

    if (!isValidBlockNumber(receipt.blockNumber)) {
      throw new AnchorWriteError('ANCHOR_EVIDENCE_INCONSISTENT');
    }

    if (!addressEquals(receipt.to, target.contractAddress)) {
      throw new AnchorWriteError('ANCHOR_EVIDENCE_INCONSISTENT');
    }

    if (!addressEquals(receipt.from, signer.address)) {
      throw new AnchorWriteError('ANCHOR_EVIDENCE_INCONSISTENT');
    }

    const selection = selectCredentialRegisteredEvidence(receipt.logs ?? [], {
      credentialHash,
      registrant: signer.address
    });

    if (selection.kind !== 'single') {
      throw new AnchorWriteError('ANCHOR_EVIDENCE_INCONSISTENT');
    }

    if (
      selection.evidence.txHash !== (txHash as string).toLowerCase() ||
      selection.evidence.blockNumber !== receipt.blockNumber
    ) {
      throw new AnchorWriteError('ANCHOR_EVIDENCE_INCONSISTENT');
    }

    return selection.evidence;
  }

  private async readBlockTimestamp(
    provider: AnchorChainProvider,
    blockNumber: number
  ): Promise<Date> {
    let block: { timestamp?: unknown } | null;
    try {
      block = await provider.getBlock(blockNumber);
    } catch (error) {
      throw new AnchorWriteError('ANCHOR_BLOCK_UNAVAILABLE', {
        providerErrorName: errorName(error)
      });
    }

    if (!block) {
      throw new AnchorWriteError('ANCHOR_BLOCK_UNAVAILABLE');
    }

    const seconds = toSafeUnixSeconds(block.timestamp);
    if (seconds === null) {
      throw new AnchorWriteError('ANCHOR_BLOCK_UNAVAILABLE');
    }

    const registeredAt = unixSecondsToDate(seconds);
    if (registeredAt === null) {
      throw new AnchorWriteError('ANCHOR_BLOCK_UNAVAILABLE');
    }

    return registeredAt;
  }

  /**
   * Devuelve el provider + NonceManager de este ancla en esta cadena,
   * creandolos si hace falta.
   *
   * La entrada cacheada se descarta si la configuracion dejo de corresponder
   * -- otro endpoint o otra direccion -- siguiendo el mismo criterio que la
   * cache de signers de S8c2: la metadata vigente es la autoridad.
   */
  private resolveSignerEntry(
    target: CredentialRegistryTarget,
    signer: AnchorSignerSnapshot
  ): AnchorSignerCacheEntry {
    const key = laneKey(signer.profileId, target.chainId);
    const cached = this.signers.get(key);

    if (
      cached &&
      cached.rpcUrl === target.rpcUrl &&
      cached.address === signer.address
    ) {
      return cached;
    }

    const provider = this.createProvider(target);
    const connected = signer.wallet.connect(provider as never);
    const entry: AnchorSignerCacheEntry = {
      rpcUrl: target.rpcUrl,
      address: signer.address,
      provider,
      // Sin aritmetica de nonce propia: `getTransactionCount() + 1` escrito a
      // mano es justamente el error que `NonceManager` existe para evitar.
      nonceManager: new NonceManager(connected)
    };

    this.signers.set(key, entry);
    return entry;
  }

  private createProvider(
    target: CredentialRegistryTarget
  ): AnchorChainProvider {
    if (this.dependencies.createProvider) {
      return this.dependencies.createProvider(target);
    }

    return createCredentialRegistryProvider(target) as unknown as AnchorChainProvider;
  }

  private createWriter(input: {
    target: CredentialRegistryTarget;
    signer: Signer;
  }): AnchorRegistryWriter {
    if (this.dependencies.createWriter) {
      return this.dependencies.createWriter(input);
    }

    const contract = new Contract(
      input.target.contractAddress,
      CREDENTIAL_REGISTRY_REGISTER_ABI as unknown as string[],
      input.signer
    );

    return {
      async registerCredential(credentialHash: string) {
        return (await contract.registerCredential(
          credentialHash
        )) as AnchorTransactionResponse;
      }
    };
  }
}

/**
 * Identidad del nonce y del cerrojo: PERFIL + CADENA.
 *
 * El `issuerId` NO participa: dos Issuers pueden compartir un ancla, y el
 * estado de nonce es de la CUENTA en una CADENA.
 */
function laneKey(profileId: string, chainId: number): string {
  return `${profileId}:${chainId}`;
}

function addressEquals(left: unknown, right: string): boolean {
  if (typeof left !== 'string' || left.length === 0) {
    return false;
  }

  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

/** SOLO el nombre de la clase del error. Nunca su mensaje. */
function errorName(error: unknown): string | undefined {
  if (error instanceof BlockchainTargetError) {
    return error.name;
  }

  if (error instanceof Error && typeof error.name === 'string') {
    return error.name;
  }

  return undefined;
}

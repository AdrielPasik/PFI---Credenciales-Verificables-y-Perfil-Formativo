import { Injectable, Optional } from '@nestjs/common';
import {
  type BlockchainNetwork,
  BlockchainRecordStatus
} from '@prisma/client';
import { isAddress } from 'ethers';

import {
  CredentialRegistryDeploymentResolver,
  isMockBlockchainRecord
} from '../blockchain/credential-registry-deployment';
import {
  CredentialRegistryReadClient,
  type CredentialRegistryTargetBoundReader
} from '../blockchain/credential-registry-read-client';
import {
  type BlockchainEvidence,
  type BlockchainEvidenceReason
} from './verification-outcome';

/**
 * Lector de EVIDENCIA DE BLOCKCHAIN para la verificacion publica -- S8c7.
 *
 * ---------------------------------------------------------------------------
 * SOLO OBSERVA
 * ---------------------------------------------------------------------------
 *
 * Responde "que evidencia de anclaje/revocacion puede observar Scope AHORA
 * para este hash canonico". Una verificacion publica es una observacion:
 *
 *   NO finaliza un record `pending`;
 *   NO adopta un huerfano;
 *   NO llama a la reconciliacion que escribe;
 *   NO envia `registerCredential` ni `revokeCredential`;
 *   NO actualiza Credential ni BlockchainRecord.
 *
 * Tampoco firma: no necesita ninguna clave privada, ni el almacen de secretos,
 * ni el coordinador de escrituras. El registrante ESPERADO sale de metadata
 * publica persistida.
 *
 * Y no mira el proof: la autenticidad es otra pregunta, y un resultado de
 * cadena no puede cambiarla.
 *
 * ---------------------------------------------------------------------------
 * EL TARGET SALE DEL RECORD, NO DE LA CONFIGURACION DE HOY
 * ---------------------------------------------------------------------------
 *
 * Red, chainId y direccion de contrato son las del record HISTORICO. Si la
 * configuracion vigente apunta a otro deployment, este record no se puede
 * observar y el resultado es UNAVAILABLE. Nunca se cae al deployment actual ni
 * se fabrica Base Sepolia: buscar el hash en una cadena distinta de la que lo
 * registro no responde la pregunta.
 *
 * Lo UNICO que aporta el entorno es la conectividad RPC.
 */

/** Fila de evidencia, con la procedencia publica que hace falta. */
export interface BlockchainEvidenceRecordInput {
  readonly network: BlockchainNetwork;
  readonly chainId: number;
  readonly contractAddress: string;
  readonly credentialHash: string;
  readonly status: BlockchainRecordStatus;
  /** Registrante OBSERVADO, nullable desde S8c6. Nunca es la expectativa
   *  cuando existe `anchorSignerProfileId`. */
  readonly issuerAddress: string | null;
  readonly anchorSignerProfileId: string | null;
  /** `SignerProfile.address` PUBLICO del ancla historica, si la hay. */
  readonly anchorSignerAddress: string | null;
}

export interface BlockchainEvidenceResult {
  readonly blockchainEvidence: BlockchainEvidence;
  readonly reason: BlockchainEvidenceReason;
  /**
   * De donde salio el registrante esperado. `legacy_issuer_address` existe
   * solo por compatibilidad con filas previas a `anchorSignerProfileId`.
   */
  readonly expectedRegistrantProvenance:
    | 'anchor_signer_profile'
    | 'legacy_issuer_address'
    | null;
}

@Injectable()
export class CredentialBlockchainEvidenceReader {
  constructor(
    private readonly deploymentResolver: CredentialRegistryDeploymentResolver,
    // Doble inyectable en tests. En produccion se usa el cliente real, que
    // toma su conectividad del entorno. Mismo patron que la reconciliacion de
    // S8b: ningun test construye un JsonRpcProvider.
    @Optional()
    private readonly readClient: CredentialRegistryTargetBoundReader = new CredentialRegistryReadClient()
  ) {}

  /**
   * `records` son TODAS las filas de evidencia de la credencial, sin ordenar y
   * sin recortar. La multiplicidad es parte de la pregunta.
   */
  async read(input: {
    credentialCanonicalHash: string | null;
    records: readonly BlockchainEvidenceRecordInput[];
  }): Promise<BlockchainEvidenceResult> {
    // -----------------------------------------------------------------------
    // MULTIPLICIDAD -- FALLA CERRADO, SIN ELEGIR
    // -----------------------------------------------------------------------
    //
    // El dominio crea exactamente UN BlockchainRecord por credencial: una
    // emision real crea uno, una emision mock crea uno, y la revocacion
    // ACTUALIZA el existente en vez de insertar otro. Un test congela esa
    // invariante.
    //
    // Por eso mas de una fila no es una coleccion cronologica que haya que
    // ordenar: es una anomalia de integridad. Y no hay forma honesta de elegir
    // una -- la tabla no tiene `createdAt`, el `registeredAt` de una fila
    // `pending` es NULL, y ordenar por UUID seria inventar una cronologia que
    // el almacenamiento no tiene. Asi que no se elige ninguna.
    if (input.records.length === 0) {
      return result('NOT_FOUND', 'NO_BLOCKCHAIN_RECORD');
    }

    if (input.records.length > 1) {
      return result('UNAVAILABLE', 'AMBIGUOUS_BLOCKCHAIN_RECORDS');
    }

    const record = input.records[0];

    // -----------------------------------------------------------------------
    // MOCK -- CERO RED
    // -----------------------------------------------------------------------
    //
    // Un record mock no es REGISTERED: significa "a este record no le aplica
    // ninguna atestacion de blockchain externa". No se construye provider y no
    // se hace ninguna llamada.
    if (isMockBlockchainRecord(record)) {
      return result('NOT_APPLICABLE_MOCK', 'MOCK_EVIDENCE_RECORD');
    }

    // El record tiene que describir ESTA credencial. Si su hash no es el
    // canonicalHash de la credencial, consultar la cadena con el daria un
    // resultado que no habla de este artefacto.
    if (
      typeof input.credentialCanonicalHash !== 'string' ||
      input.credentialCanonicalHash.toLowerCase() !==
        record.credentialHash.toLowerCase()
    ) {
      return result('UNAVAILABLE', 'RECORD_HASH_CORRELATION_FAILED');
    }

    // -----------------------------------------------------------------------
    // TARGET LIGADO AL RECORD
    // -----------------------------------------------------------------------
    const resolution = this.deploymentResolver.resolve({
      network: record.network,
      chainId: record.chainId,
      contractAddress: record.contractAddress,
      credentialHash: record.credentialHash,
      // El resolver no lo usa para resolver el deployment; se le pasa una
      // cadena vacia porque la expectativa de registrante la decide ESTE
      // componente y no el resolver.
      issuerAddress: ''
    });

    if (resolution.kind !== 'resolved') {
      // Incluye `mock_unsupported`, que aca no deberia ocurrir porque el mock
      // ya se clasifico arriba, y cualquier configuracion que no corresponda
      // al record. En los dos casos no hay nada observable.
      return result('UNAVAILABLE', 'DEPLOYMENT_UNRESOLVED');
    }

    // -----------------------------------------------------------------------
    // REGISTRANTE ESPERADO -- PROCEDENCIA EXPLICITA
    // -----------------------------------------------------------------------
    const expected = resolveExpectedRegistrant(record);
    if (expected === null) {
      // Sin una expectativa confiable NO se puede decir REGISTRANT_UNEXPECTED:
      // ese resultado exige que exista una expectativa Y que la cadena reporte
      // positivamente otra. Sin expectativa, lo honesto es "no observable".
      return result('UNAVAILABLE', 'EXPECTED_REGISTRANT_UNRESOLVED');
    }

    // -----------------------------------------------------------------------
    // LECTURA -- UN SOLO PROVIDER, PREFLIGHT Y READ SOBRE EL MISMO
    // -----------------------------------------------------------------------
    const chainState = await this.readClient.readTargetBoundCredentialState({
      target: resolution.deployment,
      credentialHash: record.credentialHash,
      expectedRegistrant: expected.address
    });

    const pendingIntent = record.status === BlockchainRecordStatus.pending;

    switch (chainState.kind) {
      case 'credential_state':
        return chainState.status.revoked
          ? result('REVOKED_ON_CHAIN', 'CHAIN_STATE_OBSERVED', expected.provenance)
          : result('REGISTERED', 'CHAIN_STATE_OBSERVED', expected.provenance);

      case 'credential_issuer_mismatch':
        // La cadena registra el hash bajo OTRO registrante. Esto tiene
        // precedencia sobre `revoked`: una revocacion firmada por una cuenta
        // que contradice la procedencia del anclaje no es evidencia de
        // revocacion de ESTA credencial.
        return result(
          'REGISTRANT_UNEXPECTED',
          'REGISTRANT_MISMATCH',
          expected.provenance
        );

      case 'credential_missing':
        // Lectura EXITOSA que dice "no esta". Para un intent `pending` eso no
        // es NOT_FOUND: el intent sigue pendiente, y S8c6 se niega a propósito
        // a reenviarlo automaticamente. Para una fila que se declara
        // registrada, en cambio, es evidencia externa NEGATIVA concreta y no
        // se reporta REGISTERED solo porque la base lo dijo una vez.
        return pendingIntent
          ? result('PENDING', 'PENDING_INTENT_NOT_YET_ON_CHAIN', expected.provenance)
          : result('NOT_FOUND', 'CHAIN_NOT_REGISTERED', expected.provenance);

      case 'record_deployment_mismatch':
        return result('UNAVAILABLE', 'DEPLOYMENT_UNRESOLVED', expected.provenance);

      case 'rpc_chain_id_mismatch':
      case 'contract_code_missing':
      case 'rpc_unavailable':
      case 'registry_read_failed':
        // Cadena equivocada, contrato ausente, timeout o fallo de la llamada:
        // en los cuatro casos NO se obtuvo un estado confiable, asi que no se
        // afirma nada sobre la cadena. Un intent `pending` tampoco se reporta
        // como PENDING aca: la pregunta es que se puede OBSERVAR, y ahora no se
        // puede observar nada. El hecho de que el intent exista viaja como
        // metadata segura, no como el resultado de esta dimension.
        return result('UNAVAILABLE', 'RPC_UNAVAILABLE', expected.provenance);
    }
  }
}

/**
 * Registrante ESPERADO, con su procedencia.
 *
 *   anchorSignerProfileId presente -> `SignerProfile.address` publico. Es la
 *                                     procedencia que S8c6 persiste.
 *   solo issuerAddress             -> compatibilidad con filas previas a
 *                                     S8c6. Se marca como LEGACY: es el
 *                                     registrante OBSERVADO en su momento, y
 *                                     usarlo como expectativa es lo unico
 *                                     disponible para esas filas. NO
 *                                     reinterpreta `issuerAddress` como
 *                                     identidad de asercion ni como una nueva
 *                                     fuente de autoridad de firma.
 *
 * Si hay perfil de ancla pero su direccion falta o esta mal formada, NO se cae
 * a `issuerAddress`: la procedencia declarada por el record es la que manda, y
 * sustituirla en silencio por el valor observado haria circular la comparacion
 * -- se compararia la cadena contra lo que la cadena dijo.
 */
function resolveExpectedRegistrant(record: BlockchainEvidenceRecordInput):
  | {
      address: string;
      provenance: 'anchor_signer_profile' | 'legacy_issuer_address';
    }
  | null {
  if (record.anchorSignerProfileId !== null) {
    return isUsableAddress(record.anchorSignerAddress)
      ? {
          address: record.anchorSignerAddress as string,
          provenance: 'anchor_signer_profile'
        }
      : null;
  }

  return isUsableAddress(record.issuerAddress)
    ? {
        address: record.issuerAddress as string,
        provenance: 'legacy_issuer_address'
      }
    : null;
}

function isUsableAddress(value: string | null): boolean {
  return (
    typeof value === 'string' &&
    /^0x[0-9a-fA-F]{40}$/.test(value) &&
    isAddress(value)
  );
}

function result(
  blockchainEvidence: BlockchainEvidence,
  reason: BlockchainEvidenceReason,
  expectedRegistrantProvenance: BlockchainEvidenceResult['expectedRegistrantProvenance'] = null
): BlockchainEvidenceResult {
  return { blockchainEvidence, reason, expectedRegistrantProvenance };
}

import { BlockchainRecordSummaryDto } from './blockchain-record-summary.dto';
import { type ScopeProofV1 } from '../scope-proof-v1';

export class CredentialSummaryResponseDto {
  id!: string;
  schemaVersion!: string;
  issuerId!: string;
  subjectUserId!: string;
  type!: string;
  title!: string;
  description?: string;
  sourceType!: string;
  status!: string;
  hours?: string;
  academicCourseId?: string;
  externalCourseId?: string;
  credentialSubject!: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  createdAt!: string;
  updatedAt!: string;
  issuedAt?: string;
  canonicalHash?: string;
  canonicalizationVersion?: string;
  /**
   * DID de la IDENTIDAD TECNICA del emisor, el mismo que entra en canon_v2 y
   * que es sujeto del DID Document de S8c3. NUNCA el `Issuer.did` legacy.
   *
   * Solo lo trae la respuesta de una emision autenticada; un borrador no tiene
   * autoria que expresar.
   */
  issuerDid?: string;
  /**
   * DID del titular, exactamente el valor que entro en canon_v2 -- el que
   * devolvio el provisioning perezoso, nunca una lectura anterior.
   *
   * Solo lo trae la respuesta de una emision autenticada.
   */
  subjectDid?: string;
  /**
   * Proof `scope-proof-v1` recien construido. Presente unicamente en la
   * respuesta de una emision exitosa de `credential_v2`.
   *
   * Es material PUBLICO: firma y metadatos. No lleva, ni puede llevar,
   * direccion del signer, `secretRef` ni nada de la clave privada.
   */
  proof?: ScopeProofV1;
  latestBlockchainRecord?: BlockchainRecordSummaryDto;
}

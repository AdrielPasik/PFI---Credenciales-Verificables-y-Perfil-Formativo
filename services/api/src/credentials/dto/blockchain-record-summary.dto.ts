export class BlockchainRecordSummaryDto {
  id!: string;
  network!: string;
  chainId!: number;
  status!: string;
  credentialHash!: string;
  hashAlgorithm!: string;
  canonicalizationVersion!: string;
  contractAddress!: string;
  /**
   * S8c6: los tres campos de abajo son HECHOS DE LA CADENA y son `null`
   * mientras la evidencia esta `pending` -- el intent es durable desde antes de
   * que exista la transaccion. `null` significa "todavia no observado", nunca
   * "vacio": no hay placeholder.
   *
   * La semantica publica de `pending` para el verificador la define S8c7.
   */
  txHash!: string | null;
  /** Registrante OBSERVADO (`transaction.from`), no la identidad del emisor. */
  issuerAddress!: string | null;
  /** Fecha de la registracion EN LA CADENA (`block.timestamp`). */
  registeredAt!: string | null;
}

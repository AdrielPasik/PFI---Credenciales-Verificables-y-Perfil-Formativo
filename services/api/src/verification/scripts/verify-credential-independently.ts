/**
 * Verificacion INDEPENDIENTE y de SOLO LECTURA de una credencial -- S8 cierre de
 * Base Sepolia.
 *
 * ---------------------------------------------------------------------------
 * QUE HACE
 * ---------------------------------------------------------------------------
 *
 * Dado el MATERIAL de una credencial (ver `IndependentVerificationMaterial`) y,
 * opcionalmente, un endpoint RPC de Base Sepolia entregado en tiempo de
 * ejecucion, demuestra:
 *
 *   1. reconstruye `canon_v2` desde el contenido y calcula SHA-256;
 *   2. lo compara con el `canonicalHash` declarado;
 *   3. verifica la firma `scope-proof-v1` / EIP-191 y recupera la direccion;
 *   4. comprueba que el DID Document del emisor publica esa clave y la autoriza
 *      como `assertionMethod`;
 *   5. consulta `getCredentialStatus(canonicalHash)` en el contrato, tras
 *      verificar la cadena y la presencia de codigo;
 *   6. informa si el registrante on-chain y el estado coinciden con lo declarado.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ES "INDEPENDIENTE" -- Y HASTA DONDE
 * ---------------------------------------------------------------------------
 *
 * NO usa PostgreSQL, NO usa AWS, NO resuelve ningun signer y NO necesita una
 * clave privada. El contenido lo aporta QUIEN PRESENTA la credencial (el titular
 * o un tercero autorizado); la API publica `/verify` expone la firma, el hash y
 * las coordenadas de la cadena, pero NO el contenido (privacidad), de modo que
 * "no fue alterado" requiere ese contenido presentado.
 *
 * Reutiliza la misma logica que el verificador del servidor
 * (`CredentialAuthenticityVerifier` + `CredentialHashingService`) y el mismo
 * cliente de lectura del contrato: no duplica criptografia. Lo unico que se
 * sustituye es la FUENTE del DID Document: aqui es un archivo o la URL publica
 * del did:web, en vez del resolver local contra la base.
 *
 * ---------------------------------------------------------------------------
 * LO QUE NO PRUEBA
 * ---------------------------------------------------------------------------
 *
 * - Que la institucion este acreditada o sea legitima (autoridad administrativa).
 * - Que la cuenta registrante pertenezca a esa institucion: el DID Document
 *   publica la clave de ASERCION; la cuenta de ANCLAJE se compara contra lo que
 *   declara el material, no contra el DID.
 * - Finalidad de la cadena: una confirmacion, sin claims de reorganizacion.
 *
 * ---------------------------------------------------------------------------
 * SEGURIDAD
 * ---------------------------------------------------------------------------
 *
 * Solo lee. No envia transacciones, no pide ni acepta claves privadas, no
 * imprime el RPC (que se toma de `CREDENTIAL_REGISTRY_RPC_URL` y nunca se
 * refleja en la salida) ni credenciales de autenticacion.
 */

import { readFileSync } from 'node:fs';

import { getAddress, isAddress } from 'ethers';

import {
  CredentialRegistryReadClient,
  type CredentialRegistryTargetBoundReader,
  type RecordBoundCredentialRegistryReadResult
} from '../../blockchain/credential-registry-read-client';
import {
  chainIdForCredentialRegistryNetwork,
  isCredentialRegistryNetwork
} from '../../blockchain/blockchain-target';
import { CredentialHashingService } from '../../credentials/credential-hashing.service';
import { issuerDidDocumentUrl } from '../../identity/did-web-issuer';
import { type IssuerDidDocumentResolver } from '../../identity/issuer-did-document.resolver';
import { CredentialAuthenticityVerifier } from '../credential-authenticity.verifier';

// ---------------------------------------------------------------------------
// MATERIAL
// ---------------------------------------------------------------------------

/**
 * Lo que hay que presentar. Todo es texto/JSON portable: se puede armar con el
 * contenido que tiene el titular (`/me/credentials/:id`) y los campos publicos
 * de `GET /verify/credentials/:id`.
 */
export interface IndependentVerificationMaterial {
  readonly schema: 'scope-independent-verification-material-v1';
  readonly credential: {
    readonly credentialId: string;
    readonly type: string;
    readonly title: string;
    readonly description: string | null;
    /** Horas tal como las emitio la credencial (numero o texto decimal). */
    readonly hours: number | string | null;
    /** ISO-8601 del `issued_at` emitido. */
    readonly issuedAt: string;
    readonly credentialSubject: Record<string, unknown>;
    readonly issuerDid: string;
    readonly subjectDid: string;
  };
  readonly canonicalHash: string;
  readonly proof: Record<string, unknown>;
  readonly chain?: {
    readonly network: string;
    readonly chainId: number;
    readonly contractAddress: string;
    /** Cuenta que, segun el material, registro el hash. */
    readonly registrantAddress: string;
    readonly deploymentId?: string;
  };
}

export type CheckStatus = 'PASS' | 'FAIL' | 'SKIPPED';

export interface IndependentCheck {
  readonly id: string;
  readonly status: CheckStatus;
  readonly detail: string;
}

export type IndependentVerdict =
  | 'VERIFIED'
  | 'VERIFIED_AUTHORSHIP_ONLY'
  | 'INVALID'
  | 'INDETERMINATE'
  | 'REVOKED_ON_CHAIN'
  | 'CHAIN_MISMATCH';

export interface IndependentVerificationReport {
  readonly verdict: IndependentVerdict;
  readonly checks: readonly IndependentCheck[];
  readonly recomputedCanonicalHash: string | null;
}

export class MaterialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MaterialError';
  }
}

// ---------------------------------------------------------------------------
// NUCLEO (testeable: sin red ni disco)
// ---------------------------------------------------------------------------

export interface IndependentVerificationDependencies {
  /** DID Document del emisor (ya obtenido). */
  readonly didDocument: unknown;
  /** Lector del contrato. `null` = no se entrego RPC: la cadena se omite. */
  readonly registryReader: CredentialRegistryTargetBoundReader | null;
  /** RPC en tiempo de ejecucion. Nunca se imprime. */
  readonly rpcUrl?: string;
}

export async function verifyCredentialIndependently(
  rawMaterial: unknown,
  dependencies: IndependentVerificationDependencies
): Promise<IndependentVerificationReport> {
  const material = parseMaterial(rawMaterial);
  const checks: IndependentCheck[] = [];

  const issuerId = issuerIdFromDid(material.credential.issuerDid);
  if (issuerId === null) {
    throw new MaterialError('issuerDid no es un did:web de issuer de Scope.');
  }

  // DID Document: el verificador espera un resolver; se le entrega el documento
  // obtenido por la fuente publica, sin base de datos.
  const didResolver = {
    async resolveForIssuer() {
      return { kind: 'resolved', document: dependencies.didDocument };
    }
  } as unknown as IssuerDidDocumentResolver;

  const hashing = new CredentialHashingService();
  const verifier = new CredentialAuthenticityVerifier(hashing, didResolver);

  const authenticity = await verifier.verify({
    credentialId: material.credential.credentialId,
    schemaVersion: 'credential_v2',
    canonicalizationVersion: 'canon_v2',
    canonicalHash: material.canonicalHash,
    proof: material.proof,
    type: material.credential.type,
    title: material.credential.title,
    description: material.credential.description,
    issuedAt: new Date(material.credential.issuedAt),
    hours: toDecimalLike(material.credential.hours),
    credentialSubject: material.credential.credentialSubject,
    issuerId,
    issuerTechnicalDid: material.credential.issuerDid,
    subjectDid: material.credential.subjectDid
  });

  // 1-2: reconstruccion y comparacion del hash canonico.
  const recomputed = authenticity.recomputedCanonicalHash;
  const hashFailed = authenticity.reason === 'CANONICAL_HASH_MISMATCH' ||
    authenticity.reason === 'CANONICAL_PAYLOAD_UNREPRODUCIBLE';
  checks.push(
    hashFailed
      ? {
          id: 'canonical_hash_recomputed_matches',
          status: 'FAIL',
          detail: authenticity.reason
        }
      : recomputed !== null
        ? {
            id: 'canonical_hash_recomputed_matches',
            status: 'PASS',
            detail: 'canon_v2 reconstruido desde el contenido == canonicalHash declarado'
          }
        : {
            id: 'canonical_hash_recomputed_matches',
            status: 'SKIPPED',
            detail: `no se llego al recalculo (${authenticity.reason})`
          }
  );

  // 3-4: firma y autorizacion en el DID Document.
  checks.push({
    id: 'proof_signature_and_did_authorization',
    status:
      authenticity.authenticity === 'VERIFIED'
        ? 'PASS'
        : authenticity.authenticity === 'INVALID'
          ? 'FAIL'
          : 'SKIPPED',
    detail: authenticity.reason
  });

  // 5-6: cadena.
  let chainOutcome: ChainOutcome = { verdictImpact: 'none' };
  if (material.chain === undefined) {
    checks.push({
      id: 'chain_registration',
      status: 'SKIPPED',
      detail: 'el material no declara datos de cadena'
    });
  } else if (dependencies.registryReader === null) {
    checks.push({
      id: 'chain_registration',
      status: 'SKIPPED',
      detail: 'no se entrego un endpoint RPC (CREDENTIAL_REGISTRY_RPC_URL)'
    });
  } else if (authenticity.authenticity === 'INVALID' || recomputed === null) {
    checks.push({
      id: 'chain_registration',
      status: 'SKIPPED',
      detail: 'no se consulta la cadena por un hash que no reproduce'
    });
  } else {
    chainOutcome = await checkChain(
      material,
      recomputed,
      dependencies.registryReader,
      dependencies.rpcUrl,
      checks
    );
  }

  return {
    verdict: deriveVerdict(authenticity.authenticity, chainOutcome),
    checks,
    recomputedCanonicalHash: recomputed
  };
}

type ChainOutcome =
  | { verdictImpact: 'none' }
  | { verdictImpact: 'registered' }
  | { verdictImpact: 'revoked' }
  | { verdictImpact: 'mismatch' }
  | { verdictImpact: 'unavailable' };

async function checkChain(
  material: IndependentVerificationMaterial,
  recomputedHash: string,
  reader: CredentialRegistryTargetBoundReader,
  rpcUrl: string | undefined,
  checks: IndependentCheck[]
): Promise<ChainOutcome> {
  const chain = material.chain!;

  if (
    !isCredentialRegistryNetwork(chain.network) ||
    chain.chainId !== chainIdForCredentialRegistryNetwork(chain.network)
  ) {
    checks.push({
      id: 'chain_registration',
      status: 'FAIL',
      detail: 'red/chainId del material no corresponden a una red soportada'
    });
    return { verdictImpact: 'mismatch' };
  }

  if (typeof rpcUrl !== 'string' || rpcUrl.length === 0) {
    checks.push({
      id: 'chain_registration',
      status: 'SKIPPED',
      detail: 'sin endpoint RPC'
    });
    return { verdictImpact: 'none' };
  }

  let result: RecordBoundCredentialRegistryReadResult;
  try {
    result = await reader.readTargetBoundCredentialState({
      target: {
        evidenceMode: 'credential_registry',
        network: chain.network,
        chainId: chain.chainId,
        rpcUrl,
        contractAddress: getAddress(chain.contractAddress),
        // Identificador opaco: la lectura no lo usa para decidir.
        deploymentId: chain.deploymentId ?? 'independent-verification'
      },
      credentialHash: recomputedHash,
      expectedRegistrant: chain.registrantAddress
    });
  } catch {
    checks.push({
      id: 'chain_registration',
      status: 'SKIPPED',
      detail: 'la lectura de la cadena fallo (sin detalle del proveedor)'
    });
    return { verdictImpact: 'unavailable' };
  }

  switch (result.kind) {
    case 'credential_state':
      if (result.status.revoked) {
        checks.push({
          id: 'chain_registration',
          status: 'PASS',
          detail:
            'registrado on-chain por la cuenta declarada, y REVOCADO on-chain'
        });
        return { verdictImpact: 'revoked' };
      }
      checks.push({
        id: 'chain_registration',
        status: 'PASS',
        detail: 'registrado on-chain por la cuenta declarada, no revocado'
      });
      return { verdictImpact: 'registered' };

    case 'credential_missing':
      checks.push({
        id: 'chain_registration',
        status: 'FAIL',
        detail: 'el contrato no tiene registrado este hash'
      });
      return { verdictImpact: 'mismatch' };

    case 'credential_issuer_mismatch':
      checks.push({
        id: 'chain_registration',
        status: 'FAIL',
        detail: 'el hash esta registrado por una cuenta distinta de la declarada'
      });
      return { verdictImpact: 'mismatch' };

    case 'rpc_chain_id_mismatch':
    case 'contract_code_missing':
      checks.push({
        id: 'chain_registration',
        status: 'FAIL',
        detail:
          result.kind === 'rpc_chain_id_mismatch'
            ? 'el nodo responde otra cadena que la declarada'
            : 'no hay codigo desplegado en la direccion del contrato declarada'
      });
      return { verdictImpact: 'mismatch' };

    case 'record_deployment_mismatch':
    case 'rpc_unavailable':
    case 'registry_read_failed':
      checks.push({
        id: 'chain_registration',
        status: 'SKIPPED',
        detail: 'no se pudo obtener un estado confiable de la cadena'
      });
      return { verdictImpact: 'unavailable' };
  }
}

function deriveVerdict(
  authenticity: 'VERIFIED' | 'INVALID' | 'INDETERMINATE',
  chain: ChainOutcome
): IndependentVerdict {
  if (authenticity === 'INVALID') {
    return 'INVALID';
  }
  if (authenticity === 'INDETERMINATE') {
    return 'INDETERMINATE';
  }

  switch (chain.verdictImpact) {
    case 'registered':
      return 'VERIFIED';
    case 'revoked':
      return 'REVOKED_ON_CHAIN';
    case 'mismatch':
      return 'CHAIN_MISMATCH';
    case 'none':
    case 'unavailable':
      return 'VERIFIED_AUTHORSHIP_ONLY';
  }
}

// ---------------------------------------------------------------------------
// ENTRADA
// ---------------------------------------------------------------------------

function parseMaterial(raw: unknown): IndependentVerificationMaterial {
  if (!isObject(raw) || raw.schema !== 'scope-independent-verification-material-v1') {
    throw new MaterialError('schema debe ser scope-independent-verification-material-v1.');
  }

  const credential = raw.credential;
  if (!isObject(credential)) {
    throw new MaterialError('Falta credential.');
  }

  for (const key of ['credentialId', 'type', 'title', 'issuedAt', 'issuerDid', 'subjectDid']) {
    if (typeof credential[key] !== 'string' || (credential[key] as string).length === 0) {
      throw new MaterialError(`credential.${key} debe ser texto.`);
    }
  }

  if (Number.isNaN(new Date(credential.issuedAt as string).getTime())) {
    throw new MaterialError('credential.issuedAt no es una fecha valida.');
  }

  if (!isObject(credential.credentialSubject)) {
    throw new MaterialError('credential.credentialSubject debe ser un objeto.');
  }

  if (typeof raw.canonicalHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(raw.canonicalHash)) {
    throw new MaterialError('canonicalHash debe ser 0x + 64 hex.');
  }

  if (!isObject(raw.proof)) {
    throw new MaterialError('Falta proof.');
  }

  const chain = raw.chain;
  if (chain !== undefined) {
    if (
      !isObject(chain) ||
      typeof chain.network !== 'string' ||
      typeof chain.chainId !== 'number' ||
      typeof chain.contractAddress !== 'string' ||
      !isAddress(chain.contractAddress) ||
      typeof chain.registrantAddress !== 'string' ||
      !isAddress(chain.registrantAddress)
    ) {
      throw new MaterialError('chain debe traer network, chainId, contractAddress y registrantAddress validos.');
    }
  }

  return raw as unknown as IndependentVerificationMaterial;
}

function issuerIdFromDid(did: string): string | null {
  const match = /:did:issuers:([0-9a-fA-F-]{36})$/.exec(did);
  if (!match) {
    return null;
  }

  return issuerDidDocumentUrl(did, match[1]) === null ? null : match[1];
}

function toDecimalLike(value: number | string | null) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new MaterialError('credential.hours no es numerico.');
  }

  return {
    toFixed: (digits?: number) => numeric.toFixed(digits),
    toString: () => String(numeric)
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArguments {
  readonly materialPath: string;
  readonly didDocumentPath: string | null;
  readonly fetchDid: boolean;
}

function parseArguments(argv: readonly string[]): CliArguments {
  const read = (flag: string) => {
    const index = argv.indexOf(flag);
    if (index === -1) {
      return null;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new MaterialError(`Falta el valor de ${flag}.`);
    }
    return value;
  };

  const materialPath = read('--material');
  if (!materialPath) {
    throw new MaterialError('Falta --material <archivo.json>.');
  }

  return {
    materialPath,
    didDocumentPath: read('--did-document'),
    fetchDid: argv.includes('--fetch-did')
  };
}

async function loadDidDocument(args: CliArguments, issuerDid: string): Promise<unknown> {
  if (args.didDocumentPath) {
    return JSON.parse(readFileSync(args.didDocumentPath, 'utf8'));
  }

  if (!args.fetchDid) {
    throw new MaterialError('Indica --did-document <archivo> o --fetch-did.');
  }

  const issuerId = issuerIdFromDid(issuerDid);
  const url = issuerId ? issuerDidDocumentUrl(issuerDid, issuerId) : null;
  if (!url) {
    throw new MaterialError('No se pudo derivar la URL publica del DID Document.');
  }

  const response = await fetch(url, {
    headers: { accept: 'application/did+ld+json, application/json' },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new MaterialError(`El DID Document no esta disponible (HTTP ${response.status}).`);
  }

  return response.json();
}

export async function main(argv: readonly string[] = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const material = JSON.parse(readFileSync(args.materialPath, 'utf8')) as unknown;
  const parsed = parseMaterial(material);
  const didDocument = await loadDidDocument(args, parsed.credential.issuerDid);

  const rpcUrl = process.env.CREDENTIAL_REGISTRY_RPC_URL?.trim() || undefined;
  const report = await verifyCredentialIndependently(material, {
    didDocument,
    registryReader: rpcUrl ? new CredentialRegistryReadClient() : null,
    rpcUrl
  });

  // Nunca se imprime el RPC ni el material completo: solo el informe.
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.verdict === 'VERIFIED' ? 0 : 1;
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    console.error(
      error instanceof MaterialError ? error.message : 'La verificacion independiente fallo.'
    );
    process.exitCode = 2;
  });
}

import { randomBytes } from 'node:crypto';

import { SigningKey, computeAddress } from 'ethers';

import {
  type GeneratedSignerMaterial,
  type SignerMaterialGenerator
} from '../technical-identity-provisioning.service';

/**
 * Generador de claves secp256k1 -- S8c9. SOLO herramienta de operacion.
 *
 * Escalar crudo de 32 bytes de CSPRNG. Sin mnemonic, sin HD wallet, sin
 * derivacion, sin semilla configurable. Se rechazan 0 y valores >= n.
 */
const SECP256K1_ORDER = BigInt(
  '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'
);

export function materialFromScalar(scalarHex: string): GeneratedSignerMaterial {
  const scalar = BigInt(scalarHex);
  if (scalar <= 0n || scalar >= SECP256K1_ORDER) {
    throw new Error('Escalar fuera de rango.');
  }

  const key = new SigningKey(scalarHex);
  const uncompressed = key.publicKey.toLowerCase();

  return {
    privateKey: scalarHex,
    address: computeAddress(key.publicKey),
    publicKeyX: `0x${uncompressed.slice(4, 68)}`,
    publicKeyY: `0x${uncompressed.slice(68, 132)}`,
    publicKeyCompressed: key.compressedPublicKey.toLowerCase()
  };
}

export class CsprngSignerMaterialGenerator implements SignerMaterialGenerator {
  constructor(private readonly random: (size: number) => Buffer = randomBytes) {}

  generate(): GeneratedSignerMaterial {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const bytes = this.random(32);
      if (bytes.length !== 32) {
        break;
      }
      const scalar = BigInt(`0x${bytes.toString('hex')}`);
      if (scalar > 0n && scalar < SECP256K1_ORDER) {
        return materialFromScalar(`0x${bytes.toString('hex')}`);
      }
    }
    throw new Error('No se pudo generar un escalar valido.');
  }
}

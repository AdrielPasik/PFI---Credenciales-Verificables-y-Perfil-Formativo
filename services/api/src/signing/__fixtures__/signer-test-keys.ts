/**
 * CLAVES PUBLICAS DE PRUEBA -- NO FINANCIAR -- NO USAR EN NINGUNA RED.
 *
 * Son los escalares secp256k1 1 y 2: los valores mas publicos que existen para
 * esta curva, reproducibles desde cualquier implementacion y documentados en
 * cualquier referencia. NO son secretos.
 *
 * El escalar 1 es exactamente el fixture congelado en S8b.1, asi que la
 * resolucion de S8c2 queda encadenada al contrato criptografico ya congelado:
 * si la direccion o el material publico derivados cambiaran, ambos slices
 * fallarian a la vez.
 *
 * Deliberadamente NO se usa la cuenta de dev de Anvil que aparece en
 * `contracts/ANVIL_LOCAL_TESTING.md`, ni ninguna clave de demo, de produccion
 * o del autor del proyecto.
 */

export interface PublicTestKey {
  readonly privateKey: string;
  /** Checksum EIP-55, tal como lo devuelve ethers. */
  readonly address: string;
  /** Representacion persistida en `SignerProfile.address` (minuscula). */
  readonly addressLowercase: string;
  readonly publicKeyX: string;
  readonly publicKeyY: string;
  readonly publicKeyCompressed: string;
}

/** secp256k1 escalar 1. Su clave publica es el generador G. */
export const PUBLIC_TEST_KEY_ONE: PublicTestKey = {
  privateKey:
    '0x0000000000000000000000000000000000000000000000000000000000000001',
  address: '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
  addressLowercase: '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf',
  publicKeyX:
    '0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
  publicKeyY:
    '0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8',
  publicKeyCompressed:
    '0x0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
};

/** secp256k1 escalar 2. */
export const PUBLIC_TEST_KEY_TWO: PublicTestKey = {
  privateKey:
    '0x0000000000000000000000000000000000000000000000000000000000000002',
  address: '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF',
  addressLowercase: '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf',
  publicKeyX:
    '0xc6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
  publicKeyY:
    '0x1ae168fea63dc339a3c58419466ceaeef7f632653266d0e1236431a950cfe52a',
  publicKeyCompressed:
    '0x02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5'
};

/** Orden del grupo secp256k1. Ningun escalar valido puede alcanzarlo. */
export const SECP256K1_GROUP_ORDER =
  '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141';

export const ZERO_PRIVATE_KEY = `0x${'0'.repeat(64)}`;

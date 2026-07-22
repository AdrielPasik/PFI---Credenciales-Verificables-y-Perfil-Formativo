import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from 'node:crypto';

const ALGORITHM = 'scrypt';
const VERSION = 'v1';
const KEY_LENGTH = 64;
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const SALT_LENGTH = 16;

export async function hashPassword(password: string): Promise<string> {
  assertPasswordInput(password);

  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = await scryptWithParams(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION
  });

  return [
    ALGORITHM,
    VERSION,
    String(COST),
    String(BLOCK_SIZE),
    String(PARALLELIZATION),
    salt.toString('hex'),
    derivedKey.toString('hex')
  ].join(':');
}

export async function verifyPasswordHash(
  password: string,
  persistedHash: string
): Promise<boolean> {
  assertPasswordInput(password);
  const parsedHash = parsePersistedHash(persistedHash);

  const recalculatedKey = await scryptWithParams(
    password,
    parsedHash.salt,
    parsedHash.hash.length,
    {
      N: parsedHash.cost,
      r: parsedHash.blockSize,
      p: parsedHash.parallelization
    }
  );

  if (recalculatedKey.length !== parsedHash.hash.length) {
    return false;
  }

  return timingSafeEqual(recalculatedKey, parsedHash.hash);
}

function parsePersistedHash(persistedHash: string) {
  if (typeof persistedHash !== 'string' || persistedHash.trim().length === 0) {
    throw new Error('passwordHash persistido invalido.');
  }

  const [
    algorithm,
    version,
    costRaw,
    blockSizeRaw,
    parallelizationRaw,
    saltHex,
    hashHex
  ] = persistedHash.split(':');

  if (algorithm !== ALGORITHM || version !== VERSION) {
    throw new Error('Formato de passwordHash no soportado.');
  }

  const cost = Number.parseInt(costRaw ?? '', 10);
  const blockSize = Number.parseInt(blockSizeRaw ?? '', 10);
  const parallelization = Number.parseInt(parallelizationRaw ?? '', 10);

  if (
    !Number.isInteger(cost) ||
    !Number.isInteger(blockSize) ||
    !Number.isInteger(parallelization)
  ) {
    throw new Error('Parametros de passwordHash invalidos.');
  }

  if (!isHexString(saltHex) || !isHexString(hashHex)) {
    throw new Error('Salt o hash persistido invalido.');
  }

  return {
    cost,
    blockSize,
    parallelization,
    salt: Buffer.from(saltHex, 'hex'),
    hash: Buffer.from(hashHex, 'hex')
  };
}

function assertPasswordInput(password: string) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('password es requerido.');
  }
}

function isHexString(value: string | undefined) {
  return typeof value === 'string' && /^[0-9a-f]+$/i.test(value) && value.length > 0;
}

function scryptWithParams(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: {
    N: number;
    r: number;
    p: number;
  }
) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey as Buffer);
    });
  });
}

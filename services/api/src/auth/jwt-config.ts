import { InternalServerErrorException } from '@nestjs/common';

export function getJwtSecretOrThrow() {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret) {
    throw new InternalServerErrorException('JWT_SECRET no esta configurado.');
  }

  return secret;
}

export function getJwtExpiresIn() {
  const expiresIn = process.env.JWT_EXPIRES_IN?.trim();
  return expiresIn && expiresIn.length > 0 ? expiresIn : '1h';
}

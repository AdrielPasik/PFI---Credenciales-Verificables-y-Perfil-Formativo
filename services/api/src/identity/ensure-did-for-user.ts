import { NotFoundException } from '@nestjs/common';
import { type Prisma } from '@prisma/client';

import { resolveDidConfig } from '../config/did-config';
import { type PrismaService } from '../prisma/prisma.service';
import { buildDidForUser } from './did-web';

// A2.1: unica implementacion de provisioning -- llamada tanto desde
// AuthService.register (dentro de su transaccion) como desde
// CredentialsService.issueCredential (fuera de transaccion, antes de
// calcular el hash canonico). Deliberadamente una funcion simple, no una
// clase inyectable: mismo patron que hashPassword/getJwtSecretOrThrow/
// buildHolderDisplayLabel en este repo -- evita acoplar AuthService y
// CredentialsService a un provider nuevo solo para esto.
//
// Invariante: User.did es write-once. Si ya existe, se devuelve tal cual,
// SIN recalcular ni comparar contra la config actual (un cambio de
// PUBLIC_DID_BASE_URL nunca reescribe un DID ya persistido). Si no existe
// y hay configuracion valida, se persiste de forma segura ante
// concurrencia: el UPDATE es condicional (`where: { did: null }`); si dos
// llamadas concurrentes compiten por el mismo usuario, como el DID es una
// funcion deterministica de userId+config, ambas calculan el mismo valor
// candidato, pero solo una gana el UPDATE -- la otra relee el valor
// realmente persistido (nunca sobreescribe, nunca produce dos DIDs).
export async function ensureDidForUser(
  client: PrismaService | Prisma.TransactionClient,
  userId: string
): Promise<string | null> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { did: true }
  });

  if (!user) {
    throw new NotFoundException(`Usuario ${userId} no existe.`);
  }

  if (user.did) {
    return user.did;
  }

  const config = resolveDidConfig();

  if (!config) {
    return null;
  }

  const candidateDid = buildDidForUser(config, userId);

  const updateResult = await client.user.updateMany({
    where: { id: userId, did: null },
    data: { did: candidateDid }
  });

  if (updateResult.count === 1) {
    return candidateDid;
  }

  // Perdimos la carrera: otra llamada concurrente ya provisiono (con este
  // mismo valor deterministico, o con uno de otro host si la config
  // cambio a mitad de camino). User.did es la autoridad -- releemos en vez
  // de asumir que nuestro candidato es el que quedo persistido.
  const reloaded = await client.user.findUnique({
    where: { id: userId },
    select: { did: true }
  });

  return reloaded?.did ?? null;
}

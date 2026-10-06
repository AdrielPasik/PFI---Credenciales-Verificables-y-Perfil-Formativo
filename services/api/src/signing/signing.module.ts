import { Module } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { IssuerSignerResolver } from './issuer-signer-resolver';
import { createSignerSecretStoreFromEnv } from './signer-secret-store.factory';
import {
  SIGNER_SECRET_STORE,
  type SignerSecretStore
} from './signer-secret-store.port';

/**
 * Modulo de custodia y resolucion de signers -- S8c2.
 *
 * CAMINO NUEVO, TODAVIA NO ACTIVO. Registrarlo es seguro porque:
 *
 *   - construir el cliente de SSM no hace ninguna llamada de red ni resuelve
 *     credenciales (ver `signer-secret-store.factory.ts`);
 *   - no hay ningun `onModuleInit` ni trabajo de arranque;
 *   - ningun flujo existente inyecta `IssuerSignerResolver`, asi que nada
 *     invoca `resolve*` y por lo tanto no se lee ningun secreto.
 *
 * La recuperacion del secreto es PEREZOSA: ocurre unicamente cuando alguien
 * llama explicitamente a un metodo `resolve*`.
 *
 * El camino LEGACY de blockchain (`CREDENTIAL_REGISTRY_PRIVATE_KEY` dentro de
 * `src/blockchain/`) sigue intacto y sigue siendo el que usa la emision y la
 * revocacion actuales. El reemplazo se activa en la slice de cutover, no aca.
 */
@Module({
  providers: [
    {
      provide: SIGNER_SECRET_STORE,
      useFactory: () => createSignerSecretStoreFromEnv(process.env)
    },
    {
      provide: IssuerSignerResolver,
      useFactory: (prisma: PrismaService, secretStore: SignerSecretStore) =>
        new IssuerSignerResolver(prisma, secretStore),
      inject: [PrismaService, SIGNER_SECRET_STORE]
    }
  ],
  exports: [IssuerSignerResolver, SIGNER_SECRET_STORE]
})
export class SigningModule {}

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
 * S8c8 completo el cutover: ni la emision ni la revocacion firman ya con la
 * clave global de entorno. El cliente legacy de `src/blockchain/` sigue
 * existiendo, pero su unico usuario es la herramienta de operacion por linea de
 * comandos; ningun servicio, controller ni factory de modulo lo instancia para
 * firmar. La limpieza final de ese tooling es S8c10.
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

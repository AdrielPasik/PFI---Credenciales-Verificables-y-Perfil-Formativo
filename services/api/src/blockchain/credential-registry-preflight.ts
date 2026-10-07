import { Injectable } from '@nestjs/common';
import { FetchRequest, JsonRpcProvider } from 'ethers';

import {
  BlockchainTargetError,
  type CredentialRegistryTarget
} from './blockchain-target';

/**
 * Provider y preflight PREVIO A CADA ESCRITURA -- S8c5.
 *
 * ---------------------------------------------------------------------------
 * QUE PRUEBA EL PREFLIGHT
 * ---------------------------------------------------------------------------
 *
 *   1. el provider esta en la cadena ESPERADA (`getNetwork`);
 *   2. hay bytecode desplegado en la direccion configurada (`getCode`).
 *
 * Eso es todo lo que prueba. En particular (1)+(2) NO prueban que lo que esta
 * desplegado sea la implementacion CredentialRegistry que esperamos: solo que
 * algo hay. La identidad exacta del deployment pertenece al manifest de S8c10.
 *
 * ---------------------------------------------------------------------------
 * CUANDO CORRE
 * ---------------------------------------------------------------------------
 *
 * Inmediatamente ANTES de cada escritura real, nunca en el arranque. La
 * resolucion de configuracion del arranque es puramente LOCAL: no toca la red.
 *
 * Y corre en CADA escritura, sin cache. Una "salud de red" cacheada 15 minutos
 * significaria escribir contra una cadena equivocada o contra una direccion sin
 * contrato durante esos 15 minutos. (La cache de signers de S8c2 es otra cosa:
 * ahorra una lectura de secreto, no una comprobacion de red.)
 *
 * ---------------------------------------------------------------------------
 * SEGURIDAD
 * ---------------------------------------------------------------------------
 *
 * Los errores del provider NO se propagan. Un error de ethers puede arrastrar
 * la URL completa del RPC -- con la API key dentro -- en su mensaje, en su
 * `cause`, en `info` o en la request serializada. Aca se reducen a un error
 * tipado con mensaje fijo, conservando a lo sumo el NOMBRE de la clase del
 * error original. Nada de `cause`: la infraestructura de logging de Nest la
 * serializaria.
 */

/** Timeout de request del RPC, elegido en S8b. Se ajusta con evidencia live. */
export const CREDENTIAL_REGISTRY_RPC_TIMEOUT_MS = 10_000;

/**
 * Lo MINIMO que el preflight necesita de un provider. Los tests inyectan un
 * doble que implementa solo esto: ningun test instancia un JsonRpcProvider y
 * por lo tanto ningun test puede escapar a la red.
 */
export interface CredentialRegistryPreflightProvider {
  getNetwork(): Promise<{ chainId: bigint }>;
  getCode(address: string): Promise<string>;
}

/**
 * Bytecode desplegado: `0x` mas al menos UN byte COMPLETO.
 *
 * Cada byte son exactamente dos caracteres hex, asi que la cantidad de hex
 * despues de `0x` tiene que ser PAR. `0xabc` no es una cadena de bytes: es un
 * valor truncado o corrupto, y aceptarlo seria tratar una respuesta malformada
 * como prueba de deployment.
 *
 * Deliberadamente NO se exige un tamano minimo mas alla de un byte, ni ninguna
 * forma concreta: el preflight prueba UNICAMENTE que hay bytes de codigo en la
 * direccion, no que ese codigo sea el CredentialRegistry esperado. Rechazar
 * bytecode valido por ser chico o inusual seria afirmar una identidad de
 * deployment que esta slice no verifica -- eso es S8c10.
 */
const DEPLOYED_CODE_PATTERN = /^0x(?:[0-9a-fA-F]{2})+$/;

/**
 * UNICA construccion de provider en produccion.
 *
 * Solo se puede llamar con un target `credential_registry`: la union
 * discriminada de `BlockchainTarget` hace que un target mock no compile aca, asi
 * que es imposible construir un provider en modo mock.
 *
 * Vendor-neutral a proposito: `JsonRpcProvider` sobre un endpoint HTTP, sin
 * AlchemyProvider, InfuraProvider, WebSocketProvider ni FallbackProvider.
 */
export function createCredentialRegistryProvider(
  target: CredentialRegistryTarget
): JsonRpcProvider {
  const request = new FetchRequest(target.rpcUrl);
  request.timeout = CREDENTIAL_REGISTRY_RPC_TIMEOUT_MS;

  // Se pasa SOLO la request. Fijar `staticNetwork` haria que `getNetwork()`
  // devolviera la red configurada sin preguntarle al nodo, lo que vaciaria de
  // sentido la comprobacion de cadena del preflight.
  return new JsonRpcProvider(request);
}

@Injectable()
export class CredentialRegistryPreflight {
  /**
   * Valida que el target sea escribible AHORA. Lanza `BlockchainTargetError` si
   * no lo es; no devuelve nada cuando pasa.
   *
   * ORDEN DELIBERADO:
   *
   *   getNetwork -> comparar cadena -> getCode -> verificar codigo
   *
   * Si la cadena no coincide NO se llama a `getCode`: preguntar por el codigo
   * de una direccion en la cadena equivocada no informa nada y, peor, podria
   * encontrar un contrato distinto en la misma direccion de otra cadena.
   */
  async assertWritable(
    target: CredentialRegistryTarget,
    injectedProvider?: CredentialRegistryPreflightProvider
  ): Promise<void> {
    const provider =
      injectedProvider ?? createCredentialRegistryProvider(target);

    let observedChainId: bigint;
    try {
      observedChainId = (await provider.getNetwork()).chainId;
    } catch (error) {
      throw new BlockchainTargetError('BLOCKCHAIN_RPC_UNAVAILABLE', {
        providerErrorName: errorName(error)
      });
    }

    if (observedChainId !== BigInt(target.chainId)) {
      // El chainId observado NO viaja en el error: es dato de red, el mensaje
      // es fijo, y el operador ya tiene el `field`/`code` para actuar.
      throw new BlockchainTargetError('BLOCKCHAIN_NETWORK_MISMATCH');
    }

    let code: string;
    try {
      code = await provider.getCode(target.contractAddress);
    } catch (error) {
      throw new BlockchainTargetError('BLOCKCHAIN_RPC_UNAVAILABLE', {
        providerErrorName: errorName(error)
      });
    }

    // `0x` es la respuesta de una direccion sin contrato. Una respuesta vacia,
    // nula o no hexadecimal tampoco prueba un deployment: falla cerrado.
    if (typeof code !== 'string' || !DEPLOYED_CODE_PATTERN.test(code)) {
      throw new BlockchainTargetError('BLOCKCHAIN_CONTRACT_MISSING');
    }
  }
}

/**
 * SOLO el nombre de la clase del error. Nunca `error.message`, nunca
 * `String(error)`, nunca `JSON.stringify(error)`: cualquiera de los tres puede
 * contener la URL del RPC con su credencial.
 */
function errorName(error: unknown): string | undefined {
  if (error instanceof Error && typeof error.name === 'string') {
    return error.name;
  }

  return undefined;
}

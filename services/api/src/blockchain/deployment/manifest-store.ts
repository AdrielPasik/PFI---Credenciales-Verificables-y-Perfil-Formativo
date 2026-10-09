import { randomBytes } from 'node:crypto';
import { access, link, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { CANONICAL_DEPLOYMENT_ID_PREFIX } from './deployment-id';
import {
  type DeploymentManifest,
  serializeDeploymentManifest,
  validateDeploymentManifest
} from './deployment-manifest';

/**
 * Almacen de manifests: APPEND-ONLY y PUBLICACION ATOMICA -- S8c10.1.
 *
 * ---------------------------------------------------------------------------
 * INVARIANTES
 * ---------------------------------------------------------------------------
 *
 *   1. La ruta FINAL `<deploymentId>.json` NUNCA es visible parcialmente escrita.
 *   2. Un manifest final existente NUNCA se sobrescribe.
 *
 * ---------------------------------------------------------------------------
 * POR QUE NO `writeFile(final, 'wx')`
 * ---------------------------------------------------------------------------
 *
 * `wx` impide sobrescribir, pero CREA la ruta final al abrir y escribe despues:
 * un crash, un disco lleno o un corte entre la creacion y el ultimo byte deja un
 * `<deploymentId>.json` parcial (o vacio) en el nombre final. Peor: como el
 * archivo ya existe, el reintento seguro fallaria con "ya existe" y el manifest
 * valido nunca podria publicarse. Eso viola el invariante 1.
 *
 * ---------------------------------------------------------------------------
 * LA PUBLICACION
 * ---------------------------------------------------------------------------
 *
 *   1. serializar y VALIDAR el manifest completo en memoria;
 *   2. escribir los bytes COMPLETOS a un temporal en el MISMO directorio (mismo
 *      filesystem), creado-exclusivo (`wx`) con un nombre aleatorio que nunca es
 *      un nombre final;
 *   3. `fsync` y cerrar el temporal ANTES de publicar;
 *   4. publicar con `link(temporal, final)`;
 *   5. borrar el temporal (mejor esfuerzo).
 *
 * `link` (enlace duro) es la primitiva elegida porque cumple las DOS cosas a la
 * vez: es atomica (la ruta final aparece de golpe apuntando a un inodo ya
 * completo) y es EXCLUSIVA (falla con `EEXIST` si el destino existe; no
 * reemplaza). `rename` NO sirve: en POSIX reemplaza el destino en silencio y en
 * Windows puede hacerlo tambien segun el caso, asi que no prueba el
 * no-sobrescribir. `copyFile` con COPYFILE_EXCL tampoco: copia progresivamente en
 * el destino y puede dejarlo parcial.
 *
 * Si el filesystem no soporta enlaces duros (`EPERM`, `ENOTSUP`, `EXDEV`...), la
 * publicacion FALLA CERRADO. No hay fallback a `rename` ni a escritura directa:
 * cualquiera de los dos rompe un invariante. Tras publicar, el borrado del
 * temporal es de mejor esfuerzo y SOLO toca la ruta temporal; nunca la final.
 *
 * Un temporal huerfano (`.<id>.<aleatorio>.tmp`) tras un crash es inofensivo: no
 * es un manifest, nadie lo lee, y se puede borrar a mano.
 */

// Derivado del prefijo canonico: ni la red ni el chainId se repiten aca.
const DEPLOYMENT_ID_FILE = new RegExp(`^${CANONICAL_DEPLOYMENT_ID_PREFIX}0x[0-9a-f]{40}$`);

export interface ManifestStore {
  exists(deploymentId: string): Promise<boolean>;
  /** Devuelve la ruta publicada. Lanza si ya existe o si no puede publicar. */
  writeNew(manifest: DeploymentManifest): Promise<string>;
}

export class ManifestStoreError extends Error {
  readonly code: 'MANIFEST_INVALID' | 'MANIFEST_ALREADY_EXISTS' | 'MANIFEST_WRITE_FAILED';

  constructor(code: ManifestStoreError['code']) {
    super(
      code === 'MANIFEST_INVALID'
        ? 'El manifest no es valido y no se escribe.'
        : code === 'MANIFEST_ALREADY_EXISTS'
          ? 'Ya existe un manifest con ese deploymentId. Los manifests son append-only.'
          : 'No se pudo publicar el manifest.'
    );
    this.name = 'ManifestStoreError';
    this.code = code;
  }
}

/**
 * Operaciones de filesystem que usa la publicacion. Existe para poder inyectar
 * fallas deterministas en las pruebas; la implementacion por defecto es el
 * filesystem real.
 */
export interface ManifestFileSystem {
  /** Crea EXCLUSIVAMENTE el temporal, escribe TODO, `fsync` y cierra. */
  writeTemporary(path: string, contents: string): Promise<void>;
  /** Publicacion atomica y exclusiva: falla con EEXIST si `finalPath` existe. */
  publish(temporaryPath: string, finalPath: string): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

export const nodeManifestFileSystem: ManifestFileSystem = {
  async writeTemporary(path, contents) {
    const handle = await open(path, 'wx');
    try {
      await handle.writeFile(contents, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  async publish(temporaryPath, finalPath) {
    await link(temporaryPath, finalPath);
  },
  async remove(path) {
    await unlink(path);
  },
  async exists(path) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
};

export class FileManifestStore implements ManifestStore {
  constructor(
    private readonly directory: string,
    private readonly fileSystem: ManifestFileSystem = nodeManifestFileSystem
  ) {}

  pathFor(deploymentId: string): string {
    if (!DEPLOYMENT_ID_FILE.test(deploymentId)) {
      throw new ManifestStoreError('MANIFEST_INVALID');
    }
    return join(this.directory, `${deploymentId}.json`);
  }

  async exists(deploymentId: string): Promise<boolean> {
    return this.fileSystem.exists(this.pathFor(deploymentId));
  }

  async writeNew(manifest: DeploymentManifest): Promise<string> {
    // 1. Todo en memoria ANTES de tocar el disco.
    if (!validateDeploymentManifest(manifest).ok) {
      throw new ManifestStoreError('MANIFEST_INVALID');
    }
    const contents = serializeDeploymentManifest(manifest);
    const finalPath = this.pathFor(manifest.deploymentId);

    // Un nombre que JAMAS puede coincidir con uno final (empieza con `.`, termina
    // en `.tmp`, lleva 64 bits aleatorios): borrarlo nunca puede tocar un manifest.
    const temporaryPath = join(
      this.directory,
      `.${manifest.deploymentId}.${randomBytes(8).toString('hex')}.tmp`
    );

    // 2-3. Bytes completos al temporal, fsync y cierre.
    try {
      await this.fileSystem.writeTemporary(temporaryPath, contents);
    } catch {
      await this.discard(temporaryPath);
      throw new ManifestStoreError('MANIFEST_WRITE_FAILED');
    }

    // 4. Publicacion atomica y exclusiva.
    try {
      await this.fileSystem.publish(temporaryPath, finalPath);
    } catch (error) {
      await this.discard(temporaryPath);
      throw new ManifestStoreError(
        (error as NodeJS.ErrnoException)?.code === 'EEXIST'
          ? 'MANIFEST_ALREADY_EXISTS'
          : 'MANIFEST_WRITE_FAILED'
      );
    }

    // 5. El manifest YA esta publicado. Un fallo al limpiar el temporal no lo
    // afecta ni se reporta como fallo de publicacion.
    await this.discard(temporaryPath);

    return finalPath;
  }

  /** Mejor esfuerzo, SOLO sobre la ruta temporal. Nunca lanza. */
  private async discard(temporaryPath: string): Promise<void> {
    try {
      await this.fileSystem.remove(temporaryPath);
    } catch {
      // Un temporal huerfano es inofensivo.
    }
  }
}

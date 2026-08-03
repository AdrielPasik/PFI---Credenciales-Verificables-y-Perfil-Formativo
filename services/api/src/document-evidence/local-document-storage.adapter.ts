import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';

import {
  type DetectedDocumentExtension,
  type DetectedDocumentMimeType,
  type DocumentStoragePort,
  type SaveDocumentInput
} from './document-storage.port';

const EXTENSION_MIME_TYPES: Record<
  DetectedDocumentExtension,
  DetectedDocumentMimeType
> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg'
};

const STORAGE_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(pdf|png|jpg)$/i;

export class LocalDocumentStorageAdapter implements DocumentStoragePort {
  private readonly root: string;

  constructor(
    root: string,
    private readonly createId: () => string = randomUUID
  ) {
    this.root = resolve(root);
  }

  async saveDocument(input: SaveDocumentInput) {
    this.assertFormatPair(input.detectedExtension, input.detectedMimeType);

    const storageKey = `${this.createId()}${input.detectedExtension}`;
    const targetPath = this.resolveStorageKey(storageKey);

    await mkdir(this.root, { recursive: true });
    await writeFile(targetPath, input.buffer, { flag: 'wx' });

    return {
      storageProvider: 'local',
      storageKey
    };
  }

  async deleteDocument(storageKey: string): Promise<void> {
    const targetPath = this.resolveStorageKey(storageKey);

    try {
      await unlink(targetPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  private assertFormatPair(
    extension: DetectedDocumentExtension,
    mimeType: DetectedDocumentMimeType
  ) {
    if (EXTENSION_MIME_TYPES[extension] !== mimeType) {
      throw new Error('La extension detectada no coincide con el MIME canonico.');
    }
  }

  private resolveStorageKey(storageKey: string) {
    if (
      !STORAGE_KEY_PATTERN.test(storageKey) ||
      isAbsolute(storageKey) ||
      storageKey.includes('/') ||
      storageKey.includes('\\')
    ) {
      throw new Error('La clave de almacenamiento local no es valida.');
    }

    const targetPath = resolve(this.root, storageKey);
    if (dirname(targetPath) !== this.root) {
      throw new Error('La clave de almacenamiento escapa del directorio local.');
    }

    return targetPath;
  }
}

export function resolveLocalDocumentStorageRoot(configuredRoot?: string) {
  const normalized = configuredRoot?.trim();

  if (normalized) {
    return resolve(normalized);
  }

  return resolve(__dirname, '..', '..', '.local-storage', 'document-evidence');
}

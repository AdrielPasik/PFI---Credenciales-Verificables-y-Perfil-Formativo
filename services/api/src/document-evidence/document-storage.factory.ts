import { S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';

import { DocumentStorageError } from './document-storage.error';
import { type DocumentStoragePort } from './document-storage.port';
import {
  LocalDocumentStorageAdapter,
  resolveLocalDocumentStorageRoot
} from './local-document-storage.adapter';
import { S3DocumentStorageAdapter } from './s3-document-storage.adapter';

export interface DocumentStorageFactoryDependencies {
  createS3Client?: (config: S3ClientConfig) => S3Client;
}

export function createDocumentStorageAdapterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: DocumentStorageFactoryDependencies = {}
): DocumentStoragePort {
  const provider = (env.DOCUMENT_STORAGE_PROVIDER ?? 'local')
    .trim()
    .toLowerCase();

  if (provider === 'local' || provider === '') {
    return new LocalDocumentStorageAdapter(
      resolveLocalDocumentStorageRoot(env.DOCUMENT_STORAGE_LOCAL_ROOT)
    );
  }

  if (provider !== 's3') {
    throw new DocumentStorageError(
      'configuration',
      'DOCUMENT_STORAGE_PROVIDER debe ser local o s3.'
    );
  }

  const region = requireEnv(env, 'AWS_REGION');
  const bucket = requireEnv(env, 'AWS_S3_BUCKET');
  const accessKeyId = requireEnv(env, 'AWS_ACCESS_KEY_ID');
  const secretAccessKey = requireEnv(env, 'AWS_SECRET_ACCESS_KEY');
  const endpoint = resolveOptionalEndpoint(env.AWS_S3_ENDPOINT);
  const forcePathStyle = resolveOptionalBoolean(
    env.AWS_S3_FORCE_PATH_STYLE,
    'AWS_S3_FORCE_PATH_STYLE'
  );
  const createS3Client =
    dependencies.createS3Client ?? ((config) => new S3Client(config));

  const client = createS3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey
    },
    ...(endpoint ? { endpoint } : {}),
    ...(forcePathStyle === undefined ? {} : { forcePathStyle })
  });

  return new S3DocumentStorageAdapter(client, {
    bucket,
    prefix: env.AWS_S3_PREFIX?.trim() || 'document-evidence'
  });
}

function requireEnv(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) {
    throw new DocumentStorageError(
      'configuration',
      `Falta ${name} para DOCUMENT_STORAGE_PROVIDER=s3.`
    );
  }
  return value;
}

function resolveOptionalEndpoint(value: string | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  try {
    const url = new URL(normalized);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('invalid protocol');
    }
    return url.toString();
  } catch {
    throw new DocumentStorageError(
      'configuration',
      'AWS_S3_ENDPOINT debe ser una URL HTTP o HTTPS valida.'
    );
  }
}

function resolveOptionalBoolean(value: string | undefined, name: string) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  throw new DocumentStorageError(
    'configuration',
    `${name} debe ser true o false.`
  );
}


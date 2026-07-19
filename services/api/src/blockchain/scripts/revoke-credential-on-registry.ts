import { CredentialRegistryWriteClient } from '../credential-registry-write-client';

async function main() {
  const { credentialHash } = parseArgs(process.argv.slice(2));
  const client = new CredentialRegistryWriteClient();
  const result = await client.revokeCredential(credentialHash);

  console.log(JSON.stringify(result, null, 2));
}

function parseArgs(argv: string[]) {
  const hashFlagIndex = argv.indexOf('--hash');

  if (hashFlagIndex === -1) {
    throw new Error('Falta el argumento --hash.');
  }

  const credentialHash = argv[hashFlagIndex + 1];

  if (!credentialHash) {
    throw new Error('Falta valor para --hash.');
  }

  return { credentialHash };
}

void main().catch((error: unknown) => {
  console.error('Blockchain registry revoke failed.');
  console.error(getErrorMessage(error));
  process.exitCode = 1;
});

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}


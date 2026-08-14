import { describe, expect, it } from 'vitest';

import { normalizePublicCredentialReference } from './reference-normalization';

describe('normalizePublicCredentialReference', () => {
  it('accepts a direct credential reference', () => {
    expect(normalizePublicCredentialReference('  credential_123-abc ')).toBe('credential_123-abc');
  });

  it('extracts a credential reference from public verifier and wallet URLs', () => {
    expect(normalizePublicCredentialReference('https://traza.example/verify?credential=credential-1')).toBe('credential-1');
    expect(normalizePublicCredentialReference('https://traza.example/wallet/credentials/credential-2')).toBe('credential-2');
  });

  it('rejects canonical hashes, unsafe strings and unrelated URLs', () => {
    expect(normalizePublicCredentialReference(`0x${'a'.repeat(64)}`)).toBeNull();
    expect(normalizePublicCredentialReference('credential with spaces')).toBeNull();
    expect(normalizePublicCredentialReference('https://traza.example/other/credential-3')).toBeNull();
  });
});

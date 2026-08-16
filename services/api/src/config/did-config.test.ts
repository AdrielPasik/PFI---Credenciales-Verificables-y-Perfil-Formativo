import assert from 'node:assert/strict';
import test from 'node:test';

import { InternalServerErrorException } from '@nestjs/common';

import { resolveDidConfig } from './did-config';

function withDidBaseUrl(value: string | undefined, run: () => void) {
  const original = process.env.PUBLIC_DID_BASE_URL;

  if (value === undefined) {
    delete process.env.PUBLIC_DID_BASE_URL;
  } else {
    process.env.PUBLIC_DID_BASE_URL = value;
  }

  try {
    run();
  } finally {
    if (original === undefined) {
      delete process.env.PUBLIC_DID_BASE_URL;
    } else {
      process.env.PUBLIC_DID_BASE_URL = original;
    }
  }
}

test('missing or blank PUBLIC_DID_BASE_URL disables provisioning without inventing a DID', () => {
  for (const value of [undefined, '', '   ']) {
    withDidBaseUrl(value, () => {
      assert.equal(resolveDidConfig(), null);
    });
  }
});

test('valid HTTPS origin resolves to a lowercase host, no port suffix', () => {
  withDidBaseUrl('https://api.traza.example', () => {
    assert.deepEqual(resolveDidConfig(), { host: 'api.traza.example' });
  });
});

test('valid HTTPS origin with uppercase hostname is normalized to lowercase', () => {
  withDidBaseUrl('https://API.Traza.Example', () => {
    assert.deepEqual(resolveDidConfig(), { host: 'api.traza.example' });
  });
});

test('valid HTTPS origin with an explicit port percent-encodes the colon', () => {
  withDidBaseUrl('https://api.traza.example:8443', () => {
    assert.deepEqual(resolveDidConfig(), {
      host: 'api.traza.example%3A8443'
    });
  });
});

test('trailing slash on an otherwise bare origin is accepted', () => {
  withDidBaseUrl('https://api.traza.example/', () => {
    assert.deepEqual(resolveDidConfig(), { host: 'api.traza.example' });
  });
});

test('present but invalid PUBLIC_DID_BASE_URL fails clearly instead of silently disabling provisioning', () => {
  for (const value of [
    'not-a-url',
    'http://api.traza.example',
    'https://user:pass@api.traza.example',
    'https://api.traza.example/some/path',
    'https://api.traza.example?query=1',
    'https://api.traza.example#fragment',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]'
  ]) {
    withDidBaseUrl(value, () => {
      assert.throws(() => resolveDidConfig(), InternalServerErrorException);
    });
  }
});

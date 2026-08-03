import assert from 'node:assert/strict';
import test from 'node:test';

import { TextEvidenceStatus } from '@prisma/client';

import { mapTextEvidenceResponse } from './text-evidence.mapper';

test('text evidence mapper returns only the safe allowlist', () => {
  const record = {
    id: 'text-evidence-1',
    status: TextEvidenceStatus.current,
    label: 'Temario institucional',
    content: 'Contenido\nformativo \ud83e\udde0',
    sha256: 'ABCDEF0123456789'.repeat(4),
    submittedAt: new Date('2026-08-03T12:00:00.000Z'),
    credentialId: 'credential-1',
    submittedByUserId: 'user-1',
    replacedAt: null,
    submittedBy: { passwordHash: 'secret' }
  };

  assert.deepEqual(mapTextEvidenceResponse(record), {
    textEvidenceReference: 'text-evidence-1',
    status: TextEvidenceStatus.current,
    label: 'Temario institucional',
    content: 'Contenido\nformativo \ud83e\udde0',
    characterCount: 21,
    sha256: 'abcdef0123456789'.repeat(4),
    submittedAt: '2026-08-03T12:00:00.000Z'
  });

  const serialized = JSON.stringify(mapTextEvidenceResponse(record));
  for (const field of [
    'credentialId',
    'submittedByUserId',
    'replacedAt',
    'submittedBy',
    'passwordHash'
  ]) {
    assert.equal(serialized.includes(field), false);
  }
});

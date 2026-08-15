import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException } from '@nestjs/common';

import { validateApplyReusableSemanticInterpretationPayload } from './reusable-semantic-interpretation.validator';

const VALID_BODY = {
  templateId: 'template-1',
  approvalRevision: '2026-08-14T10:00:00.000Z'
};

test('accepts a minimal valid body and defaults acknowledgeDestinationDrift to false', () => {
  const result = validateApplyReusableSemanticInterpretationPayload(VALID_BODY);
  assert.deepEqual(result, {
    templateId: 'template-1',
    approvalRevision: '2026-08-14T10:00:00.000Z',
    acknowledgeDestinationDrift: false
  });
});

test('accepts acknowledgeDestinationDrift: true explicitly', () => {
  const result = validateApplyReusableSemanticInterpretationPayload({
    ...VALID_BODY,
    acknowledgeDestinationDrift: true
  });
  assert.equal(result.acknowledgeDestinationDrift, true);
});

test('rejects a non-object body', () => {
  for (const body of [null, undefined, 'string', 42, []]) {
    assert.throws(
      () => validateApplyReusableSemanticInterpretationPayload(body),
      BadRequestException
    );
  }
});

test('rejects a missing or empty templateId', () => {
  assert.throws(
    () =>
      validateApplyReusableSemanticInterpretationPayload({
        ...VALID_BODY,
        templateId: undefined
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      validateApplyReusableSemanticInterpretationPayload({
        ...VALID_BODY,
        templateId: '   '
      }),
    BadRequestException
  );
});

test('rejects a missing or unparseable approvalRevision', () => {
  assert.throws(
    () =>
      validateApplyReusableSemanticInterpretationPayload({
        ...VALID_BODY,
        approvalRevision: undefined
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      validateApplyReusableSemanticInterpretationPayload({
        ...VALID_BODY,
        approvalRevision: 'not-a-date'
      }),
    BadRequestException
  );
});

test('rejects a non-boolean acknowledgeDestinationDrift', () => {
  assert.throws(
    () =>
      validateApplyReusableSemanticInterpretationPayload({
        ...VALID_BODY,
        acknowledgeDestinationDrift: 'true'
      }),
    BadRequestException
  );
});

test('trims templateId', () => {
  const result = validateApplyReusableSemanticInterpretationPayload({
    ...VALID_BODY,
    templateId: '  template-1  '
  });
  assert.equal(result.templateId, 'template-1');
});

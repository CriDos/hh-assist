import { test, assert } from 'vitest';
import { getMethodState, getMethodTitle } from '../../src/panel/store/useTestsStore.ts';
import { MethodData } from '../../src/panel/types/tests.ts';

test('useTestsStore: getMethodState returns correct state', () => {
  assert.equal(getMethodState(undefined), 'unavailable');

  const passedMethod: MethodData = {
    id: 1,
    validity: { state: 'EFFECTIVE', validUntil: '2027-08-18T00:00:00Z' }
  };
  assert.equal(getMethodState(passedMethod), 'passed');

  const availableMethod: MethodData = {
    id: 2,
    availability: { status: 'AVAILABLE' }
  };
  assert.equal(getMethodState(availableMethod), 'available');

  const blockedMethod: MethodData = {
    id: 3,
    availability: { status: 'TEMPORARY_UNAVAILABLE', availableAt: '2026-09-01T00:00:00Z' }
  };
  assert.equal(getMethodState(blockedMethod), 'blocked');
});

test('useTestsStore: getMethodTitle formats clean tooltip without kind duplication', () => {
  const method: MethodData = {
    id: 1,
    validity: { state: 'EFFECTIVE', validUntil: '2027-08-18T00:00:00Z' }
  };
  const title = getMethodTitle('Продвинутый', method);
  assert.match(title, /^Продвинутый · подтверждено до/);
  assert.notMatch(title, /Теория/);
  assert.notMatch(title, /Практика/);

  const plainTitle = getMethodTitle('Базовый', undefined);
  assert.equal(plainTitle, 'Базовый');
});

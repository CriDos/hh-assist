import { test, assert } from 'vitest';
import { isAssessmentUrl } from '../../src/core/page-utils.ts';

test('isAssessmentUrl accepts only https assessments.hh.ru tests/code paths', () => {
  assert.equal(isAssessmentUrl('https://assessment.hh.ru/tests/123'), true);
  assert.equal(isAssessmentUrl('https://assessment.hh.ru/code/230'), true);
  assert.equal(isAssessmentUrl('https://assessment.hh.ru/tests/abc-123?step=1#section'), true);
  assert.equal(isAssessmentUrl('https://assessment.hh.ru/code/task-55?query=true'), true);
});

test('isAssessmentUrl rejects invalid protocols, domains, paths and non-strings', () => {
  assert.equal(isAssessmentUrl('http://assessment.hh.ru/tests/1'), false);
  assert.equal(isAssessmentUrl('ftp://assessment.hh.ru/tests/1'), false);
  assert.equal(isAssessmentUrl('https://assessment.hh.ru/'), false);
  assert.equal(isAssessmentUrl('https://assessment.hh.ru/about'), false);
  assert.equal(isAssessmentUrl('https://assessment.hh.ru/shards/task'), false);
  assert.equal(isAssessmentUrl('https://career.hh.ru/assessment'), false);
  assert.equal(isAssessmentUrl('https://hh.ru/tests/123'), false);
  assert.equal(isAssessmentUrl('https://spb.hh.ru/tests/123'), false);
  assert.equal(isAssessmentUrl('https://evil-assessment.hh.ru/tests/123'), false);
  assert.equal(isAssessmentUrl('not-a-url'), false);
  assert.equal(isAssessmentUrl(''), false);
  assert.equal(isAssessmentUrl(null as any), false);
  assert.equal(isAssessmentUrl(undefined as any), false);
  assert.equal(isAssessmentUrl(12345 as any), false);
  assert.equal(isAssessmentUrl({} as any), false);
});

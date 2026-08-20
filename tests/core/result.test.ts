import { test, assert } from 'vitest';
import { parseResultPage, resultVerdict, scoreText } from '../../src/core/result.ts';

// Completion page (contest_result): the SSR template with double escaping.
const completionHtml = (state: any) =>
  '<template class="SkillsFront-InitialState">' +
  JSON.stringify(state).replaceAll('\\', '\\\\').replaceAll('"', '&quot;') +
  '</template>';

test('parseResultPage: passed test (score + verdict)', () => {
  const html = completionHtml({
    applicantContestResultPage: { contest: { correct: 9, total: 12, passed: true } }
  });
  const res = parseResultPage(html);
  assert.equal(res?.known, true);
  assert.equal(res?.passed, true);
  assert.equal(res?.correct, 9);
  assert.equal(res?.total, 12);
});

test('parseResultPage: failed test (8 из 12)', () => {
  const html = completionHtml({
    applicantContestResultPage: { contest: { correct: 8, total: 12, passed: false } }
  });
  const res = parseResultPage(html);
  assert.equal(res?.known, true);
  assert.equal(res?.passed, false);
  assert.equal(res?.correct, 8);
  assert.equal(res?.total, 12);
});

test('parseResultPage: verdict as string result field', () => {
  const html = completionHtml({
    applicantContestResultPage: { contest: { correct: 10, total: 10, result: 'PASSED' } }
  });
  const res = parseResultPage(html);
  assert.equal(res?.known, true);
  assert.equal(res?.passed, true);
});

test('parseResultPage: contest page structure (score actual/max + SUCCESS status)', () => {
  const html = completionHtml({
    applicantContestResultPage: {
      desktopUiLayout: {
        level: { id: 8, name: 'Базовый' },
        score: { max: 10, actual: 9 },
        contestResultStatus: 'SUCCESS'
      }
    }
  });
  const res = parseResultPage(html);
  assert.equal(res?.known, true);
  assert.equal(res?.passed, true);
  assert.equal(res?.correct, 9);
  assert.equal(res?.total, 10);
  assert.equal(res?.reason, 'SUCCESS');
});

test('parseResultPage: contest page structure (FAILURE, 4 из 10)', () => {
  const html = completionHtml({
    applicantContestResultPage: {
      desktopUiLayout: {
        status: {},
        score: { max: 10, actual: 4 },
        contestResultStatus: 'FAILURE'
      }
    }
  });
  const res = parseResultPage(html);
  assert.equal(res?.known, true);
  assert.equal(res?.passed, false);
  assert.equal(res?.correct, 4);
  assert.equal(res?.total, 10);
  assert.equal(res?.reason, 'FAILURE');
});

test('parseResultPage: FRAUD (antifraud block) — score absent, reason is the status', () => {
  const html = completionHtml({
    applicantContestResultPage: {
      desktopUiLayout: {
        skill: { id: 1114, name: 'Python', category: 'SKILL' },
        level: { id: 8, name: 'Базовый' },
        score: null,
        methodType: 'PRACTICE',
        contestResultStatus: 'FRAUD',
        infoCards: [
          {
            type: 'FRAUD',
            infoCardValue: 'FRAUD',
            additionalProperties: { date: '2026-09-12T00:00:00+03:00' }
          }
        ]
      },
      method: { result: { practice: 'FAILURE', theory: 'AVAILABLE' } }
    }
  });
  const res = parseResultPage(html);
  assert.equal(res?.known, true);
  assert.equal(res?.passed, false);
  assert.equal(res?.correct, null);
  assert.equal(res?.total, null);
  assert.equal(res?.reason, 'FRAUD');
});

test('parseResultPage: null on missing template or absent result node', () => {
  assert.equal(parseResultPage('<html><body></body></html>'), null);
  assert.equal(
    parseResultPage(completionHtml({ applicantContestResultPage: { foo: { bar: 1 } } })),
    null
  );
});

// ---- resultVerdict / scoreText ----------------------------------------------

test('resultVerdict: passed with score', () => {
  const verdict = resultVerdict({ passed: true, correct: 3, total: 3, reason: 'SUCCESS' });
  assert.equal(verdict.status, 'passed');
  assert.equal(verdict.label, 'Навык подтверждён: 3 из 3');
});

test('resultVerdict: failed with score', () => {
  const verdict = resultVerdict({ passed: false, correct: 4, total: 10 });
  assert.equal(verdict.status, 'failed');
  assert.equal(verdict.label, 'Навык не подтверждён: 4 из 10');
});

test('resultVerdict: blocked — no score, reason is the status', () => {
  const verdict = resultVerdict({ passed: false, correct: null, total: null, reason: 'FRAUD' });
  assert.equal(verdict.status, 'blocked');
  assert.equal(verdict.label, 'Навык не подтверждён: FRAUD');
});

test('resultVerdict: SUCCESS reason does not make a passed result blocked', () => {
  const verdict = resultVerdict({ passed: true, correct: 3, total: 3, reason: 'SUCCESS' });
  assert.notEqual(verdict.status, 'blocked');
});

test('resultVerdict: passed without score — plain label', () => {
  const verdict = resultVerdict({ passed: true, correct: null, total: null });
  assert.equal(verdict.status, 'passed');
  assert.equal(verdict.label, 'Навык подтверждён');
});

test('resultVerdict: no-score — passed unknown, score present', () => {
  const verdict = resultVerdict({ passed: null, correct: 5, total: 6 });
  assert.equal(verdict.status, 'no-score');
  assert.equal(verdict.label, 'Результат: 5 из 6');
});

test('resultVerdict: unknown — nothing recognized', () => {
  const verdict = resultVerdict({ passed: null, correct: null, total: null });
  assert.equal(verdict.status, 'unknown');
  assert.equal(verdict.label, 'Результат не распознан');
});

test('scoreText: «N из M» only when both sides are present', () => {
  assert.equal(scoreText({ correct: 3, total: 3 }), '3 из 3');
  assert.equal(scoreText({ correct: 3 }), '');
  assert.equal(scoreText({ total: 3 }), '');
  assert.equal(scoreText({}), '');
});

test('resultVerdict: short forms for embedded sentences', () => {
  assert.equal(resultVerdict({ passed: true, correct: 3, total: 3 }).short, 'навык подтверждён');
  assert.equal(
    resultVerdict({ passed: false, correct: 4, total: 10 }).short,
    'навык не подтверждён'
  );
  assert.equal(
    resultVerdict({ passed: false, correct: null, total: null, reason: 'FRAUD' }).short,
    'навык не подтверждён (FRAUD)'
  );
  assert.equal(resultVerdict({ passed: null, correct: 5, total: 6 }).short, 'результат: 5 из 6');
  assert.equal(
    resultVerdict({ passed: null, correct: null, total: null }).short,
    'результат не распознан'
  );
});

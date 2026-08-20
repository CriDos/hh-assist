import { test, assert } from 'vitest';
import { PROTO } from '../../src/core/proto.ts';

test('proto: fingerprint paths match the live hh formula', () => {
  assert.equal(PROTO.fingerprint.strictPaths.length, 13);
  assert.equal(PROTO.fingerprint.softPaths.length, 9);
  assert.equal(PROTO.fingerprint.hardwarePaths.length, 5);
  assert.ok(PROTO.fingerprint.strictPaths.includes('canvas.value.geometry'));
  assert.ok(PROTO.fingerprint.softPaths.includes('fontPreferences.value'));
  assert.ok(PROTO.fingerprint.hardwarePaths.includes('webGlBasics.value.vendorUnmasked'));
});

test('proto: assessment endpoints and headers match docs', () => {
  assert.equal(PROTO.assessment.paths.getCurrentTask, '/shards/cert_tests/get_current_task');
  assert.equal(PROTO.assessment.paths.submitAnswer, '/shards/cert_tests/submit_user_answer');
  assert.equal(PROTO.assessment.paths.postFinish, '/shards/contest/post_finish');
  assert.equal(PROTO.assessment.headers['X-Hhtmsource'], 'CertTests');
  assert.equal(PROTO.assessment.headers['X-Requested-With'], 'XMLHttpRequest');
});

test('proto: telemetry shape is stable', () => {
  assert.equal(PROTO.telemetry.heartbeatMs, 20000);
  assert.equal(PROTO.telemetry.types.chooseAnswer, 8);
  assert.equal(PROTO.telemetry.types.heartBeat, 10);
});

test('proto: code contour endpoints and headers match docs §4.1', () => {
  assert.equal(PROTO.code.pagePath, '/code/<skillId>');
  assert.equal(PROTO.code.ssrTemplateClass, 'AssessmentFront-InitialState');
  assert.equal(PROTO.code.ssrKey, 'pageCertCode');
  assert.equal(PROTO.code.paths.updateCode, '/shards/cert_code/update_code');
  assert.equal(PROTO.code.paths.submitTask, '/shards/cert_code/post_submit_task');
  assert.equal(PROTO.code.paths.getSubmitTaskResult, '/shards/cert_code/get_submit_task_result');
  assert.equal(PROTO.code.headers['X-Hhtmsource'], 'CertCode');
  assert.deepEqual(PROTO.code.submissionTypes, { check: 'check', full: 'full' });
  assert.ok(PROTO.code.maxFixAttempts >= 2);
  assert.ok(PROTO.code.pollAttempts >= 5);
});

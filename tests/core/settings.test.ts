import { test, assert } from 'vitest';
import {
  settingsDefaults,
  llmConfig,
  timingConfig,
  activeProfile
} from '../../src/core/settings.ts';
import { DEFAULT_TIMING } from '../../src/core/timing.ts';
import { PROTO } from '../../src/core/proto.ts';

test('settings: defaults fill missing fields', () => {
  const settings = settingsDefaults({});
  assert.equal(settings.baseUrl, '');
  assert.equal(settings.profileId, null);
  assert.deepEqual(settings.profiles, []);
  assert.equal(settings.timings.theory.answerMinMs, DEFAULT_TIMING.theory.answerMinMs);
  assert.equal(settings.timings.practice.typingMaxMs, DEFAULT_TIMING.practice.typingMaxMs);
  assert.equal(settings.timings.betweenTestsMinMs, DEFAULT_TIMING.betweenTestsMinMs);
});

test('settings: flat timings shape migrates into both groups', () => {
  const settings = settingsDefaults({
    timings: {
      answerMinMs: 5000,
      answerMaxMs: 9000,
      betweenMinMs: 3000,
      betweenMaxMs: 6000,
      betweenTestsMinMs: 20000,
      betweenTestsMaxMs: 40000
    }
  });
  assert.deepEqual(settings.timings.theory, {
    answerMinMs: 5000,
    answerMaxMs: 9000,
    betweenMinMs: 3000,
    betweenMaxMs: 6000
  });
  assert.deepEqual(settings.timings.practice, {
    answerMinMs: 5000,
    answerMaxMs: 9000,
    betweenMinMs: 3000,
    betweenMaxMs: 6000,
    typingMinMs: DEFAULT_TIMING.practice.typingMinMs,
    typingMaxMs: DEFAULT_TIMING.practice.typingMaxMs,
    retryTypingMinMs: DEFAULT_TIMING.practice.retryTypingMinMs,
    retryTypingMaxMs: DEFAULT_TIMING.practice.retryTypingMaxMs
  });
  assert.equal(settings.timings.betweenTestsMinMs, 20000);
});

test('settings: grouped timings survive untouched', () => {
  const settings = settingsDefaults({
    timings: {
      theory: { answerMinMs: 1, answerMaxMs: 2, betweenMinMs: 3, betweenMaxMs: 4 },
      practice: { answerMinMs: 5, answerMaxMs: 6, betweenMinMs: 7, betweenMaxMs: 8 },
      betweenTestsMinMs: 100,
      betweenTestsMaxMs: 200
    }
  });
  assert.deepEqual(settings.timings.theory, {
    answerMinMs: 1,
    answerMaxMs: 2,
    betweenMinMs: 3,
    betweenMaxMs: 4
  });
  assert.deepEqual(settings.timings.practice, {
    answerMinMs: 5,
    answerMaxMs: 6,
    betweenMinMs: 7,
    betweenMaxMs: 8,
    typingMinMs: DEFAULT_TIMING.practice.typingMinMs,
    typingMaxMs: DEFAULT_TIMING.practice.typingMaxMs,
    retryTypingMinMs: DEFAULT_TIMING.practice.retryTypingMinMs,
    retryTypingMaxMs: DEFAULT_TIMING.practice.retryTypingMaxMs
  });
});

test('settings: timingConfig picks the group by kind', () => {
  const settings = settingsDefaults({
    timings: {
      theory: { answerMinMs: 1000, answerMaxMs: 2000, betweenMinMs: 300, betweenMaxMs: 400 },
      practice: { answerMinMs: 5000, answerMaxMs: 6000, betweenMinMs: 700, betweenMaxMs: 800 }
    }
  });
  assert.deepEqual(timingConfig(settings, 'theory').answer, { min: 1000, max: 2000 });
  assert.deepEqual(timingConfig(settings, 'practice').answer, { min: 5000, max: 6000 });
  assert.deepEqual(timingConfig(settings, 'practice').between, { min: 700, max: 800 });
  assert.equal(timingConfig(settings, 'theory').heartbeatMs, PROTO.telemetry.heartbeatMs);
});

test('settings: llmConfig passes through API and prompt settings', () => {
  const config = llmConfig(
    settingsDefaults({
      baseUrl: 'https://api.test/v1',
      apiKey: 'k',
      model: 'm',
      reasoning: 'high',
      systemPrompt: 'SYS'
    })
  );
  assert.deepEqual(config, {
    baseUrl: 'https://api.test/v1',
    apiKey: 'k',
    model: 'm',
    reasoning: 'high',
    systemPrompt: 'SYS'
  });
});

test('settings: activeProfile finds the selected profile', () => {
  const hashes = { strict_hash: 's', soft_hash: 'f', hardware_hash: 'h' };
  const profiles: any[] = [
    { id: 'a', label: 'A', visitorId: '1', xhh: 'x1', hashes },
    { id: 'b', label: 'B', visitorId: '2', xhh: 'x2', hashes }
  ];
  assert.equal(activeProfile({ profiles, profileId: 'b' } as any)?.label, 'B');
  assert.equal(activeProfile({ profiles, profileId: 'zzz' } as any), null);
  assert.equal(activeProfile({ profiles, profileId: null } as any), null);
});

test('settings: migration drops salted legacy profiles and resets a broken profileId', () => {
  const settings = settingsDefaults({
    profiles: [
      { id: 'legacy', label: 'Профиль 2026-08-10', visitorId: '1', salt: 's1' },
      {
        id: 'new',
        label: 'gen_1_2026-08-13',
        visitorId: '2',
        xhh: 'x2',
        hashes: { strict_hash: 'a', soft_hash: 'b', hardware_hash: 'c' }
      }
    ],
    profileId: 'legacy'
  });
  assert.equal(settings.profiles.length, 1, 'salted profiles must be dropped');
  assert.equal(settings.profiles[0].id, 'new');
  assert.equal(settings.profileId, null, 'selection of a dropped profile resets to null');
});

test('settings: migration keeps the selection when the profile survives', () => {
  const settings = settingsDefaults({
    profiles: [{ id: 'ok', label: 'gen_0_2026-08-13', visitorId: '1', xhh: 'x', hashes: {} }],
    profileId: 'ok'
  });
  assert.equal(settings.profiles.length, 1);
  assert.equal(settings.profileId, 'ok');
});

test('settings: null or non-object input safely falls back to defaults', () => {
  const settingsNull = settingsDefaults(null as any);
  assert.equal(settingsNull.baseUrl, '');
  assert.equal(settingsNull.profileId, null);
  assert.ok(settingsNull.timings.theory);

  const settingsUndefined = settingsDefaults(undefined as any);
  assert.equal(settingsUndefined.baseUrl, '');
});

test('settings: timings gracefully handles non-numeric and negative values', () => {
  const settings = settingsDefaults({
    timings: {
      theory: { answerMinMs: 'invalid', answerMaxMs: -100, betweenMinMs: NaN, betweenMaxMs: null }
    }
  });
  assert.equal(settings.timings.theory.answerMinMs, DEFAULT_TIMING.theory.answerMinMs);
  assert.equal(settings.timings.theory.answerMaxMs, DEFAULT_TIMING.theory.answerMaxMs);
});

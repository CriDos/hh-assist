import { test, assert } from 'vitest';
import { DEFAULT_TIMING, randomBetween, delayMs, sleep } from '../../src/core/timing.ts';

test('randomBetween: stays within the range', () => {
  const rng = () => 0.5;
  assert.equal(randomBetween(100, 200, rng), 150);
  assert.equal(randomBetween(100, 100, rng), 100);
  const rngEdge = () => 0;
  assert.equal(randomBetween(100, 200, rngEdge), 100);
});

test('delayMs: picks from the range', () => {
  assert.equal(
    delayMs({ min: 10, max: 20 }, () => 0),
    10
  );
  assert.equal(
    delayMs({ min: 10, max: 20 }, () => 1),
    20
  );
});

test('sleep: resolves true after the delay', async () => {
  const started = Date.now();
  const result = await sleep(30);
  assert.equal(result, true);
  assert.ok(Date.now() - started >= 25, 'must wait at least the base delay');
});

test('sleep: resolves false immediately when the signal is already aborted', async () => {
  const signal: any = { aborted: true, addEventListener() {} };
  assert.equal(await sleep(1000, { signal }), false);
});

test('sleep: aborts mid-sleep and resolves false', async () => {
  const listeners: any[] = [];
  const signal: any = {
    aborted: false,
    addEventListener(_name: string, fn: any) {
      listeners.push(fn);
    },
    removeEventListener(_name: string, fn: any) {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    }
  };
  const promise = sleep(10000, { signal });
  listeners[0]();
  assert.equal(await promise, false);
  assert.equal(listeners.length, 0, 'listener should be cleaned up on abort');
});

test('default timing ranges are sane and configurable-shaped', () => {
  for (const group of [DEFAULT_TIMING.theory]) {
    assert.ok(group.answerMinMs > 0 && group.answerMaxMs > group.answerMinMs);
    assert.ok(group.betweenMinMs > 0 && group.betweenMaxMs >= group.betweenMinMs);
  }
  assert.ok(DEFAULT_TIMING.practice.typingMinMs > 0);
  assert.ok(DEFAULT_TIMING.practice.typingMaxMs > DEFAULT_TIMING.practice.typingMinMs);
  assert.ok(DEFAULT_TIMING.betweenTestsMinMs > 0);
  assert.ok(DEFAULT_TIMING.betweenTestsMaxMs > DEFAULT_TIMING.betweenTestsMinMs);
});

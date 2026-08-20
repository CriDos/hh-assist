import { test, assert, expect } from 'vitest';
import { createSolverKit } from '../../src/solvers/solver-kit.ts';
import { sleep } from '../../src/core/timing.ts';

const LIMITS = { apiRetries: 3, apiBackoffMs: 10 };

function makeKit({ telemetry = {}, signal = undefined as any, rng = () => 0.5 } = {}) {
  const events: any[] = [];
  return {
    kit: createSolverKit({
      signal,
      telemetry,
      rng,
      onEvent: (event: any) => events.push(event),
      limits: LIMITS
    }),
    events
  };
}

test('solver-kit: heartbeat pump beats during long work and stops after', async () => {
  const beats: number[] = [];
  const { kit } = makeKit({
    telemetry: {
      heartbeat: async (taskId: number) => {
        beats.push(taskId);
      }
    }
  });
  await kit.withHeartbeat(
    42,
    async () => {
      await sleep(45, { signal: kit.signal });
    },
    10
  );
  assert.ok(beats.length >= 2, 'heartbeat must fire repeatedly during long work');
  assert.ok(
    beats.every(taskId => taskId === 42),
    'heartbeat carries the taskId'
  );
  const count = beats.length;
  await sleep(20, { signal: kit.signal });
  assert.equal(beats.length, count, 'pump stops after work finishes');
});

test('solver-kit: withApiRetries retries transient errors with backoff', async () => {
  const { kit } = makeKit();
  let attempts = 0;
  const result = await kit.withApiRetries('work', async () => {
    attempts++;
    if (attempts < 3) {
      const error: any = new Error('HTTP 500');
      error.status = 500;
      throw error;
    }
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});

test('solver-kit: withApiRetries throws non-retriable errors immediately', async () => {
  const { kit } = makeKit();
  let attempts = 0;
  await expect(
    kit.withApiRetries('work', async () => {
      attempts++;
      const error: any = new Error('HTTP 400');
      error.status = 400;
      throw error;
    })
  ).rejects.toThrow(/HTTP 400/);
  assert.equal(attempts, 1);
});

test('solver-kit: pause resolves false when aborted, true otherwise', async () => {
  const { kit } = makeKit();
  assert.equal(await kit.pause({ min: 1, max: 1 }), true);

  const aborted = new AbortController();
  const { kit: kit2 } = makeKit({ signal: aborted });
  aborted.abort();
  assert.equal(await kit2.pause({ min: 1000, max: 2000 }), false);
});

test('solver-kit: abort() cancels the signal and pending sleeps', async () => {
  const { kit } = makeKit();
  let resolved: any = null;
  const pending = kit.pause({ min: 5000, max: 5000 }).then(value => {
    resolved = value;
  });
  kit.abort();
  await pending;
  assert.equal(resolved, false);
  assert.equal(kit.signal.aborted, true);
});

test('solver-kit: report falls back to no-op without telemetry, forwards calls otherwise', async () => {
  const { kit } = makeKit();
  await kit.report(1, [{ type: 8 }]);
  const sent: any[] = [];
  const called = createSolverKit({
    telemetry: {
      report: async (taskId: number, events: any[]) => {
        sent.push({ taskId, events });
      }
    },
    onEvent: () => {},
    limits: LIMITS
  });
  await called.report(7, [{ type: 5 }]);
  assert.deepEqual(sent, [{ taskId: 7, events: [{ type: 5 }] }]);
});

test('solver-kit: emitTimeLeft emits only a valid server value, swallows failures', async () => {
  const { kit, events } = makeKit();
  await kit.emitTimeLeft({ getTimeLeft: async () => ({ timeLeftSeconds: 45 }) } as any);
  assert.deepEqual(
    events.map(e => e.type),
    ['timeLeft']
  );
  assert.equal(events[0].seconds, 45);

  const { kit: kit2, events: events2 } = makeKit();
  await kit2.emitTimeLeft({
    getTimeLeft: async () => {
      throw new Error('net');
    }
  } as any);
  await kit2.emitTimeLeft({ getTimeLeft: async () => ({}) } as any);
  assert.equal(events2.length, 0, 'неверные ответы не эмиттся, сбои глотаются');
});

test('solver-kit: expose() wires start(contest) to run() and abort to the signal', async () => {
  const { kit } = makeKit();
  const seen: any[] = [];
  const solver = kit.expose(async contest => {
    seen.push(contest);
    return { status: 'finished' } as any;
  });
  const result = await solver.start('abc');
  assert.deepEqual(seen, ['abc']);
  assert.equal(result.status, 'finished');
  assert.equal(typeof solver.abort, 'function');
  solver.abort();
  assert.equal(kit.signal.aborted, true);
});

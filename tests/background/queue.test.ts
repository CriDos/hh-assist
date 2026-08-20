import { test, assert } from 'vitest';
import { createChromeMock } from '../helpers/chrome-mock.ts';
import { state, resetState } from '../../src/background/state.ts';
import { createQueue, restoreQueue, QUEUE_KEY } from '../../src/background/queue.ts';

const job = (name = 'Python') => ({
  item: { id: 1114, name, category: 'LANG' },
  level: { id: 8, name: 'Базовый', rank: 1 },
  method: { id: 294, name: 'Теория' },
  kind: 'theory' as const
});

// No pause between tests: timingConfig reads hhSettings from storage.local.
const fastSettings = {
  timings: { betweenTestsMinMs: 1, betweenTestsMaxMs: 1 }
};

// Queue persistence is intentionally asynchronous. Let its storage chain
// settle before the next test swaps the global Chrome mock.
test.afterEach(async () => {
  await new Promise(resolve => setTimeout(resolve, 0));
});

function freshQueue(store: any = {}) {
  const { chrome, storage } = createChromeMock({ store });
  (globalThis as any).chrome = chrome;
  return { createQueue, restoreQueue, QUEUE_KEY, storage, chrome };
}

test('queue: startMany persists the jobs snapshot while running', async () => {
  resetState();
  const { createQueue, QUEUE_KEY, storage } = await freshQueue();
  let release: any;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const queue = createQueue({
    startTest: async () => {
      await gate;
      return { status: 'finished', passed: true };
    },
    getRunningSolver: () => null
  });
  const run = queue.startMany([job()]);
  await new Promise(resolve => setTimeout(resolve, 20));
  const saved = storage[QUEUE_KEY];
  assert.ok(saved, 'the snapshot is written to storage.session');
  assert.equal(saved.jobs[0].status, 'running');
  assert.equal(saved.running, true);
  queue.abort();
  release();
  await run;
});

test('queue: restoreQueue rebuilds jobs and continues job ids without collisions', async () => {
  resetState();
  const store = {
    hhSettings: fastSettings,
    hhQueue: {
      jobs: [
        {
          id: 7,
          ...job(),
          status: 'done',
          progress: { number: 0, total: null },
          passed: true,
          correct: 5,
          totalScore: 5,
          message: ''
        }
      ],
      running: false
    }
  };
  const { restoreQueue, createQueue } = await freshQueue(store);
  const saved = await restoreQueue();
  assert.equal(saved?.jobs.length, 1);
  assert.equal(state.jobs[0].id, 7);

  // Appending after restore must not reuse id 7 (removeJob matches by id).
  const queue = createQueue({
    startTest: async () => ({ status: 'finished' }) as any,
    getRunningSolver: () => null
  });
  await queue.startMany([job('Java')]);
  const ids = state.jobs.map(entry => entry.id);
  assert.ok(
    ids.every(id => ids.filter(x => x === id).length === 1),
    'restored and new ids must not collide'
  );
  assert.ok(
    state.jobs.some(entry => Number(entry.id) > 7),
    'new jobs get fresh ids after the restored ones'
  );
});

test('queue: finishResumed closes the running job with the resumed outcome', async () => {
  resetState();
  const { restoreQueue, createQueue } = await freshQueue({
    hhQueue: {
      jobs: [
        {
          id: 3,
          ...job(),
          status: 'running',
          progress: { number: 2, total: 10 },
          passed: null,
          correct: null,
          totalScore: null,
          message: ''
        }
      ],
      running: true
    }
  });
  await restoreQueue();
  const queue = createQueue({ startTest: async () => ({}) as any, getRunningSolver: () => null });
  queue.finishResumed({ status: 'finished', passed: true, correct: 8, totalScore: 10 });
  assert.equal(state.jobs[0].status, 'done');
  assert.equal(state.jobs[0].passed, true);
  assert.equal(state.jobs[0].correct, 8);
});

test('queue: requeueRunning sends a stuck running job back to queued', async () => {
  resetState();
  const { restoreQueue, createQueue } = await freshQueue({
    hhQueue: {
      jobs: [
        {
          id: 3,
          ...job(),
          status: 'running',
          progress: { number: 2, total: 10 },
          passed: null,
          correct: null,
          totalScore: null,
          message: ''
        }
      ],
      running: true
    }
  });
  await restoreQueue();
  const queue = createQueue({ startTest: async () => ({}) as any, getRunningSolver: () => null });
  queue.requeueRunning();
  assert.equal(state.jobs[0].status, 'queued');
  assert.deepEqual(state.jobs[0].progress, { number: 0, total: null });
});

test('queue: abort interrupts the between-tests pause and aborts queued jobs', async () => {
  resetState();
  const { createQueue } = await freshQueue();
  let started = 0;
  const queue = createQueue({
    startTest: async () => {
      started++;
      return { status: 'finished', passed: true };
    },
    getRunningSolver: () => null
  });
  const run = queue.startMany([job('Python'), job('Java')]);
  await new Promise(resolve => setTimeout(resolve, 50));
  queue.abort();
  await run;
  assert.equal(started, 1, 'the second job must not start after the abort');
  assert.equal(state.jobs[1].status, 'aborted');
  assert.equal(state.queueRunning, false);
});

test('queue: adding jobs during a pause keeps the abort controller and returns a promise', async () => {
  resetState();
  const { createQueue } = await freshQueue();
  let started = 0;
  const queue = createQueue({
    startTest: async () => {
      started++;
      return { status: 'finished', passed: true };
    },
    getRunningSolver: () => null
  });
  const run = queue.startMany([job('Python'), job('Java')]);
  await new Promise(resolve => setTimeout(resolve, 50));
  const appended = queue.startMany([job('Go')]);
  assert.equal(
    typeof appended?.then,
    'function',
    'the append path must keep the RPC promise contract'
  );
  queue.abort();
  await run;
  assert.equal(started, 1, 'the queued jobs must not start after the abort');
  assert.equal(state.jobs[1].status, 'aborted');
  assert.equal(state.jobs[2].status, 'aborted');
});

test('queue: storage writes stay ordered when a new queue starts during cleanup', async () => {
  resetState();
  const { createQueue, QUEUE_KEY, chrome, storage } = await freshQueue();
  const originalRemove = chrome.storage.session.remove;
  let blockRemove = true;
  let releaseRemove: any;
  chrome.storage.session.remove = (key: any) => {
    if (key !== QUEUE_KEY || !blockRemove) return originalRemove(key);
    return new Promise(resolve => {
      releaseRemove = () => {
        blockRemove = false;
        originalRemove(key).then(resolve);
      };
    });
  };
  const queue = createQueue({
    startTest: async () => ({ status: 'finished', passed: true }),
    getRunningSolver: () => null
  });

  const firstRun = queue.startMany([job('First')]);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(typeof releaseRemove, 'function', 'finished queue must schedule cleanup');

  let releaseSecond: any;
  const secondGate = new Promise(resolve => {
    releaseSecond = resolve;
  });
  const secondQueue = createQueue({
    startTest: async () => {
      await secondGate;
      return { status: 'finished', passed: true };
    },
    getRunningSolver: () => null
  });
  const secondRun = secondQueue.startMany([job('Second')]);
  releaseRemove();
  await firstRun;
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(
    storage[QUEUE_KEY].jobs.find((entry: any) => entry.status === 'running')?.item?.name,
    'Second',
    'new snapshot must survive old cleanup'
  );

  secondQueue.abort();
  releaseSecond();
  await secondRun;
});

test('queue: the finished queue clears the persisted snapshot', async () => {
  resetState();
  const { createQueue, QUEUE_KEY, storage } = await freshQueue();
  const queue = createQueue({
    startTest: async () => ({ status: 'finished', passed: true }),
    getRunningSolver: () => null
  });
  await queue.startMany([job()]);
  assert.equal(storage[QUEUE_KEY], undefined, 'nothing left to restore once the queue is done');
});

test('queue: LLM API failure on a job pauses the remaining queue', async () => {
  resetState();
  const { createQueue } = await freshQueue({ hhSettings: fastSettings });
  const llmFailure = Object.assign(new Error('HTTP 503 unavailable'), { code: 'LLM_API' });
  let calls = 0;
  const queue = createQueue({
    startTest: async () => {
      calls++;
      if (calls === 1) throw llmFailure;
      return { status: 'finished', passed: true, correct: 5, totalScore: 5 };
    },
    getRunningSolver: () => null
  });
  await queue.startMany([job('Python'), job('Java'), job('Go')]);

  assert.equal(state.jobs[0].status, 'error');
  assert.equal(state.jobs[0].message, 'HTTP 503 unavailable');
  assert.equal(state.jobs[1].status, 'queued', 'remaining jobs stay queued on pause');
  assert.equal(state.jobs[2].status, 'queued');
  assert.equal(calls, 1, 'no further tests start while paused');
  assert.equal(state.queuePaused, true, 'queue is marked as paused');

  // Resume queue after failure
  await queue.resume();
  assert.equal(state.jobs[1].status, 'done');
  assert.equal(state.jobs[2].status, 'done');
  assert.equal(calls, 3);
});

test('queue: a non-LLM job error does not stop the queue', async () => {
  resetState();
  const { createQueue } = await freshQueue({ hhSettings: fastSettings });
  const failures = new Set(['Python']);
  const queue = createQueue({
    startTest: async ({ item }: any) => {
      if (failures.has(item.name)) throw new Error('Страница раздела не открылась');
      return { status: 'finished', passed: true, correct: 1, totalScore: 1 };
    },
    getRunningSolver: () => null
  });
  await queue.startMany([job('Python'), job('Java')]);

  assert.equal(state.jobs[0].status, 'error');
  assert.equal(state.jobs[1].status, 'done', 'a non-LLM error must not abort the queue');
});

test('queue: edge cases: non-existent removeJob, retryFailed on empty, clearDone on active', async () => {
  resetState();
  const { createQueue } = await freshQueue({ hhSettings: fastSettings });
  const queue = createQueue({
    startTest: async () => ({ status: 'finished', passed: true }),
    getRunningSolver: () => null
  });

  // removeJob with non-existent id
  assert.equal(queue.removeJob(999999)?.removed, false);

  // retryFailed when no errors
  const retried = await queue.retryFailed();
  assert.equal(retried.count, 0);

  // clearDone on empty queue
  const cleared = queue.clearDone();
  assert.equal(cleared.count, 0);
});

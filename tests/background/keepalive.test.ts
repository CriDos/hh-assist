import { test, beforeEach, assert } from 'vitest';
import { state, resetState } from '../../src/background/state.ts';
import {
  isWorkActive,
  ensureKeepAlive,
  saveCheckpoint,
  clearCheckpoint,
  KEEP_ALIVE_ALARM,
  CHECKPOINT_KEY
} from '../../src/background/keepalive.ts';

let alarms: Record<string, any> = {};
let sessionStore: Record<string, any> = {};

beforeEach(() => {
  resetState();
  alarms = {};
  sessionStore = {};
  (globalThis as any).chrome = {
    alarms: {
      create: (name: string, opts: any) => {
        alarms[name] = opts;
      },
      clear: (name: string) => {
        delete alarms[name];
      },
      onAlarm: { addListener: () => {} }
    },
    storage: {
      session: {
        set: async (items: any) => Object.assign(sessionStore, items),
        remove: async (key: string) => {
          delete sessionStore[key];
        }
      }
    }
  };
});

test('keepalive: isWorkActive returns true when queue or run is active', () => {
  assert.equal(isWorkActive(), false);

  state.queueRunning = true;
  assert.equal(isWorkActive(), true);

  state.queueRunning = false;
  state.run = { tabId: 10 } as any;
  assert.equal(isWorkActive(), true);
});

test('keepalive: ensureKeepAlive creates alarm when active and clears when idle', () => {
  state.queueRunning = true;
  ensureKeepAlive();
  assert.ok(alarms[KEEP_ALIVE_ALARM]);
  assert.equal(alarms[KEEP_ALIVE_ALARM].periodInMinutes, 0.5);

  state.queueRunning = false;
  state.run = null;
  ensureKeepAlive();
  assert.equal(alarms[KEEP_ALIVE_ALARM], undefined);
});

test('keepalive: saveCheckpoint writes run state and clearCheckpoint deletes it', async () => {
  state.run = {
    tabId: 99,
    contestId: 'contest-xyz',
    item: { id: 123, name: 'JavaScript' },
    level: { name: 'Продвинутый' },
    kind: 'practice'
  } as any;

  saveCheckpoint();
  assert.ok(sessionStore[CHECKPOINT_KEY]);
  const checkpoint = sessionStore[CHECKPOINT_KEY];
  assert.equal(checkpoint.tabId, 99);
  assert.equal(checkpoint.contestId, 'contest-xyz');
  assert.equal(checkpoint.job, 'JavaScript:Продвинутый:practice');
  assert.equal(checkpoint.item.id, 123);
  assert.equal(checkpoint.kind, 'practice');
  assert.ok(Number.isFinite(checkpoint.savedAt));

  clearCheckpoint();
  assert.equal(sessionStore[CHECKPOINT_KEY], undefined);
});

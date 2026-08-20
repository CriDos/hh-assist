import { test, assert } from 'vitest';
import { probeSession } from '../../src/core/page-fp.ts';

test('serialization: helpers are declared inside the exported functions', () => {
  assert.ok(
    probeSession.toString().includes('readSsrState'),
    'probeSession must inline readSsrState'
  );
});

// Page mock: templates — [{ text }], where text is double-escaped JSON
// (as in live SSR: quotes are already decoded by the DOM parser, slashes doubled).
function mockPage({ templates = [] as any[], globalVars = null as any }) {
  const saved: Record<string, any> = {};
  const setGlobal = (name: string, value: any) => {
    saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };
  setGlobal('document', {
    querySelectorAll: () => templates.map(item => ({ content: { textContent: item.text } }))
  });
  setGlobal('window', {
    globalVars: globalVars || {},
    location: { href: 'https://spb.hh.ru/applicant/skill_verifications/methods' }
  });
  const restore = () => {
    for (const [name, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as any)[name];
    }
  };
  return { restore };
}

const escapeSsr = (value: any) => JSON.stringify(value).replaceAll('\\', '\\\\');

test('probeSession: catalog page — template without class, numeric userId', () => {
  const page = mockPage({
    templates: [
      {
        text: escapeSsr({ userId: 171099089, skillsVerificationMethodsPage: { items: [] } })
      }
    ]
  });
  try {
    const session = probeSession();
    assert.equal(session.loggedIn, true);
    assert.equal(session.userId, '171099089');
  } finally {
    page.restore();
  }
});

test('probeSession: section page — template.SkillsFront-InitialState, string userId', () => {
  const page = mockPage({
    templates: [
      {
        text: escapeSsr({ userId: '171099089', applicantKeyskillVerificationMethodsPage: {} })
      }
    ]
  });
  try {
    const session = probeSession();
    assert.equal(session.loggedIn, true);
    assert.equal(session.userId, '171099089');
  } finally {
    page.restore();
  }
});

test('probeSession: not logged in — no templates, no globalVars', () => {
  const page = mockPage({ templates: [] });
  try {
    const session = probeSession();
    assert.equal(session.loggedIn, false);
    assert.equal(session.userId, null);
  } finally {
    page.restore();
  }
});

test('probeSession: fallback to globalVars.login when SSR is consumed', () => {
  const page = mockPage({
    templates: [],
    globalVars: { userType: 'applicant', login: 'user@ya.ru' }
  });
  try {
    const session = probeSession();
    assert.equal(session.loggedIn, true);
  } finally {
    page.restore();
  }
});

test('probeSession: guest with only userType applicant is NOT logged in', () => {
  const page = mockPage({
    templates: [],
    globalVars: { userType: 'applicant', userId: null }
  });
  try {
    const session = probeSession();
    assert.equal(session.loggedIn, false);
    assert.equal(session.userId, null);
  } finally {
    page.restore();
  }
});

test('probeSession: first parseable template wins, broken ones are skipped', () => {
  const page = mockPage({
    templates: [{ text: 'not json at all' }, { text: escapeSsr({ userId: 42 }) }]
  });
  try {
    const session = probeSession();
    assert.equal(session.loggedIn, true);
    assert.equal(session.userId, '42');
  } finally {
    page.restore();
  }
});

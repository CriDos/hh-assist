import { test, assert } from 'vitest';
import { extractTemplate, parseCatalog, parseSsr } from '../../src/core/catalog.ts';

function encodeSsr(value: any) {
  return JSON.stringify(value).replaceAll('\\', '\\\\').replaceAll('"', '&quot;');
}

function wrap(state: any, templateClass = 'SkillsFront-InitialState') {
  return `<!doctype html><html><body><template class="${templateClass}">${encodeSsr(state)}</template></body></html>`;
}

// Catalog: SSR template WITHOUT a class (such as in the live catalog HTML) — the parser
// must find the state among all <template> tags by key.
function wrapClassless(state: any) {
  return `<!doctype html><html><body>
    <template class="SomeOther">${encodeSsr({ unrelated: true })}</template>
    <template>${encodeSsr(state)}</template>
  </body></html>`;
}

const level = (rank: number) => ({
  id: 100 + rank,
  internalId: 200 + rank,
  name: rank === 1 ? 'Базовый' : rank === 2 ? 'Средний' : 'Продвинутый',
  rank,
  theory: {
    id: 290 + rank,
    name: 'Теория',
    taskNumber: 10,
    estimatedTime: 600,
    availability: { availableAt: null, status: 'AVAILABLE' },
    validity: { state: 'NONE', validUntil: null },
    externalId: null,
    trainingExternalId: null
  },
  practice: {
    id: 390 + rank,
    name: 'Практика',
    taskNumber: 2,
    estimatedTime: 1800,
    availability: { availableAt: null, status: 'AVAILABLE' },
    validity: { state: 'NONE', validUntil: null },
    externalId: null,
    trainingExternalId: null
  }
});

const item = (id: number, name: string) => ({
  id,
  name,
  category: 'LANG',
  source: null,
  result: {
    level: null,
    state: 'NONE',
    theory: 'AVAILABLE',
    practice: 'AVAILABLE',
    availableAt: null,
    validUntil: null
  },
  levels: [level(1), level(2), level(3)]
});

test('parseCatalog: decodes double-escaped SSR and returns items', () => {
  const html = wrap({
    skillsVerificationMethodsPage: { items: [item(1114, 'Python'), item(3093, 'Java')] }
  });
  const { items, dropped } = parseCatalog(html);
  assert.equal(dropped, 0);
  assert.equal(items?.length, 2);
  assert.equal(items![0].name, 'Python');
  assert.equal(items![0].levels[0].rank, 1);
  assert.equal(items![0].levels[0].theory!.id, 291);
});

test('parseCatalog: classless template (live catalog HTML) is found by key', () => {
  const html = wrapClassless({ skillsVerificationMethodsPage: { items: [item(1114, 'Python')] } });
  const { items, dropped } = parseCatalog(html);
  assert.equal(dropped, 0);
  assert.equal(items?.length, 1);
  assert.equal(items?.[0].name, 'Python');
});

test('parseCatalog: invalid items are dropped and counted', () => {
  const html = wrap({
    skillsVerificationMethodsPage: {
      items: [item(1114, 'Python'), { id: 1, name: 'Битая' }]
    }
  });
  const { items, dropped } = parseCatalog(html);
  assert.equal(dropped, 1);
  assert.equal(items?.length, 1);
  assert.equal(items?.[0].name, 'Python');
});

test('parseCatalog: sections with no practice (theory-only) are valid', () => {
  const theoryOnly: any = item(674, 'JavaScript');
  for (const level of theoryOnly.levels) level.practice = null;
  const html = wrap({ skillsVerificationMethodsPage: { items: [theoryOnly] } });
  const { items, dropped } = parseCatalog(html);
  assert.equal(dropped, 0, 'theory-only sections must be kept');
  assert.equal(items?.length, 1);
  assert.equal(items?.[0].levels[0].practice, null);
});

test('parseCatalog: broken SSR yields null items (caller falls back)', () => {
  assert.deepEqual(parseCatalog('<html>no template</html>'), { items: null, dropped: 0 });
  assert.deepEqual(parseCatalog(null as any), { items: null, dropped: 0 });
  assert.deepEqual(parseCatalog(wrap({ notACatalog: true })), { items: null, dropped: 0 });
});

test('extractTemplate: finds content by class name', () => {
  const html = '<template class="SkillsFront-InitialState">{"a":1}</template>';
  assert.equal(extractTemplate(html, 'SkillsFront-InitialState'), '{"a":1}');
  assert.equal(extractTemplate(html, 'Other'), null);
});

test('parseSsr: parses JSON with keyHint priority', () => {
  const html = wrap({ testKey: { data: 123 } });
  const result = parseSsr(html, 'testKey');
  assert.deepEqual(result, { testKey: { data: 123 } });
});

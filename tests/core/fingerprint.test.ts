import { test, assert } from 'vitest';
import {
  sha256Hex,
  componentString,
  concatenateComponents,
  computeHashes,
  generateComponents,
  generateProfile,
  buildStartUrl
} from '../../src/core/fingerprint.ts';
import { PROTO } from '../../src/core/proto.ts';

// Components matching the real capture (docs/hh.md §3.1) — not all
// 41, only the ones needed by the hash paths; values taken from a live run.
const components: any = {
  canvas: {
    value: {
      geometry: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEYAAA',
      text: 'abcdefghijklmnopqrstuvwxyz0123456789#@&%*$'
    }
  },
  webGlBasics: {
    value: {
      rendererUnmasked:
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti (0x000027B0) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      vendorUnmasked: 'Google Inc. (NVIDIA)'
    }
  },
  webGlExtensions: {
    value: {
      extensions: ['ANGLE_instanced_arrays', 'EXT_blend_minmax', 'WEBGL_debug_renderer_info']
    }
  },
  plugins: { value: ['PDF Viewer', 'Chrome PDF Viewer'] },
  fonts: { value: ['Arial', 'Times New Roman', 'Courier New'] },
  fontPreferences: { value: { defaultFontSize: 16 } },
  screenResolution: { value: [1920, 1040, 1920, 1040] },
  colorDepth: { value: 24 },
  deviceMemory: { value: 8 },
  hardwareConcurrency: { value: 16 },
  math: { value: 4.00000000000001 },
  audio: { value: 124.04347527500903 }
};

test('sha256Hex: known vector', async () => {
  assert.equal(
    await sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
});

test('componentString: arrays are sorted and serialized, objects stringified, primitives as-is', () => {
  assert.equal(componentString(['b', 'a']), JSON.stringify(['a', 'b']));
  assert.equal(componentString({ x: 1 }), JSON.stringify({ x: 1 }));
  assert.equal(componentString(24), '24');
  assert.equal(componentString(null), '');
  assert.equal(componentString(undefined), '');
});

test('concatenateComponents: dot paths resolve and join with |', () => {
  const out = concatenateComponents(components, [
    'colorDepth.value',
    'deviceMemory.value',
    'math.value'
  ]);
  assert.equal(out, '24|8|4.00000000000001');
});

test('concatenateComponents: missing path contributes empty string', () => {
  const out = concatenateComponents(components, ['colorDepth.value', 'nope.value']);
  assert.equal(out, '24|');
});

test('computeHashes: produces 64-hex hashes for the formula paths', async () => {
  const hashes = await computeHashes(components);
  assert.match(hashes.strict_hash, /^[0-9a-f]{64}$/);
  assert.match(hashes.soft_hash, /^[0-9a-f]{64}$/);
  assert.match(hashes.hardware_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hashes.strict_hash, hashes.soft_hash);
  assert.notEqual(hashes.soft_hash, hashes.hardware_hash);
});

test('computeHashes: deterministic — the same components give the same hashes', async () => {
  const generated = generateComponents();
  const first = await computeHashes(generated);
  const second = await computeHashes(generated);
  assert.deepEqual(first, second);
});

test('generateComponents: covers every path used by the hash formula', () => {
  const generated: any = generateComponents();
  const { strictPaths, softPaths, hardwarePaths } = PROTO.fingerprint;
  const paths = [...new Set([...strictPaths, ...softPaths, ...hardwarePaths])];
  for (const path of paths) {
    const value = path.split('.').reduce((acc, segment) => acc?.[segment], generated);
    assert.notEqual(value, undefined, `missing component path: ${path}`);
  }
});

test('generateComponents: GPU renderer and vendor are consistent Windows D3D11 adapters', () => {
  for (let i = 0; i < 20; i++) {
    const generated = generateComponents();
    const renderer = generated.webGlBasics.value.rendererUnmasked;
    const vendor = generated.webGlBasics.value.vendorUnmasked;
    assert.match(renderer, /^ANGLE \((?:NVIDIA|AMD|Intel), .* Direct3D11 .* D3D11\)$/);
    assert.match(vendor, /^Google Inc\. \((?:NVIDIA|AMD|Intel)\)$/);
    assert.notMatch(renderer, /Apple|Qualcomm|Adreno/i);
  }
});

test('generateProfile: fresh random visitorId, xhh and hashes on every call', async () => {
  const a = await generateProfile();
  const b = await generateProfile();
  assert.match(a.id, /^[0-9a-f]{16}$/);
  assert.match(a.visitorId, /^[0-9a-f]{32}$/);
  assert.match(a.xhh, /^[0-9a-f]{32}$/);
  assert.match(a.hashes.strict_hash, /^[0-9a-f]{64}$/);
  assert.match(a.hashes.soft_hash, /^[0-9a-f]{64}$/);
  assert.match(a.hashes.hardware_hash, /^[0-9a-f]{64}$/);
  assert.equal(a.label, '');
  assert.equal((a as any).salt, undefined, 'no salt in the new profile model');
  assert.notEqual(a.visitorId, b.visitorId);
  assert.notEqual(a.xhh, b.xhh);
  assert.notEqual(a.hashes.strict_hash, b.hashes.strict_hash);
});

test('buildStartUrl: assembles redirect URL with all params', () => {
  const url = buildStartUrl({
    origin: 'https://spb.hh.ru',
    skillId: 1114,
    kind: 'theory',
    methodId: 294,
    lastId: 'bce745ba',
    hashes: { strict_hash: 's', soft_hash: 'f', hardware_hash: 'h' },
    xhh: 'fab3c598',
    fingerprintjs: 'd5a45f56'
  });
  const parsed = new URL(url, 'https://spb.hh.ru');
  assert.equal(
    parsed.pathname,
    '/skills/applicant/keyskills/verification_methods/redirect_to_test'
  );
  assert.equal(parsed.searchParams.get('strict_hash'), 's');
  assert.equal(parsed.searchParams.get('soft_hash'), 'f');
  assert.equal(parsed.searchParams.get('hardware_hash'), 'h');
  assert.equal(parsed.searchParams.get('xhh'), 'fab3c598');
  assert.equal(parsed.searchParams.get('fingerprintjs'), 'd5a45f56');
  assert.equal(parsed.searchParams.get('skill_id'), '1114');
  assert.equal(parsed.searchParams.get('kind'), 'theory');
  assert.equal(parsed.searchParams.get('id'), '294');
  assert.equal(parsed.searchParams.get('origin'), 'https://spb.hh.ru');
  assert.equal(parsed.searchParams.get('skill_category'), 'skills');
  assert.equal(parsed.searchParams.get('last_id'), 'bce745ba');
  assert.equal(parsed.searchParams.get('hhtmFrom'), 'skill_assessment_current');
});

test('buildStartUrl: language sections use skill_category=langs', () => {
  const url = buildStartUrl({
    origin: 'https://spb.hh.ru',
    skillId: 57,
    kind: 'practice',
    methodId: 12,
    skillCategory: 'langs',
    lastId: 'l',
    hashes: { strict_hash: 's', soft_hash: 'f', hardware_hash: 'h' },
    xhh: 'x',
    fingerprintjs: 'fp'
  });
  const parsed = new URL(url, 'https://spb.hh.ru');
  assert.equal(parsed.searchParams.get('skill_category'), 'langs');
});

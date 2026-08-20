// hh client fingerprint (docs/hh.md §3.1). Replicates the formula from hh's
// route chunk: Z (SHA-256), J (component concatenation), W (hash assembly).
// Pure module: runs in node (tests) and the browser (extension).
//
// Synthetic fingerprint (2026-08-13): no live collection. Profiles carry
// random visitorId/xhh and hashes computed by formula W from a fresh set of
// plausible components; a launch without a manually selected profile
// generates a new one. See docs/hh.md §3.1 «Синтетический fingerprint».

import { PROTO } from './proto.ts';
import { FingerprintHashes, FingerprintProfile } from '../types/fingerprint.ts';

const subtle = (globalThis as any).crypto?.subtle;

export async function sha256Hex(text: string | number): Promise<string> {
  const data = new TextEncoder().encode(String(text));
  const digest = await subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// J: one component by value → string; arrays are sorted and stringified.
export function componentString(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify([...value].sort());
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return String(value ?? '');
}

// J: component concatenation along paths (dot = nesting).
export function concatenateComponents(
  components: Record<string, any>,
  paths: readonly string[]
): string {
  return paths
    .map(path => {
      const value = path.split('.').reduce((acc, segment) => acc?.[segment], components);
      return componentString(value);
    })
    .join('|');
}

// W: the three hashes (xhh and visitorId are separate profile values).
export async function computeHashes(components: Record<string, any>): Promise<FingerprintHashes> {
  const { strictPaths, softPaths, hardwarePaths } = PROTO.fingerprint;
  return {
    strict_hash: await sha256Hex(concatenateComponents(components, strictPaths)),
    soft_hash: await sha256Hex(concatenateComponents(components, softPaths)),
    hardware_hash: await sha256Hex(concatenateComponents(components, hardwarePaths))
  };
}

// last_id = SHA-256(userId) (docs/hh.md §3.1, item 3). Computed from the
// session cache or a probe of the current tab (background/tabs.js).

function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  if ((globalThis as any).crypto?.getRandomValues) {
    (globalThis as any).crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < array.length; i++) array[i] = Math.floor(Math.random() * 256);
  }
  return [...array].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomInt(min: number, max: number): number {
  const range = max - min + 1;
  if ((globalThis as any).crypto?.getRandomValues) {
    const array = new Uint32Array(1);
    (globalThis as any).crypto.getRandomValues(array);
    return min + (array[0] % range);
  }
  return min + Math.floor(Math.random() * range);
}

function pick<T>(list: T[]): T {
  return list[randomInt(0, list.length - 1)];
}

// Synthetic FingerprintJS components: plausible values for exactly the paths
// used by formula W (docs/hh.md §3.1) — no live collection anywhere.
export function generateComponents(): Record<string, any> {
  const GPUS = [
    {
      renderer:
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti (0x000027B0) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      vendor: 'Google Inc. (NVIDIA)'
    },
    {
      renderer:
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002503) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      vendor: 'Google Inc. (NVIDIA)'
    },
    {
      renderer:
        'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER (0x000021C4) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      vendor: 'Google Inc. (NVIDIA)'
    },
    {
      renderer: 'ANGLE (AMD, AMD Radeon RX 6700 XT (0x000073DF) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      vendor: 'Google Inc. (AMD)'
    },
    {
      renderer: 'ANGLE (AMD, AMD Radeon RX 6600 (0x000073FF) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      vendor: 'Google Inc. (AMD)'
    },
    {
      renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      vendor: 'Google Inc. (Intel)'
    }
  ];
  const EXTENSIONS = [
    'ANGLE_instanced_arrays',
    'EXT_blend_minmax',
    'EXT_color_buffer_float',
    'EXT_disjoint_timer_query_webgl2',
    'EXT_float_blend',
    'EXT_texture_compression_bptc',
    'EXT_texture_compression_rgtc',
    'EXT_texture_filter_anisotropic',
    'OES_element_index_uint',
    'OES_fbo_render_mipmap',
    'OES_standard_derivatives',
    'OES_texture_float_linear',
    'OES_texture_half_float_linear',
    'OES_vertex_array_object',
    'WEBGL_color_buffer_float',
    'WEBGL_compressed_texture_s3tc',
    'WEBGL_debug_renderer_info',
    'WEBGL_debug_shaders',
    'WEBGL_lose_context',
    'WEBGL_multi_draw'
  ];
  const FONTS = [
    'Arial',
    'Arial Black',
    'Arial Narrow',
    'Bahnschrift',
    'Calibri',
    'Cambria',
    'Candara',
    'Comic Sans MS',
    'Consolas',
    'Courier New',
    'Franklin Gothic Medium',
    'Georgia',
    'Impact',
    'JetBrains Mono',
    'Lucida Console',
    'Lucida Sans Unicode',
    'Malgun Gothic',
    'Microsoft Sans Serif',
    'Palatino Linotype',
    'Roboto',
    'Segoe Print',
    'Segoe UI',
    'Segoe UI Light',
    'Segoe UI Semibold',
    'Tahoma',
    'Times New Roman',
    'Trebuchet MS',
    'Verdana',
    'Webdings',
    'Wingdings'
  ];
  const RESOLUTIONS = [
    [1920, 1080, 1920, 1080],
    [2560, 1440, 2560, 1440],
    [1536, 864, 1536, 864],
    [1366, 768, 1366, 768]
  ];
  const ALPHANUM = 'abcdefghijklmnopqrstuvwxyz0123456789#@&%*$';
  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

  const randomString = (length: number, alphabet: string) => {
    let out = '';
    for (let i = 0; i < length; i++) out += alphabet[randomInt(0, alphabet.length - 1)];
    return out;
  };
  const randomSubset = <T>(list: T[], min: number, max: number): T[] => {
    const size = randomInt(min, max);
    const copy = [...list];
    const result: T[] = [];
    for (let i = 0; i < size && copy.length; i++) {
      result.push(copy.splice(randomInt(0, copy.length - 1), 1)[0]);
    }
    return result;
  };

  const gpu = pick(GPUS);
  return {
    canvas: {
      value: {
        geometry: `data:image/png;base64,${randomString(60, BASE64)}`,
        text: randomString(40, ALPHANUM)
      }
    },
    webGlBasics: { value: { rendererUnmasked: gpu.renderer, vendorUnmasked: gpu.vendor } },
    webGlExtensions: { value: { extensions: randomSubset(EXTENSIONS, 5, 10) } },
    plugins: { value: ['PDF Viewer', 'Chrome PDF Viewer', 'Chromium PDF Viewer'] },
    fonts: { value: randomSubset(FONTS, 8, 15) },
    fontPreferences: { value: {} },
    screenResolution: { value: pick(RESOLUTIONS) },
    colorDepth: { value: 24 },
    deviceMemory: { value: pick([4, 8]) },
    hardwareConcurrency: { value: pick([4, 6, 8, 12, 16, 20, 24, 32]) },
    math: { value: 4 + randomInt(1, 9) * 0.00000000000001 },
    audio: { value: 120 + randomInt(0, 50000) / 10000 }
  };
}

// New profile: random visitorId and xhh (32 hex each, like the live values),
// hashes computed by formula W from a fresh synthetic component set.
// Components are NOT stored after hashing.
export async function generateProfile(): Promise<FingerprintProfile> {
  const components = generateComponents();
  return {
    id: randomHex(8),
    label: '',
    visitorId: randomHex(16),
    xhh: randomHex(16),
    hashes: await computeHashes(components)
  };
}

export interface StartUrlParams {
  origin: string;
  skillId: number | string;
  kind: string;
  methodId: number | string;
  skillCategory?: string;
  lastId: string;
  hhtmFrom?: string;
  hashes: FingerprintHashes;
  xhh: string;
  fingerprintjs: string;
}

// Full redirect_to_test URL (docs/hh.md §3). skillCategory: 'skills'|'langs'.
export function buildStartUrl({
  origin,
  skillId,
  kind,
  methodId,
  skillCategory = 'skills',
  lastId,
  hhtmFrom = PROTO.start.hhtmFrom,
  hashes,
  xhh,
  fingerprintjs
}: StartUrlParams): string {
  const params = new URLSearchParams();
  params.set('strict_hash', hashes.strict_hash);
  params.set('soft_hash', hashes.soft_hash);
  params.set('hardware_hash', hashes.hardware_hash);
  params.set('xhh', xhh);
  params.set('fingerprintjs', fingerprintjs);
  params.set('skill_id', String(skillId));
  params.set('kind', kind);
  params.set('id', String(methodId));
  params.set('origin', origin);
  params.set('skill_category', skillCategory);
  params.set('last_id', lastId);
  params.set('hhtmFrom', hhtmFrom);
  return `${PROTO.start.path}?${params.toString()}`;
}

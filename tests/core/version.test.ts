import { test, assert } from 'vitest';
import pkg from '../../package.json';
import manifest from '../../manifest.json';
import { APP_VERSION, getAppVersion } from '../../src/core/version.ts';

test('version: package.json, manifest.json and APP_VERSION are in sync', () => {
  assert.ok(pkg.version, 'package.json must have a version string');
  assert.equal(APP_VERSION, pkg.version, 'APP_VERSION must match package.json');
  assert.equal(manifest.version, pkg.version, 'manifest.json must match package.json');
});

test('version: getAppVersion returns runtime manifest version or APP_VERSION', () => {
  (globalThis as any).chrome = {
    runtime: {
      getManifest: () => ({ version: '3.1.4' })
    }
  };
  assert.equal(getAppVersion(), '3.1.4');

  (globalThis as any).chrome = undefined;
  assert.equal(getAppVersion(), APP_VERSION);
});

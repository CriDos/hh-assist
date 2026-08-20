import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version;

export function getAppVersion(): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
    return chrome.runtime.getManifest()?.version || APP_VERSION;
  }
  return APP_VERSION;
}

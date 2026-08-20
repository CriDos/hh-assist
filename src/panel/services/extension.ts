export const send = <T = any>(message: any): Promise<T> => {
  return new Promise(resolve => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(message, resolve);
    } else {
      resolve(null as any);
    }
  });
};

export { getAppVersion } from '../../core/version.ts';

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      return true;
    } catch {
      return false;
    }
  }
}

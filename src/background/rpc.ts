// Panel command dispatcher: a command table (name → handler) instead of a
// switch. installRpc registers one onMessage listener; the handler returns a
// value (a promise) — the wrapper responds with sendResponse and catches errors.

export type RpcCommandHandler = (message: any) => Promise<any> | any;

export function installRpc(commands: Record<string, RpcCommandHandler>) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const run = async () => {
      const command = commands[message?.type];
      if (!command) return { error: 'unknown command' };
      return command(message);
    };
    run()
      .then(sendResponse)
      .catch(error => sendResponse({ error: String(error?.message || error) }));
    return true; // async sendResponse
  });
}

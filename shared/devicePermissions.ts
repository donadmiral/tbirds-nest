export type DevicePermission = { granted: boolean; canAskAgain: boolean; status: string; accessPrivileges?: string };

/** Read the OS each time, so a grant revoked in Settings is never cached. Share
 * concurrent requests and serialize prompts across camera, microphone and photos. */
export function createPermissionBroker() {
  const pending = new Map<string, Promise<unknown>>();
  let promptTail: Promise<unknown> = Promise.resolve();
  return async function ensure<T extends DevicePermission>(
    key: string, read: () => Promise<T>, request: () => Promise<T>,
    accepted: (value: T) => boolean = value => value.granted,
  ): Promise<T> {
    const existing = pending.get(key);
    if (existing) { await existing; return read(); }
    const operation = (async () => {
      const current = await read();
      if (accepted(current) || !current.canAskAgain) return current;
      const prompt = promptTail.catch(() => undefined).then(async () => {
        // Another native feature may have granted access while this prompt waited.
        const latest = await read();
        return accepted(latest) || !latest.canAskAgain ? latest : request();
      });
      promptTail = prompt.then(() => undefined, () => undefined);
      return prompt;
    })();
    pending.set(key, operation);
    try { return await operation; }
    finally { if (pending.get(key) === operation) pending.delete(key); }
  };
}

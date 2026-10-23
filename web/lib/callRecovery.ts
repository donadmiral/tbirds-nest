/** A close intent contains no credentials or media. Group intents name one join
 * generation so a delayed retry cannot disconnect a later rejoin. */
export type CallCloseIntent = { id: string; is_group_call: boolean; provider_identity?: string };
type Pending = CallCloseIntent & { queued_at: number };
const PREFIX = 'pc:call-close:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const memory = new Map<string, Pending>();
const inFlight = new Map<string, Promise<void>>();
const MAX_AGE = 24 * 60 * 60 * 1000; // Server calls expire after at most six hours.

function storage(): Storage | undefined {
  try { return typeof window !== 'undefined' ? window.localStorage : undefined; } catch { return undefined; }
}
function keyFor(account: string, value: CallCloseIntent) {
  return PREFIX + account + ':' + value.id + ':' + (value.is_group_call ? value.provider_identity : 'direct');
}
function valid(value: Pending): boolean {
  return !!value && UUID.test(value.id) && typeof value.is_group_call === 'boolean'
    && (!value.is_group_call || UUID.test(value.provider_identity ?? ''))
    && Number.isFinite(value.queued_at) && value.queued_at <= Date.now() + 60000
    && value.queued_at > Date.now() - MAX_AGE;
}
function remove(key: string) {
  memory.delete(key);
  try { storage()?.removeItem(key); } catch { /* Memory recovery still works. */ }
}

export function queueCallClose(account: string, value: CallCloseIntent): boolean {
  const pending: Pending = { id: value.id, is_group_call: value.is_group_call,
    ...(value.is_group_call ? { provider_identity: value.provider_identity } : {}), queued_at: Date.now() };
  if (!UUID.test(account) || !valid(pending)) return false;
  const key = keyFor(account, pending);
  // One key per intent prevents unrelated tabs from overwriting each other's work.
  memory.set(key, pending);
  try { storage()?.setItem(key, JSON.stringify(pending)); } catch { /* Retain in memory if storage is unavailable. */ }
  return true;
}

export function pendingCallCloses(account: string): CallCloseIntent[] {
  if (!UUID.test(account)) return [];
  const prefix = PREFIX + account + ':';
  const disk = storage();
  if (disk) {
    try {
      const keys = Array.from({ length: disk.length }, (_, index) => disk.key(index)).filter((key): key is string => !!key && key.startsWith(prefix));
      for (const key of keys) {
        try {
          const value = JSON.parse(disk.getItem(key) ?? 'null') as Pending;
          if (valid(value) && keyFor(account, value) === key) memory.set(key, value);
          else remove(key);
        } catch { remove(key); }
      }
    } catch { /* Fall back to this tab's pending operations. */ }
  }
  const rows: Pending[] = [];
  for (const [key, value] of memory) {
    if (!key.startsWith(prefix)) continue;
    if (!valid(value)) remove(key); else rows.push(value);
  }
  return rows.sort((a, b) => a.queued_at - b.queued_at).slice(0, 100);
}

export async function flushPendingCallCloses(account: string, isCurrent: () => boolean,
  close: (intent: CallCloseIntent) => Promise<void>): Promise<boolean> {
  for (const intent of pendingCallCloses(account)) {
    if (!isCurrent()) return false;
    const key = keyFor(account, intent);
    let operation = inFlight.get(key);
    if (!operation) {
      operation = (async () => {
        if (!isCurrent()) return;
        try { await close(intent); remove(key); } catch { /* Retry when connectivity returns. */ }
      })();
      inFlight.set(key, operation);
      void operation.finally(() => { if (inFlight.get(key) === operation) inFlight.delete(key); });
    }
    await operation;
  }
  return isCurrent() && pendingCallCloses(account).length === 0;
}

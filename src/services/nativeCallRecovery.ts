import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { callService } from './callService';

type PendingClose = {
  callId: string;
  group: boolean;
  providerIdentity?: string;
  duration: number;
};

// This queue contains only call identifiers, never room credentials or messages.
// Keep the actor in the key so signing in as another person cannot replay it.
const chains = new Map<string, Promise<void>>();
const memory = new Map<string, PendingClose[]>();
const keyFor = (actor: string) => `platinum:pending-call-close:v1:${actor}`;

export async function settleCallOperation<T>(operation: PromiseLike<T>, timeoutMs = 10000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Call operation timed out')), timeoutMs); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

function serial(actor: string, operation: () => Promise<void>): Promise<void> {
  const next = (chains.get(actor) ?? Promise.resolve()).catch(() => {}).then(operation);
  chains.set(actor, next);
  void next.finally(() => { if (chains.get(actor) === next) chains.delete(actor); }).catch(() => {});
  return next;
}

async function read(actor: string): Promise<PendingClose[]> {
  if (memory.has(actor)) return memory.get(actor)!;
  const raw = await AsyncStorage.getItem(keyFor(actor));
  let rows: PendingClose[] = [];
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    if (Array.isArray(parsed)) rows = parsed.filter((entry): entry is PendingClose =>
      !!entry && typeof entry.callId === 'string' && entry.callId.length > 0 &&
      typeof entry.group === 'boolean' && (!entry.group || typeof entry.providerIdentity === 'string') &&
      Number.isFinite(entry.duration) && entry.duration >= 0);
  } catch { /* A corrupt local queue cannot authorize a server mutation. */ }
  memory.set(actor, rows);
  return rows;
}

async function save(actor: string, rows: PendingClose[]) {
  memory.set(actor, rows);
  await AsyncStorage.setItem(keyFor(actor), JSON.stringify(rows));
}

export function queueNativeCallClose(actor: string, entry: PendingClose): Promise<void> {
  if (!actor || !entry.callId) return Promise.resolve();
  if (entry.group && !entry.providerIdentity) {
    // Before admission we may dismiss only an invitation. The server's decline
    // operation cannot remove a joined membership on this or another device.
    return (async () => {
      const { data } = await settleCallOperation(supabase.auth.getSession());
      if (data.session?.user.id === actor) await settleCallOperation(callService.declineGroupCall(entry.callId, actor));
    })();
  }
  return serial(actor, async () => {
    const rows = await read(actor);
    const old = rows.find(row => row.callId === entry.callId);
    const next = { ...entry, duration: Math.max(old?.duration ?? 0, Math.floor(entry.duration)) };
    await save(actor, [...rows.filter(row => row.callId !== entry.callId), next]);
  });
}

export function flushNativeCallCloses(actor: string): Promise<void> {
  if (!actor) return Promise.resolve();
  return serial(actor, async () => {
    const rows = [...await read(actor)];
    for (const entry of rows) {
      // Recheck before every write; a queue can outlive its original session.
      const { data } = await settleCallOperation(supabase.auth.getSession());
      if (data.session?.user.id !== actor) return;
      if (entry.group) {
        await settleCallOperation(callService.leaveGroupCallMembership(entry.callId, entry.providerIdentity!));
      } else {
        const record = await settleCallOperation(callService.getCall(entry.callId));
        if (!record) throw new Error('Call status unavailable');
        if (record.status === 'ringing' || record.status === 'active') {
          const current = await settleCallOperation(supabase.auth.getSession());
          if (current.data.session?.user.id !== actor) return;
          // Acceptance can win the race with hangup before the media connects.
          const closed = await settleCallOperation(record.status === 'active'
            ? callService.endCall(entry.callId, entry.duration)
            : callService.markMissed(entry.callId));
          if (!closed) throw new Error('Call close not confirmed');
        }
      }
      await settleCallOperation(callService.recordCallEvent(entry.callId));
      await save(actor, (await read(actor)).filter(row => row.callId !== entry.callId));
    }
  });
}

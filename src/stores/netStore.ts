/**
 * Connection truth and the message outbox - pure JavaScript, no native
 * modules, Expo Go proof. Reachability = a tiny request to our own
 * Supabase on foreground/recovery (any HTTP response means the network is
 * alive), and actual request outcomes keep it current without idle polls. Text
 * messages that fail on a dead network wait here (persisted, surviving
 * restarts) and send themselves the moment the connection returns. The
 * chat's own reconciliation absorbs the delivered copy.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { deliverMessage, type MessageIntent, type MessageReceipt } from '../../shared/messageDelivery';
import { createNetworkRecovery } from '../../shared/networkRecovery';
import { subscribeNetworkActivity } from '../../shared/networkActivity';

const PING_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || '') + '/auth/v1/health';
// Serialize persistence so senders can wait for their ID to be durable before
// making a request. A failed save prevents that request from being attempted.
let outboxWrite: Promise<void> = Promise.resolve();
let hydrationError: Error | null = null;
const hydrationFailures = new Set<(error: Error) => void>();
const outboxStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => {
    outboxWrite = outboxWrite.catch(() => {}).then(() => AsyncStorage.setItem(key, value));
    return outboxWrite;
  },
  removeItem: (key: string) => {
    outboxWrite = outboxWrite.catch(() => {}).then(() => AsyncStorage.removeItem(key));
    return outboxWrite;
  },
};

type QueuedMessage = MessageIntent & {
  key: string;
  owner_auth_id: string;
  queued_at: number;
  failed?: boolean;
};

type NetState = {
  online: boolean;
  outbox: QueuedMessage[];
  confirmed: { owner_auth_id: string; message: MessageReceipt }[];
  setOnline: (v: boolean) => void;
  enqueue: (m: Omit<QueuedMessage, 'key' | 'queued_at'>) => Promise<void>;
  removeFromOutbox: (key: string) => void;
  setOutboxFailed: (key: string, failed: boolean) => void;
  confirmOutboxMessage: (key: string, message: MessageReceipt) => void;
};

export const useNetStore = create<NetState>()(
  persist(
    (set) => ({
      online: true,
      outbox: [],
      confirmed: [],
      setOnline: (v) => { if (useNetStore.persist.hasHydrated() && useNetStore.getState().online !== v) set({ online: v }); },
      enqueue: async (m) => {
        await waitForOutboxHydration();
        set((s) => ({
          outbox: s.outbox.some(item => item.id === m.id) ? s.outbox : [...s.outbox, { ...m, key: m.id, queued_at: Date.now() }],
        }));
        try { await outboxWrite; }
        catch (error) {
          set(s => ({ outbox: s.outbox.filter(item => item.id !== m.id) }));
          await outboxWrite.catch(() => {});
          throw error;
        }
        recovery?.workQueued();
      },
      removeFromOutbox: (key) => set((s) => ({ outbox: s.outbox.filter((x) => x.key !== key) })),
      setOutboxFailed: (key, failed) => set(s => ({ outbox: s.outbox.map(item => item.key === key ? { ...item, failed } : item) })),
      confirmOutboxMessage: (key, message) => set(s => {
        const item = s.outbox.find(value => value.key === key);
        if (!item) return s;
        return {
          outbox: s.outbox.filter(value => value.key !== key),
          confirmed: [...s.confirmed.slice(-49), { owner_auth_id: item.owner_auth_id, message }],
        };
      }),
    }),
    {
      name: 'pc-outbox',
      storage: createJSONStorage(() => outboxStorage),
      partialize: (s) => ({ outbox: s.outbox }) as any,
      onRehydrateStorage: () => {
        hydrationError = null;
        return (_state, error) => {
          if (!error) return;
          hydrationError = new Error('Your saved messages could not be loaded. Please reopen the app.');
          hydrationFailures.forEach(fail => fail(hydrationError!));
        };
      },
    }
  )
);

export async function waitForOutboxHydration(): Promise<void> {
  if (useNetStore.persist.hasHydrated()) return;
  if (hydrationError) throw hydrationError;
  await new Promise<void>((resolve, reject) => {
    let unsubscribe = () => {};
    const cleanup = () => { clearTimeout(timeout); unsubscribe(); hydrationFailures.delete(fail); };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const timeout = setTimeout(() => fail(new Error('Your saved messages could not be loaded. Please reopen the app.')), 10000);
    hydrationFailures.add(fail);
    unsubscribe = useNetStore.persist.onFinishHydration(() => { cleanup(); resolve(); });
  });
}

export async function retryOutboxMessage(key: string): Promise<void> {
  await waitForOutboxHydration();
  if (flushing) throw new Error('Another delivery check is running. Please try again.');
  useNetStore.getState().setOutboxFailed(key, false);
  if (await flushOutbox(key)) recovery?.workQueued();
}

let started = false;
let flushing = false;
let recovery: ReturnType<typeof createNetworkRecovery> | undefined;

async function flushOutbox(preferredKey?: string) {
  if (flushing) return true;
  flushing = true;
  let pending = false;
  let lastOwner: string | undefined;
  try {
    await waitForOutboxHydration();
    await outboxWrite;
    const { supabase } = require('../services/supabase');
    for (let attempted = 0; attempted < 20; attempted++) {
      if (started && AppState.currentState !== 'active') break;
      const { data: session, error: sessionError } = await supabase.auth.getSession();
      const owner = session?.session?.user?.id;
      if (sessionError) { pending = true; break; }
      if (!owner) break;
      lastOwner = owner;
      // Old outbox entries have no stable ID and cannot safely be replayed.
      const item = useNetStore.getState().outbox.find(value => value.owner_auth_id === owner && value.id && !value.failed && (!preferredKey || value.key === preferredKey));
      if (!item) break;
      const { key: _key, queued_at: _time, owner_auth_id: _owner, failed: _failed, ...intent } = item;
      const result = await deliverMessage(supabase, intent, true);
      // Preserve both uncertain and denied messages for the user to review.
      if (result.status === 'pending') { pending = true; break; }
      if (result.status !== 'confirmed') { useNetStore.getState().setOutboxFailed(item.key, true); continue; }
      useNetStore.getState().confirmOutboxMessage(item.key, result.row);
    }
    if (lastOwner) pending ||= useNetStore.getState().outbox.some(value => value.owner_auth_id === lastOwner && value.id && !value.failed && (!preferredKey || value.key === preferredKey));
  } catch {
    pending = true;
  } finally {
    flushing = false;
  }
  return pending;
}

export function initNet() {
  if (started) return;
  started = true;
  recovery = createNetworkRecovery({
    active: AppState.currentState === 'active',
    probe: async signal => { await fetch(PING_URL, { method: 'GET', signal, cache: 'no-store' as any }); },
    hasWork: () => useNetStore.persist.hasHydrated() && useNetStore.getState().outbox.some(item => item.id && !item.failed),
    flush: () => flushOutbox(),
    setOnline: value => useNetStore.getState().setOnline(value),
  });
  subscribeNetworkActivity(success => recovery?.outcome(success));
  AppState.addEventListener('change', state => recovery?.setActive(state === 'active'));
  // Persist hydration can complete after the first reachable response.
  void waitForOutboxHydration().then(() => recovery?.workQueued(), () => {});
  recovery.start();
}

/** Called by senders on a failed request for an instant offline verdict. */
export function reportSendFailure() { recovery?.outcome(false); }

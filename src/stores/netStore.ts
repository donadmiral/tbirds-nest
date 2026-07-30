/**
 * Connection truth and the message outbox - pure JavaScript, no native
 * modules, Expo Go proof. Reachability = a tiny request to our own
 * Supabase every few seconds (any HTTP response means the network is
 * alive); the app foregrounding triggers an immediate check. Text
 * messages that fail on a dead network wait here (persisted, surviving
 * restarts) and send themselves the moment the connection returns. The
 * chat's own reconciliation absorbs the delivered copy.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

const PING_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || '') + '/auth/v1/health';

type QueuedMessage = {
  key: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string | null;
  text: string;
  reply_to_id: string | null;
  queued_at: number;
};

type NetState = {
  online: boolean;
  outbox: QueuedMessage[];
  setOnline: (v: boolean) => void;
  enqueue: (m: Omit<QueuedMessage, 'key' | 'queued_at'>) => void;
  removeFromOutbox: (key: string) => void;
};

export const useNetStore = create<NetState>()(
  persist(
    (set) => ({
      online: true,
      outbox: [],
      setOnline: (v) => set({ online: v }),
      enqueue: (m) =>
        set((s) => ({
          outbox: [...s.outbox, { ...m, key: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), queued_at: Date.now() }],
        })),
      removeFromOutbox: (key) => set((s) => ({ outbox: s.outbox.filter((x) => x.key !== key) })),
    }),
    {
      name: 'pc-outbox',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ outbox: s.outbox }) as any,
    }
  )
);

let started = false;
let flushing = false;

async function flushOutbox() {
  if (flushing) return;
  flushing = true;
  try {
    const { supabase } = require('../services/supabase');
    while (true) {
      const item = useNetStore.getState().outbox[0];
      if (!item) break;
      const { error } = await supabase.from('messages').insert([{
        conversation_id: item.conversation_id,
        text: item.text,
        sender_id: item.sender_id,
        receiver_id: item.receiver_id,
        reply_to_id: item.reply_to_id,
      }]);
      useNetStore.getState().removeFromOutbox(item.key);
      if (error) continue;
    }
  } catch {
  } finally {
    flushing = false;
  }
}

async function probe(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    await fetch(PING_URL, { method: 'GET', signal: ctrl.signal, cache: 'no-store' as any });
    clearTimeout(timer);
    return true;
  } catch {
    return false;
  }
}

async function check() {
  const on = await probe();
  const was = useNetStore.getState().online;
  useNetStore.getState().setOnline(on);
  if (on && (!was || useNetStore.getState().outbox.length > 0)) flushOutbox();
}

export function initNet() {
  if (started) return;
  started = true;
  check();
  setInterval(check, 5000);
  AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
}

/** Called by senders on a failed request for an instant offline verdict. */
export function reportSendFailure() { check(); }
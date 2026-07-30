/**
 * Connection truth and the message outbox. expo-network (built into
 * Expo Go) tells us whether the network is alive; text messages that
 * fail on a dead network wait here (persisted, surviving restarts) and
 * send themselves the moment the connection returns. The chat's own
 * reconciliation absorbs the delivered copy, so nothing renders twice.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Network from 'expo-network';

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

function apply(s: any) {
  const on = (s?.isConnected ?? true) !== false && s?.isInternetReachable !== false;
  const was = useNetStore.getState().online;
  useNetStore.getState().setOnline(on);
  if (on && (!was || useNetStore.getState().outbox.length > 0)) flushOutbox();
}

export function initNet() {
  if (started) return;
  started = true;
  try {
    const sub = (Network as any).addNetworkStateListener?.((s: any) => apply(s));
    if (!sub) throw new Error('no listener api');
  } catch {
    setInterval(async () => { try { apply(await Network.getNetworkStateAsync()); } catch {} }, 4000);
  }
  Network.getNetworkStateAsync().then(apply).catch(() => {});
}
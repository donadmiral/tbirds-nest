/**
 * lockStore - the optional Face ID app lock.
 * enabled persists on the device only; locked is runtime state.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'pc-applock';

type LockState = {
  enabled: boolean | null;
  locked: boolean;
  init: () => Promise<void>;
  setEnabled: (on: boolean) => Promise<void>;
  unlock: () => void;
  relock: () => void;
};

export const useLockStore = create<LockState>((set, get) => ({
  enabled: null,
  locked: true,
  init: async () => {
    try {
      const v = await AsyncStorage.getItem(KEY);
      const on = v === '1';
      set({ enabled: on, locked: on });
    } catch {
      set({ enabled: false, locked: false });
    }
  },
  setEnabled: async (on) => {
    set({ enabled: on, locked: false });
    try { await AsyncStorage.setItem(KEY, on ? '1' : '0'); } catch {}
  },
  unlock: () => set({ locked: false }),
  relock: () => { if (get().enabled === true) set({ locked: true }); },
}));

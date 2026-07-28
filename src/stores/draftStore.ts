/**
 * draftStore — per-conversation composer drafts, persisted locally.
 * WhatsApp model: a draft survives app restarts, shows in the list,
 * and dies the moment the message is sent or the field is emptied.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

type DraftState = {
  drafts: Record<string, string>;
  openedTimes: Record<string, number>;
  markOpened: (convId: string) => void;
  setDraft: (convId: string, text: string) => void;
  clearDraft: (convId: string) => void;
};

export const useDraftStore = create<DraftState>()(
  persist(
    (set) => ({
      drafts: {},
      openedTimes: {},
      markOpened: (convId) => set(s => ({ openedTimes: { ...s.openedTimes, [convId]: Date.now() } })),
      setDraft: (convId, text) => set(s => {
        const next = { ...s.drafts };
        if (text.trim()) next[convId] = text; else delete next[convId];
        return { drafts: next };
      }),
      clearDraft: (convId) => set(s => {
        const next = { ...s.drafts };
        delete next[convId];
        return { drafts: next };
      }),
    }),
    { name: 'pc-drafts', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
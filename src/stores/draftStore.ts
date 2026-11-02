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
  mentionAmnesty: Record<string, number>;
  ensureMentionAmnesty: (owner: string) => number;
  markOpened: (convId: string) => void;
  setDraft: (convId: string, text: string) => void;
  clearDraft: (convId: string) => void;
};

export const useDraftStore = create<DraftState>()(
  persist(
    (set, get) => ({
      drafts: {},
      openedTimes: {},
      mentionAmnesty: {},
      ensureMentionAmnesty: (owner) => {
        const known = get().mentionAmnesty[owner];
        if (known !== undefined) return known;
        // A per-owner cutoff also covers conversations loaded on a later
        // page. Established opened clocks keep their existing semantics.
        const cutoff = Object.keys(get().openedTimes).length === 0 ? Date.now() : 0;
        set(s => ({ mentionAmnesty: { ...s.mentionAmnesty, [owner]: cutoff } }));
        return cutoff;
      },
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

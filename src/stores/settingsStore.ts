/**
 * settingsStore — device-level preferences, persisted locally.
 * These are things only THIS phone cares about (data usage, appearance),
 * deliberately separate from profiles (identity/visibility, RLS-relevant).
 * Zimbabwe priority: expensive mobile data makes silent autoplay an
 * uninstall reason, so autoplay ships default-ON for wifi-feel but visible.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

type AppSettings = {
  autoplayVideos: boolean;
  uploadQuality: 'high' | 'data-saver';
  darkMode: boolean; // groundwork — consumers arrive with the dark-mode pass
  set: (patch: Partial<Omit<AppSettings, 'set'>>) => void;
};

export const useSettingsStore = create<AppSettings>()(
  persist(
    (set) => ({
      autoplayVideos: true,
      uploadQuality: 'high',
      darkMode: false,
      set: (patch) => set(patch),
    }),
    { name: 'pc-app-settings', storage: createJSONStorage(() => AsyncStorage) },
  ),
);
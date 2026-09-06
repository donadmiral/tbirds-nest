/**
 * Theme mode: System follows the phone, Light and Dark override it.
 * The mode persists on the device; the resolved value is what screens use.
 */
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance } from 'react-native';

export type ThemeMode = 'system' | 'light' | 'dark';
type Resolved = 'light' | 'dark';

type State = {
  mode: ThemeMode;
  system: Resolved;
  resolved: Resolved;
  init: () => Promise<void>;
  setMode: (m: ThemeMode) => Promise<void>;
};

const KEY = 'pc.theme.mode';
const systemNow = (): Resolved => (Appearance.getColorScheme() === 'dark' ? 'dark' : 'light');
const resolve = (mode: ThemeMode, system: Resolved): Resolved => (mode === 'system' ? system : mode);

export const useThemeStore = create<State>((set, get) => ({
  mode: 'system',
  system: systemNow(),
  resolved: systemNow(),
  init: async () => {
    try {
      const v = await AsyncStorage.getItem(KEY);
      const mode: ThemeMode = v === 'light' || v === 'dark' ? v : 'system';
      set({ mode, resolved: resolve(mode, get().system) });
    } catch {}
  },
  setMode: async (m) => {
    set({ mode: m, resolved: resolve(m, get().system) });
    try { await AsyncStorage.setItem(KEY, m); } catch {}
  },
}));

Appearance.addChangeListener(({ colorScheme }) => {
  const system: Resolved = colorScheme === 'dark' ? 'dark' : 'light';
  const st = useThemeStore.getState();
  useThemeStore.setState({ system, resolved: resolve(st.mode, system) });
});
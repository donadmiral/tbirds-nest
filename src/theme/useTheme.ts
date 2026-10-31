/**
 * The one door to the active palette.
 *
 *   const { t, isDark } = useTheme();            // read colours in render
 *   const s = useThemedStyles(t => ({ ... }));   // styles that follow the theme
 *   getTheme()                                    // outside React (services, navigation)
 *
 * Both palettes share one shape, so a screen written against `t` needs no
 * knowledge of which mode is on.
 */
import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { light } from '../constants/tokens/light';
import { dark } from '../constants/tokens/dark';
import { lightsOut } from '../constants/tokens/lightsOut';
import { useThemeStore } from '../stores/themeStore';

export type Theme = typeof light;

export function useTheme(): { t: Theme; isDark: boolean } {
  const palette = useThemeStore(s => s.resolved === 'dark' ? (s.mode === 'lightsOut' ? 'lightsOut' : 'dark') : 'light');
  return { t: (palette === 'lightsOut' ? lightsOut : palette === 'dark' ? dark : light) as Theme, isDark: palette !== 'light' };
}

export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(factory: (t: Theme, isDark: boolean) => T): T {
  const { t, isDark } = useTheme();
  return useMemo(() => StyleSheet.create(factory(t, isDark)), [t, isDark, factory]);
}

export function getTheme(): Theme {
  const state = useThemeStore.getState();
  return (state.resolved === 'light' ? light : state.mode === 'lightsOut' ? lightsOut : dark) as Theme;
}
/**
 * A style sheet that follows the theme without changing how screens use it.
 * Both palettes are built once; every property read resolves to the active
 * one, so `s.card` is the dark card when the theme is dark. Screens keep
 * `const s = themedSheet(t => ({ ... }))` at module level exactly as before.
 */
export function themedSheet<T extends StyleSheet.NamedStyles<T>>(factory: (t: Theme) => T): T {
  const lightSheet = StyleSheet.create(factory(light));
  const darkSheet = StyleSheet.create(factory(dark as unknown as Theme));
  const blackSheet = StyleSheet.create(factory(lightsOut as unknown as Theme));
  return new Proxy(lightSheet, {
    get(_target, key) {
      const state = useThemeStore.getState();
      const active = state.resolved === 'light' ? lightSheet : state.mode === 'lightsOut' ? blackSheet : darkSheet;
      return (active as any)[key as any];
    },
  }) as T;
}

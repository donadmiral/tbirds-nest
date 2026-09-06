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
import { useThemeStore } from '../stores/themeStore';

export type Theme = typeof light;

export function useTheme(): { t: Theme; isDark: boolean } {
  const resolved = useThemeStore(s => s.resolved);
  return { t: resolved === 'dark' ? (dark as unknown as Theme) : light, isDark: resolved === 'dark' };
}

export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(factory: (t: Theme, isDark: boolean) => T): T {
  const { t, isDark } = useTheme();
  return useMemo(() => StyleSheet.create(factory(t, isDark)), [t, isDark, factory]);
}

export function getTheme(): Theme {
  return useThemeStore.getState().resolved === 'dark' ? (dark as unknown as Theme) : light;
}
/**
 * Safe areas that are right on every device and in every presentation.
 *
 * The library's SafeAreaView reads the inset the screen's own view reports,
 * and a screen presented as a native modal on iOS reports zero, which puts
 * headers under the status bar. The rule here takes the largest of three
 * measurements: the live inset, the root window's inset measured at launch
 * (the physical notch, never zero on a notched phone), and on Android the
 * status bar height. The bottom does the same for the home indicator.
 *
 * Every screen imports SafeAreaView and useSafeAreaInsets from here.
 */
import React from 'react';
import { View, ViewProps, Platform, StatusBar } from 'react-native';
import { useSafeAreaInsets as useLiveInsets, initialWindowMetrics } from 'react-native-safe-area-context';

export type SafeEdge = 'top' | 'bottom' | 'left' | 'right';
export type SafeInsets = { top: number; bottom: number; left: number; right: number };

export function useSafeAreaInsets(): SafeInsets {
  const live = useLiveInsets();
  const init = initialWindowMetrics?.insets;
  const androidTop = Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0;
  return {
    top: Math.max(live.top, init?.top ?? 0, androidTop),
    bottom: Math.max(live.bottom, init?.bottom ?? 0),
    left: Math.max(live.left, init?.left ?? 0),
    right: Math.max(live.right, init?.right ?? 0),
  };
}

export function SafeAreaView({ edges = ['top', 'bottom', 'left', 'right'], style, children, ...rest }: ViewProps & { edges?: SafeEdge[]; children?: React.ReactNode }) {
  const i = useSafeAreaInsets();
  const pad = {
    paddingTop: edges.includes('top') ? i.top : 0,
    paddingBottom: edges.includes('bottom') ? i.bottom : 0,
    paddingLeft: edges.includes('left') ? i.left : 0,
    paddingRight: edges.includes('right') ? i.right : 0,
  };
  return <View style={[pad, style]} {...rest}>{children}</View>;
}
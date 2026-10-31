import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { BottomTabBar, BottomTabBarProps } from '@react-navigation/bottom-tabs';

const anim = new Animated.Value(0);
let state = 0;
let lastY = 0;
let keepVisible = true;

function go(to: number) {
  if (keepVisible) return;
  if (state === to) return;
  state = to;
  Animated.spring(anim, { toValue: to, useNativeDriver: true, tension: 70, friction: 12 }).start();
}

export function handleTabBarScroll(e: any) {
  const y = e?.nativeEvent?.contentOffset?.y ?? 0;
  const dy = y - lastY;
  lastY = y;
  if (y <= 0) { go(0); return; }
  if (dy > 6) go(1);
  else if (dy < -6) go(0);
}

export default function AdaptiveTabBar({ keepVisible: alwaysVisible = false, ...props }: BottomTabBarProps & { keepVisible?: boolean }) {
  const focusedStyle = StyleSheet.flatten(props.descriptors[props.state.routes[props.state.index].key].options.tabBarStyle);
  const height = focusedStyle && 'height' in focusedStyle ? focusedStyle.height : undefined;
  const bottom = focusedStyle && 'bottom' in focusedStyle ? focusedStyle.bottom : undefined;
  const floating = focusedStyle && 'position' in focusedStyle && focusedStyle.position === 'absolute';
  // The floating bar is absolute, so it cannot size this animated parent.
  // Give its native accessibility container bounds that include the buttons.
  const frame = !floating ? undefined : typeof height === 'number' && Number.isFinite(height) && height > 0 &&
    typeof bottom === 'number' && Number.isFinite(bottom) && bottom >= 0
    ? { position: 'absolute' as const, left: 0, right: 0, bottom: 0, height: height + bottom }
    : StyleSheet.absoluteFillObject;
  React.useEffect(() => {
    keepVisible = alwaysVisible;
    anim.stopAnimation();
    anim.setValue(0);
    state = 0;
    lastY = 0;
    return () => {
      keepVisible = true;
      anim.stopAnimation();
      anim.setValue(0);
      state = 0;
      lastY = 0;
    };
  }, [alwaysVisible]);
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[frame, !alwaysVisible && {
        transform: [
          { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 150] }) },
          { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] }) },
        ],
      }]}
    >
      <BottomTabBar {...props} />
    </Animated.View>
  );
}

import React from 'react';
import { Animated } from 'react-native';
import { BottomTabBar, BottomTabBarProps } from '@react-navigation/bottom-tabs';

const anim = new Animated.Value(0);
let state = 0;
let lastY = 0;

function go(to: number) {
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

export default function AdaptiveTabBar(props: BottomTabBarProps) {
  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        transform: [
          { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 150] }) },
          { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] }) },
        ],
      }}
    >
      <BottomTabBar {...props} />
    </Animated.View>
  );
}
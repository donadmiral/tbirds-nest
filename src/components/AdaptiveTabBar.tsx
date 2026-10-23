import React from 'react';
import { Animated } from 'react-native';
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
      style={alwaysVisible ? undefined : {
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

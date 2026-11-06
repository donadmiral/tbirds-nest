import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { BottomTabBar, BottomTabBarProps } from '@react-navigation/bottom-tabs';

const anim = new Animated.Value(0);
let state = 0;
let lastY: number | null = 0;
let direction = 0;
let travel = 0;
let keepVisible = true;
const SCROLL_TRAVEL = 12;

function resetScroll(y: number | null = 0) {
  lastY = y;
  direction = 0;
  travel = 0;
}

function go(to: number) {
  if (keepVisible) return;
  if (state === to) return;
  state = to;
  Animated.spring(anim, { toValue: to, useNativeDriver: true, tension: 70, friction: 12 }).start();
}

export function handleTabBarScroll(e: any) {
  const event = e?.nativeEvent;
  const offset = event?.contentOffset?.y;
  if (typeof offset !== 'number' || !Number.isFinite(offset)) return;
  const height = event?.contentSize?.height;
  const viewport = event?.layoutMeasurement?.height;
  const bottomInset = event?.contentInset?.bottom;
  const maximum = typeof height === 'number' && Number.isFinite(height)
    && typeof viewport === 'number' && Number.isFinite(viewport) && viewport > 0
    ? Math.max(0, height - viewport + (typeof bottomInset === 'number' && Number.isFinite(bottomInset) ? bottomInset : 0)) : Infinity;
  // Rubber-band movement is not an intentional change of scroll direction.
  const y = Math.max(0, Math.min(offset, maximum));
  if (keepVisible) { resetScroll(y); return; }
  if (y === 0) { resetScroll(0); go(0); return; }
  // A newly focused tab can restore a nonzero offset. Establish its baseline
  // instead of interpreting another screen's position as a large gesture.
  if (lastY === null) { resetScroll(y); return; }
  const dy = y - lastY;
  lastY = y;
  if (dy === 0) return;
  const nextDirection = dy > 0 ? 1 : -1;
  if (nextDirection !== direction) { direction = nextDirection; travel = 0; }
  travel += Math.abs(dy);
  // Accumulating distance makes the response independent of event frequency
  // and finger speed. Small reversals start fresh rather than causing jitter.
  if (travel >= SCROLL_TRAVEL) { travel = 0; go(direction > 0 ? 1 : 0); }
}

export default function AdaptiveTabBar({ keepVisible: alwaysVisible = false, ...props }: BottomTabBarProps & { keepVisible?: boolean }) {
  const focusedRouteKey = props.state.routes[props.state.index].key;
  const previousRoute = React.useRef(focusedRouteKey);
  const focusedStyle = StyleSheet.flatten(props.descriptors[focusedRouteKey].options.tabBarStyle);
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
    const routeChanged = previousRoute.current !== focusedRouteKey;
    previousRoute.current = focusedRouteKey;
    keepVisible = alwaysVisible;
    anim.stopAnimation();
    anim.setValue(0);
    state = 0;
    resetScroll(routeChanged ? null : 0);
    return () => {
      keepVisible = true;
      anim.stopAnimation();
      anim.setValue(0);
      state = 0;
      resetScroll();
    };
  }, [alwaysVisible, focusedRouteKey]);
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

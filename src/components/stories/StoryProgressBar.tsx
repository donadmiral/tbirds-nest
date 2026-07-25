/**
 * StoryProgressBar - Instagram construction.
 * Thin segmented bar at the very top. One segment per story.
 * Past segments are full, the current one fills with progress, the rest are empty.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import ReAnimated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';

type Props = {
  progressSV: SharedValue<number>;
  currentIndex: number;
  totalStories: number;
  chromeOpacity: SharedValue<number>;
  topInset: number;
  isPaused?: boolean;
  bottomInset?: number;
};

function Segment({ index, currentIndex, progressSV }: { index: number; currentIndex: number; progressSV: SharedValue<number> }) {
  const fill = useAnimatedStyle(() => {
    let pct = 0;
    if (index < currentIndex) pct = 1;
    else if (index === currentIndex) pct = progressSV.value;
    const clamped = pct < 0 ? 0 : pct > 1 ? 1 : pct;
    return { width: ((clamped * 100) + '%') as any };
  }, [index, currentIndex]);

  return (
    <View style={s.track}>
      <ReAnimated.View style={[s.fill, fill]} />
    </View>
  );
}

export default function StoryProgressBar({ progressSV, currentIndex, totalStories, chromeOpacity, topInset }: Props) {
  const wrap = useAnimatedStyle(() => ({ opacity: chromeOpacity.value }));
  if (!totalStories || totalStories < 1) return null;
  return (
    <ReAnimated.View pointerEvents="none" style={[s.wrap, { top: topInset + 10 }, wrap]}>
      {Array.from({ length: totalStories }).map((_, i) => (
        <Segment key={i} index={i} currentIndex={currentIndex} progressSV={progressSV} />
      ))}
    </ReAnimated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 8, right: 8, flexDirection: 'row', gap: 3, zIndex: 40 },
  track: { flex: 1, height: 2.5, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.34)', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  fill: { height: '100%', borderRadius: 2, backgroundColor: '#FFFFFF' },
});
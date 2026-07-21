/**
 * Skeleton — Shared loading placeholder primitives
 *
 * Usage:
 *   <SkeletonLine width={120} height={14} />
 *   <SkeletonCircle size={42} />
 *   <SkeletonBlock width="100%" height={200} radius={12} />
 *
 * All primitives use a subtle opacity pulse (0.3 to 0.6)
 * to communicate "content arriving" without visual noise.
 *
 * No shimmer gradient. Pulse is calmer and more premium.
 * Aligned with warm nocturnal calm temperature.
 */

import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';

const PULSE_MIN = 0.3;
const PULSE_MAX = 0.6;
const PULSE_DURATION = 900;
const SKELETON_COLOR = '#E8E8ED';

function usePulse() {
  const anim = useRef(new Animated.Value(PULSE_MIN)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: PULSE_MAX, duration: PULSE_DURATION, useNativeDriver: true }),
        Animated.timing(anim, { toValue: PULSE_MIN, duration: PULSE_DURATION, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  return anim;
}

export function SkeletonLine({ width = 100, height = 12, style }: { width?: number | string; height?: number; style?: any }) {
  const opacity = usePulse();
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: height / 2, backgroundColor: SKELETON_COLOR, opacity },
        style,
      ]}
    />
  );
}

export function SkeletonCircle({ size = 42, style }: { size?: number; style?: any }) {
  const opacity = usePulse();
  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: SKELETON_COLOR, opacity },
        style,
      ]}
    />
  );
}

export function SkeletonBlock({ width = '100%', height = 200, radius = 12, style }: { width?: number | string; height?: number; radius?: number; style?: any }) {
  const opacity = usePulse();
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: SKELETON_COLOR, opacity },
        style,
      ]}
    />
  );
}

// ── Composed skeletons for specific screens ──

export function FeedPostSkeleton() {
  return (
    <View style={sk.postCard}>
      <View style={sk.postHeader}>
        <SkeletonCircle size={42} />
        <View style={sk.postHeaderText}>
          <SkeletonLine width={120} height={13} />
          <SkeletonLine width={80} height={10} style={{ marginTop: 6 }} />
        </View>
      </View>
      <SkeletonLine width="90%" height={13} style={{ marginTop: 12 }} />
      <SkeletonLine width="70%" height={13} style={{ marginTop: 8 }} />
      <SkeletonBlock height={220} radius={12} style={{ marginTop: 12 }} />
      <View style={sk.postActions}>
        <SkeletonLine width={60} height={28} />
        <SkeletonLine width={60} height={28} />
        <SkeletonLine width={60} height={28} />
      </View>
    </View>
  );
}

export function FeedSkeleton() {
  return (
    <View style={sk.container}>
      <FeedPostSkeleton />
      <FeedPostSkeleton />
      <FeedPostSkeleton />
    </View>
  );
}

export function ConversationRowSkeleton() {
  return (
    <View style={sk.convRow}>
      <SkeletonCircle size={50} />
      <View style={sk.convText}>
        <SkeletonLine width={140} height={14} />
        <SkeletonLine width={200} height={11} style={{ marginTop: 6 }} />
      </View>
    </View>
  );
}

export function ConversationsSkeleton() {
  return (
    <View style={sk.container}>
      {[0, 1, 2, 3, 4].map(i => (
        <ConversationRowSkeleton key={i} />
      ))}
    </View>
  );
}

export function ProfileSkeleton() {
  return (
    <View style={sk.container}>
      <View style={sk.profileHeader}>
        <SkeletonCircle size={82} />
        <View style={{ flex: 1, gap: 8, paddingTop: 4 }}>
          <SkeletonLine width={160} height={18} />
          <SkeletonLine width={100} height={13} />
          <SkeletonLine width={70} height={24} />
        </View>
      </View>
      <View style={sk.profileStats}>
        <SkeletonLine width={50} height={18} />
        <SkeletonLine width={50} height={18} />
        <SkeletonLine width={50} height={18} />
        <SkeletonLine width={50} height={18} />
      </View>
      <View style={{ paddingHorizontal: 16, gap: 8, marginTop: 16 }}>
        <SkeletonLine width="95%" height={13} />
        <SkeletonLine width="80%" height={13} />
        <SkeletonLine width="60%" height={13} />
      </View>
    </View>
  );
}

const sk = StyleSheet.create({
  container: { paddingTop: 8 },
  postCard: { paddingHorizontal: 16, paddingVertical: 14, marginBottom: 6 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  postHeaderText: { flex: 1 },
  postActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  convRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  convText: { flex: 1 },
  profileHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, paddingHorizontal: 16, paddingTop: 16 },
  profileStats: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 16, paddingVertical: 16 },
});
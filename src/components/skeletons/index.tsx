/**
 * Skeletons in the final layout of each screen, so the page arrives in shape
 * and the content fills it in. Built on the shared Skeleton primitives.
 */
import React from 'react';
import { View } from 'react-native';
import { SkeletonLine, SkeletonCircle, SkeletonBlock } from '../Skeleton';

const Row = ({ children, style }: { children: React.ReactNode; style?: any }) => <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 12 }, style]}>{children}</View>;

export function ListRowSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 18 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Row key={i}>
          <SkeletonCircle size={44} />
          <View style={{ flex: 1, gap: 8 }}><SkeletonLine width="55%" height={13} /><SkeletonLine width="80%" height={11} /></View>
        </Row>
      ))}
    </View>
  );
}

export function ProfileSkeleton() {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      <Row><SkeletonCircle size={84} /><View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around' }}>{[0, 1, 2].map((i) => <View key={i} style={{ alignItems: 'center', gap: 6 }}><SkeletonLine width={28} height={16} /><SkeletonLine width={44} height={10} /></View>)}</View></Row>
      <View style={{ marginTop: 14, gap: 8 }}><SkeletonLine width="45%" height={16} /><SkeletonLine width="30%" height={12} /><SkeletonLine width="85%" height={12} /></View>
      <Row style={{ marginTop: 14 }}><SkeletonBlock width="48%" height={38} radius={12} /><SkeletonBlock width="48%" height={38} radius={12} /></Row>
      <View style={{ marginTop: 18, flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>{Array.from({ length: 9 }).map((_, i) => <SkeletonBlock key={i} width="32.4%" height={118} radius={4} />)}</View>
    </View>
  );
}

export function PostSkeleton() {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      <Row><SkeletonCircle size={44} /><View style={{ flex: 1, gap: 7 }}><SkeletonLine width="40%" height={14} /><SkeletonLine width="25%" height={11} /></View></Row>
      <View style={{ marginTop: 14, gap: 8 }}><SkeletonLine width="95%" height={13} /><SkeletonLine width="70%" height={13} /></View>
      <SkeletonBlock width="100%" height={300} radius={16} style={{ marginTop: 14 }} />
      <Row style={{ marginTop: 14, justifyContent: 'space-between' }}>{[0, 1, 2, 3, 4].map((i) => <SkeletonCircle key={i} size={22} />)}</Row>
      <View style={{ marginTop: 22, gap: 16 }}>{[0, 1].map((i) => <Row key={i}><SkeletonCircle size={34} /><View style={{ flex: 1, gap: 6 }}><SkeletonLine width="35%" height={12} /><SkeletonLine width="75%" height={11} /></View></Row>)}</View>
    </View>
  );
}

export function ListingSkeleton() {
  return (
    <View>
      <SkeletonBlock width="100%" height={330} radius={0} />
      <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 10 }}>
        <SkeletonLine width="30%" height={22} /><SkeletonLine width="70%" height={18} /><SkeletonLine width="55%" height={12} />
        <Row style={{ marginTop: 6 }}><SkeletonBlock width={150} height={40} radius={12} /><SkeletonBlock width={90} height={40} radius={12} /><SkeletonBlock width={90} height={40} radius={12} /></Row>
        <View style={{ marginTop: 10, gap: 8 }}><SkeletonLine width="100%" height={12} /><SkeletonLine width="85%" height={12} /></View>
        <Row style={{ marginTop: 14 }}><SkeletonCircle size={52} /><View style={{ flex: 1, gap: 7 }}><SkeletonLine width="40%" height={14} /><SkeletonLine width="60%" height={11} /></View></Row>
      </View>
    </View>
  );
}

export function JobSkeleton() {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 12 }}>
      <Row><SkeletonBlock width={56} height={56} radius={14} /><View style={{ flex: 1, gap: 7 }}><SkeletonLine width="70%" height={16} /><SkeletonLine width="45%" height={12} /></View></Row>
      <Row><SkeletonBlock width={90} height={28} radius={999} /><SkeletonBlock width={110} height={28} radius={999} /><SkeletonBlock width={70} height={28} radius={999} /></Row>
      <View style={{ marginTop: 6, gap: 8 }}>{[100, 92, 96, 60, 88, 75].map((w, i) => <SkeletonLine key={i} width={w + '%'} height={12} />)}</View>
      <SkeletonBlock width="100%" height={48} radius={14} style={{ marginTop: 10 }} />
    </View>
  );
}

export function ChatSkeleton() {
  const widths = [42, 58, 35, 66, 48, 30, 60, 44];
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 12, gap: 10 }}>
      {widths.map((w, i) => <View key={i} style={{ alignItems: i % 3 === 0 ? 'flex-end' : 'flex-start' }}><SkeletonBlock width={w + '%'} height={i % 4 === 3 ? 120 : 40} radius={18} /></View>)}
    </View>
  );
}
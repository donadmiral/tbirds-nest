import TierName from '../TierName';
import VerifiedBadge from '../VerifiedBadge';
import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ReAnimated, { SharedValue, useAnimatedStyle } from 'react-native-reanimated';

type Props = {
  user: { avatar_url?: string; full_name?: string; username?: string } | null;
  isOwn: boolean; timeAgo: string; scope?: string; category?: string; viewsCount?: number;
  chromeOpacity: SharedValue<number>; topInset: number; bottomInset: number;
  onOpenViewers?: () => void; onSaveHighlight?: () => void; onOpenSettings?: () => void;
  onOpenMore?: () => void; onDelete?: () => void; onClose: () => void;
  paused?: boolean; onTogglePause?: () => void; muted?: boolean; onToggleMute?: () => void;
};

/** Identity stays by the progress bar. Owner actions have their own bottom dock. */
export default React.memo(function IdentityPresence(props: Props) {
  const presence = useAnimatedStyle(() => ({ opacity: Math.max(0.65, props.chromeOpacity.value) }));
  const initial = props.user?.full_name?.trim().slice(0, 1).toUpperCase() || 'U';
  return <>
    <ReAnimated.View pointerEvents="box-none" style={[s.header, { top: props.topInset + 25 }, presence]}>
      <View style={s.avatarWrap}>{props.user?.avatar_url ? <Image source={{ uri: props.user.avatar_url }} style={s.avatar} /> : <View style={[s.avatar, s.avatarFallback]}><Text style={s.initial}>{initial}</Text></View>}</View>
      <View style={s.identity}><View style={s.nameRow}><TierName userId={(props.user as any)?.id} baseStyle={s.name} text={props.isOwn ? 'Your story' : props.user?.full_name || 'Someone'} /><VerifiedBadge userId={(props.user as any)?.id} size={12} /></View><Text style={s.time}>{props.timeAgo}</Text></View>
      {props.onTogglePause ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={props.paused ? 'Play story' : 'Pause story'} style={s.control} onPress={props.onTogglePause}><Feather name={props.paused ? 'play' : 'pause'} size={20} color="#FFFFFF" /></TouchableOpacity> : null}
      {props.onToggleMute ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={props.muted ? 'Unmute story' : 'Mute story'} style={s.control} onPress={props.onToggleMute}><Feather name={props.muted ? 'volume-x' : 'volume-2'} size={20} color="#FFFFFF" /></TouchableOpacity> : null}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close story" style={s.control} onPress={props.onClose}><Feather name="x" size={22} color="#FFFFFF" /></TouchableOpacity>
    </ReAnimated.View>
    {props.isOwn ? <ReAnimated.View style={[s.ownerDock, { paddingBottom: Math.max(props.bottomInset, 14) }, presence]}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Story views" onPress={props.onOpenViewers} style={s.views}><Feather name="eye" size={14} color="#C5C8CC" /><Text style={s.viewsText}>{props.viewsCount ?? 0} views</Text></TouchableOpacity>
      <View style={s.actions}>
        {props.onOpenViewers ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Story activity" style={s.action} onPress={props.onOpenViewers}><View style={s.circle}><Feather name="eye" size={22} color="#FFFFFF" /></View><Text style={s.actionText}>Activity</Text></TouchableOpacity> : null}
        {props.onSaveHighlight ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Save story to memory book" style={s.action} onPress={props.onSaveHighlight}><View style={s.circle}><Feather name="bookmark" size={22} color="#FFFFFF" /></View><Text style={s.actionText}>Keep</Text></TouchableOpacity> : null}
        {(props.onOpenMore || props.onOpenSettings) ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Story options" style={s.action} onPress={props.onOpenMore || props.onOpenSettings}><View style={s.circle}><Feather name="more-horizontal" size={22} color="#FFFFFF" /></View><Text style={s.actionText}>More</Text></TouchableOpacity> : null}
      </View>
    </ReAnimated.View> : null}
  </>;
});
const s = StyleSheet.create({
  header: { position: 'absolute', left: 14, right: 10, zIndex: 30, flexDirection: 'row', alignItems: 'center', gap: 7 },
  avatarWrap: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: '#E8D3B6', padding: 2 }, avatar: { width: '100%', height: '100%', borderRadius: 18 }, avatarFallback: { backgroundColor: '#34383D', alignItems: 'center', justifyContent: 'center' }, initial: { color: '#FFFFFF', fontWeight: '700' },
  identity: { flex: 1, minWidth: 0 }, nameRow: { flexDirection: 'row', alignItems: 'center' }, name: { color: '#FFFFFF', fontWeight: '700', fontSize: 14, flexShrink: 1, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } }, time: { color: '#EBE6DF', fontSize: 12, marginTop: 2 }, control: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  ownerDock: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20, paddingHorizontal: 24, paddingTop: 10 }, views: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 32 }, viewsText: { color: '#C5C8CC', fontSize: 12 }, actions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }, action: { minWidth: 64, minHeight: 64, alignItems: 'center', gap: 5 }, circle: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center' }, actionText: { color: '#FFFFFF', fontSize: 11 },
});

/**
 * StoryReshareCard — a mentioned person's "Add to your story".
 *
 * The original story is placed as a reference object (never re-uploaded):
 * a 9:16 card showing the original media with the author on top. The card
 * carries storyId + storyAuthorId so the viewer can open the original while
 * it is live, and attribution stays attached wherever the card goes.
 */
import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import VerifiedBadge from '../VerifiedBadge';
import TierName from '../TierName';

export const STORY_CARD_W = 200;
export const STORY_CARD_H = 356;

export default function StoryReshareCard({ sticker, onOpen, onOpenProfile }: { sticker: any; onOpen?: () => void; onOpenProfile?: () => void }) {
  const s: any = sticker;
  const img = s.storyThumbUrl || (s.storyMediaType === 'image' ? s.storyMediaUrl : null) || s.storyMediaUrl;
  const isVideo = s.storyMediaType === 'video';
  const body = (
    <View style={c.card}>
      {img ? <Image source={{ uri: img }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0B1E3D' }]} />}
      <View style={c.shadeTop} pointerEvents="none" />
      <View style={c.head}>
        {s.storyAuthorAvatar ? <Image source={{ uri: s.storyAuthorAvatar }} style={c.avatar} /> : <View style={[c.avatar, { backgroundColor: 'rgba(255,255,255,0.25)' }]} />}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
          <TierName userId={s.storyAuthorId} text={s.storyAuthorName || 'Story'} baseStyle={c.name} />
          {s.storyAuthorId ? <View style={{ marginLeft: 4 }}><VerifiedBadge userId={s.storyAuthorId} size={12} /></View> : null}
        </View>
      </View>
      {isVideo ? <View style={c.play} pointerEvents="none"><Feather name="play" size={16} color="#FFFFFF" /></View> : null}
      <View style={c.foot} pointerEvents="none"><Feather name="at-sign" size={11} color="rgba(255,255,255,0.85)" /><Text style={c.footTxt}>Mentioned you</Text></View>
    </View>
  );
  if (!onOpen && !onOpenProfile) return body;
  return (
    <View>
      <TouchableOpacity activeOpacity={0.9} onPress={onOpen || onOpenProfile}>{body}</TouchableOpacity>
      {onOpenProfile ? <TouchableOpacity style={c.headHit} onPress={onOpenProfile} activeOpacity={0.8} /> : null}
    </View>
  );
}

const c = StyleSheet.create({
  card: { width: STORY_CARD_W, height: STORY_CARD_H, borderRadius: 18, overflow: 'hidden', backgroundColor: '#111', borderWidth: 2, borderColor: '#FFFFFF' },
  shadeTop: { position: 'absolute', left: 0, right: 0, top: 0, height: 72, backgroundColor: 'rgba(0,0,0,0.32)' },
  head: { position: 'absolute', left: 10, right: 10, top: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headHit: { position: 'absolute', left: 0, right: 0, top: 0, height: 48 },
  avatar: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: '#FFFFFF' },
  name: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '800', flexShrink: 1 },
  play: { position: 'absolute', left: STORY_CARD_W / 2 - 22, top: STORY_CARD_H / 2 - 22, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)' },
  foot: { position: 'absolute', left: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 },
  footTxt: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
});

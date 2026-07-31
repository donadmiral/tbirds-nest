/**
 * PostStoryCard
 *
 * The shared-post card inside a story. Rendered by BOTH DraggableSticker
 * (composer) and StickerOverlay (viewer) so the card is pixel-identical at
 * compose time and view time. Renders entirely from the snapshot carried on
 * the sticker, so the viewer never fetches; tapping navigates to the post.
 */
import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

const NAVY = '#0B1E3D';
const CARD_W = 300;

export default function PostStoryCard({ sticker, onPress }: { sticker: any; onPress?: () => void }) {
  const inner = (
    <View style={st.card}>
      <View style={st.head}>
        {sticker.postAuthorAvatar
          ? <Image source={{ uri: sticker.postAuthorAvatar }} style={st.avatar} />
          : <View style={[st.avatar, st.avatarFb]}><Text style={st.avatarTxt}>{(sticker.postAuthorName || '?').slice(0, 1).toUpperCase()}</Text></View>}
        <Text style={st.name} numberOfLines={1}>{sticker.postAuthorName}</Text>
      </View>
      {sticker.postMediaUrl ? (
        <View style={st.mediaWrap}>
          <Image source={{ uri: sticker.postMediaUrl }} style={st.media} resizeMode="cover" />
          {sticker.postMediaType === 'video' && (
            <View style={st.playBadge}><Feather name="play" size={16} color="#FFF" /></View>
          )}
        </View>
      ) : null}
      {sticker.postText ? (
        <Text style={st.body} numberOfLines={sticker.postMediaUrl ? 3 : 6}>{sticker.postText}</Text>
      ) : null}
      <View style={st.foot}>
        <Text style={st.footTxt}>View post</Text>
        <Feather name="chevron-right" size={13} color={NAVY} />
      </View>
    </View>
  );
  if (!onPress) return inner;
  return <TouchableOpacity activeOpacity={0.85} onPress={() => { console.log('[postcard-press] fired, handler:', !!onPress); onPress && onPress(); }}>{inner}</TouchableOpacity>;
}

const st = StyleSheet.create({
  card: { width: CARD_W, backgroundColor: '#FFFFFF', borderRadius: 18, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  avatar: { width: 26, height: 26, borderRadius: 13 },
  avatarFb: { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  name: { fontSize: 13.5, fontWeight: '700', color: '#111827', flex: 1 },
  mediaWrap: { width: CARD_W, height: CARD_W, backgroundColor: '#EDEFF3' },
  media: { width: '100%', height: '100%' },
  playBadge: { position: 'absolute', top: '50%', left: '50%', marginLeft: -18, marginTop: -18, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', paddingLeft: 3 },
  body: { fontSize: 13.5, lineHeight: 19, color: '#1F2937', paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: 10, marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E7EAF0' },
  footTxt: { fontSize: 12.5, fontWeight: '700', color: NAVY },
});
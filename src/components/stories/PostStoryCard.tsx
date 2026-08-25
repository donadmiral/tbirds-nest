/**
 * PostStoryCard — the shared post as the hero object of a story.
 * Rendered by BOTH DraggableSticker (composer) and StickerOverlay (viewer),
 * pixel-identical in both. Renders from the snapshot on the sticker; the
 * whole card is tappable and opens the original post.
 */
import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import VerifiedBadge from '../VerifiedBadge';

const NAVY = '#0B1E3D';
export const POST_CARD_W = Math.min(Math.round(Dimensions.get('window').width * 0.88), 360);
export const POST_CARD_EST_H = 430;

function bodyFont(t: string, hasMedia: boolean) {
  const n = (t || '').length;
  if (hasMedia) return { fontSize: 14.5, lineHeight: 20, max: 4 };
  if (n <= 80) return { fontSize: 22, lineHeight: 30, max: 8 };
  if (n <= 160) return { fontSize: 19, lineHeight: 26.5, max: 10 };
  if (n <= 300) return { fontSize: 16.5, lineHeight: 23, max: 12 };
  return { fontSize: 14.5, lineHeight: 20.5, max: 14 };
}

function shortDate(d?: string | null) {
  if (!d) return '';
  try { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); } catch { return ''; }
}

function nCount(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export default function PostStoryCard({ sticker, onPress }: { sticker: any; onPress?: () => void }) {
  const f = bodyFont(sticker.postText || '', !!sticker.postMediaUrl);
  const likeC = nCount(sticker.postLikes);
  const comC = nCount(sticker.postComments);
  const repC = nCount(sticker.postReposts);
  const inner = (
    <View style={st.card}>
      <View style={st.head}>
        {sticker.postAuthorAvatar
          ? <Image source={{ uri: sticker.postAuthorAvatar }} style={st.avatar} />
          : <View style={[st.avatar, st.avatarFb]}><Text style={st.avatarTxt}>{(sticker.postAuthorName || '?').slice(0, 1).toUpperCase()}</Text></View>}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text style={st.name} numberOfLines={1}>{sticker.postAuthorName}</Text>
            {(sticker.postVerifiedTier || sticker.postVerified) ? <VerifiedBadge tier={sticker.postVerifiedTier ?? 'business'} size={12} /> : null}
          </View>
          {(sticker.postUsername || sticker.postCreatedAt) ? (
            <Text style={st.handle} numberOfLines={1}>
              {sticker.postUsername ? '@' + sticker.postUsername : ''}{sticker.postUsername && sticker.postCreatedAt ? ' · ' : ''}{shortDate(sticker.postCreatedAt)}
            </Text>
          ) : null}
        </View>
      </View>
      {sticker.postText ? (
        <Text style={[st.body, { fontSize: f.fontSize, lineHeight: f.lineHeight }]} numberOfLines={f.max}>{sticker.postText}</Text>
      ) : null}
      {sticker.postMediaUrl ? (
        <View style={st.mediaWrap}>
          <Image source={{ uri: sticker.postMediaUrl }} style={st.media} resizeMode="cover" />
          {sticker.postMediaType === 'video' && (
            <View style={st.playBadge}><Feather name="play" size={16} color="#FFF" /></View>
          )}
        </View>
      ) : null}
      <View style={st.engage}>
        <View style={st.engItem}><Feather name="heart" size={15} color="#E0245E" />{likeC ? <Text style={st.engTxt}>{likeC}</Text> : null}</View>
        <View style={st.engItem}><Feather name="message-circle" size={15} color="#5B6B84" />{comC ? <Text style={st.engTxt}>{comC}</Text> : null}</View>
        <View style={st.engItem}><Feather name="repeat" size={15} color="#1D7A38" />{repC ? <Text style={st.engTxt}>{repC}</Text> : null}</View>
        <View style={{ flex: 1 }} />
        <Feather name="bookmark" size={15} color="#5B6B84" />
      </View>
      <View style={st.foot}>
        <Text style={st.footTxt}>View original post</Text>
        <Feather name="chevron-right" size={14} color={NAVY} />
      </View>
    </View>
  );
  if (!onPress) return inner;
  return <TouchableOpacity activeOpacity={0.88} onPress={onPress}>{inner}</TouchableOpacity>;
}

const st = StyleSheet.create({
  card: { width: POST_CARD_W, backgroundColor: '#FFFFFF', borderRadius: 24, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 9 }, elevation: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.35)' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 13, paddingBottom: 4 },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  avatarFb: { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  name: { fontSize: 15, fontWeight: '800', color: '#111827', flexShrink: 1 },
  handle: { fontSize: 12.5, color: '#7A8699', marginTop: 1 },
  body: { color: '#111827', paddingHorizontal: 14, paddingTop: 9, paddingBottom: 4, fontWeight: '500' },
  mediaWrap: { width: '100%', aspectRatio: 4 / 5, maxHeight: 330, backgroundColor: '#EDEFF3', marginTop: 8 },
  media: { width: '100%', height: '100%' },
  playBadge: { position: 'absolute', top: '50%', left: '50%', marginLeft: -19, marginTop: -19, width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', paddingLeft: 3 },
  engage: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 3 },
  engItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  engTxt: { fontSize: 12.5, fontWeight: '700', color: '#425063' },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 11, marginTop: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E7EAF0' },
  footTxt: { fontSize: 13, fontWeight: '800', color: NAVY },
});
/**
 * PostStoryCard — the shared post as the hero object of a story.
 * Rendered by DraggableSticker (composer, non-interactive) and
 * StickerOverlay (viewer, interactive). Video posts autoplay muted with
 * tap-to-unmute; the heart likes the ORIGINAL post; header opens the
 * author's profile; caption/footer open the original post; long-press
 * pauses the story via the handlers the viewer provides.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity, Pressable, StyleSheet, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import VerifiedBadge from '../VerifiedBadge';
import { supabase } from '../../services/supabase';

const NAVY = '#0B1E3D';
export const POST_CARD_W = Math.min(Math.round(Dimensions.get('window').width * 0.88), 360);
export const POST_CARD_EST_H = 540;

function bodyFont(t: string, hasMedia: boolean) {
  const n = (t || '').length;
  if (hasMedia) return { fontSize: 14.5, lineHeight: 20, max: 3 };
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

export default function PostStoryCard({ sticker, onPress, interactive, onOpenPost, onOpenProfile, onHoldStart, onHoldEnd, paused }: {
  sticker: any;
  onPress?: () => void;
  interactive?: boolean;
  onOpenPost?: () => void;
  onOpenProfile?: () => void;
  onHoldStart?: () => void;
  onHoldEnd?: () => void;
  paused?: boolean;
}) {
  const isVideo = sticker.postMediaType === 'video' && !!sticker.postMediaUrl;
  const [muted, setMuted] = useState(true);
  const [likes, setLikes] = useState<number>(Number(sticker.postLikes) || 0);
  const [liked, setLiked] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const player = useVideoPlayer(isVideo ? sticker.postMediaUrl : null, (p) => {
    if (p) { p.bufferOptions = { preferredForwardBufferDuration: 2, waitsToMinimizeStalling: false } as any; p.loop = true; p.muted = true; try { p.play(); } catch {} }
  });

  const openPost = onOpenPost || onPress;
  const go = (fn?: () => void) => fn ? () => { try { (player as any)?.pause?.(); } catch {} fn(); } : undefined;

  useEffect(() => {
    if (!isVideo) return;
    try { const p: any = player; if (paused) p?.pause?.(); else { p?.play?.(); } } catch {}
  }, [paused, isVideo, player]);

  const toggleMute = () => {
    setMuted(m => {
      const next = !m;
      try { (player as any).muted = next; if (!next) (player as any).play?.(); } catch {}
      return next;
    });
  };

  const toggleLike = async () => {
    if (!interactive || !sticker.postId || likeBusy) return;
    setLikeBusy(true);
    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikes(v => Math.max(0, v + (wasLiked ? -1 : 1)));
    try {
      const { data, error } = await supabase.rpc('toggle_post_like', { p_post_id: sticker.postId });
      if (error) throw error;
      const r = Array.isArray(data) ? data[0] : data;
      if (r) { setLiked(!!r.liked); setLikes(Math.max(0, Number(r.likes_count ?? 0))); }
    } catch {
      setLiked(wasLiked);
      setLikes(v => Math.max(0, v + (wasLiked ? 1 : -1)));
    } finally { setLikeBusy(false); }
  };

  const f = bodyFont(sticker.postText || '', !!sticker.postMediaUrl);
  const likeC = nCount(likes);
  const comC = nCount(sticker.postComments);
  const repC = nCount(sticker.postReposts);
  const tier = sticker.postVerifiedTier ?? (sticker.postVerified ? 'business' : null);

  const mediaBlock = sticker.postMediaUrl ? (
    isVideo ? (
      <View style={st.mediaWrap}>
        <VideoView player={player} style={st.media} contentFit="cover" nativeControls={false} />
        {interactive ? (
          <Pressable style={StyleSheet.absoluteFill} onPress={toggleMute} onLongPress={onHoldStart} onPressOut={onHoldEnd} delayLongPress={220} />
        ) : null}
        <View style={st.soundChip}><Feather name={muted ? 'volume-x' : 'volume-2'} size={13} color="#FFF" /></View>
      </View>
    ) : (
      <View style={st.mediaWrap}>
        <Image source={{ uri: sticker.postMediaUrl }} style={st.media} resizeMode="cover" />
      </View>
    )
  ) : null;

  const header = (
    <TouchableOpacity activeOpacity={0.8} disabled={!interactive || !onOpenProfile} onPress={go(onOpenProfile)} style={st.head}>
      {sticker.postAuthorAvatar
        ? <Image source={{ uri: sticker.postAuthorAvatar }} style={st.avatar} />
        : <View style={[st.avatar, st.avatarFb]}><Text style={st.avatarTxt}>{(sticker.postAuthorName || '?').slice(0, 1).toUpperCase()}</Text></View>}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={st.name} numberOfLines={1}>{sticker.postAuthorName}</Text>
          {tier ? <VerifiedBadge tier={tier} size={12} /> : null}
        </View>
        {(sticker.postUsername || sticker.postCreatedAt) ? (
          <Text style={st.handle} numberOfLines={1}>
            {sticker.postUsername ? '@' + sticker.postUsername : ''}{sticker.postUsername && sticker.postCreatedAt ? ' · ' : ''}{shortDate(sticker.postCreatedAt)}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );

  const articleTitle = sticker.postArticleTitle ? (
    <Pressable disabled={!interactive || !openPost} onPress={go(openPost)} onLongPress={onHoldStart} onPressOut={onHoldEnd} delayLongPress={220}>
      <Text style={st.articleTitle} numberOfLines={2}>{sticker.postArticleTitle}</Text>
    </Pressable>
  ) : null;

  const caption = sticker.postText ? (
    <Pressable disabled={!interactive || !openPost} onPress={go(openPost)} onLongPress={onHoldStart} onPressOut={onHoldEnd} delayLongPress={220}>
      <Text style={[st.body, { fontSize: f.fontSize, lineHeight: f.lineHeight }]} numberOfLines={f.max}>{sticker.postText}</Text>
    </Pressable>
  ) : null;

  const inner = (
    <View style={st.card}>
      {isVideo ? mediaBlock : header}
      {isVideo ? header : caption}
      {articleTitle}
      {isVideo ? caption : mediaBlock}
      <View style={st.engage}>
        <TouchableOpacity style={st.engItem} disabled={!interactive} onPress={toggleLike} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
          <Feather name="heart" size={16} color={liked ? '#E0245E' : '#E0245E'} style={liked ? { opacity: 1 } : { opacity: 0.75 }} />
          {likeC ? <Text style={[st.engTxt, liked && { color: '#E0245E' }]}>{likeC}</Text> : null}
        </TouchableOpacity>
        <TouchableOpacity style={st.engItem} disabled={!interactive || !openPost} onPress={go(openPost)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
          <Feather name="message-circle" size={15} color="#5B6B84" />{comC ? <Text style={st.engTxt}>{comC}</Text> : null}
        </TouchableOpacity>
        <TouchableOpacity style={st.engItem} disabled={!interactive || !openPost} onPress={go(openPost)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
          <Feather name="repeat" size={15} color="#1D7A38" />{repC ? <Text style={st.engTxt}>{repC}</Text> : null}
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity disabled={!interactive || !openPost} onPress={go(openPost)} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
          <Feather name="bookmark" size={15} color="#5B6B84" />
        </TouchableOpacity>
      </View>
      <TouchableOpacity style={st.foot} disabled={!interactive || !openPost} onPress={go(openPost)} activeOpacity={0.75}>
        <Text style={st.footTxt}>{sticker.postArticleTitle ? 'Read the full article' : 'View original post'}</Text>
        <Feather name="chevron-right" size={14} color={NAVY} />
      </TouchableOpacity>
    </View>
  );

  if (interactive) return inner;
  if (!onPress) return inner;
  return <TouchableOpacity activeOpacity={0.88} onPress={onPress}>{inner}</TouchableOpacity>;
}

const st = StyleSheet.create({
  card: { width: POST_CARD_W, backgroundColor: '#FFFFFF', borderRadius: 24, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 9 }, elevation: 9, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.35)' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
  avatar: { width: 38, height: 38, borderRadius: 19 },
  avatarFb: { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: '#FFF', fontSize: 16, fontWeight: '800' },
  name: { fontSize: 15, fontWeight: '800', color: '#111827', flexShrink: 1 },
  handle: { fontSize: 12.5, color: '#7A8699', marginTop: 1 },
  articleTitle: { fontSize: 17, lineHeight: 23, fontWeight: '800', color: '#111827', paddingHorizontal: 14, paddingTop: 8 },
  body: { color: '#111827', paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4, fontWeight: '500' },
  mediaWrap: { width: '100%', height: Math.min(Math.round(POST_CARD_W * 1.05), 330), backgroundColor: '#0B1E3D', marginTop: 0 },
  media: { width: '100%', height: '100%' },
  soundChip: { position: 'absolute', right: 10, bottom: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  engage: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 3 },
  engItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  engTxt: { fontSize: 12.5, fontWeight: '700', color: '#425063' },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: 11, marginTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E7EAF0' },
  footTxt: { fontSize: 13, fontWeight: '800', color: NAVY },
});

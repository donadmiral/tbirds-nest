/** Shared posts retain their original proportions, with the caption above and a
 * small author / View post footer below, as in the approved viewing reference. */
import StoryPixelImage from './StoryPixelImage';
import React, { useEffect, useState } from 'react';
import { View, Text, Image, TouchableOpacity, Pressable, StyleSheet, Dimensions, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { VideoView, useVideoPlayer } from 'expo-video';
import { normalizePostPlayback, applyPostPlayback } from '../../../shared/postVoiceEffects';
import { postTrimWindow } from '../../../shared/postMediaEditing';
import { sharedPostFrame } from '../../../shared/storyPresentation';
import VerifiedBadge from '../VerifiedBadge';

export const POST_CARD_W = Math.min(Dimensions.get('window').width * .9, 440);
export const POST_CARD_EST_H = 540;

export default function PostStoryCard({ sticker, onPress, interactive, onOpenPost, onOpenProfile, onHoldStart, onHoldEnd, paused, stageWidth, stageHeight }: {
  sticker: any; onPress?: () => void; interactive?: boolean; onOpenPost?: () => void;
  onOpenProfile?: () => void; onHoldStart?: () => void; onHoldEnd?: () => void; paused?: boolean;
  stageWidth?: number; stageHeight?: number;
}) {
  const window = useWindowDimensions();
  const isVideo = sticker.postMediaType === 'video' && !!sticker.postMediaUrl;
  const [size, setSize] = useState({ width: Number(sticker.postMediaWidth) || 0, height: Number(sticker.postMediaHeight) || 0 });
  const [muted, setMuted] = useState(true);
  const playback = normalizePostPlayback(sticker.postMediaPlayback);
  useEffect(() => {
    let current = true;
    setSize({ width: Number(sticker.postMediaWidth) || 0, height: Number(sticker.postMediaHeight) || 0 });
    if (!isVideo && sticker.postMediaUrl && !(sticker.postMediaWidth > 0 && sticker.postMediaHeight > 0)) {
      Image.getSize(sticker.postMediaUrl, (width, height) => { if (current) setSize({ width, height }); }, () => {});
    }
    return () => { current = false; };
  }, [sticker.postMediaUrl, sticker.postMediaWidth, sticker.postMediaHeight, isVideo]);
  const frame = sharedPostFrame({ stageWidth: stageWidth || window.width, stageHeight: stageHeight || window.height, mediaWidth: size.width, mediaHeight: size.height, caption: sticker.postText, title: sticker.postArticleTitle, hasMedia: !!sticker.postMediaUrl });
  const player = useVideoPlayer(isVideo ? sticker.postMediaUrl : null, p => { if (p) { p.loop = true; p.muted = true; applyPostPlayback(p,playback); try { p.currentTime=playback.trimStart??0; } catch {} if (!paused) try { p.play(); } catch {} } });
  useEffect(() => { if (isVideo) try { if (paused) player.pause(); else player.play(); } catch {} }, [paused, isVideo, player]);
  useEffect(()=>{if(!isVideo)return;try{applyPostPlayback(player,playback);player.muted=muted||!!playback.muted;player.timeUpdateEventInterval=.1;}catch{}},[player,isVideo,muted,playback.speed,playback.voiceEffect,playback.muted]);
  useEffect(()=>{if(!isVideo)return;const subscription=player.addListener('timeUpdate',()=>{const window=postTrimWindow(player.duration,playback.trimStart,playback.trimEnd);if(window.duration&&(player.currentTime<window.start||player.currentTime>=window.end))player.currentTime=window.start;});return()=>subscription.remove();},[player,isVideo,playback.trimStart,playback.trimEnd]);
  const openPost = onOpenPost || onPress;
  const go = (fn?: () => void) => fn ? () => { try { player?.pause(); } catch {} fn(); } : undefined;
  const hold = { onLongPress: onHoldStart, onPressOut: onHoldEnd, delayLongPress: 160 };
  const mediaCount = Math.max(1, Number(sticker.postMediaCount) || 1);
  const inner = <View style={[st.card, { width: frame.width }]}>
    {sticker.postArticleTitle || sticker.postText ? <Pressable {...hold} disabled={!interactive || !openPost} onPress={go(openPost)} style={[st.caption, !sticker.postMediaUrl && st.textCard, { minHeight: frame.captionHeight }]}>
      {sticker.postArticleTitle ? <Text style={st.title} numberOfLines={2}>{sticker.postArticleTitle}</Text> : null}
      {sticker.postText ? <Text style={st.body} numberOfLines={sticker.postMediaUrl ? 3 : 8}>{sticker.postText}</Text> : null}
    </Pressable> : null}
    {sticker.postMediaUrl ? <View style={[st.mediaWrap, { height: frame.mediaHeight }]}>
      {isVideo ? <VideoView pointerEvents="none" player={player} style={st.media} contentFit="contain" nativeControls={false} /> : <StoryPixelImage uri={sticker.postMediaUrl} style={st.media} fit="contain" />}
      {interactive ? <Pressable {...hold} accessibilityRole="button" accessibilityLabel="Open shared post" style={StyleSheet.absoluteFill} onPress={go(openPost)} /> : null}
      {mediaCount > 1 ? <View pointerEvents="none" style={st.carousel}><Feather name="layers" size={17} color="#FFFFFF" /><Text style={st.carouselText}>1/{mediaCount}</Text></View> : null}
      {isVideo && !playback.muted ? <Pressable {...hold} accessibilityRole="button" disabled={!interactive} accessibilityLabel={muted ? 'Unmute shared video' : 'Mute shared video'} style={st.soundChip} onPress={() => setMuted(value => { const next = !value; try { player.muted = next; } catch {} return next; })}><Feather name={muted ? 'volume-x' : 'volume-2'} size={17} color="#FFF" /></Pressable> : null}
    </View> : null}
    <View style={st.footer}>
      <TouchableOpacity {...hold} accessibilityRole="button" accessibilityLabel={`Open ${sticker.postAuthorName || sticker.postUsername || 'post author'} profile`} disabled={!interactive || !onOpenProfile} onPress={go(onOpenProfile)} style={st.author}>
        <Text numberOfLines={1} style={st.handle}>{sticker.postUsername ? '@' + String(sticker.postUsername).replace(/^@/, '') : sticker.postAuthorName || 'Post'}</Text>
        {sticker.postAuthorId ? <VerifiedBadge userId={sticker.postAuthorId} size={12} /> : null}
      </TouchableOpacity>
      <TouchableOpacity {...hold} accessibilityRole="button" accessibilityLabel={sticker.postArticleTitle ? 'Read the full article' : 'View post'} disabled={!interactive || !openPost} onPress={go(openPost)} style={st.foot}>
        <Text style={st.footTxt}>View post</Text><Feather name="arrow-up-right" size={16} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  </View>;
  return interactive || !onPress ? inner : <TouchableOpacity activeOpacity={.9} onPress={onPress}>{inner}</TouchableOpacity>;
}

const st = StyleSheet.create({
  card: { backgroundColor: 'transparent' },
  caption: { paddingBottom: 14, justifyContent: 'flex-end' },
  textCard: { padding: 20, paddingBottom: 20, borderRadius: 18, backgroundColor: 'rgba(0,0,0,.24)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,.18)' },
  title: { fontSize: 17, lineHeight: 22, fontWeight: '700', color: '#FFFFFF', textAlign: 'center', textShadowColor: '#0008', textShadowRadius: 8 },
  body: { color: '#FFFFFF', fontSize: 16, lineHeight: 22, textAlign: 'center', fontWeight: '500', textShadowColor: '#0008', textShadowRadius: 8 },
  mediaWrap: { width: '100%', borderRadius: 16, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,.12)' },
  media: { width: '100%', height: '100%' },
  soundChip: { position: 'absolute', right: 8, bottom: 8, width: 44, height: 44, borderRadius: 22, backgroundColor: '#0008', alignItems: 'center', justifyContent: 'center' },
  carousel: { position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 4, padding: 5, borderRadius: 10, backgroundColor: '#0005' },
  carouselText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 54 },
  author: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44 },
  handle: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, paddingHorizontal: 16, borderRadius: 23, backgroundColor: 'rgba(255,255,255,.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,.22)' },
  footTxt: { fontSize: 14, fontWeight: '600', color: '#FFFFFF' },
});

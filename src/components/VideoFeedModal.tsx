/**
 * VideoFeedModal
 *
 * Instagram-style vertical video pager. Opens when a feed video is expanded:
 * full-screen, paged vertically through every video post currently in the
 * feed, seeded at the tapped one. Tap toggles pause. Only the visible cell's
 * player runs; windowSize keeps at most ~3 players mounted.
 *
 * Likes route back to the feed's own toggleLike, so state stays consistent
 * when the pager closes.
 */
import React, { useRef, useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, Image, StyleSheet, Dimensions } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Feather, Ionicons } from '@expo/vector-icons';

const { height: H, width: W } = Dimensions.get('window');

function VideoCell({ item, active, liked, onToggleLike, onOpenComments, onViewed }: any) {
  const player = useVideoPlayer(item.url, (p: any) => {
    p.loop = true;
    p.muted = false;
    p.timeUpdateEventInterval = 0.25;
  });
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const viewedRef = useRef(false);
  useEffect(() => {
    if (!active || viewedRef.current) return;
    const t = setTimeout(() => { viewedRef.current = true; if (onViewed) onViewed(item.id); }, 3000);
    return () => clearTimeout(t);
  }, [active]);

  useEffect(() => {
    if (active && !paused) { player.play(); } else { player.pause(); }
  }, [active, paused, player]);

  useEffect(() => {
    const t = player.addListener('timeUpdate', (e: any) => {
      const d = player.duration;
      if (d > 0) setProgress((e?.currentTime ?? 0) / d);
    });
    return () => t.remove();
  }, [player]);

  return (
    <TouchableOpacity activeOpacity={1} onPress={() => setPaused(p => !p)} style={{ width: W, height: H, backgroundColor: '#000' }}>
      <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="cover" nativeControls={false} />
      {paused && (
        <View style={s.pauseBadge} pointerEvents="none"><Feather name="play" size={30} color="#FFF" /></View>
      )}
      <View style={s.rail} pointerEvents="box-none">
        <TouchableOpacity style={s.railBtn} onPress={() => onToggleLike(item.id)} activeOpacity={0.8}>
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={31} color={liked ? '#FF3040' : '#FFFFFF'} />
          {item.likes > 0 && <Text style={s.railTxt}>{item.likes}</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={s.railBtn} onPress={() => onOpenComments(item.id)} activeOpacity={0.8}>
          <Ionicons name="chatbubble-outline" size={27} color="#FFFFFF" />
          {item.comments > 0 && <Text style={s.railTxt}>{item.comments}</Text>}
        </TouchableOpacity>
      </View>
      <View style={s.meta} pointerEvents="none">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {item.authorAvatar
            ? <Image source={{ uri: item.authorAvatar }} style={s.av} />
            : <View style={[s.av, s.avFb]}><Text style={s.avTxt}>{String(item.authorName || '?').slice(0, 1).toUpperCase()}</Text></View>}
          <Text style={s.name}>{item.authorName}</Text>
        </View>
        {!!item.caption && <Text style={s.cap} numberOfLines={2}>{item.caption}</Text>}
      </View>
      <View style={s.progress}>
        <View style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%`, height: '100%', backgroundColor: '#FFFFFF' }} />
      </View>
    </TouchableOpacity>
  );
}

export default function VideoFeedModal({ items, startId, likedMap, onClose, onToggleLike, onOpenComments, onViewed }: any) {
  const startIdx = Math.max(0, items.findIndex((i: any) => i.id === startId));
  const [activeIdx, setActiveIdx] = useState(startIdx);
  const onViewable = useRef(({ viewableItems }: any) => {
    if (viewableItems && viewableItems.length > 0) setActiveIdx(viewableItems[0].index ?? 0);
  }).current;
  const cfg = useRef({ itemVisiblePercentThreshold: 60 }).current;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <FlatList
        data={items}
        keyExtractor={(i: any) => i.id}
        renderItem={({ item, index }) => (
          <VideoCell
            item={item}
            active={index === activeIdx}
            liked={!!likedMap[item.id]}
            onToggleLike={onToggleLike}
            onOpenComments={onOpenComments}
            onViewed={onViewed}
          />
        )}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        initialScrollIndex={startIdx}
        getItemLayout={(_: any, i: number) => ({ length: H, offset: H * i, index: i })}
        windowSize={3}
        maxToRenderPerBatch={2}
        removeClippedSubviews
        onViewableItemsChanged={onViewable}
        viewabilityConfig={cfg}
      />
      <TouchableOpacity style={s.close} onPress={onClose} activeOpacity={0.8}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Feather name="x" size={20} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  close: { position: 'absolute', top: 54, left: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  pauseBadge: { position: 'absolute', top: '50%', left: '50%', marginLeft: -33, marginTop: -33, width: 66, height: 66, borderRadius: 33, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', paddingLeft: 4 },
  rail: { position: 'absolute', right: 12, bottom: 120, alignItems: 'center', gap: 20 },
  railBtn: { alignItems: 'center', gap: 3 },
  railTxt: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '700' },
  meta: { position: 'absolute', left: 14, right: 70, bottom: 46 },
  av: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)' },
  avFb: { backgroundColor: '#0B1E3D', alignItems: 'center', justifyContent: 'center' },
  avTxt: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  name: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 },
  cap: { color: 'rgba(255,255,255,0.92)', fontSize: 13.5, lineHeight: 18, marginTop: 6, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6 },
  progress: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2.5, backgroundColor: 'rgba(255,255,255,0.25)' },
});
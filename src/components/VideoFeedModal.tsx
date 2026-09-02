/**
 * VideoFeedModal - the expanded video viewer opened from a feed card.
 *
 * One continuous playback session with the interface around it: the video
 * starts where the feed left it, the creator row (avatar, tier-coloured name,
 * seal, Follow) and caption sit over the bottom, the rail carries like,
 * comments, repost, share, save and a more menu, and the scrubber with times
 * sits inside the safe area. Gesture priority, top to bottom: pinch zoom,
 * two-finger pan, double-tap like (heart at the finger), single tap pause,
 * vertical paging.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, FlatList, TouchableOpacity, Image, PanResponder, Modal } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, Directions } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming, withSequence, runOnJS } from 'react-native-reanimated';
import VerifiedBadge from './VerifiedBadge';
import TierName from './TierName';

const { height: H, width: W } = Dimensions.get('window');
const SPEEDS = [0.5, 1, 1.5, 2];

function fmt(t: number) { const s = Math.max(0, Math.floor(t || 0)); const m = Math.floor(s / 60); const r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; }
function count(n: number) { if (!n) return ''; if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'; return String(n); }

export type VideoFeedActions = {
  onToggleLike: (id: string) => void;
  onOpenComments: (id: string) => void;
  onViewed?: (id: string) => void;
  onToggleSave?: (id: string) => void;
  onToggleRepost?: (id: string) => void;
  onShare?: (id: string) => void;
  onOpenProfile?: (userId: string) => void;
  onFollow?: (userId: string) => void;
  onNotInterested?: (id: string) => void;
  onReport?: (id: string) => void;
  onCopyLink?: (id: string) => void;
};

function VideoCell({ item, active, liked, saved, reposted, following, isOwn, startAt, actions, insetTop, insetBottom, speed, onSpeed }: any) {
  const player = useVideoPlayer(item.url, (p: any) => {
    p.loop = true; p.muted = false; p.timeUpdateEventInterval = 0.1;
    if (startAt && startAt > 0.2) { try { p.currentTime = startAt; } catch {} }
  });
  const [paused, setPaused] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubT, setScrubT] = useState(0);
  const [menu, setMenu] = useState(false);
  const [clean, setClean] = useState(false);
  const viewedRef = useRef(false);
  const trackW = useRef(1);

  useEffect(() => { if (!active || viewedRef.current) return; const t = setTimeout(() => { viewedRef.current = true; actions.onViewed?.(item.id); }, 3000); return () => clearTimeout(t); }, [active]);
  // Only the active cell may be heard or run: neighbours are muted and paused, and every cell pauses on unmount.
  useEffect(() => { try { player.muted = !active; } catch {} if (active && !paused) player.play(); else player.pause(); }, [active, paused, player]);
  useEffect(() => () => { try { player.pause(); } catch {} }, [player]);
  useEffect(() => { try { (player as any).playbackRate = speed; } catch {} }, [speed, player]);
  useEffect(() => {
    const t = player.addListener('timeUpdate', (e: any) => { const d = player.duration; const c = e?.currentTime ?? player.currentTime; if (!scrubbing) setCur(c); if (d > 0) setDur(d); });
    return () => t.remove();
  }, [player, scrubbing]);

  // Heart at the finger for double-tap like.
  const heartX = useSharedValue(0); const heartY = useSharedValue(0); const heartS = useSharedValue(0); const heartO = useSharedValue(0);
  const burst = useCallback((x: number, y: number) => {
    heartX.value = x; heartY.value = y;
    heartS.value = 0; heartO.value = 1;
    heartS.value = withSequence(withSpring(1.15, { damping: 9, stiffness: 260 }), withTiming(1, { duration: 120 }));
    heartO.value = withSequence(withTiming(1, { duration: 500 }), withTiming(0, { duration: 260 }));
    if (!liked) actions.onToggleLike(item.id);
  }, [liked, item.id, actions]);
  const heartStyle = useAnimatedStyle(() => ({ position: 'absolute', left: heartX.value - 44, top: heartY.value - 44, opacity: heartO.value, transform: [{ scale: heartS.value }, { rotate: '-8deg' }] }));

  // Pinch zoom on the UI thread; keeps the zoom until double-tap, pinch back, or swipe away.
  const scale = useSharedValue(1); const tx = useSharedValue(0); const ty = useSharedValue(0);
  const baseS = useSharedValue(1); const baseX = useSharedValue(0); const baseY = useSharedValue(0);
  const ox = useSharedValue(0); const oy = useSharedValue(0);
  useEffect(() => { if (!active) { scale.value = withTiming(1); tx.value = withTiming(0); ty.value = withTiming(0); } }, [active]);
  const pinch = Gesture.Pinch()
    .onStart(e => { ox.value = e.focalX; oy.value = e.focalY; baseS.value = scale.value; baseX.value = tx.value; baseY.value = ty.value; })
    .onUpdate(e => {
      const sc = Math.min(Math.max(baseS.value * e.scale, 1), 3); const k = sc / baseS.value;
      scale.value = sc;
      tx.value = baseX.value * k + (ox.value - W / 2) * (1 - k) + (e.focalX - ox.value);
      ty.value = baseY.value * k + (oy.value - H / 2) * (1 - k) + (e.focalY - oy.value);
    })
    .onEnd(() => { if (scale.value <= 1.05) { scale.value = withSpring(1); tx.value = withSpring(0); ty.value = withSpring(0); } });
  const pan2 = Gesture.Pan().minPointers(2).maxPointers(2)
    .onStart(() => { baseX.value = tx.value; baseY.value = ty.value; })
    .onUpdate(e => { if (scale.value > 1.01) { tx.value = baseX.value + e.translationX; ty.value = baseY.value + e.translationY; } });
  const dbl = Gesture.Tap().numberOfTaps(2).maxDuration(260).onEnd((e, ok) => { if (!ok) return; if (scale.value > 1.05) { scale.value = withSpring(1); tx.value = withSpring(0); ty.value = withSpring(0); return; } runOnJS(burst)(e.x, e.y); });
  const single = Gesture.Tap().numberOfTaps(1).maxDuration(260).onEnd((_e, ok) => { if (ok) runOnJS(setPaused)(!paused); });
  // Full-view: fling left hides the rail, creator row and scrubber; fling right brings them back.
  const flingL = Gesture.Fling().direction(Directions.LEFT).onEnd(() => { runOnJS(setClean)(true); });
  const flingR = Gesture.Fling().direction(Directions.RIGHT).onEnd(() => { runOnJS(setClean)(false); });
  const gesture = Gesture.Simultaneous(pinch, pan2, Gesture.Exclusive(flingL, flingR, dbl, single));
  const zoomStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }] }));

  const seekTo = (sec: number) => { try { player.currentTime = Math.max(0, Math.min(dur || sec, sec)); } catch {} };
  const scrub = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true, onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => { setScrubbing(true); setScrubT((Math.max(0, Math.min(trackW.current, e.nativeEvent.locationX)) / trackW.current) * (player.duration || 0)); },
    onPanResponderMove: (e) => { setScrubT((Math.max(0, Math.min(trackW.current, e.nativeEvent.locationX)) / trackW.current) * (player.duration || 0)); },
    onPanResponderRelease: (e) => { const t = (Math.max(0, Math.min(trackW.current, e.nativeEvent.locationX)) / trackW.current) * (player.duration || 0); seekTo(t); setCur(t); setScrubbing(false); },
    onPanResponderTerminate: () => setScrubbing(false),
  })).current;

  const shown = scrubbing ? scrubT : cur; const pct = dur > 0 ? Math.min(1, Math.max(0, shown / dur)) : 0;
  const railBottom = Math.max(insetBottom, 12) + 92;

  return (
    <View style={{ width: W, height: H, backgroundColor: '#000' }}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[StyleSheet.absoluteFill, zoomStyle]}>
          <VideoView pointerEvents="none" style={StyleSheet.absoluteFill} player={player} contentFit="contain" nativeControls={false} />
        </Animated.View>
      </GestureDetector>
      <Animated.View pointerEvents="none" style={heartStyle}><Ionicons name="heart" size={88} color="#FFFFFF" /></Animated.View>
      {paused ? <View style={s.pauseBadge} pointerEvents="none"><Feather name="play" size={30} color="#FFF" /></View> : null}

      {/* Rail */}
      {!clean ? <View style={[s.rail, { bottom: railBottom }]} pointerEvents="box-none">
        <TouchableOpacity style={s.railBtn} onPress={() => actions.onToggleLike(item.id)} activeOpacity={0.8}>
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={31} color={liked ? '#FF3040' : '#FFFFFF'} />
          <Text style={s.railTxt}>{count(item.likes)}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.railBtn} onPress={() => actions.onOpenComments(item.id)} activeOpacity={0.8}>
          <Ionicons name="chatbubble-outline" size={27} color="#FFFFFF" /><Text style={s.railTxt}>{count(item.comments)}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.railBtn} onPress={() => actions.onToggleRepost?.(item.id)} activeOpacity={0.8}>
          <Feather name="repeat" size={26} color={reposted ? '#C9BFB0' : '#FFFFFF'} /><Text style={s.railTxt}>{reposted ? 'Reposted' : 'Repost'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.railBtn} onPress={() => actions.onShare?.(item.id)} activeOpacity={0.8}>
          <Feather name="send" size={26} color="#FFFFFF" /><Text style={s.railTxt}>Share</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.railBtn} onPress={() => actions.onToggleSave?.(item.id)} activeOpacity={0.8}>
          <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={27} color="#FFFFFF" /><Text style={s.railTxt}>{saved ? 'Saved' : 'Save'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.railBtn} onPress={() => setMenu(true)} activeOpacity={0.8}>
          <Feather name="settings" size={25} color="#FFFFFF" />
        </TouchableOpacity>
        <TouchableOpacity style={s.railBtn} onPress={() => setClean(true)} activeOpacity={0.8} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Feather name="chevrons-right" size={22} color="rgba(255,255,255,0.75)" />
        </TouchableOpacity>
      </View> : (
        <TouchableOpacity onPress={() => setClean(false)} activeOpacity={0.8} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={{ position: 'absolute', right: 0, top: H / 2 - 22, width: 18, height: 44, borderTopLeftRadius: 10, borderBottomLeftRadius: 10, backgroundColor: 'rgba(201,191,176,0.55)', alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="chevron-left" size={14} color="#0B1E3D" />
        </TouchableOpacity>
      )}

      {/* Creator + caption */}
      {!clean ? <View style={[s.meta, { bottom: Math.max(insetBottom, 12) + 46 }]} pointerEvents="box-none">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TouchableOpacity onPress={() => item.authorId && actions.onOpenProfile?.(item.authorId)} activeOpacity={0.8}>
            {item.authorAvatar ? <Image source={{ uri: item.authorAvatar }} style={s.av} /> : <View style={[s.av, s.avFb]}><Text style={s.avTxt}>{String(item.authorName || '?').slice(0, 1).toUpperCase()}</Text></View>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => item.authorId && actions.onOpenProfile?.(item.authorId)} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }}>
            <TierName userId={item.authorId} baseStyle={[s.name, { flexShrink: 1 }]} text={item.authorName} />
            <VerifiedBadge userId={item.authorId} size={14} />
          </TouchableOpacity>
          {!isOwn && !following && item.authorId ? (
            <TouchableOpacity onPress={() => actions.onFollow?.(item.authorId)} activeOpacity={0.8} style={s.follow}><Text style={s.followTxt}>Follow</Text></TouchableOpacity>
          ) : null}
        </View>
        {!!item.caption && <Text style={s.cap} numberOfLines={2}>{item.caption}</Text>}
      </View> : null}

      {/* Scrubber inside the safe area */}
      {!clean ? <View style={[s.bottom, { paddingBottom: Math.max(insetBottom, 12) }]} pointerEvents="box-none">
        <View {...scrub.panHandlers} style={s.trackHit} onLayout={e => { trackW.current = Math.max(1, e.nativeEvent.layout.width); }}>
          <View style={[s.track, scrubbing && { height: 5 }]}><View style={[s.fill, { width: `${pct * 100}%` }]} /></View>
          <View style={[s.knob, scrubbing && s.knobBig, { left: Math.max(0, pct * trackW.current - (scrubbing ? 9 : 5)) }]} />
        </View>
        <View style={s.timeRow}><Text style={s.time}>{fmt(shown)}</Text><Text style={s.timeDim}> / {fmt(dur)}</Text><View style={{ flex: 1 }} /><TouchableOpacity onPress={() => onSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={s.speed}>{speed}x</Text></TouchableOpacity></View>
      </View> : (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(insetBottom, 8), height: 2, backgroundColor: 'rgba(255,255,255,0.18)' }}><View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: '#C9BFB0' }} /></View>
      )}

      {/* More menu */}
      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <TouchableOpacity style={s.menuOverlay} activeOpacity={1} onPress={() => setMenu(false)}>
          <View style={[s.menuSheet, { paddingBottom: Math.max(insetBottom, 14) + 6 }]}>
            <View style={s.menuHandle} />
            <Text style={s.menuSection}>Playback</Text>
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
              {SPEEDS.map(sp => <TouchableOpacity key={sp} onPress={() => onSpeed(sp)} style={[s.chip, speed === sp && s.chipOn]}><Text style={[s.chipTxt, speed === sp && s.chipTxtOn]}>{sp}x</Text></TouchableOpacity>)}
            </View>
            <View style={s.menuRow}><Feather name="sliders" size={18} color="#0B1E3D" /><Text style={s.menuTxt}>Quality</Text><Text style={s.menuSub}>Auto</Text></View>
            <View style={s.menuRow}><Feather name="type" size={18} color="#0B1E3D" /><Text style={s.menuTxt}>Captions</Text><Text style={s.menuSub}>None available</Text></View>
            <Text style={s.menuSection}>This post</Text>
            <TouchableOpacity style={s.menuRow} onPress={() => { setMenu(false); actions.onNotInterested?.(item.id); }}><Feather name="eye-off" size={18} color="#0B1E3D" /><Text style={s.menuTxt}>Not interested</Text></TouchableOpacity>
            <TouchableOpacity style={s.menuRow} onPress={() => { setMenu(false); if (actions.onCopyLink) actions.onCopyLink(item.id); else actions.onShare?.(item.id); }}><Feather name="link" size={18} color="#0B1E3D" /><Text style={s.menuTxt}>Copy link</Text></TouchableOpacity>
            <View style={s.menuRow}><Feather name="info" size={18} color="#0B1E3D" /><Text style={s.menuTxt}>Why you are seeing this</Text><Text style={s.menuSub}>{item.reason || 'From people and topics you follow'}</Text></View>
            <TouchableOpacity style={s.menuRow} onPress={() => { setMenu(false); actions.onReport?.(item.id); }}><Feather name="flag" size={18} color="#C62F1D" /><Text style={[s.menuTxt, { color: '#C62F1D' }]}>Report</Text></TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

export default function VideoFeedModal({ items, startId, startAt = 0, likedMap, savedMap, repostedMap, followingIds, myId, onClose, onToggleLike, onOpenComments, onViewed, onToggleSave, onToggleRepost, onShare, onOpenProfile, onFollow, onNotInterested, onReport, onCopyLink }: any) {
  const insets = useSafeAreaInsets();
  const startIdx = Math.max(0, items.findIndex((i: any) => i.id === startId));
  const [activeIdx, setActiveIdx] = useState(startIdx);
  const [speed, setSpeed] = useState(1);
  const onViewable = useRef(({ viewableItems }: any) => { if (viewableItems && viewableItems.length > 0) setActiveIdx(viewableItems[0].index ?? 0); }).current;
  const cfg = useRef({ itemVisiblePercentThreshold: 60 }).current;
  const actions: VideoFeedActions = { onToggleLike, onOpenComments, onViewed, onToggleSave, onToggleRepost, onShare, onOpenProfile, onFollow, onNotInterested, onReport, onCopyLink };
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <FlatList
        data={items}
        keyExtractor={(i: any) => i.id}
        renderItem={({ item, index }) => (
          <VideoCell item={item} active={index === activeIdx} liked={!!likedMap?.[item.id]} saved={!!savedMap?.[item.id]} reposted={!!repostedMap?.[item.id]}
            following={!!(followingIds && item.authorId && followingIds.has(item.authorId))} isOwn={!!(myId && item.authorId === myId)}
            startAt={item.id === startId ? startAt : 0} actions={actions} insetTop={insets.top} insetBottom={insets.bottom} speed={speed} onSpeed={setSpeed} />
        )}
        pagingEnabled showsVerticalScrollIndicator={false} initialScrollIndex={startIdx}
        getItemLayout={(_: any, i: number) => ({ length: H, offset: H * i, index: i })}
        windowSize={3} maxToRenderPerBatch={2} removeClippedSubviews
        onViewableItemsChanged={onViewable} viewabilityConfig={cfg}
      />
      <TouchableOpacity style={[s.close, { top: insets.top + 22 }]} onPress={onClose} activeOpacity={0.8} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Feather name="x" size={20} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  close: { position: 'absolute', left: 16, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  pauseBadge: { position: 'absolute', top: H / 2 - 32, left: W / 2 - 32, width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  rail: { position: 'absolute', right: 10, alignItems: 'center', gap: 16 },
  railBtn: { alignItems: 'center', minWidth: 44 },
  railTxt: { color: '#FFFFFF', fontSize: 11.5, fontWeight: '700', marginTop: 3, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  meta: { position: 'absolute', left: 14, right: 76 },
  av: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: '#FFFFFF' },
  avFb: { backgroundColor: '#1F2A44', alignItems: 'center', justifyContent: 'center' },
  avTxt: { color: '#FFF', fontWeight: '800' },
  name: { color: '#FFFFFF', fontSize: 15, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  follow: { borderWidth: 1.2, borderColor: '#FFFFFF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 4 },
  followTxt: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '800' },
  cap: { color: '#FFFFFF', fontSize: 13.5, marginTop: 8, lineHeight: 18, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14 },
  trackHit: { height: 24, justifyContent: 'center' },
  track: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.32)', overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: '#FFFFFF' },
  knob: { position: 'absolute', top: 7, width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFFFFF' },
  knobBig: { top: 3, width: 18, height: 18, borderRadius: 9 },
  timeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  time: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  timeDim: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  speed: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
  menuOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  menuSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8 },
  menuHandle: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: 'rgba(11,30,61,0.18)', marginBottom: 8 },
  menuSection: { color: 'rgba(11,30,61,0.55)', fontSize: 11.5, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  menuTxt: { color: '#0B1E3D', fontSize: 15, fontWeight: '600', flex: 1 },
  menuSub: { color: 'rgba(11,30,61,0.55)', fontSize: 12.5, fontWeight: '600', maxWidth: '45%', textAlign: 'right' },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(11,30,61,0.06)' },
  chipOn: { backgroundColor: '#0B1E3D' },
  chipTxt: { color: '#0B1E3D', fontWeight: '800', fontSize: 13 },
  chipTxtOn: { color: '#FFFFFF' },
});

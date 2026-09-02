/**
 * MediaRenderer.tsx
 *
 * CAROUSEL FIX:
 * - Keeps single-image and single-video behavior unchanged.
 * - Keeps carousel as a horizontal paginated ScrollView.
 * - Locks the carousel outer container width and height.
 * - Hides overflow so only one carousel page is visible at a time.
 * - Forces ScrollView content into a horizontal row so media cannot stack vertically.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import {
  View,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Image,
  Platform,
  Dimensions,
  StatusBar,
  Text,
  TouchableOpacity,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { FilterLayer } from './stories/StoryFilters';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import TierName from './TierName';
import VerifiedBadge from './VerifiedBadge';
import { AdjustLayer } from './stories/storyPanels';
import { setAudioModeAsync } from 'expo-audio';

export type PostMedia = {
  id: string;
  url: string;
  media_type: 'image' | 'video';
  edit?: { scale?: number; translateNX?: number; translateNY?: number; fit?: 'cover' | 'contain'; filterId?: string | null; filterAmt?: number; adjust?: any; trimStart?: number | null; trimEnd?: number | null; muted?: boolean } | null;
  width?: number | null;
  height?: number | null;
  sort_order?: number;
};

type Props = {
  media: PostMedia[];
  containerWidth: number;
  fullBleed?: boolean;
  maxHeight?: number;
  isActive?: boolean;
};

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;

let audioSessionReady = false;

async function ensureAudioSession() {
  if (audioSessionReady) return;
  try {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
    });
    audioSessionReady = true;
  } catch (e) {
    console.log('[MEDIA] audio session setup failed:', e);
  }
}

/** Non-destructive post edit recipe -> render props. Same numbers the editor wrote. */
function editStyle(item: PostMedia, w: number, h: number) {
  const e = item.edit; if (!e) return { transform: undefined as any, fit: 'cover' as 'cover' | 'contain' };
  const sc = typeof e.scale === 'number' && e.scale > 0 ? e.scale : 1; const nx = typeof e.translateNX === 'number' ? e.translateNX : 0; const ny = typeof e.translateNY === 'number' ? e.translateNY : 0;
  const has = sc !== 1 || nx !== 0 || ny !== 0;
  return { transform: has ? [{ translateX: nx * w }, { translateY: ny * h }, { scale: sc }] : undefined, fit: (e.fit === 'contain' ? 'contain' : 'cover') as 'cover' | 'contain' };
}
function EditOverlays({ item }: { item: PostMedia }) {
  const e = item.edit; if (!e) return null;
  return (<>{e.filterId ? <FilterLayer filterId={e.filterId} amt={e.filterAmt ?? 100} /> : null}{e.adjust ? <AdjustLayer adjust={e.adjust} /> : null}</>);
}


/**
 * Tagged people. Our own construction, not Instagram's: a pearl people-mark
 * in the bottom-left corner shows the count; tap it and the tags rise from
 * the picture as soft pills anchored where each person is, each with avatar,
 * tier-coloured name and seal. Tap a pill to open the profile; tap the mark
 * again and they sink back. Tags load once per media id and are cached.
 */
export type MediaTag = { user_id: string; nx: number; ny: number; full_name?: string | null; username?: string | null; avatar_url?: string | null };
const tagCache = new Map<string, MediaTag[]>();
export function useMediaTags(mediaIds: string[]): Record<string, MediaTag[]> {
  const [map, setMap] = useState<Record<string, MediaTag[]>>({});
  useEffect(() => {
    const seed: Record<string, MediaTag[]> = {}; const need: string[] = [];
    mediaIds.forEach(id => { if (tagCache.has(id)) seed[id] = tagCache.get(id)!; else need.push(id); });
    setMap(seed);
    if (!need.length) return;
    let dead = false;
    (async () => {
      try {
        const { data } = await supabase.from('post_media_tags').select('media_id, user_id, nx, ny, profile:profiles!post_media_tags_user_id_fkey(full_name, username, avatar_url)').in('media_id', need);
        const next: Record<string, MediaTag[]> = {}; need.forEach(id => { next[id] = []; });
        ((data ?? []) as any[]).forEach((row: any) => { const p = row.profile || {}; (next[row.media_id] ||= []).push({ user_id: row.user_id, nx: Number(row.nx) || 0.5, ny: Number(row.ny) || 0.5, full_name: p.full_name ?? null, username: p.username ?? null, avatar_url: p.avatar_url ?? null }); });
        Object.entries(next).forEach(([id, t]) => tagCache.set(id, t));
        if (!dead) setMap(prev => ({ ...prev, ...next }));
      } catch {}
    })();
    return () => { dead = true; };
  }, [mediaIds.join('|')]);
  return map;
}

export function TagLayer({ tags, width, height }: { tags?: MediaTag[]; width: number; height: number }) {
  const [open, setOpen] = useState(false);
  const nav = useNavigation<any>();
  if (!tags || tags.length === 0) return null;
  // Tidy layout: the pearl dot stays exactly where the person is; the pills are
  // laid out top to bottom and nudged so they never overlap each other or leave
  // the picture, with a hairline connector when a pill had to move.
  const PILL_H = 30; const GAP = 6; const EST = (t: MediaTag) => Math.min(width * 0.7, 46 + (t.full_name || t.username || 'Member').length * 7.2);
  const placed: { t: MediaTag; dx: number; dy: number; x: number; y: number; w: number }[] = [];
  [...tags].sort((a, b) => a.ny - b.ny || a.nx - b.nx).forEach(t => {
    const dx = Math.max(6, Math.min(width - 6, t.nx * width)); const dy = Math.max(6, Math.min(height - 6, t.ny * height));
    const w = EST(t);
    let x = dx - 10; if (x + w > width - 6) x = width - 6 - w; if (x < 6) x = 6;
    let y = dy + 10; if (y + PILL_H > height - 6) y = dy - 10 - PILL_H;
    for (let guard = 0; guard < 12; guard++) {
      const hit = placed.find(p => !(x + w < p.x || p.x + p.w < x) && Math.abs(y - p.y) < PILL_H + GAP);
      if (!hit) break;
      y = hit.y + PILL_H + GAP;
      if (y + PILL_H > height - 6) { y = Math.max(6, hit.y - PILL_H - GAP); }
    }
    placed.push({ t, dx, dy, x, y, w });
  });
  // The count mark keeps the bottom-left corner unless a tag lives there; then it moves to the bottom-right.
  const markRight = placed.some(p => p.y + PILL_H > height - 44 && p.x < 130) || tags.some(t => t.ny > 0.82 && t.nx < 0.35);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {open ? placed.map(({ t, dx, dy, x, y, w }) => {
        const moved = Math.abs((y - 10) - dy) > 14 || Math.abs((x + 10) - dx) > 14;
        return (
          <React.Fragment key={t.user_id}>
            {moved ? <View pointerEvents="none" style={{ position: 'absolute', left: dx - 1, top: Math.min(dy, y + PILL_H / 2), width: 2, height: Math.abs((y + PILL_H / 2) - dy), backgroundColor: 'rgba(255,255,255,0.55)' }} /> : null}
            <View pointerEvents="none" style={{ position: 'absolute', left: dx - 5, top: dy - 5, width: 10, height: 10, borderRadius: 5, backgroundColor: '#C9BFB0', borderWidth: 1.5, borderColor: '#FFFFFF' }} />
            <TouchableOpacity onPress={() => nav.navigate('UserProfile', { userId: t.user_id })} activeOpacity={0.85}
              style={{ position: 'absolute', left: x, top: y, height: PILL_H, maxWidth: width * 0.7, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(11,30,61,0.88)', borderRadius: 15, paddingLeft: 4, paddingRight: 10 }}>
              {t.avatar_url ? <Image source={{ uri: t.avatar_url }} style={{ width: 22, height: 22, borderRadius: 11 }} /> : <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: '#C9BFB0' }} />}
              <TierName userId={t.user_id} baseStyle={{ color: '#FFFFFF', fontSize: 12.5, fontWeight: '700', flexShrink: 1 }} text={t.full_name || t.username || 'Member'} />
              <VerifiedBadge userId={t.user_id} size={12} />
            </TouchableOpacity>
          </React.Fragment>
        );
      }) : null}
      <TouchableOpacity onPress={() => setOpen(o => !o)} activeOpacity={0.85} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={{ position: 'absolute', left: markRight ? undefined : 10, right: markRight ? 10 : undefined, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: open ? '#C9BFB0' : 'rgba(0,0,0,0.5)', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: open ? '#0B1E3D' : '#C9BFB0' }} />
        <Text style={{ color: open ? '#0B1E3D' : '#FFFFFF', fontSize: 11, fontWeight: '800' }}>{tags.length}</Text>
      </TouchableOpacity>
    </View>
  );
}

function getRatio(item: PostMedia) {
  if (item.width && item.height && item.width > 0 && item.height > 0) {
    return item.width / item.height;
  }
  return 4 / 5;
}

function getHeightFromRatio(width: number, ratio: number, maxHeight: number) {
  const safeRatio = ratio && ratio > 0.1 && ratio < 10 ? ratio : 4 / 5;
  return Math.min(Math.round(width / safeRatio), maxHeight);
}

function ZoomModal({
  images,
  startIndex,
  visible,
  onClose,
}: {
  images: PostMedia[];
  startIndex: number;
  visible: boolean;
  onClose: () => void;
}) {
  const [active, setActive] = useState(startIndex);

  useEffect(() => {
    if (visible) setActive(startIndex);
  }, [visible, startIndex]);

  const onScroll = useCallback((e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    setActive(Math.max(0, Math.min(idx, images.length - 1)));
  }, [images.length]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={z.overlay}>
        <StatusBar hidden />
        <TouchableOpacity
          style={z.closeBtn}
          onPress={onClose}
          hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
        >
          <Text style={z.closeX}>✕</Text>
        </TouchableOpacity>

        <FlatList
          data={images}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(_, i) => String(i)}
          initialScrollIndex={startIndex}
          getItemLayout={(_, i) => ({ length: SCREEN_W, offset: SCREEN_W * i, index: i })}
          onMomentumScrollEnd={onScroll}
          renderItem={({ item }) => (
            <ScrollView
              style={{ width: SCREEN_W, height: SCREEN_H }}
              contentContainerStyle={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
              maximumZoomScale={4}
              minimumZoomScale={1}
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              centerContent
              bouncesZoom
            >
              <Image
                source={{ uri: item.url }}
                style={{ width: SCREEN_W, height: SCREEN_H }}
                resizeMode="contain"
              />
            </ScrollView>
          )}
        />

        {images.length > 1 && (
          <View style={z.dots}>
            {images.map((_, i) => (
              <View key={i} style={[z.dot, i === active && z.dotActive]} />
            ))}
          </View>
        )}
      </View>
    </Modal>
  );
}

function SingleImage({
  item,
  width,
  maxH,
  fullBleed,
}: {
  item: PostMedia;
  width: number;
  maxH: number;
  fullBleed: boolean;
}) {
  const initialRatio = item.width && item.height && item.width > 0 && item.height > 0
    ? item.width / item.height
    : null;

  const [ratio, setRatio] = useState<number | null>(initialRatio);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    if (ratio) return;
    if (!item.url) return;

    Image.getSize(
      item.url,
      (w, h) => {
        if (w > 0 && h > 0) setRatio(w / h);
      },
      () => setRatio(4 / 5)
    );
  }, [item.url, ratio]);

  const finalRatio = ratio || getRatio(item);
  const height = getHeightFromRatio(width, finalRatio, maxH);
  const radius = fullBleed ? 0 : 14;

  return (
    <View
      pointerEvents="none"
      style={{
        width,
        height,
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: '#F0F0F0',
      }}
    >
      <Image
        source={{ uri: item.url }}
        style={{ width, height, transform: editStyle(item, width, height).transform }}
        resizeMode={editStyle(item, width, height).fit}
        onLoad={() => setStatus('ok')}
        onError={(e) => {
          console.log('[IMG_ERR]', item.url, e.nativeEvent.error);
          setStatus('error');
        }}
      />
      <EditOverlays item={item} />

      {status === 'loading' && (
        <View style={[StyleSheet.absoluteFillObject, s.centered, { backgroundColor: '#F0F0F0' }]}>
          <ActivityIndicator color="#C7C7CC" size="small" />
        </View>
      )}

      {status === 'error' && (
        <View style={[StyleSheet.absoluteFillObject, s.centered, { backgroundColor: '#F2F2F7' }]}>
          <Text style={{ color: '#8E8E93', fontSize: 13 }}>Could not load image</Text>
        </View>
      )}
    </View>
  );
}

function VideoItem({
  item,
  width,
  fullBleed,
  isActive,
  maxHeight,
}: {
  item: PostMedia;
  width: number;
  fullBleed: boolean;
  isActive: boolean;
  maxHeight: number;
}) {
  const ratio = getRatio(item);
  const height = getHeightFromRatio(width, ratio, maxHeight);
  const radius = fullBleed ? 0 : 14;

  useEffect(() => {
    ensureAudioSession();
  }, []);

  const player = useVideoPlayer(item.url, p => {
    p.loop = true;
    p.muted = !!item.edit?.muted;
    p.volume = item.edit?.muted ? 0 : 1.0;
    try { (p as any).timeUpdateEventInterval = 0.1; } catch {}
  });

  useEffect(() => {
    if (isActive) player.play();
    else player.pause();
  }, [isActive, player]);
  // Trim window from the edit recipe: seek to the start and loop inside it.
  useEffect(() => {
    const e = item.edit; const p: any = player; if (!e || !p) return;
    const t0 = typeof e.trimStart === 'number' ? e.trimStart : 0; const t1 = typeof e.trimEnd === 'number' && e.trimEnd > t0 ? e.trimEnd : null;
    if (t0 > 0.05) { try { p.currentTime = t0; } catch {} }
    let sub: any = null;
    try { sub = p.addListener?.('timeUpdate', (ev: any) => { const t = typeof ev?.currentTime === 'number' ? ev.currentTime : p.currentTime; if (t1 != null && typeof t === 'number' && t >= t1 - 0.05) { try { p.currentTime = t0; } catch {} } }); } catch {}
    return () => { try { sub?.remove?.(); } catch {} };
  }, [player, item.edit]);

  return (
    <View
      pointerEvents="none"
      style={{
        width,
        height,
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: '#F0F0F0',
      }}
    >
      <VideoView
        pointerEvents="none"
        player={player}
        style={{ width, height, transform: editStyle(item, width, height).transform }}
        contentFit={editStyle(item, width, height).fit === 'contain' ? 'contain' : 'cover'}
        nativeControls={false}
        allowsPictureInPicture={false}
      />
      <EditOverlays item={item} />
    </View>
  );
}

function CarouselImageItem({
  item,
  width,
  height,
}: {
  item: PostMedia;
  width: number;
  height: number;
}) {
  return (
    <View style={{ width, height, backgroundColor: '#F0F0F0', overflow: 'hidden' }}>
      <Image
        source={{ uri: item.url }}
        style={{ width, height }}
        resizeMode="cover"
        onError={(e: any) => console.log('[CAROUSEL_IMG_ERR]', item.url, e.nativeEvent.error)}
      />
    </View>
  );
}

function CarouselVideoItem({
  item,
  width,
  height,
  isActive,
}: {
  item: PostMedia;
  width: number;
  height: number;
  isActive: boolean;
}) {
  useEffect(() => {
    ensureAudioSession();
  }, []);

  const player = useVideoPlayer(item.url, p => {
    p.loop = true;
    p.muted = !!item.edit?.muted;
    p.volume = item.edit?.muted ? 0 : 1.0;
    try { (p as any).timeUpdateEventInterval = 0.1; } catch {}
  });

  useEffect(() => {
    if (isActive) player.play();
    else player.pause();
  }, [isActive, player]);
  // Trim window from the edit recipe: seek to the start and loop inside it.
  useEffect(() => {
    const e = item.edit; const p: any = player; if (!e || !p) return;
    const t0 = typeof e.trimStart === 'number' ? e.trimStart : 0; const t1 = typeof e.trimEnd === 'number' && e.trimEnd > t0 ? e.trimEnd : null;
    if (t0 > 0.05) { try { p.currentTime = t0; } catch {} }
    let sub: any = null;
    try { sub = p.addListener?.('timeUpdate', (ev: any) => { const t = typeof ev?.currentTime === 'number' ? ev.currentTime : p.currentTime; if (t1 != null && typeof t === 'number' && t >= t1 - 0.05) { try { p.currentTime = t0; } catch {} } }); } catch {}
    return () => { try { sub?.remove?.(); } catch {} };
  }, [player, item.edit]);

  return (
    <View style={{ width, height, backgroundColor: '#F0F0F0', overflow: 'hidden' }}>
      <VideoView
        player={player}
        style={{ width, height }}
        contentFit="cover"
        nativeControls={false}
        allowsPictureInPicture={false}
      />
    </View>
  );
}

function Carousel({
  items,
  width,
  fullBleed,
  isActive,
  maxHeight,
}: {
  items: PostMedia[];
  width: number;
  fullBleed: boolean;
  isActive: boolean;
  maxHeight: number;
}) {
  const [active, setActive] = useState(0);
  const first = items[0];
  const ratio = getRatio(first);
  const calculatedMediaHeight = getHeightFromRatio(width, ratio, maxHeight);
  const radius = fullBleed ? 0.001 : 14;

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / width);
    setActive(Math.max(0, Math.min(idx, items.length - 1)));
  }, [width, items.length]);

  if (items.length < 2) {
    const solo = items[0];
    if (solo.media_type === 'video') {
      return <VideoItem item={solo} width={width} fullBleed={fullBleed} isActive={isActive} maxHeight={maxHeight} />;
    }
    return <SingleImage item={solo} width={width} maxH={maxHeight} fullBleed={fullBleed} />;
  }

  return (
    <View style={{ width }}>
      <View
        style={{
          width,
          height: calculatedMediaHeight,
          maxHeight: calculatedMediaHeight,
          borderRadius: radius,
          overflow: 'hidden',
          backgroundColor: '#F0F0F0',
        }}
      >
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScroll}
          scrollEventThrottle={16}
          decelerationRate="fast"
          overScrollMode="never"
          bounces={false}
          nestedScrollEnabled
          directionalLockEnabled
          removeClippedSubviews
          style={{
            width,
            height: calculatedMediaHeight,
            maxHeight: calculatedMediaHeight,
            overflow: 'hidden',
          }}
          contentContainerStyle={{
            width: width * items.length,
            height: calculatedMediaHeight,
            maxHeight: calculatedMediaHeight,
            flexDirection: 'row',
            alignItems: 'stretch',
          }}
        >
          {items.map((item, i) => (
            <View
              key={item.id || `carousel-${i}`}
              style={{
                width,
                height: calculatedMediaHeight,
                maxHeight: calculatedMediaHeight,
                overflow: 'hidden',
              }}
            >
              {item.media_type === 'video' ? (
                <CarouselVideoItem
                  item={item}
                  width={width}
                  height={calculatedMediaHeight}
                  isActive={isActive && i === active}
                />
              ) : (
                <CarouselImageItem
                  item={item}
                  width={width}
                  height={calculatedMediaHeight}
                />
              )}
            </View>
          ))}
        </ScrollView>
      </View>

      {items.length > 1 && (
        <View style={s.dots}>
          {items.map((_, i) => (
            <View key={i} style={[s.dot, i === active && s.dotActive]} />
          ))}
        </View>
      )}
      {items.length > 1 && (
        <View style={s.counterChip} pointerEvents="none">
          <Text style={s.counterTxt}>{active + 1}/{items.length}</Text>
        </View>
      )}
    </View>
  );
}

export default function MediaRenderer({
  media,
  containerWidth,
  fullBleed = false,
  maxHeight = 420,
  isActive = false,
}: Props) {
  const tagMap = useMediaTags((media || []).map((m: any) => m.id));
  const [zoomIndex, setZoomIndex] = useState(0);
  const [zoomVisible, setZoomVisible] = useState(false);

  if (!media?.length) return null;

  const sorted = [...media].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const sortedT = sorted.map((m: any) => (tagMap[m.id] && tagMap[m.id].length ? { ...m, tags: tagMap[m.id] } : m));
  const imageItems = sorted.filter(m => m.media_type !== 'video');

  if (__DEV__ && sorted.length > 1) {
    console.log('[MediaRenderer] carousel mode:', sorted.length, 'items, fullBleed:', fullBleed, 'width:', containerWidth);
  }

  if (sorted.length === 1 && sorted[0].media_type === 'video') {
    return (
      <PinchInspect>
      <View style={{ marginTop: 8 }}>
        <VideoItem
          item={sortedT[0]}
          width={containerWidth}
          fullBleed={fullBleed}
          isActive={isActive}
          maxHeight={maxHeight}
        />
      </View>
      </PinchInspect>
    );
  }

  if (sorted.length === 1) {
    return (
      <>
        <ZoomModal
          images={imageItems}
          startIndex={zoomIndex}
          visible={zoomVisible}
          onClose={() => setZoomVisible(false)}
        />
        <PinchInspect>
        <View style={{ marginTop: 8 }}>
          <SingleImage
            item={sortedT[0]}
            width={containerWidth}
            maxH={maxHeight}
            fullBleed={fullBleed}
          />
        </View>
        </PinchInspect>
      </>
    );
  }

  return (
    <>
      <ZoomModal
        images={imageItems}
        startIndex={zoomIndex}
        visible={zoomVisible}
        onClose={() => setZoomVisible(false)}
      />
      <PinchInspect>
      <View style={{ marginTop: 8 }}>
        <Carousel
          items={sortedT}
          width={containerWidth}
          fullBleed={fullBleed}
          isActive={isActive}
          maxHeight={maxHeight}
        />
      </View>
      </PinchInspect>
    </>
  );
}

/**
 * Pinch to inspect, the Instagram feed gesture. Media scales around the
 * midpoint between the fingers and lifts above its neighbours; letting go
 * springs it back. Video keeps playing throughout. The gesture is transient
 * and never stored, and it is not the crop editor.
 */
function PinchInspect({ children }: { children: React.ReactNode }) {
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const active = useSharedValue(0);
  const pinch = Gesture.Pinch()
    .onStart((e) => { fx.value = e.focalX; fy.value = e.focalY; active.value = 1; })
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(4, e.scale));
      tx.value = e.focalX - fx.value;
      ty.value = e.focalY - fy.value;
    })
    .onEnd(() => {
      scale.value = withSpring(1, { damping: 18, stiffness: 180 });
      tx.value = withSpring(0); ty.value = withSpring(0);
      active.value = 0;
    });
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
    zIndex: scale.value > 1 ? 50 : 0,
  }));
  return (
    <GestureDetector gesture={pinch}>
      <Animated.View style={style}>{children}</Animated.View>
    </GestureDetector>
  );
}

const s = StyleSheet.create({
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 8,
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D1D5DB',
  },
  dotActive: {
    backgroundColor: '#111827',
    width: 6,
    borderRadius: 3,
  },
  counterChip: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 12,
  },
  counterTxt: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
});

const z = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 16,
    right: 20,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeX: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  dots: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 48 : 24,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  dotActive: {
    backgroundColor: '#FFF',
    width: 18,
    borderRadius: 3,
  },
});
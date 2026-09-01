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
  const [zoomIndex, setZoomIndex] = useState(0);
  const [zoomVisible, setZoomVisible] = useState(false);

  if (!media?.length) return null;

  const sorted = [...media].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const imageItems = sorted.filter(m => m.media_type !== 'video');

  if (__DEV__ && sorted.length > 1) {
    console.log('[MediaRenderer] carousel mode:', sorted.length, 'items, fullBleed:', fullBleed, 'width:', containerWidth);
  }

  if (sorted.length === 1 && sorted[0].media_type === 'video') {
    return (
      <View style={{ marginTop: 8 }}>
        <VideoItem
          item={sorted[0]}
          width={containerWidth}
          fullBleed={fullBleed}
          isActive={isActive}
          maxHeight={maxHeight}
        />
      </View>
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
        <View style={{ marginTop: 8 }}>
          <SingleImage
            item={sorted[0]}
            width={containerWidth}
            maxH={maxHeight}
            fullBleed={fullBleed}
          />
        </View>
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
          items={sorted}
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
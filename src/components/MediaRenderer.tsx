/**
 * MediaRenderer.tsx — v5
 *
 * Images: React Native Image (stable, no bad caching)
 * Videos: expo-video VideoView + useVideoPlayer (SDK 54, works in Expo Go)
 * Audio:  expo-audio setAudioModeAsync — plays through iOS silent mode
 * Zoom:   full-screen modal with pinch-to-zoom ScrollView
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, FlatList, Modal, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Image, Platform,
  Dimensions, StatusBar, Text,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { setAudioModeAsync } from 'expo-audio';

export type PostMedia = {
  id: string;
  url: string;
  media_type: 'image' | 'video';
  width?: number | null;
  height?: number | null;
  sort_order?: number;
};

type Props = {
  media: PostMedia[];
  containerWidth: number;
  fullBleed?: boolean;
  maxHeight?: number;
  /** When true, videos in this post autoplay. When false, they pause. */
  isActive?: boolean;
};

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;

// ── Audio session setup — called once, lets video play in silent mode ─────────

let audioSessionReady = false;
async function ensureAudioSession() {
  if (audioSessionReady) return;
  try {
    await setAudioModeAsync({ allowsRecording: false, playsInSilentModeIOS: true });
    audioSessionReady = true;
  } catch (e) {
    console.log('[MEDIA] audio session setup failed (non-fatal):', e);
  }
}

// ── Zoom Modal ────────────────────────────────────────────────────────────────

function ZoomModal({
  images, startIndex, visible, onClose,
}: {
  images: PostMedia[];
  startIndex: number;
  visible: boolean;
  onClose: () => void;
}) {
  const [active, setActive] = useState(startIndex);

  useEffect(() => { if (visible) setActive(startIndex); }, [visible, startIndex]);

  const onScroll = useCallback((e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    setActive(Math.max(0, Math.min(idx, images.length - 1)));
  }, [images.length]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={z.overlay}>
        <StatusBar hidden />
        <TouchableOpacity
          style={z.closeBtn} onPress={onClose}
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

// ── Single Image ──────────────────────────────────────────────────────────────

function SingleImage({
  item, width, maxH, fullBleed, onPress,
}: {
  item: PostMedia; width: number; maxH: number; fullBleed: boolean; onPress: () => void;
}) {
  const [imgH, setImgH] = useState(() => {
    if (item.width && item.height && item.width > 0 && item.height > 0) {
      const ratio = Math.min(Math.max(item.height / item.width, 0.35), 1.5);
      return Math.round(width * ratio);
    }
    return Math.round(width * 0.5625); // default 16:9
  });
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    if (item.width && item.height) return;
    if (!item.url) return;
    Image.getSize(item.url, (w, h) => {
      if (w > 0 && h > 0) {
        const ratio = Math.min(Math.max(h / w, 0.35), 1.5);
        setImgH(Math.round(width * ratio));
      }
    }, () => {});
  }, [item.url]);

  const h = Math.min(imgH, maxH);
  const radius = fullBleed ? 0 : 14;

  // Use contain for portrait/square (ratio >= 0.8), cover for landscape
  const isPortrait = imgH >= width * 0.75;
  const rm = isPortrait ? 'contain' : 'cover';
  const bg = isPortrait ? '#000' : '#F0F0F0';

  return (
    <TouchableOpacity
      activeOpacity={0.96} onPress={onPress}
      style={{ width, height: h, borderRadius: radius, overflow: 'hidden', backgroundColor: bg }}
    >
      <Image
        source={{ uri: item.url }}
        style={{ width, height: h }}
        resizeMode={rm}
        onLoad={() => setStatus('ok')}
        onError={(e) => {
          console.log('[IMG_ERR]', item.url, e.nativeEvent.error);
          setStatus('error');
        }}
      />
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
    </TouchableOpacity>
  );
}

// ── Video ─────────────────────────────────────────────────────────────────────

function VideoItem({ item, width, fullBleed, isActive }: { item: PostMedia; width: number; fullBleed: boolean; isActive: boolean }) {
  const h = item.width && item.height
    ? Math.min(Math.round(width * item.height / item.width), 400)
    : Math.round(width * 0.6);
  const radius = fullBleed ? 0 : 14;

  // Set up audio session so video plays even in iOS silent mode
  useEffect(() => { ensureAudioSession(); }, []);

  const player = useVideoPlayer(item.url, p => {
    p.loop = true;    // loop while in view — like Instagram/Twitter
    p.muted = false;
    p.volume = 1.0;
  });

  // Autoplay when post scrolls into view, pause when it leaves
  useEffect(() => {
    if (isActive) {
      player.play();
    } else {
      player.pause();
    }
  }, [isActive]);

  return (
    <View style={{ width, height: h, borderRadius: radius, overflow: 'hidden', backgroundColor: '#000' }}>
      <VideoView
        player={player}
        style={{ width, height: h }}
        contentFit="contain"
        nativeControls
        allowsPictureInPicture={false}
      />
    </View>
  );
}

// ── Carousel Item — handles image AND video in same list ─────────────────────

const CAROUSEL_H = Math.round(SCREEN_W * 0.7);

function CarouselItem({
  item, width, onPress, isActive,
}: { item: PostMedia; width: number; onPress: () => void; isActive: boolean }) {
  // Video inside carousel — needs its own player instance
  if (item.media_type === 'video') {
    useEffect(() => { ensureAudioSession(); }, []);
    const player = useVideoPlayer(item.url, p => {
      p.loop = true;
      p.muted = false;
      p.volume = 1.0;
    });

    // Autoplay when carousel post is active
    useEffect(() => {
      if (isActive) { player.play(); } else { player.pause(); }
    }, [isActive]);
    return (
      <View style={{ width, height: CAROUSEL_H, backgroundColor: '#000' }}>
        <VideoView
          player={player}
          style={{ width, height: CAROUSEL_H }}
          contentFit="contain"
          nativeControls
          allowsPictureInPicture={false}
        />
      </View>
    );
  }

  // Image inside carousel
  return (
    <TouchableOpacity
      activeOpacity={0.96}
      onPress={onPress}
      style={{ width, height: CAROUSEL_H, backgroundColor: '#111' }}
    >
      <Image
        source={{ uri: item.url }}
        style={{ width, height: CAROUSEL_H }}
        resizeMode="contain"
        onError={(e: any) => console.log('[CAROUSEL_IMG_ERR]', item.url, e.nativeEvent.error)}
      />
    </TouchableOpacity>
  );
}

// ── Carousel ──────────────────────────────────────────────────────────────────

function Carousel({
  items, width, fullBleed, onItemPress, isActive,
}: {
  items: PostMedia[]; width: number; fullBleed: boolean; onItemPress: (i: number) => void; isActive: boolean;
}) {
  const [active, setActive] = useState(0);
  const radius = fullBleed ? 0 : 14;

  const onScroll = useCallback((e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / width);
    setActive(Math.max(0, Math.min(idx, items.length - 1)));
  }, [width, items.length]);

  return (
    <View>
      <FlatList
        data={items}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        onMomentumScrollEnd={onScroll}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        style={{ borderRadius: radius, overflow: 'hidden' }}
        renderItem={({ item, index }) => (
          <CarouselItem
            item={item}
            width={width}
            onPress={() => onItemPress(index)}
            isActive={isActive}
          />
        )}
      />
      {items.length > 1 && (
        <View style={s.dots}>
          {items.map((_, i) => (
            <View key={i} style={[s.dot, i === active && s.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function MediaRenderer({
  media, containerWidth, fullBleed = false, maxHeight = 420, isActive = false,
}: Props) {
  const [zoomIndex, setZoomIndex] = useState(0);
  const [zoomVisible, setZoomVisible] = useState(false);

  if (!media?.length) return null;

  const sorted = [...media].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const imageItems = sorted.filter(m => m.media_type !== 'video');
  const openZoom = (i: number) => { setZoomIndex(i); setZoomVisible(true); };

  // Single video
  if (sorted.length === 1 && sorted[0].media_type === 'video') {
    return (
      <View style={{ marginTop: 8 }}>
        <VideoItem item={sorted[0]} width={containerWidth} fullBleed={fullBleed} isActive={isActive} />
      </View>
    );
  }

  // Single image
  if (sorted.length === 1) {
    return (
      <>
        <ZoomModal images={imageItems} startIndex={zoomIndex} visible={zoomVisible} onClose={() => setZoomVisible(false)} />
        <View style={{ marginTop: 8 }}>
          <SingleImage item={sorted[0]} width={containerWidth} maxH={maxHeight} fullBleed={fullBleed} onPress={() => openZoom(0)} />
        </View>
      </>
    );
  }

  // Multiple — carousel
  return (
    <>
      <ZoomModal images={imageItems} startIndex={zoomIndex} visible={zoomVisible} onClose={() => setZoomVisible(false)} />
      <View style={{ marginTop: 8 }}>
        <Carousel items={sorted} width={containerWidth} fullBleed={fullBleed} onItemPress={openZoom} isActive={isActive} />
      </View>
    </>
  );
}

const s = StyleSheet.create({
  centered: { alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingTop: 8, gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D1D5DB' },
  dotActive: { backgroundColor: '#111827', width: 18, borderRadius: 3 },
});

const z = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  closeBtn: {
    position: 'absolute', top: Platform.OS === 'ios' ? 56 : 16, right: 20,
    zIndex: 10, width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center',
  },
  closeX: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  dots: { position: 'absolute', bottom: Platform.OS === 'ios' ? 48 : 24, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotActive: { backgroundColor: '#FFF', width: 18, borderRadius: 3 },
});
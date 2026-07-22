/**
 * PostCarousel.tsx
 * Instagram-style horizontal media carousel for multi-photo/video posts.
 * Place at: src/components/PostCarousel.tsx
 *
 * Design rules:
 *  - Fixed 4:5 portrait container (width:height = 4:5, height = width * 1.25)
 *  - Cover mode, crop overflow, never stretch
 *  - Every post same height, no dynamic resizing
 *  - Horizontal paging, one image per page, snap to page
 *  - No partial images visible
 *  - Overflow hidden on container
 *  - Page dots at bottom center + "1/5" counter top right
 *  - Video autoplay when visible, tap to show/hide controls
 *  - Video controls: play/pause, 10s back, 10s forward, mute/unmute
 *  - Single image still uses same 4:5 container
 *  - Identical layout on feed and post screens
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, ViewToken, Animated,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { Feather } from '@expo/vector-icons';

export type CarouselMedia = {
  id: string;
  url: string;
  media_type: 'image' | 'video';
  sort_order: number;
  width?: number | null;
  height?: number | null;
};

type Props = {
  media: CarouselMedia[];
  containerWidth: number;
  isActive?: boolean;
  onMediaPress?: (index?: number) => void;
};

// 4:5 portrait = height is 1.25x width (same as Instagram)
const HEIGHT_RATIO = 5 / 4; // 1.25

// Feed sound rule: autoplay muted; once the user unmutes, new videos inherit sound this session
let sessionMuted = true;

function CarouselImage({ uri, width, height }: { uri: string; width: number; height: number }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <View style={{ width, height, backgroundColor: '#F0F0F0' }}>
      <ExpoImage
        source={{ uri }}
        style={{ width: '100%', height: '100%' }}
        contentFit="cover"
        contentPosition="center"
        cachePolicy="memory-disk"
        priority="high"
        transition={200}
        onLoad={() => setLoaded(true)}
        onError={(e: any) => console.log('[CAROUSEL_IMG_ERR]', uri, e?.error)}
      />
      {!loaded && (
        <View style={st.loadingOverlay}>
          <ActivityIndicator color="#C7C7CC" size="small" />
        </View>
      )}
    </View>
  );
}

function CarouselVideo({
  uri, width, height, isVisible, isScreenActive,
}: {
  uri: string; width: number; height: number;
  isVisible: boolean; isScreenActive: boolean;
}) {
  const videoRef = useRef<Video>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(sessionMuted);
  const [showControls, setShowControls] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controlsOpacity = useRef(new Animated.Value(0)).current;

  const shouldPlay = isVisible && isScreenActive && !paused;

  // Auto-hide controls after 3 seconds
  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      Animated.timing(controlsOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        setShowControls(false);
      });
    }, 3000);
  }, [controlsOpacity]);

  // Clean up timer
  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const toggleControls = () => {
    if (showControls) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      Animated.timing(controlsOpacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
        setShowControls(false);
      });
    } else {
      setShowControls(true);
      Animated.timing(controlsOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      scheduleHide();
    }
  };

  const togglePause = () => {
    setPaused(prev => !prev);
    scheduleHide();
  };

  const toggleMute = () => {
    setMuted(prev => { sessionMuted = !prev; return !prev; });
    scheduleHide();
  };

  const skipForward = async () => {
    try {
      const status = await videoRef.current?.getStatusAsync();
      if (status?.isLoaded && status.durationMillis) {
        const newPos = Math.min(status.positionMillis + 10000, status.durationMillis);
        await videoRef.current?.setPositionAsync(newPos);
      }
    } catch (e) {
      console.log('[SKIP_FWD_ERR]', e);
    }
    scheduleHide();
  };

  const skipBackward = async () => {
    try {
      const status = await videoRef.current?.getStatusAsync();
      if (status?.isLoaded) {
        const newPos = Math.max(status.positionMillis - 10000, 0);
        await videoRef.current?.setPositionAsync(newPos);
      }
    } catch (e) {
      console.log('[SKIP_BACK_ERR]', e);
    }
    scheduleHide();
  };

  return (
    <TouchableOpacity
      style={{ width, height, backgroundColor: '#000' }}
      activeOpacity={1}
      onPress={toggleControls}
    >
      <Video
        ref={videoRef}
        source={{ uri }}
        style={{ width: '100%', height: '100%' }}
        resizeMode={ResizeMode.COVER}
        shouldPlay={shouldPlay}
        isLooping
        isMuted={muted}
      />

      {/* Mute button always visible bottom-right */}
      <TouchableOpacity
        style={st.muteBtn}
        onPress={toggleMute}
        activeOpacity={0.8}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Feather name={muted ? 'volume-x' : 'volume-2'} size={14} color="#FFF" />
      </TouchableOpacity>

      {/* Controls overlay */}
      {showControls && (
        <Animated.View
          style={[st.controlsOverlay, { opacity: controlsOpacity }]}
          pointerEvents="box-none"
        >
          <View style={st.controlsRow}>
            <TouchableOpacity style={st.controlBtn} onPress={skipBackward} activeOpacity={0.7}>
              <Feather name="rotate-ccw" size={22} color="#FFF" />
              <Text style={st.controlLabel}>10</Text>
            </TouchableOpacity>

            <TouchableOpacity style={st.controlBtnCenter} onPress={togglePause} activeOpacity={0.7}>
              <Feather name={paused ? 'play' : 'pause'} size={32} color="#FFF" />
            </TouchableOpacity>

            <TouchableOpacity style={st.controlBtn} onPress={skipForward} activeOpacity={0.7}>
              <Feather name="rotate-cw" size={22} color="#FFF" />
              <Text style={st.controlLabel}>10</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}
    </TouchableOpacity>
  );
}

export default function PostCarousel({ media, containerWidth, isActive = true, onMediaPress }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const slideHeight = Math.round(containerWidth * HEIGHT_RATIO);
  const total = media.length;

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index != null) {
      setActiveIndex(viewableItems[0].index);
    }
  }, []);

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
  }).current;

  const renderItem = useCallback(({ item, index }: { item: CarouselMedia; index: number }) => {
    if (item.media_type === 'video') {
      return (
        <CarouselVideo
          uri={item.url}
          width={containerWidth}
          height={slideHeight}
          isVisible={index === activeIndex}
          isScreenActive={isActive}
        />
      );
    }
    return (
      <TouchableOpacity activeOpacity={0.97} onPress={() => onMediaPress && onMediaPress(index)} disabled={!onMediaPress}>
        <CarouselImage
          uri={item.url}
          width={containerWidth}
          height={slideHeight}
        />
      </TouchableOpacity>
    );
  }, [containerWidth, slideHeight, activeIndex, isActive, onMediaPress]);


  if (total === 0) return null;

  // Single media item: same 4:5 container, no dots, no counter
  if (total === 1) {
    const item = media[0];
    return (
      <View style={st.carouselWrap}>
        <View style={{ width: containerWidth, height: slideHeight, overflow: 'hidden' }}>
          {item.media_type === 'video' ? (
            <CarouselVideo
              uri={item.url}
              width={containerWidth}
              height={slideHeight}
              isVisible={true}
              isScreenActive={isActive}
            />
          ) : (
            <TouchableOpacity activeOpacity={0.97} onPress={() => onMediaPress && onMediaPress(0)} disabled={!onMediaPress}>
              <CarouselImage
                uri={item.url}
                width={containerWidth}
                height={slideHeight}
              />
            </TouchableOpacity>
          )}

        </View>
      </View>
    );
  }

  return (
    <View style={st.carouselWrap}>
      <View style={{ height: slideHeight, overflow: 'hidden' }}>
        <FlatList
          data={media}
          keyExtractor={(item) => item.id || String(item.sort_order)}
          renderItem={renderItem}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          decelerationRate="fast"
          snapToInterval={containerWidth}
          snapToAlignment="start"
          getItemLayout={(_, index) => ({
            length: containerWidth,
            offset: containerWidth * index,
            index,
          })}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          initialNumToRender={2}
          maxToRenderPerBatch={3}
          windowSize={3}
        />

        {/* Counter badge top right */}
        <View style={st.counterBadge}>
          <Text style={st.counterTxt}>{activeIndex + 1}/{total}</Text>
        </View>
      </View>

      {/* Page dots below the image */}
      <View style={st.dotsRow}>
        {media.map((_, i) => (
          <View
            key={i}
            style={[
              st.dot,
              i === activeIndex ? st.dotActive : st.dotInactive,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  carouselWrap: {
    marginTop: 10,
    overflow: 'hidden',
  },
  loadingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F0F0F0',
  },
  controlsOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 40,
  },
  controlBtn: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center', justifyContent: 'center',
  },
  controlBtnCenter: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  controlLabel: {
    fontSize: 9, fontWeight: '700', color: '#FFF',
    marginTop: -2,
  },
  muteBtn: {
    position: 'absolute', bottom: 12, right: 12,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  counterBadge: {
    position: 'absolute', top: 12, right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4,
  },
  counterTxt: {
    fontSize: 12, fontWeight: '700', color: '#FFF',
  },
  dotsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingTop: 10, paddingBottom: 2, gap: 5,
  },
  dot: {
    width: 6, height: 6, borderRadius: 3,
  },
  dotActive: {
    backgroundColor: '#007AFF', width: 7, height: 7, borderRadius: 3.5,
  },
  dotInactive: {
    backgroundColor: '#D1D1D6',
  },
});
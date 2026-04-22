/**
 * MediaViewer.tsx
 * Edge-to-edge fullscreen viewer for images, gifs, and videos.
 * Horizontal swipe between items, Save to Photos, Share.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Modal, StyleSheet, Pressable, FlatList,
  Dimensions, ActivityIndicator, StatusBar, Alert, Share, BackHandler,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { Feather } from '@expo/vector-icons';

const { width: W, height: H } = Dimensions.get('window');

export type MediaViewerItem = {
  id: string;
  url: string;
  kind: 'image' | 'video' | 'gif';
};

type Props = {
  visible: boolean;
  items: MediaViewerItem[];
  initialIndex: number;
  onClose: () => void;
};

function VideoSlide({ url, active }: { url: string; active: boolean }) {
  const player = useVideoPlayer(url, (p) => { p.loop = false; });
  useEffect(() => {
    try {
      if (active) player.play();
      else player.pause();
    } catch {}
  }, [active, player]);
  return (
    <VideoView
      style={styles.media}
      player={player}
      contentFit="contain"
      nativeControls
      allowsFullscreen
    />
  );
}

export default function MediaViewer({ visible, items, initialIndex, onClose }: Props) {
  const [index, setIndex] = useState(initialIndex);
  const [saving, setSaving] = useState(false);
  const listRef = useRef<FlatList<MediaViewerItem>>(null);

  useEffect(() => {
    if (visible) setIndex(initialIndex);
  }, [initialIndex, visible]);

  // Hardware back button on Android closes viewer.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  const current = items[index];

  const onScrollEnd = useCallback((e: any) => {
    const x = e.nativeEvent.contentOffset.x;
    const next = Math.round(x / W);
    setIndex(Math.max(0, Math.min(items.length - 1, next)));
  }, [items.length]);

  const saveCurrent = useCallback(async () => {
    if (!current) return;
    setSaving(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission required', 'Allow photo library access to save.');
        return;
      }
      const ext = current.kind === 'video' ? 'mp4' : current.kind === 'gif' ? 'gif' : 'jpg';
      const localPath = `${FileSystem.cacheDirectory}save_${Date.now()}.${ext}`;
      const { uri } = await FileSystem.downloadAsync(current.url, localPath);
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert('Saved', current.kind === 'video' ? 'Video saved to your library.' : 'Saved to your library.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  }, [current]);

  const shareCurrent = useCallback(() => {
    if (!current) return;
    Share.share({ message: current.url });
  }, [current]);

  if (!visible || items.length === 0) return null;

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      supportedOrientations={['portrait']}
      hardwareAccelerated
    >
      <StatusBar hidden animated />
      <View style={styles.container}>
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(it) => it.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: W, offset: W * i, index: i })}
          onMomentumScrollEnd={onScrollEnd}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              listRef.current?.scrollToIndex({ index: info.index, animated: false });
            }, 60);
          }}
          renderItem={({ item, index: idx }) => (
            <View style={styles.slide}>
              {item.kind === 'video' ? (
                <VideoSlide url={item.url} active={idx === index} />
              ) : (
                <ExpoImage
                  source={{ uri: item.url }}
                  style={styles.media}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                  transition={120}
                />
              )}
            </View>
          )}
        />

        {/* Top chrome: close + counter */}
        <View style={styles.topBar} pointerEvents="box-none">
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="chevron-down" size={26} color="#FFF" />
          </Pressable>
          {items.length > 1 && (
            <Text style={styles.counter}>{index + 1} of {items.length}</Text>
          )}
          <View style={{ width: 44 }} />
        </View>

        {/* Bottom chrome: save + share */}
        <View style={styles.bottomBar} pointerEvents="box-none">
          <Pressable
            onPress={saveCurrent}
            disabled={saving}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            {saving
              ? <ActivityIndicator size={16} color="#FFF" />
              : <Feather name="download" size={22} color="#FFF" />}
          </Pressable>
          <Pressable
            onPress={shareCurrent}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="share" size={22} color="#FFF" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  slide: {
    width: W, height: H,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#000',
  },
  media: { width: W, height: H, backgroundColor: '#000' },
  topBar: {
    position: 'absolute', top: 54, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  bottomBar: {
    position: 'absolute', bottom: 54, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 32,
  },
  iconBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },
  counter: { color: '#FFF', fontSize: 15, fontWeight: '600' },
});
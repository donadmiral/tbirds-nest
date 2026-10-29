import React, { useEffect, useState } from 'react';
import { AppState, Modal, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from './SafeArea';
import PostCarousel, { type CarouselMedia } from './PostCarousel';
import { carouselIndex } from '../../shared/carouselNavigation';

export default function PostMediaViewer({ media, initialIndex, postId, onClose }: {
  media: CarouselMedia[];
  initialIndex: number;
  postId: string;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  return (
    <Modal visible animationType="fade" presentationStyle="fullScreen" onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#090B0E' }}>
        <View style={{ paddingTop: insets.top, paddingBottom: insets.bottom, flex: 1 }}>
          <View style={{ height: 52, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text accessibilityRole="header" style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>Post</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close post media" onPress={onClose} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}><Feather name="x" size={24} color="#FFFFFF" /></TouchableOpacity>
          </View>
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <PostCarousel key={postId} media={media} containerWidth={width} postId={postId} initialIndex={carouselIndex(initialIndex, media.length)} maxHeight={Math.max(160, height - insets.top - insets.bottom - 104)} fullFrame flush isActive={active} />
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

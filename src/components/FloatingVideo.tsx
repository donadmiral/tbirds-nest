/** The docked player: the engine's video in the corner while you read on. */
import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { VideoView } from 'expo-video';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from './SafeArea';
import { useVideoEngine, getVideoPlayer, stopFloating } from '../lib/videoEngine';

export default function FloatingVideo({ onOpen }: { onOpen?: (postId: string | null) => void }) {
  const floating = useVideoEngine((s) => s.floating);
  const postId = useVideoEngine((s) => s.postId);
  const insets = useSafeAreaInsets();
  if (!floating) return null;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View style={[st.dock, { bottom: insets.bottom + 92 }]}>
        <TouchableOpacity activeOpacity={0.9} style={{ flex: 1 }} onPress={() => { useVideoEngine.getState().set({ floating: false }); onOpen?.(postId); }}>
          <VideoView style={{ flex: 1 }} player={getVideoPlayer()} contentFit="cover" nativeControls={false} fullscreenOptions={{ enable: false }} />
        </TouchableOpacity>
        <TouchableOpacity onPress={stopFloating} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={st.close}><Feather name="x" size={14} color="#FFFFFF" /></TouchableOpacity>
      </View>
    </View>
  );
}
const st = StyleSheet.create({
  dock: { position: 'absolute', right: 12, width: 150, height: 210, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 10 },
  close: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
});
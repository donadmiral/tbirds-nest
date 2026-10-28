import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

/** Originals stay sharp in the book; an unavailable poster never hides them. */
export default function MemoryPageImage({ uri, thumbnail, onRetry }: { uri?: string | null; thumbnail?: string | null; onRetry: () => void }) {
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const source = [uri, thumbnail].find(value => value && !failed.has(value));
  if (source) return <ExpoImage source={{ uri: source }} style={{ width: '100%', height: '100%' }} contentFit="contain" transition={140}
    onError={() => setFailed(previous => new Set(previous).add(source))} />;
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: '#0B1E3D' }}>
    <Text style={{ color: '#FFFFFF', textAlign: 'center' }}>This memory image could not load.</Text>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry memory image" onPress={() => { setFailed(new Set()); onRetry(); }} style={{ padding: 14 }}>
      <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>Tap to retry</Text>
    </TouchableOpacity>
  </View>;
}

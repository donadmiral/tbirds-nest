// src/components/SafeImage.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image, StyleProp, ImageStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';

type Props = {
  uri?: string | null;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
  logPrefix?: string;
  showFallbackLabel?: boolean;
  fallbackLabel?: string;
};

export default function SafeImage({
  uri,
  style,
  resizeMode = 'cover',
  logPrefix = 'IMG',
  showFallbackLabel = true,
  fallbackLabel = 'Image unavailable',
}: Props) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [uri]);

  if (!uri || failed) {
    return (
      <View style={[s.fallback, style as any]}>
        <Feather name="image" size={22} color="#C7C7CC" />
        {showFallbackLabel ? <Text style={s.fallbackTxt}>{fallbackLabel}</Text> : null}
      </View>
    );
  }

  return (
    <Image
      source={{ uri, cache: 'reload' }}
      style={style as any}
      resizeMode={resizeMode}
      onError={(e: any) => {
        console.log(`[${logPrefix}]`, uri, e?.nativeEvent?.error || 'download failed');
        setFailed(true);
      }}
    />
  );
}

const s = StyleSheet.create({
  fallback: { backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center', gap: 6 },
  fallbackTxt: { fontSize: 12, color: '#8E8E93', fontWeight: '500' },
});
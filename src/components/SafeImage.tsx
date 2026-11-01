// src/components/SafeImage.tsx
import { themedSheet } from '../theme/useTheme';
import React, { useState } from 'react';
import { View, Text, StyleProp, ImageStyle } from 'react-native';
import { Image } from 'expo-image';
import { privateImageCachePolicy } from '../../shared/mediaDelivery';
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
  const [failedUri, setFailedUri] = useState<string | null>(null);

  if (!uri || failedUri === uri) {
    return (
      <View style={[s.fallback, style as any]}>
        <Feather name="image" size={22} color="#C7C7CC" />
        {showFallbackLabel ? <Text style={s.fallbackTxt}>{fallbackLabel}</Text> : null}
      </View>
    );
  }

  return (
    <Image
      key={uri}
      recyclingKey={uri}
      source={{ uri }}
      cachePolicy={privateImageCachePolicy(uri)}
      transition={0}
      style={style as any}
      contentFit={resizeMode === 'stretch' ? 'fill' : resizeMode === 'center' ? 'scale-down' : resizeMode}
      onError={(e: any) => {
        console.log(`[${logPrefix}]`, uri, e?.nativeEvent?.error || 'download failed');
        setFailedUri(uri);
      }}
    />
  );
}

const s = themedSheet((t) => ({
  fallback: { backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center', gap: 6 },
  fallbackTxt: { fontSize: 12, color: '#8E8E93', fontWeight: '500' },
}));

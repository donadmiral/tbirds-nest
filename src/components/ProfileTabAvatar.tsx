import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '../theme/useTheme';

export default function ProfileTabAvatar({ userId, uri, name, focused, size }: {
  userId: string | null; uri?: string | null; name?: string | null; focused: boolean; size: number;
}) {
  const { t } = useTheme();
  const [failed, setFailed] = useState<string | null>(null);
  const key = `${userId ?? ''}:${uri ?? ''}`;
  useEffect(() => setFailed(null), [key]);
  const dimension = Math.max(24, size);
  return <View accessible={false} style={{ width: dimension + 6, height: dimension + 6, borderRadius: (dimension + 6) / 2,
    padding: 2, borderWidth: 1.5, borderColor: focused ? t.ink.primary : 'transparent' }}>
    {uri && failed !== key ? <Image source={{ uri }} recyclingKey={key} cachePolicy="memory-disk" contentFit="cover"
      onError={() => setFailed(key)} style={{ width: dimension - 1, height: dimension - 1, borderRadius: dimension / 2 }} />
      : <View style={{ width: dimension - 1, height: dimension - 1, borderRadius: dimension / 2, backgroundColor: t.brand.base, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: t.ink.inverse, fontSize: 12, fontWeight: '700' }}>{(name?.trim() || '?').slice(0, 1).toUpperCase()}</Text>
      </View>}
  </View>;
}

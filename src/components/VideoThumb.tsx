/**
 * VideoThumb - a real frame from a video, grabbed on first render and
 * cached in memory, with a small play chip. Used wherever a video
 * appears as a preview tile rather than a player.
 */
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as VideoThumbnails from 'expo-video-thumbnails';

const cache: Record<string, string> = {};

export default function VideoThumb({ uri, size = 64, radius = 8 }: { uri: string; size?: number; radius?: number }) {
  const [thumb, setThumb] = useState<string | null>(cache[uri] ?? null);
  useEffect(() => {
    let ok = true;
    if (!cache[uri] && uri) {
      VideoThumbnails.getThumbnailAsync(uri, { time: 800 })
        .then(r => { cache[uri] = r.uri; if (ok) setThumb(r.uri); })
        .catch(() => {});
    }
    return () => { ok = false; };
  }, [uri]);
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: '#0B1E3D', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {thumb ? <ExpoImage source={{ uri: thumb }} style={{ width: size, height: size }} contentFit="cover" /> : null}
      <View style={{ position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#FFFFFF', fontSize: 11, marginLeft: 2 }}>{'\u25B6'}</Text>
      </View>
    </View>
  );
}
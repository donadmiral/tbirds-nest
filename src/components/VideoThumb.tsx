/**
 * VideoThumb - a real frame from a video, grabbed on first render and
 * cached in memory, with a small play chip. Used wherever a video
 * appears as a preview tile rather than a player.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as VideoThumbnails from 'expo-video-thumbnails';

// Keep generated frames bounded and tied to the exact authorized URL.
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
function frame(uri: string): Promise<string> {
  const hit = cache.get(uri);
  if (hit) return Promise.resolve(hit);
  const active = pending.get(uri);
  if (active) return active;
  const request = VideoThumbnails.getThumbnailAsync(uri, { time: 800 })
    .catch(() => VideoThumbnails.getThumbnailAsync(uri, { time: 0 }))
    .then(result => {
      if (!result.uri) throw new Error('No preview frame');
      cache.delete(uri);
      cache.set(uri, result.uri);
      if (cache.size > 100) cache.delete(cache.keys().next().value!);
      return result.uri;
    }).finally(() => { pending.delete(uri); });
  pending.set(uri, request);
  return request;
}

export default function VideoThumb({ uri, posterUri, size = 64, radius = 8, height, fill, chip = true, contentPosition }: { uri: string; posterUri?: string | null; size?: number; radius?: number; height?: number; fill?: boolean; chip?: boolean; contentPosition?: { left: `${number}%`; top: `${number}%` } }) {
  const h = height ?? size;
  const [failedPoster, setFailedPoster] = useState<string | null>(null);
  const usePoster = !!posterUri && failedPoster !== posterUri;
  const [preview, setPreview] = useState<{ source: string; thumb: string | null; failed: boolean }>(() => ({ source: uri, thumb: cache.get(uri) ?? null, failed: !uri }));
  useEffect(() => {
    let ok = true;
    setPreview({ source: uri, thumb: cache.get(uri) ?? null, failed: !uri });
    // A selected cover is an authorized image and avoids decoding video bytes
    // just to render the profile. If it fails, fall back to a real video frame.
    if (!usePoster && uri) frame(uri)
      .then(thumb => { if (ok) setPreview({ source: uri, thumb, failed: false }); })
      .catch(() => { if (ok) setPreview({ source: uri, thumb: null, failed: true }); });
    return () => { ok = false; };
  }, [uri, usePoster]);
  // A reused list tile must never show the preceding video's frame, even for
  // the render before the effect has reset its state.
  const thumb = usePoster ? posterUri : preview.source === uri ? preview.thumb : cache.get(uri) ?? null;
  const failed = !usePoster && preview.source === uri && preview.failed;
  return (
    <View pointerEvents="none" accessibilityLabel={thumb ? 'Video preview' : failed ? 'Video preview unavailable. Open the post to retry.' : 'Loading video preview'} style={fill ? { width: '100%', height: '100%', backgroundColor: '#0B1E3D', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } : { width: size, height: h, borderRadius: radius, backgroundColor: '#0B1E3D', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {thumb ? <ExpoImage source={{ uri: thumb }} style={fill ? { width: '100%', height: '100%' } : { width: size, height: h }} contentFit="cover" contentPosition={contentPosition} onError={() => {
        if (usePoster) { setFailedPoster(posterUri!); return; }
        cache.delete(uri); setPreview({ source: uri, thumb: null, failed: true });
      }} /> : failed ? <Text numberOfLines={2} style={{ color: '#FFFFFF', fontSize: 11, textAlign: 'center', padding: 6 }}>Preview unavailable</Text> : <ActivityIndicator size="small" color="#FFFFFF" />}
      {chip && thumb ? <View style={{ position: 'absolute', width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#FFFFFF', fontSize: 12, marginLeft: 2 }}>{'\u25B6'}</Text></View> : null}
    </View>
  );
}

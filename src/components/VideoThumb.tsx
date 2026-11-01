/**
 * VideoThumb - a real frame from a video, grabbed on first render and
 * cached in memory, with a small play chip. Used wherever a video
 * appears as a preview tile rather than a player.
 */
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as FileSystem from 'expo-file-system/legacy';
import { privateImageCachePolicy } from '../../shared/mediaDelivery';
import { navigationScope, subscribeNavigationScope } from '../lib/navigationCache';

// Only files produced by this module are owned here. Private frames live while
// a tile uses them, and every frame is discarded when the account scope changes.
const cache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
const consumers = new Map<string, number>();
const ownedFiles = new Set<string>();
let generation = 0;
let decoding = 0;
const queue: Array<{ key: string; run: () => void; reject: (error: Error) => void }> = [];
const stale = () => new Error('The video preview is no longer needed');
function deleteOwnedFile(uri: string) {
  if (!ownedFiles.delete(uri)) return;
  void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
}
function evict(key: string) {
  const uri = cache.get(key);
  cache.delete(key);
  if (uri) deleteOwnedFile(uri);
}
function trimCache() {
  for (const key of cache.keys()) {
    if (cache.size <= 100) break;
    if (!consumers.get(key)) evict(key);
  }
}
subscribeNavigationScope(() => {
  generation++;
  for (const key of cache.keys()) evict(key);
  consumers.clear(); pending.clear();
  for (const job of queue.splice(0)) job.reject(stale());
  // Native getThumbnailAsync has no cancellation method. Keep its real slots
  // occupied until completion, then discard its output using the generation.
});
function decode(uri: string, key: string, version: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const run = () => {
      if (version !== generation || !consumers.get(key)) { reject(stale()); queue.shift()?.run(); return; }
      decoding++;
      Promise.resolve().then(() => VideoThumbnails.getThumbnailAsync(uri, { time: 0, quality: 0.5 }))
        .then(result => {
          if (!result.uri?.startsWith('file://')) { reject(new Error('No preview frame')); return; }
          ownedFiles.add(result.uri);
          if (version !== generation || !consumers.get(key)) { deleteOwnedFile(result.uri); reject(stale()); return; }
          resolve(result.uri);
        }, reject)
        .finally(() => { decoding--; queue.shift()?.run(); });
    };
    if (decoding < 2) run();
    else if (queue.length < 10) queue.push({ key, run, reject });
    else reject(new Error('Preview queue is busy'));
  });
}
function frame(uri: string, key: string): Promise<string> {
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const active = pending.get(key);
  if (active) return active;
  const version = generation;
  const request = decode(uri, key, version)
    .then(result => {
      if (version !== generation || !consumers.get(key)) { deleteOwnedFile(result); throw stale(); }
      cache.delete(key); cache.set(key, result); trimCache();
      return result;
    }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
  pending.set(key, request);
  return request;
}
function retainFrame(key: string, uri: string) {
  consumers.set(key, (consumers.get(key) ?? 0) + 1);
  return () => {
    const remaining = (consumers.get(key) ?? 1) - 1;
    if (remaining > 0) { consumers.set(key, remaining); return; }
    consumers.delete(key);
    if (privateImageCachePolicy(uri) === 'none') evict(key);
    const queued = queue.findIndex(job => job.key === key);
    if (queued >= 0) queue.splice(queued, 1)[0].reject(stale());
    trimCache();
  };
}

export default function VideoThumb({ uri, posterUri, size = 64, radius = 8, height, fill, chip = true, contentPosition, contentFit = 'cover' }: { uri: string; posterUri?: string | null; size?: number; radius?: number; height?: number; fill?: boolean; chip?: boolean; contentPosition?: { left: `${number}%`; top: `${number}%` }; contentFit?: 'cover' | 'contain' }) {
  const h = height ?? size;
  const scope = useSyncExternalStore(subscribeNavigationScope, navigationScope, navigationScope);
  const key = `${scope ?? 'signed-out'}:${generation}:${uri}`;
  const [failedPoster, setFailedPoster] = useState<string | null>(null);
  const usePoster = !!posterUri && failedPoster !== `${key}:${posterUri}`;
  const [preview, setPreview] = useState<{ source: string; thumb: string | null; failed: boolean }>(() => ({ source: key, thumb: cache.get(key) ?? null, failed: !uri }));
  useEffect(() => {
    let ok = true;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let release: (() => void) | undefined;
    setPreview({ source: key, thumb: cache.get(key) ?? null, failed: !uri });
    // A selected cover is an authorized image and avoids decoding video bytes
    // just to render the profile. If it fails, fall back to a real video frame.
    if (!usePoster && uri) {
      release = retainFrame(key, uri);
      deadline = setTimeout(() => { if (ok) setPreview({ source: key, thumb: null, failed: true }); }, 8000);
      frame(uri, key)
        .then(thumb => { if (deadline) clearTimeout(deadline); if (ok) setPreview({ source: key, thumb, failed: false }); })
        .catch(() => { if (deadline) clearTimeout(deadline); if (ok) setPreview({ source: key, thumb: null, failed: true }); });
    }
    return () => { ok = false; if (deadline) clearTimeout(deadline); release?.(); };
  }, [uri, usePoster, key]);
  // A reused list tile must never show the preceding video's frame, even for
  // the render before the effect has reset its state.
  const thumb = usePoster ? posterUri : preview.source === key ? preview.thumb : cache.get(key) ?? null;
  const failed = !usePoster && preview.source === key && preview.failed;
  return (
    <View pointerEvents="none" accessibilityLabel={thumb ? 'Video preview' : failed ? 'Video preview unavailable. Open the post to retry.' : 'Loading video preview'} style={fill ? { width: '100%', height: '100%', backgroundColor: '#0B1E3D', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } : { width: size, height: h, borderRadius: radius, backgroundColor: '#0B1E3D', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {thumb ? <ExpoImage key={`${key}:${thumb}`} recyclingKey={`${key}:${thumb}`} source={{ uri: thumb }} cachePolicy={privateImageCachePolicy(uri) === 'none' ? 'none' : privateImageCachePolicy(thumb)} transition={0} style={fill ? { width: '100%', height: '100%' } : { width: size, height: h }} contentFit={contentFit} contentPosition={contentPosition} onError={() => {
        if (usePoster) { setFailedPoster(`${key}:${posterUri}`); return; }
        evict(key); setPreview({ source: key, thumb: null, failed: true });
      }} /> : failed ? <Text numberOfLines={2} style={{ color: '#FFFFFF', fontSize: 11, textAlign: 'center', padding: 6 }}>Preview unavailable</Text> : <ActivityIndicator size="small" color="#FFFFFF" />}
      {chip && thumb ? <View style={{ position: 'absolute', width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#FFFFFF', fontSize: 12, marginLeft: 2 }}>{'\u25B6'}</Text></View> : null}
    </View>
  );
}

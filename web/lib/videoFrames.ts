'use client';
/**
 * The browser side of video frames: one hidden decoder per capture, released as soon as it has drawn; one store for the
 * visit, forgotten whenever the signed-in person changes; and the hook a still uses to ask for its frame. A capture
 * asks the video for its metadata, seeks to the moment the author chose (or just past the start, where a clip has
 * usually settled), draws that one picture and lets the element go. A video served without cross-origin headers taints
 * the canvas and gives no frame rather than a broken one. The data-saver preference means no video bytes are fetched
 * for a still at all.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createVideoFrameCache, frameKey, IDLE, type FrameState } from './videoFrameCache';
import { dataSaverEnabled } from './mediaPrefs';
import { getNavigationStore } from './navigationCache';

const MAX_WIDTH = 640, TIMEOUT = 12_000;
export const DEFAULT_MOMENT = 0.8;

export function captureVideoFrame(url: string, at: number, signal: AbortSignal, maxWidth = MAX_WIDTH): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    let done = false;
    const finish = (value?: string, error?: Error) => {
      if (done) return;
      done = true; clearTimeout(timer); signal.removeEventListener('abort', cancel);
      video.onloadedmetadata = null; video.onloadeddata = null; video.onseeked = null; video.onerror = null;
      video.pause(); video.removeAttribute('src'); video.load();
      if (value) resolve(value); else reject(error ?? new Error('The video frame could not be prepared.'));
    };
    const cancel = () => finish(undefined, new Error('The video frame is no longer needed.'));
    const timer = setTimeout(() => finish(), TIMEOUT);
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    const draw = () => {
      if (done) return;
      if (video.readyState < 2) { video.onloadeddata = draw; return; }
      try {
        if (!video.videoWidth || !video.videoHeight) throw new Error('The video has no picture.');
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, maxWidth / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No drawing surface.');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL('image/jpeg', 0.72);
        if (!data.startsWith('data:image/jpeg')) throw new Error('The frame could not be encoded.');
        finish(data);
      } catch (error) { finish(undefined, error instanceof Error ? error : new Error(String(error))); }
    };
    video.crossOrigin = 'anonymous'; video.muted = true; video.playsInline = true; video.preload = 'metadata';
    video.onerror = () => finish();
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const target = Math.min(Math.max(0, at), Math.max(0, duration - 0.05));
      if (target > 0.02 && Math.abs(video.currentTime - target) > 0.02) { video.onseeked = draw; video.currentTime = target; } else draw();
    };
    video.src = url;
  });
}

let cache: ReturnType<typeof createVideoFrameCache> | null = null;
/** The store for this browser visit; none on the server, where no viewer data may live in a module. */
export function getVideoFrameCache() {
  if (typeof window === 'undefined') return null;
  if (cache) return cache;
  const store = cache = createVideoFrameCache({ capture: captureVideoFrame });
  const navigation = getNavigationStore();
  let scope = navigation.getSnapshot().scope;
  navigation.subscribe(() => { const next = navigation.getSnapshot().scope; if (next !== scope) { scope = next; store.reset(); } });
  return store;
}

/** The frame for a video URL, requested once the caller passes a URL; null until then, and never under data saver. */
export function useVideoFrame(url: string | null | undefined, at: number = DEFAULT_MOMENT): FrameState {
  const store = getVideoFrameCache();
  const key = url ? frameKey(url, process.env.NEXT_PUBLIC_SUPABASE_URL ?? '') : null;
  const [saver, setSaver] = useState(false);
  useEffect(() => {
    const read = () => setSaver(dataSaverEnabled());
    read(); window.addEventListener('pc-media-preferences', read);
    return () => window.removeEventListener('pc-media-preferences', read);
  }, []);
  const subscribe = useCallback((listener: () => void) => (store && key ? store.subscribe(key, listener) : () => {}), [store, key]);
  const read = useCallback(() => (store && key ? store.peek(key) : IDLE), [store, key]);
  const snapshot = useSyncExternalStore(subscribe, read, () => IDLE);
  // asked again when the store forgets the frame (another person signed in), not while it loads or has recently failed
  useEffect(() => { if (store && key && url && !saver && snapshot.state === 'idle') store.request(key, url, at); }, [store, key, url, at, saver, snapshot.state]);
  return snapshot;
}

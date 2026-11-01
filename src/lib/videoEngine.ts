/** One audible owner, with two nearby sources buffering in separate native players. */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { createVideoPlayer, VideoPlayer } from 'expo-video';
import { create } from 'zustand';
import { createVideoReadinessPool, type PreparedVideoSource } from '../../shared/videoReadiness';
import { subscribeNavigationScope } from './navigationCache';

type EngineState = {
  uri: string | null; owner: string | null; postId: string | null;
  player: VideoPlayer | null; ready: boolean; failed: boolean; foreground: boolean; version: number;
};
const empty: EngineState = { uri: null, owner: null, postId: null, player: null, ready: false, failed: false, foreground: AppState.currentState === 'active', version: 0 };
export const useVideoEngine = create<EngineState & { set: (p: Partial<EngineState>) => void }>((set) => ({ ...empty, set }));

const pool = createVideoReadinessPool(() => {
  const player = createVideoPlayer(null);
  player.loop = true;
  player.muted = true;
  player.timeUpdateEventInterval = 0.25;
  // Nearby players already prepare before visibility. Start the active player
  // from available frames instead of waiting for Apple's larger stall estimate.
  player.bufferOptions = { preferredForwardBufferDuration: 4, minBufferForPlayback: 0.5, maxBufferBytes: 6 * 1024 * 1024, waitsToMinimizeStalling: false };
  return player;
}, entry => {
  const state = useVideoEngine.getState();
  if (state.player === entry.player && state.uri === entry.uri) state.set(entry.disposed
    ? { player: null, ready: false, failed: false }
    : { ready: entry.ready, failed: entry.failed });
});

let pendingSeek: { uri: string; at: number } | null = null;
export function seekWhenClaimed(uri: string, at: number) { pendingSeek = { uri, at }; }
export function enginePosition(uri: string): number {
  const state = useVideoEngine.getState();
  if (state.uri !== uri || !state.ready) return 0;
  try { return Number(state.player?.currentTime) || 0; } catch { return 0; }
}
export function prefetchFeedVideos(sources: PreparedVideoSource[]) { pool.prefetch(sources); }
export function releaseEngine() {
  pool.release();
  useVideoEngine.getState().set({ owner: null });
}
export function clearVideoEngine() {
  useVideoEngine.getState().set({ ...empty, foreground: AppState.currentState === 'active' });
  pool.clear();
  pendingSeek = null;
}
subscribeNavigationScope(clearVideoEngine);
AppState.addEventListener('change', state => { if (state !== 'active') clearVideoEngine(); useVideoEngine.getState().set({ foreground: state === 'active' }); });

export function useSharedVideo(o: { uri: string; visible: boolean; screenActive: boolean; postId?: string | null; rate?: number; preservesPitch?: boolean; muted?: boolean; loop?: boolean; startAt?: number }) {
  const id = useRef('v' + Math.random().toString(36).slice(2)).current;
  const state = useVideoEngine();
  const owns = state.owner === id && state.uri === o.uri;
  const active = o.visible && o.screenActive && state.foreground;
  useEffect(() => {
    if (!active || !o.uri) return;
    const entry = pool.claim(o.uri);
    const p = entry.player;
    p.loop = o.loop ?? true;
    p.muted = !!o.muted;
    p.preservesPitch = o.preservesPitch ?? true;
    p.playbackRate = o.rate || 1;
    useVideoEngine.getState().set({ owner: id, uri: o.uri, postId: o.postId ?? null, player: p, ready: entry.ready, failed: entry.failed, version: entry.identity });
    return () => {
      const current = useVideoEngine.getState();
      if (current.owner !== id) return;
      pool.release();
      current.set({ owner: null });
    };
  }, [active, o.uri, id]);
  useEffect(() => {
    if (!owns || !state.player || !state.ready) return;
    const p = state.player;
    const current = useVideoEngine.getState();
    if (current.owner !== id || current.uri !== o.uri || current.player !== p) return;
    p.preservesPitch = o.preservesPitch ?? true;
    p.playbackRate = o.rate || 1;
    if (pendingSeek?.uri === o.uri) {
      try { p.currentTime = pendingSeek.at; } catch {}
      pendingSeek = null;
    } else if (o.startAt && p.currentTime < o.startAt) {
      try { p.currentTime = o.startAt; } catch {}
    }
  }, [owns, state.player, state.ready, o.uri, o.rate, o.preservesPitch, o.startAt, id]);
  const canHold = !state.owner && state.uri === o.uri;
  const retry = () => {
    const current = useVideoEngine.getState();
    if (current.owner !== id || current.uri !== o.uri || current.player !== state.player) return;
    const entry = pool.reload(o.uri);
    current.set({ player: entry.player, ready: entry.ready, failed: entry.failed, version: entry.identity });
  };
  return { player: state.uri === o.uri ? state.player : null, ownerId: id, owns, canHold, sourceReady: (owns || canHold) && state.ready, failed: owns && state.failed, version: state.version, retry };
}

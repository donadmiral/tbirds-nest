import React, { useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import { VideoView as ExpoVideoView, useVideoPlayer as useExpoVideoPlayer, type VideoPlayer } from 'expo-video';
import { storyVideoPreviewAvailable } from './storyComposition';
import { StoryPhotoLookContext } from '../../src/components/stories/StoryPixelImage';
import { storyPhotoColorMatrix, type StoryPhotoLook } from '../../shared/storyColorMatrix';

const NativeView: any = storyVideoPreviewAvailable ? requireNativeViewManager('Boomerang') : null;
type Listener = (event: any) => void;
/** The small player interface used by story clocks and trim controls. No second audio player. */
export class StoryVideoController {
  readonly storyNative = true;
  private listeners = new Map<string, Set<Listener>>();
  private subscribers = new Set<() => void>();
  private version = 0;
  private values = { loop: false, muted: false, volume: 1, playbackRate: 1, preservesPitch: true, paused: true, seekSeconds: 0, seekRevision: 0, reloadRevision: 0 };
  private position = 0;
  status = 'idle'; duration = 0; playing = false; timeUpdateEventInterval = .05;
  released = false;
  constructor(readonly uri: string | null) {}
  subscribe = (callback: () => void) => { this.subscribers.add(callback); return () => { this.subscribers.delete(callback); }; };
  snapshot = () => this.version;
  private change(key: keyof typeof this.values, value: any) { if (this.released || this.values[key] === value) return; (this.values as any)[key] = value; this.version++; this.subscribers.forEach(fn => fn()); }
  get loop() { return this.values.loop; } set loop(value: boolean) { this.change('loop', value); }
  get muted() { return this.values.muted; } set muted(value: boolean) { this.change('muted', value); }
  get volume() { return this.values.volume; } set volume(value: number) { this.change('volume', Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1))); }
  get playbackRate() { return this.values.playbackRate; } set playbackRate(value: number) { this.change('playbackRate', Math.max(.25, Math.min(4, Number.isFinite(value) ? value : 1))); }
  get preservesPitch() { return this.values.preservesPitch; } set preservesPitch(value: boolean) { this.change('preservesPitch', value); }
  get currentTime() { return this.position; } set currentTime(value: number) { if (!Number.isFinite(value)) return; this.position = Math.max(0, value); this.change('seekSeconds', this.position); this.change('seekRevision', this.values.seekRevision + 1); }
  play = () => { this.change('paused', false); };
  pause = () => { const previous = this.playing; this.playing = false; this.change('paused', true); if (previous) this.listeners.get('playingChange')?.forEach(fn => fn({ isPlaying: false })); };
  reload = () => { this.change('reloadRevision', this.values.reloadRevision + 1); };
  addListener(name: string, listener: Listener) { const set = this.listeners.get(name) || new Set<Listener>(); set.add(listener); this.listeners.set(name, set); return { remove: () => set.delete(listener) }; }
  receive = (event: any) => { if (this.released) return; const wasPlaying = this.playing; if (event.type === 'statusChange') { this.status = event.status; if (Number.isFinite(event.duration)) this.duration = event.duration; if (event.status === 'error') this.playing = false; } if (event.type === 'timeUpdate') { this.position = event.currentTime; this.playing = event.playing && !this.values.paused; } if (event.type === 'playToEnd') this.playing = false; this.listeners.get(event.type)?.forEach(fn => fn(event)); if (wasPlaying !== this.playing) this.listeners.get('playingChange')?.forEach(fn => fn({ isPlaying: this.playing })); };
  props() { return { uri: this.uri || '', loop: this.loop, muted: this.muted, volume: this.volume, rate: this.playbackRate, preservesPitch: this.preservesPitch, paused: this.values.paused, seekSeconds: this.values.seekSeconds, seekRevision: this.values.seekRevision, reloadRevision: this.values.reloadRevision }; }
  release() { this.released = true; this.listeners.clear(); this.subscribers.clear(); }
}

// Capability is fixed for the process: an installed build uses exactly one path.
function useNativeStoryVideoPlayer(source: string | null, setup?: (player: any) => void) {
  const player = useMemo(() => { const p = new StoryVideoController(source); setup?.(p); return p; }, [source]); // setup is an initialization callback, as in expo-video.
  useEffect(() => { player.released = false; return () => player.release(); }, [player]);
  return player;
}
export const useStoryVideoPlayer: (source: string | null, setup?: (player: VideoPlayer) => void) => VideoPlayer = storyVideoPreviewAvailable ? (useNativeStoryVideoPlayer as unknown as typeof useExpoVideoPlayer) : useExpoVideoPlayer;

function NativeStoryVideo({ player, look, onFirstFrameRender, ...props }: any) {
  useSyncExternalStore(player.subscribe, player.snapshot, player.snapshot);
  return <NativeView {...props} {...player.props()} matrix={storyPhotoColorMatrix(look)} onPlayback={(event: any) => { if (player.released) return; const value = event.nativeEvent; player.receive(value); if (value.type === 'firstFrame') onFirstFrameRender?.(); }} />;
}
export function StoryVideoView({ look: explicit, contentFit = 'contain', nativeControls: _controls, ...props }: any & { look?: StoryPhotoLook | null }) {
  const inherited = useContext(StoryPhotoLookContext), look = explicit === undefined ? inherited : explicit;
  if (!props.player?.storyNative) return <ExpoVideoView {...props} contentFit={contentFit} nativeControls={_controls} />;
  if (!_controls) return <NativeStoryVideo {...props} fit={contentFit} look={look} />;
  return <View style={props.style}><NativeStoryVideo {...props} style={StyleSheet.absoluteFill} fit={contentFit} look={look} /><NativeStoryControls player={props.player} /></View>;
}

function NativeStoryControls({ player }: { player: StoryVideoController }) {
  const [clock, setClock] = useState(0), [playing, setPlaying] = useState(false), [muted, setMuted] = useState(player.muted);
  useEffect(() => { const sub = player.addListener('timeUpdate', event => { setClock(event.currentTime); setPlaying(player.playing); }); return () => { sub.remove(); }; }, [player]);
  return <View style={{ position: 'absolute', bottom: 12, left: 12, right: 12, backgroundColor: '#101318dd', borderRadius: 18, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={playing ? 'Pause video' : 'Play video'} style={{ paddingVertical: 14 }} onPress={() => { if (playing) player.pause(); else player.play(); setPlaying(!playing); }}><Text style={{ color: '#fff' }}>{playing ? 'Pause' : 'Play'}</Text></TouchableOpacity>
    <View accessible accessibilityRole="adjustable" accessibilityLabel="Video position" accessibilityValue={{ min: 0, max: player.duration, now: clock, text: Math.floor(clock) + ' seconds' }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={event => { player.currentTime = Math.max(0, Math.min(player.duration, clock + (event.nativeEvent.actionName === 'increment' ? 5 : -5))); }} style={{ flex: 1, minHeight: 44, justifyContent: 'center' }} onStartShouldSetResponder={() => true} onResponderRelease={event => { const x = event.nativeEvent.locationX; event.currentTarget.measure((_x, _y, width) => { player.currentTime = Math.min(player.duration, Math.max(0, x / Math.max(1, width) * player.duration)); }); }}><View style={{ height: 3, backgroundColor: '#ffffff55' }}><View style={{ height: 3, width: `${Math.min(100, clock / Math.max(1, player.duration) * 100)}%`, backgroundColor: '#fff' }} /></View></View>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={muted ? 'Unmute video' : 'Mute video'} style={{ paddingVertical: 14 }} onPress={() => { player.muted = !muted; setMuted(!muted); }}><Text style={{ color: '#fff' }}>{muted ? 'Unmute' : 'Mute'}</Text></TouchableOpacity>
  </View>;
}

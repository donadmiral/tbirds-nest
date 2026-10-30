import { readSoundtrack } from '../../../shared/soundtrack';
import { useSoundtrackPlayer } from '../../hooks/useSoundtrackPlayer';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, AppState, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Audio } from 'expo-av';
import { StoryVideoView as VideoView, useStoryVideoPlayer as useVideoPlayer } from '../../../modules/boomerang/storyVideo';
import { useSafeAreaInsets } from '../SafeArea';
import { useCallContext } from '../../contexts/CallContext';
import { useMemoryPlayback } from '../../hooks/useMemoryPlayback';
import MemoryPageImage from './MemoryPageImage';
import MemoryStoryFrame from './MemoryStoryFrame';
import { MEMORY_SCORE_DESCRIPTION, MEMORY_SCORE_DUCK, MEMORY_SCORE_TITLE, MEMORY_SCORE_VOLUME, createMemoryFilmProgressGuard, memoryFilmItems, memoryPageSoundtrack, memoryFilmPhotoDuration, memoryFilmProgress, memoryFilmStep, memoryFilmVideoWindow, type MemoryFilmItem, type MemoryFilmPage } from '../../../shared/memoryFilm';
import { privateImageCachePolicy } from '../../../shared/mediaDelivery';

/** A dedicated continuous film. The editable book remains a separate reading surface. */
export default function MemoryFilm({ title, pages, soundtrack, active, reduceMotion, onClose, onReadBook, onRetry, onPost }: {
  title: string; pages: MemoryFilmPage[]; soundtrack?: unknown; active: boolean; reduceMotion: boolean;
  onClose: () => void; onReadBook: () => void; onRetry: () => void; onPost: (id: string) => void;
}) {
  const savedMusic=readSoundtrack(soundtrack);
  const insets = useSafeAreaInsets();
  const { callState } = useCallContext();
  const items = useMemo(() => memoryFilmItems(pages), [pages]);
  const [selection, setSelection] = useState({ id: pages[0]?.id ?? '', run: 0 });
  const [playing, setPlaying] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [music, setMusic] = useState(true), [volume, setVolume] = useState(savedMusic?.volume??MEMORY_SCORE_VOLUME);
  const [originalMuted, setOriginalMuted] = useState(true);
  const [readyKey, setReadyKey] = useState('');
  const [failure, setFailure] = useState({ key: '', message: '' });
  const [videoState, setVideoState] = useState({ key: '', progress: 0 });
  const [attempt, setAttempt] = useState(0);
  const index = Math.max(0, items.findIndex(item => item.id === selection.id));
  const item = items[index];
  const pageMusic=memoryPageSoundtrack(item?.page);
  const key = `${item?.id}:${item?.uri}:${selection.run}:${attempt}`;
  const error = failure.key === key ? failure.message : '';
  const ready = item?.kind === 'text' || readyKey === key;
  const allowed = active && foreground && callState === 'idle' && playing && !error;
  const current = useRef({ items, index, key, allowed }); current.current = { items, index, key, allowed };
  const mediaReady = (eventKey: string) => { if (current.current.key === eventKey) setReadyKey(eventKey); };
  const mediaFailed = (eventKey: string, message: string) => { if (current.current.key === eventKey) setFailure({ key: eventKey, message }); };
  const mediaProgress = (eventKey: string, value: number) => { if (current.current.key === eventKey) setVideoState({ key: eventKey, progress: value }); };
  const advance = useCallback((direction: 1 | -1, expected?: string) => {
    const state = current.current;
    if (!state.items.length || expected && (expected !== state.key || !state.allowed)) return;
    const next = memoryFilmStep(state.index, state.items.length, direction);
    setSelection(previous => ({ id: state.items[next.index].id, run: previous.run + 1 }));
  }, []);
  const progress = useMemoryPlayback(key, allowed && ready && item?.kind !== 'video', item ? memoryFilmPhotoDuration(item) : 6000, () => advance(1, key));
  const displayedProgress = item?.kind === 'video' ? videoState.key === key ? videoState.progress : 0 : progress;
  const scale = useRef(new Animated.Value(.965)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const bookAudio=useSoundtrackPlayer({selection:savedMusic?{...savedMusic,volume:volume*(item?.kind==='video'&&!originalMuted||pageMusic?MEMORY_SCORE_DUCK:1)}:null,use:'memory_album',active:allowed&&music});
  const pageAudio=useSoundtrackPlayer({selection:pageMusic,use:'memory_album',active:allowed&&ready,playbackKey:key});
  const score = useMemoryScore(allowed && music && !savedMusic, volume * (item?.kind === 'video' && !originalMuted || pageMusic ? MEMORY_SCORE_DUCK : 1));
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => setForeground(state === 'active'));
    let live = true;
    void AccessibilityInfo.isScreenReaderEnabled().then(enabled => { if (live && enabled) setPlaying(false); });
    const reader = AccessibilityInfo.addEventListener('screenReaderChanged', enabled => { if (enabled) setPlaying(false); });
    return () => { live = false; sub.remove(); reader.remove(); };
  }, []);
  useEffect(() => {
    if (!item || ready || error || !allowed) return;
    const timer = setTimeout(() => { if (current.current.allowed) mediaFailed(key, 'This memory is taking too long to load.'); }, 20000);
    return () => clearTimeout(timer);
  }, [key, ready, error, item, allowed]);
  useEffect(() => {
    const next = items[(index + 1) % Math.max(1, items.length)];
    const uri = next?.kind === 'image' ? next.uri : next?.poster;
    // Expo prefetch always caches. Private capabilities must be read only by
    // the visible image with cachePolicy="none", never stored ahead of time.
    if (uri && privateImageCachePolicy(uri) !== 'none') void Image.prefetch(uri).catch(() => {});
  }, [items, index]);
  useEffect(() => {
    const animation = Animated.timing(scale, { toValue: reduceMotion ? 1 : .965 + progress * .035, duration: reduceMotion ? 0 : 120, useNativeDriver: true });
    animation.start(); return () => animation.stop();
  }, [scale, progress, reduceMotion]);
  useEffect(() => {
    fade.setValue(reduceMotion ? 1 : 0);
    const animation = Animated.timing(fade, { toValue: 1, duration: reduceMotion ? 0 : 220, useNativeDriver: true });
    animation.start(); return () => animation.stop();
  }, [key, fade, reduceMotion]);
  const retry = () => { setAttempt(value => value + 1); onRetry(); };
  if (!item) return null;
  return <Modal visible animationType={reduceMotion ? 'none' : 'fade'} presentationStyle="fullScreen" onRequestClose={onClose}>
    <View style={s.root}>
      <View style={[s.header, { paddingTop: Math.max(12, insets.top) }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close memory film" onPress={onClose} style={s.icon}><Feather name="x" size={22} color="#fff" /></TouchableOpacity>
        <View style={s.heading}><Text style={s.eyebrow}>MEMORIES</Text><Text numberOfLines={1} style={s.title}>{title}</Text></View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Read memory book" onPress={onReadBook} style={s.icon}><Feather name="book-open" size={21} color="#fff" /></TouchableOpacity>
      </View>
      <View style={s.timeline} accessibilityRole="progressbar" accessibilityLabel={`Memory ${index + 1} of ${items.length}`} accessibilityValue={{ min: 0, max: 100, now: Math.round(displayedProgress * 100) }}>
        {items.map((entry, i) => <View key={entry.id} style={s.segment}><View style={[s.segmentFill, { width: `${i < index ? 100 : i === index ? displayedProgress * 100 : 0}%` }]} /></View>)}
      </View>
      <View style={s.stage}>
        {(item.kind === 'image' ? item.uri : item.poster) && <Image source={{ uri: (item.kind === 'image' ? item.uri : item.poster)! }} cachePolicy={privateImageCachePolicy(item.kind === 'image' ? item.uri : item.poster)} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={38} accessibilityElementsHidden />}
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#05080c99' }]} />
        <Animated.View key={key} style={[s.frame, { opacity: fade }]}>
          {item.kind === 'video' && item.uri ? <FilmVideo key={key} item={item} active={allowed} muted={originalMuted} onReady={() => mediaReady(key)} onError={() => mediaFailed(key, 'This memory video could not play.')} onProgress={value => mediaProgress(key, value)} onEnd={() => advance(1, key)} /> :
            <MemoryStoryFrame page={item.page} clock={progress * memoryFilmPhotoDuration(item) / 1000}>{({ fit, style }) => item.kind === 'image' ? <Animated.View style={[style, { transform: [...(Array.isArray(style.transform) ? style.transform : []), { scale }] }]}><MemoryPageImage uri={item.uri} thumbnail={item.poster} fit={fit} onReady={() => mediaReady(key)} onRetry={retry} /></Animated.View> : <View style={s.textPage}><Text style={s.storyText}>{item.excerpt || item.page.story_caption || item.page.caption || ''}</Text></View>}</MemoryStoryFrame>}
        </Animated.View>
        {!ready && !error && <View pointerEvents="none" style={s.loading}><ActivityIndicator color="#fff" /><Text style={s.loadText}>Loading memory…</Text></View>}
        {!!error && <View style={s.error}><Text style={s.errorText}>{error}</Text><TouchableOpacity accessibilityRole="button" onPress={retry} style={s.retry}><Text style={s.retryText}>Retry</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" onPress={() => advance(1)} style={s.retry}><Text style={s.retryText}>Next memory</Text></TouchableOpacity></View>}
      </View>
      <View style={[s.footer, { paddingBottom: Math.max(18, insets.bottom) }]}>
        {!!item.page.caption && item.kind !== 'text' && <Text numberOfLines={2} style={s.caption}>{item.page.caption}</Text>}
        {!!item.postId && <TouchableOpacity accessibilityRole="button" onPress={() => { setPlaying(false); onPost(item.postId!); }} style={s.source}><Text numberOfLines={1} style={s.sourceText}>{item.author ? `Shared from ${item.author}` : 'View original post'} <Feather name="arrow-up-right" size={12} /></Text></TouchableOpacity>}
        <View style={s.controls}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous memory" onPress={() => advance(-1)} style={s.icon}><Feather name="skip-back" size={22} color="#fff" /></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={playing ? 'Pause memory film' : 'Play memory film'} onPress={() => setPlaying(value => !value)} style={[s.icon, s.play]}><Feather name={playing ? 'pause' : 'play'} size={23} color="#10151c" /></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next memory" onPress={() => advance(1)} style={s.icon}><Feather name="skip-forward" size={22} color="#fff" /></TouchableOpacity>
          <Text style={s.count}>{index + 1} / {items.length}</Text>
          {item.kind === 'video' && <TouchableOpacity accessibilityRole="button" accessibilityLabel={originalMuted ? 'Unmute original video sound' : 'Mute original video sound'} accessibilityState={{ selected: !originalMuted }} onPress={() => setOriginalMuted(value => !value)} style={s.icon}><Feather name={originalMuted ? 'volume-x' : 'volume-2'} size={20} color="#fff" /></TouchableOpacity>}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={music ? 'Turn off background music' : 'Play background music'} accessibilityState={{ selected: music }} onPress={() => { score.retry(); setMusic(value => !value); }} style={[s.icon, music && s.selected]}><Feather name="music" size={19} color="#fff" /></TouchableOpacity>
        </View>
        {music && <View style={s.musicRow}><View style={{ flex: 1 }}><Text style={s.track}>{savedMusic?'Book soundtrack':MEMORY_SCORE_TITLE}</Text><Text style={s.credit}>{savedMusic?'Your saved excerpt and mix':MEMORY_SCORE_DESCRIPTION}</Text></View><FilmVolume value={volume} onChange={setVolume} /></View>}
        {!!(bookAudio.error||pageAudio.error||score.error) && <TouchableOpacity accessibilityRole="button" onPress={()=>{bookAudio.retry();pageAudio.retry();score.retry();}}><Text style={s.notice}>Music could not play. Tap to retry.</Text></TouchableOpacity>}
      </View>
    </View>
  </Modal>;
}

function FilmVideo({ item, active, muted, onReady, onError, onProgress, onEnd }: { item: MemoryFilmItem; active: boolean; muted: boolean; onReady: () => void; onError: () => void; onProgress: (value: number) => void; onEnd: () => void }) {
  const player = useVideoPlayer(item.uri!, p => { p.loop = false; p.muted = muted; p.timeUpdateEventInterval = .05; });
  const progressGuard = useRef(createMemoryFilmProgressGuard());
  const terminal = useRef(false);
  const state = useRef({ active, muted, onReady, onError, onProgress, onEnd }); state.current = { active, muted, onReady, onError, onProgress, onEnd };
  const [clock, setClock] = useState(0);
  useEffect(() => {
    let live = true, initialized = false;
    terminal.current = false;
    let recipe = memoryFilmVideoWindow(item.page, player.duration);
    const allowed = () => live && state.current.active && AppState.currentState === 'active';
    const sync = () => { progressGuard.current.reset(); progressGuard.current.stalled(player.currentTime, Date.now(), allowed() && initialized && !terminal.current); try { if (allowed() && player.status === 'readyToPlay' && !terminal.current) player.play(); else player.pause(); } catch {} };
    const fail = () => { if (!live || terminal.current) return; terminal.current = true; try { player.pause(); } catch {} state.current.onError(); };
    const configure = () => { if (!live || terminal.current) return; try {
      recipe = memoryFilmVideoWindow(item.page, player.duration); player.playbackRate = recipe.speed; player.volume = recipe.volume; player.muted = state.current.muted || recipe.volume === 0;
      if (!initialized) { player.currentTime = recipe.start; initialized = true; setClock(recipe.start); }
      state.current.onReady(); sync();
    } catch { fail(); } };
    const finish = () => { if (!allowed() || terminal.current) return; terminal.current = true; player.pause(); state.current.onProgress(1); state.current.onEnd(); };
    const status = player.addListener('statusChange', event => { if (!live) return; if (event.status === 'readyToPlay') configure(); else if (event.status === 'error') fail(); });
    const time = player.addListener('timeUpdate', event => { if (!allowed() || terminal.current) return; setClock(event.currentTime); state.current.onProgress(memoryFilmProgress(event.currentTime, recipe.start, recipe.end)); if (recipe.end != null && event.currentTime >= recipe.end - .025) finish(); });
    const ended = player.addListener('playToEnd', finish);
    const app = AppState.addEventListener('change', sync);
    if (player.status === 'readyToPlay') configure();
    const watchdog = setInterval(() => {
      if (progressGuard.current.stalled(player.currentTime, Date.now(), allowed() && initialized && !terminal.current)) fail();
    }, 500);
    return () => { live = false; terminal.current = true; clearInterval(watchdog); progressGuard.current.reset(); status.remove(); time.remove(); ended.remove(); app.remove(); try { player.pause(); } catch {} };
  }, [player, item.page]);
  useEffect(() => { progressGuard.current.reset(); progressGuard.current.stalled(player.currentTime, Date.now(), active && !terminal.current && AppState.currentState === 'active'); try { const recipe = memoryFilmVideoWindow(item.page, player.duration); player.muted = muted || recipe.volume === 0; if (active && !terminal.current && AppState.currentState === 'active') player.play(); else player.pause(); } catch {} }, [player, active, muted, item.page]);
  return <MemoryStoryFrame page={item.page} clock={clock}>{({ fit, style }) => <VideoView player={player} style={style} contentFit={fit} nativeControls={false} />}</MemoryStoryFrame>;
}

function useMemoryScore(active: boolean, volume: number) {
  const desired = useRef({ active, volume }); desired.current = { active, volume };
  const [attempt, setAttempt] = useState(0), [error, setError] = useState(false);
  const request = useRef<(() => void) | null>(null);
  useEffect(() => {
    let live = true, sound: Audio.Sound | null = null, busy = false, again = false;
    const sync = async () => {
      if (!live || !sound) return; if (busy) { again = true; return; } busy = true;
      try { do { again = false; await sound.setStatusAsync({ shouldPlay: live && desired.current.active && AppState.currentState === 'active', volume: Math.min(1, Math.max(0, desired.current.volume)), isLooping: true }); } while (live && again); }
      catch { if (live) setError(true); } finally { busy = false; }
    };
    request.current = () => { void sync(); }; setError(false);
    void Audio.Sound.createAsync(require('../../../assets/audio/platinum-memory-score.m4a'), { shouldPlay: false, isLooping: true, volume: 0 }).then(async loaded => { sound = loaded.sound; if (!live) { await sound.unloadAsync(); return; } await sync(); }).catch(() => { if (live) setError(true); });
    const app = AppState.addEventListener('change', () => { void sync(); });
    return () => { live = false; request.current = null; app.remove(); if (sound) void sound.unloadAsync().catch(() => {}); };
  }, [attempt]);
  useEffect(() => { request.current?.(); }, [active, volume]);
  return { error, retry: () => { if (error) setAttempt(value => value + 1); } };
}

function FilmVolume({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const width = useRef(1);
  return <View accessibilityRole="adjustable" accessibilityLabel="Background music volume" accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }} accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={event => onChange(Math.max(0, Math.min(1, value + (event.nativeEvent.actionName === 'increment' ? .1 : -.1))))}
    style={s.volume} onLayout={event => { width.current = event.nativeEvent.layout.width; }} onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderGrant={event => onChange(Math.max(0, Math.min(1, event.nativeEvent.locationX / width.current)))} onResponderMove={event => onChange(Math.max(0, Math.min(1, event.nativeEvent.locationX / width.current)))}>
    <View style={s.volumeTrack}><View style={[s.volumeFill, { width: `${value * 100}%` }]} /></View><View style={[s.volumeThumb, { left: `${value * 100}%` }]} />
  </View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#070b10' }, header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 10 }, heading: { flex: 1, alignItems: 'center', paddingHorizontal: 12 }, eyebrow: { color: '#c2b49a', letterSpacing: 3, fontSize: 10, fontWeight: '700' }, title: { color: '#fff', fontSize: 18, fontWeight: '600', marginTop: 4 }, icon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' }, timeline: { flexDirection: 'row', gap: 4, marginHorizontal: 18, marginBottom: 12 }, segment: { height: 3, flex: 1, backgroundColor: '#ffffff30', borderRadius: 4, overflow: 'hidden' }, segmentFill: { height: 3, backgroundColor: '#eadcc2' }, stage: { flex: 1, minHeight: 100, overflow: 'hidden', alignItems: 'center' }, frame: { width: '100%', maxWidth: 540, height: '100%' }, loading: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', gap: 12 }, loadText: { color: '#fff', fontSize: 13 }, textPage: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }, storyText: { color: '#fff', fontSize: 26, lineHeight: 36, textAlign: 'center', fontWeight: '500' }, error: { ...StyleSheet.absoluteFillObject, backgroundColor: '#101923ed', justifyContent: 'center', alignItems: 'center', padding: 28 }, errorText: { color: '#fff', textAlign: 'center', marginBottom: 16 }, retry: { minHeight: 44, paddingHorizontal: 20, paddingVertical: 12 }, retryText: { color: '#eadcc2', fontWeight: '700' }, footer: { paddingHorizontal: 18, paddingTop: 12 }, caption: { color: '#f6f3ed', textAlign: 'center', fontSize: 15, lineHeight: 21, marginBottom: 6 }, source: { alignItems: 'center', padding: 6 }, sourceText: { color: '#c9d4e1', fontSize: 12 }, controls: { flexDirection: 'row', alignItems: 'center', gap: 3 }, play: { backgroundColor: '#eadcc2' }, count: { flex: 1, color: '#aebac9', textAlign: 'center', fontSize: 12 }, selected: { backgroundColor: '#ffffff18' }, musicRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 8 }, track: { color: '#e9dfcf', fontSize: 12, fontWeight: '600' }, credit: { color: '#9faec1', fontSize: 10, marginTop: 3 }, notice: { color: '#eadcc2', fontSize: 12, marginTop: 9, textAlign: 'center' }, volume: { width: 110, height: 44, justifyContent: 'center' }, volumeTrack: { height: 3, backgroundColor: '#ffffff35', borderRadius: 2, overflow: 'hidden' }, volumeFill: { height: 3, backgroundColor: '#eadcc2' }, volumeThumb: { position: 'absolute', width: 12, height: 12, borderRadius: 6, marginLeft: -6, backgroundColor: '#eadcc2' },
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Linking, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { CameraView } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import { setAudioModeAsync } from 'expo-audio';
// iOS Expo Video changes AVAudioSession to playback when a player starts. The
// existing native Story player leaves the camera's play-and-record session
// intact, so pausing/replaying the original cannot disconnect the microphone.
import { useStoryVideoPlayer as useVideoPlayer, StoryVideoView as VideoView } from '../../../modules/boomerang/storyVideo';
import { captureRef } from 'react-native-view-shot';
import { Feather } from '@expo/vector-icons';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { useSafeAreaInsets } from '../../components/SafeArea';
import { useCameraLife } from '../../hooks/useCameraLife';
import { useCallContext } from '../../contexts/CallContext';
import { ensureCameraPermission, ensureMediaLibraryPermission, ensureMicrophonePermission } from '../../services/devicePermissions';
import { assertReactSourceAccess, prepareReactPostSource } from '../../services/reactSourceAccess';
import { setPendingReactCapture } from '../../utils/reactCaptureBridge';
import { returnToFeed } from '../../navigation/returnToFeed';
import { navigationScope } from '../../lib/navigationCache';
import { discardReactFile, exportReactTake, reactVideoDuration, stageReactSource } from '../../services/reactVideoExport';
import { reactCutoutAvailable, reactVideoCompositionAvailable } from '../../../modules/boomerang/reactComposition';
import { buildReactTimeline, REACT_MAX_SECONDS, REACT_MAX_SEGMENTS, reactRects, reactSourceAt, replaceReactSourceWindow, trimReactTimeline, type ReactCaptureParams, type ReactExport, type ReactLayout, type ReactPlaybackEvent, type ReactRect, type ReactSegment, type ReactSource } from '../../../shared/reactVideoComposition';

type Take = { uri: string; duration: number; segments: ReactSegment[] };
type Marker = { x: number; y: number } | null;
type Phase = 'choose' | 'preparing' | 'ready' | 'recording' | 'finishing' | 'editing' | 'exporting' | 'preview';
const cap = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const seconds = (value: number) => `${Math.floor(Math.max(0, value) / 60)}:${String(Math.floor(Math.max(0, value) % 60)).padStart(2, '0')}`;
const now = () => performance.now() / 1000;
const initialFace: ReactRect = { x: .65, y: .56, width: .3, height: .38 };

function Button({ label, icon, onPress, disabled = false, selected = false, primary = false }: { label: string; icon?: React.ComponentProps<typeof Feather>['name']; onPress: () => void; disabled?: boolean; selected?: boolean; primary?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, (selected || primary) && styles.selected, disabled && styles.disabled, pressed && { opacity: .7 }]}>
    {icon ? <Feather name={icon} size={17} color={selected || primary ? '#13171C' : '#F3F0E9'} /> : null}<Text style={[styles.buttonText, (selected || primary) && { color: '#13171C' }]}>{label}</Text>
  </Pressable>;
}
function Level({ label, value, onChange, disabled }: { label: string; value: number; onChange: (value: number) => void; disabled?: boolean }) {
  return <View style={styles.level}><Text style={styles.smallLabel}>{label}</Text><Button label={`Lower ${label.toLowerCase()}`} icon="minus" onPress={() => onChange(cap(Math.round((value - .1) * 10) / 10, 0, 1))} disabled={disabled || value <= 0} /><Text style={styles.levelNumber}>{Math.round(value * 100)}%</Text><Button label={`Raise ${label.toLowerCase()}`} icon="plus" onPress={() => onChange(cap(Math.round((value + .1) * 10) / 10, 0, 1))} disabled={disabled || value >= 1} /></View>;
}

/** The same artwork view is rendered over the editor and captured at native
 * output size. These annotations and the source credit are burned into MP4. */
function Artwork({ width, caption, arrow, highlight, attribution }: { width: number; caption: string; arrow: Marker; highlight: Marker; attribution: string }) {
  const height = width * 16 / 9, scale = width / 720;
  return <View pointerEvents="none" style={{ width, height, backgroundColor: 'transparent' }}>
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      {highlight ? <Circle cx={highlight.x * width} cy={highlight.y * height} r={width * .14} stroke="#F8D889" strokeWidth={7 * scale} fill="#F8D88918" /> : null}
      {arrow ? <><Line x1={(arrow.x - .2) * width} y1={(arrow.y + .1) * height} x2={arrow.x * width} y2={arrow.y * height} stroke="#F8D889" strokeWidth={8 * scale} strokeLinecap="round" /><Polyline points={`${(arrow.x - .07) * width},${(arrow.y + .005) * height} ${arrow.x * width},${arrow.y * height} ${(arrow.x - .015) * width},${(arrow.y + .05) * height}`} stroke="#F8D889" strokeWidth={8 * scale} fill="none" strokeLinecap="round" strokeLinejoin="round" /></> : null}
    </Svg>
    {caption.trim() ? <View style={{ position: 'absolute', left: 28 * scale, right: 28 * scale, bottom: 110 * scale, borderRadius: 12 * scale, paddingHorizontal: 20 * scale, paddingVertical: 12 * scale, backgroundColor: '#090D12DC' }}><Text style={{ color: '#FFF', fontSize: 34 * scale, lineHeight: 43 * scale, fontWeight: '700', textAlign: 'center' }}>{caption.trim()}</Text></View> : null}
    {attribution ? <View style={{ position: 'absolute', left: 20 * scale, right: 20 * scale, bottom: 22 * scale, alignItems: 'flex-start' }}><Text numberOfLines={2} style={{ color: '#F8F4E9', fontSize: 23 * scale, lineHeight: 29 * scale, fontWeight: '600', backgroundColor: '#090D12D9', paddingHorizontal: 12 * scale, paddingVertical: 7 * scale, borderRadius: 6 * scale }}>{attribution}</Text></View> : null}
  </View>;
}

function TextSourceCard({ source }: { source: ReactSource | null }) {
  const text = source?.text ?? '', excerpt = text.length > 1600, body = excerpt ? `${text.slice(0, 1600).trimEnd()}…` : text;
  const fontSize = body.length > 1000 ? 27 : body.length > 600 ? 32 : body.length > 300 ? 39 : 48;
  return <View style={{ width: 720, height: 1280, backgroundColor: '#EDE8DF', padding: 58, justifyContent: 'space-between' }}>
    <View><Text style={{ color: '#6D665A', fontSize: 20, fontWeight: '700', letterSpacing: 4 }}>PLATINUM CIRCLES · ORIGINAL POST</Text><Text style={{ color: '#232932', fontSize: 30, fontWeight: '800', marginTop: 28 }}>@{source?.creatorName?.replace(/^@/, '') || 'creator'}</Text></View>
    <View style={{ flex: 1, justifyContent: 'center', paddingVertical: 36 }}>
      {source?.title ? <Text style={{ color: '#242933', fontSize: 40, fontWeight: '800', marginBottom: 24 }} numberOfLines={3}>{source.title}</Text> : null}
      <Text style={{ color: '#252C35', fontSize, lineHeight: fontSize * 1.28, fontWeight: '500' }} numberOfLines={Math.floor(860 / (fontSize * 1.28))}>{body}</Text>
    </View>
    <Text style={{ color: '#6D665A', fontSize: 21, lineHeight: 28 }}>{excerpt ? 'Excerpt · Read the full text in the original post.' : 'React · Source post linked in the caption.'}</Text>
  </View>;
}

export default function ReactCaptureScreen() {
  const navigation = useNavigation<any>(), route = useRoute<any>(), insets = useSafeAreaInsets(), window = useWindowDimensions();
  const screenScope = useRef(navigationScope()).current, lifecycleAbort = useRef(new AbortController());
  const cameraLife = useCameraLife(), { callState } = useCallContext();
  const [source, setSource] = useState<ReactSource | null>(null), [localSource, setLocalSource] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('choose'), [permissions, setPermissions] = useState(false), [cameraReady, setCameraReady] = useState(false), [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraEpoch, setCameraEpoch] = useState(0);
  const [layout, setLayout] = useState<ReactLayout>('side-by-side'), [faceRect, setFaceRect] = useState(initialFace), [zoom, setZoom] = useState(1);
  const [sourceVolume, setSourceVolume] = useState(.65), [voiceVolume, setVoiceVolume] = useState(1), [sourceTime, setSourceTime] = useState(0), [sourceDuration, setSourceDuration] = useState(0), [sourcePlaying, setSourcePlaying] = useState(false);
  const [sourceStatus, setSourceStatus] = useState('idle'), [elapsed, setElapsed] = useState(0), [take, setTake] = useState<Take | null>(null), [trimStart, setTrimStart] = useState('0'), [trimEnd, setTrimEnd] = useState('0');
  const [caption, setCaption] = useState(''), [arrow, setArrow] = useState<Marker>(null), [highlight, setHighlight] = useState<Marker>(null), [tool, setTool] = useState<'face' | 'arrow' | 'highlight'>('face');
  const [reviewPlaying, setReviewPlaying] = useState(false), [reviewTime, setReviewTime] = useState(0), [exported, setExported] = useState<ReactExport | null>(null), [saveBusy, setSaveBusy] = useState(false);
  const [seekText, setSeekText] = useState('0');
  const [textSource, setTextSource] = useState<ReactSource | null>(null);
  const [timingOpen, setTimingOpen] = useState(false), [timingStart, setTimingStart] = useState('0'), [timingEnd, setTimingEnd] = useState('1'), [timingSource, setTimingSource] = useState('0');
  const sourcePlayer = useVideoPlayer(source?.kind === 'video' ? localSource : null, player => { player.loop = false; player.timeUpdateEventInterval = .05; player.audioMixingMode = 'mixWithOthers'; });
  const facePlayer = useVideoPlayer(take?.uri ?? null, player => { player.loop = false; player.timeUpdateEventInterval = .05; player.audioMixingMode = 'mixWithOthers'; });
  const finalPlayer = useVideoPlayer(exported?.uri ?? null, player => { player.loop = false; player.audioMixingMode = 'mixWithOthers'; });
  const camera = useRef<CameraView>(null), art = useRef<View>(null), textCard = useRef<View>(null), mounted = useRef(true), generation = useRef(0), busy = useRef(false), activeAbort = useRef<AbortController | null>(null);
  const stage = useRef<Awaited<ReturnType<typeof stageReactSource>> | null>(null), takeRef = useRef<Take | null>(null), exportedRef = useRef<ReactExport | null>(null), allowLeave = useRef(false);
  const recording = useRef(false), recordingStart = useRef(0), recordingEnd = useRef<number | null>(null), events = useRef<ReactPlaybackEvent[]>([]), tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const sourceRef = useRef(source), phaseRef = useRef(phase), volumeRef = useRef(sourceVolume), pendingPlay = useRef(false), stopRef = useRef<() => void>(() => {}), faceRectRef = useRef(faceRect);
  sourceRef.current = source; phaseRef.current = phase; volumeRef.current = sourceVolume; faceRectRef.current = faceRect; takeRef.current = take; exportedRef.current = exported;
  const stageWidth = Math.min(window.width - 32, 390, (window.height * .52) * 9 / 16), stageHeight = stageWidth * 16 / 9;
  const rects = reactRects(layout, faceRect), editable = phase === 'ready' || phase === 'editing', isBusy = ['preparing', 'finishing', 'exporting'].includes(phase);
  const attribution = source?.attributionText || (source?.creatorName ? `React to @${source.creatorName.replace(/^@/, '')}` : source?.postId ? 'React · Original post credited' : '');
  const styleRect = (rect: ReactRect) => ({ position: 'absolute' as const, left: rect.x * stageWidth, top: rect.y * stageHeight, width: rect.width * stageWidth, height: rect.height * stageHeight, overflow: 'hidden' as const });
  const alert = (title: string, error: unknown) => { if (mounted.current) Alert.alert(title, error instanceof Error ? error.message : 'Please try again.'); };
  const scopeCurrent = () => mounted.current && screenScope != null && navigationScope() === screenScope;

  const appendEvent = useCallback((position?: number, playing?: boolean, volume?: number) => {
    if (!recording.current || sourceRef.current?.kind !== 'video') return;
    const at = cap(Math.round((now() - recordingStart.current) * 30) / 30, 0, REACT_MAX_SECONDS);
    const event: ReactPlaybackEvent = { at, sourceTime: Math.max(0, position ?? sourcePlayer.currentTime), playing: playing ?? sourcePlayer.playing, volume: volume ?? volumeRef.current };
    const last = events.current[events.current.length - 1];
    if (last?.at === at) events.current[events.current.length - 1] = event;
    else if (!last || last.playing !== event.playing || last.volume !== event.volume || Math.abs(last.sourceTime + (last.playing ? at - last.at : 0) - event.sourceTime) > .18) events.current.push(event);
    if (events.current.length >= REACT_MAX_SEGMENTS - 2) stopRef.current();
  }, [sourcePlayer]);

  useEffect(() => {
    const time = sourcePlayer.addListener('timeUpdate', event => { setSourceTime(event.currentTime); });
    const playing = sourcePlayer.addListener('playingChange', event => { setSourcePlaying(event.isPlaying); appendEvent(undefined, event.isPlaying); });
    const status = sourcePlayer.addListener('statusChange', event => {
      setSourceStatus(event.status);
      if (sourcePlayer.duration > 0) setSourceDuration(sourcePlayer.duration);
      if (event.status === 'loading' && recording.current) appendEvent(undefined, false);
      if (event.status === 'readyToPlay' && recording.current && pendingPlay.current) { sourcePlayer.play(); appendEvent(undefined, true); }
      if (event.status === 'error' && recording.current) { stopRef.current(); alert('Source playback stopped', new Error('Your take has stopped because the original could not continue playing.')); }
    });
    const ended = sourcePlayer.addListener('playToEnd', () => { pendingPlay.current = false; appendEvent(Math.max(0, sourcePlayer.duration - 1 / 60), false); });
    return () => { time.remove(); playing.remove(); status.remove(); ended.remove(); };
  }, [sourcePlayer, appendEvent]);
  useEffect(() => { sourcePlayer.volume = sourceVolume; facePlayer.volume = voiceVolume; }, [sourceVolume, voiceVolume, sourcePlayer, facePlayer]);

  const stopReview = useCallback(() => { facePlayer.pause(); sourcePlayer.pause(); setReviewPlaying(false); }, [facePlayer, sourcePlayer]);
  useEffect(() => {
    const sub = facePlayer.addListener('timeUpdate', event => {
      setReviewTime(event.currentTime);
      if (!facePlayer.playing || !takeRef.current) return;
      const end = Number(trimEnd);
      if (Number.isFinite(end) && event.currentTime >= end - .02) { stopReview(); return; }
      const point = reactSourceAt(takeRef.current.segments, event.currentTime);
      if (sourceRef.current?.kind === 'video') {
        if (Math.abs(sourcePlayer.currentTime - point.time) > .16 || !point.playing && Math.abs(sourcePlayer.currentTime - point.time) > .02) sourcePlayer.currentTime = point.time;
        sourcePlayer.volume = point.volume;
        if (point.playing) sourcePlayer.play(); else sourcePlayer.pause();
      }
    });
    const ended = facePlayer.addListener('playToEnd', stopReview);
    return () => { sub.remove(); ended.remove(); };
  }, [facePlayer, sourcePlayer, stopReview, trimEnd]);

  useEffect(() => {
    const app = AppState.addEventListener('change', state => {
      if (state !== 'active') { stopRef.current(); stopReview(); finalPlayer.pause(); activeAbort.current?.abort(); }
    });
    return () => app.remove();
  }, [finalPlayer, stopReview]);
  useEffect(() => { setCameraReady(false); setCameraError(null); }, [cameraLife.epoch, cameraLife.active, permissions, cameraEpoch]);
  useEffect(() => {
    if (!['idle', 'ended'].includes(callState)) { stopRef.current(); stopReview(); }
  }, [callState, stopReview]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; generation.current++; lifecycleAbort.current.abort(); activeAbort.current?.abort();
      if (tick.current) clearInterval(tick.current); try { camera.current?.stopRecording(); } catch {}
      void stage.current?.dispose(); void discardReactFile(takeRef.current?.uri); void discardReactFile(exportedRef.current?.uri);
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    };
  }, []);
  useEffect(() => navigation.addListener('beforeRemove', (event: any) => {
    if (allowLeave.current || !recording.current && !takeRef.current && !busy.current) return;
    event.preventDefault(); Alert.alert('Discard this reaction?', 'The camera take and unfinished edits will be removed.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => { allowLeave.current = true; navigation.dispatch(event.data.action); } }]);
  }), [navigation]);

  const enableCamera = useCallback(async () => {
    try {
      const cameraPermission = await ensureCameraPermission();
      const microphonePermission = cameraPermission.granted ? await ensureMicrophonePermission() : null;
      if (!mounted.current) return false;
      if (!cameraPermission.granted || !microphonePermission?.granted) {
        Alert.alert('Camera and microphone access', 'Allow both so React can record your face and commentary.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Open settings', onPress: () => { void Linking.openSettings(); } }]); return false;
      }
      setPermissions(true); return true;
    } catch (error) { alert('Camera unavailable', error); return false; }
  }, []);

  const loadSource = useCallback(async (selected: ReactSource) => {
    if (busy.current || recording.current) return;
    busy.current = true; const version = ++generation.current, abort = new AbortController(); activeAbort.current = abort; setPhase('preparing');
    let textUri: string | undefined;
    try {
      const fresh = selected.postId ? await prepareReactPostSource(selected, abort.signal) : selected;
      if (!scopeCurrent() || version !== generation.current || abort.signal.aborted) return;
      if (fresh.postId && fresh.kind === 'image' && fresh.text && !fresh.uri) {
        setTextSource(fresh);
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        textUri = await captureRef(textCard, { format: 'png', quality: 1, width: 720, height: 1280, result: 'tmpfile' });
      }
      const prepared = await stageReactSource(fresh, abort.signal, textUri);
      if (!scopeCurrent() || version !== generation.current) { await prepared.dispose(); return; }
      await stage.current?.dispose(); stage.current = prepared;
      setSource(prepared.source); setLocalSource(prepared.uri); setSourceTime(0); setSourceDuration(prepared.source.kind === 'video' ? await reactVideoDuration(prepared.uri, abort.signal) : 0);
      if (!scopeCurrent() || version !== generation.current) return;
      setPhase('ready'); await enableCamera();
    } catch (error) { if (mounted.current && version === generation.current) { setPhase(sourceRef.current ? 'ready' : 'choose'); if (!abort.signal.aborted) alert('Source unavailable', error); } }
    finally { busy.current = false; await discardReactFile(textUri); if (activeAbort.current === abort) activeAbort.current = null; }
  }, [enableCamera]);
  useEffect(() => { const params = route.params as ReactCaptureParams; if (params?.source) void loadSource(params.source); }, []);

  const pickSource = async () => {
    if (busy.current) return;
    try {
      const permission = await ensureMediaLibraryPermission();
      if (!permission.granted) { Alert.alert('Photo access needed', 'Allow access to choose a video or picture to react to.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Open settings', onPress: () => { void Linking.openSettings(); } }]); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: false, quality: 1, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible });
      const asset = !result.canceled && result.assets?.[0];
      if (asset) { if (asset.mimeType === 'image/gif') throw new Error('Choose a still photo or a video for React.'); await loadSource({ uri: asset.uri, kind: asset.type === 'video' ? 'video' : 'image', width: asset.width, height: asset.height, duration: asset.duration ? asset.duration / 1000 : undefined }); }
    } catch (error) { alert('Could not choose media', error); }
  };
  const stopRecording = useCallback(() => {
    if (!recording.current) return;
    recordingEnd.current = now(); recording.current = false; pendingPlay.current = false;
    if (tick.current) { clearInterval(tick.current); tick.current = null; }
    sourcePlayer.pause(); setPhase('finishing'); try { camera.current?.stopRecording(); } catch (error) { alert('Recording could not stop', error); }
  }, [sourcePlayer]);
  stopRef.current = stopRecording;

  const startRecording = async () => {
    if (busy.current || recording.current || !camera.current || !cameraReady || !source || !stage.current || !['idle', 'ended'].includes(callState)) return;
    if (!reactVideoCompositionAvailable) { Alert.alert('Update needed', 'React needs the new app build to combine your camera, microphone, and source into one video.'); return; }
    busy.current = true; const version = generation.current;
    try {
      await assertReactSourceAccess(source);
      if (!scopeCurrent() || !await enableCamera() || !scopeCurrent() || version !== generation.current || !camera.current) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false, shouldRouteThroughEarpiece: false });
      if (!scopeCurrent() || version !== generation.current || !camera.current) return;
      sourcePlayer.pause();
      if (source.kind === 'video' && sourcePlayer.currentTime >= sourceDuration - .05) sourcePlayer.currentTime = 0;
      const sourceStart = source.kind === 'video' ? sourcePlayer.currentTime : 0;
      recordingStart.current = now(); recordingEnd.current = null; recording.current = true; setElapsed(0); setPhase('recording');
      events.current = [{ at: 0, sourceTime: sourceStart, playing: false, volume: sourceVolume }];
      const work = camera.current.recordAsync({ maxDuration: REACT_MAX_SECONDS, maxFileSize: 480 * 1024 * 1024, ...(Platform.OS === 'ios' ? { codec: 'avc1' as const } : {}) });
      if (source.kind === 'video') { pendingPlay.current = true; sourcePlayer.play(); appendEvent(sourceStart, true); }
      tick.current = setInterval(() => { if (mounted.current && recording.current) { const value = now() - recordingStart.current; setElapsed(value); if (value >= REACT_MAX_SECONDS - .1) stopRef.current(); } }, 100);
      const result = await work;
      const elapsedTake = Math.min(REACT_MAX_SECONDS, Math.max(.1, (recordingEnd.current ?? now()) - recordingStart.current));
      recording.current = false; pendingPlay.current = false; sourcePlayer.pause(); if (tick.current) { clearInterval(tick.current); tick.current = null; }
      if (!result?.uri) throw new Error('The camera did not save a video. Try recording again.');
      if (!scopeCurrent() || version !== generation.current) { await discardReactFile(result.uri); return; }
      setPhase('finishing');
      try {
        const cameraDuration = await reactVideoDuration(result.uri, lifecycleAbort.current.signal), duration = Math.floor(Math.min(cameraDuration, elapsedTake, REACT_MAX_SECONDS) * 30) / 30;
        if (!scopeCurrent() || version !== generation.current) { await discardReactFile(result.uri); return; }
        if (duration < .35) throw new Error('Record at least a moment of commentary before stopping.');
        const fullTimeline = buildReactTimeline(events.current, elapsedTake, sourceDuration, source.kind);
        // Expo resolves only at stop. Reconcile its encoder's measured duration
        // with the control clock so camera warm-up is excluded from the take.
        const offset = Math.max(0, elapsedTake - duration);
        const segments = trimReactTimeline(fullTimeline, offset, offset + duration);
        const value = { uri: result.uri, duration, segments }; setTake(value); takeRef.current = value;
        setTrimStart('0'); setTrimEnd(duration.toFixed(3)); setReviewTime(0); setPhase('editing');
        if (source.kind === 'video') sourcePlayer.currentTime = segments[0]?.sourceStart ?? 0;
      } catch (error) { await discardReactFile(result.uri); throw error; }
    } catch (error) {
      recording.current = false; if (tick.current) { clearInterval(tick.current); tick.current = null; }
      try { camera.current?.stopRecording(); } catch {} sourcePlayer.pause();
      if (scopeCurrent()) { setCameraReady(false); setCameraEpoch(value => value + 1); setPhase('ready'); alert('Recording unavailable', error); }
    } finally { busy.current = false; if (scopeCurrent()) void setAudioModeAsync({ allowsRecording: false }).catch(() => {}); }
  };

  const seek = (position: number) => {
    if (source?.kind !== 'video' || phase === 'editing' || isBusy) return;
    const value = cap(position, 0, Math.max(0, sourceDuration - 1 / 30)); sourcePlayer.currentTime = value; setSourceTime(value); appendEvent(value, pendingPlay.current);
  };
  const toggleSource = () => {
    if (source?.kind !== 'video') return;
    if (sourcePlayer.playing) { pendingPlay.current = false; appendEvent(undefined, false); sourcePlayer.pause(); }
    else { if (sourcePlayer.currentTime >= sourceDuration - .05) seek(0); pendingPlay.current = true; appendEvent(undefined, true); sourcePlayer.play(); }
  };
  const replaySource = () => {
    if (source?.kind !== 'video' || isBusy) return;
    sourcePlayer.currentTime = 0; setSourceTime(0); pendingPlay.current = true; sourcePlayer.play(); appendEvent(0, true);
  };
  const changeSourceVolume = (value: number) => {
    setSourceVolume(value); volumeRef.current = value; sourcePlayer.volume = value; appendEvent(undefined, undefined, value);
    if (take) setTake({ ...take, segments: take.segments.map(segment => ({ ...segment, volume: segment.playing ? value : 0 })) });
  };
  const trim = () => {
    const start = Number(trimStart), end = Number(trimEnd);
    if (!take || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > take.duration + .001 || end - start < .1) throw new Error('Enter a valid start and end, keeping at least 0.1 seconds of your take.');
    return { start, end: Math.min(end, take.duration) };
  };
  const playTake = () => {
    if (reviewPlaying) { stopReview(); return; }
    try { const { start } = trim(); facePlayer.currentTime = start; const point = reactSourceAt(take!.segments, start); if (source?.kind === 'video') { sourcePlayer.currentTime = point.time; if (point.playing) sourcePlayer.play(); else sourcePlayer.pause(); } facePlayer.play(); setReviewPlaying(true); }
    catch (error) { alert('Check the trim', error); }
  };
  const applyTiming = (playing: boolean) => {
    if (!take || !source) return;
    try {
      stopReview();
      const segments = replaceReactSourceWindow(take.segments, { start: Number(timingStart), end: Number(timingEnd), sourceTime: Number(timingSource), playing, sourceDuration, kind: source.kind, volume: sourceVolume });
      setTake({ ...take, segments }); facePlayer.currentTime = Number(timingStart); sourcePlayer.currentTime = Number(timingSource);
      setReviewTime(Number(timingStart)); setTimingOpen(false);
    } catch (error) { alert('Check source timing', error); }
  };
  const exportVideo = async () => {
    if (!take || !source || !localSource || busy.current) return;
    let overlayUri: string | undefined;
    const abort = new AbortController(); activeAbort.current = abort;
    try {
      const window = trim(); busy.current = true; stopReview(); setPhase('exporting');
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (caption.trim() || arrow || highlight || attribution) overlayUri = await captureRef(art, { format: 'png', quality: 1, width: 720, height: 1280, result: 'tmpfile' });
      const result = await exportReactTake({ source, sourceUri: localSource, cameraUri: take.uri, segments: take.segments, trimStart: window.start, trimEnd: window.end,
        layout, faceRect, sourceZoom: zoom, voiceVolume, overlayUri }, abort.signal);
      if (!scopeCurrent()) { await discardReactFile(result.uri); return; }
      setExported(result); exportedRef.current = result; setPhase('preview');
    } catch (error) { if (mounted.current) { setPhase('editing'); if (!abort.signal.aborted) alert('Could not export React', error); } }
    finally { busy.current = false; await discardReactFile(overlayUri); if (activeAbort.current === abort) activeAbort.current = null; }
  };
  const saveVideo = async () => {
    if (!exported || !source || saveBusy || !scopeCurrent()) return;
    setSaveBusy(true);
    try {
      await assertReactSourceAccess(source); if (!scopeCurrent()) return;
      const permission = await ensureMediaLibraryPermission({ writeOnly: true }); if (!scopeCurrent()) return;
      if (!permission.granted) throw new Error('Allow photo-library access to save your reaction.');
      await MediaLibrary.saveToLibraryAsync(exported.uri); if (!scopeCurrent()) return;
      Alert.alert('Video saved', 'The combined reaction is in your photo library.');
    } catch (error) { if (scopeCurrent()) alert('Could not save video', error); } finally { if (mounted.current) setSaveBusy(false); }
  };
  const useVideo = async () => {
    if (!exported || !source || saveBusy || !scopeCurrent()) return;
    setSaveBusy(true);
    try {
      await assertReactSourceAccess(source); if (!scopeCurrent()) return;
      if (!setPendingReactCapture(exported, screenScope)) {
        if (scopeCurrent()) Alert.alert('Another reaction is ready', 'Finish or discard the reaction already in your post composer, then use this take. Your video stays here.');
        return;
      }
      finalPlayer.pause(); allowLeave.current = true;
      exportedRef.current = null; setExported(null);
      returnToFeed(navigation);
    } catch (error) { if (scopeCurrent()) alert('Could not use this reaction', error); } finally { if (mounted.current) setSaveBusy(false); }
  };
  const retake = () => Alert.alert('Record a new take?', 'This camera take and its source timing will be removed.', [{ text: 'Keep take', style: 'cancel' }, { text: 'Record again', style: 'destructive', onPress: () => {
    stopReview(); void discardReactFile(take?.uri); setTake(null); takeRef.current = null; setReviewTime(0); sourcePlayer.currentTime = 0; setCameraReady(false); setPhase('ready');
  } }]);

  const dragStart = useRef(initialFace);
  const drag = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => editable && (layout === 'pip' || layout === 'cutout') && tool === 'face',
    onMoveShouldSetPanResponder: () => editable && (layout === 'pip' || layout === 'cutout') && tool === 'face',
    onPanResponderGrant: () => { dragStart.current = faceRectRef.current; },
    onPanResponderMove: (_, gesture) => setFaceRect(reactRects(layout, { ...dragStart.current, x: dragStart.current.x + gesture.dx / stageWidth, y: dragStart.current.y + gesture.dy / stageHeight }).face),
  }), [editable, layout, stageWidth, stageHeight, tool]);

  return <View style={[styles.root, { paddingTop: insets.top }]}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Close React" onPress={() => navigation.goBack()} style={styles.iconButton}><Feather name="x" color="#F3F0E9" size={24} /></Pressable><View style={{ flex: 1 }}><Text style={styles.title}>React</Text><Text style={styles.subtitle}>Your face. Your voice. Your perspective.</Text></View>{phase === 'recording' ? <><Text accessibilityLiveRegion="polite" style={styles.recordTime}>● {seconds(elapsed)}</Text><Pressable accessibilityRole="button" accessibilityLabel="Stop camera and microphone recording" onPress={stopRecording} style={styles.iconButton}><Feather name="square" color="#FF8F86" size={25} /></Pressable></> : null}</View>
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 28 }} keyboardShouldPersistTaps="handled">
      {!source ? <View style={styles.welcome}><View style={styles.heroIcon}><Feather name="video" size={34} color="#EAD5A9" /></View><Text style={styles.welcomeTitle}>Put your perspective in the picture</Text><Text style={styles.body}>Choose a photo or video. Keep your face and microphone recording while you pause, explain, and replay the original.</Text><Button label="Choose photo or video" icon="image" primary onPress={() => { void pickSource(); }} disabled={isBusy} /><Text style={styles.hint}>You can also choose React from a public post’s share menu.</Text></View> : <>
        <View style={styles.stageWrap}>
          <View style={[styles.stage, { width: stageWidth, height: stageHeight }]}>
            {phase === 'preview' && exported ? <VideoView style={StyleSheet.absoluteFill} player={finalPlayer} contentFit="contain" nativeControls surfaceType="textureView" /> : <>
              <View style={styleRect(rects.source)}><View style={[StyleSheet.absoluteFill, { transform: [{ scale: zoom }] }]}>{source.kind === 'video' ? <VideoView style={StyleSheet.absoluteFill} player={sourcePlayer} contentFit="contain" nativeControls={false} surfaceType="textureView" pointerEvents="none" /> : <Image source={{ uri: localSource! }} style={StyleSheet.absoluteFill} resizeMode="contain" />}</View></View>
              <View style={[styleRect(rects.face), editable && tool === 'face' && (layout === 'pip' || layout === 'cutout') && { borderColor: '#EAD5A9', borderWidth: 1 }]} {...drag.panHandlers}>
                {take ? <VideoView style={StyleSheet.absoluteFill} player={facePlayer} contentFit="cover" nativeControls={false} surfaceType="textureView" pointerEvents="none" /> : permissions && cameraLife.active && !['preparing', 'choose'].includes(phase) ? <CameraView key={`${cameraLife.epoch}:${cameraEpoch}`} ref={camera} style={StyleSheet.absoluteFill} facing="front" mode="video" mirror mute={false} videoQuality="720p" onCameraReady={() => { setCameraReady(true); setCameraError(null); }} onMountError={event => { setCameraError(event.message); setCameraReady(false); }} /> : <View style={styles.cameraPlaceholder}><Feather name="user" color="#B9B3A8" size={36} /><Text style={styles.hint}>Your camera</Text></View>}
              </View>
              <View pointerEvents="none" style={StyleSheet.absoluteFill}><Artwork width={stageWidth} caption={caption} arrow={arrow} highlight={highlight} attribution={attribution} /></View>
              {editable && tool !== 'face' ? <Pressable accessibilityRole="button" accessibilityLabel={`Position ${tool} on the source`} style={StyleSheet.absoluteFill} onPress={event => { const marker = { x: cap(event.nativeEvent.locationX / stageWidth, .05, .95), y: cap(event.nativeEvent.locationY / stageHeight, .05, .95) }; if (tool === 'arrow') setArrow(marker); else setHighlight(marker); }} /> : null}
            </>}
          </View>
        </View>
        {isBusy ? <View style={styles.progress}><ActivityIndicator color="#EAD5A9" /><Text style={styles.body}>{phase === 'exporting' ? layout === 'cutout' ? 'Combining your reaction and removing the camera background…' : 'Combining camera, source timing, and both audio tracks…' : phase === 'finishing' ? 'Preparing your take…' : 'Preparing the source…'}</Text>{phase !== 'finishing' ? <Button label="Cancel" onPress={() => activeAbort.current?.abort()} /> : null}</View> : null}
        {phase === 'ready' && !permissions ? <Button label="Enable camera and microphone" icon="camera" primary onPress={() => { void enableCamera(); }} /> : null}
        {cameraError && !take ? <View style={styles.notice}><Text style={styles.body}>{cameraError}</Text><Button label="Retry camera" onPress={() => { setPermissions(false); void enableCamera(); }} /></View> : null}
        {phase === 'recording' ? <Text accessibilityLiveRegion="polite" style={styles.captureStatus}>{source.kind === 'image' ? 'Photo held · Camera and microphone are recording' : sourcePlaying ? 'Source playing · Camera and microphone are recording' : 'Source paused · Camera and microphone keep recording'}</Text> : null}
        {(phase === 'ready' || phase === 'recording') && source.kind === 'video' ? <View style={styles.panel}><View style={styles.rowBetween}><Text style={styles.sectionLabel}>ORIGINAL</Text><Text style={styles.mono}>{seconds(sourceTime)} / {seconds(sourceDuration)}</Text></View><View style={styles.row}><Button label="Back 5s" icon="rewind" onPress={() => seek(sourceTime - 5)} disabled={sourceStatus === 'error'} /><Button label={sourcePlaying ? 'Pause source' : 'Play source'} icon={sourcePlaying ? 'pause' : 'play'} selected={sourcePlaying} onPress={toggleSource} disabled={sourceStatus === 'error' || sourceDuration <= 0} /><Button label="Replay" icon="rotate-ccw" onPress={replaySource} /></View><View style={styles.row}><Text style={styles.smallLabel}>Jump to second</Text><TextInput accessibilityLabel="Source second to seek to" value={seekText} onChangeText={setSeekText} keyboardType="decimal-pad" style={styles.numberInput} /><Button label="Go" onPress={() => { const value = Number(seekText); if (Number.isFinite(value)) seek(value); }} /></View></View> : null}
        {phase === 'ready' ? <View style={styles.recordArea}><Button label="Record reaction" icon="circle" primary disabled={!permissions || !cameraReady || !localSource || source.kind === 'video' && sourceDuration <= 0 || !['idle', 'ended'].includes(callState)} onPress={() => { void startRecording(); }} /><Text style={styles.hint}>Up to 2 minutes. Headphones keep the source audio out of your microphone.</Text></View> : null}
        {phase === 'recording' ? <View style={styles.recordArea}><Button label="Stop camera and microphone" icon="square" primary onPress={stopRecording} /></View> : null}
        {phase === 'editing' && take ? <View style={styles.panel}><View style={styles.rowBetween}><Text style={styles.sectionLabel}>REVIEW YOUR TAKE</Text><Text style={styles.mono}>{seconds(reviewTime)} / {seconds(take.duration)}</Text></View><View style={styles.row}><Button label={reviewPlaying ? 'Pause review' : 'Review take'} icon={reviewPlaying ? 'pause' : 'play'} onPress={playTake} /><Button label="Record again" icon="rotate-ccw" onPress={retake} /></View><View style={styles.row}><Text style={styles.smallLabel}>Trim start</Text><TextInput accessibilityLabel="Reaction trim start in seconds" style={styles.numberInput} keyboardType="decimal-pad" value={trimStart} onChangeText={value => { stopReview(); setTrimStart(value); }} /><Text style={styles.smallLabel}>End</Text><TextInput accessibilityLabel="Reaction trim end in seconds" style={styles.numberInput} keyboardType="decimal-pad" value={trimEnd} onChangeText={value => { stopReview(); setTrimEnd(value); }} /></View><ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={styles.row}>{take.segments.map((segment, index) => <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${segment.playing ? 'playback' : 'hold'} from ${segment.start.toFixed(1)} to ${segment.end.toFixed(1)} seconds`} key={index} onPress={() => { setTimingStart(segment.start.toFixed(3)); setTimingEnd(segment.end.toFixed(3)); setTimingSource(segment.sourceStart.toFixed(3)); setTimingOpen(true); }} style={[styles.timelineChip, !segment.playing && { borderColor: '#DCC8A5' }]}><Text style={styles.timelineText}>{segment.playing ? 'Play' : 'Hold'} {seconds(segment.sourceStart)}</Text><Text style={styles.hint}>{(segment.end - segment.start).toFixed(1)}s</Text></Pressable>)}</View></ScrollView>{source.kind === 'video' ? <><Button label={timingOpen ? 'Close timing editor' : 'Adjust source timing'} icon="clock" selected={timingOpen} onPress={() => { stopReview(); if (!timingOpen) { setTimingStart(Math.min(reviewTime, take.duration - .1).toFixed(3)); setTimingEnd(Math.min(take.duration, reviewTime + 2).toFixed(3)); setTimingSource(reactSourceAt(take.segments, reviewTime).time.toFixed(3)); } setTimingOpen(!timingOpen); }} />{timingOpen ? <><Text style={styles.hint}>Hold one original frame or replay a passage during this part of your camera take. Your face and voice keep their timing.</Text><View style={styles.row}><Text style={styles.smallLabel}>Take from</Text><TextInput accessibilityLabel="Source timing edit start in take seconds" value={timingStart} onChangeText={setTimingStart} keyboardType="decimal-pad" style={styles.numberInput} /><Text style={styles.smallLabel}>to</Text><TextInput accessibilityLabel="Source timing edit end in take seconds" value={timingEnd} onChangeText={setTimingEnd} keyboardType="decimal-pad" style={styles.numberInput} /></View><View style={styles.row}><Text style={styles.smallLabel}>Original second</Text><TextInput accessibilityLabel="Original source second for timing edit" value={timingSource} onChangeText={setTimingSource} keyboardType="decimal-pad" style={styles.numberInput} /></View><View style={styles.row}><Button label="Hold this frame" icon="pause" onPress={() => applyTiming(false)} /><Button label="Replay from here" icon="play" onPress={() => applyTiming(true)} /></View></> : null}</> : null}</View> : null}
        {editable ? <>
          <View style={styles.panel}><Text style={styles.sectionLabel}>LAYOUT</Text><View style={styles.row}><Button label="Side by side" icon="columns" selected={layout === 'side-by-side'} onPress={() => setLayout('side-by-side')} /><Button label="Top / bottom" icon="sidebar" selected={layout === 'top-bottom'} onPress={() => setLayout('top-bottom')} /></View><View style={styles.row}><Button label="Picture in picture" icon="copy" selected={layout === 'pip'} onPress={() => setLayout('pip')} />{reactCutoutAvailable ? <Button label="Person cutout" icon="user" selected={layout === 'cutout'} onPress={() => setLayout('cutout')} /> : null}</View>{layout === 'pip' || layout === 'cutout' ? <><Text style={styles.hint}>Drag your camera window to move it. Use size controls to keep the original visible.</Text><View style={styles.row}><Button label="Smaller face" icon="minimize-2" onPress={() => setFaceRect(reactRects(layout, { ...faceRect, width: faceRect.width - .05, height: faceRect.height - .06 }).face)} /><Button label="Larger face" icon="maximize-2" onPress={() => setFaceRect(reactRects(layout, { ...faceRect, width: faceRect.width + .05, height: faceRect.height + .06 }).face)} /><Button label="Move face" selected={tool === 'face'} onPress={() => setTool('face')} /></View></> : null}{layout === 'cutout' ? <Text style={styles.hint}>The camera background is removed during export. Check the finished video in the next preview.</Text> : null}</View>
          <View style={styles.panel}><Text style={styles.sectionLabel}>EXPLAIN THE MOMENT</Text><TextInput accessibilityLabel="Reaction caption" style={styles.captionInput} placeholder="Add a short caption…" placeholderTextColor="#9D9BA0" value={caption} onChangeText={setCaption} maxLength={180} multiline /><View style={styles.row}><Button label={arrow ? 'Move arrow' : 'Add arrow'} icon="arrow-up-right" selected={tool === 'arrow'} onPress={() => { setArrow(arrow ?? { x: .56, y: .3 }); setTool('arrow'); }} /><Button label={highlight ? 'Move highlight' : 'Highlight'} icon="circle" selected={tool === 'highlight'} onPress={() => { setHighlight(highlight ?? { x: .3, y: .3 }); setTool('highlight'); }} />{arrow || highlight ? <Button label="Clear markers" onPress={() => { setArrow(null); setHighlight(null); setTool('face'); }} /> : null}</View>{tool !== 'face' ? <Text style={styles.hint}>Tap the picture to position the {tool}.</Text> : null}<View style={styles.row}><Text style={styles.smallLabel}>Source close-up · {zoom.toFixed(1)}×</Text><Button label="Zoom out source" icon="zoom-out" disabled={zoom <= 1} onPress={() => setZoom(cap(zoom - .25, 1, 3))} /><Button label="Zoom in source" icon="zoom-in" disabled={zoom >= 3} onPress={() => setZoom(cap(zoom + .25, 1, 3))} /></View></View>
        </> : null}
        {editable || phase === 'recording' ? <View style={styles.panel}><Text style={styles.sectionLabel}>SOUND</Text>{source.kind === 'video' ? <Level label="Original" value={sourceVolume} onChange={changeSourceVolume} /> : null}<Level label="Your voice" value={voiceVolume} onChange={setVoiceVolume} disabled={phase === 'recording'} /></View> : null}
        {phase === 'editing' ? <Button label="Create finished video" icon="film" primary onPress={() => { void exportVideo(); }} /> : null}
        {phase === 'preview' ? <View style={styles.panel}><Text style={styles.sectionLabel}>YOUR FINISHED REACTION</Text><Text style={styles.body}>This is the combined video, including your source pauses, replays, commentary, and artwork.</Text><View style={styles.row}><Button label="Use in post" icon="arrow-right" primary onPress={() => { void useVideo(); }} disabled={saveBusy} /><Button label="Save video" icon="download" onPress={() => { void saveVideo(); }} disabled={saveBusy} /><Button label="Edit again" icon="edit-2" onPress={() => { finalPlayer.pause(); void discardReactFile(exported?.uri); setExported(null); exportedRef.current = null; setPhase('editing'); }} disabled={saveBusy} /></View></View> : null}
        {phase === 'ready' ? <Button label="Choose another source" icon="image" onPress={() => { void pickSource(); }} /> : null}
      </>}
      {!reactVideoCompositionAvailable ? <Text style={styles.hint}>Combining React videos requires the updated native app build.</Text> : null}
    </ScrollView>
    <View pointerEvents="none" style={{ position: 'absolute', left: -2200, top: 0, width: 720, height: 1280 }}><View ref={art} collapsable={false} style={{ width: 720, height: 1280, backgroundColor: 'transparent' }}><Artwork width={720} caption={caption} arrow={arrow} highlight={highlight} attribution={attribution} /></View></View>
    <View pointerEvents="none" style={{ position: 'absolute', left: -3200, top: 0, width: 720, height: 1280 }}><View ref={textCard} collapsable={false}><TextSourceCard source={textSource} /></View></View>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0F15' }, header: { minHeight: 76, paddingRight: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }, iconButton: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#F6F2E9', fontSize: 25, fontWeight: '700', letterSpacing: -.5 }, subtitle: { color: '#AAA8A9', fontSize: 12, marginTop: 3 },
  stageWrap: { alignItems: 'center', marginVertical: 10 }, stage: { backgroundColor: '#080A0E', overflow: 'hidden', borderRadius: 14 },
  panel: { marginVertical: 8, backgroundColor: '#151A23', borderRadius: 18, padding: 14, gap: 11, borderWidth: 1, borderColor: '#272E39' }, sectionLabel: { color: '#C8BEAC', fontSize: 10, fontWeight: '800', letterSpacing: 1.6 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }, rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  button: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, backgroundColor: '#252D3A', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, buttonText: { fontSize: 12, fontWeight: '700', color: '#F3F0E9' }, selected: { backgroundColor: '#EAD5A9' }, disabled: { opacity: .4 },
  body: { color: '#D8D7D6', fontSize: 14, lineHeight: 21 }, hint: { color: '#A7A9B2', fontSize: 11, lineHeight: 17 }, smallLabel: { color: '#C9C9CE', fontSize: 12 }, mono: { color: '#D8D5D0', fontSize: 12, fontVariant: ['tabular-nums'] },
  numberInput: { color: '#FFF', minHeight: 44, minWidth: 62, maxWidth: 84, backgroundColor: '#080D15', borderRadius: 9, paddingHorizontal: 10, fontSize: 14, borderWidth: 1, borderColor: '#394150' }, captionInput: { color: '#FFF', minHeight: 64, maxHeight: 120, borderRadius: 12, backgroundColor: '#080D15', paddingHorizontal: 13, paddingVertical: 12, fontSize: 14, textAlignVertical: 'top' },
  level: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }, levelNumber: { color: '#F3F0E9', fontSize: 12, minWidth: 34, textAlign: 'center', fontVariant: ['tabular-nums'] },
  recordArea: { marginVertical: 12, gap: 8 }, recordTime: { color: '#FF8F86', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] }, captureStatus: { color: '#EAD5A9', fontSize: 12, lineHeight: 18, textAlign: 'center', marginVertical: 8 },
  progress: { padding: 18, gap: 12, alignItems: 'center' }, notice: { padding: 16, borderRadius: 14, backgroundColor: '#352728', gap: 12 }, cameraPlaceholder: { flex: 1, backgroundColor: '#252932', alignItems: 'center', justifyContent: 'center', gap: 12 },
  timelineChip: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#3D4958', minWidth: 82 }, timelineText: { color: '#E9E5DB', fontSize: 11, fontWeight: '700' },
  welcome: { paddingVertical: 38, gap: 20 }, heroIcon: { width: 76, height: 76, borderRadius: 24, backgroundColor: '#1B212C', alignItems: 'center', justifyContent: 'center' }, welcomeTitle: { color: '#F4F0E7', fontSize: 29, lineHeight: 35, fontWeight: '700', letterSpacing: -.7, maxWidth: 300 },
});

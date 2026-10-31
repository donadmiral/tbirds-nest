/** Original recording/reuse and Apple Music sharing use separate rights paths. */
import { ORIGINAL_AUDIO_ENABLED } from '../../../shared/musicAvailability';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator, StyleSheet, AppState, TextInput, Keyboard, Platform, ScrollView, useWindowDimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { useCallContext } from '../../contexts/CallContext';
import { useAuthStore } from '../../stores/authStore';
import { storiesService, StoryAudioDraft, StorySound } from '../../services/storiesService';
import { AppleMusicPicker } from '../AppleMusicSheet';
import { useSafeAreaInsets } from '../SafeArea';
import { MiniSlider } from './storyPanels';
import { OriginalAudioUpload } from '../OriginalAudioUpload';
import { ORIGINAL_AUDIO_PREPARING } from '../../../shared/originalAudioAvailability';
import { soundtrackRead } from '../../../shared/soundtrackPicker';
import { soundFavorites, saveSoundFavorite, originalAudioReady } from '../../services/originalAudioService';
import type { AppleMusicTrack } from '../../../shared/appleMusic';

const MAX_RECORD_SEC = 30;
const SAVED_REFRESH_TIMEOUT_MS = 20000;
type Props = {
  visible: boolean; userId?: string | null; onClose: () => void; current: StoryAudioDraft | null;
  onSelect: (audio: StoryAudioDraft) => void; onRemove: () => void; disabled?: boolean;
  onShareTrack?: (track: AppleMusicTrack) => void;
};
type Tab = 'record' | 'sounds' | 'saved' | 'library';
type ExcerptSound = Pick<StorySound,'id'|'title'|'url'|'duration_sec'|'source'|'max_excerpt_sec'>;
type Excerpt = {sound:ExcerptSound;startSec:number;durationSec:number};
const fmtSec = (seconds: number | null | undefined) => `0:${String(Math.max(0, Math.round(seconds || 0))).padStart(2, '0')}`;
const discardRecording = async (uri: string | null) => { if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}); };

export default function MusicSheet(props: Props) {
  return ORIGINAL_AUDIO_ENABLED ? <EnabledMusicSheet key={props.userId||'signed-out'} {...props} /> : null;
}

function EnabledMusicSheet({ visible, onClose, current, onSelect, onRemove, disabled, onShareTrack, userId }: Props) {
  const { callState } = useCallContext();
  const callActive = useRef(callState !== 'idle'); callActive.current = callState !== 'idle';
  const [tab, setTab] = useState<Tab>('sounds');
  const [recordingAvailable, setRecordingAvailable] = useState(false), [availabilityError, setAvailabilityError] = useState('');
  const [checkingAvailability, setCheckingAvailability] = useState(false), [availabilityAttempt, setAvailabilityAttempt] = useState(0);
  const [query, setQuery] = useState(''), [saved, setSaved] = useState<string[]>([]), [keyboardHeight, setKeyboardHeight] = useState(0);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions(); const insets = useSafeAreaInsets();
  useEffect(() => { const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', event => setKeyboardHeight(event.endCoordinates.height)); const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardHeight(0)); return () => { show.remove(); hide.remove(); }; }, []);
  const [favoritesReady, setFavoritesReady] = useState(false), [favoritesError, setFavoritesError] = useState(''), [favoritesAttempt, setFavoritesAttempt] = useState(0);
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'stopping' | 'selecting'>('idle');
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedSec, setRecordedSec] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [rightsAttested, setRightsAttested] = useState(false);
  const [shareToSounds, setShareToSounds] = useState(false);
  const [rows, setRows] = useState<StorySound[]>([]);
  const [rowsError, setRowsError] = useState('');
  const rowsScope = useRef('');
  const [loadingRows, setLoadingRows] = useState(false);
  const [reload, setReload] = useState(0);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [appleOpen, setAppleOpen] = useState(false);
  const [excerpt,setExcerpt]=useState<Excerpt|null>(null),[dragging,setDragging]=useState(false);
  const editExcerpt=(sound:ExcerptSound)=>{const total=Math.max(1,sound.duration_sec||1),duration=Math.min(30,sound.max_excerpt_sec||30,total,current?.soundId===sound.id?current.durationSec||30:30),start=Math.max(0,Math.min(total-duration,current?.soundId===sound.id?current.startSec||0:0));setExcerpt({sound,startSec:start,durationSec:duration});};
  const session = useRef(0);
  const [visitRevision, setVisitRevision] = useState(0);
  const active = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');
  const [isForeground, setIsForeground] = useState(foreground.current);
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const operation = useRef(false);
  const starting = useRef(false);
  const nativeWork = useRef(0);
  const recRef = useRef<Audio.Recording | null>(null);
  const candidate = useRef<{ uri: string; claimed: boolean } | null>(null);
  const savedRef = useRef<string[]>([]), savedLoaded = useRef(false), saving = useRef(new Map<string, object>());
  const favoriteWrites = useRef(new Set<Promise<void>>());
  const previewRef = useRef<Audio.Sound | null>(null);
  const previewId = useRef<string | null>(null);
  const previewGeneration = useRef(0);
  const previewRightsTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});
  const audioModeQueue = useRef<Promise<void>>(Promise.resolve());

  const setSheetAudioMode = useCallback((mode: Parameters<typeof Audio.setAudioModeAsync>[0]) => {
    const pending = audioModeQueue.current.catch(() => {}).then(async () => {
      // An active call owns the device audio session. The next explicit
      // preview/record action restores this sheet's mode after the call.
      if (!callActive.current) await Audio.setAudioModeAsync(mode);
    });
    audioModeQueue.current = pending;
    return pending;
  }, []);

  const isCurrent = useCallback((mine: number) => {
    const auth = useAuthStore.getState();
    return active.current && mine === session.current && !!userId
      && auth.session?.user.id === userId && auth.profile?.id === userId;
  }, [userId]);
  const canUseAudio = useCallback((mine: number) => isCurrent(mine) && foreground.current && !callActive.current && !disabledRef.current, [isCurrent]);
  const finishNativeWork = useCallback(() => {
    nativeWork.current -= 1;
    // A pending microphone permission, creation or stop must settle before
    // another operation can change the shared native audio session.
    if (nativeWork.current === 0 && !recRef.current) {
      operation.current = false;
      if (active.current) setPhase('idle');
    }
  }, []);

  const stopPreview = useCallback(async () => {
    previewGeneration.current += 1;
    previewId.current = null;
    if (previewRightsTimer.current) clearInterval(previewRightsTimer.current);
    previewRightsTimer.current = null;
    const sound = previewRef.current; previewRef.current = null;
    if (active.current) setPreviewingId(null);
    if (sound) { sound.setOnPlaybackStatusUpdate(null); try { await sound.unloadAsync(); } catch {} }
  }, []);
  const cleanup = useCallback(async () => {
    session.current += 1;
    if (active.current) setVisitRevision(value => value + 1);
    nativeWork.current += 1; operation.current = true;
    const rec = recRef.current; recRef.current = null;
    if (rec) rec.setOnRecordingStatusUpdate(null);
    try {
      await Promise.all([stopPreview(), (async () => {
        if (rec) { try { await rec.stopAndUnloadAsync(); } catch {} await discardRecording(rec.getURI()); }
      })()]);
      try { await setSheetAudioMode({ allowsRecordingIOS: false }); } catch {}
    } finally { finishNativeWork(); }
  }, [finishNativeWork, setSheetAudioMode, stopPreview]);

  useEffect(() => { if (callState !== 'idle') void cleanup(); }, [callState, cleanup]);
  useEffect(() => { if (disabled) void cleanup(); }, [disabled, cleanup]);

  useEffect(() => {
    active.current = visible;
    if (!visible) { void cleanup(); setAppleOpen(false); setExcerpt(null); setDragging(false); }
    const subscription = AppState.addEventListener('change', state => {
      const wasForeground = foreground.current;
      foreground.current = state === 'active'; setIsForeground(foreground.current);
      if (wasForeground && !foreground.current && active.current) {
        if (recRef.current) { session.current += 1; void stopPreview(); void stopRecordingRef.current(); }
        else void cleanup();
      }
    });
    const unsubscribe = useAuthStore.subscribe(auth => {
      if (active.current && (auth.session?.user.id !== userId || auth.profile?.id !== userId)) {
        active.current = false; void cleanup(); closeRef.current();
      }
    });
    return () => { active.current = false; subscription.remove(); unsubscribe(); void cleanup(); };
  }, [visible, userId, cleanup, stopPreview]);

  useEffect(() => () => {
    if (candidate.current && !candidate.current.claimed) void discardRecording(candidate.current.uri);
    candidate.current = null;
  }, []);

  useEffect(() => {
    setRecordingAvailable(false);
    if (!visible || !isForeground || callState !== 'idle') { setCheckingAvailability(false); return; }
    const mine = session.current; let live = true;
    setCheckingAvailability(true); setAvailabilityError('');
    void originalAudioReady().then(ready => {
      if (live && isCurrent(mine)) { setRecordingAvailable(ready); setAvailabilityError(ready ? '' : ORIGINAL_AUDIO_PREPARING); }
    }).catch(failure => {
      if (live && isCurrent(mine)) setAvailabilityError(failure instanceof Error ? failure.message : 'Audio availability could not be checked. Retry.');
    }).finally(() => { if (live && isCurrent(mine)) setCheckingAvailability(false); });
    return () => { live = false; };
  }, [visible, isForeground, callState, userId, availabilityAttempt, visitRevision, isCurrent]);

  useEffect(() => {
    savedLoaded.current = false; setFavoritesReady(false); saving.current.clear(); setSavingIds([]);
    if (!visible || !isForeground || callState !== 'idle') return;
    const mine = session.current; let live = true;
    setFavoritesError('');
    void Promise.allSettled([...favoriteWrites.current]).then(() => {
      if (!live || !isCurrent(mine)) return null;
      return soundFavorites(userId || undefined);
    }).then(ids => {
      if (!ids) return;
      if (!live || !isCurrent(mine)) return;
      savedRef.current = ids; savedLoaded.current = true; setSaved(ids); setFavoritesReady(true);
    }).catch(() => { if (live && isCurrent(mine)) setFavoritesError('Saved sounds could not load. Retry to check your saved selection.'); });
    return () => { live = false; };
  }, [visible, isForeground, callState, userId, favoritesAttempt, visitRevision, isCurrent]);

  const toggleSaved = async (id: string) => {
    const mine = session.current;
    if (!canUseAudio(mine) || !savedLoaded.current || saving.current.has(id)) return;
    const token = {}, next = !savedRef.current.includes(id);
    saving.current.set(id, token); setSavingIds([...saving.current.keys()]); setFavoritesError('');
    const work = saveSoundFavorite(id, next, userId || undefined); favoriteWrites.current.add(work);
    try {
      await work;
      if (!isCurrent(mine) || saving.current.get(id) !== token) return;
      savedRef.current = next ? [...savedRef.current.filter(item => item !== id), id] : savedRef.current.filter(item => item !== id);
      setSaved(savedRef.current);
    } catch {
      if (isCurrent(mine) && saving.current.get(id) === token) {
        // The server may have committed before a response was lost. A fresh
        // read establishes the next toggle instead of replaying stale intent.
        savedLoaded.current = false; setFavoritesReady(false);
        setFavoritesError('The saved selection could not be confirmed. Retry to check its status.');
      }
    } finally {
      favoriteWrites.current.delete(work);
      if (saving.current.get(id) === token) { saving.current.delete(id); if (isCurrent(mine)) setSavingIds([...saving.current.keys()]); }
    }
  };

  const savedChoices = tab === 'saved' && favoritesReady ? saved.join(',') : null;
  useEffect(() => {
    if (!visible || !isForeground || callState !== 'idle' || tab === 'record') return;
    if (tab === 'saved' && savedChoices === null) { setRows([]); setLoadingRows(false); return; }
    const mine = session.current;
    let cancelled = false; setLoadingRows(true); setRowsError('');
    const scope = `${userId}:${tab}`;
    if (rowsScope.current !== scope) { rowsScope.current = scope; setRows([]); }
    const source = tab === 'saved' ? (async () => {
      const ids = savedChoices ? savedChoices.split(',') : [], results: PromiseSettledResult<StorySound>[] = [];
      const deadline = Date.now() + SAVED_REFRESH_TIMEOUT_MS;
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (next < ids.length && Date.now() < deadline && !cancelled && isCurrent(mine)) {
          const index = next++;
          try { results[index] = { status: 'fulfilled', value: await soundtrackRead(storiesService.getStorySound(ids[index]), Math.max(1, deadline - Date.now())) }; }
          catch (reason) { results[index] = { status: 'rejected', reason }; }
        }
      }));
      const checked = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
      if (ids.length && !checked.length) throw new Error('Saved sounds could not be checked. Retry.');
      if ((checked.length < ids.length) && !cancelled && isCurrent(mine)) setRowsError('Some saved sounds are unavailable or could not be checked. Retry to refresh them.');
      return checked;
    })() : tab === 'library' ? storiesService.listStorySounds('library') : Promise.all([storiesService.listStorySounds('original'), storiesService.listStorySounds('library')]).then(lists => [...lists[0], ...lists[1]]);
    void source.then(list => {
      if (!cancelled && isCurrent(mine)) setRows(list);
    }).catch(e => { if (!cancelled && isCurrent(mine)) setRowsError(e instanceof Error ? e.message : 'Could not load sounds.'); })
      .finally(() => { if (!cancelled && isCurrent(mine)) setLoadingRows(false); });
    return () => { cancelled = true; };
  }, [visible, isForeground, callState, userId, tab, reload, savedChoices, visitRevision, isCurrent]);

  const stopRecording = useCallback(async () => {
    const rec = recRef.current;
    if (!rec) { if (starting.current) await cleanup(); return; }
    recRef.current = null; rec.setOnRecordingStatusUpdate(null);
    const mine = session.current;
    nativeWork.current += 1;
    setPhase('stopping');
    let uri: string | null = null, retained = false;
    try {
      const status = await rec.stopAndUnloadAsync();
      uri = rec.getURI();
      if (!isCurrent(mine)) return;
      const seconds = Math.min(MAX_RECORD_SEC, status.durationMillis / 1000);
      if (uri && Number.isFinite(seconds) && seconds >= 1) {
        const previous = candidate.current;
        candidate.current = { uri, claimed: false }; retained = true;
        if (previous && !previous.claimed && previous.uri !== uri) void discardRecording(previous.uri);
        setRecordedUri(uri); setRecordedSec(seconds); setRightsAttested(false); setShareToSounds(false);
      }
      else setError('Record at least one second before using the voiceover.');
    } catch { if (isCurrent(mine)) setError('Could not save that recording. Please record it again.'); }
    finally {
      if (!retained) await discardRecording(uri || rec.getURI());
      try { await setSheetAudioMode({ allowsRecordingIOS: false }); } catch {}
      finishNativeWork();
    }
  }, [cleanup, finishNativeWork, isCurrent, setSheetAudioMode]);
  stopRecordingRef.current = stopRecording;

  const startRecording = async () => {
    if (operation.current || !recordingAvailable || !canUseAudio(session.current)) return;
    operation.current = true; starting.current = true; setPhase('starting'); setError('');
    nativeWork.current += 1;
    const mine = session.current;
    try {
      await stopPreview();
      if (!canUseAudio(mine)) return;
      const permission = await Audio.requestPermissionsAsync();
      if (!canUseAudio(mine)) return;
      if (!permission.granted) throw new Error('Enable microphone access in your phone settings to record a voiceover.');
      await setSheetAudioMode({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      if (!canUseAudio(mine)) { await setSheetAudioMode({ allowsRecordingIOS: false }); return; }
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      if (!canUseAudio(mine)) {
        try { await recording.stopAndUnloadAsync(); } catch {}
        await discardRecording(recording.getURI());
        await setSheetAudioMode({ allowsRecordingIOS: false }); return;
      }
      recRef.current = recording; setElapsed(0); setPhase('recording');
      recording.setProgressUpdateInterval(200);
      recording.setOnRecordingStatusUpdate(status => {
        if (!isCurrent(mine) || recRef.current !== recording) return;
        setElapsed(Math.min(MAX_RECORD_SEC, status.durationMillis / 1000));
        if (status.durationMillis >= MAX_RECORD_SEC * 1000 || status.isDoneRecording) void stopRecordingRef.current();
      });
    } catch (e) {
      if (isCurrent(mine)) setError(e instanceof Error ? e.message : 'Could not start the microphone.');
      if (mine === session.current) await cleanup();
    } finally {
      starting.current = false;
      finishNativeWork();
    }
  };

  const previewUri = async (id: string, uri: string, clip?:{startSec:number;durationSec:number}) => {
    const visit = session.current;
    if (operation.current || phase !== 'idle' || !canUseAudio(visit)) return;
    const stopping = previewId.current === id;
    const stopped = stopPreview(), mine = previewGeneration.current;
    const usable = () => mine === previewGeneration.current && canUseAudio(visit);
    if (stopping) { await stopped; return; }
    previewId.current = id; setPreviewingId(id); setError('');
    await stopped;
    if (!usable()) return;
    try {
      await setSheetAudioMode({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      if (!usable()) return;
      if (id === 'voiceover' && (uri !== recordedUri || !uri.startsWith('file://'))) throw new Error('Record this voiceover again.');
      const source = id === 'voiceover' ? { url: uri, duration_sec: recordedSec || 30 } : await storiesService.getStorySound(id);
      const total = source.duration_sec || 0, maximum = Math.min(30, 'max_excerpt_sec' in source ? source.max_excerpt_sec ?? 30 : 30);
      const start = clip?.startSec ?? 0, duration = clip?.durationSec ?? Math.min(maximum, total);
      const validRange = (length: number, limit: number) => Number.isFinite(start) && Number.isFinite(duration)
        && start >= 0 && duration >= 1 && duration <= limit && start + duration <= length;
      if (!validRange(total, maximum)) throw new Error('The selected excerpt is unavailable.');
      if (!usable()) return;
      const { sound } = await Audio.Sound.createAsync({ uri: source.url }, { shouldPlay: false, isLooping: false, positionMillis: start * 1000, progressUpdateIntervalMillis: 100 });
      if (!usable()) { await sound.unloadAsync(); return; }
      previewRef.current = sound;
      sound.setOnPlaybackStatusUpdate(status => {
        if (!usable() || previewRef.current !== sound) return;
        if (!status.isLoaded && status.error) { setError('This preview stopped playing. Retry.'); void stopPreview(); }
        else if (status.isLoaded && (status.didJustFinish || status.positionMillis >= (start + duration) * 1000)) void stopPreview();
      });
      await sound.playAsync();
      if (!usable()) { if (previewRef.current === sound) await stopPreview(); else await sound.unloadAsync(); return; }
      if (id !== 'voiceover') {
        let checking = false;
        previewRightsTimer.current = setInterval(() => {
          if (checking || !usable()) return;
          checking = true;
          void storiesService.getStorySound(id).then(track => {
            if (!validRange(track.duration_sec || 0, Math.min(30, track.max_excerpt_sec ?? 30))) throw new Error('Excerpt unavailable');
          }).catch(() => {
            if (usable() && previewRef.current === sound) { setError('This audio is no longer available. Choose another sound.'); void stopPreview(); }
          }).finally(() => { checking = false; });
        }, 10000);
      }
    } catch (failure) { if (usable()) { setError(failure instanceof Error ? failure.message : 'Could not play this sound. Try again.'); void stopPreview(); } }
  };
  const selectSound = async (id: string) => {
    if (operation.current || phase !== 'idle' || !canUseAudio(session.current)) return;
    operation.current = true; setPhase('selecting'); setError('');
    const mine = session.current;
    try {
      await stopPreview();
      if (!canUseAudio(mine)) return;
      const sound = await storiesService.getStorySound(id);
      if (!canUseAudio(mine)) return;
      editExcerpt(sound);
    } catch (e) { if (isCurrent(mine)) setError(e instanceof Error ? e.message : 'Sound is unavailable. Please retry.'); }
    finally { if (isCurrent(mine)) { operation.current = false; setPhase('idle'); } }
  };
  const commitExcerpt=async()=>{
    if(!excerpt||operation.current||!canUseAudio(session.current))return;
    operation.current=true;setPhase('selecting');setError('');const mine=session.current,choice=excerpt;
    try{await stopPreview();if(!canUseAudio(mine))return;const sound=await storiesService.getStorySound(choice.sound.id);if(!canUseAudio(mine))return;
      if(!Number.isFinite(choice.startSec)||!Number.isFinite(choice.durationSec)||choice.startSec<0||choice.durationSec<1||choice.durationSec>Math.min(30,sound.max_excerpt_sec??30)||choice.startSec+choice.durationSec>(sound.duration_sec||0))throw new Error('This excerpt is no longer available. Choose another section.');
      onSelect({kind:'sound',soundId:sound.id,title:sound.title,startSec:choice.startSec,durationSec:choice.durationSec,source:sound.source});
    }catch(failure){if(isCurrent(mine))setError(failure instanceof Error?failure.message:'This excerpt could not be selected. Retry.');}
    finally{if(isCurrent(mine)){operation.current=false;setPhase('idle');}}
  };
  const useVoiceover = () => {
    if (!recordedUri || !rightsAttested || operation.current || phase !== 'idle' || !canUseAudio(session.current)) return;
    void stopPreview();
    if (candidate.current?.uri === recordedUri) candidate.current.claimed = true;
    onSelect({ kind: 'voiceover', localUri: recordedUri, durationSec: recordedSec, title: 'Voiceover', source: 'voiceover', addToSounds: shareToSounds, rightsAttested: true });
  };
  const closeSheet = () => { active.current = false; void cleanup(); onClose(); };
  const busy = phase !== 'idle';
  const shownRows = rows.filter(row => (tab !== 'saved' || saved.includes(row.id)) && [row.title, row.artist || ''].join(' ').toLowerCase().includes(query.toLowerCase()));
  const maxSheetHeight = Math.max(120, windowHeight - (Platform.OS === 'ios' ? keyboardHeight : 0) - insets.top - 16);
  return <>
    <Modal visible={visible} transparent animationType="slide" onRequestClose={closeSheet}>
      <View style={ms.overlay}>
        <TouchableOpacity accessibilityLabel="Close sound picker" style={{ flex: 1 }} onPress={closeSheet} />
        <View style={[ms.sheet, { maxHeight: maxSheetHeight, marginBottom: Platform.OS === 'ios' ? keyboardHeight : 0, paddingBottom: keyboardHeight ? 12 : Math.max(insets.bottom, 22) }, appleOpen && { backgroundColor: '#FBF9F5' }]} accessibilityViewIsModal>
          <View style={ms.handle} /><View style={ms.header}><TouchableOpacity accessibilityRole="button" accessibilityLabel={appleOpen ? "Back to music" : "Close sound picker"} style={ms.headerButton} onPress={() => { Keyboard.dismiss(); if (appleOpen) setAppleOpen(false); else closeSheet(); }}><Feather name={appleOpen ? "arrow-left" : "x"} size={23} color={appleOpen ? "#0B1E3D" : "#F8F4EC"} /></TouchableOpacity><Text style={[ms.title, appleOpen && { color: '#0B1E3D' }]}>{appleOpen ? 'Share song link' : 'Music'}</Text><View style={ms.headerButton} /></View>
          {appleOpen ? <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }}><AppleMusicPicker onSelect={track => { setAppleOpen(false); onShareTrack?.(track); }} /></ScrollView> : <ScrollView scrollEnabled={!dragging} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={{ flexShrink: 1 }}>
          {current ? <View style={ms.currentRow}><Feather name="music" size={15} color="#FFF" /><Text style={ms.currentTxt} numberOfLines={1}>{current.title || 'Attached sound'}</Text>{current.soundId?<TouchableOpacity accessibilityRole="button" disabled={disabled||busy} style={{minHeight:44,justifyContent:'center'}} onPress={()=>void selectSound(current.soundId!)}><Text style={ms.secondaryTxt}>Edit</Text></TouchableOpacity>:null}<TouchableOpacity accessibilityRole="button" disabled={disabled || busy} style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => { if (canUseAudio(session.current) && !operation.current) { void stopPreview(); onRemove(); } }}><Text style={ms.removeTxt}>Remove</Text></TouchableOpacity></View> : null}
          {excerpt?<View style={{gap:12,padding:16,borderRadius:16,backgroundColor:'#FFFFFF0C',marginBottom:16}}>
            <Text style={ms.soundTitle}>Choose your excerpt</Text><Text style={ms.soundMeta}>{excerpt.sound.title} · {excerpt.startSec.toFixed(1)}s – {(excerpt.startSec+excerpt.durationSec).toFixed(1)}s</Text>
            <Text style={ms.soundMeta}>Start</Text><MiniSlider label="Music excerpt start" width={Math.max(150,Math.min(420,windowWidth-72))} value={excerpt.startSec*10} min={0} max={Math.max(0,((excerpt.sound.duration_sec||0)-excerpt.durationSec)*10)} onDragStateChange={setDragging} onChange={value=>{void stopPreview();setExcerpt(previous=>previous?{...previous,startSec:value/10}:null);}}/>
            <Text style={ms.soundMeta}>Length · {excerpt.durationSec.toFixed(1)} seconds</Text><MiniSlider label="Music excerpt length" width={Math.max(150,Math.min(420,windowWidth-72))} value={excerpt.durationSec*10} min={10} max={Math.max(10,Math.min(30,excerpt.sound.max_excerpt_sec||30,(excerpt.sound.duration_sec||1)-excerpt.startSec)*10)} onDragStateChange={setDragging} onChange={value=>{void stopPreview();setExcerpt(previous=>previous?{...previous,durationSec:value/10}:null);}}/>
            <View style={{flexDirection:'row',gap:10,flexWrap:'wrap'}}><TouchableOpacity accessibilityRole="button" disabled={busy||disabled} style={[ms.secondaryBtn,{minHeight:44}]} onPress={()=>void previewUri(excerpt.sound.id,excerpt.sound.url,excerpt)}><Text style={ms.secondaryTxt}>{previewingId===excerpt.sound.id?'Stop preview':'Preview excerpt'}</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" disabled={busy||disabled||dragging} style={[ms.primaryBtn,{minHeight:44}]} onPress={()=>void commitExcerpt()}><Text style={ms.primaryTxt}>Use excerpt</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" disabled={busy} style={[ms.secondaryBtn,{minHeight:44}]} onPress={()=>{void stopPreview();setExcerpt(null);}}><Text style={ms.secondaryTxt}>Cancel</Text></TouchableOpacity></View>
          </View>:null}
          {onShareTrack ? <TouchableOpacity accessibilityRole="button" style={[ms.secondaryBtn, { marginBottom: 12, justifyContent: 'center', minHeight: 44 }]} disabled={busy || disabled} onPress={() => { void stopPreview(); setAppleOpen(true); }}><Text style={ms.secondaryTxt}>Share a song link</Text></TouchableOpacity> : null}
          <View style={ms.search}><Feather name="search" size={18} color="#A8ACAE" /><TextInput accessibilityLabel="Search story sounds" value={query} onChangeText={setQuery} placeholder="Search music and original audio" placeholderTextColor="#A8ACAE" keyboardAppearance="dark" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => Keyboard.dismiss()} style={ms.searchInput} /></View>
          <View style={ms.tabsRow}>{([['sounds', 'For you'], ['saved', 'Saved'], ['library', 'Browse']] as [Tab, string][]).map(([key, label]) => <TouchableOpacity accessibilityRole="tab" accessibilityState={{ selected: tab === key, disabled: busy }} disabled={busy} key={key} style={[ms.tabBtn, { minHeight: 44, justifyContent: 'center' }, tab === key && ms.tabBtnOn]} onPress={() => { void stopPreview(); setError(''); setTab(key); }}><Text style={[ms.tabTxt, tab === key && ms.tabTxtOn]}>{label}</Text></TouchableOpacity>)}</View>
          {error ? <Text accessibilityRole="alert" style={[ms.recHint, { color: '#FFB4B4', marginBottom: 10 }]}>{error}</Text> : null}
          {rowsError && tab !== 'record' ? <View style={{ gap: 8, marginBottom: 12 }}><Text accessibilityRole="alert" style={ms.recHint}>{rowsError}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry sound list" style={[ms.secondaryBtn, { minHeight: 44 }]} disabled={disabled || busy || loadingRows} onPress={() => setReload(value => value + 1)}><Text style={ms.secondaryTxt}>Retry</Text></TouchableOpacity></View> : null}
          {favoritesError ? <View style={{ gap: 8, marginBottom: 12 }}><Text accessibilityRole="alert" style={ms.recHint}>{favoritesError}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry saved sounds" style={[ms.secondaryBtn, { minHeight: 44 }]} disabled={disabled || busy || savingIds.length > 0} onPress={() => setFavoritesAttempt(value => value + 1)}><Text style={ms.secondaryTxt}>Retry saved sounds</Text></TouchableOpacity></View> : null}
          {userId&&tab!=='record'?<OriginalAudioUpload owner={userId} disabled={disabled||busy} use="story" onAdded={track=>{editExcerpt({...track,source:'original'});setReload(value=>value+1);}}/>:null}
          {tab === 'record' ? <View style={ms.recordPane}>
            {availabilityError ? <><Text accessibilityRole="alert" style={ms.recHint}>{availabilityError}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry audio availability" style={[ms.secondaryBtn, { minHeight: 44 }]} disabled={disabled || busy || checkingAvailability} onPress={() => setAvailabilityAttempt(value => value + 1)}><Text style={ms.secondaryTxt}>Retry audio availability</Text></TouchableOpacity></> : null}
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={phase === 'recording' ? 'Stop recording' : 'Record voiceover'} accessibilityState={{ busy: checkingAvailability || phase === 'starting' || phase === 'stopping' }} style={[ms.recBtn, phase === 'recording' && ms.recBtnOn]} disabled={disabled || !isForeground || callState !== 'idle' || (phase !== 'recording' && (!recordingAvailable || phase !== 'idle'))} onPress={() => { if (phase === 'recording') void stopRecording(); else void startRecording(); }}>{checkingAvailability || phase === 'starting' || phase === 'stopping' ? <ActivityIndicator color="#FFF" /> : <Feather name={phase === 'recording' ? 'square' : 'mic'} size={26} color={phase === 'recording' ? '#020408' : '#FFF'} />}</TouchableOpacity>
            <Text style={ms.recHint}>{phase === 'recording' ? `Recording ${fmtSec(elapsed)} / 0:30` : phase === 'starting' ? 'Starting microphone…' : phase === 'stopping' ? 'Saving recording…' : recordedUri ? `Voiceover ready · ${fmtSec(recordedSec)}` : 'Record your own voice or original audio, up to 30 seconds.'}</Text>
            {recordedUri && !busy ? <View style={{ gap: 12, width: '100%' }}>
              <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: rightsAttested }} style={[ms.shareRow, { minHeight: 44 }]} onPress={() => setRightsAttested(value => !value)}><View style={[ms.checkbox, rightsAttested && ms.checkboxOn]}>{rightsAttested ? <Feather name="check" size={12} color="#020408" /> : null}</View><Text style={[ms.shareTxt, { flex: 1 }]}>I own this recording and have permission from everyone featured to publish it.</Text></TouchableOpacity>
              <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: shareToSounds }} style={[ms.shareRow, { minHeight: 44 }]} onPress={() => setShareToSounds(value => !value)}><View style={[ms.checkbox, shareToSounds && ms.checkboxOn]}>{shareToSounds ? <Feather name="check" size={12} color="#020408" /> : null}</View><Text style={[ms.shareTxt, { flex: 1 }]}>Also make this original sound public and allow others to reuse it in Platinum stories.</Text></TouchableOpacity>
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10 }}><TouchableOpacity accessibilityRole="button" style={[ms.secondaryBtn, { minHeight: 44 }]} onPress={() => { void previewUri('voiceover', recordedUri); }}><Text style={ms.secondaryTxt}>{previewingId === 'voiceover' ? 'Stop preview' : 'Preview'}</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" style={[ms.primaryBtn, { minHeight: 44, opacity: rightsAttested ? 1 : 0.5 }]} onPress={useVoiceover} disabled={disabled || !rightsAttested}><Text style={ms.primaryTxt}>Use voiceover</Text></TouchableOpacity></View>
            </View> : null}
          </View> : <View style={ms.listPane}>
            {loadingRows && shownRows.length === 0 ? <ActivityIndicator color="#FFF" style={{ marginTop: 26 }} /> : shownRows.length === 0 ? <><Text style={ms.emptyTxt}>{error || rowsError ? 'Your sound selection is unchanged.' : query ? 'No sounds match your search.' : tab === 'saved' ? 'Save a sound to find it here.' : tab === 'sounds' ? 'No reusable original sounds yet. Record and share your own.' : 'No licensed soundtracks are available yet. You can record original audio or share an Apple Music song link.'}</Text></> : <View>{shownRows.map(item => <View key={item.id} style={ms.soundRow}><TouchableOpacity accessibilityRole="button" accessibilityLabel={`Preview ${item.title}`} disabled={disabled || busy} style={[ms.playBtn, { width: 44, height: 44 }]} onPress={() => { void previewUri(item.id, item.url); }}><Feather name={previewingId === item.id ? 'pause' : 'play'} size={16} color="#FFF" /></TouchableOpacity><View style={{ flex: 1, minWidth: 0 }}><Text style={ms.soundTitle} numberOfLines={1}>{item.title}</Text><Text style={ms.soundMeta}>{[item.artist, fmtSec(item.duration_sec)].filter(Boolean).join(' · ')}</Text></View><TouchableOpacity accessibilityRole="button" accessibilityLabel={`${saved.includes(item.id) ? 'Unsave' : 'Save'} ${item.title}`} accessibilityState={{ selected: saved.includes(item.id), busy: savingIds.includes(item.id), disabled: disabled || busy || !favoritesReady || savingIds.includes(item.id) }} disabled={disabled || busy || !favoritesReady || savingIds.includes(item.id)} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }} onPress={() => void toggleSaved(item.id)}>{savingIds.includes(item.id) ? <ActivityIndicator color="#FFF" /> : <Feather name="bookmark" size={18} color={saved.includes(item.id) ? '#EEDCC0' : '#8F9699'} />}</TouchableOpacity><TouchableOpacity accessibilityRole="button" accessibilityLabel={`Use ${item.title}`} style={[ms.useBtn, { minHeight: 44, justifyContent: 'center' }]} disabled={disabled || busy} onPress={() => { void selectSound(item.id); }}><Text style={ms.useBtnTxt}>Use</Text></TouchableOpacity></View>)}</View>}
          </View>}
          {loadingRows && shownRows.length > 0 && tab !== 'record' ? <ActivityIndicator accessibilityLabel="Refreshing sounds" color="#FFF" /> : null}
          <TouchableOpacity accessibilityRole="button" style={[ms.secondaryBtn, { minHeight: 44, justifyContent: 'center', marginTop: 12 }]} disabled={busy || disabled} onPress={() => { Keyboard.dismiss(); void stopPreview(); setTab(tab === 'record' ? 'sounds' : 'record'); }}><Feather name={tab === 'record' ? 'music' : 'mic'} size={17} color="#F8F4EC" /><Text style={ms.secondaryTxt}>{tab === 'record' ? 'Browse sounds' : 'Record original audio'}</Text></TouchableOpacity>
          </ScrollView>}
        </View>
      </View>
    </Modal>
  </>;
}

const ms = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: '#1C2023', borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingTop: 10, paddingBottom: 34, paddingHorizontal: 18 },
  handle: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.24)', marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, color: '#F8F4EC', fontSize: 20, fontWeight: '600', textAlign: 'center' },
  search: { minHeight: 46, borderRadius: 25, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, backgroundColor: '#FFFFFF0C', marginBottom: 14 },
  searchInput: { flex: 1, minHeight: 46, color: '#F8F4EC', fontSize: 14 },
  currentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.09)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  currentTxt: { flex: 1, color: '#FFFFFF', fontSize: 13.5, fontWeight: '600' },
  removeTxt: { color: '#FF8A8A', fontSize: 13, fontWeight: '700' },
  tabsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tabBtn: { flex: 1, borderRadius: 999, paddingVertical: 8, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.09)' },
  tabBtnOn: { backgroundColor: '#EEDCC0' },
  tabTxt: { color: 'rgba(255,255,255,0.75)', fontSize: 13.5, fontWeight: '700' },
  tabTxtOn: { color: '#020408' },
  recordPane: { alignItems: 'center', paddingVertical: 14, gap: 14, minHeight: 190 },
  recBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  recBtnOn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  recHint: { color: 'rgba(255,255,255,0.7)', fontSize: 13.5, textAlign: 'center' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.12)' },
  secondaryTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  primaryBtn: { borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#EEDCC0' },
  primaryTxt: { color: '#020408', fontSize: 14, fontWeight: '700' },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  shareTxt: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5 },
  listPane: { minHeight: 0, flexShrink: 1 },
  soundRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  playBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  soundTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  soundMeta: { color: '#A8ACAE', fontSize: 12, marginTop: 2 },
  useBtn: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7, backgroundColor: '#EEDCC0' },
  useBtnTxt: { color: '#020408', fontSize: 13, fontWeight: '700' },
  emptyTxt: { color: '#A8ACAE', fontSize: 13.5, textAlign: 'center', marginTop: 30, paddingHorizontal: 20 },
});

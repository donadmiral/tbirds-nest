/** Original recording/reuse and Apple Music sharing use separate rights paths. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, FlatList, ActivityIndicator, StyleSheet, AppState } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { useCallContext } from '../../contexts/CallContext';
import { storiesService, StoryAudioDraft, StorySound } from '../../services/storiesService';
import AppleMusicSheet from '../AppleMusicSheet';
import type { AppleMusicTrack } from '../../../shared/appleMusic';

const MAX_RECORD_SEC = 30;
type Props = {
  visible: boolean; onClose: () => void; current: StoryAudioDraft | null;
  onSelect: (audio: StoryAudioDraft) => void; onRemove: () => void; disabled?: boolean;
  onShareTrack?: (track: AppleMusicTrack) => void;
};
type Tab = 'record' | 'sounds' | 'library';
const fmtSec = (seconds: number | null | undefined) => `0:${String(Math.max(0, Math.round(seconds || 0))).padStart(2, '0')}`;

export default function MusicSheet({ visible, onClose, current, onSelect, onRemove, disabled, onShareTrack }: Props) {
  const { callState } = useCallContext();
  const callActive = useRef(callState !== 'idle'); callActive.current = callState !== 'idle';
  const [tab, setTab] = useState<Tab>('record');
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'stopping' | 'selecting'>('idle');
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedSec, setRecordedSec] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [rightsAttested, setRightsAttested] = useState(false);
  const [shareToSounds, setShareToSounds] = useState(false);
  const [rows, setRows] = useState<StorySound[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [reload, setReload] = useState(0);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [appleOpen, setAppleOpen] = useState(false);
  const session = useRef(0);
  const active = useRef(false);
  const operation = useRef(false);
  const starting = useRef(false);
  const recRef = useRef<Audio.Recording | null>(null);
  const previewRef = useRef<Audio.Sound | null>(null);
  const previewGeneration = useRef(0);
  const stopRecordingRef = useRef<() => Promise<void>>(async () => {});

  const stopPreview = useCallback(async () => {
    previewGeneration.current += 1;
    const sound = previewRef.current; previewRef.current = null;
    if (active.current) setPreviewingId(null);
    if (sound) { try { await sound.unloadAsync(); } catch {} }
  }, []);
  const cleanup = useCallback(async () => {
    session.current += 1;
    await stopPreview();
    const rec = recRef.current; recRef.current = null;
    if (rec) { rec.setOnRecordingStatusUpdate(null); try { await rec.stopAndUnloadAsync(); } catch {} }
    try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {}
    // A pending permission/start request must settle before another may start.
    operation.current = starting.current;
    if (active.current) setPhase('idle');
  }, [stopPreview]);

  useEffect(() => { if (callState !== 'idle') void cleanup(); }, [callState, cleanup]);

  useEffect(() => {
    active.current = visible;
    if (!visible) { void cleanup(); setAppleOpen(false); }
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active' && active.current) { void stopRecordingRef.current(); void stopPreview(); }
    });
    return () => { active.current = false; subscription.remove(); void cleanup(); };
  }, [visible, cleanup]);

  useEffect(() => {
    if (!visible || tab === 'record') return;
    let cancelled = false; setLoadingRows(true); setError(''); setRows([]);
    storiesService.listStorySounds(tab === 'sounds' ? 'original' : 'library').then(list => {
      if (!cancelled) setRows(list);
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load sounds.'); })
      .finally(() => { if (!cancelled) setLoadingRows(false); });
    return () => { cancelled = true; };
  }, [visible, tab, reload]);

  const stopRecording = useCallback(async () => {
    const rec = recRef.current;
    if (!rec) { if (starting.current) await cleanup(); return; }
    recRef.current = null; rec.setOnRecordingStatusUpdate(null);
    const mine = session.current;
    setPhase('stopping');
    try {
      const status = await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      if (!active.current || mine !== session.current) return;
      const seconds = Math.min(MAX_RECORD_SEC, status.durationMillis / 1000);
      if (uri && seconds >= 1) { setRecordedUri(uri); setRecordedSec(seconds); }
      else setError('Record at least one second before using the voiceover.');
    } catch { if (active.current && mine === session.current) setError('Could not save that recording. Please record it again.'); }
    finally { if (active.current && mine === session.current) { operation.current = false; setPhase('idle'); } }
  }, [cleanup]);
  stopRecordingRef.current = stopRecording;

  const startRecording = async () => {
    if (operation.current || disabled || callActive.current) return;
    operation.current = true; starting.current = true; setPhase('starting'); setError('');
    const mine = session.current;
    try {
      await stopPreview();
      const permission = await Audio.requestPermissionsAsync();
      if (!active.current || mine !== session.current) return;
      if (!permission.granted) throw new Error('Enable microphone access in your phone settings to record a voiceover.');
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      if (!active.current || mine !== session.current) { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); return; }
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      if (!active.current || mine !== session.current) { await recording.stopAndUnloadAsync(); await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); return; }
      recRef.current = recording; setRecordedUri(null); setRecordedSec(0); setRightsAttested(false); setShareToSounds(false); setElapsed(0); setPhase('recording');
      recording.setProgressUpdateInterval(200);
      recording.setOnRecordingStatusUpdate(status => {
        if (!active.current || mine !== session.current) return;
        setElapsed(Math.min(MAX_RECORD_SEC, status.durationMillis / 1000));
        if (status.durationMillis >= MAX_RECORD_SEC * 1000 || status.isDoneRecording) void stopRecordingRef.current();
      });
    } catch (e) {
      if (active.current && mine === session.current) setError(e instanceof Error ? e.message : 'Could not start the microphone.');
      if (mine === session.current) await cleanup();
    } finally {
      starting.current = false;
      if (!recRef.current) { operation.current = false; if (active.current) setPhase('idle'); }
    }
  };

  const previewUri = async (id: string, uri: string) => {
    if (phase !== 'idle' || disabled || callActive.current) return;
    const stopping = previewingId === id;
    await stopPreview();
    if (stopping) return;
    const mine = previewGeneration.current;
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const source = id === 'voiceover' ? { url: uri, duration_sec: recordedSec || 30 } : await storiesService.getStorySound(id);
      const playable = source.url;
      if (!active.current || mine !== previewGeneration.current || callActive.current) return;
      const { sound } = await Audio.Sound.createAsync({ uri: playable }, { shouldPlay: false, progressUpdateIntervalMillis: 100 });
      if (!active.current || mine !== previewGeneration.current || callActive.current) { await sound.unloadAsync(); return; }
      previewRef.current = sound; setPreviewingId(id);
      sound.setOnPlaybackStatusUpdate(status => { if (status.isLoaded && (status.didJustFinish || status.positionMillis >= (source.duration_sec || 30) * 1000)) void stopPreview(); });
      await sound.playAsync();
      if (callActive.current) await stopPreview();
    } catch { if (active.current && mine === previewGeneration.current) { setError('Could not play this sound. Try again.'); void stopPreview(); } }
  };
  const selectSound = async (id: string) => {
    if (operation.current || disabled || phase !== 'idle') return;
    operation.current = true; setPhase('selecting'); setError('');
    const mine = session.current;
    try {
      await stopPreview();
      const sound = await storiesService.getStorySound(id);
      if (!active.current || mine !== session.current) return;
      onSelect({ kind: 'sound', soundId: sound.id, title: sound.title, durationSec: sound.duration_sec, source: sound.source });
    } catch (e) { if (active.current && mine === session.current) setError(e instanceof Error ? e.message : 'Sound is unavailable. Please retry.'); }
    finally { if (active.current && mine === session.current) { operation.current = false; setPhase('idle'); } }
  };
  const useVoiceover = () => {
    if (!recordedUri || !rightsAttested || disabled || phase !== 'idle') return;
    void stopPreview();
    onSelect({ kind: 'voiceover', localUri: recordedUri, durationSec: recordedSec, title: 'Voiceover', source: 'voiceover', addToSounds: shareToSounds, rightsAttested: true });
  };
  const busy = phase !== 'idle';
  return <>
    <Modal visible={visible && !appleOpen} transparent animationType="slide" onRequestClose={onClose}>
      <View style={ms.overlay}>
        <TouchableOpacity accessibilityLabel="Close sound picker" style={{ flex: 1 }} onPress={onClose} />
        <View style={ms.sheet} accessibilityViewIsModal>
          <View style={ms.handle} /><Text style={ms.title}>Sound</Text>
          {current ? <View style={ms.currentRow}><Feather name="music" size={15} color="#FFF" /><Text style={ms.currentTxt} numberOfLines={1}>{current.title || 'Attached sound'}</Text><TouchableOpacity accessibilityRole="button" disabled={disabled} style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => { void stopPreview(); onRemove(); }}><Text style={ms.removeTxt}>Remove</Text></TouchableOpacity></View> : null}
          {onShareTrack ? <TouchableOpacity accessibilityRole="button" style={[ms.secondaryBtn, { marginBottom: 12, justifyContent: 'center', minHeight: 44 }]} disabled={busy || disabled} onPress={() => { void stopPreview(); setAppleOpen(true); }}><Text style={ms.secondaryTxt}>Share an Apple Music song</Text></TouchableOpacity> : null}
          <View style={ms.tabsRow}>{([['record', 'Record'], ['sounds', 'Sounds'], ['library', 'Licensed']] as [Tab, string][]).map(([key, label]) => <TouchableOpacity accessibilityRole="tab" accessibilityState={{ selected: tab === key, disabled: busy }} disabled={busy} key={key} style={[ms.tabBtn, { minHeight: 44, justifyContent: 'center' }, tab === key && ms.tabBtnOn]} onPress={() => { void stopPreview(); setError(''); setTab(key); }}><Text style={[ms.tabTxt, tab === key && ms.tabTxtOn]}>{label}</Text></TouchableOpacity>)}</View>
          {error ? <Text accessibilityRole="alert" style={[ms.recHint, { color: '#FFB4B4', marginBottom: 10 }]}>{error}</Text> : null}
          {tab === 'record' ? <View style={ms.recordPane}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={phase === 'recording' ? 'Stop recording' : 'Record voiceover'} style={[ms.recBtn, phase === 'recording' && ms.recBtnOn]} disabled={disabled || phase === 'starting' || phase === 'stopping'} onPress={() => { if (phase === 'recording') void stopRecording(); else void startRecording(); }}>{phase === 'starting' || phase === 'stopping' ? <ActivityIndicator color="#FFF" /> : <Feather name={phase === 'recording' ? 'square' : 'mic'} size={26} color={phase === 'recording' ? '#020408' : '#FFF'} />}</TouchableOpacity>
            <Text style={ms.recHint}>{phase === 'recording' ? `Recording ${fmtSec(elapsed)} / 0:30` : phase === 'starting' ? 'Starting microphone…' : phase === 'stopping' ? 'Saving recording…' : recordedUri ? `Voiceover ready · ${fmtSec(recordedSec)}` : 'Record your own voice or original audio, up to 30 seconds.'}</Text>
            {recordedUri && !busy ? <View style={{ gap: 12, width: '100%' }}>
              <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: rightsAttested }} style={[ms.shareRow, { minHeight: 44 }]} onPress={() => setRightsAttested(value => !value)}><View style={[ms.checkbox, rightsAttested && ms.checkboxOn]}>{rightsAttested ? <Feather name="check" size={12} color="#020408" /> : null}</View><Text style={[ms.shareTxt, { flex: 1 }]}>I own this recording and have permission from everyone featured to publish it.</Text></TouchableOpacity>
              <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: shareToSounds }} style={[ms.shareRow, { minHeight: 44 }]} onPress={() => setShareToSounds(value => !value)}><View style={[ms.checkbox, shareToSounds && ms.checkboxOn]}>{shareToSounds ? <Feather name="check" size={12} color="#020408" /> : null}</View><Text style={[ms.shareTxt, { flex: 1 }]}>Also make this original sound public and allow others to reuse it in Platinum stories.</Text></TouchableOpacity>
              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 10 }}><TouchableOpacity accessibilityRole="button" style={[ms.secondaryBtn, { minHeight: 44 }]} onPress={() => { void previewUri('voiceover', recordedUri); }}><Text style={ms.secondaryTxt}>{previewingId === 'voiceover' ? 'Stop preview' : 'Preview'}</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" style={[ms.primaryBtn, { minHeight: 44, opacity: rightsAttested ? 1 : 0.5 }]} onPress={useVoiceover} disabled={disabled || !rightsAttested}><Text style={ms.primaryTxt}>Use voiceover</Text></TouchableOpacity></View>
            </View> : null}
          </View> : <View style={ms.listPane}>
            {loadingRows ? <ActivityIndicator color="#FFF" style={{ marginTop: 26 }} /> : rows.length === 0 ? <><Text style={ms.emptyTxt}>{error ? 'Your sound selection is unchanged.' : tab === 'sounds' ? 'No reusable original sounds yet. Record and share your own.' : 'No licensed soundtracks are available yet. You can record original audio or share an Apple Music song link.'}</Text>{error ? <TouchableOpacity accessibilityRole="button" style={[ms.secondaryBtn, { marginTop: 12, minHeight: 44 }]} onPress={() => setReload(value => value + 1)}><Text style={ms.secondaryTxt}>Retry</Text></TouchableOpacity> : null}</> : <FlatList data={rows} keyExtractor={row => row.id} style={{ maxHeight: 300 }} renderItem={({ item }) => <View style={ms.soundRow}><TouchableOpacity accessibilityRole="button" accessibilityLabel={`Preview ${item.title}`} style={[ms.playBtn, { width: 44, height: 44 }]} onPress={() => { void previewUri(item.id, item.url); }}><Feather name={previewingId === item.id ? 'pause' : 'play'} size={16} color="#FFF" /></TouchableOpacity><View style={{ flex: 1, minWidth: 0 }}><Text style={ms.soundTitle} numberOfLines={1}>{item.title}</Text><Text style={ms.soundMeta}>{[item.artist, fmtSec(item.duration_sec)].filter(Boolean).join(' · ')}</Text></View><TouchableOpacity accessibilityRole="button" accessibilityLabel={`Use ${item.title}`} style={[ms.useBtn, { minHeight: 44, justifyContent: 'center' }]} disabled={disabled || busy} onPress={() => { void selectSound(item.id); }}><Text style={ms.useBtnTxt}>Use</Text></TouchableOpacity></View>} />}
          </View>}
        </View>
      </View>
    </Modal>
    {onShareTrack ? <AppleMusicSheet visible={visible && appleOpen} onClose={() => setAppleOpen(false)} onSelect={track => { setAppleOpen(false); onShareTrack(track); }} /> : null}
  </>;
}

const ms = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: '#0C0C10', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 10, paddingBottom: 34, paddingHorizontal: 18 },
  handle: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.24)', marginBottom: 12 },
  title: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 12 },
  currentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(255,255,255,0.09)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12 },
  currentTxt: { flex: 1, color: '#FFFFFF', fontSize: 13.5, fontWeight: '600' },
  removeTxt: { color: '#FF8A8A', fontSize: 13, fontWeight: '700' },
  tabsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  tabBtn: { flex: 1, borderRadius: 999, paddingVertical: 8, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.09)' },
  tabBtnOn: { backgroundColor: '#FFFFFF' },
  tabTxt: { color: 'rgba(255,255,255,0.75)', fontSize: 13.5, fontWeight: '700' },
  tabTxtOn: { color: '#020408' },
  recordPane: { alignItems: 'center', paddingVertical: 14, gap: 14, minHeight: 190 },
  recBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  recBtnOn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  recHint: { color: 'rgba(255,255,255,0.7)', fontSize: 13.5, textAlign: 'center' },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: 'rgba(255,255,255,0.12)' },
  secondaryTxt: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  primaryBtn: { borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#FFFFFF' },
  primaryTxt: { color: '#020408', fontSize: 14, fontWeight: '700' },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  shareTxt: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5 },
  listPane: { minHeight: 190 },
  soundRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  playBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  soundTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  soundMeta: { color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2 },
  useBtn: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 7, backgroundColor: '#FFFFFF' },
  useBtnTxt: { color: '#020408', fontSize: 13, fontWeight: '700' },
  emptyTxt: { color: 'rgba(255,255,255,0.5)', fontSize: 13.5, textAlign: 'center', marginTop: 30, paddingHorizontal: 20 },
});

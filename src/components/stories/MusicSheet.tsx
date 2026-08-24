/**
 * MusicSheet - attach audio to a story with zero licensing cost.
 * Three legal sources:
 *   Record  - voiceover recorded on the spot (optionally shared to Sounds)
 *   Sounds  - original audio other members chose to share, most used first
 *   Library - CC0 / public-domain tracks curated into story_sounds
 * Selection returns a StoryAudioDraft; upload happens at publish time
 * in storiesService so the composer stays instant.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, FlatList, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { storiesService, StoryAudioDraft, StorySound } from '../../services/storiesService';

const MAX_RECORD_SEC = 30;

type Props = {
  visible: boolean;
  onClose: () => void;
  current: StoryAudioDraft | null;
  onSelect: (audio: StoryAudioDraft) => void;
  onRemove: () => void;
  disabled?: boolean;
};

type Tab = 'record' | 'sounds' | 'library';

function fmtSec(s: number | null | undefined) {
  const v = Math.max(0, Math.round(s || 0));
  const m = Math.floor(v / 60);
  const r = v % 60;
  return m + ':' + (r < 10 ? '0' : '') + r;
}

export default function MusicSheet({ visible, onClose, current, onSelect, onRemove, disabled }: Props) {
  const [tab, setTab] = useState<Tab>('record');
  const [recording, setRecording] = useState(false);
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedSec, setRecordedSec] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [shareToSounds, setShareToSounds] = useState(false);
  const [rows, setRows] = useState<StorySound[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const recRef = useRef<Audio.Recording | null>(null);
  const previewRef = useRef<Audio.Sound | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPreview = useCallback(async () => {
    setPreviewingId(null);
    if (previewRef.current) { try { await previewRef.current.unloadAsync(); } catch {} previewRef.current = null; }
  }, []);

  const cleanupRecording = useCallback(async () => {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    if (recRef.current) { try { await recRef.current.stopAndUnloadAsync(); } catch {} recRef.current = null; }
    try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {}
    setRecording(false);
  }, []);

  useEffect(() => {
    if (!visible) { stopPreview(); cleanupRecording(); }
    return () => { stopPreview(); cleanupRecording(); };
  }, [visible, stopPreview, cleanupRecording]);

  useEffect(() => {
    if (!visible || tab === 'record') return;
    let cancelled = false;
    setLoadingRows(true);
    storiesService.listStorySounds(tab === 'sounds' ? 'original' : 'library').then(list => {
      if (!cancelled) { setRows(list); setLoadingRows(false); }
    });
    return () => { cancelled = true; };
  }, [visible, tab]);

  const startRecording = useCallback(async () => {
    try {
      await stopPreview();
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) { Alert.alert('Microphone needed', 'Enable the microphone for Platinum Circles to record a voiceover.'); return; }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recRef.current = rec;
      setRecordedUri(null);
      setRecordedSec(0);
      setElapsed(0);
      setRecording(true);
      const startedAt = Date.now();
      tickRef.current = setInterval(() => {
        const sec = Math.floor((Date.now() - startedAt) / 1000);
        setElapsed(sec);
        if (sec >= MAX_RECORD_SEC) { stopRecordingRef.current(); }
      }, 250);
    } catch (e: any) {
      console.log('[MusicSheet] record start error:', e?.message);
      Alert.alert('Recording failed', 'Could not start the microphone.');
      cleanupRecording();
    }
  }, [stopPreview, cleanupRecording]);

  const stopRecording = useCallback(async () => {
    if (!recRef.current) return;
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    try {
      const status = await recRef.current.stopAndUnloadAsync();
      const uri = recRef.current.getURI();
      const ms = (status as any)?.durationMillis || 0;
      recRef.current = null;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      setRecording(false);
      if (uri && ms >= 900) {
        setRecordedUri(uri);
        setRecordedSec(Math.max(1, Math.round(ms / 1000)));
      } else {
        setRecordedUri(null);
        setRecordedSec(0);
      }
    } catch (e: any) {
      console.log('[MusicSheet] record stop error:', e?.message);
      recRef.current = null;
      setRecording(false);
    }
  }, []);
  const stopRecordingRef = useRef(stopRecording);
  stopRecordingRef.current = stopRecording;

  const previewUri = useCallback(async (id: string, uri: string) => {
    if (previewingId === id) { await stopPreview(); return; }
    await stopPreview();
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync({ uri }, { shouldPlay: true });
      previewRef.current = sound;
      setPreviewingId(id);
      sound.setOnPlaybackStatusUpdate(st => { if ((st as any)?.didJustFinish) { stopPreview(); } });
    } catch (e: any) {
      console.log('[MusicSheet] preview error:', e?.message);
    }
  }, [previewingId, stopPreview]);

  const useVoiceover = useCallback(() => {
    if (!recordedUri) return;
    stopPreview();
    onSelect({ kind: 'voiceover', localUri: recordedUri, durationSec: recordedSec, title: 'Voiceover', source: 'voiceover', addToSounds: shareToSounds });
  }, [recordedUri, recordedSec, shareToSounds, onSelect, stopPreview]);

  const useSound = useCallback((row: StorySound) => {
    stopPreview();
    onSelect({ kind: 'sound', url: row.url, soundId: row.id, title: row.title, durationSec: row.duration_sec, source: row.source });
  }, [onSelect, stopPreview]);

  const renderRow = ({ item }: { item: StorySound }) => (
    <View style={ms.soundRow}>
      <TouchableOpacity style={ms.playBtn} activeOpacity={0.7} onPress={() => previewUri(item.id, item.url)}>
        <Feather name={previewingId === item.id ? 'pause' : 'play'} size={16} color="#FFFFFF" />
      </TouchableOpacity>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={ms.soundTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={ms.soundMeta} numberOfLines={1}>{[item.artist, fmtSec(item.duration_sec), item.source === 'original' ? item.use_count + ' uses' : 'Free library'].filter(Boolean).join(' · ')}</Text>
      </View>
      <TouchableOpacity style={ms.useBtn} activeOpacity={0.8} onPress={() => useSound(item)} disabled={disabled}>
        <Text style={ms.useBtnTxt}>Use</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={ms.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={ms.sheet}>
            <View style={ms.handle} />
            <Text style={ms.title}>Sound</Text>

            {current ? (
              <View style={ms.currentRow}>
                <Feather name="music" size={15} color="#FFFFFF" />
                <Text style={ms.currentTxt} numberOfLines={1}>{current.title || 'Attached sound'}{current.durationSec ? ' · ' + fmtSec(current.durationSec) : ''}</Text>
                <TouchableOpacity onPress={() => { stopPreview(); onRemove(); }} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={ms.removeTxt}>Remove</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            <View style={ms.tabsRow}>
              {([['record', 'Record'], ['sounds', 'Sounds'], ['library', 'Library']] as [Tab, string][]).map(t => (
                <TouchableOpacity key={t[0]} style={[ms.tabBtn, tab === t[0] && ms.tabBtnOn]} activeOpacity={0.8} onPress={() => { stopPreview(); setTab(t[0]); }}>
                  <Text style={[ms.tabTxt, tab === t[0] && ms.tabTxtOn]}>{t[1]}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {tab === 'record' ? (
              <View style={ms.recordPane}>
                <TouchableOpacity style={[ms.recBtn, recording && ms.recBtnOn]} activeOpacity={0.8} onPress={recording ? stopRecording : startRecording} disabled={disabled}>
                  <Feather name={recording ? 'square' : 'mic'} size={26} color={recording ? '#020408' : '#FFFFFF'} />
                </TouchableOpacity>
                <Text style={ms.recHint}>
                  {recording ? 'Recording ' + fmtSec(elapsed) + ' / ' + fmtSec(MAX_RECORD_SEC) + ' - tap to stop' : recordedUri ? 'Voiceover ready · ' + fmtSec(recordedSec) : 'Tap to record a voiceover, up to ' + MAX_RECORD_SEC + 's'}
                </Text>
                {recordedUri && !recording ? (
                  <View style={{ alignItems: 'center', gap: 12 }}>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <TouchableOpacity style={ms.secondaryBtn} activeOpacity={0.8} onPress={() => previewUri('voiceover', recordedUri)}>
                        <Feather name={previewingId === 'voiceover' ? 'pause' : 'play'} size={14} color="#FFFFFF" />
                        <Text style={ms.secondaryTxt}>Preview</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={ms.primaryBtn} activeOpacity={0.8} onPress={useVoiceover} disabled={disabled}>
                        <Text style={ms.primaryTxt}>Use voiceover</Text>
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity style={ms.shareRow} activeOpacity={0.7} onPress={() => setShareToSounds(v => !v)}>
                      <View style={[ms.checkbox, shareToSounds && ms.checkboxOn]}>
                        {shareToSounds ? <Feather name="check" size={12} color="#020408" /> : null}
                      </View>
                      <Text style={ms.shareTxt}>Let others reuse this as an original sound</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={ms.listPane}>
                {loadingRows ? (
                  <ActivityIndicator color="#FFFFFF" style={{ marginTop: 26 }} />
                ) : rows.length === 0 ? (
                  <Text style={ms.emptyTxt}>{tab === 'sounds' ? 'No shared sounds yet. Record one and share it.' : 'No library tracks yet.'}</Text>
                ) : (
                  <FlatList data={rows} keyExtractor={r => r.id} renderItem={renderRow} style={{ maxHeight: 300 }} keyboardShouldPersistTaps="handled" />
                )}
              </View>
            )}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
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
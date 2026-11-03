import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Switch, StyleSheet, KeyboardAvoidingView, Platform, Keyboard, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from '../../components/SafeArea';
import { LiveChoice, LiveIcon, LIVE_AUDIENCES } from '../../components/LiveUi';
import { useTheme } from '../../theme/useTheme';
import { useAuthStore } from '../../stores/authStore';
import { LIVE_TOPICS, isLiveUuid } from '../../../shared/liveDirectory';
import { liveCommand, liveObject, liveRequestId, liveRpc } from '../../services/liveService';

type Props = { navigation: { goBack(): void; replace(name: string, params: object): void } };
export default function NewLiveScreen({ navigation }: Props) {
  const { t } = useTheme(), owner = useAuthStore(s => s.profile?.id ?? null);
  const [title, setTitle] = useState(''), [description, setDescription] = useState(''), [topic, setTopic] = useState('irl');
  const [audience, setAudience] = useState('public'), [schedule, setSchedule] = useState(''), [recording, setRecording] = useState(false);
  const [available, setAvailable] = useState(false), [broadcastable, setBroadcastable] = useState(false), [recordable, setRecordable] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [more, setMore] = useState(false), [keyboard, setKeyboard] = useState(false), [revision, setRevision] = useState(0);
  const request = useRef<{ payload: string; id: string } | null>(null), lock = useRef(false), generation = useRef(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => {
    const version = ++generation.current;
    setAvailable(false); setBroadcastable(false); setRecordable(false); setLoading(true); setError('');
    void liveRpc('live_directory', { p_filter: 'mine', p_topic: null, p_state: 'live', p_cursor: null, p_limit: 1 }).then(data => {
      if (version !== generation.current) return;
      const caps = liveObject(data.capabilities) ? data.capabilities : {};
      setAvailable(caps.create === true); setBroadcastable(caps.broadcast === true); setRecordable(caps.recording === true);
    }).catch(() => { if (version === generation.current) setError('Live setup could not load. Tap Retry.'); })
      .finally(() => { if (version === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [owner, revision]);
  const scheduled = !!schedule.trim();
  const previewAllowed = available && (broadcastable || scheduled);
  const save = async () => {
    if (lock.current || !previewAllowed || !owner) return;
    setError(''); Keyboard.dismiss();
    const time = schedule.trim() ? Date.parse(schedule) : null;
    if (time !== null && (!Number.isFinite(time) || time <= Date.now())) { setError('Enter a future date and time with a time zone.'); setMore(true); return; }
    // A title is optional in the UI, but the backend always receives a valid title.
    const payload = { title: title.trim() || 'Live stream', description, topic, audience, recording_enabled: recordable && recording,
      ...(time !== null ? { scheduled_at: new Date(time).toISOString() } : {}) };
    const signature = JSON.stringify(payload);
    if (request.current?.payload !== signature) request.current = { payload: signature, id: liveRequestId() };
    lock.current = true; setBusy(true); const version = generation.current;
    try {
      const result = await liveCommand('create', null, payload, request.current.id);
      if (version !== generation.current) return;
      if (!isLiveUuid(result.session_id)) throw new Error('The stream could not be verified. Try again.');
      request.current = null;
      navigation.replace('LiveSession', { sessionId: result.session_id, openStudio: time === null, previewCamera: time === null });
    } catch (reason) { if (version === generation.current) setError(reason instanceof Error ? reason.message : 'The stream could not be prepared.'); }
    finally { lock.current = false; if (version === generation.current) setBusy(false); }
  };
  return <SafeAreaView style={{ flex: 1, backgroundColor: t.surface.raised }}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Live" disabled={busy} onPress={() => navigation.goBack()} style={s.icon}><Feather name="chevron-left" size={24} color={t.ink.primary} /></Pressable>
        <Text accessibilityRole="header" style={{ flex: 1, color: t.ink.primary, fontSize: 21, fontWeight: '700' }}>Go live</Text>
        {keyboard ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss keyboard" onPress={Keyboard.dismiss} style={s.icon}><Feather name="check" size={22} color={t.ink.primary} /></Pressable> : null}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={s.content}>
        <View style={{ gap: 10 }}><LiveIcon size={32} color={t.ink.primary} /><Text style={{ color: t.ink.primary, fontSize: 25, fontWeight: '700' }}>Ready when you are</Text><Text style={{ color: t.ink.secondary, lineHeight: 21 }}>Preview your camera and microphone first. Nothing goes live until you tap Go live in the preview.</Text></View>
        <View style={{ gap: 8 }}><Text style={{ color: t.ink.primary, fontWeight: '600' }}>Add a title <Text style={{ color: t.ink.muted, fontWeight: '400' }}>(optional)</Text></Text>
          <TextInput accessibilityLabel="Stream title, optional" value={title} onChangeText={setTitle} editable={!busy} maxLength={120} placeholder="What are you sharing?" placeholderTextColor={t.ink.muted} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} style={[s.input, { color: t.ink.primary, backgroundColor: t.surface.sunken }]} />
        </View>
        <LiveChoice label="Who can watch" value={audience} choices={LIVE_AUDIENCES} onChange={setAudience} disabled={busy} />
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: more }} onPress={() => { Keyboard.dismiss(); setMore(!more); }} style={s.options}><Feather name="sliders" size={18} color={t.ink.primary} /><Text style={{ flex: 1, color: t.ink.primary }}>More options</Text><Feather name={more ? 'chevron-up' : 'chevron-down'} size={19} color={t.ink.secondary} /></Pressable>
        {more ? <View style={{ gap: 16 }}>
          <LiveChoice label="Topic" value={topic} choices={LIVE_TOPICS.filter(([id]) => id !== 'all')} onChange={setTopic} disabled={busy} />
          <TextInput accessibilityLabel="Stream description, optional" value={description} onChangeText={setDescription} editable={!busy} multiline maxLength={2000} placeholder="Description (optional)" placeholderTextColor={t.ink.muted} style={[s.input, { color: t.ink.primary, backgroundColor: t.surface.sunken, minHeight: 88, textAlignVertical: 'top' }]} />
          <View style={{ gap: 7 }}><Text style={{ color: t.ink.primary, fontWeight: '600' }}>Schedule for later</Text><Text style={{ color: t.ink.secondary, fontSize: 12 }}>Leave empty to preview now. Include your time zone when scheduling.</Text><TextInput accessibilityLabel="Scheduled date and time, optional" value={schedule} onChangeText={setSchedule} editable={!busy} maxLength={100} placeholder="YYYY-MM-DD HH:mm -07:00" placeholderTextColor={t.ink.muted} autoCapitalize="none" returnKeyType="done" onSubmitEditing={Keyboard.dismiss} style={[s.input, { color: t.ink.primary, backgroundColor: t.surface.sunken }]} /></View>
          <View style={s.options}><View style={{ flex: 1, gap: 4 }}><Text style={{ color: t.ink.primary, fontWeight: '600' }}>Save replay and enable clips</Text><Text style={{ color: t.ink.secondary, fontSize: 12 }}>{recordable ? 'Keep this broadcast for replays and highlights.' : 'Recording is not enabled in this environment.'}</Text></View><Switch accessibilityLabel="Record stream" disabled={!recordable || busy} value={recordable && recording} onValueChange={setRecording} /></View>
        </View> : null}
        {!loading && available && !broadcastable && !scheduled ? <Text accessibilityRole="alert" style={{ color: t.ink.secondary }}>Broadcasting is not enabled in this environment yet. You can still schedule a stream in More options.</Text> : null}
        {!loading && !available && !error ? <Text style={{ color: t.ink.secondary }}>Stream creation is not enabled in this environment yet.</Text> : null}
        {error ? <View style={{ gap: 8 }}><Text accessibilityRole="alert" style={{ color: t.ink.primary }}>{error}</Text><Pressable accessibilityRole="button" disabled={busy} onPress={() => setRevision(value => value + 1)} style={s.options}><Text style={{ color: t.ink.primary, fontWeight: '700' }}>Retry setup</Text></Pressable></View> : null}
      </ScrollView>
      <View style={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: keyboard ? 12 : 96, backgroundColor: t.surface.raised }}>
        <Pressable testID="live-preview-button" accessibilityRole="button" accessibilityLabel={scheduled ? 'Schedule stream' : 'Preview camera'} disabled={busy || loading || !previewAllowed || !owner} onPress={() => void save()}
          style={[s.primary, { backgroundColor: t.ink.primary, opacity: busy || loading || !previewAllowed || !owner ? 0.45 : 1 }]}>
          {busy || loading ? <ActivityIndicator color={t.surface.raised} /> : <Feather name={scheduled ? 'calendar' : 'video'} size={20} color={t.surface.raised} />}
          <Text style={{ color: t.surface.raised, fontSize: 16, fontWeight: '700' }}>{busy ? 'Preparing…' : loading ? 'Checking Live…' : scheduled ? 'Schedule stream' : 'Preview camera'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  header: { minHeight: 56, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18, gap: 18, paddingBottom: 28 },
  input: { minHeight: 48, borderRadius: 12, padding: 14, fontSize: 16 },
  options: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  primary: { minHeight: 52, paddingVertical: 14, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
});

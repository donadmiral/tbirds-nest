import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Switch, StyleSheet, KeyboardAvoidingView, Platform, Keyboard, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from '../../components/SafeArea';
import { LiveChoice, LiveIcon, LIVE_AUDIENCES } from '../../components/LiveUi';
import { useTheme } from '../../theme/useTheme';
import { useAuthStore } from '../../stores/authStore';
import { LIVE_TOPICS, isLiveUuid } from '../../../shared/liveDirectory';
import { defaultLiveSchedule, liveScheduledAt, liveLocalTimeZone, type LiveStartMode } from '../../../shared/liveSetup';
import { liveCommand, liveObject, liveRequestId, liveRpc } from '../../services/liveService';

type Props = { route?: { params?: { schedule?: boolean } }; navigation: { goBack(): void; replace(name: string, params: object): void } };
export default function NewLiveScreen({ navigation, route }: Props) {
  const { t } = useTheme(), owner = useAuthStore(s => s.profile?.id ?? null);
  const [mode, setMode] = useState<LiveStartMode>(route?.params?.schedule ? 'later' : 'now');
  const [schedule, setSchedule] = useState(defaultLiveSchedule);
  const [title, setTitle] = useState(''), [description, setDescription] = useState(''), [topic, setTopic] = useState('irl');
  const [audience, setAudience] = useState('public'), [recording, setRecording] = useState(false), [more, setMore] = useState(false);
  const [available, setAvailable] = useState(false), [broadcastable, setBroadcastable] = useState(false), [recordable, setRecordable] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [keyboard, setKeyboard] = useState(false), [revision, setRevision] = useState(0);
  const request = useRef<{ payload: string; id: string } | null>(null), lock = useRef(false), generation = useRef(0);
  const visibleOwner = useRef(owner); visibleOwner.current = owner;
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  useEffect(() => { setMode(route?.params?.schedule ? 'later' : 'now'); setError(''); }, [route?.params?.schedule]);
  useEffect(() => { request.current = null; lock.current = false; setBusy(false); }, [owner]);
  useEffect(() => {
    const version = ++generation.current;
    setAvailable(false); setBroadcastable(false); setRecordable(false); setLoading(!!owner); setError('');
    if (owner) void liveRpc('live_directory', { p_filter: 'mine', p_topic: null, p_state: 'live', p_cursor: null, p_limit: 1 }).then(data => {
      if (version !== generation.current || visibleOwner.current !== owner) return;
      const caps = liveObject(data.capabilities) ? data.capabilities : {};
      setAvailable(caps.create === true); setBroadcastable(caps.broadcast === true); setRecordable(caps.recording === true);
    }).catch(() => { if (version === generation.current) setError('Live setup could not load. Tap Retry setup.'); })
      .finally(() => { if (version === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [owner, revision]);
  const scheduled = mode === 'later';
  const previewAllowed = available && (scheduled || broadcastable);
  const save = async () => {
    if (lock.current || loading || !previewAllowed || !owner) return;
    setError(''); Keyboard.dismiss();
    let scheduledAt: string | null;
    try { scheduledAt = liveScheduledAt(mode, schedule.date, schedule.time); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Choose a valid date and time.'); return; }
    const payload = { title: title.trim() || 'Live stream', description, topic, audience, recording_enabled: recordable && recording,
      ...(scheduledAt ? { scheduled_at: scheduledAt } : {}) };
    const signature = JSON.stringify(payload);
    if (request.current?.payload !== signature) request.current = { payload: signature, id: liveRequestId() };
    lock.current = true; setBusy(true); const version = generation.current;
    try {
      const result = await liveCommand('create', null, payload, request.current.id);
      if (version !== generation.current || visibleOwner.current !== owner) return;
      if (!isLiveUuid(result.session_id)) throw new Error('The stream could not be verified. Try again.');
      request.current = null;
      navigation.replace('LiveSession', { sessionId: result.session_id, openStudio: !scheduledAt, previewCamera: !scheduledAt });
    } catch (reason) { if (version === generation.current) setError(reason instanceof Error ? reason.message : 'The stream could not be prepared.'); }
    finally { if (version === generation.current) { lock.current = false; setBusy(false); } }
  };
  const chooseMode = (next: LiveStartMode) => { if (!busy) { setMode(next); setError(''); Keyboard.dismiss(); } };
  return <SafeAreaView style={{ flex: 1, backgroundColor: t.surface.raised }}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={s.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Live" disabled={busy} onPress={() => navigation.goBack()} style={s.icon}><Feather name="chevron-left" size={24} color={t.ink.primary} /></Pressable>
        <Text accessibilityRole="header" style={{ flex: 1, color: t.ink.primary, fontSize: 21, fontWeight: '700' }}>{scheduled ? 'Schedule live' : 'Start live'}</Text>
        {keyboard ? <Pressable accessibilityRole="button" accessibilityLabel="Dismiss keyboard" onPress={Keyboard.dismiss} style={s.icon}><Feather name="check" size={22} color={t.ink.primary} /></Pressable> : null}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={s.content}>
        <View accessibilityRole="tablist" style={[s.modes, { backgroundColor: t.surface.sunken }]}>
          {([['now', 'Live now'], ['later', 'Schedule for later']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: mode === value, disabled: busy }} disabled={busy} onPress={() => chooseMode(value)} style={[s.mode, { backgroundColor: mode === value ? t.ink.primary : 'transparent' }]}><Text style={{ color: mode === value ? t.surface.raised : t.ink.primary, fontWeight: '600', fontSize: 14 }}>{label}</Text></Pressable>)}
        </View>
        <Text style={{ color: t.ink.secondary, lineHeight: 21 }}>{scheduled ? 'Choose when your live will start. Scheduling does not turn on your camera.' : 'No schedule needed. Preview your camera, then tap Go live when you are ready.'}</Text>
        {scheduled ? <View style={{ gap: 10 }}>
          <Text style={{ color: t.ink.primary, fontWeight: '600' }}>Date and time</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 3, gap: 5 }}><Text style={{ color: t.ink.secondary, fontSize: 12 }}>Date, YYYY-MM-DD</Text><TextInput accessibilityLabel="Scheduled date" value={schedule.date} onChangeText={date => setSchedule(previous => ({ ...previous, date }))} editable={!busy} maxLength={10} autoCorrect={false} placeholder="YYYY-MM-DD" placeholderTextColor={t.ink.muted} style={[s.input, { color: t.ink.primary, backgroundColor: t.surface.sunken }]} /></View>
            <View style={{ flex: 2, gap: 5 }}><Text style={{ color: t.ink.secondary, fontSize: 12 }}>Time, 24-hour</Text><TextInput accessibilityLabel="Scheduled time" value={schedule.time} onChangeText={time => setSchedule(previous => ({ ...previous, time }))} editable={!busy} maxLength={5} autoCorrect={false} placeholder="HH:MM" placeholderTextColor={t.ink.muted} style={[s.input, { color: t.ink.primary, backgroundColor: t.surface.sunken }]} /></View>
          </View>
          <Text style={{ color: t.ink.secondary, fontSize: 12 }}>Time zone: {liveLocalTimeZone()}</Text>
        </View> : null}
        <View style={{ gap: 8 }}><Text style={{ color: t.ink.primary, fontWeight: '600' }}>Title, optional</Text><TextInput accessibilityLabel="Stream title, optional" value={title} onChangeText={setTitle} editable={!busy} maxLength={120} placeholder="What are you sharing?" placeholderTextColor={t.ink.muted} returnKeyType="done" onSubmitEditing={Keyboard.dismiss} style={[s.input, { color: t.ink.primary, backgroundColor: t.surface.sunken }]} /></View>
        <LiveChoice label="Who can watch" value={audience} choices={LIVE_AUDIENCES} onChange={setAudience} disabled={busy} />
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: more }} disabled={busy} onPress={() => { Keyboard.dismiss(); setMore(!more); }} style={s.options}><Feather name="sliders" size={18} color={t.ink.primary} /><Text style={{ flex: 1, color: t.ink.primary }}>More options</Text><Feather name={more ? 'chevron-up' : 'chevron-down'} size={19} color={t.ink.secondary} /></Pressable>
        {more ? <View style={{ gap: 16 }}>
          <LiveChoice label="Topic" value={topic} choices={LIVE_TOPICS.filter(([id]) => id !== 'all')} onChange={setTopic} disabled={busy} />
          <TextInput accessibilityLabel="Stream description, optional" value={description} onChangeText={setDescription} editable={!busy} multiline maxLength={2000} placeholder="Description (optional)" placeholderTextColor={t.ink.muted} style={[s.input, { color: t.ink.primary, backgroundColor: t.surface.sunken, minHeight: 88, textAlignVertical: 'top' }]} />
          <View style={s.options}><View style={{ flex: 1, gap: 4 }}><Text style={{ color: t.ink.primary, fontWeight: '600' }}>Save replay and enable clips</Text><Text style={{ color: t.ink.secondary, fontSize: 12 }}>{recordable ? 'Keep this broadcast for replays and highlights.' : 'Recording is not enabled in this environment.'}</Text></View><Switch accessibilityLabel="Record stream" disabled={!recordable || busy} value={recordable && recording} onValueChange={setRecording} /></View>
        </View> : null}
      </ScrollView>
      <View style={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: keyboard ? 12 : 96, gap: 10, backgroundColor: t.surface.raised }}>
        {!owner ? <Text style={{ color: t.ink.secondary }}>Sign in to start or schedule a live.</Text> : null}
        {!loading && available && !broadcastable && !scheduled ? <Text accessibilityRole="alert" style={{ color: t.ink.secondary }}>Broadcasting is not enabled in this environment. You can select Schedule for later, or Retry setup.</Text> : null}
        {!loading && !available && !error && owner ? <Text accessibilityRole="alert" style={{ color: t.ink.secondary }}>Stream creation is unavailable. Retry setup to check again.</Text> : null}
        {error ? <Text accessibilityRole="alert" style={{ color: t.ink.primary }}>{error}</Text> : null}
        {owner && !loading && (error || !previewAllowed) ? <Pressable accessibilityRole="button" accessibilityLabel="Retry setup" disabled={busy} onPress={() => setRevision(value => value + 1)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: t.ink.primary, fontWeight: '600' }}>Retry setup</Text></Pressable> : null}
        <Pressable testID="live-preview-button" accessibilityRole="button" accessibilityLabel={scheduled ? 'Schedule stream' : 'Preview camera'} disabled={busy || loading || !previewAllowed || !owner} onPress={() => void save()} style={[s.primary, { backgroundColor: t.ink.primary, opacity: busy || loading || !previewAllowed || !owner ? 0.45 : 1 }]}>
          {busy || loading ? <ActivityIndicator color={t.surface.raised} /> : <LiveIcon size={20} color={t.surface.raised} />}
          <Text style={{ color: t.surface.raised, fontSize: 16, fontWeight: '700' }}>{busy ? scheduled ? 'Scheduling…' : 'Opening preview…' : loading ? 'Checking Live…' : scheduled ? 'Schedule stream' : 'Preview camera'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  header: { minHeight: 56, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18, gap: 18, paddingBottom: 24 },
  modes: { flexDirection: 'row', padding: 4, borderRadius: 14, gap: 4 },
  mode: { flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingHorizontal: 4 },
  input: { minHeight: 48, borderRadius: 12, padding: 14, fontSize: 16 },
  options: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  primary: { minHeight: 52, paddingVertical: 14, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
});

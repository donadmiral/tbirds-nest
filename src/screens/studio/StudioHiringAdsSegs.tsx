import { applicationCvUrl } from '../../services/applicationCvService';
import { loadApplicantPage, mergeApplicants, saveApplicationStatus, saveInterview, type ApplicantCursor } from '../../../shared/hiring';
import { useAuthStore } from '../../stores/authStore';
// src/screens/studio/StudioHiringAdsSegs.tsx
// Phone Studio Recruiter and Ads desks. Same RPC contracts as the web pages:
// studio_jobs / studio_applicants / studio_set_stage / studio_set_tags /
// studio_add_note / studio_schedule_interview / studio_close_job and
// studio_campaigns / studio_save_campaign / studio_submit_campaign /
// studio_set_campaign_status / studio_add_ad / studio_remove_ad /
// studio_my_posts_for_ads. Keyboard-safe, safe-area-aware, tab bar cleared.
import { themedSheet, getTheme, useTheme } from '../../theme/useTheme';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ScrollView, ActivityIndicator, Modal, Alert, KeyboardAvoidingView, Platform, RefreshControl, Linking } from 'react-native';
import { useSafeAreaInsets } from '../../components/SafeArea';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { supabase } from '../../services/supabase';
import { parseStudioLocalDate, validateCampaignInput } from '../../../shared/studioValidation';
import { StudioLoadError } from '../../components/StudioLoadError';

const NAVY = '#0B1E3D';
const TAB_CLEAR = 110;
const RECRUIT_ROLES = ['owner', 'admin', 'recruiter'];
const SPEND_ROLES = ['owner', 'admin'];
const AD_ROLES = ['owner', 'admin', 'editor'];
const STAGES = ['applied', 'viewed', 'shortlisted', 'screening', 'interview', 'offer', 'hired', 'accepted', 'rejected', 'withdrawn'] as const;
const OBJECTIVES: [string, string][] = [['reach', 'Reach'], ['traffic', 'Website visits'], ['messages', 'Messages'], ['storefront', 'Storefront visits'], ['applications', 'Job applications']];
const METHODS: [string, string][] = [['crisp', 'Crisp'], ['intobank', 'IntoBank']];

function whenLabel(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
const parseLocal = parseStudioLocalDate;
function fmtLocal(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function stageColor(st: string) {
  const theme = getTheme();
  return st === 'hired' || st === 'accepted' ? theme.status.success : st === 'offer' ? theme.status.warning : st === 'interview' ? theme.status.link : st === 'rejected' ? theme.status.danger : theme.ink.secondary;
}
function campaignColor(st: string) {
  const theme = getTheme();
  return st === 'live' ? theme.status.success : st === 'approved' ? theme.status.warning : st === 'submitted' ? theme.status.link : st === 'rejected' ? theme.status.danger : theme.ink.secondary;
}

function Avatar({ uri, name, size = 38 }: { uri?: string | null; name?: string | null; size?: number }) {
  if (uri) return <ExpoImage source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />;
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: getTheme().brand.base, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: getTheme().ink.inverse, fontWeight: '700' }}>{(name || '?').trim()[0]?.toUpperCase() || '?'}</Text></View>;
}
function BackRow({ title, label, onBack, right, sub }: { title: string; label: string; onBack: () => void; right?: React.ReactNode; sub?: string }) {
  return (
    <>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingTop: 12 }}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <Feather name="chevron-left" size={20} color={getTheme().ink.primary} /><Text style={{ fontSize: 14, fontWeight: '700', color: getTheme().ink.primary }}>{label}</Text>
      </TouchableOpacity>
      <Text style={[s.h1, { marginLeft: 6, flex: 1 }]} numberOfLines={1}>{title}</Text>
      {right}
    </View>
    {sub ? <Text style={{ fontSize: 12.5, color: getTheme().ink.secondary, paddingHorizontal: 16, marginTop: 4, lineHeight: 17 }}>{sub}</Text> : null}
    </>
  );
}
function Sheet({ visible, title, onClose, onSave, saveLabel, busy, canSave, children }: { visible: boolean; title: string; onClose: () => void; onSave?: () => void; saveLabel?: string; busy?: boolean; canSave?: boolean; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: getTheme().surface.canvas }}>
        <View style={[s.modalHeader, { paddingTop: Platform.OS === 'ios' ? 14 : insets.top + 8 }]}>
          <TouchableOpacity onPress={onClose} style={{ width: 70 }}><Text style={{ fontSize: 16, color: getTheme().ink.secondary }}>Cancel</Text></TouchableOpacity>
          <Text style={s.modalTitle} numberOfLines={1}>{title}</Text>
          {onSave ? <TouchableOpacity onPress={onSave} disabled={busy || canSave === false} style={{ width: 70, alignItems: 'flex-end' }}><Text style={{ fontSize: 15, fontWeight: '700', color: getTheme().ink.primary, opacity: busy || canSave === false ? 0.4 : 1 }}>{saveLabel || 'Save'}</Text></TouchableOpacity> : <View style={{ width: 70 }} />}
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Recruiter ──────────────────────────────────────────────────────────────
type Job = { id: string; title: string; company: string | null; location: string | null; job_type: string | null; remote_type: string | null; deadline: string | null; created_at: string; urgent: boolean; closed: boolean; counts: Record<string, number> };
type Applicant = { id: string; status: string; applied_at: string; updated_at: string; cover_note: string | null; cover_letter: string | null; cv_url: string | null; cv_name: string | null; phone: string | null; portfolio_url: string | null; interview_at: string | null; interview_location: string | null; applicant_id: string; name: string; username: string | null; avatar_url: string | null; bio: string | null; location: string | null; tags: string[]; notes: { id: string; body: string; created_at: string; author: string | null }[] };

export function RecruiterSeg({ role, navigation, onBack }: { role: string | null; navigation: any; onBack: () => void }) {
  useTheme();
  const userId = useAuthStore(state => state.profile?.id);
  const can = !!role && RECRUIT_ROLES.includes(role);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [apps, setApps] = useState<Applicant[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [sel, setSel] = useState<Applicant | null>(null);
  const [stagePicker, setStagePicker] = useState(false);
  const activeApplicantId = useRef<string | null>(null);
  const [note, setNote] = useState('');
  const [ivAt, setIvAt] = useState('');
  const [ivLoc, setIvLoc] = useState('');
  const [tagText, setTagText] = useState('');
  const [busy, setBusy] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [cursor, setCursor] = useState<ApplicantCursor | null>(null);
  const jobsRequest = useRef(0);
  const appsRequest = useRef(0);
  const mounted = useRef(true);
  const activeJobId = useRef<string | null>(null);
  const actionPending = useRef(false);
  const appsPending = useRef(false);
  const chooseApplicant = (value: Applicant | null) => {
    activeApplicantId.current = value?.id ?? null;
    setSel(value); setStagePicker(false);
  };

  const chooseJob = (value: Job | null) => {
    ++appsRequest.current; appsPending.current = false;
    activeJobId.current = value?.id ?? null;
    setJob(value); setStage(null); chooseApplicant(null); setApps([]); setCounts({}); setCursor(null); setAppsError(null);
  };
  const chooseStage = (value: string | null) => {
    ++appsRequest.current; appsPending.current = false;
    setStage(value); chooseApplicant(null); setApps([]); setCursor(null); setAppsError(null);
  };

  const loadJobs = useCallback(async () => {
    const request = ++jobsRequest.current;
    setLoading(true); setJobsError(null);
    try {
      const { data, error } = await supabase.rpc('studio_jobs');
      if (error || !Array.isArray(data)) throw error || new Error('Jobs could not be loaded.');
      if (mounted.current && request === jobsRequest.current) setJobs(data as Job[]);
    } catch (error: any) {
      if (mounted.current && request === jobsRequest.current) setJobsError(error?.message || 'Jobs could not be loaded. Please retry.');
    } finally { if (mounted.current && request === jobsRequest.current) setLoading(false); }
  }, [userId]);
  useEffect(() => {
    mounted.current = true; chooseJob(null); setJobs([]);
    if (can) void loadJobs(); else setLoading(false);
    return () => { mounted.current = false; ++jobsRequest.current; ++appsRequest.current; };
  }, [can, loadJobs]);

  const loadApps = useCallback(async (j: Job, before: ApplicantCursor | null = null) => {
    if (activeJobId.current !== j.id || (before && appsPending.current)) return;
    const request = ++appsRequest.current;
    const current = () => mounted.current && request === appsRequest.current && activeJobId.current === j.id;
    appsPending.current = true; setAppsLoading(true); setAppsError(null);
    try {
      const page = await loadApplicantPage<Applicant & { applicant?: { full_name?: string; username?: string; avatar_url?: string; bio?: string; location?: string }; applicant_phone?: string }>(supabase, j.id, stage ?? 'all', before);
      if (!current()) return;
      const rows = page.applications.map(row => ({ ...row, name: row.applicant?.full_name || row.name || 'Applicant', username: row.applicant?.username ?? row.username ?? null, avatar_url: row.applicant?.avatar_url ?? row.avatar_url ?? null, bio: row.applicant?.bio ?? row.bio ?? null, location: row.applicant?.location ?? row.location ?? null, phone: row.applicant_phone ?? row.phone ?? null, tags: row.tags ?? [], notes: row.notes ?? [] }));
      setApps(old => before ? mergeApplicants(old, rows) : rows);
      setCounts(page.counts); setCursor(page.has_more ? page.cursor : null);
      setSel(old => old ? rows.find(row => row.id === old.id) ?? (before ? old : null) : null);
    } catch (error: any) { if (current()) setAppsError(error?.message || 'Applicants could not be loaded. Please retry.'); }
    finally { if (current()) { appsPending.current = false; setAppsLoading(false); } }
  }, [stage, userId]);
  useEffect(() => { if (job && can) void loadApps(job); }, [job, can, loadApps]);
  useEffect(() => { if (sel) { setIvAt(fmtLocal(sel.interview_at)); setIvLoc(sel.interview_location || ''); setTagText(sel.tags.join(', ')); setNote(''); } }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => PromiseLike<any>, then?: () => void) => {
    if (actionPending.current || !can) return;
    const context = appsRequest.current;
    const applicantId = activeApplicantId.current;
    actionPending.current = true; setBusy(true);
    try {
      const r = await fn(); if (r?.error) throw r.error;
      if (!mounted.current || context !== appsRequest.current) return;
      if (applicantId === activeApplicantId.current) then?.();
      if (job) await loadApps(job);
      if (mounted.current) await loadJobs();
    } catch (e: any) { if (mounted.current && context === appsRequest.current) Alert.alert('Could not update', e?.message || 'Refresh the applicants and try again.'); }
    finally { actionPending.current = false; if (mounted.current) setBusy(false); }
  };
  const refreshSel = (list: Applicant[]) => { if (sel) { const n = list.find(a => a.id === sel.id); if (n) setSel(n); } };
  useEffect(() => { refreshSel(apps); }, [apps]); // eslint-disable-line react-hooks/exhaustive-deps

  const jobActions = (j: Job) => {
    if (!can) return;
    Alert.alert(j.title, j.closed ? 'Closed to new applications' : 'Open', [
      { text: j.closed ? 'Reopen job' : 'Close job', style: j.closed ? 'default' : 'destructive', onPress: () => act(() => supabase.rpc('studio_close_job', { p_job: j.id, p_close: !j.closed })) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };
  const moveStage = (a: Applicant) => {
    if (a.status === 'withdrawn') return;
    setStagePicker(value => !value);
  };
  const pickStage = (a: Applicant, status: string) => {
    setStagePicker(false);
    if (status === 'interview') { Alert.alert('Schedule interview', 'Choose a future date and time in the Interview section below.'); return; }
    const update = () => void act(() => saveApplicationStatus(supabase, a, status));
    if (['rejected', 'hired', 'accepted'].includes(status)) {
      Alert.alert('Update application?', `${a.name} will be notified that their application is ${status}.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Confirm', onPress: update }]);
    } else update();
  };

  if (!can) return <View style={{ flex: 1 }}><BackRow title="Recruiter" label="More" onBack={onBack} /><View style={[s.card, { margin: 16 }]}><Text style={s.cardMuted}>Recruiter is open to owners, admins and recruiters.</Text></View></View>;

  if (job) {
    const shown = apps;
    return (
      <View style={{ flex: 1 }}>
        <BackRow title={job.title} label="Jobs" onBack={() => chooseJob(null)} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }} style={{ flexGrow: 0 }}>
          <TouchableOpacity style={[s.filterChip, !stage && s.filterChipOn]} onPress={() => chooseStage(null)}><Text style={[s.filterTxt, !stage && s.filterTxtOn]}>All{counts.all != null ? ' · ' + counts.all : ''}</Text></TouchableOpacity>
          {STAGES.map(st => { const n = counts[st] ?? 0; return (
            <TouchableOpacity key={st} style={[s.filterChip, stage === st && s.filterChipOn]} onPress={() => chooseStage(stage === st ? null : st)}><Text style={[s.filterTxt, stage === st && s.filterTxtOn]}>{st.charAt(0).toUpperCase() + st.slice(1)}{n ? ' · ' + n : ''}</Text></TouchableOpacity>
          ); })}
        </ScrollView>
        {appsLoading && apps.length === 0 ? <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={getTheme().ink.primary} /></View>
        : <FlatList data={shown} keyExtractor={a => a.id} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_CLEAR }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadApps(job); setRefreshing(false); }} />}
            ListHeaderComponent={appsError ? <View style={s.card}><Text accessibilityRole="alert" style={s.cardTxt}>{appsError}</Text><TouchableOpacity style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => void loadApps(job)}><Text style={s.cardTxt}>Try again</Text></TouchableOpacity></View> : null}
            ListEmptyComponent={!appsError ? <View style={s.card}><Text style={s.cardMuted}>{stage ? 'Nobody at this stage.' : 'No applications yet.'}</Text></View> : null}
            ListFooterComponent={cursor ? <TouchableOpacity disabled={appsLoading} style={[s.secondaryBtn, { minHeight: 44 }]} onPress={() => void loadApps(job, cursor)}><Text style={s.secondaryTxt}>{appsLoading ? 'Loading…' : 'Load more applicants'}</Text></TouchableOpacity> : null}
            renderItem={({ item: a }) => (
              <TouchableOpacity style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]} onPress={() => chooseApplicant(a)} activeOpacity={0.85}>
                <Avatar uri={a.avatar_url} name={a.name} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[s.cardTxt, { fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>{a.name}</Text>
                    <Text style={[s.statusPill, { color: stageColor(a.status) }]}>{a.status.toUpperCase()}</Text>
                  </View>
                  <Text style={s.cardMeta} numberOfLines={1}>Applied {whenLabel(a.applied_at)}{a.location ? ' · ' + a.location : ''}{a.interview_at ? ' · interview ' + whenLabel(a.interview_at) : ''}</Text>
                  {a.tags.length ? <Text style={[s.cardMeta, { color: getTheme().ink.primary }]} numberOfLines={1}>{a.tags.join(' · ')}</Text> : null}
                </View>
                <Feather name="chevron-right" size={16} color={getTheme().ink.secondary} />
              </TouchableOpacity>
            )}
          />}
        <Sheet visible={!!sel} title={sel?.name || 'Applicant'} onClose={() => chooseApplicant(null)}>
          {sel ? (
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Avatar uri={sel.avatar_url} name={sel.name} size={52} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.cardTxt, { fontWeight: '800', fontSize: 16 }]}>{sel.name}</Text>
                  <Text style={s.cardMeta}>{sel.username ? '@' + sel.username : ''}{sel.location ? ' · ' + sel.location : ''}</Text>
                  <Text style={[s.statusPill, { color: stageColor(sel.status), marginTop: 4 }]}>{sel.status.toUpperCase()}</Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                {sel.status !== 'withdrawn' ? <TouchableOpacity style={s.toolChip} onPress={() => moveStage(sel)} disabled={busy}><Feather name="arrow-right-circle" size={14} color={getTheme().ink.primary} /><Text style={s.toolTxt}>Move stage</Text></TouchableOpacity> : null}
                <TouchableOpacity style={s.toolChip} onPress={() => navigation.navigate('UserProfile', { userId: sel.applicant_id })}><Feather name="user" size={14} color={getTheme().ink.primary} /><Text style={s.toolTxt}>Profile</Text></TouchableOpacity>
                {sel.cv_url ? <TouchableOpacity style={s.toolChip} onPress={() => applicationCvUrl(sel.cv_url!, sel.cv_name).then(url => Linking.openURL(url)).catch((e) => Alert.alert('Could not open CV', e?.message || 'Please try again.'))}><Feather name="file-text" size={14} color={getTheme().ink.primary} /><Text style={s.toolTxt}>{sel.cv_name || 'CV'}</Text></TouchableOpacity> : null}
                {sel.portfolio_url ? <TouchableOpacity style={s.toolChip} onPress={() => Linking.openURL(sel.portfolio_url!)}><Feather name="link" size={14} color={getTheme().ink.primary} /><Text style={s.toolTxt}>Portfolio</Text></TouchableOpacity> : null}
                {sel.phone ? <TouchableOpacity style={s.toolChip} onPress={() => Linking.openURL('tel:' + sel.phone)}><Feather name="phone" size={14} color={getTheme().ink.primary} /><Text style={s.toolTxt}>{sel.phone}</Text></TouchableOpacity> : null}
              </View>
              {stagePicker ? <View style={[s.card, { marginTop: 10 }]}><Text style={s.fieldLabel}>Move to stage</Text>{STAGES.filter(value => value !== sel.status && value !== 'withdrawn').map(value => <TouchableOpacity key={value} disabled={busy} style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => pickStage(sel, value)}><Text style={s.cardTxt}>{value.charAt(0).toUpperCase() + value.slice(1)}</Text></TouchableOpacity>)}</View> : null}
              {sel.cover_note || sel.cover_letter ? <View style={[s.card, { marginTop: 14 }]}><Text style={s.fieldLabel}>Cover note</Text><Text style={s.cardTxt}>{sel.cover_note || sel.cover_letter}</Text></View> : null}
              {sel.bio ? <View style={s.card}><Text style={s.fieldLabel}>Bio</Text><Text style={s.cardTxt}>{sel.bio}</Text></View> : null}

              <Text style={s.section}>Interview</Text>
              <TextInput value={ivAt} onChangeText={setIvAt} placeholder="YYYY-MM-DD HH:mm" placeholderTextColor={getTheme().ink.secondary} style={s.input} autoCapitalize="none" autoCorrect={false} />
              <TextInput value={ivLoc} onChangeText={setIvLoc} placeholder="Location or link" placeholderTextColor={getTheme().ink.secondary} style={[s.input, { marginTop: 8 }]} autoCapitalize="none" autoCorrect={false} />
              {sel.status !== 'withdrawn' ? <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <TouchableOpacity style={[s.primaryBtn, { flex: 1, marginTop: 0 }, (busy || !ivAt.trim()) && { opacity: 0.4 }]} disabled={busy || !ivAt.trim()} onPress={() => { const d = parseLocal(ivAt); if (!d || d.getTime() <= Date.now()) { Alert.alert('Check the date', 'Choose a future time using YYYY-MM-DD HH:mm.'); return; } void act(() => saveInterview(supabase, sel, d.toISOString(), ivLoc.trim() || null)); }}><Text style={s.primaryTxt}>Schedule</Text></TouchableOpacity>
                {sel.interview_at ? <TouchableOpacity style={[s.secondaryBtn, { justifyContent: 'center' }]} disabled={busy} onPress={() => act(() => saveInterview(supabase, sel, null, null))}><Text style={[s.secondaryTxt, { color: '#D64545' }]}>Clear</Text></TouchableOpacity> : null}
              </View> : <Text style={s.cardMuted}>This application was withdrawn.</Text>}

              <Text style={s.section}>Tags</Text>
              <TextInput value={tagText} onChangeText={setTagText} editable={!busy} placeholder="senior, remote, shortlist" placeholderTextColor={getTheme().ink.secondary} style={s.input} autoCapitalize="none" />
              <TouchableOpacity style={[s.secondaryBtn, { minHeight: 44, marginTop: 8 }]} disabled={busy} onPress={() => act(() => supabase.rpc('studio_set_tags', { p_application: sel.id, p_tags: tagText.split(',').map(t => t.trim()).filter(Boolean) }))}><Text style={s.secondaryTxt}>Save tags</Text></TouchableOpacity>

              <Text style={s.section}>Team notes</Text>
              {sel.notes.length === 0 ? <Text style={s.cardMuted}>No notes yet.</Text> : sel.notes.map(n => (
                <View key={n.id} style={s.card}><Text style={s.cardTxt}>{n.body}</Text><Text style={s.cardMeta}>{n.author || 'Team'} · {whenLabel(n.created_at)}</Text></View>
              ))}
              <TextInput value={note} onChangeText={setNote} placeholder="Add a note for the team" placeholderTextColor={getTheme().ink.secondary} multiline style={[s.textArea, { minHeight: 80, marginTop: 6 }]} />
              <TouchableOpacity style={[s.primaryBtn, { marginTop: 8 }, (busy || !note.trim()) && { opacity: 0.4 }]} disabled={busy || !note.trim()} onPress={() => act(() => supabase.rpc('studio_add_note', { p_application: sel.id, p_body: note.trim() }), () => setNote(''))}><Text style={s.primaryTxt}>Add note</Text></TouchableOpacity>
            </View>
          ) : null}
        </Sheet>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <BackRow title="Recruiter" sub="Every application moves through one pipeline. Candidates hear from you on offer, hire, rejection and interviews." label="More" onBack={onBack} />
      {loading ? <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={getTheme().ink.primary} /></View>
      : <FlatList data={jobs} keyExtractor={j => j.id} contentContainerStyle={{ padding: 16, paddingBottom: TAB_CLEAR }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadJobs(); setRefreshing(false); }} />}
          ListHeaderComponent={jobsError ? <View style={s.card}><Text accessibilityRole="alert" style={s.cardTxt}>{jobsError}</Text><TouchableOpacity style={{ minHeight: 44, justifyContent: 'center' }} onPress={() => void loadJobs()}><Text style={s.cardTxt}>Try again</Text></TouchableOpacity></View> : null}
          ListEmptyComponent={!jobsError ? <View style={s.card}><Text style={s.cardMuted}>No jobs posted by this business yet. Post one from the Jobs tab and applicants land here.</Text></View> : null}
          renderItem={({ item: j }) => (
            <TouchableOpacity style={[s.card, j.closed && { opacity: 0.6 }]} onPress={() => chooseJob(j)} onLongPress={() => jobActions(j)} activeOpacity={0.85}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[s.cardTxt, { fontWeight: '700', flex: 1 }]} numberOfLines={1}>{j.title}</Text>
                {j.urgent && !j.closed ? <Text style={[s.statusPill, { color: '#D64545' }]}>URGENT</Text> : null}
                <Text style={[s.statusPill, { color: j.closed ? '#8E8E93' : '#1C8C4E' }]}>{j.closed ? 'CLOSED' : 'OPEN'}</Text>
              </View>
              <Text style={s.cardMeta} numberOfLines={1}>{[j.location, j.job_type, j.remote_type].filter(Boolean).join(' · ')}{j.deadline ? ' · closes ' + whenLabel(j.deadline) : ''}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                <Text style={s.labelPill}>{j.counts?.total || 0} total</Text>
                {STAGES.map(st => (j.counts?.[st] || 0) > 0 ? <Text key={st} style={[s.labelPill, { color: stageColor(st) }]}>{j.counts[st]} {st}</Text> : null)}
              </View>
            </TouchableOpacity>
          )}
        />}
    </View>
  );
}

// ── Ads ────────────────────────────────────────────────────────────────────
type Ad = { id: string; post_id: string; label: string; status: string; total_cap: number | null; impressions: number; clicks: number; content: string; thumb: string | null; products: number };
type Campaign = { id: string; name: string; objective: string; budget: number; currency: string; payment_method: string | null; payment_ref: string | null; paid_amount: number; starts_at: string | null; ends_at: string | null; status: string; review_note: string | null; created_at: string; impressions: number; clicks: number; ads: Ad[] };
type Form = { id: string | null; name: string; objective: string; budget: string; currency: string; payment_method: string; starts_at: string; ends_at: string };
const emptyForm = (): Form => ({ id: null, name: '', objective: 'reach', budget: '', currency: 'USD', payment_method: '', starts_at: '', ends_at: '' });

export function AdsSeg({ role, navigation, onBack }: { role: string | null; navigation: any; onBack: () => void }) {
  const canSee = !!role && AD_ROLES.includes(role);
  const canSpend = !!role && SPEND_ROLES.includes(role);
  const [rows, setRows] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const loadRequest = useRef(0);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Form>(emptyForm());
  const [busy, setBusy] = useState(false);
  const acting = useRef(false);
  const mounted = useRef(true);
  const postsRequest = useRef(0);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [picking, setPicking] = useState<Campaign | null>(null);
  const [posts, setPosts] = useState<{ id: string; content: string; thumb: string | null; products: number; likes: number }[]>([]);

  const load = useCallback(async (silent = false) => {
    const token = ++loadRequest.current;
    if (!silent) setLoading(true);
    setLoadError(false);
    try {
      const { data, error } = await supabase.rpc('studio_campaigns');
      if (error) throw error;
      if (token === loadRequest.current) setRows(((data as any[]) || []) as Campaign[]);
    } catch {
      if (token === loadRequest.current) setLoadError(true);
    } finally {
      if (token === loadRequest.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (canSee) void load(); else { setLoading(false); setRows([]); }
    return () => { mounted.current = false; loadRequest.current += 1; postsRequest.current += 1; };
  }, [canSee, load]);

  const act = async (fn: () => PromiseLike<any>, then?: () => void) => {
    if (acting.current) return;
    acting.current = true; setBusy(true);
    try { const r = await fn(); if (r?.error) throw r.error; if (mounted.current) { then?.(); await load(true); } }
    catch (e: any) { if (mounted.current) Alert.alert('Could not update', e?.message || 'Please try again.'); }
    finally { acting.current = false; if (mounted.current) setBusy(false); }
  };
  const openEdit = (c: Campaign) => { setF({ id: c.id, name: c.name, objective: c.objective, budget: String(c.budget || ''), currency: c.currency, payment_method: c.payment_method || '', starts_at: fmtLocal(c.starts_at), ends_at: fmtLocal(c.ends_at) }); setOpen(true); };
  const save = () => {
    if (!canSpend) return;
    try {
      const value = validateCampaignInput(f);
      void act(() => supabase.rpc('studio_save_campaign', { p_id: f.id, p_name: value.name, p_objective: f.objective, p_budget: value.budget, p_currency: f.currency, p_payment_method: f.payment_method || null, p_starts_at: value.startsAt, p_ends_at: value.endsAt }), () => { setOpen(false); setF(emptyForm()); });
    } catch (error: any) { Alert.alert('Check campaign details', error?.message || 'Check the budget and dates.'); }
  };
  const campaignActions = (c: Campaign) => {
    const b: any[] = [];
    if (canSpend && ['draft', 'rejected', 'paused', 'approved'].includes(c.status)) b.push({ text: 'Edit', onPress: () => openEdit(c) });
    if (c.status !== 'ended') b.push({ text: 'Add an ad', onPress: () => startPick(c) });
    if (canSpend && ['draft', 'rejected'].includes(c.status)) b.push({ text: 'Submit for review', onPress: () => act(() => supabase.rpc('studio_submit_campaign', { p_id: c.id })) });
    if (canSpend && ['approved', 'paused'].includes(c.status)) b.push({ text: 'Go live', onPress: () => act(() => supabase.rpc('studio_set_campaign_status', { p_id: c.id, p_status: 'live' })) });
    if (canSpend && c.status === 'live') b.push({ text: 'Pause', onPress: () => act(() => supabase.rpc('studio_set_campaign_status', { p_id: c.id, p_status: 'paused' })) });
    if (canSpend && !['ended', 'draft'].includes(c.status)) b.push({ text: 'End campaign', style: 'destructive', onPress: () => Alert.alert('End campaign?', c.name, [{ text: 'Cancel', style: 'cancel' }, { text: 'End', style: 'destructive', onPress: () => act(() => supabase.rpc('studio_set_campaign_status', { p_id: c.id, p_status: 'ended' })) }]) });
    if (canSpend && ['draft', 'rejected'].includes(c.status)) b.push({ text: 'Delete draft', style: 'destructive', onPress: () => Alert.alert('Delete this draft?', c.name + ' and its ads will be removed.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => act(() => supabase.rpc('studio_delete_campaign', { p_id: c.id })) }]) });
    b.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(c.name, c.status + (c.review_note ? ' · ' + c.review_note : ''), b);
  };
  const startPick = async (c: Campaign) => {
    const request = ++postsRequest.current;
    setPicking(c); setPosts([]); setPostsLoading(true); setPostsError(null);
    try {
      const { data, error } = await supabase.rpc('studio_my_posts_for_ads', { p_limit: 60 });
      if (error) throw error;
      if (mounted.current && request === postsRequest.current) setPosts(((data as any[]) || []) as any);
    } catch { if (mounted.current && request === postsRequest.current) setPostsError('Your posts could not be loaded.'); }
    finally { if (mounted.current && request === postsRequest.current) setPostsLoading(false); }
  };
  const addAd = (c: Campaign, postId: string) => act(() => supabase.rpc('studio_add_ad', { p_campaign: c.id, p_post_id: postId, p_label: 'Sponsored', p_total_cap: null }), () => setPicking(null));
  const removeAd = (a: Ad) => Alert.alert('Remove this ad?', a.content || 'Post', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => act(() => supabase.rpc('studio_remove_ad', { p_promo: a.id })) }]);

  const totals = useMemo(() => rows.reduce((t, c) => ({ imp: t.imp + Number(c.impressions || 0), clk: t.clk + Number(c.clicks || 0), live: t.live + (c.status === 'live' ? 1 : 0) }), { imp: 0, clk: 0, live: 0 }), [rows]);

  if (!canSee) return <View style={{ flex: 1 }}><BackRow title="Ads" label="More" onBack={onBack} /><View style={[s.card, { margin: 16 }]}><Text style={s.cardMuted}>Ads is open to owners, admins and editors.</Text></View></View>;

  return (
    <View style={{ flex: 1 }}>
      <BackRow title="Ads" sub="Campaigns with an objective, budget and schedule. Ads inside them run as Sponsored posts once the campaign is approved and live." label="More" onBack={onBack} right={canSpend ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Create campaign" style={s.plusBtn} onPress={() => { setF(emptyForm()); setOpen(true); }}><Feather name="plus" size={18} color={getTheme().ink.inverse} /></TouchableOpacity> : null} />
      {loadError ? <TouchableOpacity accessibilityRole="button" onPress={() => void load(true)} style={[s.card, { margin: 16, minHeight: 48 }]}><Text style={s.cardTxt}>Could not refresh campaigns. Tap to retry.</Text>{rows.length ? <Text style={s.cardMuted}>Showing the last loaded campaigns.</Text> : null}</TouchableOpacity> : null}
      {loading ? <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={getTheme().ink.primary} /></View>
      : loadError && !rows.length ? null : <FlatList data={rows} keyExtractor={c => c.id} contentContainerStyle={{ padding: 16, paddingBottom: TAB_CLEAR }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(true); setRefreshing(false); }} />}
          ListHeaderComponent={
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
              {[['Live', totals.live], ['Views', totals.imp], ['Clicks', totals.clk]].map(([l, n]) => (
                <View key={String(l)} style={[s.card, { flex: 1, marginBottom: 0 }]}><Text style={s.statLabel}>{String(l)}</Text><Text style={s.statNum}>{Number(n).toLocaleString()}</Text></View>
              ))}
            </View>
          }
          ListEmptyComponent={<View style={s.card}><Text style={s.cardMuted}>No campaigns yet. A campaign has an objective, budget and schedule. Ads inside it run as Sponsored posts once it is approved and live.</Text></View>}
          renderItem={({ item: c }) => (
            <TouchableOpacity style={s.card} onPress={() => campaignActions(c)} activeOpacity={0.85}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={[s.cardTxt, { fontWeight: '700', flex: 1 }]} numberOfLines={1}>{c.name}</Text>
                <Text style={[s.statusPill, { color: campaignColor(c.status) }]}>{c.status.toUpperCase()}</Text>
              </View>
              <Text style={s.cardMeta} numberOfLines={1}>{OBJECTIVES.find(o => o[0] === c.objective)?.[1] || c.objective} · {c.currency} {Number(c.budget).toLocaleString()}{c.payment_method ? ' via ' + (c.payment_method === 'crisp' ? 'Crisp' : 'IntoBank') : ''}</Text>
              <Text style={s.cardMeta} numberOfLines={1}>{Number(c.impressions).toLocaleString()} views · {Number(c.clicks).toLocaleString()} clicks · {c.ads.length} ad{c.ads.length === 1 ? '' : 's'}{c.starts_at ? ' · ' + whenLabel(c.starts_at) : ''}{c.ends_at ? ' to ' + whenLabel(c.ends_at) : ''}</Text>
              {c.review_note ? <Text style={[s.cardMeta, { color: '#D64545' }]}>{c.review_note}</Text> : null}
              {c.ads.length > 0 ? (
                <TouchableOpacity onPress={() => setExpanded(expanded === c.id ? null : c.id)} style={{ marginTop: 8 }}><Text style={s.linkTxt}>{expanded === c.id ? 'Hide ads' : 'Show ads'}</Text></TouchableOpacity>
              ) : null}
              {expanded === c.id ? c.ads.map(a => (
                <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  {a.thumb ? <ExpoImage source={{ uri: a.thumb }} style={s.thumbSm} contentFit="cover" /> : <View style={[s.thumbSm, { backgroundColor: getTheme().surface.raised }]} />}
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTxt} numberOfLines={2}>{a.content || 'Post'}</Text>
                    <Text style={s.cardMeta}>{a.label} · {a.status} · {Number(a.impressions).toLocaleString()} views · {Number(a.clicks).toLocaleString()} clicks</Text>
                  </View>
                  <TouchableOpacity onPress={() => navigation.navigate('Post', { postId: a.post_id })} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="external-link" size={16} color={getTheme().ink.secondary} /></TouchableOpacity>
                  {c.status !== 'ended' ? <TouchableOpacity onPress={() => removeAd(a)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="x" size={16} color={getTheme().ink.secondary} /></TouchableOpacity> : null}
                </View>
              )) : null}
            </TouchableOpacity>
          )}
        />}

      <Sheet visible={open} title={f.id ? 'Edit campaign' : 'New campaign'} onClose={() => { if (!acting.current) setOpen(false); }} onSave={save} busy={busy} canSave={!!f.name.trim()}>
        <Text style={s.fieldLabel}>Name</Text>
        <TextInput value={f.name} onChangeText={v => setF({ ...f, name: v })} placeholder="Spring launch" placeholderTextColor={getTheme().ink.secondary} style={s.input} />
        <Text style={[s.fieldLabel, { marginTop: 14 }]}>Objective</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {OBJECTIVES.map(([k, l]) => <TouchableOpacity key={k} style={[s.catChip, f.objective === k && s.catChipOn]} onPress={() => setF({ ...f, objective: k })}><Text style={[s.catTxt, f.objective === k && s.catTxtOn]}>{l}</Text></TouchableOpacity>)}
        </View>
        <Text style={[s.fieldLabel, { marginTop: 14 }]}>Budget</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={f.currency} onChangeText={v => setF({ ...f, currency: v.toUpperCase().slice(0, 3) })} style={[s.input, { width: 72, textAlign: 'center' }]} autoCapitalize="characters" />
          <TextInput value={f.budget} onChangeText={v => setF({ ...f, budget: v.replace(/[^0-9.]/g, '') })} placeholder="0" placeholderTextColor={getTheme().ink.secondary} keyboardType="decimal-pad" style={[s.input, { flex: 1 }]} />
        </View>
        <Text style={[s.fieldLabel, { marginTop: 14 }]}>Paid with</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {METHODS.map(([k, l]) => <TouchableOpacity key={k} style={[s.catChip, { flex: 1, alignItems: 'center' }, f.payment_method === k && s.catChipOn]} onPress={() => setF({ ...f, payment_method: k })}><Text style={[s.catTxt, f.payment_method === k && s.catTxtOn]}>{l}</Text></TouchableOpacity>)}
        </View>
        <Text style={[s.fieldLabel, { marginTop: 14 }]}>Schedule</Text>
        <TextInput value={f.starts_at} onChangeText={v => setF({ ...f, starts_at: v })} placeholder="Start YYYY-MM-DD HH:mm" placeholderTextColor={getTheme().ink.secondary} style={s.input} autoCapitalize="none" autoCorrect={false} />
        <TextInput value={f.ends_at} onChangeText={v => setF({ ...f, ends_at: v })} placeholder="End YYYY-MM-DD HH:mm" placeholderTextColor={getTheme().ink.secondary} style={[s.input, { marginTop: 8 }]} autoCapitalize="none" autoCorrect={false} />
        <Text style={[s.cardMuted, { marginTop: 12 }]}>Add ads after saving. Submit for review once the campaign has a budget, a payment method and at least one ad.</Text>
      </Sheet>

      <Sheet visible={!!picking} title={'Add an ad to ' + (picking?.name || '')} onClose={() => { if (!acting.current) { ++postsRequest.current; setPicking(null); } }}>
        <StudioLoadError message={postsError} onRetry={() => { if (picking) void startPick(picking); }} busy={postsLoading} />
        {postsLoading ? <ActivityIndicator color={getTheme().ink.primary} /> : postsError ? null : posts.length === 0 ? <Text style={s.cardMuted}>No posts to promote yet. Post from the feed first.</Text> : posts.map(p => {
          const already = !!picking?.ads.some(a => a.post_id === p.id);
          return (
            <TouchableOpacity key={p.id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }, already && { opacity: 0.45 }]} disabled={already || busy} onPress={() => picking && addAd(picking, p.id)}>
              {p.thumb ? <ExpoImage source={{ uri: p.thumb }} style={s.thumbSm} contentFit="cover" /> : <View style={[s.thumbSm, { backgroundColor: getTheme().surface.raised }]} />}
              <View style={{ flex: 1 }}>
                <Text style={s.cardTxt} numberOfLines={2}>{p.content || 'Post'}</Text>
                <Text style={s.cardMeta}>{p.likes} likes{p.products ? ' · ' + p.products + ' product' + (p.products === 1 ? '' : 's') : ''}{already ? ' · already in campaign' : ''}</Text>
              </View>
              {!already ? <Feather name="plus-circle" size={18} color={getTheme().ink.primary} /> : null}
            </TouchableOpacity>
          );
        })}
      </Sheet>
    </View>
  );
}

const s = themedSheet((t) => ({
  center: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  h1: { fontSize: 20, fontWeight: '800', color: t.ink.primary },
  section: { fontSize: 11.5, fontWeight: '800', color: t.ink.secondary, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },
  card: { backgroundColor: t.surface.raised, borderRadius: 14, padding: 12, marginBottom: 8 },
  cardTxt: { fontSize: 14, color: t.ink.primary, lineHeight: 19 },
  cardMuted: { fontSize: 13, color: t.ink.secondary, lineHeight: 18 },
  cardMeta: { fontSize: 11.5, color: t.ink.secondary, marginTop: 3 },
  statLabel: { fontSize: 11.5, color: t.ink.secondary },
  statNum: { fontSize: 22, fontWeight: '800', color: t.ink.primary, marginTop: 2 },
  filterChip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, backgroundColor: t.surface.raised },
  filterChipOn: { backgroundColor: t.brand.base },
  filterTxt: { fontSize: 12.5, fontWeight: '700', color: t.ink.secondary },
  filterTxtOn: { color: t.ink.inverse },
  labelPill: { fontSize: 10.5, fontWeight: '700', color: t.ink.primary, backgroundColor: t.surface.hairline, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  statusPill: { fontSize: 10.5, fontWeight: '800' },
  thumbSm: { width: 44, height: 44, borderRadius: 8 },
  plusBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.brand.base, alignItems: 'center', justifyContent: 'center' },
  linkTxt: { fontSize: 12.5, fontWeight: '700', color: t.ink.primary },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  modalTitle: { fontSize: 16.5, fontWeight: '700', color: t.ink.primary, flex: 1, textAlign: 'center' },
  textArea: { backgroundColor: t.surface.raised, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5, color: t.ink.primary, minHeight: 110, textAlignVertical: 'top' },
  input: { backgroundColor: t.surface.raised, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: t.ink.primary },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: t.ink.secondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  primaryBtn: { marginTop: 16, backgroundColor: t.brand.base, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  primaryTxt: { color: t.ink.inverse, fontWeight: '700', fontSize: 15 },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface.raised, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16 },
  secondaryTxt: { color: t.ink.primary, fontWeight: '700', fontSize: 15 },
  toolChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surface.raised, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  toolTxt: { fontSize: 13, fontWeight: '700', color: t.ink.primary },
  catChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: t.surface.raised, borderWidth: 1, borderColor: t.surface.hairline },
  catChipOn: { backgroundColor: t.brand.base, borderColor: t.ink.primary },
  catTxt: { fontSize: 12.5, fontWeight: '600', color: t.ink.secondary },
  catTxtOn: { color: t.ink.inverse },
}));

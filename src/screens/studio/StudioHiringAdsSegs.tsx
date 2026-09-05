// src/screens/studio/StudioHiringAdsSegs.tsx
// Phone Studio Recruiter and Ads desks. Same RPC contracts as the web pages:
// studio_jobs / studio_applicants / studio_set_stage / studio_set_tags /
// studio_add_note / studio_schedule_interview / studio_close_job and
// studio_campaigns / studio_save_campaign / studio_submit_campaign /
// studio_set_campaign_status / studio_add_ad / studio_remove_ad /
// studio_my_posts_for_ads. Keyboard-safe, safe-area-aware, tab bar cleared.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ScrollView, ActivityIndicator, Modal, Alert, KeyboardAvoidingView, Platform, RefreshControl, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { supabase } from '../../services/supabase';

const NAVY = '#0B1E3D';
const TAB_CLEAR = 110;
const RECRUIT_ROLES = ['owner', 'admin', 'recruiter'];
const SPEND_ROLES = ['owner', 'admin'];
const AD_ROLES = ['owner', 'admin', 'editor'];
const STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const;
const OBJECTIVES: [string, string][] = [['reach', 'Reach'], ['traffic', 'Website visits'], ['messages', 'Messages'], ['storefront', 'Storefront visits'], ['applications', 'Job applications']];
const METHODS: [string, string][] = [['crisp', 'Crisp'], ['intobank', 'IntoBank']];

function whenLabel(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function parseLocal(s: string): Date | null {
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return isNaN(d.getTime()) ? null : d;
}
function fmtLocal(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function stageColor(st: string) {
  return st === 'hired' ? '#1C8C4E' : st === 'offer' ? '#B8860B' : st === 'interview' ? NAVY : st === 'rejected' ? '#D64545' : '#5B6B84';
}
function campaignColor(st: string) {
  return st === 'live' ? '#1C8C4E' : st === 'approved' ? '#B8860B' : st === 'submitted' ? NAVY : st === 'rejected' ? '#D64545' : '#5B6B84';
}

function Avatar({ uri, name, size = 38 }: { uri?: string | null; name?: string | null; size?: number }) {
  if (uri) return <ExpoImage source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />;
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#FFF', fontWeight: '700' }}>{(name || '?').trim()[0]?.toUpperCase() || '?'}</Text></View>;
}
function BackRow({ title, label, onBack, right, sub }: { title: string; label: string; onBack: () => void; right?: React.ReactNode; sub?: string }) {
  return (
    <>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingTop: 12 }}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        <Feather name="chevron-left" size={20} color={NAVY} /><Text style={{ fontSize: 14, fontWeight: '700', color: NAVY }}>{label}</Text>
      </TouchableOpacity>
      <Text style={[s.h1, { marginLeft: 6, flex: 1 }]} numberOfLines={1}>{title}</Text>
      {right}
    </View>
    {sub ? <Text style={{ fontSize: 12.5, color: '#8E8E93', paddingHorizontal: 16, marginTop: 4, lineHeight: 17 }}>{sub}</Text> : null}
    </>
  );
}
function Sheet({ visible, title, onClose, onSave, saveLabel, busy, canSave, children }: { visible: boolean; title: string; onClose: () => void; onSave?: () => void; saveLabel?: string; busy?: boolean; canSave?: boolean; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#FFF' }}>
        <View style={[s.modalHeader, { paddingTop: Platform.OS === 'ios' ? 14 : insets.top + 8 }]}>
          <TouchableOpacity onPress={onClose} style={{ width: 70 }}><Text style={{ fontSize: 16, color: '#8E8E93' }}>Cancel</Text></TouchableOpacity>
          <Text style={s.modalTitle} numberOfLines={1}>{title}</Text>
          {onSave ? <TouchableOpacity onPress={onSave} disabled={busy || canSave === false} style={{ width: 70, alignItems: 'flex-end' }}><Text style={{ fontSize: 15, fontWeight: '700', color: NAVY, opacity: busy || canSave === false ? 0.4 : 1 }}>{saveLabel || 'Save'}</Text></TouchableOpacity> : <View style={{ width: 70 }} />}
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
  const can = !!role && RECRUIT_ROLES.includes(role);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [apps, setApps] = useState<Applicant[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [sel, setSel] = useState<Applicant | null>(null);
  const [note, setNote] = useState('');
  const [ivAt, setIvAt] = useState('');
  const [ivLoc, setIvLoc] = useState('');
  const [tagText, setTagText] = useState('');
  const [busy, setBusy] = useState(false);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try { const { data } = await supabase.rpc('studio_jobs'); setJobs(((data as any[]) || []) as Job[]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (can) void loadJobs(); else setLoading(false); }, [can, loadJobs]);

  const loadApps = useCallback(async (j: Job) => {
    setAppsLoading(true);
    try { const { data } = await supabase.rpc('studio_applicants', { p_job: j.id }); setApps(((data as any[]) || []) as Applicant[]); }
    finally { setAppsLoading(false); }
  }, []);
  useEffect(() => { if (job) void loadApps(job); }, [job, loadApps]);
  useEffect(() => { if (sel) { setIvAt(fmtLocal(sel.interview_at)); setIvLoc(sel.interview_location || ''); setTagText(sel.tags.join(', ')); setNote(''); } }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => PromiseLike<any>, then?: () => void) => {
    if (busy) return;
    setBusy(true);
    try { const r = await fn(); if (r?.error) throw r.error; if (job) await loadApps(job); await loadJobs(); then?.(); }
    catch (e: any) { Alert.alert('Could not update', e?.message || 'Please try again.'); }
    finally { setBusy(false); }
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
    Alert.alert('Move ' + a.name, 'Current stage: ' + a.status, [
      ...STAGES.filter(st => st !== a.status).map(st => ({ text: st.charAt(0).toUpperCase() + st.slice(1), style: st === 'rejected' ? 'destructive' as const : 'default' as const, onPress: () => act(() => supabase.rpc('studio_set_stage', { p_application: a.id, p_status: st })) })),
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (!can) return <View style={{ flex: 1 }}><BackRow title="Recruiter" label="More" onBack={onBack} /><View style={[s.card, { margin: 16 }]}><Text style={s.cardMuted}>Recruiter is open to owners, admins and recruiters.</Text></View></View>;

  if (job) {
    const shown = apps.filter(a => !stage || a.status === stage);
    return (
      <View style={{ flex: 1 }}>
        <BackRow title={job.title} label="Jobs" onBack={() => { setJob(null); setApps([]); setStage(null); }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }} style={{ flexGrow: 0 }}>
          <TouchableOpacity style={[s.filterChip, !stage && s.filterChipOn]} onPress={() => setStage(null)}><Text style={[s.filterTxt, !stage && s.filterTxtOn]}>All · {apps.length}</Text></TouchableOpacity>
          {STAGES.map(st => { const n = apps.filter(a => a.status === st).length; return (
            <TouchableOpacity key={st} style={[s.filterChip, stage === st && s.filterChipOn]} onPress={() => setStage(stage === st ? null : st)}><Text style={[s.filterTxt, stage === st && s.filterTxtOn]}>{st.charAt(0).toUpperCase() + st.slice(1)}{n ? ' · ' + n : ''}</Text></TouchableOpacity>
          ); })}
        </ScrollView>
        {appsLoading && apps.length === 0 ? <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={NAVY} /></View>
        : <FlatList data={shown} keyExtractor={a => a.id} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: TAB_CLEAR }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadApps(job); setRefreshing(false); }} />}
            ListEmptyComponent={<View style={s.card}><Text style={s.cardMuted}>{stage ? 'Nobody at this stage.' : 'No applications yet.'}</Text></View>}
            renderItem={({ item: a }) => (
              <TouchableOpacity style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }]} onPress={() => setSel(a)} activeOpacity={0.85}>
                <Avatar uri={a.avatar_url} name={a.name} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[s.cardTxt, { fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>{a.name}</Text>
                    <Text style={[s.statusPill, { color: stageColor(a.status) }]}>{a.status.toUpperCase()}</Text>
                  </View>
                  <Text style={s.cardMeta} numberOfLines={1}>Applied {whenLabel(a.applied_at)}{a.location ? ' · ' + a.location : ''}{a.interview_at ? ' · interview ' + whenLabel(a.interview_at) : ''}</Text>
                  {a.tags.length ? <Text style={[s.cardMeta, { color: NAVY }]} numberOfLines={1}>{a.tags.join(' · ')}</Text> : null}
                </View>
                <Feather name="chevron-right" size={16} color="#8E8E93" />
              </TouchableOpacity>
            )}
          />}
        <Sheet visible={!!sel} title={sel?.name || 'Applicant'} onClose={() => setSel(null)}>
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
                <TouchableOpacity style={s.toolChip} onPress={() => moveStage(sel)} disabled={busy}><Feather name="arrow-right-circle" size={14} color={NAVY} /><Text style={s.toolTxt}>Move stage</Text></TouchableOpacity>
                <TouchableOpacity style={s.toolChip} onPress={() => navigation.navigate('UserProfile', { userId: sel.applicant_id })}><Feather name="user" size={14} color={NAVY} /><Text style={s.toolTxt}>Profile</Text></TouchableOpacity>
                {sel.cv_url ? <TouchableOpacity style={s.toolChip} onPress={() => Linking.openURL(sel.cv_url!)}><Feather name="file-text" size={14} color={NAVY} /><Text style={s.toolTxt}>{sel.cv_name || 'CV'}</Text></TouchableOpacity> : null}
                {sel.portfolio_url ? <TouchableOpacity style={s.toolChip} onPress={() => Linking.openURL(sel.portfolio_url!)}><Feather name="link" size={14} color={NAVY} /><Text style={s.toolTxt}>Portfolio</Text></TouchableOpacity> : null}
                {sel.phone ? <TouchableOpacity style={s.toolChip} onPress={() => Linking.openURL('tel:' + sel.phone)}><Feather name="phone" size={14} color={NAVY} /><Text style={s.toolTxt}>{sel.phone}</Text></TouchableOpacity> : null}
              </View>
              {sel.cover_note || sel.cover_letter ? <View style={[s.card, { marginTop: 14 }]}><Text style={s.fieldLabel}>Cover note</Text><Text style={s.cardTxt}>{sel.cover_note || sel.cover_letter}</Text></View> : null}
              {sel.bio ? <View style={s.card}><Text style={s.fieldLabel}>Bio</Text><Text style={s.cardTxt}>{sel.bio}</Text></View> : null}

              <Text style={s.section}>Interview</Text>
              <TextInput value={ivAt} onChangeText={setIvAt} placeholder="YYYY-MM-DD HH:mm" placeholderTextColor="#9AA0A6" style={s.input} autoCapitalize="none" autoCorrect={false} />
              <TextInput value={ivLoc} onChangeText={setIvLoc} placeholder="Location or link" placeholderTextColor="#9AA0A6" style={[s.input, { marginTop: 8 }]} autoCapitalize="none" autoCorrect={false} />
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <TouchableOpacity style={[s.primaryBtn, { flex: 1, marginTop: 0 }, (busy || !ivAt.trim()) && { opacity: 0.4 }]} disabled={busy || !ivAt.trim()} onPress={() => { const d = parseLocal(ivAt); if (!d) { Alert.alert('Check the date', 'Use YYYY-MM-DD HH:mm'); return; } void act(() => supabase.rpc('studio_schedule_interview', { p_application: sel.id, p_at: d.toISOString(), p_location: ivLoc.trim() || null })); }}><Text style={s.primaryTxt}>Schedule</Text></TouchableOpacity>
                {sel.interview_at ? <TouchableOpacity style={[s.secondaryBtn, { justifyContent: 'center' }]} disabled={busy} onPress={() => act(() => supabase.rpc('studio_schedule_interview', { p_application: sel.id, p_at: null, p_location: null }))}><Text style={[s.secondaryTxt, { color: '#D64545' }]}>Clear</Text></TouchableOpacity> : null}
              </View>

              <Text style={s.section}>Tags</Text>
              <TextInput value={tagText} onChangeText={setTagText} placeholder="senior, remote, shortlist" placeholderTextColor="#9AA0A6" style={s.input} autoCapitalize="none" onBlur={() => act(() => supabase.rpc('studio_set_tags', { p_application: sel.id, p_tags: tagText.split(',').map(t => t.trim()).filter(Boolean) }))} />

              <Text style={s.section}>Team notes</Text>
              {sel.notes.length === 0 ? <Text style={s.cardMuted}>No notes yet.</Text> : sel.notes.map(n => (
                <View key={n.id} style={s.card}><Text style={s.cardTxt}>{n.body}</Text><Text style={s.cardMeta}>{n.author || 'Team'} · {whenLabel(n.created_at)}</Text></View>
              ))}
              <TextInput value={note} onChangeText={setNote} placeholder="Add a note for the team" placeholderTextColor="#9AA0A6" multiline style={[s.textArea, { minHeight: 80, marginTop: 6 }]} />
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
      {loading ? <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={NAVY} /></View>
      : <FlatList data={jobs} keyExtractor={j => j.id} contentContainerStyle={{ padding: 16, paddingBottom: TAB_CLEAR }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await loadJobs(); setRefreshing(false); }} />}
          ListEmptyComponent={<View style={s.card}><Text style={s.cardMuted}>No jobs posted by this business yet. Post one from the Jobs tab and applicants land here.</Text></View>}
          renderItem={({ item: j }) => (
            <TouchableOpacity style={[s.card, j.closed && { opacity: 0.6 }]} onPress={() => setJob(j)} onLongPress={() => jobActions(j)} activeOpacity={0.85}>
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
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Form>(emptyForm());
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [picking, setPicking] = useState<Campaign | null>(null);
  const [posts, setPosts] = useState<{ id: string; content: string; thumb: string | null; products: number; likes: number }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await supabase.rpc('studio_campaigns'); setRows(((data as any[]) || []) as Campaign[]); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (canSee) void load(); else setLoading(false); }, [canSee, load]);

  const act = async (fn: () => PromiseLike<any>, then?: () => void) => {
    if (busy) return;
    setBusy(true);
    try { const r = await fn(); if (r?.error) throw r.error; await load(); then?.(); }
    catch (e: any) { Alert.alert('Could not update', e?.message || 'Please try again.'); }
    finally { setBusy(false); }
  };
  const openEdit = (c: Campaign) => { setF({ id: c.id, name: c.name, objective: c.objective, budget: String(c.budget || ''), currency: c.currency, payment_method: c.payment_method || '', starts_at: fmtLocal(c.starts_at), ends_at: fmtLocal(c.ends_at) }); setOpen(true); };
  const save = () => {
    const st = f.starts_at.trim() ? parseLocal(f.starts_at) : null;
    const en = f.ends_at.trim() ? parseLocal(f.ends_at) : null;
    if ((f.starts_at.trim() && !st) || (f.ends_at.trim() && !en)) { Alert.alert('Check the dates', 'Use YYYY-MM-DD HH:mm'); return; }
    void act(() => supabase.rpc('studio_save_campaign', { p_id: f.id, p_name: f.name.trim(), p_objective: f.objective, p_budget: Number(f.budget || 0), p_currency: f.currency, p_payment_method: f.payment_method || null, p_starts_at: st ? st.toISOString() : null, p_ends_at: en ? en.toISOString() : null }), () => { setOpen(false); setF(emptyForm()); });
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
    setPicking(c);
    const { data } = await supabase.rpc('studio_my_posts_for_ads', { p_limit: 60 });
    setPosts(((data as any[]) || []) as any);
  };
  const addAd = (c: Campaign, postId: string) => act(() => supabase.rpc('studio_add_ad', { p_campaign: c.id, p_post_id: postId, p_label: 'Sponsored', p_total_cap: null }), () => setPicking(null));
  const removeAd = (a: Ad) => Alert.alert('Remove this ad?', a.content || 'Post', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => act(() => supabase.rpc('studio_remove_ad', { p_promo: a.id })) }]);

  const totals = useMemo(() => rows.reduce((t, c) => ({ imp: t.imp + Number(c.impressions || 0), clk: t.clk + Number(c.clicks || 0), live: t.live + (c.status === 'live' ? 1 : 0) }), { imp: 0, clk: 0, live: 0 }), [rows]);

  if (!canSee) return <View style={{ flex: 1 }}><BackRow title="Ads" label="More" onBack={onBack} /><View style={[s.card, { margin: 16 }]}><Text style={s.cardMuted}>Ads is open to owners, admins and editors.</Text></View></View>;

  return (
    <View style={{ flex: 1 }}>
      <BackRow title="Ads" sub="Campaigns with an objective, budget and schedule. Ads inside them run as Sponsored posts once the campaign is approved and live." label="More" onBack={onBack} right={canSpend ? <TouchableOpacity style={s.plusBtn} onPress={() => { setF(emptyForm()); setOpen(true); }}><Feather name="plus" size={18} color="#FFF" /></TouchableOpacity> : null} />
      {loading ? <View style={[s.center, { flex: 1 }]}><ActivityIndicator color={NAVY} /></View>
      : <FlatList data={rows} keyExtractor={c => c.id} contentContainerStyle={{ padding: 16, paddingBottom: TAB_CLEAR }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
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
                  {a.thumb ? <ExpoImage source={{ uri: a.thumb }} style={s.thumbSm} contentFit="cover" /> : <View style={[s.thumbSm, { backgroundColor: '#E5E5EA' }]} />}
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTxt} numberOfLines={2}>{a.content || 'Post'}</Text>
                    <Text style={s.cardMeta}>{a.label} · {a.status} · {Number(a.impressions).toLocaleString()} views · {Number(a.clicks).toLocaleString()} clicks</Text>
                  </View>
                  <TouchableOpacity onPress={() => navigation.navigate('Post', { postId: a.post_id })} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="external-link" size={16} color="#8E8E93" /></TouchableOpacity>
                  {c.status !== 'ended' ? <TouchableOpacity onPress={() => removeAd(a)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Feather name="x" size={16} color="#8E8E93" /></TouchableOpacity> : null}
                </View>
              )) : null}
            </TouchableOpacity>
          )}
        />}

      <Sheet visible={open} title={f.id ? 'Edit campaign' : 'New campaign'} onClose={() => setOpen(false)} onSave={save} busy={busy} canSave={!!f.name.trim()}>
        <Text style={s.fieldLabel}>Name</Text>
        <TextInput value={f.name} onChangeText={v => setF({ ...f, name: v })} placeholder="Spring launch" placeholderTextColor="#9AA0A6" style={s.input} />
        <Text style={[s.fieldLabel, { marginTop: 14 }]}>Objective</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {OBJECTIVES.map(([k, l]) => <TouchableOpacity key={k} style={[s.catChip, f.objective === k && s.catChipOn]} onPress={() => setF({ ...f, objective: k })}><Text style={[s.catTxt, f.objective === k && s.catTxtOn]}>{l}</Text></TouchableOpacity>)}
        </View>
        <Text style={[s.fieldLabel, { marginTop: 14 }]}>Budget</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInput value={f.currency} onChangeText={v => setF({ ...f, currency: v.toUpperCase().slice(0, 3) })} style={[s.input, { width: 72, textAlign: 'center' }]} autoCapitalize="characters" />
          <TextInput value={f.budget} onChangeText={v => setF({ ...f, budget: v.replace(/[^0-9.]/g, '') })} placeholder="0" placeholderTextColor="#9AA0A6" keyboardType="decimal-pad" style={[s.input, { flex: 1 }]} />
        </View>
        <Text style={[s.fieldLabel, { marginTop: 14 }]}>Paid with</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {METHODS.map(([k, l]) => <TouchableOpacity key={k} style={[s.catChip, { flex: 1, alignItems: 'center' }, f.payment_method === k && s.catChipOn]} onPress={() => setF({ ...f, payment_method: k })}><Text style={[s.catTxt, f.payment_method === k && s.catTxtOn]}>{l}</Text></TouchableOpacity>)}
        </View>
        <Text style={[s.fieldLabel, { marginTop: 14 }]}>Schedule</Text>
        <TextInput value={f.starts_at} onChangeText={v => setF({ ...f, starts_at: v })} placeholder="Start YYYY-MM-DD HH:mm" placeholderTextColor="#9AA0A6" style={s.input} autoCapitalize="none" autoCorrect={false} />
        <TextInput value={f.ends_at} onChangeText={v => setF({ ...f, ends_at: v })} placeholder="End YYYY-MM-DD HH:mm" placeholderTextColor="#9AA0A6" style={[s.input, { marginTop: 8 }]} autoCapitalize="none" autoCorrect={false} />
        <Text style={[s.cardMuted, { marginTop: 12 }]}>Add ads after saving. Submit for review once the campaign has a budget, a payment method and at least one ad.</Text>
      </Sheet>

      <Sheet visible={!!picking} title={'Add an ad to ' + (picking?.name || '')} onClose={() => setPicking(null)}>
        {posts.length === 0 ? <Text style={s.cardMuted}>No posts to promote yet. Post from the feed first.</Text> : posts.map(p => {
          const already = !!picking?.ads.some(a => a.post_id === p.id);
          return (
            <TouchableOpacity key={p.id} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }, already && { opacity: 0.45 }]} disabled={already || busy} onPress={() => picking && addAd(picking, p.id)}>
              {p.thumb ? <ExpoImage source={{ uri: p.thumb }} style={s.thumbSm} contentFit="cover" /> : <View style={[s.thumbSm, { backgroundColor: '#E5E5EA' }]} />}
              <View style={{ flex: 1 }}>
                <Text style={s.cardTxt} numberOfLines={2}>{p.content || 'Post'}</Text>
                <Text style={s.cardMeta}>{p.likes} likes{p.products ? ' · ' + p.products + ' product' + (p.products === 1 ? '' : 's') : ''}{already ? ' · already in campaign' : ''}</Text>
              </View>
              {!already ? <Feather name="plus-circle" size={18} color={NAVY} /> : null}
            </TouchableOpacity>
          );
        })}
      </Sheet>
    </View>
  );
}

const s = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  h1: { fontSize: 20, fontWeight: '800', color: '#0F1419' },
  section: { fontSize: 11.5, fontWeight: '800', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 8 },
  card: { backgroundColor: '#F8F9FB', borderRadius: 14, padding: 12, marginBottom: 8 },
  cardTxt: { fontSize: 14, color: '#0F1419', lineHeight: 19 },
  cardMuted: { fontSize: 13, color: '#8E8E93', lineHeight: 18 },
  cardMeta: { fontSize: 11.5, color: '#8E8E93', marginTop: 3 },
  statLabel: { fontSize: 11.5, color: '#8E8E93' },
  statNum: { fontSize: 22, fontWeight: '800', color: '#0F1419', marginTop: 2 },
  filterChip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, backgroundColor: '#F2F2F7' },
  filterChipOn: { backgroundColor: NAVY },
  filterTxt: { fontSize: 12.5, fontWeight: '700', color: '#5B6B84' },
  filterTxtOn: { color: '#FFF' },
  labelPill: { fontSize: 10.5, fontWeight: '700', color: NAVY, backgroundColor: 'rgba(11,30,61,0.08)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  statusPill: { fontSize: 10.5, fontWeight: '800' },
  thumbSm: { width: 44, height: 44, borderRadius: 8 },
  plusBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  linkTxt: { fontSize: 12.5, fontWeight: '700', color: NAVY },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA' },
  modalTitle: { fontSize: 16.5, fontWeight: '700', color: '#0F1419', flex: 1, textAlign: 'center' },
  textArea: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5, color: '#0F1419', minHeight: 110, textAlignVertical: 'top' },
  input: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#0F1419' },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  primaryBtn: { marginTop: 16, backgroundColor: NAVY, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  primaryTxt: { color: '#FFF', fontWeight: '700', fontSize: 15 },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F2F2F7', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16 },
  secondaryTxt: { color: NAVY, fontWeight: '700', fontSize: 15 },
  toolChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F2F2F7', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  toolTxt: { fontSize: 13, fontWeight: '700', color: NAVY },
  catChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: '#E5E5EA' },
  catChipOn: { backgroundColor: NAVY, borderColor: NAVY },
  catTxt: { fontSize: 12.5, fontWeight: '600', color: '#5B6B84' },
  catTxtOn: { color: '#FFF' },
});

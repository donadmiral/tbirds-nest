import { applicationCvUrl } from '../../services/applicationCvService';
import { ListRowSkeleton } from '../../components/skeletons';
import { themedSheet, getTheme, useTheme } from '../../theme/useTheme';
import EmptyState from '../../components/EmptyState';
import TierName from '../../components/TierName';
import VerifiedBadge from '../../components/VerifiedBadge';
/**
 * ApplicantsScreen — the poster's side of a job.
 * Handshake model: every applicant with profile, note and applied time,
 * filterable by status. Changing a status writes job_applications.status,
 * so applicants can follow their progress in My applications.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Image,
  Alert, ActivityIndicator, StatusBar, Linking, Modal, ScrollView, TextInput,
} from 'react-native';
import { SafeAreaView } from '../../components/SafeArea';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { jobsService, JobApplication, ApplicationStatus, STATUS_META, APPLICATION_STATUS_ORDER } from '../../services/jobsService';

import { loadApplicantPage, mergeApplicants, saveApplicationStatus, saveInterview, type ApplicantCursor } from '../../../shared/hiring';

const NAVY = '#0B1E3D';

const STATUS_ORDER = APPLICATION_STATUS_ORDER;

function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 1) return 'now'; if (m < 60) return m + 'm'; if (h < 24) return h + 'h';
  if (dy < 7) return dy + 'd';
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ApplicantsScreen() {
  const { isDark } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const userId = useAuthStore(st => st.profile?.id);
  const job = route.params?.job;

  const [apps, setApps] = useState<JobApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | ApplicationStatus>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sheetApp, setSheetApp] = useState<JobApplication | null>(null);
  const [ivAt, setIvAt] = useState('');
  const [ivLoc, setIvLoc] = useState('');
  const [sheetProfile, setSheetProfile] = useState<any>(null);
  const pendingStatuses = useRef(new Set<string>());
  const [statusApp, setStatusApp] = useState<JobApplication | null>(null);

  const generation = useRef(0);
  const sheetGeneration = useRef(0);
  const [counts, setCounts] = useState<Record<string, number>>({ all: 0 });
  const [cursor, setCursor] = useState<ApplicantCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const morePending = useRef(false);
  const load = useCallback(async () => {
    const token = ++generation.current;
    setLoading(true); setErr(null); setApps([]); setCounts({ all: 0 }); setCursor(null);
    morePending.current = false; setLoadingMore(false);
    if (!job?.id || !userId) { setErr('This job is unavailable. Sign in and reopen the job.'); setLoading(false); return; }
    try {
      const page = await loadApplicantPage<JobApplication>(supabase, job.id, filter);
      if (token !== generation.current) return;
      setApps(page.applications); setCounts(page.counts); setCursor(page.has_more ? page.cursor : null);
    } catch (e: any) { if (token === generation.current) setErr(e?.message || 'Could not load applicants'); }
    finally { if (token === generation.current) setLoading(false); }
  }, [job?.id, userId, filter]);
  useEffect(() => {
    setSheetApp(null); setSheetProfile(null); setStatusApp(null); setIvAt(''); setIvLoc(''); ++sheetGeneration.current;
    void load();
    return () => { ++generation.current; ++sheetGeneration.current; };
  }, [load]);
  const loadMore = async () => {
    if (!cursor || morePending.current) return;
    const token = generation.current;
    morePending.current = true; setLoadingMore(true);
    try {
      const page = await loadApplicantPage<JobApplication>(supabase, job.id, filter, cursor);
      if (token !== generation.current) return;
      setApps(rows => mergeApplicants(rows, page.applications)); setCounts(page.counts); setCursor(page.has_more ? page.cursor : null);
    } catch (e: any) { if (token === generation.current) Alert.alert('Could not load more applicants', e?.message || 'Please try again.'); }
    finally { if (token === generation.current) { morePending.current = false; setLoadingMore(false); } }
  };
  const shown = apps;

  const openSheet = useCallback(async (app: JobApplication) => {
    const request = ++sheetGeneration.current, token = generation.current;
    setSheetApp(app); setIvAt(''); setIvLoc('');
    setSheetProfile(null);
    try {
      const { data } = await supabase.from('profiles')
        .select('id, full_name, username, avatar_url, headline, bio, location, workplace')
        .eq('id', app.applicant_id).maybeSingle();
      if (request === sheetGeneration.current && token === generation.current) setSheetProfile(data ?? null);
    } catch {}
  }, []);

  const setStatus = useCallback((app: JobApplication) => {
    if (app.status === 'withdrawn' || pendingStatuses.current.has(app.id)) return;
    setStatusApp(app);
  }, []);

  const updateStatus = useCallback(async (app: JobApplication, status: ApplicationStatus) => {
    if (app.status === 'withdrawn' || status === 'withdrawn' || pendingStatuses.current.has(app.id)) return;
    if (status === 'interview') { setStatusApp(null); void openSheet(app); return; }
    const token = generation.current;
    pendingStatuses.current.add(app.id); setStatusApp(null);
    try {
      await saveApplicationStatus(supabase, app, status);
      if (token === generation.current) void load();
    } catch (e: any) { if (token === generation.current) Alert.alert('Could not update', e?.message || 'Please try again.'); }
    finally { pendingStatuses.current.delete(app.id); }
  }, [load, openSheet]);

  const messageApplicant = useCallback(async (app: JobApplication) => {
    if (!userId || !app.applicant_id) return;
    const token = generation.current;
    try {
      const { data: convId, error } = await supabase.rpc('start_dm_ctx', { p_receiver_id: app.applicant_id, p_context: 'jobs', p_ref_id: job.id });
      if (error || !convId) throw error || new Error('Could not start conversation');
      if (token !== generation.current) return;
      navigation.navigate('Chat', {
        conversationId: convId,
        userId: app.applicant_id,
        userName: app.applicant?.full_name || 'Applicant',
        otherUser: {
          id: app.applicant_id,
          full_name: app.applicant?.full_name || 'Applicant',
          username: app.applicant?.username || null,
          avatar_url: app.applicant?.avatar_url || null,
        },
      });
    } catch (e: any) { Alert.alert('Error', e?.message || 'Could not open conversation'); }
  }, [userId, job?.id, navigation]);

  const renderRow = ({ item }: { item: JobApplication }) => {
    const a: any = item.applicant || {};
    const meta = STATUS_META[item.status] || STATUS_META.applied;
    const open = expanded.has(item.id);
    const note = item.cover_note || item.cover_letter;
    return (
      <View style={st.row}>
        <TouchableOpacity style={st.rowHead} activeOpacity={0.8}
          onPress={() => openSheet(item)}>
          {a.avatar_url
            ? <Image source={{ uri: a.avatar_url }} style={st.av} />
            : <View style={[st.av, st.avFb]}><Text style={st.avTxt}>{String(a.full_name || '?').slice(0, 1).toUpperCase()}</Text></View>}
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TierName userId={(a as any).id} baseStyle={[st.name, { flexShrink: 1 }]} text={a.full_name || 'Applicant'} />
              <VerifiedBadge userId={(a as any).id} size={13} />
            </View>
            <Text style={st.sub} numberOfLines={1}>{a.username ? '@' + a.username + ' · ' : ''}applied {relTime(item.applied_at)}</Text>
          </View>
          <TouchableOpacity style={[st.statusChip, { backgroundColor: meta.bg }]} disabled={item.status === 'withdrawn'} onPress={() => setStatus(item)} activeOpacity={0.8}>
            <Text style={[st.statusTxt, { color: meta.color }]}>{meta.label}</Text>
            <Feather name="chevron-down" size={12} color={meta.color} />
          </TouchableOpacity>
        </TouchableOpacity>

        {note ? (
          <TouchableOpacity activeOpacity={0.85}
            onPress={() => setExpanded(prev => { const n = new Set(prev); if (n.has(item.id)) n.delete(item.id); else n.add(item.id); return n; })}>
            <Text style={st.note} numberOfLines={open ? undefined : 2}>{note}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={st.noNote}>No note attached</Text>
        )}

        <View style={st.actions}>
          <TouchableOpacity style={st.actionBtn} onPress={() => messageApplicant(item)} activeOpacity={0.8}>
            <Feather name="message-circle" size={14} color={getTheme().ink.primary} />
            <Text style={st.actionTxt}>Message</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.actionBtn} activeOpacity={0.8}
            onPress={() => a.id && navigation.navigate('UserProfile', { userId: a.id })}>
            <Feather name="user" size={14} color={getTheme().ink.primary} />
            <Text style={st.actionTxt}>Profile</Text>
          </TouchableOpacity>
        {(item as any).cv_url ? (
            <TouchableOpacity style={st.actionBtn} activeOpacity={0.8}
              onPress={() => applicationCvUrl((item as any).cv_url, (item as any).cv_name).then(url => Linking.openURL(url)).catch((e) => Alert.alert('Could not open CV', e?.message || 'Please try again.'))}>
              <Feather name="file-text" size={14} color="#059669" />
              <Text style={[st.actionTxt, { color: '#059669' }]} numberOfLines={1}>{(item as any).cv_name || 'CV'}</Text>
            </TouchableOpacity>
          ) : null}

        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={getTheme().surface.canvas} />
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color={getTheme().ink.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginHorizontal: 10 }}>
          <Text style={st.headerTitle} numberOfLines={1}>{job?.title || 'Applicants'}</Text>
          <Text style={st.headerSub}>{counts.all ?? 0} {counts.all === 1 ? 'applicant' : 'applicants'}</Text>
        </View>
        <View style={{ width: 26 }} />
      </View>

      <View style={st.filterRow}>
        <FlatList
          horizontal showsHorizontalScrollIndicator={false}
          data={(['all', ...STATUS_ORDER] as const).filter(fk => fk === 'all' || (counts[fk] ?? 0) > 0)}
          keyExtractor={fk => fk}
          contentContainerStyle={{ paddingHorizontal: 14, gap: 8 }}
          renderItem={({ item: fk }) => (
            <TouchableOpacity style={[st.filterPill, filter === fk && st.filterPillOn]} onPress={() => { if (fk !== filter) { ++generation.current; setFilter(fk as any); } }} activeOpacity={0.8}>
              <Text style={[st.filterTxt, filter === fk && st.filterTxtOn]}>
                {fk === 'all' ? 'All' : STATUS_META[fk as ApplicationStatus].label} {counts[fk] ?? 0}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {loading ? (
        <ListRowSkeleton />
      ) : err ? (
        <View style={st.center}>
          <Text style={st.errTxt}>{err}</Text>
          <TouchableOpacity style={st.retry} onPress={load}><Text style={st.retryTxt}>Try again</Text></TouchableOpacity>
        </View>
      ) : shown.length === 0 ? (
        <View style={st.center}>
          <Feather name="users" size={36} color="#C7CDD6" />
          <Text style={st.emptyTitle}>{filter === 'all' ? 'No applicants yet' : 'Nobody in ' + STATUS_META[filter as ApplicationStatus].label}</Text>
          <Text style={st.emptySub}>{filter === 'all' ? 'Applications will appear here as they come in.' : 'Move applicants here from their status chip.'}</Text>
        </View>
      ) : (
        <FlatList
 ListEmptyComponent={<EmptyState icon="users" title="No applicants yet" line="People who apply appear here with their CV and note." />}
          data={shown}
          keyExtractor={i => i.id}
          renderItem={renderRow}
          contentContainerStyle={{ padding: 14, paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={cursor ? <TouchableOpacity disabled={loadingMore} style={st.retry} onPress={() => { void loadMore(); }}><Text style={st.retryTxt}>{loadingMore ? 'Loading…' : 'Load more applicants'}</Text></TouchableOpacity> : null}
        />
      )}
      <Modal visible={!!statusApp} animationType="slide" transparent onRequestClose={() => setStatusApp(null)}>
        <TouchableOpacity style={sh.scrim} activeOpacity={1} onPress={() => setStatusApp(null)}>
          <TouchableOpacity style={sh.card} activeOpacity={1} onPress={() => {}}>
            <ScrollView contentContainerStyle={{ paddingBottom: 26 }}>
              <View style={sh.grab} />
              <Text style={sh.name}>Update application status</Text>
              <Text style={sh.applied}>{statusApp?.applicant?.full_name || 'Applicant'}</Text>
              <View style={sh.actionsWrap}>
                {STATUS_ORDER.filter(status => status !== 'withdrawn').map(status => (
                  <TouchableOpacity key={status} style={sh.bigBtn} accessibilityRole="button"
                    accessibilityState={{ selected: statusApp?.status === status }}
                    disabled={!statusApp || statusApp.status === status || statusApp.status === 'withdrawn'}
                    onPress={() => { if (statusApp) void updateStatus(statusApp, status); }}>
                    <Text style={[sh.bigBtnTxt, { color: STATUS_META[status].color }]}>{STATUS_META[status].label}</Text>
                    {statusApp?.status === status ? <Feather name="check" size={16} color={STATUS_META[status].color} /> : null}
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={[sh.bigBtn, { marginTop: 14 }]} onPress={() => setStatusApp(null)} accessibilityRole="button">
                <Text style={sh.bigBtnTxt}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
<Modal visible={!!sheetApp} animationType="slide" transparent onRequestClose={() => { ++sheetGeneration.current; setSheetApp(null); }}>
        <TouchableOpacity style={sh.scrim} activeOpacity={1} onPress={() => { ++sheetGeneration.current; setSheetApp(null); }}>
          <TouchableOpacity activeOpacity={1} style={sh.card} onPress={() => {}}>
            {sheetApp && (() => {
              const a: any = sheetApp.applicant || {};
              const p: any = sheetProfile || {};
              const meta = STATUS_META[sheetApp.status] || STATUS_META.applied;
              const note = sheetApp.cover_note || sheetApp.cover_letter;
              return (
                <ScrollView automaticallyAdjustKeyboardInsets={true} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 26 }}>
                  <View style={sh.grab} />
                  <View style={sh.head}>
                    {a.avatar_url
                      ? <Image source={{ uri: a.avatar_url }} style={sh.av} />
                      : <View style={[sh.av, sh.avFb]}><Text style={sh.avTxt}>{String(a.full_name || '?').slice(0, 1).toUpperCase()}</Text></View>}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={sh.name} numberOfLines={1}><TierName userId={((a) as any)?.id ?? ((a) as any)?.user_id} baseStyle={sh.name} text={a.full_name || 'Applicant' || ''} numberOfLines={1} /> <VerifiedBadge userId={((a) as any)?.id ?? ((a) as any)?.user_id} size={12} /></Text>
                      {p.headline ? <Text style={sh.headline} numberOfLines={2}>{p.headline}</Text> : null}
                      <Text style={sh.applied}>Applied {relTime(sheetApp.applied_at)}</Text>
                    </View>
                    <TouchableOpacity style={[sh.statusChip, { backgroundColor: meta.bg }]} disabled={sheetApp.status === 'withdrawn'} onPress={() => { const cur = sheetApp; setSheetApp(null); setTimeout(() => setStatus(cur), 350); }} activeOpacity={0.8}>
                      <Text style={[sh.statusTxt, { color: meta.color }]}>{meta.label}</Text>
                      <Feather name="chevron-down" size={12} color={meta.color} />
                    </TouchableOpacity>
                  </View>

                  {(p.location || p.workplace) ? (
                    <View style={sh.metaRow}>
                      {p.location ? (<View style={sh.metaChip}><Feather name="map-pin" size={12} color={getTheme().ink.primary} /><Text style={sh.metaTxt}>{p.location}</Text></View>) : null}
                      {p.workplace ? (<View style={sh.metaChip}><Feather name="briefcase" size={12} color={getTheme().ink.primary} /><Text style={sh.metaTxt}>{p.workplace}</Text></View>) : null}
                    </View>
                  ) : null}

                  {p.bio ? (
                    <View style={sh.section}>
                      <Text style={sh.sectionTitle}>About</Text>
                      <Text style={sh.body}>{p.bio}</Text>
                    </View>
                  ) : null}

                  <View style={sh.section}>
                    <Text style={sh.sectionTitle}>Application note</Text>
                    {note ? <Text style={sh.body}>{note}</Text> : <Text style={sh.noNote}>No note attached</Text>}
                  </View>

                  <View style={sh.actionsWrap}>
                    {(sheetApp as any).cv_url ? (
                      <TouchableOpacity style={sh.bigBtn} activeOpacity={0.85}
                        onPress={() => applicationCvUrl((sheetApp as any).cv_url, (sheetApp as any).cv_name).then(url => Linking.openURL(url)).catch((e) => Alert.alert('Could not open CV', e?.message || 'Please try again.'))}>
                        <Feather name="file-text" size={16} color="#059669" />
                        <Text style={[sh.bigBtnTxt, { color: '#059669' }]} numberOfLines={1}>{(sheetApp as any).cv_name || 'Open CV'}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {(sheetApp as any).applicant_phone ? (
                      <TouchableOpacity style={sh.bigBtn} activeOpacity={0.85}
                        onPress={() => Linking.openURL('tel:' + (sheetApp as any).applicant_phone).catch(() => {})}>
                        <Feather name="phone" size={16} color={getTheme().ink.primary} />
                        <Text style={sh.bigBtnTxt}>{(sheetApp as any).applicant_phone}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {(sheetApp as any).portfolio_url ? (
                      <TouchableOpacity style={sh.bigBtn} activeOpacity={0.85}
                        onPress={() => { const u = (sheetApp as any).portfolio_url; Linking.openURL(u.startsWith('http') ? u : 'https://' + u).catch(() => {}); }}>
                        <Feather name="link" size={16} color={getTheme().ink.primary} />
                        <Text style={sh.bigBtnTxt} numberOfLines={1}>{(sheetApp as any).portfolio_url}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  <View style={{ borderWidth: 1.2, borderColor: getTheme().surface.hairline, borderRadius: 14, padding: 12, marginBottom: 14 }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: getTheme().ink.secondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Interview</Text>
                    {(sheetApp as any)?.interview_at ? (
                      <Text style={{ fontSize: 12.5, color: '#1D7A38', fontWeight: '700', marginBottom: 8 }}>Scheduled {new Date((sheetApp as any).interview_at).toLocaleString()}{(sheetApp as any).interview_location ? ' - ' + (sheetApp as any).interview_location : ''}</Text>
                    ) : null}
                    {(sheetApp as any).interview_at && sheetApp.status !== 'withdrawn' ? <TouchableOpacity style={{ paddingVertical: 10 }} onPress={async () => {
                      if (pendingStatuses.current.has(sheetApp.id)) return;
                      const app = sheetApp, token = generation.current, sheetToken = sheetGeneration.current;
                      pendingStatuses.current.add(app.id);
                      try { const saved = await saveInterview(supabase, app, null, null); if (token === generation.current && sheetToken === sheetGeneration.current) { setSheetApp(saved); setApps(rows => rows.map(row => row.id === saved.id ? saved : row)); } }
                      catch (e: any) { if (token === generation.current) Alert.alert('Could not cancel interview', e?.message || 'Please try again.'); }
                      finally { pendingStatuses.current.delete(app.id); }
                    }}><Text style={{ color: getTheme().ink.secondary, textDecorationLine: 'underline' }}>Cancel interview</Text></TouchableOpacity> : null}
                    <TextInput value={ivAt} onChangeText={setIvAt} placeholder="Date and time, e.g. 2026-08-04 14:00" placeholderTextColor={getTheme().ink.secondary} style={{ borderWidth: 1, borderColor: getTheme().surface.hairline, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: getTheme().ink.primary, marginBottom: 8 }} />
                    <TextInput value={ivLoc} onChangeText={setIvLoc} placeholder="Location or call link (optional)" placeholderTextColor={getTheme().ink.secondary} style={{ borderWidth: 1, borderColor: getTheme().surface.hairline, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: getTheme().ink.primary, marginBottom: 8 }} />
                    <TouchableOpacity style={{ backgroundColor: getTheme().brand.base, borderRadius: 10, paddingVertical: 10, alignItems: 'center' }} activeOpacity={0.85}
                      disabled={sheetApp.status === 'withdrawn'} onPress={async () => {
                        if (sheetApp.status === 'withdrawn' || pendingStatuses.current.has(sheetApp.id)) return;
                        const d = new Date(ivAt.trim().replace(' ', 'T'));
                        if (!ivAt.trim() || isNaN(d.getTime()) || d.getTime() <= Date.now()) { Alert.alert('Date needed', 'Choose a future date and time using YYYY-MM-DD HH:MM.'); return; }
                        pendingStatuses.current.add(sheetApp.id);
                        const schedulingId = sheetApp.id, token = generation.current, sheetToken = sheetGeneration.current;
                        try {
                          const saved = await saveInterview(supabase, sheetApp, d.toISOString(), ivLoc.trim() || null);
                          if (token !== generation.current || sheetToken !== sheetGeneration.current) return;
                          setSheetApp(saved); setApps(rows => rows.map(row => row.id === saved.id ? saved : row));
                          setIvAt(''); setIvLoc('');
                          const page = await loadApplicantPage<JobApplication>(supabase, job.id, filter);
                          if (token === generation.current) { setCounts(page.counts); setApps(page.applications); setCursor(page.has_more ? page.cursor : null); }
                        } catch (e: any) { if (token === generation.current) Alert.alert('Could not schedule', e?.message || ''); }
                        finally { pendingStatuses.current.delete(schedulingId); }
                      }}>
                      <Text style={{ color: getTheme().ink.inverse, fontSize: 13, fontWeight: '800' }}>{(sheetApp as any)?.interview_at ? 'Reschedule' : 'Schedule interview'}</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={sh.footerRow}>
                    <TouchableOpacity style={sh.footBtn} activeOpacity={0.85}
                      onPress={() => { const cur = sheetApp; setSheetApp(null); setTimeout(() => messageApplicant(cur), 300); }}>
                      <Feather name="message-circle" size={15} color={getTheme().ink.inverse} />
                      <Text style={sh.footBtnTxt}>Message</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[sh.footBtn, sh.footBtnGhost]} activeOpacity={0.85}
                      onPress={() => { const uid = a.id; setSheetApp(null); if (uid) setTimeout(() => navigation.navigate('UserProfile', { userId: uid }), 300); }}>
                      <Feather name="user" size={15} color={getTheme().ink.primary} />
                      <Text style={[sh.footBtnTxt, { color: getTheme().ink.primary }]}>Full profile</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              );
            })()}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const st = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  headerTitle: { fontSize: 15.5, fontWeight: '800', color: t.ink.primary, textAlign: 'center' },
  headerSub: { fontSize: 12, color: t.ink.secondary, textAlign: 'center', marginTop: 1 },
  filterRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.divider },
  filterPill: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, backgroundColor: t.brand.tintBg, borderWidth: StyleSheet.hairlineWidth, borderColor: t.surface.hairline },
  filterPillOn: { backgroundColor: t.brand.base, borderColor: t.ink.primary },
  filterTxt: { fontSize: 13, fontWeight: '700', color: t.ink.primary },
  filterTxtOn: { color: t.ink.inverse },
  row: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: t.surface.hairline, backgroundColor: t.surface.canvas, padding: 13, marginBottom: 12 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  av: { width: 42, height: 42, borderRadius: 21 },
  avFb: { backgroundColor: t.brand.base, alignItems: 'center', justifyContent: 'center' },
  avTxt: { color: t.ink.inverse, fontSize: 16, fontWeight: '700' },
  name: { fontSize: 15, fontWeight: '700', color: t.ink.primary },
  sub: { fontSize: 12.5, color: t.ink.secondary, marginTop: 1 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  statusTxt: { fontSize: 12, fontWeight: '800' },
  note: { fontSize: 13.5, lineHeight: 19, color: t.ink.secondary, marginTop: 10, backgroundColor: t.surface.raised, padding: 10, borderRadius: 10 },
  noNote: { fontSize: 12.5, color: t.ink.secondary, marginTop: 10, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: t.surface.hairline },
  actionTxt: { fontSize: 12.5, fontWeight: '700', color: t.ink.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  errTxt: { fontSize: 14.5, fontWeight: '600', color: '#DC2626', textAlign: 'center' },
  retry: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: t.brand.base },
  retryTxt: { color: t.ink.inverse, fontSize: 13.5, fontWeight: '700' },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: t.ink.primary, marginTop: 12 },
  emptySub: { fontSize: 13.5, color: t.ink.secondary, textAlign: 'center', marginTop: 4 },
}));

const sh = themedSheet((t) => ({
  scrim: { flex: 1, backgroundColor: t.ink.muted, justifyContent: 'flex-end' },
  card: { backgroundColor: t.surface.canvas, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '86%', paddingHorizontal: 18, paddingTop: 8 },
  grab: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: 'rgba(11,30,61,0.16)', marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  av: { width: 54, height: 54, borderRadius: 27 },
  avFb: { backgroundColor: t.brand.base, alignItems: 'center', justifyContent: 'center' },
  avTxt: { color: t.ink.inverse, fontSize: 20, fontWeight: '700' },
  name: { fontSize: 17.5, fontWeight: '800', color: t.ink.primary, letterSpacing: -0.2 },
  headline: { fontSize: 13, color: t.ink.secondary, marginTop: 1 },
  applied: { fontSize: 12, color: t.ink.secondary, marginTop: 2 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999 },
  statusTxt: { fontSize: 12, fontWeight: '800' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: t.brand.tintBg },
  metaTxt: { fontSize: 12.5, fontWeight: '600', color: t.ink.primary },
  section: { marginTop: 18 },
  sectionTitle: { fontSize: 13.5, fontWeight: '800', color: t.ink.secondary, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6 },
  body: { fontSize: 14.5, lineHeight: 21, color: t.ink.secondary },
  noNote: { fontSize: 13.5, color: t.ink.secondary, fontStyle: 'italic' },
  actionsWrap: { marginTop: 18, gap: 9 },
  bigBtn: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 13, borderWidth: 1, borderColor: t.surface.hairline, backgroundColor: t.surface.raised },
  bigBtnTxt: { flex: 1, fontSize: 14, fontWeight: '700', color: t.ink.primary },
  footerRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  footBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: t.brand.base, borderRadius: 999, paddingVertical: 13 },
  footBtnGhost: { backgroundColor: t.surface.canvas, borderWidth: 1.5, borderColor: t.surface.hairline },
  footBtnTxt: { color: t.ink.inverse, fontSize: 14.5, fontWeight: '700' },
}));

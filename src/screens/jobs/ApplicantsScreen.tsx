import TierName from '../../components/TierName';
import VerifiedBadge from '../../components/VerifiedBadge';
/**
 * ApplicantsScreen — the poster's side of a job.
 * Handshake model: every applicant with profile, note and applied time,
 * filterable by status. Changing a status writes job_applications.status,
 * which fires the job_application notification trigger, so applicants are
 * told without any extra client code.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Image,
  Alert, ActivityIndicator, StatusBar, Linking, Modal, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { jobsService, JobApplication, ApplicationStatus } from '../../services/jobsService';

const NAVY = '#0B1E3D';

const STATUS_META: Record<ApplicationStatus, { label: string; color: string; bg: string }> = {
  applied:     { label: 'Applied',     color: '#2563EB', bg: '#EFF6FF' },
  viewed:      { label: 'Viewed',      color: '#7C3AED', bg: '#F5F3FF' },
  shortlisted: { label: 'Shortlisted', color: '#059669', bg: '#ECFDF5' },
  interview:   { label: 'Interview',   color: '#D97706', bg: '#FFFBEB' },
  rejected:    { label: 'Rejected',    color: '#DC2626', bg: '#FEF2F2' },
  accepted:    { label: 'Accepted',    color: '#059669', bg: '#ECFDF5' },
};
const STATUS_ORDER: ApplicationStatus[] = ['applied', 'viewed', 'shortlisted', 'interview', 'accepted', 'rejected'];

function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 1) return 'now'; if (m < 60) return m + 'm'; if (h < 24) return h + 'h';
  if (dy < 7) return dy + 'd';
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ApplicantsScreen() {
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
  const [sheetProfile, setSheetProfile] = useState<any>(null);

  const load = useCallback(async () => {
    if (!job?.id) return;
    setLoading(true); setErr(null);
    try {
      const rows = await jobsService.getApplicationsForJob(job.id);
      setApps(rows);
    } catch (e: any) {
      setErr(e?.message || 'Could not load applicants');
    } finally { setLoading(false); }
  }, [job?.id]);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: apps.length };
    STATUS_ORDER.forEach(st => { c[st] = apps.filter(a => a.status === st).length; });
    return c;
  }, [apps]);

  const shown = useMemo(
    () => (filter === 'all' ? apps : apps.filter(a => a.status === filter)),
    [apps, filter],
  );

  const openSheet = useCallback(async (app: JobApplication) => {
    setSheetApp(app);
    setSheetProfile(null);
    try {
      const { data } = await supabase.from('profiles')
        .select('id, full_name, username, avatar_url, headline, bio, location, workplace')
        .eq('id', app.applicant_id).maybeSingle();
      setSheetProfile(data ?? null);
    } catch {}
  }, []);

  const setStatus = useCallback((app: JobApplication) => {
    const name = app.applicant?.full_name || 'this applicant';
    Alert.alert('Update ' + name, 'They will be notified of the change.',
      STATUS_ORDER.filter(st => st !== app.status).map(st => ({
        text: STATUS_META[st].label,
        onPress: async () => {
          const prev = app.status;
          setApps(list => list.map(x => x.id === app.id ? { ...x, status: st } : x));
          try { await jobsService.updateApplicationStatus(app.id, st); }
          catch (e: any) {
            setApps(list => list.map(x => x.id === app.id ? { ...x, status: prev } : x));
            Alert.alert('Could not update', e?.message || 'Unknown error');
          }
        },
      })).concat([{ text: 'Cancel', style: 'cancel' } as any]));
  }, []);

  const messageApplicant = useCallback(async (app: JobApplication) => {
    if (!userId || !app.applicant_id) return;
    try {
      const { data: convId, error } = await supabase.rpc('start_dm_ctx', { p_receiver_id: app.applicant_id, p_context: 'jobs', p_ref_id: job.id });
      if (error || !convId) throw error || new Error('Could not start conversation');
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
          <TouchableOpacity style={[st.statusChip, { backgroundColor: meta.bg }]} onPress={() => setStatus(item)} activeOpacity={0.8}>
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
            <Feather name="message-circle" size={14} color={NAVY} />
            <Text style={st.actionTxt}>Message</Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.actionBtn} activeOpacity={0.8}
            onPress={() => a.id && navigation.navigate('UserProfile', { userId: a.id })}>
            <Feather name="user" size={14} color={NAVY} />
            <Text style={st.actionTxt}>Profile</Text>
          </TouchableOpacity>
        {(item as any).cv_url ? (
            <TouchableOpacity style={st.actionBtn} activeOpacity={0.8}
              onPress={() => Linking.openURL((item as any).cv_url).catch(() => Alert.alert('Could not open file'))}>
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
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color={NAVY} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginHorizontal: 10 }}>
          <Text style={st.headerTitle} numberOfLines={1}>{job?.title || 'Applicants'}</Text>
          <Text style={st.headerSub}>{apps.length} {apps.length === 1 ? 'applicant' : 'applicants'}</Text>
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
            <TouchableOpacity style={[st.filterPill, filter === fk && st.filterPillOn]} onPress={() => setFilter(fk as any)} activeOpacity={0.8}>
              <Text style={[st.filterTxt, filter === fk && st.filterTxtOn]}>
                {fk === 'all' ? 'All' : STATUS_META[fk as ApplicationStatus].label} {counts[fk] ?? 0}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {loading ? (
        <View style={st.center}><ActivityIndicator size="large" color={NAVY} /></View>
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
          data={shown}
          keyExtractor={i => i.id}
          renderItem={renderRow}
          contentContainerStyle={{ padding: 14, paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}
        />
      )}
<Modal visible={!!sheetApp} animationType="slide" transparent onRequestClose={() => setSheetApp(null)}>
        <TouchableOpacity style={sh.scrim} activeOpacity={1} onPress={() => setSheetApp(null)}>
          <TouchableOpacity activeOpacity={1} style={sh.card} onPress={() => {}}>
            {sheetApp && (() => {
              const a: any = sheetApp.applicant || {};
              const p: any = sheetProfile || {};
              const meta = STATUS_META[sheetApp.status] || STATUS_META.applied;
              const note = sheetApp.cover_note || sheetApp.cover_letter;
              return (
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 26 }}>
                  <View style={sh.grab} />
                  <View style={sh.head}>
                    {a.avatar_url
                      ? <Image source={{ uri: a.avatar_url }} style={sh.av} />
                      : <View style={[sh.av, sh.avFb]}><Text style={sh.avTxt}>{String(a.full_name || '?').slice(0, 1).toUpperCase()}</Text></View>}
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={sh.name} numberOfLines={1}>{a.full_name || 'Applicant'}</Text>
                      {p.headline ? <Text style={sh.headline} numberOfLines={2}>{p.headline}</Text> : null}
                      <Text style={sh.applied}>Applied {relTime(sheetApp.applied_at)}</Text>
                    </View>
                    <TouchableOpacity style={[sh.statusChip, { backgroundColor: meta.bg }]} onPress={() => { const cur = sheetApp; setSheetApp(null); setTimeout(() => setStatus(cur), 350); }} activeOpacity={0.8}>
                      <Text style={[sh.statusTxt, { color: meta.color }]}>{meta.label}</Text>
                      <Feather name="chevron-down" size={12} color={meta.color} />
                    </TouchableOpacity>
                  </View>

                  {(p.location || p.workplace) ? (
                    <View style={sh.metaRow}>
                      {p.location ? (<View style={sh.metaChip}><Feather name="map-pin" size={12} color={NAVY} /><Text style={sh.metaTxt}>{p.location}</Text></View>) : null}
                      {p.workplace ? (<View style={sh.metaChip}><Feather name="briefcase" size={12} color={NAVY} /><Text style={sh.metaTxt}>{p.workplace}</Text></View>) : null}
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
                        onPress={() => Linking.openURL((sheetApp as any).cv_url).catch(() => Alert.alert('Could not open file'))}>
                        <Feather name="file-text" size={16} color="#059669" />
                        <Text style={[sh.bigBtnTxt, { color: '#059669' }]} numberOfLines={1}>{(sheetApp as any).cv_name || 'Open CV'}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {(sheetApp as any).applicant_phone ? (
                      <TouchableOpacity style={sh.bigBtn} activeOpacity={0.85}
                        onPress={() => Linking.openURL('tel:' + (sheetApp as any).applicant_phone).catch(() => {})}>
                        <Feather name="phone" size={16} color={NAVY} />
                        <Text style={sh.bigBtnTxt}>{(sheetApp as any).applicant_phone}</Text>
                      </TouchableOpacity>
                    ) : null}
                    {(sheetApp as any).portfolio_url ? (
                      <TouchableOpacity style={sh.bigBtn} activeOpacity={0.85}
                        onPress={() => { const u = (sheetApp as any).portfolio_url; Linking.openURL(u.startsWith('http') ? u : 'https://' + u).catch(() => {}); }}>
                        <Feather name="link" size={16} color={NAVY} />
                        <Text style={sh.bigBtnTxt} numberOfLines={1}>{(sheetApp as any).portfolio_url}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  <View style={sh.footerRow}>
                    <TouchableOpacity style={sh.footBtn} activeOpacity={0.85}
                      onPress={() => { const cur = sheetApp; setSheetApp(null); setTimeout(() => messageApplicant(cur), 300); }}>
                      <Feather name="message-circle" size={15} color="#FFFFFF" />
                      <Text style={sh.footBtnTxt}>Message</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[sh.footBtn, sh.footBtnGhost]} activeOpacity={0.85}
                      onPress={() => { const uid = a.id; setSheetApp(null); if (uid) setTimeout(() => navigation.navigate('UserProfile', { userId: uid }), 300); }}>
                      <Feather name="user" size={15} color={NAVY} />
                      <Text style={[sh.footBtnTxt, { color: NAVY }]}>Full profile</Text>
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

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(11,30,61,0.08)' },
  headerTitle: { fontSize: 15.5, fontWeight: '800', color: NAVY, textAlign: 'center' },
  headerSub: { fontSize: 12, color: 'rgba(11,30,61,0.5)', textAlign: 'center', marginTop: 1 },
  filterRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(11,30,61,0.06)' },
  filterPill: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, backgroundColor: 'rgba(11,30,61,0.05)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.10)' },
  filterPillOn: { backgroundColor: NAVY, borderColor: NAVY },
  filterTxt: { fontSize: 13, fontWeight: '700', color: NAVY },
  filterTxtOn: { color: '#FFFFFF' },
  row: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.10)', backgroundColor: '#FFFFFF', padding: 13, marginBottom: 12 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  av: { width: 42, height: 42, borderRadius: 21 },
  avFb: { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  avTxt: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  name: { fontSize: 15, fontWeight: '700', color: NAVY },
  sub: { fontSize: 12.5, color: 'rgba(11,30,61,0.5)', marginTop: 1 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  statusTxt: { fontSize: 12, fontWeight: '800' },
  note: { fontSize: 13.5, lineHeight: 19, color: 'rgba(11,30,61,0.8)', marginTop: 10, backgroundColor: '#FAFAF9', padding: 10, borderRadius: 10 },
  noNote: { fontSize: 12.5, color: 'rgba(11,30,61,0.35)', marginTop: 10, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(11,30,61,0.16)' },
  actionTxt: { fontSize: 12.5, fontWeight: '700', color: NAVY },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  errTxt: { fontSize: 14.5, fontWeight: '600', color: '#DC2626', textAlign: 'center' },
  retry: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 999, backgroundColor: NAVY },
  retryTxt: { color: '#FFF', fontSize: 13.5, fontWeight: '700' },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: NAVY, marginTop: 12 },
  emptySub: { fontSize: 13.5, color: 'rgba(11,30,61,0.55)', textAlign: 'center', marginTop: 4 },
});

const sh = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(11,30,61,0.45)', justifyContent: 'flex-end' },
  card: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '86%', paddingHorizontal: 18, paddingTop: 8 },
  grab: { alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: 'rgba(11,30,61,0.16)', marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  av: { width: 54, height: 54, borderRadius: 27 },
  avFb: { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  avTxt: { color: '#FFF', fontSize: 20, fontWeight: '700' },
  name: { fontSize: 17.5, fontWeight: '800', color: NAVY, letterSpacing: -0.2 },
  headline: { fontSize: 13, color: 'rgba(11,30,61,0.65)', marginTop: 1 },
  applied: { fontSize: 12, color: 'rgba(11,30,61,0.4)', marginTop: 2 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999 },
  statusTxt: { fontSize: 12, fontWeight: '800' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  metaChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(11,30,61,0.05)' },
  metaTxt: { fontSize: 12.5, fontWeight: '600', color: NAVY },
  section: { marginTop: 18 },
  sectionTitle: { fontSize: 13.5, fontWeight: '800', color: 'rgba(11,30,61,0.5)', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6 },
  body: { fontSize: 14.5, lineHeight: 21, color: 'rgba(11,30,61,0.85)' },
  noNote: { fontSize: 13.5, color: 'rgba(11,30,61,0.35)', fontStyle: 'italic' },
  actionsWrap: { marginTop: 18, gap: 9 },
  bigBtn: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, paddingVertical: 13, borderRadius: 13, borderWidth: 1, borderColor: 'rgba(11,30,61,0.12)', backgroundColor: '#FAFAF9' },
  bigBtnTxt: { flex: 1, fontSize: 14, fontWeight: '700', color: NAVY },
  footerRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  footBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: NAVY, borderRadius: 999, paddingVertical: 13 },
  footBtnGhost: { backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: 'rgba(11,30,61,0.18)' },
  footBtnTxt: { color: '#FFFFFF', fontSize: 14.5, fontWeight: '700' },
});

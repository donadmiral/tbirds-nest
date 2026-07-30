import TierName from '../../components/TierName';
import VerifiedBadge from '../../components/VerifiedBadge';
/**
 * JobDetailScreen — Handshake-structure job page.
 * Receives the full job object via route params (no refetch for render);
 * checks application status and saved state on focus. Apply, message the
 * poster, and open external application all live here with a pinned bar.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput,
  Alert, Linking, Modal, ActivityIndicator, Image, StatusBar, KeyboardAvoidingView, Platform, Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { jobsService } from '../../services/jobsService';
import { uploadMedia } from '../../services/mediaService';
import * as DocumentPicker from 'expo-document-picker';

const NAVY = '#0B1E3D';
const PLATINUM = '#C9BFB0';

function SimilarRoles({ job, onOpen }: { job: any; onOpen: (j: any) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      let q = supabase.from('jobs').select('*').neq('id', job.id)
        .order('created_at', { ascending: false }).limit(5);
      if (job.category) q = q.eq('category', job.category);
      const { data } = await q;
      if (alive) setRows(data || []);
    })();
    return () => { alive = false; };
  }, [job.id]);
  if (!rows.length) return null;
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
      <Text style={{ fontSize: 15, fontWeight: '800', color: '#0B1E3D', marginBottom: 10 }}>Similar roles</Text>
      {rows.map((r) => (
        <TouchableOpacity key={r.id} activeOpacity={0.85} onPress={() => onOpen(r)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(11,30,61,0.10)' }}>
          <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: '#0B1E3D', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 16, fontWeight: '800', color: '#C9BFB0' }}>{String(r.company || '?').slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '700', color: '#0B1E3D' }}>{r.title}</Text>
            <Text numberOfLines={1} style={{ fontSize: 12, color: 'rgba(11,30,61,0.55)', marginTop: 2 }}>{r.company}{r.location ? ' - ' + r.location : ''}</Text>
          </View>
          <Feather name="chevron-right" size={16} color="rgba(11,30,61,0.35)" />
        </TouchableOpacity>
      ))}
    </View>
  );
}

function daysLeft(deadline?: string | null) {
  if (!deadline) return null;
  const d = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000);
  return d;
}

export default function JobDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const userId = useAuthStore(st => st.profile?.id);

  const job = route.params?.job;
  const [saved, setSaved] = useState(false);
  const [appStatus, setAppStatus] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [coverNote, setCoverNote] = useState('');
  const [applying, setApplying] = useState(false);
  const [cvAsset, setCvAsset] = useState<{ name: string; uri: string; ext: string } | null>(null);
  const [phone, setPhone] = useState('');
  const [portfolio, setPortfolio] = useState('');

  useEffect(() => {
    if (!job || !userId) return;
    (async () => {
      try {
        const { data: sv } = await supabase.from('job_saves').select('job_id').eq('user_id', userId).eq('job_id', job.id).maybeSingle();
        setSaved(!!sv);
        const { data: ap } = await supabase.from('job_applications').select('status').eq('applicant_id', userId).eq('job_id', job.id).maybeSingle();
        setAppStatus(ap?.status ?? null);
      } catch {}
    })();
  }, [job?.id, userId]);

  const toggleSave = useCallback(async () => {
    if (!userId || !job) return;
    const next = !saved;
    setSaved(next);
    try {
      if (next) await jobsService.saveJob(userId, job.id);
      else await jobsService.unsaveJob(userId, job.id);
    } catch { setSaved(!next); }
  }, [saved, userId, job]);

  const messagePoster = useCallback(async () => {
    if (!userId || !job?.posted_by) return;
    try {
      const { data: convId, error } = await supabase.rpc('start_dm_ctx', { p_receiver_id: job.posted_by, p_context: 'jobs', p_ref_id: job.id });
      if (error || !convId) throw error || new Error('Could not start conversation');
      navigation.navigate('Chat', {
        conversationId: convId,
        userId: job.posted_by,
        userName: job.profile?.full_name || 'Recruiter',
        otherUser: {
          id: job.posted_by,
          full_name: job.profile?.full_name || 'Recruiter',
          username: job.profile?.username || null,
          avatar_url: job.profile?.avatar_url || null,
        },
      });
    } catch (e: any) {
      Alert.alert('Error', 'Could not open conversation: ' + (e?.message || 'Unknown error'));
    }
  }, [userId, job, navigation]);

  const pickCv = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'], copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const ext = asset.name.split('.').pop()?.toLowerCase() || 'pdf';
      setCvAsset({ name: asset.name, uri: asset.uri, ext });
    } catch (e: any) { Alert.alert('Could not pick file', e?.message || 'Unknown error'); }
  }, []);

  const submitApply = useCallback(async () => {
    if (!userId || !job || applying) return;
    setApplying(true);
    try {
      let cvUrl: string | null = null;
      let cvName: string | null = null;
      if (cvAsset) {
        const safeName = cvAsset.name.replace(/[^a-zA-Z0-9/_.\-]/g, '_');
        const { url } = await uploadMedia('chat-files', userId, {
          uri: cvAsset.uri, kind: 'document', ext: cvAsset.ext, mimeType: 'application/octet-stream', base64: null,
        } as any, { filename: `cv_${Date.now()}_${safeName}` });
        cvUrl = url; cvName = cvAsset.name;
      }
      const res = await jobsService.applyToJob(userId, job.id, coverNote, cvUrl, cvName, phone, portfolio);
      if (res.updated) Alert.alert('Application updated', 'Your application details were updated.');
      setAppStatus('applied');
      setApplyOpen(false);
      setCoverNote(''); setCvAsset(null); setPhone(''); setPortfolio('');
    } catch (e: any) {
      Alert.alert('Could not apply', e?.message || 'Unknown error');
    } finally { setApplying(false); }
  }, [userId, job, coverNote, applying, cvAsset, phone, portfolio]);

  if (!job) {
    return (
      <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
        <View style={st.loader}><Text style={st.missing}>This job is no longer available.</Text></View>
      </SafeAreaView>
    );
  }

  const isOwn = job.posted_by === userId;
  const logo = String(job.company || '?').trim().charAt(0).toUpperCase();
  const dLeft = daysLeft(job.deadline);
  const place = job.remote_type === 'remote' ? 'Remote'
    : job.remote_type === 'hybrid' ? [job.location, 'Hybrid'].filter(Boolean).join(' · ')
    : (job.location || 'On site');
  const catLabel = String(job.category || 'role').replace(/_/g, ' ');
  const expLabel = job.experience_level ? job.experience_level.charAt(0).toUpperCase() + job.experience_level.slice(1) : null;

  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color={NAVY} />
        </TouchableOpacity>
        <Text style={st.headerTitle} numberOfLines={1}>{job.company}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <TouchableOpacity hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={() => Share.share({ message: `${job.title} at ${job.company}${job.location ? ' — ' + job.location : ''}\n\nSee it on Platinum Circles Jobs: platinum-circles://job/${job.id}` }).catch(() => {})}>
            <Feather name="share-2" size={21} color={NAVY} />
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleSave} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={22} color={saved ? '#2563EB' : NAVY} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 130 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View style={st.hero}>
          <View style={st.logoBlock}><Text style={st.logoTxt}>{logo}</Text></View>
          <Text style={st.title}>{job.title}</Text>
          <Text style={st.companyLine}>{job.company}{place ? '  ·  ' + place : ''}</Text>
          <View style={st.chipRow}>
            <View style={st.chip}><Text style={st.chipTxt}>{catLabel}</Text></View>
            {expLabel ? <View style={st.chip}><Text style={st.chipTxt}>{expLabel}</Text></View> : null}
            {job.salary_range ? <View style={[st.chip, st.chipMoney]}><Text style={[st.chipTxt, { color: '#065F46' }]}>{job.salary_range}</Text></View> : null}
            {job.urgent ? <View style={[st.chip, st.chipUrgent]}><Text style={[st.chipTxt, { color: '#B45309' }]}>URGENT</Text></View> : null}
            {dLeft !== null && dLeft >= 0 ? <View style={st.chip}><Text style={st.chipTxt}>{dLeft === 0 ? 'Closes today' : 'Closes in ' + dLeft + 'd'}</Text></View> : null}
          </View>
        </View>

        <TouchableOpacity style={st.posterRow} activeOpacity={0.8}
          onPress={() => job.posted_by && navigation.navigate('UserProfile', { userId: job.posted_by })}>
          {job.profile?.avatar_url
            ? <Image source={{ uri: job.profile.avatar_url }} style={st.posterAv} />
            : <View style={[st.posterAv, st.posterAvFb]}><Text style={st.posterAvTxt}>{String(job.profile?.full_name || '?').slice(0, 1).toUpperCase()}</Text></View>}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <TierName userId={job.posted_by} baseStyle={[st.posterName, { flexShrink: 1 }]} text={job.profile?.full_name || 'Poster'} />
              <VerifiedBadge userId={job.posted_by} size={14} />
            </View>
            <Text style={st.posterSub}>Posted this role · View profile</Text>
          </View>
          {!isOwn && (
            <TouchableOpacity style={st.msgBtn} onPress={messagePoster} activeOpacity={0.85}>
              <Feather name="message-circle" size={15} color={NAVY} />
              <Text style={st.msgBtnTxt}>Message</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>

        <View style={st.section}>
          <Text style={st.sectionTitle}>About the role</Text>
          <Text style={st.body}>{job.description || 'No description provided.'}</Text>
        </View>

        {job.benefits ? (
          <View style={st.section}>
            <Text style={st.sectionTitle}>What this role offers</Text>
            {String(job.benefits).split('\n').map((b: string) => b.trim()).filter(Boolean).map((b: string, i: number) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Feather name="check-circle" size={14} color="#059669" />
                <Text style={{ fontSize: 13.5, color: '#0B1E3D', flex: 1 }}>{b}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={st.section}>
          <Text style={st.sectionTitle}>Details</Text>
          <View style={st.grid}>
            {[
              ['Industry', job.industry],
              ['Type', catLabel],
              ['Experience', expLabel],
              ['Workplace', place],
              ['Apply by', job.deadline ? new Date(job.deadline).toLocaleDateString([], { month: 'short', day: 'numeric' }) : null],
              ['Applicants', String(job.applications_count ?? job.application_count ?? 0)],
              ['Posted', new Date(job.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })],
            ].filter(r => r[1]).map(([k, v]) => (
              <View key={String(k)} style={st.gridCell}>
                <Text style={st.gridKey}>{k}</Text>
                <Text style={st.gridVal}>{v}</Text>
              </View>
            ))}
          </View>
        </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: '#0B1E3D', marginBottom: 8 }}>Employer</Text>
          <Text style={{ fontSize: 17, fontWeight: '800', color: '#0B1E3D' }}>{job.company}</Text>
          {job.industry ? <Text style={{ fontSize: 12.5, color: 'rgba(11,30,61,0.55)', marginTop: 3 }}>{job.industry}</Text> : null}
          <Text style={{ fontSize: 12.5, color: 'rgba(11,30,61,0.55)', marginTop: 3 }}>Posted by {job.profile?.full_name || 'a member'} - use Message above with any questions.</Text>
        </View>

        <SimilarRoles job={job} onOpen={(j: any) => (navigation as any).push('JobDetail', { job: j })} />
      </ScrollView>

      <View style={[st.applyBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        {isOwn ? (
          <View style={st.ownRow}>
            <Feather name="briefcase" size={15} color={NAVY} />
            <Text style={st.ownTxt}>Your posting · manage it from the Jobs tab</Text>
          </View>
        ) : appStatus ? (
          <View style={st.statusRow}>
            <Ionicons name="checkmark-circle" size={18} color="#059669" />
            <Text style={st.statusTxt}>Application {appStatus}</Text>
          </View>
        ) : job.apply_url ? (
          <TouchableOpacity style={st.applyBtn} activeOpacity={0.9}
            onPress={() => Linking.openURL(job.apply_url).catch(() => Alert.alert('Could not open link'))}>
            <Text style={st.applyBtnTxt}>Apply on company site</Text>
            <Feather name="external-link" size={15} color="#FFF" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={st.applyBtn} activeOpacity={0.9} onPress={() => setApplyOpen(true)}>
            <Text style={st.applyBtnTxt}>Apply now</Text>
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={applyOpen} animationType="slide" transparent onRequestClose={() => setApplyOpen(false)}>
        <KeyboardAvoidingView style={st.modalScrim} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[st.modalCard, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <Text style={st.modalTitle}>Apply to {job.company}</Text>
            <Text style={st.modalSub}>{job.title}</Text>
            <TextInput
              style={st.noteInput}
              value={coverNote}
              onChangeText={setCoverNote}
              placeholder="Add a short note (optional): why you fit this role"
              placeholderTextColor="#9CA3AF"
              multiline
              maxLength={600}
            />
            <TouchableOpacity style={st.attachRow} onPress={pickCv} activeOpacity={0.8}>
              <Feather name={cvAsset ? 'file-text' : 'paperclip'} size={16} color={cvAsset ? '#059669' : NAVY} />
              <Text style={[st.attachTxt, cvAsset && { color: '#059669' }]} numberOfLines={1}>
                {cvAsset ? cvAsset.name : 'Attach CV or cover letter (PDF, Word)'}
              </Text>
              {cvAsset ? (
                <TouchableOpacity onPress={() => setCvAsset(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Feather name="x" size={15} color="#9CA3AF" />
                </TouchableOpacity>
              ) : null}
            </TouchableOpacity>
            <TextInput
              style={st.contactInput}
              value={phone}
              onChangeText={setPhone}
              placeholder="Phone number (optional)"
              placeholderTextColor="#9CA3AF"
              keyboardType="phone-pad"
              maxLength={20}
            />
            <TextInput
              style={st.contactInput}
              value={portfolio}
              onChangeText={setPortfolio}
              placeholder="Portfolio or LinkedIn link (optional)"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              keyboardType="url"
              maxLength={200}
            />
            <TouchableOpacity style={st.attachRow} onPress={pickCv} activeOpacity={0.8}>
              <Feather name={cvAsset ? 'file-text' : 'paperclip'} size={16} color={cvAsset ? '#059669' : NAVY} />
              <Text style={[st.attachTxt, cvAsset && { color: '#059669' }]} numberOfLines={1}>
                {cvAsset ? cvAsset.name : 'Attach CV or cover letter (PDF, Word)'}
              </Text>
              {cvAsset ? (
                <TouchableOpacity onPress={() => setCvAsset(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Feather name="x" size={15} color="#9CA3AF" />
                </TouchableOpacity>
              ) : null}
            </TouchableOpacity>
            <View style={st.modalRow}>
              <TouchableOpacity style={st.cancelBtn} onPress={() => setApplyOpen(false)}>
                <Text style={st.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.applyBtn, { flex: 1 }]} onPress={submitApply} disabled={applying} activeOpacity={0.9}>
                {applying ? <ActivityIndicator color="#FFF" size={16} /> : <Text style={st.applyBtnTxt}>Submit application</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  missing: { fontSize: 15, fontWeight: '600', color: '#6B7280' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(11,30,61,0.08)' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 15, fontWeight: '700', color: NAVY, marginHorizontal: 10 },
  hero: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 16 },
  logoBlock: { width: 58, height: 58, borderRadius: 14, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', marginBottom: 14, borderWidth: 1.5, borderColor: 'rgba(201,191,176,0.7)' },
  logoTxt: { color: PLATINUM, fontSize: 26, fontWeight: '800' },
  title: { fontSize: 23, fontWeight: '800', color: NAVY, letterSpacing: -0.5, lineHeight: 29 },
  companyLine: { fontSize: 14.5, color: 'rgba(11,30,61,0.62)', marginTop: 5, fontWeight: '500' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  chip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(11,30,61,0.05)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.10)' },
  chipMoney: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  chipUrgent: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  chipTxt: { fontSize: 12.5, fontWeight: '700', color: NAVY, textTransform: 'capitalize' },
  posterRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 18, padding: 12, borderRadius: 14, backgroundColor: '#FAFAF9', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.08)' },
  posterAv: { width: 40, height: 40, borderRadius: 20 },
  posterAvFb: { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  posterAvTxt: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  posterName: { fontSize: 14.5, fontWeight: '700', color: NAVY },
  posterSub: { fontSize: 12, color: 'rgba(11,30,61,0.5)', marginTop: 1 },
  msgBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(11,30,61,0.18)' },
  msgBtnTxt: { fontSize: 13, fontWeight: '700', color: NAVY },
  section: { paddingHorizontal: 18, paddingTop: 22 },
  sectionTitle: { fontSize: 16.5, fontWeight: '800', color: NAVY, marginBottom: 8, letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 23, color: 'rgba(11,30,61,0.85)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  gridCell: { width: '47%', padding: 12, borderRadius: 12, backgroundColor: '#FAFAF9', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.07)' },
  gridKey: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: 'rgba(11,30,61,0.45)', textTransform: 'uppercase' },
  gridVal: { fontSize: 14, fontWeight: '600', color: NAVY, marginTop: 3, textTransform: 'capitalize' },
  applyBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 12, backgroundColor: '#FFFFFF', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(11,30,61,0.10)' },
  applyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: NAVY, borderRadius: 999, paddingVertical: 14 },
  applyBtnTxt: { color: '#FFFFFF', fontSize: 15.5, fontWeight: '700' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, borderRadius: 999, backgroundColor: '#ECFDF5' },
  statusTxt: { fontSize: 14.5, fontWeight: '700', color: '#065F46', textTransform: 'capitalize' },
  ownRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13 },
  ownTxt: { fontSize: 13.5, fontWeight: '600', color: 'rgba(11,30,61,0.6)' },
  modalScrim: { flex: 1, backgroundColor: 'rgba(11,30,61,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: NAVY },
  modalSub: { fontSize: 13.5, color: 'rgba(11,30,61,0.6)', marginTop: 2, marginBottom: 12 },
  noteInput: { minHeight: 110, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(11,30,61,0.14)', padding: 12, fontSize: 15, color: NAVY, textAlignVertical: 'top' },
  modalRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(11,30,61,0.14)', borderStyle: 'dashed' },
  attachTxt: { flex: 1, fontSize: 13.5, fontWeight: '600', color: NAVY },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 13 },
  cancelTxt: { fontSize: 14.5, fontWeight: '600', color: 'rgba(11,30,61,0.6)' },
});

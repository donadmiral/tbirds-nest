import { handleTabBarScroll } from '../../components/AdaptiveTabBar';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Image,
  TextInput, ScrollView, ActivityIndicator, RefreshControl,
  StatusBar, Alert, Modal, KeyboardAvoidingView, Platform, Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { useFocusEffect } from '@react-navigation/native';
import { useUnreadStore } from '../../stores/unreadStore';
import { supabase } from '../../services/supabase';
import { Ionicons } from '@expo/vector-icons';
import { authorId as currentAuthorId } from '../../stores/actorStore';
import { jobsService, Job, JobCategory, JobApplication, JobRecommendation, ApplicationStatus, JobScope } from '../../services/jobsService';
import { useAuthStore } from '../../stores/authStore';

const CATEGORY_TABS = [
  { id: 'all', label: 'All Jobs', emoji: '💼' },
  { id: 'full_time', label: 'Full Time', emoji: '🏢' },
  { id: 'part_time', label: 'Part Time', emoji: '⏰' },
  { id: 'internship', label: 'Internships', emoji: '🎓' },
  { id: 'volunteering', label: 'Volunteering', emoji: '🤝' },
  { id: 'startup', label: 'Startups', emoji: '🚀' },
  { id: 'freelance', label: 'Freelance', emoji: '💻' },
] as const;

const SORT_OPTIONS = [
  { id: 'recent', label: 'Most Recent' },
  { id: 'popular', label: 'Most Applied' },
  { id: 'salary', label: 'Highest Pay' },
  { id: 'urgent', label: 'Urgent Hiring' },
] as const;

const SCOPE_TABS = [
  { id: 'all', label: 'All Zimbabwe' },
  { id: 'primary', label: 'Near me' },
  { id: 'global', label: 'Remote' },
] as const;

const INDUSTRIES = [
  'Agriculture', 'Mining', 'Finance & Banking', 'Technology', 'Healthcare', 'Energy',
  'Construction', 'Transport & Logistics', 'Retail & Trade', 'Education', 'Government',
  'NGO & Development', 'Media & Creative', 'Manufacturing', 'Tourism & Hospitality',
  'Legal', 'Human Resources', 'Entrepreneurship',
];

const CATEGORY_COLORS: Record<string, string> = {
  full_time: '#2563EB',
  part_time: '#7C3AED',
  internship: '#059669',
  volunteering: '#EA580C',
  startup: '#DC2626',
  freelance: '#0891B2',
  all: '#374151',
};

const STATUS_META: Record<ApplicationStatus, { label: string; color: string; bg: string }> = {
  applied:     { label: 'Applied',      color: '#2563EB', bg: '#EFF6FF' },
  viewed:      { label: 'Viewed',       color: '#7C3AED', bg: '#F5F3FF' },
  shortlisted: { label: 'Shortlisted',  color: '#059669', bg: '#ECFDF5' },
  interview:   { label: 'Interview 🎉', color: '#D97706', bg: '#FFFBEB' },
  rejected:    { label: 'Rejected',     color: '#DC2626', bg: '#FEF2F2' },
  accepted:    { label: 'Accepted 🎊',  color: '#059669', bg: '#ECFDF5' },
};

function computeMatchScore(job: Job, userProfile: any): number {
  let score = 45;
  if (!userProfile) return score;
  const deg = (userProfile.degree_program || '').toLowerCase();
  const title = (job.title || '').toLowerCase();
  const ind = (job.industry || '').toLowerCase();
  const desc = (job.description || '').toLowerCase();

  if (deg && (title.includes(deg.split(' ')[0]) || ind.includes(deg.split(' ')[0]) || desc.includes(deg.split(' ')[0]))) score += 22;
  if (userProfile.location && job.location && job.location.toLowerCase().includes(userProfile.location.toLowerCase().split(',')[0])) score += 15;
  if (job.remote_type === 'remote') score += 8;
  if (job.urgent) score += 5;
  if (job.verified) score += 5;
  return Math.min(99, score);
}

function matchColor(score: number): string {
  if (score >= 80) return '#059669';
  if (score >= 60) return '#D97706';
  return '#6B7280';
}

function formatTime(d?: string | null): string {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (dy < 7) return `${dy}d ago`;
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function categoryLabel(c: string): string {
  return CATEGORY_TABS.find(t => t.id === c)?.label || c;
}

function initials(name?: string | null): string {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

export default function JobsScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [jobs, setJobs] = useState<Job[]>([]);
  const [myApplications, setMyApplications] = useState<JobApplication[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [appliedMap, setAppliedMap] = useState<Record<string, ApplicationStatus>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [activeTab, setActiveTab] = useState<string>('all');
  const jobsUnread = useUnreadStore(st => st.counts.jobs);
  useFocusEffect(useCallback(() => { useUnreadStore.getState().refresh(); }, []));
  const [sortBy, setSortBy] = useState<'recent' | 'popular' | 'salary' | 'urgent'>('recent');
  const [scopeMode, setScopeMode] = useState<JobScope>('all');
  const [search, setSearch] = useState('');
  
  

  const [showPost, setShowPost] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postForm, setPostForm] = useState({
    scope: 'global' as 'institution' | 'global',
    title: '', company: '', location: '', description: '',
    salary_range: '', apply_url: '', industry: '',
    category: 'full_time' as JobCategory,
    remote_type: 'on_site' as 'remote' | 'hybrid' | 'on_site',
    experience_level: 'mid' as 'entry' | 'mid' | 'senior' | 'executive',
    urgent: false,
  });


  const [referTarget,  setReferTarget]  = useState<Job | null>(null);
  const [referSearch,  setReferSearch]  = useState('');
  const [referResults, setReferResults] = useState<any[]>([]);
  const [referNote,    setReferNote]    = useState('');
  const [referring,    setReferring]    = useState(false);

  const [recTarget,      setRecTarget]      = useState<Job | null>(null);
  const [recName,        setRecName]        = useState('');
  const [recContact,     setRecContact]     = useState('');
  const [recMessage,     setRecMessage]     = useState('');
  const [recommending,   setRecommending]   = useState(false);

  
  
  

  const [viewRecsJob,    setViewRecsJob]    = useState<Job | null>(null);
  const [jobRecs,        setJobRecs]        = useState<JobRecommendation[]>([]);
  const [loadingRecs,    setLoadingRecs]    = useState(false);

  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});
  const setBusy = (k: string, v: boolean) =>
    setBusyMap(p => { const n = {...p}; if(v) n[k]=true; else delete n[k]; return n; });

  const loadAll = useCallback(async (showLoader = true) => {
    if (!userId) return;
    try {
      if (showLoader) setLoading(true);
      const [fetchedJobs, savedJobIds, appMap, apps] = await Promise.all([
        jobsService.getJobs({ sortBy, scope: scopeMode, userId }),
        jobsService.getSavedJobIds(userId),
        jobsService.getAppliedJobIds(userId),
        jobsService.getMyApplications(userId),
      ]);
      setJobs(fetchedJobs);
      setSavedIds(new Set(savedJobIds));
      setAppliedMap(appMap);
      setMyApplications(apps);
    } catch (e) {
      console.log('LOAD_JOBS_ERROR', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, sortBy, scopeMode]);

  useEffect(() => { loadAll(true); }, [loadAll]);

  const displayJobs = useMemo(() => {
    let list = jobs;
    if (activeTab !== 'all') list = list.filter(j => j.category === activeTab);
    const term = search.trim().toLowerCase();
    if (term) {
      list = list.filter(j =>
        (j.title || '').toLowerCase().includes(term) ||
        (j.company || '').toLowerCase().includes(term) ||
        (j.location || '').toLowerCase().includes(term) ||
        (j.industry || '').toLowerCase().includes(term)
      );
    }
    return list;
  }, [jobs, activeTab, search]);

  const savedJobs = useMemo(() => {
    return jobs.filter(j => savedIds.has(j.id));
  }, [jobs, savedIds]);

  const toggleSave = async (jobId: string) => {
    if (!userId || busyMap[`save-${jobId}`]) return;
    const was = savedIds.has(jobId);
    setBusy(`save-${jobId}`, true);
    setSavedIds(p => { const n = new Set(p); if (was) n.delete(jobId); else n.add(jobId); return n; });
    try {
      if (was) await jobsService.unsaveJob(userId, jobId);
      else await jobsService.saveJob(userId, jobId);
    } catch (e) {
      setSavedIds(p => { const n = new Set(p); if (was) n.add(jobId); else n.delete(jobId); return n; });
    } finally { setBusy(`save-${jobId}`, false); }
  };

  const loadRecommendations = async (job: Job) => {
    setViewRecsJob(job);
    setLoadingRecs(true);
    try {
      const recs = await jobsService.getRecommendationsForJob(job.id);
      setJobRecs(recs);
    } catch (e) {
      console.log('LOAD_RECS_ERR', e);
    } finally {
      setLoadingRecs(false);
    }
  };

  const submitRecommendation = async () => {
    if (!userId || !recTarget || !recName.trim() || recommending) return;
    setRecommending(true);
    try {
      await jobsService.createRecommendation({
        jobId:             recTarget.id,
        recommenderId:     userId,
        recommendedName:   recName.trim(),
        recommendedContact: recContact.trim() || undefined,
        message:           recMessage.trim() || undefined,
      });
      setRecTarget(null);
      setRecName('');
      setRecContact('');
      setRecMessage('');
      Alert.alert('Recommendation sent!', 'The job poster will be notified privately.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not send recommendation.');
    } finally {
      setRecommending(false);
    }
  };

  const messageJobPoster = async (job: Job) => {
    if (!userId || !job.posted_by) return;
    try {
      const { data: convId, error: convErr } = await supabase.rpc('start_dm_ctx', { p_receiver_id: job.posted_by, p_context: 'jobs', p_ref_id: job.id });
      if (convErr || !convId) throw convErr || new Error('Could not start conversation');
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
  };

  const searchUsersForRefer = async (q: string) => {
    setReferSearch(q);
    if (q.length < 2) { setReferResults([]); return; }
    const { data } = await supabase.from('profiles')
      .select('id, full_name, username, avatar_url, degree_program')
      .neq('id', userId)
      .or(`full_name.ilike.%${q}%,username.ilike.%${q}%`)
      .limit(6);
    setReferResults(data || []);
  };

  const submitRefer = async (referredUser: any) => {
    if (!userId || !referTarget || referring) return;
    setReferring(true);
    try {
      await jobsService.referUser({
        referrerId: userId,
        referredId: referredUser.id,
        jobId: referTarget.id,
        note: referNote,
      });
      setReferTarget(null);
      setReferSearch('');
      setReferResults([]);
      setReferNote('');
      Alert.alert('Referral sent!', `You referred ${referredUser.full_name || referredUser.username} to ${referTarget.title}.`);
    } catch (e) {
      Alert.alert('Error', 'Could not send referral.');
    } finally { setReferring(false); }
  };

  const submitPost = async () => {
    if (!userId || posting) return;
    if (!postForm.title.trim() || !postForm.company.trim() || !postForm.description.trim()) {
      Alert.alert('Missing fields', 'Title, company, and description are required.');
      return;
    }
    setPosting(true);
    try {
      await jobsService.createJob(currentAuthorId(userId) ?? userId, {
        title: postForm.title.trim(),
        company: postForm.company.trim(),
        location: postForm.location.trim() || undefined,
        description: postForm.description.trim(),
        category: postForm.category,
        remote_type: postForm.remote_type,
        experience_level: postForm.experience_level,
        industry: postForm.industry || undefined,
        salary_range: postForm.salary_range.trim() || undefined,
        urgent: postForm.urgent,
        apply_url: postForm.apply_url.trim() || undefined,
      });
      setShowPost(false);
      setPostForm({ scope:'global', title:'', company:'', location:'', description:'', salary_range:'', apply_url:'', industry:'', category:'full_time', remote_type:'on_site', experience_level:'mid', urgent:false });
      await loadAll(false);
      Alert.alert('Posted!', 'Your job listing is now live.');
    } catch (e) {
      console.log('POST_JOB_ERROR', e);
      Alert.alert('Error', 'Could not post job. Please try again.');
    } finally { setPosting(false); }
  };

  const renderJob = ({ item }: { item: Job }) => {
    const isSaved = savedIds.has(item.id);
    const appStatus = appliedMap[item.id];
    const score = computeMatchScore(item, profile);
    const isOwn = item.posted_by === userId;
    const statusMeta = appStatus ? STATUS_META[appStatus] : null;
    const logo = (item.company || '?').trim().charAt(0).toUpperCase();
    const isNew = Date.now() - new Date(item.created_at).getTime() < 86400000;
    const soon = item.deadline ? (new Date(item.deadline).getTime() - Date.now()) < 259200000 : false;
    const place = item.remote_type === 'remote' ? 'Remote'
      : item.remote_type === 'hybrid' ? (item.location ? item.location + ' - Hybrid' : 'Hybrid')
      : (item.location || '');

    return (
      <TouchableOpacity style={s.hsCardRoot} activeOpacity={0.94} onPress={() => (navigation as any).navigate('JobDetail', { job: item })}>
        <View style={s.hsCard}>
          <View style={s.hsLogo}><Text style={s.hsLogoTxt}>{logo}</Text></View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <Text style={[s.hsTitle, { flex: 1 }]} numberOfLines={2}>{item.title}</Text>
              <TouchableOpacity style={s.hsSave} onPress={() => toggleSave(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={19} color={isSaved ? '#2563EB' : '#9CA3AF'} />
              </TouchableOpacity>
            </View>

            <Text style={s.hsCompany} numberOfLines={1}>{item.company}</Text>
            {!!place && <Text style={s.hsMeta} numberOfLines={1}>{place}</Text>}
            {!!item.salary_range && <Text style={s.hsSalary}>{item.salary_range}</Text>}

            <View style={s.hsTagRow}>
              <View style={s.hsTag}><Text style={s.hsTagTxt}>{categoryLabel(item.category as string)}</Text></View>
              {item.experience_level ? (
                <View style={s.hsTag}><Text style={s.hsTagTxt}>{String(item.experience_level)}</Text></View>
              ) : null}
              {isNew ? (
                <View style={[s.hsTag, s.hsTagNew]}><Text style={[s.hsTagTxt, s.hsTagNewTxt]}>New</Text></View>
              ) : null}
              {soon ? (
                <View style={[s.hsTag, s.hsTagSoon]}><Text style={[s.hsTagTxt, s.hsTagSoonTxt]}>Apply soon</Text></View>
              ) : null}
              {item.verified ? (
                <View style={s.hsTag}><Text style={s.hsTagTxt}>Verified</Text></View>
              ) : null}
              {score >= 70 ? (
                <View style={[s.hsTag, s.hsTagNew]}><Text style={[s.hsTagTxt, s.hsTagNewTxt]}>{score}% match</Text></View>
              ) : null}
            </View>

            {statusMeta ? (
              <View style={[s.statusBanner, { backgroundColor: statusMeta.bg, marginTop: 10 }]}>
                <Text style={[s.statusBannerTxt, { color: statusMeta.color }]}>{statusMeta.label}</Text>
              </View>
            ) : null}

            <View style={s.hsFooter}>
              <Text style={s.hsPosted}>
                {formatTime(item.created_at)}{item.applications_count > 0 ? '  -  ' + item.applications_count + ' applied' : ''}
              </Text>
              {!isOwn && (
                appStatus ? (
                  <View style={[s.hsApply, s.hsApplied]}>
                    <Text style={[s.hsApplyTxt, s.hsAppliedTxt]}>Applied</Text>
                  </View>
                ) : (
                  <TouchableOpacity style={s.hsApply} onPress={() => (navigation as any).navigate('JobDetail', { job: item })} activeOpacity={0.85}>
                    <Text style={s.hsApplyTxt}>Apply</Text>
                  </TouchableOpacity>
                )
              )}
            </View>
          </View>
        </View>

        {!isOwn && (
          <View style={s.hsSecondary}>
            <TouchableOpacity style={s.hsLink} onPress={() => messageJobPoster(item)}>
              <Text style={s.hsLinkTxt}>Message recruiter</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.hsLink} onPress={() => setRecTarget(item)}>
              <Text style={s.hsLinkTxt}>Refer someone</Text>
            </TouchableOpacity>
          </View>
        )}

        {isOwn && (
          <View style={s.hsSecondary}>
            <TouchableOpacity style={s.hsLink} onPress={() => (navigation as any).navigate('Applicants', { job: item })}>
              <Text style={s.hsLinkTxt}>{item.applications_count > 0 ? item.applications_count + ' applicants' : 'Applicants'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.hsLink} onPress={() => loadRecommendations(item)}>
              <Text style={s.hsLinkTxt}>Referrals</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.hsLink}
              onPress={() => Alert.alert('Delete job?', 'This cannot be undone.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: async () => { await jobsService.deleteJob(item.id); loadAll(false); } },
              ])}
            >
              <Text style={[s.hsLinkTxt, { color: '#DC2626' }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  };
  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#F4F6F9" />
      <View style={s.container}>

        <View style={s.header}>
          <View style={s.hsTopRow}>
            <Text style={s.hsPageTitle}>Jobs</Text>
            <View style={s.hsTopActions}>
              <TouchableOpacity onPress={() => navigation.navigate('JobsInbox')} style={s.hsIconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="chatbubble-outline" size={22} color="#0B1E3D" />
                {jobsUnread > 0 && <View style={s.hsDot}><Text style={s.hsDotTxt}>{jobsUnread > 99 ? '99+' : jobsUnread}</Text></View>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => (navigation as any).navigate('SavedJobs')} style={s.hsIconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="bookmark-outline" size={22} color="#0B1E3D" />
                {savedIds.size > 0 && <View style={s.hsDot}><Text style={s.hsDotTxt}>{savedIds.size}</Text></View>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => (navigation as any).navigate('MyApplications')} style={s.hsIconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="document-text-outline" size={22} color="#0B1E3D" />
                {myApplications.length > 0 && <View style={s.hsDot}><Text style={s.hsDotTxt}>{myApplications.length}</Text></View>}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowPost(true)} style={s.hsPostBtn}>
                <Text style={s.hsPostBtnTxt}>Post</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TextInput
            value={search} onChangeText={setSearch}
            placeholder="Search jobs by title, keyword, or company"
            placeholderTextColor="#9CA3AF"
            style={s.hsSearch}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />

          <View style={s.hsTabRow}>
            {SCOPE_TABS.map(sc => (
              <TouchableOpacity
                key={sc.id}
                style={[s.hsTab, scopeMode === sc.id && s.hsTabActive]}
                onPress={() => setScopeMode(sc.id as JobScope)}
                activeOpacity={0.7}
              >
                <Text style={[s.hsTabTxt, scopeMode === sc.id && s.hsTabTxtActive]}>{sc.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.hsChipRow}>
            {CATEGORY_TABS.map(t => (
              <TouchableOpacity
                key={t.id}
                style={[s.hsChip, activeTab === t.id && s.hsChipActive]}
                onPress={() => setActiveTab(t.id)}
                activeOpacity={0.75}
              >
                <Text style={[s.hsChipTxt, activeTab === t.id && s.hsChipTxtActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={s.hsResultRow}>
            <Text style={s.hsResultCount}>
              {displayJobs.length} {displayJobs.length === 1 ? 'job' : 'jobs'}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
              {SORT_OPTIONS.map(o => (
                <TouchableOpacity key={o.id} onPress={() => setSortBy(o.id as any)} activeOpacity={0.7}>
                  <Text style={[s.hsSortTxt, sortBy === o.id && s.hsSortTxtActive]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
        {loading ? (
          <View style={s.loader}><ActivityIndicator size="large" color="#2563EB" /><Text style={s.loaderTxt}>Loading jobs...</Text></View>
        ) : (
          <FlatList
            data={displayJobs}
            keyExtractor={j => j.id}
            renderItem={renderJob}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={7}
            onScroll={handleTabBarScroll} scrollEventThrottle={16} contentContainerStyle={[s.list, !displayJobs.length && s.listEmpty, { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }]}
            ListEmptyComponent={
              <View style={s.empty}>
                <Text style={s.emptyEmoji}>💼</Text>
                <Text style={s.emptyTitle}>
                  {search ? 'No jobs found' :
                    scopeMode === 'primary' ? 'Nothing near you yet' :
                    scopeMode === 'global' ? 'No remote roles yet' : 'No jobs yet'}
                </Text>
                <Text style={s.emptyTxt}>
                  {search ? 'Try a different search.' :
                    scopeMode === 'primary' ? 'Be the first to post a role in your area.' :
                    'Try switching scopes.'}
                </Text>
                <TouchableOpacity style={s.emptyPostBtn} onPress={() => setShowPost(true)}>
                  <Text style={s.emptyPostBtnTxt}>Post a Job</Text>
                </TouchableOpacity>
              </View>
            }
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll(false); }} tintColor="#2563EB" />}
          />
        )}
      </View>

      <Modal visible={!!recTarget} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setRecTarget(null); setRecName(''); setRecContact(''); setRecMessage(''); }}>
        <SafeAreaView style={s.modalSafe}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Recommend Someone</Text>
              <TouchableOpacity onPress={() => { setRecTarget(null); setRecName(''); setRecContact(''); setRecMessage(''); }} style={s.modalClose}>
                <Text style={s.modalCloseTxt}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={s.modalBody} keyboardShouldPersistTaps="handled">
              {recTarget && (
                <>
                  <View style={s.applyJobBanner}>
                    <Text style={s.applyJobTitle}>{recTarget.title}</Text>
                    <Text style={s.applyJobCompany}>{recTarget.company}</Text>
                  </View>
                  <View style={s.recPrivacyNote}>
                    <Text style={s.recPrivacyTxt}>🔒 Only the job poster will see this recommendation.</Text>
                  </View>
                  <Text style={s.fieldLabel2}>Person's full name *</Text>
                  <TextInput
                    value={recName} onChangeText={setRecName}
                    placeholder="e.g. Sarah Kimani"
                    placeholderTextColor="#9CA3AF"
                    style={s.coverInput}
                    autoFocus
                  />
                  <Text style={s.fieldLabel2}>Contact info (optional)</Text>
                  <TextInput
                    value={recContact} onChangeText={setRecContact}
                    placeholder="Email, LinkedIn, or phone number"
                    placeholderTextColor="#9CA3AF"
                    style={s.coverInput}
                  />
                  <Text style={s.fieldLabel2}>Why are you recommending them? (optional)</Text>
                  <TextInput
                    value={recMessage} onChangeText={setRecMessage}
                    placeholder="Brief note about their background or fit..."
                    placeholderTextColor="#9CA3AF"
                    style={[s.coverInput, { minHeight: 100 }]}
                    multiline numberOfLines={4}
                  />
                  <TouchableOpacity
                    style={[s.submitBtn, (!recName.trim() || recommending) && { opacity: 0.5 }]}
                    onPress={submitRecommendation}
                    disabled={!recName.trim() || recommending}
                  >
                    {recommending
                      ? <ActivityIndicator color="#FFF" />
                      : <Text style={s.submitBtnTxt}>Send Recommendation</Text>}
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      

      <Modal visible={!!viewRecsJob} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setViewRecsJob(null); setJobRecs([]); }}>
        <SafeAreaView style={s.modalSafe}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Recommendations {viewRecsJob?.title ? `— ${viewRecsJob.title}` : ''}</Text>
            <TouchableOpacity onPress={() => { setViewRecsJob(null); setJobRecs([]); }} style={s.modalClose}>
              <Text style={s.modalCloseTxt}>✕</Text>
            </TouchableOpacity>
          </View>
          <View style={s.recPrivacyNote}>
            <Text style={s.recPrivacyTxt}>🔒 Only you can see these recommendations.</Text>
          </View>
          {loadingRecs
            ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#2563EB" size="large" /></View>
            : (
              <FlatList
                data={jobRecs}
                keyExtractor={r => r.id}
                onScroll={handleTabBarScroll} scrollEventThrottle={16} contentContainerStyle={[s.list, { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }]}
                ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTxt}>No recommendations yet.</Text></View>}
                renderItem={({ item }) => {
                  const rec = item as JobRecommendation;
                  return (
                    <View style={s.appCard}>
                      <Text style={s.appJobTitle}>⭐ {rec.recommended_name}</Text>
                      {rec.recommended_contact && <Text style={s.appCompany}>📬 {rec.recommended_contact}</Text>}
                      {rec.message && <Text style={s.appNote}>{rec.message}</Text>}
                      <Text style={s.appDate}>
                        Recommended by {(rec as any).recommender?.full_name || 'a member'} · {formatTime(rec.created_at)}
                      </Text>
                    </View>
                  );
                }}
              />
            )
          }
        </SafeAreaView>
      </Modal>

      <Modal visible={showPost} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowPost(false)}>
        <SafeAreaView style={s.modalSafe}>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Post a Job</Text>
              <TouchableOpacity onPress={() => setShowPost(false)} style={s.modalClose}><Text style={s.modalCloseTxt}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={s.modalBody} keyboardShouldPersistTaps="handled">

              

              <Text style={s.fieldLabel2}>Job Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: 14 }}>
                {CATEGORY_TABS.filter(t => t.id !== 'all').map(t => (
                  <TouchableOpacity
                    key={t.id}
                    style={[s.catChip, postForm.category === t.id && s.catChipActive]}
                    onPress={() => setPostForm(p => ({ ...p, category: t.id as JobCategory }))}
                  >
                    <Text style={[s.catChipTxt, postForm.category === t.id && s.catChipTxtActive]}>{t.emoji} {t.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={s.fieldLabel2}>Job Title *</Text>
              <TextInput value={postForm.title} onChangeText={v => setPostForm(p => ({...p, title: v}))} placeholder="e.g. Global Strategy Analyst" placeholderTextColor="#9CA3AF" style={s.formInput} />

              <Text style={s.fieldLabel2}>Company *</Text>
              <TextInput value={postForm.company} onChangeText={v => setPostForm(p => ({...p, company: v}))} placeholder="Company or organization name" placeholderTextColor="#9CA3AF" style={s.formInput} />

              <Text style={s.fieldLabel2}>Location</Text>
              <TextInput value={postForm.location} onChangeText={v => setPostForm(p => ({...p, location: v}))} placeholder="City, Country or Remote" placeholderTextColor="#9CA3AF" style={s.formInput} />

              <Text style={s.fieldLabel2}>Work Mode</Text>
              <View style={s.toggleRow}>
                {(['on_site','hybrid','remote'] as const).map(rt => (
                  <TouchableOpacity
                    key={rt}
                    style={[s.toggleChip, postForm.remote_type === rt && s.toggleChipActive]}
                    onPress={() => setPostForm(p => ({...p, remote_type: rt}))}
                  >
                    <Text style={[s.toggleChipTxt, postForm.remote_type === rt && s.toggleChipTxtActive]}>
                      {rt === 'on_site' ? '🏢 On-site' : rt === 'hybrid' ? '🔀 Hybrid' : '🌐 Remote'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={s.fieldLabel2}>Experience Level</Text>
              <View style={s.toggleRow}>
                {(['entry','mid','senior','executive'] as const).map(el => (
                  <TouchableOpacity
                    key={el}
                    style={[s.toggleChip, postForm.experience_level === el && s.toggleChipActive]}
                    onPress={() => setPostForm(p => ({...p, experience_level: el}))}
                  >
                    <Text style={[s.toggleChipTxt, postForm.experience_level === el && s.toggleChipTxtActive]}>
                      {el.charAt(0).toUpperCase() + el.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={s.fieldLabel2}>Industry</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginBottom: 14 }}>
                {INDUSTRIES.map(ind => (
                  <TouchableOpacity
                    key={ind}
                    style={[s.toggleChip, postForm.industry === ind && s.toggleChipActive]}
                    onPress={() => setPostForm(p => ({...p, industry: p.industry === ind ? '' : ind}))}
                  >
                    <Text style={[s.toggleChipTxt, postForm.industry === ind && s.toggleChipTxtActive]}>{ind}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={s.fieldLabel2}>Salary Range</Text>
              <TextInput value={postForm.salary_range} onChangeText={v => setPostForm(p => ({...p, salary_range: v}))} placeholder="e.g. $60,000 - $80,000 / year" placeholderTextColor="#9CA3AF" style={s.formInput} />

              <Text style={s.fieldLabel2}>Apply URL (optional)</Text>
              <TextInput value={postForm.apply_url} onChangeText={v => setPostForm(p => ({...p, apply_url: v}))} placeholder="https://..." placeholderTextColor="#9CA3AF" style={s.formInput} autoCapitalize="none" />

              <Text style={s.fieldLabel2}>Description *</Text>
              <TextInput
                value={postForm.description} onChangeText={v => setPostForm(p => ({...p, description: v}))}
                placeholder="Describe the role, responsibilities, and requirements..."
                placeholderTextColor="#9CA3AF" style={[s.formInput, s.formTextarea]}
                multiline numberOfLines={6}
              />


              <View style={s.switchRow}>
                <View style={s.switchInfo}>
                  <Text style={s.switchLabel}>⚡ Urgent Hiring</Text>
                  <Text style={s.switchSub}>Shows urgent badge on your listing</Text>
                </View>
                <TouchableOpacity
                  style={[s.switchBtn, postForm.urgent && s.switchBtnOn]}
                  onPress={() => setPostForm(p => ({...p, urgent: !p.urgent}))}
                >
                  <Text style={s.switchBtnTxt}>{postForm.urgent ? 'Yes' : 'No'}</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[s.submitBtn, posting && { opacity: 0.5 }]}
                onPress={submitPost} disabled={posting}
              >
                {posting ? <ActivityIndicator color="#FFF" /> : <Text style={s.submitBtnTxt}>Publish Job</Text>}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  hsTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12 },
  hsPageTitle: { fontSize: 26, fontWeight: '700', color: '#111827', letterSpacing: -0.6 },
  hsTopActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  hsTopBtn: { paddingVertical: 4 },
  hsTopBtnTxt: { fontSize: 13.5, fontWeight: '600', color: '#4B5563' },
  hsPostBtn: { backgroundColor: '#0B1E3D', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  hsPostBtnTxt: { fontSize: 13.5, fontWeight: '700', color: '#FFFFFF' },
  hsSearch: { marginHorizontal: 16, marginTop: 10, backgroundColor: '#FAFAF9', borderWidth: 1, borderColor: 'rgba(11,30,61,0.12)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#0B1E3D' },
  hsTabRow: { flexDirection: 'row', paddingHorizontal: 16, marginTop: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E0E0E0' },
  hsTab: { marginRight: 22, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  hsTabActive: { borderBottomColor: '#0B1E3D' },
  hsTabTxt: { fontSize: 14.5, fontWeight: '600', color: '#6B7280' },
  hsTabTxtActive: { color: '#0B1E3D', fontWeight: '700' },
  hsChipRow: { paddingHorizontal: 16, gap: 8, paddingVertical: 12 },
  hsChip: { paddingHorizontal: 13, height: 32, borderRadius: 16, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  hsChipActive: { backgroundColor: 'rgba(11,30,61,0.06)', borderColor: '#0B1E3D' },
  hsChipTxt: { fontSize: 13, fontWeight: '600', color: '#374151' },
  hsChipTxtActive: { color: '#0B1E3D' },
  hsResultRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12, gap: 16 },
  hsResultCount: { fontSize: 14, fontWeight: '700', color: '#111827' },
  hsSortTxt: { fontSize: 13.5, fontWeight: '600', color: '#9CA3AF' },
  hsSortTxtActive: { color: '#0B1E3D' },
  hsIconBtn: { padding: 6, position: 'relative' },
  hsDot: { position: 'absolute', top: 0, right: -2, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#FF3040', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  hsDotTxt: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '800' },
  hsCardRoot: { backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#E0E0E0', marginBottom: 10, overflow: 'hidden' },
  hsSecondary: { flexDirection: 'row', gap: 18, paddingHorizontal: 14, paddingBottom: 12, paddingTop: 2 },
  hsLink: { paddingVertical: 4 },
  hsLinkTxt: { fontSize: 13, fontWeight: '600', color: '#0B1E3D' },
  hsCard: { flexDirection: 'row', gap: 12, padding: 14 },
  hsLogo: { width: 48, height: 48, borderRadius: 12, backgroundColor: '#0B1E3D', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(201,191,176,0.7)' },
  hsLogoTxt: { fontSize: 18, fontWeight: '800', color: '#C9BFB0' },
  hsTitle: { fontSize: 16, fontWeight: '700', color: '#0B1E3D', letterSpacing: -0.3 },
  hsCompany: { fontSize: 14, color: '#4B5563', marginTop: 2 },
  hsMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  hsMeta: { fontSize: 13, color: '#6B7280' },
  hsSalary: { fontSize: 13.5, fontWeight: '700', color: '#059669', marginTop: 5 },
  hsTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  hsTag: { backgroundColor: '#F3F4F6', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  hsTagTxt: { fontSize: 11.5, fontWeight: '600', color: '#374151' },
  hsTagNew: { backgroundColor: '#DBEAFE' },
  hsTagNewTxt: { color: '#1D4ED8' },
  hsTagSoon: { backgroundColor: '#FFEDD5' },
  hsTagSoonTxt: { color: '#C2410C' },
  hsSave: { padding: 4 },
  hsFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  hsPosted: { fontSize: 12, color: '#9CA3AF' },
  hsApply: { backgroundColor: '#0B1E3D', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9 },
  hsApplyTxt: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '700' },
  hsApplied: { backgroundColor: '#F3F4F6' },
  hsAppliedTxt: { color: '#6B7280' },
  safe: { flex: 1, backgroundColor: '#F4F6F9' },
  container: { flex: 1, backgroundColor: '#F4F6F9' },
  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, backgroundColor: '#F4F6F9' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '800', color: '#0F172A', letterSpacing: -0.5 },
  subtitle: { marginTop: 3, fontSize: 13, color: '#64748B', fontWeight: '500' },
  headerBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  savedBtn: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#FEF9C3', borderRadius: 10, borderWidth: 1, borderColor: '#FDE047' },
  savedBtnTxt: { fontSize: 13, fontWeight: '700', color: '#854D0E' },
  myAppsBtn: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#F1F5F9', borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0' },
  myAppsBtnTxt: { fontSize: 13, fontWeight: '600', color: '#475569' },
  postBtn: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#2563EB', borderRadius: 10 },
  postBtnTxt: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  search: { backgroundColor: '#FFF', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: '#0F172A', marginBottom: 10 },

  scopeRow: { flexDirection: 'row', gap: 6, marginBottom: 10 },
  scopeTab: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 9, borderRadius: 10,
    backgroundColor: '#F1F5F9',
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  scopeTabActive: { backgroundColor: '#0F172A', borderColor: '#0F172A' },
  scopeTabTxt: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  scopeTabTxtActive: { color: '#FFFFFF' },

  tabScroll: { marginBottom: 8 },
  tabContent: { paddingRight: 8, gap: 6 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#E2E8F0' },
  tabActive: { backgroundColor: '#0F172A' },
  tabTxt: { fontSize: 12, fontWeight: '600', color: '#64748B' },
  tabTxtActive: { color: '#FFF' },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  resultsCount: { fontSize: 12, fontWeight: '700', color: '#94A3B8', textTransform: 'uppercase', letterSpacing: 0.4, minWidth: 60 },
  sortChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  sortChipActive: { backgroundColor: '#1E293B', borderColor: '#1E293B' },
  sortChipTxt: { fontSize: 12, fontWeight: '600', color: '#64748B' },
  sortChipTxtActive: { color: '#FFF' },
  list: { paddingHorizontal: 14 },
  listEmpty: { flexGrow: 1 },

  card: { backgroundColor: '#FFF', borderRadius: 20, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, marginBottom: 12 },
  cardBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10, alignItems: 'center' },
  catBadge: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  catBadgeTxt: { fontSize: 11, fontWeight: '700' },
  locationBadge: { backgroundColor: '#EFF6FF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 160 },
  locationBadgeTxt: { fontSize: 11, fontWeight: '700', color: '#1D4ED8' },
  globalBadge: { backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  globalBadgeTxt: { fontSize: 11, fontWeight: '700', color: '#374151' },
  urgentBadge: { backgroundColor: '#FEF3C7', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  urgentTxt: { fontSize: 11, fontWeight: '700', color: '#D97706' },
  verifiedBadge: { backgroundColor: '#F0F9FF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  verifiedTxt: { fontSize: 11, fontWeight: '700', color: '#0284C7' },
  scorePill: { marginLeft: 'auto', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  scoreTxt: { fontSize: 12, fontWeight: '800' },
  cardMain: { flexDirection: 'row', gap: 12 },
  cardLeft: { flex: 1 },
  jobTitle: { fontSize: 17, fontWeight: '800', color: '#0F172A', marginBottom: 3 },
  jobCompany: { fontSize: 14, fontWeight: '600', color: '#475569', marginBottom: 4 },
  jobMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  jobMeta: { fontSize: 12, color: '#64748B' },
  salary: { fontSize: 13, fontWeight: '700', color: '#059669', marginBottom: 6 },
  jobFooter: { flexDirection: 'row', gap: 10 },
  jobTime: { fontSize: 11, color: '#94A3B8' },
  jobApps: { fontSize: 11, color: '#94A3B8' },
  cardPoster: { alignItems: 'center', width: 56 },
  posterAvatar: { width: 44, height: 44, borderRadius: 22, marginBottom: 4 },
  posterAvatarFb: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  posterAvatarTxt: { fontSize: 14, fontWeight: '700', color: '#1D4ED8' },
  posterName: { fontSize: 10, color: '#64748B', textAlign: 'center', fontWeight: '500' },
  whyRow: { backgroundColor: '#F8FAFC', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginTop: 8 },
  whyTxt: { fontSize: 12, color: '#475569', fontWeight: '500' },
  statusBanner: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, marginTop: 8 },
  statusBannerTxt: { fontSize: 12, fontWeight: '700' },
  cardActions: { flexDirection: 'row', gap: 6, marginTop: 12, flexWrap: 'wrap' },
  actionSave: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  actionSaveActive: { backgroundColor: '#FEF9C3', borderColor: '#FDE047' },
  actionSaveTxt: { fontSize: 12, fontWeight: '600', color: '#475569' },
  actionSaveTxtActive: { color: '#854D0E' },
  actionApply: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: '#2563EB' },
  actionApplyTxt: { fontSize: 12, fontWeight: '700', color: '#FFF' },
  actionApplied: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  actionAppliedTxt: { fontSize: 12, fontWeight: '700' },
  actionRecommend: { backgroundColor: '#7C3AED', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  actionRecommendTxt: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  actionMsg: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EFF6FF', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#BFDBFE' },
  actionMsgTxt: { color: '#1D4ED8', fontSize: 12, fontWeight: '700' },
  posterActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, flex: 1 },
  posterActionBtn: { backgroundColor: '#F0FDF4', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#86EFAC' },
  posterActionTxt: { color: '#15803D', fontSize: 13, fontWeight: '600' },
  actionDelete: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: '#FEF2F2' },
  actionDeleteTxt: { fontSize: 12, fontWeight: '600', color: '#DC2626' },
  recPrivacyNote: { backgroundColor: '#FFF7ED', marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#FED7AA' },
  recPrivacyTxt: { fontSize: 13, color: '#C2410C', fontWeight: '500', textAlign: 'center' },
  statusChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#F9FAFB' },
  statusChipTxt: { fontSize: 12, color: '#6B7280', fontWeight: '600' },

  modalSafe: { flex: 1, backgroundColor: '#FFF' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E0E0E0' },
  modalTitle: { fontSize: 19, fontWeight: '700', color: '#111827', flex: 1, letterSpacing: -0.4 },
  modalClose: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  modalCloseTxt: { fontSize: 16, color: '#64748B', fontWeight: '700' },
  modalBody: { padding: 16, paddingBottom: 40 },
  applyJobBanner: { backgroundColor: '#F8FAFC', borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#E2E8F0' },
  applyJobTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: 4 },
  applyJobCompany: { fontSize: 13, color: '#64748B' },
  fieldLabel: { fontSize: 14, color: '#475569', marginBottom: 12 },
  fieldLabel2: { fontSize: 13, fontWeight: '700', color: '#111827', marginBottom: 7, marginTop: 4 },
  coverInput: { backgroundColor: '#F8FAFC', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, fontSize: 14, color: '#0F172A', textAlignVertical: 'top', minHeight: 100, marginBottom: 16 },
  referUserAvatar: { width: 42, height: 42, borderRadius: 21 },
  referUserAvatarFb: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' },
  referUserAvatarTxt: { fontSize: 14, fontWeight: '700', color: '#1D4ED8' },
  submitBtn: { backgroundColor: '#2563EB', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  submitBtnTxt: { fontSize: 16, fontWeight: '800', color: '#FFF' },
  formInput: { backgroundColor: '#FFFFFF', borderRadius: 10, borderWidth: 1, borderColor: '#D1D5DB', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111827', marginBottom: 14 },
  formTextarea: { textAlignVertical: 'top', minHeight: 120 },
  catChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0' },
  catChipActive: { backgroundColor: '#0F172A', borderColor: '#0F172A' },
  catChipTxt: { fontSize: 12, fontWeight: '600', color: '#475569' },
  catChipTxtActive: { color: '#FFF' },
  toggleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 14 },
  toggleChip: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D1D5DB' },
  toggleChipActive: { backgroundColor: '#EFF3FA', borderColor: '#0B1E3D' },
  toggleChipTxt: { fontSize: 12, fontWeight: '600', color: '#475569' },
  toggleChipTxtActive: { color: '#0B1E3D' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F8FAFC', borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#E2E8F0' },
  switchInfo: { flex: 1 },
  switchLabel: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  switchSub: { fontSize: 12, color: '#64748B', marginTop: 2 },
  switchBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: '#E2E8F0' },
  switchBtnOn: { backgroundColor: '#2563EB' },
  switchBtnTxt: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  appCard: { backgroundColor: '#FFF', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 14, marginBottom: 10 },
  appCardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  appCardInfo: { flex: 1 },
  appJobTitle: { fontSize: 15, fontWeight: '700', color: '#0F172A' },
  appCompany: { fontSize: 13, color: '#64748B', marginTop: 2 },
  appDate: { fontSize: 12, color: '#94A3B8', marginTop: 4 },
  appStatusBadge: { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  appStatusTxt: { fontSize: 12, fontWeight: '700' },
  appNote: { fontSize: 13, color: '#475569', marginTop: 8, fontStyle: 'italic' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loaderTxt: { marginTop: 12, fontSize: 14, color: '#64748B' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingTop: 60 },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#0F172A', textAlign: 'center' },
  emptyTxt: { marginTop: 8, fontSize: 14, color: '#64748B', textAlign: 'center', lineHeight: 20 },
  emptyPostBtn: { marginTop: 20, backgroundColor: '#2563EB', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  emptyPostBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});
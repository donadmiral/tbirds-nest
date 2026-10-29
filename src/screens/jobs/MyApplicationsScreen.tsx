import { jobsBack } from '../../navigation/jobsNavigation';
import { ListRowSkeleton } from '../../components/skeletons';
import { themedSheet, getTheme, useTheme } from '../../theme/useTheme';
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, StatusBar, Alert } from 'react-native';
import { SafeAreaView } from '../../components/SafeArea';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import { jobsService, JobApplication, STATUS_META } from '../../services/jobsService';
import JobListRow from '../../components/jobs/JobListRow';
import { type ApplicantCursor, canWithdrawApplication, mergeApplicants } from '../../../shared/hiring';

function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 1) return 'now'; if (m < 60) return m + 'm'; if (h < 24) return h + 'h';
  if (dy < 7) return dy + 'd';
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function MyApplicationsScreen() {
  const { isDark } = useTheme();
  const navigation = useNavigation<any>();
  const userId = useAuthStore(st => st.profile?.id);
  const [apps, setApps] = useState<JobApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const cursor = useRef<ApplicantCursor | null>(null);
  const request = useRef(0);
  const pending = useRef(false);
  const retryAppend = useRef(false);
  const activeUser = useRef(userId);
  activeUser.current = userId;
  const withdrawalPending = useRef(false);
  const focused = useRef(false);

  const load = useCallback(async (append = false) => {
    if (append && pending.current) return;
    const token = ++request.current;
    pending.current = true; retryAppend.current = append;
    setLoading(true); setLoadError(false);
    try {
      if (!userId) throw new Error('Sign in to see your applications.');
      const page = await jobsService.getMyApplicationsPage(append ? cursor.current : null);
      if (token !== request.current || activeUser.current !== userId) return;
      cursor.current = page.cursor; setHasMore(page.has_more);
      setApps(previous => append ? mergeApplicants(previous, page.applications) : page.applications);
    } catch { if (token === request.current) setLoadError(true); }
    finally { if (token === request.current) { pending.current = false; setLoading(false); } }
  }, [userId]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    setApps([]); cursor.current = null; setHasMore(false); setWithdrawing(null);
    void load();
    return () => { focused.current = false; request.current++; pending.current = false; };
  }, [load]));

  const withdraw = (application: JobApplication) => {
    const owner = userId;
    Alert.alert('Withdraw application?', 'The employer will be notified. Your application history stays available, but this application cannot be reopened.', [
      { text: 'Keep application', style: 'cancel' },
      { text: 'Withdraw', style: 'destructive', onPress: () => {
        if (withdrawalPending.current || !focused.current || !owner || activeUser.current !== owner) return;
        withdrawalPending.current = true; setWithdrawing(application.id);
        void (async () => {
          try {
            const saved = await jobsService.withdrawApplication(application);
            if (!focused.current || activeUser.current !== owner) return;
            // Prevent a pre-withdrawal page response from restoring stale status.
            request.current++; pending.current = false; setLoading(false);
            setApps(previous => previous.map(row => row.id === saved.id ? saved : row));
          } catch (error) {
            if (focused.current && activeUser.current === owner) Alert.alert('Could not withdraw', error instanceof Error ? error.message : 'Refresh and try again.');
          } finally {
            withdrawalPending.current = false;
            if (focused.current && activeUser.current === owner) setWithdrawing(null);
          }
        })();
      } },
    ]);
  };

  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={getTheme().surface.canvas} />
      <View style={st.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to jobs" onPress={() => jobsBack(navigation, useAuthStore.getState().profile?.account_type === 'business')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color={getTheme().ink.primary} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>My applications</Text>
        <View style={{ width: 26 }} />
      </View>
      {loading && apps.length === 0 ? (
        <ListRowSkeleton />
      ) : loadError && apps.length === 0 ? (
        <View style={st.center}><Text style={st.emptyTitle}>Could not load applications</Text><TouchableOpacity accessibilityRole="button" onPress={() => void load()} style={st.action}><Text style={st.emptySub}>Tap to retry</Text></TouchableOpacity></View>
      ) : apps.length === 0 ? (
        <View style={st.center}>
          <Ionicons name="document-text-outline" size={38} color="#C7CDD6" />
          <Text style={st.emptyTitle}>No applications yet</Text>
          <Text style={st.emptySub}>Jobs you apply to will appear here with their live status.</Text>
        </View>
      ) : (
        <FlatList
          data={apps}
          keyExtractor={i => i.id}
          refreshing={loading && !retryAppend.current}
          onRefresh={() => void load()}
          ItemSeparatorComponent={() => <View style={st.sep} />}
          contentContainerStyle={{ paddingVertical: 4, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          ListFooterComponent={
            <View style={st.footer}>
              {loadError ? <Text accessibilityRole="alert" style={st.emptySub}>Could not load applications. Your loaded applications are still available.</Text> : null}
              {loading ? <ActivityIndicator color={getTheme().ink.primary} /> : loadError || hasMore ? (
                <TouchableOpacity accessibilityRole="button" onPress={() => void load(loadError ? retryAppend.current : true)} style={st.action}>
                  <Text style={st.actionText}>{loadError ? 'Retry' : 'Load more applications'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status] || STATUS_META.applied;
            return (
              <View>
                <JobListRow
                job={item.job ?? { title: 'Job no longer available' }}
                subtitle={'Applied ' + (relTime(item.applied_at) || 'date unavailable') + (item.status === 'interview' && (item as any).interview_at ? '  ·  Interview ' + new Date((item as any).interview_at).toLocaleString() : '') + ((item as any).cv_name ? '  ·  ' + (item as any).cv_name : '')}
                onPress={() => item.job && navigation.navigate('JobDetail', { job: item.job })}
                right={
                  <View style={[st.chip, { backgroundColor: meta.bg }]}>
                    <Text style={[st.chipTxt, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                }
              />
              {canWithdrawApplication(item.status) ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={'Withdraw application for ' + (item.job?.title || 'this job')} disabled={withdrawing !== null} onPress={() => withdraw(item)} style={st.withdraw}>
                <Text style={st.actionText}>{withdrawing === item.id ? 'Withdrawing…' : 'Withdraw application'}</Text>
              </TouchableOpacity> : null}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const st = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surface.hairline },
  headerTitle: { fontSize: 16, fontWeight: '800', color: t.ink.primary },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: t.brand.tintBg, marginLeft: 74 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyTitle: { fontSize: 16.5, fontWeight: '800', color: t.ink.primary, marginTop: 12 },
  emptySub: { fontSize: 13.5, color: t.ink.secondary, textAlign: 'center', marginTop: 4, lineHeight: 19 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  chipTxt: { fontSize: 12, fontWeight: '800' },
  action: { minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  actionText: { fontSize: 13, color: t.ink.secondary, textDecorationLine: 'underline' },
  withdraw: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-end', paddingHorizontal: 16, marginBottom: 4 },
  footer: { alignItems: 'center', padding: 16 },
}));

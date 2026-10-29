import { ListRowSkeleton } from '../../components/skeletons';
import { themedSheet, getTheme, useTheme } from '../../theme/useTheme';
import EmptyState from '../../components/EmptyState';
import React, { useCallback, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, StatusBar, Alert } from 'react-native';
import { SafeAreaView } from '../../components/SafeArea';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import { jobsService, Job } from '../../services/jobsService';
import JobListRow from '../../components/jobs/JobListRow';
import { jobsBack } from '../../navigation/jobsNavigation';

const NAVY = '#0B1E3D';

export default function SavedJobsScreen() {
  const { isDark } = useTheme();
  const navigation = useNavigation<any>();
  const userId = useAuthStore(st => st.profile?.id);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const pending = useRef(new Set<string>());

  useFocusEffect(useCallback(() => {
    let live = true;
    (async () => {
      setLoading(true); setLoadError(false);
      if (!userId) { if (live) { setLoading(false); setLoadError(true); } return; }
      try { const rows = await jobsService.getSavedJobs(userId); if (live) setJobs(rows); }
      catch { if (live) setLoadError(true); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [userId, retry]));

  const unsave = useCallback(async (jobId: string) => {
    if (!userId || pending.current.has(jobId)) return;
    const index = jobs.findIndex(job => job.id === jobId), previous = jobs[index];
    pending.current.add(jobId);
    setJobs(list => list.filter(x => x.id !== jobId));
    try { await jobsService.unsaveJob(userId, jobId); }
    catch {
      if (useAuthStore.getState().profile?.id === userId && previous) {
        setJobs(list => list.some(job => job.id === jobId) ? list : [...list.slice(0, index), previous, ...list.slice(index)]);
        Alert.alert('Could not unsave job', 'Please try again.');
      }
    } finally { pending.current.delete(jobId); }
  }, [userId, jobs]);

  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={getTheme().surface.canvas} />
      <View style={st.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to jobs" onPress={() => jobsBack(navigation, useAuthStore.getState().profile?.account_type === 'business')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color={getTheme().ink.primary} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Saved jobs</Text>
        <View style={{ width: 26 }} />
      </View>
      {loading ? (
        <ListRowSkeleton />
      ) : loadError ? (
        <View style={st.center}><Text style={st.emptyTitle}>Could not load saved jobs</Text><TouchableOpacity accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={st.emptySub}>Tap to retry</Text></TouchableOpacity></View>
      ) : jobs.length === 0 ? (
        <View style={st.center}>
          <Ionicons name="bookmark-outline" size={38} color="#C7CDD6" />
          <Text style={st.emptyTitle}>Nothing saved yet</Text>
          <Text style={st.emptySub}>Tap the bookmark on any job to keep it here for later.</Text>
        </View>
      ) : (
        <FlatList
 ListEmptyComponent={<EmptyState icon="bookmark" title="No saved jobs" line="Jobs you save appear here." />}          data={jobs}
          keyExtractor={i => i.id}
          ItemSeparatorComponent={() => <View style={st.sep} />}
          contentContainerStyle={{ paddingVertical: 4, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <JobListRow
              job={item}
              subtitle={item.salary_range || null}
              onPress={() => navigation.navigate('JobDetail', { job: item })}
              right={
                <TouchableOpacity onPress={() => unsave(item.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="bookmark" size={20} color="#2563EB" />
                </TouchableOpacity>
              }
            />
          )}
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
}));

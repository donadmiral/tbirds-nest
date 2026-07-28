import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import { jobsService, Job } from '../../services/jobsService';
import JobListRow from '../../components/jobs/JobListRow';

const NAVY = '#0B1E3D';

export default function SavedJobsScreen() {
  const navigation = useNavigation<any>();
  const userId = useAuthStore(st => st.profile?.id);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let live = true;
    (async () => {
      if (!userId) return;
      try { const rows = await jobsService.getSavedJobs(userId); if (live) setJobs(rows); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [userId]));

  const unsave = useCallback(async (jobId: string) => {
    if (!userId) return;
    const prev = jobs;
    setJobs(list => list.filter(x => x.id !== jobId));
    try { await jobsService.unsaveJob(userId, jobId); }
    catch { setJobs(prev); }
  }, [userId, jobs]);

  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color={NAVY} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Saved jobs</Text>
        <View style={{ width: 26 }} />
      </View>
      {loading ? (
        <View style={st.center}><ActivityIndicator size="large" color={NAVY} /></View>
      ) : jobs.length === 0 ? (
        <View style={st.center}>
          <Ionicons name="bookmark-outline" size={38} color="#C7CDD6" />
          <Text style={st.emptyTitle}>Nothing saved yet</Text>
          <Text style={st.emptySub}>Tap the bookmark on any job to keep it here for later.</Text>
        </View>
      ) : (
        <FlatList
          data={jobs}
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

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(11,30,61,0.08)' },
  headerTitle: { fontSize: 16, fontWeight: '800', color: NAVY },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(11,30,61,0.07)', marginLeft: 74 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyTitle: { fontSize: 16.5, fontWeight: '800', color: NAVY, marginTop: 12 },
  emptySub: { fontSize: 13.5, color: 'rgba(11,30,61,0.55)', textAlign: 'center', marginTop: 4, lineHeight: 19 },
});
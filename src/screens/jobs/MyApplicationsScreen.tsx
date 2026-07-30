import EmptyState from '../../components/EmptyState';
import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../stores/authStore';
import { jobsService, JobApplication, STATUS_META } from '../../services/jobsService';
import JobListRow from '../../components/jobs/JobListRow';

const NAVY = '#0B1E3D';

function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 1) return 'now'; if (m < 60) return m + 'm'; if (h < 24) return h + 'h';
  if (dy < 7) return dy + 'd';
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function MyApplicationsScreen() {
  const navigation = useNavigation<any>();
  const userId = useAuthStore(st => st.profile?.id);
  const [apps, setApps] = useState<JobApplication[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let live = true;
    (async () => {
      if (!userId) return;
      try { const rows = await jobsService.getMyApplications(userId); if (live) setApps(rows); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [userId]));

  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color={NAVY} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>My applications</Text>
        <View style={{ width: 26 }} />
      </View>
      {loading ? (
        <View style={st.center}><ActivityIndicator size="large" color={NAVY} /></View>
      ) : apps.length === 0 ? (
        <View style={st.center}>
          <Ionicons name="document-text-outline" size={38} color="#C7CDD6" />
          <Text style={st.emptyTitle}>No applications yet</Text>
          <Text style={st.emptySub}>Jobs you apply to will appear here with their live status.</Text>
        </View>
      ) : (
        <FlatList
 ListEmptyComponent={<EmptyState icon="send" title="No applications yet" line="Roles you apply for show up here with their status." />}          data={apps}
          keyExtractor={i => i.id}
          ItemSeparatorComponent={() => <View style={st.sep} />}
          contentContainerStyle={{ paddingVertical: 4, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status] || STATUS_META.applied;
            return (
              <JobListRow
                job={item.job}
                subtitle={'Applied ' + relTime(item.applied_at) + ((item as any).interview_at ? '  ·  Interview ' + new Date((item as any).interview_at).toLocaleString() : '') + ((item as any).cv_name ? '  ·  ' + (item as any).cv_name : '')}
                onPress={() => item.job && navigation.navigate('JobDetail', { job: item.job })}
                right={
                  <View style={[st.chip, { backgroundColor: meta.bg }]}>
                    <Text style={[st.chipTxt, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                }
              />
            );
          }}
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
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  chipTxt: { fontSize: 12, fontWeight: '800' },
});
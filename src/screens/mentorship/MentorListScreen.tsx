import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, Image,
  TextInput, ActivityIndicator, StatusBar, ScrollView, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  listMentors, MentorListItem, MentorKind, MENTOR_KIND_LABEL,
} from '../../services/mentorshipService';

function initials(n?: string | null) {
  if (!n) return '?';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}

const COLORS = ['#1D4ED8','#065F46','#7C2D12','#5856D6','#C2410C','#0F766E','#7C3AED','#0B1E3D'];
function colorFor(id: string) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % COLORS.length;
  return COLORS[Math.abs(h) % COLORS.length];
}

const KIND_COLOR: Record<MentorKind, { bg: string; fg: string }> = {
  alumni:         { bg: '#FEF3C7', fg: '#B45309' },
  faculty:        { bg: '#EDE9FE', fg: '#6D28D9' },
  staff:          { bg: '#DBEAFE', fg: '#1E3A8A' },
  student_mentor: { bg: '#D1FAE5', fg: '#065F46' },
};

const FILTERS: Array<{ id: MentorKind | 'all'; label: string }> = [
  { id: 'all',            label: 'All' },
  { id: 'alumni',         label: 'Alumni' },
  { id: 'faculty',        label: 'Faculty' },
  { id: 'staff',          label: 'Staff' },
  { id: 'student_mentor', label: 'Student mentors' },
];

export default function MentorListScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();

  const [mentors, setMentors] = useState<MentorListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<MentorKind | 'all'>('all');

  const load = useCallback(async () => {
    const data = await listMentors({
      search: search.trim() || undefined,
      kind: filter === 'all' ? null : filter,
    });
    setMentors(data);
    setLoading(false);
    setRefreshing(false);
  }, [search, filter]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const renderItem = ({ item }: { item: MentorListItem }) => {
    const kindStyle = KIND_COLOR[item.mentor_kind];
    return (
      <TouchableOpacity
        style={s.card}
        activeOpacity={0.8}
        onPress={() => nav.navigate('MentorProfile', { mentorId: item.profile_id })}
      >
        <View style={s.cardTop}>
          {item.avatar_url ? (
            <Image source={{ uri: item.avatar_url }} style={s.avatar} />
          ) : (
            <View style={[s.avatar, { backgroundColor: colorFor(item.profile_id) }]}>
              <Text style={s.avatarTxt}>{initials(item.full_name)}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.name} numberOfLines={1}>{item.full_name || 'Mentor'}</Text>
            {item.headline ? (
              <Text style={s.headline} numberOfLines={1}>{item.headline}</Text>
            ) : null}
            <View style={[s.kindPill, { backgroundColor: kindStyle.bg }]}>
              <Text style={[s.kindPillTxt, { color: kindStyle.fg }]}>
                {MENTOR_KIND_LABEL[item.mentor_kind]}
              </Text>
            </View>
          </View>
          <View style={[s.capPill, item.has_capacity ? s.capOpen : s.capFull]}>
            <Text style={[s.capTxt, item.has_capacity ? s.capOpenTxt : s.capFullTxt]}>
              {item.active_mentees}/{item.max_active_mentees}
            </Text>
          </View>
        </View>

        {item.bio ? (
          <Text style={s.bio} numberOfLines={2}>{item.bio}</Text>
        ) : null}

        {item.help_with.length > 0 && (
          <View style={s.tagRow}>
            {item.help_with.slice(0, 3).map(t => (
              <View key={t} style={s.tag}>
                <Text style={s.tagTxt}>{t}</Text>
              </View>
            ))}
            {item.help_with.length > 3 && (
              <Text style={s.moreTxt}>+{item.help_with.length - 3}</Text>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => nav.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={26} color="#000" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Find a mentor</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={s.searchWrap}>
        <Feather name="search" size={16} color="#8E8E93" />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Name, role, or expertise"
          placeholderTextColor="#9CA3AF"
          style={s.searchInput}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.filterRow}
        style={{ flexGrow: 0 }}
      >
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.id}
            style={[s.filterChip, filter === f.id && s.filterChipActive]}
            onPress={() => setFilter(f.id)}
            activeOpacity={0.75}
          >
            <Text style={[s.filterTxt, filter === f.id && s.filterTxtActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={s.loader}><ActivityIndicator color="#000" /></View>
      ) : (
        <FlatList
          data={mentors}
          keyExtractor={m => m.profile_id}
          renderItem={renderItem}
          contentContainerStyle={[s.list, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="users" size={36} color="#E5E5EA" />
              <Text style={s.emptyTitle}>No mentors found</Text>
              <Text style={s.emptySub}>
                {search.trim() || filter !== 'all'
                  ? 'Try a different search or filter.'
                  : 'Nobody at your school has signed up as a mentor yet. Be the first!'}
              </Text>
              {(!search.trim() && filter === 'all') && (
                <TouchableOpacity style={s.emptyBtn} onPress={() => nav.navigate('BecomeMentor')}>
                  <Text style={s.emptyBtnTxt}>Become a mentor</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12, marginBottom: 8,
    backgroundColor: '#F5F5F5', borderRadius: 12,
    paddingHorizontal: 12, height: 40,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#000' },

  filterRow: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
  filterChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18,
    backgroundColor: '#F3F4F6',
  },
  filterChipActive: { backgroundColor: '#000' },
  filterTxt: { fontSize: 13, fontWeight: '600', color: '#374151' },
  filterTxtActive: { color: '#FFF' },

  list: { paddingHorizontal: 14, paddingTop: 4, gap: 10 },

  card: {
    backgroundColor: '#FFF', borderRadius: 16,
    padding: 14, gap: 10,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E7EB',
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 16, fontWeight: '800', color: '#FFF' },
  name: { fontSize: 15, fontWeight: '700', color: '#000' },
  headline: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  kindPill: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
  kindPillTxt: { fontSize: 11, fontWeight: '700' },

  capPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  capOpen: { backgroundColor: '#D1FAE5' },
  capFull: { backgroundColor: '#FEE2E2' },
  capTxt: { fontSize: 12, fontWeight: '800' },
  capOpenTxt: { color: '#065F46' },
  capFullTxt: { color: '#991B1B' },

  bio: { fontSize: 13, color: '#374151', lineHeight: 18 },

  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  tag: { backgroundColor: '#F3F4F6', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  tagTxt: { fontSize: 11, color: '#374151', fontWeight: '600' },
  moreTxt: { fontSize: 11, color: '#6B7280', fontWeight: '600' },

  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: '#000', marginTop: 8 },
  emptySub: { fontSize: 13, color: '#6B7280', textAlign: 'center', lineHeight: 18 },
  emptyBtn: {
    marginTop: 12, backgroundColor: '#000',
    paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12,
  },
  emptyBtnTxt: { color: '#FFF', fontSize: 14, fontWeight: '700' },
});
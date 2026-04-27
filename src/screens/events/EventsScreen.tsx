import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator,
  StatusBar, RefreshControl, Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import type { MinglePost } from '../../types';

function initials(n?: string | null) {
  if (!n) return 'E';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}

function fmtDate(d?: string | null) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

type EventWithHost = MinglePost & {
  host_name: string;
  host_avatar: string | null;
  attendees_count: number;
};

export default function EventsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();

  const [events, setEvents] = useState<EventWithHost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'upcoming' | 'all' | 'mine'>('upcoming');

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('mingle_posts')
        .select('*')
        .order('event_time', { ascending: true });

      if (error) { console.log('[EVENTS_LOAD]', error.message); return; }
      if (!data?.length) { setEvents([]); return; }

      const hostIds = Array.from(new Set(data.map((e: any) => e.host_id)));
      const { data: hosts } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', hostIds);

      const hostMap: Record<string, any> = {};
      (hosts || []).forEach((h: any) => { hostMap[h.id] = h; });

      const eventIds = data.map((e: any) => e.id);
      const { data: attendanceRows } = await supabase
        .from('mingle_post_attendees')
        .select('post_id')
        .in('post_id', eventIds);

      const attendeeCounts: Record<string, number> = {};
      (attendanceRows || []).forEach((row: any) => {
        attendeeCounts[row.post_id] = (attendeeCounts[row.post_id] || 0) + 1;
      });

      const enriched: EventWithHost[] = data.map((e: any) => ({
        ...e,
        host_name: hostMap[e.host_id]?.full_name || 'Host',
        host_avatar: hostMap[e.host_id]?.avatar_url || null,
        attendees_count: attendeeCounts[e.id] || 0,
      }));

      setEvents(enriched);
    } catch (e) {
      console.log('[EVENTS_LOAD_CATCH]', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const filteredEvents = events.filter(e => {
    if (filter === 'mine') return e.host_id === profile?.id;
    if (filter === 'upcoming') {
      const t = new Date(e.event_time).getTime();
      return !isNaN(t) && t >= Date.now() - 3600_000;
    }
    return true;
  });

  const renderEvent = ({ item }: { item: EventWithHost }) => (
    <TouchableOpacity
      style={s.card}
      activeOpacity={0.85}
      onPress={() => navigation.navigate('MingleDetails', { postId: item.id })}
    >
      {item.image_url
        ? <Image source={{ uri: item.image_url }} style={s.cover} />
        : <View style={[s.cover, s.coverFb]}>
            <Text style={s.coverFbTxt}>{initials(item.title)}</Text>
          </View>}

      <View style={s.cardBody}>
        <View style={s.categoryRow}>
          <View style={s.categoryPill}>
            <Text style={s.categoryTxt}>{item.category}</Text>
          </View>
          <View style={s.attendeeBadge}>
            <Feather name="users" size={11} color="#8E8E93" />
            <Text style={s.attendeeTxt}>{item.attendees_count}</Text>
          </View>
        </View>

        <Text style={s.title} numberOfLines={2}>{item.title}</Text>

        <View style={s.metaRow}>
          <Feather name="calendar" size={12} color="#6B7280" />
          <Text style={s.metaTxt}>{fmtDate(item.event_time)}</Text>
        </View>
        <View style={s.metaRow}>
          <Feather name="map-pin" size={12} color="#6B7280" />
          <Text style={s.metaTxt} numberOfLines={1}>{item.location}</Text>
        </View>

        <View style={s.hostRow}>
          {item.host_avatar
            ? <Image source={{ uri: item.host_avatar }} style={s.hostAvatar} />
            : <View style={[s.hostAvatar, s.hostAvatarFb]}>
                <Text style={s.hostAvatarTxt}>{initials(item.host_name)}</Text>
              </View>}
          <Text style={s.hostName} numberOfLines={1}>Hosted by {item.host_name}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Events</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('CreateEvent')}
          style={s.createBtn}
          activeOpacity={0.8}
        >
          <Feather name="plus" size={16} color="#FFF" />
          <Text style={s.createBtnTxt}>Host</Text>
        </TouchableOpacity>
      </View>

      <View style={s.filterBar}>
        {(['upcoming', 'all', 'mine'] as const).map(f => (
          <TouchableOpacity
            key={f}
            style={[s.filterChip, filter === f && s.filterChipActive]}
            onPress={() => setFilter(f)}
            activeOpacity={0.75}
          >
            <Text style={[s.filterTxt, filter === f && s.filterTxtActive]}>
              {f === 'upcoming' ? 'Upcoming' : f === 'all' ? 'All events' : 'My events'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color="#007AFF" /></View>
      ) : (
        <FlatList
          data={filteredEvents}
          keyExtractor={e => e.id}
          renderItem={renderEvent}
          contentContainerStyle={[s.list, !filteredEvents.length && s.listEmpty, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor="#007AFF"
            />
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="calendar" size={44} color="#E5E5EA" />
              <Text style={s.emptyTitle}>
                {filter === 'mine' ? 'No events hosted yet' : 'No events'}
              </Text>
              <Text style={s.emptySub}>
                {filter === 'mine' ? 'Host your first event and gather the PlatinumCircles community.' : 'Be the first to host a Mingle event.'}
              </Text>
              <TouchableOpacity
                style={s.emptyBtn}
                onPress={() => navigation.navigate('CreateEvent')}
                activeOpacity={0.85}
              >
                <Text style={s.emptyBtnTxt}>Host an event</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0',
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#000' },
  createBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#000', borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  createBtnTxt: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  filterBar: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F5F5F5',
  },
  filterChip: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20, backgroundColor: '#F5F5F5',
  },
  filterChipActive: { backgroundColor: '#000' },
  filterTxt: { fontSize: 13, fontWeight: '600', color: '#3C3C43' },
  filterTxtActive: { color: '#FFF' },
  list: { padding: 14, gap: 14 },
  listEmpty: { flexGrow: 1 },
  card: {
    backgroundColor: '#FFF', borderRadius: 18, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E5EA',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  cover: { width: '100%', height: 140, backgroundColor: '#F2F2F7' },
  coverFb: { alignItems: 'center', justifyContent: 'center' },
  coverFbTxt: { fontSize: 36, fontWeight: '800', color: '#C7C7CC' },
  cardBody: { padding: 14, gap: 6 },
  categoryRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 4,
  },
  categoryPill: {
    backgroundColor: '#EFF6FF', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  categoryTxt: { fontSize: 11, fontWeight: '700', color: '#007AFF' },
  attendeeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  attendeeTxt: { fontSize: 12, color: '#8E8E93', fontWeight: '600' },
  title: { fontSize: 17, fontWeight: '700', color: '#000', lineHeight: 22 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaTxt: { fontSize: 13, color: '#6B7280' },
  hostRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 8, paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F0F0F0',
  },
  hostAvatar: { width: 22, height: 22, borderRadius: 11 },
  hostAvatarFb: { backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  hostAvatarTxt: { fontSize: 9, fontWeight: '800', color: '#1D4ED8' },
  hostName: { flex: 1, fontSize: 12, color: '#6B7280' },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 32, paddingTop: 60, gap: 10,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#000' },
  emptySub: { fontSize: 14, color: '#8E8E93', textAlign: 'center', lineHeight: 20 },
  emptyBtn: {
    marginTop: 12, backgroundColor: '#000', borderRadius: 14,
    paddingHorizontal: 28, paddingVertical: 13,
  },
  emptyBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '700' },
});

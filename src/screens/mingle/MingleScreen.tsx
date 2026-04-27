/**
 * MingleScreen.tsx
 * Option C: Timeline view with working date filtering,
 * rolling near-infinite date strip, smart filters, event-time grouping/sorting,
 * and realtime attendee/comment refresh. Design remains unchanged.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  StatusBar, RefreshControl, TextInput, Image, ScrollView, Modal,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { pickFromLibrary, uploadMedia, PickedMedia } from '../../services/mediaService';
import SafeImage from '../../components/SafeImage';

const NAVY = '#0B1E3D';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#8E8E93';
const HAIRLINE = '#E5E5EA';
const GREEN = '#059669';

type ScopeMode = 'primary' | 'all' | 'global';
type SmartFilter = 'all' | 'today' | 'week' | 'upcoming';

type MingleItem = {
  id: string;
  title: string;
  category: string;
  location: string;
  time: string;
  host: string;
  host_id: string;
  description: string;
  attendees: number;
  comments: number;
  joined: boolean;
  image_url: string | null;
  created_at: string;
  institution_name: string | null;
  scope: 'institution' | 'affiliation' | 'global' | null;
};

const CATEGORIES = ['Dinner', 'Coffee Chat', 'Study', 'Trip', 'Sports', 'Networking', 'Party', 'Other'];

const CAT_EMOJI: Record<string, string> = {
  All: '🌍', Dinner: '🍽️', 'Coffee Chat': '☕', Study: '📚',
  Trip: '✈️', Sports: '⚽', Networking: '🤝', Party: '🎉', Other: '✨',
};

const CAT_COLOR: Record<string, string> = {
  Dinner: '#FF3B30', 'Coffee Chat': '#FF9500', Study: '#5856D6',
  Trip: '#34C759', Sports: '#FF6B35', Networking: '#007AFF',
  Party: '#FF2D55', Other: '#8E8E93',
};

const SCOPE_TABS: { id: ScopeMode; label: string }[] = [
  { id: 'primary', label: 'My School' },
  { id: 'all', label: 'All Schools' },
  { id: 'global', label: 'Global' },
];

const SMART_FILTERS: { id: SmartFilter; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { id: 'upcoming', label: 'Upcoming', icon: 'calendar' },
  { id: 'today', label: 'Today', icon: 'sun' },
  { id: 'week', label: 'This Week', icon: 'clock' },
  { id: 'all', label: 'All', icon: 'list' },
];

function parseDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function safeDate(raw?: string | null, fallback?: string | null): Date {
  const first = raw ? new Date(raw) : null;
  if (first && !Number.isNaN(first.getTime())) return first;
  const second = fallback ? new Date(fallback) : null;
  if (second && !Number.isNaN(second.getTime())) return second;
  return new Date();
}

function eventDate(item: MingleItem): Date {
  return safeDate(item.time, item.created_at);
}

function eventDateKey(item: MingleItem): string {
  return eventDate(item).toISOString().split('T')[0];
}

function eventSortMs(item: MingleItem): number {
  return eventDate(item).getTime();
}

function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function startOfLocalDay(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isWithinNextDays(date: Date, days: number): boolean {
  const start = startOfLocalDay();
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return date >= start && date < end;
}

function fmtEventTime(eventTime: string, fallbackCreatedAt?: string): string {
  const parsed = eventTime ? new Date(eventTime) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (eventTime && eventTime.trim()) return eventTime.trim();
  const fallback = fallbackCreatedAt ? new Date(fallbackCreatedAt) : null;
  if (fallback && !Number.isNaN(fallback.getTime())) {
    return fallback.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return '';
}

function getDateChips(days = 365): { label: string; dow: string; day: number; month: string; date: Date; key: string }[] {
  const chips = [];
  const start = startOfLocalDay();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    chips.push({
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : '',
      dow: d.toLocaleDateString([], { weekday: 'short' }),
      day: d.getDate(),
      month: d.toLocaleDateString([], { month: 'short' }),
      date: d,
      key: localDateKey(d),
    });
  }
  return chips;
}

export default function MingleScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile, session } = useAuthStore();
  const myId = profile?.id ?? session?.user?.id ?? null;

  const [events, setEvents] = useState<MingleItem[]>([]);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [scopeMode, setScopeMode] = useState<ScopeMode>('primary');
  const [modalVisible, setModalVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [smartFilter, setSmartFilter] = useState<SmartFilter>('upcoming');
  const [dateHorizonDays, setDateHorizonDays] = useState(365);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [time, setTime] = useState('');
  const [description, setDescription] = useState('');
  const [composerScope, setComposerScope] = useState<'institution' | 'global'>('institution');
  const [pickedImage, setPickedImage] = useState<PickedMedia | null>(null);

  const dateChips = useMemo(() => getDateChips(dateHorizonDays), [dateHorizonDays]);

  const extendDateStripIfNeeded = useCallback((e: any) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const distanceFromEnd = contentSize.width - (contentOffset.x + layoutMeasurement.width);
    if (distanceFromEnd < 700) {
      setDateHorizonDays(prev => Math.min(prev + 365, 3650));
    }
  }, []);

  const clearForm = () => {
    setTitle('');
    setCategory('');
    setLocation('');
    setTime('');
    setDescription('');
    setComposerScope('institution');
    setPickedImage(null);
  };

  const load = useCallback(async (showLoader = true) => {
    if (!myId) return;
    try {
      if (showLoader) setLoading(true);
      const { data: rpcRows, error: rpcErr } = await supabase.rpc('get_scoped_mingle', {
        p_user_id: myId,
        p_mode: scopeMode,
        p_limit: 80,
        p_before: null,
      });

      if (rpcErr) {
        console.log('[MINGLE_RPC_ERR]', rpcErr.message);
        setEvents([]);
        return;
      }

      const posts = (rpcRows || []) as any[];
      if (posts.length === 0) {
        setEvents([]);
        return;
      }

      const hostIds = Array.from(new Set(posts.map((p: any) => p.host_id).filter(Boolean)));
      const postIds = posts.map((p: any) => p.id).filter(Boolean);

      const [profilesRes, attRes, cmtRes] = await Promise.all([
        hostIds.length
          ? supabase.from('profiles').select('id, full_name').in('id', hostIds)
          : Promise.resolve({ data: [] as any[] }),
        postIds.length
          ? supabase.from('mingle_post_attendees').select('post_id, user_id').in('post_id', postIds)
          : Promise.resolve({ data: [] as any[] }),
        postIds.length
          ? supabase.from('mingle_comments').select('id, post_id').in('post_id', postIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const pm: Record<string, string> = {};
      (profilesRes.data || []).forEach((p: any) => { pm[p.id] = p.full_name || 'User'; });

      const attMap: Record<string, string[]> = {};
      (attRes.data || []).forEach((a: any) => {
        if (!attMap[a.post_id]) attMap[a.post_id] = [];
        attMap[a.post_id].push(a.user_id);
      });

      const cmtMap: Record<string, number> = {};
      (cmtRes.data || []).forEach((c: any) => {
        cmtMap[c.post_id] = (cmtMap[c.post_id] || 0) + 1;
      });

      setEvents(posts.map((p: any) => ({
        id: p.id,
        title: p.title,
        category: p.category,
        location: p.location,
        time: p.event_time,
        host: pm[p.host_id] || 'User',
        host_id: p.host_id,
        description: p.description || '',
        image_url: p.image_url,
        attendees: (attMap[p.id] || []).length,
        comments: cmtMap[p.id] || 0,
        joined: (attMap[p.id] || []).includes(myId),
        created_at: p.created_at,
        institution_name: p.institution_name ?? null,
        scope: p.scope ?? null,
      })));
    } catch (e) {
      console.log('MINGLE_LOAD', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [myId, scopeMode]);

  useEffect(() => {
    load(true);
    const ch = supabase.channel('mingle_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mingle_posts' }, () => load(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mingle_post_attendees' }, () => load(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mingle_comments' }, () => load(false))
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [load]);

  const pickImage = async () => {
    try {
      const picked = await pickFromLibrary({ allowVideos: false, multiple: false });
      if (picked.length > 0) setPickedImage(picked[0]);
    } catch (e: any) {
      Alert.alert('Could not pick image', e?.message || '');
    }
  };

  const handleCreate = async () => {
    if (!myId) return;
    if (!title.trim() || !category.trim() || !location.trim() || !time.trim()) {
      Alert.alert('Missing fields', 'Please fill in title, category, location, and time.');
      return;
    }

    setSubmitting(true);
    try {
      let imageUrl: string | null = null;
      if (pickedImage) {
        try {
          const uploaded = await uploadMedia('mingle-media', myId, pickedImage);
          const head = await fetch(uploaded.url, { method: 'HEAD' });
          if (!head.ok) throw new Error('Upload not reachable');
          imageUrl = uploaded.url;
        } catch (e: any) {
          Alert.alert('Image upload failed', e?.message || '');
          setSubmitting(false);
          return;
        }
      }

      const { data: pd, error } = await supabase.from('mingle_posts').insert([{
        host_id: myId,
        title: title.trim(),
        category: category.trim(),
        location: location.trim(),
        event_time: time.trim(),
        description: description.trim() || null,
        image_url: imageUrl,
        scope: composerScope,
        updated_at: new Date().toISOString(),
      }]).select().single();

      if (error) {
        Alert.alert('Error', error.message);
        return;
      }

      await supabase.from('mingle_post_attendees').insert({ post_id: pd.id, user_id: myId });
      clearForm();
      setModalVisible(false);
      Alert.alert('Posted!', 'Your Mingle event is now live.');
      await load(false);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not create event.');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleJoin = async (item: MingleItem) => {
    if (!myId || joiningId) return;
    setJoiningId(item.id);
    try {
      if (item.joined) {
        const { error } = await supabase.from('mingle_post_attendees')
          .delete()
          .eq('post_id', item.id)
          .eq('user_id', myId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('mingle_post_attendees')
          .insert({ post_id: item.id, user_id: myId });
        if (error) throw error;
      }

      setEvents(prev => prev.map(e => e.id === item.id
        ? { ...e, joined: !e.joined, attendees: Math.max(0, e.attendees + (e.joined ? -1 : 1)) }
        : e));
    } catch {
      Alert.alert('Error', 'Could not update attendance.');
    } finally {
      setJoiningId(null);
    }
  };

  const displayed = useMemo(() => {
    const term = search.trim().toLowerCase();
    const todayKey = localDateKey(new Date());

    const list = events.filter(e => {
      const eventDt = eventDate(e);
      const key = localDateKey(eventDt);
      const matchCat = !catFilter || e.category === catFilter;
      const matchSearch = !term
        || e.title.toLowerCase().includes(term)
        || e.location.toLowerCase().includes(term)
        || e.host.toLowerCase().includes(term)
        || e.description.toLowerCase().includes(term);

      const matchDate = selectedDate ? key === selectedDate : true;
      const matchSmart = selectedDate
        ? true
        : smartFilter === 'all'
          ? true
          : smartFilter === 'today'
            ? key === todayKey
            : smartFilter === 'week'
              ? isWithinNextDays(eventDt, 7)
              : eventDt >= startOfLocalDay();

      return matchCat && matchSearch && matchDate && matchSmart;
    });

    list.sort((a, b) => eventSortMs(a) - eventSortMs(b));
    return list;
  }, [events, search, catFilter, selectedDate, smartFilter]);

  const grouped = useMemo(() => {
    const groups: { label: string; key: string; events: MingleItem[] }[] = [];
    const map: Record<string, MingleItem[]> = {};

    displayed.forEach(e => {
      const key = eventDateKey(e);
      if (!map[key]) map[key] = [];
      map[key].push(e);
    });

    const sortedKeys = Object.keys(map).sort((a, b) => a.localeCompare(b));
    sortedKeys.forEach(key => {
      groups.push({
        label: parseDateLabel(key),
        key,
        events: map[key].sort((a, b) => eventSortMs(a) - eventSortMs(b)),
      });
    });

    return groups;
  }, [displayed]);

  const renderEventCard = (item: MingleItem, isLast: boolean) => {
    const busy = joiningId === item.id;
    const catColor = CAT_COLOR[item.category] || '#007AFF';
    const hasImage = !!item.image_url;

    return (
      <View key={item.id} style={st.tlItem}>
        <View style={st.tlLeft}>
          <Text style={st.tlTime}>{fmtEventTime(item.time, item.created_at)}</Text>
          <View style={[st.tlDot, item.joined && st.tlDotActive]} />
          {!isLast && <View style={st.tlLine} />}
        </View>

        <TouchableOpacity
          style={st.tlCard}
          activeOpacity={0.88}
          onPress={() => navigation.navigate('MingleDetails', { postId: item.id })}
        >
          {hasImage && (
            <SafeImage uri={item.image_url!} style={st.cardImage} logPrefix="MINGLE" showFallbackLabel={false} />
          )}

          <View style={st.cardBody}>
            <View style={st.cardTopRow}>
              <View style={[st.catChip, { backgroundColor: catColor + '18', borderColor: catColor + '30' }]}>
                <Text style={{ fontSize: 12 }}>{CAT_EMOJI[item.category] || '✨'}</Text>
                <Text style={[st.catChipTxt, { color: catColor }]}>{item.category}</Text>
              </View>
              {item.scope === 'global' ? (
                <View style={st.scopeBadge}>
                  <Feather name="globe" size={10} color="#6B7280" />
                  <Text style={st.scopeBadgeTxt}>Global</Text>
                </View>
              ) : item.institution_name ? (
                <View style={[st.scopeBadge, { backgroundColor: '#EFF6FF' }]}>
                  <Feather name="award" size={10} color="#1D4ED8" />
                  <Text style={[st.scopeBadgeTxt, { color: '#1D4ED8' }]} numberOfLines={1}>{item.institution_name}</Text>
                </View>
              ) : null}
            </View>

            <Text style={st.cardTitle}>{item.title}</Text>

            <View style={st.metaRow}><Feather name="user" size={12} color={TEXT_SECONDARY} /><Text style={st.metaTxt}>{item.host}</Text></View>
            <View style={st.metaRow}><Feather name="map-pin" size={12} color={TEXT_SECONDARY} /><Text style={st.metaTxt}>{item.location}</Text></View>
            <View style={st.metaRow}><Feather name="clock" size={12} color={TEXT_SECONDARY} /><Text style={st.metaTxt}>{item.time}</Text></View>

            {item.description ? <Text style={st.cardDesc} numberOfLines={2}>{item.description}</Text> : null}

            <View style={st.cardFoot}>
              <View style={st.goingRow}>
                <Feather name="users" size={13} color={TEXT_SECONDARY} />
                <Text style={st.goingTxt}>{item.attendees} going</Text>
                {item.comments > 0 && (
                  <>
                    <Text style={st.dotSep}>.</Text>
                    <Feather name="message-circle" size={12} color={TEXT_SECONDARY} />
                    <Text style={st.goingTxt}>{item.comments}</Text>
                  </>
                )}
              </View>
              <View style={st.cardBtns}>
                <TouchableOpacity
                  style={[st.joinBtn, item.joined && st.joinedBtn]}
                  onPress={(e) => { e.stopPropagation(); toggleJoin(item); }}
                  disabled={busy}
                  activeOpacity={0.7}
                >
                  {busy
                    ? <ActivityIndicator color={item.joined ? TEXT_PRIMARY : '#FFF'} size={12} />
                    : <>
                        <Feather name={item.joined ? 'check' : 'user-plus'} size={13} color={item.joined ? GREEN : '#FFF'} />
                        <Text style={[st.joinBtnTxt, item.joined && st.joinedBtnTxt]}>
                          {item.joined ? 'Going' : 'Join'}
                        </Text>
                      </>
                  }
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />

      <View style={st.header}>
        <View>
          <Text style={st.title}>Mingle</Text>
          <Text style={st.subtitle}>Events, hangouts and social plans</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={st.hdrBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Feather name="chevron-left" size={20} color={NAVY} />
          </TouchableOpacity>
          <TouchableOpacity style={[st.hdrBtn, st.hdrBtnFill]} onPress={() => setModalVisible(true)} activeOpacity={0.7}>
            <Feather name="plus" size={20} color="#FFF" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={st.scopeRow}>
        {SCOPE_TABS.map(sc => (
          <TouchableOpacity key={sc.id} style={[st.scopeTab, scopeMode === sc.id && st.scopeTabOn]}
            onPress={() => setScopeMode(sc.id)} activeOpacity={0.7}>
            <Text style={[st.scopeTabTxt, scopeMode === sc.id && st.scopeTabTxtOn]}>{sc.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={st.dateStrip}
        onScroll={extendDateStripIfNeeded}
        scrollEventThrottle={16}
      >
        {dateChips.map(chip => {
          const isOn = selectedDate === chip.key;
          return (
            <TouchableOpacity key={chip.key} style={[st.dateChip, isOn && st.dateChipOn]}
              onPress={() => { setSelectedDate(isOn ? '' : chip.key); setSmartFilter('all'); }} activeOpacity={0.7}>
              <Text style={[st.dateChipDow, isOn && st.dateChipDowOn]}>{chip.dow}</Text>
              <Text style={[st.dateChipDay, isOn && st.dateChipDayOn]}>{chip.day}</Text>
              <Text style={[st.dateChipMonth, isOn && st.dateChipMonthOn]}>{chip.month}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={st.searchBar}>
        <Feather name="search" size={15} color={TEXT_SECONDARY} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search events..."
          placeholderTextColor={TEXT_SECONDARY} style={st.searchInput} clearButtonMode="while-editing" />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.smartRow}>
        {SMART_FILTERS.map(filter => {
          const isActive = !selectedDate && smartFilter === filter.id;
          return (
            <TouchableOpacity
              key={filter.id}
              style={[st.smartChip, isActive && st.smartChipOn]}
              onPress={() => { setSelectedDate(''); setSmartFilter(filter.id); }}
              activeOpacity={0.7}
            >
              <Feather name={filter.icon} size={13} color={isActive ? '#FFF' : NAVY} />
              <Text style={[st.smartChipTxt, isActive && st.smartChipTxtOn]}>{filter.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.catRow}>
        {['', ...CATEGORIES].map(c => {
          const label = c || 'All';
          const isActive = catFilter === c;
          return (
            <TouchableOpacity key={label} style={[st.catChipFilter, isActive && st.catChipFilterOn]}
              onPress={() => setCatFilter(c)} activeOpacity={0.7}>
              <Text style={{ fontSize: 13 }}>{CAT_EMOJI[label] || '✨'}</Text>
              <Text style={[st.catChipFilterTxt, isActive && st.catChipFilterTxtOn]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={st.center}><ActivityIndicator color={NAVY} size="large" /></View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(false); }} tintColor={NAVY} />}
          contentContainerStyle={[st.listContent, displayed.length === 0 && { flex: 1 }, { paddingBottom: insets.bottom + 60 }]}
        >
          {displayed.length === 0 ? (
            <View style={st.empty}>
              <View style={st.emptyIcon}><Feather name="calendar" size={32} color="#C7C7CC" /></View>
              <Text style={st.emptyTitle}>
                {search || catFilter || selectedDate ? 'No results' :
                  scopeMode === 'primary' ? 'Nothing from your school yet' :
                  scopeMode === 'global' ? 'No global events yet' : 'No events yet'}
              </Text>
              <Text style={st.emptySub}>
                {search || catFilter || selectedDate ? 'Try a different search, category, or date.' :
                  scopeMode === 'primary' ? 'Create the first event for your school.' : 'Try switching scopes.'}
              </Text>
              {!search && !catFilter && !selectedDate && (
                <TouchableOpacity style={st.emptyBtn} onPress={() => setModalVisible(true)} activeOpacity={0.85}>
                  <Text style={st.emptyBtnTxt}>Create event</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            grouped.map(group => (
              <View key={group.key}>
                <Text style={st.dateSectionLabel}>{group.label}</Text>
                {group.events.map((ev, idx) => renderEventCard(ev, idx === group.events.length - 1))}
              </View>
            ))
          )}
        </ScrollView>
      )}

      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet"
        onRequestClose={() => { clearForm(); setModalVisible(false); }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <View style={st.modalHeader}>
            <TouchableOpacity onPress={() => { clearForm(); setModalVisible(false); }}>
              <Text style={st.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={st.modalTitle}>New Mingle</Text>
            <TouchableOpacity onPress={handleCreate} disabled={submitting}>
              {submitting ? <ActivityIndicator color={NAVY} size={16} /> : <Text style={st.modalPost}>Post</Text>}
            </TouchableOpacity>
          </View>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <ScrollView contentContainerStyle={st.modalBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={st.mField}>
                <Text style={st.mLabel}>Visibility</Text>
                <View style={st.scopePickerRow}>
                  <TouchableOpacity style={[st.scopePickerChip, composerScope === 'institution' && st.scopePickerChipOn]}
                    onPress={() => setComposerScope('institution')}>
                    <Feather name="award" size={14} color={composerScope === 'institution' ? '#FFF' : '#1D4ED8'} />
                    <Text style={[st.scopePickerTxt, composerScope === 'institution' && st.scopePickerTxtOn]}>My School</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[st.scopePickerChip, composerScope === 'global' && st.scopePickerChipOn]}
                    onPress={() => setComposerScope('global')}>
                    <Feather name="globe" size={14} color={composerScope === 'global' ? '#FFF' : '#374151'} />
                    <Text style={[st.scopePickerTxt, composerScope === 'global' && st.scopePickerTxtOn]}>Global</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <View style={st.mField}>
                <Text style={st.mLabel}>Title *</Text>
                <TextInput value={title} onChangeText={setTitle} placeholder="Friday dinner meetup"
                  placeholderTextColor="#C7C7CC" style={st.mInput} />
              </View>
              <View style={st.mField}>
                <Text style={st.mLabel}>Location *</Text>
                <TextInput value={location} onChangeText={setLocation} placeholder="Tempe, AZ"
                  placeholderTextColor="#C7C7CC" style={st.mInput} />
              </View>
              <View style={st.mField}>
                <Text style={st.mLabel}>Time *</Text>
                <TextInput value={time} onChangeText={setTime} placeholder="2026-05-01 7:00 PM or Friday 7:00 PM"
                  placeholderTextColor="#C7C7CC" style={st.mInput} />
              </View>
              <View style={st.mField}>
                <Text style={st.mLabel}>Category *</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
                  {CATEGORIES.map(c => {
                    const isActive = category === c;
                    return (
                      <TouchableOpacity key={c} style={[st.catChipFilter, isActive && st.catChipFilterOn]}
                        onPress={() => setCategory(c)}>
                        <Text style={{ fontSize: 13 }}>{CAT_EMOJI[c] || '✨'}</Text>
                        <Text style={[st.catChipFilterTxt, isActive && st.catChipFilterTxtOn]}>{c}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
              <View style={st.mField}>
                <Text style={st.mLabel}>Description</Text>
                <TextInput value={description} onChangeText={setDescription} placeholder="What's this event about?"
                  placeholderTextColor="#C7C7CC" style={[st.mInput, { minHeight: 90, paddingTop: 12 }]}
                  multiline textAlignVertical="top" />
              </View>
              <View style={st.mField}>
                <Text style={st.mLabel}>Photo</Text>
                <TouchableOpacity style={st.photoBtn} onPress={pickImage} activeOpacity={0.8}>
                  <Feather name="image" size={16} color={NAVY} />
                  <Text style={st.photoBtnTxt}>{pickedImage ? 'Change photo' : 'Add a photo'}</Text>
                </TouchableOpacity>
                {pickedImage && <Image source={{ uri: pickedImage.uri }} style={st.photoPreview} resizeMode="cover" />}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  title: { fontSize: 26, fontWeight: '700', color: TEXT_PRIMARY, letterSpacing: -0.4 },
  subtitle: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 },
  hdrBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  hdrBtnFill: { backgroundColor: NAVY },

  scopeRow: { flexDirection: 'row', gap: 6, marginHorizontal: 16, marginBottom: 10 },
  scopeTab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, backgroundColor: '#F5F5F5', borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE },
  scopeTabOn: { backgroundColor: NAVY, borderColor: NAVY },
  scopeTabTxt: { fontSize: 12, fontWeight: '700', color: '#6B7280' },
  scopeTabTxtOn: { color: '#FFF' },

  dateStrip: { paddingHorizontal: 16, paddingBottom: 12, gap: 6 },
  dateChip: { alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: '#F2F2F7', minWidth: 54 },
  dateChipOn: { backgroundColor: NAVY },
  dateChipDow: { fontSize: 10, fontWeight: '600', color: TEXT_SECONDARY },
  dateChipDowOn: { color: 'rgba(255,255,255,0.7)' },
  dateChipDay: { fontSize: 18, fontWeight: '700', color: TEXT_PRIMARY, marginTop: 2 },
  dateChipDayOn: { color: '#FFF' },
  dateChipMonth: { fontSize: 10, fontWeight: '600', color: TEXT_SECONDARY, marginTop: 1 },
  dateChipMonthOn: { color: 'rgba(255,255,255,0.7)' },

  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F2F2F7', marginHorizontal: 16, marginBottom: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  searchInput: { flex: 1, fontSize: 14, color: '#000', padding: 0 },

  smartRow: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 10, gap: 6, alignItems: 'center' },
  smartChip: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 34, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 17, backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE },
  smartChipOn: { backgroundColor: NAVY, borderColor: NAVY },
  smartChipTxt: { fontSize: 12, fontWeight: '700', color: NAVY },
  smartChipTxtOn: { color: '#FFF' },

  catRow: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 14, gap: 8, alignItems: 'center', minHeight: 48 },
  catChipFilter: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 34, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 17, backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: HAIRLINE },
  catChipFilterOn: { backgroundColor: NAVY, borderColor: NAVY },
  catChipFilterTxt: { fontSize: 12, fontWeight: '600', color: '#3C3C43' },
  catChipFilterTxtOn: { color: '#FFF' },

  listContent: { paddingHorizontal: 0 },
  dateSectionLabel: { fontSize: 14, fontWeight: '700', color: TEXT_PRIMARY, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  tlItem: { flexDirection: 'row', paddingLeft: 16, paddingRight: 16, marginBottom: 0 },
  tlLeft: { width: 54, alignItems: 'center', position: 'relative', paddingTop: 14 },
  tlTime: { fontSize: 11, fontWeight: '600', color: TEXT_SECONDARY, marginBottom: 6, textAlign: 'center' },
  tlDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: NAVY, borderWidth: 2, borderColor: '#FFF', zIndex: 2 },
  tlDotActive: { backgroundColor: GREEN, shadowColor: GREEN, shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
  tlLine: { position: 'absolute', top: 48, bottom: -14, left: 26, width: 2, backgroundColor: '#F0F0F0', zIndex: 1 },

  tlCard: { flex: 1, marginLeft: 8, marginBottom: 14, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: '#F0F0F0', overflow: 'hidden', backgroundColor: '#FFF' },
  cardImage: { width: '100%', height: 140 },
  cardBody: { padding: 12 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  catChipTxt: { fontSize: 11, fontWeight: '700' },
  scopeBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3, maxWidth: 120 },
  scopeBadgeTxt: { fontSize: 10, fontWeight: '600', color: '#374151' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: TEXT_PRIMARY, marginBottom: 8, lineHeight: 20 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  metaTxt: { fontSize: 12, color: TEXT_SECONDARY },
  cardDesc: { fontSize: 13, color: '#3C3C43', lineHeight: 18, marginTop: 6, marginBottom: 4 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F0F0F0' },
  goingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  goingTxt: { fontSize: 12, color: TEXT_SECONDARY, fontWeight: '500' },
  dotSep: { fontSize: 14, color: '#C7C7CC', marginHorizontal: 2 },
  cardBtns: { flexDirection: 'row', gap: 6 },
  joinBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, backgroundColor: NAVY },
  joinedBtn: { backgroundColor: '#EDFBF0', borderWidth: 1, borderColor: '#BBF7D0' },
  joinBtnTxt: { fontSize: 12, fontWeight: '600', color: '#FFF' },
  joinedBtnTxt: { color: GREEN },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: TEXT_PRIMARY, textAlign: 'center' },
  emptySub: { fontSize: 13, color: TEXT_SECONDARY, textAlign: 'center', lineHeight: 18 },
  emptyBtn: { marginTop: 14, backgroundColor: NAVY, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  emptyBtnTxt: { color: '#FFF', fontSize: 14, fontWeight: '700' },

  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  modalCancel: { fontSize: 17, color: TEXT_SECONDARY },
  modalTitle: { fontSize: 17, fontWeight: '600', color: TEXT_PRIMARY },
  modalPost: { fontSize: 17, fontWeight: '700', color: NAVY },
  modalBody: { padding: 20 },
  mField: { marginBottom: 18 },
  mLabel: { fontSize: 13, fontWeight: '600', color: TEXT_SECONDARY, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  mInput: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: TEXT_PRIMARY },
  scopePickerRow: { flexDirection: 'row', gap: 8 },
  scopePickerChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12, backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: HAIRLINE },
  scopePickerChipOn: { backgroundColor: NAVY, borderColor: NAVY },
  scopePickerTxt: { fontSize: 14, fontWeight: '600', color: '#374151' },
  scopePickerTxtOn: { color: '#FFF' },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F2F2F7', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  photoBtnTxt: { fontSize: 15, fontWeight: '600', color: NAVY },
  photoPreview: { width: '100%', height: 180, borderRadius: 12, marginTop: 10 },
});

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Modal,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  StatusBar,
  RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';
import { pickFromLibrary, uploadMedia, PickedMedia } from '../../services/mediaService';
import SafeImage from '../../components/SafeImage';

type ScopeMode = 'primary' | 'all' | 'global';

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
  All: '🌍',
  Dinner: '🍽️',
  'Coffee Chat': '☕',
  Study: '📚',
  Trip: '✈️',
  Sports: '⚽',
  Networking: '🤝',
  Party: '🎉',
  Other: '✨',
};

const CAT_COLOR: Record<string, string> = {
  All: '#007AFF',
  Dinner: '#FF3B30',
  'Coffee Chat': '#FF9500',
  Study: '#5856D6',
  Trip: '#34C759',
  Sports: '#FF6B35',
  Networking: '#007AFF',
  Party: '#FF2D55',
  Other: '#8E8E93',
};

const SCOPE_TABS: { id: ScopeMode; label: string }[] = [
  { id: 'primary', label: 'My School' },
  { id: 'all', label: 'All Schools' },
  { id: 'global', label: 'Global' },
];

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

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [time, setTime] = useState('');
  const [description, setDescription] = useState('');
  const [composerScope, setComposerScope] = useState<'institution' | 'global'>('institution');
  const [pickedImage, setPickedImage] = useState<PickedMedia | null>(null);

  const clearForm = () => {
    setTitle('');
    setCategory('');
    setLocation('');
    setTime('');
    setDescription('');
    setComposerScope('institution');
    setPickedImage(null);
  };

  const load = useCallback(
    async (showLoader = true) => {
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

        const hostIds = Array.from(new Set(posts.map(p => p.host_id)));
        const postIds = posts.map(p => p.id);
        const [profilesRes, attRes, cmtRes] = await Promise.all([
          supabase.from('profiles').select('id, full_name').in('id', hostIds),
          supabase.from('mingle_post_attendees').select('post_id, user_id').in('post_id', postIds),
          supabase.from('mingle_comments').select('id, post_id').in('post_id', postIds),
        ]);
        const ps = profilesRes.data || [];
        const att = attRes.data || [];
        const cmt = cmtRes.data || [];

        const pm: Record<string, string> = {};
        ps.forEach((p: any) => {
          pm[p.id] = p.full_name || 'User';
        });
        const attMap: Record<string, string[]> = {};
        att.forEach((a: any) => {
          if (!attMap[a.post_id]) attMap[a.post_id] = [];
          attMap[a.post_id].push(a.user_id);
        });
        const cmtMap: Record<string, number> = {};
        cmt.forEach((c: any) => {
          cmtMap[c.post_id] = (cmtMap[c.post_id] || 0) + 1;
        });

        const mapped: MingleItem[] = posts.map((p: any) => ({
          id: p.id,
          title: p.title,
          category: p.category,
          location: p.location,
          time: p.event_time,
          host: pm[p.host_id] || 'User',
          host_id: p.host_id,
          description: p.description || 'No description.',
          image_url: p.image_url,
          attendees: (attMap[p.id] || []).length,
          comments: cmtMap[p.id] || 0,
          joined: (attMap[p.id] || []).includes(myId),
          created_at: p.created_at,
          institution_name: p.institution_name ?? null,
          scope: p.scope ?? null,
        }));
        setEvents(mapped);
      } catch (e) {
        console.log('MINGLE_LOAD', e);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [myId, scopeMode]
  );

  useEffect(() => {
    load(true);
    const ch = supabase
      .channel('mingle_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mingle_posts' }, () => load(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mingle_post_attendees' }, () => load(false))
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const pickImage = async () => {
    try {
      const picked = await pickFromLibrary({ allowVideos: false, multiple: false });
      if (picked.length > 0) setPickedImage(picked[0]);
    } catch (e: any) {
      Alert.alert('Could not pick image', e?.message || 'Unknown error');
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
          if (!head.ok) {
            throw new Error('Uploaded file is not reachable (' + head.status + ').');
          }
          imageUrl = uploaded.url;
        } catch (e: any) {
          console.log('[MINGLE_UPLOAD_FAIL]', e?.message);
          Alert.alert('Image upload failed', e?.message || 'Could not upload image.');
          setSubmitting(false);
          return;
        }
      }

      const { data: pd, error } = await supabase
        .from('mingle_posts')
        .insert([
          {
            host_id: myId,
            title: title.trim(),
            category: category.trim(),
            location: location.trim(),
            event_time: time.trim(),
            description: description.trim() || null,
            image_url: imageUrl,
            scope: composerScope,
            updated_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();
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
        await supabase
          .from('mingle_post_attendees')
          .delete()
          .eq('post_id', item.id)
          .eq('user_id', myId);
      } else {
        await supabase.from('mingle_post_attendees').insert({ post_id: item.id, user_id: myId });
      }
      setEvents((prev) =>
        prev.map((e) =>
          e.id === item.id
            ? { ...e, joined: !e.joined, attendees: e.attendees + (e.joined ? -1 : 1) }
            : e
        )
      );
    } catch {
      Alert.alert('Error', 'Could not update attendance.');
    } finally {
      setJoiningId(null);
    }
  };

  const displayed = useMemo(() => {
    const term = search.toLowerCase();
    return events.filter((e) => {
      const matchCat = !catFilter || e.category === catFilter;
      const matchSearch =
        !term ||
        e.title.toLowerCase().includes(term) ||
        e.location.toLowerCase().includes(term) ||
        e.host.toLowerCase().includes(term);
      return matchCat && matchSearch;
    });
  }, [events, search, catFilter]);

  const renderItem = ({ item }: { item: MingleItem }) => {
    const busy = joiningId === item.id;
    const joinLabel = item.joined ? 'Joined' : 'Join';
    return (
      <TouchableOpacity
        style={s.card}
        activeOpacity={0.88}
        onPress={() => navigation.navigate('MingleDetails', { postId: item.id })}
      >
        {item.image_url ? (
          <SafeImage
            uri={item.image_url}
            style={s.cardImage}
            logPrefix="MINGLE_CARD_IMG"
            showFallbackLabel={false}
          />
        ) : null}
        <View style={s.cardBody}>
          <View style={s.cardTop}>
            <View style={s.catPill}>
              <Text style={s.catPillTxt}>{item.category}</Text>
            </View>
            {item.scope === 'global' ? (
              <View style={s.globalPill}>
                <Feather name="globe" size={10} color="#6B7280" />
                <Text style={s.globalPillTxt}>Global</Text>
              </View>
            ) : item.institution_name ? (
              <View style={s.schoolPill}>
                <Feather name="award" size={10} color="#1D4ED8" />
                <Text style={s.schoolPillTxt} numberOfLines={1}>{item.institution_name}</Text>
              </View>
            ) : null}
            <Text style={s.goingTxt}>{item.attendees} going</Text>
          </View>
          <Text style={s.cardTitle}>{item.title}</Text>
          <View style={s.cardMeta}>
            <Feather name="user" size={13} color="#8E8E93" />
            <Text style={s.cardMetaTxt}>{item.host}</Text>
          </View>
          <View style={s.cardMeta}>
            <Feather name="map-pin" size={13} color="#8E8E93" />
            <Text style={s.cardMetaTxt}>{item.location}</Text>
          </View>
          <View style={s.cardMeta}>
            <Feather name="clock" size={13} color="#8E8E93" />
            <Text style={s.cardMetaTxt}>{item.time}</Text>
          </View>
          <Text style={s.cardDesc} numberOfLines={2}>
            {item.description}
          </Text>
          <View style={s.cardActions}>
            <TouchableOpacity
              style={s.viewBtn}
              onPress={() => navigation.navigate('MingleDetails', { postId: item.id })}
              activeOpacity={0.8}
            >
              <Text style={s.viewBtnTxt}>View</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.joinBtn, item.joined && s.joinedBtn]}
              onPress={(e) => {
                e.stopPropagation();
                toggleJoin(item);
              }}
              disabled={busy}
              activeOpacity={0.8}
            >
              {busy ? (
                <ActivityIndicator color={item.joined ? '#000' : '#FFF'} size={14} />
              ) : (
                <Text style={[s.joinBtnTxt, item.joined && s.joinedBtnTxt]}>{joinLabel}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <View>
          <Text style={s.title}>Mingle</Text>
          <Text style={s.subtitle}>Events, hangouts and social plans</Text>
        </View>
        <TouchableOpacity
          style={s.addBtn}
          onPress={() => setModalVisible(true)}
          activeOpacity={0.8}
        >
          <Feather name="plus" size={20} color="#FFF" />
        </TouchableOpacity>
      </View>

      <View style={s.searchWrap}>
        <Feather name="search" size={16} color="#8E8E93" />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search events..."
          placeholderTextColor="#8E8E93"
          style={s.searchInput}
          clearButtonMode="while-editing"
        />
      </View>

      {/* Scope toggle */}
      <View style={s.scopeRow}>
        {SCOPE_TABS.map(sc => (
          <TouchableOpacity
            key={sc.id}
            style={[s.scopeTab, scopeMode === sc.id && s.scopeTabActive]}
            onPress={() => setScopeMode(sc.id)}
            activeOpacity={0.7}
          >
            <Text style={[s.scopeTabTxt, scopeMode === sc.id && s.scopeTabTxtActive]}>
              {sc.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.catRow}>
        {['', ...CATEGORIES].map((c) => {
          const label = c || 'All';
          const isActive = catFilter === c;
          const color = CAT_COLOR[label] || '#007AFF';
          return (
            <TouchableOpacity
              key={c || 'all'}
              style={[s.chip, isActive && { backgroundColor: color, borderColor: color }]}
              onPress={() => setCatFilter(c)}
            >
              <Text style={s.chipEmoji}>{CAT_EMOJI[label] || '✨'}</Text>
              <Text style={[s.chipTxt, isActive && s.chipTxtActive]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={s.loader}>
          <ActivityIndicator color="#007AFF" size="large" />
        </View>
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={(i) => i.id}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            s.list,
            !displayed.length && s.listEmpty,
            { paddingBottom: Math.max(insets.bottom + 40, 60) },
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load(false);
              }}
              tintColor="#007AFF"
            />
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="coffee" size={40} color="#E5E5EA" />
              <Text style={s.emptyTitle}>
                {search || catFilter ? 'No results' :
                  scopeMode === 'primary' ? 'Nothing from your school yet' :
                  scopeMode === 'global' ? 'No global events yet' : 'No events yet'}
              </Text>
              <Text style={s.emptyTxt}>
                {search || catFilter ? 'Try a different search.' :
                  scopeMode === 'primary' ? 'Create the first event for your school.' :
                  'Try switching scopes.'}
              </Text>
              {!search && !catFilter ? (
                <TouchableOpacity style={s.emptyBtn} onPress={() => setModalVisible(true)}>
                  <Text style={s.emptyBtnTxt}>Create event</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          }
          renderItem={renderItem}
        />
      )}

      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          clearForm();
          setModalVisible(false);
        }}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <View style={s.modalHeader}>
            <TouchableOpacity
              onPress={() => {
                clearForm();
                setModalVisible(false);
              }}
            >
              <Text style={s.modalCancel}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.modalTitle}>New Mingle</Text>
            <TouchableOpacity onPress={handleCreate} disabled={submitting}>
              {submitting ? (
                <ActivityIndicator color="#007AFF" size={16} />
              ) : (
                <Text style={s.modalPost}>Post</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={s.modalBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={s.modalField}>
              <Text style={s.modalFieldLabel}>Visibility</Text>
              <View style={s.scopePickerRow}>
                <TouchableOpacity
                  style={[s.scopePickerChip, composerScope === 'institution' && s.scopePickerChipActive]}
                  onPress={() => setComposerScope('institution')}
                >
                  <Feather name="award" size={14} color={composerScope === 'institution' ? '#FFF' : '#1D4ED8'} />
                  <Text style={[s.scopePickerTxt, composerScope === 'institution' && s.scopePickerTxtActive]}>
                    My School
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.scopePickerChip, composerScope === 'global' && s.scopePickerChipActive]}
                  onPress={() => setComposerScope('global')}
                >
                  <Feather name="globe" size={14} color={composerScope === 'global' ? '#FFF' : '#374151'} />
                  <Text style={[s.scopePickerTxt, composerScope === 'global' && s.scopePickerTxtActive]}>
                    Global
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={s.modalField}>
              <Text style={s.modalFieldLabel}>Title *</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Friday dinner meetup"
                placeholderTextColor="#C7C7CC"
                style={s.modalInput}
              />
            </View>

            <View style={s.modalField}>
              <Text style={s.modalFieldLabel}>Location *</Text>
              <TextInput
                value={location}
                onChangeText={setLocation}
                placeholder="Tempe, AZ"
                placeholderTextColor="#C7C7CC"
                style={s.modalInput}
              />
            </View>

            <View style={s.modalField}>
              <Text style={s.modalFieldLabel}>Time *</Text>
              <TextInput
                value={time}
                onChangeText={setTime}
                placeholder="Friday 7:00 PM"
                placeholderTextColor="#C7C7CC"
                style={s.modalInput}
              />
            </View>

            <View style={s.modalField}>
              <Text style={s.modalFieldLabel}>Category *</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6, paddingBottom: 4 }}
              >
                {CATEGORIES.map((c) => {
                  const isActive = category === c;
                  const color = CAT_COLOR[c] || '#007AFF';
                  return (
                    <TouchableOpacity
                      key={c}
                      style={[s.chip, isActive && { backgroundColor: color, borderColor: color }]}
                      onPress={() => setCategory(c)}
                    >
                      <Text style={s.chipEmoji}>{CAT_EMOJI[c] || '✨'}</Text>
                      <Text style={[s.chipTxt, isActive && s.chipTxtActive]}>{c}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            <View style={s.modalField}>
              <Text style={s.modalFieldLabel}>Description</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="What's this event about?"
                placeholderTextColor="#C7C7CC"
                style={[s.modalInput, { minHeight: 90, paddingTop: 12 }]}
                multiline
                textAlignVertical="top"
              />
            </View>

            <View style={s.modalField}>
              <Text style={s.modalFieldLabel}>Photo</Text>
              <TouchableOpacity style={s.photoPickerBtn} onPress={pickImage} activeOpacity={0.8}>
                <Feather name="image" size={16} color="#007AFF" />
                <Text style={s.photoPickerTxt}>
                  {pickedImage ? 'Change photo' : 'Add a photo'}
                </Text>
              </TouchableOpacity>
              {pickedImage ? (
                <Image source={{ uri: pickedImage.uri }} style={s.photoPreview} resizeMode="cover" />
              ) : null}
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { fontSize: 28, fontWeight: '700', color: '#000' },
  subtitle: { fontSize: 13, color: '#8E8E93', marginTop: 2 },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#000' },

  scopeRow: {
    flexDirection: 'row', gap: 6,
    marginHorizontal: 16, marginBottom: 10,
  },
  scopeTab: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 9, borderRadius: 10,
    backgroundColor: '#F5F5F5',
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#E5E5EA',
  },
  scopeTabActive: { backgroundColor: '#000', borderColor: '#000' },
  scopeTabTxt: { fontSize: 12, fontWeight: '700', color: '#6B7280' },
  scopeTabTxtActive: { color: '#FFFFFF' },

  catRow: { paddingHorizontal: 16, paddingBottom: 10, gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#F5F5F5',
  },
  chipEmoji: { fontSize: 14 },
  chipTxt: { fontSize: 11, fontWeight: '600', color: '#3C3C43', letterSpacing: -0.1 },
  chipTxtActive: { color: '#FFF', fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingTop: 4 },
  listEmpty: { flexGrow: 1 },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 18,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#F0F0F0',
    overflow: 'hidden',
  },
  cardImage: { width: '100%', height: 200 },
  cardBody: { padding: 14 },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  catPill: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  catPillTxt: { fontSize: 12, fontWeight: '700', color: '#007AFF' },
  schoolPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#EFF6FF', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 4,
    maxWidth: 140,
  },
  schoolPillTxt: { fontSize: 11, fontWeight: '700', color: '#1D4ED8' },
  globalPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#F3F4F6', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  globalPillTxt: { fontSize: 11, fontWeight: '700', color: '#374151' },
  goingTxt: { fontSize: 13, color: '#8E8E93', fontWeight: '500', marginLeft: 'auto' },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#000', marginBottom: 8 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  cardMetaTxt: { fontSize: 13, color: '#8E8E93' },
  cardDesc: { fontSize: 14, color: '#3C3C43', lineHeight: 20, marginTop: 6, marginBottom: 12 },
  cardActions: { flexDirection: 'row', gap: 8 },
  viewBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E5EA',
    alignItems: 'center',
  },
  viewBtnTxt: { fontSize: 14, fontWeight: '600', color: '#3C3C43' },
  joinBtn: {
    flex: 1.2,
    paddingVertical: 11,
    borderRadius: 12,
    backgroundColor: '#000',
    alignItems: 'center',
  },
  joinedBtn: { backgroundColor: '#F2F2F7' },
  joinBtnTxt: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  joinedBtnTxt: { color: '#000' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#000', textAlign: 'center' },
  emptyTxt: { fontSize: 14, color: '#8E8E93', textAlign: 'center', lineHeight: 20 },
  emptyBtn: {
    marginTop: 8,
    backgroundColor: '#000',
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  emptyBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  modalCancel: { fontSize: 17, color: '#8E8E93' },
  modalTitle: { fontSize: 17, fontWeight: '600', color: '#000' },
  modalPost: { fontSize: 17, fontWeight: '600', color: '#007AFF' },
  modalBody: { padding: 20 },
  modalField: { marginBottom: 18 },
  modalFieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 8,
  },
  modalInput: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#000',
  },
  scopePickerRow: { flexDirection: 'row', gap: 8 },
  scopePickerChip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 11, borderRadius: 12,
    backgroundColor: '#F5F5F5',
    borderWidth: 1, borderColor: '#E5E5EA',
  },
  scopePickerChipActive: { backgroundColor: '#000', borderColor: '#000' },
  scopePickerTxt: { fontSize: 14, fontWeight: '600', color: '#374151' },
  scopePickerTxtActive: { color: '#FFFFFF' },
  photoPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  photoPickerTxt: { fontSize: 15, fontWeight: '600', color: '#007AFF' },
  photoPreview: { width: '100%', height: 180, borderRadius: 12, marginTop: 10 },
});
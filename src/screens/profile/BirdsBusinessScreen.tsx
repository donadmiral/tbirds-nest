import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput,
  Modal, ScrollView, ActivityIndicator, Alert, StatusBar, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';

type BusinessItem = {
  id: string;
  owner_id: string;
  owner_name: string;
  business_name: string;
  category: string;
  location: string;
  description: string;
  offering: string;
  contact_info: string;
  website_url?: string | null;
  created_at: string;
};

const BIZ_CAT_EMOJI: Record<string, string> = {
  'All': '🌍', 'Consulting': '💼', 'Technology': '💻', 'Food & Bev': '🍽️',
  'Fashion': '👗', 'Finance': '💰', 'Health': '❤️', 'Education': '📚', 'Other': '✨',
};
const CATEGORIES = ['Consulting', 'Technology', 'Food & Beverage', 'Design & Creative', 'Finance', 'Education', 'Health & Wellness', 'Retail', 'Events', 'Media', 'Non-profit', 'Other'];

export default function BirdsBusinessScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile, session } = useAuthStore();
  const currentUserId = profile?.id ?? session?.user?.id ?? null;

  const [posts, setPosts] = useState<BusinessItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('');

  const [businessName, setBusinessName] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [offering, setOffering] = useState('');
  const [description, setDescription] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');

  const filteredPosts = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = posts;
    if (selectedCategory) list = list.filter(p => p.category === selectedCategory);
    if (!term) return list;
    return list.filter(p =>
      p.business_name.toLowerCase().includes(term) ||
      p.category.toLowerCase().includes(term) ||
      p.location.toLowerCase().includes(term) ||
      p.owner_name.toLowerCase().includes(term) ||
      p.offering.toLowerCase().includes(term)
    );
  }, [posts, search, selectedCategory]);

  const clearForm = () => { setBusinessName(''); setCategory(''); setLocation(''); setOffering(''); setDescription(''); setContactInfo(''); setWebsiteUrl(''); };

  const loadPosts = useCallback(async (showLoader = true) => {
    try {
      if (showLoader) setLoading(true);
      const { data: postsData, error } = await supabase.from('birds_business_posts').select('*').order('created_at', { ascending: false });
      if (error) { console.log('BIRDS_BUSINESS_LOAD', error); setPosts([]); return; }
      const safePosts = (postsData || []);
      if (!safePosts.length) { setPosts([]); return; }
      const ownerIds = Array.from(new Set(safePosts.map((p: any) => p.owner_id)));
      const { data: profileData } = await supabase.from('profiles').select('id, full_name').in('id', ownerIds);
      const nameMap: Record<string, string> = {};
      (profileData || []).forEach((p: any) => { nameMap[p.id] = p.full_name?.trim() || 'User'; });
      setPosts(safePosts.map((p: any) => ({ ...p, owner_name: nameMap[p.owner_id] || 'User', contact_info: p.contact_info?.trim() || 'No contact info' })));
    } catch (e) { console.log('BIRDS_BUSINESS_CATCH', e); setPosts([]); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    loadPosts(true);
    const ch = supabase.channel('birds_business_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'birds_business_posts' }, () => loadPosts(false))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadPosts]);

  const handleCreate = async () => {
    if (!currentUserId) { Alert.alert('Not signed in'); return; }
    if (!businessName.trim() || !category.trim() || !location.trim() || !offering.trim() || !description.trim()) {
      Alert.alert('Missing fields', 'Please fill in all required fields.'); return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('birds_business_posts').insert([{
        owner_id: currentUserId,
        business_name: businessName.trim(),
        category: category.trim(),
        location: location.trim(),
        offering: offering.trim(),
        description: description.trim(),
        contact_info: contactInfo.trim() || null,
        website_url: websiteUrl.trim() || null,
      }]);
      if (error) { Alert.alert('Error', error.message); return; }
      clearForm(); setModalVisible(false);
      Alert.alert('Posted!', 'Your business listing is now live.');
      await loadPosts(false);
    } catch (e) { Alert.alert('Error', 'Could not create listing.'); }
    finally { setSubmitting(false); }
  };

  const renderItem = ({ item }: { item: BusinessItem }) => {
    const isOwn = item.owner_id === currentUserId;
    return (
      <TouchableOpacity
        style={s.card}
        activeOpacity={0.88}
        onPress={() => navigation.navigate('BirdsBusinessDetails', { postId: item.id })}
      >
        <View style={s.cardTop}>
          <View style={s.categoryPill}><Text style={s.categoryTxt}>{item.category}</Text></View>
          <Text style={s.ownerTxt}>{isOwn ? 'You' : item.owner_name}</Text>
        </View>
        <Text style={s.cardTitle}>{item.business_name}</Text>
        <Text style={s.cardMeta}>📍 {item.location}</Text>
        <Text style={s.cardMeta}>💼 {item.offering}</Text>
        <Text style={s.cardDesc} numberOfLines={2}>{item.description}</Text>
        <View style={s.cardActions}>
          <TouchableOpacity style={s.viewBtn} activeOpacity={0.8} onPress={() => navigation.navigate('BirdsBusinessDetails', { postId: item.id })}>
            <Text style={s.viewBtnTxt}>View details</Text>
          </TouchableOpacity>
          {!isOwn && (
            <TouchableOpacity style={s.contactBtn} activeOpacity={0.8} onPress={() => navigation.navigate('Chat', {
          userId: item.owner_id,
          userName: item.owner_name,
          otherUser: {
            id: item.owner_id,
            full_name: item.owner_name,
            username: null,
            avatar_url: null,
          },
        })}>
              <Feather name="message-circle" size={14} color="#007AFF" />
              <Text style={s.contactBtnTxt}>Contact</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>‹</Text>
          <Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <View>
          <Text style={s.title}>Bird's Business</Text>
          <Text style={s.subtitle}>Thunderbird businesses & ventures</Text>
        </View>
        <TouchableOpacity style={s.addBtn} onPress={() => setModalVisible(true)} activeOpacity={0.8}>
          <Feather name="plus" size={20} color="#FFF" />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={s.searchWrap}>
        <Feather name="search" size={16} color="#8E8E93" />
        <TextInput value={search} onChangeText={setSearch} placeholder="Search businesses..." placeholderTextColor="#8E8E93" style={s.searchInput} clearButtonMode="while-editing" />
      </View>

      {/* Category filter chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}>
        <TouchableOpacity style={[s.filterChip, !selectedCategory && s.filterChipActive]} onPress={() => setSelectedCategory('')}>
          <Text style={[s.filterChipTxt, !selectedCategory && s.filterChipTxtActive]}>All</Text>
        </TouchableOpacity>
        {CATEGORIES.map(c => (
          <TouchableOpacity key={c} style={[s.filterChip, selectedCategory === c && s.filterChipActive]} onPress={() => setSelectedCategory(selectedCategory === c ? '' : c)}>
            <Text style={[s.filterChipTxt, selectedCategory === c && s.filterChipTxtActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading ? (
        <View style={s.loader}><ActivityIndicator color="#007AFF" size="large" /><Text style={s.loaderTxt}>Loading businesses...</Text></View>
      ) : (
        <FlatList
          data={filteredPosts}
          keyExtractor={i => i.id}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.list, !filteredPosts.length && s.listEmpty, { paddingBottom: Math.max(insets.bottom + 40, 60) }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadPosts(false); }} tintColor="#007AFF" />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Feather name="briefcase" size={40} color="#E5E5EA" />
              <Text style={s.emptyTitle}>{search || selectedCategory ? 'No results' : 'No businesses yet'}</Text>
              <Text style={s.emptyTxt}>{search || selectedCategory ? 'Try a different search or category.' : 'Be the first to list your business.'}</Text>
              {!search && !selectedCategory && (
                <TouchableOpacity style={s.emptyBtn} onPress={() => setModalVisible(true)}>
                  <Text style={s.emptyBtnTxt}>Add a listing</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      )}

      {/* Create listing modal */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { clearForm(); setModalVisible(false); }}>
        <SafeAreaView style={s.modalSafe}>
          <View style={s.modalHeader}>
            <TouchableOpacity onPress={() => { clearForm(); setModalVisible(false); }} style={s.modalCloseBtn}>
              <Text style={s.modalCloseTxt}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.modalTitle}>New Listing</Text>
            <TouchableOpacity onPress={handleCreate} disabled={submitting} style={s.modalSaveBtn}>
              {submitting ? <ActivityIndicator color="#007AFF" size={16} /> : <Text style={s.modalSaveTxt}>Post</Text>}
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.modalBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {[
              { label: 'Business Name *', value: businessName, set: setBusinessName, placeholder: "Don's Consulting" },
              { label: 'Location *', value: location, set: setLocation, placeholder: 'Phoenix, AZ' },
              { label: 'Offering *', value: offering, set: setOffering, placeholder: 'Business strategy and market research' },
              { label: 'Contact Info', value: contactInfo, set: setContactInfo, placeholder: 'Email, Instagram, phone' },
              { label: 'Website', value: websiteUrl, set: setWebsiteUrl, placeholder: 'https://...', autoCapitalize: 'none' as const },
            ].map(f => (
              <View key={f.label} style={s.modalField}>
                <Text style={s.modalFieldLabel}>{f.label}</Text>
                <TextInput value={f.value} onChangeText={f.set} placeholder={f.placeholder} placeholderTextColor="#C7C7CC" style={s.modalInput} autoCapitalize={f.autoCapitalize} />
              </View>
            ))}

            <View style={s.modalField}>
              <Text style={s.modalFieldLabel}>Category *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 4 }}>
                {CATEGORIES.map(c => (
                  <TouchableOpacity key={c} style={[s.filterChip, category === c && s.filterChipActive]} onPress={() => setCategory(c)}>
                    <Text style={[s.filterChipTxt, category === c && s.filterChipTxtActive]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={s.modalField}>
              <Text style={s.modalFieldLabel}>Description *</Text>
              <TextInput value={description} onChangeText={setDescription} placeholder="What your business does and why people should support it..." placeholderTextColor="#C7C7CC" style={[s.modalInput, s.modalInputMulti]} multiline textAlignVertical="top" />
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  backBtn: { flexDirection: 'row', alignItems: 'center', minWidth: 60 },
  backChev: { fontSize: 30, color: '#007AFF', lineHeight: 34, marginRight: 1 },
  backLbl: { fontSize: 17, color: '#007AFF' },
  title: { fontSize: 18, fontWeight: '700', color: '#000', textAlign: 'center' },
  subtitle: { fontSize: 12, color: '#8E8E93', textAlign: 'center', marginTop: 1 },
  addBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginVertical: 10, backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 12, height: 40 },
  searchInput: { flex: 1, fontSize: 15, color: '#000' },
  filterRow: { paddingHorizontal: 16, paddingBottom: 10, gap: 6 },
  filterChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, borderWidth: 1, borderColor: '#E5E5EA', backgroundColor: '#F5F5F5' },
  filterChipActive: { backgroundColor: '#000', borderColor: '#000' },
  filterChipTxt: { fontSize: 11, fontWeight: '500', color: '#8E8E93', letterSpacing: -0.1 },
  filterChipTxtActive: { color: '#FFF', fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingTop: 4 },
  listEmpty: { flexGrow: 1 },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: '#F0F0F0' },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  categoryPill: { backgroundColor: '#EFF6FF', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  categoryTxt: { fontSize: 12, fontWeight: '700', color: '#007AFF' },
  ownerTxt: { fontSize: 12, color: '#8E8E93', fontWeight: '500' },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#000', marginBottom: 6 },
  cardMeta: { fontSize: 13, color: '#8E8E93', marginBottom: 3 },
  cardDesc: { fontSize: 14, color: '#3C3C43', lineHeight: 20, marginTop: 8, marginBottom: 12 },
  cardActions: { flexDirection: 'row', gap: 8 },
  viewBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: '#E5E5EA' },
  viewBtnTxt: { fontSize: 13, fontWeight: '600', color: '#3C3C43' },
  contactBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: '#EFF6FF' },
  contactBtnTxt: { fontSize: 13, fontWeight: '600', color: '#007AFF' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loaderTxt: { fontSize: 14, color: '#8E8E93' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 32, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#000', textAlign: 'center' },
  emptyTxt: { fontSize: 14, color: '#8E8E93', textAlign: 'center', lineHeight: 20 },
  emptyBtn: { marginTop: 8, backgroundColor: '#000', borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  emptyBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  modalSafe: { flex: 1, backgroundColor: '#FFF' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  modalCloseBtn: { minWidth: 60 },
  modalCloseTxt: { fontSize: 17, color: '#8E8E93' },
  modalTitle: { fontSize: 17, fontWeight: '600', color: '#000' },
  modalSaveBtn: { minWidth: 60, alignItems: 'flex-end' },
  modalSaveTxt: { fontSize: 17, fontWeight: '600', color: '#007AFF' },
  modalBody: { padding: 20 },
  modalField: { marginBottom: 18 },
  modalFieldLabel: { fontSize: 13, fontWeight: '600', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  modalInput: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#000' },
  modalInputMulti: { minHeight: 110, paddingTop: 12 },
});
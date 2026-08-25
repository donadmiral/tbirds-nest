import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ActivityIndicator, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { supabase } from '../../services/supabase';

const NAVY = '#0B1E3D';

function initials(name?: string | null) {
  return (name || 'C').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

export default function ChannelsScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [cName, setCName] = useState('');
  const [cDesc, setCDesc] = useState('');
  const [cAud, setCAud] = useState<'everyone' | 'followers'>('everyone');
  const [creating, setCreating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q: string) => {
    try {
      const { data, error } = await supabase.rpc('get_channels', { p_query: q || null, p_limit: 40 });
      if (!error) setRows(data || []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => load(query.trim()), 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, load]);

  const openChannel = (item: any) => {
    navigation.navigate('Channel', {
      channelId: item.id, name: item.name, memberCount: item.member_count,
      myRole: item.my_role || null, isMember: !!item.is_member,
    });
  };

  const joinAndOpen = async (item: any) => {
    try {
      const { error } = await supabase.rpc('join_channel', { p_channel: item.id });
      if (error) throw error;
      setRows(prev => prev.map(r => r.id === item.id ? { ...r, is_member: true, my_role: r.my_role || 'member', member_count: (r.member_count || 0) + 1 } : r));
      openChannel({ ...item, is_member: true, my_role: item.my_role || 'member', member_count: (item.member_count || 0) + 1 });
    } catch (e: any) { Alert.alert('Could not join', e?.message || 'Please try again.'); }
  };

  const createChannel = async () => {
    const nm = cName.trim();
    if (!nm || creating) return;
    setCreating(true);
    try {
      const { data, error } = await supabase.rpc('create_channel', { p_name: nm, p_description: cDesc.trim() || null, p_audience: cAud });
      if (error) throw error;
      setCreateOpen(false); setCName(''); setCDesc(''); setCAud('everyone');
      load(query.trim());
      navigation.navigate('Channel', { channelId: (data as any).id, name: (data as any).name, memberCount: 1, myRole: 'owner', isMember: true });
    } catch (e: any) { Alert.alert('Could not create channel', e?.message || 'Please try again.'); }
    finally { setCreating(false); }
  };

  const renderRow = ({ item }: { item: any }) => (
    <TouchableOpacity style={s.row} activeOpacity={0.85} onPress={() => openChannel(item)}>
      {item.icon_url ? (
        <ExpoImage source={{ uri: item.icon_url }} style={s.icon} contentFit="cover" />
      ) : (
        <View style={[s.icon, s.iconFb]}><Text style={s.iconTxt}>{initials(item.name)}</Text></View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={s.name} numberOfLines={1}>{item.name}</Text>
        <Text style={s.meta} numberOfLines={1}>{item.member_count === 1 ? '1 member' : String(item.member_count || 0) + ' members'}{item.owner_username ? ' · @' + item.owner_username : ''}</Text>
        {item.description ? <Text style={s.desc} numberOfLines={1}>{item.description}</Text> : null}
      </View>
      {item.is_member ? (
        <View style={s.joinedPill}><Text style={s.joinedTxt}>Joined</Text></View>
      ) : (
        <TouchableOpacity style={s.joinPill} activeOpacity={0.85} onPress={() => joinAndOpen(item)}>
          <Text style={s.joinTxt}>Join</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color={NAVY} />
        </TouchableOpacity>
        <Text style={s.title}>Channels</Text>
        <TouchableOpacity onPress={() => setCreateOpen(true)} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="plus" size={22} color={NAVY} />
        </TouchableOpacity>
      </View>
      <View style={s.searchWrap}>
        <Feather name="search" size={15} color="#8E8E93" />
        <TextInput style={s.searchInput} placeholder="Search channels" placeholderTextColor="#8E8E93" value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} />
        {query.length > 0 ? <TouchableOpacity onPress={() => setQuery('')}><Feather name="x-circle" size={16} color="#C7C7CC" /></TouchableOpacity> : null}
      </View>
      {loading ? (
        <View style={s.center}><ActivityIndicator color={NAVY} /></View>
      ) : rows.length === 0 ? (
        <View style={s.center}>
          <Feather name="radio" size={38} color="#E5E5EA" />
          <Text style={s.emptyTitle}>{query ? 'No channels found' : 'No channels yet'}</Text>
          <Text style={s.emptySub}>Create one and broadcast to your members.</Text>
        </View>
      ) : (
        <FlatList data={rows} keyExtractor={r => r.id} renderItem={renderRow}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled" />
      )}

      <Modal visible={createOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCreateOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={s.modalHeader}>
              <TouchableOpacity onPress={() => setCreateOpen(false)} style={{ width: 60 }}><Text style={s.modalCancel}>Cancel</Text></TouchableOpacity>
              <Text style={s.modalTitle}>New channel</Text>
              <TouchableOpacity onPress={createChannel} disabled={!cName.trim() || creating} style={{ width: 60, alignItems: 'flex-end' }}>
                {creating ? <ActivityIndicator size="small" color={NAVY} /> : <Text style={[s.modalCreate, !cName.trim() && { opacity: 0.35 }]}>Create</Text>}
              </TouchableOpacity>
            </View>
            <View style={{ padding: 20, gap: 18 }}>
              <View>
                <Text style={s.fieldLabel}>Name</Text>
                <TextInput style={s.input} placeholder="Channel name" placeholderTextColor="#C7C7CC" value={cName} onChangeText={setCName} maxLength={60} />
              </View>
              <View>
                <Text style={s.fieldLabel}>Description</Text>
                <TextInput style={[s.input, { minHeight: 76, paddingTop: 12, textAlignVertical: 'top' }]} placeholder="What is this channel about?" placeholderTextColor="#C7C7CC" value={cDesc} onChangeText={setCDesc} multiline maxLength={200} />
              </View>
              <View>
                <Text style={s.fieldLabel}>Who can join</Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {(['everyone', 'followers'] as const).map(a => (
                    <TouchableOpacity key={a} style={[s.audChip, cAud === a && s.audChipOn]} onPress={() => setCAud(a)} activeOpacity={0.85}>
                      <Text style={[s.audTxt, cAud === a && s.audTxtOn]}>{a === 'everyone' ? 'Everyone' : 'My followers'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <Text style={s.hint}>You post the updates. Members react, and reply in threads under each message.</Text>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 16.5, fontWeight: '700', color: '#0F1419' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F2F2F7', borderRadius: 12, marginHorizontal: 16, marginTop: 4, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 9 },
  searchInput: { flex: 1, fontSize: 15, color: '#0F1419', padding: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 60, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 15.5, fontWeight: '700', color: '#0F1419' },
  emptySub: { fontSize: 13, color: '#8E8E93', textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  icon: { width: 50, height: 50, borderRadius: 14 },
  iconFb: { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  iconTxt: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  name: { fontSize: 15.5, fontWeight: '700', color: '#0F1419' },
  meta: { fontSize: 12.5, color: '#8E8E93', marginTop: 1 },
  desc: { fontSize: 13, color: '#5B6B84', marginTop: 2 },
  joinPill: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999, backgroundColor: NAVY },
  joinTxt: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  joinedPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: '#FFF', borderWidth: 1, borderColor: '#D1D5DB' },
  joinedTxt: { fontSize: 13, fontWeight: '700', color: '#0F1419' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA' },
  modalCancel: { fontSize: 16, color: '#8E8E93' },
  modalTitle: { fontSize: 16.5, fontWeight: '700', color: '#0F1419' },
  modalCreate: { fontSize: 16, fontWeight: '700', color: NAVY },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  input: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5, color: '#0F1419' },
  audChip: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: '#F5F5F5', borderWidth: 1.5, borderColor: '#E5E5EA' },
  audChipOn: { backgroundColor: NAVY, borderColor: NAVY },
  audTxt: { fontSize: 14, fontWeight: '600', color: '#5B6B84' },
  audTxtOn: { color: '#FFF' },
  hint: { fontSize: 12.5, color: '#8E8E93', lineHeight: 18 },
});

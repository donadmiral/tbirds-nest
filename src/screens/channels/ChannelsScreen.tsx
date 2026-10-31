import { themedSheet, getTheme, useTheme } from '../../theme/useTheme';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ActivityIndicator, Modal, Alert, KeyboardAvoidingView, Platform, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { supabase } from '../../services/supabase';
import { CATEGORIES } from '../../constants/categories';
import { useAuthStore } from '../../stores/authStore';
import { StudioLoadError } from '../../components/StudioLoadError';
import { navigationCache, navigationScope, subscribeNavigationScope } from '../../lib/navigationCache';
import { channelDirectoryKey, emptyChannelDirectory, mutateDirectory, readChannelDirectory } from '../../services/navigationDirectory';
import type { ChannelDirectoryTab, ChannelDirectoryView } from '../../services/navigationDirectory';

const NAVY = '#0B1E3D';
export const COMM_COLORS: Record<string, string> = {
  sky: '#A9CBE0', blush: '#F2B8C6', pearl: '#C9BFB0', cream: '#E8D9B8',
  sage: '#AFC8AB', lilac: '#C4B6E6', rose: '#D4537E', ink: '#2A2D33',
};

function initials(name?: string | null) {
  return (name || 'C').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

export default function ChannelsScreen() {
  useTheme();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const uid = useAuthStore(state => state.session?.user.id || '');
  const scope = useSyncExternalStore(subscribeNavigationScope, navigationScope, navigationScope);
  const controlsScope = useRef(scope), controlsOwner = controlsScope.current;
  const [initialControls] = useState(() => navigationCache.read<{ tab: ChannelDirectoryTab; query: string }>(scope, 'channels:controls'));
  const [tab, setTab] = useState<ChannelDirectoryTab>(initialControls?.tab ?? 'channels');
  const [query, setQuery] = useState(initialControls?.query ?? '');
  const [search, setSearch] = useState(query.trim());
  const cacheKey = channelDirectoryKey(tab, search);
  const context = useMemo(() => ({ scope, cacheKey, uid }), [scope, cacheKey, uid]);
  const contextRef = useRef(context); contextRef.current = context;
  const [view, setView] = useState(() => navigationCache.read<ChannelDirectoryView>(scope, cacheKey) ?? emptyChannelDirectory());
  const viewRef = useRef(view);
  const [loading, setLoading] = useState(!view.ready);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [cName, setCName] = useState('');
  const [cDesc, setCDesc] = useState('');
  const [cAud, setCAud] = useState<'everyone' | 'followers'>('everyone');
  const [creating, setCreating] = useState(false);
  const [commOpen, setCommOpen] = useState(false);
  const [gName, setGName] = useState('');
  const [gDesc, setGDesc] = useState('');
  const [gRules, setGRules] = useState('');
  const [gMode, setGMode] = useState<'open' | 'approval' | 'invite'>('open');
  const [gColor, setGColor] = useState('sky');
  const [gCat, setGCat] = useState<string | null>(null);
  const [gBusy, setGBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const mounted = useRef(true), activeRead = useRef<AbortController | null>(null);
  const locks = useRef(new Set<string>());
  const owner = useRef(uid); owner.current = uid;
  const currentAccount = () => mounted.current && contextRef.current === context && navigationScope() === scope && owner.current === uid && !!uid && useAuthStore.getState().session?.user.id === uid;
  useEffect(() => {
    const work = activeRead;
    mounted.current = true;
    return () => { mounted.current = false; work.current?.abort(); };
  }, []);
  useEffect(() => { setCreateOpen(false); setCommOpen(false); setCName(''); setCDesc(''); setGName(''); setGDesc(''); setGRules(''); setCreating(false); setGBusy(false); }, [uid, scope]);
  const commit = useCallback((next: ChannelDirectoryView) => {
    if (!mounted.current || contextRef.current !== context || navigationScope() !== scope) return;
    viewRef.current = next; setView(next);
    if (next.ready) navigationCache.save(scope, cacheKey, next);
  }, [scope, cacheKey, context]);
  const updateRows = (update: (rows: any[]) => any[]) => commit({ ...viewRef.current, rows: update(viewRef.current.rows) });
  useEffect(() => {
    if (search === query.trim()) return;
    const timer = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query, search]);
  useEffect(() => { if (controlsOwner === scope) navigationCache.save(scope, 'channels:controls', { tab, query }); }, [scope, controlsOwner, tab, query]);
  useLayoutEffect(() => {
    if (controlsScope.current !== scope) { controlsScope.current = scope; setTab('channels'); setQuery(''); setSearch(''); }
    activeRead.current?.abort(); activeRead.current = null;
    const cached = navigationCache.read<ChannelDirectoryView>(scope, cacheKey) ?? emptyChannelDirectory();
    viewRef.current = cached; setView(cached); setLoading(!cached.ready); setLoadError(null); setRefreshing(false);
  }, [scope, cacheKey]);

  const load = useCallback(async (q: string, which: ChannelDirectoryTab) => {
    if (!scope || controlsOwner !== scope || !mounted.current || contextRef.current !== context || channelDirectoryKey(which, q) !== cacheKey || navigationScope() !== scope) return;
    activeRead.current?.abort();
    const controller = new AbortController(); activeRead.current = controller;
    const current = () => mounted.current && contextRef.current === context && activeRead.current === controller && !controller.signal.aborted && navigationScope() === scope;
    setLoading(!viewRef.current.ready); setLoadError(null);
    try {
      const rows = await readChannelDirectory(scope, which, q, controller.signal);
      if (current()) commit({ rows, top: viewRef.current.top, ready: true });
    } catch { if (current()) setLoadError('The directory could not be loaded. Please try again.'); }
    finally { if (current()) { activeRead.current = null; setLoading(false); setRefreshing(false); } }
  }, [scope, controlsOwner, context, cacheKey, commit]);

  useFocusEffect(useCallback(() => {
    const work = activeRead;
    void load(search, tab);
    return () => { work.current?.abort(); work.current = null; };
  }, [load, search, tab]));

  const openChannel = (item: any) => {
    navigation.navigate('Channel', {
      channelId: item.id, name: item.name, memberCount: item.member_count,
      myRole: item.my_role || null, isMember: !!item.is_member,
    });
  };

  const joinAndOpen = async (item: any) => {
    const key = uid + ':join:' + item.id;
    if (!currentAccount() || locks.current.has(key)) return;
    locks.current.add(key);
    try {
      await mutateDirectory(scope, pin => pin(supabase.rpc('join_channel', { p_channel: item.id })));
      if (!currentAccount()) return;
      updateRows(prev => prev.map(r => r.id === item.id ? { ...r, is_member: true, my_role: r.my_role || 'member', member_count: (r.member_count || 0) + 1 } : r));
      openChannel({ ...item, is_member: true, my_role: item.my_role || 'member', member_count: (item.member_count || 0) + 1 });
    } catch (e: any) { if (currentAccount()) Alert.alert('Could not join', e?.message || 'Please try again.'); }
    finally { locks.current.delete(key); }
  };

  const createChannel = async () => {
    const nm = cName.trim();
    const key = uid + ':create-channel';
    if (!nm || !currentAccount() || locks.current.has(key)) return;
    locks.current.add(key); setCreating(true);
    try {
      const data = await mutateDirectory<any>(scope, pin => pin(supabase.rpc('create_channel', { p_name: nm, p_description: cDesc.trim() || null, p_audience: cAud })));
      if (!currentAccount()) return;
      const channel = typeof data === 'string' ? { id: data, name: nm } : data;
      if (!channel?.id) throw new Error('Creation was not confirmed. Refresh the directory before retrying.');
      setCreateOpen(false); setCName(''); setCDesc(''); setCAud('everyone');
      void load(query.trim(), 'channels');
      navigation.navigate('Channel', { channelId: channel.id, name: channel.name || nm, memberCount: 1, myRole: 'owner', isMember: true });
    } catch (e: any) { if (currentAccount()) Alert.alert('Could not create channel', e?.message || 'Refresh the directory before retrying.'); }
    finally { locks.current.delete(key); if (currentAccount()) setCreating(false); }
  };

  const openCommunity = (item: any) => {
    navigation.navigate('Community', {
      communityId: item.id, name: item.name, coverColor: item.cover_color,
      iconUrl: item.icon_url || null, memberCount: item.member_count,
      myRole: item.my_role || null, isMember: !!item.is_member,
    });
  };

  const joinCommunity = async (item: any) => {
    const key = uid + ':join-community:' + item.id;
    if (!currentAccount() || locks.current.has(key)) return;
    locks.current.add(key);
    try {
      const data = await mutateDirectory(scope, pin => pin(supabase.rpc('join_community', { p_community: item.id })));
      if (!currentAccount()) return;
      if (data === 'joined') {
        updateRows(prev => prev.map(r => r.id === item.id ? { ...r, is_member: true, my_role: r.my_role || 'member', member_count: (r.member_count || 0) + 1 } : r));
        openCommunity({ ...item, is_member: true, my_role: item.my_role || 'member' });
      } else if (data === 'requested') updateRows(prev => prev.map(r => r.id === item.id ? { ...r, has_pending: true } : r));
      else throw new Error('The join request was not confirmed. Refresh the directory before retrying.');
    } catch (e: any) { if (currentAccount()) Alert.alert('Could not join', e?.message || 'Please try again.'); }
    finally { locks.current.delete(key); }
  };

  const createCommunity = async () => {
    const nm = gName.trim();
    const key = uid + ':create-community';
    if (!nm || !currentAccount() || locks.current.has(key)) return;
    locks.current.add(key); setGBusy(true);
    try {
      const data = await mutateDirectory(scope, pin => pin(supabase.rpc('create_community', {
        p_name: nm, p_description: gDesc.trim() || null, p_category: gCat,
        p_join_mode: gMode, p_cover_color: gColor, p_rules: gRules.trim() || null,
      })));
      if (!currentAccount()) return;
      if (!data || typeof data !== 'string') throw new Error('Creation was not confirmed. Refresh the directory before retrying.');
      setCommOpen(false); setGName(''); setGDesc(''); setGRules(''); setGMode('open'); setGColor('sky'); setGCat(null);
      void load(query.trim(), 'communities');
      navigation.navigate('Community', { communityId: data as string, name: nm, coverColor: gColor, iconUrl: null, memberCount: 1, myRole: 'owner', isMember: true });
    } catch (e: any) { if (currentAccount()) Alert.alert('Could not create community', e?.message || 'Refresh the directory before retrying.'); }
    finally { locks.current.delete(key); if (currentAccount()) setGBusy(false); }
  };

  const renderRow = ({ item }: { item: any }) => (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open channel: ${item.name}`} style={s.row} activeOpacity={0.85} onPress={() => openChannel(item)}>
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
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Join channel: ${item.name}`} style={s.joinPill} activeOpacity={0.85} onPress={() => joinAndOpen(item)}>
          <Text style={s.joinTxt}>Join</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  const renderCommRow = ({ item }: { item: any }) => (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open community: ${item.name}`} style={s.row} activeOpacity={0.85} onPress={() => openCommunity(item)}>
      {item.icon_url ? (
        <ExpoImage source={{ uri: item.icon_url }} style={s.icon} contentFit="cover" />
      ) : (
        <View style={[s.icon, { backgroundColor: COMM_COLORS[item.cover_color] || COMM_COLORS.sky, alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={[s.iconTxt, { color: '#1F2937' }]}>{initials(item.name)}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={s.name} numberOfLines={1}>{item.name}</Text>
        <Text style={s.meta} numberOfLines={1}>
          {item.member_count === 1 ? '1 member' : String(item.member_count || 0) + ' members'}
          {item.category ? ' · ' + (CATEGORIES.find(c => c.key === item.category)?.label || item.category) : ''}
        </Text>
        {item.description ? <Text style={s.desc} numberOfLines={1}>{item.description}</Text> : null}
      </View>
      {item.is_member ? (
        <View style={s.joinedPill}><Text style={s.joinedTxt}>Joined</Text></View>
      ) : item.has_invite ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Accept invitation to ${item.name}`} style={s.joinPill} activeOpacity={0.85} onPress={() => joinCommunity(item)}>
          <Text style={s.joinTxt}>Accept invite</Text>
        </TouchableOpacity>
      ) : item.has_pending ? (
        <View style={s.joinedPill}><Text style={s.joinedTxt}>Requested</Text></View>
      ) : item.join_mode === 'invite' ? (
        <View style={s.invitePill}><Text style={s.inviteTxt}>Invite only</Text></View>
      ) : (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${item.join_mode === 'approval' ? 'Request to join' : 'Join'} community: ${item.name}`} style={s.joinPill} activeOpacity={0.85} onPress={() => joinCommunity(item)}>
          <Text style={s.joinTxt}>{item.join_mode === 'approval' ? 'Request' : 'Join'}</Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={s.safe} edges={['left', 'right']}>
      <View style={[s.header, { paddingTop: insets.top + 4 }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color={NAVY} />
        </TouchableOpacity>
        <Text style={s.title}>{tab === 'channels' ? 'Channels' : 'Communities'}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={tab === 'channels' ? 'Create channel' : 'Create community'} onPress={() => tab === 'channels' ? setCreateOpen(true) : setCommOpen(true)} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="plus" size={22} color={NAVY} />
        </TouchableOpacity>
      </View>
      <View style={s.tabsRow}>
        {(['channels', 'communities'] as const).map(t => (
          <TouchableOpacity accessibilityRole="tab" accessibilityState={{ selected: tab === t }} key={t} style={[s.tabChip, tab === t && s.tabChipOn]} onPress={() => setTab(t)} activeOpacity={0.85}>
            <Feather name={t === 'channels' ? 'radio' : 'users'} size={14} color={tab === t ? '#FFF' : '#5B6B84'} />
            <Text style={[s.tabTxt, tab === t && s.tabTxtOn]}>{t === 'channels' ? 'Channels' : 'Communities'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={s.searchWrap}>
        <Feather name="search" size={15} color="#8E8E93" />
        <TextInput accessibilityLabel={tab === 'channels' ? 'Search channels' : 'Search communities'} maxLength={100} style={s.searchInput} placeholder={tab === 'channels' ? 'Search channels' : 'Search communities'} placeholderTextColor={getTheme().ink.secondary} value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} />
        {query.length > 0 ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear directory search" onPress={() => setQuery('')}><Feather name="x-circle" size={16} color="#C7C7CC" /></TouchableOpacity> : null}
      </View>
      {loadError && view.ready ? <TouchableOpacity accessibilityRole="button" onPress={() => void load(search, tab)} style={{ padding: 12 }}><Text style={s.emptySub}>{loadError} Tap to retry.</Text></TouchableOpacity> : null}
      {loadError && !view.ready ? <StudioLoadError message={loadError} onRetry={() => void load(search, tab)} busy={loading} /> : loading && !view.ready ? (
        <View style={s.center}><ActivityIndicator color={NAVY} /></View>
      ) : (
        <FlatList key={cacheKey} data={view.rows} keyExtractor={r => r.id} renderItem={tab === 'channels' ? renderRow : renderCommRow}
          contentOffset={{ x: 0, y: view.top }}
          onScroll={event => {
            const top = event.nativeEvent.contentOffset.y;
            if (!currentAccount() || !viewRef.current.ready || !Number.isFinite(top) || top < 0) return;
            viewRef.current = { ...viewRef.current, top }; navigationCache.save(scope, cacheKey, viewRef.current);
          }} scrollEventThrottle={16}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(search, tab); }} tintColor={NAVY} />}
          ListEmptyComponent={<View style={s.center}>
            <Feather name={tab === 'channels' ? 'radio' : 'users'} size={38} color="#E5E5EA" />
            <Text style={s.emptyTitle}>{search ? `No ${tab} found` : `No ${tab} yet`}</Text>
            <Text style={s.emptySub}>{tab === 'channels' ? 'Create one and broadcast to your members.' : 'Create one. Every member can post inside it.'}</Text>
          </View>}
          contentContainerStyle={{ flexGrow: view.rows.length ? undefined : 1, paddingHorizontal: 16, paddingBottom: insets.bottom + 30 }} keyboardShouldPersistTaps="handled" />
      )}

      <Modal visible={createOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!creating) setCreateOpen(false); }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={s.modalHeader}>
              <TouchableOpacity disabled={creating} onPress={() => setCreateOpen(false)} style={{ width: 60 }}><Text style={s.modalCancel}>Cancel</Text></TouchableOpacity>
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

      <Modal visible={commOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { if (!gBusy) setCommOpen(false); }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={s.modalHeader}>
              <TouchableOpacity disabled={gBusy} onPress={() => setCommOpen(false)} style={{ width: 60 }}><Text style={s.modalCancel}>Cancel</Text></TouchableOpacity>
              <Text style={s.modalTitle}>New community</Text>
              <TouchableOpacity onPress={createCommunity} disabled={!gName.trim() || gBusy} style={{ width: 60, alignItems: 'flex-end' }}>
                {gBusy ? <ActivityIndicator size="small" color={NAVY} /> : <Text style={[s.modalCreate, !gName.trim() && { opacity: 0.35 }]}>Create</Text>}
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
              <View>
                <Text style={s.fieldLabel}>Name</Text>
                <TextInput style={s.input} placeholder="Community name" placeholderTextColor="#C7C7CC" value={gName} onChangeText={setGName} maxLength={60} />
              </View>
              <View>
                <Text style={s.fieldLabel}>Description</Text>
                <TextInput style={[s.input, { minHeight: 70, paddingTop: 12, textAlignVertical: 'top' }]} placeholder="What is this community about?" placeholderTextColor="#C7C7CC" value={gDesc} onChangeText={setGDesc} multiline maxLength={200} />
              </View>
              <View>
                <Text style={s.fieldLabel}>Who can join</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {(['open', 'approval', 'invite'] as const).map(m => (
                    <TouchableOpacity key={m} style={[s.audChip, gMode === m && s.audChipOn]} onPress={() => setGMode(m)} activeOpacity={0.85}>
                      <Text style={[s.audTxt, { fontSize: 12.5 }, gMode === m && s.audTxtOn]}>{m === 'open' ? 'Open' : m === 'approval' ? 'Approval' : 'Invite only'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View>
                <Text style={s.fieldLabel}>Category</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {CATEGORIES.map(c => (
                    <TouchableOpacity key={c.key} style={[s.catChip, gCat === c.key && s.catChipOn]} onPress={() => setGCat(gCat === c.key ? null : c.key)} activeOpacity={0.85}>
                      <Text style={[s.catTxt, gCat === c.key && s.catTxtOn]}>{c.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View>
                <Text style={s.fieldLabel}>Cover color</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                  {Object.entries(COMM_COLORS).map(([k, v]) => (
                    <TouchableOpacity accessibilityRole="radio" accessibilityLabel={`${k} cover`} accessibilityState={{ checked: gColor === k }} key={k} onPress={() => setGColor(k)} style={[s.colorDot, { backgroundColor: v }, gColor === k && s.colorDotOn]} activeOpacity={0.85} />
                  ))}
                </View>
              </View>
              <View>
                <Text style={s.fieldLabel}>Rules</Text>
                <TextInput style={[s.input, { minHeight: 84, paddingTop: 12, textAlignVertical: 'top' }]} placeholder="Shown to people when they join. (optional)" placeholderTextColor="#C7C7CC" value={gRules} onChangeText={setGRules} multiline maxLength={600} />
              </View>
              <Text style={s.hint}>Every member can post inside a community. You and your moderators keep it clean.</Text>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 16.5, fontWeight: '700', color: t.ink.primary },
  tabsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  tabChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#F2F2F7' },
  tabChipOn: { backgroundColor: NAVY },
  tabTxt: { fontSize: 13.5, fontWeight: '700', color: '#5B6B84' },
  tabTxtOn: { color: '#FFFFFF' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.surface.sunken, borderRadius: 12, marginHorizontal: 16, marginTop: 0, marginBottom: 8, paddingHorizontal: 12, minHeight: 48 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 48, fontSize: 16, color: t.ink.primary, paddingHorizontal: 0, paddingVertical: 10, includeFontPadding: false, textAlignVertical: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 60, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 15.5, fontWeight: '700', color: t.ink.primary },
  emptySub: { fontSize: 13, color: t.ink.muted, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 },
  icon: { width: 50, height: 50, borderRadius: 14 },
  iconFb: { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  iconTxt: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  name: { fontSize: 15.5, fontWeight: '700', color: t.ink.primary },
  meta: { fontSize: 12.5, color: t.ink.muted, marginTop: 1 },
  desc: { fontSize: 13, color: t.ink.secondary, marginTop: 2 },
  joinPill: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 999, backgroundColor: NAVY },
  joinTxt: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  joinedPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: t.surface.canvas, borderWidth: 1, borderColor: '#D1D5DB' },
  joinedTxt: { fontSize: 13, fontWeight: '700', color: t.ink.primary },
  invitePill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#F2F2F7' },
  inviteTxt: { fontSize: 12, fontWeight: '700', color: '#5B6470' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA' },
  modalCancel: { fontSize: 16, color: '#8E8E93' },
  modalTitle: { fontSize: 16.5, fontWeight: '700', color: '#0F1419' },
  modalCreate: { fontSize: 16, fontWeight: '700', color: NAVY },
  fieldLabel: { fontSize: 12, fontWeight: '700', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  input: { backgroundColor: '#F5F5F5', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15.5, color: '#0F1419' },
  audChip: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: '#F5F5F5', borderWidth: 1.5, borderColor: '#E5E5EA' },
  audChipOn: { backgroundColor: NAVY, borderColor: NAVY },
  audTxt: { fontSize: 14, fontWeight: '600', color: '#5B6B84' },
  audTxtOn: { color: '#FFFFFF' },
  catChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: '#E5E5EA' },
  catChipOn: { backgroundColor: NAVY, borderColor: NAVY },
  catTxt: { fontSize: 12.5, fontWeight: '600', color: '#5B6B84' },
  catTxtOn: { color: '#FFFFFF' },
  colorDot: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: 'transparent' },
  colorDotOn: { borderColor: '#0F1419' },
  hint: { fontSize: 12.5, color: '#8E8E93', lineHeight: 18 },
}));

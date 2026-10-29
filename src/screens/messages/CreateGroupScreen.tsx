import { themedSheet, getTheme, useTheme } from '../../theme/useTheme';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, Image,
  FlatList, ActivityIndicator, StatusBar, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { messagesBack, openChatFromComposer } from '../../navigation/messagesNavigation';
import { searchMessagePeople } from '../../../shared/peopleSearch';

type Candidate = {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
};

const AVATAR_COLORS = ['#1D4ED8','#065F46','#7C2D12','#1a3560','#5856D6','#C2410C','#0F766E','#7C3AED'];
function avatarColor(id: string) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}
function initials(n?: string | null) {
  if (!n) return '?';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}

export default function CreateGroupScreen({ navigation }: any) {
  const { t, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const myId = profile?.id ?? null;
  const owner = useRef(myId); owner.current = myId;
  const alive = useRef(true);
  const creatingRef = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate[]>([]);
  const [groupName, setGroupName] = useState('');
  const [creating, setCreating] = useState(false);
  const [initialList, setInitialList] = useState<Candidate[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);

  useEffect(() => { setSelected([]); setGroupName(''); setQuery(''); }, [myId]);

  useEffect(() => {
    if (!myId) { setInitialList([]); setLoadingInitial(false); return; }
    let cancelled = false;
    (async () => {
      setLoadingInitial(true); setLoadError(null);
      try {
        const { data: rows, error: fErr } = await supabase
          .from('follows')
          .select('following_id')
          .eq('follower_id', myId)
          .limit(50);

        if (fErr) throw fErr;

        const otherIds = Array.from(new Set(
          (rows || [])
            .map((r: any) => r.following_id)
            .filter(Boolean)
        ));

        if (otherIds.length === 0) {
          if (!cancelled) setInitialList([]);
          return;
        }

        const { data: profs, error: profileError } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url')
          .in('id', otherIds)
          .limit(50);

        if (profileError) throw profileError;
        if (!cancelled) setInitialList((profs || []) as Candidate[]);
      } catch (e) {
        if (!cancelled) setLoadError('Your connections could not be loaded. Search for a person or retry.');
      } finally {
        if (!cancelled) setLoadingInitial(false);
      }
    })();
    return () => { cancelled = true; };
  }, [myId, attempt]);

  useEffect(() => {
    let current = true;
    setResults([]); setSearchError(null); setSearching(!!query.trim() && !!myId);
    if (!query.trim() || !myId) return;
    const timer = setTimeout(() => {
      void searchMessagePeople(supabase, myId, query).then(people => {
        if (current) setResults(people);
      }, () => { if (current) setSearchError('People could not be loaded. Edit your search to retry.'); })
        .finally(() => { if (current) setSearching(false); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [query, myId]);

  const isSelected = useCallback(
    (id: string) => selected.some(s => s.id === id),
    [selected]
  );

  const toggleSelect = (c: Candidate) => {
    setSelected(prev => {
      if (prev.some(s => s.id === c.id)) return prev.filter(s => s.id !== c.id);
      return [...prev, c];
    });
  };

  const removeSelected = (id: string) => {
    setSelected(prev => prev.filter(s => s.id !== id));
  };

  const createGroup = async () => {
    if (!myId || creatingRef.current) return;
    if (selected.length < 1) {
      Alert.alert('Add at least 1 member', 'A group needs at least one other person.');
      return;
    }
    if (!groupName.trim()) {
      Alert.alert('Name your group', 'Please enter a group name.');
      return;
    }

    creatingRef.current = true;
    setCreating(true);
    const current = () => alive.current && owner.current === myId;
    try {
      const memberIds = selected.map(s => s.id);

      const { data: newConvId, error } = await supabase.rpc('create_group_conversation', {
        p_group_name: groupName.trim(),
        p_member_ids: memberIds,
      });

      if (error || !newConvId) {
        throw error || new Error('Could not create group');
      }

      if (!current()) return;
      const name = groupName.trim();
      openChatFromComposer(navigation, { conversationId: newConvId, isGroup: true, groupName: name, groupEmoji: '💬', userName: name });
    } catch (e: any) {
      if (current()) Alert.alert('Could not create group', e?.message || 'Please try again.');
    } finally {
      creatingRef.current = false;
      if (current()) setCreating(false);
    }
  };

  const canCreate = selected.length >= 1 && groupName.trim().length > 0 && !creating;
  const displayList: Candidate[] = query.trim().length > 0 ? results : initialList;

  const renderCandidate = ({ item }: { item: Candidate }) => {
    const picked = isSelected(item.id);
    return (
      <TouchableOpacity
        style={s.candidateRow}
        onPress={() => toggleSelect(item)}
        activeOpacity={0.7}
      >
        {item.avatar_url ? (
          <Image source={{ uri: item.avatar_url }} style={s.candidateAvatar} />
        ) : (
          <View style={[s.candidateAvatar, { backgroundColor: avatarColor(item.id), alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={s.candidateAvatarTxt}>{initials(item.full_name)}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={s.candidateName} numberOfLines={1}>
            {item.full_name || 'User'}
          </Text>
          {item.username ? (
            <Text style={s.candidateHandle} numberOfLines={1}>@{item.username}</Text>
          ) : null}
        </View>
        <View style={[s.checkbox, picked && s.checkboxOn]}>
          {picked && <Feather name="check" size={14} color={t.ink.inverse} />}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={s.header}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel new group" onPress={() => messagesBack(navigation)} style={s.backBtn}>
            <Feather name="chevron-left" size={26} color={t.ink.primary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>New group</Text>
            <Text style={s.subtitle}>
              {selected.length === 0 ? 'Add members' : `${selected.length} selected`}
            </Text>
          </View>
          <TouchableOpacity
            style={[s.createBtn, !canCreate && s.createBtnOff]}
            onPress={createGroup}
            disabled={!canCreate}
            activeOpacity={0.8}
          >
            {creating ? (
              <ActivityIndicator color={t.ink.inverse} size={14} />
            ) : (
              <Text style={s.createBtnTxt}>Create</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={s.nameWrap}>
          <Feather name="users" size={18} color={t.ink.secondary} />
          <TextInput
            value={groupName}
            onChangeText={setGroupName}
            placeholder="Group name"
            placeholderTextColor={t.ink.muted}
            style={s.nameInput}
            maxLength={60}
          />
        </View>

        {selected.length > 0 && (
          <View style={s.chipsWrap}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 14, gap: 8 }}
            >
              {selected.map(c => (
                <TouchableOpacity
                  key={c.id}
                  style={s.chip}
                  onPress={() => removeSelected(c.id)}
                  activeOpacity={0.7}
                >
                  {c.avatar_url ? (
                    <Image source={{ uri: c.avatar_url }} style={s.chipAvatar} />
                  ) : (
                    <View style={[s.chipAvatar, { backgroundColor: avatarColor(c.id), alignItems: 'center', justifyContent: 'center' }]}>
                      <Text style={s.chipAvatarTxt}>{initials(c.full_name)}</Text>
                    </View>
                  )}
                  <Text style={s.chipTxt} numberOfLines={1}>
                    {(c.full_name || 'User').split(' ')[0]}
                  </Text>
                  <Feather name="x" size={12} color={t.ink.secondary} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={s.searchWrap}>
          <Feather name="search" size={15} color={t.ink.secondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search people"
            placeholderTextColor={getTheme().ink.secondary}
            style={s.searchInput}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <Feather name="x" size={15} color={t.ink.secondary} />
            </TouchableOpacity>
          )}
        </View>

        {loadError && !query.trim() ? <View style={{ paddingHorizontal: 16 }}><Text accessibilityRole="alert" style={s.emptySub}>{loadError}</Text><TouchableOpacity accessibilityRole="button" onPress={() => setAttempt(value => value + 1)} style={s.backBtn}><Text style={{ color: t.status.link }}>Retry</Text></TouchableOpacity></View> : null}
        {searchError ? <Text accessibilityRole="alert" style={s.emptySub}>{searchError}</Text> : null}
        {(query.trim() ? searching : loadingInitial) && displayList.length === 0 ? (
          <View style={s.loader}>
            <ActivityIndicator color={t.ink.primary} />
          </View>
        ) : displayList.length === 0 ? (
          <View style={s.empty}>
            <Feather name="users" size={40} color={t.ink.muted} />
            <Text style={s.emptyTitle}>
              {query.trim().length > 0 ? 'No results' : 'No connections yet'}
            </Text>
            <Text style={s.emptySub}>
              {query.trim().length > 0
                ? 'Try a different name.'
                : 'Search for people by name or username.'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={displayList}
            keyExtractor={(c) => c.id}
            renderItem={renderCandidate}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 24 }}
            ListHeaderComponent={
              query.trim().length === 0 && initialList.length > 0 ? (
                <Text style={s.sectionLabel}>YOUR CONNECTIONS</Text>
              ) : null
            }
          />
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.surface.hairline,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontWeight: '700', color: t.ink.primary },
  subtitle: { fontSize: 12, color: t.ink.secondary, marginTop: 1 },
  createBtn: {
    backgroundColor: t.brand.base,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 9,
    minWidth: 78,
    alignItems: 'center',
  },
  createBtnOff: { opacity: 0.35 },
  createBtnTxt: { color: t.ink.inverse, fontSize: 14, fontWeight: '700' },

  nameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 14,
    marginTop: 14,
    marginBottom: 10,
    backgroundColor: t.surface.sunken,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  nameInput: { flex: 1, fontSize: 15, fontWeight: '500', color: t.ink.primary, padding: 0 },

  chipsWrap: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.surface.hairline,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: t.status.linkBg,
    borderRadius: 20,
    paddingLeft: 4,
    paddingRight: 10,
    paddingVertical: 4,
  },
  chipAvatar: { width: 24, height: 24, borderRadius: 12 },
  chipAvatarTxt: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  chipTxt: { fontSize: 12, fontWeight: '600', color: t.status.link, maxWidth: 80 },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginVertical: 10,
    backgroundColor: t.surface.sunken,
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  searchInput: { flex: 1, minWidth: 0, minHeight: 48, fontSize: 16, color: t.ink.primary, paddingHorizontal: 0, paddingVertical: 10, includeFontPadding: false, textAlignVertical: 'center' },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: t.ink.primary },
  emptySub: { fontSize: 13, color: t.ink.secondary, textAlign: 'center' },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: t.ink.secondary,
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  candidateAvatar: { width: 44, height: 44, borderRadius: 22 },
  candidateAvatarTxt: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  candidateName: { fontSize: 15, fontWeight: '600', color: t.ink.primary },
  candidateHandle: { fontSize: 12, color: t.ink.secondary, marginTop: 2 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: t.ink.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: t.brand.base,
    borderColor: t.brand.base,
  },
}));
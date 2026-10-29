import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, FlatList, ActivityIndicator, KeyboardAvoidingView, Platform, StatusBar } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from '../../components/SafeArea';
import { useTheme, themedSheet } from '../../theme/useTheme';
import { useAuthStore } from '../../stores/authStore';
import { supabase } from '../../services/supabase';
import { messagesBack, openChatFromComposer } from '../../navigation/messagesNavigation';
import { searchMessagePeople, type MessagePerson } from '../../../shared/peopleSearch';

export default function NewMessageScreen({ navigation }: any) {
  const { t, isDark } = useTheme();
  const userId = useAuthStore(state => state.session?.user.id);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<MessagePerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const opening = useRef(false);
  useEffect(() => { setQuery(''); setRows([]); opening.current = false; }, [userId]);
  useEffect(() => {
    const version = ++generation.current;
    setRows([]); setError(null); setLoading(!!query.trim() && !!userId);
    if (!userId || !query.trim()) return;
    const timer = setTimeout(() => {
      void searchMessagePeople(supabase, userId, query).then(people => {
        if (version === generation.current) setRows(people);
      }, () => { if (version === generation.current) setError('People could not be loaded. Try again.'); })
        .finally(() => { if (version === generation.current) setLoading(false); });
    }, 200);
    return () => { generation.current++; clearTimeout(timer); };
  }, [query, userId, attempt]);
  const open = (person: MessagePerson) => {
    if (opening.current || !userId || useAuthStore.getState().session?.user.id !== userId) return;
    opening.current = true;
    generation.current++;
    openChatFromComposer(navigation, { userId: person.id, otherUser: person, userName: person.full_name || person.username || 'Member' });
  };
  return <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
    <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
    <KeyboardAvoidingView style={s.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.header}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel new message" onPress={() => messagesBack(navigation)} style={s.action}><Text style={s.link}>Cancel</Text></TouchableOpacity>
        <Text style={s.title}>New message</Text><View style={s.action} />
      </View>
      <View style={s.search}><Feather name="search" size={18} color={t.ink.secondary} />
        <TextInput value={query} onChangeText={setQuery} autoFocus autoCapitalize="none" autoCorrect={false} maxLength={80} placeholder="Name or @username" placeholderTextColor={t.ink.muted} accessibilityLabel="Search message recipients" style={s.input} />
        {query ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} style={s.clear}><Feather name="x" size={18} color={t.ink.secondary} /></TouchableOpacity> : null}
      </View>
      <TouchableOpacity accessibilityRole="button" onPress={() => navigation.navigate('CreateGroup')} style={s.group}><Feather name="users" size={22} color={t.ink.primary} /><Text style={s.title}>Create a group</Text><Feather name="chevron-right" size={18} color={t.ink.secondary} /></TouchableOpacity>
      {loading ? <ActivityIndicator accessibilityLabel="Searching people" color={t.ink.primary} style={s.feedback} /> : error ? <View style={s.feedback}><Text accessibilityRole="alert" style={s.secondary}>{error}</Text><TouchableOpacity accessibilityRole="button" onPress={() => setAttempt(value => value + 1)} style={s.action}><Text style={s.link}>Retry</Text></TouchableOpacity></View> : <FlatList data={rows} keyExtractor={item => item.id} keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={'Message ' + (item.full_name || item.username || 'member')} onPress={() => open(item)} style={s.row}>
          {item.avatar_url ? <Image source={{ uri: item.avatar_url }} style={s.avatar} /> : <View style={s.avatar}><Text style={s.title}>{(item.full_name || item.username || '?').slice(0, 1).toUpperCase()}</Text></View>}
          <View style={s.person}><Text style={s.title} numberOfLines={1}>{item.full_name || item.username || 'Member'}</Text>{item.username ? <Text style={s.secondary} numberOfLines={1}>@{item.username}</Text> : null}</View><Feather name="chevron-right" size={18} color={t.ink.secondary} />
        </TouchableOpacity>}
        ListEmptyComponent={<Text style={[s.secondary, s.feedback]}>{!userId ? 'Sign in to start a message.' : query.trim() ? 'No people match this search.' : 'Search for someone to start a conversation.'}</Text>} />}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const s = themedSheet(t => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 0.5, borderBottomColor: t.surface.hairline, paddingHorizontal: 12 },
  action: { minWidth: 60, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: t.ink.primary }, link: { color: t.status.link, fontSize: 15 },
  search: { margin: 14, paddingHorizontal: 12, gap: 8, borderRadius: 12, backgroundColor: t.surface.sunken, flexDirection: 'row', alignItems: 'center' },
  input: { flex: 1, minHeight: 48, color: t.ink.primary, fontSize: 16, paddingVertical: 10 }, clear: { minHeight: 44, minWidth: 36, alignItems: 'center', justifyContent: 'center' },
  group: { minHeight: 56, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: 0.5, borderBottomColor: t.surface.hairline },
  feedback: { padding: 24, textAlign: 'center', alignItems: 'center' }, secondary: { color: t.ink.secondary, fontSize: 14 },
  row: { minHeight: 68, paddingHorizontal: 18, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: t.brand.tintBg }, person: { flex: 1, gap: 3 },
}));

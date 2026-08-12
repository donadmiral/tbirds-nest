import EmptyState from '../../components/EmptyState';
import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { TAB_BAR_CLEARANCE } from '../../constants/layout';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { signChatMediaMap } from '../../services/chatMediaService';
import { useAuthStore } from '../../stores/authStore';

type SavedMsg = {
  id: string;
  message_id: string;
  saved_at: string;
  message: {
    id: string;
    text?: string | null;
    media_url?: string | null;
    media_type?: string | null;
    created_at: string;
    sender: { id: string; full_name?: string; avatar_url?: string } | null;
    conversation: { id: string; group_name?: string; user_1?: string; user_2?: string } | null;
  } | null;
};

function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const dy = Math.floor(diff / 86400000);
  if (dy === 0) return 'Today';
  if (dy === 1) return 'Yesterday';
  if (dy < 7) return `${dy} days ago`;
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function SavedMessagesScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;
  const [saved, setSaved]   = useState<SavedMsg[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('saved_messages')
        .select(`
          id, message_id, saved_at,
          message:messages!message_id(
            id, text, media_url, media_type, created_at,
            sender:profiles!sender_id(id, full_name, avatar_url),
            conversation:conversations!conversation_id(id, group_name, user_1, user_2)
          )
        `)
        .eq('user_id', userId)
        .order('saved_at', { ascending: false });
      const savedRows = (data || []) as any[];
      const signedMap = await signChatMediaMap(savedRows.map((r: any) => r.message).filter(Boolean));
      savedRows.forEach((r: any) => { if (r.message && signedMap[r.message.id]) r.message.media_url = signedMap[r.message.id]; });
      setSaved(savedRows as unknown as SavedMsg[]);
    } catch (e) {
      console.log('SAVED_MSGS_ERR', e);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const unsave = async (id: string, msgId: string) => {
    await supabase.from('saved_messages').delete().eq('id', id);
    setSaved(prev => prev.filter(s => s.id !== id));
  };

  const renderItem = ({ item }: { item: SavedMsg }) => {
    const msg = item.message;
    if (!msg) return null;
    const preview = msg.text || (msg.media_type === 'image' ? '📷 Photo' : msg.media_type === 'video' ? '🎬 Video' : msg.media_type === 'audio' ? '🎤 Voice message' : '📎 Attachment');
    const sender = msg.sender?.full_name || 'Unknown';
    const convName = msg.conversation?.group_name || sender;
    return (
      <TouchableOpacity
        style={s.card}
        onPress={() => {
          if (msg.conversation?.id) {
            navigation.navigate('Chat', { conversationId: msg.conversation.id });
          }
        }}
        activeOpacity={0.85}
      >
        <View style={s.cardTop}>
          <View style={s.cardMeta}>
            <Text style={s.cardConv}>{convName}</Text>
            <Text style={s.cardDate}>{relTime(item.saved_at)}</Text>
          </View>
          <TouchableOpacity onPress={() => unsave(item.id, item.message_id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="bookmark" size={16} color="#2563EB" />
          </TouchableOpacity>
        </View>
        <Text style={s.cardSender}>{sender}</Text>
        <Text style={s.cardText} numberOfLines={3}>{preview}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Feather name="chevron-left" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={s.title}>Saved Messages</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading
        ? <View style={s.center}><ActivityIndicator color="#000" /></View>
        : (
          <FlatList ListEmptyComponent={<EmptyState icon="bookmark" title="Nothing saved" line="Save a message to find it here later." />}
            data={saved}
            keyExtractor={i => i.id}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 14, gap: 10, paddingBottom: insets.bottom + TAB_BAR_CLEARANCE + 24 }}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <View style={s.empty}>
                <Feather name="bookmark" size={44} color="#E5E5EA" />
                <Text style={s.emptyTitle}>No saved messages</Text>
                <Text style={s.emptySub}>Long-press any message and tap Save to bookmark it.</Text>
              </View>
            }
          />
        )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: '#FFF' },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EB' },
  title:     { fontSize: 17, fontWeight: '700', color: '#000' },
  backBtn:   { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  card:      { backgroundColor: '#F7F7F7', borderRadius: 16, padding: 16 },
  cardTop:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  cardMeta:  { flex: 1 },
  cardConv:  { fontSize: 13, fontWeight: '700', color: '#111' },
  cardDate:  { fontSize: 11, color: '#8E8E93', marginTop: 1 },
  cardSender:{ fontSize: 12, color: '#6B7280', marginBottom: 4 },
  cardText:  { fontSize: 15, color: '#1F2937', lineHeight: 22 },
  empty:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 10, paddingHorizontal: 40 },
  emptyTitle:{ fontSize: 18, fontWeight: '700', color: '#000' },
  emptySub:  { fontSize: 14, color: '#8E8E93', textAlign: 'center', lineHeight: 20 },
});
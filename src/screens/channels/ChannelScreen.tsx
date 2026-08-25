import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ActivityIndicator, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

const NAVY = '#0B1E3D';
const EMOJIS = ['\u2764\uFE0F', '\uD83D\uDD25', '\uD83D\uDC4F', '\uD83D\uDE02', '\uD83D\uDE2E'];

function relTime(iso?: string) {
  if (!iso) return '';
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return 'now';
  if (m < 60) return String(m) + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return String(h) + 'h';
  return String(Math.floor(h / 24)) + 'd';
}

export default function ChannelScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { channelId, name, memberCount: mc0, myRole: role0, isMember: mem0 } = (route.params || {}) as any;
  const me = useAuthStore(st => st.profile) as any;
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [memberCount, setMemberCount] = useState<number>(mc0 || 0);
  const [isMember, setIsMember] = useState<boolean>(!!mem0);
  const [myRole, setMyRole] = useState<string | null>(role0 || null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [thread, setThread] = useState<any | null>(null);
  const [replies, setReplies] = useState<any[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [replyDraft, setReplyDraft] = useState('');
  const [replySending, setReplySending] = useState(false);

  const canPost = myRole === 'owner' || myRole === 'collaborator';

  const load = useCallback(async () => {
    if (!channelId) return;
    try {
      const { data, error } = await supabase.rpc('get_channel_messages', { p_channel: channelId, p_limit: 40 });
      if (!error) {
        const rows = data || [];
        setMessages(rows);
        if (rows.length > 0) void supabase.rpc('mark_channel_read', { p_channel: channelId, p_message: rows[0].id });
      }
    } finally { setLoading(false); }
  }, [channelId]);

  useEffect(() => { load(); }, [load]);

  const join = async () => {
    try {
      const { error } = await supabase.rpc('join_channel', { p_channel: channelId });
      if (error) throw error;
      setIsMember(true); setMyRole(r => r || 'member'); setMemberCount(n => n + 1);
    } catch (e: any) { Alert.alert('Could not join', e?.message || 'Please try again.'); }
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const { data, error } = await supabase.rpc('post_channel_message', { p_channel: channelId, p_content: body });
      if (error) throw error;
      const mine = {
        id: data, content: body, media_url: null, media_type: null, created_at: new Date().toISOString(),
        sender_id: me?.id, sender_name: me?.full_name || 'You', sender_avatar: me?.avatar_url || null,
        sender_role: myRole || 'owner', reply_count: 0, reactions: {}, my_reactions: [],
      };
      setMessages(prev => [mine, ...prev]);
      setDraft('');
    } catch (e: any) { Alert.alert('Could not post', e?.message || 'Please try again.'); }
    finally { setSending(false); }
  };

  const toggleReact = async (msg: any, emoji: string) => {
    if (!isMember) { join(); return; }
    setMessages(prev => prev.map(m => {
      if (m.id !== msg.id) return m;
      const mine: string[] = Array.isArray(m.my_reactions) ? [...m.my_reactions] : [];
      const counts = { ...(m.reactions || {}) } as Record<string, number>;
      const has = mine.includes(emoji);
      if (has) { counts[emoji] = Math.max((counts[emoji] || 1) - 1, 0); if (counts[emoji] === 0) delete counts[emoji]; }
      else { counts[emoji] = (counts[emoji] || 0) + 1; }
      return { ...m, reactions: counts, my_reactions: has ? mine.filter(e => e !== emoji) : [...mine, emoji] };
    }));
    void supabase.rpc('react_channel_message', { p_message: msg.id, p_emoji: emoji });
  };

  const openThread = async (msg: any) => {
    setThread(msg); setReplies([]); setRepliesLoading(true);
    try {
      const { data } = await supabase.rpc('get_channel_replies', { p_message: msg.id, p_limit: 60 });
      setReplies(data || []);
    } finally { setRepliesLoading(false); }
  };

  const sendReply = async () => {
    const body = replyDraft.trim();
    if (!body || !thread || replySending) return;
    if (!isMember) { join(); return; }
    setReplySending(true);
    try {
      const { data, error } = await supabase.rpc('reply_channel_message', { p_message: thread.id, p_content: body });
      if (error) throw error;
      setReplies(prev => [...prev, { id: data, content: body, created_at: new Date().toISOString(), user_id: me?.id, user_name: me?.full_name || 'You', user_avatar: me?.avatar_url || null }]);
      setMessages(prev => prev.map(m => m.id === thread.id ? { ...m, reply_count: (m.reply_count || 0) + 1 } : m));
      setReplyDraft('');
    } catch (e: any) { Alert.alert('Could not reply', e?.message || 'Please try again.'); }
    finally { setReplySending(false); }
  };

  const renderMessage = ({ item }: { item: any }) => {
    const counts = (item.reactions || {}) as Record<string, number>;
    const mine: string[] = Array.isArray(item.my_reactions) ? item.my_reactions : [];
    return (
      <View style={s.msgCard}>
        <View style={s.msgHead}>
          {item.sender_avatar ? (
            <ExpoImage source={{ uri: item.sender_avatar }} style={s.msgAvatar} contentFit="cover" />
          ) : (
            <View style={[s.msgAvatar, s.msgAvatarFb]}><Text style={s.msgAvatarTxt}>{(item.sender_name || 'M')[0]}</Text></View>
          )}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={s.msgName} numberOfLines={1}>{item.sender_name || 'Member'}</Text>
              {item.sender_role === 'owner' ? <View style={s.roleChip}><Text style={s.roleChipTxt}>Owner</Text></View> : null}
            </View>
            <Text style={s.msgTime}>{relTime(item.created_at)}</Text>
          </View>
        </View>
        {item.content ? <Text style={s.msgBody}>{item.content}</Text> : null}
        {item.media_url && item.media_type !== 'video' ? (
          <ExpoImage source={{ uri: item.media_url }} style={s.msgMedia} contentFit="cover" />
        ) : null}
        <View style={s.reactRow}>
          {Object.keys(counts).map(e => (
            <TouchableOpacity key={e} style={[s.reactPill, mine.includes(e) && s.reactPillOn]} onPress={() => toggleReact(item, e)} activeOpacity={0.8}>
              <Text style={s.reactTxt}>{e} {counts[e]}</Text>
            </TouchableOpacity>
          ))}
          {EMOJIS.filter(e => !counts[e]).slice(0, 3).map(e => (
            <TouchableOpacity key={e} style={s.reactAdd} onPress={() => toggleReact(item, e)} activeOpacity={0.8}>
              <Text style={{ fontSize: 14 }}>{e}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={s.replyBtn} onPress={() => openThread(item)} activeOpacity={0.8}>
            <Feather name="message-circle" size={13} color="#5B6B84" />
            <Text style={s.replyBtnTxt}>{item.reply_count > 0 ? String(item.reply_count) + ' replies' : 'Reply'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color={NAVY} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={s.title} numberOfLines={1}>{name || 'Channel'}</Text>
          <Text style={s.subtitle}>{memberCount === 1 ? '1 member' : String(memberCount) + ' members'}</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        {loading ? (
          <View style={s.center}><ActivityIndicator color={NAVY} /></View>
        ) : messages.length === 0 ? (
          <View style={s.center}>
            <Feather name="radio" size={38} color="#E5E5EA" />
            <Text style={s.emptyTitle}>No updates yet</Text>
            {canPost ? <Text style={s.emptySub}>Post the first update below.</Text> : <Text style={s.emptySub}>Updates from the channel will appear here.</Text>}
          </View>
        ) : (
          <FlatList data={messages} keyExtractor={m => m.id} renderItem={renderMessage} inverted
            contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12 }} keyboardShouldPersistTaps="handled" />
        )}
        {canPost ? (
          <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            <TextInput style={s.composerInput} placeholder="Post an update" placeholderTextColor="#8E8E93" value={draft} onChangeText={setDraft} multiline maxLength={2000} />
            <TouchableOpacity style={[s.sendBtn, (!draft.trim() || sending) && { opacity: 0.4 }]} onPress={send} disabled={!draft.trim() || sending}>
              {sending ? <ActivityIndicator size="small" color="#FFF" /> : <Feather name="arrow-up" size={18} color="#FFF" />}
            </TouchableOpacity>
          </View>
        ) : !isMember ? (
          <View style={[s.joinBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <TouchableOpacity style={s.joinBig} onPress={join} activeOpacity={0.85}>
              <Text style={s.joinBigTxt}>Join channel</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      <Modal visible={!!thread} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setThread(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={s.modalHeader}>
              <View style={{ width: 60 }} />
              <Text style={s.modalTitle}>Replies</Text>
              <TouchableOpacity onPress={() => setThread(null)} style={{ width: 60, alignItems: 'flex-end' }}><Feather name="x" size={22} color="#000" /></TouchableOpacity>
            </View>
            {thread ? (
              <View style={s.threadRoot}>
                <Text style={s.threadRootName}>{thread.sender_name}</Text>
                {thread.content ? <Text style={s.threadRootBody} numberOfLines={3}>{thread.content}</Text> : null}
              </View>
            ) : null}
            {repliesLoading ? (
              <View style={s.center}><ActivityIndicator color={NAVY} /></View>
            ) : (
              <FlatList data={replies} keyExtractor={r => r.id}
                contentContainerStyle={{ padding: 16, paddingBottom: 20 }}
                ListEmptyComponent={<Text style={{ textAlign: 'center', color: '#8E8E93', marginTop: 30, fontSize: 13.5 }}>No replies yet. Start the thread.</Text>}
                renderItem={({ item }) => (
                  <View style={s.replyRow}>
                    {item.user_avatar ? (
                      <ExpoImage source={{ uri: item.user_avatar }} style={s.replyAvatar} contentFit="cover" />
                    ) : (
                      <View style={[s.replyAvatar, s.msgAvatarFb]}><Text style={s.replyAvatarTxt}>{(item.user_name || 'M')[0]}</Text></View>
                    )}
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={s.replyName}>{item.user_name || 'Member'}</Text>
                        <Text style={s.replyTime}>{relTime(item.created_at)}</Text>
                      </View>
                      <Text style={s.replyBody}>{item.content}</Text>
                    </View>
                  </View>
                )} />
            )}
            <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
              <TextInput style={s.composerInput} placeholder="Write a reply" placeholderTextColor="#8E8E93" value={replyDraft} onChangeText={setReplyDraft} multiline maxLength={1000} />
              <TouchableOpacity style={[s.sendBtn, (!replyDraft.trim() || replySending) && { opacity: 0.4 }]} onPress={sendReply} disabled={!replyDraft.trim() || replySending}>
                {replySending ? <ActivityIndicator size="small" color="#FFF" /> : <Feather name="arrow-up" size={18} color="#FFF" />}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16.5, fontWeight: '700', color: '#0F1419' },
  subtitle: { fontSize: 11.5, color: '#8E8E93', marginTop: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 15.5, fontWeight: '700', color: '#0F1419' },
  emptySub: { fontSize: 13, color: '#8E8E93', textAlign: 'center' },
  msgCard: { backgroundColor: '#F8F9FB', borderRadius: 16, padding: 12, marginBottom: 10 },
  msgHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  msgAvatar: { width: 36, height: 36, borderRadius: 18 },
  msgAvatarFb: { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  msgAvatarTxt: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  msgName: { fontSize: 14, fontWeight: '700', color: '#0F1419', flexShrink: 1 },
  roleChip: { backgroundColor: 'rgba(11,30,61,0.08)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  roleChipTxt: { fontSize: 10, fontWeight: '700', color: NAVY },
  msgTime: { fontSize: 11.5, color: '#8E8E93', marginTop: 1 },
  msgBody: { fontSize: 15, color: '#1A1A1A', lineHeight: 21, marginTop: 8 },
  msgMedia: { height: 180, borderRadius: 10, marginTop: 8 },
  reactRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 10 },
  reactPill: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: '#E5E5EA' },
  reactPillOn: { borderColor: NAVY, backgroundColor: 'rgba(11,30,61,0.06)' },
  reactTxt: { fontSize: 12.5, color: '#0F1419' },
  reactAdd: { backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#EFEFEF' },
  replyBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 4 },
  replyBtnTxt: { fontSize: 12.5, fontWeight: '600', color: '#5B6B84' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5EA', backgroundColor: '#FFF' },
  composerInput: { flex: 1, backgroundColor: '#F2F2F7', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, fontSize: 15, color: '#0F1419', maxHeight: 110 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  joinBar: { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5EA', backgroundColor: '#FFF' },
  joinBig: { backgroundColor: NAVY, borderRadius: 14, alignItems: 'center', paddingVertical: 13 },
  joinBigTxt: { fontSize: 15, fontWeight: '700', color: '#FFF' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA' },
  modalTitle: { fontSize: 16.5, fontWeight: '700', color: '#0F1419' },
  threadRoot: { backgroundColor: '#F8F9FB', marginHorizontal: 16, marginTop: 12, borderRadius: 12, padding: 12 },
  threadRootName: { fontSize: 13, fontWeight: '700', color: NAVY },
  threadRootBody: { fontSize: 14, color: '#1A1A1A', marginTop: 4, lineHeight: 20 },
  replyRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  replyAvatar: { width: 32, height: 32, borderRadius: 16 },
  replyAvatarTxt: { fontSize: 13, fontWeight: '700', color: '#FFF' },
  replyName: { fontSize: 13.5, fontWeight: '700', color: '#0F1419' },
  replyTime: { fontSize: 11.5, color: '#8E8E93' },
  replyBody: { fontSize: 14.5, color: '#1A1A1A', lineHeight: 20, marginTop: 2 },
});

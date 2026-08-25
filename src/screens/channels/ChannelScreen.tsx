import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ActivityIndicator, Modal, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { uploadMedia } from '../../services/mediaService';
import ChannelSettingsSheet from '../../components/ChannelSettingsSheet';

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

function pollTimeLeft(endsAt?: string) {
  if (!endsAt) return '';
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return 'Final results';
  const h = Math.floor(ms / 3600000);
  if (h < 1) return 'Ends soon';
  if (h < 24) return 'Ends in ' + String(h) + 'h';
  return 'Ends in ' + String(Math.floor(h / 24)) + 'd';
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
  const [channelName, setChannelName] = useState<string>(name || 'Channel');
  const [repliesEnabled, setRepliesEnabled] = useState<boolean>(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [promptMode, setPromptMode] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [pollQ, setPollQ] = useState('');
  const [pollOpts, setPollOpts] = useState<string[]>(['', '']);
  const [pollDays, setPollDays] = useState(3);
  const [pollBusy, setPollBusy] = useState(false);
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
      const { data, error } = await supabase.rpc('post_channel_message', { p_channel: channelId, p_content: body, p_is_prompt: promptMode });
      if (error) throw error;
      const mine = {
        id: data, content: body, media_url: null, media_type: null, created_at: new Date().toISOString(),
        sender_id: me?.id, sender_name: me?.full_name || 'You', sender_avatar: me?.avatar_url || null,
        sender_role: myRole || 'owner', reply_count: 0, reactions: {}, my_reactions: [], is_prompt: promptMode, poll: null,
      };
      setMessages(prev => [mine, ...prev]);
      setDraft(''); setPromptMode(false);
    } catch (e: any) { Alert.alert('Could not post', e?.message || 'Please try again.'); }
    finally { setSending(false); }
  };

  const attach = async () => {
    if (!me?.id || attaching) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access in your device settings.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      preferredAssetRepresentationMode: 'compatible' as ImagePicker.UIImagePickerPreferredAssetRepresentationMode,
      mediaTypes: ['images', 'videos'] as ImagePicker.MediaType[],
      allowsEditing: false, quality: 0.85, videoMaxDuration: 120,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setAttaching(true);
    try {
      const asset = result.assets[0];
      const isVideo = asset.type === 'video';
      const ext = (asset.uri.split('.').pop() || (isVideo ? 'mp4' : 'jpg')).toLowerCase().replace('jpeg', 'jpg');
      const mime = isVideo ? 'video/mp4' : ext === 'png' ? 'image/png' : 'image/jpeg';
      const { url } = await uploadMedia('chat-media', me.id, { uri: asset.uri, kind: isVideo ? 'video' : 'image', ext, mimeType: mime, width: asset.width, height: asset.height, base64: null } as any, {});
      const body = draft.trim();
      const { data, error } = await supabase.rpc('post_channel_message', {
        p_channel: channelId, p_content: body || null, p_media_url: url, p_media_type: isVideo ? 'video' : 'image', p_is_prompt: promptMode,
      });
      if (error) throw error;
      const mine = {
        id: data, content: body || null, media_url: url, media_type: isVideo ? 'video' : 'image', created_at: new Date().toISOString(),
        sender_id: me?.id, sender_name: me?.full_name || 'You', sender_avatar: me?.avatar_url || null,
        sender_role: myRole || 'owner', reply_count: 0, reactions: {}, my_reactions: [], is_prompt: promptMode, poll: null,
      };
      setMessages(prev => [mine, ...prev]);
      setDraft(''); setPromptMode(false);
    } catch (e: any) { Alert.alert('Could not post media', e?.message || 'Please try again.'); }
    finally { setAttaching(false); }
  };

  const createPoll = async () => {
    const question = pollQ.trim();
    const opts = pollOpts.map(o => o.trim()).filter(Boolean);
    if (!question) { Alert.alert('Poll needs a question'); return; }
    if (opts.length < 2) { Alert.alert('Polls take at least two options'); return; }
    setPollBusy(true);
    try {
      const { error } = await supabase.rpc('post_channel_poll', { p_channel: channelId, p_question: question, p_options: opts, p_days: pollDays });
      if (error) throw error;
      setPollOpen(false); setPollQ(''); setPollOpts(['', '']); setPollDays(3);
      await load();
    } catch (e: any) { Alert.alert('Could not create the poll', e?.message || 'Please try again.'); }
    finally { setPollBusy(false); }
  };

  const votePoll = async (msg: any, optionId: string) => {
    if (!isMember) { join(); return; }
    const poll = msg.poll;
    if (!poll || new Date(poll.ends_at).getTime() < Date.now()) return;
    if (poll.my_option === optionId) return;
    setMessages(prev => prev.map(m => {
      if (m.id !== msg.id || !m.poll) return m;
      const hadVote = !!m.poll.my_option;
      const options = (m.poll.options || []).map((o: any) => {
        let votes = o.votes || 0;
        if (o.id === m.poll.my_option) votes = Math.max(votes - 1, 0);
        if (o.id === optionId) votes = votes + 1;
        return { ...o, votes };
      });
      return { ...m, poll: { ...m.poll, options, my_option: optionId, total: (m.poll.total || 0) + (hadVote ? 0 : 1) } };
    }));
    const { error } = await supabase.rpc('vote_channel_poll', { p_message: msg.id, p_option: optionId });
    if (error) Alert.alert('Vote failed', error.message);
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
    const poll = item.poll || null;
    const pollClosed = poll ? new Date(poll.ends_at).getTime() < Date.now() : false;
    return (
      <View style={[s.msgCard, item.is_prompt && s.promptCard]}>
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
              {item.sender_role === 'collaborator' ? <View style={s.roleChip}><Text style={s.roleChipTxt}>Collab</Text></View> : null}
            </View>
            <Text style={s.msgTime}>{relTime(item.created_at)}</Text>
          </View>
        </View>
        {item.is_prompt ? (
          <View style={s.promptPill}><Feather name="help-circle" size={12} color={NAVY} /><Text style={s.promptPillTxt}>Prompt · answer in the replies</Text></View>
        ) : null}
        {item.content ? <Text style={s.msgBody}>{item.content}</Text> : null}
        {item.media_url && item.media_type !== 'video' ? (
          <ExpoImage source={{ uri: item.media_url }} style={s.msgMedia} contentFit="cover" />
        ) : null}
        {item.media_url && item.media_type === 'video' ? (
          <Video source={{ uri: item.media_url }} style={s.msgMedia} useNativeControls resizeMode={ResizeMode.CONTAIN} />
        ) : null}
        {poll ? (
          <View style={s.pollBox}>
            {(poll.options || []).map((o: any) => {
              const total = Math.max(poll.total || 0, 1);
              const pct = Math.round(((o.votes || 0) / total) * 100);
              const on = poll.my_option === o.id;
              return (
                <TouchableOpacity key={o.id} style={s.pollOpt} onPress={() => votePoll(item, o.id)} activeOpacity={pollClosed ? 1 : 0.8} disabled={pollClosed}>
                  <View style={[s.pollFill, { width: String(Math.max(pct, 3)) + '%' }, on && s.pollFillOn]} />
                  <View style={s.pollOptRow}>
                    <Text style={[s.pollOptTxt, on && { fontWeight: '700', color: NAVY }]} numberOfLines={1}>{o.label}</Text>
                    <Text style={s.pollPct}>{(poll.total || 0) > 0 ? String(pct) + '%' : ''}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
            <Text style={s.pollMeta}>{String(poll.total || 0)} {poll.total === 1 ? 'vote' : 'votes'} · {pollTimeLeft(poll.ends_at)}</Text>
          </View>
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
          {repliesEnabled ? (
            <TouchableOpacity style={s.replyBtn} onPress={() => openThread(item)} activeOpacity={0.8}>
              <Feather name="message-circle" size={13} color="#5B6B84" />
              <Text style={s.replyBtnTxt}>{item.reply_count > 0 ? String(item.reply_count) + ' replies' : 'Reply'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['left', 'right']}>
      <View style={[s.header, { paddingTop: insets.top + 4 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="chevron-left" size={26} color={NAVY} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={s.title} numberOfLines={1}>{channelName}</Text>
          <Text style={s.subtitle}>{memberCount === 1 ? '1 member' : String(memberCount) + ' members'}</Text>
        </View>
        {isMember ? (
          <TouchableOpacity onPress={() => setSettingsOpen(true)} style={s.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="settings" size={20} color={NAVY} />
          </TouchableOpacity>
        ) : <View style={{ width: 40 }} />}
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
          <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5EA', backgroundColor: '#FFF' }}>
            {promptMode ? (
              <View style={s.promptBanner}><Feather name="help-circle" size={13} color={NAVY} /><Text style={s.promptBannerTxt}>Posting as a prompt. Members answer in the replies.</Text></View>
            ) : null}
            <View style={[s.composer, { borderTopWidth: 0, paddingBottom: Math.max(insets.bottom, 10) }]}>
              <TouchableOpacity style={s.toolBtn} onPress={() => setPromptMode(p => !p)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                <Feather name="help-circle" size={20} color={promptMode ? NAVY : '#8E8E93'} />
              </TouchableOpacity>
              <TouchableOpacity style={s.toolBtn} onPress={() => setPollOpen(true)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                <Feather name="bar-chart-2" size={20} color="#8E8E93" />
              </TouchableOpacity>
              <TouchableOpacity style={s.toolBtn} onPress={attach} disabled={attaching} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                {attaching ? <ActivityIndicator size="small" color={NAVY} /> : <Feather name="image" size={20} color="#8E8E93" />}
              </TouchableOpacity>
              <TextInput style={s.composerInput} placeholder={promptMode ? 'Ask your members something' : 'Post an update'} placeholderTextColor="#8E8E93" value={draft} onChangeText={setDraft} multiline maxLength={2000} />
              <TouchableOpacity style={[s.sendBtn, (!draft.trim() || sending) && { opacity: 0.4 }]} onPress={send} disabled={!draft.trim() || sending}>
                {sending ? <ActivityIndicator size="small" color="#FFF" /> : <Feather name="arrow-up" size={18} color="#FFF" />}
              </TouchableOpacity>
            </View>
          </View>
        ) : !isMember ? (
          <View style={[s.joinBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <TouchableOpacity style={s.joinBig} onPress={join} activeOpacity={0.85}>
              <Text style={s.joinBigTxt}>Join channel</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      <Modal visible={pollOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPollOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={s.modalHeader}>
              <View style={{ width: 60 }} />
              <Text style={s.modalTitle}>New poll</Text>
              <TouchableOpacity onPress={() => setPollOpen(false)} style={{ width: 60, alignItems: 'flex-end' }}><Feather name="x" size={22} color="#000" /></TouchableOpacity>
            </View>
            <View style={{ padding: 16, flex: 1 }}>
              <TextInput style={s.pollInput} placeholder="Ask a question" placeholderTextColor="#8E8E93" value={pollQ} onChangeText={setPollQ} maxLength={140} />
              {pollOpts.map((o, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TextInput style={[s.pollInput, { flex: 1 }]} placeholder={'Option ' + String(i + 1)} placeholderTextColor="#8E8E93" value={o} maxLength={60}
                    onChangeText={t => setPollOpts(prev => prev.map((x, j) => j === i ? t : x))} />
                  {pollOpts.length > 2 ? (
                    <TouchableOpacity onPress={() => setPollOpts(prev => prev.filter((_, j) => j !== i))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Feather name="x" size={18} color="#8E8E93" />
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
              {pollOpts.length < 4 ? (
                <TouchableOpacity style={s.pollAdd} onPress={() => setPollOpts(prev => [...prev, ''])} activeOpacity={0.8}>
                  <Feather name="plus" size={15} color={NAVY} />
                  <Text style={s.pollAddTxt}>Add option</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={[s.pollLabel, { marginTop: 14 }]}>Runs for</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {[1, 3, 7].map(d => (
                  <TouchableOpacity key={d} style={[s.dayChip, pollDays === d && s.dayChipOn]} onPress={() => setPollDays(d)} activeOpacity={0.85}>
                    <Text style={[s.dayChipTxt, pollDays === d && s.dayChipTxtOn]}>{d === 1 ? '1 day' : String(d) + ' days'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={[s.pollCreate, pollBusy && { opacity: 0.5 }]} onPress={createPoll} disabled={pollBusy} activeOpacity={0.85}>
                {pollBusy ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={s.pollCreateTxt}>Create poll</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

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

      <ChannelSettingsSheet
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        channelId={channelId}
        myRole={myRole}
        meId={me?.id || null}
        onChannelUpdated={p => {
          if (p.name) setChannelName(p.name);
          if (typeof p.replies_enabled === 'boolean') setRepliesEnabled(p.replies_enabled);
        }}
      />
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
  promptCard: { borderLeftWidth: 3, borderLeftColor: NAVY },
  promptPill: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: 'rgba(11,30,61,0.07)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, marginTop: 8 },
  promptPillTxt: { fontSize: 11.5, fontWeight: '700', color: NAVY },
  msgHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  msgAvatar: { width: 36, height: 36, borderRadius: 18 },
  msgAvatarFb: { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  msgAvatarTxt: { fontSize: 14, fontWeight: '700', color: '#FFF' },
  msgName: { fontSize: 14, fontWeight: '700', color: '#0F1419', flexShrink: 1 },
  roleChip: { backgroundColor: 'rgba(11,30,61,0.08)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  roleChipTxt: { fontSize: 10, fontWeight: '700', color: NAVY },
  msgTime: { fontSize: 11.5, color: '#8E8E93', marginTop: 1 },
  msgBody: { fontSize: 15, color: '#1A1A1A', lineHeight: 21, marginTop: 8 },
  msgMedia: { height: 180, borderRadius: 10, marginTop: 8, backgroundColor: '#000' },
  pollBox: { marginTop: 10, gap: 6 },
  pollOpt: { position: 'relative', borderRadius: 10, borderWidth: 1, borderColor: '#E5E5EA', overflow: 'hidden', backgroundColor: '#FFF' },
  pollFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: 'rgba(11,30,61,0.10)' },
  pollFillOn: { backgroundColor: 'rgba(11,30,61,0.20)' },
  pollOptRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 11, paddingVertical: 9 },
  pollOptTxt: { fontSize: 13.5, color: '#0F1419', flexShrink: 1, paddingRight: 8 },
  pollPct: { fontSize: 12.5, fontWeight: '700', color: '#5B6B84' },
  pollMeta: { fontSize: 11.5, color: '#8E8E93', marginTop: 2 },
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
  toolBtn: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  promptBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 8 },
  promptBannerTxt: { fontSize: 12, fontWeight: '600', color: NAVY },
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
  pollInput: { backgroundColor: '#F2F2F7', borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, fontSize: 15, color: '#0F1419', marginBottom: 10 },
  pollLabel: { fontSize: 12, fontWeight: '700', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  pollAdd: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingVertical: 4 },
  pollAddTxt: { fontSize: 13.5, fontWeight: '700', color: NAVY },
  dayChip: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: '#E5E5EA', paddingVertical: 10, alignItems: 'center' },
  dayChipOn: { borderColor: NAVY, backgroundColor: 'rgba(11,30,61,0.05)' },
  dayChipTxt: { fontSize: 13.5, fontWeight: '600', color: '#5B6B84' },
  dayChipTxtOn: { color: NAVY, fontWeight: '700' },
  pollCreate: { backgroundColor: NAVY, borderRadius: 12, alignItems: 'center', paddingVertical: 13, marginTop: 18 },
  pollCreateTxt: { fontSize: 15, fontWeight: '700', color: '#FFF' },
});

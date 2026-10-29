import { themedSheet, useTheme } from '../../theme/useTheme';
import React, { useCallback, useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, ActivityIndicator, Modal, Alert, KeyboardAvoidingView, Platform, AppState } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { supabase, SUPABASE_URL } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { uploadMedia } from '../../services/mediaService';
import { channelMediaObject } from '../../../shared/channelMedia';
import { orderTimeout } from '../../../shared/orderRequest';
import ChannelSettingsSheet from '../../components/ChannelSettingsSheet';

const deadline = <T,>(work: PromiseLike<T>) => orderTimeout(work, 15000, 'The connection timed out. Refresh to check the result before trying again.');

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
  useTheme();
  const focused = useIsFocused();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { channelId, name, memberCount: mc0, myRole: role0, isMember: mem0 } = (route.params || {}) as any;
  const uid = useAuthStore(st => st.session?.user.id || '');
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

  const scope = useRef(0), pageLock = useRef(false), actionLock = useRef(false), replyLock = useRef(false);
  const live = useRef(''); live.current = uid + ':' + channelId;
  const messagesRef = useRef<any[]>([]); messagesRef.current = messages;
  const threadRef = useRef<string | null>(null);const threadEpoch=useRef(0);
  const [mediaUrls,setMediaUrls] = useState<Record<string,string>>({});
  const [more,setMore] = useState(false), [paging,setPaging] = useState(false), [loadError,setLoadError] = useState('');
  const [replyMore,setReplyMore] = useState(false), [replyError,setReplyError] = useState('');
  const atLatest = useRef(true), readPending = useRef(false), lastRead = useRef('');
  const loadedIdentity = useRef('');
  const readState = useRef({ focused, isMember, obscured: false });
  readState.current = { focused, isMember, obscured: settingsOpen || pollOpen || !!thread };
  const valid = (run:number) => run===scope.current && useAuthStore.getState().session?.user.id===uid && live.current===uid+':'+channelId;
  const markRead = useCallback(async (): Promise<void> => {
    const run = scope.current, latest = messagesRef.current[0];
    if (!latest || loadedIdentity.current !== uid + ':' + channelId || !valid(run) || readPending.current || lastRead.current === latest.id || !readState.current.focused || !readState.current.isMember || readState.current.obscured || !atLatest.current || AppState.currentState !== 'active') return;
    readPending.current = true;
    try {
      const { error } = await deadline(supabase.rpc('mark_channel_read', { p_channel: channelId, p_message: latest.id }));
      if (error) throw error;
      if (valid(run)) lastRead.current = latest.id;
    } catch { if (valid(run)) setLoadError('Updates loaded, but the read marker could not be saved.'); }
    finally {
      if (valid(run)) {
        readPending.current = false;
        if (messagesRef.current[0]?.id !== latest.id) void markRead();
      }
    }
  }, [channelId, uid]);
  useEffect(() => { if (!loading) void markRead(); }, [messages, loading, focused, isMember, settingsOpen, pollOpen, thread, markRead]);
  const signMedia = useCallback(async (rows:any[], run:number) => {
    const signed = await Promise.all(rows.filter(row=>row.media_url).map(async row=>{
      const object=channelMediaObject(row.media_url,SUPABASE_URL);
      if(!object)return [row.id,''] as const;
      try {const result=await deadline(supabase.storage.from(object.bucket).createSignedUrl(object.path,300));return [row.id,result.error?'':result.data?.signedUrl||''] as const;}
      catch{return [row.id,''] as const;}
    }));
    if(run===scope.current)setMediaUrls(old=>({...old,...Object.fromEntries(signed)}));
  },[]);
  const canPost = myRole === 'owner' || myRole === 'collaborator';

  const load = useCallback(async (next = false) => {
    if (!channelId || !uid || pageLock.current) return;
    const run=scope.current, identity=uid+':'+channelId;pageLock.current=true;
    if(next)setPaging(true);else setLoading(messagesRef.current.length===0);
    const before=next?messagesRef.current.at(-1):null;
    try {
      const [page,detail] = await Promise.all([
        deadline(supabase.rpc('get_channel_messages_page',{p_channel:channelId,p_limit:40,p_cursor:before?.created_at||null,p_cursor_id:before?.id||null})),
        next?Promise.resolve(null):deadline(supabase.rpc('get_channel_detail',{p_channel:channelId})),
      ]);
      if(page.error)throw page.error;if(detail?.error)throw detail.error;
      if(run!==scope.current||live.current!==identity)return;
      if(detail){const channel=detail.data?.[0];if(!channel){setMessages([]);setMediaUrls({});setThread(null);setReplies([]);throw new Error('This channel is not available.');}setMemberCount(channel.member_count);setIsMember(channel.is_member);setMyRole(channel.my_role);setChannelName(channel.name);setRepliesEnabled(channel.replies_enabled);}
      const rows=page.data||[];
      loadedIdentity.current = identity;
      setMessages(old=>next?[...old,...rows.filter((row:any)=>!old.some(item=>item.id===row.id))]:rows);setMore(rows.length===40);setLoadError('');
      void signMedia(rows,run);
    } catch(e:any) {if(run===scope.current)setLoadError(e?.message||'Channel could not be loaded. Please retry.');}
    finally {if(run===scope.current){pageLock.current=false;setLoading(false);setPaging(false);}}
  },[channelId,uid,signMedia]);

  useEffect(()=>{
    atLatest.current = true; readPending.current = false; lastRead.current = ''; loadedIdentity.current = '';
    live.current=uid+':'+channelId;scope.current++;pageLock.current=false;actionLock.current=false;replyLock.current=false;setMessages([]);messagesRef.current=[];setMediaUrls({});setThread(null);threadRef.current=null;setReplies([]);setDraft('');setReplyDraft('');setPollQ('');setPollOpts(['','']);setPollOpen(false);setSending(false);setAttaching(false);setPollBusy(false);setReplySending(false);setIsMember(false);setMyRole(null);setMore(false);setLoadError('');setLoading(!!uid);
    void load();
    const subscription=supabase.channel('channel-screen:'+uid+':'+channelId).on('postgres_changes',{event:'*',schema:'public',table:'channel_messages',filter:'channel_id=eq.'+channelId},()=>{void load();}).subscribe();
    const timer=setInterval(()=>void signMedia(messagesRef.current,scope.current),240000);
    const app=AppState.addEventListener('change',state=>{if(state==='active'){void load();void signMedia(messagesRef.current,scope.current);}});
    return()=>{scope.current++;live.current='';clearInterval(timer);app.remove();void supabase.removeChannel(subscription);};
  },[load,uid,channelId,signMedia]);

  const join = async () => {
    const run=scope.current;if(!valid(run)||actionLock.current)return;actionLock.current=true;
    try {
      const { error } = await deadline(supabase.rpc('join_channel', { p_channel: channelId }));
      if (error) throw error;
      if(valid(run))await load();
    } catch (e: any) { if(valid(run))Alert.alert('Could not join', e?.message || 'Please try again.'); } finally{if(valid(run))actionLock.current=false;}
  };

  const send = async () => {
    const body = draft.trim();
    const run=scope.current;if (!body || actionLock.current || !valid(run)) return;
    actionLock.current=true;setSending(true);
    try {
      const { data, error } = await deadline(supabase.rpc('post_channel_message', { p_channel: channelId, p_content: body, p_is_prompt: promptMode }));
      if (error) throw error;
      if (!data || typeof data !== 'string') throw new Error('Posting was not confirmed. Refresh this channel before retrying.');
      if(!valid(run))return;
      const mine = {
        id: data, content: body, media_url: null, media_type: null, created_at: new Date().toISOString(),
        sender_id: me?.id, sender_name: me?.full_name || 'You', sender_avatar: me?.avatar_url || null,
        sender_role: myRole || 'owner', reply_count: 0, reactions: {}, my_reactions: [], is_prompt: promptMode, poll: null,
      };
      setMessages(prev => [mine, ...prev.filter(item=>item.id!==mine.id)]);
      void signMedia([mine],run);
      setDraft(''); setPromptMode(false);
    } catch (e: any) { if(valid(run))Alert.alert('Could not post', e?.message || 'Please try again.'); }
    finally { if(valid(run)){actionLock.current=false;setSending(false);} }
  };

  const attach = async () => {
    const run=scope.current;if (!uid || actionLock.current || !valid(run)) return;
    actionLock.current=true;
    try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!valid(run)) return;
    if (!perm.granted) { actionLock.current=false;Alert.alert('Permission needed', 'Allow photo access in your device settings.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      preferredAssetRepresentationMode: 'compatible' as ImagePicker.UIImagePickerPreferredAssetRepresentationMode,
      mediaTypes: ['images', 'videos'] as ImagePicker.MediaType[],
      allowsEditing: false, quality: 1, videoMaxDuration: 120,
    });
    if (!valid(run))return;if (result.canceled || !result.assets?.[0]) {actionLock.current=false;return;}
    setAttaching(true);
      const asset = result.assets[0];
      const isVideo = asset.type === 'video';
      const ext = ((asset.fileName || asset.uri).split('.').pop()?.split('?')[0] || (isVideo ? 'mp4' : 'jpg')).toLowerCase().replace('jpeg', 'jpg');
      const mime = asset.mimeType || (isVideo ? 'video/mp4' : ext === 'png' ? 'image/png' : 'image/jpeg');
      const { url } = await uploadMedia('channel-media', channelId + '/' + uid, { uri: asset.uri, kind: isVideo ? 'video' : 'image', ext, mimeType: mime, width: asset.width, height: asset.height, base64: null } as any, {});
      if(!valid(run))return;
      const body = draft.trim();
      const { data, error } = await deadline(supabase.rpc('post_channel_message', {
        p_channel: channelId, p_content: body || null, p_media_url: url, p_media_type: isVideo ? 'video' : 'image', p_is_prompt: promptMode,
      }));
      if (error) throw error;
      if (!data || typeof data !== 'string') throw new Error('Posting was not confirmed. Refresh this channel before retrying.');
      if(!valid(run))return;
      const mine = {
        id: data, content: body || null, media_url: url, media_type: isVideo ? 'video' : 'image', created_at: new Date().toISOString(),
        sender_id: me?.id, sender_name: me?.full_name || 'You', sender_avatar: me?.avatar_url || null,
        sender_role: myRole || 'owner', reply_count: 0, reactions: {}, my_reactions: [], is_prompt: promptMode, poll: null,
      };
      setMessages(prev => [mine, ...prev.filter(item=>item.id!==mine.id)]);
      void signMedia([mine],run);
      setDraft(''); setPromptMode(false);
    } catch (e: any) { if(valid(run))Alert.alert('Could not post media', e?.message || 'Please try again.'); }
    finally { if(valid(run)){actionLock.current=false;setAttaching(false);} }
  };

  const createPoll = async () => {
    const question = pollQ.trim();
    const opts = pollOpts.map(o => o.trim()).filter(Boolean);
    if (!question) { Alert.alert('Poll needs a question'); return; }
    if (opts.length < 2) { Alert.alert('Polls take at least two options'); return; }
    const run=scope.current;if(actionLock.current||!valid(run))return;actionLock.current=true;setPollBusy(true);
    try {
      const { error } = await deadline(supabase.rpc('post_channel_poll', { p_channel: channelId, p_question: question, p_options: opts, p_days: pollDays }));
      if (error) throw error;
      if(!valid(run))return;setPollOpen(false); setPollQ(''); setPollOpts(['', '']); setPollDays(3);
      await load();
    } catch (e: any) { if(valid(run))Alert.alert('Could not create the poll', e?.message || 'Please try again.'); }
    finally { if(valid(run)){actionLock.current=false;setPollBusy(false);} }
  };

  const channelAction = async (rpc:string,args:Record<string,unknown>,title:string) => {
    if(!isMember){void join();return;}
    const run=scope.current;if(actionLock.current||!valid(run))return;actionLock.current=true;
    try{const {error}=await deadline(supabase.rpc(rpc,args));if(error)throw error;}
    catch(e:any){if(valid(run))Alert.alert(title,e?.message||'Please retry.');}
    finally{if(valid(run)){actionLock.current=false;void load();}}
  };
  const votePoll = (msg:any,optionId:string) => {
    if(!msg.poll||Date.parse(msg.poll.ends_at)<=Date.now()||msg.poll.my_option===optionId)return;
    void channelAction('vote_channel_poll',{p_message:msg.id,p_option:optionId},'Vote could not be saved');
  };
  const toggleReact = (msg:any,emoji:string) => {void channelAction('react_channel_message',{p_message:msg.id,p_emoji:emoji},'Reaction could not be saved');};

  const loadReplies = async (messageId:string,next=false) => {
    const run=scope.current,threadRun=threadEpoch.current;if(replyLock.current)return;replyLock.current=true;setRepliesLoading(true);
    const before=next?replies.at(-1):null;
    try {
      const {data,error}=await deadline(supabase.rpc('get_channel_replies_page',{p_message:messageId,p_limit:40,p_cursor:before?.created_at||null,p_cursor_id:before?.id||null}));
      if(error)throw error;if(!valid(run)||threadRef.current!==messageId||threadRun!==threadEpoch.current)return;
      const rows=data||[];setReplies(old=>next?[...old,...rows.filter((row:any)=>!old.some(item=>item.id===row.id))]:rows);setReplyMore(rows.length===40);setReplyError('');
    }catch(e:any){if(valid(run)&&threadRef.current===messageId&&threadRun===threadEpoch.current)setReplyError(e?.message||'Replies could not be loaded.');}
    finally{if(valid(run)&&threadRef.current===messageId&&threadRun===threadEpoch.current){replyLock.current=false;setRepliesLoading(false);}}
  };
  const openThread = (msg:any) => {threadEpoch.current++;threadRef.current=msg.id;replyLock.current=false;setThread(msg);setReplies([]);setReplyDraft('');setReplyError('');setReplyMore(false);void loadReplies(msg.id);};

  const sendReply = async () => {
    const body = replyDraft.trim();
    const run=scope.current,target=thread?.id;if (!body || !thread || actionLock.current || !valid(run)) return;
    if (!isMember) { join(); return; }
    actionLock.current=true;setReplySending(true);
    try {
      const { data, error } = await deadline(supabase.rpc('reply_channel_message', { p_message: thread.id, p_content: body }));
      if (error) throw error;
      if(!valid(run)||threadRef.current!==target)return;
      setReplies(prev => [...prev, { id: data, content: body, created_at: new Date().toISOString(), user_id: me?.id, user_name: me?.full_name || 'You', user_avatar: me?.avatar_url || null }]);
      setMessages(prev => prev.map(m => m.id === thread.id ? { ...m, reply_count: (m.reply_count || 0) + 1 } : m));
      setReplyDraft('');
    } catch (e: any) { if(valid(run))Alert.alert('Could not reply', e?.message || 'Please try again.'); }
    finally { if(valid(run)){actionLock.current=false;setReplySending(false);} }
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
        {mediaUrls[item.id] && item.media_type !== 'video' ? (
          <ExpoImage source={{ uri: mediaUrls[item.id] }} style={s.msgMedia} contentFit="cover" />
        ) : null}
        {mediaUrls[item.id] && item.media_type === 'video' ? (
          <Video source={{ uri: mediaUrls[item.id] }} style={s.msgMedia} useNativeControls resizeMode={ResizeMode.CONTAIN} />
        ) : null}
        {item.media_url&&!mediaUrls[item.id]?<TouchableOpacity onPress={()=>void signMedia([item],scope.current)}><Text style={s.msgTime}>Attachment unavailable. Tap to retry.</Text></TouchableOpacity>:null}
        {poll ? (
          <View style={s.pollBox}>
            {(poll.options || []).map((o: any) => {
              const total = Math.max(poll.total || 0, 1);
              const pct = Math.round(((o.votes || 0) / total) * 100);
              const on = poll.my_option === o.id;
              return (
                <TouchableOpacity key={o.id} style={s.pollOpt} onPress={() => votePoll(item, o.id)} activeOpacity={pollClosed ? 1 : 0.8} disabled={pollClosed}>
                  <View style={[s.pollFill, { width: `${Math.max(pct, 3)}%` as const }, on && s.pollFillOn]} />
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
        {loadError?<TouchableOpacity onPress={()=>void load()}><Text accessibilityRole="alert" style={s.emptySub}>{loadError} Tap to retry.</Text></TouchableOpacity>:null}
        {loading ? (
          <View style={s.center}><ActivityIndicator color={NAVY} /></View>
        ) : messages.length === 0 ? (
          <View style={s.center}>
            <Feather name="radio" size={38} color="#E5E5EA" />
            <Text style={s.emptyTitle}>No updates yet</Text>
            {canPost ? <Text style={s.emptySub}>Post the first update below.</Text> : <Text style={s.emptySub}>Updates from the channel will appear here.</Text>}
          </View>
        ) : (
          <FlatList onScroll={event => { const latest = event.nativeEvent.contentOffset.y < 64; const becameLatest = latest && !atLatest.current; atLatest.current = latest; if (becameLatest) void markRead(); }} scrollEventThrottle={32} onEndReached={()=>{if(more)void load(true);}} onEndReachedThreshold={0.3} ListFooterComponent={paging?<ActivityIndicator/>:null} data={messages} keyExtractor={m => m.id} renderItem={renderMessage} inverted
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
              <TextInput style={s.composerInput} placeholder={promptMode ? 'Ask your members something' : 'Post an update'} placeholderTextColor="#8E8E93" value={draft} editable={!sending && !attaching} onChangeText={setDraft} multiline maxLength={2000} />
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
              <FlatList ListHeaderComponent={replyError?<TouchableOpacity onPress={()=>void loadReplies(thread.id)}><Text>{replyError} Tap to retry.</Text></TouchableOpacity>:null} ListFooterComponent={replyMore?<TouchableOpacity onPress={()=>void loadReplies(thread.id,true)}><Text>Load more replies</Text></TouchableOpacity>:null} data={replies} keyExtractor={r => r.id}
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

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
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
  msgAvatarTxt: { fontSize: 14, fontWeight: '700', color: t.ink.inverse },
  msgName: { fontSize: 14, fontWeight: '700', color: '#0F1419', flexShrink: 1 },
  roleChip: { backgroundColor: t.surface.hairline, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  roleChipTxt: { fontSize: 10, fontWeight: '700', color: NAVY },
  msgTime: { fontSize: 11.5, color: '#8E8E93', marginTop: 1 },
  msgBody: { fontSize: 15, color: '#1A1A1A', lineHeight: 21, marginTop: 8 },
  msgMedia: { height: 180, borderRadius: 10, marginTop: 8, backgroundColor: '#000' },
  pollBox: { marginTop: 10, gap: 6 },
  pollOpt: { position: 'relative', borderRadius: 10, borderWidth: 1, borderColor: '#E5E5EA', overflow: 'hidden', backgroundColor: t.surface.canvas },
  pollFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: t.surface.hairline },
  pollFillOn: { backgroundColor: 'rgba(11,30,61,0.20)' },
  pollOptRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 11, paddingVertical: 9 },
  pollOptTxt: { fontSize: 13.5, color: '#0F1419', flexShrink: 1, paddingRight: 8 },
  pollPct: { fontSize: 12.5, fontWeight: '700', color: '#5B6B84' },
  pollMeta: { fontSize: 11.5, color: '#8E8E93', marginTop: 2 },
  reactRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 10 },
  reactPill: { flexDirection: 'row', backgroundColor: t.surface.canvas, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: '#E5E5EA' },
  reactPillOn: { borderColor: NAVY, backgroundColor: t.brand.tintBg },
  reactTxt: { fontSize: 12.5, color: '#0F1419' },
  reactAdd: { backgroundColor: t.surface.canvas, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#EFEFEF' },
  replyBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 4 },
  replyBtnTxt: { fontSize: 12.5, fontWeight: '600', color: '#5B6B84' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5EA', backgroundColor: t.surface.canvas },
  composerInput: { flex: 1, backgroundColor: '#F2F2F7', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, fontSize: 15, color: '#0F1419', maxHeight: 110 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  toolBtn: { width: 32, height: 36, alignItems: 'center', justifyContent: 'center' },
  promptBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 8 },
  promptBannerTxt: { fontSize: 12, fontWeight: '600', color: NAVY },
  joinBar: { paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5EA', backgroundColor: t.surface.canvas },
  joinBig: { backgroundColor: NAVY, borderRadius: 14, alignItems: 'center', paddingVertical: 13 },
  joinBigTxt: { fontSize: 15, fontWeight: '700', color: t.ink.inverse },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA' },
  modalTitle: { fontSize: 16.5, fontWeight: '700', color: '#0F1419' },
  threadRoot: { backgroundColor: '#F8F9FB', marginHorizontal: 16, marginTop: 12, borderRadius: 12, padding: 12 },
  threadRootName: { fontSize: 13, fontWeight: '700', color: NAVY },
  threadRootBody: { fontSize: 14, color: '#1A1A1A', marginTop: 4, lineHeight: 20 },
  replyRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  replyAvatar: { width: 32, height: 32, borderRadius: 16 },
  replyAvatarTxt: { fontSize: 13, fontWeight: '700', color: t.ink.inverse },
  replyName: { fontSize: 13.5, fontWeight: '700', color: '#0F1419' },
  replyTime: { fontSize: 11.5, color: '#8E8E93' },
  replyBody: { fontSize: 14.5, color: '#1A1A1A', lineHeight: 20, marginTop: 2 },
  pollInput: { backgroundColor: '#F2F2F7', borderRadius: 12, paddingHorizontal: 13, paddingVertical: 10, fontSize: 15, color: '#0F1419', marginBottom: 10 },
  pollLabel: { fontSize: 12, fontWeight: '700', color: '#8E8E93', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  pollAdd: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingVertical: 4 },
  pollAddTxt: { fontSize: 13.5, fontWeight: '700', color: NAVY },
  dayChip: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: '#E5E5EA', paddingVertical: 10, alignItems: 'center' },
  dayChipOn: { borderColor: NAVY, backgroundColor: t.brand.tintBg },
  dayChipTxt: { fontSize: 13.5, fontWeight: '600', color: '#5B6B84' },
  dayChipTxtOn: { color: NAVY, fontWeight: '700' },
  pollCreate: { backgroundColor: NAVY, borderRadius: 12, alignItems: 'center', paddingVertical: 13, marginTop: 18 },
  pollCreateTxt: { fontSize: 15, fontWeight: '700', color: t.ink.inverse },
}));

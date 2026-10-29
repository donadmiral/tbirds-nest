import { ChatSkeleton } from '../../components/skeletons';
import { useTheme, themedSheet } from '../../theme/useTheme';
import TierName from '../../components/TierName';
import { flagsService } from '../../services/flagsService';
import VerifiedBadge from '../../components/VerifiedBadge';
import SharedPostCard from '../../components/feed/SharedPostCard';
import SendMoneySheet from '../../components/SendMoneySheet';
import { loadConfirmedPaymentReceipt } from '../../services/paymentReceipt';
/**
 * ChatScreen.tsx
 * Unified DM + group chat.
 * Design: Clean Premium — navy sent bubbles, soft tails, instant send.
 *
 * FIXES applied (no other logic changed):
 *  1. markRead calls mark_conversation_read RPC — atomic bulk update, bypasses
 *     any messageStatusService issues.  read_at is set server-side in one call.
 *  2. Read receipts require the active foreground chat at its newest messages.
 *  3. Reaction realtime sub uses a ref so it never captures a stale messages array.
 *  4. Own messages (sender_id === me) never carry a receiver_id that matches me,
 *     so they can never be counted as unread — this is enforced at the DB level by
 *     the RPC (WHERE receiver_id = p_user_id) and at the UI level in ConversationsScreen.
 */
import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, StatusBar, LayoutAnimation, UIManager,
  Animated, Easing, Pressable, Modal, ScrollView, Alert, Linking,
  Image, Dimensions, Share, AppState,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { useNavigation, useRoute, useIsFocused } from '@react-navigation/native';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { messageStatusService } from '../../services/messageStatusService';
import { callService } from '../../services/callService';
import { uploadMedia } from '../../services/mediaService';
import { signChatMedia, signChatMediaMap, isChatMediaUrl, signGroupAvatars } from '../../services/chatMediaService';
import { useVoiceRecorder, formatVoiceDuration, MAX_VOICE_SECONDS } from '../../controllers/messages/useVoiceRecorder';
import VoiceNote from '../../components/VoiceNote';
import { ShareDetailsSheet } from '../../components/messages/ShareDetailsSheet';
import { parseChatAttachmentCard, attachmentCardText, attachmentCardLinks } from '../../../shared/chatAttachmentCards';
import { PrivateMediaViewer } from '../../components/messages/PrivateMediaViewer';
import PaymentBubble, { ChatPayment } from '../../components/PaymentBubble';
import ChatInfoSections from '../../components/ChatInfoSections';
import CallEventBubble from '../../components/CallEventBubble';
import ChatImageEditor from '../../components/ChatImageEditor';
import { useDraftStore } from '../../stores/draftStore';
import { useNetStore, retryOutboxMessage } from '../../stores/netStore';
import 'react-native-get-random-values';
import { deliverMessage, makeMessageId, type MessageIntent } from '../../../shared/messageDelivery';
import { canForwardMessage } from '../../../shared/messageContent';
import { MESSAGE_PAGE_SIZE, olderMessageFilter, mergeMessagePage, type MessageCursor } from '../../../shared/messageHistory';
import { acknowledgeConversationRead, canMarkConversationRead } from '../../../shared/messageReceipts';
import { parseStoryMessageReference } from '../../../shared/storyMessageReference';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) { UIManager.setLayoutAnimationEnabledExperimental(true); }

const SCREEN_W = Dimensions.get('window').width;
const MSG_IMG_MAX_W = Math.min(SCREEN_W * 0.72, 300);
const MSG_IMG_MAX_H = 360;
const MSG_IMG_MIN_H = 140;
const MSG_VID_H = Math.round(MSG_IMG_MAX_W * 0.60);
const REACTION_EMOJIS = ['❤️', '😂', '👍', '😮', '😢', '🔥', '🎯', '🙌'];

const NAVY = '#0B1E3D';
const NAVY_SOFT = '#1A3560';
const BUBBLE_OTHER = '#FFFFFF';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#8E8E93';
const HAIRLINE = '#E5E5EA';

type Reaction = { emoji: string; user_id: string };

type MessageItem = {
  sender_name?: string | null;
  id: string;
  text: string | null;
  sender_id: string | null;
  receiver_id: string | null;
  conversation_id: string | null;
  created_at: string | null;
  read_at?: string | null;
  delivered_at?: string | null;
  viewed_at?: string | null;
  view_limit?: number | null;
  media_url?: string | null;
  media_type?: string | null;
  media_b64?: string | null;
  media_width?: number | null;
  media_height?: number | null;
  thumbnail_url?: string | null;
  reply_to_id?: string | null;
  shared_post_id?: string | null;
  payment_id?: string | null;
  payment_receipt_verified?: boolean;
  _optimistic?: boolean;
  _queued?: boolean;
  _reactions?: Reaction[];
};

type InfoMediaMsg = {
  id: string;
  media_url: string;
  media_type: string;
  thumbnail_url: string | null;
  created_at: string;
  sender_id: string | null;
};

type InfoFileMsg = {
  id: string;
  media_url: string;
  text: string | null;
  created_at: string;
  sender_id: string | null;
};

type InfoStarredMsg = {
  id: string;
  message_id: string;
  starred_at: string;
  starred_by: string;
  msg: {
    id: string;
    text: string | null;
    media_url: string | null;
    media_type: string | null;
    created_at: string;
    sender_id: string;
    sender_name?: string;
  } | null;
};

type OutgoingStatus = { id: string; delivered_at: string | null; viewed_at: string | null; created_at: string | null } | null;
type InfoTab = 'media' | 'files' | 'starred';


// GIF search removed: Google shut down the Tenor API on 30 June 2026 and stopped
// issuing keys in January, so the old integration cannot be revived. Giphy is the
// intended replacement, which needs an account and a key before it can be built.

function MentionText({ text, style, meStyle }: { text: string; style: any; meStyle?: boolean }) {
  const { t } = useTheme();
  const navigation = useNavigation<any>();
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const openMention = async (username: string) => {
    if (pending.current) return;
    const owner = useAuthStore.getState().session?.user.id;
    pending.current = true;
    try {
      const exactHandle = username.replace(/\.$/, '').replace(/[\\%_]/g, '\\$&');
      const { data, error } = await supabase.from('profiles').select('id').ilike('username', exactHandle).maybeSingle();
      if (!alive.current || useAuthStore.getState().session?.user.id !== owner) return;
      if (error || !data) { Alert.alert('Profile unavailable', 'This profile could not be opened.'); return; }
      navigation.navigate('UserProfile', { userId: data.id });
    } catch { if (alive.current && useAuthStore.getState().session?.user.id === owner) Alert.alert('Profile unavailable', 'This profile could not be opened.'); }
    finally { pending.current = false; }
  };
  const parts = String(text).split(/(@[A-Za-z0-9_\.]{2,30})/g);
  return (
    <Text style={style}>
      {parts.map((p, i) => p.startsWith('@')
        ? <Text key={i} accessibilityRole="link" onPress={() => void openMention(p.slice(1))} style={{ fontWeight: '800', color: meStyle ? '#FFFFFF' : t.status.link, textDecorationLine: 'underline' }}>{p}</Text>
        : <Text key={i}>{p}</Text>)}
    </Text>
  );
}
function fmtTime(d?: string | null) {
  if (!d) return '';
  return new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtSep(d?: string | null) {
  if (!d) return '';
  const date = new Date(d), now = new Date();
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const days = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (days < 7) return date.toLocaleDateString([], { weekday: 'long' });
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtShortDate(d?: string | null) {
  if (!d) return '';
  const date = new Date(d), now = new Date();
  if (date.toDateString() === now.toDateString()) return fmtTime(d);
  const days = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (days < 7) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function sameDay(a?: string | null, b?: string | null) {
  return !!a && !!b && new Date(a).toDateString() === new Date(b).toDateString();
}
function initials(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}
function isLink(text?: string | null) {
  return !!text && /https?:\/\//i.test(text);
}

function computeImageDims(origW?: number | null, origH?: number | null) {
  const w = origW && origW > 0 ? origW : MSG_IMG_MAX_W;
  const h = origH && origH > 0 ? origH : Math.round(MSG_IMG_MAX_W * 0.75);
  const ratio = w / h;
  let boxW = MSG_IMG_MAX_W;
  let boxH = Math.round(boxW / ratio);
  if (boxH > MSG_IMG_MAX_H) {
    boxH = MSG_IMG_MAX_H;
    boxW = Math.round(boxH * ratio);
    if (boxW > MSG_IMG_MAX_W) boxW = MSG_IMG_MAX_W;
  }
  if (boxH < MSG_IMG_MIN_H) boxH = MSG_IMG_MIN_H;
  return { w: boxW, h: boxH };
}

function GifPicker({ onSelect, onBack, gifMode = 'gifs' }: { onSelect: (url: string) => void; onBack: () => void; gifMode?: string }) {
  const {t}=useTheme();
  const GIPHY_KEY = process.env.EXPO_PUBLIC_GIPHY_KEY || '';
  const [q, setQ] = useState('');
  const [gifs, setGifs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const gifDebounce = useRef<any>(null);
  const gifRequest = useRef(0);

  const fetchGifs = useCallback(async (query: string) => {
    if (!GIPHY_KEY) return;
    const request = ++gifRequest.current;
    setBusy(true);
    try {
      const url = query.trim()
        ? `https://api.giphy.com/v1/${gifMode}/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(query.trim())}&limit=24&rating=pg-13`
        : `https://api.giphy.com/v1/${gifMode}/trending?api_key=${GIPHY_KEY}&limit=24&rating=pg-13`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('GIF search unavailable');
      const json = await res.json();
      if (request === gifRequest.current) setGifs(Array.isArray(json?.data) ? json.data : []);
    } catch { if (request === gifRequest.current) setGifs([]); }
    finally { if (request === gifRequest.current) setBusy(false); }
  }, [GIPHY_KEY, gifMode]);

  useEffect(() => {
    if (gifDebounce.current) clearTimeout(gifDebounce.current);
    gifDebounce.current = setTimeout(() => fetchGifs(q), 450);
    return () => { ++gifRequest.current; if (gifDebounce.current) clearTimeout(gifDebounce.current); };
  }, [q, fetchGifs]);

  if (!GIPHY_KEY) {
    return (
      <View style={{ paddingHorizontal: 20, paddingVertical: 28, alignItems: 'center', gap: 8 }}>
        <View style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor:t.surface.sunken }}>
          <Feather name="film" size={20} color={t.ink.secondary} />
        </View>
        <Text style={{ fontSize: 15, fontWeight: '700', color: t.ink.primary }}>GIFs unavailable</Text>
        <Text style={{ fontSize: 13, color: t.ink.secondary, textAlign: 'center', lineHeight: 19 }}>
          GIF search is unavailable right now. You can still share photos and videos.
        </Text>
        <TouchableOpacity onPress={onBack} style={{ marginTop: 6, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 999, backgroundColor:t.surface.sunken }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: t.ink.primary }}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const half = Math.floor((SCREEN_W - 14 * 2 - 8) / 2);
  return (
    <View style={{ flex: 1, paddingTop: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginBottom: 8, backgroundColor:t.surface.sunken, borderRadius: 18, paddingHorizontal: 12 }}>
        <Feather name="search" size={15} color={t.ink.secondary} />
        <TextInput
          style={{ flex: 1, fontSize: 14.5, color: t.ink.primary, paddingVertical: 9 }}
          value={q} onChangeText={setQ}
          placeholder="Search GIPHY"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
        />
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="x" size={17} color={t.ink.secondary} />
        </TouchableOpacity>
      </View>
      {busy && gifs.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#0B1E3D" /></View>
      ) : (
        <FlatList
          data={gifs}
          keyExtractor={(g: any) => g.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 8, paddingHorizontal: 14 }}
          contentContainerStyle={{ gap: 8, paddingBottom: 14 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }: any) => {
            const fw = item?.images?.fixed_width;
            const full = item?.images?.original?.url || fw?.url;
            const h = fw?.width && fw?.height ? Math.round(half * (Number(fw.height) / Number(fw.width))) : half;
            if (!fw?.url || !full) return null;
            return (
              <TouchableOpacity activeOpacity={0.85} onPress={() => onSelect(full)}>
                <ExpoImage source={{ uri: fw.url }} style={{ width: half, height: Math.min(h, 220), borderRadius: 10, backgroundColor: '#E5E5EA' }} contentFit="cover" />
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={<Text style={{ textAlign: 'center', color: t.ink.secondary, fontSize: 13, marginTop: 30 }}>No GIFs found</Text>}
        />
      )}
    </View>
  );
}
function SmartImage({ uri, b64, width, height, radius, contentFit }: { uri: string; b64?: string | null; width: number; height: number; radius: number; contentFit?: any }) {
  const mime = (() => {
    const ext = uri.split('.').pop()?.toLowerCase().split('?')[0] ?? '';
    return ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
  })();
  if (b64) {
    return <ExpoImage source={{ uri: `data:${mime};base64,${b64}` }} style={{ width, height, borderRadius: radius }} contentFit={contentFit ?? 'cover'} />;
  }
  if (!uri || !uri.startsWith('http')) {
    return (
      <View style={{ width, height, borderRadius: radius, backgroundColor: '#E5E5EA', alignItems: 'center', justifyContent: 'center' }}>
        <Feather name="image" size={28} color="#8E8E93" />
      </View>
    );
  }
  return (
    <ExpoImage
      source={{ uri }}
      style={{ width, height, borderRadius: radius, backgroundColor: '#F0F0F0' }}
      contentFit={contentFit ?? 'cover'}
      cachePolicy="memory-disk"
      transition={150}
      onError={() => console.log('[IMG_ERR]', uri)}
    />
  );
}

function AutoSizeImage({ uri, b64, onPress, onLongPress, onDims }: {
  uri: string; b64?: string | null;
  onPress?: () => void; onLongPress?: () => void;
  onDims?: (w: number, h: number) => void;
}) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!uri) return;
    if (uri.startsWith('http')) {
      Image.getSize(uri,
        (w, h) => { if (!cancelled) { const d = computeImageDims(w, h); setDims(d); onDims?.(w, h); } },
        () => { if (!cancelled) setDims(computeImageDims(MSG_IMG_MAX_W, Math.round(MSG_IMG_MAX_W * 0.75))); }
      );
    } else {
      setDims(computeImageDims(MSG_IMG_MAX_W, Math.round(MSG_IMG_MAX_W * 0.75)));
    }
    return () => { cancelled = true; };
  }, [uri]);

  const { w, h } = dims || computeImageDims(MSG_IMG_MAX_W, Math.round(MSG_IMG_MAX_W * 0.75));

  const content = <SmartImage uri={uri} b64={b64} width={w} height={h} radius={18} />;

  if (onPress || onLongPress) {
    return (
      <TouchableOpacity activeOpacity={0.9} onPress={onPress} onLongPress={onLongPress}>
        {content}
      </TouchableOpacity>
    );
  }
  return content;
}

function VideoPlayer({ uri, width, height, fullscreen }: { uri: string; width: number; height: number; fullscreen?: boolean }) {
  const [error, setError] = useState(false);
  if (error) {
    return (
      <View style={{ width, height, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#FFF', fontSize: 12 }}>Could not play video</Text>
      </View>
    );
  }
  try {
    const { Video, ResizeMode } = require('expo-av');
    return (
      <Video source={{ uri }} style={fullscreen ? { width, height: undefined, flex: 1 } : { width, height }}
        useNativeControls resizeMode={ResizeMode.CONTAIN} shouldPlay={fullscreen} onError={() => setError(true)} />
    );
  } catch {
    return (
      <View style={{ width, height, backgroundColor: '#1C1C1E', alignItems: 'center', justifyContent: 'center' }}>
        <TouchableOpacity onPress={() => Linking.openURL(uri)}>
          <Text style={{ color: '#FFF', fontSize: 13, fontWeight: '600' }}>▶ Open in browser</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

export default function ChatScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const atLatestRef = useRef(true);
  const historyLoadedRef = useRef(false);
  const readPending = useRef(new Set<string>());
  const readRequested = useRef(new Set<string>());
  const lastRead = useRef('');
  const insets = useSafeAreaInsets();
  const { profile, session } = useAuthStore();
  const outbox = useNetStore(state => state.outbox);
  const confirmedOutbox = useNetStore(state => state.confirmed);

  const actAsId: string | null = route.params?.actAsId ?? null;  const currentUserId = actAsId ?? profile?.id ?? null;
  const [conversationId, setConversationId] = useState<string | null>(route.params?.conversationId ?? null);
  const paymentChatRef = useRef('');
  paymentChatRef.current = [currentUserId, conversationId].join(':');
  const passedUser = route.params?.otherUser ?? null;
  const passedUserId: string | null = route.params?.userId ?? null;
  // The conversation row fills in whatever the params left out (a notification or the community's Chat button pass only the id).
  const [convMeta, setConvMeta] = useState<any>(null);
  useEffect(() => {
    let current = true;
    setConvMeta(null);
    if (!conversationId || !currentUserId) return;
    supabase.from('conversations').select('is_group, group_name, group_emoji, group_avatar_url, group_type, group_ref_id').eq('id', conversationId).maybeSingle().then(async ({ data }) => {
      if (data) { const [signed] = await signGroupAvatars([data]); if (current) setConvMeta(signed); }
    }, () => {});
    return () => { current = false; };
  }, [conversationId, currentUserId]);
  const isGroup: boolean = route.params?.isGroup ?? !!convMeta?.is_group;
  const groupName: string = route.params?.groupName ?? (convMeta?.group_name || '');
  const groupEmoji: string = route.params?.groupEmoji ?? (convMeta?.group_emoji || '');
  const groupAvatarUrl: string | null = convMeta?.group_avatar_url || (!isChatMediaUrl(route.params?.groupAvatarUrl) ? route.params?.groupAvatarUrl : null) || null;
  // A community's chat: the community is its home, so the header says so and the info sheet opens it.
  const groupType: string | null = route.params?.groupType ?? (convMeta?.group_type || null);
  const groupRefId: string | null = route.params?.groupRefId ?? (convMeta?.group_ref_id || null);
  const isCommunityChat = isGroup && groupType === 'community' && !!groupRefId;
  const openCommunity = () => { if (groupRefId) navigation.navigate('Community', { communityId: groupRefId, name: groupName, iconUrl: groupAvatarUrl, isMember: true }); };

  const [otherUser, setOtherUser] = useState<any>(passedUser);


  useEffect(() => {
    if (otherUser) return;
    const uid = passedUserId;
    if (!uid) return;
    supabase.from('profiles').select('id, full_name, username, avatar_url, bio, location, degree_program, graduation_year, email, is_verified, verified_tier')
      .eq('id', uid).single()
      .then(({ data }) => { if (data) setOtherUser(data); });
  }, [passedUserId]);

  useEffect(() => {
    if (conversationId || isGroup || !currentUserId || !passedUserId) return;
    const a = [currentUserId, passedUserId].sort();
    supabase.from('conversations')
      .select('id')
      .eq('type', 'direct')
      .or('context.is.null,context.eq.personal')
      .or(`and(user_1.eq.${a[0]},user_2.eq.${a[1]}),and(user_1.eq.${a[1]},user_2.eq.${a[0]})`)
      .maybeSingle()
      .then(({ data }) => { if (data?.id) setConversationId(data.id); });
  }, [conversationId, isGroup, currentUserId, passedUserId]);

  const [message, setMessage] = useState('');
  const draftSeededRef = useRef(false);
  useEffect(() => {
    if (draftSeededRef.current || !conversationId) return;
    draftSeededRef.current = true;
    const saved = useDraftStore.getState().drafts[conversationId];
    if (saved) setMessage(saved);
  }, [conversationId]);
  const { t } = useTheme();
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const historyCursor = useRef<MessageCursor | null>(null);
  const historyRequest = useRef(0);
  const olderPending = useRef(false);
  const activeConversation = useRef(conversationId);
  activeConversation.current = conversationId;
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const confirmationScope = `${session?.user.id || ''}:${conversationId || ''}`;
  const confirmationBaseline = useRef({ scope: confirmationScope, seen: new Set(confirmedOutbox.map(receipt => receipt.message.id)) });
  if (confirmationBaseline.current.scope !== confirmationScope) {
    confirmationBaseline.current = { scope: confirmationScope, seen: new Set(confirmedOutbox.map(receipt => receipt.message.id)) };
  }
  const waitingMessages = outbox.filter(item => item.conversation_id === conversationId && item.sender_id === currentUserId
    && (item.owner_auth_id === session?.user.id || !item.owner_auth_id)
    && (item.failed || !messages.some(message => message.id === item.id)));
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const textSendPending = useRef(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const [typingUserId, setTypingUserId] = useState<string | null>(null);
  const [seenByNames, setSeenByNames] = useState<string[]>([]);
  const [memberReads, setMemberReads] = useState<any[]>([]);
  useEffect(() => {
    if (!isGroup || !conversationId || !currentUserId) { setMemberReads([]); return; }
    let live = true;
    const pull = async () => {
      try {
        const { data } = await supabase.from('conversation_members')
          .select('user_id, last_read_at')
          .eq('conversation_id', conversationId)
          .neq('user_id', currentUserId);
        if (live && data) setMemberReads(data);
      } catch {}
    };
    pull();
    const iv = setInterval(pull, 6000);
    return () => { live = false; clearInterval(iv); };
  }, [isGroup, conversationId, currentUserId]);
  const [seenSheet, setSeenSheet] = useState<{ msg: any; rows: { name: string; avatar: string | null; seenAt: string | null }[] } | null>(null);
  const [lastStatus, setLastStatus] = useState<OutgoingStatus>(null);

  const [shareDetails, setShareDetails] = useState<'contact'|'location'|null>(null);
  const [showToolbar, setShowToolbar] = useState(false);
  const [showGifs, setShowGifs] = useState(false);
  const [editingMsg, setEditingMsg] = useState<MessageItem | null>(null);
  const [editText, setEditText] = useState('');
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [groupMembers, setGroupMembers] = useState<any[]>([]);
  const [infoMuted, setInfoMuted] = useState(false);

  const [infoTab, setInfoTab] = useState<InfoTab>('media');
  const [infoMedia, setInfoMedia] = useState<InfoMediaMsg[]>([]);
  const [infoFiles, setInfoFiles] = useState<InfoFileMsg[]>([]);
  const [infoStarred, setInfoStarred] = useState<InfoStarredMsg[]>([]);
  const [infoLoading, setInfoLoading] = useState(false);

  const [selectedMsg, setSelectedMsg] = useState<MessageItem | null>(null);
  const [replyTo, setReplyTo] = useState<MessageItem | null>(null);
  const [forwardMsg, setForwardMsg] = useState<MessageItem | null>(null);
  const [showForwardPicker, setShowForwardPicker] = useState(false);
  const [forwardConvs, setForwardConvs] = useState<any[]>([]);
  const [fullscreenImg, setFullscreenImg] = useState<string | null>(null);
  const [capturedVideo, setCapturedVideo] = useState<{ uri: string; type: 'video'; width?: number; height?: number } | null>(null);
  const mediaSending = useRef(false);
  const mediaOperation = useRef(0);
  const reactionPending = useRef(new Set<string>());
  const editPending = useRef(false);
  const pinPending = useRef(false);
  const forwardPending = useRef(false);
  const [fullscreenVideo, setFullscreenVideo] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [savingToDevice, setSavingToDevice] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTimestamp, setShowTimestamp] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [viewedOutIds, setViewedOutIds] = useState<Set<string>>(new Set());
  const [privateMedia, setPrivateMedia] = useState<{ id: string; userId: string; scope: string } | null>(null);
  useEffect(() => { setPrivateMedia(null); setShareDetails(null); setViewedOutIds(new Set()); setFullscreenImg(null); setFullscreenVideo(null); }, [conversationId, session?.user.id]);
  const sendScale = useRef(new Animated.Value(1)).current;
  const springSend = useCallback(() => {
    sendScale.setValue(0.82);
    Animated.spring(sendScale, { toValue: 1, friction: 4, tension: 220, useNativeDriver: true }).start();
  }, [sendScale]);
  const [editTarget, setEditTarget] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [liveGroupCall, setLiveGroupCall] = useState<{ id: string; is_video: boolean; joinedNames: string[] } | null>(null);
  const startingCallRef = useRef(false);
  const voice = useVoiceRecorder();
  const [sendingVoice, setSendingVoice] = useState(false);
  const voiceSending = useRef(false);
  const voiceScope = `${session?.user.id || ''}:${currentUserId || ''}:${conversationId || passedUserId || ''}`;
  const voiceScopeRef = useRef(voiceScope); voiceScopeRef.current = voiceScope;
  const attachmentScope = `${session?.user.id || ''}:${currentUserId || ''}:${route.params?.conversationId || passedUserId || conversationId || ''}`;
  const attachmentScopeRef = useRef(attachmentScope); attachmentScopeRef.current = attachmentScope;
  const accountScope = `${session?.user.id || ''}:${currentUserId || ''}`;
  const accountScopeValue = useRef(accountScope), accountScopeRef = useRef(0);
  if (accountScopeValue.current !== accountScope) { accountScopeValue.current = accountScope; accountScopeRef.current++; }
  useEffect(() => {
    ++mediaOperation.current; mediaSending.current = false; setUploadingMedia(false);
    setEditTarget(null); setCapturedVideo(null); setSelectedMsg(null); setReplyTo(null); setForwardMsg(null); setShowForwardPicker(false);
    setShowInfoModal(false); setInfoMedia([]); setInfoFiles([]); setInfoStarred([]); setOtherTyping(false); setTypingUserId(null);
    setSharedPostsMap({}); setSavedIds(new Set()); setStarredIds(new Set()); setPinnedMsg(null);
    lastTypingRef.current = false; typingSentAt.current = 0;
  }, [attachmentScope]);
  const voiceControl = useRef(voice); voiceControl.current = voice;
  useEffect(() => {
    setSendingVoice(false);
    return () => { voiceSending.current = false; void voiceControl.current.cancel(); };
  }, [voiceScope]);
  const [otherOnline, setOtherOnline] = useState(false);

  const mountedRef = useRef(true);
  const flatListRef = useRef<FlatList<any>>(null);

  // Pinned context for Market / Jobs threads
  const [ctxCard, setCtxCard] = useState<{ kind: 'market' | 'jobs'; title: string; sub: string; image: string | null; refId: string; price?: number | null; currency?: string | null } | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!conversationId) { setCtxCard(null); return; }
      try {
        const { data: conv } = await supabase.from('conversations').select('context, context_ref_id').eq('id', conversationId).maybeSingle();
        const ctx = (conv as any)?.context;
        const refId = (conv as any)?.context_ref_id;
        if (!ctx || ctx === 'personal' || !refId) { if (!cancelled) setCtxCard(null); return; }
        if (ctx === 'market') {
          const { data } = await supabase.from('marketplace_listings').select('*').eq('id', refId).maybeSingle();
          if (!data || cancelled) return;
          const d: any = data;
          const img = Array.isArray(d.images) && d.images.length ? d.images[0] : (d.image_url || null);
          const price = d.price != null ? ((d.currency || 'USD') + ' ' + d.price) : '';
          setCtxCard({ kind: 'market', title: d.title || 'Listing', sub: [price, d.status].filter(Boolean).join('  ·  '), image: img, refId: d.id, price: d.price != null ? Number(d.price) : null, currency: d.currency || 'USD' });
        } else if (ctx === 'jobs') {
          const { data } = await supabase.from('jobs').select('id, title, company, location').eq('id', refId).maybeSingle();
          if (!data || cancelled) return;
          const d: any = data;
          setCtxCard({ kind: 'jobs', title: d.title || 'Role', sub: [d.company, d.location].filter(Boolean).join('  ·  '), image: null, refId: d.id });
        }
      } catch (e) { console.log('[ChatContext]', e); }
    })();
    return () => { cancelled = true; };
  }, [conversationId]);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingRef = useRef(false);
  const typingSentAt = useRef(0);
  const inputRef = useRef<TextInput>(null);
  const [pinnedMsg, setPinnedMsg] = useState<any | null>(null);
  useEffect(() => {
    if (!conversationId) { setPinnedMsg(null); return; }
    let live = true;
    (async () => {
      try {
        const { data: c } = await supabase.from('conversations').select('pinned_message_id').eq('id', conversationId).maybeSingle();
        if (!c?.pinned_message_id) { if (live) setPinnedMsg(null); return; }
        const { data: m } = await supabase.from('messages').select('id, text, media_url, sender_id').eq('id', c.pinned_message_id).maybeSingle();
        if (live) setPinnedMsg(m ?? null);
      } catch {}
    })();
    return () => { live = false; };
  }, [conversationId, accountScope]);
  const togglePin = useCallback(async (msg: any) => {
    if (!conversationId || pinPending.current) return;
    pinPending.current = true;
    const unpin = pinnedMsg?.id === msg.id;
    try {
      const { error } = await supabase.rpc('set_pinned_message', { p_conversation_id: conversationId, p_message_id: unpin ? null : msg.id });
      if (error) throw error;
      if (activeConversation.current === conversationId) setPinnedMsg(unpin ? null : { id: msg.id, text: msg.text, media_url: msg.media_url, sender_id: msg.sender_id });
    } catch { Alert.alert('Pin not saved', 'Please try again. Your conversation role may not allow this action.'); }
    finally { pinPending.current = false; }
  }, [conversationId, pinnedMsg]);
  const [savedReplies, setSavedReplies] = useState<any[]>([]);
  const isBizSession = (useAuthStore.getState().profile as any)?.account_type === 'business' || !!actAsId;
  useEffect(() => {
    if (!isBizSession || !currentUserId) return;
    supabase.from('business_saved_replies').select('*').eq('user_id', currentUserId).order('created_at').then(({ data }) => setSavedReplies(data ?? []));
  }, [isBizSession, currentUserId]);
  const messagesRef = useRef<MessageItem[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;
  const typingOpacity = useRef(new Animated.Value(0)).current;
  const toolbarH = useRef(new Animated.Value(0)).current;

  const chatTitle = useMemo(() => {
    return isGroup ? groupName || 'Group' : (otherUser?.full_name?.trim() || 'Chat');
  }, [otherUser, isGroup, groupName]);
  const otherInits = useMemo(() => initials(otherUser?.full_name), [otherUser]);

  useEffect(() => {
    if (otherTyping) {
      Animated.timing(typingOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      const b = (v: Animated.Value, delay: number) => Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: -4, duration: 260, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 260, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.delay(280),
      ]));
      const a1 = b(dot1, 0), a2 = b(dot2, 130), a3 = b(dot3, 260);
      a1.start(); a2.start(); a3.start();
      return () => { a1.stop(); a2.stop(); a3.stop(); };
    } else {
      Animated.timing(typingOpacity, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    }
  }, [otherTyping]);

  useEffect(() => {
    Animated.timing(toolbarH, { toValue: showToolbar ? 1 : 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [showToolbar]);

  const sortDesc = useCallback((rows: MessageItem[]) =>
    [...rows].sort((a, b) =>
      (b.created_at ? new Date(b.created_at).getTime() : 0) -
      (a.created_at ? new Date(a.created_at).getTime() : 0)
    ), []);

  const mergeMsg = useCallback(async (incoming: MessageItem) => {
    const scope = accountScopeRef.current;
    if (isChatMediaUrl(incoming.media_url)) incoming = (await signChatMedia([incoming]))[0];
    if (!mountedRef.current || scope !== accountScopeRef.current || incoming.conversation_id !== activeConversation.current) return;
    LayoutAnimation.configureNext(LayoutAnimation.create(180, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
    setMessages(prev => {
      const ei = prev.findIndex(m => m.id === incoming.id);
      if (ei !== -1) {
        const c = [...prev];
        c[ei] = { ...incoming, media_b64: c[ei].media_b64 ?? incoming.media_b64, _optimistic: false };
        return c;
      }
      return mergeMessagePage(prev, [incoming]);
    });
  }, []);

  useEffect(() => {
    // Background reconciliation can confirm a row even if realtime was missed.
    // Feed that receipt back into the open chat without reloading its history.
    for (const receipt of confirmedOutbox) {
      if (confirmationBaseline.current.seen.has(receipt.message.id)) continue;
      if (receipt.owner_auth_id !== session?.user.id || receipt.message.conversation_id !== conversationId) continue;
      confirmationBaseline.current.seen.add(receipt.message.id);
      const shown = messagesRef.current.find(message => message.id === receipt.message.id);
      if (!shown || shown._optimistic) void mergeMsg(receipt.message as MessageItem);
    }
  }, [confirmedOutbox, session?.user.id, conversationId, mergeMsg]);

  const loadSavedIds = useCallback(async () => {
    const scope = attachmentScopeRef.current;
    if (!currentUserId || !conversationId) return;
    const { data } = await supabase.from('saved_messages').select('message_id').eq('user_id', currentUserId);
    if(scope !== attachmentScopeRef.current || !mountedRef.current) return;
    setSavedIds(new Set((data || []).map((r: any) => r.message_id)));
  }, [currentUserId, conversationId]);

  const loadStarredIds = useCallback(async () => {
    const scope = attachmentScopeRef.current;
    if (!currentUserId || !conversationId) return;
    const { data } = await supabase.from('starred_messages')
      .select('message_id').eq('conversation_id', conversationId).eq('starred_by', currentUserId);
    if(scope !== attachmentScopeRef.current || !mountedRef.current) return;
    setStarredIds(new Set((data || []).map((r: any) => r.message_id)));
  }, [currentUserId, conversationId]);

  const refreshStatus = useCallback(async () => {
    const scope = attachmentScopeRef.current;
    if (!conversationId || !currentUserId) return;
    try {
      const s = await messageStatusService.getLastOutgoingMessageStatus(conversationId, currentUserId);
      if (mountedRef.current && scope === attachmentScopeRef.current) setLastStatus(s ?? null);
    } catch {}
  }, [conversationId, currentUserId]);

  const readObscured = useRef(false);
  readObscured.current = showInfoModal || showGifs || !!privateMedia || !!searchQuery.trim();
  const markRead = useCallback(async () => {
    if (!conversationId || !currentUserId) return;
    const scope = accountScopeRef.current;
    const key = `${scope}:${currentUserId}:${conversationId}`;
    const current = () => mountedRef.current && scope === accountScopeRef.current && activeConversation.current === conversationId;
    const visible = () => current() && !readObscured.current && canMarkConversationRead({
      focused: focusedRef.current, foreground: AppState.currentState === 'active',
      atLatest: atLatestRef.current, loaded: historyLoadedRef.current,
    });
    if (!visible()) return;
    readRequested.current.add(key);
    if (readPending.current.has(key)) return;
    readPending.current.add(key);
    try {
      while (readRequested.current.delete(key) && visible()) {
        const newest = messagesRef.current.find(row => !row._optimistic)?.id || '';
        const receipt = `${key}:${newest}`;
        if (lastRead.current === receipt) break;
        await acknowledgeConversationRead(supabase, { conversationId, userId: currentUserId, isGroup });
        if (current()) { lastRead.current = receipt; await refreshStatus(); }
      }
    } catch { /* Keep the unread state. Focus/scroll/reconnect can retry. */ }
    finally { readPending.current.delete(key); }
  }, [conversationId, currentUserId, isGroup, refreshStatus]);

  useEffect(() => {
    if (focused) void markRead();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void markRead(); });
    return () => subscription.remove();
  }, [focused, markRead, showInfoModal, showGifs, privateMedia, searchQuery]);

  const loadReactions = useCallback(async (msgIds: string[]) => {
    if (!msgIds.length) return;
    const convId = activeConversation.current, scope = accountScopeRef.current;
    const { data } = await supabase.from('message_reactions').select('message_id, emoji, user_id').in('message_id', msgIds);
    if (!data || !mountedRef.current || scope !== accountScopeRef.current || activeConversation.current !== convId) return;
    const byMsg: Record<string, Reaction[]> = {};
    data.forEach((r: any) => { if (!byMsg[r.message_id]) byMsg[r.message_id] = []; byMsg[r.message_id].push({ emoji: r.emoji, user_id: r.user_id }); });
    setMessages(prev => prev.map(m => msgIds.includes(m.id) ? { ...m, _reactions: byMsg[m.id] || [] } : m));
  }, []);

  const getOrCreateConversation = useCallback(async (): Promise<string | null> => {
    if (conversationId) return conversationId;
    if (!currentUserId || !passedUserId) return null;
    const a = [currentUserId, passedUserId].sort();
    const { data: existing } = await supabase.from('conversations').select('id').eq('type', 'direct')
      .or(`and(user_1.eq.${a[0]},user_2.eq.${a[1]}),and(user_1.eq.${a[1]},user_2.eq.${a[0]})`)
      .or('context.is.null,context.eq.personal')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existing?.id) { setConversationId(existing.id); return existing.id; }
    const { data: created, error } = await supabase.from('conversations').insert({
      user_1: currentUserId, user_2: passedUserId, type: 'direct', is_group: false, context: 'personal',
      last_message: '', last_message_time: new Date().toISOString(),
    }).select('id').single();
    if (error) { console.log('[CREATE_CONV_ERR]', error.message); return null; }
    setConversationId(created.id);
    return created.id;
  }, [conversationId, currentUserId, passedUserId]);

  useEffect(() => { if (isGroup && conversationId) loadGroupMembers(); }, [isGroup, conversationId]);
  const loadGroupMembers = useCallback(async () => {
    const scope = attachmentScopeRef.current;
    if (!isGroup || !conversationId) return;
    try {
      const { data } = await supabase.from('conversation_members')
        .select('user_id, role, profile:profiles!user_id(id, full_name, username, avatar_url)')
        .eq('conversation_id', conversationId);
      if(scope === attachmentScopeRef.current && mountedRef.current) setGroupMembers(data || []);
    } catch (e) { console.log('[GROUP_MEMBERS_ERR]', e); }
  }, [isGroup, conversationId]);

  const loadInfoContent = useCallback(async () => {
    const scope = attachmentScopeRef.current;
    const current = () => mountedRef.current && attachmentScopeRef.current === scope;
    if (!conversationId) {
      setInfoMedia([]); setInfoFiles([]); setInfoStarred([]);
      return;
    }
    setInfoLoading(true);
    try {
      const [mediaRes, filesRes, starredRes] = await Promise.all([
        supabase.from('messages')
          .select('id, media_url, media_type, thumbnail_url, created_at, sender_id')
          .eq('conversation_id', conversationId)
          .not('media_url', 'is', null)
          .in('media_type', ['image', 'video', 'gif'])
          .is('view_limit', null)
          .order('created_at', { ascending: false })
          .limit(200),
        supabase.from('messages')
          .select('id, media_url, text, created_at, sender_id')
          .eq('conversation_id', conversationId)
          .eq('media_type', 'document')
          .is('view_limit', null)
          .not('media_url', 'is', null)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase.from('starred_messages')
          .select('id, message_id, starred_at, starred_by, msg:messages!message_id(id, text, media_url, media_type, view_limit, created_at, sender_id)')
          .eq('conversation_id', conversationId)
          .order('starred_at', { ascending: false })
          .limit(100),
      ]);

      if(mediaRes.error || filesRes.error || starredRes.error) throw Error('Chat details unavailable');
      const [mediaRows, fileRows] = await Promise.all([signChatMedia((mediaRes.data || []) as InfoMediaMsg[]), signChatMedia((filesRes.data || []) as InfoFileMsg[])]);

      const starredRows = (starredRes.data || []) as any[];
      const infoSigned = await signChatMediaMap(starredRows.map((r: any) => r.msg).filter(Boolean));
      starredRows.forEach((r: any) => { if (r.msg && isChatMediaUrl(r.msg.media_url)) r.msg.media_url = infoSigned[r.msg.id] || null; });
      const senderIds = Array.from(new Set(starredRows.map((r: any) => r.msg?.sender_id).filter(Boolean)));
      let nameMap: Record<string, string> = {};
      if (senderIds.length > 0) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', senderIds);
        (profs || []).forEach((p: any) => { nameMap[p.id] = p.full_name || 'Member'; });
      }
      if(!current()) return;
      setInfoMedia(mediaRows); setInfoFiles(fileRows);
      setInfoStarred(starredRows.map((r: any) => ({
        id: r.id, message_id: r.message_id, starred_at: r.starred_at, starred_by: r.starred_by,
        msg: r.msg ? { ...r.msg, sender_name: nameMap[r.msg.sender_id] || 'Member' } : null,
      })));
    } catch (e) {
      if(current()) { setInfoMedia([]); setInfoFiles([]); setInfoStarred([]); Alert.alert('Chat details unavailable','Please reopen this panel to retry.'); }
    } finally {
      if(current()) setInfoLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (showInfoModal && conversationId) {
      loadInfoContent();
      if (isGroup) loadGroupMembers();
    }
  }, [showInfoModal, conversationId, isGroup, loadInfoContent, loadGroupMembers]);

  const unstarFromInfo = async (starredId: string, messageId: string) => {
    setInfoStarred(prev => prev.filter(s => s.id !== starredId));
    setStarredIds(prev => { const n = new Set(prev); n.delete(messageId); return n; });
    const { error } = await supabase.from('starred_messages').delete().eq('id', starredId);
    if (error) {
      loadInfoContent();
      loadStarredIds();
    }
  };

  const fetchMessages = useCallback(async () => {
    const scope = accountScopeRef.current;
    const convId = conversationId;
    const request = ++historyRequest.current;
    if (!convId) { setMessages([]); setLoading(false); return; }
    const current = () => mountedRef.current && scope === accountScopeRef.current && activeConversation.current === convId && historyRequest.current === request;
    historyLoadedRef.current = false;
    setHistoryError(null);
    setLoading(true);
    try {
      const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', convId)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(MESSAGE_PAGE_SIZE);
      if (error) throw error;
      const rows = (data || []) as MessageItem[];
      const msgs = await signChatMedia(rows);
      if (!current()) return;
      const confirmedIds = new Set(msgs.map(message => message.id));
      historyCursor.current = rows[rows.length - 1] || null;
      setHasOlder(rows.length === MESSAGE_PAGE_SIZE);
      setMessages(prev => mergeMessagePage(msgs, prev.filter(m => m.conversation_id === convId && (!m._optimistic || !confirmedIds.has(m.id)))));
      historyLoadedRef.current = true;
      await loadReactions(msgs.map(m => m.id));
      await Promise.all([refreshStatus(), loadStarredIds(), loadSavedIds()]);
    } catch {
      if (current()) setHistoryError('Messages could not be loaded. Please try again.');
    } finally { if (current()) setLoading(false); }
  }, [conversationId, refreshStatus, loadReactions, loadStarredIds, loadSavedIds]);

  useEffect(() => { if (!loading) void markRead(); }, [loading, messages, markRead]);

  const loadOlderMessages = useCallback(async () => {
    const scope = accountScopeRef.current;
    const convId = conversationId;
    const cursor = historyCursor.current;
    if (!convId || !cursor || !hasOlder || olderPending.current || loading) return;
    const request = historyRequest.current;
    const current = () => mountedRef.current && scope === accountScopeRef.current && activeConversation.current === convId && historyRequest.current === request;
    olderPending.current = true;
    setLoadingOlder(true); setHistoryError(null);
    try {
      const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', convId)
        .or(olderMessageFilter(cursor)).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(MESSAGE_PAGE_SIZE);
      if (error) throw error;
      const rows = (data || []) as MessageItem[];
      const signed = await signChatMedia(rows);
      if (!current()) return;
      if (rows.length) historyCursor.current = rows[rows.length - 1];
      setHasOlder(rows.length === MESSAGE_PAGE_SIZE);
      setMessages(prev => mergeMessagePage(signed, prev));
      await loadReactions(rows.map(m => m.id));
    } catch {
      if (current()) setHistoryError('Older messages could not be loaded. Please try again.');
    } finally {
      if (current()) { olderPending.current = false; setLoadingOlder(false); }
    }
  }, [conversationId, hasOlder, loading, loadReactions]);

  const fetchTyping = useCallback(async () => {
    const scope = accountScopeRef.current;
    if (!conversationId || !currentUserId) return;
    try {
      const { data } = await supabase.from('conversation_typing').select('*').eq('conversation_id', conversationId);
      if (scope !== accountScopeRef.current || activeConversation.current !== conversationId || !mountedRef.current) return;
      const freshTypers = (data || []).filter((r: any) => r.user_id !== currentUserId && r.is_typing && (Date.now() - new Date(r.updated_at).getTime() >= 0 && Date.now() - new Date(r.updated_at).getTime() < 7000));
      setTypingUserId(freshTypers[0]?.user_id ?? null);
      setOtherTyping(freshTypers.length > 0);
    } catch {}
  }, [conversationId, currentUserId]);

  const setTyping = useCallback(async (isTyping: boolean) => {
    if (!conversationId || !currentUserId) return;
    const now = Date.now();
    if (lastTypingRef.current === isTyping && (!isTyping || now - typingSentAt.current < 2000)) return;
    lastTypingRef.current = isTyping; typingSentAt.current = now;
    try { await supabase.from('conversation_typing').upsert({ conversation_id: conversationId, user_id: currentUserId, is_typing: isTyping, updated_at: new Date().toISOString() }, { onConflict: 'conversation_id,user_id' }); } catch {}
  }, [conversationId, currentUserId]);

  useEffect(() => {
    setOtherOnline(false);
    if (isGroup || !otherUser?.id) return;
    let live = true;
    let presence: { is_online?: boolean; last_seen?: string | null } | null = null;
    const refresh = () => {
      if (!live) return;
      const age = presence?.last_seen ? Date.now() - Date.parse(presence.last_seen) : Infinity;
      setOtherOnline(!!presence?.is_online && age >= 0 && age < 120000);
    };
    void supabase.from('user_presence').select('is_online, last_seen').eq('user_id', otherUser.id).maybeSingle()
      .then(({ data }) => { if (live) { presence = data; refresh(); } });
    const channel = supabase.channel(`presence_${otherUser.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence', filter: `user_id=eq.${otherUser.id}` },
        payload => { presence = payload.new; refresh(); }).subscribe();
    const timer = setInterval(refresh, 5000);
    return () => { live = false; clearInterval(timer); void supabase.removeChannel(channel); };
  }, [isGroup, otherUser?.id, accountScope]);

  useEffect(() => {
    mountedRef.current = true;
    historyLoadedRef.current = false; atLatestRef.current = true; lastRead.current = '';
    setMessages([]); historyCursor.current = null; setHasOlder(false); setLoadingOlder(false); olderPending.current = false;
    fetchMessages();
    fetchTyping();
    if (!conversationId) return () => { mountedRef.current = false; };

    const msgCh = supabase
      .channel(`messages_${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        async (p) => {
          await mergeMsg(p.new as MessageItem);
          if ((p.new as any).receiver_id === currentUserId || (isGroup && (p.new as any).sender_id !== currentUserId)) {
            await markRead();
          }
          await refreshStatus();
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        async (p) => {
          mergeMsg(p.new as MessageItem);
          await refreshStatus();
        }
      )
      .subscribe();

    const typeCh = supabase
      .channel(`typing_${conversationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversation_typing', filter: `conversation_id=eq.${conversationId}` },
        () => fetchTyping()
      )
      .subscribe();

    const typePoll = setInterval(fetchTyping, 3000);

    const reactCh = supabase
      .channel(`reactions_${conversationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_reactions' },
        (payload) => {
          const messageId = (payload.new as any)?.message_id || (payload.old as any)?.message_id;
          const ids = messagesRef.current.filter(m => !messageId || m.id === messageId).map(m => m.id);
          for (let i = 0; i < ids.length; i += MESSAGE_PAGE_SIZE) void loadReactions(ids.slice(i, i + MESSAGE_PAGE_SIZE));
        }
      )
      .subscribe();

    return () => {
      mountedRef.current = false;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      setTyping(false);
      supabase.removeChannel(msgCh);
      clearInterval(typePoll); supabase.removeChannel(typeCh);
      supabase.removeChannel(reactCh);
    };
  }, [conversationId, currentUserId, fetchMessages, fetchTyping, markRead, mergeMsg, refreshStatus, setTyping, loadReactions, accountScope]);

  const handleTextChange = useCallback((text: string) => {
    setMessage(text);
    if (conversationId) useDraftStore.getState().setDraft(conversationId, text);
    if (isGroup) { const mm = text.match(/@([A-Za-z0-9_\.]*)$/); setMentionQuery(mm ? mm[1] : null); } else { if (mentionQuery !== null) setMentionQuery(null); }
    setTyping(text.trim().length > 0);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => setTyping(false), 1500);
  }, [setTyping]);

useEffect(() => {
    if (!isGroup || !conversationId) return;
    let live = true;
    const check = async () => {
      try {
        const { data } = await supabase.from('call_sessions')
          .select('id, is_video, status, created_at, expires_at')
          .eq('is_group_call', true)
          .eq('conversation_id', conversationId)
          .in('status', ['ringing', 'active'])
          .order('created_at', { ascending: false })
          .limit(1).maybeSingle();
        const stale = data?.status === 'ringing' && ((data as any).expires_at ? Date.now() > new Date((data as any).expires_at).getTime() : (Date.now() - new Date(data.created_at ?? 0).getTime() > 90000));
        if (!data || stale) { if (live) setLiveGroupCall(null); return; }
        let joinedNames: string[] = [];
        try {
          const { data: parts } = await supabase.from('call_participants')
            .select('user_id').eq('call_session_id', data.id).eq('status', 'joined');
          const ids = (parts || []).map((p: any) => p.user_id);
          if (data.status === 'active' && ids.length === 0) { if (live) setLiveGroupCall(null); return; }
          if (ids.length) {
            const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', ids);
            joinedNames = (profs || []).map((p: any) => String(p.full_name || '').split(' ')[0]).filter(Boolean);
          }
        } catch (e: any) { console.log('[BANNER] participants query error:', e?.message); }
        if (live) setLiveGroupCall({ id: data.id, is_video: !!data.is_video, joinedNames });
      } catch {}
    };
    supabase.rpc('sweep_dead_calls').then(() => { if (live) check(); }, () => { if (live) check(); });
    const iv = setInterval(check, 20000);
    const ch = supabase.channel(`gcall_watch_${conversationId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_sessions', filter: `conversation_id=eq.${conversationId}` }, () => check())
      .subscribe();
    return () => { live = false; clearInterval(iv); supabase.removeChannel(ch); };
  }, [isGroup, conversationId]);

  const joinLiveCall = useCallback(async () => {
    if (!liveGroupCall || !conversationId) return;
    try {
      const { error } = await supabase.rpc('join_group_call', { p_session_id: liveGroupCall.id });
      if (error) throw error;
      (navigation as any).navigate('Call', {
        callId: liveGroupCall.id, channelId: liveGroupCall.id,
        callerName: chatTitle, callerAvatar: null,
        otherUser: { id: '', full_name: chatTitle, avatar_url: null },
        isIncoming: true, isVideo: liveGroupCall.is_video, isGroupCall: true,
        groupName: chatTitle, conversationId,
      });
    } catch (e: any) { setLiveGroupCall(null); Alert.alert('Could not join', e?.message || 'The call may have ended.'); }
  }, [liveGroupCall, conversationId, chatTitle]);

  useEffect(() => {
    if (!isGroup || !conversationId || !currentUserId) return;
    let live = true;
    const check = async () => {
      try {
        const newest = messagesRef.current?.[0];
        if (!newest || newest.sender_id !== currentUserId || !newest.created_at) {
          if (live) setSeenByNames(prev => prev.length ? [] : prev);
          return;
        }
        const { data } = await supabase
          .from('conversation_members')
          .select('user_id, last_read_at')
          .eq('conversation_id', conversationId)
          .neq('user_id', currentUserId)
          .gt('last_read_at', newest.created_at);
        if (!live) return;
        const names: string[] = (data || []).map((r: any) => String(r.user_id));
        setSeenByNames(prev =>
          prev.length === names.length && prev.every((n, i) => n === names[i]) ? prev : names);
      } catch {}
    };
    check();
    const iv = setInterval(check, 5000);
    return () => { live = false; clearInterval(iv); };
  }, [isGroup, conversationId, currentUserId]);

const openSeenInfo = useCallback(async (msg: any) => {
    if (!conversationId || !msg?.created_at) return;
    setSeenSheet({ msg, rows: null } as any); // loading — the sheet can never be silently blank
    try {
      const { data, error } = await supabase
        .from('conversation_members')
        .select('user_id, last_read_at')
        .eq('conversation_id', conversationId)
        .neq('user_id', currentUserId);
      if (error) throw error;
      const ids = (data || []).map((r: any) => r.user_id);
      const { data: profs } = ids.length
        ? await supabase.from('profiles').select('id, full_name, username, avatar_url').in('id', ids)
        : { data: [] as any[] };
      const profById: Record<string, any> = {};
      (profs || []).forEach((p: any) => { profById[p.id] = p; });
      const rows = (data || []).map((r: any) => {
        const p: any = profById[r.user_id] || {};
        const seen = r.last_read_at && new Date(r.last_read_at) > new Date(msg.created_at);
        return {
          name: String(p.full_name || p.username || 'Member'),
          avatar: p.avatar_url ?? null,
          seenAt: seen ? r.last_read_at : null,
        };
      }).sort((x: any, y: any) => (y.seenAt ? 1 : 0) - (x.seenAt ? 1 : 0));
      setSeenSheet({ msg, rows });
    } catch (e: any) {
      setSeenSheet({ msg, rows: [], error: e?.message || 'Could not load' } as any);
    }
  }, [conversationId, currentUserId]);

const insertMention = useCallback((username: string) => {
    setMessage(prev => prev.replace(/@([A-Za-z0-9_\.]*)$/, '@' + username + ' '));
    setMentionQuery(null);
  }, []);

  const toggleSaveMessage = async (msgId: string) => {
    if (!currentUserId) return;
    const already = savedIds.has(msgId);
    if (already) {
      await supabase.from('saved_messages').delete().eq('user_id', currentUserId).eq('message_id', msgId);
      setSavedIds(prev => { const n = new Set(prev); n.delete(msgId); return n; });
    } else {
      await supabase.from('saved_messages').insert({ user_id: currentUserId, message_id: msgId });
      setSavedIds(prev => new Set([...prev, msgId]));
    }
  };

  const toggleStar = async (msg: MessageItem) => {
    if (!currentUserId || !conversationId) return;
    const already = starredIds.has(msg.id);
    setStarredIds(prev => {
      const n = new Set(prev);
      if (already) n.delete(msg.id); else n.add(msg.id);
      return n;
    });
    if (already) {
      const { error } = await supabase.from('starred_messages').delete()
        .eq('message_id', msg.id).eq('starred_by', currentUserId);
      if (error) { setStarredIds(prev => new Set([...prev, msg.id])); }
      else if (showInfoModal) loadInfoContent();
    } else {
      const { error } = await supabase.from('starred_messages').insert({
        message_id: msg.id, conversation_id: conversationId, starred_by: currentUserId,
      });
      if (error) { setStarredIds(prev => { const n = new Set(prev); n.delete(msg.id); return n; }); }
      else if (showInfoModal) loadInfoContent();
    }
  };

  const saveMediaToDevice = async (url: string | null, kind: 'image' | 'video') => {
    if (!url || savingToDevice) return;
    setSavingToDevice(true);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow access to save to your gallery.'); return; }
      const cleanUrl = url.split('?')[0];
      const ext = cleanUrl.split('.').pop()?.toLowerCase() || (kind === 'video' ? 'mp4' : 'jpg');
      const fileName = `PlatinumCirclesnest_${Date.now()}.${ext}`;
      const dest = `${FileSystem.cacheDirectory}${fileName}`;
      const downloaded = await FileSystem.downloadAsync(url, dest);
      if (downloaded.status !== 200) throw new Error(`Download ${downloaded.status}`);
      await MediaLibrary.saveToLibraryAsync(downloaded.uri);
      Alert.alert('Saved', `${kind === 'video' ? 'Video' : 'Photo'} saved to your gallery.`);
    } catch (e: any) {
      Alert.alert('Could not save', e?.message || 'Try again.');
    } finally { setSavingToDevice(false); }
  };

  const openForward = async (msg: MessageItem) => {
    if (!canForwardMessage(msg)) { Alert.alert('Cannot forward', 'Limited-view attachments and payment events cannot be forwarded.'); return; }
    setForwardMsg(msg);
    try {
      const [dmRes, memberRes] = await Promise.all([
        supabase.from('conversations').select('id, user_1, user_2, group_name, is_group, group_emoji, last_message, last_message_time')
          .or(`user_1.eq.${currentUserId},user_2.eq.${currentUserId}`)
          .eq('is_group', false).order('last_message_time', { ascending: false }).limit(20),
        supabase.from('conversation_members').select('conversation_id').eq('user_id', currentUserId ?? ''),
      ]);
      const groupIds = (memberRes.data || []).map((r: any) => r.conversation_id);
      let groupConvs: any[] = [];
      if (groupIds.length > 0) {
        const { data: gc } = await supabase.from('conversations').select('id, group_name, is_group, group_emoji, last_message, last_message_time').in('id', groupIds).limit(20);
        groupConvs = gc || [];
      }
      setForwardConvs([...(dmRes.data || []), ...groupConvs].filter(c => c.id !== conversationId));
    } catch (e) { console.log('[FORWARD_LOAD_ERR]', e); }
    setShowForwardPicker(true);
  };

  const forwardToConversation = useCallback(async (destination: any) => {
    if (!forwardMsg || !currentUserId || forwardPending.current) return;
    forwardPending.current = true;
    try {
      const { data: source, error: sourceError } = await supabase.from('messages').select('*')
        .eq('id', forwardMsg.id).eq('conversation_id', forwardMsg.conversation_id).single();
      if (sourceError || !source || !canForwardMessage(source)) throw new Error('This message is no longer available to forward.');
      const receiverId = destination.is_group ? null : destination.user_1 === currentUserId ? destination.user_2 : destination.user_1;
      const { error } = await supabase.from('messages').insert({
        conversation_id: destination.id, sender_id: currentUserId, receiver_id: receiverId,
        text: source.text || null, media_url: source.media_url || null, media_type: source.media_type || null,
        thumbnail_url: source.thumbnail_url || null, shared_post_id: source.shared_post_id || null,
        forwarded_from_id: source.id, reply_to_id: null,
      });
      if (error) throw new Error('The message could not be forwarded. Please try again.');
      setShowForwardPicker(false); setForwardMsg(null); Alert.alert('Forwarded');
    } catch (error) { Alert.alert('Not forwarded', error instanceof Error ? error.message : 'Please try again.'); }
    finally { forwardPending.current = false; }
  }, [forwardMsg, currentUserId]);

  const doSend = useCallback(async (text: string, mediaUrl?: string, mediaType?: string, mediaB64?: string | null, replyId?: string | null, mediaWidth?: number, mediaHeight?: number, mediaThumbUrl?: string, viewLimit: number | null = null): Promise<boolean> => {
    if (!currentUserId) return false;
    const initiatingOwner = useAuthStore.getState().session?.user.id;
    if (!initiatingOwner) return false;
    const convId = await getOrCreateConversation();
    if (!convId || useAuthStore.getState().session?.user.id !== initiatingOwner) return false;
    const { data: session, error: sessionError } = await supabase.auth.getSession();
    const owner = session?.session?.user?.id;
    if (sessionError || owner !== initiatingOwner || useAuthStore.getState().session?.user.id !== initiatingOwner) return false;
    const receiverId = isGroup ? null : (otherUser?.id ?? passedUserId ?? null);
    const id = makeMessageId();
    const intent: MessageIntent = {
      id, conversation_id: convId, sender_id: currentUserId, receiver_id: receiverId,
      text: text || null, media_url: mediaUrl || null, media_type: mediaType || null,
      thumbnail_url: mediaThumbUrl || null, reply_to_id: replyId || null,
      view_limit: viewLimit,
    };
    const optimistic: MessageItem = {
      ...intent, created_at: new Date().toISOString(), media_b64: mediaB64 || null,
      media_width: mediaWidth || null, media_height: mediaHeight || null, _optimistic: true,
    };
    // Persist the original ID before any attempt. Both the immediate sender and
    // reconnection worker use this ID, so a lost response cannot make a new row.
    await useNetStore.getState().enqueue({ ...intent, owner_auth_id: owner });
    if (useAuthStore.getState().session?.user.id !== owner) return true;
    if (mountedRef.current && activeConversation.current === convId) {
      LayoutAnimation.configureNext(LayoutAnimation.create(180, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
      setMessages(prev => mergeMessagePage(prev, [optimistic]));
    }
    const outcome = await deliverMessage(supabase, intent);
    if (outcome.status === 'confirmed') {
      useNetStore.getState().removeFromOutbox(id);
      if (useAuthStore.getState().session?.user.id === owner) {
        await mergeMsg({ ...outcome.row, media_width: mediaWidth || null, media_height: mediaHeight || null, media_b64: mediaB64 || null } as MessageItem);
        void refreshStatus();
      }
      return true;
    }
    if (outcome.status === 'pending') {
      if (useAuthStore.getState().session?.user.id === owner && mountedRef.current && activeConversation.current === convId) setMessages(prev => prev.map(item => item.id === id && item._optimistic ? { ...item, _queued: true } : item));
      return true;
    }
    if (outcome.status === 'conflict') {
      useNetStore.getState().setOutboxFailed(id, true);
      return true;
    }
    useNetStore.getState().removeFromOutbox(id);
    if (mountedRef.current && activeConversation.current === convId) setMessages(prev => prev.filter(item => item.id !== id));
    Alert.alert('Message not sent', 'The server did not accept this message. Your draft is available to try again.');
    return false;
  }, [getOrCreateConversation, currentUserId, isGroup, otherUser, passedUserId, mergeMsg, refreshStatus]);

  const sendMessage = useCallback(async () => {
    const clean = message.trim();
    if (!clean || textSendPending.current) return;
    const owner = useAuthStore.getState().session?.user.id;
    textSendPending.current = true;
    const origin = conversationId;
    setMessage('');
    if (origin) useDraftStore.getState().clearDraft(origin);
    setSending(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    setTyping(false);
    const rid = replyTo?.id;
    setReplyTo(null);
    try {
      const ok = await doSend(clean, undefined, undefined, null, rid);
      if (!ok && useAuthStore.getState().session?.user.id === owner) {
        if (origin) useDraftStore.getState().setDraft(origin, clean);
        if (mountedRef.current && activeConversation.current === origin) setMessage(clean);
      }
    } catch {
      if (useAuthStore.getState().session?.user.id === owner) {
        if (origin) useDraftStore.getState().setDraft(origin, clean);
        if (mountedRef.current && activeConversation.current === origin) setMessage(clean);
        Alert.alert('Message not sent', 'Please try again.');
      }
    } finally { textSendPending.current = false; if (mountedRef.current) setSending(false); }
  }, [message, conversationId, setTyping, replyTo, doSend]);

const chooseAndSendImage = useCallback(async (img: { uri: string; width: number; height: number; base64: string | null; caption?: string }): Promise<boolean> => {
    const owner = useAuthStore.getState().session?.user.id;
    if (!owner || !currentUserId || mediaSending.current) return false;
    const scope = attachmentScopeRef.current, operation = ++mediaOperation.current;
    const current = () => mountedRef.current && attachmentScopeRef.current === scope && useAuthStore.getState().session?.user.id === owner && mediaOperation.current === operation;
    mediaSending.current = true;
    try {
      const choice = await new Promise<number | null>(resolve => Alert.alert('Send photo', 'Choose how it can be viewed', [
        { text: 'Normal', onPress: () => resolve(null) }, { text: 'View once', onPress: () => resolve(1) },
        { text: 'View twice', onPress: () => resolve(2) }, { text: 'Cancel', style: 'cancel', onPress: () => resolve(-1) },
      ], { cancelable: true, onDismiss: () => resolve(-1) }));
      if (choice === -1 || !current()) return false;
      setUploadingMedia(true);
      const { url } = await uploadMedia('chat-media', currentUserId, {
        uri: img.uri, kind: 'image', ext: 'jpg', mimeType: 'image/jpeg',
        width: img.width, height: img.height, base64: choice ? null : img.base64,
      }, { filename: `edited_${Date.now()}.jpg` });
      if (!current()) return false;
      const sent = await doSend(img.caption || '', url, 'image', choice ? null : img.base64, null, img.width, img.height, undefined, choice);
      if (!sent && current()) throw Error('Photo could not be sent.');
      return sent;
    } catch {
      if (current()) Alert.alert('Photo not sent', 'Your edited photo is kept for retry.', [
        { text: 'Cancel', style: 'cancel' }, { text: 'Retry', onPress: () => { void chooseAndSendImage(img); } },
      ]);
      return false;
    } finally { if (operation === mediaOperation.current) { mediaSending.current = false; if (current()) setUploadingMedia(false); } }
  }, [currentUserId, doSend]);

  const openSealedMedia = useCallback((msg: MessageItem) => {
    const viewer = useAuthStore.getState().session?.user.id;
    if (!viewer || msg.sender_id === viewer || !msg.view_limit || viewedOutIds.has(msg.id)) return;
    if(msg.conversation_id !== activeConversation.current) return;
    setPrivateMedia({ id: msg.id, userId: viewer, scope: attachmentScopeRef.current });
  }, [viewedOutIds]);
  const sendMediaAssets = useCallback(async (assets: { uri: string; type?: string | null; width?: number; height?: number; base64?: string | null }[]) => {
    const owner = useAuthStore.getState().session?.user.id;
    if (!owner || !currentUserId || mediaSending.current || !assets.length) return false;
    const scope = attachmentScopeRef.current, operation = ++mediaOperation.current;
    const current = () => mountedRef.current && attachmentScopeRef.current === scope && useAuthStore.getState().session?.user.id === owner && operation === mediaOperation.current;
    mediaSending.current = true;
    let failed = 0, failureReason = '', viewLimit: number | null = null;
    setShowToolbar(false); setUploadingMedia(true);
    try {
      if (assets.length === 1 && assets[0].type === 'video') {
        const choice = await new Promise<number|null>(resolve => Alert.alert('Send video', 'Choose how it can be viewed', [
          {text:'Normal',onPress:()=>resolve(null)}, {text:'View once',onPress:()=>resolve(1)}, {text:'Cancel',style:'cancel',onPress:()=>resolve(-1)},
        ], {cancelable:true,onDismiss:()=>resolve(-1)}));
        if (choice === -1 || !current()) return false;
        viewLimit = choice;
      }
      for (const asset of assets) {
        if (!current()) return false;
        const isVid = asset.type === 'video', ext = isVid ? 'mp4' : 'jpg', mime = isVid ? 'video/mp4' : 'image/jpeg';
        const imgBase64 = viewLimit ? null : asset.base64 ?? null;
        try {
          const { url } = await uploadMedia('chat-media', currentUserId, {
            uri: asset.uri, kind: isVid ? 'video' : 'image', ext, mimeType: mime,
            width: asset.width, height: asset.height, base64: imgBase64,
          }, { filename: `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}` });
          if (!current()) return false;
          let thumbUrl: string | undefined;
          if (isVid && !viewLimit) {
            try {
              const th = await VideoThumbnails.getThumbnailAsync(asset.uri, { time: 0, quality: 0.7 });
              if (!current()) return false;
              const up = await uploadMedia('chat-media', currentUserId, {
                uri: th.uri, kind: 'image', ext: 'jpg', mimeType: 'image/jpeg', base64: null,
              }, { filename: `${Date.now()}_${Math.random().toString(36).slice(2)}_thumb.jpg` });
              thumbUrl = up.url;
            } catch (thumbErr: any) { console.log('[CHAT_THUMB_ERR]', thumbErr?.message); }
          }
          if (!current()) return false;
          if (!(await doSend('', url, isVid ? 'video' : 'image', imgBase64, null, asset.width, asset.height, thumbUrl, viewLimit))) failed++;
        } catch (error) { failed++; failureReason = error instanceof Error ? error.message : ''; }
      }
    } finally { if (operation === mediaOperation.current) { mediaSending.current = false; if (current()) setUploadingMedia(false); } }
    if (!current()) return false;
    if (failed) Alert.alert('Attachment not sent', failureReason || `${failed} attachment${failed === 1 ? '' : 's'} could not be sent. Please try again.`);
    return failed === 0;
  }, [currentUserId, doSend]);

  const pickAndSendMedia = useCallback(async () => {
    const scope = attachmentScopeRef.current;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (attachmentScopeRef.current !== scope || !mountedRef.current) return;
    if (!perm.granted) { Alert.alert('Permission required'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
        preferredAssetRepresentationMode: "compatible" as ImagePicker.UIImagePickerPreferredAssetRepresentationMode,
      mediaTypes: ['images', 'videos'] as ImagePicker.MediaType[], quality: 0.92,
      allowsMultipleSelection: true, selectionLimit: 10, base64: true,
    });
    if (result.canceled || !result.assets?.length || attachmentScopeRef.current !== scope || !mountedRef.current) return;
    if (result.assets.length === 1 && result.assets[0].type !== 'video') {
      const a = result.assets[0];
      setShowToolbar(false);
      setEditTarget({ uri: a.uri, width: a.width ?? 1000, height: a.height ?? 1000 });
      return;
    }
    await sendMediaAssets(result.assets);
  }, [sendMediaAssets]);

const pickAndSendDocument = useCallback(async () => {
    const owner = useAuthStore.getState().session?.user.id;
    if (!owner || !currentUserId || mediaSending.current) return;
    const scope = attachmentScopeRef.current, operation = ++mediaOperation.current;
    const current = () => mountedRef.current && scope === attachmentScopeRef.current && owner === useAuthStore.getState().session?.user.id && operation === mediaOperation.current;
    mediaSending.current = true; setShowToolbar(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets?.[0] || !current()) return;
      const asset = result.assets[0];
      const ext = asset.name.split('.').pop()?.toLowerCase() || 'bin';
      setUploadingMedia(true);
      const safeName = asset.name.replace(/[^a-zA-Z0-9_.-]/g, '_');
      const { url } = await uploadMedia('chat-files', currentUserId, {
        uri: asset.uri, kind: 'document', ext, mimeType: asset.mimeType || 'application/octet-stream', base64: null,
      }, { filename: `${Date.now()}_${safeName}` });
      if (current()) await doSend(`📄 ${asset.name}`, url, 'document', null);
    } catch (e: any) { if(current()) Alert.alert('Error', 'Could not send file: ' + (e?.message || '')); }
    finally { if(operation===mediaOperation.current){mediaSending.current=false;if(current())setUploadingMedia(false);} }
  }, [currentUserId, doSend]);

  const sendGif = useCallback(async (url: string) => {
    setShowGifs(false); setShowToolbar(false);
    await doSend('', url, 'gif', null);
  }, [doSend]);

  const [stickerMode, setStickerMode] = useState(false);
  const sendSticker = useCallback(async (url: string) => {
    setShowGifs(false); setShowToolbar(false);
    await doSend('', url, 'sticker', null);
  }, [doSend]);

  const funCamNav = useNavigation<any>();
  const funCamRoute = useRoute();
  useEffect(() => {
    const cm = (funCamRoute.params as any)?.capturedMedia;
    if (!cm) return;
    if (cm.type === 'video') {
      setCapturedVideo({ uri: cm.uri, type: 'video', width: cm.width, height: cm.height });
      funCamNav.setParams({ capturedMedia: undefined });
      return;
    }
    setEditTarget({ uri: cm.uri, width: cm.width ?? 1000, height: cm.height ?? 1000 });
    funCamNav.setParams({ capturedMedia: undefined });
  }, [(funCamRoute.params as any)?.capturedMedia]);

  const openCamera = useCallback(() => {
    setShowToolbar(false);
    funCamNav.navigate('StoryFunCamera', { returnTo: 'chat', chatParams: {} });
  }, [funCamNav]);

  const toggleReaction = useCallback(async (msgId: string, emoji: string) => {
    if (!currentUserId || reactionPending.current.has(msgId)) return;
    reactionPending.current.add(msgId); setSelectedMsg(null);
    try {
      const { data: existing, error: readError } = await supabase.from('message_reactions').select('id, emoji').eq('message_id', msgId).eq('user_id', currentUserId).maybeSingle();
      if (readError) throw readError;
      const result = existing
        ? existing.emoji === emoji
          ? await supabase.from('message_reactions').delete().eq('id', existing.id).eq('user_id', currentUserId)
          : await supabase.from('message_reactions').update({ emoji }).eq('id', existing.id).eq('user_id', currentUserId)
        : await supabase.from('message_reactions').insert({ message_id: msgId, user_id: currentUserId, emoji });
      if (result.error) throw result.error;
      await loadReactions([msgId]);
    } catch { Alert.alert('Reaction not saved', 'Please try again.'); }
    finally { reactionPending.current.delete(msgId); }
  }, [currentUserId, loadReactions]);

  const saveEdit = useCallback(async () => {
    if (!editingMsg || !editText.trim() || editPending.current || !currentUserId) return;
    editPending.current = true;
    const newText = editText.trim(); const msgId = editingMsg.id;
    try {
      const { data, error } = await supabase.from('messages').update({ text: newText, edited_at: new Date().toISOString() })
        .eq('id', msgId).eq('sender_id', currentUserId).is('deleted_at', null).select('*').single();
      if (error || !data) throw error;
      if (activeConversation.current === editingMsg.conversation_id) {
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, ...data } : m));
        setEditingMsg(null); setEditText('');
      }
    } catch { Alert.alert('Edit not saved', 'Your edit is still here. Please try again.'); }
    finally { editPending.current = false; }
  }, [editingMsg, editText, currentUserId]);

  const startCall = useCallback(async (isVideo = false) => {
    if (!(await flagsService.isEnabled('calls'))) {
      Alert.alert('Calls unavailable', 'Calling is temporarily switched off by Platinum Circles operations.');
      return;
    }
    if (!currentUserId) return;
    if (startingCallRef.current) return; // double-tap made twin sessions 3ms apart
    startingCallRef.current = true;
    setTimeout(() => { startingCallRef.current = false; }, 2000);

    if (isGroup) {
      if (!conversationId) { Alert.alert('Cannot call', 'No conversation found.'); return; }
      const { data: sessId, error: gcErr } = await supabase.rpc('start_group_call', { p_conversation_id: conversationId, p_is_video: isVideo });
      if (gcErr || !sessId) { Alert.alert('Could not start call', gcErr?.message || 'Someone may already be calling.'); return; }
      supabase.functions.invoke('send-voip-push', { body: { callId: String(sessId) } }).then((r: any) => console.log('[voip] ring', JSON.stringify(r?.data ?? null), r?.error ? String(r.error.message || r.error) : 'ok')).catch((e: any) => console.log('[voip] ring failed', e?.message));
      const chanId = String(sessId);
      navigation.navigate('Call', {
        callId: String(sessId), channelId: chanId,
        callerName: chatTitle, callerAvatar: null,
        otherUser: { id: '', full_name: chatTitle, avatar_url: null },
        isIncoming: false, isVideo, isGroupCall: true,
        groupName: chatTitle, conversationId,
      });
    } else {
      const recipientId = otherUser?.id ?? passedUserId;
      if (!recipientId) { Alert.alert('Cannot call'); return; }
      const chanId = conversationId || `${currentUserId}_${recipientId}`;
      navigation.navigate('Call', {
        callId: null, channelId: chanId,
        callerName: otherUser?.full_name || chatTitle,
        callerAvatar: otherUser?.avatar_url || null,
        otherUser: otherUser ?? { id: recipientId, full_name: chatTitle, avatar_url: null },
        isIncoming: false, isVideo, isGroupCall: false,
      });
      // session creation belongs to CallContext alone — a second create here
      // split every call into two rooms (receiver answered the wrong one).
    }
  }, [currentUserId, otherUser, passedUserId, conversationId, isGroup, chatTitle, navigation]);

  const lastOwnIndex = useMemo(() => messages.findIndex(m => m.sender_id === currentUserId), [messages, currentUserId]);

  const getStatus = useCallback((item: MessageItem, isMe: boolean, index: number) => {
    if (!isMe) return null;
    if (lastOwnIndex !== index) return null;
    if (item._queued) return 'Waiting to send';
    if (item._optimistic) return 'Sending';
    const viewed = item.viewed_at || (lastStatus?.id === item.id ? lastStatus.viewed_at : null);
    const delivered = item.delivered_at || (lastStatus?.id === item.id ? lastStatus.delivered_at : null);
    const readAt = item.read_at;
    if (viewed || readAt) return `Seen ${fmtTime(viewed || readAt)}`;
    if (delivered) return 'Delivered';
    return 'Sent';
  }, [lastOwnIndex, currentUserId, lastStatus]);

  const listData = useMemo(() => {
    const source = searchQuery.trim()
      ? messages.filter(m => m.text?.toLowerCase().includes(searchQuery.toLowerCase()))
      : messages;
    const out: any[] = [];
    source.forEach((msg, i) => {
      out.push({ type: 'msg', data: msg, index: i });
      const next = source[i + 1];
      if (!next || !sameDay(msg.created_at, next.created_at)) {
        out.push({ type: 'sep', label: fmtSep(msg.created_at), id: `sep-${i}` });
      }
    });
    return out;
  }, [messages, searchQuery]);

  const [paymentsMap, setPaymentsMap] = useState<Record<string, ChatPayment>>({});
  const [offersMap, setOffersMap] = useState<Record<string, any>>({});
  useEffect(() => {
    const ids: string[] = [];
    messages.forEach(m => {
      if (m.media_type === 'offer' && m.media_url) {
        try { const j = JSON.parse(m.media_url); if (j?.offer_id && !offersMap[j.offer_id]) ids.push(j.offer_id); } catch {}
      }
    });
    if (!ids.length) return;
    supabase.from('listing_offers').select('id, status, proposer_id, amount, currency').in('id', ids)
      .then(({ data }) => {
        if (!data?.length) return;
        setOffersMap(prev => { const n = { ...prev }; data.forEach((r: any) => { n[r.id] = r; }); return n; });
      });
  }, [messages]);
  const respondOffer = useCallback(async (offerId: string, action: string, counterAmount?: number) => {
    try {
      const { error } = await supabase.rpc('respond_offer', { p_offer_id: offerId, p_action: action, p_counter_amount: counterAmount ?? null });
      if (error) throw error;
      setOffersMap(prev => ({ ...prev, [offerId]: { ...(prev[offerId] || {}), status: action } }));
    } catch (e: any) { Alert.alert('Offer', e?.message || 'Could not respond.'); }
  }, []);
  useEffect(() => {
    const ids = Array.from(new Set(messages.filter(m => m.payment_receipt_verified === true)
      .map(m => m.payment_id).filter(Boolean))) as string[];
    const missing = ids.filter(id => !paymentsMap[id]);
    if (missing.length === 0) return;
    (async () => {
      const { data, error } = await supabase.rpc('get_payments_by_ids', { p_ids: missing });
      if (error) { console.log('[PAYMENTS]', error.message); return; }
      setPaymentsMap(prev => {
        const next = { ...prev };
        (data ?? []).forEach((r: any) => { next[r.payment_id] = r as ChatPayment; });
        return next;
      });
    })();
  }, [messages, paymentsMap]);


  // The list is inverted, so index - 1 renders BELOW this message. A run ends
  // where the message below comes from someone else or after a gap. Only the
  // bottom of a run gets a tail, an avatar and a timestamp.
  const groupEnds = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (let i = 0; i < messages.length; i++) {
      const mm = messages[i];
      const below = messages[i - 1];
      const continues = !!below
        && below.sender_id === mm.sender_id
        && Math.abs(new Date(below.created_at ?? 0).getTime() - new Date(mm.created_at ?? 0).getTime()) < 120000;
      map[mm.id] = !continues;
    }
    return map;
  }, [messages]);
  const membersById = useMemo(() => {
    const m: Record<string, any> = {};
    groupMembers.forEach((gm: any) => { if (gm.profile?.id) m[gm.profile.id] = gm.profile; });
    return m;
  }, [groupMembers]);
  const groupStarts = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (let i = 0; i < messages.length; i++) {
      const mm = messages[i];
      const above = messages[i + 1];
      const continues = !!above
        && above.sender_id === mm.sender_id
        && Math.abs(new Date(mm.created_at ?? 0).getTime() - new Date(above.created_at ?? 0).getTime()) < 120000;
      map[mm.id] = !continues;
    }
    return map;
  }, [messages]);
  const SENDER_COLORS = ['#B45309', '#0F766E', '#7C3AED', '#BE185D', '#2563EB', '#059669', '#C2410C', '#4F46E5'];
  const senderColor = useCallback((id?: string | null) => {
    if (!id) return SENDER_COLORS[0];
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return SENDER_COLORS[h % SENDER_COLORS.length];
  }, []);
  const [sharedPostsMap, setSharedPostsMap] = useState<Record<string, { content: string; author: any; media?: { url: string; media_type: string; thumbnail_url?: string | null } | null }>>({});
  useEffect(() => {
    let live=true; const scope=accountScopeRef.current;
    const ids = Array.from(new Set(messages.map(m => m.shared_post_id).filter(Boolean))) as string[];
    const missing = ids.filter(id => !sharedPostsMap[id]);
    if (missing.length === 0) return;
    (async () => {
      const { data: sp } = await supabase.from('posts').select('id, user_id, content, body, media_url, post_media(url, media_type, sort_order, edit)').in('id', missing);
      const rows = sp ?? [];
      const uids = Array.from(new Set(rows.map((r: any) => r.user_id)));
      const am: Record<string, any> = {};
      if (uids.length > 0) {
        const { data: aus } = await supabase.from('profiles').select('id, full_name, username, avatar_url').in('id', uids);
        (aus ?? []).forEach((a: any) => { am[a.id] = a; });
      }
      if(!live || scope!==accountScopeRef.current)return;
      setSharedPostsMap(prev => {
        const n = { ...prev };
        rows.forEach((r: any) => {
          const pmArr = Array.isArray(r.post_media) ? [...r.post_media].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) : [];
          const firstMedia = pmArr[0] ? { url: pmArr[0].url, media_type: pmArr[0].media_type, thumbnail_url: (pmArr[0] as any)?.edit?.coverUrl ?? null } : (r.media_url ? { url: r.media_url, media_type: 'image' } : null);
          n[r.id] = { content: r.content ?? r.body ?? '', author: am[r.user_id] ?? null, media: firstMedia };
        });
        missing.forEach(id => { if (!n[id]) n[id] = { content: 'Post unavailable', author: null }; });
        return n;
      });
    })();
    return()=>{live=false;};
  }, [messages, sharedPostsMap, accountScope]);
  const replySource = useMemo(() => {
    if (!replyTo) return null;
    return replyTo.text || (replyTo.media_type === 'image' ? '📷 Photo' : replyTo.media_type === 'video' ? '🎬 Video' : '📎 Media');
  }, [replyTo]);

  const renderMsg = ({ item }: { item: any }) => {
    if (item.type === 'sep') return <View style={s.sep}><Text style={s.sepTxt}>{item.label}</Text></View>;
    if (item.type === 'msg' && (item.data as MessageItem).media_type === 'call_event') {
      const m = item.data as MessageItem;
      return <CallEventBubble content={m.text || ''} mediaUrl={m.media_url || null} createdAt={m.created_at} />;
    }
    if (item.type === 'msg' && (item.data as any).is_system_message && !(item.data as any).payment_id) {
      const m = item.data as MessageItem;
      return <View style={s.sep}><Text style={s.sepTxt}>{m.text || ''}</Text></View>;
    }
    const msg: MessageItem = item.data;
    const isMe = msg.sender_id === currentUserId;
    const endsGroup = groupEnds[msg.id] !== false;
    const startsGroup = groupStarts[msg.id] !== false;
    const sender = isGroup ? membersById[msg.sender_id ?? ''] : otherUser;
    const dmStatus = getStatus(msg, isMe, item.index);
    const status = (isGroup && isMe && !(msg as any).is_system_message && memberReads.length > 0)
      ? (memberReads.every((m: any) => m.last_read_at && msg.created_at && new Date(m.last_read_at) > new Date(msg.created_at)) ? 'Seen' : dmStatus === 'Sending' ? 'Sending' : 'Sent')
      : dmStatus;
    const showTs = showTimestamp === msg.id;
    const reactions = msg._reactions || [];
    const myReaction = reactions.find(r => r.user_id === currentUserId)?.emoji;
    const isStarred = starredIds.has(msg.id);
    const replySourceMsg = msg.reply_to_id ? messages.find(m => m.id === msg.reply_to_id) : null;
    const replyPreview = replySourceMsg ? (replySourceMsg.text || (replySourceMsg.media_type === 'image' ? '📷 Photo' : '🎬 Video')) : null;
    const isSticker = msg.media_type === 'sticker' && msg.media_url;
    const isMediaOnly = (msg.media_type === 'image' || msg.media_type === 'gif' || isSticker) && msg.media_url && !msg.text && !(msg as any).view_limit;
    // A shared post with no words is the card alone; no empty bubble under it.
    const isSharedOnly = !!msg.shared_post_id && !msg.text && !msg.media_url;
    const sharedPost = msg.shared_post_id ? sharedPostsMap[msg.shared_post_id] : null;
    // A deleted message leaves a mark rather than vanishing, so the other
    // person sees that something was removed instead of the conversation
    // quietly changing shape.
    if ((msg as any).deleted_at) {
      return (
        <View style={[s.row, isMe ? s.rowMe : s.rowOther, endsGroup && s.rowEndsGroup]}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 6,
            paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18,
            borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.14)',
            backgroundColor: 'rgba(11,30,61,0.03)',
          }}>
            <Feather name='slash' size={12} color={t.ink.muted} />
            <Text style={{ fontSize: 13.5, fontStyle: 'italic', color: t.ink.muted }}>
              {isMe ? 'You deleted this message' : 'This message was deleted'}
            </Text>
          </View>
        </View>
      );
    }

    return (
      <View style={[s.row, isMe ? s.rowMe : s.rowOther]}>
        {!isMe && (
          <View style={[s.sideAvatarSlot, !endsGroup && { opacity: 0 }]}>
            {sender?.avatar_url
              ? <ExpoImage source={{ uri: sender.avatar_url }} style={s.sideAvatar} contentFit="cover" />
              : <View style={s.sideAvatarFb}><Text style={s.sideAvatarTxt}>{isGroup ? initials(sender?.full_name) : otherInits}</Text></View>}
          </View>
        )}
        <Pressable style={({ pressed }) => [s.bubbleCol, isMe ? s.bubbleColMe : s.bubbleColOther, pressed && { transform: [{ scale: 0.975 }], opacity: 0.92 }]}
          onPress={() => setShowTimestamp(prev => prev === msg.id ? null : msg.id)}
          onLongPress={() => setSelectedMsg(msg)} delayLongPress={380}>
          {isGroup && !isMe && startsGroup && (
            <Text style={{ fontSize: 12, fontWeight: '700', color: senderColor(msg.sender_id), marginBottom: 3, marginLeft: 4 }} numberOfLines={1}>
              {sender?.full_name || msg.sender_name || 'Member'}
            </Text>
          )}
          {(() => { const card = msg.view_limit ? null : parseChatAttachmentCard(msg.media_url); return card ? <View style={{padding:12,borderWidth:1,borderColor:t.surface.hairline,borderRadius:12,backgroundColor:t.surface.raised}}><Text style={{color:t.ink.primary,fontWeight:'700'}}>{attachmentCardText(card)}</Text>{attachmentCardLinks(card).map(link=><TouchableOpacity key={link.url} accessibilityRole="link" onPress={()=>{void Linking.openURL(link.url).catch(()=>Alert.alert('Could not open','No compatible app is available.'));}} style={{paddingVertical:10}}><Text style={{color:t.status.link}}>{link.label}</Text></TouchableOpacity>)}</View> : null; })()}
          {!(msg as any).view_limit && parseStoryMessageReference(msg.media_url) ? <TouchableOpacity accessibilityRole="link" onPress={() => navigation.navigate('StoryViewer', { storyId: parseStoryMessageReference(msg.media_url) })} style={{ padding: 12, borderRadius: 12, backgroundColor: t.surface.raised }}><Text style={{ color: t.status.link, fontWeight: '700' }}>View story</Text></TouchableOpacity> : null}
          {msg.shared_post_id && (
            <View style={{ marginBottom: 4 }}>
              <SharedPostCard post={sharedPost ? { id: msg.shared_post_id, content: sharedPost.content, author: sharedPost.author, media: sharedPost.media } : null} width={232} onPress={() => navigation.navigate('Post', { postId: msg.shared_post_id })} onAuthorPress={sharedPost?.author?.id ? () => navigation.navigate('UserProfile' as never, { userId: sharedPost.author.id } as never) : undefined} />
            </View>
          )}

          {replyPreview && (
            <View style={[s.replyBar, isMe ? s.replyBarMe : s.replyBarOther]}>
              <View style={[s.replyAccent, isMe ? s.replyAccentMe : s.replyAccentOther]} />
              <View style={{ flex: 1 }}>
                <Text style={[s.replyLabel, isMe && s.replyLabelMe]}>{isMe ? 'You' : 'Replied'}</Text>
                <Text style={[s.replyTxt, isMe && s.replyTxtMe]} numberOfLines={2}>{replyPreview}</Text>
              </View>
            </View>
          )}
          {isSharedOnly ? null : isMediaOnly ? (
            <View style={s.imgWrap}>
              <AutoSizeImage
                uri={msg.media_url!}
                b64={msg.media_b64}
                onPress={() => msg.media_url && setFullscreenImg(msg.media_url)}
                onLongPress={() => setSelectedMsg(msg)}
              />
              {msg.media_type === 'gif' ? <View style={s.gifBadge}><Text style={s.gifBadgeTxt}>GIF</Text></View> : null}
              {isStarred && <View style={s.starBadge}><Text style={s.starBadgeTxt}>★</Text></View>}
            </View>
          ) : (
            <View style={[
              s.bubble,
              isMe ? (replyPreview ? s.bubbleMeFlat : s.bubbleMe) : (replyPreview ? s.bubbleOtherFlat : s.bubbleOther),
              isSticker && { backgroundColor: 'transparent', borderWidth: 0, shadowOpacity: 0, elevation: 0, padding: 0 },
                !endsGroup && s.bubbleInRun,
            ]}>
{(msg as any).view_limit && (msg.media_type === 'image' || msg.media_type === 'video') ? (
                <TouchableOpacity
                  disabled={isMe || viewedOutIds.has(msg.id)}
                  onPress={() => openSealedMedia(msg)}
                  activeOpacity={0.8}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingVertical: 2 }}>
                  <View style={{
                    width: 34, height: 34, borderRadius: 17, borderWidth: 1.5,
                    borderColor: isMe ? 'rgba(255,255,255,0.55)' : t.ink.muted,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: isMe ? 'rgba(255,255,255,0.85)' : t.ink.secondary }}>{(msg as any).view_limit}</Text>
                  </View>
                  <Text style={{ fontSize: 14.5, fontWeight: '600', fontStyle: viewedOutIds.has(msg.id) ? 'italic' : 'normal', color: isMe ? 'rgba(255,255,255,0.9)' : t.ink.primary }}>
                    {isMe ? `${msg.view_limit === 1 ? 'View once' : 'View twice'} ${msg.media_type === 'video' ? 'video' : 'photo'}`
                      : viewedOutIds.has(msg.id) ? 'Opened'
                      : `${msg.media_type === 'video' ? 'Video' : 'Photo'} · tap to view`}
                  </Text>
                </TouchableOpacity>
              ) : null}
              {isSticker && !msg.view_limit ? (
                <ExpoImage source={{ uri: msg.media_url! }} style={{ width: 150, height: 150 }} contentFit="contain" />
              ) : null}
              {(msg.media_type === 'image' || msg.media_type === 'gif') && msg.media_url && !(msg as any).view_limit ? (
                <View style={{ marginBottom: msg.text ? 8 : 0 }}>
                  <AutoSizeImage
                    uri={msg.media_url!}
                    b64={msg.media_b64}
                    onPress={() => msg.media_url && setFullscreenImg(msg.media_url)}
                    onLongPress={() => setSelectedMsg(msg)}
                  />
                  {msg.media_type === 'gif' ? <View style={s.gifBadge}><Text style={s.gifBadgeTxt}>GIF</Text></View> : null}
                </View>
              ) : null}
              {msg.payment_receipt_verified === true && msg.payment_id && paymentsMap[msg.payment_id]?.status === 'completed' ? (
                <PaymentBubble
                  payment={paymentsMap[msg.payment_id]}
                  isMine={isMe}
                  otherName={otherUser?.full_name}
                />
              ) : null}
              {(msg.payment_id || msg.media_type === 'payment') && msg.payment_receipt_verified !== true ? (
                <Text style={{ color: isMe ? '#FFFFFF' : t.ink.primary, fontSize: 12 }}>This message is not a verified payment receipt.</Text>
              ) : null}
              {msg.media_type === 'offer' && msg.media_url ? (() => {
                let j: any = null; try { j = JSON.parse(msg.media_url); } catch {}
                if (!j?.offer_id) return null;
                const live = offersMap[j.offer_id];
                const status = live?.status || j.status || 'pending';
                const myTurn = status === 'pending' && (live?.proposer_id ?? msg.sender_id) !== currentUserId;
                const statusColor = status === 'accepted' ? '#059669' : status === 'pending' ? t.status.warning : t.ink.secondary;
                return (
                  <View style={{ minWidth: 200, borderRadius: 14, overflow: 'hidden', backgroundColor: isMe ? 'rgba(255,255,255,0.12)' : t.surface.raised, borderWidth: 1, borderColor: isMe ? 'rgba(255,255,255,0.25)' : t.surface.hairline }}>
                    <View style={{ padding: 12 }}>
                      <Text style={{ fontSize: 11.5, fontWeight: '700', color: isMe ? 'rgba(255,255,255,0.7)' : t.ink.secondary }}>{j.counter_of ? 'COUNTER-OFFER' : 'OFFER'} · {String(j.listing_title || '').slice(0, 28)}</Text>
                      <Text style={{ fontSize: 21, fontWeight: '800', marginTop: 3, color: isMe ? '#FFFFFF' : t.ink.primary }}>{j.currency} {j.amount}</Text>
                      <Text style={{ fontSize: 12, fontWeight: '700', marginTop: 3, color: statusColor }}>{status.toUpperCase()}</Text>
                    </View>
                    {myTurn && (
                      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: isMe ? 'rgba(255,255,255,0.2)' : t.surface.hairline }}>
                        <TouchableOpacity style={{ flex: 1, paddingVertical: 10, alignItems: 'center' }} onPress={() => respondOffer(j.offer_id, 'accepted')}>
                          <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#059669' }}>Accept</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={{ flex: 1, paddingVertical: 10, alignItems: 'center', borderLeftWidth: 1, borderLeftColor: 'rgba(11,30,61,0.08)' }} onPress={() => {
                          Alert.prompt ? Alert.prompt('Counter-offer', 'Your amount', (t) => { const n = Number(String(t).replace(/,/g, '')); if (Number.isFinite(n) && n > 0) respondOffer(j.offer_id, 'countered', n); }, 'plain-text', '', 'numeric') : respondOffer(j.offer_id, 'declined');
                        }}>
                          <Text style={{ fontSize: 12.5, fontWeight: '800', color: t.ink.primary }}>Counter</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={{ flex: 1, paddingVertical: 10, alignItems: 'center', borderLeftWidth: 1, borderLeftColor: 'rgba(11,30,61,0.08)' }} onPress={() => respondOffer(j.offer_id, 'declined')}>
                          <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#DC2626' }}>Decline</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })() : null}
              {msg.media_type === 'audio' && msg.media_url && !msg.view_limit ? (
                <VoiceNote
                  uri={msg.media_url}
                  durationSec={msg.media_width ?? null}
                  tint={isMe ? '#FFFFFF' : t.ink.primary}
                  dim={isMe ? 'rgba(255,255,255,0.45)' : t.ink.muted}
                  onTint={isMe ? NAVY : t.surface.canvas}
                />
              ) : null}
              {msg.media_type === 'video' && msg.media_url && !msg.view_limit ? (
                <TouchableOpacity style={[s.videoThumb, { width: MSG_IMG_MAX_W, height: MSG_VID_H }]}
                  activeOpacity={0.85} onPress={() => setFullscreenVideo(msg.media_url!)}
                  onLongPress={() => setSelectedMsg(msg)}>
                  {msg.thumbnail_url ? (
                    <ExpoImage source={{ uri: msg.thumbnail_url }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
                  ) : null}
                  <View style={s.videoPlayCircle}><Feather name="play" size={24} color="#FFF" /></View>
                </TouchableOpacity>
              ) : null}
              {msg.media_type === 'document' && msg.media_url && !msg.view_limit ? (
                <TouchableOpacity style={s.docBubble} activeOpacity={0.8}
                  onPress={() => { if (msg.media_url) Linking.openURL(msg.media_url); }}>
                  <View style={[s.docIconBg, isMe && s.docIconBgMe]}>
                    <Feather name="file-text" size={20} color={isMe ? '#FFF' : t.ink.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.docName, isMe && s.docNameMe]} numberOfLines={2}>
                      {msg.text?.replace('📄 ', '') || 'Document'}
                    </Text>
                    <Text style={[s.docTap, isMe && s.docTapMe]}>Tap to open</Text>
                  </View>
                </TouchableOpacity>
              ) : null}
              {(() => {
                const isStoryReply = msg.text?.startsWith('Replied to your story:\n');
                const displayText = isStoryReply ? msg.text!.replace('Replied to your story:\n', '') : msg.text;
                return (
                  <>
                    {isStoryReply && (
                      <View style={s.storyReplyLabel}>
                        <Feather name="camera" size={14} color={isMe ? 'rgba(255,255,255,0.7)' : '#2563EB'} />
                        <Text style={[s.storyReplyTxt, isMe ? s.storyReplyTxtMe : s.storyReplyTxtOther]}>Story reply</Text>
                      </View>
                    )}
                    {displayText ? (
                      isLink(displayText) ? (
                        <TouchableOpacity onPress={() => Linking.openURL(displayText!)}>
                          <Text style={[s.bubbleTxt, isMe ? s.bubbleTxtMe : s.bubbleTxtOther, s.linkTxt]}>{displayText}</Text>
                        </TouchableOpacity>
                      ) : <MentionText text={displayText!} meStyle={isMe} style={[s.bubbleTxt, isMe ? s.bubbleTxtMe : s.bubbleTxtOther]} />
                    ) : null}
                  </>
                );
              })()}
              {isStarred && msg.media_type !== 'image' && msg.media_type !== 'gif' && (
                <View style={s.starBadgeInline}><Text style={s.starBadgeTxt}>★</Text></View>
              )}
            </View>
          )}
          {reactions.length > 0 && (
            <View style={[s.reactionsRow, isMe ? s.reactionsRowMe : s.reactionsRowOther]}>
              {Object.entries(reactions.reduce((acc: Record<string, number>, r) => { acc[r.emoji] = (acc[r.emoji] || 0) + 1; return acc; }, {})).map(([emoji, count]) => (
                <TouchableOpacity key={emoji} style={[s.reactionPill, emoji === myReaction && s.reactionPillMine]}
                  onPress={() => toggleReaction(msg.id, emoji)}>
                  <Text style={s.reactionEmoji}>{emoji}</Text>
                  {count > 1 && <Text style={s.reactionCount}>{count}</Text>}
                </TouchableOpacity>
              ))}
            </View>
          )}
          {(msg as any).edited_at && !status && <Text style={[s.status, isMe ? s.statusMe : s.statusOther]}>edited</Text>}
          {status && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: isMe ? 'flex-end' : 'flex-start' }}>
              {status === 'Sending' ? <Ionicons name="time-outline" size={12} color="rgba(11,30,61,0.4)" />
                : status === 'Sent' ? <Ionicons name="checkmark" size={13} color="rgba(11,30,61,0.45)" />
                : status === 'Delivered' ? <Ionicons name="checkmark-done" size={13} color="rgba(11,30,61,0.45)" />
                : <Ionicons name="checkmark-done" size={13} color="#3B82F6" />}
              <Text style={[s.status, isMe ? s.statusMe : s.statusOther]}>{String(status).startsWith('Seen') ? status : ''}{(msg as any).edited_at ? ' · edited' : ''}</Text>
            </View>
          )}
          {showTs && <Text style={[s.tsLabel, isMe ? s.tsLabelMe : s.tsLabelOther]}>{fmtTime(msg.created_at)}</Text>}
        </Pressable>
      </View>
    );
  };

  const canSend = message.trim().length > 0;
  // Stop, upload, then send. The recording is only discarded once the message
  // exists, so a failed upload does not lose what was said.
  const sendVoiceNote = useCallback(async () => {
    if (voiceSending.current || !currentUserId) return;
    voiceSending.current = true; setSendingVoice(true);
    const scope = voiceScopeRef.current;
    try {
      const result = await voice.stop();
      if (!result || voiceScopeRef.current !== scope) return;
      const { url } = await uploadMedia('chat-media', currentUserId, {
        uri: result.uri, kind: 'audio', ext: 'm4a', mimeType: 'audio/m4a', base64: null,
      }, { filename: 'voice_' + Date.now() + '.m4a' });
      if (voiceScopeRef.current !== scope) return;
      const queued = await doSend('', url, 'audio', null, replyTo?.id ?? null, result.durationSec, undefined);
      if (queued && voiceScopeRef.current === scope) voice.clearResult();
    } catch {
      if (voiceScopeRef.current === scope) Alert.alert('Could not send', 'Your recording is saved here. Tap Send to retry.');
    } finally {
      if (voiceScopeRef.current === scope) { voiceSending.current = false; setSendingVoice(false); }
    }
  }, [voice, currentUserId, replyTo, doSend]);
  const toolbarMaxH = toolbarH.interpolate({ inputRange: [0, 1], outputRange: [0, 160] });

  const renderInfoMediaTab = () => {
    if (infoLoading) return <View style={s.infoTabLoading}><ActivityIndicator color={t.ink.primary} /></View>;
    if (infoMedia.length === 0) return <Text style={s.infoEmpty}>No photos or videos yet</Text>;
    return (
      <View style={s.mediaGrid}>
        {infoMedia.map(m => (
          <TouchableOpacity key={m.id} style={s.mediaGridItem} activeOpacity={0.85}
            onPress={() => {
              if (!m.media_url) return;
              const scope = attachmentScopeRef.current;
              setShowInfoModal(false);
              setTimeout(() => {
                if(scope !== attachmentScopeRef.current || !mountedRef.current) return;
                if (m.media_type === 'video') setFullscreenVideo(m.media_url);
                else setFullscreenImg(m.media_url);
              }, 250);
            }}>
            {m.media_type === 'video' && !m.thumbnail_url ? (
              <View style={{ width: '100%', height: '100%', backgroundColor: '#1C1C1E' }} />
            ) : (
              <ExpoImage source={{ uri: m.media_type === 'video' ? (m.thumbnail_url || m.media_url) : m.media_url }} style={{ width: Math.floor((SCREEN_W - 28 - 6) / 3), height: Math.floor((SCREEN_W - 28 - 6) / 3) }} contentFit="cover" cachePolicy="memory-disk" />
            )}
            {m.media_type === 'video' && (
              <View style={s.mediaPlayOverlay}><Feather name="play" size={20} color="#FFF" /></View>
            )}
            {m.media_type === 'gif' && (
              <View style={s.gifBadge}><Text style={s.gifBadgeTxt}>GIF</Text></View>
            )}
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const renderInfoFilesTab = () => {
    if (infoLoading) return <View style={s.infoTabLoading}><ActivityIndicator color={t.ink.primary} /></View>;
    if (infoFiles.length === 0) return <Text style={s.infoEmpty}>No files yet</Text>;
    return (
      <View>
        {infoFiles.map(f => (
          <TouchableOpacity key={f.id} style={s.infoFileRow} activeOpacity={0.7}
            onPress={() => { if (f.media_url) Linking.openURL(f.media_url); }}>
            <View style={s.infoFileIconBg}>
              <Feather name="file-text" size={18} color={t.ink.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.infoFileName} numberOfLines={1}>
                {f.text?.replace('📄 ', '') || 'Document'}
              </Text>
              <Text style={s.infoFileMeta}>
                {f.sender_id === currentUserId ? 'You' : chatTitle} · {fmtShortDate(f.created_at)}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color="#C6C6C8" />
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const renderInfoStarredTab = () => {
    if (infoLoading) return <View style={s.infoTabLoading}><ActivityIndicator color={t.ink.primary} /></View>;
    if (infoStarred.length === 0) return <Text style={s.infoEmpty}>No starred messages yet</Text>;
    return (
      <View>
        {infoStarred.map(star => {
          const m = star.msg;
          const senderName = star.starred_by === currentUserId ? 'You' : (m?.sender_name || 'Member');
          const preview = m?.text ||
            (m?.media_type === 'image' ? '📷 Photo'
            : m?.media_type === 'video' ? '🎬 Video'
            : m?.media_type === 'gif' ? '🎞 GIF'
            : m?.media_type === 'document' ? '📄 Document'
            : '📎 Media');
          return (
            <View key={star.id} style={s.infoStarredRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.infoStarredTxt} numberOfLines={3}>{preview}</Text>
                <Text style={s.infoStarredMeta}>
                  From {senderName} · Starred {fmtShortDate(star.starred_at)}
                </Text>
              </View>
              <TouchableOpacity style={s.infoStarredUnstar}
                onPress={() => unstarFromInfo(star.id, star.message_id)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.6}>
                <Text style={s.infoStarredIcon}>★</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(11,30,61,0.06)', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="chevron-back" size={22} color={t.ink.primary} /></View>
        </TouchableOpacity>
        <TouchableOpacity style={s.headerCenter} activeOpacity={0.7}
          onPress={() => setShowInfoModal(true)}>
          {isGroup
              ? (groupAvatarUrl
                ? <ExpoImage source={{ uri: groupAvatarUrl }} style={s.hAvatar} contentFit="cover" />
                : <View style={s.hAvatarFb}><Text style={{ fontSize: 20 }}>{groupEmoji}</Text></View>)
              : otherUser?.avatar_url
                ? <ExpoImage source={{ uri: otherUser.avatar_url }} style={s.hAvatar} contentFit="cover" />
                : <View style={s.hAvatarFb}><Text style={s.hAvatarTxt}>{otherInits}</Text></View>}
          <View style={s.hInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 }}>
              <TierName userId={isGroup ? undefined : otherUser?.id} baseStyle={s.hName} text={chatTitle} />
              {!isGroup ? <VerifiedBadge userId={otherUser?.id} size={14} /> : null}
            </View>
            {isGroup && otherTyping ? <Text style={[s.hSub, { color: '#34C759' }]} numberOfLines={1}>{String(membersById[typingUserId ?? '']?.full_name || 'Someone').split(' ')[0]} is typing...</Text>
              : !isGroup && otherTyping ? <Text style={[s.hSub, { color: '#34C759' }]}>typing...</Text>
              : !isGroup && otherOnline ? <Text style={[s.hSub, { color: '#34C759' }]}>online</Text>
              : !isGroup && otherUser?.username ? <Text style={s.hSub}>@{otherUser.username}</Text>
              : isGroup ? <Text style={s.hSub}>{isCommunityChat ? 'Community chat · tap for info' : 'Tap for info'}</Text> : null}
          </View>
        </TouchableOpacity>
        <View style={s.headerActions}>
          <TouchableOpacity onPress={() => startCall(false)} style={s.hActionBtn} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(11,30,61,0.06)', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="call" size={18} color={t.ink.primary} /></View>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSearchActive(p => !p)}
            style={s.hActionBtn} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: searchActive ? 'rgba(11,30,61,0.12)' : 'rgba(11,30,61,0.06)', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="search" size={18} color={t.ink.primary} /></View>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => startCall(true)} style={s.hActionBtn} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(11,30,61,0.06)', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="videocam" size={19} color={t.ink.primary} /></View>
          </TouchableOpacity>
        </View>
      </View>

      {searchActive && (
        <View style={s.searchBar}>
          <Feather name="search" size={15} color={t.ink.muted} />
          <TextInput value={searchQuery} onChangeText={setSearchQuery}
            placeholder="Search in conversation..." placeholderTextColor={t.ink.muted}
            style={s.searchBarInput} autoFocus returnKeyType="search" clearButtonMode="while-editing" />
          <TouchableOpacity onPress={() => { setSearchActive(false); setSearchQuery(''); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={16} color={t.ink.muted} />
          </TouchableOpacity>
        </View>
      )}

      {!isGroup && !!passedUserId && !!conversationId && (
        <SendMoneySheet
          visible={payOpen}
          onClose={() => setPayOpen(false)}
          recipientId={passedUserId}
          listingId={ctxCard?.kind === 'market' ? ctxCard.refId : null}
          initialAmount={ctxCard?.kind === 'market' ? (ctxCard.price ?? null) : null}
          recipientName={(route.params as any)?.userName || 'them'}
          conversationId={conversationId}
          onRequested={async (amt, cur) => {
            try {
              await supabase.from('messages').insert({
                conversation_id: conversationId,
                sender_id: currentUserId,
                receiver_id: passedUserId,
                text: 'Requested ' + cur + ' ' + amt.toFixed(2),
                is_system_message: true,
              });
            } catch (e) { console.log('[PaymentRequest]', e); }
          }}
          onSent={async (_amt, _cur, txId) => {
            const ownerId = useAuthStore.getState().session?.user?.id;
            if (!ownerId || !conversationId || ownerId !== currentUserId) return;
            const context = [ownerId, conversationId].join(':');
            try {
              // The database trigger creates one canonical payment message.
              // Reading and merging its id also deduplicates a realtime arrival.
              const receipt = await loadConfirmedPaymentReceipt(supabase, { ownerId, conversationId, txId });
              if (!mountedRef.current || paymentChatRef.current !== context ||
                  useAuthStore.getState().session?.user?.id !== ownerId) return;
              await mergeMsg(receipt as MessageItem);
            } catch {
              if (mountedRef.current && paymentChatRef.current === context &&
                  useAuthStore.getState().session?.user?.id === ownerId) {
                Alert.alert('Payment completed', 'The chat receipt is still loading. Reopen this conversation to refresh it. Do not send the payment again.');
              }
            }
          }}
        />
      )}

      {ctxCard && (
        <TouchableOpacity
          style={s.ctxCard}
          activeOpacity={0.85}
          onPress={() => { if (ctxCard.kind === 'market') navigation.navigate('Market', { screen: 'ListingDetail', params: { listingId: ctxCard.refId } }); }}
        >
          {ctxCard.image
            ? <Image source={{ uri: ctxCard.image }} style={s.ctxThumb} />
            : <View style={[s.ctxThumb, s.ctxThumbFallback]}><Feather name={ctxCard.kind === 'jobs' ? 'briefcase' : 'tag'} size={18} color="#8E8E93" /></View>}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.ctxLabel}>{ctxCard.kind === 'jobs' ? 'JOB ENQUIRY' : 'MARKET'}</Text>
            <Text style={s.ctxTitle} numberOfLines={1}>{ctxCard.title}</Text>
            {!!ctxCard.sub && <Text style={s.ctxSub} numberOfLines={1}>{ctxCard.sub}</Text>}
          </View>
          <Feather name="chevron-right" size={16} color="#C7C7CC" />
        </TouchableOpacity>
      )}

      {pinnedMsg ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F4F7FB', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E1E6EE', paddingHorizontal: 14, paddingVertical: 8, gap: 8 }}>
          <Feather name="paperclip" size={13} color="#1D7A38" />
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: t.ink.primary }}>{pinnedMsg.text || 'Media message'}</Text>
          <TouchableOpacity onPress={() => togglePin(pinnedMsg)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={14} color="#5B6B84" />
          </TouchableOpacity>
        </View>
      ) : null}
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}>
        {loading ? (
          <ChatSkeleton />
        ) : (
          <FlatList ref={flatListRef} data={listData} inverted
            onScroll={event => {
              const atLatest = event.nativeEvent.contentOffset.y < 64;
              const returned = atLatest && !atLatestRef.current;
              atLatestRef.current = atLatest;
              if (returned) void markRead();
            }}
            scrollEventThrottle={100}
            ListHeaderComponent={isGroup && seenByNames.length > 0 ? (
              <TouchableOpacity onPress={() => { const m = messagesRef.current?.[0]; if (m) openSeenInfo(m); }} activeOpacity={0.7}
                style={{ alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingTop: 2, paddingBottom: 6 }}>
                <Feather name="eye" size={11} color="rgba(11,30,61,0.45)" />
                <Text style={{ fontSize: 11.5, fontWeight: '600', color: 'rgba(11,30,61,0.5)' }}>
                  Seen by {seenByNames.length}{groupMembers.length > 1 && seenByNames.length >= groupMembers.length - 1 ? ' · everyone' : ''}
                </Text>
              </TouchableOpacity>
            ) : null}
            maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            ListFooterComponent={historyError || hasOlder ? (
              <TouchableOpacity accessibilityRole="button" disabled={loadingOlder}
                onPress={() => historyCursor.current ? loadOlderMessages() : fetchMessages()}
                style={{ padding: 16, alignItems: 'center' }}>
                <Text style={{ color: t.ink.primary }}>{loadingOlder ? 'Loading older messages…' : historyError || 'Load older messages'}</Text>
                {historyError ? <Text style={{ color: t.ink.muted }}>Tap to retry</Text> : null}
              </TouchableOpacity>
            ) : null}
            keyExtractor={(item: any) => item.type === 'sep' ? item.id : item.data.id}
            renderItem={renderMsg} contentContainerStyle={s.list}
            keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
            removeClippedSubviews
            windowSize={10}
            maxToRenderPerBatch={12}
            initialNumToRender={15}
            ListEmptyComponent={
              <View style={s.empty}>
                {otherUser?.avatar_url
                    ? <ExpoImage source={{ uri: otherUser.avatar_url }} style={s.emptyAvatar} contentFit="cover" />
                    : <View style={s.emptyAvatarFb}><Text style={s.emptyAvatarTxt}>{otherInits}</Text></View>}
                <Text style={s.emptyName}>{chatTitle}</Text>
                {otherUser?.username && <Text style={s.emptyHandle}>@{otherUser.username}</Text>}
                <Text style={s.emptyHint}>
                  {historyError ? 'Your messages will appear when the connection is restored.' : 'Send a message to start the conversation.'}
                </Text>
              </View>
            } />
        )}

        <Animated.View style={[s.typingWrap, { opacity: typingOpacity }]} pointerEvents="none">
          <View style={s.sideAvatarSlot}>
            {(() => {
              const tp: any = isGroup ? (typingUserId ? membersById[typingUserId] : null) : otherUser;
              if (!tp) return null;
              return tp.avatar_url
                ? <ExpoImage source={{ uri: tp.avatar_url }} style={s.sideAvatar} contentFit="cover" />
                : <View style={s.sideAvatarFb}><Text style={s.sideAvatarTxt}>{initials(tp.full_name)}</Text></View>;
            })()}
          </View>
          <View style={[s.bubble, s.bubbleOther, s.typingBubble]}>
            <Animated.View style={[s.typingDot, { transform: [{ translateY: dot1 }] }]} />
            <Animated.View style={[s.typingDot, { transform: [{ translateY: dot2 }] }]} />
            <Animated.View style={[s.typingDot, { transform: [{ translateY: dot3 }] }]} />
          </View>
        </Animated.View>

{isGroup && liveGroupCall && (
          <TouchableOpacity onPress={joinLiveCall} activeOpacity={0.88}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginHorizontal: 12, marginBottom: 6, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 999, backgroundColor: '#059669' }}>
            <Feather name={liveGroupCall.is_video ? 'video' : 'phone'} size={16} color="#FFFFFF" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700' }}>Ongoing {liveGroupCall.is_video ? 'video ' : ''}call · {liveGroupCall.joinedNames.length} in call</Text>
              {liveGroupCall.joinedNames.length > 0 && (
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 1 }} numberOfLines={1}>
                  {liveGroupCall.joinedNames.slice(0, 3).join(', ')}{liveGroupCall.joinedNames.length > 3 ? ' +' + (liveGroupCall.joinedNames.length - 3) : ''}
                </Text>
              )}
            </View>
            <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '800' }}>Tap to join</Text>
          </TouchableOpacity>
        )}
        {isGroup && mentionQuery !== null && (
          <View style={{ maxHeight: 190, backgroundColor: t.surface.sunken, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(11,30,61,0.08)' }}>
            {groupMembers
              .filter((gm: any) => gm.profile?.id !== currentUserId && gm.profile?.username
                && gm.profile.username.toLowerCase().startsWith(mentionQuery.toLowerCase()))
              .slice(0, 5)
              .map((gm: any) => (
                <TouchableOpacity key={gm.profile.id}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 9 }}
                  onPress={() => insertMention(gm.profile.username)} activeOpacity={0.8}>
                  {gm.profile.avatar_url
                    ? <ExpoImage source={{ uri: gm.profile.avatar_url }} style={{ width: 30, height: 30, borderRadius: 15 }} contentFit="cover" />
                    : <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: '#0B1E3D', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#FFF', fontSize: 12, fontWeight: '700' }}>{initials(gm.profile.full_name)}</Text></View>}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13.5, fontWeight: '700', color: t.ink.primary }} numberOfLines={1}><TierName userId={((gm.profile) as any)?.id ?? ((gm.profile) as any)?.user_id} baseStyle={{ fontSize: 13.5, fontWeight: '700', color: t.ink.primary }} text={gm.profile.full_name || ''} numberOfLines={1} /> <VerifiedBadge userId={((gm.profile) as any)?.id ?? ((gm.profile) as any)?.user_id} size={12} /></Text>
                    <Text style={{ fontSize: 11.5, color: 'rgba(11,30,61,0.5)' }} numberOfLines={1}>@{gm.profile.username}</Text>
                  </View>
                </TouchableOpacity>
              ))}
          </View>
        )}
        {waitingMessages.length > 0 && <ScrollView style={{ maxHeight: 150 }} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 8, gap: 8 }}>
          {waitingMessages.slice(0, 20).map(item => <View key={item.key} style={{ padding: 10, borderRadius: 12, backgroundColor: t.surface.sunken }}>
            <Text style={{ color: t.ink.primary, fontWeight: '700' }}>{item.failed || !item.id ? 'Delivery needs review' : 'Waiting for confirmation'}</Text>
            <Text style={{ color: t.ink.secondary, marginTop: 3 }} numberOfLines={2}>{item.text || 'Attachment'}</Text>
            {!item.id ? <Text style={{ color: t.ink.secondary, marginTop: 3 }}>Check this chat before sending this older saved message again.</Text> : null}
            <View style={{ flexDirection: 'row', gap: 16 }}>
              {item.id ? <TouchableOpacity accessibilityRole="button" onPress={() => { void retryOutboxMessage(item.key).catch(() => Alert.alert('Could not check delivery', 'Please try again.')); }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: t.ink.primary }}>Check delivery</Text></TouchableOpacity> : null}
              {item.failed || !item.id ? <TouchableOpacity accessibilityRole="button" onPress={() => useNetStore.getState().removeFromOutbox(item.key)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: t.ink.primary }}>Dismiss saved copy</Text></TouchableOpacity> : null}
            </View>
          </View>)}
          {waitingMessages.length > 20 ? <Text style={{ color: t.ink.secondary }}>{waitingMessages.length - 20} more saved messages remain.</Text> : null}
        </ScrollView>}
        {replyTo && (
          <View style={s.replyBanner}>
            <View style={s.replyBannerAccent} />
            <View style={s.replyBannerContent}>
              <Text style={s.replyBannerLabel}>Replying to {replyTo.sender_id === currentUserId ? 'yourself' : chatTitle}</Text>
              <Text style={s.replyBannerPrev} numberOfLines={1}>{replySource}</Text>
            </View>
            <TouchableOpacity onPress={() => setReplyTo(null)} style={s.replyBannerClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={16} color={t.ink.muted} />
            </TouchableOpacity>
          </View>
        )}

        <Animated.View style={[s.toolbar, { maxHeight: toolbarMaxH, overflow: 'hidden' }]}>
            {(
              <View style={s.toolbarGrid}>
                {[
                  { iconName: 'camera', label: 'Camera', action: openCamera },
                  { iconName: 'image', label: 'Gallery', action: pickAndSendMedia },
                  { iconName: 'film', label: 'GIFs', action: () => { setShowToolbar(false); setShowGifs(true); } },
                  { iconName: 'file-text', label: 'Files', action: pickAndSendDocument },
                  { iconName: 'user', label: 'Contact', action: () => { setShowToolbar(false); setShareDetails('contact'); } },
                  { iconName: 'map-pin', label: 'Location', action: () => { setShowToolbar(false); setShareDetails('location'); } },
                  { iconName: 'info', label: 'Info', action: () => { setShowToolbar(false); setShowInfoModal(true); } },
                ].map(btn => (
                  <TouchableOpacity key={btn.label} style={s.toolbarBtn} onPress={btn.action} activeOpacity={0.7}>
                    <View style={s.toolbarBtnInner}>
                      <Feather name={btn.iconName as any} size={22} color={t.ink.primary} />
                    </View>
                    <Text style={s.toolbarBtnLbl}>{btn.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
        </Animated.View>

        {voice.recording || voice.result ? (
            <View style={[s.voiceBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
              <TouchableOpacity
                onPress={() => voice.cancel()}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole='button'
                accessibilityLabel='Cancel recording'
              >
                <Feather name='trash-2' size={19} color='#FF3B30' />
              </TouchableOpacity>

              <View style={s.voiceDot} />
              <Text style={s.voiceTimer}>{formatVoiceDuration(voice.seconds)}</Text>
              <Text style={s.voiceHint} numberOfLines={1}>
                {voice.result ? 'Ready to send' : voice.atLimit ? 'Maximum length reached' : 'Recording'}
              </Text>

              <TouchableOpacity
                onPress={sendVoiceNote}
                disabled={sendingVoice}
                style={s.voiceSend}
                activeOpacity={0.85}
                accessibilityRole='button'
                accessibilityLabel='Send voice message'
              >
                {sendingVoice
                  ? <ActivityIndicator color='#FFF' size={14} />
                  : <Feather name='arrow-up' size={18} color='#FFF' />}
              </TouchableOpacity>
            </View>
          ) : (<>
          {isBizSession && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" style={{ height: 44, flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 7, gap: 8, alignItems: 'center' }}>
              {savedReplies.map(r => (
                <TouchableOpacity key={r.id} activeOpacity={0.8} onPress={() => setMessage(r.body)}
                  onLongPress={() => Alert.alert('Remove saved reply?', r.body.slice(0, 60), [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => { await supabase.from('business_saved_replies').delete().eq('id', r.id); setSavedReplies(p => p.filter(x => x.id !== r.id)); } }])}
                  style={{ borderWidth: 1.2, borderColor: 'rgba(11,30,61,0.14)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: t.surface.sunken }}>
                  <Text numberOfLines={1} style={{ fontSize: 12.5, color: t.ink.primary, fontWeight: '600', maxWidth: 180 }}>{r.body}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity activeOpacity={0.8} accessibilityLabel="Save current text as a reply"
                onPress={async () => { const b = message.trim(); if (!b) { Alert.alert('Type it first', 'Write the reply in the box, then tap plus to save it.'); return; } const { data } = await supabase.from('business_saved_replies').insert({ user_id: currentUserId, body: b }).select().single(); if (data) setSavedReplies(p => [...p, data]); }}
                style={{ borderWidth: 1.2, borderColor: 'rgba(29,122,56,0.4)', borderRadius: 999, width: 30, height: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(29,122,56,0.06)' }}>
                <Feather name="plus" size={15} color="#1D7A38" />
              </TouchableOpacity>
            </ScrollView>
          )}
          <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <View style={s.inputWrap}>
              <TextInput ref={inputRef} value={message} onChangeText={handleTextChange}
                placeholder="Message"
                placeholderTextColor={t.ink.muted}
                style={s.input} multiline maxLength={2000} returnKeyType="default" blurOnSubmit={false} />

              {/* Attachment and payment live inside the pill, the way WhatsApp
                  does it, so the bar reads as one control rather than a row of
                  loose buttons. */}
              <TouchableOpacity style={s.inlineBtn}
                onPress={() => { setShowToolbar(p => { if (p) setShowGifs(false); return !p; }); }}
                activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
                <Ionicons name={showToolbar ? 'close' : 'add'} size={24} color={showToolbar ? t.ink.primary : t.ink.muted} />
              </TouchableOpacity>

              {!isGroup && !!passedUserId && (
                <TouchableOpacity style={s.inlineBtn} onPress={() => setPayOpen(true)}
                  activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
                  <Ionicons name="card" size={21} color={t.ink.muted} />
                </TouchableOpacity>
              )}
            </View>

            {uploadingMedia ? (
              <View style={s.sendBtn}><ActivityIndicator color="#FFF" size={14} /></View>
            ) : canSend ? (
              <Animated.View style={{ transform: [{ scale: sendScale }] }}>
              <TouchableOpacity onPress={() => { springSend(); sendMessage(); }} style={s.sendBtn} activeOpacity={0.85}>
                <Ionicons name="send" size={17} color="#FFF" style={{ marginLeft: 2 }} />
              </TouchableOpacity>
              </Animated.View>
            ) : (
              <TouchableOpacity
                onPress={() => { voice.start(); }}
                disabled={sendingVoice}
                style={[s.sendBtn, voice.recording && { backgroundColor: '#FF3B30' }]}
                activeOpacity={0.8}
                accessibilityRole='button'
                accessibilityLabel='Record a voice message'
              >
                {sendingVoice
                  ? <ActivityIndicator color='#FFF' size={14} />
                  : <Ionicons name='mic' size={20} color='#FFF' />}
              </TouchableOpacity>
            )}
          </View>
          </>
        )}
      <Modal visible={!!seenSheet} transparent animationType="slide" onRequestClose={() => setSeenSheet(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(11,30,61,0.45)' }} activeOpacity={1} onPress={() => setSeenSheet(null)} />
        <View style={{ backgroundColor: t.surface.sunken, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8, paddingBottom: 34, maxHeight: '70%' }}>
          <View style={{ alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: 'rgba(11,30,61,0.16)', marginBottom: 10 }} />
          <Text style={{ fontSize: 16.5, fontWeight: '800', color: t.ink.primary, paddingHorizontal: 18, marginBottom: 10 }}>Message info</Text>
          {(seenSheet as any)?.rows === null && <ActivityIndicator style={{ marginVertical: 24 }} color="#0B1E3D" />}
          {(seenSheet as any)?.error ? <Text style={{ textAlign: 'center', color: 'rgba(11,30,61,0.5)', paddingVertical: 20 }}>{(seenSheet as any).error}</Text> : null}
          {Array.isArray(seenSheet?.rows) && seenSheet!.rows.length === 0 && !(seenSheet as any)?.error ? <Text style={{ textAlign: 'center', color: 'rgba(11,30,61,0.5)', paddingVertical: 20 }}>No other members</Text> : null}
          <ScrollView>
            {(seenSheet?.rows || []).map((r, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 10 }}>
                {r.avatar ? <ExpoImage source={{ uri: r.avatar }} style={{ width: 38, height: 38, borderRadius: 19 }} contentFit="cover" /> : <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#0B1E3D', alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#FFF', fontWeight: '700' }}>{initials(r.name)}</Text></View>}
                <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: t.ink.primary }} numberOfLines={1}>{r.name}</Text>
                {r.seenAt
                  ? <View style={{ alignItems: 'flex-end' }}><Text style={{ fontSize: 12.5, fontWeight: '700', color: '#059669' }}>Seen</Text><Text style={{ fontSize: 11, color: 'rgba(11,30,61,0.45)' }}>{new Date(r.seenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text></View>
                  : <Text style={{ fontSize: 12.5, fontWeight: '600', color: 'rgba(11,30,61,0.4)' }}>Pending</Text>}
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>
      <Modal visible={showGifs} transparent animationType="slide" onRequestClose={() => setShowGifs(false)}>
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11,30,61,0.45)' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowGifs(false)} />
          <View style={{ backgroundColor: t.surface.sunken, borderTopLeftRadius: 22, borderTopRightRadius: 22, height: '78%', paddingTop: 8 }}>
            <View style={{ alignSelf: 'center', width: 38, height: 4.5, borderRadius: 3, backgroundColor: 'rgba(11,30,61,0.16)', marginBottom: 6 }} />
            <View style={{ flexDirection: 'row', alignSelf: 'center', backgroundColor: 'rgba(11,30,61,0.06)', borderRadius: 999, padding: 3, marginBottom: 6 }}>
              {[{ k: false, l: 'GIFs' }, { k: true, l: 'Stickers' }].map(t => (
                <TouchableOpacity key={t.l} onPress={() => setStickerMode(t.k)}
                  style={{ paddingHorizontal: 18, paddingVertical: 7, borderRadius: 999, backgroundColor: stickerMode === t.k ? '#0B1E3D' : 'transparent' }}>
                  <Text style={{ fontSize: 12.5, fontWeight: '700', color: stickerMode === t.k ? '#FFF' : '#0B1E3D' }}>{t.l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <GifPicker key={stickerMode ? 'st' : 'gf'} gifMode={stickerMode ? 'stickers' : 'gifs'} onSelect={stickerMode ? sendSticker : sendGif} onBack={() => setShowGifs(false)} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <ChatImageEditor
        visible={!!editTarget}
        image={editTarget}
        onCancel={() => setEditTarget(null)}
        onDone={(out) => { setEditTarget(null); chooseAndSendImage(out); }}
      />
      </KeyboardAvoidingView>

      <Modal visible={showInfoModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowInfoModal(false)}>
        <SafeAreaView style={[s.infoSafe, { paddingTop: insets.top }]} edges={['left', 'right', 'bottom']}>
          <View style={s.infoHeader}>
            <TouchableOpacity onPress={() => setShowInfoModal(false)} style={s.infoDoneBtn}>
              <Text style={s.infoDoneTxt}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={s.infoContact}>
              {isGroup
                  ? (groupAvatarUrl
                    ? <ExpoImage source={{ uri: groupAvatarUrl }} style={s.infoAvatar} contentFit="cover" />
                    : <View style={[s.infoAvatarFb, { width: 90, height: 90, borderRadius: 45 }]}>
                        <Text style={{ fontSize: 38 }}>{groupEmoji}</Text>
                      </View>)
                  : otherUser?.avatar_url
                    ? <ExpoImage source={{ uri: otherUser.avatar_url }} style={s.infoAvatar} contentFit="cover" />
                    : <View style={s.infoAvatarFb}><Text style={s.infoAvatarTxt}>{otherInits}</Text></View>}
              <Text style={[s.infoName, { fontSize: 23, fontWeight: '800' }]}>{chatTitle}</Text>
              {isCommunityChat ? <Text style={s.infoHandle}>Community chat · posts and announcements live on the community page</Text> : null}
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
                {[
                  ...(isCommunityChat ? [{ icon: 'people', label: 'Community', act: () => { setShowInfoModal(false); openCommunity(); } }] : []),
                  { icon: 'call', label: 'Audio', act: () => { setShowInfoModal(false); startCall(false); } },
                  { icon: 'videocam', label: 'Video', act: () => { setShowInfoModal(false); startCall(true); } },
                  { icon: 'search', label: 'Search', act: () => { setShowInfoModal(false); setSearchActive(true); } },
                ].map(chip => (
                  <TouchableOpacity key={chip.label} onPress={chip.act} activeOpacity={0.75}
                    style={{ width: 86, paddingVertical: 10, borderRadius: 12, backgroundColor: 'rgba(11,30,61,0.05)', alignItems: 'center', gap: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.1)' }}>
                    <Ionicons name={chip.icon as any} size={20} color={t.ink.primary} />
                    <Text style={{ fontSize: 12, fontWeight: '600', color: t.ink.primary }}>{chip.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {!isGroup && otherUser?.username && <Text style={s.infoHandle}>@{otherUser.username}</Text>}
              {!isGroup && otherUser?.degree_program && (
                <Text style={s.infoProg}>{otherUser.degree_program}{otherUser?.graduation_year ? ` · ${otherUser.graduation_year}` : ''}</Text>
              )}
              {!isGroup && otherUser?.location && <Text style={s.infoLoc}>📍 {otherUser.location}</Text>}
              {isGroup && <Text style={s.infoLoc}>{groupMembers.length} members</Text>}

            </View>

            <View style={s.infoQuickRow}>
              {(!isGroup ? [
                { iconName: 'message-circle', label: 'Message', action: () => setShowInfoModal(false) },
                { iconName: 'user', label: 'Profile', action: () => { setShowInfoModal(false); if (otherUser?.id) navigation.navigate('UserProfile', { userId: otherUser.id }); } },
                { iconName: 'phone', label: 'Call', action: () => { setShowInfoModal(false); startCall(false); } },
                { iconName: 'video', label: 'Video', action: () => { setShowInfoModal(false); startCall(true); } },
                { iconName: infoMuted ? 'bell-off' : 'bell', label: infoMuted ? 'Unmute' : 'Mute',
                  action: async () => {
                    if (!currentUserId || !conversationId) return;
                    const next = !infoMuted; setInfoMuted(next);
                    await supabase.from('conversation_settings').upsert(
                      { conversation_id: conversationId, user_id: currentUserId, is_muted: next, updated_at: new Date().toISOString() },
                      { onConflict: 'conversation_id,user_id' }
                    )// @ts-ignore
.then((r: any) => { if (r?.error) { setMuted(!next); Alert.alert('Not saved', 'Mute could not be changed. Try again.'); } }).catch(() => { setMuted(!next); });
                  }},
              ] : [
                { iconName: 'users', label: 'Manage', action: () => { setShowInfoModal(false); navigation.navigate('GroupManagement', { conversationId, groupName: chatTitle, groupEmoji }); } },
                { iconName: infoMuted ? 'bell-off' : 'bell', label: infoMuted ? 'Unmute' : 'Mute',
                  action: async () => {
                    const next = !infoMuted; setInfoMuted(next);
                    await supabase.from('conversation_settings').upsert(
                      { conversation_id: conversationId, user_id: currentUserId, is_muted: next, updated_at: new Date().toISOString() },
                      { onConflict: 'conversation_id,user_id' }
                    ).then(() => {}, () => {});
                  }},
                { iconName: 'log-out', label: 'Leave', action: () => {
                  setShowInfoModal(false);
                  Alert.alert('Leave group?', 'You will stop receiving messages from this group.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Leave', style: 'destructive', onPress: async () => {
                      await supabase.from('conversation_members').delete()
                        .eq('conversation_id', conversationId).eq('user_id', currentUserId);
                      navigation.goBack();
                    }},
                  ]);
                }},
              ]).map((q: any) => (
                <TouchableOpacity key={q.label} style={s.infoQuickBtn} onPress={q.action} activeOpacity={0.7}>
                  <View style={s.infoQuickInner}>
                    <Feather name={q.iconName} size={20} color={t.ink.primary} />
                  </View>
                  <Text style={s.infoQuickLbl}>{q.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.infoTabsSection}>
              <View style={s.infoTabBar}>
                {(['media', 'files', 'starred'] as InfoTab[]).map(t => (
                  <TouchableOpacity key={t} style={[s.infoTab, infoTab === t && s.infoTabActive]}
                    onPress={() => setInfoTab(t)} activeOpacity={0.7}>
                    <Text style={[s.infoTabTxt, infoTab === t && s.infoTabTxtActive]}>
                      {t === 'media' ? `Media (${infoMedia.length})` : t === 'files' ? `Files (${infoFiles.length})` : `Starred (${infoStarred.length})`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={s.infoTabBody}>
                {infoTab === 'media' && renderInfoMediaTab()}
                {infoTab === 'files' && renderInfoFilesTab()}
                {infoTab === 'starred' && renderInfoStarredTab()}
              </View>
            </View>

            {!isGroup && otherUser?.bio && (
              <View style={s.infoSection}>
                <Text style={s.infoSectionTitle}>About</Text>
                <Text style={s.infoBio}>{otherUser.bio}</Text>
              </View>
            )}

            {isGroup && groupMembers.length > 0 && (
              <View style={s.infoSection}>
                <Text style={s.infoSectionTitle}>Members</Text>
                {groupMembers.slice(0, 8).map((m: any) => (
                  <View key={m.user_id} style={s.infoMemberRow}>
                    {m.profile?.avatar_url
                      ? <Image source={{ uri: m.profile.avatar_url }} style={s.infoMemberAvatar} />
                      : <View style={[s.infoMemberAvatar, { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' }]}>
                          <Text style={{ fontSize: 12, color: '#FFF', fontWeight: '700' }}>
                            {(m.profile?.full_name?.[0] || 'U').toUpperCase()}
                          </Text>
                        </View>}
                    <Text style={s.infoMemberName}><TierName userId={((m.profile) as any)?.id ?? ((m.profile) as any)?.user_id} baseStyle={s.infoMemberName} text={m.profile?.full_name || 'Member' || ''} /> <VerifiedBadge userId={((m.profile) as any)?.id ?? ((m.profile) as any)?.user_id} size={12} /></Text>
                    {m.role === 'admin' && <View style={s.infoAdminBadge}><Text style={s.infoAdminTxt}>Admin</Text></View>}
                  </View>
                ))}
                {groupMembers.length > 8 && (
                  <TouchableOpacity onPress={() => { setShowInfoModal(false); navigation.navigate('GroupManagement', { conversationId, groupName: chatTitle, groupEmoji }); }}>
                    <Text style={s.infoSeeAll}>See all {groupMembers.length} members →</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

              <ChatInfoSections
                conversationId={conversationId}
                otherUserId={otherUser?.id ?? passedUserId ?? null}
                otherName={chatTitle}
                isGroup={isGroup}
                muted={infoMuted}
                onToggleMute={async () => {
                  const next = !infoMuted;
                  setInfoMuted(next);
                  if (conversationId && currentUserId) {
                    await supabase.from('conversation_settings').upsert(
                      { conversation_id: conversationId, user_id: currentUserId, is_muted: next, updated_at: new Date().toISOString() },
                      { onConflict: 'conversation_id,user_id' });
                  }
                }}
                onClose={() => setShowInfoModal(false)}
                navigation={navigation}
              />

            {!isGroup && (
              <View style={s.infoSection}>
                  <TouchableOpacity style={[s.infoDanger, { backgroundColor: '#F4F5F7', marginBottom: 10 }]} onPress={() => {
                    Alert.alert('Clear this chat?', 'Messages disappear for you only. The other person keeps their copy.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Clear', style: 'destructive', onPress: async () => {
                        const { error } = await supabase.rpc('clear_conversation', { p_conversation_id: conversationId });
                        if (error) { Alert.alert('Could not clear', error.message); return; }
                        setMessages([]);
                        setShowInfoModal(false);
                      }},
                    ]);
                  }}>
                    <Text style={[s.infoDangerTxt, { color: t.ink.muted }]}>Clear chat</Text>
                  </TouchableOpacity>
                <TouchableOpacity style={s.infoDanger} onPress={() => {
                  Alert.alert('Block user?', `${chatTitle} will not be able to message you.`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Block', style: 'destructive', onPress: async () => {
                      const recipientId = otherUser?.id ?? passedUserId;
                      if (recipientId) {
                        await supabase.from('blocked_users').insert({ blocker_id: currentUserId, blocked_id: recipientId }).select().maybeSingle();
                      }
                      setShowInfoModal(false);
                      navigation.goBack();
                    }},
                  ]);
                }}>
                  <Text style={s.infoDangerTxt}>Block {chatTitle}</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <Modal visible={!!editingMsg} transparent animationType="slide" onRequestClose={() => { setEditingMsg(null); setEditText(''); }}>
        <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end' }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={{ flex: 1 }} onPress={() => { setEditingMsg(null); setEditText(''); }} />
          <View style={s.editMsgSheet}>
            <View style={s.editMsgHeader}>
              <TouchableOpacity onPress={() => { setEditingMsg(null); setEditText(''); }}>
                <Text style={s.editMsgCancelTxt}>Cancel</Text>
              </TouchableOpacity>
              <Text style={s.editMsgTitle}>Edit message</Text>
              <TouchableOpacity onPress={saveEdit} disabled={!editText.trim()}>
                <Text style={[s.editMsgSaveTxt, !editText.trim() && { opacity: 0.4 }]}>Save</Text>
              </TouchableOpacity>
            </View>
            {editingMsg?.text && (
              <View style={s.editOriginal}>
                <Text style={s.editOriginalLabel}>Editing</Text>
                <Text style={s.editOriginalTxt} numberOfLines={2}>{editingMsg.text}</Text>
              </View>
            )}
            <TextInput value={editText} onChangeText={setEditText} style={s.editMsgInput}
              multiline autoFocus maxLength={2000}
              placeholderTextColor={t.ink.muted} placeholder="Edit your message..." />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!selectedMsg} transparent animationType="fade" onRequestClose={() => setSelectedMsg(null)}>
        <Pressable style={s.reactionOverlay} onPress={() => setSelectedMsg(null)}>
          <View style={s.reactionSheet}>
            <View style={s.reactionEmojis}>
              {REACTION_EMOJIS.map(e => (
                <TouchableOpacity key={e} style={s.reactionEmojiBtn} onPress={() => selectedMsg && toggleReaction(selectedMsg.id, e)}>
                  <Text style={s.reactionEmojiTxt}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.reactionActions}>
              {[
                ...(isGroup && selectedMsg?.sender_id === currentUserId ? [{ iconName: 'eye', label: 'Info', action: () => { const m = selectedMsg; setSelectedMsg(null); if (m) openSeenInfo(m); } }] : []),
                { iconName: 'corner-up-left', label: 'Reply', action: () => { setReplyTo(selectedMsg); setSelectedMsg(null); inputRef.current?.focus(); } },
                { iconName: 'copy', label: 'Copy', action: async () => {
                  if (selectedMsg?.text) { await Clipboard.setStringAsync(selectedMsg.text); setSelectedMsg(null); Alert.alert('Copied'); }
                }},
                ...(!selectedMsg?.view_limit ? [{ iconName: 'share-2', label: 'Share', action: async () => {
                  if (!selectedMsg) return;
                  const content = selectedMsg.text || selectedMsg.media_url || '';
                  setSelectedMsg(null); await Share.share({ message: content });
                }}] : []),
                { iconName: 'star',
                  label: selectedMsg && starredIds.has(selectedMsg.id) ? 'Unstar' : 'Star',
                  action: () => { if (selectedMsg) { toggleStar(selectedMsg); setSelectedMsg(null); } }},
                { iconName: 'bookmark',
                  label: savedIds.has(selectedMsg?.id || '') ? 'Unsave' : 'Save',
                  action: () => { if (selectedMsg) { toggleSaveMessage(selectedMsg.id); setSelectedMsg(null); } }},
                { iconName: 'corner-up-right', label: 'Forward', action: () => { if (selectedMsg) { openForward(selectedMsg); setSelectedMsg(null); } }},
                { iconName: 'paperclip',
                  label: pinnedMsg?.id === selectedMsg?.id ? 'Unpin' : 'Pin',
                  action: () => { if (selectedMsg) { togglePin(selectedMsg); setSelectedMsg(null); } }},
                ...(selectedMsg?.sender_id === currentUserId && selectedMsg?.text ? [{
                  iconName: 'edit-2', label: 'Edit', action: () => {
                    setEditingMsg(selectedMsg); setEditText(selectedMsg?.text || ''); setSelectedMsg(null);
                  }}] : []),
              // Two different things, deliberately separated. Removing it from
              // your own view is not the same as retracting it from someone
              // else's, and WhatsApp is right to make people choose.
              { iconName: 'eye-off', label: 'Delete for me', action: async () => {
                if (!selectedMsg || !currentUserId) return;
                const msgId = selectedMsg.id;
                setSelectedMsg(null);
                setMessages(prev => prev.filter(m => m.id !== msgId));
                const { error } = await supabase.from('message_deletions')
                  .insert({ user_id: currentUserId, message_id: msgId });
                if (error) { console.log('[DELETE_ME]', error.message); await fetchMessages(); }
              }},
              ...(selectedMsg?.sender_id === currentUserId && !(selectedMsg as any)?.deleted_at ? [{
                iconName: 'trash-2', label: 'Delete for everyone', destructive: true, action: async () => {
                  if (!selectedMsg) return;
                  const msgId = selectedMsg.id;
                  setSelectedMsg(null);
                  const { error } = await supabase.rpc('delete_message_for_everyone', { p_message_id: msgId });
                  if (error) {
                    Alert.alert('Could not delete', error.message);
                    return;
                  }
                  setMessages(prev => prev.map(m => m.id === msgId
                    ? { ...m, text: null, media_url: null, media_type: null, deleted_at: new Date().toISOString() } as any
                    : m));
                }
              }] : []),
              ].map(a => (
                <TouchableOpacity key={a.label} style={s.reactionActionBtn} onPress={a.action} activeOpacity={0.7}>
                  <View style={s.reactionActionInner}>
                    <Feather name={a.iconName as any} size={18} color={a.label === 'Delete' ? '#EF4444' : t.ink.primary} />
                  </View>
                  <Text style={[s.reactionActionLbl, a.label === 'Delete' && { color: '#EF4444' }]}>{a.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>

      {shareDetails && <ShareDetailsSheet key={voiceScope} kind={shareDetails} onClose={()=>setShareDetails(null)} onSend={async card=>{
        const scope=attachmentScope; if(attachmentScopeRef.current!==scope || useAuthStore.getState().session?.user.id !== session?.user.id)return false;
        return doSend(attachmentCardText(card),JSON.stringify(card),'link');
      }}/>}
      {privateMedia && privateMedia.userId === session?.user.id && privateMedia.scope === attachmentScope && <PrivateMediaViewer key={privateMedia.userId+':'+privateMedia.id} messageId={privateMedia.id} userId={privateMedia.userId}
        onClose={() => setPrivateMedia(current => current?.id === privateMedia.id && current?.userId === privateMedia.userId && current?.scope === privateMedia.scope ? null : current)} onConsumed={remaining => { if (remaining <= 0 && attachmentScopeRef.current === privateMedia.scope) setViewedOutIds(prev => new Set(prev).add(privateMedia.id)); }} />}
      <Modal visible={!!fullscreenImg} transparent animationType="fade" onRequestClose={() => setFullscreenImg(null)}>
        <View style={s.fullscreenRoot}>
          <TouchableOpacity style={s.fullscreenClose} onPress={() => setFullscreenImg(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="x" size={24} color="#FFF" />
          </TouchableOpacity>
          {fullscreenImg && (
            <ExpoImage source={{ uri: fullscreenImg }} style={{ width: SCREEN_W, flex: 1 }} contentFit="contain" cachePolicy="memory-disk" />
          )}
          {fullscreenImg && (
            <View style={s.fullscreenActions}>
              <TouchableOpacity style={s.fsActionBtn} onPress={() => saveMediaToDevice(fullscreenImg, 'image')} disabled={savingToDevice} activeOpacity={0.7}>
                {savingToDevice ? <ActivityIndicator color="#FFF" size={14} /> : <Feather name="download" size={16} color="#FFF" />}
                <Text style={s.fsActionTxt}>{savingToDevice ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.fsActionBtn} onPress={() => Share.share({ message: fullscreenImg })} activeOpacity={0.7}>
                <Feather name="share" size={16} color="#FFF" />
                <Text style={s.fsActionTxt}>Share</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>

      <Modal visible={!!capturedVideo} animationType="slide" onRequestClose={() => { if (!uploadingMedia) setCapturedVideo(null); }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center' }}>
          {capturedVideo ? <VideoPlayer uri={capturedVideo.uri} width={SCREEN_W} height={SCREEN_W * 0.75} fullscreen /> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-around', padding: 24 }}>
            <TouchableOpacity accessibilityRole="button" disabled={uploadingMedia} onPress={() => setCapturedVideo(null)} style={{ padding: 16 }}>
              <Text style={{ color: '#FFFFFF' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" disabled={uploadingMedia} onPress={async () => {
              if (capturedVideo && await sendMediaAssets([capturedVideo])) setCapturedVideo(null);
            }} style={{ padding: 16 }}>
              <Text style={{ color: '#FFFFFF' }}>{uploadingMedia ? 'Sending…' : 'Send video'}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      <Modal visible={!!fullscreenVideo} transparent animationType="fade" onRequestClose={() => setFullscreenVideo(null)}>
        <View style={s.fullscreenRoot}>
          <TouchableOpacity style={s.fullscreenClose} onPress={() => setFullscreenVideo(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="x" size={24} color="#FFF" />
          </TouchableOpacity>
          {fullscreenVideo && <VideoPlayer uri={fullscreenVideo} width={SCREEN_W} height={SCREEN_W * 0.75} fullscreen />}
          {fullscreenVideo && (
            <View style={s.fullscreenActions}>
              <TouchableOpacity style={s.fsActionBtn} onPress={() => saveMediaToDevice(fullscreenVideo, 'video')} disabled={savingToDevice} activeOpacity={0.7}>
                {savingToDevice ? <ActivityIndicator color="#FFF" size={14} /> : <Feather name="download" size={16} color="#FFF" />}
                <Text style={s.fsActionTxt}>{savingToDevice ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.fsActionBtn} onPress={() => Share.share({ message: fullscreenVideo })} activeOpacity={0.7}>
                <Feather name="share" size={16} color="#FFF" />
                <Text style={s.fsActionTxt}>Share</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>

      <Modal visible={showForwardPicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowForwardPicker(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: t.surface.sunken, paddingTop: insets.top }} edges={['left', 'right', 'bottom']}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: t.ink.primary }}>Forward to...</Text>
            <TouchableOpacity onPress={() => { setShowForwardPicker(false); setForwardMsg(null); }}>
              <Feather name="x" size={22} color={t.ink.primary} />
            </TouchableOpacity>
          </View>
          <FlatList data={forwardConvs} keyExtractor={c => c.id}
            contentContainerStyle={{ padding: 12, gap: 6 }}
            renderItem={({ item: c }) => (
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.surface.canvas, borderRadius: 14, padding: 14 }}
                activeOpacity={0.7}
                onPress={() => void forwardToConversation(c)}>
                <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: c.is_group ? NAVY : NAVY_SOFT, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#FFF', fontSize: c.is_group ? 18 : 16, fontWeight: '700' }}>{c.is_group ? (c.group_emoji || '💬') : '💬'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: t.ink.primary }} numberOfLines={1}>
                    {c.is_group ? (c.group_name || 'Group') : 'Direct Message'}
                  </Text>
                  <Text style={{ fontSize: 12, color: t.ink.muted }} numberOfLines={1}>{c.last_message || 'No messages yet'}</Text>
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<View style={{ alignItems: 'center', paddingTop: 60 }}><Text style={{ color: t.ink.muted }}>No other conversations</Text></View>} />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  voiceBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 10, backgroundColor: t.surface.canvas, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(11,30,61,0.07)' },
  voiceDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#FF3B30' },
  voiceTimer: { fontSize: 15, fontWeight: '700', color: t.ink.primary, minWidth: 46 },
  voiceHint: { flex: 1, fontSize: 13, color: t.ink.muted },
  voiceSend: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.brand.base, alignItems: 'center', justifyContent: 'center' },
  ctxCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#F7F8FA', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA' },
  ctxThumb: { width: 46, height: 46, borderRadius: 8, backgroundColor: t.surface.sunken },
  ctxThumbFallback: { alignItems: 'center', justifyContent: 'center' },
  ctxLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: '#8E8E93' },
  ctxTitle: { fontSize: 14.5, fontWeight: '700', color: '#0A0A0A', letterSpacing: -0.2, marginTop: 2 },
  ctxSub: { fontSize: 12.5, fontWeight: '500', color: '#6B7280', marginTop: 1 },
  safe: { flex: 1, backgroundColor: t.surface.sunken },
  flex: { flex: 1, backgroundColor: t.surface.sunken },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, backgroundColor: t.surface.canvas, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE, minHeight: 58, gap: 8 },
  backBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.surface.sunken, marginHorizontal: 12, marginBottom: 4, marginTop: 2, borderRadius: 12, paddingHorizontal: 12, minHeight: 48 },
  searchBarInput: { flex: 1, minWidth: 0, minHeight: 48, fontSize: 16, color: t.ink.primary, paddingHorizontal: 0, paddingVertical: 10, includeFontPadding: false, textAlignVertical: 'center' },
  headerCenter: { flex: 1, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 },
  hAvatar: { width: 38, height: 38, borderRadius: 19 },
  hAvatarFb: { width: 38, height: 38, borderRadius: 19, backgroundColor: t.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  hAvatarTxt: { fontSize: 14, fontWeight: '600', color: t.ink.primary },
  hInfo: { alignItems: 'flex-start', maxWidth: 160 },
  hName: { fontSize: 15, fontWeight: '600', color: t.ink.primary, letterSpacing: -0.2 },
  hSub: { fontSize: 12, color: t.ink.muted, marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  hActionBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: t.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 0, paddingTop: 14, paddingBottom: 10, flexGrow: 1 },
  sep: { alignItems: 'center', paddingVertical: 14 },
  sepTxt: { fontSize: 12, color: t.ink.muted, fontWeight: '600', letterSpacing: 0.2, backgroundColor: t.surface.canvas, overflow: 'hidden', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5, shadowColor: '#000', shadowOpacity: 0, shadowRadius: 1, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 4, paddingHorizontal: 12 },
  rowMe: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  rowEndsGroup: { marginBottom: 10 },
  bubbleInRun: { borderBottomRightRadius: 20, borderBottomLeftRadius: 20 },
  sideAvatarSlot: { width: 28, marginRight: 6, alignItems: 'center', justifyContent: 'flex-end', marginBottom: 2 },
  sideAvatar: { width: 28, height: 28, borderRadius: 14 },
  sideAvatarFb: { width: 28, height: 28, borderRadius: 14, backgroundColor: t.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  sideAvatarTxt: { fontSize: 10, fontWeight: '700', color: t.ink.primary },
  bubbleCol: { maxWidth: '78%', flexShrink: 1 },
  bubbleColMe: { alignItems: 'flex-end' },
  bubbleColOther: { alignItems: 'flex-start' },
  bubble: { paddingHorizontal: 13, paddingVertical: 9, position: 'relative', shadowColor: '#000', shadowOpacity: 0, shadowRadius: 1, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  bubbleMe: { backgroundColor: NAVY, borderRadius: 20, borderBottomRightRadius: 6 },
  bubbleOther: { backgroundColor: t.surface.canvas, borderRadius: 20, borderBottomLeftRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.16)', shadowColor: t.ink.primary, shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  bubbleMeFlat: { backgroundColor: NAVY, borderRadius: 20, borderBottomRightRadius: 6 },
  bubbleOtherFlat: { backgroundColor: t.surface.canvas, borderRadius: 20, borderBottomLeftRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(11,30,61,0.16)', shadowColor: t.ink.primary, shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  bubbleTxt: { fontSize: 15.5, lineHeight: 20, letterSpacing: -0.1 },
  bubbleTxtMe: { color: '#FFFFFF' },
  bubbleTxtOther: { color: t.ink.primary },
  linkTxt: { textDecorationLine: 'underline' },
  imgWrap: { borderRadius: 18, overflow: 'hidden', position: 'relative' },
  replyBar: { flexDirection: 'row', marginBottom: 4, borderRadius: 14, overflow: 'hidden', maxWidth: '100%' },
  replyBarMe: { backgroundColor: 'rgba(255,255,255,0.14)' },
  replyBarOther: { backgroundColor: t.brand.tintBg },
  replyAccent: { width: 3 },
  replyAccentMe: { backgroundColor: t.surface.sunken },
  replyAccentOther: { backgroundColor: t.ink.primary },
  replyLabel: { fontSize: 11, fontWeight: '700', color: t.ink.primary, paddingHorizontal: 10, paddingTop: 7, paddingBottom: 1 },
  replyLabelMe: { color: 'rgba(255,255,255,0.75)' },
  replyTxt: { fontSize: 13, color: t.ink.primary, paddingHorizontal: 10, paddingTop: 2, paddingBottom: 8, lineHeight: 17 },
  replyTxtMe: { color: 'rgba(255,255,255,0.88)' },
  gifBadge: { position: 'absolute', bottom: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  gifBadgeTxt: { fontSize: 10, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.3 },
  starBadge: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.55)', width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  starBadgeInline: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.12)', width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  starBadgeTxt: { fontSize: 12, color: '#FFD60A', fontWeight: '700' },
  videoThumb: { backgroundColor: '#1C1C1E', borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  videoPlayCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  docBubble: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4, minWidth: 200 },
  docIconBg: { width: 40, height: 40, borderRadius: 10, backgroundColor: t.surface.hairline, alignItems: 'center', justifyContent: 'center' },
  docIconBgMe: { backgroundColor: 'rgba(255,255,255,0.15)' },
  docName: { fontSize: 14, fontWeight: '600', color: t.ink.primary, lineHeight: 19 },
  docNameMe: { color: '#FFFFFF' },
  docTap: { fontSize: 12, color: t.ink.muted, marginTop: 2 },
  docTapMe: { color: 'rgba(255,255,255,0.65)' },
  // Story reply label
  storyReplyLabel: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  storyReplyTxt: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  storyReplyTxtMe: { color: 'rgba(255,255,255,0.6)' },
  storyReplyTxtOther: { color: '#2563EB' },
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  reactionsRowMe: { justifyContent: 'flex-end' },
  reactionsRowOther: { justifyContent: 'flex-start' },
  reactionPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: t.surface.canvas, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  reactionPillMine: { backgroundColor: t.brand.tintBg, borderColor: t.brand.base },
  reactionEmoji: { fontSize: 14 },
  reactionCount: { fontSize: 11, fontWeight: '600', color: t.ink.primary },
  status: { fontSize: 11, marginTop: 5, color: t.ink.muted, fontWeight: '500', letterSpacing: 0.1 },
  statusMe: { textAlign: 'right', marginRight: 4 },
  statusOther: { marginLeft: 4 },
  tsLabel: { fontSize: 10.5, color: t.ink.muted, marginTop: 2 },
  tsLabelMe: { textAlign: 'right', marginRight: 4 },
  tsLabelOther: { marginLeft: 4 },
  typingWrap: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingBottom: 6, marginBottom: 2 },
  typingBubble: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 11 },
  typingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: t.ink.muted },
  replyBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface.sunken, paddingHorizontal: 14, paddingVertical: 10, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE },
  replyBannerAccent: { width: 3, height: 32, borderRadius: 2, backgroundColor: NAVY },
  replyBannerContent: { flex: 1 },
  replyBannerLabel: { fontSize: 12, fontWeight: '600', color: t.ink.primary },
  replyBannerPrev: { fontSize: 13, color: t.ink.primary, marginTop: 1 },
  replyBannerClose: { padding: 4 },
  toolbar: { backgroundColor: t.surface.canvas, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE },
  toolbarGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingVertical: 16, gap: 20, justifyContent: 'flex-start' },
  toolbarBtn: { alignItems: 'center', gap: 6 },
  toolbarBtnInner: { width: 52, height: 52, borderRadius: 18, backgroundColor: t.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  toolbarBtnLbl: { fontSize: 11, color: t.ink.muted, fontWeight: '500' },
  bar: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingTop: 8, backgroundColor: t.surface.canvas, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(11,30,61,0.07)', gap: 8 },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center', marginBottom: 1 },
  inlineBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', marginBottom: -3 },
  inputWrap: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 4, backgroundColor: t.surface.sunken, borderRadius: 22, paddingLeft: 16, paddingRight: 6, paddingTop: 9, paddingBottom: 9, minHeight: 44, borderWidth: StyleSheet.hairlineWidth, borderColor: t.surface.divider },
  input: { flex: 1, fontSize: 16, color: t.ink.primary, maxHeight: 130, padding: 0, margin: 0, paddingTop: 2, paddingBottom: 2, letterSpacing: -0.1, lineHeight: 21 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', shadowColor: t.ink.primary, shadowOpacity: 0.22, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  lockedBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 14, backgroundColor: '#F9FAFB', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE },
  lockedIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#F3E8FF', alignItems: 'center', justifyContent: 'center' },
  lockedTitle: { fontSize: 13, fontWeight: '700', color: '#1F2937' },
  lockedSub: { fontSize: 11, color: '#6B7280', marginTop: 1 },
  fullscreenRoot: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  fullscreenClose: { position: 'absolute', top: 60, right: 20, zIndex: 10, width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  fullscreenActions: { position: 'absolute', bottom: 40, flexDirection: 'row', gap: 10 },
  fsActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 },
  fsActionTxt: { color: '#FFFFFF', fontWeight: '600' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 6 },
  emptyAvatar: { width: 72, height: 72, borderRadius: 36, marginBottom: 4 },
  emptyAvatarFb: { width: 72, height: 72, borderRadius: 36, backgroundColor: t.surface.sunken, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyAvatarTxt: { fontSize: 28, fontWeight: '600', color: t.ink.primary },
  emptyName: { fontSize: 18, fontWeight: '600', color: t.ink.primary },
  emptyHandle: { fontSize: 14, color: t.ink.muted },
  emptyHint: { fontSize: 13, color: t.ink.muted, marginTop: 8, textAlign: 'center', paddingHorizontal: 40 },
  reactionOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  reactionSheet: { backgroundColor: t.surface.canvas, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 14, paddingBottom: 34 },
  reactionEmojis: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  reactionEmojiBtn: { padding: 6 },
  reactionEmojiTxt: { fontSize: 30 },
  reactionActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', paddingHorizontal: 16, paddingVertical: 16, gap: 12 },
  reactionActionBtn: { alignItems: 'center', gap: 6, minWidth: 62 },
  reactionActionInner: { width: 44, height: 44, borderRadius: 14, backgroundColor: t.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  reactionActionLbl: { fontSize: 11, color: t.ink.primary, fontWeight: '500' },
  infoSafe: { flex: 1, backgroundColor: t.surface.sunken },
  infoHeader: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: t.surface.canvas, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  infoDoneBtn: { paddingVertical: 4, paddingHorizontal: 4 },
  infoDoneTxt: { fontSize: 16, color: t.ink.primary, fontWeight: '600' },
  infoContact: { backgroundColor: t.surface.canvas, alignItems: 'center', paddingVertical: 32, paddingHorizontal: 20, marginBottom: 8 },
  infoAvatar: { width: 110, height: 110, borderRadius: 55, marginBottom: 14 },
  infoAvatarFb: { width: 90, height: 90, borderRadius: 45, backgroundColor: t.surface.sunken, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  infoAvatarTxt: { fontSize: 34, fontWeight: '600', color: t.ink.primary },
  infoName: { fontSize: 22, fontWeight: '700', color: t.ink.primary, marginBottom: 4, letterSpacing: -0.3 },
  infoHandle: { fontSize: 14, color: t.ink.primary, marginBottom: 4, fontWeight: '500' },
  infoProg: { fontSize: 13, color: t.ink.primary, marginBottom: 4 },
  infoLoc: { fontSize: 13, color: t.ink.muted },
  infoQuickRow: { flexDirection: 'row', backgroundColor: t.surface.canvas, paddingVertical: 16, paddingHorizontal: 8, marginBottom: 8, justifyContent: 'space-around' },
  infoQuickBtn: { alignItems: 'center', gap: 6, flex: 1 },
  infoQuickInner: { width: 48, height: 48, borderRadius: 16, backgroundColor: t.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  infoQuickLbl: { fontSize: 11, color: t.ink.primary, fontWeight: '500' },
  infoTabsSection: { backgroundColor: t.surface.canvas, marginBottom: 8 },
  infoTabBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  infoTab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  infoTabActive: { borderBottomWidth: 2, borderBottomColor: NAVY },
  infoTabTxt: { fontSize: 13, fontWeight: '600', color: t.ink.muted },
  infoTabTxtActive: { color: t.ink.primary },
  infoTabBody: { paddingHorizontal: 14, paddingVertical: 12, minHeight: 140 },
  infoTabLoading: { alignItems: 'center', justifyContent: 'center', paddingVertical: 30 },
  infoEmpty: { fontSize: 14, color: t.ink.muted, textAlign: 'center', paddingVertical: 24 },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  mediaGridItem: { width: Math.floor((SCREEN_W - 28 - 6) / 3), height: Math.floor((SCREEN_W - 28 - 6) / 3), borderRadius: 6, overflow: 'hidden', backgroundColor: t.surface.sunken, position: 'relative' },
  mediaPlayOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.2)' },
  infoFileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  infoFileIconBg: { width: 38, height: 38, borderRadius: 10, backgroundColor: t.surface.hairline, alignItems: 'center', justifyContent: 'center' },
  infoFileName: { fontSize: 14, fontWeight: '600', color: t.ink.primary },
  infoFileMeta: { fontSize: 12, color: t.ink.muted, marginTop: 2 },
  infoStarredRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  infoStarredTxt: { fontSize: 14, color: t.ink.primary, lineHeight: 19 },
  infoStarredMeta: { fontSize: 12, color: t.ink.muted, marginTop: 4 },
  infoStarredUnstar: { padding: 4 },
  infoStarredIcon: { fontSize: 20, color: '#FFD60A' },
  infoSection: { backgroundColor: t.surface.canvas, padding: 16, marginBottom: 8 },
  infoSectionTitle: { fontSize: 12, fontWeight: '600', color: t.ink.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  infoBio: { fontSize: 15, color: t.ink.primary, lineHeight: 22 },
  infoMemberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  infoMemberAvatar: { width: 36, height: 36, borderRadius: 10 },
  infoMemberName: { flex: 1, fontSize: 14, fontWeight: '600', color: t.ink.primary },
  infoAdminBadge: { backgroundColor: NAVY, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  infoAdminTxt: { fontSize: 10, color: '#FFFFFF', fontWeight: '700', letterSpacing: 0.3 },
  infoSeeAll: { fontSize: 14, color: t.ink.primary, fontWeight: '600', paddingVertical: 8 },
  infoDanger: { backgroundColor: '#FEF2F2', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  infoDangerTxt: { fontSize: 15, fontWeight: '700', color: '#DC2626' },
  editMsgSheet: { backgroundColor: t.surface.canvas, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: 24 },
  editMsgHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  editMsgTitle: { fontSize: 15, fontWeight: '700', color: t.ink.primary },
  editMsgCancelTxt: { fontSize: 15, color: t.ink.muted, fontWeight: '500' },
  editMsgSaveTxt: { fontSize: 15, fontWeight: '700', color: t.ink.primary },
  editOriginal: { backgroundColor: t.surface.sunken, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  editOriginalLabel: { fontSize: 11, fontWeight: '700', color: t.ink.primary, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
  editOriginalTxt: { fontSize: 14, color: t.ink.muted, lineHeight: 19 },
  editMsgInput: { backgroundColor: t.surface.canvas, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: t.ink.primary, minHeight: 90, textAlignVertical: 'top' },
}));

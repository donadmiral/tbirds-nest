/**
 * ChatScreen.tsx
 * Unified DM + group + affiliation-aware chat.
 * Design: Clean Premium — navy sent bubbles, soft tails, instant send.
 *
 * FIXES applied (no other logic changed):
 *  1. markRead calls mark_conversation_read RPC — atomic bulk update, bypasses
 *     any messageStatusService issues.  read_at is set server-side in one call.
 *  2. Realtime INSERT handler marks messages read immediately when they arrive
 *     and the screen is mounted (same as before but now uses the RPC).
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
  KeyboardAvoidingView, Platform, ActivityIndicator, StatusBar,
  Animated, Easing, Pressable, Modal, ScrollView, Alert, Linking,
  Image, Dimensions, Share,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import * as FileSystem from 'expo-file-system/legacy';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { messageStatusService } from '../../services/messageStatusService';
import { callService } from '../../services/callService';
import { uploadMedia } from '../../services/mediaService';
import CallEventBubble from '../../components/CallEventBubble';

const SCREEN_W = Dimensions.get('window').width;
const MSG_IMG_MAX_W = Math.min(SCREEN_W * 0.72, 300);
const MSG_IMG_MAX_H = 360;
const MSG_IMG_MIN_H = 140;
const MSG_VID_H = Math.round(MSG_IMG_MAX_W * 0.60);
const TENOR_KEY = 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ';
const REACTION_EMOJIS = ['❤️', '😂', '👍', '😮', '😢', '🔥', '🎯', '🙌'];

const NAVY = '#0B1E3D';
const NAVY_SOFT = '#1A3560';
const BUBBLE_OTHER = '#F2F2F7';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#8E8E93';
const HAIRLINE = '#E5E5EA';

type Reaction = { emoji: string; user_id: string };

type MessageItem = {
  id: string;
  text: string | null;
  sender_id: string | null;
  receiver_id: string | null;
  conversation_id: string | null;
  created_at: string | null;
  read_at?: string | null;
  delivered_at?: string | null;
  viewed_at?: string | null;
  media_url?: string | null;
  media_type?: string | null;
  media_b64?: string | null;
  media_width?: number | null;
  media_height?: number | null;
  reply_to_id?: string | null;
  shared_post_id?: string | null;
  _optimistic?: boolean;
  _reactions?: Reaction[];
};

type InfoMediaMsg = {
  id: string;
  media_url: string;
  media_type: string;
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

type AffiliationInfo = {
  id: string;
  name: string;
  post_mode: 'interactive' | 'informative';
  my_role: 'member' | 'officer' | 'admin' | 'founder' | 'alumni' | null;
};

function useFetchGifs(search: string) {
  const [gifs, setGifs] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setGifs([]);
    const q = search.trim();
    const url = q
      ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${TENOR_KEY}&limit=30&media_filter=gif`
      : `https://tenor.googleapis.com/v2/featured?key=${TENOR_KEY}&limit=30&media_filter=gif`;
    fetch(url).then(r => r.json()).then(d => {
      if (!cancelled && d.results) {
        const urls = d.results
          .map((g: any) => g.media_formats?.gif?.url ?? g.media_formats?.tinygif?.url ?? null)
          .filter(Boolean);
        setGifs(urls);
      }
    }).catch(e => console.log('GIF_FETCH_ERR', e))
    .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [search]);
  return { gifs, loading };
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

function GifPicker({ onSelect, onBack }: { onSelect: (url: string) => void; onBack: () => void }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const { gifs, loading } = useFetchGifs(query);
  return (
    <View style={{ padding: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
          <Text style={{ fontSize: 14, color: NAVY, fontWeight: '600' }}>← Back</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, backgroundColor: '#F2F2F7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7 }}>
          <TextInput value={search} onChangeText={setSearch} onSubmitEditing={() => setQuery(search)}
            placeholder="Search GIFs..." placeholderTextColor={TEXT_SECONDARY}
            style={{ fontSize: 14, color: '#000', padding: 0 }} returnKeyType="search" />
        </View>
      </View>
      {loading ? <ActivityIndicator color={NAVY} style={{ marginVertical: 16 }} /> : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {gifs.map((url, i) => (
            <TouchableOpacity key={i} onPress={() => onSelect(url)} style={{ marginRight: 8 }} activeOpacity={0.8}>
              <ExpoImage source={{ uri: url }} style={{ width: 90, height: 90, borderRadius: 8 }} contentFit="cover" />
            </TouchableOpacity>
          ))}
          {gifs.length === 0 && !loading && (
            <Text style={{ color: TEXT_SECONDARY, fontSize: 13, paddingVertical: 16 }}>No GIFs found.</Text>
          )}
        </ScrollView>
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
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();

  const currentUserId = profile?.id ?? null;
  const [conversationId, setConversationId] = useState<string | null>(route.params?.conversationId ?? null);
  const passedUser = route.params?.otherUser ?? null;
  const passedUserId: string | null = route.params?.userId ?? null;
  const isGroup: boolean = route.params?.isGroup ?? false;
  const groupName: string = route.params?.groupName ?? '';
  const groupEmoji: string = route.params?.groupEmoji ?? '💬';
  const groupAvatarUrl: string | null = route.params?.groupAvatarUrl ?? null;
  const passedAffiliationId: string | null = route.params?.affiliationId ?? null;
  const [otherUser, setOtherUser] = useState<any>(passedUser);
  const [affiliation, setAffiliation] = useState<AffiliationInfo | null>(null);

  useEffect(() => {
    if (otherUser) return;
    const uid = passedUserId;
    if (!uid) return;
    supabase.from('profiles').select('id, full_name, username, avatar_url, bio, location, degree_program, graduation_year, email')
      .eq('id', uid).single()
      .then(({ data }) => { if (data) setOtherUser(data); });
  }, [passedUserId]);

  useEffect(() => {
    if (conversationId || isGroup || !currentUserId || !passedUserId) return;
    const a = [currentUserId, passedUserId].sort();
    supabase.from('conversations')
      .select('id')
      .eq('type', 'direct')
      .or(`and(user_1.eq.${a[0]},user_2.eq.${a[1]}),and(user_1.eq.${a[1]},user_2.eq.${a[0]})`)
      .maybeSingle()
      .then(({ data }) => { if (data?.id) setConversationId(data.id); });
  }, [conversationId, isGroup, currentUserId, passedUserId]);

  useEffect(() => {
    if (!currentUserId) return;
    let cancelled = false;

    const loadAffiliation = async () => {
      let affId = passedAffiliationId;

      if (!affId && conversationId) {
        const { data: conv } = await supabase
          .from('conversations')
          .select('affiliation_id')
          .eq('id', conversationId)
          .maybeSingle();
        affId = conv?.affiliation_id ?? null;
      }

      if (!affId) {
        if (!cancelled) setAffiliation(null);
        return;
      }

      const [{ data: aff }, { data: myMembership }] = await Promise.all([
        supabase.from('affiliations')
          .select('id, name, post_mode')
          .eq('id', affId)
          .maybeSingle(),
        supabase.from('profile_affiliations')
          .select('role, left_at')
          .eq('affiliation_id', affId)
          .eq('profile_id', currentUserId)
          .is('left_at', null)
          .maybeSingle(),
      ]);

      if (cancelled) return;
      if (!aff) { setAffiliation(null); return; }

      setAffiliation({
        id: aff.id,
        name: aff.name,
        post_mode: (aff.post_mode as any) || 'interactive',
        my_role: (myMembership?.role as any) || null,
      });
    };

    loadAffiliation();
    return () => { cancelled = true; };
  }, [conversationId, passedAffiliationId, currentUserId]);

  const isAffiliationConversation = !!affiliation;
  const iAmAffiliationAdmin = useMemo(() => {
    if (!affiliation?.my_role) return false;
    return ['admin', 'officer', 'founder'].includes(affiliation.my_role);
  }, [affiliation]);
  const composerLocked = useMemo(() =>
    isAffiliationConversation
    && affiliation?.post_mode === 'informative'
    && !iAmAffiliationAdmin,
  [isAffiliationConversation, affiliation, iAmAffiliationAdmin]);

  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const [lastStatus, setLastStatus] = useState<OutgoingStatus>(null);

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
  const [fullscreenVideo, setFullscreenVideo] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [savingToDevice, setSavingToDevice] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showTimestamp, setShowTimestamp] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [otherOnline, setOtherOnline] = useState(false);

  const mountedRef = useRef(true);
  const flatListRef = useRef<FlatList<any>>(null);

  // Pinned context for Market / Jobs threads
  const [ctxCard, setCtxCard] = useState<{ kind: 'market' | 'jobs'; title: string; sub: string; image: string | null; refId: string } | null>(null);
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
          setCtxCard({ kind: 'market', title: d.title || 'Listing', sub: [price, d.status].filter(Boolean).join('  ·  '), image: img, refId: d.id });
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
  const inputRef = useRef<TextInput>(null);
  const messagesRef = useRef<MessageItem[]>([]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;
  const typingOpacity = useRef(new Animated.Value(0)).current;
  const toolbarH = useRef(new Animated.Value(0)).current;

  const chatTitle = useMemo(() => {
    if (isAffiliationConversation && affiliation) return affiliation.name;
    return isGroup ? groupName || 'Group' : (otherUser?.full_name?.trim() || 'Chat');
  }, [otherUser, isGroup, groupName, isAffiliationConversation, affiliation]);
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

  const mergeMsg = useCallback((incoming: MessageItem) => {
    setMessages(prev => {
      const ei = prev.findIndex(m => m.id === incoming.id);
      if (ei !== -1) {
        const c = [...prev];
        c[ei] = { ...incoming, media_b64: c[ei].media_b64 ?? incoming.media_b64, _optimistic: false };
        return c;
      }
      const oi = prev.findIndex(m => m._optimistic && m.sender_id === incoming.sender_id && m.text === incoming.text && m.media_url === incoming.media_url);
      if (oi !== -1) {
        const c = [...prev];
        c[oi] = { ...incoming, media_b64: c[oi].media_b64 ?? incoming.media_b64, _optimistic: false };
        return c;
      }
      return [incoming, ...prev];
    });
  }, []);

  const loadSavedIds = useCallback(async () => {
    if (!currentUserId || !conversationId) return;
    const { data } = await supabase.from('saved_messages').select('message_id').eq('user_id', currentUserId);
    setSavedIds(new Set((data || []).map((r: any) => r.message_id)));
  }, [currentUserId, conversationId]);

  const loadStarredIds = useCallback(async () => {
    if (!currentUserId || !conversationId) return;
    const { data } = await supabase.from('starred_messages')
      .select('message_id').eq('conversation_id', conversationId).eq('starred_by', currentUserId);
    setStarredIds(new Set((data || []).map((r: any) => r.message_id)));
  }, [currentUserId, conversationId]);

  const refreshStatus = useCallback(async () => {
    if (!conversationId || !currentUserId) return;
    try {
      const s = await messageStatusService.getLastOutgoingMessageStatus(conversationId, currentUserId);
      if (mountedRef.current) setLastStatus(s ?? null);
    } catch {}
  }, [conversationId, currentUserId]);

  const markRead = useCallback(async () => {
    if (!conversationId || !currentUserId) return;
    try {
      await supabase.rpc('mark_conversation_read', {
        p_conv_id: conversationId,
        p_user_id: currentUserId,
      });

      const now = new Date().toISOString();
      setMessages(prev =>
        prev.map(m =>
          m.receiver_id === currentUserId && !m.read_at
            ? { ...m, read_at: now, delivered_at: m.delivered_at || now, viewed_at: m.viewed_at || now }
            : m
        )
      );

      await refreshStatus();
    } catch (e) {
      console.log('[MARK_READ_ERR]', e);
    }
  }, [conversationId, currentUserId, refreshStatus]);

  const loadReactions = useCallback(async (msgIds: string[]) => {
    if (!msgIds.length) return;
    const { data } = await supabase.from('message_reactions').select('message_id, emoji, user_id').in('message_id', msgIds);
    if (!data) return;
    const byMsg: Record<string, Reaction[]> = {};
    data.forEach((r: any) => { if (!byMsg[r.message_id]) byMsg[r.message_id] = []; byMsg[r.message_id].push({ emoji: r.emoji, user_id: r.user_id }); });
    setMessages(prev => prev.map(m => byMsg[m.id] ? { ...m, _reactions: byMsg[m.id] } : m));
  }, []);

  const getOrCreateConversation = useCallback(async (): Promise<string | null> => {
    if (conversationId) return conversationId;
    if (!currentUserId || !passedUserId) return null;
    const a = [currentUserId, passedUserId].sort();
    const { data: existing } = await supabase.from('conversations').select('id').eq('type', 'direct')
      .or(`and(user_1.eq.${a[0]},user_2.eq.${a[1]}),and(user_1.eq.${a[1]},user_2.eq.${a[0]})`).maybeSingle();
    if (existing?.id) { setConversationId(existing.id); return existing.id; }
    const { data: created, error } = await supabase.from('conversations').insert({
      user_1: currentUserId, user_2: passedUserId, type: 'direct', is_group: false,
      last_message: '', last_message_time: new Date().toISOString(),
    }).select('id').single();
    if (error) { console.log('[CREATE_CONV_ERR]', error.message); return null; }
    setConversationId(created.id);
    return created.id;
  }, [conversationId, currentUserId, passedUserId]);

  const loadGroupMembers = useCallback(async () => {
    if (!isGroup || !conversationId) return;
    try {
      const { data } = await supabase.from('conversation_members')
        .select('user_id, role, profile:profiles!user_id(id, full_name, username, avatar_url)')
        .eq('conversation_id', conversationId);
      setGroupMembers(data || []);
    } catch (e) { console.log('[GROUP_MEMBERS_ERR]', e); }
  }, [isGroup, conversationId]);

  const loadInfoContent = useCallback(async () => {
    if (!conversationId) {
      setInfoMedia([]); setInfoFiles([]); setInfoStarred([]);
      return;
    }
    setInfoLoading(true);
    try {
      const [mediaRes, filesRes, starredRes] = await Promise.all([
        supabase.from('messages')
          .select('id, media_url, media_type, created_at, sender_id')
          .eq('conversation_id', conversationId)
          .not('media_url', 'is', null)
          .in('media_type', ['image', 'video', 'gif'])
          .order('created_at', { ascending: false })
          .limit(200),
        supabase.from('messages')
          .select('id, media_url, text, created_at, sender_id')
          .eq('conversation_id', conversationId)
          .eq('media_type', 'document')
          .not('media_url', 'is', null)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase.from('starred_messages')
          .select('id, message_id, starred_at, starred_by, msg:messages!message_id(id, text, media_url, media_type, created_at, sender_id)')
          .eq('conversation_id', conversationId)
          .order('starred_at', { ascending: false })
          .limit(100),
      ]);

      setInfoMedia((mediaRes.data || []) as InfoMediaMsg[]);
      setInfoFiles((filesRes.data || []) as InfoFileMsg[]);

      const starredRows = (starredRes.data || []) as any[];
      const senderIds = Array.from(new Set(starredRows.map((r: any) => r.msg?.sender_id).filter(Boolean)));
      let nameMap: Record<string, string> = {};
      if (senderIds.length > 0) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', senderIds);
        (profs || []).forEach((p: any) => { nameMap[p.id] = p.full_name || 'Member'; });
      }
      setInfoStarred(starredRows.map((r: any) => ({
        id: r.id, message_id: r.message_id, starred_at: r.starred_at, starred_by: r.starred_by,
        msg: r.msg ? { ...r.msg, sender_name: nameMap[r.msg.sender_id] || 'Member' } : null,
      })));
    } catch (e) {
      console.log('[INFO_LOAD_ERR]', e);
    } finally {
      setInfoLoading(false);
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
    const convId = conversationId;
    if (!convId) { setMessages([]); setLoading(false); return; }
    try {
      if (mountedRef.current) setLoading(true);
      const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', convId).order('created_at', { ascending: false });
      if (!error && mountedRef.current) {
        const msgs = sortDesc((data || []) as MessageItem[]);
        setMessages(msgs);
        const ids = msgs.map(m => m.id);
        await loadReactions(ids);
      }
      await markRead();
      await refreshStatus();
      await loadStarredIds();
      await loadSavedIds();
    } catch {} finally { if (mountedRef.current) setLoading(false); }
  }, [conversationId, markRead, refreshStatus, sortDesc, loadReactions, loadStarredIds, loadSavedIds]);

  const fetchTyping = useCallback(async () => {
    if (!conversationId || !currentUserId) return;
    try {
      const { data } = await supabase.from('conversation_typing').select('*').eq('conversation_id', conversationId);
      const other = (data || []).find((r: any) => r.user_id !== currentUserId);
      setOtherTyping(!!(other?.is_typing && (Date.now() - new Date(other.updated_at).getTime() < 5000)));
    } catch {}
  }, [conversationId, currentUserId]);

  const setTyping = useCallback(async (isTyping: boolean) => {
    if (!conversationId || !currentUserId || lastTypingRef.current === isTyping) return;
    lastTypingRef.current = isTyping;
    try { await supabase.from('conversation_typing').upsert({ conversation_id: conversationId, user_id: currentUserId, is_typing: isTyping, updated_at: new Date().toISOString() }, { onConflict: 'conversation_id,user_id' }); } catch {}
  }, [conversationId, currentUserId]);

  useEffect(() => {
    if (!isGroup && otherUser?.id) {
      const isRecent = (lastSeen: string | null) => !!lastSeen && (Date.now() - new Date(lastSeen).getTime() < 120000);
      supabase.from('user_presence').select('is_online, last_seen').eq('user_id', otherUser.id).maybeSingle()
        .then(({ data }) => { if (data) setOtherOnline(!!data.is_online && isRecent(data.last_seen)); });
      const presSub = supabase.channel(`presence_${otherUser.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_presence', filter: `user_id=eq.${otherUser.id}` },
          (payload) => {
            const p = payload.new as any;
            setOtherOnline(!!p?.is_online && isRecent(p?.last_seen));
          })
        .subscribe();
      return () => { supabase.removeChannel(presSub); };
    }
  }, [isGroup, otherUser?.id]);

  useEffect(() => {
    mountedRef.current = true;
    fetchMessages();
    fetchTyping();
    if (!conversationId) return () => { mountedRef.current = false; };

    const msgCh = supabase
      .channel(`messages_${conversationId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
        async (p) => {
          mergeMsg(p.new as MessageItem);
          if ((p.new as any).receiver_id === currentUserId) {
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

    const reactCh = supabase
      .channel(`reactions_${conversationId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_reactions' },
        () => {
          const ids = messagesRef.current.map(m => m.id);
          if (ids.length) loadReactions(ids);
        }
      )
      .subscribe();

    return () => {
      mountedRef.current = false;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      setTyping(false);
      supabase.removeChannel(msgCh);
      supabase.removeChannel(typeCh);
      supabase.removeChannel(reactCh);
    };
  }, [conversationId, currentUserId, fetchMessages, fetchTyping, markRead, mergeMsg, refreshStatus, setTyping, loadReactions]);

  const handleTextChange = useCallback((text: string) => {
    setMessage(text);
    setTyping(text.trim().length > 0);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => setTyping(false), 1500);
  }, [setTyping]);

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

  const doSend = useCallback(async (text: string, mediaUrl?: string, mediaType?: string, mediaB64?: string | null, replyId?: string | null, mediaWidth?: number, mediaHeight?: number): Promise<boolean> => {
    if (!currentUserId) return false;
    if (composerLocked) {
      Alert.alert('Announcements only', 'Only admins can post in this community.');
      return false;
    }
    const convId = await getOrCreateConversation();
    if (!convId) return false;
    const receiverId = isGroup ? null : (otherUser?.id ?? passedUserId);
    const tempId = 'opt_' + Date.now();
    const now = new Date().toISOString();
    const optimistic: MessageItem = {
      id: tempId, text: text || null, sender_id: currentUserId, receiver_id: receiverId, conversation_id: convId,
      created_at: now, media_url: mediaUrl || null, media_type: mediaType || null, media_b64: mediaB64 || null,
      media_width: mediaWidth || null, media_height: mediaHeight || null,
      reply_to_id: replyId || null, _optimistic: true,
    };
    setMessages(prev => [optimistic, ...prev]);
    try {
      const { data, error } = await supabase.from('messages').insert([{
        conversation_id: convId, text: text || null, sender_id: currentUserId, receiver_id: receiverId,
        media_url: mediaUrl || null, media_type: mediaType || null, reply_to_id: replyId || null,
      }]).select().single();
      if (error) {
        setMessages(prev => prev.filter(m => m.id !== tempId));
        if (error.code === '42501') {
          Alert.alert('Announcements only', 'Only admins can post in this community.');
        }
        return false;
      }
      mergeMsg({ ...data, media_width: mediaWidth || null, media_height: mediaHeight || null, media_b64: mediaB64 || null });
      await refreshStatus();
      const preview = mediaUrl
        ? (mediaType === 'image' ? '📷 Photo' : mediaType === 'video' ? '🎬 Video' : mediaType === 'document' ? '📄 File' : '📎 Media')
        : (text || '');
      supabase.from('conversations').update({ last_message: preview, last_message_time: data.created_at }).eq('id', convId).then(() => {});
      return true;
    } catch {
      setMessages(prev => prev.filter(m => m.id !== tempId));
      return false;
    }
  }, [getOrCreateConversation, currentUserId, isGroup, otherUser, passedUserId, mergeMsg, refreshStatus, composerLocked]);

  const sendMessage = useCallback(async () => {
    const clean = message.trim();
    if (!clean || sending) return;
    setMessage('');
    setSending(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    setTyping(false);
    const rid = replyTo?.id;
    setReplyTo(null);
    const ok = await doSend(clean, undefined, undefined, null, rid);
    if (!ok) setMessage(clean);
    setSending(false);
  }, [message, sending, setTyping, replyTo, doSend]);

  const pickAndSendMedia = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission required'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'] as ImagePicker.MediaType[], quality: 0.92,
      allowsMultipleSelection: true, selectionLimit: 10, base64: true,
    });
    if (result.canceled || !result.assets?.length) return;
    setShowToolbar(false); setUploadingMedia(true);
    try {
      for (const asset of result.assets) {
        const isVid = asset.type === 'video';
        const ext = isVid ? 'mp4' : 'jpg';
        const mime = isVid ? 'video/mp4' : 'image/jpeg';
        const imgBase64 = asset.base64 ?? null;
        try {
          const { url } = await uploadMedia('chat-media', currentUserId!, {
            uri: asset.uri, kind: isVid ? 'video' : 'image', ext, mimeType: mime,
            width: asset.width, height: asset.height, base64: imgBase64,
          }, { filename: `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}` });
          await doSend('', url, isVid ? 'video' : 'image', imgBase64, null, asset.width, asset.height);
        } catch (upErr: any) { console.log('[CHAT_UPLOAD_ERR]', upErr?.message); continue; }
      }
    } catch (e: any) { Alert.alert('Upload failed', e?.message); } finally { setUploadingMedia(false); }
  }, [currentUserId, doSend]);

  const pickAndSendDocument = useCallback(async () => {
    setShowToolbar(false);
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const ext = asset.name.split('.').pop()?.toLowerCase() || 'bin';
      setUploadingMedia(true);
      const safeName = asset.name.replace(/[^a-zA-Z0-9/_.\-]/g, '_');
      const { url } = await uploadMedia('chat-files', currentUserId!, {
        uri: asset.uri, kind: 'document', ext, mimeType: 'application/octet-stream', base64: null,
      }, { filename: `${Date.now()}_${safeName}` });
      await doSend(`📄 ${asset.name}`, url, 'document', null);
    } catch (e: any) { Alert.alert('Error', 'Could not send file: ' + (e?.message || '')); }
    finally { setUploadingMedia(false); }
  }, [currentUserId, doSend]);

  const sendGif = useCallback(async (url: string) => {
    setShowGifs(false); setShowToolbar(false);
    await doSend('', url, 'gif', null);
  }, [doSend]);

  const openCamera = useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission required'); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.92, base64: true });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setShowToolbar(false); setUploadingMedia(true);
    try {
      const camBase64 = asset.base64 ?? null;
      const { url } = await uploadMedia('chat-media', currentUserId!, {
        uri: asset.uri, kind: 'image', ext: 'jpg', mimeType: 'image/jpeg',
        width: asset.width, height: asset.height, base64: camBase64,
      }, { filename: `camera_${Date.now()}.jpg` });
      await doSend('', url, 'image', camBase64, null, asset.width, asset.height);
    } catch { Alert.alert('Upload failed'); } finally { setUploadingMedia(false); }
  }, [currentUserId, doSend]);

  const toggleReaction = useCallback(async (msgId: string, emoji: string) => {
    if (!currentUserId) return;
    setSelectedMsg(null);
    const { data: existing } = await supabase.from('message_reactions').select('id, emoji').eq('message_id', msgId).eq('user_id', currentUserId).maybeSingle();
    if (existing) {
      if (existing.emoji === emoji) await supabase.from('message_reactions').delete().eq('id', existing.id);
      else await supabase.from('message_reactions').update({ emoji }).eq('id', existing.id);
    } else {
      await supabase.from('message_reactions').insert({ message_id: msgId, user_id: currentUserId, emoji });
    }
    await loadReactions([msgId]);
  }, [currentUserId, loadReactions]);

  const saveEdit = useCallback(async () => {
    if (!editingMsg || !editText.trim()) return;
    const newText = editText.trim();
    const msgId = editingMsg.id;
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, text: newText } : m));
    setEditingMsg(null); setEditText('');
    const { error } = await supabase.from('messages').update({ text: newText, edited_at: new Date().toISOString() })
      .eq('id', msgId).eq('sender_id', currentUserId!);
    if (error) { await fetchMessages(); }
    else if (editingMsg.conversation_id) {
      const { data: latest } = await supabase.from('messages').select('id').eq('conversation_id', editingMsg.conversation_id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (latest?.id === msgId) {
        await supabase.from('conversations').update({ last_message: newText }).eq('id', editingMsg.conversation_id);
      }
    }
  }, [editingMsg, editText, currentUserId, fetchMessages]);

  const startCall = useCallback(async (isVideo = false) => {
    if (!currentUserId) return;

    if (isGroup) {
      if (!conversationId) { Alert.alert('Cannot call', 'No conversation found.'); return; }
      const chanId = `group_${conversationId}_${Date.now()}`;
      navigation.navigate('Call', {
        callId: null, channelId: chanId,
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
      try {
        await callService.initiateCall({ callerId: currentUserId, receiverId: recipientId, channelId: chanId, isVideo });
      } catch {}
    }
  }, [currentUserId, otherUser, passedUserId, conversationId, isGroup, chatTitle, navigation]);

  const lastOwnIndex = useMemo(() => messages.findIndex(m => m.sender_id === currentUserId), [messages, currentUserId]);

  const getStatus = useCallback((item: MessageItem, isMe: boolean, index: number) => {
    if (!isMe) return null;
    if (lastOwnIndex !== index) return null;
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

  const [sharedPostsMap, setSharedPostsMap] = useState<Record<string, { content: string; author: any; media?: { url: string; media_type: string } | null }>>({});
  useEffect(() => {
    const ids = Array.from(new Set(messages.map(m => m.shared_post_id).filter(Boolean))) as string[];
    const missing = ids.filter(id => !sharedPostsMap[id]);
    if (missing.length === 0) return;
    (async () => {
      const { data: sp } = await supabase.from('posts').select('id, user_id, content, body, media_url, post_media(url, media_type, sort_order)').in('id', missing);
      const rows = sp ?? [];
      const uids = Array.from(new Set(rows.map((r: any) => r.user_id)));
      const am: Record<string, any> = {};
      if (uids.length > 0) {
        const { data: aus } = await supabase.from('profiles').select('id, full_name, username, avatar_url').in('id', uids);
        (aus ?? []).forEach((a: any) => { am[a.id] = a; });
      }
      setSharedPostsMap(prev => {
        const n = { ...prev };
        rows.forEach((r: any) => {
          const pmArr = Array.isArray(r.post_media) ? [...r.post_media].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) : [];
          const firstMedia = pmArr[0] ? { url: pmArr[0].url, media_type: pmArr[0].media_type } : (r.media_url ? { url: r.media_url, media_type: 'image' } : null);
          n[r.id] = { content: r.content ?? r.body ?? '', author: am[r.user_id] ?? null, media: firstMedia };
        });
        missing.forEach(id => { if (!n[id]) n[id] = { content: 'Post unavailable', author: null }; });
        return n;
      });
    })();
  }, [messages, sharedPostsMap]);
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
    const msg: MessageItem = item.data;
    const isMe = msg.sender_id === currentUserId;
    const status = getStatus(msg, isMe, item.index);
    const showTs = showTimestamp === msg.id;
    const reactions = msg._reactions || [];
    const myReaction = reactions.find(r => r.user_id === currentUserId)?.emoji;
    const isStarred = starredIds.has(msg.id);
    const replySourceMsg = msg.reply_to_id ? messages.find(m => m.id === msg.reply_to_id) : null;
    const replyPreview = replySourceMsg ? (replySourceMsg.text || (replySourceMsg.media_type === 'image' ? '📷 Photo' : '🎬 Video')) : null;
    const isMediaOnly = (msg.media_type === 'image' || msg.media_type === 'gif') && msg.media_url && !msg.text;
    const sharedPost = msg.shared_post_id ? sharedPostsMap[msg.shared_post_id] : null;

    return (
      <View style={[s.row, isMe ? s.rowMe : s.rowOther]}>
        {!isMe && (
          <View style={s.sideAvatarSlot}>
            {otherUser?.avatar_url
              ? <ExpoImage source={{ uri: otherUser.avatar_url }} style={s.sideAvatar} contentFit="cover" />
              : <View style={s.sideAvatarFb}><Text style={s.sideAvatarTxt}>{otherInits}</Text></View>}
          </View>
        )}
        <Pressable style={[s.bubbleCol, isMe ? s.bubbleColMe : s.bubbleColOther]}
          onPress={() => setShowTimestamp(prev => prev === msg.id ? null : msg.id)}
          onLongPress={() => setSelectedMsg(msg)} delayLongPress={380}>
          {msg.shared_post_id && (
            <TouchableOpacity style={{ width: 232, backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, borderColor: '#D1D5DB', borderRadius: 14, overflow: 'hidden', marginBottom: 4 }} activeOpacity={0.85} onPress={() => navigation.navigate('Post', { postId: msg.shared_post_id })} onLongPress={() => setSelectedMsg(msg)} delayLongPress={380}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8 }}>
                {sharedPost?.author?.avatar_url
                  ? <ExpoImage source={{ uri: sharedPost.author.avatar_url }} style={{ width: 24, height: 24, borderRadius: 12 }} contentFit="cover" />
                  : <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#E5E7EB' }} />}
                <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#0A0A0A', flex: 1 }} numberOfLines={1}>{sharedPost?.author?.full_name || sharedPost?.author?.username || 'Post'}</Text>
              </View>
              {sharedPost?.media?.url ? (
                sharedPost.media.media_type === 'video' ? (
                  <View style={{ width: '100%', height: 232, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 15, color: '#0A0A0A', marginLeft: 3 }}>{'\u25B6'}</Text>
                    </View>
                  </View>
                ) : (
                  <ExpoImage source={{ uri: sharedPost.media.url }} style={{ width: '100%', height: 232 }} contentFit="cover" />
                )
              ) : null}
              {(sharedPost?.content ?? '') !== '' ? (
                <Text style={{ fontSize: 13, color: '#374151', paddingHorizontal: 10, paddingVertical: 8 }} numberOfLines={sharedPost?.media?.url ? 2 : 4}>{sharedPost?.content}</Text>
              ) : (!sharedPost?.media?.url ? (
                <Text style={{ fontSize: 13, color: '#8E8E93', paddingHorizontal: 10, paddingBottom: 8 }}>Tap to view post</Text>
              ) : null)}
            </TouchableOpacity>
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
          {isMediaOnly ? (
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
            ]}>
              {(msg.media_type === 'image' || msg.media_type === 'gif') && msg.media_url ? (
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
              {msg.media_type === 'video' && msg.media_url ? (
                <TouchableOpacity style={[s.videoThumb, { width: MSG_IMG_MAX_W, height: MSG_VID_H }]}
                  activeOpacity={0.85} onPress={() => setFullscreenVideo(msg.media_url!)}
                  onLongPress={() => setSelectedMsg(msg)}>
                  <View style={s.videoPlayCircle}><Feather name="play" size={24} color="#FFF" /></View>
                </TouchableOpacity>
              ) : null}
              {msg.media_type === 'document' && msg.media_url ? (
                <TouchableOpacity style={s.docBubble} activeOpacity={0.8}
                  onPress={() => { if (msg.media_url) Linking.openURL(msg.media_url); }}>
                  <View style={[s.docIconBg, isMe && s.docIconBgMe]}>
                    <Feather name="file-text" size={20} color={isMe ? '#FFF' : NAVY} />
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
                      ) : <Text style={[s.bubbleTxt, isMe ? s.bubbleTxtMe : s.bubbleTxtOther]}>{displayText}</Text>
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
          {status && <Text style={[s.status, isMe ? s.statusMe : s.statusOther]}>{status}{(msg as any).edited_at ? ' · edited' : ''}</Text>}
          {showTs && <Text style={[s.tsLabel, isMe ? s.tsLabelMe : s.tsLabelOther]}>{fmtTime(msg.created_at)}</Text>}
        </Pressable>
      </View>
    );
  };

  const canSend = message.trim().length > 0 && !composerLocked;
  const toolbarMaxH = toolbarH.interpolate({ inputRange: [0, 1], outputRange: [0, 160] });

  const renderInfoMediaTab = () => {
    if (infoLoading) return <View style={s.infoTabLoading}><ActivityIndicator color={NAVY} /></View>;
    if (infoMedia.length === 0) return <Text style={s.infoEmpty}>No photos or videos yet</Text>;
    return (
      <View style={s.mediaGrid}>
        {infoMedia.map(m => (
          <TouchableOpacity key={m.id} style={s.mediaGridItem} activeOpacity={0.85}
            onPress={() => {
              if (!m.media_url) return;
              setShowInfoModal(false);
              setTimeout(() => {
                if (m.media_type === 'video') setFullscreenVideo(m.media_url);
                else setFullscreenImg(m.media_url);
              }, 250);
            }}>
            <ExpoImage source={{ uri: m.media_url }} style={{ width: Math.floor((SCREEN_W - 28 - 6) / 3), height: Math.floor((SCREEN_W - 28 - 6) / 3) }} contentFit="cover" cachePolicy="memory-disk" />
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
    if (infoLoading) return <View style={s.infoTabLoading}><ActivityIndicator color={NAVY} /></View>;
    if (infoFiles.length === 0) return <Text style={s.infoEmpty}>No files yet</Text>;
    return (
      <View>
        {infoFiles.map(f => (
          <TouchableOpacity key={f.id} style={s.infoFileRow} activeOpacity={0.7}
            onPress={() => { if (f.media_url) Linking.openURL(f.media_url); }}>
            <View style={s.infoFileIconBg}>
              <Feather name="file-text" size={18} color={NAVY} />
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
    if (infoLoading) return <View style={s.infoTabLoading}><ActivityIndicator color={NAVY} /></View>;
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
          <Feather name="chevron-left" size={26} color={NAVY} />
        </TouchableOpacity>
        <TouchableOpacity style={s.headerCenter} activeOpacity={0.7}
          onPress={() => setShowInfoModal(true)}>
          {isAffiliationConversation
            ? <View style={s.hAvatarFb}><Feather name="users" size={18} color="#3C3C43" /></View>
            : isGroup
              ? (groupAvatarUrl
                ? <ExpoImage source={{ uri: groupAvatarUrl }} style={s.hAvatar} contentFit="cover" />
                : <View style={s.hAvatarFb}><Text style={{ fontSize: 20 }}>{groupEmoji}</Text></View>)
              : otherUser?.avatar_url
                ? <ExpoImage source={{ uri: otherUser.avatar_url }} style={s.hAvatar} contentFit="cover" />
                : <View style={s.hAvatarFb}><Text style={s.hAvatarTxt}>{otherInits}</Text></View>}
          <View style={s.hInfo}>
            <Text style={s.hName} numberOfLines={1}>{chatTitle}</Text>
            {isAffiliationConversation
              ? <Text style={s.hSub}>{affiliation?.post_mode === 'informative' ? 'Announcements only' : 'Community chat'}</Text>
              : !isGroup && otherTyping ? <Text style={[s.hSub, { color: '#34C759' }]}>typing...</Text>
              : !isGroup && otherOnline ? <Text style={[s.hSub, { color: '#34C759' }]}>online</Text>
              : !isGroup && otherUser?.username ? <Text style={s.hSub}>@{otherUser.username}</Text>
              : isGroup ? <Text style={s.hSub}>Tap for info</Text> : null}
          </View>
        </TouchableOpacity>
        <View style={s.headerActions}>
          {!isAffiliationConversation && (
            <TouchableOpacity onPress={() => startCall(false)} style={s.hActionBtn} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
              <Feather name="phone" size={18} color={NAVY} />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setSearchActive(p => !p)}
            style={s.hActionBtn} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
            <Feather name="search" size={18} color={searchActive ? NAVY : '#3C3C43'} />
          </TouchableOpacity>
          {!isAffiliationConversation && (
            <TouchableOpacity onPress={() => startCall(true)} style={s.hActionBtn} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
              <Feather name="video" size={18} color={NAVY} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {searchActive && (
        <View style={s.searchBar}>
          <Feather name="search" size={15} color={TEXT_SECONDARY} />
          <TextInput value={searchQuery} onChangeText={setSearchQuery}
            placeholder="Search in conversation..." placeholderTextColor={TEXT_SECONDARY}
            style={s.searchBarInput} autoFocus returnKeyType="search" clearButtonMode="while-editing" />
          <TouchableOpacity onPress={() => { setSearchActive(false); setSearchQuery(''); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={16} color={TEXT_SECONDARY} />
          </TouchableOpacity>
        </View>
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
            <Text style={s.ctxLabel}>{ctxCard.kind === 'jobs' ? 'JOB ENQUIRY' : 'MARKETPLACE'}</Text>
            <Text style={s.ctxTitle} numberOfLines={1}>{ctxCard.title}</Text>
            {!!ctxCard.sub && <Text style={s.ctxSub} numberOfLines={1}>{ctxCard.sub}</Text>}
          </View>
          <Feather name="chevron-right" size={16} color="#C7C7CC" />
        </TouchableOpacity>
      )}

      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}>
        {loading ? (
          <View style={s.loader}><ActivityIndicator color={NAVY} size="large" /></View>
        ) : (
          <FlatList ref={flatListRef} data={listData} inverted
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
                {isAffiliationConversation
                  ? <View style={s.emptyAvatarFb}><Feather name="users" size={32} color="#3C3C43" /></View>
                  : otherUser?.avatar_url
                    ? <ExpoImage source={{ uri: otherUser.avatar_url }} style={s.emptyAvatar} contentFit="cover" />
                    : <View style={s.emptyAvatarFb}><Text style={s.emptyAvatarTxt}>{otherInits}</Text></View>}
                <Text style={s.emptyName}>{chatTitle}</Text>
                {!isAffiliationConversation && otherUser?.username && <Text style={s.emptyHandle}>@{otherUser.username}</Text>}
                <Text style={s.emptyHint}>
                  {isAffiliationConversation
                    ? (affiliation?.post_mode === 'informative'
                        ? (iAmAffiliationAdmin ? 'Post an announcement for the community.' : 'Admins will post announcements here.')
                        : 'Be the first to say hi to the community.')
                    : 'Send a message to start the conversation.'}
                </Text>
              </View>
            } />
        )}

        <Animated.View style={[s.typingWrap, { opacity: typingOpacity }]} pointerEvents="none">
          <View style={s.sideAvatarSlot}>
            {otherUser?.avatar_url
              ? <ExpoImage source={{ uri: otherUser.avatar_url }} style={s.sideAvatar} contentFit="cover" />
              : <View style={s.sideAvatarFb}><Text style={s.sideAvatarTxt}>{otherInits}</Text></View>}
          </View>
          <View style={[s.bubble, s.bubbleOther, s.typingBubble]}>
            <Animated.View style={[s.typingDot, { transform: [{ translateY: dot1 }] }]} />
            <Animated.View style={[s.typingDot, { transform: [{ translateY: dot2 }] }]} />
            <Animated.View style={[s.typingDot, { transform: [{ translateY: dot3 }] }]} />
          </View>
        </Animated.View>

        {replyTo && (
          <View style={s.replyBanner}>
            <View style={s.replyBannerAccent} />
            <View style={s.replyBannerContent}>
              <Text style={s.replyBannerLabel}>Replying to {replyTo.sender_id === currentUserId ? 'yourself' : chatTitle}</Text>
              <Text style={s.replyBannerPrev} numberOfLines={1}>{replySource}</Text>
            </View>
            <TouchableOpacity onPress={() => setReplyTo(null)} style={s.replyBannerClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={16} color={TEXT_SECONDARY} />
            </TouchableOpacity>
          </View>
        )}

        {!composerLocked && (
          <Animated.View style={[s.toolbar, { maxHeight: toolbarMaxH, overflow: 'hidden' }]}>
            {showGifs ? <GifPicker onSelect={sendGif} onBack={() => setShowGifs(false)} /> : (
              <View style={s.toolbarGrid}>
                {[
                  { iconName: 'camera', label: 'Camera', action: openCamera },
                  { iconName: 'image', label: 'Gallery', action: pickAndSendMedia },
                  { iconName: 'film', label: 'GIFs', action: () => setShowGifs(true) },
                  { iconName: 'file-text', label: 'Files', action: pickAndSendDocument },
                  { iconName: 'info', label: 'Info', action: () => { setShowToolbar(false); setShowInfoModal(true); } },
                ].map(btn => (
                  <TouchableOpacity key={btn.label} style={s.toolbarBtn} onPress={btn.action} activeOpacity={0.7}>
                    <View style={s.toolbarBtnInner}>
                      <Feather name={btn.iconName as any} size={22} color={NAVY} />
                    </View>
                    <Text style={s.toolbarBtnLbl}>{btn.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </Animated.View>
        )}

        {composerLocked ? (
          <View style={[s.lockedBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
            <View style={s.lockedIcon}>
              <Feather name="lock" size={14} color="#7C3AED" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.lockedTitle}>Announcements only</Text>
              <Text style={s.lockedSub}>Only admins can post in this community.</Text>
            </View>
          </View>
        ) : (
          <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            <TouchableOpacity style={s.addBtn}
              onPress={() => { setShowToolbar(p => { if (p) setShowGifs(false); return !p; }); }} activeOpacity={0.6}>
              <Feather name={showToolbar ? 'x' : 'plus'} size={22} color={showToolbar ? TEXT_SECONDARY : NAVY} />
            </TouchableOpacity>
            <View style={s.inputWrap}>
              <TextInput ref={inputRef} value={message} onChangeText={handleTextChange}
                placeholder={isAffiliationConversation && iAmAffiliationAdmin && affiliation?.post_mode === 'informative'
                  ? 'Post an announcement...'
                  : 'Message'}
                placeholderTextColor={TEXT_SECONDARY}
                style={s.input} multiline maxLength={2000} returnKeyType="default" blurOnSubmit={false} />
            </View>
            {uploadingMedia ? (
              <View style={s.sendBtn}><ActivityIndicator color="#FFF" size={14} /></View>
            ) : canSend ? (
              <TouchableOpacity onPress={sendMessage} style={s.sendBtn} activeOpacity={0.7}>
                <Feather name="arrow-up" size={18} color="#FFF" />
              </TouchableOpacity>
            ) : (
              <View style={[s.sendBtn, { backgroundColor: '#E5E5EA' }]}>
                <Feather name="arrow-up" size={18} color={TEXT_SECONDARY} />
              </View>
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      <Modal visible={showInfoModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowInfoModal(false)}>
        <SafeAreaView style={s.infoSafe}>
          <View style={s.infoHeader}>
            <TouchableOpacity onPress={() => setShowInfoModal(false)} style={s.infoDoneBtn}>
              <Text style={s.infoDoneTxt}>Done</Text>
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={s.infoContact}>
              {isAffiliationConversation
                ? <View style={[s.infoAvatarFb, { width: 90, height: 90, borderRadius: 45 }]}>
                    <Feather name="users" size={38} color="#3C3C43" />
                  </View>
                : isGroup
                  ? (groupAvatarUrl
                    ? <ExpoImage source={{ uri: groupAvatarUrl }} style={s.infoAvatar} contentFit="cover" />
                    : <View style={[s.infoAvatarFb, { width: 90, height: 90, borderRadius: 45 }]}>
                        <Text style={{ fontSize: 38 }}>{groupEmoji}</Text>
                      </View>)
                  : otherUser?.avatar_url
                    ? <ExpoImage source={{ uri: otherUser.avatar_url }} style={s.infoAvatar} contentFit="cover" />
                    : <View style={s.infoAvatarFb}><Text style={s.infoAvatarTxt}>{otherInits}</Text></View>}
              <Text style={s.infoName}>{chatTitle}</Text>
              {!isAffiliationConversation && !isGroup && otherUser?.username && <Text style={s.infoHandle}>@{otherUser.username}</Text>}
              {!isAffiliationConversation && !isGroup && otherUser?.degree_program && (
                <Text style={s.infoProg}>{otherUser.degree_program}{otherUser?.graduation_year ? ` · ${otherUser.graduation_year}` : ''}</Text>
              )}
              {!isAffiliationConversation && !isGroup && otherUser?.location && <Text style={s.infoLoc}>📍 {otherUser.location}</Text>}
              {isGroup && !isAffiliationConversation && <Text style={s.infoLoc}>{groupMembers.length} members</Text>}
              {isAffiliationConversation && (
                <Text style={s.infoLoc}>
                  {affiliation?.post_mode === 'informative' ? 'Announcements only' : 'Community chat'}
                </Text>
              )}
            </View>

            <View style={s.infoQuickRow}>
              {false && isAffiliationConversation && affiliation ? [
                { icon: 'users', label: 'View community',
                  action: () => {
                    setShowInfoModal(false);
                    navigation.getParent()?.navigate('Main', {
                      screen: 'Network',
                      params: { screen: 'AffiliationDetail', params: { affiliationId: affiliation.id } },
                    });
                  }},
                { icon: infoMuted ? 'bell-off' : 'bell', label: infoMuted ? 'Unmute' : 'Mute',
                  action: async () => {
                    if (!currentUserId || !conversationId) return;
                    const next = !infoMuted; setInfoMuted(next);
                    await supabase.from('conversation_settings').upsert(
                      { conversation_id: conversationId, user_id: currentUserId, is_muted: next, updated_at: new Date().toISOString() },
                      { onConflict: 'conversation_id,user_id' }
                    )// @ts-ignore
.then(() => {}).catch(() => {});
                  }},
              ].map((q: any) => (
                <TouchableOpacity key={q.label} style={s.infoQuickBtn} onPress={q.action} activeOpacity={0.7}>
                  <View style={s.infoQuickInner}><Feather name={q.icon} size={20} color={NAVY} /></View>
                  <Text style={s.infoQuickLbl}>{q.label}</Text>
                </TouchableOpacity>
              )) : (!isGroup ? [
                { iconName: 'message-circle', label: 'Message', action: () => setShowInfoModal(false) },
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
.then(() => {}).catch(() => {});
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
                    <Feather name={q.iconName} size={20} color={NAVY} />
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

            {!isAffiliationConversation && !isGroup && otherUser?.bio && (
              <View style={s.infoSection}>
                <Text style={s.infoSectionTitle}>About</Text>
                <Text style={s.infoBio}>{otherUser.bio}</Text>
              </View>
            )}

            {isGroup && !isAffiliationConversation && groupMembers.length > 0 && (
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
                    <Text style={s.infoMemberName}>{m.profile?.full_name || 'Member'}</Text>
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

            {!isAffiliationConversation && !isGroup && (
              <View style={s.infoSection}>
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
              placeholderTextColor={TEXT_SECONDARY} placeholder="Edit your message..." />
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
                { iconName: 'corner-up-left', label: 'Reply', action: () => { setReplyTo(selectedMsg); setSelectedMsg(null); inputRef.current?.focus(); } },
                { iconName: 'copy', label: 'Copy', action: async () => {
                  if (selectedMsg?.text) { await Clipboard.setStringAsync(selectedMsg.text); setSelectedMsg(null); Alert.alert('Copied'); }
                }},
                { iconName: 'share-2', label: 'Share', action: async () => {
                  if (!selectedMsg) return;
                  const content = selectedMsg.text || selectedMsg.media_url || '';
                  setSelectedMsg(null); await Share.share({ message: content });
                }},
                { iconName: 'star',
                  label: selectedMsg && starredIds.has(selectedMsg.id) ? 'Unstar' : 'Star',
                  action: () => { if (selectedMsg) { toggleStar(selectedMsg); setSelectedMsg(null); } }},
                { iconName: 'bookmark',
                  label: savedIds.has(selectedMsg?.id || '') ? 'Unsave' : 'Save',
                  action: () => { if (selectedMsg) { toggleSaveMessage(selectedMsg.id); setSelectedMsg(null); } }},
                { iconName: 'corner-up-right', label: 'Forward', action: () => { if (selectedMsg) { openForward(selectedMsg); setSelectedMsg(null); } }},
                ...(selectedMsg?.sender_id === currentUserId && selectedMsg?.text ? [{
                  iconName: 'edit-2', label: 'Edit', action: () => {
                    setEditingMsg(selectedMsg); setEditText(selectedMsg?.text || ''); setSelectedMsg(null);
                  }}] : []),
                ...(selectedMsg?.sender_id === currentUserId ? [{ iconName: 'trash-2', label: 'Delete', action: async () => {
                  if (!selectedMsg) return;
                  const msgId = selectedMsg.id;
                  const convId = selectedMsg.conversation_id;
                  setSelectedMsg(null);
                  setMessages(prev => prev.filter(m => m.id !== msgId));
                  const { error } = await supabase.from('messages').delete().eq('id', msgId).eq('sender_id', currentUserId!);
                  if (error) { await fetchMessages(); return; }
                  if (convId) {
                    const { data: latest } = await supabase.from('messages').select('text, media_type, created_at')
                      .eq('conversation_id', convId).order('created_at', { ascending: false }).limit(1).maybeSingle();
                    const preview = latest ? (latest.text || (latest.media_type === 'image' ? '📷 Photo' : '📎 Media')) : '';
                    await supabase.from('conversations').update({ last_message: preview, last_message_time: latest?.created_at ?? null }).eq('id', convId);
                  }
                }}] : []),
              ].map(a => (
                <TouchableOpacity key={a.label} style={s.reactionActionBtn} onPress={a.action} activeOpacity={0.7}>
                  <View style={s.reactionActionInner}>
                    <Feather name={a.iconName as any} size={18} color={a.label === 'Delete' ? '#EF4444' : NAVY} />
                  </View>
                  <Text style={[s.reactionActionLbl, a.label === 'Delete' && { color: '#EF4444' }]}>{a.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </Pressable>
      </Modal>

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
        <SafeAreaView style={{ flex: 1, backgroundColor: '#FFF' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE }}>
            <Text style={{ fontSize: 17, fontWeight: '700' }}>Forward to...</Text>
            <TouchableOpacity onPress={() => { setShowForwardPicker(false); setForwardMsg(null); }}>
              <Feather name="x" size={22} color="#000" />
            </TouchableOpacity>
          </View>
          <FlatList data={forwardConvs} keyExtractor={c => c.id}
            contentContainerStyle={{ padding: 12, gap: 6 }}
            renderItem={({ item: c }) => (
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#F7F7F7', borderRadius: 14, padding: 14 }}
                activeOpacity={0.7}
                onPress={async () => {
                  if (!forwardMsg || !currentUserId) return;
                  setShowForwardPicker(false);
                  const receiverId = c.is_group ? null : (c.user_1 === currentUserId ? c.user_2 : c.user_1);
                  const { error } = await supabase.from('messages').insert({
                    conversation_id: c.id, sender_id: currentUserId, receiver_id: receiverId,
                    text: forwardMsg.text || null, media_url: forwardMsg.media_url || null,
                    media_type: forwardMsg.media_type || null, forwarded_from_id: forwardMsg.id,
                  });
                  if (error) Alert.alert('Error', 'Could not forward: ' + error.message);
                  else {
                    await supabase.from('conversations').update({
                      last_message: forwardMsg.text || (forwardMsg.media_type === 'image' ? '📷 Photo' : '📎 Media'),
                      last_message_time: new Date().toISOString(),
                    }).eq('id', c.id);
                    Alert.alert('Forwarded');
                  }
                  setForwardMsg(null);
                }}>
                <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: c.is_group ? NAVY : NAVY_SOFT, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: '#FFF', fontSize: c.is_group ? 18 : 16, fontWeight: '700' }}>{c.is_group ? (c.group_emoji || '💬') : '💬'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: '#111' }} numberOfLines={1}>
                    {c.is_group ? (c.group_name || 'Group') : 'Direct Message'}
                  </Text>
                  <Text style={{ fontSize: 12, color: TEXT_SECONDARY }} numberOfLines={1}>{c.last_message || 'No messages yet'}</Text>
                </View>
              </TouchableOpacity>
            )}
            ListEmptyComponent={<View style={{ alignItems: 'center', paddingTop: 60 }}><Text style={{ color: TEXT_SECONDARY }}>No other conversations</Text></View>} />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  ctxCard: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#F7F8FA', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5EA' },
  ctxThumb: { width: 46, height: 46, borderRadius: 8, backgroundColor: '#E5E5EA' },
  ctxThumbFallback: { alignItems: 'center', justifyContent: 'center' },
  ctxLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: '#8E8E93' },
  ctxTitle: { fontSize: 14.5, fontWeight: '700', color: '#0A0A0A', letterSpacing: -0.2, marginTop: 2 },
  ctxSub: { fontSize: 12.5, fontWeight: '500', color: '#6B7280', marginTop: 1 },
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE, minHeight: 58, gap: 8 },
  backBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F2F2F7', marginHorizontal: 12, marginBottom: 4, marginTop: 2, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  searchBarInput: { flex: 1, fontSize: 14, color: '#000', padding: 0 },
  headerCenter: { flex: 1, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 10 },
  hAvatar: { width: 38, height: 38, borderRadius: 19 },
  hAvatarFb: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#E5E5EA', alignItems: 'center', justifyContent: 'center' },
  hAvatarTxt: { fontSize: 14, fontWeight: '600', color: '#3C3C43' },
  hInfo: { alignItems: 'flex-start', maxWidth: 160 },
  hName: { fontSize: 15, fontWeight: '600', color: TEXT_PRIMARY, letterSpacing: -0.2 },
  hSub: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 },
  headerActions: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  hActionBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 0, paddingTop: 10, paddingBottom: 6, flexGrow: 1 },
  sep: { alignItems: 'center', paddingVertical: 12 },
  sepTxt: { fontSize: 11, color: TEXT_SECONDARY, fontWeight: '600', letterSpacing: 0.3 },
  row: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 3, paddingHorizontal: 12 },
  rowMe: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  sideAvatarSlot: { width: 28, marginRight: 6, alignItems: 'center', justifyContent: 'flex-end', marginBottom: 2 },
  sideAvatar: { width: 28, height: 28, borderRadius: 14 },
  sideAvatarFb: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#E5E5EA', alignItems: 'center', justifyContent: 'center' },
  sideAvatarTxt: { fontSize: 10, fontWeight: '700', color: '#3C3C43' },
  bubbleCol: { maxWidth: '78%', flexShrink: 1 },
  bubbleColMe: { alignItems: 'flex-end' },
  bubbleColOther: { alignItems: 'flex-start' },
  bubble: { paddingHorizontal: 10, paddingVertical: 7, position: 'relative', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 1, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  bubbleMe: { backgroundColor: NAVY, borderRadius: 8, borderTopRightRadius: 3 },
  bubbleOther: { backgroundColor: BUBBLE_OTHER, borderRadius: 8, borderTopLeftRadius: 3 },
  bubbleMeFlat: { backgroundColor: NAVY, borderRadius: 8 },
  bubbleOtherFlat: { backgroundColor: BUBBLE_OTHER, borderRadius: 8 },
  bubbleTxt: { fontSize: 15.5, lineHeight: 20, letterSpacing: -0.1 },
  bubbleTxtMe: { color: '#FFFFFF' },
  bubbleTxtOther: { color: TEXT_PRIMARY },
  linkTxt: { textDecorationLine: 'underline' },
  imgWrap: { borderRadius: 18, overflow: 'hidden', position: 'relative' },
  replyBar: { flexDirection: 'row', marginBottom: 4, borderRadius: 14, overflow: 'hidden', maxWidth: '100%' },
  replyBarMe: { backgroundColor: 'rgba(255,255,255,0.14)' },
  replyBarOther: { backgroundColor: 'rgba(11,30,61,0.06)' },
  replyAccent: { width: 3 },
  replyAccentMe: { backgroundColor: '#FFFFFF' },
  replyAccentOther: { backgroundColor: NAVY },
  replyLabel: { fontSize: 11, fontWeight: '700', color: NAVY, paddingHorizontal: 10, paddingTop: 7, paddingBottom: 1 },
  replyLabelMe: { color: 'rgba(255,255,255,0.75)' },
  replyTxt: { fontSize: 13, color: '#3C3C43', paddingHorizontal: 10, paddingTop: 2, paddingBottom: 8, lineHeight: 17 },
  replyTxtMe: { color: 'rgba(255,255,255,0.88)' },
  gifBadge: { position: 'absolute', bottom: 8, left: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  gifBadgeTxt: { fontSize: 10, fontWeight: '700', color: '#FFF', letterSpacing: 0.3 },
  starBadge: { position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.55)', width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  starBadgeInline: { position: 'absolute', top: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.12)', width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  starBadgeTxt: { fontSize: 12, color: '#FFD60A', fontWeight: '700' },
  videoThumb: { backgroundColor: '#1C1C1E', borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  videoPlayCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' },
  docBubble: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4, minWidth: 200 },
  docIconBg: { width: 40, height: 40, borderRadius: 10, backgroundColor: 'rgba(11,30,61,0.08)', alignItems: 'center', justifyContent: 'center' },
  docIconBgMe: { backgroundColor: 'rgba(255,255,255,0.15)' },
  docName: { fontSize: 14, fontWeight: '600', color: TEXT_PRIMARY, lineHeight: 19 },
  docNameMe: { color: '#FFF' },
  docTap: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 },
  docTapMe: { color: 'rgba(255,255,255,0.65)' },
  // Story reply label
  storyReplyLabel: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  storyReplyTxt: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  storyReplyTxtMe: { color: 'rgba(255,255,255,0.6)' },
  storyReplyTxtOther: { color: '#2563EB' },
  reactionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  reactionsRowMe: { justifyContent: 'flex-end' },
  reactionsRowOther: { justifyContent: 'flex-start' },
  reactionPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FFFFFF', borderRadius: 14, paddingHorizontal: 9, paddingVertical: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  reactionPillMine: { backgroundColor: '#E8EEF8', borderColor: NAVY },
  reactionEmoji: { fontSize: 14 },
  reactionCount: { fontSize: 11, fontWeight: '600', color: '#3C3C43' },
  status: { fontSize: 10.5, marginTop: 4, color: TEXT_SECONDARY, fontWeight: '500' },
  statusMe: { textAlign: 'right', marginRight: 4 },
  statusOther: { marginLeft: 4 },
  tsLabel: { fontSize: 10.5, color: TEXT_SECONDARY, marginTop: 2 },
  tsLabelMe: { textAlign: 'right', marginRight: 4 },
  tsLabelOther: { marginLeft: 4 },
  typingWrap: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingBottom: 6, marginBottom: 2 },
  typingBubble: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 14, paddingVertical: 11 },
  typingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: TEXT_SECONDARY },
  replyBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F7F7F9', paddingHorizontal: 14, paddingVertical: 10, gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE },
  replyBannerAccent: { width: 3, height: 32, borderRadius: 2, backgroundColor: NAVY },
  replyBannerContent: { flex: 1 },
  replyBannerLabel: { fontSize: 12, fontWeight: '600', color: NAVY },
  replyBannerPrev: { fontSize: 13, color: '#3C3C43', marginTop: 1 },
  replyBannerClose: { padding: 4 },
  toolbar: { backgroundColor: '#FFFFFF', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE },
  toolbarGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingVertical: 16, gap: 20, justifyContent: 'flex-start' },
  toolbarBtn: { alignItems: 'center', gap: 6 },
  toolbarBtnInner: { width: 52, height: 52, borderRadius: 18, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  toolbarBtnLbl: { fontSize: 11, color: '#3C3C43', fontWeight: '500' },
  bar: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 10, paddingTop: 8, backgroundColor: '#FFFFFF', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE, gap: 8 },
  addBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  inputWrap: { flex: 1, backgroundColor: '#F2F2F7', borderRadius: 22, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, minHeight: 40, justifyContent: 'center' },
  input: { fontSize: 16, color: TEXT_PRIMARY, maxHeight: 130, padding: 0, margin: 0, letterSpacing: -0.1 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  lockedBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingTop: 14, backgroundColor: '#F9FAFB', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE },
  lockedIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#F3E8FF', alignItems: 'center', justifyContent: 'center' },
  lockedTitle: { fontSize: 13, fontWeight: '700', color: '#1F2937' },
  lockedSub: { fontSize: 11, color: '#6B7280', marginTop: 1 },
  fullscreenRoot: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  fullscreenClose: { position: 'absolute', top: 60, right: 20, zIndex: 10, width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  fullscreenActions: { position: 'absolute', bottom: 40, flexDirection: 'row', gap: 10 },
  fsActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 },
  fsActionTxt: { color: '#FFF', fontWeight: '600' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 6 },
  emptyAvatar: { width: 72, height: 72, borderRadius: 36, marginBottom: 4 },
  emptyAvatarFb: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#E5E5EA', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyAvatarTxt: { fontSize: 28, fontWeight: '600', color: '#3C3C43' },
  emptyName: { fontSize: 18, fontWeight: '600', color: TEXT_PRIMARY },
  emptyHandle: { fontSize: 14, color: TEXT_SECONDARY },
  emptyHint: { fontSize: 13, color: '#C6C6C8', marginTop: 8, textAlign: 'center', paddingHorizontal: 40 },
  reactionOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  reactionSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 14, paddingBottom: 34 },
  reactionEmojis: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  reactionEmojiBtn: { padding: 6 },
  reactionEmojiTxt: { fontSize: 30 },
  reactionActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', paddingHorizontal: 16, paddingVertical: 16, gap: 12 },
  reactionActionBtn: { alignItems: 'center', gap: 6, minWidth: 62 },
  reactionActionInner: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  reactionActionLbl: { fontSize: 11, color: '#3C3C43', fontWeight: '500' },
  infoSafe: { flex: 1, backgroundColor: '#F7F7F9' },
  infoHeader: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#FFFFFF', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  infoDoneBtn: { paddingVertical: 4, paddingHorizontal: 4 },
  infoDoneTxt: { fontSize: 16, color: NAVY, fontWeight: '600' },
  infoContact: { backgroundColor: '#FFFFFF', alignItems: 'center', paddingVertical: 32, paddingHorizontal: 20, marginBottom: 8 },
  infoAvatar: { width: 90, height: 90, borderRadius: 45, marginBottom: 14 },
  infoAvatarFb: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#E5E5EA', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  infoAvatarTxt: { fontSize: 34, fontWeight: '600', color: '#3C3C43' },
  infoName: { fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY, marginBottom: 4, letterSpacing: -0.3 },
  infoHandle: { fontSize: 14, color: NAVY, marginBottom: 4, fontWeight: '500' },
  infoProg: { fontSize: 13, color: '#3C3C43', marginBottom: 4 },
  infoLoc: { fontSize: 13, color: TEXT_SECONDARY },
  infoQuickRow: { flexDirection: 'row', backgroundColor: '#FFFFFF', paddingVertical: 16, paddingHorizontal: 8, marginBottom: 8, justifyContent: 'space-around' },
  infoQuickBtn: { alignItems: 'center', gap: 6, flex: 1 },
  infoQuickInner: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  infoQuickLbl: { fontSize: 11, color: '#3C3C43', fontWeight: '500' },
  infoTabsSection: { backgroundColor: '#FFFFFF', marginBottom: 8 },
  infoTabBar: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  infoTab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  infoTabActive: { borderBottomWidth: 2, borderBottomColor: NAVY },
  infoTabTxt: { fontSize: 13, fontWeight: '600', color: TEXT_SECONDARY },
  infoTabTxtActive: { color: NAVY },
  infoTabBody: { paddingHorizontal: 14, paddingVertical: 12, minHeight: 140 },
  infoTabLoading: { alignItems: 'center', justifyContent: 'center', paddingVertical: 30 },
  infoEmpty: { fontSize: 14, color: TEXT_SECONDARY, textAlign: 'center', paddingVertical: 24 },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  mediaGridItem: { width: Math.floor((SCREEN_W - 28 - 6) / 3), height: Math.floor((SCREEN_W - 28 - 6) / 3), borderRadius: 6, overflow: 'hidden', backgroundColor: '#F2F2F7', position: 'relative' },
  mediaPlayOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.2)' },
  infoFileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  infoFileIconBg: { width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(11,30,61,0.08)', alignItems: 'center', justifyContent: 'center' },
  infoFileName: { fontSize: 14, fontWeight: '600', color: '#111' },
  infoFileMeta: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 2 },
  infoStarredRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  infoStarredTxt: { fontSize: 14, color: '#111', lineHeight: 19 },
  infoStarredMeta: { fontSize: 12, color: TEXT_SECONDARY, marginTop: 4 },
  infoStarredUnstar: { padding: 4 },
  infoStarredIcon: { fontSize: 20, color: '#FFD60A' },
  infoSection: { backgroundColor: '#FFFFFF', padding: 16, marginBottom: 8 },
  infoSectionTitle: { fontSize: 12, fontWeight: '600', color: TEXT_SECONDARY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  infoBio: { fontSize: 15, color: '#3C3C43', lineHeight: 22 },
  infoMemberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  infoMemberAvatar: { width: 36, height: 36, borderRadius: 10 },
  infoMemberName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#111' },
  infoAdminBadge: { backgroundColor: NAVY, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  infoAdminTxt: { fontSize: 10, color: '#FFF', fontWeight: '700', letterSpacing: 0.3 },
  infoSeeAll: { fontSize: 14, color: NAVY, fontWeight: '600', paddingVertical: 8 },
  infoDanger: { backgroundColor: '#FEF2F2', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  infoDangerTxt: { fontSize: 15, fontWeight: '700', color: '#DC2626' },
  editMsgSheet: { backgroundColor: '#FFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: 24 },
  editMsgHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  editMsgTitle: { fontSize: 15, fontWeight: '700', color: '#000' },
  editMsgCancelTxt: { fontSize: 15, color: TEXT_SECONDARY, fontWeight: '500' },
  editMsgSaveTxt: { fontSize: 15, fontWeight: '700', color: NAVY },
  editOriginal: { backgroundColor: '#F7F7F9', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  editOriginalLabel: { fontSize: 11, fontWeight: '700', color: NAVY, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
  editOriginalTxt: { fontSize: 14, color: TEXT_SECONDARY, lineHeight: 19 },
  editMsgInput: { backgroundColor: '#FFF', paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: '#000', minHeight: 90, textAlignVertical: 'top' },
});
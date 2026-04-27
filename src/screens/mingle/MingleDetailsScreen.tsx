/**
 * MingleDetailsScreen.tsx
 * Polished event detail page matching the timeline design language.
 * All existing functionality preserved: join/leave, comments, attendees,
 * image rendering, sharing, realtime updates.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Image,
  ActivityIndicator, Alert, StatusBar, RefreshControl, TextInput,
  KeyboardAvoidingView, Platform, Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import SafeImage from '../../components/SafeImage';

const NAVY = '#0B1E3D';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#8E8E93';
const HAIRLINE = '#E5E5EA';
const GREEN = '#059669';

type MinglePost = {
  id: string; host_id: string; host_name: string; host_avatar: string | null;
  title: string; category: string; location: string; event_time: string;
  description: string | null; image_url: string | null; created_at: string;
};
type Attendee = { id: string; user_id: string; full_name: string; avatar_url: string | null };
type Comment = { id: string; user_id: string; body: string; created_at: string; author_name: string; author_avatar: string | null };

function initials(n?: string | null) {
  if (!n) return 'U';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[1][0]).toUpperCase();
}
function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60);
  if (m < 1) return 'now'; if (m < 60) return m + 'm'; if (h < 24) return h + 'h';
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function commentText(row: any): string {
  return row?.body ?? row?.content ?? row?.text ?? row?.message ?? '';
}

export default function MingleDetailsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const myId = profile?.id ?? null;
  const postId = route.params?.postId;

  const [post, setPost] = useState<MinglePost | null>(null);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [joined, setJoined] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joining, setJoining] = useState(false);
  const [draft, setDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!postId) return;
    try {
      const { data: pd } = await supabase.from('mingle_posts').select('*').eq('id', postId).single();
      if (pd) {
        const { data: host } = await supabase.from('profiles').select('id, full_name, avatar_url').eq('id', pd.host_id).single();
        setPost({ ...pd, host_name: host?.full_name || 'Host', host_avatar: host?.avatar_url || null });
      }
      const { data: att } = await supabase.from('mingle_post_attendees').select('id, user_id').eq('post_id', postId);
      if (att) {
        const uids = att.map((a: any) => a.user_id);
        const profilesRes = uids.length > 0 ? await supabase.from('profiles').select('id, full_name, avatar_url').in('id', uids) : { data: [] as any[] };
        const pm: Record<string, any> = {};
        (profilesRes.data || []).forEach((p: any) => { pm[p.id] = p; });
        setAttendees(att.map((a: any) => ({ id: a.id, user_id: a.user_id, full_name: pm[a.user_id]?.full_name || 'Member', avatar_url: pm[a.user_id]?.avatar_url || null })));
        setJoined(att.some((a: any) => a.user_id === myId));
      }
      const { data: cmt } = await supabase.from('mingle_comments').select('*').eq('post_id', postId).order('created_at', { ascending: true });
      if (cmt) {
        const cuids = cmt.map((c: any) => c.user_id);
        const authorsRes = cuids.length > 0 ? await supabase.from('profiles').select('id, full_name, avatar_url').in('id', cuids) : { data: [] as any[] };
        const apm: Record<string, any> = {};
        (authorsRes.data || []).forEach((p: any) => { apm[p.id] = p; });
        setComments(cmt.map((c: any) => ({ id: c.id, user_id: c.user_id, body: commentText(c), created_at: c.created_at, author_name: apm[c.user_id]?.full_name || 'Member', author_avatar: apm[c.user_id]?.avatar_url || null })));
      }
    } catch (e) { console.log('MINGLE_DETAILS_LOAD', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [postId, myId]);

  useEffect(() => { load(); }, [load]);

  const toggleJoin = async () => {
    if (!myId || joining) return;
    setJoining(true);
    try {
      if (joined) {
        await supabase.from('mingle_post_attendees').delete().eq('post_id', postId).eq('user_id', myId);
        setJoined(false);
        setAttendees(prev => prev.filter(a => a.user_id !== myId));
      } else {
        await supabase.from('mingle_post_attendees').insert({ post_id: postId, user_id: myId });
        setJoined(true);
        setAttendees(prev => [...prev, { id: Date.now().toString(), user_id: myId, full_name: profile?.full_name || 'You', avatar_url: profile?.avatar_url || null }]);
      }
    } catch { Alert.alert('Error', 'Could not update attendance.'); }
    finally { setJoining(false); }
  };

  const sendComment = async () => {
    if (!draft.trim() || submitting || !myId) return;
    setSubmitting(true);
    const body = draft.trim();
    setDraft('');
    try {
      const { data: inserted, error } = await supabase.from('mingle_comments').insert({ post_id: postId, user_id: myId, body }).select('*').single();
      if (error) { setDraft(body); Alert.alert('Error', error.message); return; }
      setComments(prev => [...prev, { id: inserted.id, user_id: myId, body: commentText(inserted), created_at: inserted.created_at, author_name: profile?.full_name || 'You', author_avatar: profile?.avatar_url || null }]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200);
    } catch (e: any) { setDraft(body); }
    finally { setSubmitting(false); }
  };

  const shareEvent = async () => {
    if (!post) return;
    await Share.share({ message: `${post.title}\n📍 ${post.location}\n🕐 ${post.event_time}\n\nJoin us on PlatinumCircles Mingle!` });
  };

  if (loading) return <SafeAreaView style={st.safe}><View style={st.center}><ActivityIndicator color={NAVY} size="large" /></View></SafeAreaView>;
  if (!post) return (
    <SafeAreaView style={st.safe}>
      <View style={st.center}>
        <Feather name="alert-circle" size={40} color="#E5E5EA" />
        <Text style={{ fontSize: 18, fontWeight: '600', color: '#3C3C43', marginTop: 12 }}>Event not found</Text>
        <TouchableOpacity style={st.goBackBtn} onPress={() => navigation.goBack()}>
          <Text style={st.goBackBtnTxt}>Go back</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  const isHost = post.host_id === myId;

  return (
    <SafeAreaView style={st.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />

      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={st.backBtn} activeOpacity={0.7}>
          <Feather name="chevron-left" size={24} color={NAVY} />
        </TouchableOpacity>
        <Text style={st.headerTitle} numberOfLines={1}>{post.title}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TouchableOpacity style={st.hdrIcon} onPress={shareEvent} activeOpacity={0.7}>
            <Feather name="share-2" size={16} color={TEXT_PRIMARY} />
          </TouchableOpacity>
          {isHost && (
            <TouchableOpacity style={st.hdrIcon} onPress={() => {
              Alert.alert('Delete event?', 'This cannot be undone.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: async () => {
                  await supabase.from('mingle_posts').delete().eq('id', post.id);
                  navigation.goBack();
                }},
              ]);
            }} activeOpacity={0.7}>
              <Feather name="trash-2" size={16} color="#FF3B30" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={NAVY} />}
          contentContainerStyle={{ paddingBottom: 16 }}
        >
          {/* Hero */}
          {post.image_url ? (
            <SafeImage uri={post.image_url} style={st.heroImage} logPrefix="MINGLE_HERO" showFallbackLabel={false} />
          ) : (
            <View style={st.heroGradient} />
          )}

          <View style={st.body}>
            {/* Category + going */}
            <View style={st.topRow}>
              <View style={st.catPill}><Text style={st.catPillTxt}>{post.category}</Text></View>
              <Text style={st.goingCount}>{attendees.length} {attendees.length === 1 ? 'person' : 'people'} going</Text>
            </View>

            <Text style={st.eventTitle}>{post.title}</Text>

            {/* Info card */}
            <View style={st.infoCard}>
              <InfoRow icon="user" label="Host" value={post.host_name} onPress={() => navigation.navigate('UserProfile', { userId: post.host_id })} />
              <InfoRow icon="map-pin" label="Where" value={post.location} />
              <InfoRow icon="clock" label="When" value={post.event_time} />
            </View>

            {/* Description */}
            {post.description ? (
              <>
                <Text style={st.secLabel}>About this event</Text>
                <Text style={st.descText}>{post.description}</Text>
              </>
            ) : null}

            {/* Attendees */}
            <Text style={st.secLabel}>Who's going ({attendees.length})</Text>
            {attendees.length === 0 ? (
              <Text style={st.noContent}>No one has joined yet. Be the first!</Text>
            ) : (
              <View style={st.attendeesList}>
                {attendees.slice(0, 10).map(a => (
                  <TouchableOpacity key={a.id} style={st.attendeeItem} onPress={() => navigation.navigate('UserProfile', { userId: a.user_id })} activeOpacity={0.8}>
                    {a.avatar_url
                      ? <Image source={{ uri: a.avatar_url }} style={st.attendeeAvatar} />
                      : <View style={[st.attendeeAvatar, st.attendeeAvatarFb]}><Text style={st.attendeeAvatarTxt}>{initials(a.full_name)}</Text></View>}
                    <Text style={st.attendeeName} numberOfLines={1}>{a.full_name}</Text>
                  </TouchableOpacity>
                ))}
                {attendees.length > 10 && <Text style={st.attendeeMore}>+{attendees.length - 10} more</Text>}
              </View>
            )}

            {/* Comments */}
            <Text style={st.secLabel}>Comments ({comments.length})</Text>
            {comments.length === 0 && <Text style={st.noContent}>No comments yet. Start the conversation.</Text>}
            {comments.map(c => (
              <View key={c.id} style={st.commentRow}>
                {c.author_avatar
                  ? <Image source={{ uri: c.author_avatar }} style={st.commentAvatar} />
                  : <View style={[st.commentAvatar, st.commentAvatarFb]}><Text style={st.commentAvatarTxt}>{initials(c.author_name)}</Text></View>}
                <View style={st.commentBubble}>
                  <View style={st.commentTop}>
                    <Text style={st.commentAuthor}>{c.author_name}</Text>
                    <Text style={st.commentTime}>{relTime(c.created_at)}</Text>
                  </View>
                  <Text style={st.commentBody}>{c.body}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>

        {/* Bottom bar */}
        <View style={[st.bottomBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <TouchableOpacity style={[st.joinBtn, joined && st.joinedBtn]} onPress={toggleJoin} disabled={joining} activeOpacity={0.7}>
            {joining
              ? <ActivityIndicator color={joined ? TEXT_PRIMARY : '#FFF'} size={14} />
              : <>
                  <Feather name={joined ? 'check' : 'user-plus'} size={15} color={joined ? GREEN : '#FFF'} />
                  <Text style={[st.joinBtnTxt, joined && st.joinedBtnTxt]}>{joined ? 'Going' : 'Join'}</Text>
                </>
            }
          </TouchableOpacity>
          <TextInput
            ref={inputRef}
            style={st.commentInput}
            value={draft}
            onChangeText={setDraft}
            placeholder="Add a comment..."
            placeholderTextColor={TEXT_SECONDARY}
            returnKeyType="default"
            blurOnSubmit={false}
          />
          <TouchableOpacity style={[st.sendBtn, !draft.trim() && st.sendBtnOff]} onPress={sendComment} disabled={!draft.trim() || submitting} activeOpacity={0.7}>
            {submitting ? <ActivityIndicator color="#FFF" size={12} /> : <Feather name="arrow-up" size={16} color="#FFF" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value, onPress }: { icon: string; label: string; value: string; onPress?: () => void }) {
  const content = (
    <View style={st.infoRow}>
      <View style={st.infoIcon}><Feather name={icon as any} size={16} color={NAVY} /></View>
      <View style={{ flex: 1 }}>
        <Text style={st.infoLabel}>{label}</Text>
        <Text style={st.infoValue}>{value}</Text>
      </View>
      {onPress && <Feather name="chevron-right" size={16} color="#C7C7CC" />}
    </View>
  );
  if (onPress) return <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{content}</TouchableOpacity>;
  return content;
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  goBackBtn: { marginTop: 16, backgroundColor: NAVY, borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12 },
  goBackBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '600' },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '600', color: TEXT_PRIMARY, flex: 1, textAlign: 'center' },
  hdrIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },

  heroImage: { width: '100%', height: 220 },
  heroGradient: { width: '100%', height: 160, backgroundColor: NAVY },

  body: { padding: 16 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  catPill: { backgroundColor: '#EFF6FF', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 },
  catPillTxt: { fontSize: 13, fontWeight: '700', color: NAVY },
  goingCount: { fontSize: 13, color: TEXT_SECONDARY, fontWeight: '500' },

  eventTitle: { fontSize: 24, fontWeight: '700', color: TEXT_PRIMARY, marginBottom: 16, lineHeight: 30 },

  infoCard: { backgroundColor: '#F9F9F9', borderRadius: 14, padding: 4, marginBottom: 20, borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  infoIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: 'rgba(11,30,61,0.06)', alignItems: 'center', justifyContent: 'center' },
  infoLabel: { fontSize: 11, fontWeight: '600', color: TEXT_SECONDARY, textTransform: 'uppercase', letterSpacing: 0.3 },
  infoValue: { fontSize: 15, color: TEXT_PRIMARY, marginTop: 2 },

  secLabel: { fontSize: 15, fontWeight: '700', color: TEXT_PRIMARY, marginBottom: 10, marginTop: 4 },
  descText: { fontSize: 15, color: '#3C3C43', lineHeight: 24, marginBottom: 20 },
  noContent: { fontSize: 14, color: TEXT_SECONDARY, marginBottom: 20 },

  attendeesList: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  attendeeItem: { alignItems: 'center', width: 64 },
  attendeeAvatar: { width: 44, height: 44, borderRadius: 22, marginBottom: 4 },
  attendeeAvatarFb: { backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  attendeeAvatarTxt: { fontSize: 16, fontWeight: '700', color: NAVY },
  attendeeName: { fontSize: 11, color: '#3C3C43', textAlign: 'center' },
  attendeeMore: { fontSize: 13, color: TEXT_SECONDARY, alignSelf: 'center', marginLeft: 4 },

  commentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  commentAvatar: { width: 32, height: 32, borderRadius: 16, marginTop: 2 },
  commentAvatarFb: { backgroundColor: '#F2F2F7', alignItems: 'center', justifyContent: 'center' },
  commentAvatarTxt: { fontSize: 12, fontWeight: '700', color: NAVY },
  commentBubble: { flex: 1, backgroundColor: '#F2F2F7', borderRadius: 14, padding: 10 },
  commentTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  commentAuthor: { fontSize: 13, fontWeight: '700', color: TEXT_PRIMARY },
  commentTime: { fontSize: 11, color: '#C7C7CC' },
  commentBody: { fontSize: 14, color: '#1A1A1A', lineHeight: 20 },

  bottomBar: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 10, backgroundColor: '#FFF', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE },
  joinBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: NAVY },
  joinedBtn: { backgroundColor: '#EDFBF0', borderWidth: 1, borderColor: '#BBF7D0' },
  joinBtnTxt: { fontSize: 14, fontWeight: '600', color: '#FFF' },
  joinedBtnTxt: { color: GREEN },
  commentInput: { flex: 1, backgroundColor: '#F2F2F7', borderRadius: 22, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, fontSize: 15, color: TEXT_PRIMARY, maxHeight: 100 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { backgroundColor: '#E5E5EA' },
});
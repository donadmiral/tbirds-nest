// src/screens/mingle/MingleDetailsScreen.tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  StatusBar,
  RefreshControl,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Share,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import SafeImage from '../../components/SafeImage';

type MinglePost = {
  id: string;
  host_id: string;
  host_name: string;
  host_avatar: string | null;
  title: string;
  category: string;
  location: string;
  event_time: string;
  description: string | null;
  image_url: string | null;
  created_at: string;
};

type Attendee = {
  id: string;
  user_id: string;
  full_name: string;
  avatar_url: string | null;
};

type Comment = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
  author_name: string;
  author_avatar: string | null;
};

function initials(n?: string | null) {
  if (!n) return 'U';
  const p = n.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`;
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Handles schema drift. mingle_comments has both body and content columns.
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
      const { data: pd } = await supabase
        .from('mingle_posts')
        .select('*')
        .eq('id', postId)
        .single();
      if (pd) {
        const { data: host } = await supabase
          .from('profiles')
          .select('id, full_name, avatar_url')
          .eq('id', pd.host_id)
          .single();
        setPost({
          ...pd,
          host_name: host?.full_name || 'Host',
          host_avatar: host?.avatar_url || null,
        });
      }

      const { data: att } = await supabase
        .from('mingle_post_attendees')
        .select('id, user_id')
        .eq('post_id', postId);
      if (att) {
        const uids = att.map((a: any) => a.user_id);
        const profilesRes =
          uids.length > 0
            ? await supabase
                .from('profiles')
                .select('id, full_name, avatar_url')
                .in('id', uids)
            : { data: [] as any[] };
        const pm: Record<string, any> = {};
        (profilesRes.data || []).forEach((p: any) => {
          pm[p.id] = p;
        });
        setAttendees(
          att.map((a: any) => ({
            id: a.id,
            user_id: a.user_id,
            full_name: pm[a.user_id]?.full_name || 'Member',
            avatar_url: pm[a.user_id]?.avatar_url || null,
          }))
        );
        setJoined(att.some((a: any) => a.user_id === myId));
      }

      const { data: cmt, error: cmtErr } = await supabase
        .from('mingle_comments')
        .select('*')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });
      if (cmtErr) console.log('MINGLE_CMT_LOAD', cmtErr.message);
      if (cmt) {
        const cuids = cmt.map((c: any) => c.user_id);
        const authorsRes =
          cuids.length > 0
            ? await supabase
                .from('profiles')
                .select('id, full_name, avatar_url')
                .in('id', cuids)
            : { data: [] as any[] };
        const apm: Record<string, any> = {};
        (authorsRes.data || []).forEach((p: any) => {
          apm[p.id] = p;
        });
        setComments(
          cmt.map((c: any) => ({
            id: c.id,
            user_id: c.user_id,
            body: commentText(c),
            created_at: c.created_at,
            author_name: apm[c.user_id]?.full_name || 'Member',
            author_avatar: apm[c.user_id]?.avatar_url || null,
          }))
        );
      }
    } catch (e) {
      console.log('MINGLE_DETAILS_LOAD', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [postId, myId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleJoin = async () => {
    if (!myId || joining) return;
    setJoining(true);
    try {
      if (joined) {
        await supabase
          .from('mingle_post_attendees')
          .delete()
          .eq('post_id', postId)
          .eq('user_id', myId);
        setJoined(false);
        setAttendees((prev) => prev.filter((a) => a.user_id !== myId));
      } else {
        await supabase
          .from('mingle_post_attendees')
          .insert({ post_id: postId, user_id: myId });
        setJoined(true);
        setAttendees((prev) => [
          ...prev,
          {
            id: Date.now().toString(),
            user_id: myId,
            full_name: profile?.full_name || 'You',
            avatar_url: profile?.avatar_url || null,
          },
        ]);
      }
    } catch {
      Alert.alert('Error', 'Could not update attendance.');
    } finally {
      setJoining(false);
    }
  };

  const sendComment = async () => {
    if (!draft.trim() || submitting || !myId) return;
    setSubmitting(true);
    const body = draft.trim();
    setDraft('');
    try {
      const { data: inserted, error } = await supabase
        .from('mingle_comments')
        .insert({ post_id: postId, user_id: myId, body })
        .select('*')
        .single();
      if (error) {
        console.log('MINGLE_COMMENT_ERR', error.message);
        setDraft(body);
        Alert.alert('Error', 'Could not post comment: ' + error.message);
        return;
      }
      const newComment: Comment = {
        id: inserted.id,
        user_id: myId,
        body: commentText(inserted),
        created_at: inserted.created_at,
        author_name: profile?.full_name || 'You',
        author_avatar: profile?.avatar_url || null,
      };
      setComments((prev) => [...prev, newComment]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200);
    } catch (e: any) {
      console.log('MINGLE_COMMENT_CATCH', e);
      setDraft(body);
    } finally {
      setSubmitting(false);
    }
  };

  const shareEvent = async () => {
    if (!post) return;
    await Share.share({
      message: `${post.title}\n📍 ${post.location}\n🕐 ${post.event_time}\n\nJoin us on TBirds Nest Mingle!`,
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
        <View style={s.loader}>
          <ActivityIndicator color="#007AFF" size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right', 'bottom']}>
        <View style={s.loader}>
          <Text style={s.notFoundTxt}>Event not found</Text>
          <TouchableOpacity style={s.goBackBtn} onPress={() => navigation.goBack()}>
            <Text style={s.goBackTxt}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" />

      <View style={s.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={s.backBtn}
          activeOpacity={0.7}
        >
          <Text style={s.backChev}>‹</Text>
          <Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>
          {post.title}
        </Text>
        <TouchableOpacity onPress={shareEvent} style={s.shareBtn} activeOpacity={0.75}>
          <Feather name="share-2" size={18} color="#000" />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor="#007AFF"
            />
          }
          contentContainerStyle={{ paddingBottom: 16 }}
        >
          {post.image_url ? (
            <SafeImage
              uri={post.image_url}
              style={s.heroImage}
              logPrefix="MINGLE_HERO_IMG"
              showFallbackLabel={false}
            />
          ) : null}

          <View style={s.body}>
            <View style={s.topRow}>
              <View style={s.categoryPill}>
                <Text style={s.categoryTxt}>{post.category}</Text>
              </View>
              <Text style={s.attendeesTxt}>
                {attendees.length} {attendees.length === 1 ? 'person' : 'people'} going
              </Text>
            </View>

            <Text style={s.title}>{post.title}</Text>

            <View style={s.infoCard}>
              <View style={s.infoRow}>
                <View style={s.infoIcon}>
                  <Feather name="user" size={16} color="#007AFF" />
                </View>
                <View>
                  <Text style={s.infoLabel}>Host</Text>
                  <Text style={s.infoValue}>{post.host_name}</Text>
                </View>
              </View>
              <View style={s.infoRow}>
                <View style={s.infoIcon}>
                  <Feather name="map-pin" size={16} color="#007AFF" />
                </View>
                <View>
                  <Text style={s.infoLabel}>Where</Text>
                  <Text style={s.infoValue}>{post.location}</Text>
                </View>
              </View>
              <View style={s.infoRow}>
                <View style={s.infoIcon}>
                  <Feather name="clock" size={16} color="#007AFF" />
                </View>
                <View>
                  <Text style={s.infoLabel}>When</Text>
                  <Text style={s.infoValue}>{post.event_time}</Text>
                </View>
              </View>
            </View>

            {post.description ? (
              <>
                <Text style={s.sectionLabel}>About this event</Text>
                <Text style={s.description}>{post.description}</Text>
              </>
            ) : null}

            <Text style={s.sectionLabel}>Who's going ({attendees.length})</Text>
            {attendees.length === 0 ? (
              <Text style={s.emptyTxt}>No one has joined yet. Be the first!</Text>
            ) : (
              <View style={s.attendeesList}>
                {attendees.slice(0, 8).map((a) => (
                  <TouchableOpacity
                    key={a.id}
                    style={s.attendeeItem}
                    onPress={() =>
                      navigation.navigate('UserProfile', { userId: a.user_id })
                    }
                    activeOpacity={0.8}
                  >
                    {a.avatar_url ? (
                      <Image source={{ uri: a.avatar_url }} style={s.attendeeAvatar} />
                    ) : (
                      <View style={[s.attendeeAvatar, s.attendeeAvatarFb]}>
                        <Text style={s.attendeeAvatarTxt}>{initials(a.full_name)}</Text>
                      </View>
                    )}
                    <Text style={s.attendeeName} numberOfLines={1}>
                      {a.full_name}
                    </Text>
                  </TouchableOpacity>
                ))}
                {attendees.length > 8 && (
                  <Text style={s.attendeeMore}>+{attendees.length - 8} more</Text>
                )}
              </View>
            )}

            <Text style={s.sectionLabel}>Comments ({comments.length})</Text>
            {comments.map((c) => (
              <View key={c.id} style={s.commentRow}>
                {c.author_avatar ? (
                  <Image source={{ uri: c.author_avatar }} style={s.commentAvatar} />
                ) : (
                  <View style={[s.commentAvatar, s.commentAvatarFb]}>
                    <Text style={s.commentAvatarTxt}>{initials(c.author_name)}</Text>
                  </View>
                )}
                <View style={s.commentBubble}>
                  <View style={s.commentBubbleTop}>
                    <Text style={s.commentAuthor}>{c.author_name}</Text>
                    <Text style={s.commentTime}>{relTime(c.created_at)}</Text>
                  </View>
                  <Text style={s.commentBody}>{c.body}</Text>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>

        <View style={[s.bottomBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <TouchableOpacity
            style={[s.joinBtn, joined && s.joinedBtn]}
            onPress={toggleJoin}
            disabled={joining}
            activeOpacity={0.8}
          >
            {joining ? (
              <ActivityIndicator color={joined ? '#000' : '#FFF'} size={16} />
            ) : (
              <>
                <Feather
                  name={joined ? 'user-check' : 'user-plus'}
                  size={16}
                  color={joined ? '#000' : '#FFF'}
                />
                <Text style={[s.joinBtnTxt, joined && s.joinedBtnTxt]}>
                  {joined ? 'Joined' : 'Join'}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <TextInput
            ref={inputRef}
            style={s.commentInput}
            value={draft}
            onChangeText={setDraft}
            placeholder="Add a comment..."
            placeholderTextColor="#8E8E93"
            returnKeyType="default"
            blurOnSubmit={false}
          />

          <TouchableOpacity
            style={[s.sendBtn, !draft.trim() && s.sendBtnOff]}
            onPress={sendComment}
            disabled={!draft.trim() || submitting}
            activeOpacity={0.8}
          >
            {submitting ? (
              <ActivityIndicator color="#FFF" size={14} />
            ) : (
              <Text style={s.sendBtnTxt}>↑</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  notFoundTxt: { fontSize: 18, fontWeight: '600', color: '#3C3C43' },
  goBackBtn: {
    backgroundColor: '#007AFF',
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  goBackTxt: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', minWidth: 60 },
  backChev: { fontSize: 30, color: '#007AFF', lineHeight: 34, marginRight: 1 },
  backLbl: { fontSize: 17, color: '#007AFF' },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
    flex: 1,
    textAlign: 'center',
  },
  shareBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroImage: { width: '100%', height: 240 },
  body: { padding: 16 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  categoryPill: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  categoryTxt: { fontSize: 13, fontWeight: '700', color: '#007AFF' },
  attendeesTxt: { fontSize: 13, color: '#8E8E93', fontWeight: '500' },
  title: { fontSize: 24, fontWeight: '700', color: '#000', marginBottom: 16, lineHeight: 30 },
  infoCard: {
    backgroundColor: '#F5F5F5',
    borderRadius: 14,
    padding: 4,
    marginBottom: 20,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EBEBEB',
  },
  infoIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8E8E93',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  infoValue: { fontSize: 15, color: '#000', marginTop: 2 },
  sectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#000',
    marginBottom: 10,
    marginTop: 4,
  },
  description: { fontSize: 15, color: '#3C3C43', lineHeight: 24, marginBottom: 20 },
  attendeesList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  attendeeItem: { alignItems: 'center', width: 64 },
  attendeeAvatar: { width: 44, height: 44, borderRadius: 22, marginBottom: 4 },
  attendeeAvatarFb: {
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attendeeAvatarTxt: { fontSize: 16, fontWeight: '700', color: '#1D4ED8' },
  attendeeName: { fontSize: 11, color: '#3C3C43', textAlign: 'center' },
  attendeeMore: { fontSize: 13, color: '#8E8E93', alignSelf: 'center', marginLeft: 4 },
  emptyTxt: { fontSize: 14, color: '#8E8E93', marginBottom: 20 },
  commentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 12,
  },
  commentAvatar: { width: 32, height: 32, borderRadius: 16, marginTop: 2 },
  commentAvatarFb: {
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentAvatarTxt: { fontSize: 12, fontWeight: '700', color: '#1D4ED8' },
  commentBubble: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    borderRadius: 14,
    padding: 10,
  },
  commentBubbleTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  commentAuthor: { fontSize: 13, fontWeight: '700', color: '#000' },
  commentTime: { fontSize: 11, color: '#C7C7CC' },
  commentBody: { fontSize: 14, color: '#1A1A1A', lineHeight: 20 },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: '#FFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F0F0F0',
  },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: '#000',
  },
  joinedBtn: { backgroundColor: '#F2F2F7' },
  joinBtnTxt: { fontSize: 14, fontWeight: '600', color: '#FFF' },
  joinedBtnTxt: { color: '#000' },
  commentInput: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    color: '#000',
    maxHeight: 100,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: { backgroundColor: '#E5E5EA' },
  sendBtnTxt: { color: '#FFF', fontSize: 18, fontWeight: '700' },
});
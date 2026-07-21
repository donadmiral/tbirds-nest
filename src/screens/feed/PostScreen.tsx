/**
 * PostScreen.tsx
 * Matches Feed's Clean Premium (navy) language. Clickable mentions/hashtags.
 * Supports post_comments content || body dual column.
 * Uses PostCarousel for multi-photo/video display.
 * Media displays edge-to-edge with no side padding.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Image,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator, Keyboard,
  Alert, RefreshControl, StatusBar, Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { PostMedia } from '../../components/MediaRenderer';
import PostCarousel, { CarouselMedia } from '../../components/PostCarousel';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import * as Haptics from 'expo-haptics';

const SCREEN_W = Dimensions.get('window').width;
const NAVY = '#0B1E3D';
const TEXT_PRIMARY = '#000000';
const TEXT_SECONDARY = '#8E8E93';
const HAIRLINE = '#E5E5EA';

type Comment = {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  parent_comment_id?: string | null;
  likes_count: number;
  created_at: string;
  replies: Comment[];
  author: { id: string; full_name?: string | null; username?: string | null; avatar_url?: string | null } | null;
};

type Post = {
  id: string; user_id: string; content: string;
  likes_count: number; comments_count: number;
  reposts_count: number; bookmarks_count: number;
  media_url?: string | null; created_at?: string | null;
  post_media?: PostMedia[];
  author: { id?: string; full_name?: string | null; username?: string | null; avatar_url?: string | null; degree_program?: string | null } | null;
};

function relTime(d?: string | null) {
  if (!d) return '';
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), dy = Math.floor(h / 24);
  if (m < 1) return 'now'; if (m < 60) return `${m}m`;
  if (h < 24) return `${h}h`; if (dy < 7) return `${dy}d`;
  return new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function initials(name?: string | null) {
  if (!name) return 'U';
  const p = name.trim().split(' ').filter(Boolean);
  return p.length === 1 ? p[0][0].toUpperCase() : `${p[0][0]}${p[1][0]}`.toUpperCase();
}

function RichText({
  text,
  onMention,
  onHashtag,
  style,
}: {
  text: string;
  onMention: (u: string) => void;
  onHashtag: (t: string) => void;
  style?: any;
}) {
  const parts = text.split(/([@#][\w.]+)/g);
  return (
    <Text style={style}>
      {parts.map((part, i) => {
        if (part.startsWith('#')) {
          return (
            <Text key={i} style={s.hashTag} onPress={() => onHashtag(part.slice(1))} suppressHighlighting>
              {part}
            </Text>
          );
        }
        if (part.startsWith('@')) {
          return (
            <Text key={i} style={s.mention} onPress={() => onMention(part.slice(1))} suppressHighlighting>
              {part}
            </Text>
          );
        }
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

export default function PostScreen({ route, navigation }: any) {
  const { postId, focusComment } = route.params ?? {};
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [post, setPost] = useState<Post | null>(null);
  const [likedPost, setLikedPost] = useState(false);

  const [commentData, setCommentData] = useState<{
    items: Comment[];
    likedIds: Record<string, boolean>;
    loaded: boolean;
  }>({ items: [], likedIds: {}, loaded: false });

  const [loading, setLoading] = useState(true);
  const [screenFocused, setScreenFocused] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => {
        setScreenFocused(false);
        Keyboard.dismiss();
      };
    }, [])
  );

  const [refreshing, setRefreshing] = useState(false);
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mentions, setMentions] = useState<any[]>([]);
  const [mentionOn, setMentionOn] = useState(false);

  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<any>>(null);

  const load = useCallback(async () => {
    try {
      const { data: pd } = await supabase
        .from('posts')
        .select('*, post_media(id, url, media_type, width, height, sort_order)')
        .eq('id', postId).single();

      if (pd) {
        const { data: ad } = await supabase.from('profiles')
          .select('id, full_name, username, avatar_url, degree_program').eq('id', pd.user_id).single();
        setPost({
          ...pd,
          content: pd.content ?? pd.body ?? '',
          author: ad ?? null,
          likes_count: pd.likes_count ?? 0,
          comments_count: pd.comments_count ?? 0,
          reposts_count: pd.reposts_count ?? 0,
          bookmarks_count: pd.bookmarks_count ?? 0,
          post_media: Array.isArray(pd.post_media) ? pd.post_media : [],
        });
        if (userId) {
          const { data: ld } = await supabase.from('post_likes')
            .select('post_id').eq('user_id', userId).eq('post_id', postId).maybeSingle();
          setLikedPost(!!ld);
        }
      }

      const { data: rows, error: cErr } = await supabase
        .from('post_comments')
        .select('id, post_id, user_id, body, content, parent_comment_id, likes_count, created_at')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });

      if (cErr) console.log('COMMENTS_ERROR', JSON.stringify(cErr));

      const allRows = (rows ?? []).map((r: any) => ({ ...r, body: r.body || r.content || '' }));
      const topLevel = allRows.filter((r: any) => !r.parent_comment_id);
      const replies = allRows.filter((r: any) => !!r.parent_comment_id);

      const authorIds = Array.from(new Set(allRows.map((r: any) => r.user_id).filter(Boolean))) as string[];
      const authorMap: Record<string, any> = {};
      if (authorIds.length > 0) {
        const { data: authors } = await supabase
          .from('profiles').select('id, full_name, username, avatar_url').in('id', authorIds);
        (authors ?? []).forEach((a: any) => { authorMap[a.id] = a; });
      }

      const replyMap: Record<string, Comment[]> = {};
      replies.forEach((r: any) => {
        const pid = String(r.parent_comment_id);
        if (!replyMap[pid]) replyMap[pid] = [];
        replyMap[pid].push({ ...r, likes_count: r.likes_count ?? 0, author: authorMap[r.user_id] ?? null, replies: [] });
      });

      const hydrated: Comment[] = topLevel.map((c: any) => ({
        ...c,
        likes_count: c.likes_count ?? 0,
        author: authorMap[c.user_id] ?? null,
        replies: replyMap[c.id] ?? [],
      }));

      const allCommentIds = allRows.map((c: any) => c.id);
      let likedIds: Record<string, boolean> = {};
      if (userId && allCommentIds.length > 0) {
        const { data: cl } = await supabase.from('comment_likes')
          .select('comment_id').eq('user_id', userId).in('comment_id', allCommentIds);
        (cl ?? []).forEach((r: any) => { likedIds[r.comment_id] = true; });
      }

      setCommentData({ items: hydrated, likedIds, loaded: true });
    } catch (e) {
      console.log('LOAD_POST_CATCH', e);
      setCommentData(prev => ({ ...prev, loaded: true }));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [postId, userId]);

  useEffect(() => {
    load();
    if (focusComment) {
      const t = setTimeout(() => inputRef.current?.focus(), 600);
      return () => clearTimeout(t);
    }
    const ch = supabase.channel(`pcomments-${postId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_comments', filter: `post_id=eq.${postId}` }, () => load())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'post_comments', filter: `post_id=eq.${postId}` }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_likes', filter: `post_id=eq.${postId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load, focusComment]);

  const togglePostLike = async () => {
    if (!userId || !post) return;
    const was = likedPost;
    setLikedPost(!was);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPost(p => p ? { ...p, likes_count: Math.max(0, p.likes_count + (was ? -1 : 1)) } : p);
    try {
      if (was) {
        const { error } = await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', userId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('post_likes').insert({ post_id: postId, user_id: userId });
        if (error && !String(error.message).includes('duplicate')) throw error;
      }
    } catch (e: any) {
      console.log('[LIKE_ERR]', e?.message);
      setLikedPost(was);
      setPost(p => p ? { ...p, likes_count: Math.max(0, p.likes_count + (was ? 1 : -1)) } : p);
    }
  };

  const toggleCommentLike = async (commentId: string) => {
    if (!userId) return;
    const was = commentData.likedIds[commentId];
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCommentData(prev => ({
      ...prev,
      likedIds: { ...prev.likedIds, [commentId]: !was },
      items: prev.items.map(c => {
        if (c.id === commentId) return { ...c, likes_count: Math.max(0, c.likes_count + (was ? -1 : 1)) };
        return { ...c, replies: c.replies.map(r => r.id === commentId ? { ...r, likes_count: Math.max(0, r.likes_count + (was ? -1 : 1)) } : r) };
      }),
    }));
    if (was) await supabase.from('comment_likes').delete().eq('comment_id', commentId).eq('user_id', userId);
    else await supabase.from('comment_likes').insert({ comment_id: commentId, user_id: userId });
  };

  const handleMentionTap = async (username: string) => {
    const { data } = await supabase.from('profiles')
      .select('id, full_name, username, avatar_url').ilike('username', username).maybeSingle();
    if (data) navigation.navigate('UserProfile', { userId: data.id, user: data });
    else Alert.alert('Not found', `@${username} is not on PlatinumCircles yet.`);
  };
  const handleHashtagTap = (tag: string) => navigation.navigate('Search', { query: `#${tag}` });

  const handleInput = (text: string) => {
    setInput(text);
    const match = text.match(/@([\w.]*)$/);
    if (match && match[1].length >= 1) {
      setMentionOn(true);
      supabase.from('profiles').select('id, full_name, username, avatar_url')
        .ilike('username', `${match[1]}%`).limit(5)
        .then(({ data }) => setMentions(data ?? []));
    } else { setMentionOn(false); setMentions([]); }
  };

  const insertMention = (u: any) => {
    setInput(input.replace(/@[\w.]*$/, `@${u.username} `));
    setMentionOn(false); setMentions([]);
  };

  const submitComment = async () => {
    if (!input.trim() || submitting || !userId) return;
    setSubmitting(true);
    const body = input.trim();
    setInput('');
    setReplyTo(null);
    setMentionOn(false);
    setMentions([]);
    try {
      const { error } = await supabase.from('post_comments').insert({
        post_id: postId,
        user_id: userId,
        body,
        content: body,
        parent_comment_id: replyTo?.id ?? null,
      });
      if (error) {
        setInput(body);
        Alert.alert('Error', 'Could not post comment.');
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        await load();
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 200);
      }
    } catch { setInput(body); }
    finally { setSubmitting(false); }
  };

  const renderComment = (c: Comment, isReply = false): React.ReactElement => {
    const isLiked = !!commentData.likedIds[c.id];
    const isOwn = c.user_id === userId;
    const a = c.author;
    return (
      <View key={c.id} style={[s.commentWrap, isReply && s.replyWrap]}>
        {isReply && <View style={s.threadLine} />}
        <View style={s.commentCard}>
          <View style={s.commentTop}>
            <TouchableOpacity
              style={s.commentAuthorRow}
              onPress={() => a?.id && navigation.navigate('UserProfile', { userId: a.id })}
              activeOpacity={0.8}
            >
              {a?.avatar_url
                ? <Image source={{ uri: a.avatar_url }} style={s.commentAvatar} fadeDuration={200} />
                : <View style={s.commentAvatarFb}><Text style={s.commentAvatarTxt}>{initials(a?.full_name || a?.username)}</Text></View>}
              <View>
                <Text style={s.commentName}>{a?.full_name || 'Member'}</Text>
                {a?.username && <Text style={s.commentHandle}>@{a.username}</Text>}
              </View>
            </TouchableOpacity>
            <Text style={s.commentTime}>{relTime(c.created_at)}</Text>
          </View>
          <RichText
            text={c.body}
            onMention={handleMentionTap}
            onHashtag={handleHashtagTap}
            style={s.commentBody}
          />
          <View style={s.commentActions}>
            <TouchableOpacity style={s.commentAction} onPress={() => toggleCommentLike(c.id)} activeOpacity={0.75}>
              <Feather name="heart" size={13} color={isLiked ? '#FF3B30' : TEXT_SECONDARY} />
              {c.likes_count > 0 && <Text style={[s.commentActionTxt, isLiked && { color: '#FF3B30' }]}>{c.likes_count}</Text>}
            </TouchableOpacity>
            {!isReply && (
              <TouchableOpacity
                style={s.commentAction}
                onPress={() => { setReplyTo({ id: c.id, name: a?.full_name || a?.username || 'User' }); inputRef.current?.focus(); }}
                activeOpacity={0.75}
              >
                <Feather name="corner-up-left" size={13} color={TEXT_SECONDARY} />
                <Text style={s.commentActionTxt}>Reply</Text>
              </TouchableOpacity>
            )}
            {isOwn && (
              <TouchableOpacity
                style={s.commentAction}
                onPress={() => Alert.alert('Delete comment?', 'This cannot be undone.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: async () => {
                    await supabase.from('post_comments').delete().eq('id', c.id);
                    load();
                  }},
                ])}
                activeOpacity={0.75}
              >
                <Text style={s.deleteTxt}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        {c.replies.map(r => renderComment(r, true))}
      </View>
    );
  };

  type Row =
    | { type: 'post'; key: string }
    | { type: 'divider'; key: string; count: number }
    | { type: 'comment'; key: string; item: Comment }
    | { type: 'empty'; key: string };

  const rows: Row[] = [];
  if (post) {
    rows.push({ type: 'post', key: '__post' });
    rows.push({ type: 'divider', key: '__div', count: commentData.items.length });
    if (commentData.loaded && commentData.items.length === 0) {
      rows.push({ type: 'empty', key: '__empty' });
    } else {
      commentData.items.forEach(c => rows.push({ type: 'comment', key: c.id, item: c }));
    }
  }

  const canSend = input.trim().length > 0;

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="chevron-left" size={26} color={NAVY} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Post</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={s.loader}><ActivityIndicator color={NAVY} size="large" /></View>
      ) : (
        <View style={s.body}>
          <FlatList
            ref={listRef}
            data={rows}
            keyExtractor={r => r.key}
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: row }) => {
              if (row.type === 'post' && post) {
                const a = post.author;
                const roleLine = a?.degree_program || null;

                const mediaItems: CarouselMedia[] = post.post_media?.length
                  ? (post.post_media as CarouselMedia[]).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                  : post.media_url
                    ? [{ id: '0', url: post.media_url, media_type: 'image' as const, sort_order: 0 }]
                    : [];

                return (
                  <View style={s.postBanner}>
                    <TouchableOpacity
                      style={s.postAuthorRow}
                      onPress={() => navigation.navigate('UserProfile', { userId: post.user_id, user: a })}
                      activeOpacity={0.8}
                    >
                      {a?.avatar_url
                        ? <Image source={{ uri: a.avatar_url }} style={s.postAvatar} fadeDuration={200} />
                        : <View style={[s.postAvatar, s.postAvatarFb]}><Text style={s.postAvatarFbTxt}>{initials(a?.full_name || a?.username)}</Text></View>}
                      <View style={{ flex: 1 }}>
                        <Text style={s.postAuthorName}>{a?.full_name || 'Member'}</Text>
                        {roleLine ? <Text style={s.postAuthorRole}>{roleLine}</Text> : a?.username ? <Text style={s.postAuthorRole}>@{a.username}</Text> : null}
                        <Text style={s.postAuthorSub}>{relTime(post.created_at)}</Text>
                      </View>
                    </TouchableOpacity>
                    <RichText
                      text={post.content}
                      onMention={handleMentionTap}
                      onHashtag={handleHashtagTap}
                      style={s.postBody}
                    />
                    {mediaItems.length > 0 && (
                      <View style={s.mediaEdgeWrap}>
                        <PostCarousel
                          media={mediaItems}
                          containerWidth={SCREEN_W}
                          isActive={screenFocused}
                        />
                      </View>
                    )}
                    {(post.likes_count > 0 || post.comments_count > 0 || post.reposts_count > 0) && (
                      <View style={s.postCounts}>
                        <View style={s.countsLeft}>
                          {post.likes_count > 0 && (
                            <>
                              <View style={s.likeBubble}>
                                <Feather name="heart" size={10} color="#FFF" />
                              </View>
                              <Text style={s.postCount}>{post.likes_count}</Text>
                            </>
                          )}
                        </View>
                        <View>
                          {post.comments_count > 0 && <Text style={s.postCount}>{post.comments_count} {post.comments_count === 1 ? 'comment' : 'comments'}</Text>}
                        </View>
                      </View>
                    )}
                    <View style={s.postDivider} />
                    <View style={s.postActionsRow}>
                      <TouchableOpacity style={s.actionBtn} onPress={togglePostLike} activeOpacity={0.7}>
                        <Feather name="heart" size={16} color={likedPost ? '#FF3B30' : TEXT_SECONDARY} />
                        <Text style={[s.actionTxt, likedPost && { color: '#FF3B30', fontWeight: '700' }]}>Like</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.actionBtn} onPress={() => inputRef.current?.focus()} activeOpacity={0.7}>
                        <Feather name="message-circle" size={16} color={TEXT_SECONDARY} />
                        <Text style={s.actionTxt}>Comment</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }
              if (row.type === 'divider') return (
                <View style={s.sectionHeader}>
                  <Text style={s.sectionHeaderTxt}>Comments</Text>
                  {row.count > 0 && <View style={s.sectionBadge}><Text style={s.sectionBadgeTxt}>{row.count}</Text></View>}
                </View>
              );
              if (row.type === 'empty') return (
                <View style={s.emptyComments}>
                  <Feather name="message-circle" size={28} color="#E5E5EA" />
                  <Text style={s.emptyCommentsTxt}>No comments yet</Text>
                  <Text style={s.emptyCommentsHint}>Be the first to reply</Text>
                </View>
              );
              if (row.type === 'comment') return renderComment(row.item);
              return null;
            }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 12 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={NAVY} />}
          />

          {mentionOn && mentions.length > 0 && (
            <View style={s.mentionDrop}>
              {mentions.map(u => (
                <TouchableOpacity key={u.id} style={s.mentionRow} onPress={() => insertMention(u)}>
                  {u.avatar_url ? <Image source={{ uri: u.avatar_url }} style={s.mentionAvatar} fadeDuration={200} /> : <View style={s.mentionAvatarFb}><Text style={s.mentionAvatarTxt}>{initials(u.full_name || u.username)}</Text></View>}
                  <View><Text style={s.mentionName}>{u.full_name || u.username}</Text>{u.username && <Text style={s.mentionHandle}>@{u.username}</Text>}</View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {replyTo && (
            <View style={s.replyBanner}>
              <View style={s.replyAccent} />
              <Text style={s.replyBannerLbl}>Replying to <Text style={s.replyBannerName}>{replyTo.name}</Text></Text>
              <TouchableOpacity onPress={() => setReplyTo(null)} style={s.replyClose}>
                <Feather name="x" size={16} color={TEXT_SECONDARY} />
              </TouchableOpacity>
            </View>
          )}

          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={insets.top + 52}>
            <View style={[s.inputBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
              {profile?.avatar_url
                ? <Image source={{ uri: profile.avatar_url }} style={s.inputAvatar} fadeDuration={200} />
                : <View style={s.inputAvatarFb}><Text style={s.inputAvatarTxt}>{initials(profile?.full_name || profile?.username)}</Text></View>}
              <TextInput
                ref={inputRef}
                style={s.input}
                value={input}
                onChangeText={handleInput}
                placeholder={replyTo ? `Reply to ${replyTo.name}...` : 'Add a comment...'}
                placeholderTextColor={TEXT_SECONDARY}
                multiline
                maxLength={500}
                returnKeyType="default"
                blurOnSubmit={false}
              />
              <TouchableOpacity
                style={[s.sendBtn, !canSend && s.sendBtnOff]}
                onPress={submitComment}
                disabled={!canSend || submitting}
                activeOpacity={0.8}
              >
                {submitting ? <ActivityIndicator color="#fff" size={14} /> : <Feather name="arrow-up" size={18} color="#FFF" />}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFFFF' },
  body: { flex: 1, backgroundColor: '#FFFFFF' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '600', color: TEXT_PRIMARY, flex: 1, textAlign: 'center' },

  postBanner: { paddingTop: 16, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  postAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12, paddingHorizontal: 16 },
  postAvatar: { width: 46, height: 46, borderRadius: 23 },
  postAvatarFb: { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  postAvatarFbTxt: { fontSize: 15, fontWeight: '700', color: '#FFFFFF' },
  postAuthorName: { fontSize: 15, fontWeight: '600', color: TEXT_PRIMARY, letterSpacing: -0.1 },
  postAuthorRole: { fontSize: 12, color: '#3C3C43', marginTop: 1 },
  postAuthorSub: { fontSize: 11, color: TEXT_SECONDARY, marginTop: 1 },
  postBody: { fontSize: 16, lineHeight: 24, color: '#1A1A1A', marginBottom: 14, paddingHorizontal: 16 },

  // Edge-to-edge media: negative margin cancels parent padding
  mediaEdgeWrap: { marginHorizontal: 0, marginBottom: 14 },

  mediaWrap: { borderRadius: 12, overflow: 'hidden', marginBottom: 14 },

  hashTag: { color: NAVY, fontWeight: '500' },
  mention: { color: NAVY, fontWeight: '500' },

  postCounts: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingHorizontal: 16 },
  countsLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  likeBubble: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center' },
  postCount: { fontSize: 13, color: TEXT_SECONDARY },
  postDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#F0F0F0', marginBottom: 4, marginHorizontal: 16 },

  postActionsRow: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 6, paddingHorizontal: 16 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  actionTxt: { fontSize: 13, fontWeight: '500', color: '#3C3C43' },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F5F5F5',
  },
  sectionHeaderTxt: { fontSize: 14, fontWeight: '700', color: TEXT_PRIMARY },
  sectionBadge: { backgroundColor: '#F2F2F7', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  sectionBadgeTxt: { fontSize: 11, fontWeight: '700', color: '#3C3C43' },

  emptyComments: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyCommentsTxt: { fontSize: 15, fontWeight: '600', color: '#3C3C43' },
  emptyCommentsHint: { fontSize: 13, color: TEXT_SECONDARY },

  commentWrap: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2 },
  replyWrap: { paddingLeft: 48, paddingTop: 6 },
  threadLine: { position: 'absolute', left: 32, top: 0, bottom: 0, width: 1.5, backgroundColor: '#E8E8E8' },
  commentCard: {
    backgroundColor: '#FAFAFB', borderRadius: 14, padding: 12,
  },
  commentTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  commentAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commentAvatar: { width: 30, height: 30, borderRadius: 15 },
  commentAvatarFb: { width: 30, height: 30, borderRadius: 15, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  commentAvatarTxt: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  commentName: { fontSize: 13, fontWeight: '600', color: TEXT_PRIMARY },
  commentHandle: { fontSize: 11, color: TEXT_SECONDARY, marginTop: 1 },
  commentTime: { fontSize: 11, color: '#C7C7CC' },
  commentBody: { fontSize: 14, lineHeight: 20, color: '#1A1A1A', marginBottom: 10 },
  commentActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  commentAction: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  commentActionTxt: { fontSize: 12, color: TEXT_SECONDARY, fontWeight: '500' },
  deleteTxt: { fontSize: 12, color: '#FF3B30', fontWeight: '500' },

  mentionDrop: {
    marginHorizontal: 12, marginBottom: 2,
    backgroundColor: '#FFF', borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE,
    overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: -2 }, elevation: 4,
  },
  mentionRow: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F5F5F5' },
  mentionAvatar: { width: 30, height: 30, borderRadius: 15 },
  mentionAvatarFb: { width: 30, height: 30, borderRadius: 15, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  mentionAvatarTxt: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  mentionName: { fontSize: 13, fontWeight: '600', color: TEXT_PRIMARY },
  mentionHandle: { fontSize: 12, color: TEXT_SECONDARY },

  replyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F5F5F5', paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE,
  },
  replyAccent: { width: 3, height: 28, borderRadius: 2, backgroundColor: NAVY },
  replyBannerLbl: { flex: 1, fontSize: 13, color: '#6B7280' },
  replyBannerName: { fontWeight: '700', color: NAVY },
  replyClose: { padding: 4 },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE,
  },
  inputAvatar: { width: 34, height: 34, borderRadius: 17, marginBottom: 2 },
  inputAvatarFb: { width: 34, height: 34, borderRadius: 17, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  inputAvatarTxt: { fontSize: 12, fontWeight: '700', color: '#FFFFFF' },
  input: {
    flex: 1, backgroundColor: '#F2F2F7', borderRadius: 22,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
    fontSize: 15, color: TEXT_PRIMARY, maxHeight: 120,
  },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', marginBottom: 1 },
  sendBtnOff: { backgroundColor: '#C7C7CC' },
});
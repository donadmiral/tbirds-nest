/**
 * PostScreen.tsx
 *
 * Keyboard architecture (stable, no flicker, no layout shift):
 *
 * SafeAreaView (top + left + right only — NOT bottom)
 *   Header  ← fixed, never moves
 *   View flex:1
 *     FlatList  ← automaticallyAdjustKeyboardInsets on iOS scrolls content above keyboard
 *     MentionDropdown (conditional)
 *     ReplyBanner (conditional)
 *     InputBar  ← KeyboardAvoidingView wraps ONLY this so it rises with keyboard
 *       paddingBottom = safeArea.bottom (handles home-bar overlap)
 *
 * Why this works:
 * - FlatList adjusts its own scroll inset for the keyboard (iOS 15+)
 * - Input bar is pushed up by KAV independently
 * - SafeAreaView NOT handling bottom means no double-counting
 * - No outer KAV wrapping the FlatList, so no layout shift
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Image,
  TextInput, KeyboardAvoidingView, Platform, ActivityIndicator,
  Alert, RefreshControl, StatusBar, Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import MediaRenderer, { PostMedia } from '../../components/MediaRenderer';
import { Dimensions } from 'react-native';
const SCREEN_W = Dimensions.get('window').width;
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';

// ─── Types ────────────────────────────────────────────────

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
  author: { full_name?: string | null; username?: string | null; avatar_url?: string | null } | null;
};

// ─── Helpers ──────────────────────────────────────────────

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
function RichText({ text }: { text: string }) {
  const parts = text.split(/([@#][\w.]+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('#')) return <Text key={i} style={s.hashTag}>{part}</Text>;
        if (part.startsWith('@')) return <Text key={i} style={s.mention}>{part}</Text>;
        return <Text key={i}>{part}</Text>;
      })}
    </>
  );
}

// ─── Component ────────────────────────────────────────────

export default function PostScreen({ route, navigation }: any) {
  const { postId, focusComment } = route.params ?? {};
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [post, setPost]       = useState<Post | null>(null);
  const [likedPost, setLikedPost] = useState(false);

  // Single state object for comments — prevents flicker from two separate setStates
  const [commentData, setCommentData] = useState<{
    items: Comment[];
    likedIds: Record<string, boolean>;
    loaded: boolean;
  }>({ items: [], likedIds: {}, loaded: false });

  const [loading,    setLoading]    = useState(true);
  const [screenFocused, setScreenFocused] = useState(false);

  // Own video playback only while this screen is the active one.
  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, [])
  );
  const [refreshing, setRefreshing] = useState(false);
  const [input,      setInput]      = useState('');
  const [replyTo,    setReplyTo]    = useState<{ id: string; name: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mentions,   setMentions]   = useState<any[]>([]);
  const [mentionOn,  setMentionOn]  = useState(false);

  const inputRef = useRef<TextInput>(null);
  const listRef  = useRef<FlatList<any>>(null);

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      // Post
      const { data: pd } = await supabase
        .from('posts')
        .select('*, post_media(id, url, media_type, width, height, sort_order)')
        .eq('id', postId).single();

      if (pd) {
        const { data: ad } = await supabase.from('profiles')
          .select('id, full_name, username, avatar_url').eq('id', pd.user_id).single();
        setPost({
          ...pd,
          content: pd.content ?? pd.body ?? '',
          author: ad ?? null,
          likes_count:     pd.likes_count     ?? 0,
          comments_count:  pd.comments_count  ?? 0,
          reposts_count:   pd.reposts_count   ?? 0,
          bookmarks_count: pd.bookmarks_count ?? 0,
          post_media: Array.isArray(pd.post_media) ? pd.post_media : [],
        });
        // Set liked state
        if (userId) {
          const { data: ld } = await supabase.from('post_likes')
            .select('post_id').eq('user_id', userId).eq('post_id', postId).maybeSingle();
          setLikedPost(!!ld);
        }
      }

      // Comments — select WITHOUT likes_count (column may not exist)
      // We intentionally omit any parent_comment_id IS NULL filter and do it client-side
      // because Supabase IS NULL can fail silently on some column types
      const { data: rows, error: cErr } = await supabase
        .from('post_comments')
        .select('id, post_id, user_id, body, parent_comment_id, created_at')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });

      if (cErr) {
        console.log('COMMENTS_ERROR', JSON.stringify(cErr));
      }

      const allRows = rows ?? [];
      const topLevel = allRows.filter((r: any) => !r.parent_comment_id);
      const replies  = allRows.filter((r: any) =>  !!r.parent_comment_id);

      // Authors
      const authorIds = Array.from(new Set(allRows.map((r: any) => r.user_id).filter(Boolean))) as string[];
      const authorMap: Record<string, any> = {};
      if (authorIds.length > 0) {
        const { data: authors } = await supabase
          .from('profiles').select('id, full_name, username, avatar_url').in('id', authorIds);
        (authors ?? []).forEach((a: any) => { authorMap[a.id] = a; });
      }

      // Reply map
      const replyMap: Record<string, Comment[]> = {};
      replies.forEach((r: any) => {
        const pid = String(r.parent_comment_id);
        if (!replyMap[pid]) replyMap[pid] = [];
        replyMap[pid].push({ ...r, likes_count: 0, author: authorMap[r.user_id] ?? null, replies: [] });
      });

      const hydrated: Comment[] = topLevel.map((c: any) => ({
        ...c,
        likes_count: 0,
        author: authorMap[c.user_id] ?? null,
        replies: replyMap[c.id] ?? [],
      }));

      // Comment likes
      const topIds = topLevel.map((c: any) => c.id);
      let likedIds: Record<string, boolean> = {};
      if (userId && topIds.length > 0) {
        const { data: cl } = await supabase.from('comment_likes')
          .select('comment_id').eq('user_id', userId).in('comment_id', topIds);
        (cl ?? []).forEach((r: any) => { likedIds[r.comment_id] = true; });
      }

      // Single setState — no flicker
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
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public',
        table: 'post_comments', filter: `post_id=eq.${postId}`,
      }, () => load())
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [load, focusComment]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const togglePostLike = async () => {
    if (!userId || !post) return;
    const was = likedPost;
    setLikedPost(!was);
    setPost(p => p ? { ...p, likes_count: p.likes_count + (was ? -1 : 1) } : p);
    if (was) await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', userId);
    else      await supabase.from('post_likes').insert({ post_id: postId, user_id: userId });
  };

  const toggleCommentLike = async (commentId: string) => {
    if (!userId) return;
    const was = !!commentData.likedIds[commentId];
    setCommentData(prev => ({
      ...prev,
      likedIds: { ...prev.likedIds, [commentId]: !was },
      items: prev.items.map(c => {
        if (c.id === commentId) return { ...c, likes_count: c.likes_count + (was ? -1 : 1) };
        return { ...c, replies: c.replies.map(r => r.id === commentId ? { ...r, likes_count: r.likes_count + (was ? -1 : 1) } : r) };
      }),
    }));
    if (was) await supabase.from('comment_likes').delete().eq('comment_id', commentId).eq('user_id', userId);
    else      await supabase.from('comment_likes').insert({ comment_id: commentId, user_id: userId });
  };

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
        parent_comment_id: replyTo?.id ?? null,
      });
      if (error) { setInput(body); Alert.alert('Error', 'Could not post comment.'); }
      else {
        await load();
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 200);
      }
    } catch { setInput(body); }
    finally { setSubmitting(false); }
  };

  // ── Render comment ────────────────────────────────────────────────────────

  const renderComment = (c: Comment, isReply = false): React.ReactElement => {
    const isLiked = !!commentData.likedIds[c.id];
    const isOwn = c.user_id === userId;
    const a = c.author;

    return (
      <View key={c.id} style={[s.commentWrap, isReply && s.replyWrap]}>
        {isReply && <View style={s.threadLine} />}
        <View style={s.commentCard}>
          {/* Author */}
          <View style={s.commentTop}>
            <TouchableOpacity
              style={s.commentAuthorRow}
              onPress={() => a?.id && navigation.navigate('UserProfile', { userId: a.id })}
              activeOpacity={0.8}
            >
              {a?.avatar_url
                ? <Image source={{ uri: a.avatar_url }} style={s.commentAvatar} />
                : <View style={s.commentAvatarFb}><Text style={s.commentAvatarTxt}>{initials(a?.full_name || a?.username)}</Text></View>}
              <View>
                <Text style={s.commentName}>{a?.full_name || 'Member'}</Text>
                {a?.username && <Text style={s.commentHandle}>@{a.username}</Text>}
              </View>
            </TouchableOpacity>
            <Text style={s.commentTime}>{relTime(c.created_at)}</Text>
          </View>
          {/* Body */}
          <Text style={s.commentBody}><RichText text={c.body} /></Text>
          {/* Actions */}
          <View style={s.commentActions}>
            <TouchableOpacity style={s.commentAction} onPress={() => toggleCommentLike(c.id)} activeOpacity={0.75}>
              <Feather name="heart" size={13} color={isLiked ? '#E53935' : '#8E8E93'} />
              {c.likes_count > 0 && <Text style={[s.commentActionTxt, isLiked && s.likedTxt]}>{c.likes_count}</Text>}
            </TouchableOpacity>
            {!isReply && (
              <TouchableOpacity
                style={s.commentAction}
                onPress={() => { setReplyTo({ id: c.id, name: a?.full_name || a?.username || 'User' }); inputRef.current?.focus(); }}
                activeOpacity={0.75}
              >
                <Feather name="corner-up-left" size={13} color="#8E8E93" />
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

  // ── Flat list data ─────────────────────────────────────────────────────────

  type Row =
    | { type: 'post';     key: string }
    | { type: 'divider';  key: string; count: number }
    | { type: 'comment';  key: string; item: Comment }
    | { type: 'empty';    key: string };

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

  // ── Render ────────────────────────────────────────────────────────────────

  const canSend = input.trim().length > 0;

  return (
    // bottom edge NOT included — handled manually in input bar padding
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header — outside everything so it never moves */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn} activeOpacity={0.7}>
          <Text style={s.backChev}>‹</Text>
          <Text style={s.backLbl}>Back</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>Post</Text>
        <View style={{ width: 60 }} />
      </View>

      {loading ? (
        <View style={s.loader}><ActivityIndicator color="#007AFF" size="large" /></View>
      ) : (
        // Layout: View wraps everything. FlatList adjusts for keyboard via
        // automaticallyAdjustKeyboardInsets (iOS 15+). On Android, KAV
        // wraps only the input bar. This eliminates the flicker caused
        // by double-handling (outer KAV + FlatList scroll both reacting).
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
                return (
                  <View style={s.postBanner}>
                    <TouchableOpacity style={s.postAuthorRow} onPress={() => navigation.navigate('UserProfile', { userId: post.user_id })} activeOpacity={0.8}>
                      {a?.avatar_url
                        ? <Image source={{ uri: a.avatar_url }} style={s.postAvatar} />
                        : <View style={s.postAvatarFb}><Text style={s.postAvatarFbTxt}>{initials(a?.full_name || a?.username)}</Text></View>}
                      <View style={{ flex: 1 }}>
                        <Text style={s.postAuthorName}>{a?.full_name || 'Member'}</Text>
                        <Text style={s.postAuthorSub}>{a?.username ? `@${a.username} · ` : ''}{relTime(post.created_at)}</Text>
                      </View>
                    </TouchableOpacity>
                    <Text style={s.postBody}><RichText text={post.content} /></Text>
                    {(() => {
                        const mediaItems: PostMedia[] = post.post_media?.length
                          ? post.post_media
                          : post.media_url
                            ? [{ id: '0', url: post.media_url, media_type: 'image' as const, sort_order: 0 }]
                            : [];
                        if (!mediaItems.length) return null;
                        const W = SCREEN_W - 32;
                        return <MediaRenderer media={mediaItems} containerWidth={W} fullBleed={false} maxHeight={480} isActive={screenFocused} />;
                      })()}
                    {(post.likes_count > 0 || post.comments_count > 0) && (
                      <View style={s.postCounts}>
                        {post.likes_count > 0 && <Text style={s.postCount}>{post.likes_count} {post.likes_count === 1 ? 'like' : 'likes'}</Text>}
                        {post.likes_count > 0 && post.comments_count > 0 && <Text style={s.postCountDot}> · </Text>}
                        {post.comments_count > 0 && <Text style={s.postCount}>{post.comments_count} {post.comments_count === 1 ? 'comment' : 'comments'}</Text>}
                      </View>
                    )}
                    <View style={s.postDivider} />
                    <View style={s.postPills}>
                      <TouchableOpacity style={[s.pill, likedPost && s.pillLiked]} onPress={togglePostLike} activeOpacity={0.75}>
                        <Feather name="heart" size={14} color={likedPost ? '#E53935' : '#6B7280'} />
                        <Text style={[s.pillTxt, likedPost && s.pillTxtLiked]}>{post.likes_count > 0 ? String(post.likes_count) : 'Like'}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={s.pill} onPress={() => { inputRef.current?.focus(); }} activeOpacity={0.75}>
                        <Feather name="message-circle" size={14} color="#6B7280" />
                        <Text style={s.pillTxt}>Comment</Text>
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
                  <Text style={s.emptyCommentsTxt}>No comments yet.</Text>
                  <Text style={s.emptyCommentsHint}>Be the first to share your thoughts.</Text>
                </View>
              );
              if (row.type === 'comment') return renderComment(row.item);
              return null;
            }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={{ paddingBottom: 12 }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); load(); }}
                tintColor="#007AFF"
              />
            }
          />

          {/* Mention dropdown */}
          {mentionOn && mentions.length > 0 && (
            <View style={s.mentionDrop}>
              {mentions.map(u => (
                <TouchableOpacity key={u.id} style={s.mentionRow} onPress={() => insertMention(u)}>
                  {u.avatar_url ? <Image source={{ uri: u.avatar_url }} style={s.mentionAvatar} /> : <View style={s.mentionAvatarFb}><Text style={s.mentionAvatarTxt}>{initials(u.full_name || u.username)}</Text></View>}
                  <View><Text style={s.mentionName}>{u.full_name || u.username}</Text>{u.username && <Text style={s.mentionHandle}>@{u.username}</Text>}</View>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {replyTo && (
            <View style={s.replyBanner}>
              <View style={s.replyAccent} />
              <Text style={s.replyBannerLbl}>Replying to <Text style={s.replyBannerName}>{replyTo.name}</Text></Text>
              <TouchableOpacity onPress={() => { setReplyTo(null); }} style={s.replyClose}><Text style={s.replyCloseTxt}>✕</Text></TouchableOpacity>
            </View>
          )}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={insets.top + 52}
          >
          <View style={[s.inputBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
              {profile?.avatar_url
                ? <Image source={{ uri: profile.avatar_url }} style={s.inputAvatar} />
                : <View style={s.inputAvatarFb}><Text style={s.inputAvatarTxt}>{initials(profile?.full_name || profile?.username)}</Text></View>}
              <TextInput
                ref={inputRef}
                style={s.input}
                value={input}
                onChangeText={handleInput}
                placeholder={replyTo ? `Reply to ${replyTo.name}...` : 'Add a comment...'}
                placeholderTextColor="#8E8E93"
                multiline
                maxLength={500}
                returnKeyType="default"
                blurOnSubmit={false}
                onFocus={() => {
                  // Let automaticallyAdjustKeyboardInsets handle scroll — no manual intervention
                }}
              />
              <TouchableOpacity
                style={[s.sendBtn, !canSend && s.sendBtnOff]}
                onPress={submitComment}
                disabled={!canSend || submitting}
                activeOpacity={0.8}
              >
                {submitting
                  ? <ActivityIndicator color="#fff" size={14} />
                  : <Text style={s.sendBtnTxt}>↑</Text>}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#FFFFFF' },
  body:   { flex: 1, backgroundColor: '#FFFFFF' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0',
  },
  backBtn:  { flexDirection: 'row', alignItems: 'center', minWidth: 60 },
  backChev: { fontSize: 30, color: '#007AFF', lineHeight: 34, marginRight: 1 },
  backLbl:  { fontSize: 17, color: '#007AFF' },
  headerTitle: { fontSize: 17, fontWeight: '600', color: '#000' },

  // Post banner
  postBanner: { padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F0F0F0' },
  postAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  postAvatar:   { width: 46, height: 46, borderRadius: 23 },
  postAvatarFb: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  postAvatarFbTxt: { fontSize: 17, fontWeight: '700', color: '#1D4ED8' },
  postAuthorName: { fontSize: 16, fontWeight: '700', color: '#000' },
  postAuthorSub:  { fontSize: 13, color: '#8E8E93', marginTop: 1 },
  postBody:  { fontSize: 17, lineHeight: 26, color: '#1A1A1A', marginBottom: 14 },
  postMedia: { width: '100%', height: 260, borderRadius: 12, marginBottom: 14 },
  postCounts: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  postCount:    { fontSize: 14, color: '#8E8E93' },
  postCountDot: { fontSize: 14, color: '#C7C7CC' },
  postDivider:  { height: StyleSheet.hairlineWidth, backgroundColor: '#F0F0F0', marginBottom: 10 },
  postPills: { flexDirection: 'row', gap: 8 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1,
    borderColor: '#E8E8E8', backgroundColor: '#FAFAFA',
  },
  pillLiked:    { backgroundColor: '#FFF0F0', borderColor: '#FFCDD2' },
  pillTxt:      { fontSize: 13, fontWeight: '500', color: '#6B7280' },
  pillTxtLiked: { color: '#E53935', fontWeight: '600' },

  // Section header
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F5F5F5',
  },
  sectionHeaderTxt: { fontSize: 15, fontWeight: '700', color: '#000' },
  sectionBadge:    { backgroundColor: '#F2F2F7', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  sectionBadgeTxt: { fontSize: 12, fontWeight: '600', color: '#3C3C43' },

  // Empty comments
  emptyComments:     { alignItems: 'center', paddingVertical: 48 },
  emptyCommentsTxt:  { fontSize: 16, fontWeight: '600', color: '#3C3C43' },
  emptyCommentsHint: { fontSize: 14, color: '#8E8E93', marginTop: 6 },

  // Comment cards
  commentWrap: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2 },
  replyWrap:   { paddingLeft: 48, paddingTop: 6 },
  threadLine:  { position: 'absolute', left: 32, top: 0, bottom: 0, width: 1.5, backgroundColor: '#E8E8E8' },
  commentCard: {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#EBEBEB',
  },
  commentTop:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  commentAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commentAvatar:    { width: 30, height: 30, borderRadius: 15 },
  commentAvatarFb:  { width: 30, height: 30, borderRadius: 15, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  commentAvatarTxt: { fontSize: 11, fontWeight: '700', color: '#1D4ED8' },
  commentName:   { fontSize: 13, fontWeight: '700', color: '#000' },
  commentHandle: { fontSize: 11, color: '#8E8E93', marginTop: 1 },
  commentTime:   { fontSize: 11, color: '#C7C7CC' },
  commentBody:   { fontSize: 14, lineHeight: 20, color: '#1A1A1A', marginBottom: 10 },
  commentActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  commentAction:  { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  commentActionTxt: { fontSize: 12, color: '#8E8E93', fontWeight: '500' },
  likedTxt:  { color: '#E53935' },
  deleteTxt: { fontSize: 12, color: '#FF3B30', fontWeight: '500' },
  hashTag: { color: '#007AFF', fontWeight: '500' },
  mention: { color: '#5856D6', fontWeight: '500' },

  // Mention dropdown
  mentionDrop: {
    marginHorizontal: 12, marginBottom: 2,
    backgroundColor: '#FFF', borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#E8E8E8',
    overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: -2 }, elevation: 4,
  },
  mentionRow:      { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F5F5F5' },
  mentionAvatar:   { width: 30, height: 30, borderRadius: 15 },
  mentionAvatarFb: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  mentionAvatarTxt: { fontSize: 11, fontWeight: '700', color: '#1D4ED8' },
  mentionName:   { fontSize: 13, fontWeight: '600', color: '#000' },
  mentionHandle: { fontSize: 12, color: '#8E8E93' },

  // Reply banner
  replyBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#F5F5F5', paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F0F0F0',
  },
  replyAccent:     { width: 3, height: 28, borderRadius: 2, backgroundColor: '#007AFF' },
  replyBannerLbl:  { flex: 1, fontSize: 13, color: '#6B7280' },
  replyBannerName: { fontWeight: '700', color: '#007AFF' },
  replyClose:    { padding: 4 },
  replyCloseTxt: { fontSize: 17, color: '#C7C7CC' },

  // Input bar
  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F0F0F0',
  },
  inputAvatar:   { width: 34, height: 34, borderRadius: 17, marginBottom: 2 },
  inputAvatarFb: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  inputAvatarTxt: { fontSize: 12, fontWeight: '700', color: '#1D4ED8' },
  input: {
    flex: 1, backgroundColor: '#F5F5F5', borderRadius: 22,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
    fontSize: 15, color: '#000', maxHeight: 120,
  },
  sendBtn:    { width: 36, height: 36, borderRadius: 18, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center', marginBottom: 1 },
  sendBtnOff: { backgroundColor: '#E5E5EA' },
  sendBtnTxt: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
});
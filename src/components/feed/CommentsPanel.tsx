/**
 * CommentsPanel - the one comment thread for every surface that hosts comments:
 * the post screen, the feed's comments sheet and the expanded video viewer's
 * sheet. Same data, rules and look everywhere:
 * replies target the top-level comment (Instagram's one-level model), like and
 * dislike through set_comment_reaction, GIFs, @mention typeahead, the author's
 * hide/unhide, hidden comments folded, blocked people filtered, comment policy
 * honoured, live updates through realtime.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Image, TextInput,
  ActivityIndicator, Alert, Platform, KeyboardAvoidingView, RefreshControl,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { themedSheet, getTheme } from '../../theme/useTheme';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import { authorId as currentAuthorId } from '../../stores/actorStore';
import GifPickerLite from '../GifPickerLite';
import TierName from '../TierName';
import VerifiedBadge from '../VerifiedBadge';

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
  dislikes_count?: number;
  likes_count: number;
  created_at: string;
  media_url?: string | null;
  media_type?: string | null;
  hidden?: boolean;
  spam?: boolean;
  spam_reason?: string | null;
  replies: Comment[];
  author: { id: string; full_name?: string | null; username?: string | null; avatar_url?: string | null } | null;
};

export type CommentsPanelProps = {
  postId: string;
  /** The post's author, so hidden comments fold for them and Hide/Unhide shows. Looked up when omitted. */
  postAuthorId?: string | null;
  autoFocus?: boolean;
  /** Fires with the number of visible top-level comments whenever the thread loads. */
  onCount?: (n: number) => void;
  /** Padding under the input bar (the safe area when the panel sits at the bottom of the window). */
  bottomInset?: number;
  /** The comment field gaining or losing focus, so a host can follow the keyboard even when the OS is quiet about it. */
  onFocusChange?: (focused: boolean) => void;
  /** Content drawn above the thread inside the same list (the post screen's post banner). */
  header?: React.ReactNode;
  /** Pull to refresh reloads the thread and calls this, so a host can reload its own post too. */
  onRefresh?: () => Promise<unknown> | void;
  /** Hosted on a screen rather than in a sheet: the input rides the keyboard itself. Pass the window y of the panel's parent. */
  keyboardOffset?: number;
};

export type CommentsPanelHandle = { focusInput: () => void };

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

function RichText({ text, onMention, onHashtag, style }: { text: string; onMention: (u: string) => void; onHashtag: (t: string) => void; style?: any }) {
  const parts = text.split(/([@#][\w.]+)/g);
  return (
    <Text style={style}>
      {parts.map((part, i) => {
        if (part.startsWith('#')) return <Text key={i} style={s.hashTag} onPress={() => onHashtag(part.slice(1))} suppressHighlighting>{part}</Text>;
        if (part.startsWith('@')) return <Text key={i} style={s.mention} onPress={() => onMention(part.slice(1))} suppressHighlighting>{part}</Text>;
        return <Text key={i}>{part}</Text>;
      })}
    </Text>
  );
}

const CommentsPanel = forwardRef<CommentsPanelHandle, CommentsPanelProps>(function CommentsPanel({ postId, postAuthorId, autoFocus, onCount, bottomInset = 0, onFocusChange, header, onRefresh, keyboardOffset }, ref) {
  const navigation = useNavigation<any>();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [items, setItems] = useState<Comment[]>([]);
  const [reactions, setReactions] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [canComment, setCanComment] = useState(true);
  const [policyOff, setPolicyOff] = useState(false);
  const [ownerId, setOwnerId] = useState<string | null>(postAuthorId ?? null);
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());
  const [input, setInput] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mentions, setMentions] = useState<any[]>([]);
  const [mentionOn, setMentionOn] = useState(false);
  const [pendingGif, setPendingGif] = useState<string | null>(null);
  const [showGifs, setShowGifs] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const listRef = useRef<FlatList<any>>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Comments that look like spam sit folded at the end; their writer sees their own inline, the post author reviews them.
  const [showSpam, setShowSpam] = useState(false);
  useImperativeHandle(ref, () => ({ focusInput: () => inputRef.current?.focus() }), []);
  const onCountRef = useRef(onCount); onCountRef.current = onCount;

  const load = useCallback(async () => {
    try {
      const [{ data: can }, { data: pd }] = await Promise.all([
        supabase.rpc('can_comment', { p_post_id: postId }),
        supabase.from('posts').select('user_id, comment_policy').eq('id', postId).maybeSingle(),
      ]);
      setCanComment(can !== false);
      const authorIdNow = (pd as any)?.user_id ?? postAuthorId ?? null;
      setOwnerId(authorIdNow);
      const off = (pd as any)?.comment_policy === 'off';
      setPolicyOff(off);

      const { data: rows, error: cErr } = await supabase
        .from('post_comments')
        .select('id, post_id, user_id, body, content, parent_comment_id, likes_count, dislikes_count, created_at, media_url, media_type, hidden_at, is_spam, spam_reason')
        .eq('post_id', postId)
        .order('created_at', { ascending: true });
      if (cErr) console.log('COMMENTS_ERROR', JSON.stringify(cErr));

      // A hidden comment is seen by its writer and by the post's author only.
      let allRows = off ? [] : (rows ?? [])
        .filter((r: any) => !r.hidden_at || r.user_id === userId || authorIdNow === userId)
        .map((r: any) => ({ ...r, body: r.body || r.content || '', hidden: !!r.hidden_at, spam: !!r.is_spam && r.user_id !== userId, spam_reason: r.spam_reason ?? null }));
      if (userId) {
        try {
          const { data: blk } = await supabase.from('blocked_users').select('blocker_id, blocked_id').or('blocker_id.eq.' + userId + ',blocked_id.eq.' + userId);
          const blockedSet = new Set<string>((blk ?? []).map((b: any) => (b.blocker_id === userId ? b.blocked_id : b.blocker_id)));
          if (blockedSet.size > 0) allRows = allRows.filter((r: any) => !blockedSet.has(r.user_id));
        } catch {}
      }
      const topLevel = allRows.filter((r: any) => !r.parent_comment_id);
      const replies = allRows.filter((r: any) => !!r.parent_comment_id);
      const authorIds = Array.from(new Set(allRows.map((r: any) => r.user_id).filter(Boolean))) as string[];
      const authorMap: Record<string, any> = {};
      if (authorIds.length > 0) {
        const { data: authors } = await supabase.from('profiles').select('id, full_name, username, avatar_url').in('id', authorIds);
        (authors ?? []).forEach((a: any) => { authorMap[a.id] = a; });
      }
      const replyMap: Record<string, Comment[]> = {};
      replies.forEach((r: any) => {
        const pid = String(r.parent_comment_id);
        if (!replyMap[pid]) replyMap[pid] = [];
        replyMap[pid].push({ ...r, likes_count: r.likes_count ?? 0, author: authorMap[r.user_id] ?? null, replies: [] });
      });
      const hydrated: Comment[] = topLevel.map((c: any) => ({ ...c, likes_count: c.likes_count ?? 0, author: authorMap[c.user_id] ?? null, replies: replyMap[c.id] ?? [] }));

      const reacts: Record<string, number> = {};
      const allIds = allRows.map((c: any) => c.id);
      if (userId && allIds.length > 0) {
        const { data: cr } = await supabase.from('comment_reactions').select('comment_id, value').eq('user_id', userId).in('comment_id', allIds);
        (cr ?? []).forEach((r: any) => { reacts[r.comment_id] = r.value; });
      }
      setItems(hydrated);
      setReactions(reacts);
      onCountRef.current?.(hydrated.reduce((acc, c) => acc + ((c.hidden || c.spam) ? 0 : 1 + c.replies.length), 0));
    } catch (e) {
      console.log('COMMENTS_PANEL_LOAD', e);
    } finally {
      setLoaded(true);
    }
  }, [postId, userId, postAuthorId]);

  useEffect(() => {
    setItems([]); setLoaded(false); setReplyTo(null); setInput(''); setPendingGif(null);
    load();
    const ch = supabase.channel(`sheet-comments-${postId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'post_comments', filter: `post_id=eq.${postId}` }, () => load())
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'post_comments', filter: `post_id=eq.${postId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [postId, load]);

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => inputRef.current?.focus(), 420);
    return () => clearTimeout(t);
  }, [autoFocus, postId]);

  const reactToComment = async (commentId: string, value: 1 | -1) => {
    if (!userId) return;
    const prevValue = reactions[commentId] ?? 0;
    const nextValue = prevValue === value ? 0 : value;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const applyCounts = (id: string, likes?: number, dislikes?: number) => {
      setReactions((prev) => ({ ...prev, [id]: nextValue }));
      setItems((prev) => prev.map((c) => {
        const patch = (t: any) => t.id === id ? { ...t, likes_count: likes ?? t.likes_count, dislikes_count: dislikes ?? t.dislikes_count } : t;
        return { ...patch(c), replies: c.replies.map(patch) };
      }));
    };
    applyCounts(commentId);
    const { data, error } = await supabase.rpc('set_comment_reaction', { p_comment_id: commentId, p_value: value });
    if (error) { setReactions((prev) => ({ ...prev, [commentId]: prevValue })); return; }
    applyCounts(commentId, (data as any)?.likes, (data as any)?.dislikes);
  };

  const handleMentionTap = async (username: string) => {
    const { data } = await supabase.from('profiles').select('id, full_name, username, avatar_url').ilike('username', username).maybeSingle();
    if (data) navigation.navigate('UserProfile', { userId: data.id, user: data });
    else Alert.alert('Not found', `@${username} is not on PlatinumCircles yet.`);
  };
  const handleHashtagTap = (tag: string) => navigation.navigate('Search', { query: `#${tag}` });

  const handleInput = (text: string) => {
    setInput(text);
    const match = text.match(/@([\w.]*)$/);
    if (match && match[1].length >= 1) {
      setMentionOn(true);
      supabase.from('profiles').select('id, full_name, username, avatar_url').ilike('username', `${match[1]}%`).limit(5).then(({ data }) => setMentions(data ?? []));
    } else { setMentionOn(false); setMentions([]); }
  };
  const insertMention = (u: any) => {
    setInput(input.replace(/@[\w.]*$/, `@${u.username} `));
    setMentionOn(false); setMentions([]);
  };

  const submitComment = async () => {
    if ((!input.trim() && !pendingGif) || submitting || !userId) return;
    setSubmitting(true);
    const body = input.trim();
    setInput(''); setReplyTo(null); setMentionOn(false); setMentions([]);
    try {
      const { error } = await supabase.from('post_comments').insert({
        post_id: postId,
        user_id: currentAuthorId(userId) ?? userId,
        body, content: body,
        parent_comment_id: replyTo?.id ?? null,
        media_url: pendingGif,
        media_type: pendingGif ? 'gif' : null,
      });
      if (error) { setInput(body); Alert.alert('Error', 'Could not post comment.'); }
      else {
        setPendingGif(null);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        await load();
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 200);
      }
    } catch { setInput(body); }
    finally { setSubmitting(false); }
  };

  // Long-press on a comment: the post author moderates from here (hide, spam, restrict); a writer can delete their own.
  const commentMenu = (c: Comment) => {
    const isOwn = c.user_id === userId;
    const isPostAuthor = !!ownerId && ownerId === userId;
    const who = c.author?.full_name || (c.author?.username ? '@' + c.author.username : 'this person');
    const buttons: any[] = [];
    if (isPostAuthor && !isOwn) {
      buttons.push({ text: c.hidden ? 'Unhide comment' : 'Hide comment', onPress: () => supabase.rpc('set_comment_hidden', { p_comment_id: c.id, p_hidden: !c.hidden }).then(() => load(), () => {}) });
      buttons.push({ text: c.spam ? 'Not spam' : 'Mark as spam', onPress: () => supabase.rpc('set_comment_spam', { p_comment_id: c.id, p_spam: !c.spam }).then(() => load(), () => {}) });
      buttons.push({ text: 'Restrict ' + who, onPress: () => Alert.alert('Restrict ' + who + '?', 'Their comments on your posts will only be visible to them until you approve them, their messages move to Message requests, and you will not get notifications from them. They will not know.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restrict', style: 'destructive', onPress: () => supabase.rpc('set_restriction', { p_user: c.user_id, p_on: true }).then(({ error }) => { if (error) Alert.alert('Could not restrict', error.message); else Alert.alert('Restricted', who + ' is restricted. Undo it in Settings, under Restricted accounts.'); }) },
      ]) });
    }
    if (isOwn) buttons.push({ text: 'Delete comment', style: 'destructive', onPress: async () => { await supabase.from('post_comments').delete().eq('id', c.id); load(); } });
    if (!buttons.length) return;
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(who, c.spam ? 'Folded as possible spam' + (c.spam_reason ? ' (' + c.spam_reason + ')' : '') : undefined, buttons);
  };

  const renderComment = (c: Comment, isReply = false, parentId?: string): React.ReactElement | null => {
    const myReaction = reactions[c.id] ?? 0;
    const isLiked = myReaction === 1;
    const isDisliked = myReaction === -1;
    const isOwn = c.user_id === userId;
    const isPostAuthor = !!ownerId && ownerId === userId;
    if (c.hidden && !isOwn && !isPostAuthor) return null;
    const a = c.author;
    return (
      <View key={c.id} style={[s.commentWrap, isReply && s.replyWrap]}>
        {isReply && <View style={s.threadLine} />}
        <TouchableOpacity activeOpacity={1} delayLongPress={350} onLongPress={() => commentMenu(c)} style={[s.commentCard, c.hidden && { opacity: 0.55 }]}>
          <View style={s.commentTop}>
            <TouchableOpacity style={s.commentAuthorRow} onPress={() => a?.id && navigation.navigate('UserProfile', { userId: a.id })} activeOpacity={0.8}>
              {a?.avatar_url
                ? <Image source={{ uri: a.avatar_url }} style={s.commentAvatar} fadeDuration={200} />
                : <View style={s.commentAvatarFb}><Text style={s.commentAvatarTxt}>{initials(a?.full_name || a?.username)}</Text></View>}
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <TierName userId={a?.id} baseStyle={[s.commentName, { flexShrink: 1 }]} text={a?.full_name || 'Member'} />
                  <VerifiedBadge userId={a?.id} size={12} />
                </View>
                {a?.username && <Text style={s.commentHandle}>@{a.username}</Text>}
              </View>
            </TouchableOpacity>
            <Text style={s.commentTime}>{relTime(c.created_at)}</Text>
          </View>
          <RichText text={c.body} onMention={handleMentionTap} onHashtag={handleHashtagTap} style={s.commentBody} />
          {c.media_url ? <Image source={{ uri: c.media_url }} style={{ width: 180, height: 135, borderRadius: 10, marginTop: 6 }} resizeMode="cover" /> : null}
          <View style={s.commentActions}>
            <TouchableOpacity style={s.commentAction} onPress={() => reactToComment(c.id, -1)} activeOpacity={0.75} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel={isDisliked ? 'Remove dislike' : 'Dislike comment'}>
              <Ionicons name={isDisliked ? 'thumbs-down' : 'thumbs-down-outline'} size={14} color={isDisliked ? getTheme().status.danger : getTheme().ink.muted} />
              {(c.dislikes_count ?? 0) > 0 && <Text style={[s.commentActionTxt, isDisliked && { color: getTheme().status.danger }]}>{c.dislikes_count}</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={s.commentAction} onPress={() => reactToComment(c.id, 1)} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel={isLiked ? 'Unlike comment' : 'Like comment'}>
              <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={14} color={isLiked ? '#FF3040' : TEXT_SECONDARY} />
              {c.likes_count > 0 && <Text style={[s.commentActionTxt, isLiked && { color: '#FF3B30' }]}>{c.likes_count}</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={s.commentAction}
              onPress={() => {
                const targetId = isReply && parentId ? parentId : c.id;
                setReplyTo({ id: targetId, name: a?.full_name || a?.username || 'User' });
                if (isReply && a?.username) setInput((prev) => (prev.trim().length === 0 ? '@' + a.username + ' ' : prev));
                inputRef.current?.focus();
              }}
              activeOpacity={0.75}
            >
              <Feather name="corner-up-left" size={13} color={TEXT_SECONDARY} />
              <Text style={s.commentActionTxt}>Reply</Text>
            </TouchableOpacity>
            {isPostAuthor && !isOwn && (
              <TouchableOpacity style={s.commentAction} activeOpacity={0.75} onPress={() => supabase.rpc('set_comment_hidden', { p_comment_id: c.id, p_hidden: !c.hidden }).then(() => load(), () => {})}>
                <Text style={s.commentActionTxt}>{c.hidden ? 'Unhide' : 'Hide'}</Text>
              </TouchableOpacity>
            )}
            {isPostAuthor && !isOwn && (
              <TouchableOpacity style={s.commentAction} activeOpacity={0.75} onPress={() => supabase.rpc('set_comment_spam', { p_comment_id: c.id, p_spam: !c.spam }).then(() => load(), () => {})} accessibilityRole="button" accessibilityLabel={c.spam ? 'Not spam' : 'Mark as spam'}>
                <Text style={s.commentActionTxt}>{c.spam ? 'Not spam' : 'Spam'}</Text>
              </TouchableOpacity>
            )}
            {isOwn && (
              <TouchableOpacity
                style={s.commentAction}
                onPress={() => Alert.alert('Delete comment?', 'This cannot be undone.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: async () => { await supabase.from('post_comments').delete().eq('id', c.id); load(); } },
                ])}
                activeOpacity={0.75}
              >
                <Text style={s.deleteTxt}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
        {c.replies.length > 0 && !isReply && !expandedReplies.has(c.id) ? (
          <TouchableOpacity style={s.repliesToggle} onPress={() => setExpandedReplies((prev) => new Set(prev).add(c.id))} activeOpacity={0.7}>
            <View style={s.repliesRule} />
            <Text style={s.repliesTxt}>View {c.replies.length} {c.replies.length === 1 ? 'reply' : 'replies'}</Text>
          </TouchableOpacity>
        ) : c.replies.length > 0 ? (
          <>
            {c.replies.map((r) => renderComment(r, true, c.id))}
            <TouchableOpacity style={[s.repliesToggle, { marginTop: 2 }]} onPress={() => setExpandedReplies((prev) => { const n = new Set(prev); n.delete(c.id); return n; })} activeOpacity={0.7}>
              <View style={s.repliesRule} />
              <Text style={s.repliesTxt}>Hide replies</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </View>
    );
  };

  const canSend = input.trim().length > 0 || !!pendingGif;
  const onScreen = keyboardOffset != null;
  const refresh = async () => { setRefreshing(true); try { await Promise.all([load(), Promise.resolve(onRefresh?.())]); } finally { setRefreshing(false); } };

  const composer = (
    <>
      {mentionOn && mentions.length > 0 && (
        <View style={s.mentionDrop}>
          {mentions.map((u) => (
            <TouchableOpacity key={u.id} style={s.mentionRow} onPress={() => insertMention(u)}>
              {u.avatar_url ? <Image source={{ uri: u.avatar_url }} style={s.mentionAvatar} fadeDuration={200} /> : <View style={s.mentionAvatarFb}><Text style={s.mentionAvatarTxt}>{initials(u.full_name || u.username)}</Text></View>}
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <TierName userId={u.id} baseStyle={s.mentionName} text={u.full_name || u.username || ''} />
                  <VerifiedBadge userId={u.id} size={12} />
                </View>
                {u.username ? <Text style={s.mentionHandle}>@{u.username}</Text> : null}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {replyTo && (
        <View style={s.replyBanner}>
          <View style={s.replyAccent} />
          <Text style={s.replyBannerLbl}>Replying to <Text style={s.replyBannerName}>{replyTo.name}</Text></Text>
          <TouchableOpacity onPress={() => setReplyTo(null)} style={s.replyClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="x" size={16} color={TEXT_SECONDARY} />
          </TouchableOpacity>
        </View>
      )}

      {pendingGif && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 8 }}>
          <Image source={{ uri: pendingGif }} style={{ width: 74, height: 56, borderRadius: 8 }} />
          <TouchableOpacity onPress={() => setPendingGif(null)}><Feather name="x-circle" size={20} color="#8E8E93" /></TouchableOpacity>
        </View>
      )}

      {!canComment || policyOff ? (
        <View style={[s.inputBar, { paddingBottom: Math.max(bottomInset, 8), justifyContent: 'center' }]}>
          <Text style={{ fontSize: 13, color: TEXT_SECONDARY, fontWeight: '600' }}>{policyOff ? 'Comments are turned off' : 'Comments are limited on this post'}</Text>
        </View>
      ) : (
        <View style={[s.inputBar, { paddingBottom: Math.max(bottomInset, 8) }]}>
          {profile?.avatar_url
            ? <Image source={{ uri: profile.avatar_url }} style={s.inputAvatar} fadeDuration={200} />
            : <View style={s.inputAvatarFb}><Text style={s.inputAvatarTxt}>{initials(profile?.full_name || profile?.username)}</Text></View>}
          <TouchableOpacity onPress={() => setShowGifs(true)} activeOpacity={0.7} style={{ paddingHorizontal: 4, paddingVertical: 6 }} accessibilityRole="button" accessibilityLabel="Add a GIF">
            <Text style={s.gifChip}>GIF</Text>
          </TouchableOpacity>
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
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => onFocusChange?.(false)}
          />
          <TouchableOpacity style={[s.sendBtn, !canSend && s.sendBtnOff]} onPress={submitComment} disabled={!canSend || submitting} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Post comment">
            {submitting ? <ActivityIndicator color="#fff" size={14} /> : <Feather name="arrow-up" size={18} color="#FFF" />}
          </TouchableOpacity>
        </View>
      )}
    </>
  );

  return (
    <View style={s.root}>
      <FlatList
        ref={listRef}
        data={items.filter((c) => !c.spam)}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => renderComment(item)}
        ListHeaderComponent={header ? <>{header}</> : null}
        ListFooterComponent={(() => {
          const spam = items.filter((c) => c.spam && (!c.hidden || c.user_id === userId || (!!ownerId && ownerId === userId)));
          if (!spam.length) return null;
          return (
            <View style={{ paddingTop: 6 }}>
              <TouchableOpacity style={s.spamToggle} onPress={() => setShowSpam((v) => !v)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={showSpam ? 'Hide possible spam' : 'Show possible spam'}>
                <Feather name={showSpam ? 'chevron-up' : 'chevron-down'} size={14} color={TEXT_SECONDARY} />
                <Text style={s.repliesTxt}>{spam.length} {spam.length === 1 ? 'comment' : 'comments'} may be spam</Text>
              </TouchableOpacity>
              {showSpam ? spam.map((c) => renderComment(c)) : null}
            </View>
          );
        })()}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets={onScreen && Platform.OS === 'ios'}
        refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={NAVY} /> : undefined}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 12, paddingTop: 4 }}
        ListEmptyComponent={
          !loaded ? <View style={{ paddingVertical: 36, alignItems: 'center' }}><ActivityIndicator color={NAVY} /></View>
          : policyOff ? <View style={s.emptyComments}><Feather name="message-circle" size={28} color="#E5E5EA" /><Text style={s.emptyCommentsTxt}>Comments are turned off</Text></View>
          : (
            <View style={s.emptyComments}>
              <Feather name="message-circle" size={28} color="#E5E5EA" />
              <Text style={s.emptyCommentsTxt}>No comments yet</Text>
              <Text style={s.emptyCommentsHint}>Start the conversation</Text>
            </View>
          )
        }
      />

      <GifPickerLite visible={showGifs} onClose={() => setShowGifs(false)} onSelect={(u) => { setPendingGif(u); setShowGifs(false); }} />
      {onScreen ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={keyboardOffset}>
          {composer}
        </KeyboardAvoidingView>
      ) : composer}
    </View>
  );
});

export default CommentsPanel;

const s = themedSheet((t) => ({
  root: { flex: 1, backgroundColor: t.surface.canvas },
  hashTag: { color: NAVY, fontWeight: '500' },
  mention: { color: NAVY, fontWeight: '500' },
  emptyComments: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyCommentsTxt: { fontSize: 15, fontWeight: '600', color: '#3C3C43' },
  emptyCommentsHint: { fontSize: 13, color: TEXT_SECONDARY },
  commentWrap: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2 },
  replyWrap: { paddingLeft: 48, paddingTop: 6 },
  threadLine: { position: 'absolute', left: 32, top: 0, bottom: 0, width: 1.5, backgroundColor: '#E8E8E8' },
  commentCard: { backgroundColor: '#FAFAFB', borderRadius: 14, padding: 12 },
  commentTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  commentAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  commentAvatar: { width: 30, height: 30, borderRadius: 15 },
  commentAvatarFb: { width: 30, height: 30, borderRadius: 15, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  commentAvatarTxt: { fontSize: 11, fontWeight: '700', color: t.ink.inverse },
  commentName: { fontSize: 13, fontWeight: '600', color: TEXT_PRIMARY },
  commentHandle: { fontSize: 11, color: TEXT_SECONDARY, marginTop: 1 },
  commentTime: { fontSize: 11, color: '#C7C7CC' },
  commentBody: { fontSize: 14, lineHeight: 20, color: '#1A1A1A', marginBottom: 10 },
  commentActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  commentAction: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
  commentActionTxt: { fontSize: 12, color: TEXT_SECONDARY, fontWeight: '500' },
  deleteTxt: { fontSize: 12, color: '#FF3B30', fontWeight: '500' },
  repliesToggle: { marginLeft: 44, marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6 },
  repliesRule: { width: 24, height: 1, backgroundColor: '#C7CDD6' },
  spamToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 16 },
  repliesTxt: { fontSize: 12.5, fontWeight: '600', color: TEXT_SECONDARY },
  mentionDrop: {
    marginHorizontal: 12, marginBottom: 2,
    backgroundColor: t.surface.canvas, borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: HAIRLINE, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6, shadowOffset: { width: 0, height: -2 }, elevation: 4,
  },
  mentionRow: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F5F5F5' },
  mentionAvatar: { width: 30, height: 30, borderRadius: 15 },
  mentionAvatarFb: { width: 30, height: 30, borderRadius: 15, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  mentionAvatarTxt: { fontSize: 11, fontWeight: '700', color: t.ink.inverse },
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
    backgroundColor: t.surface.canvas,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: HAIRLINE,
  },
  inputAvatar: { width: 34, height: 34, borderRadius: 17, marginBottom: 2 },
  inputAvatarFb: { width: 34, height: 34, borderRadius: 17, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
  inputAvatarTxt: { fontSize: 12, fontWeight: '700', color: t.ink.inverse },
  gifChip: { fontSize: 11, fontWeight: '800', color: NAVY, borderWidth: 1.5, borderColor: NAVY, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2, overflow: 'hidden' },
  input: {
    flex: 1, backgroundColor: '#F2F2F7', borderRadius: 22,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10,
    fontSize: 15, color: TEXT_PRIMARY, maxHeight: 120,
    ...(Platform.OS === 'android' ? { textAlignVertical: 'center' as const } : {}),
  },
  sendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', marginBottom: 1 },
  sendBtnOff: { backgroundColor: '#C7C7CC' },
}));
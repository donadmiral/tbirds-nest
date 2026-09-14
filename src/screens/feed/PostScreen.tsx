import { useAfterTransition } from '../../lib/screenTransition';
import { PostSkeleton } from '../../components/skeletons';
import PollCard from '../../components/PollCard';
import CollaboratorsSheet from '../../components/CollaboratorsSheet';
import { themedSheet } from '../../theme/useTheme';
import TierName from '../../components/TierName';
import VerifiedBadge from '../../components/VerifiedBadge';
import ArticleBody from '../../components/ArticleBody';
import CommentsPanel, { CommentsPanelHandle } from '../../components/feed/CommentsPanel';
/**
 * PostScreen.tsx
 * Matches Feed's Clean Premium (navy) language. Clickable mentions/hashtags.
 * A video post pins its media above the thread (X and Instagram): the video
 * and the comments stay in view together, and the video never plays off
 * screen. The thread itself is the shared CommentsPanel, the same one the
 * feed's comments sheet and the expanded viewer use.
 * Media displays edge-to-edge with no side padding.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image, Linking, Keyboard,
  Alert, StatusBar, Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from '../../components/SafeArea';
import { Feather, Ionicons } from '@expo/vector-icons';
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

type Post = {
  id: string; user_id: string; content: string;
  likes_count: number; comments_count: number;
  reposts_count: number; bookmarks_count: number;
  media_url?: string | null; created_at?: string | null;
  link_url?: string | null;
  article_title?: string | null; read_minutes?: number | null;
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

export default function PostScreen({ route, navigation }: any) {
  const { postId, focusComment, media: seedMedia } = route.params ?? {};
  const insets = useSafeAreaInsets();
  const { profile } = useAuthStore();
  const userId = profile?.id ?? null;

  const [post, setPost] = useState<Post | null>(null);
  const [collabInvite, setCollabInvite] = useState<boolean>(false);
  const [postCollabs, setPostCollabs] = useState<{ id: string; username: string | null; full_name: string | null; avatar_url: string | null }[]>([]);
  const [collabSheet, setCollabSheet] = useState(false);
  useFocusEffect(useCallback(() => { if (userId) supabase.from('post_collaborators').select('status').eq('post_id', postId).eq('user_id', userId).maybeSingle().then(({ data }) => setCollabInvite((data as any)?.status === 'invited'), () => {}); }, [postId, userId]));
  const [linkPreview, setLinkPreview] = useState<{ url: string; title: string | null; description: string | null; image_url: string | null; domain: string | null } | null>(null);
  const [galleryImages, setGalleryImages] = useState<{ url: string; width?: number; height?: number }[]>([]);
  const [likedPost, setLikedPost] = useState(false);
  const [loading, setLoading] = useState(true);
  const afterSlide = useAfterTransition();
  const [screenFocused, setScreenFocused] = useState(false);
  const [threadAbove, setThreadAbove] = useState<any[]>([]);
  const [threadBelow, setThreadBelow] = useState<any[]>([]);
  const [notFound, setNotFound] = useState(false);
  const panelRef = useRef<CommentsPanelHandle>(null);

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => {
        setScreenFocused(false);
        Keyboard.dismiss();
      };
    }, [])
  );

  const load = useCallback(async () => {
    try {
      const { data: vis } = await supabase.rpc('can_view_post', { p_post_id: postId });
      supabase.from('post_collaborators').select('user_id, profile:profiles!post_collaborators_user_id_fkey(username, full_name, avatar_url)').eq('post_id', postId).eq('status', 'accepted').then(({ data }) => setPostCollabs(((data ?? []) as any[]).map((r: any) => ({ id: r.user_id, username: r.profile?.username ?? null, full_name: r.profile?.full_name ?? null, avatar_url: r.profile?.avatar_url ?? null }))), () => {});
      if (userId) supabase.from('post_collaborators').select('status').eq('post_id', postId).eq('user_id', userId).maybeSingle().then(({ data }) => setCollabInvite((data as any)?.status === 'invited'), () => {});
      if (vis === false) { setNotFound(true); setLoading(false); return; }
    } catch {}
    try {
      const { data: pd } = await supabase
        .from('posts')
        .select('*, post_media(id, url, media_type, width, height, sort_order, edit, is_sensitive)')
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
        if (pd.link_url) {
          supabase.from('link_previews').select('url, title, description, image_url, domain').eq('url', pd.link_url).maybeSingle()
            .then(({ data: lp }) => { if (lp) setLinkPreview(lp as any); });
        }
        if (pd.article_title) {
          supabase.from('articles').select('current_revision_id').eq('linked_post_id', pd.id).maybeSingle()
            .then(({ data: art }: { data: { current_revision_id: string } | null }) => {
              if (!art?.current_revision_id) return;
              supabase.from('article_blocks').select('content').eq('revision_id', art.current_revision_id).eq('block_type', 'gallery').maybeSingle()
                .then(({ data: blk }: { data: { content: unknown } | null }) => {
                  const imgs = (blk?.content as any)?.images;
                  if (Array.isArray(imgs)) setGalleryImages(imgs);
                });
            });
        }
        try {
          const above: any[] = [];
          let cursor = pd.thread_parent_id ?? null;
          let hops = 0;
          while (cursor && hops < 10) {
            const { data: par } = await supabase.from('posts').select('id, user_id, content, body, created_at, thread_parent_id').eq('id', cursor).maybeSingle();
            if (!par) break;
            above.unshift({ ...par, content: par.content ?? par.body ?? '' });
            cursor = par.thread_parent_id ?? null;
            hops++;
          }
          const { data: kids } = await supabase.from('posts').select('id, user_id, content, body, created_at').eq('thread_parent_id', postId).order('created_at', { ascending: true });
          const below = (kids ?? []).map((k: any) => ({ ...k, content: k.content ?? k.body ?? '' }));
          const tIds = Array.from(new Set([...above, ...below].map((t: any) => t.user_id)));
          const tMap: Record<string, any> = {};
          if (tIds.length > 0) {
            const { data: tAuthors } = await supabase.from('profiles').select('id, full_name, username, avatar_url').in('id', tIds);
            (tAuthors ?? []).forEach((a: any) => { tMap[a.id] = a; });
          }
          setThreadAbove(above.map((t: any) => ({ ...t, author: tMap[t.user_id] ?? null })));
          setThreadBelow(below.map((t: any) => ({ ...t, author: tMap[t.user_id] ?? null })));
        } catch (e) { console.log('THREAD_LOAD_ERR', e); }
        if (userId) {
          const { data: ld } = await supabase.from('post_likes')
            .select('post_id').eq('user_id', userId).eq('post_id', postId).maybeSingle();
          setLikedPost(!!ld);
        }
      }
    } catch (e) {
      console.log('LOAD_POST_CATCH', e);
    } finally {
      setLoading(false);
    }
  }, [postId, userId]);

  useEffect(() => {
    load();
    const ch = supabase.channel(`post-${postId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_likes', filter: `post_id=eq.${postId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [load]);

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

  const handleMentionTap = async (username: string) => {
    const { data } = await supabase.from('profiles')
      .select('id, full_name, username, avatar_url').ilike('username', username).maybeSingle();
    if (data) navigation.navigate('UserProfile', { userId: data.id, user: data });
    else Alert.alert('Not found', `@${username} is not on PlatinumCircles yet.`);
  };
  const handleHashtagTap = (tag: string) => navigation.navigate('Search', { query: `#${tag}` });

  // A video post pins its media above the thread, so the video and the comments stay in view together (X and Instagram).
  // The feed hands its media in through route.params so the video carries over before the post itself has loaded.
  const mediaItems: CarouselMedia[] = post?.post_media?.length
    ? [...(post.post_media as CarouselMedia[])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    : post?.media_url
      ? [{ id: '0', url: post.media_url, media_type: /\.(mp4|mov|m4v|webm|quicktime)(\?|#|$)/i.test(post.media_url) ? 'video' as const : 'image' as const, sort_order: 0 }]
      : (!post && Array.isArray(seedMedia) ? (seedMedia as CarouselMedia[]) : []);
  const pinned = !post?.article_title && mediaItems.some((m) => m.media_type === 'video');
  const pinAspect = (mediaItems[0]?.edit as any)?.aspect as string | undefined;
  const pinRatio = pinAspect === 'square' ? 1 : pinAspect === 'landscape' ? 1 / 1.91 : 1.25;
  const pinH = Math.min(Math.round(SCREEN_W * pinRatio), Math.round(Dimensions.get('window').height * 0.42));
  const pinW = Math.min(SCREEN_W, Math.round(pinH / pinRatio));
  const pinBoxH = pinH + (mediaItems.length > 1 ? 22 : 0); // room for the page dots under a carousel
  const rowMedia: CarouselMedia[] = pinned ? [] : mediaItems; // a pinned video is drawn above the thread, not inside it

  const openThreadPost = (id: string) => { const nav: any = navigation; if (nav.push) { nav.push('Post', { postId: id }); } else { nav.navigate('Post', { postId: id }); } };
  const renderThreadRow = (t: any) => (
    <TouchableOpacity key={'t-' + t.id} style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10 }} activeOpacity={0.85} onPress={() => openThreadPost(t.id)}>
      <View style={{ width: 2, backgroundColor: '#D1D5DB', borderRadius: 1, marginRight: 12 }} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <TierName userId={t.author?.id ?? t.user_id} baseStyle={{ fontSize: 13, fontWeight: '700', color: '#0A0A0A', flexShrink: 1 }} text={t.author?.full_name || t.author?.username || 'Member'} />
          <VerifiedBadge userId={t.author?.id ?? t.user_id} size={12} />
          <Text style={{ fontSize: 13, fontWeight: '400', color: '#8E8E93' }}>{relTime(t.created_at)}</Text>
        </View>
        <Text style={{ fontSize: 14, color: '#111827', marginTop: 2 }} numberOfLines={3}>{t.content}</Text>
      </View>
    </TouchableOpacity>
  );

  const a = post?.author;
  const header = post ? (
    <View>
      {threadAbove.map(renderThreadRow)}
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
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
              <TierName userId={a?.id} baseStyle={[s.postAuthorName, { flexShrink: 1 }]} text={a?.full_name || 'Member'} />
              <VerifiedBadge userId={a?.id} size={14} />
              {postCollabs.length === 1 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 3 }}>
                  <Text style={[s.postAuthorName, { fontWeight: '800' }]}>×</Text>
                  <TouchableOpacity onPress={() => navigation.navigate('UserProfile', { userId: postCollabs[0].id })} activeOpacity={0.7}><TierName userId={postCollabs[0].id} baseStyle={[s.postAuthorName, { flexShrink: 1 }]} text={postCollabs[0].full_name || postCollabs[0].username || 'Member'} /></TouchableOpacity>
                  <VerifiedBadge userId={postCollabs[0].id} size={14} />
                </View>
              ) : postCollabs.length > 1 ? (
                <TouchableOpacity onPress={() => setCollabSheet(true)} activeOpacity={0.7} style={{ marginLeft: 3 }}><Text style={s.postAuthorName}>× {postCollabs.length} others</Text></TouchableOpacity>
              ) : null}
            </View>
            {a?.username ? <Text style={s.postAuthorRole}>@{a.username}</Text> : null}
            <Text style={s.postAuthorSub}>{relTime(post.created_at)}</Text>
          </View>
        </TouchableOpacity>
        {post.article_title ? (
          <View style={s.articleWrap}>
            <Text style={s.articleMeta}>{post.read_minutes ? post.read_minutes + ' min read' : 'Article'}</Text>
            <Text style={s.articleTitle}>{post.article_title}</Text>
            <ArticleBody text={post.content} />
            {galleryImages.length > 0 && (
              <View style={s.galleryGrid}>
                {galleryImages.map((img: { url: string; width?: number; height?: number }, i: number) => (
                  <Image
                    key={img.url + i}
                    source={{ uri: img.url }}
                    style={galleryImages.length === 1 ? s.galleryFull : s.galleryHalf}
                  />
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={{ marginTop: 4 }}>
            <ArticleBody text={post.content} onMention={handleMentionTap} onHashtag={handleHashtagTap} />
          </View>
        )}
        {post.id ? <View style={{ paddingHorizontal: 16 }}><PollCard postId={post.id} /></View> : null}
        {rowMedia.length > 0 && (
          <View style={s.mediaEdgeWrap}>
            <PostCarousel postId={postId}
              media={rowMedia}
              containerWidth={SCREEN_W}
              isActive={screenFocused}
            />
          </View>
        )}
        {mediaItems.length === 0 && post.link_url && linkPreview ? (
          <TouchableOpacity activeOpacity={0.85} onPress={() => Linking.openURL(post.link_url!)} style={s.linkCard}>
            {linkPreview.image_url ? <Image source={{ uri: linkPreview.image_url }} style={s.linkCardImg} /> : null}
            <View style={s.linkCardBody}>
              <Text style={s.linkCardDomain} numberOfLines={1}>{linkPreview.domain || ''}</Text>
              <Text style={s.linkCardTitle} numberOfLines={2}>{linkPreview.title || post.link_url}</Text>
            </View>
          </TouchableOpacity>
        ) : null}
        {(post.likes_count > 0 || post.comments_count > 0 || post.reposts_count > 0) && (
          <View style={s.postCounts}>
            <View style={s.countsLeft}>
              {post.likes_count > 0 && (
                <>
                  <View style={s.likeBubble}>
                    <Ionicons name="heart" size={10} color="#FFF" />
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
            <Ionicons name={likedPost ? 'heart' : 'heart-outline'} size={18} color={likedPost ? '#FF3040' : TEXT_SECONDARY} />
            <Text style={[s.actionTxt, likedPost && { color: '#FF3B30', fontWeight: '700' }]}>Like</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.actionBtn} onPress={() => panelRef.current?.focusInput()} activeOpacity={0.7}>
            <Feather name="message-circle" size={16} color={TEXT_SECONDARY} />
            <Text style={s.actionTxt}>Comment</Text>
          </TouchableOpacity>
        </View>
        {collabInvite ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(11,30,61,0.08)' }}>
            <Text style={{ flex: 1, fontSize: 13.5, color: '#0B1E3D', fontWeight: '600' }}>You're invited to collaborate on this post</Text>
            <TouchableOpacity onPress={async () => { if (!userId) return; await supabase.from('post_collaborators').update({ status: 'accepted' }).eq('post_id', postId).eq('user_id', userId); setCollabInvite(false); load(); }} style={s.collabBtn} activeOpacity={0.8}><Text style={s.collabBtnTxt}>Accept</Text></TouchableOpacity>
            <TouchableOpacity onPress={async () => { if (!userId) return; await supabase.from('post_collaborators').update({ status: 'declined' }).eq('post_id', postId).eq('user_id', userId); setCollabInvite(false); }} style={[s.collabBtn, s.collabBtnGhost]} activeOpacity={0.8}><Text style={[s.collabBtnTxt, { color: '#0B1E3D' }]}>Decline</Text></TouchableOpacity>
          </View>
        ) : null}
      </View>
      {threadBelow.map(renderThreadRow)}
      <View style={s.sectionHeader}>
        <Text style={s.sectionHeaderTxt}>Comments</Text>
        {post.comments_count > 0 && <View style={s.sectionBadge}><Text style={s.sectionBadgeTxt}>{post.comments_count}</Text></View>}
      </View>
    </View>
  ) : null;

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

      {pinned ? (
        <View style={{ width: SCREEN_W, height: pinBoxH, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          <PostCarousel media={mediaItems} containerWidth={pinW} isActive={screenFocused} postId={postId} flush />
        </View>
      ) : null}
      {loading || !afterSlide ? (
        <PostSkeleton />
      ) : notFound ? (
        <View style={s.loader}><Feather name="eye-off" size={34} color="#9CA3AF" /><Text style={{ marginTop: 10, fontSize: 15, fontWeight: '600', color: '#6B7280' }}>This post isn't available</Text></View>
      ) : (
        <View style={s.body}>
          <CommentsPanel
            ref={panelRef}
            postId={postId}
            postAuthorId={post?.user_id ?? null}
            header={header}
            autoFocus={!!focusComment}
            bottomInset={Math.max(insets.bottom, 8)}
            keyboardOffset={insets.top + 52 + (pinned ? pinBoxH : 0)}
            onRefresh={load}
            onCount={(n) => setPost((p) => (p ? { ...p, comments_count: n } : p))}
          />
          <CollaboratorsSheet visible={collabSheet} people={postCollabs} onClose={() => setCollabSheet(false)} />
        </View>
      )}
    </SafeAreaView>
  );
}

const s = themedSheet((t) => ({
  safe: { flex: 1, backgroundColor: t.surface.canvas },
  body: { flex: 1, backgroundColor: t.surface.canvas },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: t.surface.canvas,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '600', color: TEXT_PRIMARY, flex: 1, textAlign: 'center' },

  postBanner: { paddingTop: 16, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: HAIRLINE },
  postAuthorRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12, paddingHorizontal: 16 },
  postAvatar: { width: 46, height: 46, borderRadius: 23 },
  postAvatarFb: { backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center' },
  postAvatarFbTxt: { fontSize: 15, fontWeight: '700', color: t.ink.inverse },
  postAuthorName: { fontSize: 15, fontWeight: '600', color: TEXT_PRIMARY, letterSpacing: -0.1 },
  postAuthorRole: { fontSize: 12, color: '#3C3C43', marginTop: 1 },
  postAuthorSub: { fontSize: 11, color: TEXT_SECONDARY, marginTop: 1 },
  articleWrap: { marginTop: 4 },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 18 },
  galleryFull: { width: '100%', height: 260, borderRadius: 14, backgroundColor: '#F2F3F5' },
  galleryHalf: { width: '48%', height: 150, borderRadius: 14, backgroundColor: '#F2F3F5' },
  articleMeta: { fontSize: 12, fontWeight: '700', color: TEXT_SECONDARY, letterSpacing: 0.3 },
  articleTitle: { marginTop: 6, fontSize: 24, fontWeight: '800', color: TEXT_PRIMARY, lineHeight: 30 },
  linkCard: { flexDirection: 'row', marginTop: 10, marginHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: HAIRLINE, overflow: 'hidden' },
  linkCardImg: { width: 84, height: 84, backgroundColor: '#F2F3F5' },
  linkCardBody: { flex: 1, padding: 10, justifyContent: 'center' },
  linkCardDomain: { fontSize: 10.5, fontWeight: '700', color: TEXT_SECONDARY, textTransform: 'uppercase', letterSpacing: 0.4 },
  linkCardTitle: { fontSize: 13.5, fontWeight: '700', color: TEXT_PRIMARY, marginTop: 2 },

  // Edge-to-edge media: negative margin cancels parent padding
  mediaEdgeWrap: { marginHorizontal: 0, marginBottom: 14 },

  postCounts: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingHorizontal: 16 },
  countsLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  likeBubble: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#FF3B30', alignItems: 'center', justifyContent: 'center' },
  postCount: { fontSize: 13, color: TEXT_SECONDARY },
  postDivider: { height: StyleSheet.hairlineWidth, backgroundColor: '#F0F0F0', marginBottom: 4, marginHorizontal: 16 },

  postActionsRow: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 6, paddingHorizontal: 16 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  actionTxt: { fontSize: 13, fontWeight: '500', color: '#3C3C43' },
  collabBtn: { backgroundColor: NAVY, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 },
  collabBtnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(11,30,61,0.25)' },
  collabBtnTxt: { color: t.ink.inverse, fontSize: 13, fontWeight: '700' },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F5F5F5',
  },
  sectionHeaderTxt: { fontSize: 14, fontWeight: '700', color: TEXT_PRIMARY },
  sectionBadge: { backgroundColor: '#F2F2F7', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  sectionBadgeTxt: { fontSize: 11, fontWeight: '700', color: '#3C3C43' },
}));
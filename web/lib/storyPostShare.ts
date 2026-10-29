import { normalizePostPlayback } from '../../shared/postVoiceEffects';
import type { createClient } from './supabase/client';
import { CONTENT_UUID } from '../../shared/contentMedia';
import { hydratePostMedia } from './contentMedia';
import type { StoryTextSticker } from './stories';

/** Read the current public source; route parameters carry only its ID. */
export async function loadPostStorySticker(
  client: ReturnType<typeof createClient>, postId: string, assertCurrent: () => void,
): Promise<StoryTextSticker> {
  assertCurrent();
  if (!CONTENT_UUID.test(postId)) throw new Error('This post is not available to share to a story.');
  const access = await client.rpc('can_view_post', { p_post_id: postId });
  assertCurrent();
  if (access.error || access.data !== true) throw new Error('This post is not available to share to a story.');
  const result = await client.from('posts')
    .select('id,user_id,content,body,article_title,media_url,image_url,created_at,audience,archived_at,is_exclusive,community_id')
    .eq('id', postId).maybeSingle();
  assertCurrent();
  const post = result.data;
  if (result.error) throw new Error('The post could not load. Please try again.');
  if (!post || post.archived_at || post.is_exclusive || post.community_id || (post.audience ?? 'everyone') !== 'everyone') {
    throw new Error('Only public posts can be added to a story. This post keeps its current audience.');
  }
  const [profile, gallery] = await Promise.all([
    client.from('profiles').select('id,full_name,username,avatar_url,is_verified,verified_tier,profile_visibility,deactivated_at').eq('id', post.user_id).maybeSingle(),
    client.from('post_media').select('url,media_type,width,height,sort_order,edit').eq('post_id', postId).order('sort_order', { ascending: true }),
  ]);
  assertCurrent();
  if (profile.error || gallery.error) throw new Error('The post could not load. Please try again.');
  const author = profile.data;
  if (!author || author.deactivated_at || (author.profile_visibility ?? 'public') !== 'public') {
    throw new Error('Only posts from public profiles can be added to a story.');
  }
  const first = gallery.data?.[0];
  const mediaUrl = first?.url || post.media_url || post.image_url || null;
  const sticker: StoryTextSticker = {
    id: 'post-' + post.id, kind: 'post', text: '', style: 'classic', color: '#FFFFFF',
    nx: 0.5, ny: 0.5, scale: 1, rotation: 0,
    postId: post.id, postAuthorId: author.id,
    postAuthorName: author.full_name || author.username || 'Platinum Circles',
    postUsername: author.username, postAuthorAvatar: author.avatar_url,
    postVerified: !!author.is_verified, postVerifiedTier: author.verified_tier,
    postText: post.content || post.body || '', postArticleTitle: post.article_title,
    postMediaUrl: mediaUrl,
    postMediaType: first?.media_type || (mediaUrl && /\.(mp4|mov|webm|m4v)(?:[?#]|$)/i.test(mediaUrl) ? 'video' : 'image'),
    postMediaCount: Math.max(gallery.data?.length || 0, mediaUrl ? 1 : 0),
    postMediaWidth: first?.width || null, postMediaHeight: first?.height || null,
    postMediaPlayback: normalizePostPlayback(first?.edit),
    postCreatedAt: post.created_at,
  };
  const [preview] = await hydratePostMedia([{ id: post.id, sticker }], client);
  assertCurrent();
  if (mediaUrl && !preview?.sticker.postMediaUrl) throw new Error('The post preview could not load. Please try again.');
  return preview.sticker;
}

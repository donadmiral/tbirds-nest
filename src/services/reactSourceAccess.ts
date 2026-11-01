import type { ReactSource } from '../../shared/reactVideoComposition';
import { CONTENT_UUID, contentObject, isContentCapability } from '../../shared/contentMedia';
import { orderTimeout } from '../../shared/orderRequest';
import { supabase, SUPABASE_URL } from './supabase';
import { hydratePostMedia } from './contentMedia';
import { useAuthStore } from '../stores/authStore';
import { navigationScope } from '../lib/navigationCache';

const unavailable = () => new Error('This post is no longer available for React. Choose a public post, photo or video.');
const local = (uri: unknown) => typeof uri === 'string' && /^(file|content):\/\//.test(uri);

/** Resolve the source afresh through existing post visibility and media access.
 * Route flags and stale signed URLs never authorize copying private content. */
export async function prepareReactPostSource(source: ReactSource, signal?: AbortSignal): Promise<ReactSource> {
  if (signal?.aborted) throw new Error('React was cancelled.');
  if (!source.postId) {
    if (!local(source.uri) || source.isPrivate || source.allowReact === false) throw unavailable();
    return { uri: source.uri, kind: source.kind, width: source.width, height: source.height, duration: source.duration };
  }
  if (!CONTENT_UUID.test(source.postId)) throw unavailable();
  const owner = useAuthStore.getState().session?.user.id;
  const scope = navigationScope();
  if (!owner) throw unavailable();
  const current = () => {
    if (signal?.aborted || navigationScope() !== scope || useAuthStore.getState().session?.user.id !== owner) throw new Error('React was cancelled because the account changed.');
  };
  const bounded = <T,>(work: PromiseLike<T>) => orderTimeout(work, 15000, 'The source post could not be checked. Try again.');
  let visibility = supabase.rpc('can_view_post', { p_post_id: source.postId });
  if (signal) visibility = visibility.abortSignal(signal);
  const { data: canView, error: visibilityError } = await bounded(visibility);
  current();
  if (visibilityError) throw visibilityError;
  if (canView !== true) throw unavailable();
  let query = supabase.from('posts').select('id,user_id,content,body,article_title,media_url,image_url,audience,archived_at,is_exclusive,community_id,post_media(id,url,media_type,width,height,sort_order,is_sensitive)').eq('id', source.postId);
  if (signal) query = query.abortSignal(signal);
  const { data: post, error } = await bounded(query.maybeSingle());
  current();
  if (error) throw error;
  if (!post || post.audience !== 'everyone' || post.archived_at || post.is_exclusive || post.community_id) throw unavailable();
  let authorQuery = supabase.from('profiles').select('id,username,full_name,profile_visibility,deactivated_at').eq('id', post.user_id);
  if (signal) authorQuery = authorQuery.abortSignal(signal);
  const { data: author, error: authorError } = await bounded(authorQuery.maybeSingle());
  current();
  if (authorError) throw authorError;
  if (!author || author.deactivated_at || author.profile_visibility === 'private') throw unavailable();
  const media = [...(post.post_media ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id.localeCompare(b.id));
  const selected = source.sourceMediaId ? media.find(item => item.id === source.sourceMediaId) : media[0];
  if (source.sourceMediaId && !selected || selected?.is_sensitive) throw unavailable();
  const uri = selected?.url || post.media_url || post.image_url || '';
  const kind: ReactSource['kind'] = selected?.media_type === 'video' || /\.(mp4|mov|m4v|webm)([?#]|$)/i.test(uri) ? 'video' : 'image';
  const text = uri ? undefined : String(post.content || post.body || '').trim();
  const title = text ? post.article_title || undefined : undefined;
  if (!uri && !text) throw unavailable();
  const sourceRevision = JSON.stringify([post.id, post.user_id, selected?.id ?? null, uri, kind, text ?? null, title ?? null]);
  if (source.sourceRevision && source.sourceRevision !== sourceRevision) throw new Error('The original post changed. Reopen React from the updated post.');
  const creatorName = author.username ? `@${author.username}` : author.full_name || 'Platinum creator';
  const resolved: ReactSource = {
    uri, kind, text, title, postId: post.id, sourceMediaId: selected?.id, sourceRevision,
    creatorId: author.id, creatorName, attributionText: `React · ${creatorName}`,
    width: selected?.width ?? undefined, height: selected?.height ?? undefined,
  };
  if (!uri) return resolved;
  if (!contentObject(uri, SUPABASE_URL)) throw unavailable();
  const [hydrated] = await hydratePostMedia([{ ...resolved, post_id: post.id }]);
  current();
  if (!hydrated.uri || !isContentCapability(hydrated.uri, SUPABASE_URL)) throw unavailable();
  return hydrated;
}

export async function assertReactSourceAccess(source: ReactSource): Promise<void> {
  const scope = navigationScope();
  const fresh = await prepareReactPostSource(source);
  if (navigationScope() !== scope) throw new Error('React was cancelled because the account changed.');
  if (source.postId && (!source.sourceRevision || source.sourceRevision !== fresh.sourceRevision || source.creatorId !== fresh.creatorId)) {
    throw new Error('The original post changed while you were making this reaction. Reopen React from the updated post.');
  }
}

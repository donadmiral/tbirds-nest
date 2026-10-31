import 'server-only';
import { requirePermission } from './adminAuth';
import { serviceClient } from './supabaseAdmin';
import { isVideoUrl, pickAllMedia } from './media';
import { resolveModerationMedia } from './moderationMedia';
import { completeRead } from './completeRead';
import type { MediaPreviewEdit, ReviewMedia } from '@/components/MediaPreview';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const REVIEW_PAGE_SIZE = 20;
export type ReviewPost = {
  id: string; user_id: string; content: string | null; body: string | null; media_url: string | null;
  created_at: string; likes_count: number | null; comments_count: number | null; shares_count: number | null;
  scope: string; audience: string; is_exclusive: boolean; community_id: string | null; archived_at: string | null;
};
type MediaRow = { url: string; media_type: string | null; width: number | null; height: number | null; edit: MediaPreviewEdit | null };
export type ReviewComment = { id: string; user_id: string; content: string | null; body: string | null; created_at: string; media_url: string | null };
export type ReviewReport = { id: string; reason: string | null; status: string; created_at: string };
export type ReviewAuthor = { id: string; full_name: string | null; username: string | null; is_verified: boolean };

export function reviewPage(value: string | undefined): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, 100_000) : 1;
}

/** A staff record has a separate route from the public sharing page. Permission
 * is checked before the first service-role read, including invalid identifiers. */
export async function loadContentReview(id: string, commentPage = 1, reportPage = 1) {
  await requirePermission('post_moderate');
  if (!UUID.test(id)) return null;
  const svc = serviceClient();
  const postResult = await svc.from('posts').select('id,user_id,content,body,media_url,created_at,likes_count,comments_count,shares_count,scope,audience,is_exclusive,community_id,archived_at').eq('id', id).maybeSingle();
  if (postResult.error) throw new Error('The post could not be loaded. Please retry.');
  const post = postResult.data as ReviewPost | null;
  if (!post) return null;
  const commentOffset = (commentPage - 1) * REVIEW_PAGE_SIZE;
  const reportOffset = (reportPage - 1) * REVIEW_PAGE_SIZE;
  const [mediaResult, commentResult, reportResult] = await Promise.all([
    svc.from('post_media').select('url,media_type,width,height,edit', { count: 'exact' }).eq('post_id', id).order('sort_order', { ascending: true }).limit(1000),
    svc.from('post_comments').select('id,user_id,content,body,created_at,media_url', { count: 'exact' }).eq('post_id', id).order('created_at', { ascending: false }).order('id', { ascending: true }).range(commentOffset, commentOffset + REVIEW_PAGE_SIZE - 1),
    svc.from('post_reports').select('id,reason,status,created_at', { count: 'exact' }).eq('post_id', id).order('created_at', { ascending: false }).order('id', { ascending: true }).range(reportOffset, reportOffset + REVIEW_PAGE_SIZE - 1),
  ]);
  if (mediaResult.error || commentResult.error || reportResult.error || commentResult.count === null || reportResult.count === null) {
    throw new Error('The full review context could not be loaded. Please retry.');
  }
  completeRead(mediaResult, 'Post attachments');
  const comments = (commentResult.data || []) as ReviewComment[];
  const reports = (reportResult.data || []) as ReviewReport[];
  const attachments = (mediaResult.data || []) as MediaRow[];
  // A legacy attachment is still reviewed when post_media has no rows.
  const media = attachments.length ? attachments : pickAllMedia({ media_url: post.media_url }).map(url => ({ url, media_type: isVideoUrl(url) ? 'video' : 'image', width: null, height: null, edit: null }));
  const sources = media.flatMap(item => [item.url, item.edit?.coverUrl]);
  const [urls, authorsResult] = await Promise.all([
    resolveModerationMedia(sources, 'post', [id]),
    svc.from('profiles').select('id,full_name,username,is_verified').in('id', [...new Set([post.user_id, ...comments.map(comment => comment.user_id)])]),
  ]);
  if (authorsResult.error) throw new Error('Author details could not be loaded. Please retry.');
  const authors = Object.fromEntries(((authorsResult.data || []) as ReviewAuthor[]).map(author => [author.id, author]));
  const gallery: ReviewMedia[] = media.filter(item => !!urls[item.url]).map(item => ({
    url: urls[item.url], video: item.media_type === 'video' || isVideoUrl(item.url), width: item.width, height: item.height,
    edit: item.edit ? { ...item.edit, coverUrl: item.edit.coverUrl ? urls[item.edit.coverUrl] || null : null } : null,
  }));
  return { post, authors, gallery, unavailableAttachments: media.length - gallery.length, comments, reports, commentCount: commentResult.count, reportCount: reportResult.count };
}

import Link from 'next/link';
import { requireDesk } from '@/lib/adminAuth';
import { loadContentReview, reviewPage, REVIEW_PAGE_SIZE } from '@/lib/contentReview';
import Shell from '@/components/Shell';
import ReviewMediaGallery from '@/components/ReviewMediaGallery';
import AdminIcon from '@/components/AdminIcon';
import { fmt } from '@/lib/fmt';
import CommandForm from '@/components/CommandForm';
import { adminRemovePost } from '@/lib/actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Post review | Platinum Circles Admin', robots: { index: false, follow: false } };

export default async function ContentRecordPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ comments?: string; reports?: string }>;
}) {
  const admin = await requireDesk('/content');
  const { id } = await params;
  const query = await searchParams;
  const commentPage = reviewPage(query.comments);
  const reportPage = reviewPage(query.reports);
  const review = await loadContentReview(id, commentPage, reportPage);
  const back = <Link href="/content" className="pc-button"><AdminIcon name="arrowLeft" size={16} /> Back to Content</Link>;
  if (!review) return <Shell admin={admin} active="/content" title="Post unavailable" pageActions={back} sub="This post may have been removed. Return to Content to review the current records.">{null}</Shell>;
  const { post, authors, gallery, comments, reports, commentCount, reportCount, unavailableAttachments } = review;
  const author = authors[post.user_id];
  const authorName = author?.full_name || author?.username || 'Unavailable account';
  const link = (kind: 'comments' | 'reports', page: number) => `/content/${id}?${new URLSearchParams({ comments: String(kind === 'comments' ? page : commentPage), reports: String(kind === 'reports' ? page : reportPage) })}#${kind}`;
  const pager = (kind: 'comments' | 'reports', page: number, total: number) => <nav aria-label={`${kind} pages`} className="pc-review-pagination">
    {page > 1 ? <Link className="pc-button" href={link(kind, page - 1)}>Previous</Link> : <span />}
    <span>Page {page} of {Math.max(1, Math.ceil(total / REVIEW_PAGE_SIZE))} · {fmt(total)} {kind}</span>
    {page * REVIEW_PAGE_SIZE < total ? <Link className="pc-button" href={link(kind, page + 1)}>Next</Link> : <span />}
  </nav>;
  return <Shell admin={admin} active="/content" title="Post review" crumb="Post review" pageActions={back} sub="Review the published media, audience and conversation before making a moderation decision.">
    <div className="pc-content-record">
      <section className="pc-record-panel" aria-labelledby="post-heading">
        <header className="pc-record-heading"><div><h2 id="post-heading">{authorName}</h2><p>{author?.username ? `@${author.username} · ` : ''}<time dateTime={post.created_at}>{new Date(post.created_at).toLocaleString('en-US', { timeZone: 'UTC' })} UTC</time></p></div><Link className="pc-button" href={`/users/${post.user_id}`}>Open author</Link></header>
        {gallery.length ? <ReviewMediaGallery media={gallery} /> : <p className="pc-record-empty">{unavailableAttachments ? 'Media access could not be verified for this post.' : 'This post has no photo or video attachments.'}</p>}
        {unavailableAttachments > 0 ? <p role="status" className="pc-service-notice">{unavailableAttachments} attachment{unavailableAttachments === 1 ? '' : 's'} could not be authorized. Refresh the review to check access again.</p> : null}
        <div className="pc-record-caption">{post.content || post.body || 'No caption.'}</div>
        <dl className="pc-record-metrics">{[[post.likes_count || 0, 'Likes'], [commentCount, 'Comments'], [post.shares_count || 0, 'Shares'], [reportCount, 'Reports']].map(([value, label]) => <div key={label}><dt>{label}</dt><dd>{fmt(Number(value))}</dd></div>)}</dl>
      </section>
      <aside className="pc-record-panel pc-record-context" aria-labelledby="context-heading"><h2 id="context-heading">Visibility and context</h2><dl>
        <div><dt>Audience</dt><dd>{post.audience?.replaceAll('_', ' ') || 'Unspecified'}</dd></div>
        <div><dt>Scope</dt><dd>{post.scope?.replaceAll('_', ' ') || 'Unspecified'}</dd></div>
        <div><dt>Exclusive content</dt><dd>{post.is_exclusive ? 'Yes' : 'No'}</dd></div>
        <div><dt>Community post</dt><dd>{post.community_id ? 'Yes' : 'No'}</dd></div>
        <div><dt>Status</dt><dd>{post.archived_at ? 'Archived' : 'Published'}</dd></div>
        <div><dt>Post ID</dt><dd className="pc-record-id">{post.id}</dd></div>
      </dl><p>Media access is checked against your staff session for every request.</p><Link className="pc-button" href="/reports">Open reports desk <AdminIcon name="arrowRight" size={16} /></Link>
        <details className="pc-record-enforcement"><summary>Moderation action</summary><p>Removing this post also removes it from member feeds. Review its context before continuing.</p><CommandForm scope="adminRemovePost" action={adminRemovePost}><input type="hidden" name="pid" value={post.id} /><label><input type="checkbox" required /> I have reviewed this post and confirm its removal.</label><button className="pc-button pc-record-remove" type="submit">Remove this post</button></CommandForm></details>
      </aside>
      <section id="comments" className="pc-record-panel" aria-labelledby="comments-heading"><h2 id="comments-heading">Conversation</h2>
        {comments.length ? comments.map(comment => <article key={comment.id} className="pc-record-comment"><header><Link href={`/users/${comment.user_id}`}>{authors[comment.user_id]?.full_name || authors[comment.user_id]?.username || 'Unavailable account'}</Link><time dateTime={comment.created_at}>{new Date(comment.created_at).toLocaleString('en-US', { timeZone: 'UTC' })} UTC</time></header><p>{comment.content || comment.body || (comment.media_url ? 'Media comment' : 'No text.')}</p></article>) : <p className="pc-record-empty">{commentCount ? 'There are no comments on this page.' : 'No comments yet.'}</p>}
        {pager('comments', commentPage, commentCount)}
      </section>
      <section id="reports" className="pc-record-panel" aria-labelledby="reports-heading"><h2 id="reports-heading">Reports</h2>
        {reports.length ? reports.map(report => <article key={report.id} className="pc-record-comment"><header><strong>{report.status.replaceAll('_', ' ')}</strong><time dateTime={report.created_at}>{new Date(report.created_at).toLocaleString('en-US', { timeZone: 'UTC' })} UTC</time></header><p>{report.reason || 'No reason supplied.'}</p><code>{report.id}</code></article>) : <p className="pc-record-empty">{reportCount ? 'There are no reports on this page.' : 'No reports for this post.'}</p>}
        {pager('reports', reportPage, reportCount)}
      </section>
    </div>
  </Shell>;
}

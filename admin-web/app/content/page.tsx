import { requestTime } from '@/lib/requestTime';
import { requireDesk } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { adminRemovePost } from '@/lib/actions';
import Shell from '@/components/Shell';
import { Desk, StatStrip, type DeskRow, type Tone } from '@/components/Desk';
import { Donut, StackBars, Empty, type Slice } from '@/components/Viz';
import { fmt, ago } from '@/lib/fmt';
import { pickMedia, isVideoMedia, isVideoUrl } from '@/lib/media';
import { resolveModerationMedia } from '@/lib/moderationMedia';
import type { MediaPreviewEdit, ReviewMedia } from '@/components/MediaPreview';
import RecordPages from '@/components/RecordPages';
import { DESK_PAGE_SIZE, exactCount, formatCount, recordPage, type DeskSearch } from '@/lib/deskReporting';
import { completeRead } from '@/lib/completeRead';

export const dynamic = 'force-dynamic';

const PANEL: React.CSSProperties = { borderRadius: 12, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', overflow: 'hidden' };
const HEAD: React.CSSProperties = { padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' };
const H_TITLE: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: 'var(--txt)' };
const H_SUB: React.CSSProperties = { fontSize: 12, color: 'var(--txt-muted)', marginTop: 3 };

const IC = {
  post: 'content',
  flag: 'reports',
  heart: 'heart',
  eye: 'eye',
  media: 'image',
} as const;

const isVideo = isVideoUrl;

export default async function ContentPage({ searchParams }: { searchParams: Promise<DeskSearch> }) {
  const admin = await requireDesk('/content');
  const svc = serviceClient();

  const now = await requestTime();
  const from7 = new Date(now - 7 * 86400000).toISOString();
  const from14 = new Date(now - 14 * 86400000).toISOString();
  const days30 = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * 86400000).toISOString().slice(0, 10));

  const [totalRes, posted7Res, postedPrev7Res, removedRes] = await Promise.all([
    svc.from('posts').select('id', { count: 'exact', head: true }),
    svc.from('posts').select('id', { count: 'exact', head: true }).gte('created_at', from7),
    svc.from('posts').select('id', { count: 'exact', head: true }).gte('created_at', from14).lt('created_at', from7),
    svc.from('admin_audit_log').select('id, target_id, created_at').eq('action', 'post.remove').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(6),
  ]);
  const totalPosts = exactCount(totalRes, 'Post counts could not be loaded. Refresh to retry.');
  const range = recordPage((await searchParams).page, totalPosts);
  const postsRes = await svc.from('posts').select('id, user_id, content, body, media_url, likes_count, comments_count, shares_count, created_at')
    .order('created_at', { ascending: false }).order('id', { ascending: false }).range(range.from, range.to);
  if (postsRes.error || !Array.isArray(postsRes.data) || removedRes.error || !Array.isArray(removedRes.data)) throw new Error('Posts could not be loaded. Refresh to retry.');

  const posts = (postsRes.data ?? []) as {
    id: string; user_id: string; content: string | null; body: string | null; media_url: string | null;
    likes_count: number | null; comments_count: number | null; shares_count: number | null; created_at: string;
  }[];

  const ids = posts.map(post => post.id), uids = Array.from(new Set(posts.map(post => post.user_id)));
  const empty = { data: [], error: null, count: 0 };
  const [mediaRes, trendRes, reportsRes, profiles] = await Promise.all([
    ids.length ? svc.from('post_media').select('post_id, url, sort_order, media_type, width, height, edit', { count: 'exact' }).in('post_id', ids).order('sort_order', { ascending: true }).order('id', { ascending: true }).limit(1000) : Promise.resolve(empty),
    ids.length ? svc.from('trending_snapshot').select('kind, ref_id, user_id, rank, heat, uniq_engagers').eq('kind', 'post').in('ref_id', ids).order('rank', { ascending: true }).limit(DESK_PAGE_SIZE) : Promise.resolve(empty),
    ids.length ? svc.from('post_reports').select('id, post_id, reason, status, created_at').in('post_id', ids).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1000) : Promise.resolve(empty),
    uids.length ? svc.from('profiles').select('id, full_name, username, avatar_url, is_verified').in('id', uids) : Promise.resolve(empty),
  ]);
  if (mediaRes.error || reportsRes.error || trendRes.error || profiles.error || !Array.isArray(reportsRes.data) || !Array.isArray(trendRes.data) || !Array.isArray(profiles.data)) throw new Error('Post review context could not be loaded. Refresh to retry.');
  completeRead(mediaRes, 'Post attachments');

  const mediaByPost: Record<string, string[]> = {};
  const mediaDetails: Record<string, { media_type?: string | null; width?: number | null; height?: number | null; edit?: MediaPreviewEdit | null }> = {};
    ((mediaRes.data ?? []) as { post_id: string; url: string; media_type?: string | null; width?: number | null; height?: number | null; edit?: MediaPreviewEdit | null }[]).forEach(m => {
      (mediaByPost[m.post_id] = mediaByPost[m.post_id] || []).push(m.url);
      mediaDetails[m.post_id + ':' + m.url] = m;
    });

  // Resolve verified post media for the authenticated moderation desk.
  posts.forEach(p => {
    if (!mediaByPost[p.id]?.length) {
      const found = pickMedia({ media_url: p.media_url });
      if (found) mediaByPost[p.id] = [found];
    }
  });
  // only real pictures and videos become tiles; a link inside a caption is not a picture
  // Attachment rows are authoritative, including extensionless Storage keys.
  // The resolver validates their location and current content binding.
  const previewSources = Object.values(mediaByPost).flat();
  const coverSources = posts.flatMap(post => (mediaByPost[post.id] || []).flatMap(url => {
    const cover = mediaDetails[post.id + ':' + url]?.edit?.coverUrl;
    return typeof cover === 'string' ? [cover] : [];
  }));
  const urlMap = await resolveModerationMedia([...previewSources, ...coverSources], 'post', posts.map(p => p.id));

  const people: Record<string, { full_name: string | null; username: string | null; avatar_url: string | null; is_verified: boolean }> = {};
  (profiles.data ?? []).forEach((p: { id: string; full_name: string | null; username: string | null; avatar_url: string | null; is_verified: boolean }) => { people[p.id] = p; });

  const reports = (reportsRes.data ?? []) as { id: string; post_id: string; reason: string; status: string; created_at: string }[];
  const reportsByPost: Record<string, { open: number; total: number; reasons: string[] }> = {};
  reports.forEach(r => {
    const e = reportsByPost[r.post_id] = reportsByPost[r.post_id] || { open: 0, total: 0, reasons: [] };
    e.total += 1;
    if (r.status === 'open') e.open += 1;
    if (r.reason) e.reasons.push(r.reason);
  });

  const trending = (trendRes.data ?? []) as { ref_id: string; rank: number; heat: number; uniq_engagers: number }[];
  const trendRank: Record<string, { rank: number; engagers: number }> = {};
  trending.forEach(t => { trendRank[t.ref_id] = { rank: t.rank, engagers: t.uniq_engagers }; });

  const removed = (removedRes.data ?? []) as { id: string; target_id: string; created_at: string }[];

  const withMedia = posts.filter(p => (mediaByPost[p.id]?.length || 0) > 0 || p.media_url).length;
  const videoPosts = posts.filter(p => (mediaByPost[p.id] || []).some(url => isVideoMedia(mediaDetails[p.id + ':' + url]?.media_type, url)) || isVideo(p.media_url)).length;
  const flagged = posts.filter(p => (reportsByPost[p.id]?.open || 0) > 0).length;
  const engagement = posts.reduce((a, p) => a + (p.likes_count || 0) + (p.comments_count || 0) + (p.shares_count || 0), 0);

  const posted7 = exactCount(posted7Res, 'Weekly post counts could not be loaded. Refresh to retry.');
  const postedPrev7 = exactCount(postedPrev7Res, 'Weekly post counts could not be loaded. Refresh to retry.');
  const pct = (a: number, b: number) => b > 0 ? { text: (a >= b ? '+' : '') + (((a - b) / b) * 100).toFixed(1) + '%', tone: (a >= b ? 'ok' : 'bad') as Tone } : { text: a > 0 ? 'new' : 'flat', tone: (a > 0 ? 'ok' : 'neutral') as Tone };
  const d7 = pct(posted7, postedPrev7);

  const dayRows = days30.map(d => ({
    day: d,
    media: posts.filter(p => p.created_at.slice(0, 10) === d && ((mediaByPost[p.id]?.length || 0) > 0 || p.media_url)).length,
    text: posts.filter(p => p.created_at.slice(0, 10) === d && !((mediaByPost[p.id]?.length || 0) > 0 || p.media_url)).length,
  } as Record<string, number | string>));

  const reasonCount: Record<string, number> = {};
  reports.forEach(r => { if (r.reason) reasonCount[r.reason] = (reasonCount[r.reason] || 0) + 1; });
  const SERIES = ['var(--c5)', 'var(--c3)', 'var(--c1)', 'var(--c4)', 'var(--c6)', 'var(--c2)'];
  const reasonSlices: Slice[] = Object.keys(reasonCount).sort((a, b) => reasonCount[b] - reasonCount[a]).slice(0, 6)
    .map((k, i) => ({ label: k.replace(/[._]/g, ' '), value: reasonCount[k], color: SERIES[i % SERIES.length] }));

  const cards = [
    { label: 'Posts on the platform', value: formatCount(totalPosts), note: 'all published posts', icon: IC.post, color: 'var(--c1)' },
    { label: 'Posted this week', value: formatCount(posted7), delta: d7.text, deltaTone: d7.tone, note: 'against the week before', icon: IC.post, color: 'var(--c2)' },
    { label: 'Reported on this page', value: fmt(flagged), note: fmt(reports.filter(r => r.status === 'open').length) + ' open reports in the loaded context', icon: IC.flag, color: 'var(--c5)' },
    { label: 'With media on this page', value: fmt(withMedia), note: fmt(videoPosts) + ' of them video', icon: IC.media, color: 'var(--c4)' },
    { label: 'Engagement on this page', value: fmt(engagement), note: 'likes, comments and shares', icon: IC.heart, color: 'var(--c6)' },
  ];

  const rows: DeskRow[] = posts.map(p => {
    const a = people[p.user_id] || { full_name: null, username: null, avatar_url: null, is_verified: false };
    const resolvedRaw = (mediaByPost[p.id] || []).filter(u => !!urlMap[u]);
    const urls = resolvedRaw.map(u => urlMap[u]);
    const gallery: ReviewMedia[] = resolvedRaw.map(source => {
      const item = mediaDetails[p.id + ':' + source];
      const recipe = item?.edit && typeof item.edit === 'object' ? item.edit : null;
      return { url: urlMap[source], video: isVideoMedia(item?.media_type, source), width: item?.width, height: item?.height,
        edit: recipe ? { ...recipe, coverUrl: recipe.coverUrl ? urlMap[recipe.coverUrl] || null : null } : null };
    });
    const first = urls[0] || null;
    const video = gallery[0]?.video || isVideo(resolvedRaw[0] || (mediaByPost[p.id] || [])[0]);
    const rep = reportsByPost[p.id];
    const trend = trendRank[p.id];
    const text = (p.content || p.body || '').trim();
    const score = (p.likes_count || 0) + (p.comments_count || 0) + (p.shares_count || 0);
    const mediaCount = (mediaByPost[p.id] || []).length;
    const kind = mediaCount === 0 ? 'Text' : video ? 'Video' : mediaCount > 1 ? 'Gallery' : 'Photo';
    const status: { v: string; tone: Tone } = rep?.open
      ? { v: 'Reported', tone: 'bad' }
      : trend ? { v: 'Trending', tone: 'warn' } : { v: 'Published', tone: 'ok' };
    return {
      id: p.id,
      tabs: [
        rep?.open ? 'reported' : 'clean',
        mediaCount ? 'media' : 'text',
        ...(video ? ['video'] : []),
        ...(trend ? ['trending'] : []),
      ],
      search: [text, a.full_name, a.username, kind].map(x => String(x || '').toLowerCase()).join(' '),
      facets: { type: kind, status: status.v },
      cells: [
        { t: 'media', v: text || (mediaCount ? kind + ' post' : 'Empty post'), sub: '@' + (a.username || 'member'), thumb: first, video, poster: gallery[0]?.edit?.coverUrl },
        { t: 'user', v: a.full_name || 'Unnamed', sub: '@' + (a.username || 'member'), img: a.avatar_url },
        { t: 'pill', v: kind, tone: kind === 'Video' ? 'info' : kind === 'Text' ? 'neutral' : 'accent' },
        { t: 'pill', v: status.v, tone: status.tone },
        { t: 'mono', v: fmt(p.likes_count || 0) },
        { t: 'mono', v: fmt(p.comments_count || 0) },
        { t: 'mono', v: fmt(p.shares_count || 0) },
        { t: 'mono', v: ago(p.created_at) },
      ],
      detail: {
        title: text ? (text.length > 70 ? text.slice(0, 70) + '...' : text) : kind + ' post',
        subtitle: (a.full_name || 'Unnamed') + ' \u00b7 @' + (a.username || 'member') + ' \u00b7 ' + ago(p.created_at),
        img: a.avatar_url,
        media: gallery[0] || null,
        gallery,
        pills: [
          { v: kind, tone: kind === 'Video' ? 'info' : kind === 'Text' ? 'neutral' : 'accent' },
          status,
          ...(a.is_verified ? [{ v: 'Verified author', tone: 'ok' as Tone }] : []),
          ...(trend ? [{ v: 'Trending #' + trend.rank, tone: 'warn' as Tone }] : []),
        ],
        stats: [
          { label: 'Likes', value: fmt(p.likes_count || 0) },
          { label: 'Comments', value: fmt(p.comments_count || 0) },
          { label: 'Shares', value: fmt(p.shares_count || 0) },
          { label: 'Total', value: fmt(score) },
        ],
        fields: [
          { label: 'Post id', value: p.id },
          { label: 'Author', value: (a.full_name || 'Unnamed') + ' (@' + (a.username || 'member') + ')' },
          { label: 'Type', value: kind },
          { label: 'Media items', value: String(mediaCount) },
          { label: 'Posted', value: new Date(p.created_at).toLocaleString() },
          ...(rep ? [{ label: 'Recent reports', value: rep.open + ' open of ' + rep.total + ' loaded' }] : []),
          ...(trend ? [{ label: 'Trending', value: 'rank ' + trend.rank + ', ' + trend.engagers + ' unique engagers' }] : []),
        ],
        body: [
          ...(text ? [{ label: 'Caption', text }] : []),
          ...(rep && rep.reasons.length ? [{ label: 'Why it was reported', text: Array.from(new Set(rep.reasons)).join('\n') }] : []),
        ],
        links: [
          { label: 'Open post', href: '/content/' + p.id },
          { label: 'Open author', href: '/users/' + p.user_id },
          ...(rep?.open ? [{ label: 'Open reports desk', href: '/reports' }] : []),
        ],
      },
      actions: ['remove'],
      actionId: p.id,
    };
  });

  const tabs = [
    { key: 'all', label: 'Posts on this page', count: rows.length },
    { key: 'reported', label: 'Reported', count: rows.filter(r => r.tabs.includes('reported')).length },
    { key: 'trending', label: 'Trending', count: rows.filter(r => r.tabs.includes('trending')).length },
    { key: 'media', label: 'With media', count: rows.filter(r => r.tabs.includes('media')).length },
    { key: 'video', label: 'Video', count: rows.filter(r => r.tabs.includes('video')).length },
    { key: 'text', label: 'Text only', count: rows.filter(r => r.tabs.includes('text')).length },
  ];

  return (
    <Shell admin={admin} active="/content" title="Posts" sub="Review photos, videos and conversations. Open a post to see its context, engagement and moderation actions.">
      <StatStrip cards={cards} />
      <RecordPages path="/content" range={range} loaded={rows.length} label="Posts" />
      <p className="text-sm text-[var(--txt-muted)]">Filters and charts describe this page. Open a post for its full report history.</p>

      <div className="mt-5 flex min-w-0 flex-col gap-5">
        <div>
          <Desk
            key={range.page}
            presentation="media"
            tabs={tabs}
            columns={[{ label: 'Post' }, { label: 'Author' }, { label: 'Type' }, { label: 'Status' }, { label: 'Likes', align: 'right' }, { label: 'Comments', align: 'right' }, { label: 'Shares', align: 'right' }, { label: 'Posted', align: 'right' }]}
            grid="minmax(220px,2.4fr) minmax(150px,1.3fr) 96px 108px 74px 92px 76px 92px"
            rows={rows}
            filters={[
              { key: 'type', label: 'Type', options: ['Photo', 'Video', 'Gallery', 'Text'] },
              { key: 'status', label: 'Status', options: ['Published', 'Reported', 'Trending'] },
            ]}
            searchHint="Filter this page by caption, author or media"
            detailTitle="Post details"
            minWidth={1020}
            pageSize={DESK_PAGE_SIZE}
            actions={[
              { key: 'remove', label: 'Remove this post everywhere', tone: 'bad', action: adminRemovePost, idName: 'pid' },
            ]}
          />
        </div>

        <div className="pc-content-insights">
          <div style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Why posts get reported</div>
              <div style={H_SUB}>Recent reports for posts on this page</div>
            </div>
            <div style={{ padding: 16 }}>
              {reasonSlices.length === 0 ? <Empty note="No recent reports for these posts." /> : <Donut slices={reasonSlices} centerLabel="reports" size={148} />}
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>What gets posted</div>
              <div style={H_SUB}>Posts on this page during the last 30 days</div>
            </div>
            <div style={{ padding: '18px 16px 14px' }}>
              <StackBars days={dayRows} height={130} series={[
                { key: 'media', label: 'With media', color: 'var(--c4)' },
                { key: 'text', label: 'Text only', color: 'var(--c1)' },
              ]} />
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Recently removed</div>
              <div style={H_SUB}>From the audit log, permanent record</div>
            </div>
            {removed.length === 0 ? <Empty note="No post has been removed by this desk." /> : removed.slice(0, 6).map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10.5px 16px', borderBottom: '1px solid rgba(var(--on),0.10)' }}>
                <span className="pc-num" style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--txt-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(r.target_id).slice(0, 18)}</span>
                <span className="pc-num" style={{ fontSize: 11, color: 'var(--txt-muted)' }}>{ago(r.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}

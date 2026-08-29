import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { adminRemovePost } from '@/lib/actions';
import Shell from '@/components/Shell';
import { Desk, StatStrip, type DeskRow, type Tone } from '@/components/Desk';
import { Donut, StackBars, Empty, type Slice } from '@/components/Viz';
import { fmt, ago } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

const PANEL: React.CSSProperties = { borderRadius: 13, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', overflow: 'hidden' };
const HEAD: React.CSSProperties = { padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' };
const H_TITLE: React.CSSProperties = { fontSize: 13.5, fontWeight: 700, color: 'var(--txt)' };
const H_SUB: React.CSSProperties = { fontSize: 11.3, color: 'rgba(var(--on),0.36)', marginTop: 3 };

const IC = {
  post: 'M4 4h16v12H5.2L4 17.2V4zm2 3h12v2H6V7zm0 4h8v2H6v-2z',
  flag: 'M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z',
  heart: 'M12 21S3 14.5 3 8.9A5 5 0 0112 6a5 5 0 019 2.9C21 14.5 12 21 12 21z',
  eye: 'M12 5c5 0 9 4.5 9 7s-4 7-9 7-9-4.5-9-7 4-7 9-7zm0 3.5A3.5 3.5 0 1012 15a3.5 3.5 0 000-6.5z',
  media: 'M4 5h16v14H4V5zm2 10l3.5-4.5 2.5 3 3-4L18 17H6z',
};

const VIDEO_RX = /\.(mp4|mov|m4v|webm|hevc|avi|mkv)(\?|$)/i;

function isVideo(url: string | null | undefined) { return !!url && VIDEO_RX.test(url); }

export default async function ContentPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();

  const now = Date.now();
  const from7 = new Date(now - 7 * 86400000).toISOString();
  const from14 = new Date(now - 14 * 86400000).toISOString();
  const days30 = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * 86400000).toISOString().slice(0, 10));

  const [postsRes, totalRes, trendRes, reportsRes, removedRes] = await Promise.all([
    svc.from('posts').select('id, user_id, content, body, media_url, likes_count, comments_count, shares_count, created_at')
      .order('created_at', { ascending: false }).limit(200),
    svc.from('posts').select('id', { count: 'exact', head: true }),
    svc.from('trending_snapshot').select('kind, ref_id, user_id, rank, heat, uniq_engagers').eq('kind', 'post').order('rank', { ascending: true }),
    svc.from('post_reports').select('id, post_id, reason, status, created_at').limit(1000),
    svc.from('admin_audit_log').select('id, target_id, created_at').eq('action', 'post.remove').order('created_at', { ascending: false }).limit(500),
  ]);

  const posts = (postsRes.data ?? []) as {
    id: string; user_id: string; content: string | null; body: string | null; media_url: string | null;
    likes_count: number | null; comments_count: number | null; shares_count: number | null; created_at: string;
  }[];

  const mediaByPost: Record<string, string[]> = {};
  if (posts.length) {
    const { data: media } = await svc.from('post_media').select('post_id, url, sort_order')
      .in('post_id', posts.map(p => p.id)).order('sort_order', { ascending: true });
    ((media ?? []) as { post_id: string; url: string }[]).forEach(m => {
      (mediaByPost[m.post_id] = mediaByPost[m.post_id] || []).push(m.url);
    });
  }

  const uids = Array.from(new Set(posts.map(p => p.user_id)));
  const people: Record<string, { full_name: string | null; username: string | null; avatar_url: string | null; is_verified: boolean }> = {};
  if (uids.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username, avatar_url, is_verified').in('id', uids);
    (data ?? []).forEach((p: { id: string; full_name: string | null; username: string | null; avatar_url: string | null; is_verified: boolean }) => { people[p.id] = p; });
  }

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

  const totalPosts = totalRes.count ?? posts.length;
  const withMedia = posts.filter(p => (mediaByPost[p.id]?.length || 0) > 0 || p.media_url).length;
  const videoPosts = posts.filter(p => (mediaByPost[p.id] || []).some(isVideo) || isVideo(p.media_url)).length;
  const flagged = posts.filter(p => (reportsByPost[p.id]?.open || 0) > 0).length;
  const engagement = posts.reduce((a, p) => a + (p.likes_count || 0) + (p.comments_count || 0) + (p.shares_count || 0), 0);

  const posted7 = posts.filter(p => p.created_at >= from7).length;
  const postedPrev7 = posts.filter(p => p.created_at >= from14 && p.created_at < from7).length;
  const pct = (a: number, b: number) => b > 0 ? { text: (a >= b ? '+' : '') + (((a - b) / b) * 100).toFixed(1) + '%', tone: (a >= b ? 'ok' : 'bad') as Tone } : { text: a > 0 ? 'new' : 'flat', tone: (a > 0 ? 'ok' : 'neutral') as Tone };
  const d7 = pct(posted7, postedPrev7);

  const spark = days30.map(d => posts.filter(p => p.created_at.slice(0, 10) === d).length);
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
    { label: 'Posts on the platform', value: fmt(totalPosts), note: 'every row in posts', icon: IC.post, color: 'var(--c1)', spark },
    { label: 'Posted this week', value: fmt(posted7), delta: d7.text, deltaTone: d7.tone, note: 'against the week before', icon: IC.post, color: 'var(--c2)', spark: spark.slice(-14) },
    { label: 'Carrying open reports', value: fmt(flagged), note: fmt(reports.filter(r => r.status === 'open').length) + ' open reports in total', icon: IC.flag, color: 'var(--c5)' },
    { label: 'With media', value: fmt(withMedia), note: fmt(videoPosts) + ' of them video', icon: IC.media, color: 'var(--c4)' },
    { label: 'Engagement on file', value: fmt(engagement), note: 'likes, comments and shares', icon: IC.heart, color: 'var(--c6)' },
  ];

  const rows: DeskRow[] = posts.map(p => {
    const a = people[p.user_id] || { full_name: null, username: null, avatar_url: null, is_verified: false };
    const urls = mediaByPost[p.id] || (p.media_url ? [p.media_url] : []);
    const first = urls[0] || null;
    const video = isVideo(first);
    const rep = reportsByPost[p.id];
    const trend = trendRank[p.id];
    const text = (p.content || p.body || '').trim();
    const score = (p.likes_count || 0) + (p.comments_count || 0) + (p.shares_count || 0);
    const kind = urls.length === 0 ? 'Text' : video ? 'Video' : urls.length > 1 ? 'Gallery' : 'Photo';
    const status: { v: string; tone: Tone } = rep?.open
      ? { v: 'Reported', tone: 'bad' }
      : trend ? { v: 'Trending', tone: 'warn' } : { v: 'Published', tone: 'ok' };
    return {
      id: p.id,
      tabs: [
        rep?.open ? 'reported' : 'clean',
        urls.length ? 'media' : 'text',
        ...(video ? ['video'] : []),
        ...(trend ? ['trending'] : []),
      ],
      search: [text, a.full_name, a.username, kind].map(x => String(x || '').toLowerCase()).join(' '),
      facets: { type: kind, status: status.v },
      cells: [
        { t: 'media', v: text || (urls.length ? kind + ' post' : 'Empty post'), sub: '@' + (a.username || 'member'), thumb: first, video },
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
        media: first ? { url: first, video } : null,
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
          { label: 'Media items', value: String(urls.length) },
          { label: 'Posted', value: new Date(p.created_at).toLocaleString() },
          ...(rep ? [{ label: 'Reports', value: rep.open + ' open of ' + rep.total + ' total' }] : []),
          ...(trend ? [{ label: 'Trending', value: 'rank ' + trend.rank + ', ' + trend.engagers + ' unique engagers' }] : []),
        ],
        body: [
          ...(text ? [{ label: 'Caption', text }] : []),
          ...(rep && rep.reasons.length ? [{ label: 'Why it was reported', text: Array.from(new Set(rep.reasons)).join('\n') }] : []),
          ...(urls.length > 1 ? [{ label: 'All media', text: urls.join('\n') }] : []),
        ],
        links: [
          { label: 'Open post', href: '/p/' + p.id },
          { label: 'Open author', href: '/users/' + p.user_id },
          ...(rep?.open ? [{ label: 'Open reports desk', href: '/reports' }] : []),
        ],
      },
      actions: ['remove'],
      actionId: p.id,
    };
  });

  const tabs = [
    { key: 'all', label: 'All posts', count: rows.length },
    { key: 'reported', label: 'Reported', count: rows.filter(r => r.tabs.includes('reported')).length },
    { key: 'trending', label: 'Trending', count: rows.filter(r => r.tabs.includes('trending')).length },
    { key: 'media', label: 'With media', count: rows.filter(r => r.tabs.includes('media')).length },
    { key: 'video', label: 'Video', count: rows.filter(r => r.tabs.includes('video')).length },
    { key: 'text', label: 'Text only', count: rows.filter(r => r.tabs.includes('text')).length },
  ];

  return (
    <Shell admin={admin} active="/content" title="Posts" sub="Every post across Platinum Circles with its real media, engagement and reports. Removing deletes it everywhere and the trending snapshot rebuilds within three minutes.">
      <StatStrip cards={cards} />

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_336px]">
        <div>
          <Desk
            tabs={tabs}
            columns={[{ label: 'Post' }, { label: 'Author' }, { label: 'Type' }, { label: 'Status' }, { label: 'Likes', align: 'right' }, { label: 'Comments', align: 'right' }, { label: 'Shares', align: 'right' }, { label: 'Posted', align: 'right' }]}
            grid="minmax(220px,2.4fr) minmax(150px,1.3fr) 96px 108px 74px 92px 76px 92px"
            rows={rows}
            filters={[
              { key: 'type', label: 'Type', options: ['Photo', 'Video', 'Gallery', 'Text'] },
              { key: 'status', label: 'Status', options: ['Published', 'Reported', 'Trending'] },
            ]}
            searchHint="Search captions, authors, media"
            detailTitle="Post details"
            minWidth={1020}
            pageSize={12}
            actions={[
              { key: 'remove', label: 'Remove this post everywhere', tone: 'bad', action: adminRemovePost, idName: 'pid' },
            ]}
          />
        </div>

        <div>
          <div style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Why posts get reported</div>
              <div style={H_SUB}>post_reports.reason, every report on file</div>
            </div>
            <div style={{ padding: 16 }}>
              {reasonSlices.length === 0 ? <Empty note="No post has been reported yet." /> : <Donut slices={reasonSlices} centerLabel="reports" size={148} />}
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>What gets posted</div>
              <div style={H_SUB}>Media against text, last 30 days</div>
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
                <span className="pc-num" style={{ flex: 1, minWidth: 0, fontSize: 11.4, color: 'rgba(var(--on),0.55)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{String(r.target_id).slice(0, 18)}</span>
                <span className="pc-num" style={{ fontSize: 10.5, color: 'rgba(var(--on),0.3)' }}>{ago(r.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}

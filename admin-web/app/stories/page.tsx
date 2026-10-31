import { requestTime } from '@/lib/requestTime';
import { requireDesk } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { adminRemoveStory } from '@/lib/actions';
import Shell from '@/components/Shell';
import { Desk, StatStrip, type DeskRow, type Tone } from '@/components/Desk';
import { Donut, StackBars, Empty, type Slice } from '@/components/Viz';
import { fmt, ago } from '@/lib/fmt';
import { resolveModerationMedia } from '@/lib/moderationMedia';
import { resolveStoryPresentations } from '@/lib/storyPresentation';
import RecordPages from '@/components/RecordPages';
import { DESK_PAGE_SIZE, exactCount, formatCount, recordPage, type DeskSearch } from '@/lib/deskReporting';

export const dynamic = 'force-dynamic';

const PANEL: React.CSSProperties = { borderRadius: 12, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', overflow: 'hidden' };
const HEAD: React.CSSProperties = { padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' };
const H_TITLE: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: 'var(--txt)' };
const H_SUB: React.CSSProperties = { fontSize: 12, color: 'var(--txt-muted)', marginTop: 3 };

const IC = {
  ring: 'stories',
  eye: 'eye',
  clock: 'clock',
  media: 'image',
  users: 'users',
} as const;

const SERIES = ['var(--c1)', 'var(--c4)', 'var(--c3)', 'var(--c2)', 'var(--c6)', 'var(--c5)'];

function title(s: string) { return (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

export default async function StoriesPage({ searchParams }: { searchParams: Promise<DeskSearch> }) {
  const admin = await requireDesk('/stories');
  const svc = serviceClient();

  const now = await requestTime();
  const nowIso = new Date(now).toISOString();
  const days30 = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * 86400000).toISOString().slice(0, 10));

  const [totalRes, liveRes, expired24Res, removedRes] = await Promise.all([
    svc.from('stories').select('id', { count: 'exact', head: true }),
    svc.from('stories').select('id', { count: 'exact', head: true }).gt('expires_at', nowIso),
    svc.from('stories').select('id', { count: 'exact', head: true }).gt('expires_at', new Date(now - 86400000).toISOString()).lte('expires_at', nowIso),
    svc.from('admin_audit_log').select('id, target_id, created_at').eq('action', 'story.remove').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(6),
  ]);
  const failure = 'Story counts could not be loaded. Refresh before using this report.';
  const total = exactCount(totalRes, failure), liveCount = exactCount(liveRes, failure);
  const expired24 = exactCount(expired24Res, failure);
  const range = recordPage((await searchParams).page, total);
  const storiesRes = await svc.from('stories').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).range(range.from, range.to);
  if (storiesRes.error || !Array.isArray(storiesRes.data) || removedRes.error || !Array.isArray(removedRes.data)) throw new Error('Stories could not be loaded.');

  const stories = (storiesRes.data ?? []) as Record<string, unknown>[];

  const presentations = await resolveStoryPresentations(stories, resolveModerationMedia);

  const uids = Array.from(new Set(stories.map(s => String(s.user_id || '')).filter(Boolean)));
  const people: Record<string, { full_name: string | null; username: string | null; avatar_url: string | null; is_verified: boolean }> = {};
  if (uids.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username, avatar_url, is_verified').in('id', uids);
    (data ?? []).forEach((p: { id: string; full_name: string | null; username: string | null; avatar_url: string | null; is_verified: boolean }) => { people[p.id] = p; });
  }

  const totalViews = stories.reduce((a, s) => a + (Number(s.views_count) || 0), 0);
  const withMedia = presentations.filter(s => s.mediaCount > 0).length;
  const posters = new Set(stories.map(s => String(s.user_id))).size;

  const typeCount: Record<string, number> = {};
  presentations.forEach(s => { typeCount[s.kind] = (typeCount[s.kind] || 0) + 1; });
  const typeSlices: Slice[] = Object.keys(typeCount).map((k, i) => ({ label: title(k), value: typeCount[k], color: SERIES[i % SERIES.length] }));

  const dayRows = days30.map(d => ({
    day: d,
    posted: stories.filter(s => String(s.created_at).slice(0, 10) === d).length,
    views: stories.filter(s => String(s.created_at).slice(0, 10) === d).reduce((a, s) => a + (Number(s.views_count) || 0), 0),
  } as Record<string, number | string>));

  const removed = (removedRes.data ?? []) as { id: string; target_id: string; created_at: string }[];

  const cards = [
    { label: 'Stories on file', value: formatCount(total), note: 'all retained stories', icon: IC.ring, color: 'var(--c1)' },
    { label: 'Live right now', value: formatCount(liveCount), note: 'all stories not yet expired', icon: IC.clock, color: 'var(--c2)' },
    { label: 'Expired in the last 24 hours', value: formatCount(expired24), note: 'retained stories, by expiry time', icon: IC.clock, color: 'var(--c3)' },
    { label: 'Views on this page', value: fmt(totalViews), note: 'views across these stories', icon: IC.eye, color: 'var(--c6)' },
    { label: 'People on this page', value: fmt(posters), note: fmt(withMedia) + ' stories on this page carry media', icon: IC.users, color: 'var(--c4)' },
  ];

  const rows: DeskRow[] = stories.map((s, index) => {
    const id = String(s.id);
    const uid = String(s.user_id || '');
    const a = people[uid] || { full_name: null, username: null, avatar_url: null, is_verified: false };
    const presentation = presentations[index];
    const first = presentation.gallery[0] || null;
    const url = first?.url || null;
    const video = !!first?.video;
    const caption = presentation.caption;
    const expires = String(s.expires_at || '');
    const isLive = expires > nowIso;
    const hoursLeft = isLive ? Math.max(0, Math.round((new Date(expires).getTime() - now) / 3600000)) : 0;
    const views = Number(s.views_count) || 0;
    const kind = presentation.kind;
    const hasMedia = presentation.mediaCount > 0;
    const tone: Tone = kind === 'Video' ? 'info' : hasMedia || kind === 'Shared post' ? 'accent' : 'neutral';

    const fields = [
      { label: 'Story id', value: id },
      { label: 'Author', value: (a.full_name || 'Unnamed') + ' (@' + (a.username || 'member') + ')' },
      { label: 'Type', value: kind },
      { label: 'Views', value: fmt(views) },
      { label: 'Posted', value: new Date(String(s.created_at)).toLocaleString() },
      { label: 'Expires', value: expires ? new Date(expires).toLocaleString() : 'not set' },
      { label: 'State', value: isLive ? hoursLeft + ' hours left' : 'expired ' + ago(expires) },
    ];
    ['audience', 'only_with', 'music', 'location', 'link_url', 'mentions', 'sticker'].forEach(k => {
      const v = s[k];
      if (v !== undefined && v !== null && String(v).trim() !== '' && String(v) !== '[object Object]') {
        fields.push({ label: title(k), value: Array.isArray(v) ? v.join(', ') : String(v) });
      }
    });

    return {
      id,
      tabs: [isLive ? 'live' : 'expired', kind === 'Shared post' ? 'shared' : kind.toLowerCase()],
      search: [caption, a.full_name, a.username, kind].map(x => String(x || '').toLowerCase()).join(' '),
      facets: { type: kind, state: isLive ? 'Live' : 'Expired' },
      cells: [
        { t: 'media', v: caption || kind + ' story', sub: '@' + (a.username || 'member'), thumb: url, video },
        { t: 'user', v: a.full_name || 'Unnamed', sub: '@' + (a.username || 'member'), img: a.avatar_url },
        { t: 'pill', v: kind, tone },
        { t: 'pill', v: isLive ? hoursLeft + 'h left' : 'Expired', tone: (isLive ? 'ok' : 'neutral') as Tone },
        { t: 'mono', v: fmt(views) },
        { t: 'mono', v: ago(String(s.created_at)) },
      ],
      detail: {
        title: caption || kind + ' story',
        subtitle: (a.full_name || 'Unnamed') + ' \u00b7 posted ' + ago(String(s.created_at)),
        img: a.avatar_url,
        media: first,
        gallery: presentation.gallery,
        pills: [
          { v: kind, tone },
          { v: isLive ? 'Live, ' + hoursLeft + ' hours left' : 'Expired', tone: (isLive ? 'ok' : 'neutral') as Tone },
          ...(a.is_verified ? [{ v: 'Verified author', tone: 'ok' as Tone }] : []),
        ],
        stats: [
          { label: 'Views', value: fmt(views) },
          { label: 'Media', value: String(presentation.mediaCount) },
          { label: isLive ? 'Hours left' : 'Ended', value: isLive ? String(hoursLeft) : ago(expires).replace(' ago', '') },
        ],
        fields,
        body: caption ? [{ label: 'Caption', text: caption }] : undefined,
        links: [{ label: 'Open author', href: '/users/' + uid }],
      },
      actions: ['remove'],
      actionId: id,
    };
  });

  const tabs = [
    { key: 'all', label: 'Stories on this page', count: rows.length },
    { key: 'live', label: 'Live', count: rows.filter(r => r.tabs.includes('live')).length },
    { key: 'expired', label: 'Expired', count: rows.filter(r => r.tabs.includes('expired')).length },
    { key: 'video', label: 'Video', count: rows.filter(r => r.tabs.includes('video')).length },
    { key: 'photo', label: 'Photo', count: rows.filter(r => r.tabs.includes('photo')).length },
    { key: 'text', label: 'Text', count: rows.filter(r => r.tabs.includes('text')).length },
    { key: 'shared', label: 'Shared posts', count: rows.filter(r => r.tabs.includes('shared')).length },
  ];

  return (
    <Shell admin={admin} active="/stories" title="Stories" sub="A clear view of the stories your community shares. Review the original media, activity and moderation history.">
      <StatStrip cards={cards} />
      <RecordPages path="/stories" range={range} loaded={rows.length} label="Stories" />
      <p className="text-sm text-[var(--txt-muted)]">The filters and charts below describe the stories on this page.</p>

      <div className="mt-5 flex min-w-0 flex-col gap-5">
        <div>
          <Desk
            key={range.page}
            presentation="media"
            tabs={tabs}
            columns={[{ label: 'Story' }, { label: 'Author' }, { label: 'Type' }, { label: 'State' }, { label: 'Views', align: 'right' }, { label: 'Posted', align: 'right' }]}
            grid="minmax(220px,2.4fr) minmax(150px,1.3fr) 96px 108px 84px 92px"
            rows={rows}
            filters={[
              { key: 'type', label: 'Type', options: ['Photo', 'Video', 'Text', 'Shared post'] },
              { key: 'state', label: 'State', options: ['Live', 'Expired'] },
            ]}
            searchHint="Filter this page by caption or author"
            detailTitle="Story details"
            minWidth={900}
            pageSize={DESK_PAGE_SIZE}
            actions={[{ key: 'remove', label: 'Remove this story now', tone: 'bad', action: adminRemoveStory, idName: 'sid' }]}
          />
        </div>

        <div className="pc-content-insights">
          <div style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>What gets posted</div>
              <div style={H_SUB}>Photos, videos, text and shared posts on this page</div>
            </div>
            <div style={{ padding: 16 }}>
              {typeSlices.length === 0 ? <Empty note="No story on this page." /> : <Donut slices={typeSlices} centerLabel="stories" size={148} />}
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Posting rhythm</div>
              <div style={H_SUB}>Stories on this page posted during the last 30 days</div>
            </div>
            <div style={{ padding: '18px 16px 14px' }}>
              <StackBars days={dayRows} height={130} series={[{ key: 'posted', label: 'Posted', color: 'var(--c4)' }]} />
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Recently removed</div>
              <div style={H_SUB}>Latest six removals from the audit log</div>
            </div>
            {removed.length === 0 ? <Empty note="No story has been removed by this desk." /> : removed.slice(0, 6).map(r => (
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

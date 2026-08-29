import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { adminRemoveStory } from '@/lib/actions';
import Shell from '@/components/Shell';
import { Desk, StatStrip, type DeskRow, type Tone } from '@/components/Desk';
import { Donut, StackBars, Empty, type Slice } from '@/components/Viz';
import { fmt, ago } from '@/lib/fmt';
import { pickMedia, pickAllMedia, resolveMedia, isVideoUrl } from '@/lib/media';

export const dynamic = 'force-dynamic';

const PANEL: React.CSSProperties = { borderRadius: 13, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', overflow: 'hidden' };
const HEAD: React.CSSProperties = { padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' };
const H_TITLE: React.CSSProperties = { fontSize: 13.5, fontWeight: 700, color: 'var(--txt)' };
const H_SUB: React.CSSProperties = { fontSize: 11.3, color: 'rgba(var(--on),0.36)', marginTop: 3 };

const IC = {
  ring: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 3a7 7 0 110 14 7 7 0 010-14zm0 2.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9z',
  eye: 'M12 5c5 0 9 4.5 9 7s-4 7-9 7-9-4.5-9-7 4-7 9-7zm0 3.5A3.5 3.5 0 1012 15a3.5 3.5 0 000-6.5z',
  clock: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 10.6V6h-2v7.4l5.2 3.1 1-1.7-4.2-2.2z',
  media: 'M4 5h16v14H4V5zm2 10l3.5-4.5 2.5 3 3-4L18 17H6z',
  users: 'M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
};

const SERIES = ['var(--c1)', 'var(--c4)', 'var(--c3)', 'var(--c2)', 'var(--c6)', 'var(--c5)'];

function title(s: string) { return (s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

export default async function StoriesPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const days30 = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * 86400000).toISOString().slice(0, 10));

  const [storiesRes, totalRes, expired24Res, removedRes] = await Promise.all([
    svc.from('stories').select('*').order('created_at', { ascending: false }).limit(200),
    svc.from('stories').select('id', { count: 'exact', head: true }),
    svc.from('stories').select('id', { count: 'exact', head: true }).lt('expires_at', nowIso).gt('created_at', new Date(now - 86400000).toISOString()),
    svc.from('admin_audit_log').select('id, target_id, created_at').eq('action', 'story.remove').order('created_at', { ascending: false }).limit(200),
  ]);

  const stories = (storiesRes.data ?? []) as Record<string, unknown>[];

  const rawMedia = stories.map(s => pickMedia(s));
  const urlMap = await resolveMedia(rawMedia);

  const uids = Array.from(new Set(stories.map(s => String(s.user_id || '')).filter(Boolean)));
  const people: Record<string, { full_name: string | null; username: string | null; avatar_url: string | null; is_verified: boolean }> = {};
  if (uids.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username, avatar_url, is_verified').in('id', uids);
    (data ?? []).forEach((p: { id: string; full_name: string | null; username: string | null; avatar_url: string | null; is_verified: boolean }) => { people[p.id] = p; });
  }

  const live = stories.filter(s => String(s.expires_at || '') > nowIso);
  const totalViews = stories.reduce((a, s) => a + (Number(s.views_count) || 0), 0);
  const withMedia = stories.filter(s => pickMedia(s)).length;
  const posters = new Set(stories.map(s => String(s.user_id))).size;

  const typeCount: Record<string, number> = {};
  stories.forEach(s => {
    const raw = pickMedia(s);
    const t = String(s.media_type || (isVideoUrl(raw) ? 'video' : raw ? 'photo' : 'unknown'));
    typeCount[t] = (typeCount[t] || 0) + 1;
  });
  const typeSlices: Slice[] = Object.keys(typeCount).map((k, i) => ({ label: title(k), value: typeCount[k], color: SERIES[i % SERIES.length] }));

  const spark = days30.map(d => stories.filter(s => String(s.created_at).slice(0, 10) === d).length);
  const dayRows = days30.map(d => ({
    day: d,
    posted: stories.filter(s => String(s.created_at).slice(0, 10) === d).length,
    views: stories.filter(s => String(s.created_at).slice(0, 10) === d).reduce((a, s) => a + (Number(s.views_count) || 0), 0),
  } as Record<string, number | string>));

  const removed = (removedRes.data ?? []) as { id: string; target_id: string; created_at: string }[];

  const cards = [
    { label: 'Stories on file', value: fmt(totalRes.count ?? stories.length), note: 'every row in stories', icon: IC.ring, color: 'var(--c1)', spark },
    { label: 'Live right now', value: fmt(live.length), note: 'not yet expired', icon: IC.clock, color: 'var(--c2)' },
    { label: 'Expired in 24 hours', value: fmt(expired24Res.count ?? 0), note: 'they vanish on their own', icon: IC.clock, color: 'var(--c3)' },
    { label: 'Views recorded', value: fmt(totalViews), note: 'stories.views_count', icon: IC.eye, color: 'var(--c6)' },
    { label: 'People posting', value: fmt(posters), note: fmt(withMedia) + ' stories carry media', icon: IC.users, color: 'var(--c4)' },
  ];

  const rows: DeskRow[] = stories.map(s => {
    const id = String(s.id);
    const uid = String(s.user_id || '');
    const a = people[uid] || { full_name: null, username: null, avatar_url: null, is_verified: false };
    const raw = pickMedia(s);
    const url = raw ? urlMap[raw] || raw : null;
    const video = isVideoUrl(raw) || String(s.media_type || '').toLowerCase().includes('video');
    const caption = String(s.caption || '').trim();
    const expires = String(s.expires_at || '');
    const isLive = expires > nowIso;
    const hoursLeft = isLive ? Math.max(0, Math.round((new Date(expires).getTime() - now) / 3600000)) : 0;
    const views = Number(s.views_count) || 0;
    const kind = video ? 'Video' : raw ? 'Photo' : 'Text';

    const fields = [
      { label: 'Story id', value: id },
      { label: 'Author', value: (a.full_name || 'Unnamed') + ' (@' + (a.username || 'member') + ')' },
      { label: 'Type', value: String(s.media_type || kind) },
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

    const allRaw = pickAllMedia(s);

    return {
      id,
      tabs: [isLive ? 'live' : 'expired', video ? 'video' : raw ? 'photo' : 'text'],
      search: [caption, a.full_name, a.username, s.media_type].map(x => String(x || '').toLowerCase()).join(' '),
      facets: { type: kind, state: isLive ? 'Live' : 'Expired' },
      cells: [
        { t: 'media', v: caption || kind + ' story', sub: '@' + (a.username || 'member'), thumb: url, video },
        { t: 'user', v: a.full_name || 'Unnamed', sub: '@' + (a.username || 'member'), img: a.avatar_url },
        { t: 'pill', v: kind, tone: video ? 'info' : raw ? 'accent' : 'neutral' },
        { t: 'pill', v: isLive ? hoursLeft + 'h left' : 'Expired', tone: (isLive ? 'ok' : 'neutral') as Tone },
        { t: 'mono', v: fmt(views) },
        { t: 'mono', v: ago(String(s.created_at)) },
      ],
      detail: {
        title: caption || kind + ' story',
        subtitle: (a.full_name || 'Unnamed') + ' \u00b7 posted ' + ago(String(s.created_at)),
        img: a.avatar_url,
        media: url ? { url, video } : null,
        pills: [
          { v: kind, tone: video ? 'info' : raw ? 'accent' : 'neutral' },
          { v: isLive ? 'Live, ' + hoursLeft + ' hours left' : 'Expired', tone: (isLive ? 'ok' : 'neutral') as Tone },
          ...(a.is_verified ? [{ v: 'Verified author', tone: 'ok' as Tone }] : []),
        ],
        stats: [
          { label: 'Views', value: fmt(views) },
          { label: 'Media', value: String(allRaw.length) },
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
    { key: 'all', label: 'All stories', count: rows.length },
    { key: 'live', label: 'Live', count: rows.filter(r => r.tabs.includes('live')).length },
    { key: 'expired', label: 'Expired', count: rows.filter(r => r.tabs.includes('expired')).length },
    { key: 'video', label: 'Video', count: rows.filter(r => r.tabs.includes('video')).length },
    { key: 'photo', label: 'Photo', count: rows.filter(r => r.tabs.includes('photo')).length },
  ];

  return (
    <Shell admin={admin} active="/stories" title="Stories" sub="Every story with its real media. Live ones expire on their own, violations go now, and removal is written to the audit log.">
      <StatStrip cards={cards} />

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_336px]">
        <div>
          <Desk
            tabs={tabs}
            columns={[{ label: 'Story' }, { label: 'Author' }, { label: 'Type' }, { label: 'State' }, { label: 'Views', align: 'right' }, { label: 'Posted', align: 'right' }]}
            grid="minmax(220px,2.4fr) minmax(150px,1.3fr) 96px 108px 84px 92px"
            rows={rows}
            filters={[
              { key: 'type', label: 'Type', options: ['Photo', 'Video', 'Text'] },
              { key: 'state', label: 'State', options: ['Live', 'Expired'] },
            ]}
            searchHint="Search captions and authors"
            detailTitle="Story details"
            minWidth={900}
            pageSize={12}
            actions={[{ key: 'remove', label: 'Remove this story now', tone: 'bad', action: adminRemoveStory, idName: 'sid' }]}
          />
        </div>

        <div>
          <div style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>What gets posted</div>
              <div style={H_SUB}>Story type across every row</div>
            </div>
            <div style={{ padding: 16 }}>
              {typeSlices.length === 0 ? <Empty note="No story on file yet." /> : <Donut slices={typeSlices} centerLabel="stories" size={148} />}
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Posting rhythm</div>
              <div style={H_SUB}>Stories posted per day, last 30 days</div>
            </div>
            <div style={{ padding: '18px 16px 14px' }}>
              <StackBars days={dayRows} height={130} series={[{ key: 'posted', label: 'Posted', color: 'var(--c4)' }]} />
            </div>
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}>
              <div style={H_TITLE}>Recently removed</div>
              <div style={H_SUB}>From the audit log, permanent record</div>
            </div>
            {removed.length === 0 ? <Empty note="No story has been removed by this desk." /> : removed.slice(0, 6).map(r => (
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

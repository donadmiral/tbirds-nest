import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import { SeriesChart, Donut, Bars, StackBars, Spark, Empty, type Slice } from '@/components/Viz';
import { fmt } from '@/lib/fmt';
import { pickMedia, resolveMedia, isVideoUrl } from '@/lib/media';

export const dynamic = 'force-dynamic';

const PANEL: React.CSSProperties = { borderRadius: 13, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', overflow: 'hidden' };
const HEAD: React.CSSProperties = { padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' };
const H_TITLE: React.CSSProperties = { fontSize: 13.5, fontWeight: 700, color: 'var(--txt)' };
const H_SUB: React.CSSProperties = { fontSize: 11.3, color: 'rgba(var(--on),0.36)', marginTop: 3 };

type Day = Record<string, number | string>;

function sum(rows: Day[], key: string) { return rows.reduce((a, r) => a + (Number(r[key]) || 0), 0); }

function delta(now: number, before: number): { text: string; fg: string } {
  if (before <= 0) return { text: now > 0 ? 'new' : '-', fg: now > 0 ? 'var(--ok)' : 'rgba(var(--on),0.3)' };
  const pct = ((now - before) / before) * 100;
  const r = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
  return { text: r, fg: pct > 0 ? 'var(--ok)' : pct < 0 ? 'var(--bad)' : 'rgba(var(--on),0.4)' };
}

function weekStart(iso: string) {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export default async function AnalyticsPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();

  const cohortFrom = new Date(Date.now() - 70 * 86400000).toISOString();

  const [daysRes, membersRes, bizRes, verifiedRes, bizVerifiedRes, tierRes, postRes, cohortRes, locRes] = await Promise.all([
    svc.from('daily_stats').select('*').order('day', { ascending: false }).limit(90),
    svc.from('profiles').select('id', { count: 'exact', head: true }),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('account_type', 'business'),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('is_verified', true),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('account_type', 'business').eq('is_verified', true),
    svc.from('profiles').select('verified_tier').eq('is_verified', true).limit(2000),
    svc.from('posts').select('*').order('likes_count', { ascending: false, nullsFirst: false }).limit(12),
    svc.from('profiles').select('created_at, last_seen').gte('created_at', cohortFrom).limit(5000),
    svc.from('profiles').select('location').not('location', 'is', null).limit(5000),
  ]);

  const desc = (daysRes.data ?? []) as Day[];
  const rows = [...desc].reverse();
  const last30 = rows.slice(-30);
  const last7 = desc.slice(0, 7);
  const prev7 = desc.slice(7, 14);

  const members = membersRes.count ?? 0;
  const businesses = bizRes.count ?? 0;
  const verified = verifiedRes.count ?? 0;
  const bizVerified = bizVerifiedRes.count ?? 0;
  const bizPlain = Math.max(0, businesses - bizVerified);

  const series30 = (key: string) => last30.map(r => Number(r[key]) || 0);
  const kpis = [
    { label: 'Daily actives, 7 day average', value: last7.length ? Math.round(sum(last7, 'dau') / last7.length) : 0, prev: prev7.length ? Math.round(sum(prev7, 'dau') / prev7.length) : 0, key: 'dau', color: 'var(--c1)' },
    { label: 'Signups this week', value: sum(last7, 'new_signups'), prev: sum(prev7, 'new_signups'), key: 'new_signups', color: 'var(--c2)' },
    { label: 'Posts this week', value: sum(last7, 'posts'), prev: sum(prev7, 'posts'), key: 'posts', color: 'var(--c3)' },
    { label: 'Stories this week', value: sum(last7, 'stories'), prev: sum(prev7, 'stories'), key: 'stories', color: 'var(--c4)' },
    { label: 'Messages this week', value: sum(last7, 'messages'), prev: sum(prev7, 'messages'), key: 'messages', color: 'var(--c6)' },
    { label: 'Likes this week', value: sum(last7, 'likes'), prev: sum(prev7, 'likes'), key: 'likes', color: 'var(--c5)' },
  ];

  const MIX: { key: string; label: string; color: string }[] = [
    { key: 'likes', label: 'Likes', color: 'var(--c5)' },
    { key: 'messages', label: 'Messages', color: 'var(--c6)' },
    { key: 'comments', label: 'Comments', color: 'var(--c1)' },
    { key: 'stories', label: 'Stories', color: 'var(--c4)' },
    { key: 'posts', label: 'Posts', color: 'var(--c3)' },
    { key: 'listings', label: 'Listings', color: 'var(--c2)' },
    { key: 'jobs', label: 'Jobs', color: 'var(--pearl)' },
  ];
  const mixSlices: Slice[] = MIX.map(m => ({ label: m.label, value: sum(last30, m.key), color: m.color })).filter(s => s.value > 0);

  const memberSlices: Slice[] = [
    { label: 'Verified members', value: verified, color: 'var(--c1)' },
    { label: 'Business, not verified', value: bizPlain, color: 'var(--c2)' },
    { label: 'Everyone else', value: Math.max(0, members - verified - bizPlain), color: 'rgba(var(--on),0.16)' },
  ].filter(s => s.value > 0);

  const tierCount: Record<string, number> = {};
  (tierRes.data ?? []).forEach((r: { verified_tier: string | null }) => { const k = r.verified_tier || 'unrecorded'; tierCount[k] = (tierCount[k] || 0) + 1; });
  const TIER_LABEL: Record<string, string> = { public_figure: 'Green seal', business: 'Space grey seal', official: 'Platinum seal', unrecorded: 'Tier not recorded' };
  const TIER_COLOR: Record<string, string> = { public_figure: 'var(--ok)', business: 'rgba(var(--on),0.34)', official: 'var(--pearl)', unrecorded: 'rgba(var(--on),0.16)' };
  const tierSlices: Slice[] = Object.keys(tierCount).map(k => ({ label: TIER_LABEL[k] || k, value: tierCount[k], color: TIER_COLOR[k] || 'var(--c4)' }));

  const ACTION_KEYS = ['posts', 'comments', 'likes', 'messages', 'stories', 'listings', 'jobs'];
  const totalOf = (r: Day) => ACTION_KEYS.reduce((a, k) => a + (Number(r[k]) || 0), 0);
  const peak = last30.reduce<{ day: string; n: number } | null>((best, r) => {
    const n = totalOf(r);
    return !best || n > best.n ? { day: String(r.day), n } : best;
  }, null);
  const bestSignup = last30.reduce<{ day: string; n: number } | null>((best, r) => {
    const n = Number(r.new_signups) || 0;
    return !best || n > best.n ? { day: String(r.day), n } : best;
  }, null);
  const quietDays = last30.filter(r => totalOf(r) === 0).length;
  const actionsNow = sum(last7, 'likes') + sum(last7, 'comments') + sum(last7, 'messages') + sum(last7, 'posts') + sum(last7, 'stories');
  const actionsPrev = sum(prev7, 'likes') + sum(prev7, 'comments') + sum(prev7, 'messages') + sum(prev7, 'posts') + sum(prev7, 'stories');
  const actionsDelta = delta(actionsNow, actionsPrev);

  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekdayTotals = WEEKDAYS.map(() => 0);
  last30.forEach(r => {
    const idx = (new Date(String(r.day) + 'T00:00:00Z').getUTCDay() + 6) % 7;
    weekdayTotals[idx] += totalOf(r);
  });

  const postsRaw = (postRes.data ?? []) as Record<string, unknown>[];
  const posts = postsRaw.map(p => ({
    id: String(p.id), content: (p.content as string | null) ?? (p.body as string | null) ?? null,
    user_id: String(p.user_id), created_at: String(p.created_at),
    likes_count: Number(p.likes_count) || 0, comments_count: Number(p.comments_count) || 0, shares_count: Number(p.shares_count) || 0,
    raw: p,
  }));
  const postIds = posts.map(p => p.id);
  const mediaByPost: Record<string, string> = {};
  if (postIds.length) {
    const { data: pm } = await svc.from('post_media').select('post_id, url, sort_order').in('post_id', postIds).order('sort_order', { ascending: true });
    ((pm ?? []) as { post_id: string; url: string }[]).forEach(m => { if (!mediaByPost[m.post_id]) mediaByPost[m.post_id] = m.url; });
  }
  posts.forEach(p => { if (!mediaByPost[p.id]) { const f = pickMedia(p.raw); if (f) mediaByPost[p.id] = f; } });
  const postUrlMap = await resolveMedia(Object.values(mediaByPost));

  const authorIds = Array.from(new Set(posts.map(p => p.user_id)));
  const authors: Record<string, { full_name: string | null; username: string | null; avatar_url: string | null }> = {};
  if (authorIds.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username, avatar_url').in('id', authorIds);
    (data ?? []).forEach((p: { id: string; full_name: string | null; username: string | null; avatar_url: string | null }) => { authors[p.id] = p; });
  }
  const topPosts = posts
    .map(p => ({ ...p, score: (p.likes_count || 0) + (p.comments_count || 0) + (p.shares_count || 0) }))
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  const cohortRaw = (cohortRes.data ?? []) as { created_at: string; last_seen: string | null }[];
  const cohortMap: Record<string, { size: number; kept: number[] }> = {};
  cohortRaw.forEach(p => {
    const w = weekStart(p.created_at);
    if (!cohortMap[w]) cohortMap[w] = { size: 0, kept: [0, 0, 0, 0] };
    const c = cohortMap[w];
    c.size += 1;
    if (p.last_seen) {
      const livedDays = (new Date(p.last_seen).getTime() - new Date(p.created_at).getTime()) / 86400000;
      [7, 14, 21, 28].forEach((mark, i) => { if (livedDays >= mark) c.kept[i] += 1; });
    }
  });
  const cohorts = Object.keys(cohortMap).sort().reverse().map(w => {
    const ageDays = (Date.now() - new Date(w).getTime()) / 86400000;
    return { week: w, size: cohortMap[w].size, kept: cohortMap[w].kept, ageDays };
  });

  const locBuckets: Record<string, { label: string; n: number }> = {};
  (locRes.data ?? []).forEach((r: { location: string | null }) => {
    const raw = (r.location || '').replace(/\s+/g, ' ').trim();
    if (!raw) return;
    const key = raw.toLowerCase();
    if (!locBuckets[key]) locBuckets[key] = { label: raw, n: 0 };
    locBuckets[key].n += 1;
  });
  const located = Object.values(locBuckets).reduce((a, b) => a + b.n, 0);
  const topLocations = Object.values(locBuckets).sort((a, b) => b.n - a.n).slice(0, 8);
  const locMax = Math.max(1, ...topLocations.map(l => l.n));
  const noLocation = Math.max(0, members - located);

  const maxDau = Math.max(1, ...desc.map(r => Number(r.dau) || 0));

  return (
    <Shell admin={admin} active="/analytics" title="Analytics" sub="Every figure below is computed from daily_stats, profiles and posts. Nothing on this desk is estimated or filled in.">

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {kpis.map(k => {
          const d = delta(k.value, k.prev);
          return (
            <div key={k.label} style={{ ...PANEL, padding: '14px 15px 12px' }}>
              <div style={{ fontSize: 11.3, fontWeight: 600, color: 'rgba(var(--on),0.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.label}</div>
              <div className="pc-num" style={{ marginTop: 9, fontSize: 26, lineHeight: 1, color: 'var(--txt-strong)' }}>{fmt(k.value)}</div>
              <div style={{ marginTop: 9, display: 'flex', alignItems: 'baseline', gap: 7 }}>
                <span className="pc-num" style={{ fontSize: 10.5, fontWeight: 600, color: d.fg }}>{d.text}</span>
                <span style={{ fontSize: 10, color: 'rgba(var(--on),0.3)' }}>vs prior 7 days</span>
              </div>
              <div style={{ marginTop: 9 }}><Spark values={series30(k.key)} color={k.color} height={22} /></div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_320px]">
        <div style={PANEL}>
          <div style={HEAD}>
            <div style={H_TITLE}>Platform activity</div>
            <div style={H_SUB}>Every recorded action over time. Click a series to fold it away.</div>
          </div>
          <div style={{ padding: '16px 16px 14px' }}>
            <SeriesChart rows={rows} series={[
              { key: 'dau', label: 'Active users', color: 'var(--c1)' },
              { key: 'posts', label: 'Posts', color: 'var(--c3)' },
              { key: 'stories', label: 'Stories', color: 'var(--c4)' },
              { key: 'messages', label: 'Messages', color: 'var(--c6)' },
              { key: 'likes', label: 'Likes', color: 'var(--c5)' },
              { key: 'comments', label: 'Comments', color: 'var(--c2)' },
            ]} />
          </div>
        </div>

        <div style={PANEL}>
          <div style={HEAD}>
            <div style={H_TITLE}>What the data says</div>
            <div style={H_SUB}>Read off the last 30 days, not written by hand.</div>
          </div>
          <div style={{ padding: '4px 16px 14px' }}>
            {peak && peak.n > 0 ? (
              <Insight title="Busiest day" body={new Date(peak.day + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) + ' carried ' + fmt(peak.n) + ' recorded actions.'} />
            ) : null}
            {bestSignup && bestSignup.n > 0 ? (
              <Insight title="Strongest signup day" body={fmt(bestSignup.n) + ' joined on ' + new Date(bestSignup.day + 'T00:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) + '.'} />
            ) : null}
            <Insight title="Week on week" body={actionsPrev > 0 ? 'Actions moved ' + actionsDelta.text + ' against the prior seven days.' : 'Not enough prior history yet to compare weeks.'} fg={actionsPrev > 0 ? actionsDelta.fg : undefined} />
            <Insight title="Silence" body={quietDays + ' of the last ' + last30.length + ' days recorded no activity at all.'} />
            {peak && peak.n === 0 ? <Insight title="Nothing yet" body="daily_stats has rows but every action column is zero for this window." /> : null}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div style={PANEL}>
          <div style={HEAD}>
            <div style={H_TITLE}>What people actually do</div>
            <div style={H_SUB}>Share of every recorded action, last 30 days</div>
          </div>
          <div style={{ padding: 16 }}>
            <Donut slices={mixSlices} centerLabel="recorded actions" />
          </div>
        </div>

        <div style={PANEL}>
          <div style={HEAD}>
            <div style={H_TITLE}>Rhythm of the week</div>
            <div style={H_SUB}>Actions by weekday, last 30 days</div>
          </div>
          <div style={{ padding: 16 }}>
            {weekdayTotals.some(v => v > 0)
              ? <Bars items={WEEKDAYS.map((w, i) => ({ label: w, value: weekdayTotals[i] }))} />
              : <Empty note="No actions recorded in the last 30 days." />}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_360px]">
        <div style={PANEL}>
          <div style={HEAD}>
            <div style={H_TITLE}>What gets made</div>
            <div style={H_SUB}>Posts, stories, listings and jobs stacked by day</div>
          </div>
          <div style={{ padding: '18px 16px 14px' }}>
            <StackBars days={last30} series={[
              { key: 'posts', label: 'Posts', color: 'var(--c3)' },
              { key: 'stories', label: 'Stories', color: 'var(--c4)' },
              { key: 'listings', label: 'Listings', color: 'var(--c2)' },
              { key: 'jobs', label: 'Jobs', color: 'var(--pearl)' },
            ]} />
          </div>
        </div>

        <div style={PANEL}>
          <div style={HEAD}>
            <div style={H_TITLE}>Who is here</div>
            <div style={H_SUB}>{fmt(members)} profiles, counted now</div>
          </div>
          <div style={{ padding: 16 }}>
            <Donut slices={memberSlices} centerLabel="members" size={148} />
            {tierSlices.length ? (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(var(--on),0.10)' }}>
                <div style={{ fontSize: 11.3, fontWeight: 600, color: 'rgba(var(--on),0.5)', marginBottom: 10 }}>Verified by seal</div>
                {tierSlices.map(t => (
                  <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 0' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.color, flex: '0 0 8px' }} />
                    <span style={{ flex: 1, fontSize: 11.8, color: 'rgba(var(--on),0.62)' }}>{t.label}</span>
                    <span className="pc-num" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--txt)' }}>{t.value}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <div style={PANEL}>
          <div style={HEAD}>
            <div style={H_TITLE}>Where members are</div>
            <div style={H_SUB}>profiles.location, exactly as members typed it, grouped without case</div>
          </div>
          <div style={{ padding: 16 }}>
            {topLocations.length === 0 ? <Empty note="No member has set a location yet." /> : (
              <div>
                {topLocations.map(l => (
                  <div key={l.label} style={{ marginBottom: 11 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 5 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.label}</span>
                      <span className="pc-num" style={{ fontSize: 11.4, fontWeight: 600, color: 'var(--txt)' }}>{l.n}</span>
                      <span className="pc-num" style={{ fontSize: 10.5, color: 'rgba(var(--on),0.34)', width: 44, textAlign: 'right' }}>{located ? ((l.n / located) * 100).toFixed(1) + '%' : '-'}</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 4, background: 'rgba(var(--on),0.06)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: Math.max(2, (l.n / locMax) * 100) + '%', borderRadius: 4, background: 'var(--c1)' }} />
                    </div>
                  </div>
                ))}
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(var(--on),0.10)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 11.4, color: 'rgba(var(--on),0.42)' }}>Profiles with no location set</span>
                  <span className="pc-num" style={{ fontSize: 11.6, fontWeight: 600, color: 'var(--txt)' }}>{fmt(noLocation)}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={PANEL}>
          <div style={HEAD}>
            <div style={H_TITLE}>Top content by engagement</div>
            <div style={H_SUB}>Real likes, comments and shares from the posts table</div>
          </div>
          {topPosts.length === 0 ? <Empty note="No post has drawn engagement yet." /> : topPosts.map(p => {
            const a = authors[p.user_id];
            const rawUrl = mediaByPost[p.id];
            const url = rawUrl ? postUrlMap[rawUrl] || rawUrl : null;
            const video = isVideoUrl(rawUrl);
            return (
              <Link key={p.id} href={'/p/' + p.id} className="pc-nav" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 16px', borderBottom: '1px solid rgba(var(--on),0.10)', textDecoration: 'none' }}>
                <span style={{ width: 40, height: 40, flex: '0 0 40px', borderRadius: 9, overflow: 'hidden', background: 'rgba(var(--on),0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                  {url
                    ? (video
                      ? <video src={url} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)
                    : (a?.avatar_url
                      ? <img src={a.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <svg width="15" height="15" viewBox="0 0 24 24" style={{ fill: 'rgba(var(--on),0.24)' }}><path d="M4 4h16v12H5.2L4 17.2V4zm2 3h12v2H6V7zm0 4h8v2H6v-2z" /></svg>)}
                  {video && url ? (
                    <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.28)' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" style={{ fill: '#fff' }}><path d="M8 5v14l11-7z" /></svg>
                    </span>
                  ) : null}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.3, fontWeight: 600, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.content || 'Media post'}</div>
                  <div style={{ fontSize: 10.6, color: 'rgba(var(--on),0.36)', marginTop: 3 }}>{a ? '@' + (a.username || 'member') : 'unknown author'}</div>
                </div>
                <div className="pc-num" style={{ display: 'flex', gap: 12, flex: '0 0 auto', fontSize: 11, color: 'rgba(var(--on),0.5)' }}>
                  <span>{fmt(p.likes_count || 0)} likes</span>
                  <span>{fmt(p.comments_count || 0)} comments</span>
                  <span>{fmt(p.shares_count || 0)} shares</span>
                </div>
              </Link>
            );
          })}
        </div>

        <div style={PANEL}>
          <div style={HEAD}>
            <div style={H_TITLE}>Do they stay</div>
            <div style={H_SUB}>Each signup week, and the share still being seen a week, two, three and four weeks later. Blank means that cohort is not old enough to answer yet.</div>
          </div>
          {cohorts.length === 0 ? <Empty note="No signups in the last ten weeks." /> : (
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 430 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '128px 62px 1fr 1fr 1fr 1fr', padding: '0 16px', borderBottom: '1px solid rgba(var(--on),0.10)', background: 'rgba(var(--on),0.015)' }}>
                  {['Signup week', 'Joined', 'Week 1', 'Week 2', 'Week 3', 'Week 4'].map((c, i) => (
                    <div key={c} style={{ padding: '9px 6px', fontSize: 10.3, fontWeight: 700, color: 'rgba(var(--on),0.36)', textAlign: i > 1 ? 'right' : 'left', whiteSpace: 'nowrap' }}>{c}</div>
                  ))}
                </div>
                {cohorts.map(c => (
                  <div key={c.week} style={{ display: 'grid', gridTemplateColumns: '128px 62px 1fr 1fr 1fr 1fr', padding: '0 16px', borderBottom: '1px solid rgba(var(--on),0.10)' }}>
                    <div style={{ padding: '10px 6px', fontSize: 11.8, color: 'rgba(var(--on),0.62)' }}>{new Date(c.week + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
                    <div className="pc-num" style={{ padding: '10px 6px', fontSize: 11.8, color: 'var(--txt)' }}>{c.size}</div>
                    {[7, 14, 21, 28].map((mark, i) => {
                      const ready = c.ageDays >= mark;
                      const pct = c.size ? Math.round((c.kept[i] / c.size) * 100) : 0;
                      return (
                        <div key={mark} className="pc-num" style={{ padding: '10px 6px', fontSize: 11.8, textAlign: 'right', color: ready ? (pct > 0 ? 'var(--txt)' : 'rgba(var(--on),0.3)') : 'rgba(var(--on),0.18)', background: ready && pct > 0 ? 'rgba(var(--ok-rgb),' + (0.06 + (pct / 100) * 0.16).toFixed(3) + ')' : 'transparent' }}>
                          {ready ? pct + '%' : '-'}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4" style={PANEL}>
        <div style={HEAD}>
          <div style={H_TITLE}>Every recorded day</div>
          <div style={H_SUB}>daily_stats, newest first</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 900 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 72px 72px 82px 72px 82px 72px 76px 62px', padding: '0 16px', borderBottom: '1px solid rgba(var(--on),0.10)', background: 'rgba(var(--on),0.015)' }}>
              {['Day', 'Actives', 'Signups', 'Posts', 'Comments', 'Likes', 'Messages', 'Stories', 'Listings', 'Jobs'].map((c, i) => (
                <div key={c} style={{ padding: '9px 8px', fontSize: 10.3, fontWeight: 700, color: 'rgba(var(--on),0.36)', textAlign: i > 1 ? 'right' : 'left', whiteSpace: 'nowrap' }}>{c}</div>
              ))}
            </div>
            {desc.length === 0 ? <Empty note="The first nightly computation lands after midnight." /> : desc.map(r => (
              <div key={String(r.day)} className="pc-nav" style={{ display: 'grid', gridTemplateColumns: '110px 1fr 72px 72px 82px 72px 82px 72px 76px 62px', padding: '0 16px', borderBottom: '1px solid rgba(var(--on),0.10)' }}>
                <div className="pc-num" style={{ padding: '9px 8px', fontSize: 11.6, color: 'rgba(var(--on),0.55)' }}>{String(r.day)}</div>
                <div style={{ padding: '9px 8px', display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                  <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'rgba(var(--on),0.06)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: Math.max(2, Math.round(((Number(r.dau) || 0) / maxDau) * 100)) + '%', background: 'var(--c1)', borderRadius: 4 }} />
                  </div>
                  <span className="pc-num" style={{ width: 30, flex: '0 0 30px', fontSize: 11.8, fontWeight: 600, color: 'var(--txt)' }}>{Number(r.dau) || 0}</span>
                </div>
                {['new_signups', 'posts', 'comments', 'likes', 'messages', 'stories', 'listings', 'jobs'].map(k => (
                  <div key={k} className="pc-num" style={{ padding: '9px 8px', fontSize: 11.6, textAlign: 'right', color: (Number(r[k]) || 0) > 0 ? 'var(--txt)' : 'rgba(var(--on),0.22)' }}>{Number(r[k]) || 0}</div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Insight({ title, body, fg }: { title: string; body: string; fg?: string }) {
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid rgba(var(--on),0.08)' }}>
      <div style={{ fontSize: 11.8, fontWeight: 700, color: fg || 'var(--txt)' }}>{title}</div>
      <div style={{ fontSize: 11.6, color: 'rgba(var(--on),0.48)', marginTop: 4, lineHeight: 1.45 }}>{body}</div>
    </div>
  );
}

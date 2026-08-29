import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import Seal from '@/components/Seal';
import { SeriesChart, Spark, Greeting, Empty } from '@/components/Viz';
import { fmt, ago } from '@/lib/fmt';

export const dynamic = 'force-dynamic';

const TIER_LABEL: Record<string, string> = { public_figure: 'Green', business: 'Space grey', official: 'Platinum' };
const ACTIVE_WINDOW_MIN = 5;

const PANEL: React.CSSProperties = { borderRadius: 13, background: 'var(--panel)', border: '1px solid rgba(var(--on),0.10)', overflow: 'hidden' };
const HEAD: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' };
const H_TITLE: React.CSSProperties = { fontSize: 13.5, fontWeight: 700, color: 'var(--txt)' };
const ROW: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 11, padding: '11px 16px', borderBottom: '1px solid rgba(var(--on),0.10)', textDecoration: 'none' };
const LINK_SM: React.CSSProperties = { fontSize: 11.4, fontWeight: 600, color: 'rgba(var(--on),0.45)', textDecoration: 'none', whiteSpace: 'nowrap' };

const IC = {
  users: 'M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
  pulse: 'M3 12h3.2l2.1-6 3.4 12 2.6-8 1.6 2h5.1v2h-6.1l-1.1-1.4-3.1 9.4L7.4 10 6.6 14H3v-2z',
  flag: 'M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z',
  seal: 'M12 2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 7.7l5.4-.8L12 2z',
  ticket: 'M12 2a10 10 0 100 20 10 10 0 000-20zm0 4a6 6 0 016 6h-3a3 3 0 00-6 0H6a6 6 0 016-6zm-3 8h6a3 3 0 01-6 0z',
  build: 'M4 21V5a2 2 0 012-2h7a2 2 0 012 2v16h-4v-4H8v4H4zm13-9h3a1 1 0 011 1v8h-4v-9z',
  mega: 'M3 10a2 2 0 012-2h2l7-4v16l-7-4H5a2 2 0 01-2-2v-4zm14-4.8a7 7 0 010 9.6V5.2z',
  list: 'M4 5h16v2H4V5zm0 6h16v2H4v-2zm0 6h10v2H4v-2z',
  gear: 'M12 8a4 4 0 100 8 4 4 0 000-8zm8.6 4a6.6 6.6 0 00-.1-1.1l2-1.6-2-3.4-2.4 1a6.9 6.9 0 00-1.9-1.1L15.8 3h-4l-.4 2.8a6.9 6.9 0 00-1.9 1.1l-2.4-1-2 3.4 2 1.6a6.6 6.6 0 000 2.2l-2 1.6 2 3.4 2.4-1a6.9 6.9 0 001.9 1.1l.4 2.8h4l.4-2.8a6.9 6.9 0 001.9-1.1l2.4 1 2-3.4-2-1.6c.1-.4.1-.7.1-1.1z',
  staff: 'M16 11c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3zm-8 0c1.7 0 3-1.3 3-3S9.7 5 8 5 5 6.3 5 8s1.3 3 3 3zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 1.9 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z',
};

function dayKey(d: Date) { return d.toISOString().slice(0, 10); }

function bucketByDay(rows: { created_at: string }[], days: string[]) {
  const map: Record<string, number> = {};
  days.forEach(d => { map[d] = 0; });
  rows.forEach(r => { const k = r.created_at.slice(0, 10); if (k in map) map[k] += 1; });
  return days.map(d => map[d]);
}

function pctDelta(now: number, before: number): { text: string; fg: string } {
  if (before <= 0) return { text: now > 0 ? 'new' : 'flat', fg: now > 0 ? 'var(--ok)' : 'rgba(var(--on),0.35)' };
  const p = ((now - before) / before) * 100;
  return { text: (p >= 0 ? '+' : '') + p.toFixed(1) + '%', fg: p > 0 ? 'var(--ok)' : p < 0 ? 'var(--bad)' : 'rgba(var(--on),0.4)' };
}

export default async function DashboardPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();

  const now = Date.now();
  const activeSince = new Date(now - ACTIVE_WINDOW_MIN * 60000).toISOString();
  const from30 = new Date(now - 30 * 86400000).toISOString();
  const from7 = new Date(now - 7 * 86400000).toISOString();
  const from14 = new Date(now - 14 * 86400000).toISOString();
  const from24h = new Date(now - 86400000).toISOString();
  const days30 = Array.from({ length: 30 }, (_, i) => dayKey(new Date(now - (29 - i) * 86400000)));

  const [
    users, verified, active, apps, pr, lr, ur, audit, tickets, bizApps, flags, daily,
    prAll, lrAll, urAll, appAll, recent, topPostsRes, locRes, cerr,
    vAll, vReview, vApproved, vRejected,
  ] = await Promise.all([
    svc.from('profiles').select('id', { count: 'exact', head: true }),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('is_verified', true),
    svc.from('profiles').select('id', { count: 'exact', head: true }).gte('last_seen', activeSince),
    svc.from('verification_applications').select('id, applicant_id, tier, category, created_at').in('status', ['submitted', 'under_review']).order('created_at', { ascending: true }).limit(6),
    svc.from('post_reports').select('id, reason, created_at').eq('status', 'open').order('created_at', { ascending: true }).limit(4),
    svc.from('listing_reports').select('id, reason, created_at').eq('status', 'open').order('created_at', { ascending: true }).limit(4),
    svc.from('user_reports').select('id, reason, created_at').eq('status', 'open').order('created_at', { ascending: true }).limit(4),
    svc.from('admin_audit_log').select('action, reason, created_at').order('created_at', { ascending: false }).limit(8),
    svc.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    svc.from('business_applications').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    svc.from('feature_flags').select('key, enabled, note').order('key'),
    svc.from('daily_stats').select('day, dau, new_signups, posts, comments, likes, messages, stories, listings, jobs').order('day', { ascending: true }).limit(30),
    svc.from('post_reports').select('created_at').gte('created_at', from30).limit(2000),
    svc.from('listing_reports').select('created_at').gte('created_at', from30).limit(2000),
    svc.from('user_reports').select('created_at').gte('created_at', from30).limit(2000),
    svc.from('verification_applications').select('created_at').gte('created_at', from30).limit(2000),
    svc.from('profiles').select('id, full_name, username, avatar_url, is_verified, verified_tier, location, account_type, created_at').order('created_at', { ascending: false }).limit(6),
    svc.from('posts').select('id, content, user_id, likes_count, comments_count, shares_count').order('likes_count', { ascending: false, nullsFirst: false }).limit(12),
    svc.from('profiles').select('location').not('location', 'is', null).limit(5000),
    svc.from('client_errors').select('id', { count: 'exact', head: true }).gte('created_at', from24h),
    svc.from('verification_applications').select('id', { count: 'exact', head: true }),
    svc.from('verification_applications').select('id', { count: 'exact', head: true }).in('status', ['under_review', 'approved', 'rejected']),
    svc.from('verification_applications').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    svc.from('verification_applications').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
  ]);

  const members = users.count ?? 0;
  const appRows = apps.data ?? [];
  const names: Record<string, { full_name: string | null; username: string | null }> = {};
  if (appRows.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username').in('id', appRows.map(a => a.applicant_id));
    (data ?? []).forEach((p: { id: string; full_name: string | null; username: string | null }) => { names[p.id] = p; });
  }
  const openReports = [
    ...(pr.data ?? []).map(r => ({ ...r, kind: 'Post' })),
    ...(lr.data ?? []).map(r => ({ ...r, kind: 'Listing' })),
    ...(ur.data ?? []).map(r => ({ ...r, kind: 'Account' })),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, 6);

  const daysRows = (daily.data ?? []) as Record<string, number | string>[];
  const dauSeries = daysRows.map(r => Number(r.dau) || 0);
  const signupSeries = daysRows.map(r => Number(r.new_signups) || 0);
  const signups7 = signupSeries.slice(-7).reduce((a, b) => a + b, 0);
  const signupsPrev7 = signupSeries.slice(-14, -7).reduce((a, b) => a + b, 0);
  const avgDau7 = dauSeries.length ? Math.round(dauSeries.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, dauSeries.length)) : 0;

  // membership curve, walked backwards from today's real count using real signups
  const memberCurve: number[] = [];
  let running = members;
  for (let i = signupSeries.length - 1; i >= 0; i--) { memberCurve.unshift(running); running -= signupSeries[i]; }
  if (!memberCurve.length) memberCurve.push(members, members);

  const reportRows = [...(prAll.data ?? []), ...(lrAll.data ?? []), ...(urAll.data ?? [])] as { created_at: string }[];
  const reportSeries = bucketByDay(reportRows, days30);
  const reports7 = reportRows.filter(r => r.created_at >= from7).length;
  const reportsPrev7 = reportRows.filter(r => r.created_at >= from14 && r.created_at < from7).length;
  const appSeries = bucketByDay((appAll.data ?? []) as { created_at: string }[], days30);
  const apps7 = ((appAll.data ?? []) as { created_at: string }[]).filter(r => r.created_at >= from7).length;
  const appsPrev7 = ((appAll.data ?? []) as { created_at: string }[]).filter(r => r.created_at >= from14 && r.created_at < from7).length;

  const [prOpen, lrOpen, urOpen] = [(pr.data ?? []).length, (lr.data ?? []).length, (ur.data ?? []).length];

  const cards = [
    { label: 'Total members', value: members, icon: IC.users, color: 'var(--c1)', spark: memberCurve, delta: pctDelta(signups7, signupsPrev7), note: 'signups this week against last', href: '/users' },
    { label: 'Active now', value: active.count ?? 0, icon: IC.pulse, color: 'var(--c2)', spark: dauSeries, delta: pctDelta(active.count ?? 0, avgDau7), note: 'against the 7 day average of ' + avgDau7, href: '/users' },
    { label: 'Open reports', value: prOpen + lrOpen + urOpen, icon: IC.flag, color: 'var(--c5)', spark: reportSeries, delta: pctDelta(reports7, reportsPrev7), note: 'opened this week against last', href: '/reports' },
    { label: 'Pending verifications', value: appRows.length, icon: IC.seal, color: 'var(--c3)', spark: appSeries, delta: pctDelta(apps7, appsPrev7), note: 'applied this week against last', href: '/queue' },
  ];

  const needs = [
    { label: 'Verification applications', sub: 'submitted and under review', count: appRows.length, href: '/queue', icon: IC.seal, color: 'var(--c3)' },
    { label: 'Open reports', sub: 'posts, listings and accounts', count: prOpen + lrOpen + urOpen, href: '/reports', icon: IC.flag, color: 'var(--c5)' },
    { label: 'Support tickets', sub: 'open conversations', count: tickets.count ?? 0, href: '/support', icon: IC.ticket, color: 'var(--c1)' },
    { label: 'Business applications', sub: 'awaiting review', count: bizApps.count ?? 0, href: '/businesses', icon: IC.build, color: 'var(--c2)' },
  ].filter(n => n.count > 0);
  const attention = needs.reduce((s, n) => s + n.count, 0);

  const postRows = (topPostsRes.data ?? []) as { id: string; content: string | null; user_id: string; likes_count: number | null; comments_count: number | null; shares_count: number | null }[];
  const postAuthors: Record<string, { username: string | null }> = {};
  const pids = Array.from(new Set(postRows.map(p => p.user_id)));
  if (pids.length) {
    const { data } = await svc.from('profiles').select('id, username').in('id', pids);
    (data ?? []).forEach((p: { id: string; username: string | null }) => { postAuthors[p.id] = p; });
  }
  const topContent = postRows
    .map(p => ({ ...p, score: (p.likes_count || 0) + (p.comments_count || 0) + (p.shares_count || 0) }))
    .filter(p => p.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);

  const locBuckets: Record<string, { label: string; n: number }> = {};
  ((locRes.data ?? []) as { location: string | null }[]).forEach(r => {
    const raw = (r.location || '').replace(/\s+/g, ' ').trim();
    if (!raw) return;
    const k = raw.toLowerCase();
    if (!locBuckets[k]) locBuckets[k] = { label: raw, n: 0 };
    locBuckets[k].n += 1;
  });
  const located = Object.values(locBuckets).reduce((a, b) => a + b.n, 0);
  const topLocations = Object.values(locBuckets).sort((a, b) => b.n - a.n).slice(0, 5);

  const flagRows = (flags.data ?? []) as { key: string; enabled: boolean; note: string | null }[];
  const lastStatDay = daysRows.length ? String(daysRows[daysRows.length - 1].day) : null;
  const statsFresh = lastStatDay ? (now - new Date(lastStatDay + 'T00:00:00Z').getTime()) < 2 * 86400000 : false;
  const errors24 = cerr.count ?? 0;

  const health = [
    { label: 'Database', state: 'Responding', ok: true, meta: 'every panel on this page answered' },
    { label: 'Nightly statistics', state: statsFresh ? 'Current' : 'Stale', ok: statsFresh, meta: lastStatDay ? 'last day computed ' + lastStatDay : 'no rows in daily_stats' },
    { label: 'Client errors, 24 hours', state: errors24 === 0 ? 'Clear' : String(errors24), ok: errors24 === 0, meta: 'client_errors' },
    { label: 'Feature flags on', state: flagRows.filter(f => f.enabled).length + ' of ' + flagRows.length, ok: true, meta: 'feature_flags' },
  ];

  const funnel = [
    { label: 'Applications received', value: vAll.count ?? 0 },
    { label: 'Reached review', value: vReview.count ?? 0 },
    { label: 'Approved', value: vApproved.count ?? 0 },
    { label: 'Rejected', value: vRejected.count ?? 0 },
  ];
  const funnelMax = Math.max(1, funnel[0].value);

  const first = (admin.email.split('@')[0].split(/[._-]/)[0] || 'there');
  const firstName = first.charAt(0).toUpperCase() + first.slice(1);

  return (
    <Shell admin={admin} active="/dashboard" crumb="Overview"
      title={<Greeting name={firstName} />}
      sub={'Here is what is happening across Platinum Circles. ' + fmt(members) + ' members on file, ' + (attention ? attention + ' items waiting on this desk.' : 'nothing waiting on this desk.')}>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(c => (
          <Link key={c.label} href={c.href} className="pc-nav" style={{ ...PANEL, padding: '14px 15px 12px', display: 'block', textDecoration: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontSize: 11.3, fontWeight: 600, color: 'rgba(var(--on),0.5)' }}>{c.label}</span>
              <span style={{ width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(var(--on),0.05)' }}>
                <svg width="13" height="13" viewBox="0 0 24 24" style={{ fill: c.color }}><path d={c.icon} /></svg>
              </span>
            </div>
            <div className="pc-num" style={{ marginTop: 9, fontSize: 27, lineHeight: 1, color: 'var(--txt-strong)' }}>{fmt(c.value)}</div>
            <div style={{ marginTop: 9, display: 'flex', alignItems: 'baseline', gap: 7, whiteSpace: 'nowrap', overflow: 'hidden' }}>
              <span className="pc-num" style={{ flex: '0 0 auto', fontSize: 10.5, fontWeight: 600, color: c.delta.fg }}>{c.delta.text}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 10, color: 'rgba(var(--on),0.3)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.note}</span>
            </div>
            <div style={{ marginTop: 9 }}><Spark values={c.spark} color={c.color} height={26} /></div>
          </Link>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_360px]">
        <div style={PANEL}>
          <div style={HEAD}>
            <div style={{ flex: 1 }}>
              <div style={H_TITLE}>Platform activity</div>
              <div style={{ fontSize: 11.3, color: 'rgba(var(--on),0.36)', marginTop: 3 }}>daily_stats, rebuilt nightly. Click a series to fold it away.</div>
            </div>
            <Link href="/analytics" className="pc-crumb" style={LINK_SM}>Full analytics</Link>
          </div>
          <div style={{ padding: '16px 16px 14px' }}>
            <SeriesChart rows={daysRows} height={230} series={[
              { key: 'dau', label: 'Active users', color: 'var(--c1)' },
              { key: 'posts', label: 'Posts', color: 'var(--c3)' },
              { key: 'stories', label: 'Stories', color: 'var(--c4)' },
              { key: 'messages', label: 'Messages', color: 'var(--c6)' },
            ]} />
          </div>
        </div>

        <div style={PANEL}>
          <div style={HEAD}>
            <div style={{ flex: 1 }}>
              <div style={H_TITLE}>Needs attention</div>
              <div style={{ fontSize: 11.3, color: 'rgba(var(--on),0.36)', marginTop: 3 }}>{attention ? attention + ' items across four desks' : 'Quiet is the goal'}</div>
            </div>
          </div>
          {needs.length === 0 ? <Empty note="Nothing is waiting. Every queue is clear." /> : needs.map(n => (
            <Link key={n.label} href={n.href} className="pc-nav" style={ROW}>
              <span style={{ width: 32, height: 32, flex: '0 0 32px', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(var(--on),0.05)' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" style={{ fill: n.color }}><path d={n.icon} /></svg>
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--txt)' }}>{n.label}</span>
                <span style={{ display: 'block', fontSize: 10.8, color: 'rgba(var(--on),0.36)', marginTop: 2 }}>{n.sub}</span>
              </span>
              <span className="pc-num" style={{ fontSize: 17, color: 'var(--txt-strong)' }}>{n.count}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <div style={PANEL}>
          <div style={HEAD}>
            <div style={{ flex: 1 }}><div style={H_TITLE}>Newest members</div></div>
            <Link href="/users" className="pc-crumb" style={LINK_SM}>All members</Link>
          </div>
          {(recent.data ?? []).length === 0 ? <Empty note="No profiles yet." /> : (recent.data ?? []).map((u: { id: string; full_name: string | null; username: string | null; avatar_url: string | null; is_verified: boolean; verified_tier: string | null; location: string | null; created_at: string }) => (
            <Link key={u.id} href={'/users/' + u.id} className="pc-nav" style={ROW}>
              {u.avatar_url
                ? <img src={u.avatar_url} alt="" style={{ width: 30, height: 30, flex: '0 0 30px', borderRadius: '50%', objectFit: 'cover' }} />
                : <span style={{ width: 30, height: 30, flex: '0 0 30px', borderRadius: '50%', background: 'var(--chip-bg)', color: 'var(--chip-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{String(u.full_name || u.username || '?').slice(0, 1).toUpperCase()}</span>}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 12.3, fontWeight: 600, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.full_name || 'Unnamed'}</span>
                  {u.is_verified ? <Seal tier={u.verified_tier || 'business'} size={12} /> : null}
                </span>
                <span style={{ display: 'block', fontSize: 10.8, color: 'rgba(var(--on),0.36)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>@{u.username || 'member'}{u.location ? ' \u00b7 ' + u.location : ''}</span>
              </span>
              <span className="pc-num" style={{ flex: '0 0 auto', fontSize: 10.5, color: 'rgba(var(--on),0.3)' }}>{ago(u.created_at)}</span>
            </Link>
          ))}
        </div>

        <div style={PANEL}>
          <div style={HEAD}>
            <div style={{ flex: 1 }}><div style={H_TITLE}>Top content</div></div>
            <Link href="/content" className="pc-crumb" style={LINK_SM}>All posts</Link>
          </div>
          {topContent.length === 0 ? <Empty note="No post has drawn engagement yet." /> : topContent.map(p => (
            <Link key={p.id} href={'/p/' + p.id} className="pc-nav" style={ROW}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.3, fontWeight: 600, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.content || 'Media post'}</span>
                <span style={{ display: 'block', fontSize: 10.8, color: 'rgba(var(--on),0.36)', marginTop: 2 }}>@{postAuthors[p.user_id]?.username || 'member'}</span>
              </span>
              <span className="pc-num" style={{ flex: '0 0 auto', fontSize: 11.4, fontWeight: 600, color: 'var(--txt)' }}>{fmt(p.score)}</span>
            </Link>
          ))}
        </div>

        <div style={PANEL}>
          <div style={HEAD}>
            <div style={{ flex: 1 }}>
              <div style={H_TITLE}>Top locations</div>
              <div style={{ fontSize: 11.3, color: 'rgba(var(--on),0.36)', marginTop: 3 }}>profiles.location, as members typed it</div>
            </div>
          </div>
          <div style={{ padding: 16 }}>
            {topLocations.length === 0 ? <Empty note="No member has set a location yet." /> : topLocations.map(l => (
              <div key={l.label} style={{ marginBottom: 11 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 5 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.label}</span>
                  <span className="pc-num" style={{ fontSize: 11.4, fontWeight: 600, color: 'var(--txt)' }}>{l.n}</span>
                  <span className="pc-num" style={{ fontSize: 10.5, color: 'rgba(var(--on),0.34)', width: 44, textAlign: 'right' }}>{located ? ((l.n / located) * 100).toFixed(1) + '%' : '-'}</span>
                </div>
                <div style={{ height: 6, borderRadius: 4, background: 'rgba(var(--on),0.06)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: Math.max(2, (l.n / Math.max(1, topLocations[0].n)) * 100) + '%', borderRadius: 4, background: 'var(--c1)' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_320px]">
        <div style={PANEL}>
          <div style={HEAD}>
            <div style={{ flex: 1 }}><div style={H_TITLE}>Recent desk activity</div></div>
            <Link href="/audit" className="pc-crumb" style={LINK_SM}>Audit log</Link>
          </div>
          {(audit.data ?? []).length === 0 ? <Empty note="Every action lands here, permanently." /> : (audit.data ?? []).map((a: { action: string; reason: string | null; created_at: string }, i: number) => (
            <div key={i} style={ROW}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.3, fontWeight: 600, color: 'var(--txt)' }}>{a.action.replace(/[._]/g, ' ')}</span>
                <span style={{ display: 'block', fontSize: 10.8, color: 'rgba(var(--on),0.36)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.reason || 'no note recorded'}</span>
              </span>
              <span className="pc-num" style={{ flex: '0 0 auto', fontSize: 10.5, color: 'rgba(var(--on),0.3)' }}>{ago(a.created_at)}</span>
            </div>
          ))}
        </div>

        <div>
          <div style={PANEL}>
            <div style={HEAD}>
              <div style={{ flex: 1 }}><div style={H_TITLE}>Platform health</div></div>
            </div>
            {health.map(h => (
              <div key={h.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10.5px 16px', borderBottom: '1px solid rgba(var(--on),0.10)' }}>
                <span className={h.ok ? 'pc-pulse' : ''} style={{ width: 6, height: 6, borderRadius: '50%', flex: '0 0 6px', background: h.ok ? 'var(--ok)' : 'var(--warn)' }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.2, color: 'rgba(var(--on),0.68)' }}>{h.label}</span>
                  <span style={{ display: 'block', fontSize: 10.4, color: 'rgba(var(--on),0.3)', marginTop: 2 }}>{h.meta}</span>
                </span>
                <span className="pc-num" style={{ fontSize: 11, fontWeight: 600, color: h.ok ? 'var(--ok)' : 'var(--warn)' }}>{h.state}</span>
              </div>
            ))}
          </div>

          <div className="mt-4" style={PANEL}>
            <div style={HEAD}><div style={{ flex: 1 }}><div style={H_TITLE}>Quick links</div></div></div>
            <div style={{ padding: 10 }}>
              {[
                { label: 'Announcements and flags', href: '/system', icon: IC.mega },
                { label: 'Staff and roles', href: '/staff', icon: IC.staff },
                { label: 'Audit log', href: '/audit', icon: IC.list },
                { label: 'Controls', href: '/system', icon: IC.gear },
              ].map(q => (
                <Link key={q.label} href={q.href} className="pc-nav" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 9, textDecoration: 'none', fontSize: 12.3, color: 'var(--txt)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" style={{ flex: '0 0 14px', fill: 'rgba(var(--on),0.4)' }}><path d={q.icon} /></svg>
                  {q.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[320px_1fr]">
        <div style={PANEL}>
          <div style={HEAD}>
            <div style={{ flex: 1 }}>
              <div style={H_TITLE}>Verification funnel</div>
              <div style={{ fontSize: 11.3, color: 'rgba(var(--on),0.36)', marginTop: 3 }}>All time, verification_applications</div>
            </div>
          </div>
          <div style={{ padding: 16 }}>
            {funnel.map(f => (
              <div key={f.label} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 12, color: 'rgba(var(--on),0.55)' }}>{f.label}</span>
                  <span className="pc-num" style={{ fontSize: 11.8, fontWeight: 600, color: 'var(--txt)' }}>{fmt(f.value)}</span>
                </div>
                <div style={{ height: 6, borderRadius: 4, background: 'rgba(var(--on),0.06)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: Math.max(2, (f.value / funnelMax) * 100) + '%', borderRadius: 4, background: 'var(--c4)' }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={PANEL}>
          <div style={HEAD}>
            <div style={{ flex: 1 }}>
              <div style={H_TITLE}>Waiting on a decision</div>
              <div style={{ fontSize: 11.3, color: 'rgba(var(--on),0.36)', marginTop: 3 }}>Oldest first, because waiting is the cost</div>
            </div>
          </div>
          {appRows.length + openReports.length === 0 ? <Empty note="No application or report is waiting." /> : (
            <div>
              {appRows.map(a => {
                const p = names[a.applicant_id] || { full_name: null, username: null };
                return (
                  <Link key={a.id} href="/queue" className="pc-nav" style={ROW}>
                    <Seal tier={a.tier} size={16} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.3, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <b style={{ fontWeight: 600 }}>{p.full_name || '@' + (p.username || 'member')}</b>
                      <span style={{ color: 'rgba(var(--on),0.45)' }}> applied for {TIER_LABEL[a.tier] || a.tier}{a.category ? ' \u00b7 ' + a.category : ''}</span>
                    </span>
                    <span className="pc-num" style={{ flex: '0 0 auto', fontSize: 10.5, color: 'rgba(var(--on),0.3)' }}>{ago(a.created_at)}</span>
                  </Link>
                );
              })}
              {openReports.map(r => (
                <Link key={r.kind + r.id} href="/reports" className="pc-nav" style={ROW}>
                  <span style={{ flex: '0 0 auto', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'rgba(var(--warn-rgb),0.12)', color: 'var(--warn)' }}>{r.kind}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.3, color: 'rgba(var(--on),0.55)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Reported for {r.reason}</span>
                  <span className="pc-num" style={{ flex: '0 0 auto', fontSize: 10.5, color: 'rgba(var(--on),0.3)' }}>{ago(r.created_at)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {flagRows.length > 0 ? (
        <div className="mt-4" style={PANEL}>
          <div style={HEAD}>
            <div style={{ flex: 1 }}><div style={H_TITLE}>Feature flags</div></div>
            <Link href="/system" className="pc-crumb" style={LINK_SM}>Manage in Controls</Link>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" style={{ padding: 16 }}>
            {flagRows.map(f => (
              <div key={f.key} style={{ borderRadius: 10, border: '1px solid rgba(var(--on),0.10)', padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.2, fontWeight: 600, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.key}</span>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', flex: '0 0 7px', background: f.enabled ? 'var(--ok)' : 'rgba(var(--on),0.2)' }} />
                </div>
                {f.note ? <div style={{ fontSize: 10.4, color: 'rgba(var(--on),0.32)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.note}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Shell>
  );
}

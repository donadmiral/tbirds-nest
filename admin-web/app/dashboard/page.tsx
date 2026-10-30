import Image from 'next/image';
import { requestTime, measureRead } from '@/lib/requestTime';
import AdminIcon from '@/components/AdminIcon';
import { completeRead } from '@/lib/completeRead';
import Link from 'next/link';
import { requireDesk } from '@/lib/adminAuth';
import { allowedDesks, hasFullOverview, canPerform } from '@/lib/permissions';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import RefreshDesk from '@/components/RefreshDesk';
import Seal from '@/components/Seal';
import { SeriesChart, Spark, Empty } from '@/components/Viz';
import { fmt, ago } from '@/lib/fmt';
import { pickMedia, resolveMedia, isVideoUrl } from '@/lib/media';
import { resolveModerationMedia } from '@/lib/moderationMedia';

export const dynamic = 'force-dynamic';

const TIER_LABEL: Record<string, string> = { public_figure: 'Green', business: 'Space grey', official: 'Platinum' };
const ACTIVE_WINDOW_MIN = 5;

const PANEL: React.CSSProperties = { minWidth: 0, borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)', boxShadow: '0 1px 2px rgba(11,30,61,0.025)', overflow: 'hidden' };
const HEAD: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 12px', borderBottom: '1px solid rgba(var(--on),0.10)' };
const H_TITLE: React.CSSProperties = { fontSize: 14, fontWeight: 700, color: 'var(--txt)' };
const ROW: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 11, padding: '11px 16px', borderBottom: '1px solid rgba(var(--on),0.10)', textDecoration: 'none' };
const LINK_SM: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--txt-muted)', textDecoration: 'none', whiteSpace: 'nowrap' };

const IC = {
  users: 'users',
  pulse: 'pulse',
  flag: 'reports',
  seal: 'verification',
  ticket: 'support',
  build: 'business',
  mega: 'ads',
  list: 'audit',
  gear: 'controls',
  staff: 'staff',
} as const;

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
  const admin = await requireDesk('/dashboard');
  if (!hasFullOverview(admin.role)) {
    return <Shell admin={admin} active="/dashboard" title="Your workspace" sub="Open a desk assigned to your role.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...allowedDesks(admin.role)].filter(d => d !== '/dashboard').map(d => (
          <Link key={d} href={d} className="rounded-xl border p-5 capitalize">{d.slice(1)}</Link>
        ))}
      </div>
    </Shell>;
  }
  const svc = serviceClient();

  const now = await requestTime();
  const activeSince = new Date(now - ACTIVE_WINDOW_MIN * 60000).toISOString();
  const from30 = new Date(now - 30 * 86400000).toISOString();
  const from7 = new Date(now - 7 * 86400000).toISOString();
  const from14 = new Date(now - 14 * 86400000).toISOString();
  const from24h = new Date(now - 86400000).toISOString();
  const days30 = Array.from({ length: 30 }, (_, i) => dayKey(new Date(now - (29 - i) * 86400000)));

  const { value: [
    users, verified, active, apps, pr, lr, ur, audit, tickets, bizApps, flags, daily,
    prAll, lrAll, urAll, appAll, recent, topPostsRes, locRes, cerr,
    vAll, vReview, vApproved, vRejected,
  ], elapsedMs: readsElapsedMs } = await measureRead(() => Promise.all([
    svc.from('profiles').select('id', { count: 'exact', head: true }),
    svc.from('profiles').select('id', { count: 'exact', head: true }).eq('is_verified', true),
    svc.from('profiles').select('id', { count: 'exact', head: true }).gte('last_seen', activeSince),
    svc.from('verification_applications').select('id, applicant_id, tier, category, created_at', { count: 'exact' }).in('status', ['submitted', 'under_review']).order('created_at', { ascending: true }).limit(6),
    svc.from('post_reports').select('id, reason, created_at', { count: 'exact' }).eq('status', 'open').order('created_at', { ascending: true }).limit(4),
    svc.from('listing_reports').select('id, reason, created_at', { count: 'exact' }).eq('status', 'open').order('created_at', { ascending: true }).limit(4),
    svc.from('user_reports').select('id, reason, created_at', { count: 'exact' }).eq('status', 'open').order('created_at', { ascending: true }).limit(4),
    svc.from('admin_audit_log').select('action, reason, created_at').order('created_at', { ascending: false }).limit(8),
    svc.from('support_tickets').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    svc.from('business_applications').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    svc.from('feature_flags').select('key, enabled, note').order('key'),
    svc.from('daily_stats').select('day, dau, new_signups, posts, comments, likes, messages, stories, listings, jobs').order('day', { ascending: false }).limit(30),
    svc.from('post_reports').select('created_at', { count: 'exact' }).gte('created_at', from30).limit(2000),
    svc.from('listing_reports').select('created_at', { count: 'exact' }).gte('created_at', from30).limit(2000),
    svc.from('user_reports').select('created_at', { count: 'exact' }).gte('created_at', from30).limit(2000),
    svc.from('verification_applications').select('created_at', { count: 'exact' }).gte('created_at', from30).limit(2000),
    svc.from('profiles').select('id, full_name, username, avatar_url, is_verified, verified_tier, location, account_type, created_at').order('created_at', { ascending: false }).limit(6),
    svc.from('posts').select('*').order('likes_count', { ascending: false, nullsFirst: false }).limit(12),
    svc.from('profiles').select('location', { count: 'exact' }).not('location', 'is', null).limit(5000),
    svc.from('client_errors').select('id', { count: 'exact', head: true }).gte('created_at', from24h),
    svc.from('verification_applications').select('id', { count: 'exact', head: true }),
    svc.from('verification_applications').select('id', { count: 'exact', head: true }).in('status', ['under_review', 'approved', 'rejected']),
    svc.from('verification_applications').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    svc.from('verification_applications').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
  ]));

  const dashboardResults = [users, verified, active, apps, pr, lr, ur, audit, tickets, bizApps, flags, daily,
    prAll, lrAll, urAll, appAll, recent, topPostsRes, locRes, cerr, vAll, vReview, vApproved, vRejected];
  if (dashboardResults.some(result => result.error)) throw new Error('Dashboard information could not be loaded.');
  if ([users, verified, active, apps, pr, lr, ur, tickets, bizApps, cerr, vAll, vReview, vApproved, vRejected].some(result => result.count === null)) {
    throw new Error('Dashboard counts could not be confirmed.');
  }
  for (const result of [prAll, lrAll, urAll, appAll, locRes]) completeRead(result, 'Dashboard aggregate');
  const members = users.count ?? 0;
  const appRows = apps.data ?? [];
  const names: Record<string, { full_name: string | null; username: string | null }> = {};
  if (appRows.length) {
    const { data, error } = await svc.from('profiles').select('id, full_name, username').in('id', appRows.map(a => a.applicant_id));
    if (error) throw new Error('Dashboard applicant details could not be loaded.');
    (data ?? []).forEach((p: { id: string; full_name: string | null; username: string | null }) => { names[p.id] = p; });
  }
  const openReports = [
    ...(pr.data ?? []).map(r => ({ ...r, kind: 'Post' })),
    ...(lr.data ?? []).map(r => ({ ...r, kind: 'Listing' })),
    ...(ur.data ?? []).map(r => ({ ...r, kind: 'Account' })),
  ].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, 6);

  const daysRows = [...(daily.data ?? [])].reverse() as Record<string, number | string>[];
  const dauSeries = daysRows.map(r => Number(r.dau) || 0);
  const signupSeries = daysRows.map(r => Number(r.new_signups) || 0);
  const signups7 = signupSeries.slice(-7).reduce((a, b) => a + b, 0);
  const signupsPrev7 = signupSeries.slice(-14, -7).reduce((a, b) => a + b, 0);

  const reportRows = [...(prAll.data ?? []), ...(lrAll.data ?? []), ...(urAll.data ?? [])] as { created_at: string }[];
  const reportSeries = bucketByDay(reportRows, days30);
  const reports7 = reportRows.filter(r => r.created_at >= from7).length;
  const reportsPrev7 = reportRows.filter(r => r.created_at >= from14 && r.created_at < from7).length;
  const appSeries = bucketByDay((appAll.data ?? []) as { created_at: string }[], days30);
  const apps7 = ((appAll.data ?? []) as { created_at: string }[]).filter(r => r.created_at >= from7).length;
  const appsPrev7 = ((appAll.data ?? []) as { created_at: string }[]).filter(r => r.created_at >= from14 && r.created_at < from7).length;

  const [prOpen, lrOpen, urOpen] = [pr.count ?? 0, lr.count ?? 0, ur.count ?? 0];

  const cards = [
    { label: 'Total members', value: members, icon: IC.users, color: 'var(--c1)', spark: signupSeries, delta: pctDelta(signups7, signupsPrev7), note: 'signups this week against last', href: '/users' },
    { label: 'Active now', value: active.count ?? 0, icon: IC.pulse, color: 'var(--c2)', spark: dauSeries, delta: {text: '', fg: 'var(--txt)'}, note: 'seen during the last 5 minutes', href: '/users' },
    { label: 'Open reports', value: prOpen + lrOpen + urOpen, icon: IC.flag, color: 'var(--c5)', spark: reportSeries, delta: pctDelta(reports7, reportsPrev7), note: 'opened this week against last', href: '/reports' },
    { label: 'Pending verifications', value: apps.count ?? 0, icon: IC.seal, color: 'var(--c3)', spark: appSeries, delta: pctDelta(apps7, appsPrev7), note: 'applied this week against last', href: '/queue' },
  ];

  const needs = [
    { label: 'Verification applications', sub: 'submitted and under review', count: apps.count ?? 0, href: '/queue', icon: IC.seal, color: 'var(--c3)' },
    { label: 'Open reports', sub: 'posts, listings and accounts', count: prOpen + lrOpen + urOpen, href: '/reports', icon: IC.flag, color: 'var(--c5)' },
    { label: 'Support tickets', sub: 'open conversations', count: tickets.count ?? 0, href: '/support', icon: IC.ticket, color: 'var(--c1)' },
    { label: 'Business applications', sub: 'awaiting review', count: bizApps.count ?? 0, href: '/businesses', icon: IC.build, color: 'var(--c2)' },
  ].filter(n => n.count > 0);
  const attention = needs.reduce((s, n) => s + n.count, 0);

  const postRaw = (topPostsRes.data ?? []) as Record<string, unknown>[];
  const postRows = postRaw.map(p => ({
    id: String(p.id), content: (p.content as string | null) ?? (p.body as string | null) ?? null, user_id: String(p.user_id),
    likes_count: Number(p.likes_count) || 0, comments_count: Number(p.comments_count) || 0, shares_count: Number(p.shares_count) || 0,
    raw: p,
  }));
  const postMedia: Record<string, string> = {};
  if (postRows.length) {
    const { data: pm } = await svc.from('post_media').select('post_id, url, sort_order').in('post_id', postRows.map(p => p.id)).order('sort_order', { ascending: true });
    ((pm ?? []) as { post_id: string; url: string }[]).forEach(m => { if (!postMedia[m.post_id]) postMedia[m.post_id] = m.url; });
  }
  postRows.forEach(p => { if (!postMedia[p.id]) { const f = pickMedia(p.raw); if (f) postMedia[p.id] = f; } });
  const postUrls = canPerform(admin.role, 'post_moderate')
    ? await resolveModerationMedia(Object.values(postMedia), 'post', postRows.map(p => p.id))
    : await resolveMedia(Object.values(postMedia));

  const postAuthors: Record<string, { username: string | null; avatar_url: string | null }> = {};
  const pids = Array.from(new Set(postRows.map(p => p.user_id)));
  if (pids.length) {
    const { data } = await svc.from('profiles').select('id, username, avatar_url').in('id', pids);
    (data ?? []).forEach((p: { id: string; username: string | null; avatar_url: string | null }) => { postAuthors[p.id] = p; });
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
    { label: 'Dashboard data reads', state: 'Succeeded', ok: true, meta: `current page queries completed in ${readsElapsedMs} ms; not a service-wide health check` },
    { label: 'Daily activity summary', state: statsFresh ? 'Current' : 'Awaiting update', ok: statsFresh, meta: lastStatDay ? 'Last updated ' + lastStatDay : 'The first daily summary is not available yet' },
    { label: 'App errors, 24 hours', state: errors24 === 0 ? 'Clear' : String(errors24), ok: errors24 === 0, meta: 'Reported by the app' },
    { label: 'Enabled features', state: flagRows.filter(f => f.enabled).length + ' of ' + flagRows.length, ok: true, meta: 'Current feature settings' },
  ];

  const funnel = [
    { label: 'Applications received', value: vAll.count ?? 0 },
    { label: 'Reached review', value: vReview.count ?? 0 },
    { label: 'Approved', value: vApproved.count ?? 0 },
    { label: 'Rejected', value: vRejected.count ?? 0 },
  ];
  const funnelMax = Math.max(1, funnel[0].value);

  return (
    <Shell admin={admin} active="/dashboard" crumb="Overview"
      title="Workspace overview"
      sub={'Community activity and the work that needs your attention. ' + fmt(members) + ' members on file; ' + (attention ? attention + ' items waiting for review.' : 'no items waiting in the monitored queues.')}
      pageActions={<><RefreshDesk /><Link className="pc-button pc-button-primary" href="/reports">Review reports <span aria-hidden="true">↗</span></Link></>}>

      <div className="pc-stat-strip" style={{ '--stat-count': cards.length } as React.CSSProperties}>
        {cards.map(c => (
          <Link key={c.label} href={c.href} className="pc-nav" style={{ ...PANEL, padding: '14px 15px 12px', display: 'block', textDecoration: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--txt-muted)' }}>{c.label}</span>
              <span style={{ width: 26, height: 26, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(var(--on),0.05)' }}>
                <AdminIcon name={c.icon} size={19} style={{ color: c.color }} />
              </span>
            </div>
            <div className="pc-num" style={{ marginTop: 9, fontSize: 27, lineHeight: 1, color: 'var(--txt-strong)' }}>{fmt(c.value)}</div>
            <div style={{ marginTop: 9, display: 'flex', alignItems: 'baseline', gap: 7, whiteSpace: 'nowrap', overflow: 'hidden' }}>
              <span className="pc-num" style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 600, color: c.delta.fg }}>{c.delta.text}</span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: 'var(--txt-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.note}</span>
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
              <div style={{ fontSize: 12, color: 'var(--txt-muted)', marginTop: 4 }}>Daily activity across your community. Select a series to show or hide it.</div>
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
              <div style={{ fontSize: 12, color: 'var(--txt-muted)', marginTop: 3 }}>{attention ? attention + ' items across four desks' : 'Quiet is the goal'}</div>
            </div>
          </div>
          {needs.length === 0 ? <Empty note="Nothing is waiting. Every queue is clear." /> : needs.map(n => (
            <Link key={n.label} href={n.href} className="pc-nav" style={ROW}>
              <span style={{ width: 32, height: 32, flex: '0 0 32px', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(var(--on),0.05)' }}>
                <AdminIcon name={n.icon} size={19} style={{ color: n.color }} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{n.label}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--txt-muted)', marginTop: 2 }}>{n.sub}</span>
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
                ? <Image unoptimized width={30} height={30} src={u.avatar_url} alt="" style={{ width: 30, height: 30, flex: '0 0 30px', borderRadius: '50%', objectFit: 'cover' }} />
                : <span style={{ width: 30, height: 30, flex: '0 0 30px', borderRadius: '50%', background: 'var(--chip-bg)', color: 'var(--chip-fg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{String(u.full_name || u.username || '?').slice(0, 1).toUpperCase()}</span>}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.full_name || 'Unnamed'}</span>
                  {u.is_verified ? <Seal tier={u.verified_tier || 'business'} size={12} /> : null}
                </span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--txt-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>@{u.username || 'member'}{u.location ? ' \u00b7 ' + u.location : ''}</span>
              </span>
              <span className="pc-num" style={{ flex: '0 0 auto', fontSize: 11, color: 'var(--txt-muted)' }}>{ago(u.created_at)}</span>
            </Link>
          ))}
        </div>

        <div style={PANEL}>
          <div style={HEAD}>
            <div style={{ flex: 1 }}><div style={H_TITLE}>Top content</div></div>
            <Link href="/content" className="pc-crumb" style={LINK_SM}>All posts</Link>
          </div>
          {topContent.length === 0 ? <Empty note="No post has drawn engagement yet." /> : topContent.map(p => {
            const rawUrl = postMedia[p.id];
            const url = rawUrl ? postUrls[rawUrl] || null : null;
            const video = isVideoUrl(rawUrl);
            return (
            <Link key={p.id} href={'/content/' + p.id} className="pc-nav" style={ROW}>
              <span style={{ width: 38, height: 38, flex: '0 0 38px', borderRadius: 9, overflow: 'hidden', background: 'rgba(var(--on),0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                {url
                  ? (video
                    ? <video src={url} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <Image unoptimized width={38} height={38} src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />)
                  : (postAuthors[p.user_id]?.avatar_url
                    ? <Image unoptimized width={38} height={38} src={postAuthors[p.user_id]!.avatar_url as string} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <svg width="14" height="14" viewBox="0 0 24 24" style={{ fill: 'rgba(var(--on),0.24)' }}><path d="M4 4h16v12H5.2L4 17.2V4zm2 3h12v2H6V7zm0 4h8v2H6v-2z" /></svg>)}
                {video && url ? (
                  <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.28)' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" style={{ fill: '#fff' }}><path d="M8 5v14l11-7z" /></svg>
                  </span>
                ) : null}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.content || 'Media post'}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--txt-muted)', marginTop: 2 }}>@{postAuthors[p.user_id]?.username || 'member'}</span>
              </span>
              <span className="pc-num" style={{ flex: '0 0 auto', fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>{fmt(p.score)}</span>
            </Link>
            );
          })}
        </div>

        <div style={PANEL}>
          <div style={HEAD}>
            <div style={{ flex: 1 }}>
              <div style={H_TITLE}>Top locations</div>
              <div style={{ fontSize: 12, color: 'var(--txt-muted)', marginTop: 4 }}>Locations shared by your members</div>
            </div>
          </div>
          <div style={{ padding: 16 }}>
            {topLocations.length === 0 ? <Empty note="No member has set a location yet." /> : topLocations.map(l => (
              <div key={l.label} style={{ marginBottom: 11 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 5 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.label}</span>
                  <span className="pc-num" style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>{l.n}</span>
                  <span className="pc-num" style={{ fontSize: 11, color: 'var(--txt-muted)', width: 44, textAlign: 'right' }}>{located ? ((l.n / located) * 100).toFixed(1) + '%' : '-'}</span>
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
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{a.action.replace(/[._]/g, ' ')}</span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--txt-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.reason || 'no note recorded'}</span>
              </span>
              <span className="pc-num" style={{ flex: '0 0 auto', fontSize: 11, color: 'var(--txt-muted)' }}>{ago(a.created_at)}</span>
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
                  <span style={{ display: 'block', fontSize: 13, color: 'var(--txt-muted)' }}>{h.label}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--txt-muted)', marginTop: 2 }}>{h.meta}</span>
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
                <Link key={q.label} href={q.href} className="pc-nav" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 9, textDecoration: 'none', fontSize: 13, color: 'var(--txt)' }}>
                  <AdminIcon name={q.icon} size={18} style={{ color: 'var(--txt-muted)' }} />
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
              <div style={{ fontSize: 12, color: 'var(--txt-muted)', marginTop: 4 }}>Verification applications, all time</div>
            </div>
          </div>
          <div style={{ padding: 16 }}>
            {funnel.map(f => (
              <div key={f.label} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 12, color: 'var(--txt-muted)' }}>{f.label}</span>
                  <span className="pc-num" style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>{fmt(f.value)}</span>
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
              <div style={{ fontSize: 12, color: 'var(--txt-muted)', marginTop: 3 }}>Oldest first, because waiting is the cost</div>
            </div>
          </div>
          {appRows.length + openReports.length === 0 ? <Empty note="No application or report is waiting." /> : (
            <div>
              {appRows.map(a => {
                const p = names[a.applicant_id] || { full_name: null, username: null };
                return (
                  <Link key={a.id} href="/queue" className="pc-nav" style={ROW}>
                    <Seal tier={a.tier} size={16} />
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <b style={{ fontWeight: 600 }}>{p.full_name || '@' + (p.username || 'member')}</b>
                      <span style={{ color: 'var(--txt-muted)' }}> applied for {TIER_LABEL[a.tier] || a.tier}{a.category ? ' \u00b7 ' + a.category : ''}</span>
                    </span>
                    <span className="pc-num" style={{ flex: '0 0 auto', fontSize: 11, color: 'var(--txt-muted)' }}>{ago(a.created_at)}</span>
                  </Link>
                );
              })}
              {openReports.map(r => (
                <Link key={r.kind + r.id} href="/reports" className="pc-nav" style={ROW}>
                  <span style={{ flex: '0 0 auto', fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'rgba(var(--warn-rgb),0.12)', color: 'var(--warn)' }}>{r.kind}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--txt-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Reported for {r.reason}</span>
                  <span className="pc-num" style={{ flex: '0 0 auto', fontSize: 11, color: 'var(--txt-muted)' }}>{ago(r.created_at)}</span>
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
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: 'var(--txt)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.key}</span>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', flex: '0 0 7px', background: f.enabled ? 'var(--ok)' : 'rgba(var(--on),0.2)' }} />
                </div>
                {f.note ? <div style={{ fontSize: 11, color: 'var(--txt-muted)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.note}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Shell>
  );
}

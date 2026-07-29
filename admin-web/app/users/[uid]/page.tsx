import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { suspendUser, restoreUser, revokeVerification, adminRemovePost, adminRemoveListing, issueStrike, liftRestriction } from '@/lib/actions';
import Shell from '@/components/Shell';
import Seal from '@/components/Seal';

export const dynamic = 'force-dynamic';

const TABS = ['overview', 'strikes', 'posts', 'listings', 'jobs', 'reports', 'support', 'audit'] as const;

export default async function MemberRecordPage({ params, searchParams }: {
  params: Promise<{ uid: string }>; searchParams: Promise<{ tab?: string }>;
}) {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const { uid } = await params;
  const { tab: rawTab } = await searchParams;
  const tab = (TABS as readonly string[]).includes(rawTab || '') ? (rawTab as string) : 'overview';
  const svc = serviceClient();
  const { data: u } = await svc.from('profiles')
    .select('id, full_name, username, email, avatar_url, account_type, bio, location, is_verified, verified_tier, verified_category, created_at, deactivated_at, suspended_reason, restricted_until')
    .eq('id', uid).maybeSingle();
  if (!u) notFound();
  const suspended = !!u.deactivated_at;
  const restricted = !!(u.restricted_until && new Date(u.restricted_until) > new Date());

  let body: React.ReactNode = null;
  if (tab === 'overview') {
    const [pc, lc, jc, tk] = await Promise.all([
      svc.from('posts').select('id', { count: 'exact', head: true }).eq('user_id', uid),
      svc.from('marketplace_listings').select('id', { count: 'exact', head: true }).eq('seller_id', uid),
      svc.from('jobs').select('id', { count: 'exact', head: true }).eq('posted_by', uid),
      svc.from('support_tickets').select('id', { count: 'exact', head: true }).eq('user_id', uid),
    ]);
    body = (
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-5 lg:col-span-2">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Identity</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px]">
            <p className="text-[#7A7D84]">Email</p><p className="font-medium">{u.email || '-'}</p>
            <p className="text-[#7A7D84]">Account type</p><p className="font-medium">{u.account_type || 'personal'}</p>
            <p className="text-[#7A7D84]">Joined</p><p className="font-medium tabular-nums">{new Date(u.created_at).toLocaleDateString()}</p>
            <p className="text-[#7A7D84]">Location</p><p className="font-medium">{u.location || '-'}</p>
            <p className="text-[#7A7D84]">Verification</p><p className="font-medium">{u.verified_tier ? (u.verified_tier + (u.verified_category ? ' - ' + u.verified_category : '')) : 'none'}</p>
            <p className="text-[#7A7D84]">Activity</p><p className="font-medium tabular-nums">{pc.count ?? 0} posts - {lc.count ?? 0} listings - {jc.count ?? 0} jobs - {tk.count ?? 0} tickets</p>
          </div>
          {u.bio ? <p className="mt-4 rounded-[10px] bg-[#F8F8F7] p-3 text-[13px] text-[#43454B]">{u.bio}</p> : null}
        </div>
        <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-5">
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Enforcement</p>
          {restricted ? (
            <div className="mb-3 rounded-[10px] border border-[#F3E3C5] bg-[#FBF4E4] p-2.5">
              <p className="text-[11.5px] font-bold text-[#B45309]">Restricted until {new Date(u.restricted_until).toLocaleDateString()}</p>
              <form action={liftRestriction} className="mt-1.5">
                <input type="hidden" name="uid" value={u.id} />
                <button className="text-[11px] font-semibold text-[#B45309] underline">Lift early</button>
              </form>
            </div>
          ) : null}
          {!suspended ? (
            <form action={issueStrike} className="space-y-2">
              <input type="hidden" name="uid" value={u.id} />
              <select name="level" className="w-full rounded-[10px] border border-[#E5E4E0] bg-white px-3 py-2 text-[12.5px] outline-none">
                <option value="warn">Warn - recorded strike only</option>
                <option value="restrict">Restrict - no posting or listing</option>
                <option value="suspend">Suspend - account hidden</option>
                <option value="ban">Ban - permanent intent</option>
              </select>
              <input name="days" type="number" min={1} max={90} defaultValue={7} className="w-full rounded-[10px] border border-[#E5E4E0] px-3 py-2 text-[12.5px] outline-none focus:border-[#B9BCC2]" placeholder="Days if restricting" />
              <input name="reason" required placeholder="Reason - the member may see this"
                className="w-full rounded-[10px] border border-[#E5E4E0] px-3 py-2 text-[12.5px] outline-none focus:border-[#B9BCC2]" />
              <button className="w-full rounded-[10px] border border-[#F0DEDE] bg-[#FBF2F2] py-2 text-[12px] font-bold text-[#B03A3A] hover:bg-[#F6E4E4]">Issue</button>
            </form>
          ) : (
            <form action={restoreUser}>
              <input type="hidden" name="id" value={u.id} />
              <button className="w-full rounded-[10px] bg-[#0B1E3D] py-2 text-[12px] font-bold text-white hover:opacity-90">Restore account</button>
            </form>
          )}
          {(u.verified_tier || u.is_verified) ? (
            <form action={revokeVerification} className="mt-2">
              <input type="hidden" name="id" value={u.id} />
              <button className="w-full rounded-[10px] border border-[#E5E4E0] py-2 text-[12px] font-bold text-[#5A5D64] hover:bg-[#F0EFEC]">Revoke badge</button>
            </form>
          ) : null}
        </div>
      </div>
    );
  } else if (tab === 'strikes') {
    const { data: strikes } = await svc.from('member_strikes')
      .select('id, level, reason, expires_at, created_at').eq('user_id', uid)
      .order('created_at', { ascending: false }).limit(30);
    const pill = (lv: string) => lv === 'warn'
      ? <span className="rounded-full bg-[#EEF2FB] px-2 py-0.5 text-[10.5px] font-bold text-[#0B1E3D]">Warn</span>
      : lv === 'restrict'
      ? <span className="rounded-full border border-[#F3E3C5] bg-[#FBF4E4] px-2 py-0.5 text-[10.5px] font-bold text-[#B45309]">Restrict</span>
      : lv === 'suspend'
      ? <span className="rounded-full border border-[#F0DEDE] bg-[#FBF2F2] px-2 py-0.5 text-[10.5px] font-bold text-[#B03A3A]">Suspend</span>
      : <span className="rounded-full bg-[#191C22] px-2 py-0.5 text-[10.5px] font-bold text-white">Ban</span>;
    body = (
      <div className="rounded-[12px] border border-[#E5E4E0] bg-white">
        {(strikes ?? []).length === 0 ? <p className="px-5 py-10 text-center text-[13px] text-[#9A9DA4]">Clean record. No strikes.</p>
        : (strikes ?? []).map(s => (
          <div key={s.id} className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 text-[12.5px] last:border-0">
            {pill(s.level)}
            <p className="min-w-0 flex-1 truncate">{s.reason}</p>
            {s.expires_at ? <p className="text-[11px] tabular-nums text-[#9A9DA4]">until {new Date(s.expires_at).toLocaleDateString()}</p> : null}
            <p className="tabular-nums text-[11px] text-[#9A9DA4]">{new Date(s.created_at).toLocaleDateString()}</p>
          </div>
        ))}
      </div>
    );
  } else if (tab === 'posts') {
    const { data: posts } = await svc.from('posts')
      .select('id, content, body, media_url, likes_count, comments_count, created_at')
      .eq('user_id', uid).order('created_at', { ascending: false }).limit(25);
    body = (
      <div className="rounded-[12px] border border-[#E5E4E0] bg-white">
        {(posts ?? []).length === 0 ? <p className="px-5 py-10 text-center text-[13px] text-[#9A9DA4]">No posts.</p>
        : (posts ?? []).map(p => (
          <div key={p.id} className="border-b border-[#F0EFEC] px-5 py-3 last:border-0">
            <p className="line-clamp-2 whitespace-pre-wrap text-[13px] text-[#43454B]">{p.content || p.body || (p.media_url ? '(media post)' : '(empty)')}</p>
            <div className="mt-1.5 flex items-center gap-3">
              <p className="text-[11.5px] tabular-nums text-[#9A9DA4]">{p.likes_count} likes - {p.comments_count} comments - {new Date(p.created_at).toLocaleString()}</p>
              <form action={adminRemovePost} className="ml-auto">
                <input type="hidden" name="pid" value={p.id} />
                <button className="rounded-[8px] border border-[#F0DEDE] bg-[#FBF2F2] px-3 py-1 text-[11px] font-bold text-[#B03A3A] hover:bg-[#F6E4E4]">Remove</button>
              </form>
            </div>
          </div>
        ))}
      </div>
    );
  } else if (tab === 'listings') {
    const { data: ls } = await svc.from('marketplace_listings')
      .select('id, title, price, status, created_at').eq('seller_id', uid)
      .order('created_at', { ascending: false }).limit(25);
    body = (
      <div className="rounded-[12px] border border-[#E5E4E0] bg-white">
        {(ls ?? []).length === 0 ? <p className="px-5 py-10 text-center text-[13px] text-[#9A9DA4]">No listings.</p>
        : (ls ?? []).map(l => (
          <div key={l.id} className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 text-[12.5px] last:border-0">
            <p className="min-w-0 flex-1 truncate font-semibold">{l.title}</p>
            <p className="tabular-nums">${l.price}</p>
            <p className="text-[#7A7D84]">{l.status}</p>
            <p className="tabular-nums text-[#9A9DA4]">{new Date(l.created_at).toLocaleDateString()}</p>
            <form action={adminRemoveListing}>
              <input type="hidden" name="lid" value={l.id} />
              <button className="rounded-[8px] border border-[#F0DEDE] bg-[#FBF2F2] px-3 py-1 text-[11px] font-bold text-[#B03A3A] hover:bg-[#F6E4E4]">Remove</button>
            </form>
          </div>
        ))}
      </div>
    );
  } else if (tab === 'jobs') {
    const { data: js } = await svc.from('jobs')
      .select('id, title, company, location, job_type, created_at').eq('posted_by', uid)
      .order('created_at', { ascending: false }).limit(25);
    body = (
      <div className="rounded-[12px] border border-[#E5E4E0] bg-white">
        {(js ?? []).length === 0 ? <p className="px-5 py-10 text-center text-[13px] text-[#9A9DA4]">No roles posted.</p>
        : (js ?? []).map(j => (
          <div key={j.id} className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 text-[12.5px] last:border-0">
            <p className="min-w-0 flex-1 truncate font-semibold">{j.title}</p>
            <p className="truncate text-[#7A7D84]">{j.company}</p>
            <p className="truncate text-[#7A7D84]">{j.location || '-'}</p>
            <p className="tabular-nums text-[#9A9DA4]">{new Date(j.created_at).toLocaleDateString()}</p>
          </div>
        ))}
      </div>
    );
  } else if (tab === 'reports') {
    const [made, received] = await Promise.all([
      svc.from('user_reports').select('id, reason, status, created_at').eq('reporter_id', uid).order('created_at', { ascending: false }).limit(15),
      svc.from('user_reports').select('id, reason, status, created_at').eq('reported_id', uid).order('created_at', { ascending: false }).limit(15),
    ]);
    const list = (rows: any[], empty: string) => (
      <div className="rounded-[12px] border border-[#E5E4E0] bg-white">
        {rows.length === 0 ? <p className="px-5 py-8 text-center text-[12.5px] text-[#9A9DA4]">{empty}</p>
        : rows.map(r => (
          <div key={r.id} className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-2.5 text-[12.5px] last:border-0">
            <p className="min-w-0 flex-1 truncate">{r.reason}</p>
            <p className="text-[11px] font-bold text-[#7A7D84]">{r.status}</p>
            <p className="tabular-nums text-[11px] text-[#9A9DA4]">{new Date(r.created_at).toLocaleDateString()}</p>
          </div>
        ))}
      </div>
    );
    body = (
      <div className="grid gap-4 lg:grid-cols-2">
        <div><p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Reports against this member</p>{list(received.data ?? [], 'Never reported.')}</div>
        <div><p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Reports they filed</p>{list(made.data ?? [], 'None filed.')}</div>
      </div>
    );
  } else if (tab === 'support') {
    const { data: ts } = await svc.from('support_tickets')
      .select('id, kind, subject, status, resolution_note, created_at').eq('user_id', uid)
      .order('created_at', { ascending: false }).limit(20);
    body = (
      <div className="rounded-[12px] border border-[#E5E4E0] bg-white">
        {(ts ?? []).length === 0 ? <p className="px-5 py-10 text-center text-[13px] text-[#9A9DA4]">No tickets.</p>
        : (ts ?? []).map(t => (
          <div key={t.id} className="border-b border-[#F0EFEC] px-5 py-3 last:border-0">
            <p className="text-[13px]"><span className="font-bold">{t.kind === 'appeal' ? 'Appeal' : 'Support'}</span> - {t.subject} <span className="text-[#9A9DA4]">- {t.status} - {new Date(t.created_at).toLocaleDateString()}</span></p>
            {t.resolution_note ? <p className="mt-1 text-[12px] text-[#7A7D84]">{t.resolution_note}</p> : null}
          </div>
        ))}
      </div>
    );
  } else {
    const { data: rows } = await svc.from('admin_audit_log')
      .select('id, action, reason, created_at').eq('target_id', uid)
      .order('created_at', { ascending: false }).limit(30);
    body = (
      <div className="rounded-[12px] border border-[#E5E4E0] bg-white">
        {(rows ?? []).length === 0 ? <p className="px-5 py-10 text-center text-[13px] text-[#9A9DA4]">No administrative history.</p>
        : (rows ?? []).map(r => (
          <div key={r.id} className="flex items-baseline gap-3 border-b border-[#F0EFEC] px-5 py-2.5 text-[12.5px] last:border-0">
            <p className="font-semibold">{r.action.replace(/[._]/g, ' ')}</p>
            <p className="min-w-0 flex-1 truncate text-[#7A7D84]">{r.reason}</p>
            <p className="tabular-nums text-[11px] text-[#9A9DA4]">{new Date(r.created_at).toLocaleString()}</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <Shell admin={admin} active="/users" title="Member record" sub={'Everything about one member in one place'}>
      <div className="mb-5 flex items-center gap-3">
        {u.avatar_url
          ? <img src={u.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" />
          : <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#ECEBE7] text-[15px] font-bold text-[#5A5D64]">{String(u.full_name || '?').slice(0, 1)}</div>}
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[16px] font-semibold">{u.full_name || 'Unnamed'}{(u.verified_tier || u.is_verified) ? <Seal tier={u.verified_tier || 'business'} size={16} /> : null}<span className="font-normal text-[#9A9DA4]">@{u.username || '-'}</span></p>
          {suspended ? <p className="text-[12px] font-bold text-[#B03A3A]">SUSPENDED{u.suspended_reason ? ': ' + u.suspended_reason : ''}</p> : <p className="text-[12px] text-[#7A7D84]">Account in good standing</p>}
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-1 border-b border-[#E5E4E0]">
        {TABS.map(t => (
          <Link key={t} href={'/users/' + u.id + '?tab=' + t}
            className={'rounded-t-[8px] px-3.5 py-2 text-[12.5px] font-semibold capitalize transition-colors duration-150 ' + (tab === t ? 'border-b-2 border-[#0B1E3D] text-[#17181C]' : 'text-[#7A7D84] hover:text-[#17181C]')}>{t}</Link>
        ))}
      </div>
      {body}
    </Shell>
  );
}
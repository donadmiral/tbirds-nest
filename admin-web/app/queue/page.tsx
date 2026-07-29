import { redirect } from 'next/navigation';
import { getAdmin, VERIFICATION_ROLES } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { approveApplication, rejectApplication, signOut } from '@/lib/actions';
import Seal from '@/components/Seal';

export const dynamic = 'force-dynamic';

const TIER_LABEL: Record<string, string> = { public_figure: 'Green', business: 'Space grey', official: 'Platinum' };

export default async function QueuePage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  if (!VERIFICATION_ROLES.has(admin.role)) redirect('/');
  const svc = serviceClient();
  const { data: apps } = await svc.from('verification_applications')
    .select('*').in('status', ['submitted', 'under_review'])
    .order('created_at', { ascending: true });
  const ids = Array.from(new Set((apps ?? []).map(a => a.applicant_id)));
  const profiles: Record<string, any> = {};
  if (ids.length) {
    const { data: profs } = await svc.from('profiles')
      .select('id, full_name, username, avatar_url, account_type, created_at').in('id', ids);
    (profs ?? []).forEach(p => { profiles[p.id] = p; });
  }
  const { data: decided } = await svc.from('verification_applications')
    .select('id, tier, status, decided_at').not('decided_at', 'is', null)
    .order('decided_at', { ascending: false }).limit(5);

  return (
    <main className="min-h-screen bg-[#F5F6F8]">
      <header className="sticky top-0 z-10 border-b border-[#0B1E3D]/10 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-base font-extrabold text-[#0B1E3D]">Verification queue</h1>
            <nav className="mt-0.5"><a href="/users" className="text-xs font-semibold text-[#0B1E3D]/60 hover:text-[#0B1E3D]">User desk</a></nav>
            <p className="text-[11px] text-[#0B1E3D]/50">{admin.email} - {admin.role.replace(/_/g, ' ')}</p>
          </div>
          <form action={signOut}><button className="rounded-lg border border-[#0B1E3D]/15 px-3 py-1.5 text-xs font-semibold text-[#0B1E3D] hover:bg-[#0B1E3D]/5">Sign out</button></form>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-8">
        {(apps ?? []).length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#0B1E3D]/15 bg-white p-12 text-center">
            <p className="text-sm font-bold text-[#0B1E3D]">The queue is empty.</p>
            <p className="mt-1 text-xs text-[#0B1E3D]/50">When someone applies in the app, their case appears here for a human decision.</p>
          </div>
        ) : (apps ?? []).map(app => {
          const p = profiles[app.applicant_id] || {};
          const ev = app.evidence || {};
          return (
            <div key={app.id} className="mb-5 rounded-2xl border border-[#0B1E3D]/10 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  {p.avatar_url
                    ? <img src={p.avatar_url} alt="" className="h-11 w-11 rounded-full object-cover" />
                    : <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0B1E3D]/10 text-sm font-bold text-[#0B1E3D]">{String(p.full_name || '?').slice(0, 1)}</div>}
                  <div>
                    <p className="text-sm font-extrabold text-[#0B1E3D]">{p.full_name || 'Unknown'} <span className="font-medium text-[#0B1E3D]/40">@{p.username || '-'}</span></p>
                    <p className="text-[11px] text-[#0B1E3D]/50">{p.account_type || 'personal'} account - applied {new Date(app.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <span className="flex items-center gap-1.5 rounded-full bg-[#0B1E3D]/5 px-3 py-1.5 text-xs font-bold text-[#0B1E3D]">
                  <Seal tier={app.tier} size={16} /> {TIER_LABEL[app.tier] || app.tier}{app.category ? ' - ' + app.category : ''}
                </span>
              </div>
              <div className="mt-4 rounded-xl bg-[#0B1E3D]/[0.03] p-4">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#0B1E3D]/40">Their case</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[#0B1E3D]/85">{ev.statement || '-'}</p>
                {ev.office ? <p className="mt-2 text-xs font-semibold text-[#0B1E3D]/70">Office: {ev.office}</p> : null}
                {Array.isArray(ev.links) && ev.links.length ? (
                  <ul className="mt-2 space-y-1">
                    {ev.links.map((l: string, i: number) => (
                      <li key={i}><a href={l.startsWith('http') ? l : 'https://' + l} target="_blank" rel="noreferrer" className="text-xs text-blue-700 underline break-all">{l}</a></li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <form action={approveApplication}>
                  <input type="hidden" name="id" value={app.id} />
                  <button className="rounded-xl bg-[#0B1E3D] px-5 py-2 text-xs font-extrabold text-white hover:opacity-90">Approve - grant the {TIER_LABEL[app.tier]?.toLowerCase()} seal</button>
                </form>
                <form action={rejectApplication} className="flex flex-1 min-w-[260px] items-center gap-2">
                  <input type="hidden" name="id" value={app.id} />
                  <input name="reason" placeholder="Reason if rejecting" className="flex-1 rounded-xl border border-[#0B1E3D]/15 px-3 py-2 text-xs text-[#0B1E3D] outline-none focus:border-[#0B1E3D]" />
                  <button className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700 hover:bg-red-100">Reject</button>
                </form>
              </div>
            </div>
          );
        })}
        {(decided ?? []).length ? (
          <p className="mt-8 text-center text-[11px] text-[#0B1E3D]/40">
            Recent decisions: {(decided ?? []).map(d => (d.status === 'approved' ? 'granted' : 'declined') + ' ' + (TIER_LABEL[d.tier] || d.tier)).join(' - ')}
          </p>
        ) : null}
      </div>
    </main>
  );
}
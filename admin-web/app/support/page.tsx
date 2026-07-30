import Shell from '@/components/Shell';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const PILL: Record<string, string> = {
  open: 'bg-[#FBF2F2] text-[#B03A3A]',
  pending: 'bg-[#FDF6E9] text-[#B08D3F]',
  solved: 'bg-[#EBF3EE] text-[#1D7A38]',
};

export default async function SupportPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/signin');
  const svc = serviceClient();
  const { data: tickets } = await svc.from('support_tickets')
    .select('id, user_id, kind, subject, status, created_at, updated_at')
    .order('updated_at', { ascending: false }).limit(80);
  const uids = Array.from(new Set((tickets ?? []).map(t => t.user_id)));
  const people: Record<string, any> = {};
  if (uids.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username').in('id', uids);
    (data ?? []).forEach(p => { people[p.id] = p; });
  }
  const groups: Array<{ key: string; label: string }> = [
    { key: 'open', label: 'Open - the customer is waiting' },
    { key: 'pending', label: 'Pending - the ball is with the customer' },
    { key: 'solved', label: 'Solved' },
  ];
  return (
    <Shell admin={admin} active="/support" title="Support" sub="Every ticket opens into its own conversation">
      {groups.map(g => {
        const rows = (tickets ?? []).filter(t => t.status === g.key);
        return (
          <div key={g.key} className="mb-6">
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">{g.label} - {rows.length}</p>
            {rows.length === 0 ? (
              <p className="rounded-[12px] border border-[#E5E4E0] bg-white p-4 text-[12.5px] text-[#9A9DA4]">Nothing here right now.</p>
            ) : (
              <div className="overflow-hidden rounded-[12px] border border-[#E5E4E0] bg-white">
                {rows.map(t => {
                  const p = people[t.user_id] || {};
                  return (
                    <Link key={t.id} href={'/support/' + t.id} className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 last:border-0 hover:bg-[#FAFAF9]">
                      <span className={'shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold ' + (PILL[t.status] || PILL.open)}>{t.status}</span>
                      {t.kind === 'appeal' ? <span className="shrink-0 rounded-full bg-[#EFEFF4] px-2 py-0.5 text-[10.5px] font-bold text-[#5B6470]">Appeal</span> : null}
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{t.subject}</span>
                      <span className="shrink-0 text-[12px] text-[#5A5D64]">{p.full_name || '@' + (p.username || '?')}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-[#9A9DA4]">{new Date(t.updated_at || t.created_at).toLocaleString()}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </Shell>
  );
}

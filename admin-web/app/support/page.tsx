import Shell from '@/components/Shell';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const PILL: Record<string, { cls: string; label: string }> = {
  open: { cls: 'bg-[#FBF2F2] text-[#B03A3A]', label: 'Open' },
  pending: { cls: 'bg-[#FDF6E9] text-[#B08D3F]', label: 'Pending' },
  solved: { cls: 'bg-[#EBF3EE] text-[#1D7A38]', label: 'Solved' },
};

function Tile({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="flex-1 rounded-[12px] border border-[#E5E4E0] bg-white p-4">
      <p className={'text-[22px] font-bold tabular-nums leading-none ' + tone}>{n}</p>
      <p className="mt-1.5 text-[11.5px] font-medium text-[#9A9DA4]">{label}</p>
    </div>
  );
}

export default async function SupportPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/signin');
  const svc = serviceClient();
  const { data: tickets } = await svc.from('support_tickets')
    .select('id, user_id, kind, subject, status, created_at, updated_at')
    .order('updated_at', { ascending: false, nullsFirst: false }).limit(120);
  const all = tickets ?? [];
  const uids = Array.from(new Set(all.map(t => t.user_id)));
  const people: Record<string, any> = {};
  if (uids.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username').in('id', uids);
    (data ?? []).forEach(p => { people[p.id] = p; });
  }
  const counts = {
    open: all.filter(t => t.status === 'open').length,
    pending: all.filter(t => t.status === 'pending').length,
    solved: all.filter(t => t.status === 'solved').length,
  };
  const ordered = [
    ...all.filter(t => t.status === 'open'),
    ...all.filter(t => t.status === 'pending'),
    ...all.filter(t => t.status === 'solved'),
  ];
  return (
    <Shell admin={admin} active="/support" title="Support" sub="Open cases first - every ticket opens into its conversation">
      <div className="mb-5 flex gap-3">
        <Tile n={counts.open} label="Open - customer waiting" tone="text-[#B03A3A]" />
        <Tile n={counts.pending} label="Pending - with the customer" tone="text-[#B08D3F]" />
        <Tile n={counts.solved} label="Solved" tone="text-[#1D7A38]" />
      </div>
      <div className="overflow-hidden rounded-[12px] border border-[#E5E4E0] bg-white">
        <div className="grid grid-cols-[76px_1fr_180px_150px_20px] items-center gap-3 border-b border-[#E5E4E0] bg-[#FAFAF9] px-5 py-2.5 text-[10.5px] font-bold uppercase tracking-wider text-[#9A9DA4]">
          <span>Status</span><span>Ticket</span><span>Member</span><span className="text-right">Last activity</span><span></span>
        </div>
        {ordered.length === 0 ? (
          <p className="px-5 py-8 text-center text-[12.5px] text-[#9A9DA4]">No tickets yet. When a member writes from Contact support, the case appears here.</p>
        ) : ordered.map(t => {
          const p = people[t.user_id] || {};
          const pill = PILL[t.status] || PILL.open;
          return (
            <Link key={t.id} href={'/support/' + t.id}
              className="grid grid-cols-[76px_1fr_180px_150px_20px] items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 last:border-0 hover:bg-[#FAFAF9] transition-colors duration-100">
              <span className={'w-fit rounded-full px-2.5 py-1 text-[10.5px] font-bold ' + pill.cls}>{pill.label}</span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-[#26282E]">{t.subject}</span>
                {t.kind === 'appeal' ? <span className="text-[10.5px] font-bold uppercase tracking-wide text-[#5B6470]">Suspension appeal</span> : null}
              </span>
              <span className="truncate text-[12.5px] text-[#43454B]">{p.full_name || '@' + (p.username || '?')}</span>
              <span className="text-right text-[11.5px] tabular-nums text-[#9A9DA4]">{new Date(t.updated_at || t.created_at).toLocaleString()}</span>
              <span className="text-right text-[#C9CBD1]">&rsaquo;</span>
            </Link>
          );
        })}
      </div>
    </Shell>
  );
}

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function PaymentsPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();
  const { data: rows } = await svc.from('chat_payments')
    .select('id, sender_id, recipient_id, amount, currency, status, tx_id, note, error, listing_id, created_at, completed_at')
    .order('created_at', { ascending: false }).limit(50);
  const uids = Array.from(new Set((rows ?? []).flatMap(r => [r.sender_id, r.recipient_id])));
  const people: Record<string, any> = {};
  if (uids.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username').in('id', uids);
    (data ?? []).forEach(p => { people[p.id] = p; });
  }
  const week = Date.now() - 7 * 86400000;
  const inWeek = (rows ?? []).filter(r => new Date(r.created_at).getTime() > week);
  const done = inWeek.filter(r => r.status === 'completed');
  const failed = inWeek.filter(r => r.status === 'failed');
  const volume = done.reduce((a, r) => a + Number(r.amount || 0), 0);
  const name = (id: string) => people[id]?.full_name || '@' + (people[id]?.username || '?');
  const pill = (s: string) => s === 'completed'
    ? <span className="rounded-full border border-[#DCEFE0] bg-[#F2F9F3] px-2 py-0.5 text-[10.5px] font-bold text-[#1D7A38]">Completed</span>
    : s === 'failed'
    ? <span className="rounded-full border border-[#F0DEDE] bg-[#FBF2F2] px-2 py-0.5 text-[10.5px] font-bold text-[#B03A3A]">Failed</span>
    : <span className="rounded-full border border-[#F3E3C5] bg-[#FBF4E4] px-2 py-0.5 text-[10.5px] font-bold text-[#B45309]">{s}</span>;
  return (
    <Shell admin={admin} active="/payments" title="Payments" sub="Every in-chat transfer on the Crisp rail - money is the highest trust surface">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-4">
          <p className="text-[24px] font-semibold tabular-nums tracking-tight">${volume.toFixed(2)}</p>
          <p className="mt-0.5 text-[12px] font-medium text-[#7A7D84]">Volume this week</p>
        </div>
        <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-4">
          <p className="text-[24px] font-semibold tabular-nums tracking-tight">{done.length}</p>
          <p className="mt-0.5 text-[12px] font-medium text-[#7A7D84]">Completed this week</p>
        </div>
        <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-4">
          <p className={'text-[24px] font-semibold tabular-nums tracking-tight ' + (failed.length ? 'text-[#B03A3A]' : '')}>{failed.length}</p>
          <p className="mt-0.5 text-[12px] font-medium text-[#7A7D84]">Failed this week</p>
        </div>
        <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-4">
          <p className="text-[24px] font-semibold tabular-nums tracking-tight">{(rows ?? []).length}</p>
          <p className="mt-0.5 text-[12px] font-medium text-[#7A7D84]">All time shown</p>
        </div>
      </div>
      <div className="mt-6 overflow-hidden rounded-[12px] border border-[#E5E4E0] bg-white">
        <div className="grid grid-cols-[90px_1fr_1fr_110px_1fr_130px] gap-3 border-b border-[#E5E4E0] bg-[#FAFAF9] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#9A9DA4]">
          <p>Amount</p><p>From</p><p>To</p><p>Status</p><p>Reference</p><p>When</p>
        </div>
        {(rows ?? []).length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-[#9A9DA4]">No transfers yet. The first in-chat payment lands here the moment it moves.</p>
        ) : (rows ?? []).map(r => (
          <div key={r.id} className="grid grid-cols-[90px_1fr_1fr_110px_1fr_130px] items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 text-[12.5px] last:border-0">
            <p className="font-semibold tabular-nums">${Number(r.amount).toFixed(2)}</p>
            <Link href={'/users/' + r.sender_id} className="truncate text-[#0B1E3D] hover:underline">{name(r.sender_id)}</Link>
            <Link href={'/users/' + r.recipient_id} className="truncate text-[#0B1E3D] hover:underline">{name(r.recipient_id)}</Link>
            <p>{pill(r.status)}</p>
            <p className="truncate text-[11px] tabular-nums text-[#9A9DA4]" title={r.error || ''}>{r.error ? 'ERR: ' + r.error : (r.tx_id ? r.tx_id.slice(0, 13) : '-')}{r.listing_id ? ' - listing' : ''}</p>
            <p className="tabular-nums text-[11.5px] text-[#9A9DA4]">{new Date(r.created_at).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </Shell>
  );
}
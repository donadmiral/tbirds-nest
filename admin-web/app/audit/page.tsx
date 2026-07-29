import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();
  const { data: rows } = await svc.from('admin_audit_log')
    .select('id, admin_id, action, target_kind, target_id, reason, created_at')
    .order('created_at', { ascending: false }).limit(100);
  return (
    <Shell admin={admin} active="/audit" title="Audit log" sub="Every administrative action, immutable, newest first">
      <div className="overflow-hidden rounded-[12px] border border-[#E8E6E1] bg-white">
        <div className="grid grid-cols-[150px_1fr_2fr] gap-4 border-b border-[#E8E6E1] bg-[#FAFAF9] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#9A9DA4]">
          <p>When</p><p>Action</p><p>Detail</p>
        </div>
        {(rows ?? []).length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-[#9A9DA4]">Nothing yet.</p>
        ) : (rows ?? []).map(r => (
          <div key={r.id} className="grid grid-cols-[150px_1fr_2fr] gap-4 border-b border-[#F0EFEC] px-5 py-3 text-[12.5px] last:border-0">
            <p className="tabular-nums text-[#7A7D84]">{new Date(r.created_at).toLocaleString()}</p>
            <p className="font-semibold">{r.action.replace(/[._]/g, ' ')}</p>
            <p className="truncate text-[#5A5D64]">{r.reason}<span className="text-[#B4B6BB]"> - {r.target_kind} {String(r.target_id).slice(0, 8)}</span></p>
          </div>
        ))}
      </div>
    </Shell>
  );
}
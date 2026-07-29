import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import Seal from '@/components/Seal';

export const dynamic = 'force-dynamic';

export default async function BusinessesPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();
  const { data: bizs } = await svc.from('profiles')
    .select('id, full_name, username, avatar_url, is_verified, verified_tier, created_at, deactivated_at')
    .eq('account_type', 'business')
    .order('created_at', { ascending: false }).limit(50);
  const ids = (bizs ?? []).map(b => b.id);
  const counts: Record<string, number> = {};
  if (ids.length) {
    const { data: members } = await svc.from('business_members').select('business_id').in('business_id', ids);
    (members ?? []).forEach(m => { counts[m.business_id] = (counts[m.business_id] || 0) + 1; });
  }
  return (
    <Shell admin={admin} active="/businesses" title="Businesses" sub="Every registered business on the platform - space grey is earned on the verification desk">
      <div className="rounded-[12px] border border-[#E8E6E1] bg-white">
        {(bizs ?? []).length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-[#9A9DA4]">No business accounts yet. When one registers in the app, it appears here.</p>
        ) : (bizs ?? []).map(b => (
          <div key={b.id} className="flex items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 last:border-0">
            {b.avatar_url
              ? <img src={b.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
              : <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#ECEBE7] text-[12px] font-bold text-[#5A5D64]">{String(b.full_name || '?').slice(0, 1)}</div>}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 truncate text-[13px] font-semibold">{b.full_name || 'Unnamed'}{(b.verified_tier || b.is_verified) ? <Seal tier={b.verified_tier || 'business'} size={14} /> : null}<span className="font-normal text-[#9A9DA4]">@{b.username || '-'}</span></p>
              <p className="text-[11.5px] text-[#9A9DA4]">{counts[b.id] || 0} team member{(counts[b.id] || 0) === 1 ? '' : 's'} - joined {new Date(b.created_at).toLocaleDateString()}{b.deactivated_at ? ' - SUSPENDED' : ''}</p>
            </div>
            <Link href={'/users?q=' + encodeURIComponent(b.username || '')} className="shrink-0 rounded-[8px] border border-[#E8E6E1] px-3 py-1.5 text-[11.5px] font-semibold text-[#5A5D64] transition-colors duration-150 hover:bg-[#F0EFEC] hover:text-[#17181C]">Open</Link>
          </div>
        ))}
      </div>
    </Shell>
  );
}
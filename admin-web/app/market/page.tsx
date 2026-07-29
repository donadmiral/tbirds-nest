import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { adminRemoveListing } from '@/lib/actions';
import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function MarketPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();
  const { data: listings } = await svc.from('marketplace_listings')
    .select('id, seller_id, title, price, status, created_at')
    .order('created_at', { ascending: false }).limit(25);
  const uids = Array.from(new Set((listings ?? []).map(l => l.seller_id)));
  const people: Record<string, any> = {};
  if (uids.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username').in('id', uids);
    (data ?? []).forEach(p => { people[p.id] = p; });
  }
  return (
    <Shell admin={admin} active="/market" title="Market" sub="Live listings across the platform">
      <div className="overflow-hidden rounded-[12px] border border-[#E8E6E1] bg-white">
        <div className="grid grid-cols-[2fr_90px_110px_1fr_130px_90px] gap-3 border-b border-[#E8E6E1] bg-[#FAFAF9] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#9A9DA4]">
          <p>Listing</p><p>Price</p><p>Status</p><p>Seller</p><p>Listed</p><p></p>
        </div>
        {(listings ?? []).length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-[#9A9DA4]">No listings yet.</p>
        ) : (listings ?? []).map(l => {
          const s = people[l.seller_id] || {};
          return (
            <div key={l.id} className="grid grid-cols-[2fr_90px_110px_1fr_130px_90px] items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 text-[12.5px] last:border-0">
              <p className="truncate font-semibold">{l.title}</p>
              <p className="tabular-nums">${l.price}</p>
              <p>{l.status === 'available'
                ? <span className="rounded-full border border-[#DCEFE0] bg-[#F2F9F3] px-2 py-0.5 text-[10.5px] font-bold text-[#1D7A38]">Available</span>
                : <span className="rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[10.5px] font-bold text-[#7A7D84]">{l.status}</span>}</p>
              <Link href={'/users?q=' + encodeURIComponent(s.username || '')} className="truncate text-[#0B1E3D] hover:underline">{s.full_name || '@' + (s.username || '?')}</Link>
              <p className="tabular-nums text-[#9A9DA4]">{new Date(l.created_at).toLocaleDateString()}</p>
              <form action={adminRemoveListing} className="justify-self-end">
                <input type="hidden" name="lid" value={l.id} />
                <button className="rounded-[8px] border border-[#F0DEDE] bg-[#FBF2F2] px-3 py-1 text-[11px] font-bold text-[#B03A3A] transition-colors duration-150 hover:bg-[#F6E4E4]">Remove</button>
              </form>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
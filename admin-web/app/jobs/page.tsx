import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function JobsPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  const svc = serviceClient();
  const { data: jobs } = await svc.from('jobs')
    .select('id, posted_by, title, company, location, job_type, created_at')
    .order('created_at', { ascending: false }).limit(25);
  const uids = Array.from(new Set((jobs ?? []).map(j => j.posted_by)));
  const people: Record<string, any> = {};
  if (uids.length) {
    const { data } = await svc.from('profiles').select('id, full_name, username').in('id', uids);
    (data ?? []).forEach(p => { people[p.id] = p; });
  }
  return (
    <Shell admin={admin} active="/jobs" title="Jobs" sub="Open roles posted across the platform">
      <div className="overflow-hidden rounded-[12px] border border-[#E8E6E1] bg-white">
        <div className="grid grid-cols-[2fr_1fr_1fr_110px_1fr_120px] gap-3 border-b border-[#E8E6E1] bg-[#FAFAF9] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#9A9DA4]">
          <p>Role</p><p>Company</p><p>Location</p><p>Type</p><p>Posted by</p><p>Posted</p>
        </div>
        {(jobs ?? []).length === 0 ? (
          <p className="px-5 py-12 text-center text-[13px] text-[#9A9DA4]">No roles yet.</p>
        ) : (jobs ?? []).map(j => {
          const p = people[j.posted_by] || {};
          return (
            <div key={j.id} className="grid grid-cols-[2fr_1fr_1fr_110px_1fr_120px] items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 text-[12.5px] last:border-0">
              <p className="truncate font-semibold">{j.title}</p>
              <p className="truncate text-[#5A5D64]">{j.company}</p>
              <p className="truncate text-[#5A5D64]">{j.location || '-'}</p>
              <p className="text-[#5A5D64]">{(j.job_type || '-').replace(/_/g, ' ')}</p>
              <Link href={'/users?q=' + encodeURIComponent(p.username || '')} className="truncate text-[#0B1E3D] hover:underline">{p.full_name || '@' + (p.username || '?')}</Link>
              <p className="tabular-nums text-[#9A9DA4]">{new Date(j.created_at).toLocaleDateString()}</p>
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
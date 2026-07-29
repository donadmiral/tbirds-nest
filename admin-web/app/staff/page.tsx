import { redirect } from 'next/navigation';
import { getAdmin } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { inviteStaff, setStaffRole, deactivateStaff } from '@/lib/actions';
import Shell from '@/components/Shell';

export const dynamic = 'force-dynamic';

const ROLES = ['super_admin', 'platform_admin', 'trust_safety', 'support_agent', 'ops_engineer', 'market_reviewer', 'jobs_reviewer', 'verification_reviewer', 'finance_admin', 'analyst', 'auditor_readonly'];

export default async function StaffPage() {
  const admin = await getAdmin();
  if (!admin) redirect('/');
  if (admin.role !== 'super_admin') redirect('/dashboard');
  const svc = serviceClient();
  const { data: staff } = await svc.from('admin_users').select('user_id, role, active, created_at').order('created_at', { ascending: true });
  const { data: authList } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
  const emails: Record<string, string> = {};
  (authList?.users ?? []).forEach((u: any) => { emails[u.id] = u.email || ''; });
  return (
    <Shell admin={admin} active="/staff" title="Staff" sub="Who holds keys to this desk - invite, assign a role, deactivate">
      <div className="rounded-[12px] border border-[#E5E4E0] bg-white p-5">
        <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-[#9A9DA4]">Invite an administrator</p>
        <form action={inviteStaff} className="flex flex-wrap items-center gap-2">
          <input name="email" type="email" required placeholder="Email" className="min-w-[220px] flex-1 rounded-[10px] border border-[#E5E4E0] px-3 py-2 text-[13px] outline-none focus:border-[#B9BCC2]" />
          <input name="password" type="text" required minLength={10} placeholder="Temporary password (10+)" className="min-w-[200px] flex-1 rounded-[10px] border border-[#E5E4E0] px-3 py-2 text-[13px] outline-none focus:border-[#B9BCC2]" />
          <select name="role" className="rounded-[10px] border border-[#E5E4E0] bg-white px-3 py-2 text-[13px] outline-none">
            {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </select>
          <button className="rounded-[10px] bg-[#0B1E3D] px-4 py-2 text-[12px] font-bold text-white transition-opacity duration-150 hover:opacity-90">Invite</button>
        </form>
        <p className="mt-2 text-[11px] text-[#9A9DA4]">A deactivated shell profile is created automatically - staff identities are never social.</p>
      </div>
      <div className="mt-5 overflow-hidden rounded-[12px] border border-[#E5E4E0] bg-white">
        <div className="grid grid-cols-[2fr_1fr_120px_170px] gap-3 border-b border-[#E5E4E0] bg-[#FAFAF9] px-5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[#9A9DA4]">
          <p>Administrator</p><p>Role</p><p>Status</p><p></p>
        </div>
        {(staff ?? []).map(s => (
          <div key={s.user_id} className="grid grid-cols-[2fr_1fr_120px_170px] items-center gap-3 border-b border-[#F0EFEC] px-5 py-3 text-[12.5px] last:border-0">
            <p className="truncate font-semibold">{emails[s.user_id] || s.user_id.slice(0, 8)}{s.user_id === admin.id ? <span className="ml-1.5 text-[10.5px] font-bold text-[#9A9DA4]">you</span> : null}</p>
            <form action={setStaffRole} className="flex items-center gap-1.5">
              <input type="hidden" name="uid" value={s.user_id} />
              <select name="role" defaultValue={s.role} className="rounded-[8px] border border-[#E5E4E0] bg-white px-2 py-1 text-[12px] outline-none">
                {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
              </select>
              <button className="rounded-[8px] border border-[#E5E4E0] px-2.5 py-1 text-[11px] font-semibold text-[#5A5D64] hover:bg-[#F0EFEC]">Set</button>
            </form>
            <p>{s.active
              ? <span className="rounded-full border border-[#DCEFE0] bg-[#F2F9F3] px-2 py-0.5 text-[10.5px] font-bold text-[#1D7A38]">Active</span>
              : <span className="rounded-full bg-[#F4F3F0] px-2 py-0.5 text-[10.5px] font-bold text-[#7A7D84]">Deactivated</span>}</p>
            {s.user_id !== admin.id && s.active ? (
              <form action={deactivateStaff} className="justify-self-end">
                <input type="hidden" name="uid" value={s.user_id} />
                <button className="rounded-[8px] border border-[#F0DEDE] bg-[#FBF2F2] px-3 py-1 text-[11px] font-bold text-[#B03A3A] hover:bg-[#F6E4E4]">Deactivate</button>
              </form>
            ) : <span />}
          </div>
        ))}
      </div>
    </Shell>
  );
}
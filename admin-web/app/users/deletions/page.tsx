import Link from 'next/link';
import Shell from '@/components/Shell';
import { requirePermission } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
type Request = { id: string; user_id: string; reason: string; status: string; created_at: string; full_name: string | null; username: string | null };

export default async function DeletionRequests({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const admin = await requirePermission('account_delete');
  const params = await searchParams;
  const page = /^\d{1,4}$/.test(params.page || '') ? Math.max(1, Number(params.page)) : 1;
  const { data, error } = await serviceClient().rpc('triniti_admin_deletion_requests', {
    p_actor_id: admin.id, p_session_id: admin.sessionId, p_page: page,
  });
  if (error || !Array.isArray(data?.rows) || !Number.isSafeInteger(data?.total)) throw new Error('Deletion requests could not be loaded.');
  const rows = data.rows as Request[];
  return <Shell admin={admin} active="/users" title="Deletion requests" sub="Disabled accounts awaiting review of retention and outstanding obligations.">
    <p className="mb-4 text-sm text-[#6B6E76]">Sign-in is disabled when a request is created. Financial, order and audit records remain intact. A request is not confirmation that personal data has been erased.</p>
    <Link href="/users" className="text-sm underline">Back to users</Link>
    <div className="my-4 space-y-3">
      {rows.map(row => <article key={row.id} className="rounded-xl border border-[#E5E4E0] bg-white p-4">
        <Link className="font-semibold underline" href={'/users/' + row.user_id}>{row.full_name || row.username || row.user_id}</Link>
        <p className="mt-1 text-sm">{row.status.replaceAll('_', ' ')} · {new Date(row.created_at).toLocaleString()}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm text-[#6B6E76]">{row.reason}</p>
      </article>)}
      {rows.length === 0 && <p className="py-8 text-sm">No deletion requests on this page.</p>}
    </div>
    <nav aria-label="Deletion request pages" className="flex gap-4 text-sm">
      <span>{data.total} requests · Page {page}</span>
      {page > 1 && <Link href={'/users/deletions?page=' + (page - 1)}>Previous</Link>}
      {page * 50 < data.total && <Link href={'/users/deletions?page=' + (page + 1)}>Next</Link>}
    </nav>
  </Shell>;
}

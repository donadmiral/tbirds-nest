import Link from 'next/link';
import Shell from '@/components/Shell';
import { requirePermission } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import { isMissingAdminRpc } from '@/lib/adminRpcAvailability';
import { ERASURE_HOLDS } from '@/lib/adminErasureReview';
import CommandForm from '@/components/CommandForm';
import { reviewErasure } from './actions';

export const dynamic = 'force-dynamic';
type Request = { id: string; source?: 'admin' | 'self_service'; user_id: string | null; reason: string | null;
  status: string; created_at: string; full_name: string | null; username: string | null; version?: string;
  files_total?: number | null; files_erased?: number | null; hold_reason?: string | null;
  completed_at?: string | null; attempts?: number | null; identity_prepared?: boolean | null;
  last_review?: { note: string; action: string; outcome: string; created_at: string } | null };

export default async function DeletionRequests({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const admin = await requirePermission('account_delete');
  const params = await searchParams;
  const page = /^\d{1,4}$/.test(params.page || '') ? Math.max(1, Number(params.page)) : 1;
  const { data, error } = await serviceClient().rpc('triniti_admin_deletion_requests', {
    p_actor_id: admin.id, p_session_id: admin.sessionId, p_page: page,
  });
  if (isMissingAdminRpc(error, 'triniti_admin_deletion_requests')) {
    return <Shell admin={admin} active="/users" title="Deletion requests" sub="The deletion review queue is unavailable on this deployment.">
      <p role="status" className="my-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5">Deletion requests cannot be loaded until the review service is available. This page does not confirm that there are no pending requests or that any personal data has been erased. Contact the platform administrator.</p>
      <nav aria-label="Deletion queue recovery" className="flex flex-wrap gap-4 text-sm">
        <Link href="/users" className="underline">Back to users</Link>
        <a href={'/users/deletions?page=' + page} className="underline">Check availability again</a>
      </nav>
    </Shell>;
  }
  if (error || !Array.isArray(data?.rows) || !Number.isSafeInteger(data?.total)) throw new Error('Deletion requests could not be loaded.');
  const rows = data.rows as Request[];
  return <Shell admin={admin} active="/users" title="Deletion requests" sub="Review retention holds and follow verified erasure progress.">
    <p className="mb-4 text-sm text-[var(--txt-muted)]">Sign-in is disabled when a request is created. Financial, managed-account and ownership holds cannot be overridden here. Resuming an eligible request starts irreversible stored-file and account erasure; a queued request is not confirmation of completion.</p>
    <Link href="/users" className="text-sm underline">Back to users</Link>
    <div className="my-4 space-y-3">
      {rows.map(row => <article key={`${row.source || 'admin'}:${row.id}`} className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>{row.user_id && row.status !== 'completed' && !row.identity_prepared ? <Link className="font-semibold underline" href={'/users/' + row.user_id}>{row.full_name || row.username || row.user_id}</Link> : <strong>{row.status === 'completed' ? 'Completed account erasure' : 'Account identity pending deletion'}</strong>}
            <p className="mt-1 text-sm text-[var(--txt-muted)]">{row.source === 'self_service' ? 'Member request' : 'Staff request'} · {new Date(row.created_at).toLocaleString()}</p></div>
          <span className="rounded-full border border-[var(--line)] px-3 py-1 text-xs font-semibold">{row.status.replaceAll('_', ' ')}</span>
        </div>
        {row.reason && row.source !== 'self_service' && <p className="mt-3 whitespace-pre-wrap text-sm">{row.reason}</p>}
        {row.hold_reason && <p role="status" className="mt-3 text-sm text-[var(--txt-muted)]">{ERASURE_HOLDS[row.hold_reason] || 'This request requires investigation before erasure can continue.'}</p>}
        {row.status === 'retention_review' && row.files_total === 0 && !row.identity_prepared
          ? <p className="mt-3 text-sm">Stored-file inventory is awaiting review. Account erasure remains incomplete.</p>
          : Number.isSafeInteger(row.files_total) && Number.isSafeInteger(row.files_erased) && <p className="mt-3 text-sm">{row.files_erased} of {row.files_total} stored files verified erased. {row.status !== 'completed' && 'Account erasure remains incomplete.'}</p>}
        {row.completed_at && <p className="mt-2 text-sm">Verified complete: {new Date(row.completed_at).toLocaleString()}</p>}
        {row.last_review && <aside className="mt-4 rounded-lg bg-[var(--bg)] p-3 text-sm" aria-label="Latest operator review">
          <p className="font-semibold">Latest review · {row.last_review.outcome.replaceAll('_', ' ')} · {new Date(row.last_review.created_at).toLocaleString()}</p>
          <p className="mt-1 whitespace-pre-wrap">{row.last_review.note}</p>
        </aside>}
        {data.operator_review_available === true && row.version && row.source && <CommandForm key={`${row.source}:${row.id}:${row.version}`} scope={`erasure-${row.source}-${row.id}`} action={reviewErasure} className="mt-4 space-y-3 border-t border-[var(--line)] pt-4">
          <input type="hidden" name="source" value={row.source} /><input type="hidden" name="request_id" value={row.id} /><input type="hidden" name="version" value={row.version} />
          <label className="block text-sm font-semibold">Review note
            <textarea name="note" required minLength={20} maxLength={2000} rows={3} className="mt-2 block w-full rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3 font-normal text-[var(--txt)]" placeholder="Record the investigation and the basis for your action (20–2,000 characters)." />
          </label>
          {row.status === 'retention_review' && <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirm" value="RESUME" className="mt-1" />
            <span>I authorize irreversible erasure to resume only if the current retention, ownership and worker checks pass. Existing holds must remain in place.</span></label>}
          <div className="flex flex-wrap gap-3">
            <button type="submit" name="action" value="note" className="pc-button">Add review note</button>
            {row.status === 'retention_review' && <button type="submit" name="action" value="resume" className="pc-button pc-button-primary">Recheck and resume eligible erasure</button>}
          </div>
        </CommandForm>}
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

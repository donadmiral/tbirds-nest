import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { requireDesk } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import {
  creatorFinanceCursor,
  creatorFinanceDate,
  creatorFinanceFailure,
  creatorFinanceHref,
  parseCreatorFinanceReport,
  type CreatorFinanceReport,
  type CreatorFinanceSearch,
} from '@/lib/creatorFinanceReport';
import Shell from '@/components/Shell';
import AdminIcon from '@/components/AdminIcon';
import ReviewForm from './ReviewForm';
import { ENROLLMENT_LABELS, PAYOUT_LABELS, formatMinor } from '../../../../shared/monetization/domain';
import { providerIssue } from '../../../../shared/payments/providerStatus';
import { FINANCE_OPERATIONS_ENABLED } from '../../../../shared/monetization/availability';

export const dynamic = 'force-dynamic';
const PANEL = { background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: 20 };
const MUTED = { color: 'var(--txt-muted)' };

export default async function CreatorFinancePage({ searchParams }: { searchParams: Promise<CreatorFinanceSearch> }) {
  const admin = await requireDesk('/payments');
  if (!['super_admin', 'platform_admin', 'finance_admin'].includes(admin.role)) notFound();
  const search = creatorFinanceCursor(await searchParams);
  if (!search.valid) return <Shell admin={admin} active="/payments" title="Creator finance" sub="Enrollment and payout records">
    <section style={PANEL} aria-labelledby="finance-page-error">
      <h2 id="finance-page-error" className="text-lg font-semibold">This page link is incomplete</h2>
      <p className="my-3" role="alert">The creator page could not be identified. Open the first page to continue.</p>
      <Link className="pc-button" href="/payments/creators">Open first page</Link>
      <Link className="pc-button ml-2" href="/payments">Back to payments</Link>
    </section>
  </Shell>;

  let report: CreatorFinanceReport;
  try {
    const { data, error } = await serviceClient().rpc('creator_finance_admin_snapshot', {
      p_actor: admin.id,
      p_session: admin.sessionId,
      p_before_at: search.cursor?.updated_at ?? null,
      p_before_id: search.cursor?.user_id ?? null,
    });
    if (error) throw new Error(error.message);
    report = parseCreatorFinanceReport(data);
  } catch (error) {
    const failure = creatorFinanceFailure(error instanceof Error ? error.message : undefined);
    return <Shell admin={admin} active="/payments" title="Creator finance" sub="Enrollment and payout records">
      <section style={PANEL} aria-labelledby="finance-load-error">
        <h2 id="finance-load-error" className="text-lg font-semibold">Records unavailable</h2>
        <p className="my-3" role="alert">{failure.message}</p>
        <Link className="pc-button pc-button-primary" href={failure.action === 'Retry' ? creatorFinanceHref(search.cursor) : failure.href}>{failure.action}</Link>
        <Link className="pc-button ml-2" href="/payments">Back to payments</Link>
      </section>
    </Shell>;
  }

  const { enrollments, payouts } = report;
  const environmentLabel = report.environment === 'test' ? 'Test records' : 'Live records';
  const unconfirmed = payouts.filter(payout => ['requested', 'submitted', 'unknown'].includes(payout.status)).length;

  return <Shell admin={admin} active="/payments" title="Creator finance" sub="Enrollment and payout records">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <Link className="pc-button" href="/payments"><AdminIcon name="chevronLeft" size={16} />Back to payments</Link>
      <Link className="pc-button" href={creatorFinanceHref(search.cursor)}><AdminIcon name="refresh" size={16} />Refresh records</Link>
    </div>
    <section style={PANEL} aria-labelledby="finance-reporting-status">
      <h2 id="finance-reporting-status" className="text-base font-semibold">Read-only reporting</h2>
      <p className="mt-2 text-sm" style={MUTED}>Enrollment records and recorded payout activity are available here. Creator approvals, payouts and finalized statements are unavailable in this release.</p>
      <p className="mt-2 text-sm" style={MUTED}>The record environment does not confirm a working provider connection or authorize a payout. Live payouts also require an approved funding connection, mandate and payout permission.</p>
    </section>
    <dl className="my-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        { label: 'Record environment', value: environmentLabel, note: 'Stored program configuration' },
        { label: 'Enrollment', value: report.enrollment_open ? 'Open' : 'Closed', note: 'Current enrollment setting' },
        { label: 'Creators on this page', value: String(enrollments.length), note: 'Up to 50 records per page' },
        { label: 'Unconfirmed payouts', value: String(unconfirmed), note: 'Within the latest 50 requests' },
      ].map(card => <div key={card.label} style={PANEL}>
        <dt className="text-sm" style={MUTED}>{card.label}</dt>
        <dd className="mt-2 text-xl font-semibold">{card.value}</dd>
        <dd className="mt-1 text-xs" style={MUTED}>{card.note}</dd>
      </div>)}
    </dl>
    <section style={PANEL} aria-labelledby="creator-records-title">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><h2 id="creator-records-title" className="text-lg font-semibold">Creator enrollment records</h2><p className="mt-1 text-sm" style={MUTED}>Most recently updated first. Open a creator to review their account.</p></div>
        {search.cursor && <Link className="pc-button" href="/payments/creators">First page</Link>}
      </div>
      {!enrollments.length ? <p className="py-6 text-center text-sm" style={MUTED}>No creator enrollment records on this page.</p> : <div className="space-y-3">{enrollments.map(enrollment => <article key={enrollment.user_id} className="rounded-lg p-4" style={{ border: '1px solid var(--line)' }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold"><Link className="underline underline-offset-4" href={'/users/' + enrollment.user_id}>Creator {enrollment.user_id.slice(0, 8)}</Link></h3>
          <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'var(--panel-2)' }}>{ENROLLMENT_LABELS[enrollment.status]}</span>
        </div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt style={MUTED}>Terms accepted</dt><dd>{enrollment.accepted_terms_version || 'Not accepted'}</dd></div>
          <div><dt style={MUTED}>Last updated</dt><dd><time dateTime={enrollment.updated_at}>{creatorFinanceDate(enrollment.updated_at)}</time></dd></div>
        </dl>
        {enrollment.public_reason && <div className="mt-3 text-sm"><p className="font-medium">Reason shown to creator</p><p className="mt-1 whitespace-pre-wrap break-words" style={MUTED}>{enrollment.public_reason}</p></div>}
        {FINANCE_OPERATIONS_ENABLED && <ReviewForm userId={enrollment.user_id} updatedAt={enrollment.updated_at} status={enrollment.status} commandKey={randomUUID()} />}
      </article>)}</div>}
      {report.next_cursor && <nav className="mt-4 flex justify-end" aria-label="Creator enrollment pages"><Link className="pc-button" href={creatorFinanceHref(report.next_cursor)}>Next creator page<AdminIcon name="chevronRight" size={16} /></Link></nav>}
    </section>
    <section className="mt-4" style={PANEL} aria-labelledby="payout-activity-title">
      <h2 id="payout-activity-title" className="text-lg font-semibold">Latest payout activity</h2>
      <p className="mb-4 mt-1 text-sm" style={MUTED}>Up to 50 most recent requests across all creators. Unknown outcomes stay reserved until the provider confirms them.</p>
      {!payouts.length ? <p className="py-6 text-center text-sm" style={MUTED}>No payout requests have been recorded.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
        <caption className="sr-only">Recorded payout requests, amounts, environments and provider outcomes</caption>
        <thead><tr>{['Creator', 'Amount', 'Environment', 'Status', 'Provider reference', 'Created'].map(heading => <th scope="col" key={heading} className="px-3 py-3 font-semibold" style={{ borderBottom: '1px solid var(--line)' }}>{heading}</th>)}</tr></thead>
        <tbody>{payouts.map(payout => <tr key={payout.id}>
          <td className="px-3 py-3"><Link href={'/users/' + payout.user_id} className="underline underline-offset-4">Creator {payout.user_id.slice(0, 8)}</Link></td>
          <td className="whitespace-nowrap px-3 py-3">{formatMinor(payout.amount_minor, payout.currency)}</td>
          <td className="px-3 py-3">{payout.environment === 'test' ? 'Test' : 'Live'}</td>
          <td className="px-3 py-3">{PAYOUT_LABELS[payout.status]}{payout.last_error && <span className="mt-1 block max-w-sm text-xs" style={MUTED}>{providerIssue(payout.last_error)?.operatorMessage || 'Outcome unconfirmed. Reconcile the existing reference before retrying.'}</span>}</td>
          <td className="max-w-xs break-all px-3 py-3">{payout.provider_reference || 'Not confirmed'}</td>
          <td className="whitespace-nowrap px-3 py-3"><time dateTime={payout.created_at}>{creatorFinanceDate(payout.created_at)}</time></td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  </Shell>;
}

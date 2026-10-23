import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { requireDesk } from '@/lib/adminAuth';
import { serviceClient } from '@/lib/supabaseAdmin';
import Shell from '@/components/Shell';
import ReviewForm from './ReviewForm';
import { formatMinor } from '../../../../shared/monetization/domain';
export const dynamic='force-dynamic';
type Enrollment={user_id:string;status:string;accepted_terms_version:string|null;public_reason:string|null;updated_at:string};
type Payout={id:string;user_id:string;currency:string;amount_minor:string;environment:string;status:string;provider_reference:string|null;last_error:string|null;created_at:string};
export default async function CreatorFinancePage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const admin=await requireDesk('/payments');if(!['super_admin','platform_admin','finance_admin'].includes(admin.role))notFound();
  const query=await searchParams;
  const beforeAt=typeof query.before_at==='string'?query.before_at:null,beforeId=typeof query.before_id==='string'?query.before_id:null;
  const {data,error}=await serviceClient().rpc('creator_finance_admin_snapshot',{p_actor:admin.id,p_session:admin.sessionId,p_before_at:beforeAt,p_before_id:beforeId});
  if(error || !data || !Array.isArray(data.enrollments) || !Array.isArray(data.payouts))return <Shell admin={admin} active="/payments" title="Creator finance" sub="Creator records"><p role="alert">Creator finance could not be loaded. Refresh to retry.</p></Shell>;
  const users=data.enrollments as Enrollment[],payouts=data.payouts as Payout[];
  return <Shell admin={admin} active="/payments" title="Creator finance" sub={`IntoBank · ${data.environment==='test'?'Sandbox records, no live earnings':'Live records'} · Enrollment ${data.enrollment_open?'open':'closed'}`}>
    <Link className="inline-flex min-h-11 items-center underline" href="/payments">Back to payments</Link>
    <section className="mt-4 space-y-3"><h2 className="text-lg font-semibold">Creator reviews</h2><p>Up to 50 creators per page. Approval does not enable unverified payout accounts.</p>
      {!users.length&&<p>No creators in this page.</p>}{users.map(e=><article key={e.user_id} className="rounded-xl border p-4" style={{background:'var(--panel)'}}><Link className="underline" href={'/users/'+e.user_id}>{e.user_id}</Link><p>{e.status} · Terms {e.accepted_terms_version||'not accepted'}</p>{e.public_reason&&<p>{e.public_reason}</p>}<ReviewForm userId={e.user_id} updatedAt={e.updated_at} status={e.status} commandKey={randomUUID()}/></article>)}
      {data.next_cursor&&<Link className="inline-flex min-h-11 items-center underline" href={'/payments/creators?'+new URLSearchParams({before_at:data.next_cursor.updated_at,before_id:data.next_cursor.user_id}).toString()}>Next 50 creators</Link>}
    </section>
    <section className="mt-6"><h2 className="text-lg font-semibold">Latest payout activity</h2><p className="mb-3">Latest {payouts.length} requests, up to 50. Unknown outcomes remain reserved until the provider confirms them.</p>
      {!payouts.length?<p>No payout requests recorded.</p>:<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Creator','Amount','Environment','Status','Provider reference','Created'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{payouts.map(p=><tr key={p.id}><td className="p-2"><Link href={'/users/'+p.user_id} className="underline">{p.user_id}</Link></td><td className="p-2 whitespace-nowrap">{formatMinor(p.amount_minor,p.currency)}</td><td className="p-2">{p.environment}</td><td className="p-2">{p.status}{p.last_error&&<span className="block">Awaiting confirmation</span>}</td><td className="p-2">{p.provider_reference||'Not confirmed'}</td><td className="p-2 whitespace-nowrap">{new Date(p.created_at).toLocaleString()}</td></tr>)}</tbody></table></div>}
    </section>
  </Shell>;
}

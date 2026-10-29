import { createIntoBankSandboxProvider, validateInstruction, PayoutProviderError } from './provider.ts';
import type { Instruction } from './provider.ts';
type Result = { data: unknown; error: unknown };
type Deps = {
  db: { rpc(name: string, args: Record<string, unknown>): PromiseLike<Result> };
  serviceKey: string; crispUrl: string; crispKey: string; environment: string; fetcher: typeof fetch;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
async function equalSecret(actual: string, expected: string) {
  if (!actual || expected.length < 32) return false;
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a,b] = await Promise.all([hash(actual),hash(expected)]); let difference=0;
  for (let n=0;n<a.length;n++) difference |= a[n]^b[n];
  return difference===0;
}
export function createPayoutHandler(deps: Deps) {
  return async (req: Request) => {
    if (req.method !== 'POST') return json({ error: 'POST_REQUIRED' },405);
    if (!await equalSecret((req.headers.get('Authorization') || '').replace(/^Bearer\s+/i,''),deps.serviceKey)) return json({ error: 'SERVICE_AUTH_REQUIRED' },401);
    // No test response may ever settle a live earnings record.
    let provider: ReturnType<typeof createIntoBankSandboxProvider>;
    try { provider=createIntoBankSandboxProvider({url:deps.crispUrl,key:deps.crispKey,environment:deps.environment,fetcher:deps.fetcher}); }
    catch { return json({ error:'CREATOR_PAYOUT_PROVIDER_NOT_READY' },503); }
    const lease=crypto.randomUUID();
    const limit=new URL(req.url).searchParams.get('limit') || '5';
    if (!/^(?:[1-9]|1[0-9]|20)$/.test(limit)) return json({error:'INVALID_LIMIT'},400);
    let claimed: Result;
    try { claimed=await deps.db.rpc('creator_claim_payouts',{p_worker:lease,p_limit:Number(limit),p_environment:'test'}); }
    catch { return json({error:'PAYOUT_QUEUE_UNAVAILABLE'},503); }
    if (claimed.error || !Array.isArray(claimed.data)) return json({error:'PAYOUT_QUEUE_UNAVAILABLE'},503);
    const deadline=Date.now()+20000;
    let processed=0, completed=0, pending=0, errors=0;
    for (const instruction of claimed.data as Instruction[]) {
      if (Date.now()>=deadline) break;
      let outcome=null, failure: string | null=null;
      try {
        validateInstruction(instruction);
        const signal=AbortSignal.timeout(Math.max(1,Math.min(8000,deadline-Date.now())));
        if (instruction.dispatch_started) outcome=await provider.reconcile(instruction,signal);
        else {
          const begun=await deps.db.rpc('creator_begin_payout_dispatch',{p_id:instruction.id,p_lease:lease});
          if (begun.error || begun.data!==true) throw new Error('PAYOUT_DISPATCH_NOT_CONFIRMED');
          outcome=await provider.submit(instruction,signal);
        }
        if (!outcome) failure='PAYOUT_PROVIDER_UNCONFIRMED';
      } catch (error) { failure=error instanceof PayoutProviderError ? error.diagnostic : 'PAYOUT_PROVIDER_UNCONFIRMED'; }
      try {
        const finished=await deps.db.rpc('creator_finish_payout_attempt',{p_id:instruction.id,p_lease:lease,p_outcome:outcome,p_error:failure});
        if (finished.error || typeof finished.data!=='string') throw new Error('PAYOUT_RECORD_UNCONFIRMED');
        if (finished.data==='completed') completed++; else if (!['rejected'].includes(finished.data)) pending++;
        if (failure) errors++;
      } catch { errors++; }
      processed++;
    }
    return json({success:errors===0,environment:'test',processed,completed,pending,errors,remaining_in_batch:claimed.data.length-processed},errors?503:200);
  };
}

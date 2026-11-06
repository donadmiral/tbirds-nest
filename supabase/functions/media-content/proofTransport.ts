import { serviceRoleFetch } from '../_shared/serviceRoleFetch.ts';

export type ProofStage = 'authorization' | 'revalidation' | 'variant_selection' | 'variant_revalidation';
type Attempt = { stage: ProofStage; number: number; started: number; sent?: number; headers?: number; finished?: number; status?: number; result?: 'ok' | 'refused' | 'error' | 'transport_timeout' | 'cancelled' };
export type ProofBudget = { until: number; retried: boolean; attempts: Attempt[] };
export function proofDiagnostics(budget: ProofBudget, now = Date.now()) {
  return budget.attempts.map(a => {
    const end = a.finished ?? now;
    return { stage:a.stage, attempt:a.number, result:a.result ?? 'pending',
      phase:a.result==='ok' || a.result==='refused' ? 'finished' : a.headers!==undefined ? 'body' : a.sent!==undefined ? 'headers' : 'dispatch',
      ...(a.sent===undefined ? {} : {headersMs:Math.max(0,(a.headers??end)-a.sent)}),
      // SDK completion means the full response body was read and parsed. No body or capability enters diagnostics.
      ...(a.headers===undefined ? {} : {bodyMs:Math.max(0,end-a.headers)}), ...(a.status===undefined?{}:{status:a.status}) };
  });
}
type RpcResult<T> = { data:T; error:unknown; status:number };
type Trace = { sample: Attempt; signal?: AbortSignal };
// The default path is the existing service-key adapter including its original 8 s timer covering the complete body.
export function createProofTransport(fetcher: typeof fetch, serviceKey: string, bind = serviceRoleFetch) {
  const active = new WeakMap<AbortSignal,Trace>();
  const ordinary = bind(fetcher,serviceKey);
  const observed: typeof fetch = (input,init) => {
    const signal=init?.signal; const t=signal && active.get(signal);
    if(!t) return ordinary(input,init);
    const grant = t.sample.stage==='authorization' || t.sample.stage==='revalidation';
    const expected = grant ? 'resolve_media_delivery' : 'resolve_media_variant_for_ticket_v1';
    const url=new URL(input instanceof Request ? input.url : String(input));
    if((init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()!=='POST' || url.pathname!==`/rest/v1/rpc/${expected}`) throw Error('Unexpected media proof operation');
    return bind(async (url,options) => {
      t.sample.sent=Date.now(); t.signal=options?.signal ?? undefined;
      const response=await fetcher(url,options);
      t.sample.headers=Date.now(); t.sample.status=response.status;
      return response;
    },serviceKey)(input,init);
  };
  async function run<T>(stage:ProofStage,budget:ProofBudget,parent:AbortSignal,read:(signal:AbortSignal)=>PromiseLike<RpcResult<T>>):Promise<T> {
    for(let n=1;n<=2;n++) {
      if(parent.aborted || Date.now()>=budget.until) throw Error('Media proof stopped');
      const signal=AbortSignal.any([parent]); const sample:Attempt={stage,number:n,started:Date.now()};
      const trace:Trace={sample}; active.set(signal,trace);budget.attempts.push(sample);
      try {
        const result=await read(signal);
        if(parent.aborted || Date.now()>=budget.until) {sample.result='cancelled';throw Error('Media proof stopped');}
        if(!result.error) {sample.result=result.data==null?'refused':'ok';return result.data;}
        // A database refusal, null grant, malformed payload, HTTP rejection or arbitrary network error is never replayed.
        // Retry only an existing SDK resolver read after its own bounded network signal expires. At most one replay is
        // shared by BOTH grant proofs, inside the original overall startup deadline. Variants remain single-attempt.
        const timedOut=result.status===0 && trace.signal?.aborted && trace.signal.reason?.name==='TimeoutError' && (sample.status===undefined || (sample.status>=200 && sample.status<300));
        sample.result=timedOut?'transport_timeout':'error';
        if(timedOut && n===1 && !budget.retried && (stage==='authorization'||stage==='revalidation') && budget.until-Date.now()>=1000) {budget.retried=true;continue;}
        throw Error('Media proof unavailable');
      } finally {sample.finished=Date.now();sample.result??=parent.aborted?'cancelled':'error';active.delete(signal);}
    }
    throw Error('Media proof unavailable');
  }
  return { fetch:observed,run };
}

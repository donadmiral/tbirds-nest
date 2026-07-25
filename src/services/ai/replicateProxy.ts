/**
 * replicateProxy
 *
 * All Replicate traffic goes through the replicate-proxy Edge Function, which
 * holds the API token. Nothing in the app bundle knows it any more.
 *
 * The proxy allows exactly three operations and restricts prediction creation
 * to an allowlist of model versions, so a leaked build cannot be used to run
 * arbitrary models on the account.
 */
import { supabase } from '../supabase';

type Op = 'ping' | 'create' | 'get';

async function call(op: Op, payload: Record<string, any> = {}): Promise<any> {
  const { data, error } = await supabase.functions.invoke('replicate-proxy', {
    body: { op, ...payload },
  });
  if (error) {
    let reason = error.message;
    try {
      const ctx: any = (error as any).context;
      if (ctx && typeof ctx.json === 'function') {
        const parsed = await ctx.json();
        if (parsed?.error) reason = parsed.error;
      }
    } catch { /* keep the original */ }
    throw new Error(reason);
  }
  return data;
}

/** Is Replicate reachable and the token valid. */
export async function replicatePing(): Promise<boolean> {
  try {
    const res = await call('ping');
    return !!res?.ok;
  } catch {
    return false;
  }
}

/** Start a prediction. Returns its id. */
export async function replicateCreate(version: string, input: Record<string, any>): Promise<string> {
  const res = await call('create', { version, input });
  if (!res?.id) throw new Error(res?.error || 'Replicate did not return a prediction');
  return res.id;
}

/** Poll until it finishes. Returns the output, or throws with the failure. */
export async function replicateWait(
  id: string,
  { maxAttempts = 60, intervalMs = 1000 }: { maxAttempts?: number; intervalMs?: number } = {},
): Promise<any> {
  for (let i = 0; i < maxAttempts; i++) {
    const data = await call('get', { id });
    if (data?.status === 'succeeded') return data.output;
    if (data?.status === 'failed' || data?.status === 'canceled') {
      throw new Error(data?.error || `Prediction ${data?.status}`);
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error('Prediction timed out');
}
import { createClient } from './supabase/client';
export { readCreatorSnapshot, registerCreatorInterest, applyToCreatorProgram, withFinanceDeadline } from '../../shared/monetization/client';
export { ENROLLMENT_LABELS, BALANCE_LABELS, PAYOUT_LABELS, formatMinor, payoutBlockReason, earningActivityLabel } from '../../shared/monetization/domain';
export type { CreatorSnapshot } from '../../shared/monetization/domain';
/** Read only the existing wallet-link contract. Never infer payout readiness. */
export async function readIntoBankLink(client: ReturnType<typeof createClient>, owner: string, signal: AbortSignal): Promise<boolean> {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session || data.session.user.id !== owner) throw new Error('Sign in again to check your IntoBank connection.');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('The IntoBank connection is unavailable.');
  const response = await fetch(`${url}/functions/v1/crisp-bridge?action=status`, {
    headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' }, signal,
  });
  const body = await response.json();
  if (!response.ok || body?.success !== true || typeof body.linked !== 'boolean') throw new Error('IntoBank could not confirm your connection. Please refresh.');
  return body.linked;
}

/** Uses the same explicit IntoBank approval-code contract as the phone. */
export async function linkIntoBankAccount(client: ReturnType<typeof createClient>, owner: string, code: string, signal: AbortSignal): Promise<void> {
  const unconfirmed = 'The connection result is not confirmed. Refresh your connection status before trying again.';
  // Auth refresh and response decoding do not accept the fetch signal. Race
  // every step against the same deadline/cancel signal so none can trap the UI.
  const waitFor = <T>(work: () => PromiseLike<T>): Promise<T> => new Promise((resolve, reject) => {
    const abort = () => reject(new Error(unconfirmed));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => { if (signal.aborted) throw new Error(unconfirmed); return work(); }).then(
      value => { signal.removeEventListener('abort', abort); if (signal.aborted) abort(); else resolve(value); },
      reason => { signal.removeEventListener('abort', abort); reject(reason); },
    );
  });
  const connectionCode = code.trim().toUpperCase();
  if (!/^[A-F0-9]{8}$/.test(connectionCode)) throw new Error('Enter the 8-character connection code from IntoBank.');
  const { data, error } = await waitFor(() => client.auth.getSession());
  if (error || !data.session || data.session.user.id !== owner) throw new Error('Your account changed. Sign in again before connecting IntoBank.');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('The IntoBank connection is unavailable.');
  let response: Response;
  try {
    response = await waitFor(() => fetch(`${url}/functions/v1/crisp-bridge?action=link`, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: connectionCode }),
    }));
  } catch { throw new Error(unconfirmed); }
  const body = await waitFor(() => response.json().catch(() => null));
  const current = await waitFor(() => client.auth.getSession());
  if (current.error || current.data.session?.user.id !== owner) throw new Error('Your account changed. Refresh your connection status.');
  if (!response.ok || body?.success !== true) {
    if (response.status === 401) throw new Error('Sign in again before connecting IntoBank.');
    if (response.status === 403) throw new Error('IntoBank has not enabled this connection for Platinum Circles yet.');
    if (response.status === 400 || response.status === 404 || response.status === 410) throw new Error('The approval code could not be used. Check it in IntoBank and try again.');
    throw new Error('IntoBank did not confirm the connection. Refresh your connection status before retrying.');
  }
}

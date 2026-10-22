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

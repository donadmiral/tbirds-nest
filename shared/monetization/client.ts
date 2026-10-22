import { parseCreatorSnapshot, type CreatorSnapshot } from './domain';
export type FinanceClient = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
};
/** Stops waiting, not the server operation. Mutations must retain uncertainty. */
export async function withFinanceDeadline<T>(work: PromiseLike<T>, message: string, ms = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]);
  } finally { if (timer) clearTimeout(timer); }
}
export async function readCreatorSnapshot(client: FinanceClient, userId: string): Promise<CreatorSnapshot> {
  const { data, error } = await withFinanceDeadline(client.rpc('creator_monetization_snapshot'), 'The earnings service took too long. Please refresh.');
  if (error) throw new Error(error.code === 'PGRST202' ? 'Creator monetization is not available on this deployment yet.' : 'Could not load your monetization status. Please try again.');
  return parseCreatorSnapshot(data, userId);
}
export async function registerCreatorInterest(client: FinanceClient, owner: string): Promise<void> {
  const uncertain = 'Your interest was not confirmed. Refresh before trying again.';
  const { data, error } = await withFinanceDeadline(client.rpc('creator_register_interest', { p_expected_user: owner }), uncertain);
  if (error || !['interested', 'applied', 'approved', 'rejected', 'suspended'].includes(String(data))) throw new Error(uncertain);
}
export async function applyToCreatorProgram(client: FinanceClient, owner: string, termsVersion: string): Promise<void> {
  const uncertain = 'Your application was not confirmed. Refresh to check the current program terms and status.';
  const { data, error } = await withFinanceDeadline(client.rpc('creator_apply', { p_expected_user: owner, p_terms_version: termsVersion }), uncertain);
  if (error || !['applied', 'approved', 'rejected', 'suspended'].includes(String(data))) throw new Error(uncertain);
}

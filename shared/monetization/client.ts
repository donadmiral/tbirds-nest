import { parseCreatorSnapshot, validMinor, type CreatorSnapshot } from './domain';
import { parseCreatorStatement, type StatementCursor } from './statement';
import { FINANCE_OPERATIONS_ENABLED, FINANCE_OPERATIONS_UNAVAILABLE } from './availability';
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
export async function readCreatorStatement(client: FinanceClient, owner: string, cursor: StatementCursor|null=null) {
  if (!FINANCE_OPERATIONS_ENABLED) throw new Error(FINANCE_OPERATIONS_UNAVAILABLE);
  const {data,error}=await withFinanceDeadline(client.rpc('creator_statement',{p_expected_user:owner,p_limit:50,p_before_at:cursor?.created_at??null,p_before_id:cursor?.id??null}),'Your statement took too long. Please retry.');
  if(error) throw new Error('Could not load your statement. Please retry.');
  return parseCreatorStatement(data,owner);
}
/** The UI retains this key and amount across uncertain responses. A timeout is
 * never evidence that the reservation or payout did not happen. */
export async function requestCreatorPayout(client:FinanceClient,owner:string,amountMinor:string,key:string):Promise<string> {
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if(!validMinor(amountMinor,true) || !uuid.test(key)) throw new Error('Invalid payout request.');
  const message='Your payout request was not confirmed. Refresh to check its status before trying again.';
  const {data,error}=await withFinanceDeadline(client.rpc('creator_request_payout',{p_expected_user:owner,p_currency:'USD',p_amount_minor:amountMinor,p_idempotency_key:key}),message);
  const rejection=error?.message;
  if(error && rejection && ['PAYOUT_PROVIDER_NOT_READY','CREATOR_NOT_APPROVED','PAYOUT_ACCOUNT_NOT_READY','UNSUPPORTED_CURRENCY','INVALID_AMOUNT','INSUFFICIENT_BALANCE','ACCOUNT_CHANGED','OUTSTANDING_REFUND_BALANCE'].includes(rejection)) {
    const failure=new Error('This request was not accepted. Refresh your account before requesting a payout.');
    Object.assign(failure,{confirmedRejected:true});throw failure;
  }
  if(error || typeof data!=='string' || !uuid.test(data)) throw new Error(message);
  return data;
}
